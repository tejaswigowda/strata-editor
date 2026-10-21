// Run: node docs/editor/js/shaders/__tests__/shaderSpec.test.mjs
// Pure checks for the shader registry (no GPU). The material work (node materials,
// undo, save/restore) is exercised in the browser; see guides/SHADERS.md "Verifying".

import { SHADERS, getShaderDef, listShaders, defaultParams, normalizeShaderParams, mtoonLookSpec, isOutlineName, didYouMean, splitLookSpec, unknownShaderMessage } from '../shaderSpec.js';
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
test( 'outline names', () => {

	ok( isOutlineName( 'Object674_outline_0' ) );
	ok( isOutlineName( 'Outline' ) );
	ok( ! isOutlineName( 'normal' ) );
	ok( ! isOutlineName( undefined ) );

} );

console.log( 'mtoon spec: one shape, everywhere' );

const mtoon = ( spec, fill = false ) => normalizeShaderParams( 'mtoon', spec, fill );
const flatOf = spec => { const n = mtoon( spec ); ok( n.ok, String( n.errors ) ); return n.params; };

test( 'nested, flat and mixed spellings give the same flat params', () => {

	const want = { toony: 0.9, rimColor: '#ff00ff', rimMix: 0.5, outlineWidth: 0 };
	eq( flatOf( { toony: 0.9, outline: { width: 0 }, rim: { color: '#ff00ff', mix: 0.5 } } ), want );
	eq( flatOf( { toony: 0.9, outlineWidth: 0, rimColor: '#ff00ff', rimMix: 0.5 } ), want );
	eq( flatOf( { toony: 0.9, outline: { width: 0 }, rimColor: 0xff00ff, rim: { mix: 0.5 } } ), want );

} );
test( 'the bug report: shader( t, "mtoon", { toony, outline: { width: 0 } } ) is valid', () => {

	eq( flatOf( { toony: 0.9, outline: { width: 0 } } ), { toony: 0.9, outlineWidth: 0 } );

} );
test( 'every nested key is reachable and maps to a real flat param', () => {

	const def = getShaderDef( 'mtoon' );
	const flat = new Set( def.params.map( p => p.key ) );
	for ( const [ group, keys ] of Object.entries( def.nested ) ) for ( const [ nk, fk ] of Object.entries( keys ) ) ok( flat.has( fk ), `${ group }.${ nk } -> ${ fk }` );

} );
test( 'the toon look route and the registry route agree', () => {

	const spec = { look: 'toon', shade: '#223344', rim: { color: '#fff', lift: 0.2 }, outlineMode: 'screen', outline: { mix: 0.5 }, shift: - 3 };
	const { look, ...fromLook } = normalizeLook( spec ).spec;
	eq( look, 'toon' );
	const { look: l2, ...fromRegistry } = mtoonLookSpec( flatOf( spec ) );
	eq( fromLook, fromRegistry );

} );
test( 'unknown keys are refused with a suggestion and both legal spellings', () => {

	const n = mtoon( { toony: 0.9, outlin: { width: 0 } } );
	ok( ! n.ok );
	const msg = n.errors[ 0 ];
	ok( /unknown param "outlin"/.test( msg ), msg );
	ok( /did you mean "outline"/.test( msg ), msg );
	ok( /flat: shade, shift, toony, rimColor/.test( msg ) && /nested: rim:\{ color, power, lift, mix \}, outline:\{ width, color, mode, mix \}/.test( msg ), msg );

} );
test( 'typos in flat, nested and separator styles are caught', () => {

	ok( /did you mean "rimColor"/.test( mtoon( { rimcolour: '#fff' } ).errors[ 0 ] ), mtoon( { rimcolour: '#fff' } ).errors[ 0 ] );
	ok( /did you mean "outlineWidth"/.test( mtoon( { outline_width: 0 } ).errors[ 0 ] ) );
	ok( /did you mean "outline.width"/.test( mtoon( { outline: { wdth: 0 } } ).errors[ 0 ] ) );
	ok( /did you mean "toony"/.test( mtoon( { toonyness: 1 } ).errors[ 0 ] ) || /unknown param "toonyness"/.test( mtoon( { toonyness: 1 } ).errors[ 0 ] ) );
	ok( ! /did you mean/.test( mtoon( { glow: 1 } ).errors[ 0 ] ), 'nothing close, no guess' );
	ok( /Legal:/.test( mtoon( { glow: 1 } ).errors[ 0 ] ) );

} );
test( 'every bad key is reported, not just the first', () => {

	eq( mtoon( { glow: 1, sparkle: 2, outline: { thick: 1 } } ).errors.length, 3 );

} );
test( 'a group that is not an object, and a setting given twice, are refused', () => {

	ok( /outline: expected an object/.test( mtoon( { outline: 3 } ).errors[ 0 ] ) );
	ok( /both|same thing/.test( mtoon( { outlineWidth: 1, outline: { width: 2 } } ).errors[ 0 ] ) );
	ok( mtoon( { outlineWidth: 0.01, outline: { width: 0.01 } } ).ok, 'the same value twice is harmless' );

} );
test( 'numbers clamp in every spelling', () => {

	eq( flatOf( { shift: 5, rim: { power: 0, mix: 9 }, outline: { width: - 1 }, outlineMix: 2 } ), { shift: 1, rimPower: 0.1, rimMix: 1, outlineWidth: 0, outlineMix: 1 } );

} );
test( 'wrong types and bad values are refused in every spelling', () => {

	ok( ! mtoon( { toony: 'a lot' } ).ok );
	ok( ! mtoon( { rim: { color: 'red' } } ).ok );
	ok( ! mtoon( { rimColor: 'red' } ).ok );
	ok( ! mtoon( { outline: { width: NaN } } ).ok );
	ok( ! mtoon( { outline: { mode: 'sideways' } } ).ok );
	ok( /outline\.width/.test( mtoon( { outline: { width: 'wide' } } ).errors[ 0 ] ), 'the error names the path as written' );
	ok( /outlineWidth/.test( mtoon( { outlineWidth: 'wide' } ).errors[ 0 ] ) );
	ok( ! mtoon( [ 1 ] ).ok );
	ok( ! mtoon( 'toon' ).ok );

} );
test( 'bands: 2 is toony 1; other values and conflicts are refused', () => {

	eq( flatOf( { bands: 2 } ), { toony: 1 } );
	ok( ! mtoon( { bands: 3 } ).ok );
	ok( /no 3\+ band/.test( mtoon( { bands: 3 } ).errors[ 0 ] ) );
	ok( ! mtoon( { bands: 2, toony: 0.4 } ).ok );
	ok( mtoon( { bands: 2, toony: 1 } ).ok );

} );
test( 'look: "toon" is tolerated inside the spec; look: "native" points at unshader', () => {

	eq( flatOf( { look: 'toon', shift: 0.1 } ), { shift: 0.1 } );
	ok( /unshader/.test( mtoon( { look: 'native' } ).errors[ 0 ] ) );
	ok( ! mtoon( { look: 'cel' } ).ok );

} );
test( 'other shaders: typos get a suggestion, strangers do not', () => {

	ok( /did you mean "roughness"/.test( normalizeShaderParams( 'standard', { roughnes: 1 } ).errors[ 0 ] ) );
	ok( ! /did you mean/.test( normalizeShaderParams( 'standard', { glossy: 1 } ).errors[ 0 ] ) );
	ok( /Legal: roughness, metalness/.test( normalizeShaderParams( 'standard', { glossy: 1 } ).errors[ 0 ] ) );
	ok( /Legal: none/.test( normalizeShaderParams( 'basic', { x: 1 } ).errors[ 0 ] ) );
	ok( /unknown param "outline"/.test( normalizeShaderParams( 'fresnel', { outline: { width: 0 } } ).errors[ 0 ] ), 'nested spellings belong to mtoon only' );

} );
test( 'unknown shaders say so the same way everywhere', () => {

	ok( /did you mean "mtoon"/.test( unknownShaderMessage( 'mtoom' ) ) );
	ok( /did you mean "fresnel"/.test( unknownShaderMessage( 'fresnell' ) ) );
	ok( ! /did you mean/.test( unknownShaderMessage( 'zzzzzz' ) ) );
	ok( /Call shaders\(\)/.test( unknownShaderMessage( 42 ) ) );
	eq( normalizeShaderParams( 'mtoom', {} ).errors[ 0 ], unknownShaderMessage( 'mtoom' ) );

} );
test( 'didYouMean ignores case and separators and stays quiet when far', () => {

	eq( didYouMean( 'RIM_COLOR', [ 'shade', 'rimColor' ] ), 'rimColor' );
	eq( didYouMean( 'qqqqq', [ 'shade', 'rimColor' ] ), null );
	eq( didYouMean( '', [ 'shade' ] ), null );

} );
test( 'toon()\'s argument splits into a mode and the params', () => {

	eq( splitLookSpec(), { look: 'toon', params: {} } );
	eq( splitLookSpec( 'native' ), { look: 'native', params: {} } );
	eq( splitLookSpec( { shade: '#fff' } ), { look: 'toon', params: { shade: '#fff' } } );
	eq( splitLookSpec( { mode: 'native', shade: '#fff' } ), { look: 'native', params: { shade: '#fff' } } );
	let threw = false;
	try { splitLookSpec( { look: 'cel' } ); } catch ( e ) { threw = /"toon" or "native"/.test( e.message ); }
	ok( threw );
	threw = false;
	try { splitLookSpec( 42 ); } catch ( e ) { threw = /toon:/.test( e.message ); }
	ok( threw );

} );
test( 'shaders() lists the nested spelling', () => {

	eq( listShaders().find( s => s.id === 'mtoon' ).nested.rim.color, 'rimColor' );
	ok( listShaders().filter( s => s.id !== 'mtoon' ).every( s => s.nested === undefined ) );

} );

console.log( `\n${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
