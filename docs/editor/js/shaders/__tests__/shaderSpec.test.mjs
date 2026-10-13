// Run: node docs/editor/js/shaders/__tests__/shaderSpec.test.mjs
// Pure checks for the shader registry (no GPU). The material work (node materials,
// undo, save/restore) is exercised in the browser; see guides/SHADERS.md "Verifying".

import { SHADERS, getShaderDef, listShaders, defaultParams, normalizeShaderParams, mtoonLookSpec, isOutlineName, flattenMtoon } from '../shaderSpec.js';
import { normalizeLook } from '../../toon/toonSpec.js';

let passed = 0, failed = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const eq = ( a, b, m ) => { if ( JSON.stringify( a ) !== JSON.stringify( b ) ) throw new Error( ( m || 'not equal' ) + `: ${ JSON.stringify( a ) } vs ${ JSON.stringify( b ) }` ); };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };

console.log( 'shader registry' );

test( 'ids are unique and every param has a type, key and default', () => {

	eq( new Set( SHADERS.map( s => s.id ) ).size, SHADERS.length );
	for ( const s of SHADERS ) for ( const p of s.params ) { ok( p.key && p.type && p.default !== undefined, s.id + '.' + p.key ); }

} );
test( 'every default passes its own validation', () => {

	for ( const s of SHADERS ) { const n = normalizeShaderParams( s.id, defaultParams( s.id ) ); ok( n.ok, s.id + ': ' + n.errors ); }

} );
test( 'aliases resolve', () => {

	eq( getShaderDef( 'toon' ).id, 'mtoon' );
	eq( getShaderDef( ' Unlit ' ).id, 'basic' );
	eq( getShaderDef( 'nope' ), null );
	eq( getShaderDef( 42 ), null );

} );
test( 'listShaders is plain JSON', () => { eq( JSON.parse( JSON.stringify( listShaders() ) ), listShaders() ); } );

console.log( 'param validation' );

test( 'missing keys take defaults; colors normalise', () => {

	const n = normalizeShaderParams( 'fresnel', { color: 0xff8800 } );
	ok( n.ok );
	eq( n.params.color, '#ff8800' );
	eq( n.params.power, 3 );

} );
test( 'numbers clamp to the range', () => { eq( normalizeShaderParams( 'standard', { roughness: 9 } ).params.roughness, 1 ); } );
test( 'unknown keys and bad types are refused', () => {

	ok( ! normalizeShaderParams( 'standard', { glossy: 1 } ).ok );
	ok( ! normalizeShaderParams( 'standard', { roughness: 'rough' } ).ok );
	ok( ! normalizeShaderParams( 'fresnel', { color: 'red' } ).ok );
	ok( ! normalizeShaderParams( 'gradient', { axis: 'w' } ).ok );
	ok( ! normalizeShaderParams( 'standard', [ 1 ] ).ok );
	ok( ! normalizeShaderParams( 'nope', {} ).ok );

} );
test( 'fill:false returns only what was given', () => { eq( normalizeShaderParams( 'mtoon', { toony: 0.5 }, false ).params, { toony: 0.5 } ); } );

console.log( 'mtoon bridge' );

test( 'mtoon params become a valid look spec', () => {

	const g = normalizeShaderParams( 'mtoon', { shade: '#223344', rimColor: '#ffffff', rimMix: 0.5, outlineWidth: 0 }, false ).params;
	const spec = mtoonLookSpec( g );
	eq( spec, { look: 'toon', shade: '#223344', rim: { color: '#ffffff', mix: 0.5 }, outline: { width: 0 } } );
	ok( normalizeLook( spec ).ok, String( normalizeLook( spec ).errors ) );

} );
test( 'no params is a bare toon look', () => { eq( mtoonLookSpec( {} ), { look: 'toon' } ); } );
test( 'the nested look form flattens to mtoon params', () => {

	eq( flattenMtoon( { look: 'toon', shade: '#223344', rim: { color: '#fff', mix: 0.4 }, outline: { width: 0 } } ), { shade: '#223344', rimColor: '#fff', rimMix: 0.4, outlineWidth: 0 } );
	eq( flattenMtoon( { toony: 0.5 } ), { toony: 0.5 } );
	eq( flattenMtoon( undefined ), undefined );

} );
test( 'outline names', () => {

	ok( isOutlineName( 'Object674_outline_0' ) );
	ok( isOutlineName( 'Outline' ) );
	ok( ! isOutlineName( 'normal' ) );
	ok( ! isOutlineName( undefined ) );

} );

console.log( `\n${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
