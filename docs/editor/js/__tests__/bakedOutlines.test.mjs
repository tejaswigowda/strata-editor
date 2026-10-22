// Node tests for baked glTF outline hulls. Run with:
//   node docs/editor/js/__tests__/bakedOutlines.test.mjs

import assert from 'node:assert';
import { isBakedOutlineHull, settleBakedOutline, settleBakedOutlines } from '../toon/bakedOutlines.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const mat = ( over = {} ) => ( { name: 'outline', side: 0, transparent: false, depthWrite: true, needsUpdate: false, ...over } );
const mesh = ( over = {} ) => ( { isMesh: true, name: 'Object674_outline_0', renderOrder: 0, material: mat(), ...over } );

test( 'a front-sided, opaque outline mesh is a baked hull', () => {

	assert.ok( isBakedOutlineHull( mesh() ) );
	assert.ok( isBakedOutlineHull( mesh( { name: 'Object1' } ) ), 'matched by its material name' );

} );

test( 'other meshes are not', () => {

	assert.ok( ! isBakedOutlineHull( mesh( { name: 'lantern', material: mat( { name: 'metalmat' } ) } ) ) );
	assert.ok( ! isBakedOutlineHull( mesh( { material: mat( { side: 1 } ) } ) ), 'back-sided hulls are the toon look\'s own' );
	assert.ok( ! isBakedOutlineHull( mesh( { material: mat( { isOutline: true } ) } ) ) );
	assert.ok( ! isBakedOutlineHull( mesh( { material: mat( { transparent: true } ) } ) ) );
	assert.ok( ! isBakedOutlineHull( { isMesh: false, name: 'outline' } ) );
	assert.ok( ! isBakedOutlineHull( null ) );

} );

test( 'settling draws the hull first and stops it writing depth', () => {

	const m = mesh();
	assert.strictEqual( settleBakedOutline( m ), true );
	assert.strictEqual( m.material.depthWrite, false );
	assert.strictEqual( m.material.needsUpdate, true );
	assert.strictEqual( m.renderOrder, - 1 );

} );

test( 'settling twice changes nothing the second time, and keeps a render order set on purpose', () => {

	const m = mesh();
	settleBakedOutline( m );
	assert.strictEqual( settleBakedOutline( m ), false );
	const custom = mesh( { renderOrder: 5 } );
	settleBakedOutline( custom );
	assert.strictEqual( custom.renderOrder, 5 );

} );

test( 'a mesh with several outline materials settles all of them', () => {

	const a = mat(), b = mat();
	const m = mesh( { material: [ a, b ] } );
	settleBakedOutline( m );
	assert.ok( ! a.depthWrite && ! b.depthWrite );

} );

test( 'settleBakedOutlines walks a tree and counts what it changed', () => {

	const hull = mesh(), other = mesh( { name: 'post', material: mat( { name: 'metalmat' } ) } );
	const root = { traverse( fn ) { fn( this ); fn( hull ); fn( other ); } };
	assert.strictEqual( settleBakedOutlines( root ), 1 );
	assert.strictEqual( other.material.depthWrite, true );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
