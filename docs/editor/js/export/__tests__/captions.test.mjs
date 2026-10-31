// Run: node docs/editor/js/export/__tests__/captions.test.mjs
// Addressable captions: the cue id as the VTT identifier (C1, C2), the NOTE block (C3), the hashes that decide present / stale / missing (C6), re-import keeping ids,
// the track record, and the HLS subtitle group.
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { normalizeCues } from '../../intelligence/subtitles.js';
import {
	captionCues, cueIdProblems, slugCueId, reconcileIds, cuesHash, structureHash, vttFile, parseVtt, noteBlock, sceneLine, vttTime, parseVttTime, trackPath, trackRecord, recordOfFile,
	subtitlePlaylist, withSubtitles, languageName, assessTrack, sceneCues, CUE_ID_PATTERN, fillIds, cueTrack,
} from '../captions.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const CUES = [
	{ id: 'intro-question', start: 0.8, end: 4.2, text: 'Why do these three molecules have different shapes?' },
	{ id: 'cue-cemp3w2', start: 5.4, end: 9.7, text: 'Cut every side into two parts:\na, and b.' },
	{ id: 'blocks-of-four-kinds', start: 15, end: 18, text: 'The blocks come in four kinds.' },
];
const SCENE = { repo: 'tejaswigowda/test1', file: 'a+b-cubed.json', commit: 'fdb3a56e4ba0f47081b918b5a95b59f31aeaa5fb' };
const sha = s => 'sha256:' + createHash( 'sha256' ).update( s ).digest( 'hex' );

await test( 'C1: every VTT cue carries the scene\u2019s own cue id on the line before the timing', async () => {

	const f = await vttFile( { cues: CUES, scene: SCENE, exporter: 'strata-export/1.2.0' } );
	assert.match( f.text, /\nintro-question\n00:00:00\.800 --> 00:00:04\.200\nWhy do these three molecules have different shapes\?\n/ );
	assert.match( f.text, /\ncue-cemp3w2\n00:00:05\.400 --> 00:00:09\.700\nCut every side into two parts:\na, and b\.\n/ );
	const back = parseVtt( f.text );
	assert.deepStrictEqual( back.cues.map( c => c.id ), [ 'intro-question', 'cue-cemp3w2', 'blocks-of-four-kinds' ] );
	assert.ok( ! /^\d+$/m.test( f.text.split( 'NOTE' )[ 1 ].split( '\n\n' ).slice( 1 ).join( '\n' ).split( '\n' )[ 0 ] ), 'no positional numbers' );
	assert.ok( back.cues.every( c => ! /^\d+$/.test( c.id ) ) );

} );

await test( 'C2: inserting a cue changes no other cue\u2019s id; the ids are stored with the cues, not counted', async () => {

	const before = normalizeCues( CUES );
	const inserted = normalizeCues( [ ...CUES, { start: 2, end: 3, text: 'A new cue, in the middle.' } ] );
	const idOf = ( list, text ) => list.find( c => c.text === text ).id;
	for ( const c of CUES ) assert.strictEqual( idOf( inserted, c.text ), idOf( before, c.text ), 'id of "' + c.text.slice( 0, 20 ) + '"' );
	assert.strictEqual( inserted.length, 4 );
	assert.ok( inserted.find( c => c.text.startsWith( 'A new cue' ) ).id, 'the new cue has an id' );
	const vtt = await vttFile( { cues: inserted, scene: SCENE } );
	const ids = parseVtt( vtt.text ).cues.map( c => c.id );
	assert.deepStrictEqual( ids.filter( id => id === 'intro-question' || id === 'cue-cemp3w2' || id === 'blocks-of-four-kinds' ), [ 'intro-question', 'cue-cemp3w2', 'blocks-of-four-kinds' ] );
	assert.strictEqual( new Set( ids ).size, 4 );

} );

await test( 'ids: authored ones must be valid and unique; a bad one is refused with the cue named, never renumbered', async () => {

	assert.deepStrictEqual( cueIdProblems( CUES ), [] );
	assert.match( cueIdProblems( [ { id: 'has space', start: 0, end: 1, text: 'x' } ] ).join(), /"has space".*not a valid cue id/ );
	assert.match( cueIdProblems( [ { id: 'a', start: 0, end: 1, text: 'one' }, { id: 'a', start: 2, end: 3, text: 'two' } ] ).join(), /"a" is used by .* and by .*an id names one cue/ );
	assert.match( cueIdProblems( [ { start: 0, end: 1, text: 'x' } ] ).join(), /has no id/ );
	assert.match( cueIdProblems( [ { id: 'a-->b', start: 0, end: 1, text: 'x' } ] ).join(), /not a valid cue id/ );
	await assert.rejects( vttFile( { cues: [ { id: 'bad id', start: 0, end: 1, text: 'x' } ] } ), /not a valid cue id/ );
	assert.ok( CUE_ID_PATTERN.test( 'cue-y0quet1' ) && ! CUE_ID_PATTERN.test( '-x' ) && ! CUE_ID_PATTERN.test( 'a'.repeat( 65 ) ) );
	assert.strictEqual( slugCueId( 'Why do these three molecules have different shapes?' ), 'why-do-these-three' );
	assert.strictEqual( slugCueId( 'Why do these three', new Set( [ 'why-do-these-three' ] ) ), 'why-do-these-three-2' );
	assert.strictEqual( slugCueId( '???' ), 'cue' );

} );

await test( 'C3: the file says where it came from, in a NOTE block, with nothing in it that varies between exports', async () => {

	const f = await vttFile( { cues: CUES, scene: SCENE, exporter: 'strata-export/1.2.0' } );
	assert.match( f.text, /^WEBVTT\n\nNOTE\nscene\s+tejaswigowda\/test1@fdb3a56 a\+b-cubed\.json\ncues\s+sha256:[0-9a-f]{64}\n/ );
	assert.match( f.text, /\nsource\s+cues\n/ );
	assert.match( f.text, /\nexporter\s+strata-export\/1\.2\.0\n/ );
	assert.ok( ! f.text.split( 'NOTE' )[ 1 ].split( '\n\n' )[ 0 ].includes( '-->' ), 'a NOTE may not hold "-->"' );
	const p = parseVtt( f.text ).provenance;
	assert.strictEqual( p.cues, f.cues_sha256 );
	assert.strictEqual( p.source, 'cues' );
	assert.strictEqual( p.scene, 'tejaswigowda/test1@fdb3a56 a+b-cubed.json' );
	assert.strictEqual( ( await vttFile( { cues: CUES, scene: SCENE, exporter: 'strata-export/1.2.0' } ) ).text, f.text, 'the same cues give the same bytes' );
	assert.strictEqual( sceneLine( null ), null );
	assert.match( noteBlock( { source: 'cues', cues: undefined } ), /^NOTE\nsource\s+cues\n$/ );

} );

await test( 'the cue hash is over id, times and words: it changes when any does, and not when only the order they were stored in does', async () => {

	const h = await cuesHash( CUES );
	assert.match( h, /^sha256:[0-9a-f]{64}$/ );
	assert.strictEqual( h, await cuesHash( [ ...CUES ].reverse() ) );
	assert.notStrictEqual( h, await cuesHash( CUES.map( ( c, i ) => i === 1 ? { ...c, text: c.text + '!' } : c ) ), 'words' );
	assert.notStrictEqual( h, await cuesHash( CUES.map( ( c, i ) => i === 1 ? { ...c, start: 5.5 } : c ) ), 'time' );
	assert.notStrictEqual( h, await cuesHash( CUES.map( ( c, i ) => i === 1 ? { ...c, id: 'renamed' } : c ) ), 'id' );
	assert.strictEqual( h, await cuesHash( [ ...CUES, { id: 'empty', start: 20, end: 21, text: '   ' } ] ), 'a cue with no words is not in the file, so it is not in the hash' );
	assert.strictEqual( await structureHash( CUES ), await structureHash( CUES.map( c => ( { ...c, text: 'otro texto' } ) ) ), 'structure ignores the words' );
	assert.strictEqual( h, sha( JSON.stringify( [ [ 'intro-question', 800, 4200, CUES[ 0 ].text ], [ 'cue-cemp3w2', 5400, 9700, CUES[ 1 ].text ], [ 'blocks-of-four-kinds', 15000, 18000, CUES[ 2 ].text ] ] ) ), 'plain sha256 of a stated form: anyone can recompute it' );

} );

await test( 'parsing is the inverse of writing, and tolerates what other tools write', async () => {

	const f = await vttFile( { cues: CUES, scene: SCENE } );
	const back = parseVtt( f.text );
	assert.deepStrictEqual( back.cues, captionCues( CUES ) );
	assert.deepStrictEqual( back.problems, [] );
	const foreign = 'WEBVTT - made elsewhere\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.500 align:start\r\nHello\r\n\r\nNOTE a comment\r\n\r\n00:03.000 --> 00:04.000\r\nNo id here\r\n';
	const p = parseVtt( foreign );
	assert.deepStrictEqual( p.cues, [ { id: '1', start: 1, end: 2.5, text: 'Hello' }, { id: null, start: 3, end: 4, text: 'No id here' } ] );
	assert.strictEqual( p.provenance, null );
	assert.match( parseVtt( 'not vtt' ).problems.join(), /WEBVTT/ );
	assert.strictEqual( parseVttTime( '00:00:04.650' ), 4.65 );
	assert.strictEqual( parseVttTime( '01:02.003' ), 62.003 );
	assert.strictEqual( parseVttTime( 'nonsense' ), null );
	assert.strictEqual( vttTime( 3723.5 ), '01:02:03.500' );

} );

await test( 'C6: the state of a caption is decided by what it holds against what the scene says now: present, stale, missing', async () => {

	const f = await vttFile( { cues: CUES, scene: SCENE } );
	const file = await recordOfFile( 'captions.vtt', f.text );
	const now = await sceneCues( CUES );
	assert.deepStrictEqual( assessTrack( { file, scene: now } ).state, 'present' );
	assert.strictEqual( assessTrack( { file: null, scene: now } ).state, 'missing' );
	assert.strictEqual( assessTrack( { file: null, scene: now } ).action, 'generate' );
	assert.strictEqual( assessTrack( { file: null, scene: await sceneCues( [] ) } ).action, 'asr', 'a scene with no cues can only be filled by ASR' );
	// the failure that actually happens: the file is there and the cues have moved on
	const edited = await sceneCues( CUES.map( ( c, i ) => i === 0 ? { ...c, text: 'Why do these molecules differ?' } : c ) );
	const stale = assessTrack( { file, scene: edited } );
	assert.strictEqual( stale.state, 'stale' );
	assert.match( stale.reasons.join(), /cues have changed since it was written/ );
	assert.strictEqual( assessTrack( { file, scene: await sceneCues( CUES.map( ( c, i ) => i === 1 ? { ...c, end: 9.8 } : c ) ) } ).state, 'stale', 're-timed' );
	assert.strictEqual( assessTrack( { file, scene: await sceneCues( [ ...CUES, { id: 'new-one', start: 30, end: 31, text: 'more' } ] ) } ).state, 'stale', 'inserted' );
	// a file with no provenance cannot be said to match anything, even when it happens to
	const legacy = await recordOfFile( 'captions.vtt', 'WEBVTT\n\n1\n00:00:00.800 --> 00:00:04.200\nWhy do these three molecules have different shapes?\n' );
	assert.match( assessTrack( { file: legacy, scene: now } ).reasons.join(), /no provenance/ );
	// a hand edit that left the NOTE alone is caught, because the content is hashed and not just the NOTE trusted
	const handEdited = await recordOfFile( 'captions.vtt', f.text.replace( 'different shapes', 'different forms' ) );
	assert.strictEqual( assessTrack( { file: handEdited, scene: now } ).state, 'stale' );
	assert.match( assessTrack( { file: handEdited, scene: now } ).reasons.join(), /edited after it was exported/ );

} );

await test( 'an ASR or manual track is not compared with the cue list, and says when the scene could now replace it', async () => {

	const asr = await vttFile( { cues: [ { id: null, start: 0, end: 2, text: 'inferred words' } ], source: 'asr', asr: { model: 'base.en', version: '20240930' }, ids: false } );
	assert.match( asr.text, /\nasr\s+base\.en 20240930\n/ );
	assert.match( asr.text, /\nids\s+none\n/ );
	assert.ok( ! /^\S+\n00:00:00\.000 --> /m.test( asr.text.split( '\n\n' ).slice( 2 ).join( '\n\n' ) ), 'no identifier line before the timing' );
	const file = await recordOfFile( 'captions.vtt', asr.text );
	assert.deepStrictEqual( [ file.record.source, file.record.addressable, file.record.asr ], [ 'asr', false, { model: 'base.en', version: '20240930' } ] );
	assert.strictEqual( assessTrack( { file, scene: await sceneCues( [] ) } ).state, 'present' );
	const withCues = assessTrack( { file, scene: await sceneCues( CUES ) } );
	assert.strictEqual( withCues.state, 'present' );
	assert.match( withCues.notes.join(), /exact track can replace this inferred one/ );

} );

await test( 'F: a translation shares the ids and times, and goes stale if a cue is dropped, re-timed, or its words change', async () => {

	const base = await sceneCues( CUES );
	const es = CUES.map( c => ( { ...c, text: 'ES ' + c.text } ) );
	const f = await vttFile( { cues: es, language: 'es', source: 'manual', translationOf: 'en', translatedFrom: base.cues_sha256, scene: SCENE } );
	const file = await recordOfFile( 'captions.es.vtt', f.text );
	assert.strictEqual( file.record.language, 'es' );
	assert.strictEqual( file.record.translation_of, 'en' );
	assert.strictEqual( file.record.structure_sha256, base.structure_sha256, 'same ids and times as the cues it translates' );
	assert.strictEqual( assessTrack( { file, scene: base, base: false } ).state, 'present' );
	const dropped = await sceneCues( [ ...CUES, { id: 'fresh', start: 30, end: 31, text: 'a cue the translation lacks' } ] );
	const d = assessTrack( { file, scene: dropped, base: false } );
	assert.strictEqual( d.state, 'stale' ); assert.match( d.reasons.join(), /dropped 1 cue \(fresh\)/ );
	assert.match( assessTrack( { file, scene: await sceneCues( CUES.slice( 0, 2 ) ), base: false } ).reasons.join(), /1 cue the scene no longer has \(blocks-of-four-kinds\)/ );
	assert.match( assessTrack( { file, scene: await sceneCues( CUES.map( ( c, i ) => i === 0 ? { ...c, end: 4.3 } : c ) ), base: false } ).reasons.join(), /re-timed/ );
	assert.match( assessTrack( { file, scene: await sceneCues( CUES.map( ( c, i ) => i === 0 ? { ...c, text: 'new words' } : c ) ), base: false } ).reasons.join(), /words of the cues have changed since it was translated/ );
	assert.strictEqual( assessTrack( { file: null, scene: base, base: false } ).action, 'translate' );

} );

await test( 'an .srt re-import keeps the ids of the cues it is an edit of, and only those', () => {

	const old = normalizeCues( CUES );
	const fromSrt = [
		{ id: 'cue-new1', start: 0.8, end: 4.2, text: 'Why do these three molecules have different shapes?' },     // identical
		{ id: 'cue-new2', start: 5.6, end: 9.9, text: 'Cut every side into two parts:\na, and b.' },               // re-timed
		{ id: 'cue-new3', start: 15, end: 18, text: 'The blocks come in four different kinds.' },                  // re-worded, same times
		{ id: 'cue-new4', start: 40, end: 42, text: 'A brand new cue.' },
	];
	const out = reconcileIds( old, fromSrt );
	assert.deepStrictEqual( out.map( c => c.id ), [ 'intro-question', 'cue-cemp3w2', 'blocks-of-four-kinds', 'cue-new4' ] );
	assert.strictEqual( new Set( out.map( c => c.id ) ).size, 4 );
	const blank = reconcileIds( [ { id: 'just-added', start: 20, end: 23, text: '' } ], [ { id: 'n', start: 20, end: 23, text: '' } ] );
	assert.strictEqual( blank[ 0 ].id, 'just-added', 'a cue with no words yet keeps its id through an import' );
	const twice = reconcileIds( [ { id: 'a', start: 0, end: 1, text: 'same' } ], [ { id: 'n1', start: 0, end: 1, text: 'same' }, { id: 'n2', start: 2, end: 3, text: 'same' } ] );
	assert.strictEqual( twice[ 0 ].id, 'a' ); assert.notStrictEqual( twice[ 1 ].id, 'a', 'one old id names one cue' );

} );

await test( 'C2 (saving): a cue that arrives with only words and times keeps the id of the cue it is the edit of, so saving never renumbers', () => {

	const stored = normalizeCues( CUES );
	// a script that sends words and times only (the Shell's setSubtitles), in a different order, with one new cue
	const sent = [ { start: 15, end: 18, text: 'The blocks come in four kinds.' }, { start: 0.8, end: 4.2, text: 'Why do these three molecules have different shapes?' }, { start: 7, end: 8, text: 'brand new' }, { start: 5.4, end: 9.7, text: 'Cut every side into two parts:\na, and b.' } ];
	const filled = fillIds( stored, sent );
	assert.deepStrictEqual( filled.map( c => c.id ), [ 'blocks-of-four-kinds', 'intro-question', undefined, 'cue-cemp3w2' ] );
	const saved = normalizeCues( filled );
	assert.deepStrictEqual( saved.filter( c => c.text !== 'brand new' ).map( c => c.id ), [ 'intro-question', 'cue-cemp3w2', 'blocks-of-four-kinds' ] );
	assert.ok( saved.find( c => c.text === 'brand new' ).id, 'the new cue is numbered by normalizeCues' );
	// saving the same words again changes nothing, however often it is done
	const again = normalizeCues( fillIds( saved, sent ) );
	assert.deepStrictEqual( again.map( c => c.id ), saved.map( c => c.id ) );
	// an id that is given is kept, even where it differs from the old cue's
	assert.strictEqual( fillIds( stored, [ { id: 'mine', start: 0.8, end: 4.2, text: 'Why do these three molecules have different shapes?' } ] )[ 0 ].id, 'mine' );

} );

await test( 'the cue-derived track carries the ids, the record and the file together', async () => {

	const t = await cueTrack( { cues: CUES, scene: SCENE, exporter: 'strata-export/1.2.0', language: 'es', isDefault: false } );
	assert.deepStrictEqual( [ t.path, t.language, t.default, t.record.source, t.record.addressable ], [ 'captions.es.vtt', 'es', false, 'cues', true ] );
	assert.strictEqual( t.record.cues_sha256, ( await recordOfFile( t.path, t.text ) ).record.cues_sha256 );
	assert.strictEqual( await cueTrack( { cues: [] } ), null );

} );

await test( 'the track record says how the file was made, and is read back from the file itself', async () => {

	const f = await vttFile( { cues: CUES, scene: SCENE } );
	const rec = trackRecord( { path: 'captions.vtt', language: 'en', source: 'cues', file: f } );
	assert.deepStrictEqual( rec, { path: 'captions.vtt', language: 'en', source: 'cues', cues_sha256: f.cues_sha256, structure_sha256: f.structure_sha256, cue_count: 3, addressable: true } );
	assert.deepStrictEqual( ( await recordOfFile( 'captions.vtt', f.text ) ).record, rec );
	assert.strictEqual( trackPath( 'en', true ), 'captions.vtt' );
	assert.strictEqual( trackPath( 'es', false ), 'captions.es.vtt' );
	assert.strictEqual( ( await vttFile( { cues: [], scene: SCENE } ) ), null, 'no cues, no file' );

} );

await test( 'the HLS group: one SUBTITLES media entry per track, every variant points at the group, and applying it twice gives the same text', () => {

	const master = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aud"\n1080p60/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,CODECS="avc1.640020,mp4a.40.2",AUDIO="aud"\n720p60/index.m3u8\n';
	const tracks = [ { language: 'en', uri: 'subs/en/index.m3u8', default: true }, { language: 'es', uri: 'subs/es/index.m3u8', default: false } ];
	const once = withSubtitles( master, tracks );
	assert.strictEqual( once.match( /TYPE=SUBTITLES/g ).length, 2 );
	assert.match( once, /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="en",URI="subs\/en\/index\.m3u8"/ );
	assert.match( once, /NAME="Espa\u00f1ol",DEFAULT=NO/ );
	assert.strictEqual( once.match( /,SUBTITLES="subs"/g ).length, 2 );
	assert.strictEqual( withSubtitles( once, tracks ), once, 'idempotent' );
	assert.strictEqual( withSubtitles( once, [ tracks[ 0 ] ] ).match( /TYPE=SUBTITLES/g ).length, 1, 'it replaces, it does not accumulate' );
	assert.strictEqual( withSubtitles( once, [] ), master, 'with no tracks it takes the group out again' );

} );

await test( 'the subtitle playlist is one WebVTT segment over the length of the render, pointing at the caption file', () => {

	const p = subtitlePlaylist( { uri: '../../captions.vtt', durationS: 51.2 } );
	assert.match( p, /#EXT-X-TARGETDURATION:52\n/ );
	assert.match( p, /#EXTINF:51\.200000,\n\.\.\/\.\.\/captions\.vtt\n#EXT-X-ENDLIST\n$/ );
	assert.strictEqual( languageName( 'es' ), 'Espa\u00f1ol' );
	assert.strictEqual( languageName( 'zz-nonsense-' ), 'zz-nonsense-' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
