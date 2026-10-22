// ── bakedOutlines.js ──────────────────────────────────────────────────────────
// A glTF made in Blender often carries its own outline as an extra mesh: an inverted
// hull (a copy pushed out along its normals, winding flipped, a near-black material called
// "outline" or a mesh called "Object_outline_0"). Drawn as an ordinary opaque mesh the hull
// writes depth, and on thin parts (lanterns, posts, poles) it ends up in front of the object
// it is meant to sit behind, so the object shows up solid black.
//
// The fix is to draw the hull first and keep it out of the depth buffer: everything else then
// paints over it, and it only shows where nothing else is, which is the outline. It touches only
// the hull's material (depthWrite) and draw order, not its geometry, and running it twice
// changes nothing. Hulls the toon look generates itself (material.isOutline) are left alone.

const FRONT_SIDE = 0;
const HULL_ORDER = - 1; // before every default (0) mesh

const isOutlineName = name => typeof name === 'string' && /outline/i.test( name );

/** True for a mesh whose every material is a baked, opaque, front-sided "outline" hull. */
export function isBakedOutlineHull( mesh ) {

	if ( ! mesh || ! mesh.isMesh || ! mesh.material ) return false;
	const mats = [].concat( mesh.material );
	if ( mats.length === 0 || mats.some( m => ! m || m.isOutline || m.transparent || m.side !== FRONT_SIDE ) ) return false;
	return isOutlineName( mesh.name ) || mats.every( m => isOutlineName( m.name ) );

}

/** Make one baked hull draw first and not write depth. Returns true when it changed anything. */
export function settleBakedOutline( mesh ) {

	if ( ! isBakedOutlineHull( mesh ) ) return false;
	let changed = false;

	for ( const m of [].concat( mesh.material ) ) {

		if ( m.depthWrite !== false ) { m.depthWrite = false; m.needsUpdate = true; changed = true; }

	}

	if ( mesh.renderOrder === 0 ) { mesh.renderOrder = HULL_ORDER; changed = true; }
	return changed;

}

/** settleBakedOutline over a whole subtree; returns how many hulls it changed. */
export function settleBakedOutlines( root ) {

	let count = 0;
	root.traverse( o => { if ( settleBakedOutline( o ) ) count ++; } );
	return count;

}
