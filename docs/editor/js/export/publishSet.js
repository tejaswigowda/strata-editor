// ── publishSet.js ──────────────────────────────────────────────────────────────
// The publishable set of one render, as pure functions: the ladder, the captions, the file list with its sizes, the size gates and
// the warnings the Render tab shows before anything is committed. No browser APIs: the encoding lives in ladder.js.
//
//   renders/<scene>/render.json  poster.jpg  captions.vtt  master.m3u8
//   renders/<scene>/1080p60/init.mp4  seg00001.m4s …  index.m3u8   (and 720p60, 480p60)

import { masterPlaylist } from './fmp4.js';
import { buildRenderJson, formatBytes, assessDeterminism, LIMITS } from './renderJson.js';

/** The ladder, highest first: target heights and the bitrates the work order names. */
export const RUNGS = Object.freeze( [
	{ height: 1080, kbps: 3500 },
	{ height: 720, kbps: 1800 },
	{ height: 480, kbps: 900 },
] );

const even = n => Math.max( 2, Math.round( n / 2 ) * 2 );

/**
 * The rungs for a master of this size: never larger than the master (no upscaling), same aspect ratio, even dimensions.
 * `keep` (optional) is the list of heights the user left ticked. A master smaller than the lowest rung gets one rung at its own size.
 */
export function planLadder( { width, height, fps, keep = null } ) {

	const aspect = width / height;
	let rungs = RUNGS.filter( r => r.height <= height );
	if ( rungs.length === 0 ) rungs = [ { height, kbps: Math.max( 200, Math.round( RUNGS[ RUNGS.length - 1 ].kbps * ( height / RUNGS[ RUNGS.length - 1 ].height ) ** 2 ) ) } ];
	if ( keep ) rungs = rungs.filter( r => keep.includes( r.height ) );
	return rungs.map( r => ( {
		name: `${ r.height }p${ fps }`, height: r.height === height ? height : even( r.height ), width: r.height === height ? width : even( r.height * aspect ),
		kbps: r.kbps,
	} ) );

}

const pad = ( n, w = 2 ) => String( n ).padStart( w, '0' );

/** Seconds -> 00:00:04.650 (WebVTT timestamp). */
export function vttTime( seconds ) {

	const ms = Math.round( seconds * 1000 );
	return `${ pad( Math.floor( ms / 3600000 ) ) }:${ pad( Math.floor( ms / 60000 ) % 60 ) }:${ pad( Math.floor( ms / 1000 ) % 60 ) }.${ pad( ms % 1000, 3 ) }`;

}

/** The scene's subtitle cues ({ start, end, text } in output seconds) as WebVTT. Returns null when there are none. */
export function cuesToVtt( cues ) {

	const list = ( cues || [] ).filter( c => c && String( c.text ).trim() !== '' && c.end > c.start ).sort( ( a, b ) => a.start - b.start );
	if ( list.length === 0 ) return null;
	// a cue's text may not contain a blank line or "-->"
	const clean = t => String( t ).replace( /\r/g, '' ).replace( /\n{2,}/g, '\n' ).replace( /-->/g, '\u2192' ).trim();
	return 'WEBVTT\n\n' + list.map( ( c, i ) => `${ i + 1 }\n${ vttTime( c.start ) } --> ${ vttTime( c.end ) }\n${ clean( c.text ) }\n` ).join( '\n' );

}

/** renders/<scene-basename>/ for a scene file such as "piston.json". */
export function defaultPublishPath( sceneFile ) {

	const base = String( sceneFile || 'scene.json' ).split( '/' ).pop().replace( /\.[^./]+$/, '' ) || 'scene';
	return 'renders/' + base.replace( /[^A-Za-z0-9._+-]+/g, '-' );

}

const enc = new TextEncoder();
const bytesOf = v => typeof v === 'string' ? enc.encode( v ) : v;

/**
 * @param {object} i
 *   path:        'renders/piston'
 *   scene:       { repo, file, branch, commit, hash }
 *   render:      { mode, renderer, device, fps, frames, frameRange, width, height, renderedAt }
 *   rungs:       [{ rung: { name, width, height, kbps }, packaged: packageRendition() output }]
 *   poster:      Uint8Array
 *   captions:    string | null     (WebVTT; written whenever the scene has cues, burned in or not)
 *   audio:       null | { packaged: packageAudio(), name, language, source: { path, sha256 }, delaySamples }
 *   determinism: { mode, encoder, hasEndCard, playbackWasRunning }   (assessDeterminism's input)
 * @returns {{ files: { path, bytes: Uint8Array }[], renderJson, total: number, errors: string[], warnings: string[], tree: { path, bytes }[] }}
 */
export function assemblePublishSet( { path, scene, render, rungs, poster, captions, audio = null, determinism } ) {

	const files = [];
	const rel = ( ...p ) => path + '/' + p.join( '/' );
	const add = ( relPath, data ) => files.push( { path: rel( relPath ), bytes: bytesOf( data ) } );

	add( 'poster.jpg', poster );
	if ( captions ) add( 'captions.vtt', captions );

	const renditions = [];
	for ( const { rung, packaged } of rungs ) {

		add( `${ rung.name }/init.mp4`, packaged.init );
		for ( const s of packaged.segments ) add( `${ rung.name }/${ s.name }`, s.data );
		add( `${ rung.name }/index.m3u8`, packaged.playlist );
		renditions.push( {
			name: rung.name, width: rung.width, height: rung.height, bitrateKbps: rung.kbps,
			playlist: `${ rung.name }/index.m3u8`, segments: packaged.segments.length, maxSegmentBytes: packaged.maxSegmentBytes,
		} );

	}

	let audioMeta = null;
	if ( audio ) {

		const a = audio.packaged;
		add( 'audio/init.mp4', a.init );
		for ( const s of a.segments ) add( `audio/${ s.name }`, s.data );
		add( 'audio/index.m3u8', a.playlist );
		audioMeta = {
			name: audio.name, language: audio.language, bitrateKbps: 128, sampleRate: 48000, channels: 2, playlist: 'audio/index.m3u8', segments: a.segments.length,
			maxSegmentBytes: a.maxSegmentBytes, durationS: a.durationSeconds, source: audio.source, delaySamples: audio.delaySamples,
		};

	}

	add( 'master.m3u8', masterPlaylist( rungs.map( ( { rung, packaged } ) => ( {
		name: rung.name, width: rung.width, height: rung.height, playlist: `${ rung.name }/index.m3u8`,
		codec: packaged.codec, bandwidth: packaged.bandwidth, averageBandwidth: packaged.averageBandwidth,
	} ) ), render.fps, audio ? { groupId: 'aud', name: audio.name, language: audio.language, uri: 'audio/index.m3u8', codec: 'mp4a.40.2', bandwidth: audio.packaged.bandwidth, averageBandwidth: audio.packaged.averageBandwidth } : null ) );

	const renderJson = buildRenderJson( {
		scene, render, renditions, captions: captions ? 'captions.vtt' : null, audio: audioMeta,
		determinism: assessDeterminism( determinism ),
		files: files.map( f => ( { path: f.path, bytes: f.bytes.length } ) ),
	} );
	files.unshift( { path: rel( 'render.json' ), bytes: enc.encode( JSON.stringify( renderJson, null, 2 ) + '\n' ) } );

	const total = files.reduce( ( n, f ) => n + f.bytes.length, 0 );
	const { errors, warnings } = sizeReport( files, total, audioMeta ? [ ...renditions, { name: 'audio', maxSegmentBytes: audioMeta.maxSegmentBytes } ] : renditions, renderJson.render.deterministic );
	return { files, renderJson, total, errors, warnings, tree: files.map( f => ( { path: f.path, bytes: f.bytes.length } ) ) };

}

/**
 * The size gates (errors block the publish) and the warnings (shown with the real numbers before the commit).
 *   error:   a segment at or over 20 MB (jsDelivr's cap), any file at or over 100 MB (GitHub's hard limit)
 *   warning: always, the total and what git does with binaries; louder over 100 MB
 */
export function sizeReport( files, total, renditions, deterministic ) {

	const errors = [];
	const warnings = [];
	for ( const r of renditions ) {

		if ( r.maxSegmentBytes >= LIMITS.segmentBytes ) errors.push( `${ r.name }: a segment is ${ formatBytes( r.maxSegmentBytes ) }, over the 20 MB limit jsDelivr serves. Drop this rung or lower its bitrate.` );

	}
	for ( const f of files ) {

		if ( f.bytes.length >= LIMITS.fileBytes ) errors.push( `${ f.path } is ${ formatBytes( f.bytes.length ) }: GitHub refuses files of 100 MB or more.` );

	}

	let warning = `This commit adds ${ formatBytes( total ) } in ${ files.length } files. Git keeps every version of a binary forever: rendering and publishing six times stores six full copies (about ${ formatBytes( total * 6 ) }).`;
	if ( total > LIMITS.warnTotalBytes ) warning = `This commit is over 100 MB (${ formatBytes( total ) } in ${ files.length } files). ` + warning.replace( /^This commit adds [^.]*\.\s*/, '' );
	warnings.push( warning );
	warnings.push( 'To keep scene history light, publish to a separate "renders" branch (it can be squashed without touching the scene\u2019s history) or to a separate media repository.' );
	if ( deterministic ) warnings.push( 'This render is temporally deterministic: it can be regenerated from the scene and render.json, so it is a build artifact and old renders can be pruned. (Pixels may still differ across GPUs.)' );
	return { errors, warnings };

}

/** "scene unchanged since render" or the stale warning, from the two hashes. */
export function stalenessLine( renderHash, currentHash ) {

	if ( ! renderHash ) return { stale: true, text: 'The scene\u2019s state at render time was not recorded; treat this render as stale.' };
	if ( renderHash === currentHash ) return { stale: false, text: 'Scene unchanged since render.' };
	return { stale: true, text: 'The scene has changed \u2014 this render is stale. Render again before publishing, or publish it knowing it no longer matches the scene.' };

}

