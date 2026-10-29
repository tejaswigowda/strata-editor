// ── glbStamp.js ───────────────────────────────────────────────────────────────────────────────────
// The licence goes out with the geometry. When someone exports a glTF whose geometry came from a record, they are the ones who made a derivative, and what the
// source's licence asks lands on them the moment they pass the file on. So the file says what is attached to it: `asset.copyright` (the credit and the licence,
// one line per source) and `asset.extras.strata_source` (url, commit, sha256, licence, attribution and what was done to it). A copy of fields the record has.
//
// The notice itself is exportNotice() in records.js; this file writes it into the glTF JSON, or into the JSON chunk of a .glb.

import { exportNotice, exportWarnings } from './records.js';

/** The glTF JSON object with the notice written into `asset`. A copyright the file already had is kept, and the notice added after it. */
export function stampGltfJson( gltf, notice ) {

	if ( ! notice ) return gltf;
	const asset = { ...( gltf.asset || { version: '2.0' } ) };
	asset.copyright = [ asset.copyright, notice.copyright ].filter( Boolean ).join( '\n' );
	asset.extras = { ...( asset.extras || {} ), ...notice.extras };
	return { ...gltf, asset };

}

const MAGIC = 0x46546C67, JSON_CHUNK = 0x4E4F534A;

/** A .glb (ArrayBuffer) with the notice written into the JSON chunk. The binary chunk is copied untouched. Returns a new ArrayBuffer; a buffer that is not a .glb is returned as it was. */
export function stampGlb( buffer, notice ) {

	if ( ! notice ) return buffer;
	const dv = new DataView( buffer );
	if ( buffer.byteLength < 20 || dv.getUint32( 0, true ) !== MAGIC || dv.getUint32( 16, true ) !== JSON_CHUNK ) return buffer;
	const jsonLength = dv.getUint32( 12, true ), rest = buffer.slice( 20 + jsonLength );
	const text = new TextDecoder().decode( new Uint8Array( buffer, 20, jsonLength ) ).replace( /[\s\0]+$/, '' );
	const json = new TextEncoder().encode( JSON.stringify( stampGltfJson( JSON.parse( text ), notice ) ) );
	const padded = Math.ceil( json.length / 4 ) * 4, out = new Uint8Array( 20 + padded + rest.byteLength ), view = new DataView( out.buffer );
	view.setUint32( 0, MAGIC, true ); view.setUint32( 4, dv.getUint32( 4, true ), true ); view.setUint32( 8, out.length, true );
	view.setUint32( 12, padded, true ); view.setUint32( 16, JSON_CHUNK, true );
	out.set( json, 20 ); out.fill( 0x20, 20 + json.length, 20 + padded );
	out.set( new Uint8Array( rest ), 20 + padded );
	return out.buffer;

}

/** What the exporters call with a result: an ArrayBuffer (.glb) or a glTF object, stamped from the scene's records. No record, no change. */
export function stampExport( scene, result ) {

	const notice = exportNotice( scene );
	if ( ! notice ) return result;
	return result instanceof ArrayBuffer ? stampGlb( result, notice ) : stampGltfJson( result, notice );

}

/**
 * Asks before an export whose geometry came from a source with no licence, or a proprietary one: the person who regenerated the geometry should know
 * before the file lands in their downloads. Returns true to go on. `ask` is window.confirm (or anything that takes a string and answers a boolean).
 */
export function confirmLicence( scene, ask = ( typeof confirm === 'function' ? confirm : () => true ) ) {

	const warnings = exportWarnings( scene );
	if ( ! warnings.length ) return true;
	return !! ask( 'The geometry in this scene came from a source whose licence does not say you may have it:\n\n' + warnings.map( w => '• ' + w ).join( '\n' ) + '\n\nThe exported file will carry what the record says (asset.copyright, asset.extras), but that is not a grant. Export anyway?' );

}
