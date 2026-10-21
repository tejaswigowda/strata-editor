// Run: node docs/editor/js/shaders/__tests__/shaderDocs.test.mjs
// The guides' parameter tables and the shell's help() text are generated from the registry
// (shaderSpec.js). These checks fail when a guide is stale: run `node scripts/gen-shader-docs.mjs`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SHADERS, getShaderDef } from '../shaderSpec.js';
import { DOC_FILES, rewriteDocs, renderSection, helpTopic, helpTopics, helpMissing, helpIndex } from '../shaderDocs.js';

let passed = 0, failed = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const eq = ( a, b, m ) => { if ( JSON.stringify( a ) !== JSON.stringify( b ) ) throw new Error( ( m || 'not equal' ) + `: ${ JSON.stringify( a ) } vs ${ JSON.stringify( b ) }` ); };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };

const root = join( dirname( fileURLToPath( import.meta.url ) ), '../../../../..' );

console.log( 'guides' );

for ( const [ file, names ] of Object.entries( DOC_FILES ) ) {

	test( `${ file } tables are up to date with the registry`, () => {

		const text = readFileSync( join( root, file ), 'utf8' );
		ok( rewriteDocs( text, names ) === text, 'stale: run node scripts/gen-shader-docs.mjs' );

	} );

}

test( 'rewriting is idempotent and replaces only what is between the markers', () => {

	const text = 'before\n<!-- shader-docs:mtoon:start -->\nold\n<!-- shader-docs:mtoon:end -->\nafter\n';
	const once = rewriteDocs( text, [ 'mtoon' ] );
	ok( once.startsWith( 'before\n' ) && once.endsWith( '\nafter\n' ) && ! once.includes( 'old' ) );
	eq( rewriteDocs( once, [ 'mtoon' ] ), once );

} );
test( 'a guide without the markers is an error, not a silent skip', () => {

	let threw = false;
	try { rewriteDocs( 'no markers', [ 'mtoon' ] ); } catch ( e ) { threw = /markers/.test( e.message ); }
	ok( threw );

} );
test( 'the tables name every shader, param, alias and nested spelling', () => {

	const builtin = renderSection( 'builtin' );
	const mtoon = renderSection( 'mtoon' );
	for ( const s of SHADERS ) {

		ok( builtin.includes( '`' + s.id + '`' ), s.id );
		for ( const p of s.params ) ok( builtin.includes( '`' + p.key + '`' ), s.id + '.' + p.key );

	}
	const def = getShaderDef( 'mtoon' );
	for ( const p of def.params ) ok( mtoon.includes( '`' + p.key + '`' ), p.key );
	for ( const [ g, keys ] of Object.entries( def.nested ) ) for ( const k of Object.keys( keys ) ) ok( mtoon.includes( '`' + g + '.' + k + '`' ), g + '.' + k );

} );

console.log( 'help()' );

test( 'every verb and every shader has a topic', () => {

	for ( const t of [ 'shader', 'mtoon', 'toon', 'toonMaterial', 'unshader', 'shaders' ] ) ok( helpTopic( t ), t );
	for ( const s of SHADERS ) ok( helpTopic( s.id ), s.id );
	ok( helpTopic( 'toon' ) && helpTopic( 'vrm' ), 'aliases resolve too' );
	eq( helpTopics().length, 6 + SHADERS.length );

} );
test( 'help("mtoon") lists every flat key and nested path from the registry', () => {

	const text = helpTopic( 'mtoon' ).join( '\n' );
	const def = getShaderDef( 'mtoon' );
	for ( const p of def.params ) ok( text.includes( p.key ), p.key );
	for ( const [ g, keys ] of Object.entries( def.nested ) ) for ( const k of Object.keys( keys ) ) ok( text.includes( g + '.' + k ), g + '.' + k );
	ok( /flat:.*nested:/.test( text ) );
	ok( /\{ id, params, meshes, materials \}/.test( text ) );

} );
test( 'help("shader") lists every shader id by group', () => {

	const text = helpTopic( 'shader' ).join( '\n' );
	for ( const s of SHADERS ) ok( text.includes( s.id ), s.id );
	ok( /Unknown keys throw/.test( text ) );

} );
test( 'help for one shader shows its params and defaults', () => {

	const text = helpTopic( 'fresnel' ).join( '\n' );
	ok( /power/.test( text ) && /intensity/.test( text ) && /#4fd2ff/.test( text ) );
	ok( /\(no parameters\)/.test( helpTopic( 'lambert' ).join( '\n' ) ) );

} );
test( 'an unknown topic says so and suggests the near one', () => {

	eq( helpTopic( 'nope' ), null );
	ok( /did you mean "mtoon"/.test( helpMissing( 'mtoom' ) ) );
	ok( /help\(\) lists/.test( helpMissing( 'zzzz' ) ) );

} );
test( 'help() with no argument introduces the shader verbs', () => {

	const text = helpIndex().join( '\n' );
	for ( const v of [ 'shader(', 'mtoon(', 'toon(', 'unshader(', 'shaders()' ] ) ok( text.includes( v ), v );

} );

console.log( `\n${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
