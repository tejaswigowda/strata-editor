// Run: node docs/editor/js/intelligence/__tests__/subtitles.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const S = await import( path.join( here, '..', 'subtitles.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

console.log( 'subtitles' );

test( 'formats and parses times symmetrically', () => {

	for ( const t of [ 0, 1, 42.5, 59.999, 60, 156.5, 3599.001, 3661.25 ] ) assert.strictEqual( S.parseSrtTime( S.formatSrtTime( t ) ), t );
	assert.strictEqual( S.formatSrtTime( 59.9996 ), '00:01:00,000', 'rounding must carry into the next second, never print 1000 ms' );
	assert.strictEqual( S.formatSrtTime( 83.25 ), '00:01:23,250' );

} );

test( 'parses a standard srt, ignoring index lines and CRLF', () => {

	const cues = S.parseSrt( '1\r\n00:00:01,000 --> 00:00:03,500\r\nHello\r\nthere\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nBye\r\n' );
	assert.strictEqual( cues.length, 2 );
	assert.deepStrictEqual( [ cues[ 0 ].start, cues[ 0 ].end, cues[ 0 ].text ], [ 1, 3.5, 'Hello\nthere' ] );
	assert.ok( cues.every( c => typeof c.id === 'string' && c.id ) );

} );

test( 'accepts a BOM, dot separators and missing indices', () => {

	const cues = S.parseSrt( '\uFEFF00:00:01.5 --> 00:00:02.25\nHi' );
	assert.strictEqual( cues.length, 1 );
	assert.deepStrictEqual( [ cues[ 0 ].start, cues[ 0 ].end ], [ 1.5, 2.25 ] );

} );

test( 'round-trips text -> cues -> text', () => {

	const src = '1\n00:00:01,000 --> 00:00:03,500\nHello\nthere\n\n2\n00:00:04,000 --> 00:00:05,000\nBye\n';
	assert.strictEqual( S.cuesToSrt( S.parseSrt( src ) ), src );

} );

test( 'normalizeCues sorts, repairs, de-duplicates ids and never mutates', () => {

	const input = [ { id: 'a', start: 5, end: 4, text: 'late' }, { id: 'a', start: '1', end: 2, text: 7 }, null, { start: -3, end: 'x' } ];
	const snapshot = JSON.stringify( input );
	const out = S.normalizeCues( input );
	assert.strictEqual( JSON.stringify( input ), snapshot );
	assert.strictEqual( out.length, 3 );
	assert.deepStrictEqual( out.map( c => c.start ), [ 0, 1, 5 ] );
	assert.ok( out.every( c => c.end > c.start ), 'end is always after start' );
	assert.strictEqual( new Set( out.map( c => c.id ) ).size, 3, 'ids are unique' );
	assert.strictEqual( out.find( c => c.start === 1 ).text, '7' );

} );

test( 'cuesEqual ignores ids and order, sees real changes', () => {

	const a = [ { id: '1', start: 1, end: 2, text: 'x' }, { id: '2', start: 3, end: 4, text: 'y' } ];
	const b = [ { id: 'q', start: 3, end: 4, text: 'y' }, { id: 'r', start: 1, end: 2, text: 'x' } ];
	assert.ok( S.cuesEqual( a, b ) );
	assert.ok( ! S.cuesEqual( a, [ ...b, { start: 9, end: 10, text: 'z' } ] ) );
	assert.ok( ! S.cuesEqual( a, [ { start: 1, end: 2, text: 'x' }, { start: 3, end: 4, text: 'changed' } ] ) );

} );

test( 'activeCueAt is start-inclusive, end-exclusive', () => {

	const cues = [ { start: 1, end: 2, text: 'a' }, { start: 2, end: 3, text: 'b' } ];
	assert.strictEqual( S.activeCueAt( cues, 0.99 ), null );
	assert.strictEqual( S.activeCueAt( cues, 1 ).text, 'a' );
	assert.strictEqual( S.activeCueAt( cues, 2 ).text, 'b' );
	assert.strictEqual( S.activeCueAt( cues, 3 ), null );

} );

test( 'the film subtitle file shipped for the cafe timeline parses clean', () => {

	const file = path.join( os.homedir(), 'Downloads', 'cafe-timeline.srt' );
	if ( ! fs.existsSync( file ) ) return; // only present on the author's machine
	const cues = S.parseSrt( fs.readFileSync( file, 'utf8' ) );
	assert.strictEqual( cues.length, 21 );
	assert.ok( cues.every( ( c, i ) => i === 0 || c.start >= cues[ i - 1 ].end ), 'no overlaps' );
	assert.ok( cues[ cues.length - 1 ].end <= 156.5 );

} );

console.log( `\n# pass ${ pass }\n# fail ${ fail }` );
if ( fail ) process.exit( 1 );
