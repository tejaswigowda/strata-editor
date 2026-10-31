#!/usr/bin/env node
// tools/captions.mjs: the coverage workflow for a repository of published Strata renders (renders/<name>/render.json, captions.vtt, master.m3u8 ...).
//
//   node tools/captions.mjs --check                 report only, no writes: present / stale / missing for every render; exit 1 if any is stale or missing
//   node tools/captions.mjs --fill                  generate what is missing and stale, from the scene's cue list; idempotent: it writes nothing when everything matches
//   node tools/captions.mjs --fill --asr            additionally transcribe, with Whisper, the renders whose scene has no cue list; the result is marked source "asr"
//   node tools/captions.mjs --add-track es es.vtt --render a+b-cubed     a translation: same cue ids, new words (a .vtt with the ids, or a .json of { id: text })
//
// options: --root DIR (the repository checkout, default .)   --renders DIR (default renders)   --only NAME   --language en   --json   --dry-run   --replace
//          ASR: --asr-engine whisper|whisper-cli|auto   --asr-model base.en (a model name, or a ggml file for whisper-cli)   --asr-cmd "mycmd {input} {outdir}"   --asr-version V
// exit: 0 everything present · 1 something is stale or missing (after a --fill: something a fill cannot do) · 2 a render could not be judged, or a usage error
//
// These captions are not transcriptions. They are a projection of the same cue list that drove the narration's timing, so they cannot drift against the audio. A
// missing file is therefore usually an export that has not been run; only a render whose scene has no cue list needs ASR, and then the track says "asr", because an
// inferred timing is not an exact one. A caption can also be present and stale (the cues changed after it was written), which a presence check cannot see: the state
// is decided by hashing what the file CONTAINS against the scene's cues now.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
	captionCues, sceneCues, vttFile, parseVtt, recordOfFile, assessTrack, withSubtitles, subtitlePlaylist, subtitlePlaylistPath, trackPath, LANGUAGE,
} from '../docs/editor/js/export/captions.js';

export const TOOL = 'strata-captions/1';

const exists = async p => fs.access( p ).then( () => true, () => false );
const readText = async p => ( ( await exists( p ) ) ? fs.readFile( p, 'utf8' ) : null );

// ── reading one render ──────────────────────────────────────────────────────────────────────────

/** The cue list of a scene file as the editor saves it: scene.object.userData.renderSubtitles. */
export function cuesOfSceneJson( json ) {

	const ud = json && json.scene && json.scene.object && json.scene.object.userData;
	return Array.isArray( ud && ud.renderSubtitles ) ? ud.renderSubtitles : [];

}

/** Everything the tool needs to judge one render: its manifest, its scene's cues now, and the caption files it has. Never throws: what cannot be read is `error`. */
export async function load( root, rendersDir, name, { language = 'en' } = {} ) {

	const dir = path.join( root, rendersDir, name );
	const ctx = { name, dir, root, language, rj: null, rjText: null, scene: null, files: {}, master: null, error: null };
	ctx.rjText = await readText( path.join( dir, 'render.json' ) );
	if ( ctx.rjText === null ) return { ...ctx, error: 'no render.json' };
	try { ctx.rj = JSON.parse( ctx.rjText ); } catch ( e ) { return { ...ctx, error: 'render.json is not JSON' }; }
	const sceneFile = ctx.rj.scene && ctx.rj.scene.file;
	if ( ! sceneFile ) return { ...ctx, error: 'render.json names no scene file' };
	const scenePath = path.join( root, sceneFile );
	const sceneText = await readText( scenePath );
	if ( sceneText === null ) return { ...ctx, error: `the scene file ${ sceneFile } is not in this checkout (--root), so its cues cannot be compared` };
	try { ctx.scene = await sceneCues( cuesOfSceneJson( JSON.parse( sceneText ) ) ); } catch ( e ) { return { ...ctx, error: `${ sceneFile } is not scene JSON` }; }
	const base = ( ctx.rj.outputs && ctx.rj.outputs.caption_tracks && ctx.rj.outputs.caption_tracks[ 0 ] && ctx.rj.outputs.caption_tracks[ 0 ].language ) || language;
	ctx.baseLanguage = base;
	for ( const f of ( await fs.readdir( dir ) ).filter( f => /^captions(\.[A-Za-z0-9-]+)?\.vtt$/.test( f ) ).sort() ) ctx.files[ f ] = await fs.readFile( path.join( dir, f ), 'utf8' );
	ctx.master = await readText( path.join( dir, 'master.m3u8' ) );
	return ctx;

}

/** What each caption file is, read from the file: [{ path, base, file: { record, provenance, ... } }], the render's own track first, then translations by language. */
async function readTracks( ctx ) {

	const out = [];
	const names = Object.keys( ctx.files ).sort( ( a, b ) => ( a === 'captions.vtt' ? -1 : b === 'captions.vtt' ? 1 : a.localeCompare( b ) ) );
	for ( const n of names ) {

		const m = /^captions\.([A-Za-z0-9-]+)\.vtt$/.exec( n );
		const file = await recordOfFile( n, ctx.files[ n ], { defaultLanguage: m ? m[ 1 ] : ctx.baseLanguage } );
		out.push( { path: n, base: n === 'captions.vtt', file } );

	}
	return out;

}

// ── judging ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The state of one render: { name, state, tracks: [{ path, state, reasons, action, notes }] }. State is the worst of its tracks: missing > stale > present. A render with
 * no file for its own track is `missing`; a translation named in render.json whose file is gone is `missing` too. `ancillary` says whether render.json, master.m3u8 and the
 * subtitle playlists describe the files that are there: a caption that is right but not described is stale, so the check is non-zero until a fill makes it consistent.
 */
export async function inspect( ctx ) {

	if ( ctx.error ) return { name: ctx.name, state: 'error', error: ctx.error, tracks: [] };
	const found = await readTracks( ctx );
	const tracks = [];
	const baseFound = found.find( t => t.base );
	tracks.push( { path: 'captions.vtt', language: ctx.baseLanguage, base: true, ...assessTrack( { file: baseFound ? baseFound.file : null, scene: ctx.scene, base: true } ) } );
	for ( const t of found.filter( t => ! t.base ) ) tracks.push( { path: t.path, language: t.file.record.language, base: false, ...assessTrack( { file: t.file, scene: ctx.scene, base: false } ) } );
	for ( const r of ( ctx.rj.outputs && ctx.rj.outputs.caption_tracks ) || [] ) {

		if ( r.path !== 'captions.vtt' && ! found.some( t => t.path === r.path ) ) tracks.push( { path: r.path, language: r.language, base: false, ...assessTrack( { file: null, scene: ctx.scene, base: false } ) } );

	}
	// a render with no cue list and no caption file is not "missing a file we can make": it needs ASR, and says so
	const wanted = ctx.scene.hasCues || tracks.some( t => t.state === 'present' );
	if ( ! wanted ) tracks[ 0 ].reasons = [ 'there is no caption file, and the scene has no cue list to make one from (author cues, or --asr)' ];

	// is what is there described? Only worth saying when the files themselves are right: otherwise the fill rewrites it anyway.
	if ( tracks.every( t => t.state === 'present' ) ) {

		const issues = await ancillaryIssues( ctx, found );
		if ( issues.length ) for ( const t of tracks.slice( 0, 1 ) ) { t.state = 'stale'; t.reasons = issues; t.action = 'describe'; }

	}
	const rank = { present: 0, stale: 1, missing: 2 };
	const state = tracks.reduce( ( w, t ) => ( rank[ t.state ] > rank[ w ] ? t.state : w ), 'present' );
	return { name: ctx.name, state, tracks };

}

const hlsOf = ( ctx, t ) => ( ctx.master ? subtitlePlaylistPath( t.file.record.language ) : null );

/** What render.json, master.m3u8 and the subtitle playlists should say, given the caption files there are: { renderJson, master, playlists: {path: text}, records }. */
export function expectedAncillary( ctx, found ) {

	const records = found.map( t => { const r = { ...t.file.record }; const h = hlsOf( ctx, t ); if ( h ) r.hls = h; return r; } );
	const rj = JSON.parse( ctx.rjText );
	rj.outputs = rj.outputs || {};
	const outputs = {};
	for ( const [ k, v ] of Object.entries( rj.outputs ) ) {

		if ( k === 'caption_tracks' ) continue;
		outputs[ k ] = k === 'captions' ? ( records.length ? records[ 0 ].path : null ) : v;
		if ( k === 'captions' ) outputs.caption_tracks = records;

	}
	if ( ! ( 'captions' in rj.outputs ) ) { outputs.captions = records.length ? records[ 0 ].path : null; outputs.caption_tracks = records; }
	rj.outputs = outputs;
	const durationS = ( rj.render && rj.render.duration_s ) || 0;
	const playlists = {};
	if ( ctx.master ) for ( const t of found ) playlists[ subtitlePlaylistPath( t.file.record.language ) ] = subtitlePlaylist( { uri: '../../' + t.path, durationS } );
	const master = ctx.master ? withSubtitles( ctx.master, ctx.master ? found.map( ( t, i ) => ( { language: t.file.record.language, uri: subtitlePlaylistPath( t.file.record.language ), default: i === 0 } ) ) : [] ) : null;
	return { renderJson: JSON.stringify( rj, null, 2 ) + '\n', master, playlists, records };

}

async function ancillaryIssues( ctx, found ) {

	const exp = expectedAncillary( ctx, found ), issues = [];
	if ( exp.renderJson !== ctx.rjText ) issues.push( 'render.json does not describe its caption files (outputs.caption_tracks: where each came from, and the hash of its cues)' );
	if ( ctx.master !== null && exp.master !== ctx.master ) issues.push( 'master.m3u8 has no subtitle group for its caption files' );
	for ( const [ p, text ] of Object.entries( exp.playlists ) ) if ( ( await readText( path.join( ctx.dir, p ) ) ) !== text ) issues.push( `${ p } is missing or out of date` );
	return issues;

}

// ── filling ─────────────────────────────────────────────────────────────────────────────────────

/** Writes `text` to `file` only if it would change it. Resolves true when it wrote. */
async function writeIfChanged( file, text, { dryRun = false } = {} ) {

	if ( ( await readText( file ) ) === text ) return false;
	if ( ! dryRun ) { await fs.mkdir( path.dirname( file ), { recursive: true } ); await fs.writeFile( file, text ); }
	return true;

}

/** Makes render.json, master.m3u8 and the subtitle playlists describe the caption files in `ctx.files`. Resolves the paths written. */
async function repairAncillary( ctx, opts ) {

	const found = await readTracks( ctx ), exp = expectedAncillary( ctx, found ), wrote = [];
	for ( const [ p, text ] of Object.entries( exp.playlists ) ) if ( await writeIfChanged( path.join( ctx.dir, p ), text, opts ) ) wrote.push( p );
	if ( exp.master !== null && await writeIfChanged( path.join( ctx.dir, 'master.m3u8' ), exp.master, opts ) ) wrote.push( 'master.m3u8' );
	if ( await writeIfChanged( path.join( ctx.dir, 'render.json' ), exp.renderJson, opts ) ) wrote.push( 'render.json' );
	return wrote;

}

/** The cue-derived caption file for a render: the scene's cues, the render's scene record in the NOTE. */
async function cueFile( ctx, opts = {} ) {

	const rj = ctx.rj;
	return vttFile( { cues: ctx.scene.cues, language: ctx.baseLanguage, source: 'cues', scene: { repo: rj.scene.repo, file: rj.scene.file, commit: rj.scene.commit }, exporter: TOOL, ...opts } );

}

/**
 * Brings a render's captions up to date from its cue list, and nothing else. `--replace` also lets cues replace a track that is asr or manual. Resolves
 * { wrote: [paths], left: [{ path, why }] }: `left` is what a fill cannot do (a render with no cues and no --asr, a translation to redo).
 */
export async function fill( ctx, { replace = false, asr = null, dryRun = false } = {} ) {

	const wrote = [], left = [];
	const opts = { dryRun };
	const state = await inspect( ctx );
	const base = state.tracks.find( t => t.base );
	const found = await readTracks( ctx );
	const baseFound = found.find( t => t.base );
	const baseSource = baseFound && baseFound.file.record.source;
	const mayReplace = ! baseFound || baseSource === 'cues' || ! baseSource || replace;

	// --replace also takes an asr or manual track that is present, when the scene now has the cues to make an exact one
	const replacing = replace && ctx.scene.hasCues && baseFound && baseSource !== 'cues' && base && base.state === 'present';
	if ( base && ( ( base.state !== 'present' && base.action !== 'describe' ) || replacing ) ) {

		if ( ctx.scene.hasCues && mayReplace ) {

			const f = await cueFile( ctx );
			if ( await writeIfChanged( path.join( ctx.dir, 'captions.vtt' ), f.text, opts ) ) wrote.push( 'captions.vtt' );
			ctx.files[ 'captions.vtt' ] = f.text;

		} else if ( ctx.scene.hasCues ) left.push( { path: 'captions.vtt', why: `it is ${ baseSource }, not cue-derived; --replace lets the scene\u2019s cues take its place` } );
		else if ( asr ) {

			const r = await transcribe( ctx, asr );
			if ( r.error ) left.push( { path: 'captions.vtt', why: r.error } );
			else { if ( await writeIfChanged( path.join( ctx.dir, 'captions.vtt' ), r.text, opts ) ) wrote.push( 'captions.vtt' ); ctx.files[ 'captions.vtt' ] = r.text; }

		} else left.push( { path: 'captions.vtt', why: 'the scene has no cue list: author cues in the scene, or run --fill --asr (the result is marked asr)' } );

	}
	// a translation is words a person (or a translator) writes: a fill cannot make or refresh one
	for ( const t of state.tracks.filter( t => ! t.base && t.state !== 'present' ) ) left.push( { path: t.path, why: `${ t.reasons.join( '; ' ) }: re-translate, then --add-track` } );
	if ( Object.keys( ctx.files ).length ) wrote.push( ...( await repairAncillary( ctx, opts ) ) );
	return { wrote, left };

}

/** A translation: the scene's ids and times with new words. `text`: { id: words }. Resolves { path } or { error }. */
export async function addTrack( ctx, language, text, { dryRun = false } = {} ) {

	if ( ! LANGUAGE.test( language ) ) return { error: `"${ language }" is not a language code (en, es, pt-BR)` };
	if ( language === ctx.baseLanguage ) return { error: `${ language } is the render's own language: its captions.vtt comes from the cues, not from a translation` };
	if ( ! ctx.scene.hasCues ) return { error: 'the scene has no cue list, so there are no ids for a translation to share' };
	const ids = new Set( ctx.scene.ids ), given = Object.keys( text );
	const dropped = ctx.scene.ids.filter( id => ! ( id in text ) ), extra = given.filter( id => ! ids.has( id ) ), blank = ctx.scene.ids.filter( id => id in text && ! String( text[ id ] ).trim() );
	if ( dropped.length || extra.length || blank.length ) return { error: [ dropped.length && `missing ids: ${ dropped.join( ', ' ) }`, extra.length && `ids the scene does not have: ${ extra.join( ', ' ) }`, blank.length && `empty text for: ${ blank.join( ', ' ) }` ].filter( Boolean ).join( '; ' ) };
	const cues = ctx.scene.cues.map( c => ( { ...c, text: String( text[ c.id ] ) } ) );
	const f = await vttFile( { cues, language, source: 'manual', translationOf: ctx.baseLanguage, translatedFrom: ctx.scene.cues_sha256, scene: { repo: ctx.rj.scene.repo, file: ctx.rj.scene.file, commit: ctx.rj.scene.commit }, exporter: TOOL } );
	const file = trackPath( language, false );
	await writeIfChanged( path.join( ctx.dir, file ), f.text, { dryRun } );
	ctx.files[ file ] = f.text;
	if ( ! ctx.files[ 'captions.vtt' ] ) { const base = await cueFile( ctx ); await writeIfChanged( path.join( ctx.dir, 'captions.vtt' ), base.text, { dryRun } ); ctx.files[ 'captions.vtt' ] = base.text; }
	await repairAncillary( ctx, { dryRun } );
	return { path: file };

}

// ── ASR ─────────────────────────────────────────────────────────────────────────────────────────
// For a render whose scene has no cue list, and only then. The audio is taken from the published set (audio/index.m3u8, else the master) and decoded to 16 kHz mono
// with ffmpeg, an engine writes a .vtt, and the result is written with source "asr", the model and its version, and NO cue ids (an id here would be positional,
// and a link to it would point at whatever a re-run happens to put there). Where the scene still exists, author the cues instead: that gives a caption AND a scene
// that can be re-rendered, re-timed and translated.

function run( cmd, args, opts = {} ) { return spawnSync( cmd, args, { encoding: 'utf8', ...opts } ); }

function engineVersion( engine, given ) {

	if ( given ) return given;
	if ( engine === 'whisper' ) { const r = run( 'python3', [ '-c', 'import importlib.metadata as m; print(m.version("openai-whisper"))' ] ); if ( r.status === 0 ) return r.stdout.trim(); }
	const r = run( engine, [ '--version' ] );
	const m = r.status === 0 && /(\d+(?:\.\d+)+|\d{6,8})/.exec( ( r.stdout || '' ) + ( r.stderr || '' ) );
	return m ? m[ 1 ] : null;

}

export async function transcribe( ctx, { engine = 'auto', model = 'base.en', cmd = null, version = null, language = null } ) {

	const audioIn = ( await exists( path.join( ctx.dir, 'audio', 'index.m3u8' ) ) ) ? path.join( ctx.dir, 'audio', 'index.m3u8' ) : ( ( await exists( path.join( ctx.dir, 'master.m3u8' ) ) ) ? path.join( ctx.dir, 'master.m3u8' ) : null );
	if ( ! audioIn ) return { error: 'the render has no audio to transcribe (audio/index.m3u8 or master.m3u8)' };
	const tmp = await fs.mkdtemp( path.join( os.tmpdir(), 'strata-asr-' ) );
	try {

		const wav = path.join( tmp, 'in.wav' );
		const ff = run( 'ffmpeg', [ '-y', '-loglevel', 'error', '-i', audioIn, '-vn', '-ac', '1', '-ar', '16000', wav ] );
		if ( ff.status !== 0 ) return { error: 'ffmpeg could not decode the audio: ' + ( ff.stderr || ff.error || '' ).toString().split( '\n' )[ 0 ] };
		const lang = language || ctx.baseLanguage;
		let used = engine, vtt = path.join( tmp, 'in.vtt' );
		if ( cmd ) {

			const line = cmd.replace( /\{input\}/g, wav ).replace( /\{outdir\}/g, tmp ).replace( /\{model\}/g, model ).replace( /\{language\}/g, lang );
			const r = run( line, [], { shell: true } );
			if ( r.status !== 0 ) return { error: 'the ASR command failed: ' + ( r.stderr || '' ).split( '\n' )[ 0 ] };
			used = 'custom';
			const made = ( await fs.readdir( tmp ) ).find( f => f.endsWith( '.vtt' ) );
			if ( ! made ) return { error: 'the ASR command wrote no .vtt in {outdir}' };
			vtt = path.join( tmp, made );

		} else {

			if ( used === 'auto' ) used = run( 'which', [ 'whisper' ] ).status === 0 ? 'whisper' : run( 'which', [ 'whisper-cli' ] ).status === 0 ? 'whisper-cli' : null;
			if ( ! used ) return { error: 'no ASR engine: install Whisper (pip install openai-whisper, or whisper.cpp\u2019s whisper-cli), or give --asr-cmd "yourtool {input} {outdir}"' };
			const r = used === 'whisper-cli'
				? run( 'whisper-cli', [ '-m', model, '-f', wav, '-ovtt', '-of', path.join( tmp, 'in' ), '-l', lang.split( '-' )[ 0 ] ] )
				: run( 'whisper', [ wav, '--model', model, '--language', lang.split( '-' )[ 0 ], '--output_format', 'vtt', '--output_dir', tmp, '--fp16', 'False', '--verbose', 'False' ] );
			if ( r.status !== 0 ) return { error: `${ used } failed: ` + ( r.stderr || '' ).trim().split( '\n' ).pop() };

		}
		const parsed = parseVtt( await fs.readFile( vtt, 'utf8' ) );
		const cues = parsed.cues.map( c => ( { id: null, start: c.start, end: c.end, text: c.text.replace( /<[^>]+>/g, '' ) } ) );
		const f = await vttFile( { cues, language: ctx.baseLanguage, source: 'asr', scene: { repo: ctx.rj.scene.repo, file: ctx.rj.scene.file, commit: ctx.rj.scene.commit }, exporter: TOOL, asr: { model: path.basename( model ), version: engineVersion( used === 'custom' ? 'custom' : used, version ) }, ids: false } );
		return f ? { text: f.text } : { error: 'the transcription is empty' };

	} finally { await fs.rm( tmp, { recursive: true, force: true } ); }

}

// ── command line ────────────────────────────────────────────────────────────────────────────────

function parseArgs( argv ) {

	const a = { _: [] };
	const flags = new Set( [ 'check', 'fill', 'asr', 'json', 'dry-run', 'replace', 'help' ] );
	for ( let i = 0; i < argv.length; i ++ ) {

		const t = argv[ i ];
		if ( t === '--add-track' ) { a[ 'add-track' ] = [ argv[ ++ i ], argv[ ++ i ] ]; continue; }
		if ( t.startsWith( '--' ) ) { const k = t.slice( 2 ); if ( flags.has( k ) ) a[ k ] = true; else a[ k ] = argv[ ++ i ]; } else a._.push( t );

	}
	return a;

}

const ICON = { present: 'present', stale: 'STALE  ', missing: 'MISSING', error: 'ERROR  ' };

export async function main( argv, out = console ) {

	const a = parseArgs( argv );
	if ( a.help || ( ! a.check && ! a.fill && ! a[ 'add-track' ] ) ) { out.log( 'usage: node tools/captions.mjs --check | --fill [--asr] | --add-track <lang> <file> --render <name>   (see the top of the file)' ); return a.help ? 0 : 2; }
	const root = path.resolve( a.root || '.' ), rendersDir = a.renders || 'renders', language = a.language || 'en';
	let names;
	try { names = ( await fs.readdir( path.join( root, rendersDir ), { withFileTypes: true } ) ).filter( d => d.isDirectory() ).map( d => d.name ).sort(); } catch ( e ) { out.error( `no ${ rendersDir }/ in ${ root } (--root)` ); return 2; }
	if ( a.only ) names = names.filter( n => n === a.only );
	if ( a[ 'add-track' ] ) names = names.filter( n => n === a.render );
	if ( names.length === 0 ) { out.error( a.only || a.render ? `no render "${ a.only || a.render }"` : `no renders in ${ rendersDir }/` ); return 2; }

	const dryRun = !! a[ 'dry-run' ], results = [];
	const asr = a.asr ? { engine: a[ 'asr-engine' ] || 'auto', model: a[ 'asr-model' ] || 'base.en', cmd: a[ 'asr-cmd' ] || null, version: a[ 'asr-version' ] || null } : null;
	let code = 0, wroteAny = false;

	for ( const name of names ) {

		const ctx = await load( root, rendersDir, name, { language } );
		if ( a[ 'add-track' ] && ! ctx.error ) {

			const [ lang, file ] = a[ 'add-track' ];
			let text;
			try { text = await readTranslation( file ); } catch ( e ) { out.error( `${ name }: ${ e.message }` ); return 2; }
			const r = await addTrack( ctx, lang, text, { dryRun } );
			if ( r.error ) { out.error( `${ name }: ${ r.error }` ); return 1; }
			out.log( `${ name }: ${ dryRun ? 'would write' : 'wrote' } ${ r.path }` );
			wroteAny = true;
			continue;

		}
		let before = await inspect( ctx ), result = { before, wrote: [], left: [] };
		if ( a.fill && before.state !== 'error' && ( before.state !== 'present' || a.replace ) ) {

			const r = await fill( ctx, { replace: !! a.replace, asr, dryRun } );
			result.wrote = r.wrote; result.left = r.left;
			if ( r.wrote.length ) wroteAny = true;

		}
		// after a write, read the render again: the manifest, master and files on disk are what is to be judged, not what was loaded
		const after = a.fill && ! dryRun && result.wrote.length ? await inspect( await load( root, rendersDir, name, { language } ) ) : before;
		result.after = after;
		results.push( { name, ...result } );

	}
	if ( a[ 'add-track' ] ) return 0;

	if ( a.json ) out.log( JSON.stringify( results.map( r => ( { name: r.name, state: r.after.state, before: r.before.state, tracks: r.after.tracks.map( t => ( { path: t.path, state: t.state, reasons: t.reasons, action: t.action } ) ), wrote: r.wrote, left: r.left, error: r.after.error } ) ), null, 2 ) );
	else {

		for ( const r of results ) {

			const s = r.after;
			if ( s.state === 'error' ) { out.log( `${ ICON.error }  ${ r.name }  ${ s.error }` ); continue; }
			for ( const t of s.tracks ) out.log( `${ ICON[ t.state ] }  ${ r.name }/${ t.path }${ t.reasons.length ? '  ' + t.reasons.join( '; ' ) : '' }` );
			for ( const n of s.tracks.flatMap( t => t.notes || [] ) ) out.log( `         note: ${ n }` );
			if ( a.fill ) for ( const w of r.wrote ) out.log( `         ${ dryRun ? 'would write' : 'wrote' } ${ r.name }/${ w }` );
			if ( a.fill ) for ( const l of r.left ) out.log( `         left: ${ l.path }: ${ l.why }` );

		}
		const counts = { present: 0, stale: 0, missing: 0, error: 0 };
		for ( const r of results ) counts[ r.after.state ] ++;
		out.log( `${ results.length } render${ results.length === 1 ? '' : 's' }: ${ counts.present } present, ${ counts.stale } stale, ${ counts.missing } missing${ counts.error ? `, ${ counts.error } could not be judged` : '' }${ a.fill ? ( wroteAny ? '' : '. Nothing to write.' ) : '' }` );

	}
	for ( const r of results ) { if ( r.after.state === 'error' ) code = Math.max( code, 2 ); else if ( r.after.state !== 'present' ) code = Math.max( code, 1 ); }
	return code;

}

/** A translation from a .vtt (cues with ids) or a .json ({ id: text } or [{ id, text }]). */
async function readTranslation( file ) {

	const text = await fs.readFile( file, 'utf8' ).catch( () => { throw new Error( `cannot read ${ file }` ); } );
	if ( file.endsWith( '.json' ) ) {

		const j = JSON.parse( text );
		return Array.isArray( j ) ? Object.fromEntries( j.map( c => [ c.id, c.text ] ) ) : j;

	}
	const { cues, problems } = parseVtt( text );
	if ( problems.length ) throw new Error( `${ file }: ${ problems[ 0 ] }` );
	if ( cues.some( c => ! c.id ) ) throw new Error( `${ file }: a cue has no id: a translation shares the scene's cue ids` );
	return Object.fromEntries( cues.map( c => [ c.id, c.text ] ) );

}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) main( process.argv.slice( 2 ) ).then( c => process.exit( c ) );
