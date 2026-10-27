// Run: node docs/editor/js/export/__tests__/audio.test.mjs
// The narration track's pure parts: WAV reading, AAC frame segmentation aligned to the video (no padding, no drift), the audio group in
// the master playlist, and (with a real ffmpeg) that ffmpeg decodes what is written, at the right length, with no warnings.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWav, toStereo, planAudioSegments, packageAudio, audioPlaylist, audioMediaSegment, audioInitSegment, AUDIO, lagOf } from '../audio.js';
import { masterPlaylist, packageRendition } from '../fmp4.js';
import { assemblePublishSet } from '../publishSet.js';
import { validateRenderJson } from '../renderJson.js';

let pass = 0, fail = 0, skipped = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

function boxes( buf, start = 0, end = buf.length ) {

	const out = [], v = new DataView( buf.buffer, buf.byteOffset, buf.byteLength );
	for ( let at = start; at + 8 <= end; ) { const size = v.getUint32( at ); out.push( { type: String.fromCharCode( ...buf.subarray( at + 4, at + 8 ) ), start: at, size, body: at + 8, end: at + size } ); at += size; }
	return out;

}
const child = ( buf, b, type ) => boxes( buf, b.body, b.end ).find( c => c.type === type );

function wav( samples, { rate = 24000, channels = 1, bits = 16 } = {} ) {

	const bytes = bits / 8, data = Buffer.alloc( samples.length * bytes * channels );
	samples.forEach( ( x, i ) => { for ( let c = 0; c < channels; c ++ ) data.writeInt16LE( Math.round( x * 32767 ), ( i * channels + c ) * 2 ); } );
	const h = Buffer.alloc( 44 );
	h.write( 'RIFF', 0 ); h.writeUInt32LE( 36 + data.length, 4 ); h.write( 'WAVEfmt ', 8 ); h.writeUInt32LE( 16, 16 ); h.writeUInt16LE( 1, 20 ); h.writeUInt16LE( channels, 22 );
	h.writeUInt32LE( rate, 24 ); h.writeUInt32LE( rate * channels * bytes, 28 ); h.writeUInt16LE( channels * bytes, 32 ); h.writeUInt16LE( bits, 34 ); h.write( 'data', 36 ); h.writeUInt32LE( data.length, 40 );
	return new Uint8Array( Buffer.concat( [ h, data ] ) );

}

await test( 'a WAV is read: rate, channels and samples', () => {

	const w = parseWav( wav( [ 0, 0.5, -0.5, 1 ], { rate: 24000 } ) );
	assert.strictEqual( w.sampleRate, 24000 );
	assert.strictEqual( w.channels.length, 1 );
	assert.deepStrictEqual( Array.from( w.channels[ 0 ] ).map( x => Math.round( x * 100 ) / 100 ), [ 0, 0.5, -0.5, 1 ] );
	assert.strictEqual( parseWav( wav( [ 0.25, 0.25 ], { channels: 2 } ) ).channels.length, 2 );
	assert.throws( () => parseWav( new Uint8Array( 20 ) ), /RIFF/ );

} );

await test( 'toStereo makes mono two-eared, and pads or cuts to exactly the length', () => {

	const { left, right } = toStereo( [ Float32Array.of( 1, 2, 3 ) ], 5 );
	assert.deepStrictEqual( Array.from( left ), [ 1, 2, 3, 0, 0 ] );
	assert.deepStrictEqual( Array.from( right ), [ 1, 2, 3, 0, 0 ] );
	assert.strictEqual( toStereo( [ Float32Array.of( 1, 2, 3, 4 ) ], 2 ).left.length, 2 );

} );

await test( 'audio segments start at the first whole AAC frame at or after the video segment start, and never pad', () => {

	// 80.7 s: 14 video segments of 6 s, the last 2.7 s
	const starts = Array.from( { length: 14 }, ( _, i ) => i * 6 );
	const total = Math.ceil( 80.7 * 48000 / 1024 );
	const plan = planAudioSegments( total, starts );
	assert.strictEqual( plan.length, 14 );
	assert.strictEqual( plan[ 0 ].first, 0 );
	assert.strictEqual( plan[ 1 ].first, Math.ceil( 6 * 48000 / 1024 ), '281.25 -> 282' );
	assert.strictEqual( plan[ 1 ].first, 282 );
	plan.forEach( ( p, i ) => { assert.ok( p.first * 1024 / 48000 >= starts[ i ] - 1e-9 && p.first * 1024 / 48000 < starts[ i ] + 1024 / 48000, `segment ${ i } starts within one AAC frame after its video start` ); } );
	assert.strictEqual( plan.reduce( ( n, p ) => n + p.count, 0 ), total, 'every frame exactly once: nothing padded, nothing dropped' );
	// drift: the start of the last audio segment is within one AAC frame (21 ms) of the video's, however long the film
	const longStarts = Array.from( { length: 200 }, ( _, i ) => i * 6 );
	const longPlan = planAudioSegments( Math.ceil( 1200 * 48000 / 1024 ), longStarts );
	assert.ok( longPlan[ 199 ].first * 1024 / 48000 - 1194 < 1024 / 48000, 'no accumulation over 20 minutes' );

} );

await test( 'the audio init has an mp4a sample entry with an esds, and a segment\'s data_offset lands on its first frame', () => {

	const asc = Uint8Array.of( 0x11, 0x90 );
	const init = audioInitSegment( { asc } );
	assert.deepStrictEqual( boxes( init ).map( b => b.type ), [ 'ftyp', 'moov' ] );
	const text = Buffer.from( init ).toString( 'latin1' );
	assert.ok( text.includes( 'mp4a' ) && text.includes( 'esds' ) && text.includes( 'soun' ) );
	const frames = [ Uint8Array.of( 1, 2, 3 ), Uint8Array.of( 4, 5 ), Uint8Array.of( 6 ) ];
	const seg = audioMediaSegment( { sequence: 2, firstFrame: 282, frames } );
	const top = boxes( seg ), v = new DataView( seg.buffer, seg.byteOffset, seg.byteLength );
	assert.deepStrictEqual( top.map( b => b.type ), [ 'styp', 'moof', 'mdat' ] );
	const traf = child( seg, top[ 1 ], 'traf' ), tfdt = child( seg, traf, 'tfdt' ), trun = child( seg, traf, 'trun' );
	assert.strictEqual( v.getUint32( tfdt.body + 8 ), 282 * 1024, 'base decode time = first frame * 1024 ticks' );
	assert.strictEqual( top[ 1 ].start + v.getUint32( trun.body + 8 ), top[ 2 ].body );
	assert.strictEqual( v.getUint32( trun.body + 12 ), 3 );
	assert.throws( () => audioInitSegment( { asc: null } ), /AudioSpecificConfig/ );

} );

await test( 'the master playlist carries the audio group and every CODECS lists mp4a.40.2', () => {

	const text = masterPlaylist( [
		{ name: '1080p60', width: 1920, height: 1080, playlist: '1080p60/index.m3u8', codec: 'avc1.640034', bandwidth: 4000000, averageBandwidth: 3500000 },
		{ name: '720p60', width: 1280, height: 720, playlist: '720p60/index.m3u8', codec: 'avc1.64002a', bandwidth: 2000000, averageBandwidth: 1800000 } ], 60,
	{ groupId: 'aud', name: 'English', language: 'en', uri: 'audio/index.m3u8', codec: 'mp4a.40.2', bandwidth: 140000, averageBandwidth: 128000 } );
	assert.match( text, /#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="audio\/index\.m3u8"/ );
	const infs = text.split( '\n' ).filter( l => l.startsWith( '#EXT-X-STREAM-INF' ) );
	assert.strictEqual( infs.length, 2 );
	for ( const l of infs ) assert.ok( /CODECS="avc1\.[0-9a-f]{6},mp4a\.40\.2"/.test( l ) && l.includes( 'AUDIO="aud"' ), l );
	assert.ok( infs[ 0 ].includes( 'BANDWIDTH=4140000' ), 'audio bandwidth is added' );
	// without audio nothing changes
	assert.ok( ! masterPlaylist( [ { name: 'a', width: 2, height: 2, playlist: 'a/i.m3u8', codec: 'avc1.64001f', bandwidth: 1, averageBandwidth: 1 } ], 30 ).includes( 'AUDIO' ) );

} );

await test( 'the audio playlist: exact frame durations, init map, VOD', () => {

	const t = audioPlaylist( [ { name: 'seg00001.m4s', frames: 282 }, { name: 'seg00002.m4s', frames: 281 } ] );
	assert.match( t, /#EXTINF:6\.016000,\nseg00001\.m4s/ );
	assert.match( t, /#EXTINF:5\.994667,\nseg00002\.m4s/ );
	assert.match( t, /#EXT-X-MAP:URI="init\.mp4"/ );
	assert.ok( t.includes( '#EXT-X-ENDLIST' ) );

} );

await test( 'lagOf finds a delayed copy of a burst', () => {

	const src = new Float32Array( 12000 ), y = new Float32Array( 12000 + 3000 );
	let s = 3; for ( let i = 0; i < 8000; i ++ ) { s = ( s * 1664525 + 1013904223 ) >>> 0; src[ i ] = s / 4294967296 - 0.5; }
	y.set( src, 2112 );
	assert.strictEqual( lagOf( src, y ), 2112 );

} );

await test( 'the publish set holds audio/ files, an audio group in master.m3u8, outputs.audio and the check', () => {

	const frames = Array.from( { length: 1000 }, ( _, i ) => Uint8Array.from( { length: 40 + ( i % 5 ) }, ( __, j ) => ( i + j ) & 255 ) );
	const audio = packageAudio( { frames, asc: Uint8Array.of( 0x11, 0x90 ), videoStartsSeconds: [ 0, 6, 12 ] } );
	assert.deepStrictEqual( audio.segments.map( s => s.first ), [ 0, 282, 563 ] );
	const samples = Array.from( { length: 400 }, ( _, i ) => Uint8Array.from( { length: 10 }, ( __, j ) => ( i + j ) & 255 ) );
	const avcC = Uint8Array.from( [ 1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80 ] );
	const packaged = packageRendition( { width: 320, height: 180, fps: 30, avcC, samples, keyframes: Array.from( { length: 14 }, ( _, i ) => i * 30 ) } );
	const set = assemblePublishSet( {
		path: 'renders/x', scene: { repo: 'a/b', file: 'x.json', branch: 'main', commit: 'abcdef1', hash: 'sha256:' + 'ab'.repeat( 32 ) },
		render: { mode: 'offline', renderer: 'WebGLRenderer', device: 'webgl2', encoder: 'software', fps: 30, frames: 400, frameRange: [ 0, 399 ], width: 320, height: 180, renderedAt: '2026-10-26T19:40:00Z' },
		rungs: [ { rung: { name: '180p30', width: 320, height: 180, kbps: 300 }, packaged } ], poster: Uint8Array.of( 1 ), captions: 'WEBVTT\n',
		audio: { packaged: audio, name: 'English', language: 'en', source: { path: 'audio/x.wav', sha256: 'sha256:' + 'cd'.repeat( 32 ) }, delaySamples: 2112 },
		determinism: { mode: 'offline', encoder: 'software' },
	} );
	const paths = set.files.map( f => f.path );
	for ( const p of [ 'audio/init.mp4', 'audio/seg00001.m4s', 'audio/seg00003.m4s', 'audio/index.m3u8' ] ) assert.ok( paths.includes( 'renders/x/' + p ), p );
	const master = new TextDecoder().decode( set.files.find( f => f.path.endsWith( 'master.m3u8' ) ).bytes );
	assert.match( master, /#EXT-X-MEDIA:TYPE=AUDIO/ );
	assert.match( master, /CODECS="avc1\.64001f,mp4a\.40\.2",AUDIO="aud"/ );
	assert.strictEqual( set.renderJson.outputs.audio.codec, 'mp4a.40.2' );
	assert.strictEqual( set.renderJson.outputs.audio.source.path, 'audio/x.wav' );
	assert.strictEqual( set.renderJson.checks.audio_duration_matches_video, false, 'a 1000-frame audio track is 21 s, not the 13.3 s video: the check says so' );
	assert.deepStrictEqual( validateRenderJson( set.renderJson ), [] );

} );

// with a real ffmpeg: real AAC frames, packaged and decoded
const ff = spawnSync( 'ffmpeg', [ '-version' ] );
if ( ff.status !== 0 ) { console.log( '  - ffmpeg not installed: the real-decoder check is skipped' ); skipped ++; } else {

	await test( 'ffmpeg decodes the packaged audio at the right length; the segments are whole AAC frames; packaging is deterministic', () => {

		const dir = mkdtempSync( path.join( tmpdir(), 'audio-' ) );
		const src = path.join( dir, 'a.m4a' );
		const make = spawnSync( 'ffmpeg', [ '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=14', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', src ] );
		assert.strictEqual( make.status, 0, String( make.stderr ) );
		// read the raw AAC frames and the AudioSpecificConfig out of the m4a
		const buf = new Uint8Array( readFileSync( src ) ), v = new DataView( buf.buffer, buf.byteOffset, buf.byteLength );
		const moov = boxes( buf ).find( b => b.type === 'moov' );
		const stbl = child( buf, child( buf, child( buf, child( buf, moov, 'trak' ), 'mdia' ), 'minf' ), 'stbl' );
		const stsz = child( buf, stbl, 'stsz' ), n = v.getUint32( stsz.body + 8 );
		const sizes = Array.from( { length: n }, ( _, i ) => v.getUint32( stsz.body + 12 + i * 4 ) );
		const stco = child( buf, stbl, 'stco' ), stsc = child( buf, stbl, 'stsc' );
		const offs = Array.from( { length: v.getUint32( stco.body + 4 ) }, ( _, i ) => v.getUint32( stco.body + 8 + i * 4 ) );
		const runs = Array.from( { length: v.getUint32( stsc.body + 4 ) }, ( _, i ) => ( { first: v.getUint32( stsc.body + 8 + i * 12 ), per: v.getUint32( stsc.body + 12 + i * 12 ) } ) );
		const frames = []; let k = 0;
		offs.forEach( ( off, c ) => { const run = [ ...runs ].reverse().find( r => r.first <= c + 1 ); let at = off; for ( let j = 0; j < run.per && k < n; j ++, k ++ ) { frames.push( buf.slice( at, at + sizes[ k ] ) ); at += sizes[ k ]; } } );
		// the AudioSpecificConfig: descriptor 5 inside the esds (descriptor lengths are 1-4 bytes of 7 bits each)
		const at = Buffer.from( buf ).indexOf( 'esds' ) + 8;
		const desc = ( p ) => { const tag = buf[ p ]; let len = 0, q = p + 1; for ( let i = 0; i < 4; i ++ ) { const b = buf[ q ++ ]; len = ( len << 7 ) | ( b & 127 ); if ( ! ( b & 128 ) ) break; } return { tag, len, body: q }; };
		const d3 = desc( at ), d4 = desc( d3.body + 3 ), d5 = desc( d4.body + 13 );
		assert.strictEqual( [ d3.tag, d4.tag, d5.tag ].join(), '3,4,5' );
		const asc = Buffer.from( buf.subarray( d5.body, d5.body + d5.len ) );
		assert.ok( frames.length > 600 );

		const starts = [ 0, 6, 12 ];
		const a = packageAudio( { frames, asc: new Uint8Array( asc ), videoStartsSeconds: starts } );
		const b = packageAudio( { frames, asc: new Uint8Array( asc ), videoStartsSeconds: starts } );
		a.segments.forEach( ( s, i ) => assert.deepStrictEqual( s.data, b.segments[ i ].data ) );
		assert.deepStrictEqual( a.segments.map( s => s.first ), [ 0, 282, 563 ] );
		const out = path.join( dir, 'audio' ); mkdirSync( out );
		writeFileSync( path.join( out, 'init.mp4' ), a.init );
		for ( const s of a.segments ) writeFileSync( path.join( out, s.name ), s.data );
		writeFileSync( path.join( out, 'index.m3u8' ), a.playlist );
		const probe = spawnSync( 'ffprobe', [ '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels', '-show_entries', 'format=duration', '-of', 'json', path.join( out, 'index.m3u8' ) ] );
		assert.strictEqual( probe.status, 0, 'ffprobe: ' + String( probe.stderr ) + String( probe.stdout ) + ' in ' + out );
		const j = JSON.parse( String( probe.stdout ) );
		assert.deepStrictEqual( [ j.streams[ 0 ].codec_name, j.streams[ 0 ].sample_rate, j.streams[ 0 ].channels ], [ 'aac', '48000', 2 ] );
		assert.ok( Math.abs( Number( j.format.duration ) - frames.length * 1024 / 48000 ) < 0.001, `duration ${ j.format.duration } vs ${ frames.length * 1024 / 48000 }` );
		const dec = spawnSync( 'ffmpeg', [ '-v', 'warning', '-i', path.join( out, 'index.m3u8' ), '-f', 'null', '-' ] );
		assert.strictEqual( String( dec.stderr ).trim(), '', 'no warnings: ' + dec.stderr );

	} );

}

console.log( `\n${ pass } passed, ${ fail } failed${ skipped ? `, ${ skipped } skipped` : '' }` );
process.exit( fail ? 1 : 0 );
