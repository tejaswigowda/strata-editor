// Run: node tools/__tests__/verify-publication.test.mjs
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyPublication } from '../verify-publication.mjs';
import { addManifest } from '../../docs/editor/js/export/filesManifest.js';
import { publicationBlock } from '../../docs/editor/js/export/releases.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

const enc = s => new TextEncoder().encode( s );
const sha = async b => createHash( 'sha256' ).update( b ).digest( 'hex' );
const pub = publicationBlock( { storage: 'renders-repo', repo: 'o/renders', path: 'cafe', tag: 'cafe/v1', sizeBytes: 1, archive: true } );
const [ CANON, JS, ARCH ] = [ pub.canonical, ...pub.mirrors ];

async function folder() {

	const renderJson = JSON.stringify( { publication: pub, version: 2 } );
	const set = await addManifest( { files: [
		{ path: 'cafe/render.json', bytes: enc( renderJson ) }, { path: 'cafe/master.m3u8', bytes: enc( '#EXTM3U\n' ) }, { path: 'cafe/480p60/seg00001.m4s', bytes: enc( 'segment one' ) },
	], tree: [], total: 0 }, 'cafe', sha );
	return new Map( set.files.map( f => [ f.path.slice( 5 ), f.bytes ] ) );

}
const world = locations => async url => {

	for ( const [ base, files ] of Object.entries( locations ) ) if ( url.startsWith( base ) ) { const b = files.get( url.slice( base.length ) ); if ( b ) return b; }
	throw Object.assign( new Error( 'HTTP 404' ), { status: 404 } );

};

await test( 'every location complete: all verify, and the exit condition is met', async () => {

	const f = await folder();
	const r = await verifyPublication( CANON, { fetchBytes: world( { [ CANON ]: f, [ JS ]: f, [ ARCH ]: f } ) } );
	assert.deepStrictEqual( [ r.locations.map( l => l.verdict ), r.verified, r.ok ], [ [ 'verified', 'verified', 'verified' ], 3, true ] );
	assert.deepStrictEqual( r.locations.map( l => l.base ), [ CANON, JS, ARCH ], 'canonical first, then the mirrors in the render\u2019s order' );

} );

await test( 'a half-synced canonical location, a corrupted mirror and an absent archive are each named, and none counts as verified', async () => {

	const f = await folder();
	const half = new Map( f ); half.delete( '480p60/seg00001.m4s' );
	const bad = new Map( f ); bad.set( 'master.m3u8', enc( 'tampered' ) );
	const r = await verifyPublication( CANON, { fetchBytes: world( { [ CANON ]: half, [ JS ]: bad } ) } );
	assert.deepStrictEqual( r.locations.map( l => l.verdict ), [ 'incomplete', 'different', 'unverifiable' ] );
	assert.match( r.locations[ 0 ].detail, /1 missing \(480p60\/seg00001\.m4s\)/ );
	assert.match( r.locations[ 1 ].detail, /1 with other bytes \(master\.m3u8\)/ );
	assert.deepStrictEqual( [ r.verified, r.ok ], [ 0, false ] );

} );

await test( '--require N: one verified location is enough when only one is needed, so a slow archive does not block a publish', async () => {

	const f = await folder();
	const r = await verifyPublication( CANON, { require: 1, fetchBytes: world( { [ CANON ]: f } ) } );
	assert.deepStrictEqual( [ r.verified, r.ok ], [ 1, true ] );

} );

await test( 'a mirror with a self-consistent but different manifest is reported different: a manifest vouches only for itself', async () => {

	const f = await folder(), other = new Map( f );
	other.set( 'master.m3u8', enc( '#EXTM3U\n#different\n' ) );
	const g = ( await addManifest( { files: [ ...other ].map( ( [ p, bytes ] ) => ( { path: 'cafe/' + p, bytes } ) ), tree: [], total: 0 }, 'cafe', sha ) );
	const r = await verifyPublication( CANON, { fetchBytes: world( { [ CANON ]: f, [ JS ]: new Map( g.files.map( x => [ x.path.slice( 5 ), x.bytes ] ) ) } ) } );
	assert.strictEqual( r.locations[ 1 ].verdict, 'different' );
	assert.match( r.locations[ 1 ].detail, /not the first location/ );

} );

await test( 'a legacy render (no manifest, no canonical address) is reported unverifiable, never verified', async () => {

	const legacy = { version: 1, publication: { storage: 'renders-repo', repo: 'o/renders', path: 'cafe', tag: 'cafe/v1', url: JS, size_bytes: 1 } };
	const files = new Map( [ [ 'render.json', enc( JSON.stringify( legacy ) ) ] ] );
	const r = await verifyPublication( JS, { fetchBytes: world( { [ JS ]: files } ) } );
	assert.deepStrictEqual( [ r.locations.length, r.locations[ 0 ].verdict, r.ok ], [ 1, 'unverifiable', false ] );

} );

await test( 'files.sha256 is the format shasum -c / sha256sum -c reads', async () => {

	const tool = [ [ 'sha256sum', [ '-c', '--quiet', 'files.sha256' ] ], [ 'shasum', [ '-a', '256', '-c', '--quiet', 'files.sha256' ] ] ].find( ( [ c ] ) => spawnSync( 'which', [ c ] ).status === 0 );
	if ( ! tool ) { console.log( '    (no sha256sum or shasum here: skipped)' ); return; }
	const dir = mkdtempSync( path.join( tmpdir(), 'manifest-' ) );
	try {

		const f = await folder();
		for ( const [ p, bytes ] of f ) { mkdirSync( path.dirname( path.join( dir, p ) ), { recursive: true } ); writeFileSync( path.join( dir, p ), bytes ); }
		execFileSync( tool[ 0 ], tool[ 1 ], { cwd: dir } );                                   // throws on any mismatch
		writeFileSync( path.join( dir, 'master.m3u8' ), 'tampered' );
		assert.throws( () => execFileSync( tool[ 0 ], tool[ 1 ], { cwd: dir, stdio: 'pipe' } ), /./ );

	} finally { rmSync( dir, { recursive: true, force: true } ); }

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
