// Export-time resource cloning that PRESERVES sharing. Pure (no DOM / three).
//
// The export clone needs its own geometry and materials so compression,
// change()-lowering and rest-pose baking never mutate the live scene. Cloning
// them once PER MESH, though, turns every shared resource into N copies, and
// GLTFExporter deduplicates by object identity, so the GLB carries one material
// (and one accessor set) per mesh instead of one per authored resource. Cloning
// each distinct source ONCE keeps the clone independent of the live scene and
// keeps shared resources shared, exactly as they are in the live scene.

/** Replaces geometry/material on every node under `root` with once-per-source clones. Returns { geometries, materials } distinct counts. */
export function cloneSharedResources( root ) {

	const geometries = new Map();
	const materials = new Map();

	const once = ( map, source ) => {

		let copy = map.get( source );
		if ( ! copy ) {

			copy = source.clone();
			map.set( source, copy );

		}

		return copy;

	};

	root.traverse( ( child ) => {

		if ( child.geometry ) child.geometry = once( geometries, child.geometry );
		if ( child.material ) child.material = Array.isArray( child.material ) ? child.material.map( ( m ) => once( materials, m ) ) : once( materials, child.material );

	} );

	return { geometries: geometries.size, materials: materials.size };

}
