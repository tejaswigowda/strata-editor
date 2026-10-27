// Run: node docs/editor/js/intelligence/__tests__/sceneLint.test.mjs
// The labelling gate: a scene that opts in is addressable only if every object has an author name
// (not a default, not a duplicate) and at least one author class.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { lintScene, assertLabelled, isDefaultName, hasAuthorClass } = await import( pathToFileURL( path.join( here, '..', 'sceneLint.js' ) ).href );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const node = ( name, classes, ...children ) => ( { name, type: 'Mesh', userData: classes ? { customClasses: classes } : {}, children } );
const scene = ( ...children ) => ( { name: '', type: 'Scene', userData: {}, children } );

test( 'default names are not author names', () => {

	for ( const n of [ '', '  ', '?', 'Mesh', 'mesh_3', 'Object3D', 'Group', 'Group 2', 'Box', 'Sphere_1', undefined, null ] ) assert.ok( isDefaultName( n ), String( n ) );
	for ( const n of [ 'crank', 'webA', 'gridX01', 'trail45_01', 'Room', 'KeyLight', 'ring45', 'Text' ] ) assert.ok( ! isDefaultName( n ), n );

} );

test( 'a fully named and classed scene is clean', () => {

	const s = scene( node( 'crank', [ 'part' ], node( 'web1', [ 'part', 'web' ] ), node( 'web2', [ 'part', 'web' ] ) ), node( 'rod', [ 'part' ] ) );
	assert.deepStrictEqual( lintScene( s ), [] );
	assertLabelled( s );

} );

test( 'unnamed objects are reported with their path', () => {

	const s = scene( node( 'frame', [ 'part' ], node( '', [ 'part' ] ), node( 'Mesh', [ 'part' ] ) ) );
	const v = lintScene( s );
	assert.strictEqual( v.length, 2 );
	assert.ok( v.every( x => x.reason === 'no author name' ) );
	assert.ok( v[ 0 ].path.startsWith( '/frame/' ) );

} );

test( 'a missing class is reported, and can be waived', () => {

	const s = scene( node( 'rod', null ) );
	assert.deepStrictEqual( lintScene( s ).map( v => v.reason ), [ 'no class' ] );
	assert.deepStrictEqual( lintScene( s, { requireClass: false } ), [] );
	assert.ok( ! hasAuthorClass( node( 'x', [] ) ) );
	assert.ok( hasAuthorClass( node( 'x', new Set( [ 'a' ] ) ) ) );

} );

test( 'duplicate names are reported, ignoring case', () => {

	const s = scene( node( 'rod', [ 'a' ] ), node( 'frame', [ 'a' ], node( 'Rod', [ 'a' ] ) ) );
	const v = lintScene( s );
	assert.strictEqual( v.length, 1 );
	assert.ok( v[ 0 ].reason.startsWith( 'duplicate name' ) );

} );

test( 'engine helpers (__name) are exempt, with their children', () => {

	const s = scene( node( 'label', [ 'text' ], node( '__textShadow', null, node( '', null ) ) ) );
	assert.deepStrictEqual( lintScene( s ), [] );

} );

test( 'assertLabelled throws one error that counts and lists the violations', () => {

	const s = scene( node( '', null ), node( 'a', null ), node( 'a', [ 'x' ] ) );
	assert.throws( () => assertLabelled( s ), e => /1 unnamed, 1 duplicate, 2 without a class/.test( e.message ) && /no author name/.test( e.message ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
