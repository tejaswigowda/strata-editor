// ── editOps.js ─────────────────────────────────────────────────────────────────
// Structured edit operations — model emits {op, selector, args} JSON, host
// expands deterministically into guarded Three.js commands.
//
// Closed edit op set: recolor, scale, move, rotate, delete, duplicate, retexture, setMaterial
// Model picks from this list; host enforces correctness via guards.
//
// Guards (deterministic):
//   - Recolor textured → clone-on-write + warn (map×color multiplicative)
//   - Recolor shared material → clone-on-write (no bleed)
//   - Scale/move → clamp sane, ground floor objects
//   - Delete merged-mesh subpart → graceful fail
//   - Wrong resolution → flag don't report ✓

import * as selectorEngine from './selectorEngine.js';
import { SetMaterialColorCommand } from '../commands/SetMaterialColorCommand.js';
import { SetMaterialCommand } from '../commands/SetMaterialCommand.js';
import { SetPositionCommand } from '../commands/SetPositionCommand.js';
import { SetRotationCommand } from '../commands/SetRotationCommand.js';
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { RemoveObjectCommand } from '../commands/RemoveObjectCommand.js';
import { MultiCmdsCommand } from '../commands/MultiCmdsCommand.js';

// ── Op schema (for constrained decoding / vocab injection) ─────────────────────

export const OP_SCHEMA = {
	type: 'object',
	properties: {
		op: {
			type: 'string',
			enum: [ 'recolor', 'scale', 'move', 'rotate', 'delete', 'duplicate', 'retexture', 'setMaterial', 'setOpacity', 'setVisible', 'wireframe', 'moveTo', 'rotateTo', 'scaleTo', 'reset', 'lookAt' ],
		},
		selector: { type: 'string' },
		args: { type: 'object' },
	},
	required: [ 'op', 'selector', 'args' ],
};

// ── Constrained-decode schema ─────────────────────────────────────────────────
// The JSON-schema handed to constrained decoding (WebLLM response_format, Ollama
// `format`, OpenAI json_schema, Claude tool input_schema). It REUSES OP_SCHEMA as
// the per-op item and wraps it in an { ops:[…] } envelope so a single request and a
// multi-op decomposition share ONE grammar. `raw` is added to the op enum so the
// escape hatch stays reachable (constrained decoding forbids MALFORMED output, not
// the legitimate raw-codegen fallback). selector/args are optional at the item
// level so a `raw` op (code in args, no selector) is still schema-valid.

export function buildConstrainedOpsSchema() {

	const opItem = {
		type: 'object',
		properties: {
			op: { type: 'string', enum: [ ...OP_SCHEMA.properties.op.enum, 'raw' ] },
			selector: { type: 'string' },
			args: { type: 'object' },
		},
		required: [ 'op' ],
	};

	return {
		type: 'object',
		properties: {
			ops: { type: 'array', minItems: 1, items: opItem },
		},
		required: [ 'ops' ],
	};

}

// ── Reason-then-constrain schema ──────────────────────────────────────────────
// "Best of both worlds": constrain the OUTPUT surface, leave the REASONING free.
// Plain buildConstrainedOpsSchema() forces the model to emit { ops:[…] } with no
// room to think first — that wins multi-op (complete structure) but slightly
// suppresses op-selection (premature schema commitment). This schema adds an
// UNCONSTRAINED leading `reasoning` string BEFORE the ops array. Because JSON-
// schema-constrained decoders emit fields in schema-property order, the model
// fills `reasoning` FIRST (free text — it plans which ops/selectors/how many),
// THEN emits the schema-valid `ops`. One generation, low latency: the model
// reasons before committing to the op surface. Parsing extracts ONLY `ops`;
// `reasoning` is scratch (parseEmittedOps ignores non-ops fields).

export function buildReasonConstrainedOpsSchema() {

	const base = buildConstrainedOpsSchema();
	return {
		type: 'object',
		// `reasoning` first so ordered-field decoders think before emitting ops.
		properties: {
			reasoning: { type: 'string' },
			ops: base.properties.ops,
		},
		// BOTH required: a grammar-based decoder (WebLLM/XGrammar, Ollama) only
		// emits required fields; if `reasoning` were optional the model could skip
		// the think-first slot and the mechanism would collapse back to plain
		// constrained. Required + declared-first = reasoning is emitted before ops.
		required: [ 'reasoning', 'ops' ],
	};

}

// ── Validation ──────────────────────────────────────────────────────────────────

/**
 * Validate a structured op JSON against the schema.
 * @param {object} opData  {op, selector, args}
 * @returns {string|null}  error message or null if valid
 */
export function validateOp( opData ) {

	if ( ! opData || typeof opData !== 'object' ) return 'op must be an object';
	if ( typeof opData.op !== 'string' ) return 'op.op must be a string';
	if ( ! OP_SCHEMA.properties.op.enum.includes( opData.op ) ) {

		return `op.op must be one of: ${ OP_SCHEMA.properties.op.enum.join( ', ' ) }`;

	}
	if ( typeof opData.selector !== 'string' ) return 'op.selector must be a string';
	if ( ! selectorEngine.isValid( opData.selector ) ) return `op.selector "${ opData.selector }" is not valid CSS selector syntax`;
	if ( ! opData.args || typeof opData.args !== 'object' ) return 'op.args must be an object';
	return null;

}

// ── Guard helpers ──────────────────────────────────────────────────────────────

/**
 * Check if a mesh has a texture map that will multiply with a color.
 * @param {THREE.Mesh} mesh
 * @returns {boolean}
 */
function hasTextureMap( mesh ) {

	if ( ! mesh || ! mesh.isMesh ) return false;
	const mat = Array.isArray( mesh.material ) ? mesh.material[ 0 ] : mesh.material;
	return mat && mat.map ? true : false;

}

/**
 * Check if a material is shared (used by multiple meshes).
 * @param {THREE.Material} material
 * @param {THREE.Object3D} scene
 * @returns {boolean}
 */
function isMaterialShared( material, scene ) {

	if ( ! material ) return false;
	let count = 0;
	scene.traverse( node => {

		if ( node.isMesh ) {

			const mat = Array.isArray( node.material ) ? node.material[ 0 ] : node.material;
			if ( mat === material ) count ++;
			if ( count > 1 ) return; // early exit

		}

	} );
	return count > 1;

}

/**
 * Clone a material so edits don't bleed to other meshes.
 * @param {THREE.Material} material
 * @returns {THREE.Material}  cloned material (same type/props)
 */
function cloneMaterial( material ) {

	if ( ! material ) return material;
	return material.clone();

}

/**
 * Check if a node is part of a merged mesh (single-mesh asset, can't isolate parts).
 * @param {THREE.Object3D} node
 * @returns {boolean}
 */
function isMergedMeshNode( node ) {

	if ( ! node ) return false;
	// A node is in a merged mesh if its root has exactly 1 mesh and mergedMesh:true in userData
	let root = node;
	while ( root.parent && root.parent.parent ) root = root.parent; // walk to scene root
	
	let meshCount = 0;
	root.traverse( n => { if ( n.isMesh ) meshCount ++; } );
	return meshCount === 1 && root.userData.mergedMesh;

}

/**
 * Clamp value to a reasonable range for safety.
 * @param {number} val
 * @param {number} [min]  default -1000
 * @param {number} [max]  default 1000
 * @returns {number}
 */
function clamp( val, min = -1000, max = 1000 ) {

	return Math.max( min, Math.min( max, val ) );

}

/**
 * Expand a matched node to all recolorable/material-settable meshes.
 * If node is a mesh, yield it; if node is a Group/container, recursively yield all descendant meshes.
 * This allows whole-asset edits: selecting a Group applies the op to all its child meshes.
 * @param {THREE.Object3D} node
 * @yields {THREE.Mesh}
 */
function* expandToMeshes( node ) {

	if ( node.isMesh ) {

		yield node;

	} else if ( node.children ) {

		for ( const child of node.children ) {

			yield* expandToMeshes( child );

		}

	}

}

// ── Edit op implementations ─────────────────────────────────────────────────────

/**
 * Recolor nodes matching selector.
 * Guards: warn if textured (map×color multiplicative), clone-on-write if shared material.
 */
export function recolorOp( editor, selector, color ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `recolorOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	// Host arg-normalization: accept '#111', '#ff0000', 'red', 'black', or 0xff0000
	// and resolve to a numeric hex ONCE. SetMaterialColorCommand uses setHex() which
	// needs a NUMBER — passing a string silently yields NaN/black. THREE.Color
	// parses hex strings and CSS names, so this also implements the "black"→#111
	// scaffolding for the model.
	let hex;
	try {

		hex = new window.THREE.Color( color ).getHex();

	} catch ( e ) {

		return { success: false, message: `recolor: unrecognized color "${ color }"`, count: 0 };

	}

	let warnings = [];
	const cmds = [];

	// Expand matched nodes to all descendant meshes (so Groups apply to children)
	const meshes = [];
	for ( const node of nodes ) {

		for ( const mesh of expandToMeshes( node ) ) {

			meshes.push( mesh );

		}

	}

	for ( const node of meshes ) {

		const isArrayMat = Array.isArray( node.material );
		const mat = isArrayMat ? node.material[ 0 ] : node.material;
		if ( ! mat ) continue;

		// Guard: warn if textured (color multiplies the map → tint, not replace).
		if ( hasTextureMap( node ) ) {

			warnings.push( `Node "${ node.name }" is textured — color will TINT, not replace. Replace the material to recolor fully.` );

		}

		try {

			// Guard: clone-on-write for SHARED materials, done as a command so undo
			// restores the original shared material (no bleed, fully reversible).
			// Single-material meshes only — array materials keep the per-slot color
			// command path below.
			if ( ! isArrayMat && isMaterialShared( mat, editor.scene ) ) {

				const cloned = cloneMaterial( mat );
				if ( cloned.color ) cloned.color.setHex( hex );
				cmds.push( new SetMaterialCommand( editor, node, cloned ) );

			} else {

				cmds.push( new SetMaterialColorCommand( editor, node, 'color', hex ) );

			}

		} catch ( e ) {

			console.error( `Failed to recolor "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, message: 'No recolorable meshes matched', count: 0 };

	// Batch into one undo for the whole request (consistent with scale/move).
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );

	return {
		success: true,
		message: warnings.length > 0 ? warnings.join( '; ' ) : null,
		count: cmds.length,
	};

}

/**
 * Scale nodes matching selector.
 * Guards: clamp to reasonable range, don't scale below floor (y=0).
 */
export function scaleOp( editor, selector, factor, axis = null ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `scaleOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safeFactor = clamp( factor, 0.1, 10 );
	if ( Math.abs( safeFactor - factor ) > 0.01 ) {

		console.warn( `scaleOp: factor clamped from ${ factor } to ${ safeFactor }` );

	}

	const cmds = [];

	for ( const node of nodes ) {

		try {

			const newScale = node.scale.clone();
			if ( axis && [ 'x', 'y', 'z' ].includes( String( axis ).toLowerCase() ) ) {

				newScale[ String( axis ).toLowerCase() ] *= safeFactor; // single-axis

			} else {

				newScale.multiplyScalar( safeFactor ); // uniform

			}

			cmds.push( new SetScaleCommand( editor, node, newScale ) );

		} catch ( e ) {

			console.error( `Failed to scale "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Move nodes matching selector.
 * Guards: clamp offsets, keep objects above ground (y >= 0).
 */
export function moveOp( editor, selector, dx, dy, dz ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `moveOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safeOffset = {
		x: clamp( dx, -100, 100 ),
		y: clamp( dy, -100, 100 ),
		z: clamp( dz, -100, 100 ),
	};

	const cmds = [];
	let grounded = 0;

	for ( const node of nodes ) {

		try {

			const newPos = node.position.clone();
			newPos.x += safeOffset.x;
			newPos.y += safeOffset.y;
			newPos.z += safeOffset.z;

			// Guard: keep above ground
			if ( newPos.y < 0 ) {

				newPos.y = 0;
				grounded ++;

			}

			cmds.push( new SetPositionCommand( editor, node, newPos ) );

		} catch ( e ) {

			console.error( `Failed to move "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	const msg = grounded > 0 ? `${ grounded } node(s) grounded (y≥0)` : null;
	return { success: true, message: msg, count: cmds.length };

}

/**
 * Rotate nodes matching selector around an axis by degrees.
 * Guards: clamp degrees to reasonable range.
 */
export function rotateOp( editor, selector, axis, degrees ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `rotateOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const axisName = String( axis ).toLowerCase();
	if ( ! [ 'x', 'y', 'z' ] .includes( axisName ) ) {

		return { success: false, message: `Invalid axis "${ axis }"; use x, y, or z` };

	}

	const safeDegrees = clamp( degrees, -360, 360 );
	const radians = ( safeDegrees * Math.PI ) / 180;

	// Command-backed (one execution surface): build a new Euler per node and route
	// through SetRotationCommand so the rotation is undoable/versioned.
	const cmds = [];

	for ( const node of nodes ) {

		try {

			const newRot = node.rotation.clone();
			newRot[ axisName ] += radians;
			cmds.push( new SetRotationCommand( editor, node, newRot ) );

		} catch ( e ) {

			console.error( `Failed to rotate "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Delete nodes matching selector.
 * Guards: fail gracefully if part of merged mesh (can't isolate).
 */
export function deleteOp( editor, selector ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `deleteOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	let count = 0;
	let skipped = [];

	// Command-backed: execute each RemoveObjectCommand individually (not batched).
	// RemoveObjectCommand captures parent+index at construction; executing one at
	// a time keeps each capture consistent with current sibling order (batching
	// would record stale indices once earlier siblings are removed).
	for ( const node of nodes ) {

		// Guard: check if part of merged mesh
		if ( isMergedMeshNode( node ) ) {

			skipped.push( node.name || node.uuid.slice( 0, 6 ) );
			continue;

		}

		if ( ! node.parent ) { continue; } // detached / scene root — nothing to remove from

		try {

			editor.execute( new RemoveObjectCommand( editor, node ) );
			count ++;

		} catch ( e ) {

			console.error( `Failed to delete "${ node.name }":`, e );

		}

	}

	let msg = null;
	if ( skipped.length > 0 ) {

		msg = `${ skipped.length } node(s) skipped (merged mesh; parts not separable): ${ skipped.join( ', ' ) }`;

	}

	return { success: count > 0, message: msg, skipped: skipped.length, count };

}

/**
 * Duplicate nodes matching selector with offset.
 * Guards: clamp offset.
 */
export function duplicateOp( editor, selector, dx, dy, dz ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `duplicateOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safeOffset = {
		x: clamp( dx, -100, 100 ),
		y: clamp( dy, -100, 100 ),
		z: clamp( dz, -100, 100 ),
	};

	const THREE = window.THREE;
	let count = 0;

	for ( const node of nodes ) {

		try {

			const clone = node.clone();

			// AddObjectCommand parents the clone to the scene root, so bake the
			// original's WORLD transform onto the clone — otherwise a clone of a
			// nested node would jump if its parent group had a transform.
			node.updateWorldMatrix( true, false );
			node.getWorldPosition( clone.position );
			node.getWorldQuaternion( clone.quaternion );
			node.getWorldScale( clone.scale );

			clone.position.x += safeOffset.x;
			clone.position.y += safeOffset.y;
			clone.position.z += safeOffset.z;
			if ( clone.name ) clone.name += ' (copy)';

			// Command-backed (undoable/versioned).
			editor.execute( new AddObjectCommand( editor, clone ) );
			count ++;

		} catch ( e ) {

			console.error( `Failed to duplicate "${ node.name }":`, e );

		}

	}

	return { success: count > 0, count };

}

/**
 * Set material of nodes matching selector.
 * Guards: clone material if shared.
 */
export function setMaterialOp( editor, selector, materialProps ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `setMaterialOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	if ( ! materialProps || typeof materialProps !== 'object' ) {

		return { success: false, message: 'materialProps must be an object' };

	}

	// Guard: a texture map must be a THREE.Texture, never a bare string. The
	// `retexture` op (named textures) has no loader wired yet — fail loudly here
	// rather than constructing a material with an unusable string `map`.
	if ( 'map' in materialProps && materialProps.map != null && ! materialProps.map.isTexture ) {

		return { success: false, message: 'retexture: named/string textures are not supported yet (map must be a THREE.Texture). Use setMaterial with color, or raw to load a texture.' };

	}

	const THREE = window.THREE;
	let count = 0;

	// Expand matched nodes to all descendant meshes (so Groups apply to children)
	const meshes = [];
	for ( const node of nodes ) {

		for ( const mesh of expandToMeshes( node ) ) {

			meshes.push( mesh );

		}

	}

	for ( const node of meshes ) {

		try {

			const newMat = new THREE.MeshStandardMaterial( materialProps );
			editor.execute( new SetMaterialCommand( editor, node, newMat ) );
			count ++;

		} catch ( e ) {

			console.error( `Failed to set material on "${ node.name }":`, e );

		}

	}

	return { success: count > 0, count };

}

/**
 * Set opacity (0-1) on matched nodes.
 */
export function setOpacityOp( editor, selector, value ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `setOpacityOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safeValue = clamp( parseFloat( value ) || 1, 0, 1 );
	let count = 0;

	// Expand matched nodes to all descendant meshes
	const meshes = [];
	for ( const node of nodes ) {

		for ( const mesh of expandToMeshes( node ) ) {

			meshes.push( mesh );

		}

	}

	for ( const node of meshes ) {

		try {

			if ( node.material ) {

				const materials = Array.isArray( node.material ) ? node.material : [ node.material ];
				for ( const mat of materials ) {

					mat.transparent = true;
					mat.opacity = safeValue;

				}

				count ++;

			}

		} catch ( e ) {

			console.error( `Failed to set opacity on "${ node.name }":`, e );

		}

	}

	return { success: count > 0, count };

}

/**
 * Set visibility (true/false) on matched nodes.
 */
export function setVisibleOp( editor, selector, visible ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `setVisibleOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const cmds = [];

	for ( const node of nodes ) {

		try {

			node.visible = Boolean( visible );
			// Note: visibility changes are immediate, not command-backed (no undo needed)
			cmds.push( node );

		} catch ( e ) {

			console.error( `Failed to set visibility on "${ node.name }":`, e );

		}

	}

	return { success: cmds.length > 0, count: cmds.length };

}

/**
 * Toggle wireframe mode on matched nodes.
 */
export function wireframeOp( editor, selector, wireframeMode ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `wireframeOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	let count = 0;

	// Expand matched nodes to all descendant meshes
	const meshes = [];
	for ( const node of nodes ) {

		for ( const mesh of expandToMeshes( node ) ) {

			meshes.push( mesh );

		}

	}

	for ( const node of meshes ) {

		try {

			if ( node.material ) {

				const materials = Array.isArray( node.material ) ? node.material : [ node.material ];
				for ( const mat of materials ) {

					mat.wireframe = Boolean( wireframeMode );

				}

				count ++;

			}

		} catch ( e ) {

			console.error( `Failed to set wireframe on "${ node.name }":`, e );

		}

	}

	return { success: count > 0, count };

}

/**
 * Set absolute world position on matched nodes.
 */
export function moveToOp( editor, selector, x, y, z ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `moveToOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safePos = {
		x: clamp( parseFloat( x ) || 0, -1000, 1000 ),
		y: clamp( parseFloat( y ) || 0, 0, 1000 ),
		z: clamp( parseFloat( z ) || 0, -1000, 1000 ),
	};

	const cmds = [];

	for ( const node of nodes ) {

		try {

			const newPos = new window.THREE.Vector3( safePos.x, safePos.y, safePos.z );
			cmds.push( new SetPositionCommand( editor, node, newPos ) );

		} catch ( e ) {

			console.error( `Failed to move "${ node.name }" to ${ x },${ y },${ z }:`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Set absolute rotation (Euler angles in degrees) on matched nodes.
 */
export function rotateToOp( editor, selector, x, y, z ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `rotateToOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	// Convert degrees to radians and clamp
	const toRad = Math.PI / 180;
	const safeRot = {
		x: ( parseFloat( x ) || 0 ) * toRad,
		y: ( parseFloat( y ) || 0 ) * toRad,
		z: ( parseFloat( z ) || 0 ) * toRad,
	};

	const THREE = window.THREE;
	const cmds = [];

	for ( const node of nodes ) {

		try {

			const euler = new THREE.Euler( safeRot.x, safeRot.y, safeRot.z, 'XYZ' );
			const quaternion = new THREE.Quaternion();
			quaternion.setFromEuler( euler );
			cmds.push( new SetRotationCommand( editor, node, quaternion ) );

		} catch ( e ) {

			console.error( `Failed to rotate "${ node.name }" to ${ x },${ y },${ z }:`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Set absolute uniform scale on matched nodes.
 */
export function scaleToOp( editor, selector, factor ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `scaleToOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const safeFactor = clamp( parseFloat( factor ) || 1, 0.01, 100 );
	const THREE = window.THREE;
	const cmds = [];

	for ( const node of nodes ) {

		try {

			const newScale = new THREE.Vector3( safeFactor, safeFactor, safeFactor );
			cmds.push( new SetScaleCommand( editor, node, newScale ) );

		} catch ( e ) {

			console.error( `Failed to scale "${ node.name }" to ${ factor }:`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Reset matched nodes to their original transform.
 */
export function resetOp( editor, selector ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `resetOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const cmds = [];

	for ( const node of nodes ) {

		try {

			// Reset to identity transform
			cmds.push( new SetPositionCommand( editor, node, new window.THREE.Vector3( 0, 0, 0 ) ) );
			cmds.push( new SetRotationCommand( editor, node, new window.THREE.Quaternion() ) );
			cmds.push( new SetScaleCommand( editor, node, new window.THREE.Vector3( 1, 1, 1 ) ) );

		} catch ( e ) {

			console.error( `Failed to reset "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

/**
 * Orient matched nodes toward a target point.
 * Target can be [x,y,z] array or node name string.
 */
export function lookAtOp( editor, selector, target ) {

	const nodes = selectorEngine.query( editor.scene, selector );
	if ( nodes.length === 0 ) {

		console.warn( `lookAtOp: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	const THREE = window.THREE;
	let targetVec;

	// Parse target: array [x,y,z] or node name string
	if ( Array.isArray( target ) && target.length >= 3 ) {

		targetVec = new THREE.Vector3( target[ 0 ], target[ 1 ], target[ 2 ] );

	} else if ( typeof target === 'string' ) {

		const targetNode = selectorEngine.query( editor.scene, target )[ 0 ];
		if ( ! targetNode ) {

			return { success: false, message: `lookAt: target "${ target }" not found`, count: 0 };

		}

		targetVec = new THREE.Vector3();
		targetNode.getWorldPosition( targetVec );

	} else {

		return { success: false, message: 'lookAt: target must be [x,y,z] or node name', count: 0 };

	}

	const cmds = [];

	for ( const node of nodes ) {

		try {

			// Create a matrix to look at the target
			const matrix = new THREE.Matrix4();
			const pos = new THREE.Vector3();
			node.getWorldPosition( pos );
			matrix.lookAt( pos, targetVec, new THREE.Vector3( 0, 1, 0 ) );

			// Extract quaternion from the matrix
			const quat = new THREE.Quaternion();
			quat.setFromRotationMatrix( matrix );
			cmds.push( new SetRotationCommand( editor, node, quat ) );

		} catch ( e ) {

			console.error( `Failed to lookAt on "${ node.name }":`, e );

		}

	}

	if ( cmds.length === 0 ) return { success: false, count: 0 };
	editor.execute( new MultiCmdsCommand( editor, cmds ) );
	return { success: true, count: cmds.length };

}

// ── Dispatcher ──────────────────────────────────────────────────────────────────

/**
 * Execute a structured edit op.
 * @param {Editor} editor
 * @param {object} opData  {op, selector, args}
 * @returns {object}  {success, message?, count}
 */
export function executeEditOp( editor, opData ) {

	if ( ! editor || ! editor.scene ) return { success: false, message: 'No editor' };

	const err = validateOp( opData );
	if ( err ) return { success: false, message: `Invalid op: ${ err }` };

	const { op, selector, args } = opData;

	try {

		switch ( op ) {

			case 'recolor':
				return recolorOp( editor, selector, args.color );
			case 'scale':
				return scaleOp( editor, selector, args.factor, args.axis );
			case 'move':
				return moveOp( editor, selector, args.dx, args.dy, args.dz );
			case 'rotate':
				return rotateOp( editor, selector, args.axis, args.degrees );
			case 'delete':
				return deleteOp( editor, selector );
			case 'duplicate':
				return duplicateOp( editor, selector, args.dx, args.dy, args.dz );
			case 'setMaterial':
				return setMaterialOp( editor, selector, args.props );
			case 'setOpacity':
				return setOpacityOp( editor, selector, args.value );
			case 'setVisible':
				return setVisibleOp( editor, selector, args.visible );
			case 'wireframe':
				return wireframeOp( editor, selector, args.wireframe );
			case 'moveTo':
				return moveToOp( editor, selector, args.x, args.y, args.z );
			case 'rotateTo':
				return rotateToOp( editor, selector, args.x, args.y, args.z );
			case 'scaleTo':
				return scaleToOp( editor, selector, args.factor );
			case 'reset':
				return resetOp( editor, selector );
			case 'lookAt':
				return lookAtOp( editor, selector, args.target );
			default:
				return { success: false, message: `Unknown op: ${ op }` };

		}

	} catch ( e ) {

		console.error( `Edit op error (${ op }):`, e );
		return { success: false, message: e.message };

	}

}
