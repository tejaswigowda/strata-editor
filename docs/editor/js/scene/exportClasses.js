// Export-time class promotion. Pure (no DOM / three).
//
// The editor keeps a node's semantic classes in userData.customClasses (an
// Array) and uses userData.classes for its own auto-derived descriptors (an
// object / Set that serializes to nothing useful). Downstream runtimes read the
// glTF node `extras` contract instead: { "classes": ["static", "item-box"] }
// (strata-play's label contract; Unity / Unreal importers read the same key).
// So on the EXPORT CLONE, write each node's custom classes out as
// userData.classes (an Array of unique strings). The live scene is never touched.

/** Sets `userData.classes` = custom classes on every node under `root` that has any. Returns how many nodes. */
export function promoteClassesForExport( root ) {

	let count = 0;

	root.traverse( ( node ) => {

		const custom = node.userData && node.userData.customClasses;
		if ( ! custom ) return;

		const list = Array.from( custom ).filter( ( c ) => typeof c === 'string' && c.trim() );
		if ( ! list.length ) return;

		node.userData.classes = Array.from( new Set( list ) );
		count ++;

	} );

	return count;

}
