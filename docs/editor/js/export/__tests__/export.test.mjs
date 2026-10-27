// Run: node docs/editor/js/export/__tests__/export.test.mjs
// The offline renderer's pure parts: the frame schedule (the one clock) and the MP4 muxer (exact CFR).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
	totalFrames, frameTimestampUs, resolveRange, frameTimes, avcCodecCandidates, contractLine, formatEstimate, DETERMINISM_COPY,
} from '../frames.js';
import { Mp4Muxer } from '../Mp4Muxer.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

// ── frames ────────────────────────────────────────────────────────────────────

test( 'frame n sits at exactly n / fps microseconds', () => {

	assert.strictEqual( frameTimestampUs( 0, 60 ), 0 );
	assert.strictEqual( frameTimestampUs( 60, 60 ), 1_000_000 );
	assert.strictEqual( frameTimestampUs( 7718, 60 ), Math.round( 7718 * 1e6 / 60 ) );
	assert.strictEqual( frameTimestampUs( 1, 30 ), 33333 );

} );

test( 'the render length gives the same frame count at any resolution', () => {

	// the bug this work order fixes: frame count must depend on length and fps only
	assert.strictEqual( totalFrames( 128.7, 60 ), totalFrames( 128.7, 60 ) );
	assert.strictEqual( totalFrames( 128.7, 60 ), 7722 );
	assert.strictEqual( totalFrames( 0.001, 60 ), 1 );

} );

test( 'frame times come from the frame number alone', () => {

	const a = frameTimes( 1000, 60, 2, 50 ), b = frameTimes( 1000, 60, 2, 50 );
	assert.deepStrictEqual( a, b );
	assert.strictEqual( a.outT, 1000 / 60 );
	assert.strictEqual( a.t, 2 + 1000 / 60 );

} );

test( 'content time holds at the end; shot time keeps running so a final cut finishes', () => {

	const x = frameTimes( 60 * 60, 60, 0, 50 ); // 60 s output, timeline is 50 s
	assert.strictEqual( x.t, 50 );
	assert.strictEqual( x.shotT, 60 );

} );

test( 'ranges: defaults, inclusive bounds, and errors', () => {

	assert.deepStrictEqual( resolveRange( '', '', 100 ), { start: 0, end: 99, count: 100 } );
	assert.deepStrictEqual( resolveRange( '30', '40', 100 ), { start: 30, end: 40, count: 11 } );
	assert.ok( resolveRange( '5', '2', 100 ).error );
	assert.ok( resolveRange( '0', '100', 100 ).error );
	assert.ok( resolveRange( '-1', '', 100 ).error );
	assert.ok( resolveRange( 'x', '', 100 ).error );

} );

test( 'H.264 levels: 1080p60 needs 4.2, 720p30 fits 3.1, 4K needs 5.1 or more', () => {

	assert.strictEqual( avcCodecCandidates( 1920, 1080, 60 )[ 0 ], 'avc1.64002a' );
	assert.strictEqual( avcCodecCandidates( 1280, 720, 30 )[ 0 ], 'avc1.64001f' );
	assert.strictEqual( avcCodecCandidates( 3840, 2160, 30 )[ 0 ], 'avc1.640033' );

} );

test( 'the contract line states frames, an estimate when known, and the exact rate', () => {

	assert.strictEqual( contractLine( 7719, 60, 0 ), '7,719 frames \u00b7 exact 60.000 fps' );
	assert.strictEqual( contractLine( 7719, 60, 46 ), '7,719 frames \u00b7 ~6 min \u00b7 exact 60.000 fps' );
	assert.strictEqual( formatEstimate( 40 ), '40 s' );

} );

test( 'the determinism statement separates temporal, same-device and cross-device', () => {

	assert.ok( /exact/.test( DETERMINISM_COPY.temporal ) );
	assert.ok( /same device/.test( DETERMINISM_COPY.sameDevice ) );
	assert.ok( /not all/.test( DETERMINISM_COPY.sameDevice ) && /crossfade/.test( DETERMINISM_COPY.sameDevice ) );
	assert.ok( /not promised/.test( DETERMINISM_COPY.crossDevice ) );

} );

test( 'E0: guides/TIME_SOURCES.md quotes the UI copy word for word', () => {

	const doc = readFileSync( new URL( '../../../../../guides/TIME_SOURCES.md', import.meta.url ), 'utf8' );
	for ( const key of [ 'temporal', 'sameDevice', 'crossDevice', 'offline', 'preview' ] ) assert.ok( doc.includes( DETERMINISM_COPY[ key ] ), key + ' is not in TIME_SOURCES.md verbatim' );

} );

// ── muxer ─────────────────────────────────────────────────────────────────────

const u32at = ( b, o ) => ( ( b[ o ] << 24 ) | ( b[ o + 1 ] << 16 ) | ( b[ o + 2 ] << 8 ) | b[ o + 3 ] ) >>> 0;

function boxesIn( bytes, start = 0, end = bytes.length ) {

	const out = [];
	for ( let o = start; o < end; ) {

		const size = u32at( bytes, o );
		out.push( { type: String.fromCharCode( ...bytes.subarray( o + 4, o + 8 ) ), start: o, size, body: o + 8 } );
		o += size;

	}

	return out;

}

function find( bytes, path ) {

	let range = [ 0, bytes.length ], hit = null;
	for ( const type of path ) {

		hit = boxesIn( bytes, range[ 0 ], range[ 1 ] ).find( b => b.type === type );
		assert.ok( hit, 'missing box ' + type );
		const skip = { stsd: 8, dref: 8 }[ type ] || 0;
		range = [ hit.body + skip, hit.start + hit.size ];

	}

	return hit;

}

function build( n, { fps = 60, width = 64, height = 48, keyEvery = 30 } = {} ) {

	const m = new Mp4Muxer( { width, height, fps } );
	for ( let k = 0; k < n; k ++ ) {

		m.addChunk( new Uint8Array( [ 1, 2, 3, k & 255 ] ), {
			key: k % keyEvery === 0, timestampUs: Math.round( k * 1e6 / fps ), description: k === 0 ? new Uint8Array( [ 1, 100, 0, 42 ] ) : undefined,
		} );

	}

	const parts = m.finish();
	let size = 0;
	for ( const p of parts ) size += p.length;
	const bytes = new Uint8Array( size );
	let at = 0;
	for ( const p of parts ) { bytes.set( p, at ); at += p.length; }
	return bytes;

}

test( 'a file is ftyp, moov, mdat in that order', () => {

	const bytes = build( 10 );
	assert.deepStrictEqual( boxesIn( bytes ).map( b => b.type ), [ 'ftyp', 'moov', 'mdat' ] );

} );

test( 'constant frame rate: one stts entry, delta 1000 on a timescale of fps * 1000', () => {

	for ( const fps of [ 24, 30, 60 ] ) {

		const bytes = build( 100, { fps } );
		const stts = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stts' ] );
		assert.strictEqual( u32at( bytes, stts.body + 4 ), 1, 'one entry' );
		assert.strictEqual( u32at( bytes, stts.body + 8 ), 100, 'count' );
		assert.strictEqual( u32at( bytes, stts.body + 12 ), 1000, 'delta' );
		const mdhd = find( bytes, [ 'moov', 'trak', 'mdia', 'mdhd' ] );
		assert.strictEqual( u32at( bytes, mdhd.body + 12 ), fps * 1000, 'timescale' );
		assert.strictEqual( u32at( bytes, mdhd.body + 16 ), 100 * 1000, 'duration = frames * delta' );

	}

} );

test( 'frame count and duration are exact: duration = frames / fps', () => {

	const bytes = build( 7719, { fps: 60 } );
	const mdhd = find( bytes, [ 'moov', 'trak', 'mdia', 'mdhd' ] );
	const seconds = u32at( bytes, mdhd.body + 16 ) / u32at( bytes, mdhd.body + 12 );
	assert.strictEqual( seconds, 7719 / 60 );
	const stsz = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz' ] );
	assert.strictEqual( u32at( bytes, stsz.body + 8 ), 7719 );

} );

test( 'every sample offset points at that sample\u2019s bytes', () => {

	const bytes = build( 50 );
	const stco = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stco' ] );
	const stsz = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz' ] );
	let offset = u32at( bytes, stco.body + 8 );
	for ( let k = 0; k < 50; k ++ ) {

		const size = u32at( bytes, stsz.body + 12 + k * 4 );
		assert.deepStrictEqual( [ ...bytes.subarray( offset, offset + size ) ], [ 1, 2, 3, k & 255 ], 'sample ' + k );
		offset += size;

	}

	const mdat = find( bytes, [ 'mdat' ] );
	assert.strictEqual( offset, mdat.start + mdat.size, 'samples fill mdat exactly' );

} );

test( 'an extra box after ftyp (360 metadata) leaves every sample offset right', () => {

	const m = new Mp4Muxer( { width: 64, height: 48, fps: 30 } );
	for ( let k = 0; k < 20; k ++ ) m.addChunk( new Uint8Array( [ 9, 8, 7, k ] ), { key: k === 0, timestampUs: Math.round( k * 1e6 / 30 ), description: k === 0 ? new Uint8Array( 4 ) : undefined } );
	const extra = new Uint8Array( [ 0, 0, 0, 12, 0x75, 0x75, 0x69, 0x64, 1, 2, 3, 4 ] ); // a 12-byte 'uuid' box
	const parts = m.finish( [ extra ] );
	let size = 0;
	for ( const p of parts ) size += p.length;
	const bytes = new Uint8Array( size );
	let at = 0;
	for ( const p of parts ) { bytes.set( p, at ); at += p.length; }
	assert.deepStrictEqual( boxesIn( bytes ).map( b => b.type ), [ 'ftyp', 'uuid', 'moov', 'mdat' ] );
	const stco = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stco' ] );
	const first = u32at( bytes, stco.body + 8 );
	assert.deepStrictEqual( [ ...bytes.subarray( first, first + 4 ) ], [ 9, 8, 7, 0 ] );

} );

test( 'keyframes are listed in stss, 1-based', () => {

	const bytes = build( 70, { keyEvery: 30 } );
	const stss = find( bytes, [ 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stss' ] );
	assert.strictEqual( u32at( bytes, stss.body + 4 ), 3 );
	assert.deepStrictEqual( [ 0, 1, 2 ].map( i => u32at( bytes, stss.body + 8 + i * 4 ) ), [ 1, 31, 61 ] );

} );

test( 'a dropped frame is refused, not written', () => {

	const m = new Mp4Muxer( { width: 64, height: 48, fps: 60 } );
	m.addChunk( new Uint8Array( 4 ), { key: true, timestampUs: 0, description: new Uint8Array( 4 ) } );
	m.addChunk( new Uint8Array( 4 ), { key: false, timestampUs: 16667 } );
	assert.throws( () => m.addChunk( new Uint8Array( 4 ), { key: false, timestampUs: 50000 } ), /dropped, repeated or reordered/ );

} );

test( 'a repeated or reordered frame is refused', () => {

	const m = new Mp4Muxer( { width: 64, height: 48, fps: 60 } );
	m.addChunk( new Uint8Array( 4 ), { key: true, timestampUs: 0, description: new Uint8Array( 4 ) } );
	assert.throws( () => m.addChunk( new Uint8Array( 4 ), { key: false, timestampUs: 0 } ), /expected/ );

} );

test( 'a range render starts at any timestamp and still counts exact frames', () => {

	const m = new Mp4Muxer( { width: 64, height: 48, fps: 60 } );
	for ( let n = 1000; n <= 1100; n ++ ) m.addChunk( new Uint8Array( 4 ), { key: n === 1000, timestampUs: Math.round( n * 1e6 / 60 ), description: n === 1000 ? new Uint8Array( 4 ) : undefined } );
	assert.strictEqual( m.frameCount, 101 );

} );

test( 'the same chunks give the same bytes (no wall clock in the file)', () => {

	assert.deepStrictEqual( build( 40 ), build( 40 ) );

} );

test( 'odd dimensions and fractional fps are refused up front', () => {

	assert.throws( () => new Mp4Muxer( { width: 63, height: 48, fps: 60 } ), /even/ );
	assert.throws( () => new Mp4Muxer( { width: 64, height: 48, fps: 59.94 } ), /whole number/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
