// ── workState.js ─────────────────────────────────────────────────────────────
// Pure logic behind "never lose unsaved work" (no DOM, no three.js, no IndexedDB):
// the snapshot hash, the dirty state machine, the recover-on-load decision and
// the relative-time wording. WorkGuard.js wires it to the editor.

/** 53-bit string hash (cyrb53) — cheap, no crypto needed: it only has to tell two snapshots apart. */
export function hashString( str ) {

	let h1 = 0xdeadbeef, h2 = 0x41c6ce57;

	for ( let i = 0; i < str.length; i ++ ) {

		const ch = str.charCodeAt( i );
		h1 = Math.imul( h1 ^ ch, 2654435761 );
		h2 = Math.imul( h2 ^ ch, 1597334677 );

	}

	h1 = Math.imul( h1 ^ ( h1 >>> 16 ), 2246822507 ) ^ Math.imul( h2 ^ ( h2 >>> 13 ), 3266489909 );
	h2 = Math.imul( h2 ^ ( h2 >>> 16 ), 2246822507 ) ^ Math.imul( h1 ^ ( h1 >>> 13 ), 3266489909 );

	return ( 4294967296 * ( 2097151 & h2 ) + ( h1 >>> 0 ) ).toString( 36 );

}

// What counts as "the work": everything editor.toJSON() round-trips about the scene itself.
// Camera, orbit controls and undo history are view state, so moving the view or
// pressing undo-then-redo must not read as an edit.
const WORK_KEYS = [ 'project', 'scene', 'animations', 'scripts', 'backgroundType', 'environmentType' ];

// Derived data the editor fills in lazily some time AFTER a load or edit (object descriptors:
// geometry hash, bbox, classes …). It is always re-derivable, so it must not make a freshly
// loaded scene look edited once it settles.
const DERIVED_USERDATA = [ 'descriptors' ];

function skipDerived( key, value ) {

	if ( key !== 'userData' || value === null || typeof value !== 'object' ) return value;
	if ( ! DERIVED_USERDATA.some( k => k in value ) ) return value;

	const kept = {};
	for ( const k of Object.keys( value ) ) if ( ! DERIVED_USERDATA.includes( k ) ) kept[ k ] = value[ k ];
	return Object.keys( kept ).length > 0 ? kept : undefined;

}

/** Canonical string of the working scene; two states with equal strings are "the same work". */
export function workSnapshotString( json ) {

	const work = {};
	if ( json ) for ( const k of WORK_KEYS ) work[ k ] = json[ k ];
	return JSON.stringify( work, skipDerived );

}

export function hashWork( json ) {

	return hashString( workSnapshotString( json ) );

}

/**
 * Where a scene came from: `git:owner/repo@branch:file[#commit]`, or 'local' when no repo is set.
 * @param {{repo?:string, branch?:string, file?:string, commit?:string}|null} src
 */
export function sourceKey( src ) {

	if ( ! src || ! src.repo ) return 'local';

	const commit = ( src.commit || '' ).trim();
	return `git:${ src.repo.toLowerCase() }@${ src.branch || 'main' }:${ src.file || 'scene.json' }${ commit ? '#' + commit : '' }`;

}

/** Short human label of a source key, for prompts. */
export function sourceLabel( key ) {

	if ( ! key || key === 'local' ) return 'local scene';
	return key.replace( /^git:/, '' ).replace( /@[^:]*:/, ' · ' );

}

/**
 * Dirty = the working scene's hash differs from the last loaded-or-committed baseline.
 * Comparing hashes (not "something changed" flags) is what lets undo back to the
 * clean snapshot clear the flag again.
 */
export function createDirtyTracker() {

	let baseline = null;
	let current = null;

	return {

		get baseline() { return baseline; },
		get current() { return current; },

		isDirty() {

			return baseline !== null && current !== null && baseline !== current;

		},

		/** The state the scene was just loaded / committed in. */
		setBaseline( hash ) {

			baseline = hash;
			current = hash;

		},

		/** Record the hash of the working scene; returns { dirty, changed } (changed = dirty flipped). */
		observe( hash ) {

			const before = this.isDirty();
			if ( baseline === null ) baseline = hash; // nothing loaded yet: the starting scene is the clean one
			current = hash;
			const dirty = this.isDirty();
			return { dirty, changed: dirty !== before };

		},

		/** Save / commit: whatever is on screen is now the clean snapshot. */
		markClean() {

			if ( current !== null ) baseline = current;

		},

		/** Restore a persisted pair (an autosave of unsaved work keeps its original baseline). */
		restore( baseHash, hash ) {

			baseline = baseHash;
			current = hash;

		}

	};

}

/**
 * Should an autosave found at load time be offered back to the user?
 * Only when it holds unsaved work (it differed from its own baseline) and that work
 * is not already what just got loaded.
 */
export function decideRecovery( record, loadedHash ) {

	if ( ! record || record.state === undefined || record.state === null ) return { action: 'none', reason: 'no-autosave' };
	if ( record.hash === record.baseHash ) return { action: 'none', reason: 'clean' };
	if ( loadedHash !== undefined && record.hash === loadedHash ) return { action: 'none', reason: 'identical' };

	return { action: 'prompt', savedAt: record.savedAt };

}

/**
 * Writing `incoming` over `existing` in the autosave slot would destroy unsaved work
 * that belongs to a different editing lineage (another tab, or the scene before a
 * reload/load replaced it) — that record must be stashed first.
 */
export function wouldClobberUnsaved( existing, lineage, incomingHash ) {

	if ( ! existing || existing.hash === existing.baseHash ) return false;
	return existing.lineage !== lineage && existing.hash !== incomingHash;

}

/** "just now", "42 seconds ago", "5 minutes ago", "2 hours ago", "3 days ago". */
export function relativeTime( then, now = Date.now() ) {

	const s = Math.max( 0, Math.round( ( now - then ) / 1000 ) );
	if ( s < 10 ) return 'just now';

	const unit = ( n, name ) => `${ n } ${ name }${ n === 1 ? '' : 's' } ago`;

	if ( s < 60 ) return unit( s, 'second' );
	if ( s < 3600 ) return unit( Math.floor( s / 60 ), 'minute' );
	if ( s < 86400 ) return unit( Math.floor( s / 3600 ), 'hour' );
	return unit( Math.floor( s / 86400 ), 'day' );

}

export function recoverPromptText( savedAt, label, now = Date.now() ) {

	const when = relativeTime( savedAt, now );
	return `Recover unsaved changes from ${ when }${ label ? ` (${ label })` : '' }?`;

}

// ── What would recovering change? ────────────────────────────────────────────

function sceneObjects( json ) {

	const byId = new Map();

	// The scene root also carries the timeline, subtitles and render shots; those are reported on
	// their own, so they must not make the root count as an edited object.
	const SEPARATELY_REPORTED = [ 'timeline', 'renderSubtitles', 'renderShots' ];

	( function walk( node, isRoot ) {

		if ( ! node || typeof node !== 'object' ) return;
		const { children, ...own } = node;

		if ( isRoot && own.userData ) {

			own.userData = { ...own.userData };
			for ( const k of SEPARATELY_REPORTED ) delete own.userData[ k ];

		}

		if ( node.uuid ) byId.set( node.uuid, JSON.stringify( own, skipDerived ) );
		if ( Array.isArray( children ) ) children.forEach( c => walk( c, false ) );

	} )( json && json.scene && json.scene.object, true );

	return byId;

}

function byUuid( list ) {

	const map = new Map();
	for ( const item of Array.isArray( list ) ? list : [] ) if ( item && item.uuid ) map.set( item.uuid, JSON.stringify( item ) );
	return map;

}

function countDiff( a, b ) {

	let added = 0, removed = 0, changed = 0;
	for ( const [ id, v ] of b ) { if ( ! a.has( id ) ) added ++; else if ( a.get( id ) !== v ) changed ++; }
	for ( const id of a.keys() ) if ( ! b.has( id ) ) removed ++;
	return { added, removed, changed };

}

const plural = ( n, word ) => `${ n } ${ word }${ n === 1 ? '' : 's' }`;

/**
 * Short, human description of how the saved work differs from the scene that is open now, e.g.
 * ['2 objects edited', 'timeline changed']. The list is empty only when nothing nameable differs.
 * Both arguments are editor.toJSON() results.
 */
export function describeChanges( current, saved ) {

	if ( ! current || ! saved ) return [];

	const out = [];
	const objects = countDiff( sceneObjects( current ), sceneObjects( saved ) );
	if ( objects.changed ) out.push( `${ plural( objects.changed, 'object' ) } edited` );
	if ( objects.added ) out.push( `${ plural( objects.added, 'object' ) } added` );
	if ( objects.removed ) out.push( `${ plural( objects.removed, 'object' ) } removed` );

	const materials = countDiff( byUuid( current.scene && current.scene.materials ), byUuid( saved.scene && saved.scene.materials ) );
	if ( materials.added + materials.removed + materials.changed ) out.push( `${ plural( materials.added + materials.removed + materials.changed, 'material' ) } changed` );

	const userData = json => ( json.scene && json.scene.object && json.scene.object.userData ) || {};
	const same = ( key ) => JSON.stringify( userData( current )[ key ] ) === JSON.stringify( userData( saved )[ key ] );
	if ( ! same( 'timeline' ) ) out.push( 'timeline changed' );
	if ( ! same( 'renderSubtitles' ) ) out.push( 'subtitles changed' );
	if ( ! same( 'renderShots' ) ) out.push( 'render shots changed' );
	if ( JSON.stringify( current.scripts ) !== JSON.stringify( saved.scripts ) ) out.push( 'scripts changed' );
	if ( current.backgroundType !== saved.backgroundType || current.environmentType !== saved.environmentType ) out.push( 'background changed' );

	return out;

}

/** The file name of a source key: 'git:owner/repo@main:folder/pyth.json' → 'pyth.json'. */
export function sourceFile( key ) {

	if ( ! key || key === 'local' ) return '';
	const file = key.replace( /^git:[^:]*:/, '' ).replace( /#.*$/, '' );
	return file.split( '/' ).pop();

}

/**
 * The recover prompt: what scene, how long ago, what is in it, how many other copies exist.
 * `changes` comes from describeChanges.
 */
export function recoverPrompt( { savedAt, file, changes = [], more = 0, now = Date.now() } ) {

	const what = file ? ` to ${ file }` : '';
	const detail = changes.length ? ` — ${ changes.slice( 0, 3 ).join( ', ' ) }${ changes.length > 3 ? ' …' : '' }` : '';
	const others = more === 0 ? '' : more === 1 ? ' 1 older copy is also saved.' : ` ${ more } older copies are also saved.`;
	return `Recover unsaved changes${ what } from ${ relativeTime( savedAt, now ) }${ detail }?${ others }`;

}
