// Run: node docs/editor/js/intelligence/__tests__/textChangeState.test.mjs
// A label's material flags at timeline time t must not depend on which times were sampled before. Found by the shuffled-order render test (guides/TIME_SOURCES.md):
// a label that had ever been in a fade kept `transparent = true` for the rest of the session, so the same time drew differently on a fresh scene and a scrubbed one.
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
globalThis.requestAnimationFrame = fn => setTimeout( fn, 0 );
const { applyContentAt } = await import( path.join( here, '..', 'textChange.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) { try { fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

// a stand-in for TextGeometry: the string is its vertex count, so "" is empty
class FakeText extends THREE.BufferGeometry {

	constructor( text = '', options = {} ) {

		super();
		this.parameters = { text, options: { ...options, text } };
		this.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( Math.max( 1, text.length ) * 3 ), 3 ) );

	}

}

function scene( { authoredTransparent = false } = {} ) {

	const mesh = new THREE.Mesh( new FakeText( 'A', { size: 1 } ), new THREE.MeshStandardMaterial( { transparent: authoredTransparent } ) );
	const root = new THREE.Scene();
	root.add( mesh );
	// text A until 2 s, then B, fading over 1 s from 2 s (A dips out, B comes in), and a plain change to C at 5 s
	const model = { tracks: [ { target: mesh.uuid, events: [
		{ op: 'change', at: 0, dur: 0, args: { text: 'A' } },
		{ op: 'change', at: 2, dur: 1, args: { text: 'B', transition: 'fade' } },
		{ op: 'change', at: 5, dur: 0, args: { text: 'C' } },
	] } ] };
	const editor = { scene: root };
	return { mesh, model, editor, at: t => applyContentAt( editor, model, t ) };

}
const flags = m => ( { opacity: m.material.opacity, transparent: m.material.transparent, depthWrite: m.material.depthWrite, text: m.geometry.parameters.options.text } );

test( 'after a fade, the label is exactly what it is on a scene that never sampled the fade: opaque, depth-writing, not transparent', () => {

	const fresh = scene(); fresh.at( 4 );
	const scrubbed = scene(); scrubbed.at( 2.2 ); scrubbed.at( 2.7 ); scrubbed.at( 4 );
	assert.deepStrictEqual( flags( scrubbed.mesh ), flags( fresh.mesh ) );
	assert.deepStrictEqual( [ flags( fresh.mesh ).transparent, flags( fresh.mesh ).depthWrite, flags( fresh.mesh ).opacity ], [ false, true, 1 ] );

} );

test( 'during the fade it is transparent and does not write depth, and that too is the same whatever came before', () => {

	const a = scene(); a.at( 2.2 );
	const b = scene(); b.at( 4 ); b.at( 0.5 ); b.at( 2.2 );
	assert.deepStrictEqual( flags( a.mesh ), flags( b.mesh ) );
	assert.deepStrictEqual( [ flags( a.mesh ).transparent, flags( a.mesh ).depthWrite ], [ true, false ] );

} );

test( 'scrubbing back to before the first change after a fade restores the label too', () => {

	const fresh = scene(); fresh.at( -1 );
	const scrubbed = scene(); scrubbed.at( 2.5 ); scrubbed.at( -1 );
	assert.deepStrictEqual( flags( scrubbed.mesh ), flags( fresh.mesh ) );
	assert.strictEqual( scrubbed.mesh.material.transparent, false );
	assert.strictEqual( scrubbed.mesh.material.depthWrite, true );

} );

test( 'what the author made transparent stays transparent, in a fade and out of it', () => {

	const s = scene( { authoredTransparent: true } );
	s.at( 2.2 ); s.at( 4 );
	assert.strictEqual( s.mesh.material.transparent, true, 'the authored flag comes back, not a blanket false' );
	const fresh = scene( { authoredTransparent: true } ); fresh.at( 4 );
	assert.deepStrictEqual( flags( s.mesh ), flags( fresh.mesh ) );

} );

test( 'every sampling order gives the same label at every time (the shuffled-order test, in miniature)', () => {

	const times = [ -1, 0, 1.9, 2, 2.2, 2.6, 2.99, 3, 3.5, 4.99, 5, 6 ];
	const reference = {};
	for ( const t of times ) { const s = scene(); s.at( t ); reference[ t ] = flags( s.mesh ); }
	let seed = 12345; const rand = () => ( seed = ( seed * 1103515245 + 12345 ) % 2147483648 ) / 2147483648;
	for ( let run = 0; run < 20; run ++ ) {

		const s = scene(), order = times.slice().sort( () => rand() - 0.5 );
		for ( const t of order ) { s.at( t ); assert.deepStrictEqual( flags( s.mesh ), reference[ t ], `t=${ t } after ${ order.join( ' ' ) }` ); }

	}

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
