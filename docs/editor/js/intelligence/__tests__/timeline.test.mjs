// Node test for the universal-timeline pure functions (representation, sugar
// cursor, and compilation). Browser code is ESM with no package.json, so run
// with ABSOLUTE paths from this folder:
//   node docs/editor/js/intelligence/__tests__/timeline.test.mjs
// The compiler accepts injected THREE / recipes / selectorEngine, so it runs
// without a browser or three.js.

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const intelDir = path.resolve( here, '..' );

const { TimelineModel, TimeCursor, compileTimeline } = await import( path.join( intelDir, 'timeline.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// ── Part 1: representation ────────────────────────────────────────────────────

test( 'addEvent creates a track and recomputes duration', () => {

	const m = new TimelineModel();
	m.addEvent( '.a-cube', { at: 0, op: 'fadeIn', args: {}, dur: 1 } );
	m.addEvent( '.a-cube', { at: 1, op: 'spin', args: { axis: 'y', turns: 1 }, dur: 2 } );
	assert.strictEqual( m.tracks.length, 1 );
	assert.strictEqual( m.tracks[ 0 ].events.length, 2 );
	assert.strictEqual( m.duration, 3, 'duration = latest end (1+2)' );

} );

test( 'multi-object / camera-synced: three tracks, same absolute t=2', () => {

	const m = new TimelineModel();
	m.addEvent( 'camera', { at: 2, op: 'flyTo', args: { x: 5 }, dur: 1 } );
	m.addEvent( '.slab', { at: 2, op: 'slideInLeft', args: {}, dur: 1 } );
	m.addEvent( '#sound', { at: 2, op: 'fadeIn', args: {}, dur: 1 } );
	assert.strictEqual( m.tracks.length, 3 );
	for ( const t of m.tracks ) assert.strictEqual( t.events[ 0 ].at, 2, 'all on the SAME clock at t=2' );

} );

test( 'move / resize / remove event mutations', () => {

	const m = new TimelineModel();
	const ev = m.addEvent( '.a', { at: 0, op: 'spin', args: {}, dur: 1 } );
	assert.ok( m.moveEvent( ev.id, 4 ) );
	assert.strictEqual( m.findEvent( ev.id ).event.at, 4 );
	assert.ok( m.resizeEvent( ev.id, 2 ) );
	assert.strictEqual( m.duration, 6 );
	assert.ok( m.removeEvent( ev.id ) );
	assert.strictEqual( m.tracks.length, 0, 'empty track dropped' );

} );

test( 'toJSON / fromJSON round-trip (versionable)', () => {

	const m = new TimelineModel();
	m.addEvent( '.a', { at: 1, op: 'bounce', args: { height: 0.5 }, dur: 1 } );
	const json = m.toJSON();
	const m2 = TimelineModel.fromJSON( JSON.parse( JSON.stringify( json ) ) );
	assert.deepStrictEqual( m2.toJSON(), json );

} );

// ── Part 2: sugar cursor (.then / .with / .at compile to absolute) ────────────

test( 'then() advances cursor by previous duration', () => {

	const c = new TimeCursor();
	assert.strictEqual( c.place( 1 ), 0, 'fadeIn at t=0' );
	c.then();
	assert.strictEqual( c.place( 2 ), 1, 'spin at t=1 (after fadeIn ends)' );

} );

test( 'then(gap) adds a gap after previous ends', () => {

	const c = new TimeCursor();
	c.place( 1 );
	c.then( 0.5 );
	assert.strictEqual( c.place( 1 ), 1.5, 'starts 0.5s after previous end' );

} );

test( 'with() places the next op in parallel (same at)', () => {

	const c = new TimeCursor();
	const a = c.place( 1 );      // slab slides in at 0
	c.with();
	const b = c.place( 1 );      // camera moves WHILE slab slides — same t
	assert.strictEqual( a, b );

} );

test( 'at(t) explicitly places the next op at absolute time t', () => {

	const c = new TimeCursor();
	c.place( 1 );
	c.at( 10 );
	assert.strictEqual( c.place( 1 ), 10 );

} );

// ── Compilation to absolute keyframes (the compile target / glTF source) ──────

// Minimal stubs: a fake KeyframeTrack + AnimationClip + recipes + selectorEngine.
class FakeTrack {

	constructor( name, times, values ) { this.name = name; this.times = times; this.values = values; }
	getValueSize() { return this.values.length / this.times.length; }

}

const THREE = {
	AnimationClip: class {

		constructor( name, duration, tracks ) { this.name = name; this.duration = duration; this.tracks = tracks; this.userData = {}; }
		resetDuration() {

			let max = 0;
			for ( const t of this.tracks ) max = Math.max( max, t.times[ t.times.length - 1 ] || 0 );
			this.duration = max;

		}

	},
};

const recipes = {
	// position track over [0,dur] — value equals its "at-relative" times pre-offset
	flyToRecipe: ( node, params ) => ( {
		tracks: [ new FakeTrack( node.uuid + '.position', [ 0, params.duration ], [ 0, 0, 0, params.x || 0, 0, 0 ] ) ],
	} ),
	spinRecipe: ( node, params ) => ( {
		tracks: [ new FakeTrack( node.uuid + '.quaternion', [ 0, params.duration ], [ 0, 0, 0, 1, 0, 1, 0, 0 ] ) ],
	} ),
};

const selectorEngine = {
	query: ( scene, sel ) => {

		if ( sel === '.a-cube' ) return [ { uuid: 'CUBE' } ];
		if ( sel === 'camera' ) return [ { uuid: 'CAM' } ];
		return [];

	},
};

test( 'compile offsets keyframes by absolute `at` and merges tracks', () => {

	const m = new TimelineModel();
	m.addEvent( '.a-cube', { at: 0, op: 'flyTo', args: { x: 1 }, dur: 1 } );
	m.addEvent( '.a-cube', { at: 1, op: 'spin', args: {}, dur: 2 } );
	m.addEvent( 'camera', { at: 2, op: 'flyTo', args: { x: 5 }, dur: 1 } );

	const clip = compileTimeline( m, { editor: { scene: {}, camera: { uuid: 'CAM' } }, THREE, recipes, selectorEngine } );
	assert.ok( clip, 'clip produced' );

	const cubePos = clip.tracks.find( t => t.name === 'CUBE.position' );
	assert.ok( cubePos, 'cube position track exists' );
	assert.deepStrictEqual( Array.from( cubePos.times ), [ 0, 1 ], 'fly at t=0 keeps times' );

	const camPos = clip.tracks.find( t => t.name === 'CAM.position' );
	assert.deepStrictEqual( Array.from( camPos.times ), [ 2, 3 ], 'camera fly offset to absolute t=2' );

	const cubeSpin = clip.tracks.find( t => t.name === 'CUBE.quaternion' );
	assert.deepStrictEqual( Array.from( cubeSpin.times ), [ 1, 3 ], 'spin offset to absolute t=1..3' );

	assert.strictEqual( clip.duration, 3, 'clip duration = timeline duration' );

} );

test( 'empty timeline compiles to null', () => {

	assert.strictEqual( compileTimeline( new TimelineModel(), { editor: { scene: {} }, THREE, recipes, selectorEngine } ), null );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
