// Run: node docs/editor/js/intelligence/__tests__/fadeShadow.test.mjs
// The shadow pass ignores opacity, so a mesh that has not faded in yet must stop casting its shadow
// while it is invisible, get it back when it shows, and never have that switch saved with the scene.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const threePath = path.join( here, '..', '..', '..', '..', 'build', 'three.module.js' );
register( 'data:text/javascript,' + encodeURIComponent(
	`export async function resolve( s, c, next ) { return s === 'three' ? { url: ${ JSON.stringify( pathToFileURL( threePath ).href ) }, shortCircuit: true } : next( s, c ); }`
) );
globalThis.window = { THREE: await import( threePath ) };

const { syncMaterialTransparency } = await import( path.join( here, '..', 'timelineController.js' ) );
const { withCanonicalRestState } = await import( path.join( here, '..', 'timeline.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

function tile( opacity ) {

	return {
		isMesh: true,
		uuid: 'tile',
		castShadow: true,
		userData: {},
		children: [],
		material: { opacity, transparent: true, depthWrite: true, userData: { __fadeManaged: true } }
	};

}

const sync = ( ...nodes ) => syncMaterialTransparency( { scene: { traverse: fn => nodes.forEach( fn ) } } );

test( 'a faded-out tile stops casting its shadow', () => {

	const t = tile( 0 );
	sync( t );
	assert.strictEqual( t.castShadow, false );

} );

test( 'it casts again once it is more than half there, and not before', () => {

	const t = tile( 0 );
	sync( t );
	t.material.opacity = 0.3;
	sync( t );
	assert.strictEqual( t.castShadow, false );
	t.material.opacity = 0.6;
	sync( t );
	assert.strictEqual( t.castShadow, true );

} );

test( 'a ghost (opacity 0.12) throws no shadow, and its border fades with it', () => {

	const t = tile( 0.12 );
	t.children = [ { userData: { isEdgeOutline: true }, visible: true, material: { opacity: 1, transparent: false } } ];
	sync( t );
	assert.strictEqual( t.castShadow, false );
	assert.strictEqual( t.children[ 0 ].material.opacity, 0.12 );
	assert.strictEqual( t.children[ 0 ].material.transparent, true );
	t.material.opacity = 1;
	sync( t );
	assert.strictEqual( t.children[ 0 ].material.opacity, 1 );
	assert.strictEqual( t.children[ 0 ].material.transparent, false );

} );

test( 'a mesh that never casts is left alone', () => {

	const t = tile( 0 );
	t.castShadow = false;
	sync( t );
	t.material.opacity = 1;
	sync( t );
	assert.strictEqual( t.castShadow, false );

} );

test( 'a mesh whose fade is not managed by the timeline keeps its flag', () => {

	const t = tile( 0 );
	t.material.userData = {};
	sync( t );
	assert.strictEqual( t.castShadow, true );

} );

test( 'saving while a tile is hidden writes the author\'s castShadow, then puts the switch back', () => {

	const t = tile( 0 );
	sync( t );
	let saved;
	withCanonicalRestState( { traverse: fn => fn( t ) }, () => { saved = t.castShadow; } );
	assert.strictEqual( saved, true );
	assert.strictEqual( t.castShadow, false );
	t.material.opacity = 1;
	sync( t );
	assert.strictEqual( t.castShadow, true );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
