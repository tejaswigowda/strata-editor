// Node test for numericArgs (pure).   node docs/editor/js/intelligence/__tests__/opArgs.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { numericArgs } = await import( path.join( here, '..', 'opArgs.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

test( 'finite numbers pass through', () => {

	const r = numericArgs( { dx: [ 5, 0 ], dy: [ - 2.5, 0 ] } );
	assert.deepStrictEqual( r, { ok: true, values: { dx: 5, dy: - 2.5 } } );

} );

test( 'omitted (undefined / null) falls back to the default', () => {

	const r = numericArgs( { dx: [ 4, 0 ], dy: [ undefined, 0 ], dz: [ null, 0 ] } );
	assert.deepStrictEqual( r.values, { dx: 4, dy: 0, dz: 0 } );

} );

test( 'numeric strings are accepted', () => {

	assert.strictEqual( numericArgs( { dx: [ '3', 0 ] } ).values.dx, 3 );

} );

test( 'non-numeric input is rejected, never NaN', () => {

	for ( const bad of [ 'far', NaN, Infinity, - Infinity, {}, [], true, '' ] ) {

		const r = numericArgs( { dx: [ bad, 0 ] } );
		assert.strictEqual( r.ok, false, String( bad ) );
		assert.match( r.message, /dx must be a finite number/ );

	}

} );

test( 'a required argument (fallback undefined) must be given', () => {

	const r = numericArgs( { factor: [ undefined, undefined ] } );
	assert.strictEqual( r.ok, false );
	assert.match( r.message, /factor is required/ );

} );

test( 'one bad argument rejects the whole call', () => {

	assert.strictEqual( numericArgs( { dx: [ 1, 0 ], dy: [ 'x', 0 ], dz: [ 2, 0 ] } ).ok, false );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
