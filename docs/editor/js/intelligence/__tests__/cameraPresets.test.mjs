// Run: node docs/editor/js/intelligence/__tests__/cameraPresets.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { presetKeys, MOVE_PRESETS } = await import( path.join( here, '..', 'cameraPresets.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const base = { pos: [ 3, 0.68, 20 ], lookAt: [ 3, 0.68, 0 ], fov: 50 };   // 20 units from the subject, looking down -Z
const dist = v => Math.hypot( v[ 0 ] - base.lookAt[ 0 ], v[ 1 ] - base.lookAt[ 1 ], v[ 2 ] - base.lookAt[ 2 ] );
const close = ( a, b, eps = 1e-3 ) => a.every( ( v, i ) => Math.abs( v - b[ i ] ) < eps );

test( 'every preset starts at the base pose and spans start to end', () => {

	for ( const kind of Object.keys( MOVE_PRESETS ) ) {

		const keys = presetKeys( kind, base, { start: 10, end: 16 } );
		assert.ok( keys.length >= 5, kind + ' has a few keys' );
		assert.strictEqual( keys[ 0 ].t, 10 );
		assert.strictEqual( keys[ keys.length - 1 ].t, 16 );
		assert.ok( close( keys[ 0 ].pos, base.pos ), kind + ' starts where the camera is' );
		assert.ok( keys.every( ( k, i ) => i === 0 || k.t > keys[ i - 1 ].t ), kind + ' keys increase in time' );
		assert.ok( keys.every( k => k.fov === 50 ), kind + ' keeps the fov' );

	}

} );

test( 'push in moves toward the subject by the given share of the distance', () => {

	const keys = presetKeys( 'push', base, { start: 0, end: 4, amount: 0.25 } );
	assert.ok( close( keys[ keys.length - 1 ].pos, [ 3, 0.68, 15 ] ) );
	assert.ok( close( keys[ keys.length - 1 ].lookAt, base.lookAt ), 'the aim does not move' );

} );

test( 'pull back is the opposite of push in', () => {

	const keys = presetKeys( 'pull', base, { start: 0, end: 4, amount: 0.5 } );
	assert.ok( close( keys[ keys.length - 1 ].pos, [ 3, 0.68, 30 ] ) );

} );

test( 'orbit keeps the distance and height and turns by the given angle', () => {

	const keys = presetKeys( 'orbit', base, { start: 0, end: 6, amount: 90 } );
	for ( const k of keys ) {

		assert.ok( Math.abs( dist( k.pos ) - 20 ) < 1e-3, 'stays on the circle' );
		assert.ok( Math.abs( k.pos[ 1 ] - 0.68 ) < 1e-3, 'keeps its height' );

	}

	const end = keys[ keys.length - 1 ].pos;
	assert.ok( Math.abs( Math.abs( end[ 0 ] - 3 ) - 20 ) < 1e-3 && Math.abs( end[ 2 ] ) < 1e-3, 'a quarter of the way round' );

} );

test( 'truck goes sideways and crane goes up, keeping the aim', () => {

	const t = presetKeys( 'truck', base, { start: 0, end: 4, amount: 0.25 } );
	assert.ok( Math.abs( Math.abs( t[ t.length - 1 ].pos[ 0 ] - 3 ) - 5 ) < 1e-3 );
	assert.ok( Math.abs( t[ t.length - 1 ].pos[ 2 ] - 20 ) < 1e-3 );
	const c = presetKeys( 'crane', base, { start: 0, end: 4, amount: 0.2 } );
	assert.ok( Math.abs( c[ c.length - 1 ].pos[ 1 ] - ( 0.68 + 4 ) ) < 1e-3 );

} );

test( 'drift returns to where it started', () => {

	const keys = presetKeys( 'drift', base, { start: 0, end: 8 } );
	assert.ok( close( keys[ keys.length - 1 ].pos, base.pos ) );
	assert.ok( keys.some( k => Math.abs( k.pos[ 0 ] - 3 ) > 0.1 ), 'but it does move' );

} );

test( 'easing: the move starts and ends slowly', () => {

	const keys = presetKeys( 'push', base, { start: 0, end: 6 } );
	const step = i => Math.abs( keys[ i + 1 ].pos[ 2 ] - keys[ i ].pos[ 2 ] );
	assert.ok( step( 0 ) < step( 2 ) && step( keys.length - 2 ) < step( 2 ) );

} );

test( 'bad input is refused with a readable message', () => {

	assert.throws( () => presetKeys( 'spin', base ), /must be one of/ );
	assert.throws( () => presetKeys( 'push', { pos: [ 0, 0, 0 ] } ), /position/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
