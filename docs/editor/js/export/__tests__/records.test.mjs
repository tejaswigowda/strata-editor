// Run: node docs/editor/js/export/__tests__/records.test.mjs
// The record schema: a pinned and hashed source (V1, V2), the verification block and what a review must do to it (V3, V4, V6), presentation kept out of the
// record (V5), the packaging choice, and migration of a legacy record.
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
	validateSource, verifySource, sha256Hex, initialVerification, validateVerification, statusOf, deriveReview, appendReview, checkReviewPR, labelChanges,
	isRecordScene, recordForm, canonicalForm, canonicalMatrix, composeTRS, decomposeTRS, framing, FRAMING, PRESENTATION, PACKAGING, validateRecordJson, migrateRecord, atLeast, RECORD_SCHEMA, REVIEW_METHODS
} from '../records.js';

let pass = 0, fail = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

const COMMIT = 'd7a3cc8e51d7c573771ae77a57f16b0662a905c6';
const FILE = new TextEncoder().encode( 'not really a glb, but bytes are bytes' );
const FILE_SHA = createHash( 'sha256' ).update( FILE ).digest( 'hex' );
const SOURCE = { url: `https://raw.githubusercontent.com/KhronosGroupArchives/glTF-Sample-Models/${ COMMIT }/2.0/Duck/glTF-Binary/Duck.glb`, sha256: FILE_SHA, bytes: FILE.byteLength, licence: 'SCEA Shared Source License 1.0', attribution: 'Copyright 2006 Sony Computer Entertainment Inc.' };

// a record scene as the editor saves it, with the presentation the editor adds
function editorJson( { parts, verification = initialVerification(), camera = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 5, 1 ], marked = true, source = validateSource( SOURCE ).source, version = '1.3.0', extra = {} } = {} ) {

	const kids = ( parts || [ [ 'u1', 'Duck_Beak', [ 'beak', 'orange' ] ], [ 'u2', 'Duck_Body', [ 'body', 'yellow' ] ], [ 'u3', 'Duck_Eye_Left', [ 'eye', 'left' ] ] ] ).map( ( [ uuid, name, classes ] ) => ( { uuid, type: 'Mesh', name, userData: { customClasses: classes } } ) );
	return {
		metadata: {}, project: { renderer: 'WebGPURenderer', shadows: true, toneMapping: 7 },
		camera: { object: { uuid: 'cam', type: 'PerspectiveCamera', matrix: camera } }, controls: { center: [ 0, 0.77, 0 ] },
		scene: { object: { uuid: 'root', type: 'Scene', name: 'Scene', userData: marked ? { requireLabels: true, record: { schema: RECORD_SCHEMA, packaging: 'pack' } } : { requireLabels: true }, children: [
			{ uuid: 'g', type: 'Group', name: 'Duck', userData: { segmentation: { from: 'LOD3spShape', seg_version: version, method: 'islands', ...( source ? { source } : { source_url: 'https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Duck/glTF-Binary/Duck.glb' } ), parts: { Duck_Beak: 10 }, verification } }, children: kids },
			{ uuid: 'light', type: 'DirectionalLight', name: 'KeyLight' } ] } },
		animations: [], scripts: {}, history: { undos: [ { name: 'Multiple Changes' } ], redos: [] }, backgroundType: 7, environmentType: 7, ...extra
	};

}
const record = ( o ) => recordForm( editorJson( o ) );
const clone = j => JSON.parse( JSON.stringify( j ) );
const seg = j => j.scene.object.children[ 0 ].userData.segmentation;

// ── A ───────────────────────────────────────────────────────────────────────────────────────────────

await test( 'V1: a record\'s source pins a commit and carries sha256 and bytes', () => {

	assert.deepStrictEqual( validateRecordJson( record() ), [] );
	const s = seg( record() ).source;
	assert.ok( /^[0-9a-f]{40}$/.test( s.commit ) && /^[0-9a-f]{64}$/.test( s.sha256 ) && s.bytes > 0 );
	assert.ok( s.url.startsWith( 'https://raw.githubusercontent.com/' ) && s.page.includes( '/blob/' + COMMIT + '/' ), 'the url is the file, the page is for humans' );

} );

await test( 'V1: a record with a floating source, no hash, or the old flat fields is reported, with what is wrong with it', () => {

	const legacy = validateRecordJson( record( { source: null, version: '1.1.0' } ) );
	assert.ok( legacy.length >= 1 && /legacy record \(SEG 1\.1\.0\).*floating https:\/\/github\.com\/.*blob\/main.*no pinned commit, hash or size.*Migrate it/.test( legacy[ 0 ] ), legacy[ 0 ] );
	const floating = record(); seg( floating ).source.url = SOURCE.url.replace( COMMIT, 'main' );
	assert.ok( validateRecordJson( floating ).some( p => /ref that moves/.test( p ) ) );
	const noHash = record(); delete seg( noHash ).source.sha256;
	assert.ok( validateRecordJson( noHash ).some( p => /source\.sha256 is missing/.test( p ) ) );
	const flat = record(); seg( flat ).source_url = 'x';
	assert.ok( validateRecordJson( flat ).some( p => /old flat form/.test( p ) ) );

} );

await test( 'V2: re-fetching a source and hashing it: the same file passes, a changed one is named, a dead link is reported', async () => {

	const ok = await verifySource( validateSource( SOURCE ).source, async () => FILE );
	assert.deepStrictEqual( [ ok.ok, ok.problems.length, ok.bytes, ok.sha256 ], [ true, 0, FILE.byteLength, FILE_SHA ] );
	const touched = new Uint8Array( FILE ); touched[ 3 ] ^= 1;
	const changed = await verifySource( validateSource( SOURCE ).source, async () => touched );
	assert.strictEqual( changed.ok, false );
	assert.ok( changed.problems.length === 1 && /hashes to [0-9a-f]{64}, the record says .*not the one this record was made from/.test( changed.problems[ 0 ] ), 'same size, different bytes: only the hash says so' );
	const longer = await verifySource( validateSource( SOURCE ).source, async () => new Uint8Array( [ ...FILE, 0 ] ) );
	assert.strictEqual( longer.problems.length, 2, 'a different size is a different hash too' );
	const dead = await verifySource( validateSource( SOURCE ).source, async () => { throw new Error( '404' ); } );
	assert.deepStrictEqual( [ dead.ok, dead.problems[ 0 ].includes( 'could not fetch' ) ], [ false, true ] );
	assert.strictEqual( await sha256Hex( FILE ), FILE_SHA );

} );

// ── B ───────────────────────────────────────────────────────────────────────────────────────────────

await test( 'V3: a new record is seeded with no reviews, and that is a valid verification block', () => {

	assert.deepStrictEqual( initialVerification(), { status: 'seeded', reviews: [] } );
	assert.deepStrictEqual( validateVerification( initialVerification() ), [] );
	assert.deepStrictEqual( seg( record() ).verification, { status: 'seeded', reviews: [] } );
	assert.ok( validateRecordJson( record( { verification: undefined } ) ).length === 0, 'the default is seeded' );
	const none = record(); delete seg( none ).verification;
	assert.ok( validateRecordJson( none ).some( p => /no verification block/.test( p ) ) );

} );

const BY = '@alice', AT = '2026-11-02T18:04:00Z';
function withReview( json, review ) { const j = clone( json ); seg( j ).verification = appendReview( seg( j ).verification, review ); return j; }

await test( 'V4: a confirmation, with no label changed, still produces a non-empty diff', () => {

	const base = record(), head = clone( base );
	assert.deepStrictEqual( labelChanges( base, head ), [] );
	const review = deriveReview( base, head, { by: BY, at: AT, method: 'anchored' } );
	assert.deepStrictEqual( review, { by: BY, at: AT, action: 'confirmed', method: 'anchored', changed: [] } );
	const after = withReview( head, review );
	assert.notStrictEqual( JSON.stringify( after ), JSON.stringify( base ), 'agreement is visible in the diff' );
	assert.strictEqual( seg( after ).verification.status, 'reviewed' );
	assert.deepStrictEqual( checkReviewPR( base, after, { by: BY } ), [] );
	// and with nothing appended, silence: refused
	assert.ok( checkReviewPR( base, clone( base ), { by: BY } )[ 0 ].includes( 'appends exactly one review' ) );

} );

await test( 'rule 1: a PR that changes labels but appends no review is refused, as is one that appends two', () => {

	const base = record(), relabelled = record( { parts: [ [ 'u1', 'Duck_Beak', [ 'beak', 'green' ] ], [ 'u2', 'Duck_Body', [ 'body', 'yellow' ] ], [ 'u3', 'Duck_Eye_Left', [ 'eye', 'left' ] ] ] } );
	assert.ok( checkReviewPR( base, relabelled, { by: BY } )[ 0 ].includes( 'appends exactly one review' ) );
	const r = { by: BY, at: AT, action: 'confirmed', method: 'anchored', changed: [] };
	const two = clone( base ); seg( two ).verification = { status: 'reviewed', reviews: [ r, { ...r, at: '2026-11-03T00:00:00Z' } ] };
	assert.ok( checkReviewPR( base, two, { by: BY } )[ 0 ].includes( 'appends exactly one review' ) );

} );

await test( 'rule 2: the review is derived from the diff, not typed: action, changed and who must agree with the PR', () => {

	const base = record(), relabelled = record( { parts: [ [ 'u1', 'Duck_Beak', [ 'beak', 'green' ] ], [ 'u2', 'Duck_Body', [ 'body', 'yellow' ] ], [ 'u3', 'Duck_Eye_Left', [ 'eye', 'left' ] ] ] } );
	const real = deriveReview( base, relabelled, { by: BY, at: AT, method: 'anchored' } );
	assert.strictEqual( real.action, 'corrected' );
	assert.deepStrictEqual( real.changed, [ { uuid: 'u1', part: 'Duck_Beak', field: 'classes', from: [ 'beak', 'orange' ], to: [ 'beak', 'green' ] } ] );
	const good = withReview( relabelled, real );
	assert.deepStrictEqual( checkReviewPR( base, good, { by: BY } ), [] );
	assert.strictEqual( seg( good ).verification.status, 'corrected' );
	// a contributor who types "confirmed" while the labels changed
	const lie = clone( relabelled ); seg( lie ).verification = { status: 'reviewed', reviews: [ { by: BY, at: AT, action: 'confirmed', method: 'anchored', changed: [] } ] };
	assert.ok( checkReviewPR( base, lie, { by: BY } ).some( p => /does not match the diff/.test( p ) ) );
	// a review that names someone other than the PR's author
	assert.ok( checkReviewPR( base, good, { by: '@mallory' } ).some( p => /taken from the PR, not typed/.test( p ) ) );
	// an edit to an earlier review
	const sealed = withReview( base, deriveReview( base, base, { by: BY, at: AT, method: 'blind' } ) );
	const tampered = withReview( sealed, deriveReview( sealed, sealed, { by: '@bob', at: '2026-11-05T09:00:00Z', method: 'anchored' } ) );
	seg( tampered ).verification.reviews[ 0 ].method = 'anchored';
	assert.ok( checkReviewPR( sealed, tampered, { by: '@bob' } ).some( p => /earlier reviews were edited/.test( p ) ) );
	// a rename and an added part are changes too
	assert.deepStrictEqual( labelChanges( base, record( { parts: [ [ 'u1', 'Duck_Bill', [ 'beak', 'orange' ] ], [ 'u2', 'Duck_Body', [ 'body', 'yellow' ] ], [ 'u3', 'Duck_Eye_Left', [ 'eye', 'left' ] ] ] } ) ).map( c => c.field ), [ 'name' ] );

} );

await test( 'V6: every review says whether it was anchored or blind, and nothing else is accepted', () => {

	assert.deepStrictEqual( REVIEW_METHODS, [ 'anchored', 'blind' ] );
	const base = record();
	for ( const method of REVIEW_METHODS ) assert.strictEqual( deriveReview( base, base, { by: BY, at: AT, method } ).method, method );
	assert.throws( () => deriveReview( base, base, { by: BY, at: AT } ), /method must be "anchored" or "blind"/ );
	assert.throws( () => deriveReview( base, base, { by: BY, at: AT, method: 'quick' } ), /method must be/ );
	assert.throws( () => deriveReview( base, base, { by: 'alice', at: AT, method: 'blind' } ), /handle like @name/ );
	assert.throws( () => deriveReview( base, base, { by: BY, at: '2026-11-02', method: 'blind' } ), /UTC time/ );
	const missing = record( { verification: { status: 'reviewed', reviews: [ { by: BY, at: AT, action: 'confirmed', changed: [] } ] } } );
	assert.ok( validateRecordJson( missing ).some( p => /method must be "anchored" or "blind"/.test( p ) ) );

} );

await test( 'the status follows the reviews: seeded, reviewed, corrected, and cannot be set by hand to say otherwise', () => {

	const c = { by: BY, at: AT, action: 'confirmed', method: 'anchored', changed: [] }, x = { ...c, action: 'corrected', changed: [ { uuid: 'u1', part: 'a', field: 'name', from: 'a', to: 'b' } ] };
	assert.deepStrictEqual( [ statusOf( [] ), statusOf( [ c ] ), statusOf( [ c, x ] ), statusOf( [ x, c ] ) ], [ 'seeded', 'reviewed', 'corrected', 'corrected' ] );
	assert.deepStrictEqual( appendReview( appendReview( initialVerification(), c ), x ).status, 'corrected' );
	assert.ok( validateVerification( { status: 'seeded', reviews: [ c ] } )[ 0 ].includes( 'status is "seeded" but its reviews say "reviewed"' ) );
	assert.ok( validateVerification( { status: 'reviewed', reviews: [ { ...c, changed: x.changed } ] } ).some( p => /says confirmed but lists 1 change/.test( p ) ) );
	assert.ok( validateVerification( { status: 'corrected', reviews: [ { ...x, changed: [] } ] } ).some( p => /says corrected but lists no change/.test( p ) ) );

} );

// ── C ───────────────────────────────────────────────────────────────────────────────────────────────

await test( 'V5: open a record, orbit, save: the saved record is the same, because the view is not in it', () => {

	const opened = record(), orbited = recordForm( editorJson( { camera: [ 0.2, 0, -0.98, 0, 0, 1, 0, 0, 0.98, 0, 0.2, 0, -7, 4, 1, 1 ], extra: { controls: { center: [ 9, 9, 9 ] }, history: { undos: [ 1, 2, 3, 4, 5 ], redos: [] }, project: { renderer: 'WebGLRenderer', toneMapping: 0 } } } ) );
	assert.strictEqual( JSON.stringify( orbited ), JSON.stringify( opened ), 'byte for byte' );
	for ( const k of PRESENTATION ) assert.ok( ! ( k in opened ), k + ' is not in a record' );
	assert.ok( 'scene' in opened && 'backgroundType' in opened && 'animations' in opened, 'what is the scene stays' );
	assert.strictEqual( isRecordScene( editorJson() ), true );
	assert.strictEqual( isRecordScene( editorJson( { marked: false } ) ), false );
	assert.strictEqual( isRecordScene( { requireLabels: true } ), false );
	assert.deepStrictEqual( validateRecordJson( editorJson() ).filter( p => /presentation/.test( p ) ).length, 4, 'a record that carries them is refused, naming each' );

} );

// a rotation by `angle` about the unit axis, as a quaternion
const quat = ( axis, angle ) => { const n = Math.hypot( ...axis ), h = angle / 2; return [ ...axis.map( a => a / n * Math.sin( h ) ), Math.cos( h ) ]; };
let seed = 12345; const rand = () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );
const randomTRS = () => composeTRS( [ ( rand() - 0.5 ) * 40, ( rand() - 0.5 ) * 40, ( rand() - 0.5 ) * 40 ], quat( [ rand() - 0.5, rand() - 0.5, rand() - 0.5 ], rand() * 6.3 ), [ 0.05 + rand() * 3, 0.05 + rand() * 3, 0.05 + rand() * 3 ] );
// what the editor does to a matrix it has loaded and is about to save again: take it apart, put it back together (and, in the worst case, a little float noise)
const reloaded = ( m, noise = 0 ) => { const { p, q, s } = decomposeTRS( m ); return composeTRS( p, q, s ).map( ( x, i ) => ( [ 3, 7, 11, 15 ].includes( i ) ? x : x + ( rand() - 0.5 ) * noise ) ); };

await test( 'V5: what a load does to a record (new image ids, matrices off by 1e-10) is removed by the canonical form', () => {

	const withScene = ( json, imageId, matrix ) => {

		const j = clone( json );
		j.scene.images = [ { uuid: imageId, url: 'data:image/png;base64,AAAA' } ];
		j.scene.textures = [ { uuid: 'tex', name: 'base', image: imageId } ];
		j.scene.object.children[ 0 ].matrix = matrix;
		return j;

	};
	const m = composeTRS( [ 12.5, 0, -3.25 ], quat( [ 0.3, 1, -0.2 ], 2.2 ), [ 1, 1, 1 ] );        // an object as the importer left it
	const first = canonicalForm( withScene( editorJson(), 'an-uuid-from-the-first-load', m ) );
	const opened = canonicalForm( withScene( editorJson(), 'a-different-uuid-from-the-next-load', reloaded( first.scene.object.children[ 0 ].matrix, 4e-17 ) ) );
	assert.strictEqual( JSON.stringify( opened ), JSON.stringify( first ), 'two loads of the same record save the same bytes' );
	assert.deepStrictEqual( first.scene.images.map( i => i.uuid ), [ 'image-0' ] );
	assert.strictEqual( first.scene.textures[ 0 ].image, 'image-0', 'the texture follows its image' );
	const out = first.scene.object.children[ 0 ].matrix;
	assert.deepStrictEqual( [ out[ 12 ], out[ 13 ], out[ 14 ] ], [ 12.5, 0, -3.25 ], 'the position is kept' );
	assert.ok( out.every( ( x, i ) => Math.abs( x - m[ i ] ) < 5e-9 ), 'no element moves by more than a few parts in 10^9' );
	assert.strictEqual( JSON.stringify( canonicalForm( first ) ), JSON.stringify( first ), 'idempotent' );
	assert.notStrictEqual( JSON.stringify( editorJson() ), JSON.stringify( canonicalForm( withScene( editorJson(), 'x', m ) ) ) );
	assert.ok( validateRecordJson( recordForm( withScene( editorJson(), 'a-uuid', m ) ) ).some( p => /not in canonical form/.test( p ) ), 'CI notices a record saved with the noise in it' );
	assert.deepStrictEqual( validateRecordJson( first ), [] );

} );

await test( 'V5: a transform in canonical form is a fixed point of what the editor does to it: 20,000 random transforms, three reloads each, none moves', () => {

	let bad = 0, worst = 0;
	for ( let i = 0; i < 20000; i ++ ) {

		const m = randomTRS(), c = canonicalMatrix( m );
		worst = Math.max( worst, ...c.map( ( x, k ) => Math.abs( x - m[ k ] ) / Math.max( 1, Math.abs( m[ k ] ) ) ) );
		let cur = c;
		for ( let r = 0; r < 3; r ++ ) { cur = canonicalMatrix( reloaded( cur, 2e-16 ) ); if ( cur.some( ( x, k ) => x !== c[ k ] ) ) { bad ++; break; } }
		if ( canonicalMatrix( c ).some( ( x, k ) => x !== c[ k ] ) ) bad ++;

	}
	assert.strictEqual( bad, 0, bad + ' of 20000 transforms changed on reload' );
	assert.ok( worst < 2e-8, 'the largest change to any element, relative: ' + worst );

} );

await test( 'V5: the canonical form handles the awkward ones: identity, mirrored, tiny scale, a half-turn, and what is not a transform at all', () => {

	const same = ( m ) => { const c = canonicalMatrix( m ); assert.strictEqual( JSON.stringify( canonicalMatrix( reloaded( c ) ) ), JSON.stringify( c ) ); return c; };
	same( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] );
	same( composeTRS( [ 1, 2, 3 ], [ 0, 0, 0, 1 ], [ - 1, 1, 1 ] ) );                                  // mirrored
	same( composeTRS( [ 0, 0, 0 ], quat( [ 0, 1, 0 ], Math.PI ), [ 0.001, 0.001, 0.001 ] ) );          // a half-turn: w is 0
	same( composeTRS( [ 1e-12, 0, 5 ], quat( [ 1, 1, 1 ], 2.0944 ), [ 2, 2, 2 ] ) );
	assert.deepStrictEqual( canonicalMatrix( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] ), [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ], 'identity stays identity' );
	assert.strictEqual( canonicalMatrix( undefined ), undefined );
	assert.deepStrictEqual( canonicalMatrix( [ 1, 2, 3 ] ), [ 1, 2, 3 ] );
	assert.deepStrictEqual( canonicalMatrix( new Array( 16 ).fill( 0 ) ), new Array( 16 ).fill( 0 ), 'a singular matrix is rounded, not decomposed' );

} );

await test( 'C: the camera is derived from the scene\'s box, the same every time, from the same side, and an authored view wins', () => {

	const box = { min: [ -1, 0, -1 ], max: [ 1, 2, 1 ] };
	const a = framing( box ), b = framing( clone( box ) );
	assert.deepStrictEqual( a, b );
	assert.deepStrictEqual( a.target, [ 0, 1, 0 ] );
	const d = a.position.map( ( x, i ) => x - a.target[ i ] ), len = Math.hypot( ...d ), dn = FRAMING.direction, dl = Math.hypot( ...dn );
	assert.ok( d.every( ( x, i ) => Math.abs( x / len - dn[ i ] / dl ) < 1e-5 ), 'from the fixed direction' );
	const radius = Math.hypot( 1, 1, 1 );
	assert.ok( Math.abs( len - radius / Math.sin( FRAMING.fov * Math.PI / 360 ) * FRAMING.margin ) < 1e-4, 'far enough that the bounding sphere fits' );
	const big = framing( { min: [ -10, 0, -10 ], max: [ 10, 20, 10 ] } );
	assert.ok( Math.abs( Math.hypot( ...big.position.map( ( x, i ) => x - big.target[ i ] ) ) / len - 10 ) < 1e-3, 'ten times the box, ten times the distance' );
	assert.deepStrictEqual( framing( box, { position: [ 5, 5, 5 ], target: [ 0, 1, 0 ] } ).position, [ 5, 5, 5 ] );
	assert.ok( Number.isFinite( framing( { min: [ 0, 0, 0 ], max: [ 0, 0, 0 ] } ).far ), 'an empty box does not blow up' );

} );

// ── D ───────────────────────────────────────────────────────────────────────────────────────────────

await test( 'A: a source that cannot be re-fetched (a model page behind a login) says so, still needs its hash and size, and is reported, not failed or skipped silently', async () => {

	const page = { url: 'https://sketchfab.com/3d-models/cyberpunk-micro-apartments-fd8011e2af0e43288f5445600197ea77', fetchable: false, sha256: FILE_SHA, bytes: 2266956, licence: 'CC Attribution-NonCommercial', attribution: 'Mikita_Hubanau' };
	const { source } = validateSource( page );
	assert.deepStrictEqual( Object.keys( source ), [ 'url', 'sha256', 'bytes', 'fetchable', 'licence', 'attribution' ] );
	assert.throws( () => validateSource( { ...page, sha256: undefined } ), /source\.sha256 is missing/ );
	assert.throws( () => validateSource( { ...page, fetchable: true } ), /only ever false/ );
	assert.strictEqual( 'fetchable' in validateSource( { ...page, fetchable: undefined } ).source, false, 'left out, the page is a normal source: CI would fetch the page, and its hash would not match' );
	const v = await verifySource( source, async () => { throw new Error( 'must not be fetched' ); } );
	assert.deepStrictEqual( [ v.ok, v.problems.length, /not re-fetchable/.test( v.skipped ) ], [ true, 0, true ] );
	assert.deepStrictEqual( validateSource( { ...page, url: 'https://github.com/o/r/blob/main/x.glb' } ).source.url, 'https://github.com/o/r/blob/main/x.glb', 'fetchable:false is an explicit statement that the url is a page' );

} );

await test( 'D: how the geometry travels is a recorded choice: pack is implemented, plan is declared and refused until it is', () => {

	assert.deepStrictEqual( PACKAGING, { implemented: [ 'pack' ], declared: [ 'pack', 'plan' ] } );
	const noChoice = record(); delete noChoice.scene.object.userData.record.packaging;
	assert.ok( validateRecordJson( noChoice ).some( p => /say "pack" or "plan"/.test( p ) ) );
	const plan = record(); plan.scene.object.userData.record.packaging = 'plan';
	assert.ok( validateRecordJson( plan ).some( p => /does not implement yet/.test( p ) ) );
	const view = record(); view.scene.object.userData.record.view = { position: [ 1, 2, 3 ] };
	assert.ok( validateRecordJson( view ).some( p => /record\.view must be/.test( p ) ) );

} );

// ── migration ───────────────────────────────────────────────────────────────────────────────────────

await test( 'a legacy record migrates offline to the schema, keeps its cut and its names, and says what was done', () => {

	const legacyUrl = 'https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Duck/glTF-Binary/Duck.glb';
	const legacy = editorJson( { source: null, version: '1.1.0', marked: false } );
	Object.assign( seg( legacy ), { source_licence: 'SCEA Shared Source License 1.0', attribution: 'Copyright 2006 Sony Computer Entertainment Inc.', plan: { group: 'Duck', source: { url: legacyUrl, licence: 'x', attribution: 'y' }, parts: [] } } );
	assert.ok( validateRecordJson( legacy ).length > 0 );
	const sources = { [ legacyUrl ]: { url: SOURCE.url, sha256: FILE_SHA, bytes: FILE.byteLength } };
	const migrated = migrateRecord( legacy, sources );
	assert.deepStrictEqual( validateRecordJson( migrated ), [] );
	const s = seg( migrated );
	assert.deepStrictEqual( [ s.source.commit, s.source.licence, s.source.attribution ], [ COMMIT, 'SCEA Shared Source License 1.0', 'Copyright 2006 Sony Computer Entertainment Inc.' ], 'the licence and credit are kept, not retyped' );
	assert.deepStrictEqual( s.verification, { status: 'seeded', reviews: [] } );
	assert.ok( ! ( 'source_url' in s ) && ! ( 'camera' in migrated ) );
	assert.strictEqual( s.seg_version, '1.1.0', 'the version that made the cut is not rewritten' );
	assert.ok( s.modifications.at( - 1 ).includes( 'pinned to commit ' + COMMIT ) && s.modifications.at( - 1 ).includes( 'The cut and the names are unchanged' ) );
	assert.ok( ! JSON.stringify( s.plan.source ).includes( '/blob/main/' ), 'the plan that replays the cut has the pinned source too' );
	assert.deepStrictEqual( migrated.scene.object.children[ 0 ].children.map( c => c.name ), [ 'Duck_Beak', 'Duck_Body', 'Duck_Eye_Left' ] );
	assert.strictEqual( JSON.stringify( migrateRecord( migrated, sources ) ), JSON.stringify( migrated ), 'migrating a migrated record changes nothing' );
	assert.throws( () => migrateRecord( legacy, {} ), /no pinned source given for/ );
	assert.ok( atLeast( '1.3.0', '1.3.0' ) && atLeast( '1.10.0', '1.3.0' ) && ! atLeast( '1.2.9', '1.3.0' ) && ! atLeast( undefined, '1.3.0' ) );

} );

await test( 'SEG 1.5.0: parents, when present, are one per output triangle and name the same parts', () => {

	const j = record();
	seg( j ).parts = { Duck_Beak: 2, Duck_Body: 1 };
	seg( j ).parents = { Duck_Beak: [ 0, 1 ], Duck_Body: [ 2 ] };
	assert.deepStrictEqual( validateRecordJson( j ), [] );
	const short = clone( j ); seg( short ).parents.Duck_Beak = [ 0 ];
	assert.ok( validateRecordJson( short ).some( p => /"Duck_Beak" has 1 parents for 2 triangles/.test( p ) ) );
	const other = clone( j ); delete seg( other ).parents.Duck_Body;
	assert.ok( validateRecordJson( other ).some( p => /do not name the same parts/.test( p ) ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
