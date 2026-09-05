// Node test for opResolve.js's classifyOpVerb — the deterministic verb→op mapping
// (host-assist for op-selection, same class as selector host-assist). PURE, run
// with: node docs/editor/js/intelligence/__tests__/opResolve.test.mjs

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { classifyOpVerb } = await import( path.resolve( here, '..', 'opResolve.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// ── Confident single-verb matches (mirrors EDIT_TASK_CASES phrasing) ──────────

test( '"make the wheels black" → recolor, confident', () => {

	const r = classifyOpVerb( 'make the wheels black' );
	assert.strictEqual( r.op, 'recolor' );
	assert.strictEqual( r.confident, true );

} );

test( '"paint the grille gold" → recolor, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'paint the grille gold' ).op, 'recolor' );

} );

test( '"darken the wheels and rims" → recolor, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'darken the wheels and rims' ).op, 'recolor' );

} );

test( '"make it bigger" → scale, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'make it bigger' ).op, 'scale' );

} );

test( '"spin the wheels slowly" → rotate (closed-set enum, spin has no schema slot), confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'spin the wheels slowly' ).op, 'rotate' );

} );

test( '"lift the cab up a bit" → move, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'lift the cab up a bit' ).op, 'move' );

} );

test( '"remove the front wheels" → delete, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'remove the front wheels' ).op, 'delete' );

} );

test( '"duplicate the cab" → duplicate, confident', () => {

	assert.deepStrictEqual( classifyOpVerb( 'duplicate the cab' ).op, 'duplicate' );

} );

// ── Safe fallback: ambiguous / no match → model chooses ────────────────────────

test( 'two distinct verbs in one phrase → ambiguous, not confident', () => {

	const r = classifyOpVerb( 'spin the wheels and make the bed grey' );
	assert.strictEqual( r.op, null );
	assert.strictEqual( r.confident, false );

} );

test( 'no recognizable verb → no-match, not confident', () => {

	const r = classifyOpVerb( 'fix the front so it looks right' );
	assert.strictEqual( r.op, null );
	assert.strictEqual( r.confident, false );

} );

test( 'empty/undefined input never throws', () => {

	assert.strictEqual( classifyOpVerb( '' ).confident, false );
	assert.strictEqual( classifyOpVerb( undefined ).confident, false );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail > 0 ) process.exit( 1 );
