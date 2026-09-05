// Node test for argNormalize.js's canonicalizeColorOnlySetMaterial — the Part-1
// guard that collapses a color-only `setMaterial` (the dominant op-selection
// failure: the model invents a different malformed arg shape every time for what
// is really just "make it <color>") into `recolor`. A genuine multi-property
// setMaterial (roughness, metalness, map, ...) must NOT collapse. PURE, run with:
//   node docs/editor/js/intelligence/__tests__/argNormalize.test.mjs

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { extractColorOnlyArg, canonicalizeColorOnlySetMaterial } = await import( path.resolve( here, '..', 'argNormalize.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// ── Collapsing shapes (all observed model emissions) ───────────────────────────

test( 'flat {color} collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', selector: '.wheel', args: { color: '#111' } } );
	assert.deepStrictEqual( out, { op: 'recolor', selector: '.wheel', args: { color: '#111' } } );

} );

test( '{material:{color}} collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', args: { material: { color: 'gold' } } } );
	assert.strictEqual( out.op, 'recolor' );
	assert.deepStrictEqual( out.args, { color: 'gold' } );

} );

test( '{newMaterial:{color}} collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', args: { newMaterial: { color: 'red' } } } );
	assert.strictEqual( out.op, 'recolor' );
	assert.deepStrictEqual( out.args, { color: 'red' } );

} );

test( '{properties:{color}} collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', args: { properties: { color: 'blue' } } } );
	assert.strictEqual( out.op, 'recolor' );
	assert.deepStrictEqual( out.args, { color: 'blue' } );

} );

test( 'a string material-type TAG beside a nested color-only object still collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', args: { material: 'MeshStandardMaterial', properties: { color: '#ff0000' } } } );
	assert.strictEqual( out.op, 'recolor' );
	assert.deepStrictEqual( out.args, { color: '#ff0000' } );

} );

test( 'a string material-type TAG beside a flat color still collapses', () => {

	const out = canonicalizeColorOnlySetMaterial( { op: 'setMaterial', args: { type: 'MeshStandardMaterial', color: 'gray' } } );
	assert.strictEqual( out.op, 'recolor' );
	assert.deepStrictEqual( out.args, { color: 'gray' } );

} );

// ── Must NOT collapse: genuine multi-property setMaterial ──────────────────────

test( 'color + roughness/metalness does NOT collapse (genuine setMaterial)', () => {

	const opObj = { op: 'setMaterial', args: { newMaterial: { color: '#111', roughness: 0.4, metalness: 0.8 } } };
	const out = canonicalizeColorOnlySetMaterial( opObj );
	assert.strictEqual( out, opObj ); // same reference — untouched

} );

test( 'roughness-only (no color at all) does NOT collapse', () => {

	const opObj = { op: 'setMaterial', args: { roughness: 0.9 } };
	assert.strictEqual( canonicalizeColorOnlySetMaterial( opObj ), opObj );

} );

test( 'map/texture property does NOT collapse', () => {

	const opObj = { op: 'setMaterial', args: { material: { color: '#fff', map: 'metal.png' } } };
	assert.strictEqual( canonicalizeColorOnlySetMaterial( opObj ), opObj );

} );

// ── Non-setMaterial ops are untouched ────────────────────────────────────────

test( 'recolor op is a pure no-op (already the target shape)', () => {

	const opObj = { op: 'recolor', args: { color: 'black' } };
	assert.strictEqual( canonicalizeColorOnlySetMaterial( opObj ), opObj );

} );

test( 'scale/move/delete ops are untouched', () => {

	const s = { op: 'scale', args: { factor: 2 } };
	assert.strictEqual( canonicalizeColorOnlySetMaterial( s ), s );

} );

// ── extractColorOnlyArg edge cases ──────────────────────────────────────────────

test( 'extractColorOnlyArg returns null for missing/non-object args', () => {

	assert.strictEqual( extractColorOnlyArg( null ), null );
	assert.strictEqual( extractColorOnlyArg( undefined ), null );
	assert.strictEqual( extractColorOnlyArg( {} ), null );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail > 0 ) process.exit( 1 );
