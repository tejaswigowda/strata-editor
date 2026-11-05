// player.js — a simple player for a published Strata render. The page's hash is the address of the render's folder (https://strataeditor.dev/video/<name>/v<N>/,
// or a jsDelivr one, or any file in it, or its GitHub page); see resolve.js. It reads render.json for the title, poster, captions and facts,
// and plays master.m3u8: natively where the browser does HLS (Safari), through hls.js everywhere else.

import { resolveBase, followsBranch, formatDuration, parseGh, pinnedBase, describeFailure, presentMode, cueParam, locateCue, candidateBases } from './resolve.js';
import { parseVtt } from '../editor/js/export/captions.js';
import { parseMaster, parseMediaPlaylist, audioFor, mergeFmp4, estimateBytes, formatBytes, downloadName } from './download.js';

const FETCH_TIMEOUT_MS = 6000, TTFB_MS = 6000, NATIVE_START_MS = 10000;
const $ = id => document.getElementById( id );
const video = $( 'video' ), qualityLabel = $( 'qualityLabel' ), quality = $( 'quality' );
let hls = null;

// Present mode: just the video (see presentMode in resolve.js). index.html decides it before first paint (the class is on <html>); decided again here on every hash change, since the hash can carry &present=true.
function framed() { try { return window.self !== window.top; } catch ( e ) { return true; } }     // a cross-origin parent throws: that is a frame
function applyPresent() { document.documentElement.classList.toggle( 'present', presentMode( { search: location.search, hash: location.hash, framed: framed() } ) ); }
applyPresent();

// The height that is really visible. On a phone 100vh is the page with the browser's own bars away, so a layout sized to it has its bottom (the controls, the
// footer) under them; the visual viewport is what is on screen, and it changes as the bars come and go. index.html sizes to --app-h, with 100dvh as its fallback.
function fit() { document.documentElement.style.setProperty( '--app-h', Math.round( window.visualViewport ? window.visualViewport.height : innerHeight ) + 'px' ); }
fit();
addEventListener( 'resize', fit ); addEventListener( 'orientationchange', fit );
if ( window.visualViewport ) window.visualViewport.addEventListener( 'resize', fit );

// The centre play button (present mode shows it): there while the video is paused or has ended, gone while it plays and when there is nothing to play.
const bigPlay = $( 'bigPlay' );
const syncBigPlay = () => { bigPlay.hidden = ! video.paused || !! $( 'error' ).textContent; };
[ 'play', 'playing', 'pause', 'ended', 'emptied' ].forEach( e => video.addEventListener( e, syncBigPlay ) );
bigPlay.addEventListener( 'click', () => { video.play().catch( () => { /* the browser refused (no gesture, no source yet): the controls remain */ } ); } );

function setError( text ) { $( 'error' ).textContent = text || ''; syncBigPlay(); }

/** After a failure on a branch address: look up the commit the branch is at now, and offer that exact address (jsDelivr caches a branch for hours). */
async function offerPinned( base ) {

	const gh = parseGh( base );
	if ( ! gh || ! followsBranch( base ) ) return;
	try {

		const api = ref => fetch( `https://api.github.com/repos/${ gh.owner }/${ gh.repo }/commits/${ encodeURIComponent( ref ) }` );
		let res = await api( gh.ref );
		if ( ! res.ok && gh.ref === 'latest' ) {

			const repo = await ( await fetch( `https://api.github.com/repos/${ gh.owner }/${ gh.repo }` ) ).json();
			res = await api( repo.default_branch );

		}
		if ( ! res.ok ) return;
		const sha = ( await res.json() ).sha;
		const pinned = pinnedBase( base, sha );
		if ( resolveBase( location.hash.slice( 1 ) ).base !== base ) return;     // the person has moved on to another render
		const a = document.createElement( 'a' );
		a.href = '#' + pinned;
		a.textContent = 'Play this exact commit instead (' + sha.slice( 0, 7 ) + ')';
		$( 'error' ).append( ' ', a );

	} catch ( e ) { /* the lookup is a convenience; the message above already says what failed */ }

}

function teardown() {

	if ( hls ) { hls.destroy(); hls = null; }
	if ( job ) job.abort();
	ctx = null; $( 'dl' ).hidden = true; $( 'dlFiles' ).innerHTML = ''; $( 'dlNote' ).textContent = '';
	video.removeAttribute( 'src' );
	video.querySelectorAll( 'track' ).forEach( t => t.remove() );
	video.removeAttribute( 'poster' );
	qualityLabel.hidden = true;
	quality.innerHTML = '';
	$( 'meta' ).textContent = '';
	$( 'warn' ).hidden = true;
	setError( '' );

}

function describe( rj ) {

	const r = rj.render || {}, s = rj.scene || {};
	const facts = [];
	if ( r.width ) facts.push( `<b>${ r.width }×${ r.height }</b> at ${ r.fps } fps` );
	if ( r.duration_s ) facts.push( `${ formatDuration( r.duration_s ) } (${ r.frames.toLocaleString( 'en-US' ) } frames)` );
	// render.json version 2 splits the claim: frames (verified) and bytes (the software encoder); version 1 had one boolean
	const d = r.determinism;
	const claim = d ? ( d.frames ? ( d.bytes ? 'frames verified, bytes reproducible' : 'frames verified' ) : 'frames not claimed deterministic' ) : r.deterministic ? 'temporally deterministic' : '';
	facts.push( r.mode === 'offline' ? ( 'offline render' + ( claim ? ', ' + claim : '' ) ) : r.mode ? `${ r.mode } capture` : '' );
	if ( s.file ) facts.push( `scene <b>${ s.file }</b>${ s.commit ? ' @ ' + s.commit.slice( 0, 7 ) : '' }` );
	if ( r.exporter ) facts.push( r.exporter );
	$( 'meta' ).innerHTML = facts.filter( Boolean ).join( ' · ' );

}

function levelChoices( h ) {

	quality.innerHTML = '';
	quality.add( new Option( 'Auto', '-1' ) );
	h.levels.map( ( l, i ) => [ l.height, i ] ).sort( ( x, y ) => y[ 0 ] - x[ 0 ] ).forEach( ( [ height, i ] ) => quality.add( new Option( `${ height }p`, String( i ) ) ) );   // best first; hls.js numbers them worst first
	qualityLabel.hidden = h.levels.length < 2;

}

async function play( input ) {

	teardown();
	const resolved = resolveBase( input );
	if ( resolved.error ) { document.title = 'Strata render player'; if ( input ) setError( resolved.error ); return; }
	const requested = resolved.base;
	let base = requested;
	$( 'address' ).value = requested;

	// render.json is read from the address asked for, and when that does not answer, from the next place that holds the same folder (its own publication.mirrors
	// are not known yet, so the convention stands in): a canonical address that is down must not take the page's title, poster and captions with it.
	let rj = null;
	for ( const g of candidateBases( requested ).slice( 0, 3 ) ) {

		try {

			const res = await fetch( g + 'render.json', { signal: AbortSignal.timeout( FETCH_TIMEOUT_MS ) } );
			if ( res.ok ) { rj = await res.json(); base = g; break; }     // a 404 moves on too: an edge can 404 a file that exists

		} catch ( e ) { /* no answer from this one: the next */ }

	}

	const sceneName = rj && rj.scene && rj.scene.file ? rj.scene.file.replace( /\.[^.]+$/, '' ) : base.replace( /\/$/, '' ).split( '/' ).pop();
	$( 'title' ).textContent = sceneName;
	document.title = sceneName + ' — Strata render player';
	if ( base !== requested ) { const w = $( 'warn' ); w.textContent = `${ new URL( requested ).host } does not serve this render, which is published: reading it from ${ new URL( base ).host } instead.`; w.hidden = false; }
	if ( rj ) describe( rj ); else $( 'meta' ).textContent = 'No render.json beside the playlist: playing it without the facts.';
	if ( followsBranch( requested ) ) {

		$( 'warn' ).textContent = 'This address follows a branch, so a CDN may keep serving an older render for a while after a new publish. Use a commit address (…@<sha>/…) to pin this exact render.';
		$( 'warn' ).hidden = false;

	}

	const outputs = ( rj && rj.outputs ) || {};
	video.poster = base + ( outputs.poster || 'poster.jpg' );
	// The captions: render.json lists every track (caption_tracks); older renders have just the one path. When the master carries a subtitle group the player lets
	// the HLS engine show them (a <track> as well would draw every cue twice); otherwise each file is a <track> of its own.
	const tracks = Array.isArray( outputs.caption_tracks ) && outputs.caption_tracks.length ? outputs.caption_tracks : ( outputs.captions ? [ { path: outputs.captions, language: 'en' } ] : [] );
	if ( ! tracks.some( t => t.hls ) ) {

		tracks.forEach( ( tr, i ) => {

			const t = document.createElement( 'track' );
			t.kind = 'subtitles'; t.label = tr.language === 'en' && tracks.length === 1 ? 'Captions' : tr.language; t.srclang = tr.language || 'en'; t.src = base + tr.path; t.default = i === 0;
			video.appendChild( t );

		} );

	}
	// A link can name a cue (&cue=<id>): go to where it begins. The cue is looked up in the render's own track, by its authored id.
	let startAt = null;
	const wantCue = cueParam( { search: location.search, hash: location.hash } );
	if ( wantCue && tracks.length ) {

		try {

			const res = await fetch( base + tracks[ 0 ].path );
			const found = res.ok ? locateCue( parseVtt( await res.text() ).cues, wantCue ) : { error: `The captions (${ tracks[ 0 ].path }) could not be fetched, so cue "${ wantCue }" cannot be found.` };
			if ( found.error ) setError( found.error );
			else { startAt = found.start; $( 'meta' ).innerHTML += ` \u00b7 cue <b>${ wantCue.replace( /[<>&"]/g, '' ) }</b> at ${ formatDuration( found.start ) }`; }

		} catch ( e ) { setError( `The captions could not be read, so cue "${ wantCue }" cannot be found.` ); }

	} else if ( wantCue ) setError( `This render has no captions, so there is no cue "${ wantCue }" to go to.` );

	const masterName = outputs.master || 'master.m3u8';
	// Safari (and iOS, which has no Media Source) plays HLS natively. Elsewhere hls.js, even where the browser can now play HLS itself (recent Chrome),
	// because only hls.js gives the quality choice.
	const native = !! video.canPlayType( 'application/vnd.apple.mpegurl' );
	const safari = /^((?!chrome|chromium|android).)*safari/i.test( navigator.userAgent );
	const useHls = !! ( window.Hls && window.Hls.isSupported() ) && ! ( native && safari );
	if ( ! useHls && ! native ) { setError( 'This browser can play neither native HLS nor hls.js (it needs Media Source Extensions).' ); return; }

	// A CDN serving a freshly published tag can answer 404 for a file that exists, from one edge and not another, and hold that answer longer than hls.js retries
	// (six times, about 30 s). A 404 or no answer therefore moves playback to the next host that serves the same immutable folder (resolve.js candidateBases: the canonical address, the render's mirrors, the other jsDelivr hostnames),
	// from where it had got to, and says so; only when every host has failed is it an error.
	const hosts = candidateBases( base, rj && rj.publication );
	const tried = [];
	ctx = { hosts, good: 0, masterName, scene: sceneName, rj, outputs, tracks };
	function start( at, from ) {

		const origin = hosts[ tried.length ], master = origin + masterName;
		tried.push( new URL( origin ).host ); ctx.good = tried.length - 1;
		if ( tried.length > 1 ) { const w = $( 'warn' ), note = `${ from } answered 404 or nothing for a file of this render, which is published: playing it from ${ tried[ tried.length - 1 ] } instead.`; w.textContent = ( w.hidden ? '' : w.textContent + ' ' ) + note; w.hidden = false; }
		const resume = at !== null && at !== undefined && at > 0 ? at : null;
		const failed = ( detail ) => {

			if ( tried.length < hosts.length ) { start( video.currentTime > 0 ? video.currentTime : resume, tried[ tried.length - 1 ] ); return; }
			setError( detail + ` Is the render published, and has the CDN caught up? (tried ${ tried.join( ', ' ) })` );
			offerPinned( base );

		};
		if ( ! useHls ) {

			// native HLS has no retry policy to tune, so a host that neither plays nor errors is given up on after a timeout
			let moved = false;
			const move = detail => { if ( moved ) return; moved = true; clearTimeout( timer ); failed( detail ); };
			const timer = setTimeout( () => { if ( video.readyState === 0 ) move( `${ master } did not start in time.` ); }, tried.length < hosts.length ? NATIVE_START_MS : NATIVE_START_MS * 3 );
			video.src = master;
			if ( resume !== null ) video.addEventListener( 'loadedmetadata', () => { video.currentTime = resume; }, { once: true } );
			video.addEventListener( 'loadedmetadata', () => { moved = true; clearTimeout( timer ); }, { once: true } );
			video.addEventListener( 'error', () => move( `The browser could not play ${ master }.` ), { once: true } );
			return;

		}
		// while another host is left, give up on this one quickly (two short retries); the last host keeps hls.js's full patience
		// and a host that does not start answering within a few seconds counts as down, so a dead canonical address costs seconds and not minutes
		const D = window.Hls.DefaultConfig || {}, quick = p => ( p && p.default ? { ...p, default: { ...p.default, maxTimeToFirstByteMs: TTFB_MS,
			...( p.default.errorRetry ? { errorRetry: { ...p.default.errorRetry, maxNumRetry: 2, retryDelayMs: 500, maxRetryDelayMs: 2000 } } : {} ),
			...( p.default.timeoutRetry ? { timeoutRetry: { ...p.default.timeoutRetry, maxNumRetry: 1, retryDelayMs: 0 } } : {} ) } } : p );
		const patience = tried.length < hosts.length ? Object.fromEntries( [ 'fragLoadPolicy', 'playlistLoadPolicy', 'manifestLoadPolicy' ].filter( k => D[ k ] ).map( k => [ k, quick( D[ k ] ) ] ) ) : {};
		hls = new window.Hls( { capLevelToPlayerSize: false, ...patience, ...( resume !== null ? { startPosition: resume } : {} ) } );
		const mine = hls;
		hls.on( window.Hls.Events.MANIFEST_PARSED, () => levelChoices( mine ) );
		hls.on( window.Hls.Events.ERROR, ( e, data ) => {

			if ( ! data.fatal ) return;
			const code = data.response && data.response.code !== undefined ? data.response.code : null;
			const detail = describeFailure( data, master );
			mine.destroy(); if ( hls === mine ) hls = null;
			// only a missing answer moves on: a 403 or a decode error would be the same from every host
			if ( code === 404 || code === 0 || code === null ) failed( detail ); else { setError( detail + ' Is the render published, and has the CDN caught up?' ); offerPinned( base ); }

		} );
		hls.loadSource( master );
		hls.attachMedia( video );

	}
	start( startAt, '' );
	loadDownloads();

}

// ── download ────────────────────────────────────────────────────────────────────────────────────────────────────────
// One file from the ladder: the chosen rung's video, and the render's audio if it has any, merged into a single MP4 in the browser (download.js). Every request goes
// through fetchRender, which tries the same hosts as playback, because a CDN that 404s a segment for the player will 404 it for a download too.

let ctx = null, job = null;
const dlNote = text => { $( 'dlNote' ).textContent = text || ''; };

// a file that has a next host to fall back to is given a while, not forever (a segment is under 20 MB); the last host is waited for
const DOWNLOAD_FILE_TIMEOUT_MS = 60000;
function withTimeout( signal, ms ) {

	const t = AbortSignal.timeout( ms );
	return signal && AbortSignal.any ? AbortSignal.any( [ signal, t ] ) : t;

}

async function fetchRender( path, signal ) {

	let last = null;
	for ( let k = 0; k < ctx.hosts.length; k ++ ) {

		const i = ( ctx.good + k ) % ctx.hosts.length, host = new URL( ctx.hosts[ i ] ).host;
		try {

			const res = await fetch( ctx.hosts[ i ] + path, { signal: k < ctx.hosts.length - 1 ? withTimeout( signal, DOWNLOAD_FILE_TIMEOUT_MS ) : signal } );
			if ( res.ok ) { ctx.good = i; return res; }
			last = new Error( `${ path }: HTTP ${ res.status } from ${ host }` );

		} catch ( e ) { if ( e.name === 'AbortError' ) throw e; last = new Error( `${ path }: ${ e.message } (${ host })` ); }

	}
	throw last;

}

function saveBlob( blob, name ) {

	const url = URL.createObjectURL( blob ), a = document.createElement( 'a' );
	a.href = url; a.download = name; document.body.append( a ); a.click(); a.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 60000 );

}

async function saveFile( path, name, type ) {

	const my = ctx;
	try { dlNote( 'Fetching ' + name + '…' ); saveBlob( new Blob( [ await ( await fetchRender( path ) ).arrayBuffer() ], { type } ), name ); if ( ctx === my ) dlNote( 'Saved ' + name ); }
	catch ( e ) { if ( ctx === my ) dlNote( 'Could not fetch ' + path + ': ' + e.message ); }

}

/** Offer what this render has: the video at each of its rungs, and its small files. Never an error to the person: with no master there is just nothing to offer. */
async function loadDownloads() {

	const my = ctx;
	try {

		const master = parseMaster( await ( await fetchRender( my.masterName ) ).text() );
		if ( ctx !== my || ! master.renditions.length ) return;
		const film = parseMediaPlaylist( await ( await fetchRender( master.renditions[ 0 ].uri ) ).text() );
		if ( ctx !== my ) return;
		my.master = master; my.seconds = film.duration;
		const sel = $( 'dlQuality' );
		sel.innerHTML = '';
		master.renditions.forEach( ( r, i ) => sel.add( new Option( `${ r.name } · ${ r.width }×${ r.height }${ estimateBytes( r, film.duration ) ? ' · ≈ ' + formatBytes( estimateBytes( r, film.duration ) ) : '' }`, String( i ) ) ) );
		sel.hidden = master.renditions.length < 2;

		const files = $( 'dlFiles' );
		files.innerHTML = '';
		const add = ( label, path, name, type ) => { const b = document.createElement( 'button' ); b.type = 'button'; b.textContent = label; b.addEventListener( 'click', () => saveFile( path, name, type ) ); files.append( b ); };
		for ( const t of my.tracks ) add( my.tracks.length > 1 ? `Captions (${ t.language })` : 'Captions', t.path, downloadName( my.scene, my.tracks.length > 1 ? t.language : '', 'vtt' ), 'text/vtt' );
		add( 'Poster', ( my.outputs.poster || 'poster.jpg' ), downloadName( my.scene, 'poster', 'jpg' ), 'image/jpeg' );
		if ( my.rj ) add( 'render.json', 'render.json', downloadName( my.scene, 'render', 'json' ), 'application/json' );
		$( 'dl' ).hidden = false;

	} catch ( e ) { /* the player still plays; there is just nothing to offer */ }

}

async function downloadVideo() {

	const button = $( 'dlVideo' );
	if ( job ) { job.abort(); return; }                                    // a second tap cancels
	const my = ctx, rung = my && my.master && my.master.renditions[ Number( $( 'dlQuality' ).value ) ];
	if ( ! rung ) return;
	const ac = job = new AbortController(), label = button.textContent;
	button.textContent = 'Cancel';
	try {

		dlNote( 'Reading the playlists…' );
		const plan = async path => { const pl = parseMediaPlaylist( await ( await fetchRender( path, ac.signal ) ).text() ); if ( ! pl.init || ! pl.segments.length ) throw new Error( path + ' lists no segments' ); return { dir: path.replace( /[^/]*$/, '' ), pl }; };
		const video = await plan( rung.uri ), audioRef = audioFor( my.master, rung ), audio = audioRef ? await plan( audioRef.uri ) : null;
		const runs = [ video, ...( audio ? [ audio ] : [] ) ];
		const total = runs.reduce( ( n, r ) => n + 1 + r.pl.segments.length, 0);
		let done = 0, bytes = 0;
		const grab = async path => { const buf = new Uint8Array( await ( await fetchRender( path, ac.signal ) ).arrayBuffer() ); done ++; bytes += buf.length; dlNote( `Downloading ${ done } of ${ total } · ${ formatBytes( bytes ) }${ audio ? ' (video and audio)' : '' }` ); return buf; };
		const fetchRun = async r => {

			const init = await grab( r.dir + r.pl.init ), segments = new Array( r.pl.segments.length );
			let next = 0;
			await Promise.all( Array.from( { length: 4 }, async () => { while ( next < segments.length ) { const i = next ++; segments[ i ] = await grab( r.dir + r.pl.segments[ i ].uri ); } } ) );
			return { init, segments };

		};
		const [ v, a ] = [ await fetchRun( video ), audio ? await fetchRun( audio ) : null ];
		dlNote( 'Putting it together…' );
		const merged = mergeFmp4( v, a );
		const name = downloadName( my.scene, rung.name, 'mp4' );
		saveBlob( new Blob( merged.parts, { type: 'video/mp4' } ), name );
		dlNote( `Saved ${ name } (${ formatBytes( merged.bytes ) }${ a ? ', with its audio' : audioRef === null ? ', no audio track: this render is silent' : '' })` );

	} catch ( e ) {

		dlNote( e.name === 'AbortError' ? 'Cancelled.' : 'Could not download: ' + e.message );

	} finally { job = null; button.textContent = label; }

}
$( 'dlVideo' ).addEventListener( 'click', downloadVideo );

quality.addEventListener( 'change', () => { if ( hls ) hls.currentLevel = Number( quality.value ); } );
$( 'form' ).addEventListener( 'submit', e => {

	e.preventDefault();
	const r = resolveBase( $( 'address' ).value );
	if ( r.error ) { setError( r.error ); return; }
	if ( location.hash.slice( 1 ) === r.base ) play( r.base ); else location.hash = r.base;   // the hash is the address

} );
addEventListener( 'hashchange', () => { applyPresent(); play( location.hash.slice( 1 ) ); } );
addEventListener( 'keydown', e => {

	if ( e.target.matches( 'input, select, button' ) || e.metaKey || e.ctrlKey || e.altKey ) return;
	if ( e.key === ' ' ) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
	else if ( e.key === 'f' ) { document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen && video.requestFullscreen(); }
	else if ( e.key === 'ArrowRight' ) video.currentTime += 5;
	else if ( e.key === 'ArrowLeft' ) video.currentTime -= 5;

} );

play( location.hash.slice( 1 ) );
