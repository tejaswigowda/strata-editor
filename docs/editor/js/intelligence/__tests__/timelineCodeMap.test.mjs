// Run: node docs/editor/js/intelligence/__tests__/timelineCodeMap.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { eventLineMap } = await import( path.join( here, '..', 'timelineCodeMap.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// the same assembly refreshCode() does: blocks joined by one blank line
const chain = ( sel, n ) => `$S('${ sel }')` + Array.from( { length: n }, ( _, i ) => `\n  .at(${ i }).animate({ x: ${ i } }, 100)` ).join( '' ) + ';';
const lineOf = ( text, line ) => text.split( '\n' )[ line - 1 ];

test( 'a single-event track is on the selector line', () => {

	const blocks = [ `$S('#a').at(1).animate({ x: 1 }, 100);` ];
	const m = eventLineMap( blocks, [ { block: 0, ids: [ 'e1' ] } ] );
	assert.strictEqual( m.get( 'e1' ), 1 );

} );

test( 'a chained track puts each event on its own line, after the selector', () => {

	const blocks = [ chain( '#a', 3 ) ];
	const m = eventLineMap( blocks, [ { block: 0, ids: [ 'e0', 'e1', 'e2' ] } ] );
	assert.deepStrictEqual( [ m.get( 'e0' ), m.get( 'e1' ), m.get( 'e2' ) ], [ 2, 3, 4 ] );
	const text = blocks.join( '\n\n' );
	assert.ok( lineOf( text, m.get( 'e1' ) ).includes( '.at(1)' ), lineOf( text, m.get( 'e1' ) ) );

} );

test( 'blocks before a track (warnings, multi-line imports) and the blank separators are counted', () => {

	const blocks = [ '// WARNING: something', 'line one\nline two\nline three', chain( '#a', 2 ), `$S('#b').at(5).fadeIn(200);` ];
	const text = blocks.join( '\n\n' );
	const m = eventLineMap( blocks, [ { block: 2, ids: [ 'a0', 'a1' ] }, { block: 3, ids: [ 'b0' ] } ] );
	assert.ok( lineOf( text, m.get( 'a0' ) ).includes( '.at(0)' ) );
	assert.ok( lineOf( text, m.get( 'a1' ) ).includes( '.at(1)' ) );
	assert.ok( lineOf( text, m.get( 'b0' ) ).startsWith( "$S('#b')" ) );

} );

test( 'a track whose block index is unknown is skipped', () => {

	const m = eventLineMap( [ 'x' ], [ { block: 4, ids: [ 'gone' ] } ] );
	assert.strictEqual( m.size, 0 );

} );

test( 'hundreds of baked camera keys keep their order', () => {

	const n = 195, blocks = [ chain( '#cam', n ) ];
	const m = eventLineMap( blocks, [ { block: 0, ids: Array.from( { length: n }, ( _, i ) => 'k' + i ) } ] );
	assert.strictEqual( m.get( 'k0' ), 2 );
	assert.strictEqual( m.get( 'k194' ), 196 );

} );

console.log( `${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
