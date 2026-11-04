#!/usr/bin/env node
// size-check: the trip wires for staying on GitHub Pages (guides/CDN_INDEPENDENCE.md, "Trip wires"), and the guard that the editor repository gains no encoded video.
//
//   node tools/size-check.mjs [--limit-mb 700]       exit 1 when a trip wire is crossed
//
//   video    no tracked file with a video extension, except the ones listed in VIDEO_ALLOWED. Renders live in the renders repository; every short is ~50-120 MB of
//            H.264 that git cannot delta, in the repository people clone to work on the editor, for ever.
//   size     the tracked files of docs/ (what Pages serves) add up to less than the limit. Pages caps a site at about 1 GB; the move to storage begins at 700 MB.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

export const VIDEO_EXT = /\.(m4s|mp4|m3u8|webm|mov|mkv|avi)$/i;
/** Grandfathered: here before the guard (16.7 MB, a tutorial demo). Not counted against the guard, and not a precedent. Adding to this list is a decision, not a default. */
export const VIDEO_ALLOWED = [ 'docs/about/tutorials/demos/pyth.mp4' ];
export const SITE_LIMIT_MB = 700;

/** @param {{ path: string, bytes: number }[]} files tracked files; returns { ok, video: string[], siteMb, limitMb, overLimit } */
export function assessSite( files, { limitMb = SITE_LIMIT_MB, allowed = VIDEO_ALLOWED } = {} ) {

	const video = files.filter( f => VIDEO_EXT.test( f.path ) && ! allowed.includes( f.path ) ).map( f => f.path );
	const siteMb = files.filter( f => f.path.startsWith( 'docs/' ) ).reduce( ( n, f ) => n + f.bytes, 0 ) / ( 1024 * 1024 );
	const overLimit = siteMb >= limitMb;
	return { ok: video.length === 0 && ! overLimit, video, siteMb, limitMb, overLimit };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const i = process.argv.indexOf( '--limit-mb' );
	const limitMb = i >= 0 ? Number( process.argv[ i + 1 ] ) : SITE_LIMIT_MB;
	const files = execFileSync( 'git', [ 'ls-files', '-z' ], { encoding: 'utf8', maxBuffer: 1 << 28 } ).split( '\0' ).filter( Boolean ).flatMap( path => { try { return [ { path, bytes: statSync( path ).size } ]; } catch ( e ) { return []; } } );
	const r = assessSite( files, { limitMb } );
	console.log( `Pages site (tracked docs/): ${ r.siteMb.toFixed( 0 ) } MB of the ${ r.limitMb } MB trip wire (GitHub's cap is about 1 GB)` );
	for ( const v of r.video ) console.log( `  ENCODED VIDEO in the editor repository: ${ v }. Renders belong in the renders repository.` );
	if ( r.overLimit ) console.log( '  OVER THE TRIP WIRE: begin the move to storage (guides/CDN_INDEPENDENCE.md).' );
	process.exit( r.ok ? 0 : 1 );

}
