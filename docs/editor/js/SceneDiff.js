// ── SceneDiff.js ──────────────────────────────────────────────────────────────
// Compute the semantic diff between two three.js scene JSONs.
//
// Objects are matched first by UUID (exact), then by name.
// Camera objects are excluded — they're not user content.
//
// Returns:
//   {
//     added:     [ entry ]   — in local, not in remote (you added them)
//     removed:   [ entry ]   — in remote, not in local (you removed / remote added)
//     modified:  [ entry ]   — in both, but different transform or material
//     unchanged: [ entry ]   — in both, identical
//   }
//
// Each entry: { uuid, name, type, local, remote, changes: string[] }

const SKIP_TYPES = new Set( [ 'PerspectiveCamera', 'OrthographicCamera' ] );
const MATRIX_EPS = 1e-4;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _colorHex( c ) {

	if ( c === undefined || c === null ) return null;
	return typeof c === 'number' ? c : null;

}

function _matrixChanged( ma, mb ) {

	if ( ! ma || ! mb ) return false;
	for ( let i = 0; i < 16; i ++ ) {

		if ( Math.abs( ma[ i ] - mb[ i ] ) > MATRIX_EPS ) return true;

	}

	return false;

}

function _materialChanged( localObj, remoteObj, localMatMap, remoteMatMap ) {

	if ( ! localObj.material || ! remoteObj.material ) return false;

	const lm = localMatMap.get( localObj.material );
	const rm = remoteMatMap.get( remoteObj.material );

	if ( ! lm || ! rm ) return false;
	if ( lm.type !== rm.type ) return true;
	if ( _colorHex( lm.color ) !== _colorHex( rm.color ) ) return true;
	if ( ( lm.opacity ?? 1 ) !== ( rm.opacity ?? 1 ) ) return true;

	return false;

}

function _detectChanges( local, remote, localMatMap, remoteMatMap ) {

	const changes = [];

	if ( _matrixChanged( local.matrix, remote.matrix ) ) changes.push( 'transform' );
	if ( _materialChanged( local, remote, localMatMap, remoteMatMap ) ) changes.push( 'material' );

	return changes;

}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {object} localJSON   output of editor.scene.toJSON()
 * @param {object} remoteJSON  same format from GitHub
 * @returns {{ added, removed, modified, unchanged }}
 */
export function diffScenes( localJSON, remoteJSON ) {

	const localChildren  = ( localJSON.object?.children  ?? [] ).filter( o => ! SKIP_TYPES.has( o.type ) );
	const remoteChildren = ( remoteJSON.object?.children ?? [] ).filter( o => ! SKIP_TYPES.has( o.type ) );

	const localMatMap  = new Map( ( localJSON.materials  ?? [] ).map( m => [ m.uuid, m ] ) );
	const remoteMatMap = new Map( ( remoteJSON.materials ?? [] ).map( m => [ m.uuid, m ] ) );

	const remoteByUUID = new Map( remoteChildren.map( o => [ o.uuid, o ] ) );
	const remoteByName = new Map( remoteChildren.filter( o => o.name ).map( o => [ o.name, o ] ) );

	const result      = { added: [], removed: [], modified: [], unchanged: [] };
	const matchedUUIDs = new Set();

	for ( const local of localChildren ) {

		let remote = remoteByUUID.get( local.uuid );
		if ( ! remote && local.name ) remote = remoteByName.get( local.name );

		if ( ! remote ) {

			result.added.push( { uuid: local.uuid, name: local.name || local.type, type: local.type, local, remote: null, changes: [ 'new' ] } );

		} else {

			matchedUUIDs.add( remote.uuid );
			const changes = _detectChanges( local, remote, localMatMap, remoteMatMap );
			const entry   = { uuid: local.uuid, name: local.name || local.type, type: local.type, local, remote, changes };
			result[ changes.length ? 'modified' : 'unchanged' ].push( entry );

		}

	}

	for ( const remote of remoteChildren ) {

		if ( ! matchedUUIDs.has( remote.uuid ) ) {

			// Guard against duplicates when name-matched already
			const alreadyCounted = localChildren.some( l => l.name && l.name === remote.name );
			if ( ! alreadyCounted ) {

				result.removed.push( { uuid: remote.uuid, name: remote.name || remote.type, type: remote.type, local: null, remote, changes: [ 'removed' ] } );

			}

		}

	}

	return result;

}

/**
 * Format a diff as a compact text block for AI context.
 */
export function diffSummary( diff ) {

	const lines = [];

	if ( diff.added.length )    lines.push( `Added locally (${ diff.added.length }): ${ diff.added.map( e => `"${ e.name }"` ).join( ', ' ) }` );
	if ( diff.removed.length )  lines.push( `Removed locally (${ diff.removed.length }): ${ diff.removed.map( e => `"${ e.name }"` ).join( ', ' ) }` );
	if ( diff.modified.length ) lines.push( `Modified (${ diff.modified.length }): ${ diff.modified.map( e => `"${ e.name }" (${ e.changes.join( '+' ) })` ).join( ', ' ) }` );

	return lines.length ? lines.join( '\n' ) : 'No conflicts — scenes are identical.';

}
