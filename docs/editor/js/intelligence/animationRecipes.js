// ── animationRecipes.js ─────────────────────────────────────────────────────────
// Templated animation recipes — model emits {recipe, selector, params} JSON,
// host expands deterministically into WINDING-SAFE keyframe clips.
//
// Recipes (closed set):
//   spin, bounce, pulse, fade, orbit, scale, shake, spinWheels
//
// Critical: quaternion spins must sub-divide into ≤90° steps to WORK.
// A 2-keyframe quaternion 0→2π is ANTIPODAL (same orientation), doesn't spin.
// (See: Shell.js addSpinClip implementation for reference.)

import * as selectorEngine from './selectorEngine.js';
import { AddAnimationClipCommand } from '../commands/AddAnimationClipCommand.js';
import { MultiCmdsCommand } from '../commands/MultiCmdsCommand.js';

const THREE = window.THREE;

// ── Recipe schema ───────────────────────────────────────────────────────────────

export const RECIPE_SCHEMA = {
	type: 'object',
	properties: {
		recipe: {
			type: 'string',
			enum: [ 'spin', 'bounce', 'pulse', 'fade', 'orbit', 'scale', 'shake', 'spinWheels' ],
		},
		selector: { type: 'string' },
		params: { type: 'object' },
	},
	required: [ 'recipe', 'selector', 'params' ],
};

// ── Validation ──────────────────────────────────────────────────────────────────

export function validateRecipe( recipeData ) {

	if ( ! recipeData || typeof recipeData !== 'object' ) return 'recipe must be an object';
	if ( typeof recipeData.recipe !== 'string' ) return 'recipe.recipe must be a string';
	if ( ! RECIPE_SCHEMA.properties.recipe.enum.includes( recipeData.recipe ) ) {

		return `recipe.recipe must be one of: ${ RECIPE_SCHEMA.properties.recipe.enum.join( ', ' ) }`;

	}
	if ( typeof recipeData.selector !== 'string' ) return 'recipe.selector must be a string';
	if ( ! selectorEngine.isValid( recipeData.selector ) ) return `recipe.selector "${ recipeData.selector }" is not valid CSS selector syntax`;
	if ( ! recipeData.params || typeof recipeData.params !== 'object' ) return 'recipe.params must be an object';
	return null;

}

// ── Keyframe builders ───────────────────────────────────────────────────────────

/**
 * Create a NumberKeyframeTrack for a simple numeric property.
 * @param {string} nodeName  node UUID or name for track target
 * @param {string} property  e.g. "position.x", "scale"
 * @param {Array} values     [v0, v1, v2, ...]
 * @param {Array} times      [t0, t1, t2, ...] in seconds
 * @returns {THREE.NumberKeyframeTrack}
 */
function numberTrack( nodeName, property, times, values ) {

	return new THREE.NumberKeyframeTrack( `${ nodeName }.${ property }`, times, values );

}

/**
 * Create a VectorKeyframeTrack for position/scale.
 * @param {string} nodeName
 * @param {string} property
 * @param {Array} values  [x0,y0,z0, x1,y1,z1, ...]
 * @param {Array} times
 * @returns {THREE.VectorKeyframeTrack}
 */
function vectorTrack( nodeName, property, times, values ) {

	return new THREE.VectorKeyframeTrack( `${ nodeName }.${ property }`, times, values );

}

/**
 * Create a QuaternionKeyframeTrack for rotation.
 * WINDING-SAFE: sub-divides full rotations into ≤90° steps.
 * @param {string} nodeName
 * @param {Array} values  quaternion keyframes [x0,y0,z0,w0, x1,y1,z1,w1, ...]
 * @param {Array} times
 * @returns {THREE.QuaternionKeyframeTrack}
 */
function quaternionTrack( nodeName, times, values ) {

	return new THREE.QuaternionKeyframeTrack( `${ nodeName }.quaternion`, times, values );

}

/**
 * Create a ColorKeyframeTrack.
 * @param {string} nodeName
 * @param {string} property
 * @param {Array} values  hex colors [0xRRGGBB, ...] → floats [r0,g0,b0, r1,g1,b1, ...]
 * @param {Array} times
 * @returns {THREE.ColorKeyframeTrack}
 */
function colorTrack( nodeName, property, times, values ) {

	// Convert hex to [r,g,b] floats
	const floatValues = [];
	for ( const hex of values ) {

		const c = new THREE.Color( hex );
		floatValues.push( c.r, c.g, c.b );

	}

	return new THREE.ColorKeyframeTrack( `${ nodeName }.${ property }`, times, floatValues );

}

// ── Recipe implementations ──────────────────────────────────────────────────────

/**
 * Spin recipe: rotate around an axis by turns.
 * Winding-safe: sub-divides into ≤90° quaternion steps.
 * Params: {axis:'y', turns:1, duration:2, pingPong:false}
 */
export function spinRecipe( node, params = {} ) {

	const axis = ( params.axis || 'y' ).toLowerCase();
	const turns = params.turns ?? 1;
	const duration = params.duration ?? 2;
	const pingPong = params.pingPong ?? false;
	const name = params.name || `Spin${ axis.toUpperCase() }`;

	if ( ! [ 'x', 'y', 'z' ].includes( axis ) ) throw new Error( `Invalid axis: ${ axis }` );

	const axisVec = new THREE.Vector3(
		axis === 'x' ? 1 : 0,
		axis === 'y' ? 1 : 0,
		axis === 'z' ? 1 : 0
	);

	const total = turns * Math.PI * 2;
	const segments = Math.max( 1, Math.ceil( Math.abs( turns ) * 4 ) ); // ≤90° steps

	const angles = [];
	for ( let i = 0; i <= segments; i ++ ) angles.push( ( total * i ) / segments );
	if ( pingPong ) for ( let i = segments - 1; i >= 0; i -- ) angles.push( ( total * i ) / segments );

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const times = [];
	const values = [];
	const last = angles.length - 1;

	for ( let i = 0; i < angles.length; i ++ ) {

		times.push( ( duration * i ) / last );
		tmpQ.setFromAxisAngle( axisVec, angles[ i ] ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( name, -1, [ track ] );

}

/**
 * Bounce recipe: oscillate up and down.
 * Params: {height:0.5, duration:1}
 */
export function bounceRecipe( node, params = {} ) {

	const height = params.height ?? 0.5;
	const duration = params.duration ?? 1;

	const startY = node.position.y;
	const times = [ 0, duration / 4, duration / 2, 3 * duration / 4, duration ];
	const values = [ startY, startY + height, startY, startY + height, startY ];

	const track = numberTrack( node.uuid, 'position.y', times, values );
	return new THREE.AnimationClip( 'Bounce', -1, [ track ] );

}

/**
 * Pulse recipe: scale up and down.
 * Params: {scale:1.2, duration:1}
 */
export function pulseRecipe( node, params = {} ) {

	const scale = params.scale ?? 1.2;
	const duration = params.duration ?? 1;

	const times = [ 0, duration / 2, duration ];
	const xValues = [ node.scale.x, node.scale.x * scale, node.scale.x ];
	const yValues = [ node.scale.y, node.scale.y * scale, node.scale.y ];
	const zValues = [ node.scale.z, node.scale.z * scale, node.scale.z ];

	const values = [];
	for ( let i = 0; i < times.length; i ++ ) {

		values.push( xValues[ i ], yValues[ i ], zValues[ i ] );

	}

	const track = vectorTrack( node.uuid, 'scale', times, values );
	return new THREE.AnimationClip( 'Pulse', -1, [ track ] );

}

/**
 * Fade recipe: opacity transition (requires transparent material).
 * Params: {from:1, to:0, duration:1}
 */
export function fadeRecipe( node, params = {} ) {

	const from = params.from ?? 1;
	const to = params.to ?? 0;
	const duration = params.duration ?? 1;

	const times = [ 0, duration ];
	const values = [ from, to ];

	const track = numberTrack( node.uuid, 'material.opacity', times, values );
	return new THREE.AnimationClip( 'Fade', -1, [ track ] );

}

/**
 * Orbit recipe: move around a center point.
 * Params: {center:[x,y,z], radius:2, duration:4}
 */
export function orbitRecipe( node, params = {} ) {

	const center = params.center ? new THREE.Vector3( ...params.center ) : new THREE.Vector3( 0, 0, 0 );
	const radius = params.radius ?? 2;
	const duration = params.duration ?? 4;

	const steps = 32;
	const times = [];
	const values = [];

	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		const angle = t * Math.PI * 2;
		const x = center.x + Math.cos( angle ) * radius;
		const y = node.position.y; // keep height
		const z = center.z + Math.sin( angle ) * radius;

		times.push( t * duration );
		values.push( x, y, z );

	}

	const track = vectorTrack( node.uuid, 'position', times, values );
	return new THREE.AnimationClip( 'Orbit', -1, [ track ] );

}

/**
 * Scale recipe: grow/shrink to a target scale.
 * Params: {to:2, duration:1}
 */
export function scaleRecipe( node, params = {} ) {

	const to = params.to ?? 2;
	const duration = params.duration ?? 1;

	const times = [ 0, duration ];
	const fromValues = [ node.scale.x, node.scale.y, node.scale.z ];
	const toValues = [ node.scale.x * to, node.scale.y * to, node.scale.z * to ];
	const values = [ ...fromValues, ...toValues ];

	const track = vectorTrack( node.uuid, 'scale', times, values );
	return new THREE.AnimationClip( 'Scale', -1, [ track ] );

}

/**
 * Shake recipe: quick jittery motion.
 * Params: {intensity:0.1, duration:1}
 */
export function shakeRecipe( node, params = {} ) {

	const intensity = params.intensity ?? 0.1;
	const duration = params.duration ?? 1;

	const startPos = node.position.clone();
	const steps = 16;
	const times = [];
	const values = [];

	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		const jitter = Math.random() - 0.5;
		times.push( t * duration );
		values.push(
			startPos.x + jitter * intensity,
			startPos.y + jitter * intensity,
			startPos.z + jitter * intensity
		);

	}

	const track = vectorTrack( node.uuid, 'position', times, values );
	return new THREE.AnimationClip( 'Shake', -1, [ track ] );

}

/**
 * SpinWheels recipe: specialized spin for wheel sets (e.g., car wheels).
 * Spins around X-axis (like wheels on ground).
 * Params: {speed:1, duration:auto}
 */
export function spinWheelsRecipe( nodes, params = {} ) {

	const speed = params.speed ?? 1; // revolutions per second
	const duration = params.duration ?? ( 1 / speed );

	const clips = [];
	for ( const node of nodes ) {

		const clip = spinRecipe( node, { axis: 'x', turns: speed * duration, duration, pingPong: false } );
		clips.push( clip );

	}

	return clips; // Returns array (multiple wheels)

}

// ── Dispatcher ──────────────────────────────────────────────────────────────────

/**
 * Execute a recipe and return an AnimationClip (or array for batch).
 * @param {THREE.Object3D} node  or array of nodes
 * @param {object} recipeData  {recipe, selector, params}
 * @returns {THREE.AnimationClip|Array<THREE.AnimationClip>|null}
 */
export function executeRecipe( node, recipeData ) {

	if ( ! node ) return null;

	const err = validateRecipe( recipeData );
	if ( err ) { console.error( 'Invalid recipe:', err ); return null; }

	const { recipe, params } = recipeData;

	try {

		switch ( recipe ) {

			case 'spin':
				return spinRecipe( node, params );
			case 'bounce':
				return bounceRecipe( node, params );
			case 'pulse':
				return pulseRecipe( node, params );
			case 'fade':
				return fadeRecipe( node, params );
			case 'orbit':
				return orbitRecipe( node, params );
			case 'scale':
				return scaleRecipe( node, params );
			case 'shake':
				return shakeRecipe( node, params );
			case 'spinWheels':
				return spinWheelsRecipe( Array.isArray( node ) ? node : [ node ], params );
			default:
				return null;

		}

	} catch ( e ) {

		console.error( `Recipe error (${ recipe }):`, e );
		return null;

	}

}

/**
 * Execute recipe over matched selector and register clip.
 * @param {Editor} editor
 * @param {object} recipeData  {recipe, selector, params}
 * @returns {object}  {success, clip?, message?, count}
 */
export function executeRecipeOp( editor, recipeData ) {

	if ( ! editor || ! editor.scene ) return { success: false, message: 'No editor' };

	const err = validateRecipe( recipeData );
	if ( err ) return { success: false, message: `Invalid recipe: ${ err }` };

	const { recipe, selector, params } = recipeData;
	const nodes = selectorEngine.query( editor.scene, selector );

	if ( nodes.length === 0 ) {

		console.warn( `Recipe: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	try {

		let clips = [];

		if ( recipe === 'spinWheels' ) {

			// Special case: batch
			clips = executeRecipe( nodes, recipeData ) || [];

		} else {

			// Normal case: one clip per node
			for ( const node of nodes ) {

				const clip = executeRecipe( node, recipeData );
				if ( clip ) clips.push( clip );

			}

		}

		if ( clips.length === 0 ) return { success: false, message: 'No clips generated' };

		// Register all clips through the command system (one execution surface —
		// undoable/versioned). Clips target node uuids but register on the scene,
		// matching the existing addClip path. Batch into one undo for the request.
		const cmds = clips.map( clip => new AddAnimationClipCommand( editor, clip, editor.scene ) );
		editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );

		return { success: true, count: clips.length };

	} catch ( e ) {

		console.error( `Recipe op error (${ recipe }):`, e );
		return { success: false, message: e.message };

	}

}
