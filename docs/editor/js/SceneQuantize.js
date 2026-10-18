// ── SceneQuantize.js ──────────────────────────────────────────────────────────
// Deterministic, LOSSY float quantization of animation clips for the scene save
// path. Captured motion is stored as full float64 text ("-2.261618647025898e-06"),
// which is pure byte cost: nothing perceptual or rig-relevant lives past these
// decimals. The committed scene file is also written compact (no indentation) —
// see commitSceneToRepo().
//
// LOSSY, and deliberately limited to animation track values and key times:
//   quaternion tracks  5 decimals
//   position tracks    4 decimals (0.1 mm at metre scale)
//   key times          4 decimals (0.1 ms; the timeline runs at 30-40 fps)
// Structural data — uuids, indices, matrices, geometry buffers, scale / rotation /
// morph / other tracks, the timeline model — is never touched.
//
// Deterministic: the same input always yields byte-identical output (pure
// Math.round on a fixed power of ten; -0 is normalised to 0).

export const QUANTIZE_DECIMALS = Object.freeze( {
	quaternion: 5,
	position: 4,
	time: 4,
} );

const SCALE = Object.fromEntries( Object.entries( QUANTIZE_DECIMALS ).map( ( [ k, d ] ) => [ k, 10 ** d ] ) );

const round = ( v, scale ) => {

	if ( typeof v !== 'number' || ! Number.isFinite( v ) ) return v;
	const r = Math.round( v * scale ) / scale;
	return r === 0 ? 0 : r; // no "-0"

};

function trackKind( name ) {

	if ( typeof name !== 'string' ) return null;
	if ( name.endsWith( '.quaternion' ) ) return 'quaternion';
	if ( name.endsWith( '.position' ) ) return 'position';
	return null;

}

function quantizeArray( arr, scale ) {

	if ( ! Array.isArray( arr ) ) return;
	for ( let i = 0; i < arr.length; i ++ ) arr[ i ] = round( arr[ i ], scale );

}

/** Quantizes one serialized clip (AnimationClip.toJSON() output) in place. */
export function quantizeClipJSON( clip ) {

	if ( ! clip || ! Array.isArray( clip.tracks ) ) return clip;

	for ( const track of clip.tracks ) {

		quantizeArray( track.times, SCALE.time );
		const kind = trackKind( track.name );
		if ( kind ) quantizeArray( track.values, SCALE[ kind ] );

	}

	return clip;

}

/**
 * Quantizes every animation clip in an editor.toJSON() result in place.
 * Returns the same object. The caller must own `json` (a fresh toJSON copy).
 */
export function quantizeSceneJSON( json ) {

	if ( json && Array.isArray( json.animations ) ) {

		for ( const entry of json.animations ) quantizeClipJSON( entry && entry.clip );

	}

	return json;

}
