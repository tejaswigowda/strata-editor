// Node test for promoteClassesForExport (pure; no three.js needed).
//   node docs/editor/js/__tests__/exportClasses.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { promoteClassesForExport } = await import( path.join( here, '..', 'scene', 'exportClasses.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// minimal Object3D stand-in: traverse() visits self then children
const node = ( userData, children = [] ) => ( {
	userData,
	children,
	traverse( fn ) { fn( this ); this.children.forEach( ( c ) => c.traverse( fn ) ); },
} );

test( 'custom classes become an Array in userData.classes', () => {

	const n = node( { customClasses: [ 'pickup', 'trigger' ] } );
	assert.strictEqual( promoteClassesForExport( n ), 1 );
	assert.deepStrictEqual( n.userData.classes, [ 'pickup', 'trigger' ] );

} );

test( 'replaces the editor\'s auto-derived (non-array) classes object', () => {

	const n = node( { customClasses: [ 'road' ], classes: new Set( [ 'flat' ] ) } );
	promoteClassesForExport( n );
	assert.ok( Array.isArray( n.userData.classes ) );
	assert.deepStrictEqual( n.userData.classes, [ 'road' ] );

} );

test( 'walks children; nodes without custom classes are left alone', () => {

	const plain = node( { classes: {} } );
	const child = node( { customClasses: [ 'tree' ] } );
	const root = node( {}, [ plain, child ] );
	assert.strictEqual( promoteClassesForExport( root ), 1 );
	assert.deepStrictEqual( plain.userData.classes, {} );
	assert.deepStrictEqual( child.userData.classes, [ 'tree' ] );

} );

test( 'dedupes, drops blanks and non-strings, accepts a Set', () => {

	const n = node( { customClasses: new Set( [ 'a', 'a', '', '  ', 3, 'b' ] ) } );
	promoteClassesForExport( n );
	assert.deepStrictEqual( n.userData.classes, [ 'a', 'b' ] );
	const m = node( { customClasses: [ 'x', 'x' ] } );
	promoteClassesForExport( m );
	assert.deepStrictEqual( m.userData.classes, [ 'x' ] );

} );

test( 'empty custom classes write nothing', () => {

	const n = node( { customClasses: [] } );
	assert.strictEqual( promoteClassesForExport( n ), 0 );
	assert.strictEqual( n.userData.classes, undefined );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
