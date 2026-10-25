// Run: node docs/editor/js/intelligence/__tests__/moveToFlourish.test.mjs
// moveToEach's optional spin / arc / stagger must end exactly where a plain move would.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const threePath = path.join( here, '..', '..', '..', '..', 'build', 'three.module.js' );

// the editor resolves 'three' through an import map; Node needs the same mapping
register( 'data:text/javascript,' + encodeURIComponent(
	`export async function resolve( s, c, next ) { return s === 'three' ? { url: ${ JSON.stringify( pathToFileURL( threePath ).href ) }, shortCircuit: true } : next( s, c ); }`
) );

const THREE = await import( threePath );
globalThis.window = { THREE };
const { moveToRecipe } = await import( path.join( here, '..', 'animationRecipes.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

function mover( outline = false ) {

	const parent = new THREE.Group();
	parent.updateMatrixWorld( true );
	const node = new THREE.Mesh();
	if ( outline ) node.userData.isEdgeOutline = true;
	parent.add( node );
	return node;

}

const target = { targetWorld: [ 4, 2, 0 ], targetQuaternion: new THREE.Quaternion().setFromEuler( new THREE.Euler( 0, 0, 0.9 ) ).toArray(), duration: 3, easing: 'ease-in-out' };
const keys = ( clip, suffix ) => { const t = clip.tracks.find( x => x.name.endsWith( suffix ) ); return { times: t.times, values: t.values, size: t.values.length / t.times.length }; };
const at = ( t, i ) => Array.from( t.values.slice( i * t.size, ( i + 1 ) * t.size ) );
const close = ( a, b, eps = 1e-5 ) => a.every( ( v, i ) => Math.abs( v - b[ i ] ) < eps );

test( 'a plain moveToEach is unchanged: straight position, slerp to the target', () => {

	const clip = moveToRecipe( mover(), target );
	const pos = keys( clip, '.position' );
	assert.ok( close( at( pos, pos.times.length - 1 ), [ 4, 2, 0 ] ) );
	for ( let i = 0; i < pos.times.length; i ++ ) assert.ok( Math.abs( at( pos, i )[ 2 ] ) < 1e-9, 'no lift' );

} );

test( 'spin, arc and stagger still land exactly on the target pose', () => {

	const node = mover();
	node.userData = {};
	const clip = moveToRecipe( node, { ...target, spin: [ 1, 2, 0 ], arc: 3, stagger: 0.4, eachIndex: 7 } );
	const pos = keys( clip, '.position' );
	const rot = keys( clip, '.quaternion' );
	const last = pos.times.length - 1;
	assert.ok( close( at( pos, last ), [ 4, 2, 0 ] ), 'ends at the target' );
	assert.ok( close( at( pos, 0 ), [ 0, 0, 0 ] ), 'starts where it was' );

	const want = new THREE.Quaternion().fromArray( target.targetQuaternion );
	const got = new THREE.Quaternion().fromArray( at( rot, last ) );
	assert.ok( Math.abs( Math.abs( want.dot( got ) ) - 1 ) < 1e-5, 'ends in the target orientation' );

	const peak = Math.max( ...Array.from( { length: pos.times.length }, ( _, i ) => at( pos, i )[ 2 ] ) );
	assert.ok( peak > 1, 'lifts off the plane mid-flight, got ' + peak );

} );

test( 'a staggered source waits at its start, and two compiles agree', () => {

	const params = { ...target, spin: [ 1, 1, 0 ], arc: 2, stagger: 0.6, eachIndex: 3 };
	const a = moveToRecipe( mover(), params );
	const b = moveToRecipe( mover(), params );
	assert.deepStrictEqual( Array.from( keys( a, '.position' ).values ), Array.from( keys( b, '.position' ).values ) );
	const pos = keys( a, '.position' );
	assert.ok( close( at( pos, 1 ), [ 0, 0, 0 ] ), 'still at the start one step in' );

} );

test( 'different sources tumble differently', () => {

	const base = { ...target, spin: [ 1, 1, 0 ], arc: 2, stagger: 0.3 };
	const a = keys( moveToRecipe( mover(), { ...base, eachIndex: 0 } ), '.position' );
	const b = keys( moveToRecipe( mover(), { ...base, eachIndex: 5 } ), '.position' );
	assert.notDeepStrictEqual( Array.from( a.values ), Array.from( b.values ) );

} );

test( 'an edge outline ignores the flourish so it stays glued to its tile', () => {

	const plain = moveToRecipe( mover( true ), target );
	const lively = moveToRecipe( mover( true ), { ...target, spin: [ 1, 1, 0 ], arc: 3, stagger: 0.5, eachIndex: 2 } );
	assert.deepStrictEqual( Array.from( keys( plain, '.position' ).values ), Array.from( keys( lively, '.position' ).values ) );
	assert.deepStrictEqual( Array.from( keys( plain, '.quaternion' ).values ), Array.from( keys( lively, '.quaternion' ).values ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
