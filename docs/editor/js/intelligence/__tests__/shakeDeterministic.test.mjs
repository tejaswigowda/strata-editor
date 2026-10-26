// Run: node docs/editor/js/intelligence/__tests__/shakeDeterministic.test.mjs
// The timeline recompiles its clips on every load, so shake() must not use an unseeded random number:
// the same object and step must always give the same jitter, or two renders of one timeline differ.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const threePath = path.join( here, '..', '..', '..', '..', 'build', 'three.module.js' );
register( 'data:text/javascript,' + encodeURIComponent(
	`export async function resolve( s, c, next ) { return s === 'three' ? { url: ${ JSON.stringify( pathToFileURL( threePath ).href ) }, shortCircuit: true } : next( s, c ); }`
) );
const THREE = await import( threePath );
globalThis.window = { THREE };

const { shakeRecipe } = await import( path.join( here, '..', 'animationRecipes.js' ) );

const node = uuid => ( { uuid, position: new THREE.Vector3( 1, 2, 3 ) } );
const values = uuid => Array.from( shakeRecipe( node( uuid ), { intensity: 0.5 } ).tracks[ 0 ].values );

let fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  \u2713 ' + name ); } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

test( 'the same object gives the same shake every time', () => {

	assert.deepStrictEqual( values( 'abc-123' ), values( 'abc-123' ) );

} );

test( 'a different object shakes differently', () => {

	assert.notDeepStrictEqual( values( 'abc-123' ), values( 'abc-124' ) );

} );

test( 'the jitter stays within the intensity', () => {

	for ( const v of values( 'abc-123' ) ) assert.ok( Math.abs( v - [ 1, 2, 3 ].find( b => Math.abs( v - b ) <= 0.25 ) ) <= 0.25 );

} );

process.exit( fail ? 1 : 0 );
