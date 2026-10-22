// Run: node docs/editor/js/intelligence/__tests__/timelineUi.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const U = await import( path.join( here, '..', 'timelineUi.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) <= eps, a + ' vs ' + b );

test( 'classifyObject: camera, light, character, prop, group, other', () => {

	assert.strictEqual( U.classifyObject( { isCamera: true } ), 'camera' );
	assert.strictEqual( U.classifyObject( { isLight: true } ), 'light' );
	assert.strictEqual( U.classifyObject( { isMesh: true } ), 'prop' );
	assert.strictEqual( U.classifyObject( { isSkinnedMesh: true, isMesh: true } ), 'character' );
	assert.strictEqual( U.classifyObject( { userData: { vrm: {} }, children: [] } ), 'character' );
	assert.strictEqual( U.classifyObject( { userData: { body: 'x' }, children: [] } ), 'character' );
	assert.strictEqual( U.classifyObject( { children: [ { isMesh: true, children: [ { isSkinnedMesh: true } ] } ] } ), 'character' );
	assert.strictEqual( U.classifyObject( { isGroup: true, children: [ { isMesh: true } ] } ), 'group' );
	assert.strictEqual( U.classifyObject( { children: [] } ), 'other' );
	assert.strictEqual( U.classifyObject( null ), null );

} );

test( 'classifyTrack: a performance group wins; no object falls back to what the events do', () => {

	assert.strictEqual( U.classifyTrack( { target: '#a', events: [ { args: { group: 'g1' } } ] }, { isMesh: true } ), 'group' );
	assert.strictEqual( U.classifyTrack( { target: '#a', events: [] }, { isMesh: true } ), 'prop' );
	assert.strictEqual( U.classifyTrack( { target: '#camera', events: [] }, null ), 'camera' );
	assert.strictEqual( U.classifyTrack( { target: '#x', events: [ { args: { props: { fov: 40 } } } ] }, null ), 'camera' );
	assert.strictEqual( U.classifyTrack( { target: '#x', events: [ { args: { props: { to: { lookAt: [ 0, 0, 0 ] } } } } ] }, null ), 'camera' );
	assert.strictEqual( U.classifyTrack( { target: '#x', events: [ { args: { props: { rotateY: 1 } } } ] }, null ), 'other' );
	assert.strictEqual( U.classifyTrack( { target: '#x', events: [] }, null, 'light' ), 'light' ); // a cached kind is used as is
	assert.strictEqual( U.classifyTrack( { target: '#x', events: [ { args: { props: { fov: 1 } } } ] }, null, null ), 'camera' );
	for ( const k of U.TRACK_KINDS ) assert.ok( U.KIND_ICONS[ k ].startsWith( '<svg' ), k );

} );

test( 'keyTimes: block edges, sorted, de-duplicated; prev / next are strict', () => {

	const tracks = [ { events: [ { at: 1, dur: 1 }, { at: 2, dur: 0.5 } ] }, { events: [ { at: 0.5, dur: 0 } ] } ];
	assert.deepStrictEqual( U.keyTimes( tracks ), [ 0.5, 1, 2, 2.5 ] );
	const t = U.keyTimes( tracks );
	assert.strictEqual( U.prevKeyTime( t, 2 ), 1 );
	assert.strictEqual( U.nextKeyTime( t, 2 ), 2.5 );
	assert.strictEqual( U.prevKeyTime( t, 0.5 ), null );
	assert.strictEqual( U.nextKeyTime( t, 2.5 ), null );
	assert.strictEqual( U.nextKeyTime( t, 1.9996 ), 2.5 ); // within half a millisecond counts as being on the key
	assert.strictEqual( U.nextKeyTime( t, 0 ), 0.5 );
	assert.deepStrictEqual( U.keyTimes( [] ), [] );

} );

test( 'densityBins counts overlapping blocks per slice', () => {

	const d = U.densityBins( [ { at: 0, dur: 5 }, { at: 5, dur: 5 }, { at: 2, dur: 6 } ], 10, 10 );
	assert.strictEqual( d.length, 10 );
	assert.strictEqual( d[ 0 ], 1 );
	assert.strictEqual( d[ 3 ], 2 );
	assert.strictEqual( d[ 9 ], 1 );
	assert.deepStrictEqual( U.densityBins( [], 10, 4 ), [ 0, 0, 0, 0 ] );
	assert.deepStrictEqual( U.densityBins( [ { at: 1, dur: 1 } ], 0, 3 ), [ 0, 0, 0 ] );
	assert.strictEqual( U.densityBins( [ { at: 99, dur: 50 } ], 10, 5 )[ 4 ], 1 ); // past the end lands in the last slice

} );

test( 'mini-map window, drag and click map back to the view', () => {

	const w = U.miniMapWindow( { start: 25, span: 50 }, 100, 200 );
	near( w.left, 50 ); near( w.width, 100 );
	assert.strictEqual( U.miniMapWindow( { start: 0, span: 0.1 }, 100, 200 ).width, 8 ); // never thinner than the grip
	const edge = U.miniMapWindow( { start: 99.99, span: 0.1 }, 100, 200 );
	assert.ok( edge.left + edge.width <= 200 );
	assert.deepStrictEqual( U.miniMapDragView( { start: 0, span: 20 }, 100, 200, 100 ), { start: 50, span: 20 } );
	assert.deepStrictEqual( U.miniMapDragView( { start: 0, span: 20 }, 100, 200, 9999 ), { start: 80, span: 20 } );
	assert.deepStrictEqual( U.miniMapCenterView( { start: 0, span: 20 }, 100, 200, 100 ), { start: 40, span: 20 } );
	assert.deepStrictEqual( U.miniMapCenterView( { start: 30, span: 20 }, 100, 200, 0 ), { start: 0, span: 20 } );

} );

test( 'grid: unit follows the ruler, snapping rounds to it, background lines up with the view', () => {

	assert.strictEqual( U.gridUnit( 10, 300 ), 1 ); // 30 px per second: ticks every second
	assert.ok( U.gridUnit( 1, 300 ) < 1 );
	assert.ok( U.gridUnit( 600, 300 ) >= 10 );
	assert.strictEqual( U.snapToGrid( 1.4, 1 ), 1 );
	assert.strictEqual( U.snapToGrid( 1.6, 1 ), 2 );
	near( U.snapToGrid( 0.37, 0.1 ), 0.4 );
	// start 1.2 -> 1 (shift 0.2); end 1.2+0.9=2.1 -> 2 (start 1.1, shift 0.1): the end is closer
	near( U.snapMoveToGrid( 1.2, 0.9, 1 ), 1.1 );
	near( U.snapMoveToGrid( 1.05, 0.9, 1 ), 1 );
	const g = U.gridBackground( { start: 0.5, span: 10 }, 1, 300 );
	near( g.size, 30 ); near( g.offset, 15 ); // first line at t=1: half a second in
	assert.strictEqual( U.gridBackground( { start: 0, span: 600 }, 1, 300 ), null );

} );

test( 'shotMarkers: the sequence shots using the track, else the first key', () => {

	const shots = [ { at: 10, camera: 'b' }, { at: 0, camera: 'a' }, { at: 20, camera: 'a' } ];
	assert.deepStrictEqual( U.shotMarkers( shots, s => s.camera === 'a', 5 ), [ { t: 0, label: 'S1' }, { t: 20, label: 'S3' } ] );
	assert.deepStrictEqual( U.shotMarkers( shots, () => false, 5 ), [ { t: 5, label: 'start' } ] );
	assert.deepStrictEqual( U.shotMarkers( undefined, () => true, 2 ), [ { t: 2, label: 'start' } ] );
	assert.deepStrictEqual( U.shotMarkers( [], () => true, null ), [] );

} );

test( 'poseSummary flattens props.to and caps the list', () => {

	assert.deepStrictEqual( U.poseSummary( { props: { to: { position: [ 1.234, 2, 3 ] }, fov: 34.5, lookAt: [ 0, 0, 0 ] } } ), [ 'position [1.23, 2, 3]', 'fov 34.5', 'lookAt [0, 0, 0]' ] );
	assert.strictEqual( U.poseSummary( { props: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } } ).pop(), '+2 more' );
	assert.deepStrictEqual( U.poseSummary( {} ), [] );
	assert.deepStrictEqual( U.poseSummary( null ), [] );

} );

test( 'tooltipModel: op, range, duration and the key pose', () => {

	const m = U.tooltipModel( { op: 'animate', at: 1, dur: 1.5, args: { props: { rotateY: 360 } } }, { target: '#cube' } );
	assert.strictEqual( m.title, 'animate' );
	assert.strictEqual( m.range, '1s \u2013 2.5s \u00b7 1.5s' );
	assert.deepStrictEqual( m.lines, [ '#cube', 'rotateY 360' ] );
	assert.ok( U.tooltipModel( { op: 'face', at: 0, dur: 1, args: { easing: 'linear' } } ).lines[ 0 ].includes( 'arriving at 1s, linear' ) );
	assert.ok( U.tooltipModel( { op: 'x', at: 0, dur: 1, args: { group: 'g' } }, { group: { id: 'g', broken: true } } ).lines.some( l => l.includes( 'BROKEN' ) ) );
	assert.strictEqual( U.tooltipModel( { op: 'change', at: 0, dur: 0, args: { text: 'hi' } } ).lines[ 0 ], '"hi"' );

} );

test( 'placeTip keeps the card fully inside the window', () => {

	const win = { w: 800, h: 600 }, size = { w: 200, h: 80 };
	assert.deepStrictEqual( U.placeTip( { x: 100, y: 100 }, size, win ), { left: 114, top: 114 } );
	const right = U.placeTip( { x: 790, y: 100 }, size, win );
	assert.ok( right.left + 200 <= 792 && right.left < 790 ); // flipped to the pointer's left
	const bottom = U.placeTip( { x: 100, y: 590 }, size, win );
	assert.ok( bottom.top + 80 <= 592 && bottom.top < 590 );
	for ( const p of [ { x: 0, y: 0 }, { x: 800, y: 600 }, { x: 5000, y: 5000 }, { x: - 50, y: - 50 } ] ) {

		const r = U.placeTip( p, size, win );
		assert.ok( r.left >= 8 && r.top >= 8 && r.left + 200 <= 792 && r.top + 80 <= 592, JSON.stringify( r ) );

	}
	const tiny = U.placeTip( { x: 10, y: 10 }, { w: 900, h: 700 }, win ); // larger than the window: pinned to the margin
	assert.deepStrictEqual( tiny, { left: 8, top: 8 } );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
