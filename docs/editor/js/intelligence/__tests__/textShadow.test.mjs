// Run: node docs/editor/js/intelligence/__tests__/textShadow.test.mjs
// A text mesh flagged userData.textShadow gets a transient black copy that mirrors the label's
// geometry, opacity and visibility, and is never serialized.
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

const { syncTextShadows, withAuthoredText } = await import( path.join( here, '..', 'textChange.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

function label( flagged ) {

	const geometry = new THREE.BoxGeometry( 1, 1, 1 );
	geometry.parameters = { ...geometry.parameters, options: { text: 'x', size: 2 } };
	const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { color: 0xffffff } ) );
	if ( flagged ) mesh.userData.textShadow = true;
	const scene = new THREE.Scene();
	scene.add( mesh );
	return { scene, mesh };

}

const shadowOf = mesh => mesh.children.find( c => c.userData.isTextShadow );

test( 'a flagged label gets one black shadow, offset down and right', () => {

	const { scene, mesh } = label( true );
	syncTextShadows( scene );
	syncTextShadows( scene );
	assert.strictEqual( mesh.children.length, 1 );
	const s = shadowOf( mesh );
	assert.strictEqual( s.material.color.getHex(), 0 );
	assert.ok( s.position.x > 0 && s.position.y < 0 && s.position.z < 0 );
	assert.strictEqual( s.geometry, mesh.geometry );

} );

test( 'an unflagged label gets nothing', () => {

	const { scene, mesh } = label( false );
	syncTextShadows( scene );
	assert.strictEqual( mesh.children.length, 0 );

} );

test( 'the shadow follows the label geometry and opacity', () => {

	const { scene, mesh } = label( true );
	syncTextShadows( scene );
	mesh.geometry = new THREE.BoxGeometry( 2, 1, 1 );
	mesh.geometry.parameters = { ...mesh.geometry.parameters, options: { text: 'yy', size: 2 } };
	mesh.material.opacity = 0.4;
	syncTextShadows( scene );
	const s = shadowOf( mesh );
	assert.strictEqual( s.geometry, mesh.geometry );
	assert.strictEqual( s.material.opacity, 0.4 );
	assert.strictEqual( s.material.transparent, true );

} );

test( 'a label with no vertices has no visible shadow', () => {

	const { scene, mesh } = label( true );
	mesh.geometry = new THREE.BufferGeometry();
	mesh.geometry.parameters = { options: { text: '', size: 2 } };
	syncTextShadows( scene );
	assert.strictEqual( shadowOf( mesh ).visible, false );

} );

test( 'the shadow is left out of a serialized scene and comes back after', () => {

	const { scene, mesh } = label( true );
	syncTextShadows( scene );
	const seen = withAuthoredText( scene, () => mesh.children.length );
	assert.strictEqual( seen, 0 );
	assert.strictEqual( mesh.children.length, 1 );

} );

test( 'clearing the flag removes the shadow', () => {

	const { scene, mesh } = label( true );
	syncTextShadows( scene );
	mesh.userData.textShadow = false;
	syncTextShadows( scene );
	assert.strictEqual( mesh.children.length, 0 );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail ) process.exit( 1 );
