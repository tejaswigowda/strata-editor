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

	return editor.scene.toJSON();

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
