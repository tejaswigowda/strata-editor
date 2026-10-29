// ── records.js ────────────────────────────────────────────────────────────────
// The schema of a record (a scene whose asset has been cut and named, kept as a dataset entry) and the checks that keep it honest. Pure functions: they
// run in the editor, in node, and in CI, and they are the one definition of what a valid record is.
//
//   A  the source is pinned and hashed:  validateSource, verifySource
//   B  the verification block:           initialVerification, deriveReview, appendReview, checkReviewPR
//   C  presentation stays out:           isRecordScene, recordForm, framing
//   D  packaging is a recorded choice:   PACKAGING
//   +  validateRecordJson (what CI runs), migrateRecord (legacy records to this schema)
//
// A record is the scene JSON the editor saves. The record proper is `userData.segmentation` on the group SEG made (see guides/MESH_SEGMENT.md).

export const RECORD_SCHEMA = 'stoa-record/1';

// ── A. the source: pinned, fetchable, hashed ──────────────────────────────────────────────────────

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RAW_GITHUB = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
const GITHUB_PAGE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree|raw)\/([^/]+)\/(.+)$/;

/**
 * A segmentation is a derivative work, so the record must say exactly what it derives from, in a way that can be fetched and checked and that cannot move.
 * `source` is { url, licence, attribution, sha256, bytes, page?, commit? }:
 *   url      the file itself, fetchable. For GitHub that is raw.githubusercontent.com/<owner>/<repo>/<commit sha>/<path>: a `blob/` link is a web page, and a
 *            branch name (`main`) is a ref that moves, so neither is accepted;
 *   commit   the 40-hex commit (derived from a GitHub url; for other hosts, optional);
 *   page     the human page for it (derived from a GitHub url);
 *   sha256   the hash of the file, lower-case hex: it survives link rot, because a re-hosted copy can be verified to be the same file;
 *   bytes    its size;
 *   fetchable  false, and only false, when the url is a page and the file is behind a login (a model site): the hash and size are still required, and a
 *            check that re-fetches sources says "not re-fetchable" instead of failing on the page.
 * Returns { source, legacy }. `legacy: true` lets a record that predates this (url, licence and attribution only) through, for replaying old records.
 */
export function validateSource( source, who = 'SEG.split', { legacy = false } = {} ) {

	if ( ! source || typeof source !== 'object' ) throw new Error( who + ': the plan needs a source: { url, licence, attribution, sha256, bytes }. A segmentation is a derivative work, and its record must say what it derives from, under what licence, and which exact file' );
	for ( const k of [ 'url', 'licence', 'attribution' ] ) if ( typeof source[ k ] !== 'string' || ! source[ k ].trim() ) throw new Error( who + ': source.' + k + ' is missing' );
	const url = source.url.trim();
	if ( ! /^https?:\/\/\S+$/i.test( url ) ) throw new Error( who + ': source.url must be the http(s) address of the original model' );
	const out = { url, licence: source.licence.trim(), attribution: source.attribution.trim() };
	if ( source.fetchable !== undefined && source.fetchable !== false ) throw new Error( who + ': source.fetchable is only ever false: it says that the url is a page and the file cannot be re-fetched' );
	const notFetchable = source.fetchable === false;
	const hasHash = source.sha256 !== undefined || source.bytes !== undefined || source.commit !== undefined;
	const page = notFetchable ? null : GITHUB_PAGE.exec( url );
	if ( page && ! ( legacy && ! hasHash ) ) throw new Error( `${ who }: source.url is a web page (${ page[ 3 ] }/), not the file, and nothing can fetch it. Use https://raw.githubusercontent.com/${ page[ 1 ] }/${ page[ 2 ] }/<commit sha>/${ page[ 5 ] } and put the page in source.page` );
	const raw = notFetchable ? null : RAW_GITHUB.exec( url );
	if ( raw ) {

		if ( ! COMMIT.test( raw[ 3 ] ) ) {

			if ( legacy && ! hasHash ) return { source: out, legacy: true };
			throw new Error( `${ who }: source.url names "${ raw[ 3 ] }", which is a ref that moves: if the file changes, the record points at different geometry and nothing says so. Pin the commit: replace it with the 40-character sha of the commit you took the file from` );

		}
		out.commit = raw[ 3 ];
		out.page = `https://github.com/${ raw[ 1 ] }/${ raw[ 2 ] }/blob/${ raw[ 3 ] }/${ raw[ 4 ] }`;

	}
	if ( source.commit !== undefined ) {

		if ( typeof source.commit !== 'string' || ! COMMIT.test( source.commit ) ) throw new Error( who + ': source.commit must be the 40-character commit sha' );
		if ( out.commit && out.commit !== source.commit ) throw new Error( `${ who }: source.commit (${ source.commit.slice( 0, 12 ) }…) is not the commit in source.url (${ out.commit.slice( 0, 12 ) }…)` );
		out.commit = source.commit;

	}
	if ( source.page !== undefined ) {

		if ( typeof source.page !== 'string' || ! /^https?:\/\/\S+$/i.test( source.page.trim() ) ) throw new Error( who + ': source.page must be an http(s) address' );
		out.page = source.page.trim();

	}
	if ( legacy && source.sha256 === undefined && source.bytes === undefined ) return { source: out, legacy: true };
	if ( typeof source.sha256 !== 'string' || ! SHA256.test( source.sha256.trim().toLowerCase() ) ) throw new Error( who + ': source.sha256 is missing or is not 64 hex digits. It is the hash of the original file: it is how a record whose link has died is re-attached to a copy and checked to be the same mesh. Compute it with SEG.source(url, { licence, attribution }), or `shasum -a 256 file`' );
	if ( ! Number.isInteger( source.bytes ) || source.bytes <= 0 ) throw new Error( who + ': source.bytes is missing: the size in bytes of the original file' );
	// the order a reader sees: where, what, which exact file, under what licence
	const ordered = { url: out.url };
	if ( out.page ) ordered.page = out.page;
	if ( out.commit ) ordered.commit = out.commit;
	ordered.sha256 = source.sha256.trim().toLowerCase();
	ordered.bytes = source.bytes;
	if ( notFetchable ) ordered.fetchable = false;
	ordered.licence = out.licence;
	ordered.attribution = out.attribution;
	return { source: ordered, legacy: false };

}

/** The SHA-256 of bytes, as lower-case hex (works in the editor and in node). */
export async function sha256Hex( bytes ) {

	const d = await globalThis.crypto.subtle.digest( 'SHA-256', bytes );
	return [ ...new Uint8Array( d ) ].map( b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

/**
 * Fetches the file a record says it derives from and checks it: same size, same hash. Returns { ok, problems, bytes, sha256 }; never throws on a mismatch.
 * `fetchBytes( url )` → Uint8Array, so that tests and CI can say how to fetch.
 */
export async function verifySource( source, fetchBytes ) {

	// a source behind a login (a model page) cannot be re-fetched: its hash is kept so that a copy can be checked against it, and it is said, not skipped silently
	if ( source.fetchable === false ) return { ok: true, problems: [], skipped: 'not re-fetchable: sha256 and size kept for re-attachment' };
	const problems = [];
	let bytes;
	try { bytes = await fetchBytes( source.url ); } catch ( e ) { return { ok: false, problems: [ `could not fetch ${ source.url }: ${ e.message }` ] }; }
	const sha256 = await sha256Hex( bytes );
	if ( bytes.byteLength !== source.bytes ) problems.push( `${ source.url } is ${ bytes.byteLength } bytes, the record says ${ source.bytes }` );
	if ( sha256 !== source.sha256 ) problems.push( `${ source.url } hashes to ${ sha256 }, the record says ${ source.sha256 }: the upstream file is not the one this record was made from` );
	return { ok: problems.length === 0, problems, bytes: bytes.byteLength, sha256 };

}

// ── B. verification: who looked, and whether they changed anything ────────────────────────────────

export const VERIFICATION_STATUS = [ 'seeded', 'reviewed', 'corrected' ];
export const REVIEW_ACTIONS = [ 'confirmed', 'corrected' ];
/** anchored: the reviewer saw the existing labels, so agreement measures agreement with the seed, not accuracy. blind: labels hidden; this is what calibrates the anchored rate. */
export const REVIEW_METHODS = [ 'anchored', 'blind' ];

/** What every new record starts with: seeded, and nobody has looked. */
export function initialVerification() {

	return { status: 'seeded', reviews: [] };

}

const iso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test( s ) && ! Number.isNaN( Date.parse( s ) );
const same = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );

/** The status a list of reviews implies: no reviews is seeded; any correction is corrected; otherwise reviewed. */
export function statusOf( reviews ) {

	if ( ! reviews.length ) return 'seeded';
	return reviews.some( r => r.action === 'corrected' ) ? 'corrected' : 'reviewed';

}

/** Problems with a verification block, as strings; empty when it is sound. */
export function validateVerification( v ) {

	const out = [];
	if ( ! v || typeof v !== 'object' ) return [ 'there is no verification block' ];
	if ( ! VERIFICATION_STATUS.includes( v.status ) ) out.push( `verification.status "${ v.status }" is not one of ${ VERIFICATION_STATUS.join( ', ' ) }` );
	if ( ! Array.isArray( v.reviews ) ) return [ ...out, 'verification.reviews is not a list' ];
	v.reviews.forEach( ( r, i ) => {

		const w = `verification.reviews[${ i }]`;
		if ( ! r || typeof r.by !== 'string' || ! /^@[A-Za-z0-9][A-Za-z0-9-]*$/.test( r.by ) ) out.push( `${ w }.by must be a handle like @name` );
		if ( ! r || ! iso( r.at ) ) out.push( `${ w }.at must be a UTC time like 2026-11-02T18:04:00Z` );
		if ( ! r || ! REVIEW_ACTIONS.includes( r.action ) ) out.push( `${ w }.action must be one of ${ REVIEW_ACTIONS.join( ', ' ) }` );
		if ( ! r || ! REVIEW_METHODS.includes( r.method ) ) out.push( `${ w }.method must be "anchored" or "blind": without it the agreement rate cannot be separated from the anchored one` );
		if ( ! r || ! Array.isArray( r.changed ) ) out.push( `${ w }.changed must be a list` );
		else if ( r.action === 'confirmed' && r.changed.length ) out.push( `${ w } says confirmed but lists ${ r.changed.length } change(s)` );
		else if ( r.action === 'corrected' && ! r.changed.length ) out.push( `${ w } says corrected but lists no change` );

	} );
	if ( VERIFICATION_STATUS.includes( v.status ) && v.status !== statusOf( v.reviews ) ) out.push( `verification.status is "${ v.status }" but its reviews say "${ statusOf( v.reviews ) }"` );
	return out;

}

// the labels of a record scene: every part of every segmented group, by uuid, with its name and classes. Labels are what a reviewer confirms or corrects.
function walk( o, fn ) { fn( o ); for ( const c of o.children || [] ) walk( c, fn ); }
export function segmentationGroups( json ) {

	const root = json && json.scene && json.scene.object, out = [];
	if ( root ) walk( root, o => { if ( o.userData && o.userData.segmentation ) out.push( o ); } );
	return out;

}
export function labelsOf( json ) {

	const out = {};
	for ( const g of segmentationGroups( json ) ) for ( const c of g.children || [] ) out[ c.uuid ] = { part: c.name, classes: [ ...( ( c.userData && c.userData.customClasses ) || [] ) ].sort() };
	return out;

}

/** What a reviewer changed: every part whose name or classes differ between two states of a record, by uuid, so that a rename is one change and not a delete and an add. */
export function labelChanges( baseJson, headJson ) {

	const a = labelsOf( baseJson ), b = labelsOf( headJson ), out = [];
	for ( const id of Object.keys( a ).sort() ) {

		if ( ! b[ id ] ) { out.push( { uuid: id, part: a[ id ].part, field: 'removed' } ); continue; }
		if ( a[ id ].part !== b[ id ].part ) out.push( { uuid: id, part: b[ id ].part, field: 'name', from: a[ id ].part, to: b[ id ].part } );
		if ( ! same( a[ id ].classes, b[ id ].classes ) ) out.push( { uuid: id, part: b[ id ].part, field: 'classes', from: a[ id ].classes, to: b[ id ].classes } );

	}
	for ( const id of Object.keys( b ).sort() ) if ( ! a[ id ] ) out.push( { uuid: id, part: b[ id ].part, field: 'added' } );
	return out;

}

/**
 * The review a change to a record amounts to, DERIVED, never typed: `action` from whether the labels actually changed, `changed` from the diff.
 * `by` (the PR's author) and `at` (the merge time) come from the pull request, and `method` from how the reviewer was shown the record.
 */
export function deriveReview( baseJson, headJson, { by, at, method } ) {

	const changed = labelChanges( baseJson, headJson );
	const review = { by, at, action: changed.length ? 'corrected' : 'confirmed', method, changed };
	const bad = validateVerification( { status: statusOf( [ review ] ), reviews: [ review ] } ).filter( p => ! p.startsWith( 'verification.status' ) );
	if ( bad.length ) throw new Error( 'deriveReview: ' + bad.join( '; ' ) );
	return review;

}

/**
 * Appends a review to a record's verification block and returns the new block. A confirmation is an append too, so agreement is a visible diff: with
 * no entry the only recorded signal would be disagreement, and silence would mean both "fine" and "nobody opened it".
 */
export function appendReview( verification, review ) {

	const reviews = [ ...( verification ? verification.reviews : [] ), review ];
	const next = { status: statusOf( reviews ), reviews };
	const bad = validateVerification( next );
	if ( bad.length ) throw new Error( 'appendReview: ' + bad.join( '; ' ) );
	return next;

}

/**
 * What a pull request must do to a record, checked from the base and head versions: append exactly one review, leave the earlier ones alone, and make that
 * review the one the diff amounts to (so a hand-typed `action` or `changed` that disagrees with the labels is refused). `by` is the PR author.
 * Returns problems as strings; empty when the PR is a proper review. A PR that changes labels without appending a review, or confirms without appending, fails.
 */
export function checkReviewPR( baseJson, headJson, { by } ) {

	const out = [], bg = segmentationGroups( baseJson ), hg = segmentationGroups( headJson );
	if ( bg.length !== hg.length || ! bg.length ) return [ 'the record has no segmentation group to review, or the number of groups changed' ];
	const b = bg[ 0 ].userData.segmentation.verification, h = hg[ 0 ].userData.segmentation.verification;
	if ( ! b || ! h ) return [ 'a record has no verification block' ];
	if ( h.reviews.length !== b.reviews.length + 1 ) return [ `a review PR appends exactly one review (the base has ${ b.reviews.length }, the head ${ h.reviews.length }): a confirmation must leave a diff, or silence means both "fine" and "unexamined"` ];
	if ( ! same( h.reviews.slice( 0, b.reviews.length ), b.reviews ) ) out.push( 'earlier reviews were edited: reviews are only appended' );
	const mine = h.reviews[ h.reviews.length - 1 ];
	if ( mine.by !== by ) out.push( `the review is by ${ mine.by } but the PR is by ${ by }: the reviewer is taken from the PR, not typed` );
	let expected;
	try { expected = deriveReview( baseJson, headJson, { by, at: mine.at, method: mine.method } ); } catch ( e ) { return [ ...out, e.message ]; }
	if ( ! same( mine, expected ) ) out.push( `the review does not match the diff: it says ${ JSON.stringify( { action: mine.action, changed: mine.changed } ) }, the labels say ${ JSON.stringify( { action: expected.action, changed: expected.changed } ) }` );
	if ( h.status !== statusOf( h.reviews ) ) out.push( `status is "${ h.status }", the reviews say "${ statusOf( h.reviews ) }"` );
	return out;

}

// ── C. presentation stays out of a record ─────────────────────────────────────────────────────────

/** What the editor saves besides the scene, and that varies with how the person last looked at it, not with what the record says. */
export const PRESENTATION = [ 'camera', 'controls', 'project', 'history' ];

/** A scene is a record when its root says so (`userData.record`, set by asRecord() in the Shell). Takes the editor's JSON, or the scene object's userData. */
export function isRecordScene( jsonOrUserData ) {

	const ud = jsonOrUserData && jsonOrUserData.scene ? jsonOrUserData.scene.object && jsonOrUserData.scene.object.userData : jsonOrUserData;
	return !! ( ud && ud.record && typeof ud.record === 'object' );

}

/** The editor's JSON as a record keeps it: without the camera, the controls, the renderer settings or the undo history. Everything else is untouched. */
export function recordForm( json ) {

	const out = {};
	for ( const k of Object.keys( json ) ) if ( ! PRESENTATION.includes( k ) ) out[ k ] = json[ k ];
	return out;

}

// ── a transform's canonical form ──────────────────────────────────────────────────────────────────
// three.js takes an object's matrix apart into position, rotation and scale on load and puts it back together when it next needs it, which moves the matrix's
// last digits. Rounding the matrix's elements cannot be a fixed point (a rounded rotation is no longer exactly a rotation, so the next load moves it again).
// So the rounding is done in the transform's own terms: position and scale to 9 significant digits, the rotation as a quaternion that is a fixed point of
// "normalise, then round to 9 decimals", and the matrix is composed from those. Saving, opening and saving again then gives the same numbers.

const r9 = x => Math.round( x * 1e9 ) / 1e9;
const sig9 = x => ( Math.abs( x ) < 1e-9 ? 0 : Number( x.toPrecision( 9 ) ) );

export function composeTRS( p, q, s ) {

	const [ x, y, z, w ] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
	return [
		( 1 - ( yy + zz ) ) * s[ 0 ], ( xy + wz ) * s[ 0 ], ( xz - wy ) * s[ 0 ], 0,
		( xy - wz ) * s[ 1 ], ( 1 - ( xx + zz ) ) * s[ 1 ], ( yz + wx ) * s[ 1 ], 0,
		( xz + wy ) * s[ 2 ], ( yz - wx ) * s[ 2 ], ( 1 - ( xx + yy ) ) * s[ 2 ], 0,
		p[ 0 ], p[ 1 ], p[ 2 ], 1
	];

}

// three.js's Matrix4.decompose and Quaternion.setFromRotationMatrix, on a plain 16-array
export function decomposeTRS( m ) {

	let sx = Math.hypot( m[ 0 ], m[ 1 ], m[ 2 ] ); const sy = Math.hypot( m[ 4 ], m[ 5 ], m[ 6 ] ), sz = Math.hypot( m[ 8 ], m[ 9 ], m[ 10 ] );
	const det = m[ 0 ] * ( m[ 5 ] * m[ 10 ] - m[ 9 ] * m[ 6 ] ) - m[ 4 ] * ( m[ 1 ] * m[ 10 ] - m[ 9 ] * m[ 2 ] ) + m[ 8 ] * ( m[ 1 ] * m[ 6 ] - m[ 5 ] * m[ 2 ] );
	if ( det < 0 ) sx = - sx;
	const a = [ m[ 0 ] / sx, m[ 1 ] / sx, m[ 2 ] / sx ], b = [ m[ 4 ] / sy, m[ 5 ] / sy, m[ 6 ] / sy ], c = [ m[ 8 ] / sz, m[ 9 ] / sz, m[ 10 ] / sz ];
	const m11 = a[ 0 ], m12 = b[ 0 ], m13 = c[ 0 ], m21 = a[ 1 ], m22 = b[ 1 ], m23 = c[ 1 ], m31 = a[ 2 ], m32 = b[ 2 ], m33 = c[ 2 ], trace = m11 + m22 + m33;
	let x, y, z, w, s;
	if ( trace > 0 ) { s = 0.5 / Math.sqrt( trace + 1 ); w = 0.25 / s; x = ( m32 - m23 ) * s; y = ( m13 - m31 ) * s; z = ( m21 - m12 ) * s; }
	else if ( m11 > m22 && m11 > m33 ) { s = 2 * Math.sqrt( 1 + m11 - m22 - m33 ); w = ( m32 - m23 ) / s; x = 0.25 * s; y = ( m12 + m21 ) / s; z = ( m13 + m31 ) / s; }
	else if ( m22 > m33 ) { s = 2 * Math.sqrt( 1 + m22 - m11 - m33 ); w = ( m13 - m31 ) / s; x = ( m12 + m21 ) / s; y = 0.25 * s; z = ( m23 + m32 ) / s; }
	else { s = 2 * Math.sqrt( 1 + m33 - m11 - m22 ); w = ( m21 - m12 ) / s; x = ( m13 + m31 ) / s; y = ( m23 + m32 ) / s; z = 0.25 * s; }
	return { p: [ m[ 12 ], m[ 13 ], m[ 14 ] ], q: [ x, y, z, w ], s: [ sx, sy, sz ] };

}

/** The canonical form of a 4×4 transform (column-major, as three.js writes it). A matrix that is not a position, a rotation and a scale (a shear, a singular one) is only rounded. */
export function canonicalMatrix( m ) {

	if ( ! Array.isArray( m ) || m.length !== 16 || ! m.every( Number.isFinite ) ) return m;
	const { p, q, s } = decomposeTRS( m );
	if ( ! [ ...p, ...q, ...s ].every( Number.isFinite ) || s.some( v => Math.abs( v ) < 1e-12 ) || Math.abs( m[ 3 ] ) > 1e-12 || Math.abs( m[ 7 ] ) > 1e-12 || Math.abs( m[ 11 ] ) > 1e-12 || Math.abs( m[ 15 ] - 1 ) > 1e-12 ) return m.map( sig9 );
	const norm = v => { const n = Math.hypot( ...v ); return v.map( x => x / n ); };
	let qr = q.map( r9 );
	for ( let i = 0; i < 32; i ++ ) { const next = norm( qr ).map( r9 ); if ( next.every( ( x, k ) => x === qr[ k ] ) ) break; qr = next; }
	return composeTRS( p.map( sig9 ), norm( qr ), s.map( sig9 ) );

}

/**
 * What a record is SAVED as: recordForm, plus the two things that make an open-and-save of the same record differ for no reason a person chose:
 *   image ids   three.js gives an image a new uuid every time it is loaded, so the id is replaced by its position (image-0, image-1, …) and the
 *               textures that point at it are rewritten to match;
 *   transforms  every object's matrix is put in canonical form (canonicalMatrix), so that the numbers that load moves by 1e-10 are the same every time.
 *               No transform changes by more than a few parts in 10^9.
 * The input is not modified.
 */
export function canonicalForm( json ) {

	const out = recordForm( json );
	if ( ! out.scene ) return out;
	const scene = { ...out.scene };
	if ( Array.isArray( scene.images ) ) {

		const ids = new Map();
		scene.images = scene.images.map( ( im, i ) => { ids.set( im.uuid, 'image-' + i ); return { ...im, uuid: 'image-' + i }; } );
		if ( Array.isArray( scene.textures ) ) scene.textures = scene.textures.map( t => ( t.image !== undefined && ids.has( t.image ) ? { ...t, image: ids.get( t.image ) } : t ) );

	}
	const object = o => {

		const c = { ...o };
		if ( Array.isArray( c.matrix ) ) c.matrix = canonicalMatrix( c.matrix );
		if ( Array.isArray( c.children ) ) c.children = c.children.map( object );
		return c;

	};
	if ( scene.object ) scene.object = object( scene.object );
	out.scene = scene;
	return out;

}

/**
 * The camera a record is opened with, computed from the scene's bounding box and nothing else, so opening is deterministic and saving never has a view to store.
 * `box` is { min: [x,y,z], max: [x,y,z] }. The view is always from the same side (front, a little right, a little above), at the distance that fits the box's
 * bounding sphere in the narrower field of view. An authored view (`record.view` = { position, target }) wins when a record genuinely needs one.
 */
export const FRAMING = { fov: 50, direction: [ 0.55, 0.38, 0.74 ], margin: 1.15 };
export function framing( box, view = null ) {

	const r6 = x => Math.round( x * 1e6 ) / 1e6;
	if ( view && Array.isArray( view.position ) && Array.isArray( view.target ) ) return { position: view.position.map( r6 ), target: view.target.map( r6 ), near: 0.01, far: 1000 };
	const c = box.min.map( ( lo, i ) => ( lo + box.max[ i ] ) / 2 ), radius = Math.max( 1e-6, Math.hypot( ...box.max.map( ( hi, i ) => ( hi - box.min[ i ] ) / 2 ) ) );
	const d = FRAMING.direction, n = Math.hypot( ...d ), dist = radius / Math.sin( FRAMING.fov * Math.PI / 360 ) * FRAMING.margin;
	return { position: c.map( ( x, i ) => r6( x + d[ i ] / n * dist ) ), target: c.map( r6 ), near: r6( Math.max( 0.001, dist / 1000 ) ), far: r6( dist * 20 ) };

}

// ── D. packaging: the geometry is either kept (a pack) or regenerated (a plan); say which ─────────────

/**
 * `pack`: the cut geometry is saved with the record (assets/pack-*.bin): it opens with no network and no regeneration, and it redistributes the source's
 *   geometry, so the source's licence obligations attach to the pack as well as to the plan.
 * `plan`: only the source and the plan are saved, and the cut is regenerated from the hashed source. It is ~35× smaller and redistributes instructions, not
 *   geometry. NOT IMPLEMENTED: the editor does not yet regenerate on open, so a record may not claim it.
 */
export const PACKAGING = { implemented: [ 'pack' ], declared: [ 'pack', 'plan' ] };

// ── what CI runs ──────────────────────────────────────────────────────────────────────────────────

const semver = v => String( v || '0' ).split( '.' ).map( n => parseInt( n, 10 ) || 0 );
export function atLeast( version, min ) {

	const a = semver( version ), b = semver( min );
	for ( let i = 0; i < 3; i ++ ) { if ( ( a[ i ] || 0 ) !== ( b[ i ] || 0 ) ) return ( a[ i ] || 0 ) > ( b[ i ] || 0 ); }
	return true;

}
/** The first version of SEG that writes the schema above. */
export const SCHEMA_SEG_VERSION = '1.3.0';

/**
 * Everything wrong with a record, as strings; empty when it is a valid record. `scene.json` of a legacy asset (made before SEG 1.3.0) is reported as needing
 * migration, with what is missing.
 */
export function validateRecordJson( json ) {

	const out = [], groups = segmentationGroups( json );
	if ( ! groups.length ) return [ 'there is no segmentation record in this scene' ];
	for ( const g of groups ) {

		const s = g.userData.segmentation, w = `"${ g.name }"`;
		if ( ! s.source ) {

			out.push( `${ w } is a legacy record (SEG ${ s.seg_version || 'unversioned' }): its source is ${ s.source_url ? 'the floating ' + s.source_url : 'missing' }, with no pinned commit, hash or size, and it has ${ s.verification ? 'a' : 'no' } verification block. Migrate it` );
			continue;

		}
		try { validateSource( s.source, w ); } catch ( e ) { out.push( `${ w }: ${ e.message.replace( /^[^:]*: /, '' ) }` ); }
		if ( s.source && s.source.url && ! RAW_GITHUB.test( s.source.url ) && /github\.com/.test( s.source.url ) ) out.push( `${ w }: source.url is not a raw, commit-pinned address` );
		for ( const k of [ 'source_url', 'source_licence', 'attribution' ] ) if ( k in s ) out.push( `${ w }: "${ k }" is the old flat form: it lives in source now, and a second copy is a second source of truth` );
		out.push( ...validateVerification( s.verification ).map( p => `${ w }: ${ p }` ) );
		if ( s.parents !== undefined ) {

			// SEG 1.5.0: one parent triangle per output triangle, so a part's parents are as many as its triangles
			const names = Object.keys( s.parts || {} );
			if ( JSON.stringify( Object.keys( s.parents ) ) !== JSON.stringify( names ) ) out.push( `${ w }: parents and parts do not name the same parts` );
			else for ( const n of names ) if ( ! Array.isArray( s.parents[ n ] ) || s.parents[ n ].length !== s.parts[ n ] ) out.push( `${ w }: "${ n }" has ${ Array.isArray( s.parents[ n ] ) ? s.parents[ n ].length : 'no' } parents for ${ s.parts[ n ] } triangles` );

		}

	}
	const ud = json.scene && json.scene.object && json.scene.object.userData;
	if ( ! isRecordScene( ud ) ) out.push( 'the scene is not marked as a record (userData.record), so the editor would save the camera and the renderer settings with it' );
	else {

		for ( const k of PRESENTATION ) if ( k in json ) out.push( `the record carries "${ k }": presentation, which makes every diff include how the last person looked at it` );
		if ( ! PRESENTATION.some( k => k in json ) && JSON.stringify( canonicalForm( json ) ) !== JSON.stringify( json ) ) out.push( 'the record is not in canonical form: image ids or transform matrices carry the noise of a load (image uuids are regenerated on every open, matrices drift by 1e-10), so opening and saving it would change it. Save it from the editor with the scene marked as a record (asRecord())' );
		const p = ud.record.packaging;
		if ( ! PACKAGING.declared.includes( p ) ) out.push( `userData.record.packaging is "${ p }": say "pack" or "plan", so that how the geometry travels is a recorded choice` );
		else if ( ! PACKAGING.implemented.includes( p ) ) out.push( `userData.record.packaging is "${ p }", which the editor does not implement yet` );
		if ( ud.record.view !== undefined && ! ( Array.isArray( ud.record.view.position ) && Array.isArray( ud.record.view.target ) ) ) out.push( 'userData.record.view must be { position: [x,y,z], target: [x,y,z] }' );

	}
	return out;

}

/**
 * Brings a legacy record up to the schema, offline. `sources` maps a legacy source URL (the floating one) to the pinned, hashed source:
 *   { 'https://github.com/…/blob/main/…/Duck.glb': { url, commit, sha256, bytes } }
 * The licence and attribution are kept from the record; a note is added to `modifications`; the cut itself is untouched. Returns a new JSON.
 */
export function migrateRecord( json, sources, { packaging = 'pack' } = {} ) {

	const out = canonicalForm( JSON.parse( JSON.stringify( json ) ) );
	for ( const g of segmentationGroups( out ) ) {

		const s = g.userData.segmentation;
		if ( s.source && s.verification ) continue;
		const legacyUrl = s.source_url || ( s.plan && s.plan.source && s.plan.source.url ), pinned = sources[ legacyUrl ];
		if ( ! pinned ) throw new Error( `migrateRecord: no pinned source given for ${ legacyUrl }` );
		const { source } = validateSource( { licence: s.source_licence || ( s.plan.source || {} ).licence, attribution: s.attribution || ( s.plan.source || {} ).attribution, ...pinned }, 'migrateRecord' );
		const head = {};
		for ( const k of Object.keys( s ) ) {

			if ( k === 'source_url' ) head.source = source;
			else if ( k === 'source_licence' || k === 'attribution' ) continue;
			else head[ k ] = s[ k ];

		}
		head.source = source;
		head.plan = { ...head.plan, source: { url: source.url, licence: source.licence, attribution: source.attribution, sha256: source.sha256, bytes: source.bytes } };
		head.modifications = [ ...( head.modifications || [] ), `Record schema updated to ${ RECORD_SCHEMA }: the source is pinned to commit ${ source.commit || '(none)' } and carries its sha256 and size, a verification block was added, the camera, controls, renderer settings and history were removed, image ids were renumbered and transforms were put in canonical form (position, rotation and scale rounded to 9 digits; no transform moves by more than a few parts in 10^9) so that opening and saving a record changes nothing. The cut and the names are unchanged.` ];
		head.verification = initialVerification();
		g.userData.segmentation = head;

	}
	const root = out.scene.object;
	root.userData = { ...( root.userData || {} ), record: { schema: RECORD_SCHEMA, packaging } };
	return out;

}
