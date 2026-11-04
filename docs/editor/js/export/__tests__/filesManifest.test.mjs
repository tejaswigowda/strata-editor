// Run: node docs/editor/js/export/__tests__/filesManifest.test.mjs
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { MANIFEST_NAME, buildManifest, parseManifest, addManifest, verifyBase } from '../filesManifest.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

const enc = s => new TextEncoder().encode( s );
const sha = async b => createHash( 'sha256' ).update( b ).digest( 'hex' );
const files = () => [
	{ path: 'cafe/render.json', bytes: enc( '{"a":1}\n' ) },
	{ path: 'cafe/master.m3u8', bytes: enc( '#EXTM3U\n' ) },
	{ path: 'cafe/480p60/seg00001.m4s', bytes: enc( 'segment one' ) },
	{ path: 'cafe/480p60/init.mp4', bytes: enc( 'init' ) },
];

await test( 'the manifest is sha256sum -c format, sorted by path, relative to the folder, and never lists itself', async () => {

	const text = await buildManifest( [ ...files(), { path: 'cafe/' + MANIFEST_NAME, bytes: enc( 'stale' ) } ], 'cafe', sha );
	const lines = text.trimEnd().split( '\n' );
	assert.deepStrictEqual( lines.map( l => l.slice( 66 ) ), [ '480p60/init.mp4', '480p60/seg00001.m4s', 'master.m3u8', 'render.json' ] );
	assert.strictEqual( lines[ 0 ], `${ await sha( enc( 'init' ) ) }  480p60/init.mp4` );
	assert.ok( ! text.includes( MANIFEST_NAME ) );
	await assert.rejects( buildManifest( [ { path: 'other/x', bytes: enc( 'x' ) } ], 'cafe', sha ), /outside cafe/ );

} );

await test( 'parseManifest reads it back, and a malformed or duplicated line is an error and not skipped', async () => {

	const text = await buildManifest( files(), 'cafe', sha );
	const p = parseManifest( text );
	assert.deepStrictEqual( [ p.errors, p.entries.size ], [ [], 4 ] );
	assert.strictEqual( p.entries.get( 'master.m3u8' ), await sha( enc( '#EXTM3U\n' ) ) );
	assert.ok( parseManifest( 'nonsense\n' ).errors.length === 1 );
	assert.ok( parseManifest( text + text.split( '\n' )[ 0 ] + '\n' ).errors.some( e => /listed twice/.test( e ) ) );

} );

await test( 'addManifest appends files.sha256 to the set and keeps the tree and total in step', async () => {

	const set = { files: files(), tree: [], total: 0 };
	await addManifest( set, 'cafe', sha );
	assert.strictEqual( set.files.at( - 1 ).path, 'cafe/files.sha256' );
	assert.strictEqual( set.tree.length, 5 );
	assert.strictEqual( set.total, set.files.reduce( ( n, f ) => n + f.bytes.length, 0 ) );
	await addManifest( set, 'cafe', sha );          // idempotent: asking twice leaves one manifest, with the same content
	assert.strictEqual( set.files.filter( f => f.path === 'cafe/files.sha256' ).length, 1 );

} );

// a fake mirror: a map of served files
async function mirror( { drop = [], corrupt = [], noManifest = false } = {} ) {

	const set = await addManifest( { files: files(), tree: [], total: 0 }, 'cafe', sha );
	const served = new Map( set.files.map( f => [ 'https://m.example/video/cafe/v1/' + f.path.slice( 5 ), f.bytes ] ) );
	for ( const d of drop ) served.delete( 'https://m.example/video/cafe/v1/' + d );
	for ( const c of corrupt ) served.set( 'https://m.example/video/cafe/v1/' + c, enc( 'WRONG' ) );
	if ( noManifest ) served.delete( 'https://m.example/video/cafe/v1/files.sha256' );
	return async url => { const b = served.get( url ); if ( ! b ) throw Object.assign( new Error( 'HTTP 404' ), { status: 404 } ); return b; };

}

await test( 'a complete mirror verifies', async () => {

	const r = await verifyBase( 'https://m.example/video/cafe/v1/', { fetchBytes: await mirror(), sha256: sha } );
	assert.deepStrictEqual( [ r.ok, r.checked, r.missing, r.mismatched, r.manifest ], [ true, 4, [], [], true ] );

} );

await test( 'a half-synced mirror is reported missing, and one serving other bytes is reported mismatched: neither is silently wrong', async () => {

	const r = await verifyBase( 'https://m.example/video/cafe/v1/', { fetchBytes: await mirror( { drop: [ '480p60/seg00001.m4s' ], corrupt: [ 'master.m3u8' ] } ), sha256: sha } );
	assert.strictEqual( r.ok, false );
	assert.deepStrictEqual( [ r.missing, r.mismatched ], [ [ '480p60/seg00001.m4s' ], [ 'master.m3u8' ] ] );

} );

await test( 'an edge that fails a file once and then serves it is not "missing": it is reported flaky; a file that never comes is missing; wrong bytes are never retried', async () => {

	const good = await mirror();
	const seen = new Map();
	const flakyFetch = async url => { const n = ( seen.get( url ) || 0 ) + 1; seen.set( url, n ); if ( url.endsWith( 'master.m3u8' ) && n < 3 ) throw Object.assign( new Error( 'HTTP 404' ), { status: 404 } ); return good( url ); };
	const r = await verifyBase( 'https://m.example/video/cafe/v1/', { fetchBytes: flakyFetch, sha256: sha, delayMs: 0 } );
	assert.deepStrictEqual( [ r.ok, r.missing, r.flaky ], [ true, [], [ { path: 'master.m3u8', attempts: 3 } ] ] );
	const never = await verifyBase( 'https://m.example/video/cafe/v1/', { fetchBytes: await mirror( { drop: [ 'master.m3u8' ] } ), sha256: sha, delayMs: 0, attempts: 3 } );
	assert.deepStrictEqual( [ never.ok, never.missing ], [ false, [ 'master.m3u8' ] ] );
	let calls = 0;
	const wrong = await mirror( { corrupt: [ 'master.m3u8' ] } );
	await verifyBase( 'https://m.example/video/cafe/v1/', { fetchBytes: async u => { if ( u.endsWith( 'master.m3u8' ) ) calls ++; return wrong( u ); }, sha256: sha, delayMs: 0 } );
	assert.strictEqual( calls, 1, 'a wrong answer was fetched once, not retried' );

} );

await test( 'a mirror that does not serve the manifest cannot be verified, and says so', async () => {

	const r = await verifyBase( 'https://m.example/video/cafe/v1', { fetchBytes: await mirror( { noManifest: true } ), sha256: sha } );
	assert.deepStrictEqual( [ r.ok, r.manifest ], [ false, false ] );
	assert.match( r.errors[ 0 ], /files\.sha256 is not served/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
