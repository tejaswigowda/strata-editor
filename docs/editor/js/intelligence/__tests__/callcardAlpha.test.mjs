// Run: node docs/editor/js/intelligence/__tests__/callcardAlpha.test.mjs
// A call card's baked texture has a transparent background; at full opacity its material must keep
// blending, or the QR renders as a blank white box (the last frame of a render).
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

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

function mesh( { opacity, origTransparent, isCallcard } ) {

	return {
		isMesh: true,
		userData: isCallcard ? { isCallcard: true } : {},
		children: [],
		material: { opacity, transparent: false, depthWrite: true, userData: { __fadeManaged: true, __fadeManagedOrigTransparent: origTransparent } }
	};

}

const sync = ( ...nodes ) => syncMaterialTransparency( { scene: { traverse: fn => nodes.forEach( fn ) } } );

test( 'a call card keeps blending at full opacity even if its saved scene said opaque', () => {

	const card = mesh( { opacity: 1, origTransparent: false, isCallcard: true } );
	sync( card );
	assert.strictEqual( card.material.transparent, true );

} );

test( 'an ordinary faded mesh still goes back to opaque at full opacity', () => {

	const box = mesh( { opacity: 1, origTransparent: false, isCallcard: false } );
	sync( box );
	assert.strictEqual( box.material.transparent, false );

} );

test( 'a material that was transparent before fading keeps it', () => {

	const glass = mesh( { opacity: 1, origTransparent: true, isCallcard: false } );
	sync( glass );
	assert.strictEqual( glass.material.transparent, true );

} );

test( 'mid-fade and invisible states are unchanged', () => {

	const mid = mesh( { opacity: 0.5, origTransparent: false, isCallcard: false } );
	const gone = mesh( { opacity: 0, origTransparent: false, isCallcard: true } );
	sync( mid, gone );
	assert.strictEqual( mid.material.transparent, true );
	assert.strictEqual( mid.material.depthWrite, true );
	assert.strictEqual( gone.material.transparent, true );
	assert.strictEqual( gone.material.depthWrite, false );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
