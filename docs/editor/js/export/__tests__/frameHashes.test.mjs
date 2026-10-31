// Run: node docs/editor/js/export/__tests__/frameHashes.test.mjs
// Per-frame hashes and the shuffled-order test: the sidecar, the root hash, the diff of two renders, the stride and the shuffle, and the verdict.
import assert from 'node:assert';
import { packRgb, hashFrame, sidecarText, parseSidecar, rootHash, diffHashes, frameRanges, strideFrames, shuffledOrder, seedOf, mulberry32, verificationResult } from '../frameHashes.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const frame = ( v ) => new Uint8ClampedArray( [ v, v + 1, v + 2, 255, v, v + 1, v + 2, 255 ] );

await test( 'RGB is the pixels without their alpha, and the hash is sha256 of those bytes', async () => {

	assert.deepStrictEqual( [ ...packRgb( frame( 10 ) ) ], [ 10, 11, 12, 10, 11, 12 ] );
	const h = await hashFrame( frame( 10 ) );
	assert.match( h, /^[0-9a-f]{64}$/ );
	assert.strictEqual( h, await hashFrame( frame( 10 ) ), 'the same pixels, the same hash' );
	assert.notStrictEqual( h, await hashFrame( frame( 11 ) ) );
	const alphaOnly = frame( 10 ); alphaOnly[ 3 ] = 7;
	assert.strictEqual( h, await hashFrame( alphaOnly ), 'alpha is not part of the hash' );
	const crypto = await import( 'node:crypto' );
	assert.strictEqual( h, crypto.createHash( 'sha256' ).update( Buffer.from( [ 10, 11, 12, 10, 11, 12 ] ) ).digest( 'hex' ), 'it is plain sha256 of the RGB bytes: anyone can check it' );

} );

await test( 'the sidecar is one line per frame, parses back, and its root hash changes when any frame does', async () => {

	const hashes = await Promise.all( [ 1, 2, 3 ].map( v => hashFrame( frame( v ) ) ) );
	const text = sidecarText( { hashes, first: 40, width: 2, height: 1, fps: 60 } );
	assert.match( text, /^# strata-frame-hashes 1\n# sha256 over raw RGB/ );
	assert.strictEqual( text.split( '\n' ).filter( l => /^\d+ /.test( l ) ).length, 3 );
	assert.deepStrictEqual( parseSidecar( text ), { first: 40, hashes } );
	const root = await rootHash( text );
	assert.match( root, /^sha256:[0-9a-f]{64}$/ );
	const other = sidecarText( { hashes: [ hashes[ 0 ], hashes[ 2 ], hashes[ 2 ] ], first: 40, width: 2, height: 1, fps: 60 } );
	assert.notStrictEqual( root, await rootHash( other ) );
	assert.match( parseSidecar( text.replace( '41 ', '43 ' ) ).error, /out of order/ );
	assert.match( parseSidecar( '0 notahash\n' ).error, /not a frame hash line/ );

} );

await test( 'two renders are compared by their lists: the frames that differ are named, and a different range is reported, not hidden', () => {

	const a = { first: 0, hashes: [ 'a', 'b', 'c', 'd' ].map( x => x.repeat( 64 ) ) };
	const b = { first: 0, hashes: [ 'a', 'x', 'c', 'y' ].map( x => x.repeat( 64 ) ) };
	assert.deepStrictEqual( diffHashes( a, b ), { frames: [ 1, 3 ], onlyIn: { a: [], b: [] } } );
	assert.deepStrictEqual( diffHashes( a, { first: 2, hashes: [ 'c', 'd', 'e' ].map( x => x.repeat( 64 ) ) } ), { frames: [], onlyIn: { a: [ 0, 1 ], b: [ 4 ] } } );
	assert.strictEqual( frameRanges( [ 310, 311, 312, 610, 620, 621 ] ), '310-312, 610, 620-621' );
	assert.match( frameRanges( [ 1, 3, 5, 7 ], 2 ), /1, 3, and 2 more ranges/ );

} );

await test( 'the stride keeps the last frame, and every = 1 is every frame', () => {

	assert.deepStrictEqual( strideFrames( 0, 10, 4 ), [ 0, 4, 8, 10 ] );
	assert.deepStrictEqual( strideFrames( 5, 8, 1 ), [ 5, 6, 7, 8 ] );
	assert.deepStrictEqual( strideFrames( 3, 3, 17 ), [ 3 ] );
	assert.strictEqual( strideFrames( 0, 3071, 17 ).length, 182 );

} );

await test( 'the shuffle is reproducible from its seed, uses every frame once, and leaves no frame beside its sequential neighbour', () => {

	const frames = strideFrames( 0, 399, 1 );
	const a = shuffledOrder( frames, seedOf( 'scene-hash' ) ), b = shuffledOrder( frames, seedOf( 'scene-hash' ) ), c = shuffledOrder( frames, seedOf( 'other' ) );
	assert.deepStrictEqual( a, b );
	assert.notDeepStrictEqual( a, c );
	assert.deepStrictEqual( a.slice().sort( ( x, y ) => x - y ), frames );
	assert.notDeepStrictEqual( a, frames );
	let neighbours = 0; for ( let i = 1; i < a.length; i ++ ) if ( Math.abs( a[ i ] - a[ i - 1 ] ) === 1 ) neighbours ++;
	assert.strictEqual( neighbours, 0, 'a leak that only shows between neighbours cannot hide in the shuffle' );
	assert.strictEqual( mulberry32( 1 )(), mulberry32( 1 )() );

} );

await test( 'the verdict: a complete pass says so, a stride is evidence and not a claim, and a mismatch names its frames', () => {

	const seq = { 0: 'a', 1: 'b', 2: 'c', 3: 'd' };
	const full = verificationResult( { sequential: seq, shuffled: { ...seq }, first: 0, last: 3, every: 1, seed: 7 } );
	assert.deepStrictEqual( [ full.passed, full.complete, full.frames_checked, full.of, full.mismatched_count ], [ true, true, 4, 4, 0 ] );
	const stride = verificationResult( { sequential: seq, shuffled: { 0: 'a', 2: 'c' }, first: 0, last: 3, every: 2, seed: 7 } );
	assert.deepStrictEqual( [ stride.passed, stride.complete ], [ true, false ] );
	const bad = verificationResult( { sequential: seq, shuffled: { 0: 'a', 1: 'X', 2: 'c', 3: 'Y' }, first: 0, last: 3, every: 1, seed: 7 } );
	assert.deepStrictEqual( [ bad.passed, bad.complete, bad.mismatched_frames, bad.mismatched_count ], [ false, true, [ 1, 3 ], 2 ] );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
