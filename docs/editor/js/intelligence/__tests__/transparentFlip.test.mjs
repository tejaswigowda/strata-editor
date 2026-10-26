// Run: node docs/editor/js/intelligence/__tests__/transparentFlip.test.mjs
// three.js picks a material's shader program again only when material.version changes, and bakes `transparent === false`
// into it (#define OPAQUE). So when the sampler flips `transparent`, it must also set needsUpdate, or a material first drawn
// opaque ignores its opacity for good, and a full render differs from a render of part of it.
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

let fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  \u2713 ' + name ); } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

function mesh( opacity, outlineMaterial ) {

	const material = { opacity, transparent: false, depthWrite: true, needsUpdate: false, userData: { __fadeManaged: true, __fadeManagedOrigTransparent: false } };
	const outline = { userData: { isEdgeOutline: true }, visible: true, material: outlineMaterial };
	return { isMesh: true, visible: true, castShadow: true, userData: {}, material, children: outlineMaterial ? [ outline ] : [], outline };

}

const editorWith = node => ( { scene: { traverse: fn => fn( node ), children: [] } } );

test( 'a material that starts to fade is told to re-select its program, once', () => {

	const node = mesh( 0.15 );
	syncMaterialTransparency( editorWith( node ) );
	assert.strictEqual( node.material.transparent, true );
	assert.strictEqual( node.material.needsUpdate, true );

	node.material.needsUpdate = false;
	syncMaterialTransparency( editorWith( node ) ); // nothing changed: no needless recompiles
	assert.strictEqual( node.material.needsUpdate, false );

} );

test( 'finishing a fade (back to opaque) is a flip too', () => {

	const node = mesh( 0.15 );
	syncMaterialTransparency( editorWith( node ) );
	node.material.needsUpdate = false;
	node.material.opacity = 1;
	syncMaterialTransparency( editorWith( node ) );
	assert.strictEqual( node.material.transparent, false );
	assert.strictEqual( node.material.needsUpdate, true );

} );

test( 'the edge outline that follows its cube is handled the same way', () => {

	const node = mesh( 0.15, { opacity: 1, transparent: false, needsUpdate: false } );
	syncMaterialTransparency( editorWith( node ) );
	assert.strictEqual( node.outline.material.transparent, true );
	assert.strictEqual( node.outline.material.needsUpdate, true );
	assert.strictEqual( node.outline.material.opacity, 0.15 );

} );

process.exit( fail ? 1 : 0 );
