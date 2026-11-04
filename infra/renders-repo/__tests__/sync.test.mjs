// Run: node infra/renders-repo/__tests__/sync.test.mjs
// sync.sh against a local "storage" server: the pass case, and each way the sync must refuse (a changed file, an unlisted file, a half-synced storage, wrong bytes in storage).
// The upload step itself (aws s3 sync to R2) is skipped here (SKIP_UPLOAD): it needs credentials, and it is the step that this check exists to distrust.
import assert from 'node:assert';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { addManifest } from '../../../docs/editor/js/export/filesManifest.js';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const script = path.join( here, '..', 'sync.sh' );
let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }
if ( spawnSync( 'bash', [ '-c', 'command -v curl && (command -v sha256sum || command -v shasum)' ] ).status !== 0 ) { console.log( 'no curl or sha tool: skipped' ); process.exit( 0 ); }

const sha = async b => createHash( 'sha256' ).update( b ).digest( 'hex' );
const enc = s => new TextEncoder().encode( s );
const FILES = { 'render.json': '{"v":2}\n', 'master.m3u8': '#EXTM3U\n', '480p60/init.mp4': 'init', '480p60/seg00001.m4s': 'seg one', 'audio/seg00001.m4s': 'audio one' };

/** A repo checkout holding cafe/ (with its manifest) and a storage server that serves a copy of it, each adjustable. */
async function setup() {

	const repo = mkdtempSync( path.join( tmpdir(), 'sync-' ) ), served = new Map();
	const set = await addManifest( { files: Object.entries( FILES ).map( ( [ p, t ] ) => ( { path: 'cafe/' + p, bytes: enc( t ) } ) ), tree: [], total: 0 }, 'cafe', sha );
	for ( const f of set.files ) {

		mkdirSync( path.dirname( path.join( repo, f.path ) ), { recursive: true } );
		writeFileSync( path.join( repo, f.path ), f.bytes );
		served.set( '/video/cafe/v1/' + f.path.slice( 5 ), Buffer.from( f.bytes ) );

	}
	const server = http.createServer( ( req, res ) => { const b = served.get( decodeURIComponent( req.url ) ); if ( ! b ) { res.writeHead( 404 ).end(); return; } res.writeHead( 200 ).end( b ); } );
	await new Promise( r => server.listen( 0, '127.0.0.1', r ) );
	return { repo, served, close: () => { server.close(); rmSync( repo, { recursive: true, force: true } ); }, base: `http://127.0.0.1:${ server.address().port }/video` };

}
function run( s ) {

	return new Promise( resolve => {

		const p = spawn( 'bash', [ script, 'cafe/v1' ], { cwd: s.repo, env: { ...process.env, SKIP_UPLOAD: '1', PUBLIC_BASE: s.base } } );
		let out = ''; p.stdout.on( 'data', d => out += d ); p.stderr.on( 'data', d => out += d );
		p.on( 'close', code => resolve( { code, out } ) );

	} );

}
async function scenario( change, check ) { const s = await setup(); try { await change( s ); check( await run( s ) ); } finally { s.close(); } }

await test( 'a correctly synced release verifies, and says so', () => scenario( () => {}, r => { assert.strictEqual( r.code, 0, r.out ); assert.match( r.out, /verified: cafe\/v1 is served exactly as committed/ ); } ) );

await test( 'a file changed after the manifest was made is refused before anything is uploaded', () => scenario(
	s => writeFileSync( path.join( s.repo, 'cafe/master.m3u8' ), 'tampered' ),
	r => { assert.notStrictEqual( r.code, 0 ); assert.match( r.out, /changed since the manifest was made: master\.m3u8/ ); assert.ok( ! /3\/3/.test( r.out ), 'it never reached the verification of storage' ); } ) );

await test( 'a file the manifest does not list is refused', () => scenario(
	s => writeFileSync( path.join( s.repo, 'cafe/extra.bin' ), 'x' ),
	r => { assert.notStrictEqual( r.code, 0 ); assert.match( r.out, /files differ from the manifest/ ); } ) );

await test( 'a half-synced storage is caught: a file that is not served fails the run', () => scenario(
	s => s.served.delete( '/video/cafe/v1/480p60/seg00001.m4s' ),
	r => { assert.notStrictEqual( r.code, 0 ); assert.match( r.out, /not served: 480p60\/seg00001\.m4s/ ); } ) );

await test( 'storage serving other bytes for a file is caught', () => scenario(
	s => s.served.set( '/video/cafe/v1/audio/seg00001.m4s', Buffer.from( 'corrupt' ) ),
	r => { assert.notStrictEqual( r.code, 0 ); assert.match( r.out, /served with other bytes: audio\/seg00001\.m4s/ ); } ) );

await test( 'a render with no files.sha256 (published before the manifest) is refused, not silently synced', async () => {

	const s = await setup();
	try { rmSync( path.join( s.repo, 'cafe/files.sha256' ) ); const r = await run( s ); assert.notStrictEqual( r.code, 0 ); assert.match( r.out, /predates the manifest/ ); } finally { s.close(); }

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
