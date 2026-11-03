// Run: node docs/player/__tests__/download.test.mjs
// The player's download: playlists parsed, a video run merged with a separate audio run into one fragmented MP4 (tracks renumbered, fragments interleaved in time
// and numbered, no sample touched), and what it refuses.
import assert from 'node:assert';
import { initSegment, mediaSegment } from '../../editor/js/export/fmp4.js';
import { readBoxes, readInit, mergeInits, mergeFmp4, readFragments, parseMediaPlaylist, parseMaster, audioFor, estimateBytes, formatBytes, downloadName } from '../download.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

// ── a video run from Strata's own writer, and an audio run built by hand with the same box structure ─────────────────────

const AVCC = Uint8Array.from( [ 1, 0x64, 0x00, 0x2a, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x2a, 1, 0, 1, 0x68 ] );
const u32 = n => Uint8Array.from( [ n >>> 24, ( n >>> 16 ) & 255, ( n >>> 8 ) & 255, n & 255 ] );
const cat = parts => { const o = new Uint8Array( parts.reduce( ( n, p ) => n + p.length, 0 ) ); let at = 0; for ( const p of parts ) { o.set( p, at ); at += p.length; } return o; };
const box = ( type, ...kids ) => { const body = cat( kids ); return cat( [ u32( 8 + body.length ), new TextEncoder().encode( type ), body ] ); };
const full = ( type, v, flags, ...kids ) => box( type, Uint8Array.from( [ v, flags >> 16, ( flags >> 8 ) & 255, flags & 255 ] ), ...kids );
const zeros = n => new Uint8Array( n );

function videoRun( segments = 3, fps = 30, framesPer = 4 ) {

	const init = initSegment( { width: 64, height: 36, fps, avcC: AVCC } );
	const segs = [];
	for ( let s = 0; s < segments; s ++ ) segs.push( mediaSegment( { sequence: s + 1, firstFrame: s * framesPer, samples: Array.from( { length: framesPer }, ( _, i ) => ( { data: Uint8Array.from( [ 0, 0, 0, 2, 0x65, s * 16 + i ] ), key: i === 0 } ) ) } ) );
	return { init, segments: segs };

}

/** An AAC-like run: track id 1 as well (a different file's track 1), timescale 48000, 1024-sample frames, `perSeg` frames a segment. */
function audioRun( segments = 3, perSeg = 94, trackId = 1 ) {

	const mvhd = full( 'mvhd', 0, 0, u32( 0 ), u32( 0 ), u32( 48000 ), u32( 0 ), u32( 0x10000 ), Uint8Array.from( [ 1, 0 ] ), zeros( 10 ), zeros( 36 ), zeros( 24 ), u32( trackId + 1 ) );
	const tkhd = full( 'tkhd', 0, 3, u32( 0 ), u32( 0 ), u32( trackId ), u32( 0 ), u32( 0 ), zeros( 8 ), zeros( 8 ), zeros( 36 ), u32( 0 ), u32( 0 ) );
	const mdhd = full( 'mdhd', 0, 0, u32( 0 ), u32( 0 ), u32( 48000 ), u32( 0 ), Uint8Array.from( [ 0x55, 0xc4, 0, 0 ] ) );
	const trak = box( 'trak', tkhd, box( 'mdia', mdhd, full( 'hdlr', 0, 0, u32( 0 ), new TextEncoder().encode( 'soun' ), zeros( 12 ), new TextEncoder().encode( 'SoundHandler\0' ) ) ) );
	const mvex = box( 'mvex', full( 'trex', 0, 0, u32( trackId ), u32( 1 ), u32( 1024 ), u32( 0 ), u32( 0 ) ) );
	const init = cat( [ box( 'ftyp', new TextEncoder().encode( 'iso6' ), u32( 0 ), new TextEncoder().encode( 'iso6' ) ), box( 'moov', mvhd, trak, mvex ) ] );
	const segs = [];
	for ( let s = 0; s < segments; s ++ ) {

		const data = Uint8Array.from( { length: perSeg * 3 }, ( _, i ) => ( s * 7 + i ) & 255 );
		const build = off => box( 'moof', full( 'mfhd', 0, 0, u32( s + 1 ) ), box( 'traf', full( 'tfhd', 0, 0x020000, u32( trackId ) ), full( 'tfdt', 1, 0, u32( 0 ), u32( s * perSeg * 1024 ) ), full( 'trun', 0, 0x000301, u32( perSeg ), u32( off ), cat( Array.from( { length: perSeg }, () => cat( [ u32( 1024 ), u32( 3 ) ] ) ) ) ) ) );
		const size = build( 0 ).length;
		segs.push( cat( [ box( 'styp', new TextEncoder().encode( 'msdh' ), u32( 0 ), new TextEncoder().encode( 'msdh' ) ), build( size + 8 ), box( 'mdat', data ) ] ) );

	}
	return { init, segments: segs };

}

const tfhdIds = bytes => readFragments( bytes ).flatMap( f => { const moof = readBoxes( f.bytes, 0, f.moofSize )[ 0 ]; return readBoxes( f.bytes, moof.start + 8, moof.end ).filter( x => x.type === 'traf' ).map( t => { const h = readBoxes( f.bytes, t.start + 8, t.end ).find( x => x.type === 'tfhd' ); return ( ( f.bytes[ h.start + 12 ] << 24 ) | ( f.bytes[ h.start + 13 ] << 16 ) | ( f.bytes[ h.start + 14 ] << 8 ) | f.bytes[ h.start + 15 ] ) >>> 0; } ); } );
const seqs = bytes => readBoxes( bytes ).filter( x => x.type === 'moof' ).map( m => { const mf = readBoxes( bytes, m.start + 8, m.end ).find( x => x.type === 'mfhd' ); return ( ( bytes[ mf.start + 12 ] << 24 ) | ( bytes[ mf.start + 13 ] << 16 ) | ( bytes[ mf.start + 14 ] << 8 ) | bytes[ mf.start + 15 ] ) >>> 0; } );

await test( 'two inits become one: both tracks, the audio renumbered after the video, a trex each, the next track id past them', () => {

	const v = videoRun(), a = audioRun();
	const m = mergeInits( v.init, a.init ), r = readInit( m.bytes );
	assert.deepStrictEqual( r.traks.map( t => [ t.id, t.timescale ] ), [ [ 1, 30000 ], [ 2, 48000 ] ] );
	assert.deepStrictEqual( [ ...m.ids ], [ [ 1, 2 ] ] );
	assert.strictEqual( r.trexes.length, 2 );
	const trexIds = r.trexes.map( t => ( ( m.bytes[ t.start + 12 ] << 24 ) | ( m.bytes[ t.start + 13 ] << 16 ) | ( m.bytes[ t.start + 14 ] << 8 ) | m.bytes[ t.start + 15 ] ) >>> 0 );
	assert.deepStrictEqual( trexIds, [ 1, 2 ] );
	const nextId = ( ( m.bytes[ r.mvhd.start + 104 ] << 24 ) | ( m.bytes[ r.mvhd.start + 105 ] << 16 ) | ( m.bytes[ r.mvhd.start + 106 ] << 8 ) | m.bytes[ r.mvhd.start + 107 ] ) >>> 0;
	assert.strictEqual( nextId, 3 );
	assert.deepStrictEqual( readBoxes( m.bytes ).map( x => x.type ), [ 'ftyp', 'moov' ] );

} );

await test( 'the merged file interleaves the fragments by time, numbers them in that order, and gives the audio its own track id', () => {

	const v = videoRun( 3 ), a = audioRun( 3 );
	const out = mergeFmp4( v, a ), bytes = cat( out.parts );
	assert.strictEqual( out.fragments, 6 ); assert.deepStrictEqual( out.tracks, [ 1, 2 ] );
	assert.deepStrictEqual( seqs( cat( out.parts.slice( 1 ) ) ), [ 1, 2, 3, 4, 5, 6 ] );
	// video fragments start at 0, 4/30 = 0.133 and 0.267 s; audio at 0, 94*1024/48000 = 2.005 s and 4.01 s: so the order is v0 a0 v1 v2 a1 a2
	assert.deepStrictEqual( tfhdIds( cat( out.parts.slice( 1 ) ) ), [ 1, 2, 1, 1, 2, 2 ] );
	assert.strictEqual( out.bytes, bytes.length );
	assert.ok( ! readBoxes( bytes ).some( x => x.type === 'styp' ), 'the styp boxes are dropped' );

} );

await test( 'no sample is touched: every mdat comes through byte for byte, and the inputs are not changed', () => {

	const v = videoRun( 2 ), a = audioRun( 2 );
	const before = [ v.init, ...v.segments, a.init, ...a.segments ].map( x => x.slice() );
	const out = mergeFmp4( v, a );
	const mdats = bytes => readBoxes( bytes ).filter( x => x.type === 'mdat' ).map( x => Array.from( bytes.subarray( x.start, x.end ) ).join( ',' ) );
	const want = [ ...v.segments, ...a.segments ].flatMap( mdats ).sort(), got = mdats( cat( out.parts ) ).sort();
	assert.deepStrictEqual( got, want );
	[ v.init, ...v.segments, a.init, ...a.segments ].forEach( ( x, i ) => assert.deepStrictEqual( x, before[ i ] ) );

} );

await test( 'a trun data offset still points at its own mdat after the rewrite', () => {

	const out = mergeFmp4( videoRun( 2 ), audioRun( 2 ) );
	for ( const part of out.parts.slice( 1 ) ) {

		const top = readBoxes( part ), moof = top[ 0 ], mdat = top[ 1 ];
		const traf = readBoxes( part, moof.start + 8, moof.end ).find( x => x.type === 'traf' ), trun = readBoxes( part, traf.start + 8, traf.end ).find( x => x.type === 'trun' );
		const off = ( ( part[ trun.start + 16 ] << 24 ) | ( part[ trun.start + 17 ] << 16 ) | ( part[ trun.start + 18 ] << 8 ) | part[ trun.start + 19 ] ) >>> 0;
		assert.strictEqual( moof.start + off, mdat.start + 8, 'default-base-is-moof: the first sample is right after the mdat header' );

	}

} );

await test( 'a silent render is the video alone, still one clean file', () => {

	const out = mergeFmp4( videoRun( 3 ) );
	assert.strictEqual( out.fragments, 3 ); assert.deepStrictEqual( out.tracks, [ 1 ] );
	assert.deepStrictEqual( seqs( cat( out.parts.slice( 1 ) ) ), [ 1, 2, 3 ] );
	assert.deepStrictEqual( readBoxes( cat( out.parts ) ).map( x => x.type ).slice( 0, 2 ), [ 'ftyp', 'moov' ] );

} );

await test( 'it refuses what it cannot move rightly: an absolute base offset, a fragment with no time', () => {

	const v = videoRun( 1 ), seg = v.segments[ 0 ].slice(), moof = readBoxes( seg ).find( x => x.type === 'moof' );
	const traf = readBoxes( seg, moof.start + 8, moof.end ).find( x => x.type === 'traf' ), tfhd = readBoxes( seg, traf.start + 8, traf.end ).find( x => x.type === 'tfhd' );
	const abs = seg.slice(); abs[ tfhd.start + 11 ] |= 1;
	assert.throws( () => mergeFmp4( { init: v.init, segments: [ abs ] } ), /absolute base data offset/ );
	const tfdt = readBoxes( seg, traf.start + 8, traf.end ).find( x => x.type === 'tfdt' ), noTime = seg.slice(); noTime.set( new TextEncoder().encode( 'free' ), tfdt.start + 4 );
	assert.throws( () => mergeFmp4( { init: v.init, segments: [ noTime ] } ), /no tfdt/ );
	assert.throws( () => readBoxes( Uint8Array.from( [ 0, 0, 1, 0, 0x6d, 0x6f, 0x6f, 0x76 ] ) ), /does not fit/ );

} );

await test( 'playlists: the media playlist\'s init, segments and length; the master\'s rungs best first, and the audio a rung is played with', () => {

	const media = parseMediaPlaylist( '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.016000,\nseg00001.m4s\n#EXTINF:5.994667,\nseg00002.m4s\n#EXT-X-ENDLIST\n' );
	assert.strictEqual( media.init, 'init.mp4' ); assert.deepStrictEqual( media.segments.map( s => s.uri ), [ 'seg00001.m4s', 'seg00002.m4s' ] ); assert.ok( Math.abs( media.duration - 12.010667 ) < 1e-6 );
	const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,LANGUAGE="en",URI="audio/index.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en/index.m3u8"\n'
		+ '#EXT-X-STREAM-INF:BANDWIDTH=1054536,AVERAGE-BANDWIDTH=928192,RESOLUTION=854x480,FRAME-RATE=60.000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"\n480p60/index.m3u8\n'
		+ '#EXT-X-STREAM-INF:BANDWIDTH=3665276,AVERAGE-BANDWIDTH=3364051,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"\n1080p60/index.m3u8\n';
	const m = parseMaster( text );
	assert.deepStrictEqual( m.renditions.map( r => [ r.name, r.height, r.audioGroup ] ), [ [ '1080p60', 1080, 'aud' ], [ '480p60', 480, 'aud' ] ] );
	assert.strictEqual( audioFor( m, m.renditions[ 0 ] ).uri, 'audio/index.m3u8' ); assert.strictEqual( m.subtitles.length, 1 );
	const silent = parseMaster( '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480,CODECS="avc1.64001f"\n480p60/index.m3u8\n' );
	assert.strictEqual( audioFor( silent, silent.renditions[ 0 ] ), null, 'no audio group: the render is silent' );

} );

await test( 'size estimate, its wording, and file names that a file system accepts', () => {

	assert.strictEqual( estimateBytes( { average: 3364051, bandwidth: 3665276 }, 152 ), Math.round( 3364051 * 152 / 8 ) );
	assert.strictEqual( estimateBytes( { average: 0, bandwidth: 800000 }, 10 ), 1000000 ); assert.strictEqual( estimateBytes( { average: 0, bandwidth: 0 }, 10 ), null ); assert.strictEqual( estimateBytes( { average: 1 }, 0 ), null );
	assert.deepStrictEqual( [ 4200, 63915000, 1.4e9, 2.5e8, null ].map( formatBytes ), [ '4 kB', '63.9 MB', '1.4 GB', '250 MB', '' ] );
	assert.strictEqual( downloadName( 'a+b-cubed', '1080p60', 'mp4' ), 'a+b-cubed-1080p60.mp4' );
	assert.strictEqual( downloadName( 'My film: part 1/2', null, 'vtt' ), 'My-film-part-1-2.vtt' );
	assert.strictEqual( downloadName( '', '', 'json' ), 'render.json' );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
