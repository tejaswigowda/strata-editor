// player.js — a simple player for a published Strata render. The page's hash is the jsDelivr address of the render's folder
// (or of any file in it, or its GitHub page); see resolve.js. It reads render.json for the title, poster, captions and facts,
// and plays master.m3u8: natively where the browser does HLS (Safari), through hls.js everywhere else.

import { resolveBase, followsBranch, formatDuration, parseGh, pinnedBase, describeFailure, presentMode, cueParam, locateCue } from './resolve.js';
import { parseVtt } from '../editor/js/export/captions.js';

const $ = id => document.getElementById( id );
const video = $( 'video' ), qualityLabel = $( 'qualityLabel' ), quality = $( 'quality' );
let hls = null;

// Present mode: just the video (see presentMode in resolve.js). Decided again on every hash change, since the hash can carry &present=true.
function framed() { try { return window.self !== window.top; } catch ( e ) { return true; } }     // a cross-origin parent throws: that is a frame
function applyPresent() { document.body.classList.toggle( 'present', presentMode( { search: location.search, hash: location.hash, framed: framed() } ) ); }
applyPresent();

function setError( text ) { $( 'error' ).textContent = text || ''; }

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
	const base = resolved.base;
	$( 'address' ).value = base;

	let rj = null;
	try {

		const res = await fetch( base + 'render.json' );
		if ( res.ok ) rj = await res.json();

	} catch ( e ) { /* no render.json: it still plays */ }

	const sceneName = rj && rj.scene && rj.scene.file ? rj.scene.file.replace( /\.[^.]+$/, '' ) : base.replace( /\/$/, '' ).split( '/' ).pop();
	$( 'title' ).textContent = sceneName;
	document.title = sceneName + ' — Strata render player';
	if ( rj ) describe( rj ); else $( 'meta' ).textContent = 'No render.json beside the playlist: playing it without the facts.';
	if ( followsBranch( base ) ) {

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

	const master = base + ( outputs.master || 'master.m3u8' );
	// Safari (and iOS, which has no Media Source) plays HLS natively. Elsewhere hls.js, even where the browser can now play HLS itself (recent Chrome),
	// because only hls.js gives the quality choice.
	const native = !! video.canPlayType( 'application/vnd.apple.mpegurl' );
	const safari = /^((?!chrome|chromium|android).)*safari/i.test( navigator.userAgent );
	const useHls = !! ( window.Hls && window.Hls.isSupported() ) && ! ( native && safari );
	if ( ! useHls && native ) {

		video.src = master;
		if ( startAt !== null ) video.addEventListener( 'loadedmetadata', () => { video.currentTime = startAt; }, { once: true } );
		video.addEventListener( 'error', () => setError( `The browser could not play ${ master }.` ), { once: true } );

	} else if ( useHls ) {

		hls = new window.Hls( { capLevelToPlayerSize: false, ...( startAt !== null ? { startPosition: startAt } : {} ) } );
		hls.on( window.Hls.Events.MANIFEST_PARSED, () => levelChoices( hls ) );
		hls.on( window.Hls.Events.ERROR, ( e, data ) => {

			if ( ! data.fatal ) return;
			setError( describeFailure( data, master ) + ' Is the render published, and has the CDN caught up?' );
			offerPinned( base );
			hls.destroy(); hls = null;

		} );
		hls.loadSource( master );
		hls.attachMedia( video );

	} else {

		setError( 'This browser can play neither native HLS nor hls.js (it needs Media Source Extensions).' );

	}

}

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
