// Run: node docs/player/__tests__/resolve.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveBase, followsBranch, formatDuration, parseGh, pinnedBase, describeFailure, alternateBases, presentMode, cueParam, locateCue, mirrorsFromCanonical, candidateBases } from '../resolve.js';

const B = 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/';
let pass = 0, fail = 0;
const test = ( name, fn ) => { try { fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } };

test( 'the folder, with or without the trailing slash', () => {

	assert.strictEqual( resolveBase( B ).base, B );
	assert.strictEqual( resolveBase( B.slice( 0, -1 ) ).base, B );

} );
test( 'any file in the set resolves to its folder', () => {

	for ( const f of [ 'master.m3u8', 'render.json', 'poster.jpg', 'captions.vtt' ] ) assert.strictEqual( resolveBase( B + f ).base, B, f );
	assert.strictEqual( resolveBase( B + 'master.m3u8?x=1#y' ).base, B );

} );
test( 'a branch address can be pinned to the commit it points at now, and a pinned one is not a branch', () => {

	assert.deepStrictEqual( parseGh( B ), { owner: 'tejaswigowda', repo: 'test1', ref: 'main' } );
	const sha = 'ae6df736259b2786e5ce40caa3069b4a1ac7d686';
	assert.strictEqual( pinnedBase( B, sha ), `https://cdn.jsdelivr.net/gh/tejaswigowda/test1@${ sha }/renders/projectile/` );
	assert.strictEqual( pinnedBase( 'https://cdn.jsdelivr.net/gh/o/r@latest/renders/a+b-cubed/', sha ), `https://cdn.jsdelivr.net/gh/o/r@${ sha }/renders/a+b-cubed/` );
	assert.strictEqual( followsBranch( pinnedBase( B, sha ) ), false );
	assert.strictEqual( parseGh( 'https://example.com/x/' ), null );

} );
test( 'a failed playback names the file and the HTTP answer, not just hls.js\u2019s code', () => {

	const m = B + 'master.m3u8';
	assert.strictEqual( describeFailure( { details: 'fragLoadError', frag: { url: B + '1080p60/seg00004.m4s' }, response: { code: 404 } }, m ), 'Playback failed (fragLoadError): 1080p60/seg00004.m4s gave HTTP 404.' );
	assert.match( describeFailure( { details: 'fragLoadError', frag: { url: B + 'audio/seg00002.m4s' }, response: { code: 0 } }, m ), /audio\/seg00002\.m4s gave no HTTP answer/ );
	assert.match( describeFailure( { details: 'manifestLoadError', context: { url: m }, response: { code: 404 } }, m ), /master\.m3u8 gave HTTP 404/ );
	assert.match( describeFailure( { details: 'bufferAddCodecError' }, m ), /master\.m3u8 gave no response/ );

} );

test( 'present mode: in a frame, or present=true as a query or after the address; present=false wins', () => {

	assert.strictEqual( presentMode( {} ), false );
	assert.strictEqual( presentMode( { framed: true } ), true );
	assert.strictEqual( presentMode( { search: '?present=true' } ), true );
	assert.strictEqual( presentMode( { hash: '#' + B + '&present=true' } ), true );
	assert.strictEqual( presentMode( { hash: '#present=true&' + B } ), true );
	assert.strictEqual( presentMode( { search: '?present=false', framed: true } ), false );
	assert.strictEqual( presentMode( { hash: '#' + B + '&present=0', framed: true } ), false );
	assert.strictEqual( presentMode( { hash: '#' + B } ), false );

} );
test( '&present=true after the address is an option, not part of the address', () => {

	assert.strictEqual( resolveBase( B + '&present=true' ).base, B );
	assert.strictEqual( resolveBase( B + 'master.m3u8&present=true&x=1' ).base, B );
	assert.strictEqual( resolveBase( 'https://cdn.jsdelivr.net/gh/o/r@main/renders/a%2Bb-cubed&present=true' ).base, 'https://cdn.jsdelivr.net/gh/o/r@main/renders/a+b-cubed/' );

} );

test( 'C8: a link can name a cue: &cue=<id> after the address, or ?cue=<id>, and is not part of the address', () => {

	assert.strictEqual( cueParam( { hash: '#' + B + '&cue=intro-question' } ), 'intro-question' );
	assert.strictEqual( cueParam( { search: '?cue=intro-question', hash: '#' + B } ), 'intro-question' );
	assert.strictEqual( cueParam( { hash: '#' + B + '&present=true&cue=a%20b' } ), 'a b' );
	assert.strictEqual( cueParam( { hash: '#' + B } ), null );
	assert.strictEqual( cueParam( { hash: '#' + B + '&cue=' } ), null );
	assert.strictEqual( resolveBase( B + '&cue=intro-question' ).base, B );
	assert.strictEqual( resolveBase( B + 'master.m3u8&cue=x&present=true' ).base, B );

} );
test( 'C8: the cue is found by its id, and a missing one says what the render does have', () => {

	const cues = [ { id: 'intro-question', start: 0.8, end: 4.2, text: 'Why?' }, { id: 'cut-the-sides', start: 5.4, end: 9.7, text: 'Cut.' } ];
	assert.deepStrictEqual( locateCue( cues, 'cut-the-sides' ), { start: 5.4, end: 9.7, text: 'Cut.' } );
	assert.match( locateCue( cues, 'nope' ).error, /No cue "nope" in this render's captions\. Its cues are: intro-question, cut-the-sides\./ );
	assert.match( locateCue( [ { id: null, start: 1, end: 2, text: 'x' } ], 'a' ).error, /carry no cue ids.*tools\/captions\.mjs --fill/ );
	assert.match( locateCue( [], 'a' ).error, /carry no cue ids/ );
	assert.match( locateCue( [ { id: '1', start: 1, end: 2, text: 'x' }, { id: '2', start: 3, end: 4, text: 'y' } ], 'cue-x' ).error, /carry no cue ids/, 'positional numbers are not ids' );

} );
test( 'the GitHub page of the folder becomes the jsDelivr address', () => {

	assert.strictEqual( resolveBase( 'https://github.com/tejaswigowda/test1/tree/main/renders/projectile' ).base, B );
	assert.strictEqual( resolveBase( 'https://github.com/tejaswigowda/test1/tree/renders/renders/projectile/' ).base, 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@renders/renders/projectile/' );

} );
test( 'a percent-encoded hash, and the path without the host', () => {

	assert.strictEqual( resolveBase( encodeURIComponent( B ) ).base, B );
	assert.strictEqual( resolveBase( 'gh/tejaswigowda/test1@main/renders/projectile' ).base, B );
	assert.strictEqual( resolveBase( 'cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile' ).base, B );

} );
test( 'nothing, or something that is not an address, is an error', () => {

	assert.ok( resolveBase( '' ).error );
	assert.ok( resolveBase( 'projectile' ).error );

} );
test( 'a branch address is flagged, a commit address is not', () => {

	assert.strictEqual( followsBranch( B ), true );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/a/b@89f9272c7b891ab7bf798a2b58de4b3a08a36eab/renders/x/' ), false );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/a/b@89f9272/renders/x/' ), false );

} );
test( 'durations are m:ss', () => { assert.strictEqual( formatDuration( 80.7 ), '1:21' ); assert.strictEqual( formatDuration( 5 ), '0:05' ); } );

await test( 'a tag of the renders repository (<scene>/v<N>) is pinned, a branch is not', () => {

	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/' ), false );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@a+b-cubed/v12/a+b-cubed/' ), false );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/' ), true );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/latest/cafe/' ), true );

} );

await test( 'alternate places to serve the same immutable folder: other jsDelivr hosts, then the origin; none for any other address', () => {

	assert.deepStrictEqual( alternateBases( 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/' ), [
		'https://fastly.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/', 'https://gcore.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/', 'https://raw.githubusercontent.com/tejaswigowda/renders/cafe/v1/cafe/' ] );
	assert.deepStrictEqual( alternateBases( 'https://fastly.jsdelivr.net/gh/a/b@main/renders/x/' ), [
		'https://cdn.jsdelivr.net/gh/a/b@main/renders/x/', 'https://gcore.jsdelivr.net/gh/a/b@main/renders/x/', 'https://raw.githubusercontent.com/a/b/main/renders/x/' ] );
	assert.deepStrictEqual( alternateBases( 'https://example.com/renders/x/' ), [] );
	assert.deepStrictEqual( alternateBases( 'https://raw.githubusercontent.com/a/b/main/x/' ), [], 'the origin has nowhere else to go' );
	assert.deepStrictEqual( alternateBases( '' ), [] );

} );

await test( 'a failure names the file inside the render\'s folder whichever host failed', () => {

	const m = 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/master.m3u8';
	const raw = { details: 'fragLoadError', frag: { url: 'https://raw.githubusercontent.com/tejaswigowda/renders/cafe/v1/cafe/480p60/seg00015.m4s' }, response: { code: 404 } };
	assert.strictEqual( describeFailure( { ...raw, frag: { url: 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/480p60/seg00015.m4s' } }, m ), 'Playback failed (fragLoadError): 480p60/seg00015.m4s gave HTTP 404.' );
	assert.strictEqual( describeFailure( raw, 'https://raw.githubusercontent.com/tejaswigowda/renders/cafe/v1/cafe/master.m3u8' ), 'Playback failed (fragLoadError): 480p60/seg00015.m4s gave HTTP 404.' );

} );

test( 'G4: the canonical address resolves from a pasted file, a short form and a path, and keeps a "+" in a name', () => {

	const C = 'https://strataeditor.dev/video/a+b-cubed/v2/';
	assert.strictEqual( resolveBase( C ).base, C );
	assert.strictEqual( resolveBase( C + 'master.m3u8' ).base, C );
	assert.strictEqual( resolveBase( C + 'files.sha256' ).base, C );
	assert.strictEqual( resolveBase( 'video/a+b-cubed/v2' ).base, C );
	assert.strictEqual( resolveBase( '/video/a+b-cubed/v2/render.json' ).base, C );
	assert.strictEqual( resolveBase( 'video/cafe/v1', { origin: 'http://localhost:5503/' } ).base, 'http://localhost:5503/video/cafe/v1/' );
	assert.strictEqual( followsBranch( C ), false, 'a canonical address is a tag: it never follows a branch' );

} );
test( 'G4: a canonical address with no render.json read yet has the conventional mirrors, in order: the repository at its tag, then the archive', () => {

	// the archive is only claimed once it exists (DELIVERY.archive); today the repository's folder at the tag is the one mirror
	assert.deepStrictEqual( mirrorsFromCanonical( 'https://strataeditor.dev/video/a+b-cubed/v2/' ), [ 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@a+b-cubed/v2/a+b-cubed/' ] );
	assert.deepStrictEqual( mirrorsFromCanonical( B ), [] );
	assert.deepStrictEqual( mirrorsFromCanonical( 'https://strataeditor.dev/video/cafe/' ), [] );

} );
test( 'G4: candidates are the address, the render\'s own list in its order, then the other jsDelivr hostnames; nothing twice', () => {

	const C = 'https://strataeditor.dev/video/cafe/v1/', J = 'https://cdn.jsdelivr.net/gh/o/renders@cafe/v1/cafe/', A = 'https://archive.org/download/strata-cafe-v1/';
	const c = candidateBases( C, { canonical: C, mirrors: [ J, A ] } );
	assert.deepStrictEqual( c.slice( 0, 3 ), [ C, J, A ] );
	assert.deepStrictEqual( c.slice( 3 ), [ 'https://fastly.jsdelivr.net/gh/o/renders@cafe/v1/cafe/', 'https://gcore.jsdelivr.net/gh/o/renders@cafe/v1/cafe/', 'https://raw.githubusercontent.com/o/renders/cafe/v1/cafe/' ] );
	assert.strictEqual( new Set( c ).size, c.length );
	// opened at a mirror, the address comes first and the canonical one is still tried
	assert.deepStrictEqual( candidateBases( J, { canonical: C, mirrors: [ J, A ] } ).slice( 0, 3 ), [ J, C, A ] );
	// before render.json is read the convention stands in; a legacy publication (no canonical) adds nothing, exactly as before
	assert.strictEqual( candidateBases( C )[ 1 ], 'https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/' );
	assert.deepStrictEqual( candidateBases( B, { storage: 'renders-repo', url: B } ), [ B, ...alternateBases( B ) ] );
	assert.deepStrictEqual( candidateBases( 'https://example.com/x/' ), [ 'https://example.com/x/' ] );

} );
test( 'the inline script in index.html that decides present mode before first paint gives the same answer as presentMode() for every address', () => {

	const html = readFileSync( path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', 'index.html' ), 'utf8' );
	const code = /<script>([\s\S]*?present=[\s\S]*?)<\/script>/.exec( html )[ 1 ];
	const cases = [ [ '', '', false ], [ '', '#https://x/&present=true', false ], [ '?present=true', '', false ], [ '', '#x&present=1', false ], [ '', '#x&present=', false ], [ '', '#x&present=false', true ],
		[ '?present=0', '', true ], [ '', '#x&present=TRUE', false ], [ '', '#x', true ], [ '', '#x', false ], [ '?present=false', '#x&present=true', true ], [ '', '#x&present=maybe', true ] ];
	for ( const [ search, hash, framed ] of cases ) {

		const classes = new Set();
		const sandbox = { location: { search, hash }, document: { documentElement: { classList: { add: c => classes.add( c ) } } }, window: {} };
		sandbox.window.self = sandbox.window; sandbox.window.top = framed ? {} : sandbox.window;
		vm.runInNewContext( code, sandbox );
		assert.strictEqual( classes.has( 'present' ), presentMode( { search, hash, framed } ), JSON.stringify( { search, hash, framed } ) );

	}

} );
console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
