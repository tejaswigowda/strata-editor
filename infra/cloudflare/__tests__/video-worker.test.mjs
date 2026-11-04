// Run: node infra/cloudflare/__tests__/video-worker.test.mjs
// The Worker against a fake R2 bucket with the semantics the Worker relies on (head, get with a Range or conditional header, a bodiless object when a precondition fails).
import assert from 'node:assert';
import worker, { keyFor } from '../video-worker.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } }

const objects = new Map( [
	[ 'video/cafe/v1/master.m3u8', new TextEncoder().encode( '#EXTM3U\n' ) ],
	[ 'video/cafe/v1/480p60/seg00001.m4s', new Uint8Array( [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ] ) ],
	[ 'video/a+b-cubed/v1/files.sha256', new TextEncoder().encode( 'x' ) ],
] );
const VIDEO = {
	async head( key ) { const b = objects.get( key ); return b ? { size: b.length, httpEtag: '"e-' + b.length + '"' } : null; },
	async get( key, { range, onlyIf } = {} ) {

		const b = objects.get( key ); if ( ! b ) return null;
		const o = { size: b.length, httpEtag: '"e-' + b.length + '"' };
		if ( onlyIf && onlyIf.get( 'if-none-match' ) === o.httpEtag ) return o;                       // bodiless
		const m = range && range.get( 'range' ) && /^bytes=(\d*)-(\d*)$/.exec( range.get( 'range' ) );
		if ( range && range.get( 'range' ) && ! m ) throw new Error( 'bad range' );
		if ( m ) {

			const offset = m[ 1 ] === '' ? Math.max( 0, b.length - Number( m[ 2 ] ) ) : Number( m[ 1 ] );
			const end = m[ 1 ] === '' || m[ 2 ] === '' ? b.length - 1 : Math.min( Number( m[ 2 ] ), b.length - 1 );
			if ( offset >= b.length ) throw new Error( 'unsatisfiable' );
			return { ...o, body: b.slice( offset, end + 1 ), range: { offset, length: end - offset + 1 } };

		}
		return { ...o, body: b };

	},
};
const call = ( path, init = {} ) => worker.fetch( new Request( 'https://strataeditor.dev' + path, init ), { VIDEO } );

await test( 'only files under /video/ have a key; a directory, a dotted segment or another prefix has none', () => {

	assert.strictEqual( keyFor( '/video/cafe/v1/master.m3u8' ), 'video/cafe/v1/master.m3u8' );
	assert.strictEqual( keyFor( '/video/a%2Bb-cubed/v1/x' ), 'video/a+b-cubed/v1/x' );
	for ( const bad of [ '/video/cafe/v1/', '/video/', '/editor/x', '/video/../secret', '/video/cafe/%2e%2e/x', '/video//x', '/video/%ZZ' ] ) assert.strictEqual( keyFor( bad ), null, bad );

} );

await test( 'a file is served with its type, its length, immutable caching and CORS; a "+" in the path finds the "+" key', async () => {

	const r = await call( '/video/cafe/v1/master.m3u8' );
	assert.strictEqual( r.status, 200 );
	assert.strictEqual( r.headers.get( 'content-type' ), 'application/vnd.apple.mpegurl' );
	assert.strictEqual( r.headers.get( 'cache-control' ), 'public, max-age=31536000, immutable' );
	assert.strictEqual( r.headers.get( 'access-control-allow-origin' ), '*' );
	assert.strictEqual( await r.text(), '#EXTM3U\n' );
	assert.strictEqual( ( await call( '/video/a+b-cubed/v1/files.sha256' ) ).headers.get( 'content-type' ), 'text/plain; charset=utf-8' );
	assert.strictEqual( ( await call( '/video/cafe/v1/480p60/seg00001.m4s' ) ).headers.get( 'content-type' ), 'video/mp4' );

} );

await test( 'a Range request is answered 206 with the right Content-Range, a suffix range too, and an unsatisfiable one 416', async () => {

	const r = await call( '/video/cafe/v1/480p60/seg00001.m4s', { headers: { range: 'bytes=2-5' } } );
	assert.strictEqual( r.status, 206 );
	assert.strictEqual( r.headers.get( 'content-range' ), 'bytes 2-5/10' );
	assert.deepStrictEqual( [ ...new Uint8Array( await r.arrayBuffer() ) ], [ 2, 3, 4, 5 ] );
	const s = await call( '/video/cafe/v1/480p60/seg00001.m4s', { headers: { range: 'bytes=-3' } } );
	assert.strictEqual( s.headers.get( 'content-range' ), 'bytes 7-9/10' );
	assert.strictEqual( ( await call( '/video/cafe/v1/480p60/seg00001.m4s', { headers: { range: 'bytes=50-60' } } ) ).status, 416 );

} );

await test( 'HEAD answers with the length and no body; a matching If-None-Match is 304', async () => {

	const h = await call( '/video/cafe/v1/master.m3u8', { method: 'HEAD' } );
	assert.deepStrictEqual( [ h.status, h.headers.get( 'content-length' ), await h.text() ], [ 200, '8', '' ] );
	assert.strictEqual( ( await call( '/video/cafe/v1/master.m3u8', { headers: { 'if-none-match': '"e-8"' } } ) ).status, 304 );

} );

await test( 'a missing file is 404 and never cached, so a tag that is mid-sync does not stay missing; other methods are refused; OPTIONS is the CORS preflight', async () => {

	for ( const m of [ 'GET', 'HEAD' ] ) { const r = await call( '/video/cafe/v9/master.m3u8', { method: m } ); assert.deepStrictEqual( [ r.status, r.headers.get( 'cache-control' ) ], [ 404, 'no-store' ], m ); }
	assert.strictEqual( ( await call( '/video/cafe/v1/master.m3u8', { method: 'PUT', body: 'x' } ) ).status, 405 );
	const o = await call( '/video/cafe/v1/master.m3u8', { method: 'OPTIONS' } );
	assert.deepStrictEqual( [ o.status, o.headers.get( 'access-control-allow-headers' ) ], [ 204, 'Range, If-None-Match' ] );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
