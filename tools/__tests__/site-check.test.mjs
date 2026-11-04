// Run: node tools/__tests__/site-check.test.mjs
import assert from 'node:assert';
import { compareSnapshots, probe, snapshot } from '../site-check.mjs';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

const rec = ( url, o = {} ) => ( { url, status: 200, type: 'text/html', bytes: 3, sha256: 'aa', via: 'github-pages', ...o } );
const snap = records => ( { origin: 'x', records } );

await test( 'identical snapshots pass, and a change of edge alone is not a failure', () => {

	const r = compareSnapshots( snap( [ rec( 'a' ), rec( 'b' ) ] ), snap( [ rec( 'a', { via: 'cloudflare' } ), rec( 'b', { via: 'cloudflare' } ) ] ) );
	assert.strictEqual( r.ok, true ); assert.deepStrictEqual( r.via, [ 'cloudflare' ] );

} );

await test( 'a rewritten body, a changed status, a changed type and a missing URL each fail', () => {

	const before = snap( [ rec( 'a' ), rec( 'b' ), rec( 'c' ), rec( 'd' ) ] );
	const after = snap( [ rec( 'a', { sha256: 'bb', bytes: 9 } ), rec( 'b', { status: 404 } ), rec( 'c', { type: 'text/plain' } ) ] );
	const r = compareSnapshots( before, after );
	assert.strictEqual( r.ok, false ); assert.strictEqual( r.changed.length, 3 ); assert.deepStrictEqual( r.lost, [ 'd' ] );

} );

await test( 'a URL that is new after is reported but does not fail', () => {

	const r = compareSnapshots( snap( [ rec( 'a' ) ] ), snap( [ rec( 'a' ), rec( 'b' ) ] ) );
	assert.strictEqual( r.ok, true ); assert.deepStrictEqual( r.added, [ 'b' ] );

} );

await test( 'probe records a network failure instead of throwing, and tells Cloudflare from GitHub by header', async () => {

	assert.strictEqual( ( await probe( 'u', { fetchImpl: async () => { throw new Error( 'down' ); } } ) ).status, 0 );
	const mk = headers => async () => new Response( 'hi', { status: 200, headers } );
	assert.strictEqual( ( await probe( 'u', { fetchImpl: mk( { 'cf-ray': '1', server: 'cloudflare' } ) } ) ).via, 'cloudflare' );
	assert.strictEqual( ( await probe( 'u', { fetchImpl: mk( { server: 'GitHub.com' } ) } ) ).via, 'github-pages' );

} );

await test( 'snapshot reads the sitemap and probes each URL once', async () => {

	const seen = [];
	const fetchImpl = async ( url ) => { seen.push( url ); return url.endsWith( 'sitemap.xml' ) ? new Response( '<loc>https://o/x</loc><loc>https://o/y</loc>' ) : new Response( 'ok' ); };
	const s = await snapshot( { origin: 'https://o', extra: [ 'https://other/z' ], fetchImpl } );
	for ( const u of [ 'https://o/x', 'https://o/y', 'https://other/z', 'https://o/' ] ) assert.ok( s.records.some( r => r.url === u ), u );
	assert.strictEqual( new Set( s.records.map( r => r.url ) ).size, s.records.length );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
