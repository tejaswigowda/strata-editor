// Node tests for the scene save path's lossy quantization. Run with:
//   node docs/editor/js/__tests__/sceneQuantize.test.mjs

import assert from 'node:assert';
import { QUANTIZE_DECIMALS, quantizeClipJSON, quantizeSceneJSON } from '../SceneQuantize.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const clip = () => ( {
	name: 'c', duration: 1.23456789, uuid: 'u-1234',
	tracks: [
		{ name: 'Hips.quaternion', type: 'quaternion', times: [ 0.03333333333, 0.06666666667 ], values: [ - 2.261618647025898e-06, 0.1234567891, 0.5, 0.8660254037844386, 0, 0, 0, 1 ] },
		{ name: 'Hips.position', type: 'vector', times: [ 0, 0.5 ], values: [ 1.0372790098190308, - 0.00004, 2.00005, 0, 0, 0 ] },
		{ name: 'Hips.scale', type: 'vector', times: [ 0.123456 ], values: [ 1.0372790098190308, 1, 1 ] },
		{ name: 'Face.morphTargetInfluences[smile]', type: 'number', times: [ 0.123456 ], values: [ 0.123456789 ] },
	],
} );

test( 'quaternion 5 dp, position 4 dp, times 4 dp', () => {

	const c = quantizeClipJSON( clip() );
	assert.deepStrictEqual( c.tracks[ 0 ].times, [ 0.0333, 0.0667 ] );
	assert.deepStrictEqual( c.tracks[ 0 ].values.slice( 0, 4 ), [ 0, 0.12346, 0.5, 0.86603 ] );
	assert.deepStrictEqual( c.tracks[ 1 ].values.slice( 0, 3 ), [ 1.0373, 0, 2.0001 ] );

} );

test( 'only position/quaternion values change; scale, morph, uuid, duration and names are untouched', () => {

	const before = clip(), after = quantizeClipJSON( clip() );
	assert.deepStrictEqual( after.tracks[ 2 ].values, before.tracks[ 2 ].values );
	assert.deepStrictEqual( after.tracks[ 3 ].values, before.tracks[ 3 ].values );
	assert.strictEqual( after.uuid, before.uuid );
	assert.strictEqual( after.duration, before.duration );
	assert.deepStrictEqual( after.tracks.map( t => t.name ), before.tracks.map( t => t.name ) );
	assert.deepStrictEqual( after.tracks[ 2 ].times, [ 0.1235 ] ); // times quantize on every track

} );

test( 'no negative zero, no scientific notation noise', () => {

	const c = quantizeClipJSON( clip() );
	assert.ok( ! Object.is( c.tracks[ 0 ].values[ 0 ], - 0 ) );
	assert.ok( ! JSON.stringify( c.tracks[ 0 ] ).includes( 'e-' ) );

} );

test( 'deterministic and idempotent: byte-identical output, re-quantizing changes nothing', () => {

	const a = JSON.stringify( quantizeClipJSON( clip() ) );
	const b = JSON.stringify( quantizeClipJSON( clip() ) );
	assert.strictEqual( a, b );
	assert.strictEqual( JSON.stringify( quantizeClipJSON( JSON.parse( a ) ) ), a );

} );

test( 'quantizeSceneJSON walks json.animations and leaves the rest of the scene alone', () => {

	const json = { scene: { object: { matrix: [ 1.0372790098190308 ] } }, animations: [ { object: 'o', clip: clip() } ] };
	quantizeSceneJSON( json );
	assert.strictEqual( json.scene.object.matrix[ 0 ], 1.0372790098190308 );
	assert.strictEqual( json.animations[ 0 ].clip.tracks[ 1 ].values[ 0 ], 1.0373 );
	assert.doesNotThrow( () => quantizeSceneJSON( { scene: {} } ) );
	assert.doesNotThrow( () => quantizeSceneJSON( null ) );

} );

test( 'the precision is a named, frozen constant', () => {

	assert.deepStrictEqual( { ...QUANTIZE_DECIMALS }, { quaternion: 5, position: 4, time: 4 } );
	assert.ok( Object.isFrozen( QUANTIZE_DECIMALS ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
