// Run: node docs/editor/js/export/__tests__/regenerate.test.mjs
// Opening a plan record: the source is fetched, hash-verified before anything is cut (P1, P2), an unreachable source degrades (P3), the cache is keyed by the
// hash (P4); and the licence travels with an exported glTF (P7).
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { fetchVerified, regenerateRecord, makeSourceCache, RecordSourceError } from '../regenerate.js';
import { stampGlb, stampGltfJson, stampExport, confirmLicence } from '../glbStamp.js';

let pass = 0, fail = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

const BYTES = new TextEncoder().encode( 'the source geometry' );
const SHA = createHash( 'sha256' ).update( BYTES ).digest( 'hex' );
const source = ( o = {} ) => ( { url: 'https://raw.githubusercontent.com/x/y/' + 'a'.repeat( 40 ) + '/Duck.glb', sha256: SHA, bytes: BYTES.byteLength, ...o } );
const sha = async b => createHash( 'sha256' ).update( b ).digest( 'hex' );
const counting = ( bytes = BYTES ) => { const f = async url => { f.calls.push( url ); return bytes; }; f.calls = []; return f; };

await test( 'P1: the source is fetched and verified, then imported, cut and discarded, in that order', async () => {

	const log = [], fetchBytes = counting();
	const deps = { fetchBytes, sha256: sha, importBytes: async ( b, name ) => { log.push( 'import ' + name ); return { root: 1 }; }, findMesh: () => { log.push( 'find' ); return 'mesh'; }, replace: async () => { log.push( 'replace' ); }, discard: () => log.push( 'discard' ) };
	const r = await regenerateRecord( { source: source() }, deps );
	assert.deepStrictEqual( log, [ 'import Duck.glb', 'find', 'replace', 'discard' ] );
	assert.strictEqual( r.from, 'network' );

} );

await test( 'P2: a source that does not hash to the record is refused before anything is imported or cut', async () => {

	const log = [], deps = { fetchBytes: counting( new TextEncoder().encode( 'the source geometry!' ) ), sha256: sha, importBytes: async () => { log.push( 'import' ); }, findMesh: () => { log.push( 'find' ); }, replace: async () => { log.push( 'replace' ); } };
	// same length, different content: the size check passes and the hash must catch it
	const same = new TextEncoder().encode( 'the source geometrY' ); deps.fetchBytes = counting( same );
	await assert.rejects( regenerateRecord( { source: source() }, deps ), e => e instanceof RecordSourceError && e.code === 'hash' && /different file/.test( e.message ) );
	await assert.rejects( regenerateRecord( { source: source( { sha256: '0'.repeat( 64 ) } ) }, { ...deps, fetchBytes: counting() } ), e => e.code === 'hash' );
	await assert.rejects( regenerateRecord( { source: source( { bytes: 5 } ) }, { ...deps, fetchBytes: counting() } ), e => e.code === 'size' );
	assert.deepStrictEqual( log, [], 'nothing was imported or cut' );

} );

await test( 'P3: an unreachable source is reported as such, with the url and the reason', async () => {

	const fetchBytes = async () => { throw new Error( 'HTTP 404' ); };
	await assert.rejects( fetchVerified( source(), { fetchBytes, sha256: sha } ), e => e.code === 'unreachable' && /HTTP 404/.test( e.message ) && e.message.includes( 'Duck.glb' ) );
	await assert.rejects( fetchVerified( source( { fetchable: false } ), { fetchBytes, sha256: sha } ), e => e.code === 'not-fetchable' );

} );

await test( 'P3: a replay that refuses leaves the imported root discarded and the error surfaced', async () => {

	let discarded = false;
	const deps = { fetchBytes: counting(), sha256: sha, importBytes: async () => 'root', findMesh: () => 'mesh', replace: async () => { throw new Error( 'SEG.replay: the mesh has 10 triangles and the record says 12' ); }, discard: () => { discarded = true; } };
	await assert.rejects( regenerateRecord( { source: source() }, deps ), /10 triangles and the record says 12/ );
	assert.ok( discarded );

} );

await test( 'P4: the second open of the same source is a cache hit, and fetches nothing', async () => {

	const cache = makeSourceCache( { idb: null } ), fetchBytes = counting();
	const a = await fetchVerified( source(), { fetchBytes, cache, sha256: sha } );
	const b = await fetchVerified( source(), { fetchBytes, cache, sha256: sha } );
	assert.deepStrictEqual( [ a.from, b.from ], [ 'network', 'cache' ] );
	assert.strictEqual( fetchBytes.calls.length, 1 );
	// the cache is keyed by hash, so a different url with the same hash is the same entry
	const c = await fetchVerified( source( { url: 'https://mirror.example/Duck.glb' } ), { fetchBytes, cache, sha256: sha } );
	assert.strictEqual( c.from, 'cache' );

} );

await test( 'P4: a damaged cache entry is not trusted, is dropped, and the source is fetched again', async () => {

	const cache = makeSourceCache( { idb: null } ), fetchBytes = counting();
	await cache.put( SHA, new TextEncoder().encode( 'garbage' ) );
	const r = await fetchVerified( source(), { fetchBytes, cache, sha256: sha } );
	assert.strictEqual( r.from, 'network' );
	assert.strictEqual( fetchBytes.calls.length, 1 );
	assert.strictEqual( ( await fetchVerified( source(), { fetchBytes, cache, sha256: sha } ) ).from, 'cache' );

} );

await test( 'P2: bytes that fail verification are never cached', async () => {

	const cache = makeSourceCache( { idb: null } );
	await assert.rejects( fetchVerified( source( { sha256: '0'.repeat( 64 ) } ), { fetchBytes: counting(), cache, sha256: sha } ) );
	assert.strictEqual( await cache.get( '0'.repeat( 64 ) ), null );

} );

// ── P7: the licence in the exported file ────────────────────────────────────────────────────────────

function glb( json, bin = new Uint8Array( [ 1, 2, 3, 4, 5, 6, 7, 8 ] ) ) {

	const text = new TextEncoder().encode( JSON.stringify( json ) ), padded = Math.ceil( text.length / 4 ) * 4;
	const out = new Uint8Array( 12 + 8 + padded + 8 + bin.length ), v = new DataView( out.buffer );
	v.setUint32( 0, 0x46546C67, true ); v.setUint32( 4, 2, true ); v.setUint32( 8, out.length, true );
	v.setUint32( 12, padded, true ); v.setUint32( 16, 0x4E4F534A, true ); out.set( text, 20 ); out.fill( 0x20, 20 + text.length, 20 + padded );
	v.setUint32( 20 + padded, bin.length, true ); v.setUint32( 24 + padded, 0x004E4942, true ); out.set( bin, 28 + padded );
	return out.buffer;

}
const NOTICE = { copyright: 'Copyright 2006 Sony. licence: SCEA Shared Source License 1.0', extras: { strata_source: [ { sha256: SHA, licence: 'SCEA Shared Source License 1.0', modifications: [ 'cut into 3 parts' ] } ] } };

await test( 'P7: a GLB carries the licence, attribution and modifications in asset, and is still a valid GLB', () => {

	const out = stampGlb( glb( { asset: { version: '2.0', generator: 'three' }, scenes: [] } ), NOTICE ), v = new DataView( out );
	assert.strictEqual( v.getUint32( 8, true ), out.byteLength, 'the header length is the file length' );
	const len = v.getUint32( 12, true );
	assert.strictEqual( len % 4, 0 );
	const json = JSON.parse( new TextDecoder().decode( new Uint8Array( out, 20, len ) ) );
	assert.strictEqual( json.asset.version, '2.0' );
	assert.strictEqual( json.asset.generator, 'three' );
	assert.ok( json.asset.copyright.includes( 'SCEA Shared Source License 1.0' ) );
	assert.deepStrictEqual( json.asset.extras.strata_source[ 0 ].modifications, [ 'cut into 3 parts' ] );
	assert.strictEqual( v.getUint32( 20 + len + 4, true ), 0x004E4942, 'the BIN chunk follows' );
	assert.deepStrictEqual( [ ...new Uint8Array( out, 28 + len ) ], [ 1, 2, 3, 4, 5, 6, 7, 8 ], 'and is untouched' );

} );

await test( 'P7: a copyright the file already had is kept, and a buffer that is not a GLB is returned as it was', () => {

	const out = stampGltfJson( { asset: { version: '2.0', copyright: 'Mine' } }, NOTICE );
	assert.ok( out.asset.copyright.startsWith( 'Mine\n' ) && out.asset.copyright.includes( 'Sony' ) );
	const junk = new Uint8Array( 40 ).buffer;
	assert.strictEqual( stampGlb( junk, NOTICE ), junk );
	assert.strictEqual( stampExport( { name: 'S', userData: {}, children: [] }, { asset: { version: '2.0' } } ).asset.copyright, undefined, 'a scene with no record is exported unchanged' );

} );

await test( 'P8: the export asks when the licence is missing, goes on when told to, and does not ask when it is fine', () => {

	const scene = lic => ( { name: 'S', userData: {}, children: [ { name: 'Suzanne', userData: { segmentation: { from: 'm', source: { url: 'u', licence: lic } } }, children: [] } ] } );
	let asked = 0;
	assert.strictEqual( confirmLicence( scene( null ), m => { asked ++; assert.ok( /Suzanne/.test( m ) ); return false; } ), false );
	assert.strictEqual( confirmLicence( scene( null ), () => true ), true );
	assert.strictEqual( confirmLicence( scene( 'CC0' ), () => { asked ++; return false; } ), true );
	assert.strictEqual( asked, 1 );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
