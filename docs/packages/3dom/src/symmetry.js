// ── symmetry.js ───────────────────────────────────────────────────────────────
// Detect left/right symmetric sibling pairs under a parent. Pure geometry math.
//
// Method: reflect sibling A's centroid across the parent-center YZ plane (negate
// the X offset from center). If the reflection lands within tolerance of sibling
// B's centroid AND their bbox dimensions match within tolerance ⇒ symmetric pair.
//
// CONVENTION (documented, see resolver prompt): +X is "right", −X is "left".
// This is MODEL-relative right (the model's own right), which is the viewer's
// left when the model faces the camera. This ambiguity is stated to the LLM.

const DEFAULT_TOL = 0.18;   // fraction of part size; tunable (see risks #2)

/**
 * @param {object}  parentInfo  { center:[x,y,z] }  parent bbox center (world)
 * @param {Array}   sibs        [{ node, center:[x,y,z], size:[x,y,z] }, ...]
 * @param {number} [tol=0.18]   tolerance as a fraction of part size
 * @returns {Map<Object3D, { mate:Object3D, axis:'x', side:'left'|'right' }>}
 */
export function detectSymmetryPairs( parentInfo, sibs, tol = DEFAULT_TOL ) {

	const cx = parentInfo.center[ 0 ];
	const pairs = new Map();

	for ( let i = 0; i < sibs.length; i ++ ) {

		const a = sibs[ i ];
		if ( pairs.has( a.node ) ) continue;

		// Reflect A's centroid X across parent center
		const reflX = 2 * cx - a.center[ 0 ];

		let best = null;
		let bestErr = Infinity;

		for ( let j = 0; j < sibs.length; j ++ ) {

			if ( i === j ) continue;
			const b = sibs[ j ];
			if ( pairs.has( b.node ) ) continue;

			// Scale tolerance to the larger of the two parts' max dimension
			const scale = Math.max(
				Math.max( ...a.size ), Math.max( ...b.size ), 1e-4
			);
			const t = tol * scale;

			const dx = Math.abs( reflX - b.center[ 0 ] );
			const dy = Math.abs( a.center[ 1 ] - b.center[ 1 ] );
			const dz = Math.abs( a.center[ 2 ] - b.center[ 2 ] );

			if ( dx > t || dy > t || dz > t ) continue;

			// Dimensions must match (a mirror keeps sizes)
			const ds = Math.abs( a.size[ 0 ] - b.size[ 0 ] )
				+ Math.abs( a.size[ 1 ] - b.size[ 1 ] )
				+ Math.abs( a.size[ 2 ] - b.size[ 2 ] );
			if ( ds > 3 * t ) continue;

			const err = dx + dy + dz + ds;
			if ( err < bestErr ) { bestErr = err; best = b; }

		}

		if ( best ) {

			// Designate sides by X relative to parent center
			const aRight = a.center[ 0 ] >= cx;
			pairs.set( a.node, { mate: best.node, axis: 'x', side: aRight ? 'right' : 'left' } );
			pairs.set( best.node, { mate: a.node, axis: 'x', side: aRight ? 'left' : 'right' } );

		}

	}

	return pairs;

}
