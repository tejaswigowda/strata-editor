// Run: node docs/editor/js/export/__tests__/releases.test.mjs
// R2-R7 and R9 of the release-architecture work order, against an in-memory GitHub (fakeGithub.mjs), plus the pure parts: tags, pinned addresses, the publication
// block, the publish gate, staleness and the verify plan. The real GitHub and jsDelivr are exercised by the end-to-end run in guides/PUBLISH.md.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
if ( ! globalThis.crypto ) globalThis.crypto = webcrypto;
import {
	ReleaseError, sceneSlug, tagFor, parseTag, nextVersion, releaseTags, isPinnedRef, pinnedUrl, releaseBase, playerLink, locationOf, publicationBlock, validatePublication,
	publicationOf, gateRelease, assessStaleness, verifyPlan, verifyOutcome, releaseSummary, planRelease, commitRelease, listReleaseTags, STORAGE,
} from '../releases.js';
import { buildRenderJson, assessDeterminism, validateRenderJson } from '../renderJson.js';
import { sidecarText } from '../frameHashes.js';
import { assemblePublishSet } from '../publishSet.js';
import { fakeGithub } from './fakeGithub.mjs';

let pass = 0, fail = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const SCENE = { repo: 'tejaswigowda/test1', file: 'a+b-cubed.json', branch: 'main', commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', hash: 'sha256:' + 'ab'.repeat( 32 ) };
const RENDER = { mode: 'offline', renderer: 'WebGLRenderer', device: 'webgl2', encoder: 'software', fps: 24, frames: 240, frameRange: [ 0, 239 ], width: 640, height: 360, renderedAt: '2026-11-02T10:00:00Z' };
const HASHES = Array.from( { length: 240 }, ( _, i ) => ( i % 16 ).toString( 16 ).repeat( 64 ) );
const SIDECAR = sidecarText( { hashes: HASHES, first: 0, width: 640, height: 360, fps: 24 } );
const FH = { count: 240, root: 'sha256:' + 'cd'.repeat( 32 ) };
const VERIFIED = { method: 'shuffled-order', every: 1, seed: 1, frames_checked: 240, of: 240, complete: true, passed: true, mismatched_frames: [], mismatched_count: 0 };
const RUNGS = [ { name: '360p24', width: 640, height: 360, bitrateKbps: 800, playlist: '360p24/index.m3u8', segments: 4, maxSegmentBytes: 100_000 } ];
const mk = ( over = {}, det = {}, extra = {} ) => buildRenderJson( {
	scene: SCENE, render: { ...RENDER, ...over }, renditions: RUNGS, files: [ { path: 'a', bytes: 5 } ], frameHashes: { path: 'frame-hashes.txt', ...FH },
	determinism: assessDeterminism( { mode: over.mode || 'offline', encoder: 'software', frameHashes: FH, verification: VERIFIED, ...det } ), ...extra,
} );

// ── names and addresses ─────────────────────────────────────────────────────

await test( 'tags are <slug>/v<N>; the next version counts only this slug and never reuses a number', () => {

	assert.strictEqual( sceneSlug( 'a+b-cubed.json' ), 'a+b-cubed' );
	assert.strictEqual( sceneSlug( 'shorts/area volume.json' ), 'area-volume' );
	assert.strictEqual( tagFor( 'a+b-cubed', 2 ), 'a+b-cubed/v2' );
	assert.deepStrictEqual( parseTag( 'a+b-cubed/v12' ), { slug: 'a+b-cubed', version: 12 } );
	assert.strictEqual( parseTag( 'a+b-cubed/v0' ), null );
	assert.strictEqual( parseTag( 'v1' ), null );
	assert.strictEqual( parseTag( 'a/v1', 'b' ), null );
	assert.strictEqual( nextVersion( [], 'x' ), 1 );
	assert.strictEqual( nextVersion( [ 'x/v1', 'x/v2', 'y/v9', 'x/v2-rc', 'x/v10' ], 'x' ), 11 );
	assert.strictEqual( nextVersion( [ 'x/v1', 'x/v3' ], 'x' ), 4, 'a gap is never filled' );
	assert.deepStrictEqual( releaseTags( [ 'x/v1', 'y/v1', 'x/v10', 'x/v2' ], 'x' ), [ 'x/v10', 'x/v2', 'x/v1' ] );

} );

await test( 'R4: every address is pinned to a tag or a commit; a branch, latest or HEAD is refused', () => {

	assert.ok( isPinnedRef( 'a+b-cubed/v1' ) && isPinnedRef( 'a1b2c3d' ) && isPinnedRef( 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' ) );
	for ( const bad of [ 'latest', 'main', 'master', 'HEAD', 'v1', 'abc', '' ] ) {

		assert.ok( ! isPinnedRef( bad ), bad );
		assert.throws( () => pinnedUrl( { repo: 'o/renders', ref: bad, path: 'x/' } ), e => e instanceof ReleaseError && e.code === 'bad-input', bad );

	}
	assert.strictEqual( pinnedUrl( { repo: 'o/renders', ref: 'a+b-cubed/v1', path: 'a+b-cubed/master.m3u8' } ), 'https://cdn.jsdelivr.net/gh/o/renders@a+b-cubed/v1/a+b-cubed/master.m3u8' );
	const base = releaseBase( { repo: 'o/renders', tag: 'a+b-cubed/v1', slug: 'a+b-cubed' } );
	assert.strictEqual( base, 'https://cdn.jsdelivr.net/gh/o/renders@a+b-cubed/v1/a+b-cubed/' );
	assert.strictEqual( playerLink( 'https://x/player/', base ), 'https://x/player/#' + base );
	assert.match( playerLink( 'https://x/player/', base, { cue: 'intro-question' } ), /&cue=intro-question$/ );
	assert.throws( () => playerLink( 'https://x/player/', 'https://cdn.jsdelivr.net/gh/o/renders@latest/a/' ), ReleaseError );
	assert.throws( () => playerLink( 'https://x/player/', 'https://cdn.jsdelivr.net/gh/o/renders@main/a/' ), ReleaseError );
	// the module has no way to produce an unpinned address: its source builds no @latest
	const src = readFileSync( path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', 'releases.js' ), 'utf8' ).split( '\n' ).filter( l => ! /^\s*(\/\/|\*|\/\*)/.test( l ) ).join( '\n' );
	assert.ok( ! /@latest|@main|@master/.test( src ), 'no code line builds an unpinned address' );

} );

await test( 'R8: a legacy render (no publication block) is inferred as source-repo and is pinned by the commit it is found at', () => {

	const legacy = mk();
	assert.strictEqual( legacy.publication, undefined );
	assert.deepStrictEqual( validateRenderJson( legacy ), [] );
	const p = publicationOf( legacy, { repo: 'tejaswigowda/test1', path: 'renders/a+b-cubed' } );
	assert.deepStrictEqual( [ p.storage, p.inferred, p.tag ], [ STORAGE.source, true, null ] );
	const at = locationOf( p, { commit: 'fdb3a56' } );
	assert.strictEqual( at.base, 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@fdb3a56/renders/a+b-cubed/' );
	assert.strictEqual( locationOf( p ).base, null, 'with no commit there is no pinned address to hand out' );
	const pub = publicationBlock( { storage: STORAGE.renders, repo: 'o/renders', path: 'a+b-cubed', tag: 'a+b-cubed/v1', sizeBytes: 1234 } );
	assert.deepStrictEqual( validatePublication( pub ), [] );
	assert.strictEqual( locationOf( { ...pub } ).base, pub.url );
	assert.ok( validatePublication( { ...pub, tag: 'latest' } ).some( m => /tag must be/.test( m ) ) );
	assert.ok( validatePublication( { ...pub, url: 'https://cdn.jsdelivr.net/gh/o/renders@main/a+b-cubed/' } ).some( m => /pinned/.test( m ) ) );
	assert.deepStrictEqual( validatePublication( publicationBlock( { storage: STORAGE.source, repo: 'o/r', path: 'renders/x' } ) ), [] );

} );

await test( 'R8: the list reads a version-1 render.json already published (one boolean, no caption_tracks) without throwing', () => {

	const v1 = mk(); v1.version = 1;
	delete v1.render.determinism; v1.render.deterministic = false; v1.render.not_deterministic_because = [ 'x' ];
	delete v1.outputs.caption_tracks; v1.outputs.captions = 'captions.vtt';
	const s = releaseSummary( v1, { ref: 'fdb3a56', base: 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@fdb3a56/renders/a+b-cubed/', repo: 'tejaswigowda/test1' } );
	assert.deepStrictEqual( [ s.frames, s.bytes, s.legacyFormat, s.storage ], [ false, false, true, STORAGE.source ] );
	assert.strictEqual( s.links.captions[ 0 ].url, s.base + 'captions.vtt' );
	assert.strictEqual( verifyPlan( v1 ).can, false, 'a version-1 render cannot be verified' );

} );

await test( 'assemblePublishSet records publication, with the folder and the size of every other file', () => {

	const set = assemblePublishSet( {
		path: 'a+b-cubed', scene: SCENE, render: { ...RENDER, frames: 240 }, rungs: [ { rung: { name: '360p24', width: 640, height: 360, kbps: 800 }, packaged: { init: Uint8Array.of( 1 ), segments: [ { name: 'seg00001.m4s', data: new Uint8Array( 50 ) } ], playlist: '#EXTM3U', maxSegmentBytes: 50, codec: 'avc1.64001f', bandwidth: 1, averageBandwidth: 1 } } ],
		poster: new Uint8Array( 10 ), determinism: { mode: 'offline', encoder: 'software' }, publication: { storage: STORAGE.renders, repo: 'o/renders', tag: 'a+b-cubed/v1' },
	} );
	const p = set.renderJson.publication;
	assert.deepStrictEqual( [ p.storage, p.repo, p.path, p.tag ], [ 'renders-repo', 'o/renders', 'a+b-cubed', 'a+b-cubed/v1' ] );
	assert.strictEqual( p.url, 'https://cdn.jsdelivr.net/gh/o/renders@a+b-cubed/v1/a+b-cubed/' );
	assert.strictEqual( p.size_bytes, set.total - set.files[ 0 ].bytes.length );
	assert.deepStrictEqual( validatePublication( p ), [] );
	assert.ok( set.files.every( f => f.path.startsWith( 'a+b-cubed/' ) ) );

} );

// ── R6: the gate ────────────────────────────────────────────────────────────

await test( 'R6: a failed check, a size error or an invalid render.json blocks the publish; it does not warn and continue', () => {

	assert.deepStrictEqual( gateRelease( { renderJson: mk() } ), { ok: true, failures: [] } );
	const frames = mk(); frames.checks.frame_count_matches_duration = false;
	const g1 = gateRelease( { renderJson: frames } );
	assert.ok( ! g1.ok && g1.failures.some( m => /frame count does not match the duration/.test( m ) ) );
	const audio = mk(); audio.checks.audio_duration_matches_video = false;
	assert.ok( gateRelease( { renderJson: audio } ).failures.some( m => /narration audio is not the same length/.test( m ) ) );
	const seg = mk(); seg.checks.segments_under_20mb = false;
	assert.ok( gateRelease( { renderJson: seg } ).failures.some( m => /20 MB/.test( m ) ) );
	assert.ok( ! gateRelease( { renderJson: mk(), errors: [ 'a segment is 21 MB' ] } ).ok );
	const invalid = mk(); invalid.scene.hash = 'nope';
	assert.ok( gateRelease( { renderJson: invalid } ).failures.some( m => /scene\.hash/.test( m ) ) );
	assert.ok( ! gateRelease( { renderJson: mk( {}, {}, { publication: { storage: 'renders-repo', repo: 'o/renders', path: 'x', tag: 'main', url: null, size_bytes: 1 } } ) } ).ok );
	assert.ok( ! gateRelease( { renderJson: null } ).ok );

} );

// ── D: staleness ────────────────────────────────────────────────────────────

await test( 'R5: current / behind / none, with the commit distance counted over the commits that change the scene', () => {

	const A = 'a'.repeat( 40 ), H = 'f'.repeat( 40 ), c = ( ...s ) => s.map( x => ( { sha: x.repeat( 40 ) } ) );
	assert.strictEqual( assessStaleness( { published: false } ).state, 'none' );
	const same = assessStaleness( { published: true, sourceCommit: A, headCommit: A } );
	assert.deepStrictEqual( [ same.state, same.behind ], [ 'current', 0 ] );
	assert.strictEqual( assessStaleness( { published: true, sourceCommit: A.slice( 0, 7 ), headCommit: A } ).state, 'current', 'a short sha is the same commit' );
	// four commits since the render, three of them change the scene
	const compare = { status: 'ahead', ahead_by: 4, commits: c( '1', '2', '3', H.slice( 0, 1 ) ) };
	const s = assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare, touching: [ 'f'.repeat( 40 ), '3'.repeat( 40 ), '1'.repeat( 40 ), '9'.repeat( 40 ) ] } );
	assert.deepStrictEqual( [ s.state, s.behind, s.otherCommits, s.atLeast ], [ 'behind', 3, 1, false ] );
	assert.match( s.reason, /3 commits changed this scene since the render \(and 1 more commit that does not touch it\)/ );
	assert.strictEqual( assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare: { status: 'ahead', ahead_by: 1, commits: c( 'f' ) }, touching: [ 'f'.repeat( 40 ) ] } ).behind, 1 );
	// newer commits that do not change the scene file do not make the render stale, and it says so
	const calm = assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare: { status: 'ahead', ahead_by: 2, commits: c( '1', 'f' ) }, touching: [ '8'.repeat( 40 ) ] } );
	assert.deepStrictEqual( [ calm.state, calm.behind, calm.otherCommits ], [ 'current', 0, 2 ] );
	assert.match( calm.reason, /none of which change this scene/ );
	// GitHub lists at most 250 commits: past that the count is a floor
	const big = assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare: { status: 'ahead', ahead_by: 400, commits: c( '1', '2' ) }, touching: [ '1'.repeat( 40 ) ] } );
	assert.deepStrictEqual( [ big.state, big.behind, big.atLeast ], [ 'behind', 1, true ] );
	// history rewritten, or no comparison: behind, by an unknown amount, and not exact
	const diverged = assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare: { status: 'diverged', ahead_by: 1, commits: c( 'f' ) } } );
	assert.deepStrictEqual( [ diverged.state, diverged.behind, diverged.exact ], [ 'behind', null, false ] );
	assert.strictEqual( assessStaleness( { published: true, sourceCommit: A, headCommit: H, compare: null } ).state, 'behind' );
	assert.strictEqual( assessStaleness( { published: true, sourceCommit: null, headCommit: H } ).state, 'behind', 'a render that does not say where it came from cannot be called current' );

} );

// ── F, R9: verify ───────────────────────────────────────────────────────────

await test( 'R9: verify says cannot-verify, and why, when the render declared its frames non-deterministic or published nothing to compare', () => {

	const good = verifyPlan( mk() );
	assert.ok( good.can );
	assert.deepStrictEqual( [ good.settings.commit, good.settings.fps, good.settings.range, good.settings.sidecar ], [ SCENE.commit, 24, [ 0, 239 ], 'frame-hashes.txt' ] );
	const nd = mk( {}, { verification: null } );   // never verified: frames false
	assert.strictEqual( nd.render.determinism.frames, false );
	const p = verifyPlan( nd );
	assert.ok( ! p.can );
	assert.match( p.why[ 0 ], /declared its frames non-deterministic/ );
	const o = verifyOutcome( { plan: p, published: SIDECAR, rebuilt: { first: 0, hashes: HASHES } } );
	assert.strictEqual( o.result, 'cannot-verify', 'a matching rebuild of a non-deterministic render still does not count as a verification' );
	assert.match( o.summary, /^Cannot verify: The render declared/ );
	const rt = mk( { mode: 'realtime', frames: 240 }, { mode: 'realtime' } );
	assert.ok( verifyPlan( rt ).why.some( m => /realtime/.test( m ) ) );
	const nohash = mk(); delete nohash.outputs.frame_hashes;
	assert.ok( verifyPlan( nohash ).why.some( m => /no per-frame hashes/.test( m ) ) );
	const nocommit = mk(); nocommit.scene.commit = null;
	assert.ok( verifyPlan( nocommit ).why.some( m => /does not record the scene commit/.test( m ) ) );
	assert.ok( ! verifyPlan( null ).can );

} );

await test( 'verify compares the rebuilt hashes with the published sidecar: match, or differs at exactly these frames', () => {

	const plan = verifyPlan( mk() );
	const m = verifyOutcome( { plan, published: SIDECAR, rebuilt: { first: 0, hashes: HASHES.slice() }, sameDevice: true } );
	assert.deepStrictEqual( [ m.result, m.frames ], [ 'match', 240 ] );
	const changed = HASHES.slice(); [ 100, 101, 102, 200 ].forEach( n => { changed[ n ] = 'e'.repeat( 64 ); } );
	const d = verifyOutcome( { plan, published: SIDECAR, rebuilt: { first: 0, hashes: changed }, sameDevice: true } );
	assert.deepStrictEqual( [ d.result, d.frames ], [ 'differs', [ 100, 101, 102, 200 ] ] );
	assert.match( d.summary, /^Differs at frames \[100-102, 200\] \(4 of 240\)\.$/ );
	assert.match( verifyOutcome( { plan, published: SIDECAR, rebuilt: { first: 0, hashes: changed }, sameDevice: false } ).summary, /may be the device and not the scene/ );
	assert.match( verifyOutcome( { plan, published: SIDECAR, rebuilt: { first: 0, hashes: HASHES }, sameDevice: false } ).summary, /different device/ );
	assert.strictEqual( verifyOutcome( { plan, published: SIDECAR, rebuilt: { first: 0, hashes: HASHES.slice( 0, 200 ) } } ).result, 'differs', 'missing frames are a difference' );
	assert.strictEqual( verifyOutcome( { plan, published: 'garbage', rebuilt: { first: 0, hashes: HASHES } } ).result, 'cannot-verify' );
	assert.strictEqual( verifyOutcome( { plan, published: SIDECAR, rebuilt: null } ).result, 'cannot-verify' );

} );

await test( 'the list shows tag, date, duration, fps, ladder, size, source commit with a link, both determinism claims and links to the files', () => {

	const pub = publicationBlock( { storage: STORAGE.renders, repo: 'o/renders', path: 'a+b-cubed', tag: 'a+b-cubed/v2', sizeBytes: 4_200_000 } );
	const j = mk( {}, {}, { publication: pub } );
	const s = releaseSummary( j, { ref: 'a+b-cubed/v2', base: pub.url, repo: 'o/renders' } );
	assert.deepStrictEqual( [ s.tag, s.durationS, s.fps, s.ladder, s.sizeBytes, s.frames, s.bytes, s.date ], [ 'a+b-cubed/v2', 10, 24, [ '360p24' ], 4_200_000, true, true, '2026-11-02T10:00:00Z' ] );
	assert.strictEqual( s.sourceUrl, 'https://github.com/tejaswigowda/test1/commit/' + SCENE.commit );
	assert.strictEqual( s.links.renderJson, pub.url + 'render.json' );
	assert.strictEqual( s.links.poster, pub.url + 'poster.jpg' );

} );

// ── R2, R3, R7: publishing, against a fake GitHub ───────────────────────────

const bytes = s => new TextEncoder().encode( s );
const set = ( slug, names, tag = null ) => names.map( n => ( { path: `${ slug }/${ n }`, bytes: bytes( `${ n } of ${ tag }` ) } ) );

await test( 'R2: the scene repository is refused as a renders target unless that is asked for, and is never written to', async () => {

	const gh = fakeGithub( { repos: { 'o/scenes': {}, 'o/renders': { empty: true } } } );
	await assert.rejects( planRelease( gh.api, { repo: 'o/scenes', slug: 'x', sceneRepo: 'o/scenes' } ), e => e.code === 'not-separate' && /separate repository/.test( e.message ) );
	await assert.rejects( planRelease( gh.api, { repo: 'O/Scenes', slug: 'x', sceneRepo: 'o/scenes' } ), e => e.code === 'not-separate', 'case does not get around it' );
	assert.deepStrictEqual( gh.calls, [], 'refused before a single call' );
	const plan = await planRelease( gh.api, { repo: 'o/renders', slug: 'x', sceneRepo: 'o/scenes' } );
	await commitRelease( gh.api, plan, { files: set( 'x', [ 'render.json' ] ) } );
	assert.ok( ! gh.calls.some( c => c.path.startsWith( '/repos/o/scenes' ) && c.method !== 'GET' ), 'the scene repo gets no write' );
	assert.deepStrictEqual( ( await planRelease( gh.api, { repo: 'o/scenes', slug: 'x', sceneRepo: 'o/scenes', allowSceneRepo: true } ) ).tag, 'x/v1', 'the legacy layout is an explicit opt-in' );

} );

await test( 'the first publish initialises an empty renders repo, commits <slug>/ and tags it <slug>/v1', async () => {

	const gh = fakeGithub( { repos: { 'o/renders': { empty: true } } } );
	const plan = await planRelease( gh.api, { repo: 'o/renders', slug: 'a+b-cubed', sceneRepo: 'o/test1' } );
	assert.deepStrictEqual( [ plan.tag, plan.version, plan.needsInit ], [ 'a+b-cubed/v1', 1, true ] );
	const r = await commitRelease( gh.api, plan, { files: set( 'a+b-cubed', [ 'render.json', 'master.m3u8', '360p24/seg1.m4s' ], 'v1' ), message: 'Publish a+b-cubed/v1' } );
	assert.strictEqual( r.tag, 'a+b-cubed/v1' );
	const refs = gh.refs( 'o/renders' );
	assert.strictEqual( refs[ 'refs/tags/a+b-cubed/v1' ], r.commit.sha, 'the tag points at the publish commit' );
	assert.strictEqual( refs[ 'refs/heads/main' ], r.commit.sha );
	const files = gh.files( 'o/renders', 'refs/tags/a+b-cubed/v1' );
	assert.deepStrictEqual( Object.keys( files ).sort(), [ 'README.md', 'a+b-cubed/360p24/seg1.m4s', 'a+b-cubed/master.m3u8', 'a+b-cubed/render.json' ] );
	assert.match( files[ 'README.md' ].toString(), /one tag per release/ );
	assert.strictEqual( r.base, 'https://cdn.jsdelivr.net/gh/o/renders@a+b-cubed/v1/a+b-cubed/' );

} );

await test( 'R3: a re-render is v2; v1 stays exactly where it was, files and all, and other scenes are untouched', async () => {

	const gh = fakeGithub( { repos: { 'o/renders': { files: { 'README.md': 'hi', 'other/render.json': 'OTHER', 'other/720p/seg.m4s': 'OTHER2' } } } } );
	const one = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	const r1 = await commitRelease( gh.api, one, { files: set( 'x', [ 'render.json', '720p/a.m4s', '480p/a.m4s' ], 'v1' ) } );
	const two = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	assert.deepStrictEqual( [ two.tag, two.needsInit ], [ 'x/v2', false ] );
	const r2 = await commitRelease( gh.api, two, { files: set( 'x', [ 'render.json', '720p/a.m4s' ], 'v2' ) } );
	const refs = gh.refs( 'o/renders' );
	assert.strictEqual( refs[ 'refs/tags/x/v1' ], r1.commit.sha, 'v1 was not moved' );
	assert.strictEqual( refs[ 'refs/tags/x/v2' ], r2.commit.sha );
	const v1 = gh.files( 'o/renders', 'refs/tags/x/v1' ), v2 = gh.files( 'o/renders', 'refs/tags/x/v2' );
	assert.ok( 'x/480p/a.m4s' in v1 && v1[ 'x/render.json' ].toString() === 'render.json of v1', 'v1 still has its own files' );
	assert.ok( ! ( 'x/480p/a.m4s' in v2 ), 'v2 does not carry a rung it no longer has (the folder was replaced)' );
	assert.strictEqual( v2[ 'x/render.json' ].toString(), 'render.json of v2' );
	assert.strictEqual( v2[ 'other/render.json' ].toString(), 'OTHER' );
	assert.strictEqual( v2[ 'other/720p/seg.m4s' ].toString(), 'OTHER2', 'another scene\u2019s folder is untouched' );
	assert.ok( ! gh.calls.some( c => /git\/refs\/tags/.test( c.path ) && c.method !== 'GET' ), 'no tag is ever PATCHed or deleted' );
	assert.deepStrictEqual( ( await listReleaseTags( gh.api, { repo: 'o/renders', slug: 'x' } ) ).map( t => [ t.tag, t.version ] ), [ [ 'x/v2', 2 ], [ 'x/v1', 1 ] ] );
	assert.deepStrictEqual( ( await listReleaseTags( gh.api, { repo: 'o/renders', slug: 'other' } ) ), [] );

} );

await test( 'R7: publishing to an existing tag is refused, at the plan and (if it appears meanwhile) at the tag, and nothing moves', async () => {

	const gh = fakeGithub( { repos: { 'o/renders': {} } } );
	const p1 = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	await commitRelease( gh.api, p1, { files: set( 'x', [ 'render.json' ], 'v1' ) } );
	await assert.rejects( planRelease( gh.api, { repo: 'o/renders', slug: 'x', version: 1 } ), e => e.code === 'tag-exists' && /never moves; a re-render is v2/.test( e.message ) );
	const before = gh.refs( 'o/renders' );
	// somebody creates x/v2 between the plan and the commit: the tag POST is refused by GitHub (422) and so is the publish
	const p2 = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	gh.createTagElsewhere( 'o/renders', 'x/v2' );
	const tagged = gh.refs( 'o/renders' )[ 'refs/tags/x/v2' ];
	await assert.rejects( commitRelease( gh.api, p2, { files: set( 'x', [ 'render.json' ], 'v2' ) } ), e => e.code === 'tag-exists' );
	assert.strictEqual( gh.refs( 'o/renders' )[ 'refs/tags/x/v2' ], tagged, 'the existing tag was not moved' );
	assert.strictEqual( gh.refs( 'o/renders' )[ 'refs/tags/x/v1' ], before[ 'refs/tags/x/v1' ] );

} );

await test( 'the branch moves fast-forward only: if it moved meanwhile, nothing is published and no tag is made', async () => {

	const gh = fakeGithub( { repos: { 'o/renders': {} } } );
	const plan = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	// plan reads, then the commit reads the head again: move the head between by wrapping the api
	let armed = true;
	const api = { get: gh.api.get, send: ( m, p, b ) => { if ( armed && /git\/commits$/.test( p ) ) { armed = false; gh.pushElsewhere( 'o/renders' ); } return gh.api.send( m, p, b ); } };
	await assert.rejects( commitRelease( api, plan, { files: set( 'x', [ 'render.json' ], 'v1' ) } ), e => e.code === 'branch-moved' );
	assert.ok( ! ( 'refs/tags/x/v1' in gh.refs( 'o/renders' ) ), 'no tag for a publish that did not happen' );

} );

await test( 'files outside the slug, and an empty set, are refused before anything is written', async () => {

	const gh = fakeGithub( { repos: { 'o/renders': {} } } );
	const plan = await planRelease( gh.api, { repo: 'o/renders', slug: 'x' } );
	const n = gh.calls.length;
	await assert.rejects( commitRelease( gh.api, plan, { files: [ { path: 'y/render.json', bytes: bytes( '{}' ) } ] } ), e => e.code === 'bad-input' );
	await assert.rejects( commitRelease( gh.api, plan, { files: [ { path: 'README.md', bytes: bytes( 'x' ) } ] } ), e => e.code === 'bad-input' );
	await assert.rejects( commitRelease( gh.api, plan, { files: [] } ), e => e.code === 'bad-input' );
	assert.strictEqual( gh.calls.length, n );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
