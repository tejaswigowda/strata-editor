// player.js — a simple player for a published Strata render. The page's hash is the jsDelivr address of the render's folder
// (or of any file in it, or its GitHub page); see resolve.js. It reads render.json for the title, poster, captions and facts,
// and plays master.m3u8: natively where the browser does HLS (Safari), through hls.js everywhere else.

import { resolveBase, followsBranch, formatDuration } from './resolve.js';

const $ = id => document.getElementById( id );
const video = $( 'video' ), qualityLabel = $( 'qualityLabel' ), quality = $( 'quality' );
let hls = null;

function setError( text ) { $( 'error' ).textContent = text || ''; }

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
	facts.push( r.mode === 'offline' ? ( r.deterministic ? 'offline render, temporally deterministic' : 'offline render' ) : r.mode ? `${ r.mode } capture` : '' );
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
	if ( outputs.captions ) {

		const t = document.createElement( 'track' );
		t.kind = 'subtitles'; t.label = 'Captions'; t.srclang = 'en'; t.src = base + outputs.captions; t.default = true;
		video.appendChild( t );

	}

	const master = base + ( outputs.master || 'master.m3u8' );
	// Safari (and iOS, which has no Media Source) plays HLS natively. Elsewhere hls.js, even where the browser can now play HLS itself (recent Chrome),
	// because only hls.js gives the quality choice.
	const native = !! video.canPlayType( 'application/vnd.apple.mpegurl' );
	const safari = /^((?!chrome|chromium|android).)*safari/i.test( navigator.userAgent );
	const useHls = !! ( window.Hls && window.Hls.isSupported() ) && ! ( native && safari );
	if ( ! useHls && native ) {

		video.src = master;
		video.addEventListener( 'error', () => setError( `The browser could not play ${ master }.` ), { once: true } );

	} else if ( useHls ) {

		hls = new window.Hls( { capLevelToPlayerSize: false } );
		hls.on( window.Hls.Events.MANIFEST_PARSED, () => levelChoices( hls ) );
		hls.on( window.Hls.Events.ERROR, ( e, data ) => {

			if ( ! data.fatal ) return;
			setError( `Playback failed (${ data.details }). Is ${ master } reachable, and has the render finished publishing?` );
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
addEventListener( 'hashchange', () => play( location.hash.slice( 1 ) ) );
addEventListener( 'keydown', e => {

	if ( e.target.matches( 'input, select, button' ) || e.metaKey || e.ctrlKey || e.altKey ) return;
	if ( e.key === ' ' ) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
	else if ( e.key === 'f' ) { document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen && video.requestFullscreen(); }
	else if ( e.key === 'ArrowRight' ) video.currentTime += 5;
	else if ( e.key === 'ArrowLeft' ) video.currentTime -= 5;

} );

play( location.hash.slice( 1 ) );
