// Run: node docs/editor/js/toon/__tests__/toonSpec.test.mjs
// Pure checks for the `look` spec (no GPU). The renderer-side behaviour (MToon node
// material, outlines, neon banding, save/restore) is exercised in the browser; see
// guides/TOON_LOOK.md "Verifying".

import { normalizeLook, applyLookSpec, applyLookToProp, lookOf, sceneHasToon, isVRMSource, registerLookApplier } from '../toonSpec.js';

let passed = 0, failed = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const eq = ( a, b, m ) => { if ( JSON.stringify( a ) !== JSON.stringify( b ) ) throw new Error( ( m || 'not equal' ) + `: ${ JSON.stringify( a ) } vs ${ JSON.stringify( b ) }` ); };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };

console.log( 'toon spec' );

test( 'a bare mode string is a valid spec', () => { eq( normalizeLook( 'toon' ).spec, { look: 'toon' } ); } );
test( 'scene-spec form and customize-op form normalise the same', () => {

	const a = normalizeLook( { look: 'toon', bands: 2, rim: { color: '#f0f' } } ).spec;
	const b = normalizeLook( { op: 'look', mode: 'toon', bands: 2, rim: { color: '#f0f' } } ).spec;
	eq( a, b );
	eq( a.toony, 1, 'bands:2 is toony 1' );

} );
test( 'bands other than 2 is refused (MToon is two-tone)', () => { const n = normalizeLook( { look: 'toon', bands: 4 } ); ok( ! n.ok ); ok( /MToon has no 3\+ band/.test( n.errors[ 0 ] ) ); } );
test( 'bands:2 with a conflicting toony is refused', () => { ok( ! normalizeLook( { look: 'toon', bands: 2, toony: 0.4 } ).ok ); } );
test( 'unknown modes and fields are refused, not ignored', () => {

	ok( ! normalizeLook( { look: 'cel' } ).ok );
	ok( ! normalizeLook( { look: 'toon', glow: 1 } ).ok );
	ok( ! normalizeLook( { look: 'toon', rim: { speed: 2 } } ).ok );
	ok( ! normalizeLook( { look: 'toon', outline: { mode: 'sideways' } } ).ok );

} );
test( 'ranges are clamped, as everywhere else', () => {

	eq( normalizeLook( { look: 'toon', shift: 2 } ).spec.shift, 1 );
	eq( normalizeLook( { look: 'toon', toony: - 0.1 } ).spec.toony, 0 );
	eq( normalizeLook( { look: 'toon', rim: { power: 0 } } ).spec.rim.power, 0.1 );
	eq( normalizeLook( { look: 'toon', outline: { width: - 1 } } ).spec.outline.width, 0 );
	eq( normalizeLook( { look: 'toon', outline: { width: 0 } } ).spec.outline.width, 0, 'width 0 (outlines off) is valid' );
	ok( ! normalizeLook( { look: 'toon', shift: 'high' } ).ok, 'a wrong type is still refused' );

} );
test( 'flat and nested spellings give the same spec', () => {

	const nested = normalizeLook( { look: 'toon', rim: { color: '#fff', mix: 0.5 }, outline: { width: 0 } } ).spec;
	const flat = normalizeLook( { look: 'toon', rimColor: '#ffffff', rimMix: 0.5, outlineWidth: 0 } ).spec;
	eq( nested, flat );
	eq( nested.rim.color, '#ffffff', 'short hex is expanded' );

} );
test( 'native is a valid spec (revert)', () => { ok( normalizeLook( { look: 'native' } ).ok ); } );

test( 'applyLookSpec records the spec on the character, deterministically, without a renderer', () => {

	const root = { userData: {} };
	const spec = applyLookSpec( root, { look: 'toon', bands: 2, shade: '#102' } );
	eq( root.userData.look, spec );
	const again = { userData: {} };
	applyLookSpec( again, { look: 'toon', bands: 2, shade: '#102' } );
	eq( root.userData.look, again.userData.look, 'same spec, same record' );
	applyLookSpec( root, { look: 'native' } );
	ok( root.userData.look === undefined, 'native clears it' );

} );

test( 'a prop inherits its character\'s look; the applier is called for it', () => {

	const seen = [];
	registerLookApplier( ( root, spec ) => seen.push( [ root.name, spec.look ] ) );
	const character = { name: 'c', userData: { look: { look: 'toon' } }, parent: null };
	const prop = { name: 'belt', userData: {}, parent: character };
	eq( lookOf( prop ), { look: 'toon' } );
	applyLookToProp( prop );
	eq( seen, [ [ 'belt', 'toon' ] ] );
	applyLookToProp( { name: 'loose', userData: {}, parent: null } );
	eq( seen.length, 1, 'no look, no call' );
	registerLookApplier( null );

} );

test( 'sceneHasToon finds a serialised toon material or a recorded look', () => {

	const mk = ( userData, matUserData ) => ( { traverse( fn ) { fn( { userData, isMesh: !! matUserData, material: { userData: matUserData || {} } } ); } } );
	ok( sceneHasToon( mk( { look: { look: 'toon' } } ) ) );
	ok( sceneHasToon( mk( {}, { toon: { v: 1 } } ) ) );
	ok( ! sceneHasToon( mk( {}, {} ) ) );

} );

test( 'isVRMSource spots VRM 0.x and 1.0 JSON, and ignores plain glTF', () => {

	ok( isVRMSource( '{"extensions":{"VRM":{"exporterVersion":"x"}}}' ) );
	ok( isVRMSource( '{"extensions":{"VRMC_vrm":{}}}' ) );
	ok( isVRMSource( '{"materials":[{"extensions":{"VRMC_materials_mtoon":{}}}]}' ) );
	ok( ! isVRMSource( '{"asset":{"version":"2.0"},"extensions":{"KHR_materials_unlit":{}}}' ) );

	// a minimal GLB container with a VRM JSON chunk
	const json = new TextEncoder().encode( '{"extensions":{"VRM":{}}}   ' ); // padded to 4
	const buf = new ArrayBuffer( 20 + json.length );
	const dv = new DataView( buf );
	dv.setUint32( 0, 0x46546c67, true ); dv.setUint32( 4, 2, true ); dv.setUint32( 8, buf.byteLength, true );
	dv.setUint32( 12, json.length, true ); dv.setUint32( 16, 0x4e4f534a, true );
	new Uint8Array( buf, 20 ).set( json );
	ok( isVRMSource( buf ), 'GLB with a VRM chunk' );
	ok( ! isVRMSource( new ArrayBuffer( 64 ) ), 'not a GLB' );

} );

console.log( `\n${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
