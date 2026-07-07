// ── GitAssets.js ──────────────────────────────────────────────────────────────
// Split a three.js editor scene JSON into a small, diffable `scene.json` plus a
// set of separate BINARY asset files (geometry buffers + images).
//
// Why: geometry attribute/index buffers serialize to JSON as full-precision
// float *text* — a modest scene balloons to hundreds of MB, which overflows
// btoa()/string limits and exceeds GitHub's file-size cap. Storing each buffer
// as a raw binary blob (content-addressed by hash) keeps scene.json tiny and
// lets unchanged buffers be reused across commits.
//
// Format: inside the scene JSON, a big `array` is replaced by a reference
//   { "$bin": "assets/geo-<sha1>.bin", "dtype": "Float32Array", "length": N }
// and a data-URI image `url` by
//   { "$img": "assets/img-<sha1>.<ext>", "mime": "image/png" }
// internalizeScene() restores the originals on load. Scenes without these
// markers (legacy inline format) pass through untouched.

const TYPED = {
	Int8Array, Uint8Array, Uint8ClampedArray,
	Int16Array, Uint16Array,
	Int32Array, Uint32Array,
	Float32Array, Float64Array,
};

const MIME_EXT = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
	'image/ktx2': 'ktx2',
};

// ── base64 <-> bytes (chunked; never builds one giant intermediate string) ────

export function u8ToBase64( u8 ) {

	let binary = '';
	const CHUNK = 0x8000; // 32 KB — stays under String.fromCharCode.apply arg limits
	for ( let i = 0; i < u8.length; i += CHUNK ) {

		binary += String.fromCharCode.apply( null, u8.subarray( i, i + CHUNK ) );

	}

	return btoa( binary );

}

export function base64ToU8( b64 ) {

	const binary = atob( b64 );
	const u8 = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) u8[ i ] = binary.charCodeAt( i );
	return u8;

}

async function sha1Hex( u8 ) {

	const digest = await crypto.subtle.digest( 'SHA-1', u8 );
	return Array.from( new Uint8Array( digest ) ).map( b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

function bytesToBuffer( u8 ) {

	// Return an ArrayBuffer that owns exactly these bytes (typed-array views need
	// a byteOffset of 0 and a length that is a multiple of the element size).
	if ( u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ) return u8.buffer;
	return u8.slice().buffer;

}

// ── Externalize (commit side) ─────────────────────────────────────────────────
// Mutates `json` in place, replacing big buffers with references. Returns a Map
// of path → Uint8Array for the caller to commit. Safe: `json` is a fresh
// editor.toJSON() copy, so the live scene is untouched.

export async function externalizeScene( json ) {

	const assets = new Map();
	const scene = json && json.scene;
	if ( ! scene ) return { json, assets };

	for ( const geo of scene.geometries || [] ) {

		const data = geo && geo.data;
		if ( ! data ) continue;

		if ( data.attributes ) {

			for ( const name of Object.keys( data.attributes ) ) {

				const attr = data.attributes[ name ];
				if ( attr && Array.isArray( attr.array ) ) {

					attr.array = await externalizeArray( attr.array, attr.type, assets, 'geo' );

				}

			}

		}

		if ( data.index && Array.isArray( data.index.array ) ) {

			data.index.array = await externalizeArray( data.index.array, data.index.type, assets, 'idx' );

		}

	}

	for ( const img of scene.images || [] ) {

		await externalizeImage( img, assets );

	}

	return { json, assets };

}

async function externalizeArray( array, type, assets, prefix ) {

	const TypedArray = TYPED[ type ] || Float32Array;
	const ta = new TypedArray( array );
	const u8 = new Uint8Array( ta.buffer, ta.byteOffset, ta.byteLength );
	const hash = await sha1Hex( u8 );
	const path = `assets/${ prefix }-${ hash }.bin`;
	assets.set( path, u8 );
	return { $bin: path, dtype: TypedArray.name, length: ta.length };

}

async function externalizeImage( img, assets ) {

	const one = async ( value ) => {

		if ( typeof value !== 'string' ) return value;
		const m = /^data:([^;]+);base64,(.*)$/s.exec( value );
		if ( ! m ) return value; // remote URL or already a ref — leave as-is

		const mime = m[ 1 ];
		const u8 = base64ToU8( m[ 2 ] );
		const hash = await sha1Hex( u8 );
		const ext = MIME_EXT[ mime ] || 'bin';
		const path = `assets/img-${ hash }.${ ext }`;
		assets.set( path, u8 );
		return { $img: path, mime };

	};

	if ( Array.isArray( img.url ) ) img.url = await Promise.all( img.url.map( one ) );
	else img.url = await one( img.url );

}

// ── Internalize (load side) ───────────────────────────────────────────────────
// Reverses externalizeScene(). `fetchBytes(path)` must resolve to a Uint8Array.

export async function internalizeScene( json, fetchBytes ) {

	const scene = json && json.scene;
	if ( ! scene ) return json;

	for ( const geo of scene.geometries || [] ) {

		const data = geo && geo.data;
		if ( ! data ) continue;

		if ( data.attributes ) {

			for ( const name of Object.keys( data.attributes ) ) {

				const attr = data.attributes[ name ];
				if ( attr && attr.array && attr.array.$bin ) {

					attr.array = await internalizeArray( attr.array, fetchBytes );

				}

			}

		}

		if ( data.index && data.index.array && data.index.array.$bin ) {

			data.index.array = await internalizeArray( data.index.array, fetchBytes );

		}

	}

	for ( const img of scene.images || [] ) {

		await internalizeImage( img, fetchBytes );

	}

	return json;

}

async function internalizeArray( ref, fetchBytes ) {

	const u8 = await fetchBytes( ref.$bin );
	const TypedArray = TYPED[ ref.dtype ] || Float32Array;
	const ta = new TypedArray( bytesToBuffer( u8 ) );
	return Array.from( ta );

}

async function internalizeImage( img, fetchBytes ) {

	const one = async ( value ) => {

		if ( ! value || ! value.$img ) return value;
		const u8 = await fetchBytes( value.$img );
		return `data:${ value.mime };base64,${ u8ToBase64( u8 ) }`;

	};

	if ( Array.isArray( img.url ) ) img.url = await Promise.all( img.url.map( one ) );
	else img.url = await one( img.url );

}

// True when a loaded scene uses the externalized asset format.
export function sceneHasExternalAssets( json ) {

	const geos = json && json.scene && json.scene.geometries;
	if ( ! Array.isArray( geos ) ) return false;
	for ( const geo of geos ) {

		const data = geo && geo.data;
		if ( ! data ) continue;
		if ( data.index && data.index.array && data.index.array.$bin ) return true;
		if ( data.attributes ) {

			for ( const name of Object.keys( data.attributes ) ) {

				if ( data.attributes[ name ] && data.attributes[ name ].array && data.attributes[ name ].array.$bin ) return true;

			}

		}

	}

	return false;

}
