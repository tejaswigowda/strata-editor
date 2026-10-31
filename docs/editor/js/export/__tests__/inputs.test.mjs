// Run: node docs/editor/js/export/__tests__/inputs.test.mjs
// The recorded inputs of a render: the encoder (kind, version, a hash of its settings) and the end card (a PNG with its own sha256).
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { canonicalJson, browserVersionOf, encoderInfo } from '../encoderInfo.js';
import { recordEndCard } from '../endCard.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

await test( 'canonical JSON does not depend on key order', () => {

	assert.strictEqual( canonicalJson( { b: 1, a: { d: [ 3, { y: 1, x: 2 } ], c: null } } ), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}' );
	assert.strictEqual( canonicalJson( { a: undefined, b: 1 } ), '{"b":1}' );

} );

await test( 'the browser version comes from the brands, else the user agent', () => {

	assert.strictEqual( browserVersionOf( '', [ { brand: 'Not.A/Brand', version: '8' }, { brand: 'Chromium', version: '130' }, { brand: 'Google Chrome', version: '130' } ] ), 'Google Chrome 130' );
	assert.strictEqual( browserVersionOf( 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Safari/537.36' ), 'Chrome 130.0.6723.58' );
	assert.strictEqual( browserVersionOf( 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15' ), 'Safari 17.4' );
	assert.strictEqual( browserVersionOf( 'curl/8' ), null );

} );

await test( 'the encoder record names what was used, and hashes the settings: the same settings give the same hash, a different bitrate another', async () => {

	const cfg = { codec: 'avc1.64002a', width: 1920, height: 1080, bitrate: 8e6, framerate: 60, avc: { format: 'avc' }, latencyMode: 'quality', hardwareAcceleration: 'prefer-software' };
	const a = await encoderInfo( { kind: 'software', config: cfg, extra: { keyEvery: 120 }, userAgent: 'Chrome/130.0.1' } );
	const b = await encoderInfo( { kind: 'software', config: { ...cfg }, extra: { keyEvery: 120 }, userAgent: 'Chrome/130.0.1' } );
	const c = await encoderInfo( { kind: 'software', config: { ...cfg, bitrate: 9e6 }, extra: { keyEvery: 120 }, userAgent: 'Chrome/130.0.1' } );
	assert.deepStrictEqual( [ a.kind, a.name, a.version, a.threads ], [ 'software', 'WebCodecs VideoEncoder (H.264)', 'Chrome 130.0.1', null ] );
	assert.match( a.settings_hash, /^sha256:[0-9a-f]{64}$/ );
	assert.strictEqual( a.settings_hash, b.settings_hash );
	assert.notStrictEqual( a.settings_hash, c.settings_hash );
	assert.strictEqual( a.settings_hash, 'sha256:' + createHash( 'sha256' ).update( canonicalJson( a.config ) ).digest( 'hex' ), 'it is plain sha256 of the canonical settings: anyone can recompute it' );
	assert.strictEqual( ( await encoderInfo( { kind: 'anything else', config: cfg } ) ).kind, 'hardware', 'anything that is not software is hardware' );

} );

await test( 'the end card is recorded as a PNG with its own sha256, what it was built from and what it said', async () => {

	const png = new Uint8Array( [ 0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4 ] );
	const canvas = { toBlob: cb => cb( new Blob( [ png ], { type: 'image/png' } ) ) };
	const r = await recordEndCard( { canvas, stamp: 'Strata v0.1.0', url: 'https://x/about/callcard/', width: 1024, height: 2048 } );
	assert.deepStrictEqual( [ ...r.bytes ], [ ...png ] );
	assert.strictEqual( r.sha256, createHash( 'sha256' ).update( png ).digest( 'hex' ) );
	assert.deepStrictEqual( [ r.stamp, r.url, r.width, r.height ], [ 'Strata v0.1.0', 'https://x/about/callcard/', 1024, 2048 ] );
	assert.strictEqual( await recordEndCard( undefined ), null, 'a failed refresh records nothing: the card stays an unpinned input, and the render says so' );
	assert.strictEqual( await recordEndCard( { canvas: { toBlob: cb => cb( null ) } } ), null );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
