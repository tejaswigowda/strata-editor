// Run: node docs/editor/js/intelligence/__tests__/timelineView.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const V = await import( path.join( here, '..', 'timelineView.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) <= eps, a + ' vs ' + b );

test( 'clampView keeps the view inside the timeline', () => {

	assert.deepStrictEqual( V.clampView( - 5, 10, 100 ), { start: 0, span: 10 } );
	assert.deepStrictEqual( V.clampView( 95, 10, 100 ), { start: 90, span: 10 } );
	assert.deepStrictEqual( V.clampView( 0, 500, 100 ), { start: 0, span: 100 } );
	assert.deepStrictEqual( V.clampView( 0, 0.001, 100 ), { start: 0, span: V.MIN_SPAN } );
	assert.deepStrictEqual( V.clampView( NaN, NaN, 20 ), { start: 0, span: 20 } );

} );

test( 'zoom keeps the time under the cursor still', () => {

	const view = { start: 10, span: 40 };
	for ( const frac of [ 0, 0.25, 0.5, 1 ] ) {

		const z = V.zoomView( view, 200, 2, frac );
		near( z.span, 20 );
		near( z.start + frac * z.span, view.start + frac * view.span, 1e-9 ); // anchor time unchanged

	}
	assert.strictEqual( V.zoomView( view, 200, 1000, 0.5 ).span, V.MIN_SPAN );
	assert.deepStrictEqual( V.zoomView( view, 200, 0.001, 0.5 ), { start: 0, span: 200 } ); // zoomed out past fit = fit

} );

test( 'zoom near an edge cannot push the view outside the timeline', () => {

	const z = V.zoomView( { start: 0, span: 100 }, 100, 4, 0 );
	assert.deepStrictEqual( z, { start: 0, span: 25 } );
	const e = V.zoomView( { start: 0, span: 100 }, 100, 4, 1 );
	assert.deepStrictEqual( e, { start: 75, span: 25 } );

} );

test( 'pan clamps', () => {

	assert.deepStrictEqual( V.panView( { start: 5, span: 10 }, 60, - 20 ), { start: 0, span: 10 } );
	assert.deepStrictEqual( V.panView( { start: 5, span: 10 }, 60, 100 ), { start: 50, span: 10 } );

} );

test( 'niceStep picks 1-2-5 style steps', () => {

	assert.strictEqual( V.niceStep( 0.03 ), 0.05 );
	assert.strictEqual( V.niceStep( 0.5 ), 0.5 );
	assert.strictEqual( V.niceStep( 3 ), 5 );
	assert.strictEqual( V.niceStep( 12 ), 15 );
	assert.strictEqual( V.niceStep( 1e9 ), 3600 );

} );

test( 'ruler ticks adapt to the zoom and stay inside the view', () => {

	for ( const [ start, span ] of [ [ 0, 156 ], [ 40, 20 ], [ 41.2, 1.5 ], [ 100, 0.05 ] ] ) {

		const { step, ticks } = V.rulerTicks( start, span, 900 );
		assert.ok( ticks.length > 0, 'ticks at ' + span );
		assert.ok( ticks.every( t => t.t >= start - 1e-6 && t.t <= start + span + 1e-6 ) );
		const majors = ticks.filter( t => t.major );
		assert.ok( majors.length * 64 <= 900 + 64, 'labels do not crowd: ' + majors.length );
		for ( const m of majors ) near( Math.round( m.t / step ) * step, m.t, 1e-6 ); // majors sit on multiples of the step

	}
	const fit = V.rulerTicks( 0, 156, 900 ), zoomed = V.rulerTicks( 40, 4, 900 );
	assert.ok( zoomed.step < fit.step );

} );

test( 'minor ticks sit between the labelled ones', () => {

	const { ticks } = V.rulerTicks( 0, 20, 900 );
	assert.ok( ticks.some( t => ! t.major ) && ticks.some( t => t.major ) );
	assert.ok( V.rulerTicks( 0, 20, 900, { minorPx: 1e6 } ).ticks.every( t => t.major ) );

} );

test( 'snapper finds the nearest target within range', () => {

	const s = V.makeSnapper( [ 5, 1.0004, 1, 9.5, NaN, 3 ] );
	assert.deepStrictEqual( s.times, [ 1, 3, 5, 9.5 ] );
	assert.strictEqual( s.nearest( 3.04, 0.05 ), 3 );
	assert.strictEqual( s.nearest( 3.06, 0.05 ), null );
	assert.strictEqual( s.nearest( 4.9, 0.2 ), 5 );
	assert.strictEqual( s.nearest( 0, 5 ), 1 );
	assert.strictEqual( s.nearest( 100, 5 ), null );
	assert.strictEqual( V.makeSnapper( [] ).nearest( 1, 5 ), null );

} );

test( 'a moved block snaps its start or its end, whichever is closer', () => {

	const s = V.makeSnapper( [ 2, 10 ] );
	assert.deepStrictEqual( V.snapMove( s, 2.03, 3, 0.05 ), { start: 2, guide: 2 } );
	const end = V.snapMove( s, 6.98, 3, 0.05 );
	near( end.start, 7 );
	assert.strictEqual( end.guide, 10 );
	assert.deepStrictEqual( V.snapMove( s, 5, 1, 0.05 ), { start: 5, guide: null } );
	const both = V.snapMove( V.makeSnapper( [ 1, 2 ] ), 1.04, 0.97, 0.1 );
	assert.strictEqual( both.guide, 2 ); // end 2.01 is 0.01 away, start is 0.04 away

} );

test( 'a resized edge snaps', () => {

	const s = V.makeSnapper( [ 4 ] );
	assert.deepStrictEqual( V.snapEdge( s, 4.02, 0.05 ), { time: 4, guide: 4 } );
	assert.deepStrictEqual( V.snapEdge( s, 4.5, 0.05 ), { time: 4.5, guide: null } );

} );

test( 'shift-range and toggle selection helpers', () => {

	const ids = [ 'a', 'b', 'c', 'd', 'e' ];
	assert.deepStrictEqual( V.rangeIds( ids, 'b', 'd' ), [ 'b', 'c', 'd' ] );
	assert.deepStrictEqual( V.rangeIds( ids, 'd', 'b' ), [ 'b', 'c', 'd' ] );
	assert.deepStrictEqual( V.rangeIds( ids, 'zz', 'c' ), [ 'c' ] );
	assert.deepStrictEqual( V.rangeIds( ids, 'a', 'zz' ), [] );
	assert.deepStrictEqual( V.toggleId( [ 'a', 'b' ], 'b' ), [ 'a' ] );
	assert.deepStrictEqual( V.toggleId( [ 'a' ], 'c' ), [ 'a', 'c' ] );

} );

test( 'inView', () => {

	assert.ok( V.inView( 5, 1, 4, 3 ) );
	assert.ok( ! V.inView( 8, 1, 4, 3 ) );
	assert.ok( V.inView( 7.05, 1, 4, 3, 0.1 ) );
	assert.ok( ! V.inView( 1, 2, 4, 3 ) ); // ends at 3
	assert.ok( V.inView( 1, 3, 4, 3 ) ); // ends exactly at the left edge

} );

console.log( `${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
