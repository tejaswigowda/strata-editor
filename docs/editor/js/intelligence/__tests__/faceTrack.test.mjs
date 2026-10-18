// Node tests for the authored face (pure; no editor, no DOM). Run with:
//   node docs/editor/js/intelligence/__tests__/faceTrack.test.mjs

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const F = await import( path.resolve( here, '..', 'faceTrack.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const near = ( a, b, eps = 1e-6, msg = '' ) => assert.ok( Math.abs( a - b ) < eps, `${ msg } expected ${ b }, got ${ a }` );
const track = () => ( { target: '#f1', events: [] } );
const keys = ( t, op = F.FACE_OP ) => F.keyEvents( t, op );

// ── Keys: arrival semantics, continuity, easing ──────────────────────────────

test( 'a key ARRIVES at its time; duration is milliseconds at the surface, seconds in the model', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 2, shapes: { jawOpen: 0.4 }, duration: 500 } );
	const e = t.events[ 0 ];
	near( e.at, 1.5 ); near( e.dur, 0.5 );
	assert.deepStrictEqual( F.keyList( t, 'face' )[ 0 ], { index: 0, id: e.id, time: 2, duration: 500, easing: 'linear', label: 'face 1/1 · 2.00s', shapes: { jawOpen: 0.4 }, hold: false } );

} );

test( 'values are continuous and interpolated; a key only sets the shapes it names', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: { jawOpen: 0.4, browInnerUp: 0.2 }, duration: 1000 } );
	F.upsertKey( t, 'face', { time: 3, shapes: { jawOpen: 0 }, duration: 1000 } );
	const at = T => F.evalShapes( keys( t ), T );

	assert.strictEqual( at( - 1 ).size, 0, 'nothing is driven before the first key starts' );
	near( at( 0.5 ).get( 'jawOpen' ), 0.2, 1e-9, 'half way into the first move' );
	near( at( 1 ).get( 'jawOpen' ), 0.4 );
	near( at( 2 ).get( 'jawOpen' ), 0.4, 1e-9, 'held between keys' );
	near( at( 2.5 ).get( 'jawOpen' ), 0.2, 1e-9, 'half way back down' );
	near( at( 3 ).get( 'jawOpen' ), 0 );
	near( at( 3 ).get( 'browInnerUp' ), 0.2, 1e-9, 'a shape the second key never mentions keeps its value' );

} );

test( 'easing and duration: a slow fall and a hard snap from the same two keys', () => {

	const slow = track(), snap = track();
	for ( const [ t, spec ] of [ [ slow, { duration: 2000, easing: 'ease-in-out' } ], [ snap, { duration: 0 } ] ] ) {

		F.upsertKey( t, 'face', { time: 1, shapes: { browInnerUp: 1 } } );
		F.upsertKey( t, 'face', { time: 5, shapes: { browInnerUp: 0 }, ...spec } );

	}

	const v = ( t, T ) => F.evalShapes( keys( t ), T ).get( 'browInnerUp' );
	assert.strictEqual( v( snap, 2.99 ), 1, 'before the snap' );
	assert.strictEqual( v( snap, 5 ), 0, 'arrives instantly at its time' );
	near( v( snap, 4.999 ), 1, 1e-6 );
	assert.ok( v( slow, 3.5 ) < 1 && v( slow, 3.5 ) > 0.8, 'ease-in-out leaves slowly' );
	near( v( slow, 4 ), 0.5, 1e-3, 'symmetric midpoint' );
	assert.ok( v( slow, 4.5 ) < 0.2 && v( slow, 4.5 ) > 0, 'and settles slowly' );
	near( v( slow, 5 ), 0 );

} );

test( 'an overlapping key starts from where the shape actually is, not from its previous key value', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: { s: 1 } } );
	F.upsertKey( t, 'face', { time: 3, shapes: { s: 0 }, duration: 2000 } ); // 1 -> 0 over [1,3]
	F.upsertKey( t, 'face', { time: 4, shapes: { s: 1 }, duration: 2000 } ); // starts at 2, when s = 0.5
	near( F.evalShapes( keys( t ), 2 ).get( 's' ), 0.5, 1e-9 );
	near( F.evalShapes( keys( t ), 3 ).get( 's' ), 0.75, 1e-9 );

} );

test( 'upsert merges a key arriving at the same time; moveKey / deleteKey use the sorted index', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 2, shapes: { a: 0.1 } } );
	F.upsertKey( t, 'face', { time: 2, shapes: { b: 0.2 } } );
	F.upsertKey( t, 'face', { time: 1, shapes: { c: 0.3 } } );
	assert.strictEqual( t.events.length, 2, 'same arrival merged' );
	assert.deepStrictEqual( F.keyList( t, 'face' ).map( k => Object.keys( k.shapes ).join() ), [ 'c', 'a,b' ] );

	F.moveKey( t, 'face', 0, { time: 3 } );
	assert.deepStrictEqual( F.keyList( t, 'face' ).map( k => k.time ), [ 2, 3 ], 'index follows arrival order' );

	F.moveKey( t, 'face', 1, { shapes: { z: 1 }, easing: 'ease-out', duration: 400 } );
	const k = F.keyList( t, 'face' )[ 1 ];
	assert.deepStrictEqual( [ k.shapes, k.easing, k.duration, k.time ], [ { z: 1 }, 'ease-out', 400, 3 ] );

	F.deleteKey( t, 'face', 0 );
	assert.strictEqual( F.keyList( t, 'face' ).length, 1 );
	assert.throws( () => F.deleteKey( t, 'face', 5 ), /does not exist/ );

} );

test( 'validation: shapes 0..1, easing, times, targets', () => {

	const t = track();
	assert.throws( () => F.upsertKey( t, 'face', { time: 1, shapes: { a: 1.5 } } ), /0\.\.1/ );
	assert.throws( () => F.upsertKey( t, 'face', { time: 1, shapes: {} } ), /at least one/ );
	assert.throws( () => F.upsertKey( t, 'face', { time: - 1, shapes: { a: 1 } } ), /seconds/ );
	assert.throws( () => F.upsertKey( t, 'face', { time: 1, shapes: { a: 1 }, easing: 'bouncy' } ), /CSS timing/ );
	assert.throws( () => F.upsertKey( t, 'gaze', { time: 1, target: 5 } ), /selector/ );
	assert.throws( () => F.upsertKey( t, 'gaze', { time: 1, target: '#a', head: 2 } ), /0\.\.1/ );
	assert.strictEqual( t.events.length, 0, 'nothing written on a refusal' );

} );

// ── Presets expand, they don't hide ─────────────────────────────────────────

test( 'a preset writes explicit per-shape values; neutral clears everything the track drives', () => {

	const smile = F.expandPreset( 'smile', [ 'jawOpen', 'customShape' ] );
	assert.strictEqual( smile.mouthSmileLeft, 0.7 );
	assert.strictEqual( smile.customShape, 0, 'an already-driven shape is cleared, not left half applied' );
	assert.strictEqual( smile.jawOpen, 0 );
	assert.ok( ! ( 'browInnerUp' in smile ), 'a shape nobody drives is not written' );
	assert.deepStrictEqual( F.expandPreset( 'neutral' ), {}, 'neutral with nothing driven is nothing' );

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: F.expandPreset( 'surprise' ) } );
	F.upsertKey( t, 'face', { time: 2, shapes: F.expandPreset( 'neutral', F.drivenShapes( t ) ) } );
	const rest = F.evalShapes( keys( t ), 2 );
	assert.ok( rest.size > 0 && [ ...rest.values() ].every( v => v === 0 ), 'every driven shape is back to 0' );

	const before = JSON.stringify( t.events );
	assert.deepStrictEqual( Object.keys( t.events[ 0 ].args ), [ 'shapes' ], 'the file stores values only — no preset name' );
	assert.ok( ! before.includes( 'surprise' ) );
	assert.throws( () => F.expandPreset( 'ecstatic' ), /unknown preset/ );

} );

test( 'toCommand rebuilds the track: face + gaze, GUI and shell share the same keys', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: { jawOpen: 0.4 }, duration: 300, easing: 'ease-out', hold: true } );
	F.upsertKey( t, 'gaze', { time: 2, target: '#f2', duration: 250, head: 0.6 } );
	F.upsertKey( t, 'gaze', { time: 4, target: [ 0, 1.5, 2 ] } );
	assert.strictEqual( F.toCommand( t, '#f1' ), [
		"$S('#f1').face.keyAt(1, { shapes: { jawOpen: 0.4 }, duration: 300, easing: 'ease-out', hold: true });",
		"$S('#f1').gaze(2, '#f2', { duration: 250, head: 0.6 });",
		"$S('#f1').gaze(4, [0, 1.5, 2]);",
	].join( '\n' ) );

} );

// ── Gaze ────────────────────────────────────────────────────────────────────

test( 'gaze keys: eyes lead, the head starts later and takes longer', () => {

	const t = track();
	F.upsertKey( t, 'gaze', { time: 1, target: '#f2' } );
	F.upsertKey( t, 'gaze', { time: 3, target: '#f3', duration: 1000 } ); // moves over [2, 3]
	const g = T => F.evalGaze( keys( t, 'gaze' ), T );

	assert.strictEqual( g( 0.5 ), null );
	assert.strictEqual( g( 1.5 ).to, '#f2' );
	assert.strictEqual( g( 1.5 ).from, null );
	assert.strictEqual( g( 2.5 ).from, '#f2' );
	assert.strictEqual( g( 2.5 ).to, '#f3' );

	const mid = g( 2.5 );
	assert.ok( mid.eye > mid.head, `eyes (${ mid.eye }) must lead the head (${ mid.head })` );
	assert.strictEqual( g( 2.05 ).head, 0, 'the head has not started yet' );
	assert.ok( g( 2.05 ).eye > 0 );
	assert.strictEqual( g( 3 ).eye, 1 );
	assert.ok( g( 3 ).head < 1, 'the head is still arriving when the eyes are there' );
	assert.strictEqual( g( 3.6 ).head, 1 );

} );

test( 'anatomical clamp: past the eye limit the head turns, the eyes never roll into the socket', () => {

	const L = F.GAZE_LIMITS;

	// inside the eye range the split is just the head weight
	const small = F.splitAxis( 0.2, 0.25, - L.eyeYaw, L.eyeYaw, L.headYaw );
	near( small.head, 0.05 ); near( small.eye, 0.15 );

	// a 60 degree aim with a mostly-eyes weight: eyes stop at the limit, the head takes the rest
	const A = 1.05;
	const big = F.splitAxis( A, 0.1, - L.eyeYaw, L.eyeYaw, L.headYaw );
	near( big.eye, L.eyeYaw, 1e-9, 'eye pinned at its limit' );
	near( big.head, A - L.eyeYaw, 1e-9, 'the head turns the remainder' );
	near( big.head + big.eye, A, 1e-9, 'together they still reach the target' );

	// eyes-only weight 0 and a glance inside the range: pure glance
	const glance = F.splitAxis( 0.3, 0, - L.eyeYaw, L.eyeYaw, L.headYaw );
	assert.strictEqual( glance.head, 0 );
	near( glance.eye, 0.3 );

	// and the full pipeline: never exceeds the limits
	for ( const yaw of [ 0.1, 0.5, 1, 1.5, 2.5, - 1, - 2.5 ] ) {

		const r = F.resolveAim( { eye: 1, head: 1, headWeight: 0.2 }, null, { yaw, pitch: 0 } );
		assert.ok( Math.abs( r.eye.yaw ) <= L.eyeYaw + 1e-9, `eye yaw ${ r.eye.yaw } for aim ${ yaw }` );
		assert.ok( Math.abs( r.head.yaw ) <= L.headYaw + 1e-9 );

	}

} );

test( 'resolveAim: while the head lags the eyes carry the aim, then hand it over', () => {

	const to = { yaw: 0.4, pitch: 0 };
	const early = F.resolveAim( { eye: 1, head: 0, headWeight: 0.5 }, null, to );
	near( early.head.yaw, 0 ); near( early.eye.yaw, 0.4 );
	const done = F.resolveAim( { eye: 1, head: 1, headWeight: 0.5 }, null, to );
	near( done.head.yaw, 0.2 ); near( done.eye.yaw, 0.2 );

} );

// ── Idle: seeded, deterministic, suppressed, an underlayer ───────────────────

test( 'idle: blinks are seeded — identical across runs, different across seeds and characters', () => {

	const idle = F.normalizeIdle( { seed: 7 } );
	const a = F.blinkTimes( idle, '#f1', 120 ).slice();
	const b = F.blinkTimes( { ...idle }, '#f1', 120 ).slice();
	assert.deepStrictEqual( a, b );
	assert.ok( a.length > 15 && a.length < 70, `plausible human blink rate: ${ a.length } in 120 s` );

	const gaps = a.slice( 1 ).map( ( t, i ) => t - a[ i ] );
	assert.ok( gaps.every( g => g >= 2 - 1e-3 && g <= 6 + 1e-3 ), 'intervals inside [2, 6] s' );

	assert.notDeepStrictEqual( F.blinkTimes( F.normalizeIdle( { seed: 8 } ), '#f1', 120 ), a );
	assert.notDeepStrictEqual( F.blinkTimes( idle, '#f2', 120 ), a );

	// the sequence does not depend on how far ahead anyone asked first
	const early = F.blinkTimes( F.normalizeIdle( { seed: 99 } ), '#x', 10 ).slice();
	const late = F.blinkTimes( F.normalizeIdle( { seed: 99 } ), '#x', 300 );
	assert.deepStrictEqual( late.slice( 0, early.length ), early );

} );

test( 'idle: a blink closes then opens, and is suppressed inside a held beat', () => {

	const idle = F.normalizeIdle( { seed: 3 } );
	const s = F.blinkTimes( idle, '#h', 20 )[ 0 ];
	const w = T => F.blinkWeight( idle, '#h', T );

	assert.strictEqual( w( s - 0.01 ), 0 );
	assert.ok( w( s + idle.blinkDuration / 3 ) > 0.95, 'closed at the bottom of the blink' );
	assert.strictEqual( w( s + idle.blinkDuration + 0.01 ), 0 );
	assert.strictEqual( F.blinkWeight( idle, '#h', s + idle.blinkDuration / 3, [ [ s - 1, s + 1 ] ] ), 0, 'a held beat owns the face' );

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: { browInnerUp: 1 }, hold: true } );
	F.upsertKey( t, 'face', { time: 5, shapes: { browInnerUp: 0 } } );
	assert.deepStrictEqual( F.heldBeats( keys( t ) ), [ [ 1, 5 ] ] );

} );

test( 'idle: breath is faint and the gaze micro-noise is small, smooth and deterministic', () => {

	const idle = F.normalizeIdle( { seed: 2 } );
	let max = 0;
	for ( let T = 0; T < 30; T += 0.1 ) max = Math.max( max, F.idleShapes( idle, '#a', T ).get( 'jawOpen' ) );
	assert.ok( max <= idle.breathAmount + 1e-9 && max > 0 );

	const n1 = F.gazeNoise( idle, '#a', 4.2 ), n2 = F.gazeNoise( idle, '#a', 4.2 );
	assert.deepStrictEqual( n1, n2 );
	for ( let T = 0; T < 60; T += 0.05 ) assert.ok( Math.abs( F.gazeNoise( idle, '#a', T ).yaw ) <= idle.noiseAmount + 1e-9 );
	assert.deepStrictEqual( F.gazeNoise( idle, '#a', 4.2, [ [ 4, 5 ] ] ), { yaw: 0, pitch: 0 }, 'still in a held beat' );
	assert.strictEqual( F.gazeNoise( F.normalizeIdle( { gazeNoise: false } ), '#a', 1 ), null );

	assert.strictEqual( F.normalizeIdle( false ), null );
	assert.throws( () => F.normalizeIdle( { seed: 1.5 } ), /integer/ );
	assert.throws( () => F.normalizeIdle( { blinkInterval: [ 0.1, 1 ] } ), /blinkInterval/ );

} );

// ── Layering ────────────────────────────────────────────────────────────────

test( 'layers: precedence is idle < authored < viseme, additive elsewhere', () => {

	assert.deepStrictEqual( [ ...F.LAYERS ], [ 'idle', 'authored', 'viseme' ] );
	const m = o => new Map( Object.entries( o ) );

	// idle adds to the base on shapes nobody else drives
	const idleOnly = F.composeShapes( { base: m( { jawOpen: 0.2 } ), idle: m( { jawOpen: 0.01, eyeBlinkLeft: 1 } ) } );
	near( idleOnly.get( 'jawOpen' ), 0.21 ); near( idleOnly.get( 'eyeBlinkLeft' ), 1 );

	// authored suppresses idle on the shapes it drives, the blink still fires on the others
	const authored = F.composeShapes( { base: m( {} ), idle: m( { jawOpen: 0.015, eyeBlinkLeft: 1 } ), authored: m( { jawOpen: 0.4 } ) } );
	near( authored.get( 'jawOpen' ), 0.4, 1e-9, 'authored owns the mouth' );
	near( authored.get( 'eyeBlinkLeft' ), 1, 1e-9, 'the blink still fires' );

	// a viseme owns the mouth; the brow stays authored; the blink still fires
	const full = F.composeShapes( { idle: m( { jawOpen: 0.015, eyeBlinkLeft: 1 } ), authored: m( { jawOpen: 0.4, browInnerUp: 0.3 } ), viseme: m( { jawOpen: 0.9 } ) } );
	near( full.get( 'jawOpen' ), 0.9, 1e-9 ); near( full.get( 'browInnerUp' ), 0.3, 1e-9 ); near( full.get( 'eyeBlinkLeft' ), 1, 1e-9 );

	// a baked body clip that carries a morph track: the clip wins against idle, authored wins against the clip
	const clip = F.composeShapes( { idle: m( { eyeBlinkLeft: 1, jawOpen: 0.015 } ), authored: m( { jawOpen: 0.5 } ), clipDriven: new Set( [ 'eyeBlinkLeft', 'jawOpen' ] ) } );
	assert.ok( ! clip.has( 'eyeBlinkLeft' ), 'the clip owns this shape; idle leaves it alone' );
	near( clip.get( 'jawOpen' ), 0.5, 1e-9, 'authored is the higher layer' );

	assert.strictEqual( F.composeShapes( { base: m( { a: 0.9 } ), idle: m( { a: 0.5 } ) } ).get( 'a' ), 1, 'clamped to 0..1' );

} );

test( 'removing the idle layer leaves every authored key untouched; authored values never read idle', () => {

	const t = track();
	F.upsertKey( t, 'face', { time: 1, shapes: { jawOpen: 0.4 } } );
	const before = JSON.stringify( t.events );
	const idle = F.normalizeIdle( {} );
	F.idleShapes( idle, '#f1', 2 ); F.blinkTimes( idle, '#f1', 50 );
	assert.strictEqual( JSON.stringify( t.events ), before, 'sampling the idle layer writes nothing to the track' );
	assert.strictEqual( F.evalShapes( keys( t ), 2 ).get( 'jawOpen' ), 0.4 );

} );

test( 'determinism: same keys + same time -> byte-identical samples', () => {

	const build = () => {

		const t = track();
		F.upsertKey( t, 'face', { time: 1, shapes: F.expandPreset( 'surprise' ), duration: 300, easing: 'ease-out' } );
		F.upsertKey( t, 'face', { time: 4, shapes: { jawOpen: 0.1, browInnerUp: 0 }, duration: 1200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } );
		F.upsertKey( t, 'gaze', { time: 2, target: '#f2', duration: 400 } );
		return t;

	};

	const run = () => {

		const t = build(), idle = F.normalizeIdle( { seed: 5 } ), out = [];

		for ( let T = 0; T <= 6; T += 1 / 30 ) {

			const authored = F.evalShapes( keys( t ), T );
			const final = F.composeShapes( { idle: F.idleShapes( idle, '#f1', T, F.heldBeats( keys( t ) ) ), authored } );
			out.push( [ ...final ].sort().map( ( [ k, v ] ) => k + v ).join(), JSON.stringify( F.evalGaze( keys( t, 'gaze' ), T ) ), JSON.stringify( F.gazeNoise( idle, '#f1', T ) ) );

		}

		return JSON.stringify( out );

	};

	assert.strictEqual( run(), run() );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
