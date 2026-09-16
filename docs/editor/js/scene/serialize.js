// ── serialize.js ─────────────────────────────────────────────────────────────
// Thin wrappers over three.js native serialization / deserialization.
// Corresponds to Conversions 2 (Scene → JSON) and 3 (JSON → Scene) in the
// Bidirectional Scene Representation spec.
//
// Usage:
//   import { sceneToJSON, jsonToObject, cloneViaJSON } from './scene/serialize.js';

// ── Conversion 2: Scene → JSON ────────────────────────────────────────────────

/**
 * Serialize the entire editor scene to three.js Object/Scene JSON.
 * The returned value is a plain JS object (not a string).
 *
 * @param  {import('../Editor.js').Editor} editor
 * @returns {object}  three.js JSON  { metadata, geometries, materials, object, … }
 */
export function sceneToJSON( editor ) {

	// Call-card meshes bake a live-fetched snapshot into material.map at
	// runtime (see Callcard.js) — strip it before serializing so scene JSON
	// (autosave, git commits) stores only the reference (isCallcard flag +
	// embed size), never a copy of the card's pixels. Restored immediately
	// after: toJSON() is synchronous, so there's no observable gap in the
	// live view, and the texture object itself never changes (no GPU
	// re-upload), only briefly detached from the material.
	const stripped = [];
	editor.scene.traverse( function ( o ) {

		if ( o.userData && o.userData.isCallcard && o.material && o.material.map ) {

			stripped.push( { material: o.material, map: o.material.map } );
			o.material.map = null;

		}

	} );

	try {

		return editor.scene.toJSON();

	} finally {

		stripped.forEach( function ( s ) { s.material.map = s.map; } );

	}

}

/**
 * Serialize a single object (Mesh, Group, Light, etc.) to three.js JSON.
 * Geometry / material / texture arrays are included in the output.
 *
 * @param  {THREE.Object3D} object
 * @returns {object}
 */
export function objectToJSON( object ) {

	return object.toJSON();

}

// ── Conversion 3: JSON → Scene ────────────────────────────────────────────────

/**
 * Reconstruct a THREE.Object3D (or Scene) from three.js Object/Scene JSON.
 * Uses THREE.ObjectLoader for full material/geometry/texture resolution.
 *
 * @param  {object} json   three.js JSON produced by toJSON()
 * @returns {THREE.Object3D}
 */
export function jsonToObject( json ) {

	const loader = new window.THREE.ObjectLoader();
	return loader.parse( json );

}

/**
 * Deep-clone any Object3D by round-tripping through JSON.
 * Geometry, materials, and children are all reconstructed as fresh instances.
 *
 * @param  {THREE.Object3D} object
 * @returns {THREE.Object3D}
 */
export function cloneViaJSON( object ) {

	return jsonToObject( objectToJSON( object ) );

}
