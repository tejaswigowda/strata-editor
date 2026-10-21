// Run: node docs/editor/js/toon/__tests__/pixelMetrics.test.mjs
// Pure checks for the image-difference metrics behind scripts/compare-render.mjs.

import { compareImages, diffImage, sideBySide, averageMetrics } from '../pixelMetrics.js';

let passed = 0, failed = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };
const near = ( a, b, m ) => { if ( Math.abs( a - b ) > 1e-9 ) throw new Error( ( m || 'not equal' ) + `: ${ a } vs ${ b }` ); };

const solid = ( w, h, r, g, b, a = 255 ) => {

	const data = new Uint8Array( w * h * 4 );
	for ( let i = 0; i < w * h; i ++ ) data.set( [ r, g, b, a ], i * 4 );
	return { width: w, height: h, data };

};

console.log( 'pixel metrics' );

test( 'identical images have zero error', () => {

	const m = compareImages( solid( 4, 4, 10, 20, 30 ), solid( 4, 4, 10, 20, 30 ) );
	near( m.mae, 0 ); near( m.rmse, 0 ); near( m.pctOver, 0 ); near( m.maxDiff, 0 );

} );

test( 'mean absolute error is per-channel and averaged', () => {

	const m = compareImages( solid( 2, 2, 0, 0, 0 ), solid( 2, 2, 30, 60, 90 ) );
	near( m.maePerChannel[ 0 ], 30 ); near( m.maePerChannel[ 1 ], 60 ); near( m.maePerChannel[ 2 ], 90 );
	near( m.mae, 60 );
	near( m.maxDiff, 90 );

} );

test( 'rmse weights large errors more than mae', () => {

	const a = solid( 2, 1, 0, 0, 0 );
	const b = solid( 2, 1, 0, 0, 0 );
	b.data[ 0 ] = 100; // one channel of one pixel
	const m = compareImages( a, b );
	near( m.mae, 100 / 6 );
	near( m.rmse, Math.sqrt( 10000 / 6 ) );
	ok( m.rmse > m.mae );

} );

test( '% over threshold counts pixels by their worst channel, strictly greater', () => {

	const a = solid( 2, 2, 0, 0, 0 );
	const b = solid( 2, 2, 0, 0, 0 );
	b.data[ 0 ] = 17; // pixel 0: over 16
	b.data[ 4 + 1 ] = 16; // pixel 1: exactly the threshold, not over
	near( compareImages( a, b, { threshold: 16 } ).pctOver, 25 );
	near( compareImages( a, b, { threshold: 15 } ).pctOver, 50 );

} );

test( 'alpha is ignored', () => {

	near( compareImages( solid( 2, 2, 5, 5, 5, 255 ), solid( 2, 2, 5, 5, 5, 0 ) ).mae, 0 );

} );

test( 'size mismatch and malformed input throw', () => {

	let threw = 0;
	try { compareImages( solid( 2, 2, 0, 0, 0 ), solid( 3, 2, 0, 0, 0 ) ); } catch ( e ) { threw ++; }
	try { compareImages( { width: 2, height: 2, data: new Uint8Array( 4 ) }, solid( 2, 2, 0, 0, 0 ) ); } catch ( e ) { threw ++; }
	ok( threw === 2, 'both should throw' );

} );

test( 'diffImage is black where equal and red where over the threshold', () => {

	const a = solid( 2, 1, 0, 0, 0 );
	const b = solid( 2, 1, 0, 0, 0 );
	b.data[ 4 ] = 80;
	const d = diffImage( a, b, { gain: 1, threshold: 16 } );
	ok( d.data[ 0 ] === 0 && d.data[ 1 ] === 0 && d.data[ 3 ] === 255, 'equal pixel black' );
	ok( d.data[ 4 ] >= 160 && d.data[ 5 ] === 0, 'differing pixel red' );

} );

test( 'sideBySide lays images out left to right with a gap', () => {

	const s = sideBySide( [ solid( 2, 2, 255, 0, 0 ), solid( 3, 2, 0, 255, 0 ) ], 1 );
	ok( s.width === 6 && s.height === 2 );
	ok( s.data[ 0 ] === 255 && s.data[ 1 ] === 0, 'left image first' );
	ok( s.data[ ( 2 * 4 ) + 3 ] === 255 && s.data[ 2 * 4 ] === 0, 'gap column is opaque black' );
	ok( s.data[ 3 * 4 + 1 ] === 255, 'right image after the gap' );

} );

test( 'averageMetrics averages the means and keeps the worst maxDiff', () => {

	const a = compareImages( solid( 1, 1, 0, 0, 0 ), solid( 1, 1, 10, 10, 10 ) );
	const b = compareImages( solid( 1, 1, 0, 0, 0 ), solid( 1, 1, 30, 30, 30 ) );
	const avg = averageMetrics( [ a, b ] );
	near( avg.mae, 20 ); ok( avg.maxDiff === 30 );

} );

console.log( `\n${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
