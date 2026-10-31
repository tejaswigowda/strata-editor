// Run: node docs/editor/js/export/__tests__/publish.test.mjs
// The publish set's pure parts: fMP4 segments and HLS playlists (checked against a real ffmpeg when one is installed),
// the canonical scene hash, render.json and its validator, the captions, the ladder and the size gates.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import {
	initSegment, mediaSegment, planSegments, mediaPlaylist, masterPlaylist, packageRendition, segmentName, codecFromAvcC,
} from '../fmp4.js';
import { canonicalText, canonicalScene, sceneHash } from '../canonical.js';
import {
	buildRenderJson, validateRenderJson, assessDeterminism, encoderRecord, TIME_SOURCE_AUDIT, LIMITS, formatBytes,
} from '../renderJson.js';
import { parseWav, toStereo, planAudioSegments, packageAudio, audioPlaylist, audioMediaSegment, audioInitSegment, AUDIO } from '../audio.js';
import { cueTrack, parseVtt } from '../captions.js';
import { planLadder, vttTime, defaultPublishPath, assemblePublishSet, sizeReport, stalenessLine } from '../publishSet.js';

const here = path.dirname( fileURLToPath( import.meta.url ) );
let pass = 0, fail = 0, skipped = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

// ── a tiny ISO-BMFF reader, to check what we write ────────────────────────────

function boxes( buf, start = 0, end = buf.length ) {

	const out = [];
	const v = new DataView( buf.buffer, buf.byteOffset, buf.byteLength );
	for ( let at = start; at + 8 <= end; ) {

		let size = v.getUint32( at );
		const type = String.fromCharCode( ...buf.subarray( at + 4, at + 8 ) );
		if ( size === 0 ) size = end - at;
		out.push( { type, start: at, size, body: at + 8, end: at + size } );
		at += size;

	}
	return out;

}
const child = ( buf, b, type ) => boxes( buf, b.body, b.end ).find( c => c.type === type );
const kids = ( buf, b, type ) => boxes( buf, b.body, b.end ).filter( c => c.type === type );

// Samples out of a real MP4: [ { data, key } ], avcC, width, height
function readMp4( buf ) {

	const v = new DataView( buf.buffer, buf.byteOffset, buf.byteLength );
	const moov = boxes( buf ).find( b => b.type === 'moov' );
	const trak = child( buf, moov, 'trak' ), mdia = child( buf, trak, 'mdia' ), minf = child( buf, mdia, 'minf' ), stbl = child( buf, minf, 'stbl' );
	const stsd = child( buf, stbl, 'stsd' );
	const avc1 = boxes( buf, stsd.body + 8, stsd.end )[ 0 ];
	const avcCBox = boxes( buf, avc1.body + 78, avc1.end ).find( b => b.type === 'avcC' );
	const avcC = buf.slice( avcCBox.body, avcCBox.end );
	const width = v.getUint16( avc1.body + 24 ), height = v.getUint16( avc1.body + 26 );
	const stsz = child( buf, stbl, 'stsz' ), n = v.getUint32( stsz.body + 8 ), fixed = v.getUint32( stsz.body + 4 );
	const sizes = Array.from( { length: n }, ( _, i ) => fixed || v.getUint32( stsz.body + 12 + i * 4 ) );
	const stco = child( buf, stbl, 'stco' ), co64 = child( buf, stbl, 'co64' );
	const offsets = stco ? Array.from( { length: v.getUint32( stco.body + 4 ) }, ( _, i ) => v.getUint32( stco.body + 8 + i * 4 ) )
		: Array.from( { length: v.getUint32( co64.body + 4 ) }, ( _, i ) => Number( v.getBigUint64( co64.body + 8 + i * 8 ) ) );
	const stsc = child( buf, stbl, 'stsc' );
	const runs = Array.from( { length: v.getUint32( stsc.body + 4 ) }, ( _, i ) => ( { first: v.getUint32( stsc.body + 8 + i * 12 ), per: v.getUint32( stsc.body + 12 + i * 12 ) } ) );
	const stss = child( buf, stbl, 'stss' );
	const keys = new Set( stss ? Array.from( { length: v.getUint32( stss.body + 4 ) }, ( _, i ) => v.getUint32( stss.body + 8 + i * 4 ) - 1 ) : [] );
	const samples = [];
	let k = 0;
	offsets.forEach( ( off, c ) => {

		const run = [ ...runs ].reverse().find( r => r.first <= c + 1 );
		let at = off;
		for ( let j = 0; j < run.per && k < n; j ++, k ++ ) { samples.push( { data: buf.slice( at, at + sizes[ k ] ), key: keys.has( k ) } ); at += sizes[ k ]; }

	} );
	return { samples, avcC, width, height };

}

// ── fmp4 ──────────────────────────────────────────────────────────────────────

const avcC = Uint8Array.from( [ 1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80 ] );
const fakeSamples = ( n, keyEvery ) => Array.from( { length: n }, ( _, i ) => ( { data: Uint8Array.from( { length: 10 + ( i % 7 ) }, ( __, j ) => ( i + j ) & 255 ), key: i % keyEvery === 0 } ) );

await test( 'the codec string comes from the avcC record', () => {

	assert.strictEqual( codecFromAvcC( avcC ), 'avc1.64001f' );
	assert.throws( () => codecFromAvcC( new Uint8Array( 2 ) ) );

} );

await test( 'the init segment is ftyp + moov with an empty sample table and an mvex', () => {

	const init = initSegment( { width: 1920, height: 1080, fps: 60, avcC } );
	const top = boxes( init );
	assert.deepStrictEqual( top.map( b => b.type ), [ 'ftyp', 'moov' ] );
	const moov = top[ 1 ];
	assert.ok( child( init, moov, 'mvex' ), 'mvex' );
	const stbl = child( init, child( init, child( init, child( init, moov, 'trak' ), 'mdia' ), 'minf' ), 'stbl' );
	assert.deepStrictEqual( boxes( init, stbl.body, stbl.end ).map( b => b.type ), [ 'stsd', 'stts', 'stsc', 'stsz', 'stco' ] );
	assert.throws( () => initSegment( { width: 1919, height: 1080, fps: 60, avcC } ), /even/ );
	assert.throws( () => initSegment( { width: 1920, height: 1080, fps: 29.97, avcC } ), /whole number/ );

} );

await test( 'a media segment is styp + moof + mdat, and its data_offset lands on the first sample', () => {

	const samples = fakeSamples( 12, 6 );
	const seg = mediaSegment( { sequence: 3, firstFrame: 360, samples } );
	const top = boxes( seg );
	assert.deepStrictEqual( top.map( b => b.type ), [ 'styp', 'moof', 'mdat' ] );
	const moof = top[ 1 ], mdat = top[ 2 ];
	const v = new DataView( seg.buffer, seg.byteOffset, seg.byteLength );
	const traf = child( seg, moof, 'traf' );
	const tfdt = child( seg, traf, 'tfdt' );
	assert.strictEqual( v.getUint32( tfdt.body + 4 ), 0 );
	assert.strictEqual( v.getUint32( tfdt.body + 8 ), 360 * 1000, 'base decode time is firstFrame * 1000 ticks' );
	assert.strictEqual( v.getUint32( child( seg, moof, 'mfhd' ).body + 4 ), 3 );
	const trun = child( seg, traf, 'trun' );
	assert.strictEqual( v.getUint32( trun.body + 4 ), 12, 'sample count' );
	const dataOffset = v.getUint32( trun.body + 8 );
	assert.strictEqual( moof.start + dataOffset, mdat.body, 'data_offset (from the start of moof) points at the mdat payload' );
	assert.strictEqual( mdat.end, seg.length );
	assert.deepStrictEqual( Array.from( seg.subarray( mdat.body, mdat.body + samples[ 0 ].data.length ) ), Array.from( samples[ 0 ].data ) );
	// per-sample: duration 1000, size, flags (key vs delta)
	const first = trun.body + 12;
	assert.strictEqual( v.getUint32( first ), 1000 );
	assert.strictEqual( v.getUint32( first + 4 ), samples[ 0 ].data.length );
	assert.strictEqual( v.getUint32( first + 8 ), 0x02000000 );
	assert.strictEqual( v.getUint32( first + 12 + 8 ), 0x01010000 );

} );

await test( 'a segment must start on a keyframe', () => {

	assert.throws( () => mediaSegment( { sequence: 1, firstFrame: 0, samples: [ { data: new Uint8Array( 4 ), key: false } ] } ), /keyframe/ );
	assert.throws( () => mediaSegment( { sequence: 1, firstFrame: 0, samples: [] } ), /at least one/ );

} );

await test( 'segments start on the first keyframe at or after 6 s, and cover every frame once', () => {

	// 60 fps, a keyframe every 2 s, 20 s of film
	const keys = Array.from( { length: 10 }, ( _, i ) => i * 120 );
	const plan = planSegments( 1200, keys, 60, 6 );
	assert.deepStrictEqual( plan.map( p => p.first ), [ 0, 360, 720, 1080 ] );
	assert.deepStrictEqual( plan.map( p => p.count ), [ 360, 360, 360, 120 ] );
	assert.strictEqual( plan.reduce( ( n, p ) => n + p.count, 0 ), 1200 );
	assert.throws( () => planSegments( 100, [ 5 ], 60 ), /first frame/ );
	// a film shorter than one segment is one segment
	assert.deepStrictEqual( planSegments( 200, [ 0, 120 ], 60 ), [ { first: 0, count: 200 } ] );

} );

await test( 'playlists: exact durations, an init map, a target duration, an end tag', () => {

	const segs = [ { name: segmentName( 1 ), frames: 360 }, { name: segmentName( 2 ), frames: 120 } ];
	const text = mediaPlaylist( segs, 60 );
	assert.match( text, /#EXT-X-MAP:URI="init.mp4"/ );
	assert.match( text, /#EXT-X-TARGETDURATION:6\n/ );
	assert.match( text, /#EXTINF:6\.000000,\nseg00001\.m4s/ );
	assert.match( text, /#EXTINF:2\.000000,\nseg00002\.m4s/ );
	assert.ok( text.trimEnd().endsWith( '#EXT-X-ENDLIST' ) );
	const master = masterPlaylist( [ { name: '1080p60', width: 1920, height: 1080, playlist: '1080p60/index.m3u8', codec: 'avc1.640034', bandwidth: 4000000, averageBandwidth: 3500000 } ], 60 );
	assert.match( master, /#EXT-X-STREAM-INF:BANDWIDTH=4000000,AVERAGE-BANDWIDTH=3500000,RESOLUTION=1920x1080,FRAME-RATE=60\.000,CODECS="avc1\.640034"\n1080p60\/index\.m3u8/ );

} );

await test( 'packaging is deterministic: the same samples give the same bytes', () => {

	const samples = fakeSamples( 400, 30 ).map( s => s.data );
	const keyframes = Array.from( { length: 14 }, ( _, i ) => i * 30 );
	const a = packageRendition( { width: 320, height: 180, fps: 30, avcC, samples, keyframes } );
	const b = packageRendition( { width: 320, height: 180, fps: 30, avcC, samples, keyframes } );
	assert.deepStrictEqual( a.segments.map( s => s.name ), [ 'seg00001.m4s', 'seg00002.m4s', 'seg00003.m4s' ] );
	assert.deepStrictEqual( a.segments.map( s => s.frames ), [ 180, 180, 40 ] );
	assert.strictEqual( a.playlist, b.playlist );
	a.segments.forEach( ( s, i ) => assert.deepStrictEqual( s.data, b.segments[ i ].data ) );
	assert.strictEqual( a.totalBytes, a.init.length + a.segments.reduce( ( n, s ) => n + s.data.length, 0 ) );

} );

// With a real ffmpeg: make real H.264, package it, and have ffmpeg decode the playlist.
const ffmpeg = spawnSync( 'ffmpeg', [ '-version' ] );
if ( ffmpeg.status !== 0 ) { console.log( '  - ffmpeg not installed: the real-decoder check is skipped' ); skipped ++; } else {

	await test( 'ffprobe and ffmpeg read the playlist: every frame, at a constant 30 fps, with no errors', () => {

		const dir = mkdtempSync( path.join( tmpdir(), 'publish-' ) );
		const src = path.join( dir, 'src.mp4' );
		const make = spawnSync( 'ffmpeg', [ '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '14', '-c:v', 'libx264', '-profile:v', 'high', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-bf', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', src ] );
		assert.strictEqual( make.status, 0, String( make.stderr ) );
		const { samples, avcC: realAvcC, width, height } = readMp4( new Uint8Array( readFileSync( src ) ) );
		assert.strictEqual( samples.length, 420 );
		const keyframes = samples.map( ( s, i ) => s.key ? i : - 1 ).filter( i => i >= 0 );
		assert.deepStrictEqual( keyframes.slice( 0, 3 ), [ 0, 60, 120 ] );

		const set = packageRendition( { width, height, fps: 30, avcC: realAvcC, samples: samples.map( s => s.data ), keyframes } );
		assert.strictEqual( set.segments.length, 3, '14 s at ~6 s per segment is 3 segments' );
		const out = path.join( dir, '320p30' );
		mkdirSync( out );
		writeFileSync( path.join( out, 'init.mp4' ), set.init );
		for ( const s of set.segments ) writeFileSync( path.join( out, s.name ), s.data );
		writeFileSync( path.join( out, 'index.m3u8' ), set.playlist );
		writeFileSync( path.join( dir, 'master.m3u8' ), masterPlaylist( [ { name: '320p30', width, height, playlist: '320p30/index.m3u8', codec: set.codec, bandwidth: set.bandwidth, averageBandwidth: set.averageBandwidth } ], 30 ) );

		for ( const playlist of [ path.join( out, 'index.m3u8' ), path.join( dir, 'master.m3u8' ) ] ) {

			const probe = spawnSync( 'ffprobe', [ '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_read_frames,width,height,codec_name', '-of', 'json', playlist ] );
			assert.strictEqual( probe.status, 0, String( probe.stderr ) );
			const s = JSON.parse( String( probe.stdout ) ).streams[ 0 ];
			assert.strictEqual( s.r_frame_rate, '30/1' );
			assert.strictEqual( Number( s.nb_read_frames ), 420 );
			assert.strictEqual( s.codec_name, 'h264' );
			assert.strictEqual( s.width, 320 );

		}
		const decode = spawnSync( 'ffmpeg', [ '-v', 'warning', '-i', path.join( out, 'index.m3u8' ), '-f', 'null', '-' ] );
		assert.strictEqual( String( decode.stderr ).trim(), '', 'no decoder warnings: ' + decode.stderr );
		// the segments alone, joined to the init, are a valid fragmented file too
		const joined = path.join( dir, 'joined.mp4' );
		writeFileSync( joined, Buffer.concat( [ set.init, ...set.segments.map( s => s.data ) ] ) );
		const dts = spawnSync( 'ffmpeg', [ '-v', 'warning', '-i', joined, '-c', 'copy', '-f', 'null', '-' ] );
		assert.strictEqual( String( dts.stderr ).trim(), '', 'no DTS warnings: ' + dts.stderr );

	} );

}

// ── canonical hash ────────────────────────────────────────────────────────────

const scene = ( extra = {} ) => ( {
	metadata: { type: 'Object', generator: 'x', stamp: Math.random() },
	project: { renderer: 'WebGPURenderer', shadows: true, shadowType: 1 },
	camera: { object: { matrix: [ 1, 2, 3 ], uuid: 'editor-camera' } },
	controls: { center: { x: 1, y: 2, z: 3 } },
	scene: { object: { uuid: 's', type: 'Scene', userData: { timeline: { duration: 12.00001, tracks: [ { target: '#a', events: [ { at: 1.00001, dur: 0.5, args: { props: { to: { position: [ 1.000049, 2, 3 ] } } } } ] } ] } }, children: [ { uuid: 'c', matrix: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1234567, 2, 3, 1 ] } ] }, geometries: [ { data: { attributes: { position: { array: [ 0.123456789, 1, 2 ] } } } } ] },
	animations: [ { object: 's', clip: { tracks: [ { times: [ 0.123456789 ] } ] } } ],
	scripts: {},
	history: { undos: [ 1, 2, 3 ], redos: [] },
	backgroundType: 'None', environmentType: 'None',
	...extra,
} );

await test( 'the hash ignores key order, whitespace and the transient fields (camera, controls, history, metadata, the baked clip)', async () => {

	const a = scene();
	const b = JSON.parse( JSON.stringify( scene( { camera: { object: { matrix: [ 9, 9, 9 ] } }, controls: {}, history: { undos: [], redos: [] }, animations: [] } ) ) );
	const reordered = Object.fromEntries( Object.entries( b ).reverse() );
	assert.strictEqual( await sceneHash( a, webcrypto.subtle ), await sceneHash( reordered, webcrypto.subtle ) );
	assert.ok( Object.keys( canonicalScene( a ) ).every( k => [ 'project', 'scene', 'scripts', 'backgroundType', 'environmentType' ].includes( k ) ) );

} );

await test( 'the hash applies the fixed quantization rule: noise below it is no edit, a real edit is', async () => {

	const base = await sceneHash( scene(), webcrypto.subtle );
	const noisy = scene();
	noisy.scene.object.userData.timeline.tracks[ 0 ].events[ 0 ].at = 1.000004;               // under 0.5e-4 s
	noisy.scene.object.userData.timeline.tracks[ 0 ].events[ 0 ].args.props.to.position = [ 1.000041, 2, 3 ];   // under 0.5e-4
	noisy.scene.object.children[ 0 ].matrix[ 12 ] = 0.1234601;                                 // 5 decimals: 0.12346 either way
	assert.strictEqual( await sceneHash( noisy, webcrypto.subtle ), base );
	const edited = scene();
	edited.scene.object.userData.timeline.tracks[ 0 ].events[ 0 ].at = 1.5;
	assert.notStrictEqual( await sceneHash( edited, webcrypto.subtle ), base );

} );

await test( 'the compiled timeline clip is a cache (a new uuid every load) and is left out; an imported clip is content and counts', async () => {

	const withClips = ( uuid, imported ) => { const j = scene(); j.scene.object.animations = [ uuid, 'imp' ];
		j.scene.animations = [ { uuid, name: 'Timeline', userData: '{"isTimeline":true}', tracks: [ { times: [ 0, 1 ] } ] }, { uuid: 'imp', name: 'walk', tracks: [ { times: [ 0, imported ] } ] } ]; return j; };
	assert.strictEqual( await sceneHash( withClips( 'one', 1 ), webcrypto.subtle ), await sceneHash( withClips( 'two', 1 ), webcrypto.subtle ) );
	assert.notStrictEqual( await sceneHash( withClips( 'one', 1 ), webcrypto.subtle ), await sceneHash( withClips( 'one', 2 ), webcrypto.subtle ) );

} );

await test( 'geometry buffers are hashed as they are, never rounded', async () => {

	const a = scene(), b = scene();
	b.scene.geometries[ 0 ].data.attributes.position.array[ 0 ] = 0.123456788;
	assert.notStrictEqual( await sceneHash( a, webcrypto.subtle ), await sceneHash( b, webcrypto.subtle ) );
	assert.ok( canonicalText( a ).includes( '0.123456789' ) );

} );

await test( 'the hash has the form sha256:<64 hex>', async () => {

	assert.match( await sceneHash( scene(), webcrypto.subtle ), /^sha256:[0-9a-f]{64}$/ );

} );

// ── render.json ───────────────────────────────────────────────────────────────

const sceneInfo = { repo: 'tejaswigowda/test1', file: 'piston.json', branch: 'main', commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', hash: 'sha256:' + 'ab'.repeat( 32 ) };
const renderInfo = { mode: 'offline', renderer: 'WebGLRenderer', device: 'webgl2', encoder: 'software', fps: 60, frames: 6180, frameRange: [ 0, 6179 ], width: 1920, height: 1080, renderedAt: '2026-10-26T19:40:00Z' };
const renditions = [ { name: '1080p60', width: 1920, height: 1080, bitrateKbps: 3500, playlist: '1080p60/index.m3u8', segments: 18, maxSegmentBytes: 3_100_000 } ];
const CAPTION_TRACK = await cueTrack( { cues: [ { id: 'launch', start: 0.8, end: 4.65, text: 'Launch a ball at an angle.' }, { id: 'second', start: 6.77, end: 10.09, text: 'The short leg is 3 units long.' } ], scene: sceneInfo, exporter: 'strata-export/1.2.0' } );
const HASHES = { count: 6180, root: 'sha256:' + 'cd'.repeat( 32 ) };
const VERIFIED = { method: 'shuffled-order', every: 1, seed: 1, frames_checked: 6180, of: 6180, complete: true, passed: true, mismatched_frames: [], mismatched_count: 0 };
// a render that has earned its claim: offline, hashed, verified on every frame, software encoder. `det` overrides what assessDeterminism is told.
const build = ( over = {}, det = {} ) => buildRenderJson( { scene: sceneInfo, render: { ...renderInfo, ...over }, renditions, files: [ { path: 'a', bytes: 5 } ], frameHashes: det.frameHashes === null ? null : { path: 'frame-hashes.txt', ...HASHES }, determinism: assessDeterminism( { mode: over.mode || 'offline', encoder: over.encoder || renderInfo.encoder, frameHashes: HASHES, verification: VERIFIED, ...det } ) } );

await test( 'a built render.json validates and says what it is', () => {

	const j = build();
	assert.deepStrictEqual( validateRenderJson( j ), [] );
	assert.strictEqual( j.render.duration_s, 103 );
	assert.strictEqual( j.render.frames, Math.round( j.render.duration_s * j.render.fps ), 'frames == round(duration_s * fps)' );
	assert.strictEqual( j.render.exporter, 'strata-export/1.2.0' );
	assert.strictEqual( j.version, 2 );
	assert.deepStrictEqual( j.checks, { segments_under_20mb: true, files_under_100mb: true, frame_count_matches_duration: true } );
	assert.strictEqual( j.outputs.master, 'master.m3u8' );

} );

await test( 'D1: frames and bytes are separate claims, each derived, each with its own reasons', () => {

	const j = build();
	assert.deepStrictEqual( [ j.render.determinism.frames, j.render.determinism.bytes ], [ true, true ] );
	assert.deepStrictEqual( j.render.determinism.reasons, { frames: [], bytes: [] } );
	assert.ok( ! ( 'deterministic' in j.render ) && ! ( 'not_deterministic_because' in j.render ), 'the single boolean is gone' );
	const why = ( det ) => assessDeterminism( { mode: 'offline', encoder: 'software', frameHashes: HASHES, verification: VERIFIED, ...det } );
	// a hardware encoder is a reason the BYTES are not promised, and not a reason against the frames
	const hw = why( { encoder: 'hardware' } );
	assert.deepStrictEqual( [ hw.frames, hw.bytes ], [ true, false ] );
	assert.deepStrictEqual( hw.reasons.frames, [] );
	assert.match( hw.reasons.bytes.join(), /hardware encoder was chosen.*a choice; the frames are unaffected/ );
	// anything that breaks the frames breaks the bytes' claim too, and says so
	const live = why( { playbackWasRunning: true } );
	assert.deepStrictEqual( [ live.frames, live.bytes ], [ false, false ] );
	assert.match( live.reasons.frames.join(), /playback was running/ );
	assert.match( live.reasons.bytes.join(), /frames are not established/ );
	assert.match( why( { hasEndCard: true } ).reasons.frames.join(), /end card.*not recorded: an input that is not pinned/ );
	assert.deepStrictEqual( why( { hasEndCard: true, endCard: { sha256: 'ab'.repeat( 32 ) } } ).reasons.frames, [], 'a pinned, recorded end card is not a reason' );
	assert.match( assessDeterminism( { mode: 'realtime', encoder: 'software' } ).reasons.frames.join(), /realtime/ );
	assert.match( why( { audit: { passed: false } } ).reasons.frames.join(), /audit did not pass/ );
	const mixed = build( { encoder: 'hardware' }, { playbackWasRunning: true } );
	assert.deepStrictEqual( [ mixed.render.determinism.frames, mixed.render.determinism.bytes ], [ false, false ] );
	assert.deepStrictEqual( validateRenderJson( mixed ), [] );

} );

await test( 'D2: frames is true only after a COMPLETE, passed shuffled-order test with every frame hashed; a subset, a failure and no test are each a reason', () => {

	const base = { mode: 'offline', encoder: 'software', frameHashes: HASHES };
	assert.match( assessDeterminism( { ...base, verification: null } ).reasons.frames.join(), /not verified: the shuffled-order test was not run/ );
	assert.match( assessDeterminism( { ...base, verification: { ...VERIFIED, every: 17, frames_checked: 364, complete: false } } ).reasons.frames.join(), /verified on 364 of 6180 frames only.*a subset is evidence, not a claim/ );
	const failed = assessDeterminism( { ...base, verification: { ...VERIFIED, passed: false, mismatched_frames: [ 240, 241, 242 ], mismatched_count: 3 } } );
	assert.strictEqual( failed.frames, false );
	assert.match( failed.reasons.frames.join(), /3 frames depend on more than n \/ fps \(240, 241, 242\)/ );
	assert.match( assessDeterminism( { mode: 'offline', encoder: 'software', verification: VERIFIED } ).reasons.frames.join(), /no per-frame hashes/ );
	assert.strictEqual( assessDeterminism( { ...base, verification: VERIFIED } ).frames, true );

} );

await test( 'D5: the manifest carries the frame-hash root and the encoder as a record', () => {

	const j = build( { encoder: { kind: 'software', name: 'WebCodecs VideoEncoder (H.264)', version: 'Chrome 130', settings_hash: 'sha256:' + 'ef'.repeat( 32 ), threads: null, config: { codec: 'avc1.64002a' } } } );
	assert.deepStrictEqual( validateRenderJson( j ), [] );
	assert.deepStrictEqual( j.outputs.frame_hashes, { path: 'frame-hashes.txt', count: 6180, algorithm: 'sha256', over: j.outputs.frame_hashes.over, root: HASHES.root } );
	assert.match( j.outputs.frame_hashes.over, /raw RGB/ );
	assert.deepStrictEqual( [ j.render.encoder.kind, j.render.encoder.version, j.render.encoder.threads ], [ 'software', 'Chrome 130', null ] );
	assert.deepStrictEqual( encoderRecord( 'hardware' ), { kind: 'hardware', name: null, version: null, settings_hash: null, threads: null, config: null } );
	assert.deepStrictEqual( j.render.determinism.verification, VERIFIED );

} );

await test( 'D3/D4: the audit says what it confirmed, not what it accepts; a pinned end card is an input with its own hash', () => {

	assert.deepStrictEqual( TIME_SOURCE_AUDIT.confirmed.map( c => c.id ), [ 'no-clock-in-animated-quantities', 'no-delta-integration', 'no-previous-frame-reads', 'shell-wall-clock-loops' ] );
	assert.ok( TIME_SOURCE_AUDIT.confirmed.every( c => c.how.length > 40 ), 'each confirmation says how' );
	assert.deepStrictEqual( TIME_SOURCE_AUDIT.residuals.map( r => [ r.id, r.status ] ), [ [ 'playback-running', 'live-when-present' ] ] );
	assert.deepStrictEqual( build().render.time_source_audit.live_when_present, [ 'playback-running' ] );
	assert.strictEqual( build().inputs, undefined, 'no end card, no input' );
	const withCard = buildRenderJson( { scene: sceneInfo, render: renderInfo, renditions, files: [ { path: 'a', bytes: 5 } ], frameHashes: { path: 'frame-hashes.txt', ...HASHES }, endCard: { path: 'endcard.png', sha256: 'ab'.repeat( 32 ), bytes: 1234, url: 'https://x/about/callcard/', stamp: 'Strata v0.1.0', width: 1024, height: 2048 }, determinism: assessDeterminism( { mode: 'offline', encoder: 'software', hasEndCard: true, endCard: { sha256: 'ab' }, frameHashes: HASHES, verification: VERIFIED } ) } );
	assert.deepStrictEqual( withCard.inputs.end_card, { path: 'endcard.png', sha256: 'sha256:' + 'ab'.repeat( 32 ), bytes: 1234, source: 'https://x/about/callcard/', stamp: 'Strata v0.1.0', width: 1024, height: 2048 } );
	assert.deepStrictEqual( validateRenderJson( withCard ), [] );
	assert.strictEqual( withCard.render.determinism.frames, true );

} );

await test( 'the validator refuses a lie', () => {

	const j = build();
	const bad = ( mutate ) => { const c = JSON.parse( JSON.stringify( j ) ); mutate( c ); return validateRenderJson( c ); };
	assert.ok( bad( c => { c.render.mode = 'realtime'; } ).some( m => /frames is true only for mode offline/.test( m ) ) );
	assert.ok( bad( c => { c.render.encoder.kind = 'hardware'; } ).some( m => /bytes is true only with the software encoder/.test( m ) ) );
	assert.ok( bad( c => { c.render.determinism.reasons.frames = [ 'x' ]; } ).some( m => /frames is true, so there are no reasons/.test( m ) ) );
	assert.ok( bad( c => { c.render.determinism.frames = false; } ).some( m => /frames is false, so it says why/.test( m ) ) );
	assert.ok( bad( c => { c.render.determinism.reasons.bytes = [ 'x' ]; } ).some( m => /bytes is true, so there are no reasons/.test( m ) ) );
	assert.ok( bad( c => { c.render.determinism.verification.complete = false; } ).some( m => /only after a complete, passed shuffled-order test/.test( m ) ) );
	assert.ok( bad( c => { c.render.determinism.verification = null; } ).some( m => /only after a complete, passed/.test( m ) ) );
	assert.ok( bad( c => { delete c.outputs.frame_hashes; } ).some( m => /only with a frame hash for every frame/.test( m ) ) );
	assert.ok( bad( c => { c.outputs.frame_hashes.count = 5; } ).some( m => /only with a frame hash for every frame/.test( m ) ) );
	assert.ok( bad( c => { c.render.encoder.settings_hash = 'md5:x'; } ).some( m => /settings_hash/.test( m ) ) );
	assert.ok( bad( c => { c.render.frames = 6000; c.render.frame_range = [ 0, 5999 ]; } ).some( m => /round\(duration_s \* fps\)/.test( m ) ) );
	assert.ok( bad( c => { c.scene.hash = 'sha1:abc'; } ).some( m => /scene\.hash/.test( m ) ) );
	assert.ok( bad( c => { c.render.frame_range = [ 0, 100 ]; } ).some( m => /frame_range/.test( m ) ) );
	assert.ok( bad( c => { c.outputs.renditions = []; } ).some( m => /renditions/.test( m ) ) );
	assert.ok( bad( c => { c.version = 1; } ).some( m => /version/.test( m ) ) );
	// a realtime capture is allowed to be variable rate: frames need not match, but it must say so
	const rt = build( { mode: 'realtime', frames: 6000, frameRange: [ 0, 5999 ], durationS: 103 } );
	assert.deepStrictEqual( validateRenderJson( rt ), [] );
	assert.strictEqual( rt.checks.frame_count_matches_duration, false );

} );

await test( 'C7: the validator knows what a caption track must say: its source, the hash of its cues, and (for asr) which model and that it has no ids', () => {

	const withTrack = ( over = {} ) => buildRenderJson( { scene: sceneInfo, render: renderInfo, renditions, files: [ { path: 'a', bytes: 5 } ], captions: 'captions.vtt', captionTracks: [ { ...CAPTION_TRACK.record, hls: 'subs/en/index.m3u8', ...over } ], determinism: assessDeterminism( { mode: 'offline', encoder: 'software', frameHashes: HASHES, verification: VERIFIED } ), frameHashes: { path: 'frame-hashes.txt', ...HASHES } } );
	assert.deepStrictEqual( validateRenderJson( withTrack() ), [] );
	assert.ok( validateRenderJson( withTrack( { source: 'whisper' } ) ).some( m => /source must be one of cues, asr, manual/.test( m ) ) );
	assert.ok( validateRenderJson( withTrack( { cues_sha256: 'md5:x' } ) ).some( m => /cues_sha256 and structure_sha256/.test( m ) ) );
	assert.ok( validateRenderJson( withTrack( { source: 'asr', addressable: true, asr: { model: 'base.en', version: null } } ) ).some( m => /asr track has no authored ids/.test( m ) ) );
	assert.ok( validateRenderJson( withTrack( { source: 'asr', addressable: false } ) ).some( m => /says which model made it/.test( m ) ) );
	assert.deepStrictEqual( validateRenderJson( withTrack( { source: 'asr', addressable: false, asr: { model: 'base.en', version: '20240930' } } ) ), [] );
	assert.ok( validateRenderJson( withTrack( { translation_of: 'en', translated_from: undefined } ) ).some( m => /which cues it was made from/.test( m ) ) );
	const j = withTrack(); j.outputs.captions = 'other.vtt';
	assert.ok( validateRenderJson( j ).some( m => /first caption track/.test( m ) ) );
	const dup = withTrack(); dup.outputs.caption_tracks.push( { ...dup.outputs.caption_tracks[ 0 ], path: 'captions.en2.vtt' } );
	assert.ok( validateRenderJson( dup ).some( m => /one caption track per language/.test( m ) ) );
	const gone = withTrack(); delete gone.outputs.caption_tracks;
	assert.ok( validateRenderJson( gone ).some( m => /caption_tracks must be a list/.test( m ) ) );

} );

await test( 'render.json matches the JSON Schema file on its required fields', () => {

	const schema = JSON.parse( readFileSync( path.join( here, '..', '..', '..', '..', 'schemas', 'render.schema.json' ), 'utf8' ) );
	const j = build();
	for ( const k of schema.required ) assert.ok( k in j, 'top-level ' + k );
	for ( const k of schema.properties.scene.required ) assert.ok( k in j.scene, 'scene.' + k );
	for ( const k of schema.properties.render.required ) assert.ok( k in j.render, 'render.' + k );
	for ( const k of schema.properties.outputs.required ) assert.ok( k in j.outputs, 'outputs.' + k );
	for ( const k of schema.properties.outputs.properties.renditions.items.required ) assert.ok( k in j.outputs.renditions[ 0 ], 'rendition.' + k );
	for ( const k of schema.properties.checks.required ) assert.ok( k in j.checks, 'checks.' + k );

} );

// ── ladder, captions, size gates ──────────────────────────────────────────────

await test( 'the ladder never upscales, keeps the aspect, and uses even sizes', () => {

	assert.deepStrictEqual( planLadder( { width: 1920, height: 1080, fps: 60 } ).map( r => [ r.name, r.width, r.height, r.kbps ] ),
		[ [ '1080p60', 1920, 1080, 3500 ], [ '720p60', 1280, 720, 1800 ], [ '480p60', 854, 480, 900 ] ] );
	assert.deepStrictEqual( planLadder( { width: 1280, height: 720, fps: 30 } ).map( r => r.name ), [ '720p30', '480p30' ] );
	assert.deepStrictEqual( planLadder( { width: 640, height: 360, fps: 30 } ).map( r => [ r.name, r.width, r.height ] ), [ [ '360p30', 640, 360 ] ] );
	assert.deepStrictEqual( planLadder( { width: 1920, height: 1080, fps: 60, keep: [ 720 ] } ).map( r => r.name ), [ '720p60' ] );
	assert.ok( planLadder( { width: 3840, height: 2160, fps: 60 } ).every( r => r.width % 2 === 0 && r.height % 2 === 0 && r.height <= 1080 ) );

} );

await test( 'captions: cues become WebVTT with dotted millisecond times, the cue id as the identifier, and a NOTE saying where they came from (detail: captions.test.mjs)', async () => {

	assert.strictEqual( vttTime( 3723.5 ), '01:02:03.500' );
	const t = await cueTrack( { cues: [ { id: 'second', start: 6.77, end: 10.09, text: 'The short leg is 3 units long.' }, { id: 'launch', start: 0.8, end: 4.65, text: 'Launch a ball at an angle,\nand it flies in a curve.' } ], scene: sceneInfo, exporter: 'strata-export/1.2.0' } );
	assert.match( t.text, /\n\nlaunch\n00:00:00\.800 --> 00:00:04\.650\nLaunch a ball at an angle,\nand it flies in a curve\.\n\nsecond\n00:00:06\.770 --> 00:00:10\.090\n/ );
	assert.match( t.text, /^WEBVTT\n\nNOTE\nscene\s+tejaswigowda\/test1@a1b2c3d piston\.json\n/ );
	assert.strictEqual( await cueTrack( { cues: [] } ), null );
	assert.ok( ! ( await cueTrack( { cues: [ { id: 'a', start: 0, end: 1, text: 'a --> b' } ] } ) ).text.includes( 'a -->' ) );

} );

await test( 'the publish path is renders/<scene basename>', () => {

	assert.strictEqual( defaultPublishPath( 'piston.json' ), 'renders/piston' );
	assert.strictEqual( defaultPublishPath( 'a+b-cubed.json' ), 'renders/a+b-cubed' );
	assert.strictEqual( defaultPublishPath( 'shorts/area volume.json' ), 'renders/area-volume' );

} );

await test( 'the set holds every file in one list, render.json first, and the checks are computed from it', () => {

	const samples = fakeSamples( 400, 30 ).map( s => s.data );
	const packaged = packageRendition( { width: 320, height: 180, fps: 30, avcC, samples, keyframes: Array.from( { length: 14 }, ( _, i ) => i * 30 ) } );
	const rung = { name: '180p30', width: 320, height: 180, kbps: 300 };
	const set = assemblePublishSet( { path: 'renders/x', scene: sceneInfo, render: { ...renderInfo, fps: 30, frames: 400, frameRange: [ 0, 399 ], width: 320, height: 180 }, rungs: [ { rung, packaged } ], poster: Uint8Array.of( 1, 2, 3 ), captionTracks: [ CAPTION_TRACK ], determinism: { mode: 'offline', encoder: 'software' } } );
	assert.deepStrictEqual( set.files.map( f => f.path ).slice( 0, 4 ), [ 'renders/x/render.json', 'renders/x/poster.jpg', 'renders/x/captions.vtt', 'renders/x/subs/en/index.m3u8' ] );
	assert.ok( set.files.some( f => f.path === 'renders/x/master.m3u8' ) && set.files.some( f => f.path === 'renders/x/180p30/init.mp4' ) && set.files.some( f => f.path === 'renders/x/180p30/seg00003.m4s' ) );
	assert.strictEqual( new Set( set.files.map( f => f.path ) ).size, set.files.length, 'no path twice' );
	assert.deepStrictEqual( validateRenderJson( JSON.parse( new TextDecoder().decode( set.files[ 0 ].bytes ) ) ), [] );
	assert.strictEqual( set.renderJson.outputs.captions, 'captions.vtt' );
	// C7: every render records where its captions came from
	assert.deepStrictEqual( set.renderJson.outputs.caption_tracks.map( t => [ t.path, t.language, t.source, t.addressable, t.hls ] ), [ [ 'captions.vtt', 'en', 'cues', true, 'subs/en/index.m3u8' ] ] );
	assert.match( set.renderJson.outputs.caption_tracks[ 0 ].cues_sha256, /^sha256:[0-9a-f]{64}$/ );
	// F: the HLS master carries the subtitle group, and the subtitle playlist points at the one caption file
	const text = p => new TextDecoder().decode( set.files.find( f => f.path === 'renders/x/' + p ).bytes );
	assert.match( text( 'master.m3u8' ), /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="en",URI="subs\/en\/index\.m3u8"/ );
	assert.match( text( 'master.m3u8' ), /#EXT-X-STREAM-INF:[^\n]*,SUBTITLES="subs"/ );
	assert.match( text( 'subs/en/index.m3u8' ), /#EXTINF:13\.333333,\n\.\.\/\.\.\/captions\.vtt\n/ );
	assert.deepStrictEqual( parseVtt( text( 'captions.vtt' ) ).cues.map( c => c.id ), [ 'launch', 'second' ] );
	assert.strictEqual( set.errors.length, 0 );
	assert.strictEqual( set.total, set.files.reduce( ( n, f ) => n + f.bytes.length, 0 ) );
	const none = assemblePublishSet( { path: 'renders/x', scene: sceneInfo, render: { ...renderInfo, fps: 30, frames: 400, frameRange: [ 0, 399 ] }, rungs: [ { rung, packaged } ], poster: Uint8Array.of( 1 ), captionTracks: [], determinism: { mode: 'offline', encoder: 'software' } } );
	assert.strictEqual( none.renderJson.outputs.captions, null );
	assert.deepStrictEqual( none.renderJson.outputs.caption_tracks, [], 'a render with no captions says so: an empty list, not an absent field' );
	assert.ok( ! none.files.some( f => f.path.endsWith( 'captions.vtt' ) || f.path.startsWith( 'renders/x/subs/' ) ) );
	assert.ok( ! /SUBTITLES/.test( new TextDecoder().decode( none.files.find( f => f.path.endsWith( 'master.m3u8' ) ).bytes ) ) );

} );

await test( 'a single-file MP4 and a dub-made narration are written, described in render.json, and sized', () => {

	const samples = fakeSamples( 400, 30 ).map( s => s.data );
	const packaged = packageRendition( { width: 320, height: 180, fps: 30, avcC, samples, keyframes: Array.from( { length: 14 }, ( _, i ) => i * 30 ) } );
	const rung = { name: '180p30', width: 320, height: 180, kbps: 300 };
	const aac = { init: Uint8Array.of( 1 ), segments: [ { name: 'seg00001.m4s', data: Uint8Array.of( 2, 3 ), first: 0 } ], playlist: '#EXTM3U\n', maxSegmentBytes: 2, durationSeconds: 400 / 30, bandwidth: 128000, averageBandwidth: 128000 };
	const sha = 'sha256:' + 'a'.repeat( 64 );
	const mk = ( download, wavBytes ) => assemblePublishSet( {
		path: 'renders/x', scene: sceneInfo, render: { ...renderInfo, fps: 30, frames: 400, frameRange: [ 0, 399 ], width: 320, height: 180 }, rungs: [ { rung, packaged } ], poster: Uint8Array.of( 1 ), captions: 'WEBVTT\n',
		audio: { packaged: aac, name: 'English', language: 'en', delaySamples: 2112, source: { path: 'narration.wav', sha256: sha, tool: 'dub.webcli.app', voice: 'af_heart', model: 'm@1 q8/wasm' }, wavBytes }, download,
		determinism: { mode: 'offline', encoder: 'software' },
	} );
	const plain = mk( null, null );
	assert.ok( ! plain.files.some( f => f.path.endsWith( '.mp4' ) && ! f.path.includes( '/' + '180p30/' ) && ! f.path.includes( 'audio/' ) ), 'no single-file mp4 unless one was made' );
	assert.strictEqual( plain.renderJson.outputs.file, undefined );
	const full = mk( { name: 'x.mp4', bytes: new Uint8Array( 5000 ), command: 'ffmpeg -i video.mp4', audio: true, captions: true, videoFrom: '720p30' }, Uint8Array.of( 9, 9, 9 ) );
	assert.ok( full.files.some( f => f.path === 'renders/x/x.mp4' && f.bytes.length === 5000 ) );
	assert.ok( full.files.some( f => f.path === 'renders/x/narration.wav' ), 'the WAV dub made is part of the set, so the audio can be traced to its source' );
	assert.deepStrictEqual( [ full.renderJson.outputs.file.path, full.renderJson.outputs.file.made_by, full.renderJson.outputs.file.bytes ], [ 'x.mp4', 'ffmpeg.webcli.app', 5000 ] );
	assert.strictEqual( full.renderJson.outputs.file.video, 'copied from the 720p30 rung, not re-encoded' );
	assert.strictEqual( mk( { name: 'x.mp4', bytes: new Uint8Array( 5000 ), command: '', audio: true, captions: true, videoFrom: 'master' }, null ).renderJson.outputs.file.video, 'copied from the master, not re-encoded' );
	assert.strictEqual( full.renderJson.outputs.audio.source.tool, 'dub.webcli.app' );
	assert.deepStrictEqual( validateRenderJson( JSON.parse( new TextDecoder().decode( full.files[ 0 ].bytes ) ) ), [] );
	assert.strictEqual( new Set( full.files.map( f => f.path ) ).size, full.files.length );
	const big = mk( { name: 'x.mp4', bytes: new Uint8Array( 21 * 1024 * 1024 ), command: '', audio: true, captions: true }, null );
	assert.ok( big.warnings.some( w => /x\.mp4 is 21 MB/.test( w ) && /jsDelivr/.test( w ) ), 'an MP4 over 20 MB warns that jsDelivr will not serve it' );
	assert.strictEqual( big.errors.length, 0, 'but it is not an error: GitHub takes it' );
	const huge = mk( { name: 'x.mp4', bytes: new Uint8Array( 100 * 1024 * 1024 ), command: '', audio: false, captions: false }, null );
	assert.ok( huge.errors.some( e => /x\.mp4/.test( e ) ), 'at 100 MB it blocks' );
	const bad = JSON.parse( JSON.stringify( full.renderJson ) ); bad.outputs.file.container = 'mkv';
	assert.ok( validateRenderJson( bad ).some( m => /outputs\.file/.test( m ) ) );

} );

await test( 'size gates: a segment at 20 MB or a file at 100 MB blocks; the warning carries real numbers; over 100 MB it says so', () => {

	const MB = 1024 * 1024;
	const file = ( n ) => ( { path: 'f', bytes: { length: n } } );
	const ok = sizeReport( [ file( 5 * MB ) ], 5 * MB, [ { name: 'a', maxSegmentBytes: 19 * MB } ], { frames: true, bytes: false } );
	assert.deepStrictEqual( ok.errors, [] );
	assert.match( ok.warnings[ 0 ], /adds 5\.0 MB in 1 files\. Git keeps every version of a binary forever: .* six full copies \(about 30 MB\)/ );
	assert.ok( ok.warnings.some( w => /separate "renders" branch/.test( w ) && /separate media repository/.test( w ) ) );
	assert.ok( ok.warnings.some( w => /build artifact/.test( w ) ) );
	assert.ok( ! sizeReport( [ file( 5 * MB ) ], 5 * MB, [ { name: 'a', maxSegmentBytes: 5 * MB } ], { frames: false, bytes: false } ).warnings.some( w => /build artifact/.test( w ) ), 'a render whose frames are not established is not called a build artifact' );
	assert.ok( ok.warnings.some( w => /bytes are not promised to repeat/.test( w ) ), 'and it says when only the frames are promised' );
	assert.match( sizeReport( [ file( MB ) ], 20 * MB, [ { name: 'a', maxSegmentBytes: 20 * MB } ], true ).errors[ 0 ], /over the 20 MB limit/ );
	assert.match( sizeReport( [ file( 100 * MB ) ], 100 * MB, [], true ).errors[ 0 ], /100 MB/ );
	assert.match( sizeReport( [ file( 60 * MB ), file( 50 * MB ) ], 110 * MB, [], true ).warnings[ 0 ], /^This commit is over 100 MB \(110 MB in 2 files\)\. Git keeps every version/ );
	assert.strictEqual( LIMITS.segmentBytes, 20 * MB );
	assert.strictEqual( formatBytes( 14238102 ), '14 MB' );

} );

await test( 'staleness: the same hash is unchanged, a different one is stale, none recorded is stale', () => {

	assert.deepStrictEqual( stalenessLine( 'sha256:a', 'sha256:a' ), { stale: false, text: 'Scene unchanged since render.' } );
	assert.strictEqual( stalenessLine( 'sha256:a', 'sha256:b' ).stale, true );
	assert.match( stalenessLine( 'sha256:a', 'sha256:b' ).text, /this render is stale/ );
	assert.strictEqual( stalenessLine( null, 'sha256:b' ).stale, true );

} );

console.log( `\n${ pass } passed, ${ fail } failed${ skipped ? `, ${ skipped } skipped` : '' }` );
process.exit( fail ? 1 : 0 );
