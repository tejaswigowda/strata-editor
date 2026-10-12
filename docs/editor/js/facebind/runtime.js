// Runtime side of the face bind: drive a bound VRM's expression morphs from face-morph weights.
// Morph influences only — no geometry, skeleton or skin-weight access.

export const BIND_KEY = 'faceBind';

/** The bind block of a loaded VRM (set by the Strata loader from extensions.STRATA_face_bind). */
export function readBinding( root ) {

	let found = null;
	root.traverse( o => { if ( ! found && o.userData && o.userData[ BIND_KEY ] ) found = o.userData[ BIND_KEY ]; } );
	return found;

}

/**
 * Set the VRM's expression morphs from a face performance.
 * @param {THREE.Object3D} root the loaded, bound VRM
 * @param {number[]|Object<string|number, number>} weights per face-morph: an array by source index, or an
 *   object keyed by source index or morph name. Missing entries leave the VRM morph as it is.
 * @returns {{ applied:number, skipped:string[] }}
 */
export function applyFaceWeights( root, weights, opts = {} ) {

	const bind = opts.bind || readBinding( root );
	if ( ! bind ) throw new Error( 'applyFaceWeights: this VRM has no face bind (bind it first)' );

	const get = entry => {

		if ( Array.isArray( weights ) ) return weights[ entry.source ];
		if ( weights[ entry.source ] !== undefined ) return weights[ entry.source ];
		return weights[ entry.name ];

	};

	const meshes = [];
	root.traverse( o => { if ( o.morphTargetDictionary && o.morphTargetInfluences ) meshes.push( o ); } );

	let applied = 0;
	const skipped = [];
	for ( const entry of bind.map ) {

		const w = get( entry );
		if ( typeof w !== 'number' || Number.isNaN( w ) ) continue;
		const value = Math.min( 1, Math.max( 0, w * entry.weight ) );
		let hit = false;
		for ( const m of meshes ) for ( const t of entry.targets ) {

			const i = m.morphTargetDictionary[ t.name ];
			if ( i !== undefined ) { m.morphTargetInfluences[ i ] = value; hit = true; }

		}
		if ( hit ) applied ++; else skipped.push( entry.name );

	}
	return { applied, skipped };

}
