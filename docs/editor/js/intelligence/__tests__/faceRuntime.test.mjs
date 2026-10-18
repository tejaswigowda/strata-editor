// Node integration test for the face sampler (faceRuntime.js) on a synthetic rigged pair: real three.js
// bones, a skinned mesh with morph targets, a stub editor. Run with:
//   node docs/editor/js/intelligence/__tests__/faceRuntime.test.mjs
//
// Checks what a viewport would show: morph weights follow the keys, the eyes land on a moving target,
// the head takes over past the eye limit, the body clip's head pose is respected (the aim is layered on top,
// never accumulated), the idle layer is seeded, and removing it leaves every authored key alone.

import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const docs = path.resolve( here, '../../../..' );

register( 'data:text/javascript,' + encodeURIComponent( `
export async function resolve( spec, ctx, next ) {
	if ( spec === 'three' ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'build/three.module.js' ) ).href ) }, shortCircuit: true };
	return next( spec, ctx );
}` ) );

const THREE = await import( 'three' );
const { TimelineModel } = await import( '../timeline.js' );
const R = await import( '../faceRuntime.js' );
const F = await import( '../faceTrack.js' );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const DEG = 180 / Math.PI;

// A character facing +Z: hips -> neck -> head -> two eyes, a skinned face mesh with 4 morph targets.
function character( label, position ) {

	const root = new THREE.Group();
	root.name = label;
	root.userData.label = label;
	root.position.copy( position );

	const hips = new THREE.Bone(); hips.name = 'Hips';
	const neck = new THREE.Bone(); neck.name = 'Neck'; neck.position.set( 0, 1.4, 0 );
	const head = new THREE.Bone(); head.name = 'Head'; head.position.set( 0, 0.1, 0 );
	const eyeL = new THREE.Bone(); eyeL.name = 'FACIAL_L_Eye'; eyeL.position.set( 0.03, 0.08, 0.09 );
	const eyeR = new THREE.Bone(); eyeR.name = 'FACIAL_R_Eye'; eyeR.position.set( - 0.03, 0.08, 0.09 );
	hips.add( neck ); neck.add( head ); head.add( eyeL, eyeR );

	const geo = new THREE.BoxGeometry( 0.2, 0.2, 0.2 );
	const n = geo.attributes.position.count;
	geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( new Uint16Array( n * 4 ), 4 ) );
	geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( Array.from( { length: n * 4 }, ( _, i ) => i % 4 === 0 ? 1 : 0 ), 4 ) );

	const mesh = new THREE.SkinnedMesh( geo, new THREE.MeshBasicMaterial() );
	mesh.name = label + '-face';
	mesh.morphTargetDictionary = { jawOpen: 0, browInnerUp: 1, eyeBlinkLeft: 2, eyeBlinkRight: 3 };
	mesh.morphTargetInfluences = [ 0, 0, 0, 0 ];

	root.add( hips, mesh );
	root.updateMatrixWorld( true );
	mesh.bind( new THREE.Skeleton( [ hips, neck, head, eyeL, eyeR ] ), mesh.matrixWorld );
	return { root, head, eyeL, eyeR, mesh };

}

function scene() {

	const a = character( 'a', new THREE.Vector3( 0, 0, 0 ) );
	const b = character( 'b', new THREE.Vector3( 0, 0, 3 ) ); // 3 m in front of a, along +Z
	const sc = new THREE.Scene();
	sc.add( a.root, b.root );
	sc.animations = [];
	const editor = { scene: sc, timeline: new TimelineModel() };
	sc.updateMatrixWorld( true );
	return { a, b, editor };

}

const addKey = ( editor, target, op, spec ) => F.upsertKey( editor.timeline.track( target, true ), op, spec );
const infl = ( ch, name ) => ch.mesh.morphTargetInfluences[ ch.mesh.morphTargetDictionary[ name ] ];

// the world direction the eyes actually point: the head-frame aim rotated by the head's own world orientation
function eyeDir( ch, rest ) {

	const rig = R.rigOf( ch.root );
	const qe = ch.eyeL.quaternion.clone().multiply( rest.clone().invert() );
	return rig.basis.fwd.clone().applyQuaternion( qe ).applyQuaternion( ch.head.getWorldQuaternion( new THREE.Quaternion() ) ).normalize();

}

const angleBetween = ( u, v ) => Math.acos( Math.max( - 1, Math.min( 1, u.dot( v ) ) ) );

test( 'morph weights follow the keys and are restored when the keys go', () => {

	const { a, editor } = scene();
	a.mesh.morphTargetInfluences[ 0 ] = 0.2; // the customizer's static pose
	addKey( editor, '#a', 'face', { time: 2, shapes: { jawOpen: 0.8, browInnerUp: 0.5 }, duration: 1000 } );

	R.applyFaceAt( editor, 1.5 );
	assert.ok( Math.abs( infl( a, 'jawOpen' ) - 0.5 * ( 0.8 - 0 ) ) < 1e-9, 'half way from 0 to 0.8' );
	R.applyFaceAt( editor, 2 );
	assert.strictEqual( infl( a, 'jawOpen' ), 0.8 );
	assert.strictEqual( infl( a, 'browInnerUp' ), 0.5 );

	editor.timeline.track( '#a' ).events.length = 0; // the key is deleted
	editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { blink: false, breath: false, gazeNoise: false } ) };
	R.applyFaceAt( editor, 2 );
	assert.strictEqual( infl( a, 'jawOpen' ), 0.2, 'handed back exactly as found (the static pose)' );
	assert.strictEqual( infl( a, 'browInnerUp' ), 0 );

} );

test( 'gaze: the eyes land on a named target, and follow it when it moves', () => {

	const { a, b, editor } = scene();
	const rig = R.rigOf( a.root );
	R.applyFaceAt( editor, 0 );
	const rest = a.eyeL.quaternion.clone();
	addKey( editor, '#a', 'gaze', { time: 1, target: '#b', head: 0.4, duration: 300 } );

	const err = () => {

		a.root.updateMatrixWorld( true );
		const mid = a.eyeL.getWorldPosition( new THREE.Vector3() ).add( a.eyeR.getWorldPosition( new THREE.Vector3() ) ).multiplyScalar( 0.5 );
		const want = b.head.getWorldPosition( new THREE.Vector3() ).sub( mid ).normalize();
		return angleBetween( eyeDir( a, rest ), want ) * DEG;

	};

	R.applyFaceAt( editor, 2 );
	assert.ok( err() < 0.5, `eyes on the target (off by ${ err().toFixed( 2 ) } deg)` );

	// b walks off to the side: sampling again re-aims, no state from last time
	b.root.position.set( 1.5, 0, 2.5 ); b.root.updateMatrixWorld( true );
	R.applyFaceAt( editor, 2.5 );
	assert.ok( err() < 0.5, `follows the moving target (off by ${ err().toFixed( 2 ) } deg)` );
	assert.ok( rig.basis, 'the head frame comes from the bind pose' );

} );

test( 'eyes lead, head lags: mid-turn the eyes are further along than the head', () => {

	const { a, b, editor } = scene();
	b.root.position.set( 2.5, 0, 1.5 ); b.root.updateMatrixWorld( true ); // ~59 degrees to a's side
	addKey( editor, '#a', 'gaze', { time: 3, target: '#b', head: 0.7, duration: 1000 } ); // moves over [2, 3]

	const yaw = q => 2 * Math.asin( Math.min( 1, Math.abs( q.y ) ) ) * DEG;
	R.applyFaceAt( editor, 0 );
	const eyeRest = a.eyeL.quaternion.clone();

	R.applyFaceAt( editor, 2.25 );
	const eyeEarly = yaw( a.eyeL.quaternion.clone().multiply( eyeRest.clone().invert() ) ), headEarly = yaw( a.head.quaternion );
	R.applyFaceAt( editor, 3.6 );
	const headDone = yaw( a.head.quaternion );

	assert.ok( eyeEarly > headEarly, `eyes ${ eyeEarly.toFixed( 1 ) } > head ${ headEarly.toFixed( 1 ) }` );
	assert.ok( headDone > headEarly + 5, 'the head keeps turning after the eyes have arrived' );

} );

test( 'anatomical clamp: a target behind the head turns the head and pins the eyes at their limit', () => {

	const { a, b, editor } = scene();
	b.root.position.set( 0, 0, - 3 ); b.root.updateMatrixWorld( true ); // directly behind a
	addKey( editor, '#a', 'gaze', { time: 0.5, target: '#b', head: 0.2 } );
	R.applyFaceAt( editor, 0 );
	const rest = a.eyeL.quaternion.clone();
	R.applyFaceAt( editor, 5 );

	const eyeAngle = a.eyeL.quaternion.clone().multiply( rest.clone().invert() ).angleTo( new THREE.Quaternion() ) * DEG;
	assert.ok( eyeAngle <= 40.5, `eyes stay inside their socket range (${ eyeAngle.toFixed( 1 ) } deg)` );
	assert.ok( a.head.quaternion.angleTo( new THREE.Quaternion() ) * DEG > 60, 'the head did the turning' );

} );

test( 'the body clip pose is respected and the aim never accumulates between samples', () => {

	const { a, b, editor } = scene();
	addKey( editor, '#a', 'gaze', { time: 0.5, target: '#b', head: 0.5 } );

	// a "mixer" that rewrites the head only when its clip value changes, like three.js does
	const clipHead = new THREE.Quaternion().setFromEuler( new THREE.Euler( 0, 0.3, 0 ) );
	a.head.quaternion.copy( clipHead );

	R.applyFaceAt( editor, 3 );
	const first = a.head.quaternion.clone();
	R.applyFaceAt( editor, 3 ); // the clip value did not change, so nothing rewrote the bone
	R.applyFaceAt( editor, 3 );
	assert.ok( a.head.quaternion.angleTo( first ) < 1e-6, 'sampling the same time again gives the same pose' );

	// and a body clip that does move the head: the new clip pose is the new baseline
	const clipHead2 = new THREE.Quaternion().setFromEuler( new THREE.Euler( 0, - 0.4, 0 ) );
	a.head.quaternion.copy( clipHead2 );
	R.applyFaceAt( editor, 3.1 );
	R.applyFaceAt( editor, 3.1 );
	const once = a.head.quaternion.clone();
	a.head.quaternion.copy( clipHead2 );
	R.applyFaceAt( editor, 3.1 );
	assert.ok( a.head.quaternion.angleTo( once ) < 1e-6 );

	// removing the gaze hands the head back to the clip pose
	editor.timeline.track( '#a' ).events.length = 0;
	editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { blink: false, breath: false, gazeNoise: false } ) };
	R.applyFaceAt( editor, 3.1 );
	assert.ok( a.head.quaternion.angleTo( clipHead2 ) < 1e-6, 'no layer left: the clip pose, untouched' );

} );

test( 'idle: seeded blinks, identical across runs; authored keys untouched; authored shapes win', () => {

	const run = ( seed ) => {

		const { a, editor } = scene();
		editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { seed, breath: false, gazeNoise: false } ) };
		const out = [];
		for ( let t = 0; t <= 30; t += 1 / 30 ) { R.applyFaceAt( editor, t ); out.push( +infl( a, 'eyeBlinkLeft' ).toFixed( 6 ) ); }
		return out;

	};

	const x = run( 5 ), y = run( 5 ), z = run( 6 );
	assert.deepStrictEqual( x, y, 'same seed, same blinks, every run' );
	assert.notDeepStrictEqual( x, z );
	assert.ok( x.some( v => v > 0.9 ) && x.some( v => v === 0 ), 'blinks close and open' );

	const { a, editor } = scene();
	editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { seed: 5, breath: false, gazeNoise: false } ) };
	const firstBlink = F.blinkTimes( editor.timeline.face( '#a' ).idle, '#a', 30 )[ 0 ];
	addKey( editor, '#a', 'face', { time: firstBlink - 1, shapes: { eyeBlinkLeft: 0 }, hold: true } );
	const before = JSON.stringify( editor.timeline.track( '#a' ).events );

	R.applyFaceAt( editor, firstBlink + 0.08 );
	assert.strictEqual( infl( a, 'eyeBlinkLeft' ), 0, 'an authored value owns the shape' );
	assert.ok( infl( a, 'eyeBlinkRight' ) === 0, 'and a held beat suppresses the blink on the other eye too' );

	delete editor.timeline.faces[ '#a' ]; // clearing the layer
	R.applyFaceAt( editor, firstBlink + 0.08 );
	assert.strictEqual( JSON.stringify( editor.timeline.track( '#a' ).events ), before, 'authored keys untouched' );

} );

test( 'a baked body clip that carries a morph track owns that shape against idle', () => {

	const { a, editor } = scene();
	editor.scene.animations = [ new THREE.AnimationClip( 'body', 5, [ new THREE.NumberKeyframeTrack( `${ a.mesh.uuid }.morphTargetInfluences[eyeBlinkLeft]`, [ 0, 5 ], [ 0.33, 0.33 ] ) ] ) ];
	editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { seed: 5, breath: false, gazeNoise: false } ) };

	a.mesh.morphTargetInfluences[ 2 ] = 0.33; // what the clip wrote
	const t = F.blinkTimes( editor.timeline.face( '#a' ).idle, '#a', 30 )[ 0 ] + 0.08;
	R.applyFaceAt( editor, t );
	assert.strictEqual( infl( a, 'eyeBlinkLeft' ), 0.33, 'the clip wins against idle' );
	assert.ok( infl( a, 'eyeBlinkRight' ) > 0.9, 'a shape the clip does not drive still blinks' );

} );

test( 'export bake: morph weights match playback exactly, deterministically; gaze bakes the real sampler', () => {

	const { a, b, editor } = scene();
	addKey( editor, '#a', 'face', { time: 2, shapes: { jawOpen: 0.6 }, duration: 800, easing: 'ease-out' } );
	addKey( editor, '#a', 'gaze', { time: 3, target: '#b', duration: 300 } );
	editor.timeline.faces[ '#a' ] = { idle: F.normalizeIdle( { seed: 9 } ) };
	editor.timeline.recomputeDuration();

	const sample = t => R.applyFaceAt( editor, t );
	const bake = () => R.faceExportTracks( editor, sample, { fps: 30, duration: 8 } );
	const fp = r => JSON.stringify( r.tracks.map( t => [ t.name, Array.from( t.times ), Array.from( t.values ).map( v => +v.toFixed( 6 ) ) ] ) );

	const one = bake(), two = bake();
	assert.strictEqual( fp( one ), fp( two ), 'deterministic' );

	const jaw = one.tracks.find( t => t.name === `${ a.mesh.uuid }.morphTargetInfluences[jawOpen]` );
	assert.ok( jaw );
	const it = jaw.createInterpolant();

	for ( const t of [ 0, 1.3, 2, 4.4, 7 ] ) {

		R.applyFaceAt( editor, t );
		assert.ok( Math.abs( infl( a, 'jawOpen' ) - it.evaluate( t )[ 0 ] ) < 1e-5, `jawOpen @ ${ t }` );

	}

	for ( const name of [ a.head.uuid, a.eyeL.uuid, a.eyeR.uuid ].map( u => `${ u }.quaternion` ) ) assert.ok( one.replaces.has( name ), `bakes ${ name }` );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
