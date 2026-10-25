// Node test for cloneSharedResources (pure; no three.js needed).
//   node docs/editor/js/__tests__/cloneShared.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { cloneSharedResources } = await import( path.join( here, '..', 'scene', 'cloneShared.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const resource = ( name ) => ( { name, clone() { return resource( name ); } } );
const mesh = ( geometry, material ) => ( { geometry, material, children: [], traverse( fn ) { fn( this ); } } );
const group = ( ...children ) => ( { children, traverse( fn ) { fn( this ); children.forEach( ( c ) => c.traverse( fn ) ); } } );

test( 'a material shared by many meshes is cloned once and still shared', () => {

	const m = resource( 'M_Paint' ), g = resource( 'box' );
	const meshes = [ mesh( g, m ), mesh( g, m ), mesh( g, m ) ];
	const counts = cloneSharedResources( group( ...meshes ) );
	assert.deepStrictEqual( counts, { geometries: 1, materials: 1 } );
	assert.strictEqual( meshes[ 0 ].material, meshes[ 2 ].material );
	assert.strictEqual( meshes[ 0 ].geometry, meshes[ 1 ].geometry );

} );

test( 'the clone is independent of the source (never the same object)', () => {

	const m = resource( 'M_Sea' ), g = resource( 'plane' );
	const mm = mesh( g, m );
	cloneSharedResources( group( mm ) );
	assert.notStrictEqual( mm.material, m );
	assert.notStrictEqual( mm.geometry, g );
	assert.strictEqual( mm.material.name, 'M_Sea' );

} );

test( 'distinct resources stay distinct', () => {

	const a = mesh( resource( 'g1' ), resource( 'A' ) ), b = mesh( resource( 'g2' ), resource( 'B' ) );
	const counts = cloneSharedResources( group( a, b ) );
	assert.deepStrictEqual( counts, { geometries: 2, materials: 2 } );
	assert.notStrictEqual( a.material, b.material );

} );

test( 'multi-material meshes are cloned per slot, sharing across meshes', () => {

	const a = resource( 'A' ), b = resource( 'B' ), g = resource( 'g' );
	const m1 = mesh( g, [ a, b ] ), m2 = mesh( g, [ b, a ] );
	const counts = cloneSharedResources( group( m1, m2 ) );
	assert.strictEqual( counts.materials, 2 );
	assert.strictEqual( m1.material[ 0 ], m2.material[ 1 ] );
	assert.strictEqual( m1.material[ 1 ], m2.material[ 0 ] );

} );

test( 'nodes without geometry or material are left alone', () => {

	const g = group( group() );
	assert.deepStrictEqual( cloneSharedResources( g ), { geometries: 0, materials: 0 } );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
