// Run: node tools/__tests__/captions.test.mjs
// The coverage workflow (tools/captions.mjs) on throwaway repositories: --check reports present / stale / missing and exits non-zero on the last two (C4), --fill is idempotent
// (C5), an edit to the cue list flips a render to stale and not present (C6), ASR is a marked fallback, and a translation shares the scene's ids.
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { main, cuesOfSceneJson } from '../captions.mjs';
import { parseVtt, vttFile, recordOfFile } from '../../docs/editor/js/export/captions.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const CUES = [
	{ id: 'intro-question', start: 0.8, end: 4.2, text: 'Why do these three molecules have different shapes?' },
	{ id: 'cut-the-sides', start: 5.4, end: 9.7, text: 'Cut every side into two parts:\na, and b.' },
	{ id: 'four-kinds', start: 15, end: 18, text: 'The blocks come in four kinds.' },
];
const MASTER = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3665276,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aud"\n1080p60/index.m3u8\n';

async function repo( renders ) {

	const root = await fs.mkdtemp( path.join( os.tmpdir(), 'captions-test-' ) );
	for ( const [ name, r ] of Object.entries( renders ) ) {

		const sceneFile = `${ name }.json`;
		await fs.writeFile( path.join( root, sceneFile ), JSON.stringify( { scene: { object: { userData: r.cues ? { renderSubtitles: r.cues } : {} } } } ) );
		const dir = path.join( root, 'renders', name );
		await fs.mkdir( dir, { recursive: true } );
		const rj = { version: 2, scene: { repo: 'o/r', file: sceneFile, branch: 'main', commit: 'fdb3a56e4ba0f47081b918b5a95b59f31aeaa5fb', hash: 'sha256:' + '0'.repeat( 64 ) }, render: { duration_s: 20 }, outputs: { master: 'master.m3u8', poster: 'poster.jpg', captions: r.vtt ? 'captions.vtt' : null } };
		await fs.writeFile( path.join( dir, 'render.json' ), JSON.stringify( rj, null, 2 ) + '\n' );
		await fs.writeFile( path.join( dir, 'master.m3u8' ), MASTER );
		if ( r.vtt ) await fs.writeFile( path.join( dir, 'captions.vtt' ), r.vtt );

	}
	return root;

}
const sink = () => { const lines = []; return { lines, log: ( ...a ) => lines.push( a.join( ' ' ) ), error: ( ...a ) => lines.push( 'ERR ' + a.join( ' ' ) ) }; };
const run = async ( root, ...args ) => { const o = sink(); const code = await main( [ '--root', root, ...args ], o ); return { code, text: o.lines.join( '\n' ), lines: o.lines }; };
const snapshot = async root => { const out = {}; const walk = async d => { for ( const e of await fs.readdir( d, { withFileTypes: true } ) ) { const p = path.join( d, e.name ); if ( e.isDirectory() ) await walk( p ); else out[ path.relative( root, p ) ] = createHash( 'sha256' ).update( await fs.readFile( p ) ).digest( 'hex' ); } }; await walk( root ); return out; };
const read = ( root, name, file ) => fs.readFile( path.join( root, 'renders', name, file ), 'utf8' );
const sceneEdit = async ( root, name, fn ) => { const p = path.join( root, `${ name }.json` ); const j = JSON.parse( await fs.readFile( p, 'utf8' ) ); fn( j.scene.object.userData ); await fs.writeFile( p, JSON.stringify( j ) ); };

const LEGACY = 'WEBVTT\n\n1\n00:00:00.800 --> 00:00:04.200\nWhy do these three molecules have different shapes?\n\n2\n00:00:05.400 --> 00:00:09.700\nCut every side into two parts:\na, and b.\n\n3\n00:00:15.000 --> 00:00:18.000\nThe blocks come in four kinds.\n';

await test( 'C4: --check reports present, stale and missing per render, writes nothing, and exits non-zero on stale or missing', async () => {

	const root = await repo( { fresh: { cues: CUES }, never: { cues: CUES }, old: { cues: CUES, vtt: LEGACY }, bare: { cues: null } } );
	await run( root, '--fill', '--only', 'fresh' );                                      // make one that is right
	const before = await snapshot( root );
	const r = await run( root, '--check' );
	assert.deepStrictEqual( await snapshot( root ), before, '--check writes nothing' );
	assert.strictEqual( r.code, 1 );
	assert.match( r.text, /present  fresh\/captions\.vtt/ );
	assert.match( r.text, /MISSING  never\/captions\.vtt  there is no caption file/ );
	assert.match( r.text, /STALE {4}old\/captions\.vtt  it carries no provenance[^;]*; its cues are not the scene\u2019s/ );
	assert.match( r.text, /MISSING  bare\/captions\.vtt  there is no caption file, and the scene has no cue list/ );
	assert.match( r.text, /4 renders: 1 present, 1 stale, 2 missing/ );
	const ok = await repo( { a: { cues: CUES } } ); await run( ok, '--fill' );
	assert.strictEqual( ( await run( ok, '--check' ) ).code, 0, 'all present: exit 0' );

} );

await test( 'C5: --fill writes what is missing and stale, and run again writes nothing at all', async () => {

	const root = await repo( { a: { cues: CUES }, b: { cues: CUES, vtt: LEGACY } } );
	const first = await run( root, '--fill' );
	assert.strictEqual( first.code, 0 );
	assert.match( first.text, /wrote a\/captions\.vtt/ ); assert.match( first.text, /wrote b\/captions\.vtt/ ); assert.match( first.text, /wrote a\/render\.json/ ); assert.match( first.text, /wrote a\/master\.m3u8/ );
	const after = await snapshot( root );
	const second = await run( root, '--fill' );
	assert.deepStrictEqual( await snapshot( root ), after, 'byte for byte' );
	assert.match( second.text, /Nothing to write/ );
	assert.ok( ! /wrote/.test( second.text ) );
	assert.strictEqual( second.code, 0 );
	const third = await run( root, '--fill', '--dry-run' );
	assert.match( third.text, /Nothing to write/ );

} );

await test( 'a fill makes the file, the manifest, the master and the subtitle playlist agree, with the cue ids and the NOTE', async () => {

	const root = await repo( { a: { cues: CUES } } );
	await run( root, '--fill' );
	const vtt = await read( root, 'a', 'captions.vtt' );
	assert.deepStrictEqual( parseVtt( vtt ).cues.map( c => c.id ), [ 'intro-question', 'cut-the-sides', 'four-kinds' ] );
	assert.match( vtt, /\nscene\s+o\/r@fdb3a56 a\.json\n/ ); assert.match( vtt, /\nsource\s+cues\n/ ); assert.match( vtt, /\nexporter\s+strata-captions\/1\n/ );
	const rj = JSON.parse( await read( root, 'a', 'render.json' ) );
	assert.strictEqual( rj.outputs.captions, 'captions.vtt' );
	assert.deepStrictEqual( rj.outputs.caption_tracks.map( t => [ t.path, t.language, t.source, t.addressable, t.cue_count, t.hls ] ), [ [ 'captions.vtt', 'en', 'cues', true, 3, 'subs/en/index.m3u8' ] ] );
	assert.deepStrictEqual( Object.keys( rj.outputs ), [ 'master', 'poster', 'captions', 'caption_tracks' ], 'the keys keep their order' );
	assert.match( await read( root, 'a', 'master.m3u8' ), /TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES[^\n]*URI="subs\/en\/index\.m3u8"[\s\S]*,SUBTITLES="subs"/ );
	assert.match( await read( root, 'a', 'subs/en/index.m3u8' ), /#EXTINF:20\.000000,\n\.\.\/\.\.\/captions\.vtt\n/ );
	assert.strictEqual( cuesOfSceneJson( { scene: { object: { userData: {} } } } ).length, 0 );

} );

await test( 'C6: editing the cue list flips that render to stale, not present; the other renders stay present', async () => {

	const root = await repo( { a: { cues: CUES }, b: { cues: CUES } } );
	await run( root, '--fill' );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );
	await sceneEdit( root, 'a', u => { u.renderSubtitles[ 0 ].text = 'Why do these molecules differ?'; } );
	const r = await run( root, '--check' );
	assert.strictEqual( r.code, 1 );
	assert.match( r.text, /STALE {4}a\/captions\.vtt  the scene\u2019s cues have changed since it was written/ );
	assert.match( r.text, /present  b\/captions\.vtt/ );
	// every kind of edit does it
	for ( const [ what, edit ] of [ [ 're-timed', u => { u.renderSubtitles[ 1 ].end = 9.8; } ], [ 'inserted', u => { u.renderSubtitles.push( { id: 'extra', start: 30, end: 31, text: 'one more' } ); } ], [ 'removed', u => { u.renderSubtitles.pop(); } ], [ 'id renamed', u => { u.renderSubtitles[ 2 ].id = 'renamed'; } ] ] ) {

		const r2 = await repo( { x: { cues: CUES } } ); await run( r2, '--fill' );
		await sceneEdit( r2, 'x', edit );
		assert.strictEqual( ( await run( r2, '--check' ) ).code, 1, what );

	}
	const fixed = await run( root, '--fill' );
	assert.match( fixed.text, /wrote a\/captions\.vtt/ ); assert.ok( ! /wrote b\//.test( fixed.text ) );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );
	assert.match( await read( root, 'a', 'captions.vtt' ), /Why do these molecules differ\?/ );

} );

await test( 'a caption edited by hand after the export is caught even though its NOTE still matches the scene', async () => {

	const root = await repo( { a: { cues: CUES } } ); await run( root, '--fill' );
	const p = path.join( root, 'renders', 'a', 'captions.vtt' );
	await fs.writeFile( p, ( await fs.readFile( p, 'utf8' ) ).replace( 'different shapes', 'different forms' ) );
	const r = await run( root, '--check' );
	assert.strictEqual( r.code, 1 );
	assert.match( r.text, /edited after it was exported/ );

} );

await test( 'a render whose manifest or master does not describe its captions is stale until a fill makes them agree', async () => {

	const root = await repo( { a: { cues: CUES } } ); await run( root, '--fill' );
	await fs.writeFile( path.join( root, 'renders', 'a', 'master.m3u8' ), MASTER );              // a re-published master without the group
	const r = await run( root, '--check' );
	assert.strictEqual( r.code, 1 );
	assert.match( r.text, /master\.m3u8 has no subtitle group/ );
	await run( root, '--fill' );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );

} );

await test( 'a render that cannot be judged says why and exits 2; a render with no cue list and no ASR is left, with the reason', async () => {

	const root = await repo( { a: { cues: CUES }, bare: { cues: null } } );
	await fs.rm( path.join( root, 'a.json' ) );
	const r = await run( root, '--check' );
	assert.strictEqual( r.code, 2 );
	assert.match( r.text, /ERROR {4}a {2}the scene file a\.json is not in this checkout/ );
	const bare = await run( root, '--fill', '--only', 'bare' );
	assert.strictEqual( bare.code, 1 );
	assert.match( bare.text, /left: captions\.vtt: the scene has no cue list: author cues in the scene, or run --fill --asr \(the result is marked asr\)/ );
	assert.ok( ! ( await fs.readdir( path.join( root, 'renders', 'bare' ) ) ).includes( 'captions.vtt' ), 'nothing was made up' );

} );

const hasFfmpeg = spawnSync( 'ffmpeg', [ '-version' ] ).status === 0;
await test( 'E: for a render with no cue list, --asr writes the transcription marked source asr, with the model and no ids; cues can replace it later', async () => {

	if ( ! hasFfmpeg ) { console.log( '    (skipped: no ffmpeg)' ); return; }
	const root = await repo( { talk: { cues: null } } );
	const dir = path.join( root, 'renders', 'talk' );
	await fs.mkdir( path.join( dir, 'audio' ), { recursive: true } );
	const ff = spawnSync( 'ffmpeg', [ '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', '3', '-hls_playlist_type', 'vod', path.join( dir, 'audio', 'index.m3u8' ) ] );
	assert.strictEqual( ff.status, 0, String( ff.stderr ) );
	const stub = path.join( root, 'stub-asr.mjs' );
	await fs.writeFile( stub, "import fs from 'node:fs'; import path from 'node:path'; const [ input, outdir ] = process.argv.slice( 2 ); if ( ! fs.existsSync( input ) || fs.statSync( input ).size < 1000 ) process.exit( 3 ); fs.writeFileSync( path.join( outdir, 'out.vtt' ), 'WEBVTT\\n\\n00:00:00.000 --> 00:00:01.500\\n<c>so we begin</c>\\n\\n00:00:01.500 --> 00:00:03.000\\nand then we end\\n' );\n" );
	const r = await run( root, '--fill', '--asr', '--asr-cmd', `node ${ stub } {input} {outdir}`, '--asr-model', 'base.en', '--asr-version', '20240930' );
	assert.strictEqual( r.code, 0, r.text );
	assert.match( r.text, /wrote talk\/captions\.vtt/ );
	const vtt = await read( root, 'talk', 'captions.vtt' );
	assert.match( vtt, /\nsource\s+asr\n/ ); assert.match( vtt, /\nasr\s+base\.en 20240930\n/ ); assert.match( vtt, /\nids\s+none\n/ );
	assert.deepStrictEqual( parseVtt( vtt ).cues.map( c => [ c.id, c.text ] ), [ [ null, 'so we begin' ], [ null, 'and then we end' ] ], 'no ids, and the markup is gone' );
	const rj = JSON.parse( await read( root, 'talk', 'render.json' ) );
	assert.deepStrictEqual( [ rj.outputs.caption_tracks[ 0 ].source, rj.outputs.caption_tracks[ 0 ].addressable, rj.outputs.caption_tracks[ 0 ].asr ], [ 'asr', false, { model: 'base.en', version: '20240930' } ] );
	const again = await snapshot( root ); await run( root, '--fill', '--asr', '--asr-cmd', `node ${ stub } {input} {outdir}` );
	assert.deepStrictEqual( await snapshot( root ), again, 'a second run writes nothing' );
	// an inferred track is never silently promoted: when the scene gains cues it says so, and only --replace swaps it
	await sceneEdit( root, 'talk', u => { u.renderSubtitles = CUES; } );
	const note = await run( root, '--check' );
	assert.strictEqual( note.code, 0 ); assert.match( note.text, /note: the scene has a cue list now: an exact track can replace this inferred one/ );
	assert.strictEqual( ( await run( root, '--fill' ) ).code, 0 );
	assert.match( await read( root, 'talk', 'captions.vtt' ), /source\s+asr/, 'a plain --fill leaves the asr track alone' );
	await run( root, '--fill', '--replace' );
	assert.match( await read( root, 'talk', 'captions.vtt' ), /\nsource\s+cues\n/ );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );

} );

await test( 'F: a translation shares the scene\u2019s ids: --add-track refuses a dropped or invented id, writes captions.<lang>.vtt, and goes stale when the words move', async () => {

	const root = await repo( { a: { cues: CUES } } ); await run( root, '--fill' );
	const es = { 'intro-question': '\u00bfPor qu\u00e9 tienen formas distintas estas tres mol\u00e9culas?', 'cut-the-sides': 'Corta cada lado en dos partes: a y b.', 'four-kinds': 'Los bloques son de cuatro tipos.' };
	const file = path.join( root, 'es.json' );
	await fs.writeFile( file, JSON.stringify( { ...es, 'four-kinds': undefined } ) );
	let r = await run( root, '--add-track', 'es', file, '--render', 'a' );
	assert.strictEqual( r.code, 1 ); assert.match( r.text, /missing ids: four-kinds/ );
	await fs.writeFile( file, JSON.stringify( { ...es, 'invented': 'x' } ) );
	r = await run( root, '--add-track', 'es', file, '--render', 'a' );
	assert.match( r.text, /ids the scene does not have: invented/ );
	await fs.writeFile( file, JSON.stringify( es ) );
	r = await run( root, '--add-track', 'es', file, '--render', 'a' );
	assert.strictEqual( r.code, 0, r.text ); assert.match( r.text, /wrote captions\.es\.vtt/ );
	const vtt = await read( root, 'a', 'captions.es.vtt' );
	assert.deepStrictEqual( parseVtt( vtt ).cues.map( c => c.id ), [ 'intro-question', 'cut-the-sides', 'four-kinds' ] );
	assert.deepStrictEqual( parseVtt( vtt ).cues.map( c => [ c.start, c.end ] ), CUES.map( c => [ c.start, c.end ] ), 'the scene\u2019s timings, exactly' );
	assert.match( vtt, /\ntranslation_of\s+en\n/ ); assert.match( vtt, /\nlanguage\s+es\n/ );
	const rj = JSON.parse( await read( root, 'a', 'render.json' ) );
	assert.deepStrictEqual( rj.outputs.caption_tracks.map( t => [ t.path, t.language, t.source, t.translation_of ?? null ] ), [ [ 'captions.vtt', 'en', 'cues', null ], [ 'captions.es.vtt', 'es', 'manual', 'en' ] ] );
	const master = await read( root, 'a', 'master.m3u8' );
	assert.strictEqual( master.match( /TYPE=SUBTITLES/g ).length, 2 ); assert.match( master, /NAME="Espa\u00f1ol",DEFAULT=NO[^\n]*URI="subs\/es\/index\.m3u8"/ );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );
	// the words of the source change: the English is refilled, the Spanish is stale and a fill cannot translate it
	await sceneEdit( root, 'a', u => { u.renderSubtitles[ 2 ].text = 'The blocks come in four different kinds.'; } );
	const stale = await run( root, '--check' );
	assert.strictEqual( stale.code, 1 );
	assert.match( stale.text, /STALE {4}a\/captions\.vtt/ ); assert.match( stale.text, /STALE {4}a\/captions\.es\.vtt  the words of the cues have changed since it was translated/ );
	const f = await run( root, '--fill' );
	assert.strictEqual( f.code, 1 ); assert.match( f.text, /left: captions\.es\.vtt: .*re-translate/ );
	assert.match( await read( root, 'a', 'captions.vtt' ), /four different kinds/ );
	await fs.writeFile( file, JSON.stringify( { ...es, 'four-kinds': 'Los bloques son de cuatro tipos distintos.' } ) );
	await run( root, '--add-track', 'es', file, '--render', 'a' );
	assert.strictEqual( ( await run( root, '--check' ) ).code, 0 );
	assert.match( ( await run( root, '--add-track', 'en', file, '--render', 'a' ) ).text, /the render's own language/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
