// ── regenerate.js ─────────────────────────────────────────────────────────────────────────────────
// Opening a record whose packaging is "plan": the record holds the labels and the plan, and the geometry is cut again from the source it names.
//
//   1  fetch source.url (pinned to a commit), or take the bytes from the cache, which is keyed by source.sha256
//   2  verify the bytes against source.sha256 and source.bytes BEFORE anything is imported: a file that does not hash to the record's expectation is a different
//      file, and the cut would not reproduce
//   3  import it, then SEG.replay(mesh, record), which refuses, and says how, if the mesh is not the one the record describes
//   4  put the record's identities back on what the replay made (uuids, userData, transforms), so that opening and saving the record changes nothing
//
// If any step fails the record is NOT lost: it stays open with its parts as empty groups (their names, classes, descriptors and the plan are all there), and the
// failure is recorded as the group's status, "geometry unavailable", with the reason. A dead link costs the geometry, not the annotation.
//
// The pure parts (fetchVerified, regenerateRecord) take their effects as arguments so that they run in node; regenerateRecords(editor) is the editor's wiring.

import { sha256Hex, isPlaceholderOf } from './records.js';

/** A source that could not be turned into the right bytes. `code`: 'unreachable' | 'not-fetchable' | 'hash' | 'size'. */
export class RecordSourceError extends Error {

	constructor( code, message ) { super( message ); this.name = 'RecordSourceError'; this.code = code; }

}

const defaultFetchBytes = async url => {

	const res = await fetch( url );
	if ( ! res.ok ) throw new Error( 'HTTP ' + res.status );
	return new Uint8Array( await res.arrayBuffer() );

};

/**
 * The source's bytes, verified. Looks in `cache` (keyed by the sha256, so a hit is the right bytes by construction; it is hashed again on the way out, which
 * costs milliseconds and catches a damaged entry), then fetches. Throws RecordSourceError before returning anything that does not hash to the record's source.
 * Resolves { bytes, from: 'cache' | 'network' }.
 */
export async function fetchVerified( source, { fetchBytes = defaultFetchBytes, cache = null, sha256 = sha256Hex } = {} ) {

	const want = String( source.sha256 || '' ).toLowerCase();
	if ( cache ) {

		let hit = null;
		try { hit = await cache.get( want ); } catch ( e ) { hit = null; }
		if ( hit && ( await sha256( hit ) ) === want ) return { bytes: hit, from: 'cache' };
		if ( hit && cache.delete ) { try { await cache.delete( want ); } catch ( e ) { /* a cache that cannot forget is only a cache */ } }

	}
	if ( source.fetchable === false ) throw new RecordSourceError( 'not-fetchable', `the source (${ source.page || source.url }) cannot be fetched by a program (a login, a licence gate), so the geometry has to be supplied by hand; the record needs the file with sha256 ${ want }` );
	let bytes;
	try { bytes = await fetchBytes( source.url ); } catch ( e ) { throw new RecordSourceError( 'unreachable', `the source could not be fetched from ${ source.url } (${ e && e.message || e }): the link may have moved, the network may be down, or the host may not allow it from a browser` ); }
	if ( source.bytes !== undefined && bytes.byteLength !== source.bytes ) throw new RecordSourceError( 'size', `the source at ${ source.url } is ${ bytes.byteLength } bytes and the record says ${ source.bytes }: it is a different file, so the cut will not reproduce. Nothing was imported` );
	const got = await sha256( bytes );
	if ( got !== want ) throw new RecordSourceError( 'hash', `the source at ${ source.url } hashes to ${ got } and the record says ${ want }: it is a different file, so the cut will not reproduce. Nothing was imported` );
	if ( cache ) { try { await cache.put( want, bytes ); } catch ( e ) { /* not cached; the next open fetches again */ } }
	return { bytes, from: 'network' };

}

/**
 * One record, regenerated. `deps`: { fetchBytes, cache, sha256, importBytes( bytes, filename ) -> the imported root, findMesh( root, record ) -> the mesh to cut,
 * replace( mesh, record ) -> cuts it and puts the record's identities back, discard( root ) }.
 * Resolves { from }; throws RecordSourceError (nothing imported) or the replay's own error (nothing changed).
 */
export async function regenerateRecord( record, deps ) {

	const { bytes, from } = await fetchVerified( record.source, deps );
	const filename = String( record.source.url ).split( '/' ).pop() || 'source.glb';
	const root = await deps.importBytes( bytes, filename );
	try {

		const mesh = deps.findMesh( root, record );
		await deps.replace( mesh, record );

	} catch ( e ) {

		if ( deps.discard ) deps.discard( root );
		throw e;

	}
	if ( deps.discard ) deps.discard( root );     // what the importer left behind (its wrapper, a camera the file carried) is not part of the record
	return { from };

}

// ── the cache: IndexedDB, keyed by the sha256 ─────────────────────────────────────────────────────

/** A cache of verified source bytes in IndexedDB (or in memory where there is none). Keys are sha256 hex strings. */
export function makeSourceCache( { name = 'strata-source-cache', idb = typeof indexedDB !== 'undefined' ? indexedDB : null } = {} ) {

	if ( ! idb ) { const m = new Map(); return { get: async k => m.get( k ) || null, put: async ( k, v ) => { m.set( k, v ); }, delete: async k => { m.delete( k ); }, kind: 'memory' }; }
	let opened = null;
	const open = () => opened || ( opened = new Promise( ( resolve, reject ) => {

		const req = idb.open( name, 1 );
		req.onupgradeneeded = () => req.result.createObjectStore( 'sources' );
		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error );

	} ) );
	const run = async ( mode, fn ) => { const db = await open(); return new Promise( ( resolve, reject ) => { const tx = db.transaction( 'sources', mode ), r = fn( tx.objectStore( 'sources' ) ); tx.oncomplete = () => resolve( r && r.result ); tx.onerror = () => reject( tx.error ); } ); };
	return {

		kind: 'indexeddb',
		get: async k => ( await run( 'readonly', s => s.get( k ) ) ) || null,
		put: async ( k, v ) => { await run( 'readwrite', s => s.put( v, k ) ); },
		delete: async k => { await run( 'readwrite', s => s.delete( k ) ); }

	};

}

// ── the editor ────────────────────────────────────────────────────────────────────────────────────

/** The segmented groups of a loaded scene that stand empty (a plan record that has not been regenerated). */
export function emptyGroups( root ) {

	const out = [];
	root.traverse( o => {

		const rec = o.userData && o.userData.segmentation;
		if ( ! rec || ! rec.plan || ! o.children.length ) return;
		const empty = o.children.every( c => ! c.isMesh && isPlaceholderOf( o, c ) );
		if ( empty ) out.push( o );

	} );
	return out;

}

/**
 * Regenerates every empty segmented group in the editor's scene from its record. Never throws: each group's outcome is `editor.recordStatus.get( uuid )`,
 * { state: 'ready' | 'unavailable', from?: 'cache' | 'network', code?, message? }, and `editor.signals.recordStatusChanged` fires with each change. Resolves the
 * list of [ group name, status ]. `env` is for tests and for hosts: { fetchBytes, cache, seg, loader, THREE, log }.
 */
export async function regenerateRecords( editor, env = {} ) {

	const groups = emptyGroups( editor.scene );
	if ( ! groups.length ) return [];
	if ( ! editor.recordStatus ) editor.recordStatus = new Map();
	const cache = env.cache || ( editor.sourceCache || ( editor.sourceCache = makeSourceCache() ) );
	const log = env.log || ( m => { if ( editor.importLog ) editor.importLog( m ); } );
	const set = ( g, status ) => { editor.recordStatus.set( g.uuid, status ); if ( editor.signals && editor.signals.recordStatusChanged ) editor.signals.recordStatusChanged.dispatch( g, status ); };
	const out = [];

	for ( const g of groups ) {

		const record = g.userData.segmentation;
		set( g, { state: 'unavailable', message: 'regenerating the geometry from its source…', pending: true } );
		try {

			const seg = env.seg || await makeEditorSeg( editor );
			const loader = env.loader || editor.loader;
			const deps = {

				fetchBytes: env.fetchBytes, cache,
				importBytes: ( bytes, name ) => loader.loadGLBBytes( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), name ),
				findMesh: ( root, rec ) => meshNamed( root, rec.from ),
				replace: ( mesh, rec ) => replaceGroup( editor, g, mesh, rec, seg ),
				discard: root => { if ( root && root.parent ) editor.removeObject( root ); }

			};
			const { from } = await regenerateRecord( record, deps );
			if ( editor.history && editor.history.clear ) editor.history.clear();     // regenerating is not an edit: opening a record leaves nothing to undo
			set( g, { state: 'ready', from } );
			log( `✓ "${ g.name }": the geometry was regenerated from its source (${ from === 'cache' ? 'cached bytes, verified' : 'fetched, verified' }, sha256 ${ record.source.sha256.slice( 0, 12 ) }…).` );

		} catch ( e ) {

			const status = { state: 'unavailable', code: e.code || 'replay', message: e && e.message || String( e ) };
			set( g, status );
			log( `⚠ "${ g.name }": geometry unavailable. ${ status.message } The labels, classes, descriptors and the plan are all still here.` );

		}
		out.push( [ g.name, editor.recordStatus.get( g.uuid ) ] );

	}
	return out;

}

function meshNamed( root, name ) {

	let found = null; const meshes = [];
	root.traverse( o => { if ( o.isMesh ) { meshes.push( o ); if ( o.name === name && ! found ) found = o; } } );
	if ( found ) return found;
	if ( meshes.length === 1 ) return meshes[ 0 ];
	throw new Error( `the imported file has no mesh named "${ name }" (it has ${ meshes.map( m => '"' + m.name + '"' ).join( ', ' ) || 'none' }), so the plan has nothing to cut` );

}

/** SEG, built the way the Shell builds it, for the editor that is regenerating (no Shell needed). */
async function makeEditorSeg( editor ) {

	const [ { makeSegment }, { makeQuery }, { indexSubtree }, three, { AddObjectCommand }, { RemoveObjectCommand }, { SetMaterialCommand }, { MultiCmdsCommand } ] = await Promise.all( [
		import( '../intelligence/meshSegment.js' ), import( '../intelligence/opPrimitive.js' ), import( '../intelligence/descriptors.js' ), import( 'three' ),
		import( '../commands/AddObjectCommand.js' ), import( '../commands/RemoveObjectCommand.js' ), import( '../commands/SetMaterialCommand.js' ), import( '../commands/MultiCmdsCommand.js' ) ] );
	return makeSegment( editor, { THREE: three, commands: { AddObjectCommand, RemoveObjectCommand, SetMaterialCommand, MultiCmdsCommand }, query: makeQuery( editor ), index: indexSubtree } );

}

/**
 * Takes the empty group `g` out, cuts `mesh` from the record's plan (the replay), and puts the record's identities on the result: the group's and every part's uuid,
 * userData (classes, descriptors, the record itself), transform and visibility, and the group's place among its siblings. If the replay refuses, `g` is put back.
 */
function replaceGroup( editor, g, mesh, record, seg ) {

	const parent = g.parent, index = parent.children.indexOf( g ), saved = new Map( g.children.map( c => [ c.name, c ] ) );
	parent.remove( g );                          // the names must be free for the replay; this is not an undo step
	let made;
	try {

		seg.replay( mesh, { ...record, userData: undefined } );
		made = editor.scene.getObjectByName( record.plan.group );
		if ( ! made ) throw new Error( `the replay did not make "${ record.plan.group }"` );

	} catch ( e ) {

		parent.add( g ); parent.children.splice( parent.children.indexOf( g ), 1 ); parent.children.splice( index, 0, g );
		throw e;

	}
	const adopt = ( to, from ) => {

		to.uuid = from.uuid;
		to.userData = JSON.parse( JSON.stringify( from.userData ) );
		to.position.copy( from.position ); to.quaternion.copy( from.quaternion ); to.scale.copy( from.scale ); to.visible = from.visible;
		to.updateMatrix();

	};
	adopt( made, g );
	for ( const c of made.children ) { const s = saved.get( c.name ); if ( s ) adopt( c, s ); }
	if ( made.parent !== parent ) { made.parent.remove( made ); parent.add( made ); }
	parent.children.splice( parent.children.indexOf( made ), 1 ); parent.children.splice( Math.min( index, parent.children.length ), 0, made );
	made.updateMatrixWorld( true );
	if ( editor.signals && editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();

}
