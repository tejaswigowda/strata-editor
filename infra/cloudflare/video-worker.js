// video-worker.js — serves https://strataeditor.dev/video/* from an R2 bucket. Nothing else: every other path is not routed here (wrangler.toml) and goes to GitHub Pages
// exactly as before, which is what gate G1 checks.
//
// The files are immutable (a published tag never moves), so everything is cached for a year. A 404 is never cached: a tag that is being synced answers 404 for a
// few seconds and must not keep doing so. The object key is the URL path: video/<slug>/v<N>/<file> (R2 key and public path are the same string on purpose, so that
// switching storage is a change to this file's binding and no published address changes: gate G8).

export const TYPES = {
	m3u8: 'application/vnd.apple.mpegurl', m4s: 'video/mp4', mp4: 'video/mp4', vtt: 'text/vtt; charset=utf-8', json: 'application/json', jpg: 'image/jpeg', png: 'image/png',
	wav: 'audio/wav', sha256: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8',
};

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag', 'access-control-allow-headers': 'Range, If-None-Match', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' };

/** The R2 key for a request path, or null when it is not a file under /video/ (a trailing slash, an empty or dotted segment, anything outside the prefix). */
export function keyFor( pathname ) {

	let key;
	try { key = decodeURIComponent( pathname ).replace( /^\/+/, '' ); } catch ( e ) { return null; }
	if ( ! key.startsWith( 'video/' ) || key.endsWith( '/' ) ) return null;
	if ( key.split( '/' ).some( s => s === '' || s === '.' || s === '..' ) ) return null;
	return key;

}

const typeOf = key => TYPES[ ( key.split( '.' ).pop() || '' ).toLowerCase() ] || 'application/octet-stream';

function reply( status, body, headers = {} ) {

	return new Response( body, { status, headers: { ...CORS, ...headers } } );

}

export default {

	async fetch( request, env ) {

		if ( request.method === 'OPTIONS' ) return reply( 204, null, { 'access-control-max-age': '86400' } );
		if ( request.method !== 'GET' && request.method !== 'HEAD' ) return reply( 405, 'Method not allowed', { allow: 'GET, HEAD, OPTIONS' } );

		const key = keyFor( new URL( request.url ).pathname );
		if ( ! key ) return reply( 404, 'Not found', { 'cache-control': 'no-store' } );

		const base = { 'content-type': typeOf( key ), 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable' };

		if ( request.method === 'HEAD' ) {

			const head = await env.VIDEO.head( key );
			if ( ! head ) return reply( 404, 'Not found', { 'cache-control': 'no-store' } );
			return reply( 200, null, { ...base, 'content-length': String( head.size ), etag: head.httpEtag } );

		}

		let object;
		try { object = await env.VIDEO.get( key, { range: request.headers, onlyIf: request.headers } ); } catch ( e ) {

			return reply( 416, 'Range not satisfiable', { 'cache-control': 'no-store' } );

		}
		if ( ! object ) return reply( 404, 'Not found', { 'cache-control': 'no-store' } );
		if ( object.body === undefined || object.body === null ) return reply( 304, null, { ...base, etag: object.httpEtag } );     // R2: a failed precondition is an object without a body

		const headers = { ...base, etag: object.httpEtag };
		if ( object.range && ( object.range.offset !== undefined || object.range.length !== undefined ) && request.headers.get( 'range' ) ) {

			const offset = object.range.offset || 0, length = object.range.length !== undefined ? object.range.length : object.size - offset;
			return reply( 206, object.body, { ...headers, 'content-range': `bytes ${ offset }-${ offset + length - 1 }/${ object.size }`, 'content-length': String( length ) } );

		}
		return reply( 200, object.body, { ...headers, 'content-length': String( object.size ) } );

	},

};
