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

// ── Recipe schema ───────────────────────────────────────────────────────────────

export const RECIPE_SCHEMA = {
	type: 'object',
	properties: {
		recipe: {
			type: 'string',
			enum: [
				'animate',
				'spin', 'bounce', 'pulse', 'fade', 'orbit', 'scale', 'shake', 'spinWheels',
				'flyTo', 'turnTo',
				'fadeIn', 'zoomIn', 'slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight',
				'bounceIn', 'flipInX', 'flipInY', 'rotateIn',
				'fadeOut', 'zoomOut', 'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight',
				'bounceOut', 'flipOutX', 'flipOutY', 'rotateOut',
				'flash', 'rubberBand', 'jello', 'heartBeat', 'tada', 'wobble'
			],
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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
	// Convert hex to [r,g,b] floats
	const floatValues = [];
	for ( const hex of values ) {

		const c = new THREE.Color( hex );
		floatValues.push( c.r, c.g, c.b );

	}

	return new THREE.ColorKeyframeTrack( `${ nodeName }.${ property }`, times, floatValues );

}

// ── CSS timing functions (the easing vocabulary) ─────────────────────────────
// Named CSS easings + cubic-bezier(...) — the recognized web vocabulary, not a
// bespoke curve system. Baked into sampled keyframes at compile time so the
// authored curve survives to glTF (renderer-agnostic round-trip).

const CSS_NAMED_EASINGS = {
	'ease':        [ 0.25, 0.1, 0.25, 1 ],
	'ease-in':     [ 0.42, 0, 1, 1 ],
	'ease-out':    [ 0, 0, 0.58, 1 ],
	'ease-in-out': [ 0.42, 0, 0.58, 1 ],
};

function cubicBezier( p1x, p1y, p2x, p2y ) {

	const cx = 3 * p1x, bx = 3 * ( p2x - p1x ) - cx, ax = 1 - cx - bx;
	const cy = 3 * p1y, by = 3 * ( p2y - p1y ) - cy, ay = 1 - cy - by;
	const sampleX = t => ( ( ax * t + bx ) * t + cx ) * t;
	const sampleY = t => ( ( ay * t + by ) * t + cy ) * t;
	const sampleDX = t => ( 3 * ax * t + 2 * bx ) * t + cx;

	return function ( x ) {

		if ( x <= 0 ) return 0;
		if ( x >= 1 ) return 1;

		// Newton-Raphson, bisection fallback (the standard CSS bezier solver)
		let t = x;
		for ( let i = 0; i < 8; i ++ ) {

			const err = sampleX( t ) - x;
			if ( Math.abs( err ) < 1e-6 ) return sampleY( t );
			const d = sampleDX( t );
			if ( Math.abs( d ) < 1e-6 ) break;
			t -= err / d;

		}

		let lo = 0, hi = 1;
		while ( hi - lo > 1e-6 ) {

			t = ( lo + hi ) / 2;
			if ( sampleX( t ) < x ) lo = t; else hi = t;

		}

		return sampleY( t );

	};

}

/** Resolve a CSS timing-function string to f(t)→0..1. Unknown → linear. */
export function cssEasingFunction( easing ) {

	if ( ! easing || easing === 'linear' ) return t => t;
	let pts = CSS_NAMED_EASINGS[ String( easing ).trim() ];
	if ( ! pts ) {

		const m = /^cubic-bezier\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)$/.exec( String( easing ).trim() );
		if ( m ) pts = [ + m[ 1 ], + m[ 2 ], + m[ 3 ], + m[ 4 ] ];

	}

	if ( ! pts ) return t => t;
	return cubicBezier( pts[ 0 ], pts[ 1 ], pts[ 2 ], pts[ 3 ] );

}

// ── The .animate() recipe (jQuery grammar over CSS 3D transforms) ─────────────

/**
 * The ONE animation grammar: jQuery .animate(props, duration, easing) over CSS
 * 3D transform values. Compiles to sampled absolute keyframes (position /
 * quaternion / scale / fov tracks) — the stored, exported representation is
 * unchanged.
 *
 * props (CSS 3D transforms — RELATIVE deltas, per CSS convention):
 *   translateX/Y/Z: n         — move by n on that axis
 *   translate3d: [x,y,z]      — move by the vector
 *   rotateX/Y/Z: deg          — rotate by degrees (CSS: degrees, not radians)
 *   rotate3d: [x,y,z,deg]     — rotate by deg around the (local) axis
 *   scale: n | scaleX/Y/Z: n | scale3d: [x,y,z]  — multiply current scale
 *   transformOrigin: [x,y,z]  — WORLD pivot: rotation/scale orbit this point
 *   lookAt: selector|[x,y,z]  — aim -Z at target (resolved host-side; BAKES to
 *                               rotation keyframes; overrides rotate* props)
 *   fov: deg                  — camera only; animates TO the value (absolute)
 *   to: { position:[x,y,z], rotation:[degX,degY,degZ], scale:n|[x,y,z] }
 *                             — explicit ABSOLUTE targets
 *
 * params: { props, easing: CSS timing function, duration: SECONDS (the sugar
 * converts jQuery ms), lookAtWorld: [x,y,z] (injected by compileTimeline) }
 */
export function animateRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = Math.max( 0.001, params.duration ?? 0.4 );
	const props = params.props && typeof params.props === 'object' ? params.props : {};
	const ease = cssEasingFunction( params.easing );
	const isLinear = ! params.easing || params.easing === 'linear';

	const num = v => ( Number.isFinite( Number( v ) ) ? Number( v ) : 0 );
	const deg2rad = THREE.MathUtils.degToRad;

	// ── translation delta ──
	const delta = new THREE.Vector3( 0, 0, 0 );
	if ( Array.isArray( props.translate3d ) ) delta.set( num( props.translate3d[ 0 ] ), num( props.translate3d[ 1 ] ), num( props.translate3d[ 2 ] ) );
	delta.x += num( props.translateX );
	delta.y += num( props.translateY );
	delta.z += num( props.translateZ );

	// ── rotation delta (degrees, CSS convention) ──
	let rotAxis = null, rotAngle = 0; // rotate3d form
	const eulerDelta = new THREE.Vector3( num( props.rotateX ), num( props.rotateY ), num( props.rotateZ ) ); // degrees
	if ( Array.isArray( props.rotate3d ) && props.rotate3d.length === 4 ) {

		rotAxis = new THREE.Vector3( num( props.rotate3d[ 0 ] ), num( props.rotate3d[ 1 ] ), num( props.rotate3d[ 2 ] ) ).normalize();
		rotAngle = num( props.rotate3d[ 3 ] );

	}

	const hasRotDelta = rotAngle !== 0 || eulerDelta.x !== 0 || eulerDelta.y !== 0 || eulerDelta.z !== 0;

	// ── scale multipliers ──
	const mult = new THREE.Vector3( 1, 1, 1 );
	if ( typeof props.scale === 'number' ) mult.set( props.scale, props.scale, props.scale );
	if ( Array.isArray( props.scale3d ) ) mult.set( num( props.scale3d[ 0 ] ) || 1, num( props.scale3d[ 1 ] ) || 1, num( props.scale3d[ 2 ] ) || 1 );
	if ( props.scaleX !== undefined ) mult.x = num( props.scaleX ) || 1;
	if ( props.scaleY !== undefined ) mult.y = num( props.scaleY ) || 1;
	if ( props.scaleZ !== undefined ) mult.z = num( props.scaleZ ) || 1;
	const hasScale = mult.x !== 1 || mult.y !== 1 || mult.z !== 1;

	// ── absolute targets ──
	const to = props.to && typeof props.to === 'object' ? props.to : null;
	const toPos = to && Array.isArray( to.position ) ? new THREE.Vector3( num( to.position[ 0 ] ), num( to.position[ 1 ] ), num( to.position[ 2 ] ) ) : null;
	const toRotQ = to && Array.isArray( to.rotation )
		? new THREE.Quaternion().setFromEuler( new THREE.Euler( deg2rad( num( to.rotation[ 0 ] ) ), deg2rad( num( to.rotation[ 1 ] ) ), deg2rad( num( to.rotation[ 2 ] ) ) ) )
		: null;
	let toScale = null;
	if ( to && to.scale !== undefined ) {

		toScale = Array.isArray( to.scale )
			? new THREE.Vector3( num( to.scale[ 0 ] ) || 1, num( to.scale[ 1 ] ) || 1, num( to.scale[ 2 ] ) || 1 )
			: new THREE.Vector3( num( to.scale ) || 1, num( to.scale ) || 1, num( to.scale ) || 1 );

	}

	// ── camera fov (absolute target — jQuery property-animation semantics) ──
	let fovTarget = null;
	if ( typeof props.fov === 'number' ) fovTarget = props.fov;
	else if ( to && typeof to.fov === 'number' ) fovTarget = to.fov;

	// ── pivot + look-at ──
	const origin = Array.isArray( props.transformOrigin )
		? new THREE.Vector3( num( props.transformOrigin[ 0 ] ), num( props.transformOrigin[ 1 ] ), num( props.transformOrigin[ 2 ] ) )
		: null;
	const lookTarget = Array.isArray( params.lookAtWorld )
		? new THREE.Vector3( num( params.lookAtWorld[ 0 ] ), num( params.lookAtWorld[ 1 ] ), num( params.lookAtWorld[ 2 ] ) )
		: null;

	// ── base pose ──
	const P0 = node.position.clone();
	const Q0 = node.quaternion.clone();
	const S0 = node.scale.clone();
	const fov0 = typeof node.fov === 'number' ? node.fov : 50;

	const needPos = delta.lengthSq() > 0 || toPos !== null || ( origin !== null && ( hasRotDelta || hasScale ) );
	const needRot = hasRotDelta || toRotQ !== null || lookTarget !== null;
	const needScale = hasScale || toScale !== null;
	const needFov = fovTarget !== null;

	// Sampling density: rotations / eased curves / pivots / look-at need
	// sub-division (winding safety + curve fidelity); a linear straight move
	// needs only its two endpoints.
	const totalDeg = rotAxis ? Math.abs( rotAngle ) : Math.abs( eulerDelta.x ) + Math.abs( eulerDelta.y ) + Math.abs( eulerDelta.z );
	const curved = ! isLinear || needRot || origin !== null;
	const N = curved
		? Math.min( 120, Math.max( 8, Math.ceil( totalDeg / 45 ) + Math.ceil( duration * 12 ) ) )
		: 1;

	const times = [];
	const posValues = [];
	const rotValues = [];
	const scaleValues = [];
	const fovValues = [];

	const tmpQ = new THREE.Quaternion();
	const tmpV = new THREE.Vector3();
	const tmpM = new THREE.Matrix4();
	const up = new THREE.Vector3( 0, 1, 0 );
	const cameraLike = !! ( node.isCamera || node.isLight );

	for ( let i = 0; i <= N; i ++ ) {

		const t = i / N;
		const k = ease( t );
		times.push( t * duration );

		// rotation delta at k
		if ( rotAxis ) tmpQ.setFromAxisAngle( rotAxis, deg2rad( rotAngle * k ) );
		else tmpQ.setFromEuler( new THREE.Euler( deg2rad( eulerDelta.x * k ), deg2rad( eulerDelta.y * k ), deg2rad( eulerDelta.z * k ) ) );

		// position at k
		if ( toPos ) tmpV.copy( P0 ).lerp( toPos, k );
		else tmpV.copy( P0 ).addScaledVector( delta, k );

		if ( origin ) {

			// pivot: rotate the position about the WORLD point (orbit semantics),
			// and scale its distance from the pivot
			tmpV.sub( origin );
			if ( hasScale ) tmpV.multiply( new THREE.Vector3( 1 + ( mult.x - 1 ) * k, 1 + ( mult.y - 1 ) * k, 1 + ( mult.z - 1 ) * k ) );
			tmpV.applyQuaternion( tmpQ );
			tmpV.add( origin );

		}

		if ( needPos ) posValues.push( tmpV.x, tmpV.y, tmpV.z );

		// rotation channel: look-at wins > absolute target > delta
		if ( needRot ) {

			const q = new THREE.Quaternion();
			if ( lookTarget ) {

				// Object3D.lookAt convention: cameras/lights aim -Z at the target
				if ( cameraLike ) tmpM.lookAt( tmpV, lookTarget, up );
				else tmpM.lookAt( lookTarget, tmpV, up );
				q.setFromRotationMatrix( tmpM );

			} else if ( toRotQ ) {

				q.copy( Q0 ).slerp( toRotQ, k );

			} else if ( origin ) {

				// world-space pivot rotation also turns the node itself
				q.copy( tmpQ ).multiply( Q0 );

			} else {

				// local-space delta (same convention as spinRecipe)
				q.copy( tmpQ ).premultiply( Q0 );

			}

			rotValues.push( q.x, q.y, q.z, q.w );

		}

		if ( needScale ) {

			if ( toScale ) scaleValues.push(
				S0.x + ( toScale.x - S0.x ) * k,
				S0.y + ( toScale.y - S0.y ) * k,
				S0.z + ( toScale.z - S0.z ) * k );
			else scaleValues.push(
				S0.x * ( 1 + ( mult.x - 1 ) * k ),
				S0.y * ( 1 + ( mult.y - 1 ) * k ),
				S0.z * ( 1 + ( mult.z - 1 ) * k ) );

		}

		if ( needFov ) fovValues.push( fov0 + ( fovTarget - fov0 ) * k );

	}

	const tracks = [];
	if ( needPos ) tracks.push( vectorTrack( node.uuid, 'position', times.slice(), posValues ) );
	if ( needRot ) tracks.push( quaternionTrack( node.uuid, times.slice(), rotValues ) );
	if ( needScale ) tracks.push( vectorTrack( node.uuid, 'scale', times.slice(), scaleValues ) );
	if ( needFov ) tracks.push( numberTrack( node.uuid, 'fov', times.slice(), fovValues ) );

	if ( tracks.length === 0 ) throw new Error( 'animate: no animatable props (use translate/rotate/scale/fov/lookAt/to)' );
	return new THREE.AnimationClip( 'Animate', - 1, tracks );

}

// ── Recipe implementations ──────────────────────────────────────────────────────

/**
 * Spin recipe: rotate around an axis by turns.
 * Winding-safe: sub-divides into ≤90° quaternion steps.
 * Params: {axis:'y', turns:1, duration:2, pingPong:false}
 */
export function spinRecipe( node, params = {} ) {

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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
 * Note: Skips nodes without materials (Groups, etc.).
 */
export function fadeRecipe( node, params = {} ) {

	const THREE = window.THREE;

	// Skip nodes without materials
	if ( ! node.material ) {

		console.warn( `Fade: skipping ${ node.name } (no material)` );
		return null;

	}

	const from = params.from ?? 1;
	const to = params.to ?? 0;
	const duration = params.duration ?? 1;

	node.material.transparent = true;
	
	// Ensure opacity is initialized so animation has valid target
	if ( node.material.opacity === undefined ) {
		node.material.opacity = 1;
	}

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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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

	const THREE = window.THREE;
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
 * FadeIn recipe: appear from transparent.
 * Params: {duration:1}
 * Note: Skips nodes without materials (Groups, etc.).
 */
export function fadeInRecipe( node, params = {} ) {

	// Skip nodes without materials
	if ( ! node.material ) {

		console.warn( `FadeIn: skipping ${ node.name } (no material)` );
		return null;

	}

	const duration = params.duration ?? 1;
	node.material.transparent = true;
	
	// Ensure opacity is initialized to 1 so animation has a valid target
	if ( node.material.opacity === undefined ) {
		node.material.opacity = 1;
	}

	const times = [ 0, duration ];
	const values = [ 0, node.material.opacity ];

	const track = numberTrack( node.uuid, 'material.opacity', times, values );
	return new THREE.AnimationClip( 'FadeIn', -1, [ track ] );

}

/**
 * ZoomIn recipe: scale from zero to full size.
 * Params: {scale:1.5, duration:1}
 */
export function zoomInRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1;
	const times = [ 0, duration ];
	const values = [
		0, 0, 0,
		node.scale.x, node.scale.y, node.scale.z
	];

	const track = vectorTrack( node.uuid, 'scale', times, values );
	return new THREE.AnimationClip( 'ZoomIn', -1, [ track ] );

}

/**
 * SlideIn recipes: move into position from an offset.
 */
export function slideInUpRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startY = node.position.y;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide: come from below and slightly back, with rotation
	const pValues = [
		node.position.x, startY - distance, startZ + distance * 0.5,  // start: below and back
		node.position.x, startY - distance * 0.3, startZ + distance * 0.25,  // mid: rising
		node.position.x, startY, startZ  // end: at target
	];

	// Add slight X-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 1, 0, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = ( 1 - t ) * Math.PI * 0.2;  // rotate from 36° down to 0°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideInUp', -1, [ pTrack, rotTrack ] );

}

export function slideInDownRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startY = node.position.y;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide: come from above and slightly back, with rotation
	const pValues = [
		node.position.x, startY + distance, startZ + distance * 0.5,  // start: above and back
		node.position.x, startY + distance * 0.3, startZ + distance * 0.25,  // mid: falling
		node.position.x, startY, startZ  // end: at target
	];

	// Add slight X-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 1, 0, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = ( 1 - t ) * -Math.PI * 0.2;  // rotate from -36° up to 0°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideInDown', -1, [ pTrack, rotTrack ] );

}

export function slideInLeftRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startX = node.position.x;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide: come from left and slightly back, with rotation
	const pValues = [
		startX - distance, node.position.y, startZ + distance * 0.5,  // start: left and back
		startX - distance * 0.3, node.position.y, startZ + distance * 0.25,  // mid: moving right
		startX, node.position.y, startZ  // end: at target
	];

	// Add slight Y-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = ( 1 - t ) * Math.PI * 0.25;  // rotate from 45° down to 0°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideInLeft', -1, [ pTrack, rotTrack ] );

}

export function slideInRightRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startX = node.position.x;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide: come from right and slightly back, with rotation
	const pValues = [
		startX + distance, node.position.y, startZ + distance * 0.5,  // start: right and back
		startX + distance * 0.3, node.position.y, startZ + distance * 0.25,  // mid: moving left
		startX, node.position.y, startZ  // end: at target
	];

	// Add slight Y-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = ( 1 - t ) * -Math.PI * 0.25;  // rotate from -45° up to 0°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideInRight', -1, [ pTrack, rotTrack ] );

}

/**
 * 3D Depth animations: slide in/out along Z-axis (depth)
 */
export function slideInForwardRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 2;
	const duration = params.duration ?? 0.8;

	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D depth slide: come from far back, moving forward with scale
	const pValues = [
		node.position.x, node.position.y, startZ - distance,  // start: far away
		node.position.x, node.position.y, startZ - distance * 0.3,  // mid: approaching
		node.position.x, node.position.y, startZ  // end: at target
	];

	// Add scale growth for perspective effect
	const scaleValues = [
		node.scale.x * 0.3, node.scale.y * 0.3, node.scale.z * 0.3,  // small at distance
		node.scale.x * 0.7, node.scale.y * 0.7, node.scale.z * 0.7,  // medium mid-way
		node.scale.x, node.scale.y, node.scale.z  // full at target
	];

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const sTrack = vectorTrack( node.uuid, 'scale', times, scaleValues );
	return new THREE.AnimationClip( 'SlideInForward', -1, [ pTrack, sTrack ] );

}

export function slideInBackRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 2;
	const duration = params.duration ?? 0.8;

	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D depth slide: start at normal scale, move back and shrink
	const pValues = [
		node.position.x, node.position.y, startZ,  // start: at target position
		node.position.x, node.position.y, startZ + distance * 0.3,  // mid: moving back
		node.position.x, node.position.y, startZ + distance  // end: far away
	];

	// Scale down as it moves back
	const scaleValues = [
		node.scale.x, node.scale.y, node.scale.z,  // full at start
		node.scale.x * 0.7, node.scale.y * 0.7, node.scale.z * 0.7,  // medium mid-way
		node.scale.x * 0.3, node.scale.y * 0.3, node.scale.z * 0.3  // small at distance
	];

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const sTrack = vectorTrack( node.uuid, 'scale', times, scaleValues );
	return new THREE.AnimationClip( 'SlideInBack', -1, [ pTrack, sTrack ] );

}

/**
 * 3D Rotation: flip around Z-axis (spinning like a coin)
 */
export function flipInZRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 0.8;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 0, 1 );

	const times = [ 0, duration ];
	const values = [];

	for ( const t of [ 0, 1 ] ) {

		const angle = t * Math.PI;
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'FlipInZ', -1, [ track ] );

}

export function flipOutZRecipe( node, params = {} ) {

	return flipInZRecipe( node, params ); // Same rotation effect

}

/**
 * BounceIn recipe: scale in with bounce effect.
 * Params: {duration:1.2}
 */
export function bounceInRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1.2;

	const times = [ 0, 0.25, 0.5, 0.75, 1.0 ];
	const tVals = times.map( t => t * duration );

	const values = [];
	for ( const t of times ) {

		// Bounce easing: out-bounce curve
		let scale;
		if ( t < 0.3 ) scale = 0.3;
		else if ( t < 0.6 ) scale = 0.8;
		else if ( t < 0.85 ) scale = 0.95;
		else scale = 1.0;

		values.push( node.scale.x * scale, node.scale.y * scale, node.scale.z * scale );

	}

	const track = vectorTrack( node.uuid, 'scale', tVals, values );
	return new THREE.AnimationClip( 'BounceIn', -1, [ track ] );

}

/**
 * FlipIn recipes: rotate in around an axis.
 */
export function flipInXRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 0.8;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 1, 0, 0 );

	const times = [ 0, duration ];
	const values = [];

	for ( const t of [ 0, 1 ] ) {

		const angle = t * Math.PI;
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'FlipInX', -1, [ track ] );

}

export function flipInYRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 0.8;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );

	const times = [ 0, duration ];
	const values = [];

	for ( const t of [ 0, 1 ] ) {

		const angle = t * Math.PI;
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'FlipInY', -1, [ track ] );

}

/**
 * RotateIn recipe: rotate into view.
 * Params: {angle:90, duration:0.8}
 */
export function rotateInRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const angle = ( params.angle ?? 90 ) * Math.PI / 180;
	const duration = params.duration ?? 0.8;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );

	const times = [ 0, duration ];
	const values = [];

	for ( const t of [ 0, 1 ] ) {

		const a = t * angle;
		tmpQ.setFromAxisAngle( axisVec, a ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'RotateIn', -1, [ track ] );

}

/**
 * FadeOut recipe: fade to transparent.
 * Params: {duration:1}
 * Note: Skips nodes without materials (Groups, etc.).
 */
export function fadeOutRecipe( node, params = {} ) {

	// Skip nodes without materials
	if ( ! node.material ) {

		console.warn( `FadeOut: skipping ${ node.name } (no material)` );
		return null;

	}

	const duration = params.duration ?? 1;
	node.material.transparent = true;
	
	// Ensure opacity is initialized so animation has valid starting point
	if ( node.material.opacity === undefined ) {
		node.material.opacity = 1;
	}

	const times = [ 0, duration ];
	const initialOpacity = node.material.opacity;
	const values = [ initialOpacity, 0 ];

	const track = numberTrack( node.uuid, 'material.opacity', times, values );
	return new THREE.AnimationClip( 'FadeOut', -1, [ track ] );

}

/**
 * ZoomOut recipe: scale down to zero.
 * Params: {scale:0.3, duration:1}
 */
export function zoomOutRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1;

	const times = [ 0, duration ];
	const values = [
		node.scale.x, node.scale.y, node.scale.z,
		0, 0, 0
	];

	const track = vectorTrack( node.uuid, 'scale', times, values );
	return new THREE.AnimationClip( 'ZoomOut', -1, [ track ] );

}

/**
 * SlideOut recipes: move away with 3D depth and rotation.
 */
export function slideOutUpRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startY = node.position.y;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide out: move up and back, with rotation
	const pValues = [
		node.position.x, startY, startZ,  // start: at target
		node.position.x, startY + distance * 0.3, startZ + distance * 0.25,  // mid: moving up and back
		node.position.x, startY + distance, startZ + distance * 0.5  // end: up and far back
	];

	// Add slight X-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 1, 0, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = t * Math.PI * 0.2;  // rotate from 0° to 36°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideOutUp', -1, [ pTrack, rotTrack ] );

}

export function slideOutDownRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startY = node.position.y;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide out: move down and back, with rotation
	const pValues = [
		node.position.x, startY, startZ,  // start: at target
		node.position.x, startY - distance * 0.3, startZ + distance * 0.25,  // mid: moving down and back
		node.position.x, startY - distance, startZ + distance * 0.5  // end: down and far back
	];

	// Add slight X-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 1, 0, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = t * -Math.PI * 0.2;  // rotate from 0° to -36°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideOutDown', -1, [ pTrack, rotTrack ] );

}

export function slideOutLeftRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startX = node.position.x;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide out: move left and back, with rotation
	const pValues = [
		startX, node.position.y, startZ,  // start: at target
		startX - distance * 0.3, node.position.y, startZ + distance * 0.25,  // mid: moving left and back
		startX - distance, node.position.y, startZ + distance * 0.5  // end: left and far back
	];

	// Add slight Y-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = t * -Math.PI * 0.25;  // rotate from 0° to -45°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideOutLeft', -1, [ pTrack, rotTrack ] );

}

export function slideOutRightRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 1;
	const duration = params.duration ?? 0.8;

	const startX = node.position.x;
	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D slide out: move right and back, with rotation
	const pValues = [
		startX, node.position.y, startZ,  // start: at target
		startX + distance * 0.3, node.position.y, startZ + distance * 0.25,  // mid: moving right and back
		startX + distance, node.position.y, startZ + distance * 0.5  // end: right and far back
	];

	// Add slight Y-axis rotation for dynamic 3D effect
	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );
	const rotValues = [];
	for ( const t of [ 0, 0.5, 1 ] ) {
		const angle = t * Math.PI * 0.25;  // rotate from 0° to 45°
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		rotValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );
	}

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const rotTrack = quaternionTrack( node.uuid, times, rotValues );
	return new THREE.AnimationClip( 'SlideOutRight', -1, [ pTrack, rotTrack ] );

}

/**
 * 3D Exit depth animations
 */
export function slideOutForwardRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 2;
	const duration = params.duration ?? 0.8;

	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D depth slide out: shrink and move forward toward camera
	const pValues = [
		node.position.x, node.position.y, startZ,  // start: at target
		node.position.x, node.position.y, startZ - distance * 0.3,  // mid: moving forward
		node.position.x, node.position.y, startZ - distance  // end: very close
	];

	// Scale up as it moves toward camera
	const scaleValues = [
		node.scale.x, node.scale.y, node.scale.z,  // normal at start
		node.scale.x * 1.3, node.scale.y * 1.3, node.scale.z * 1.3,  // larger mid-way
		node.scale.x * 2, node.scale.y * 2, node.scale.z * 2  // very large up close
	];

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const sTrack = vectorTrack( node.uuid, 'scale', times, scaleValues );
	return new THREE.AnimationClip( 'SlideOutForward', -1, [ pTrack, sTrack ] );

}

export function slideOutBackRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const distance = params.distance ?? 2;
	const duration = params.duration ?? 0.8;

	const startZ = node.position.z;
	const times = [ 0, 0.5, duration ];

	// 3D depth slide out: shrink and move far back
	const pValues = [
		node.position.x, node.position.y, startZ,  // start: at target
		node.position.x, node.position.y, startZ + distance * 0.3,  // mid: moving back
		node.position.x, node.position.y, startZ + distance  // end: far away
	];

	// Scale down as it moves away
	const scaleValues = [
		node.scale.x, node.scale.y, node.scale.z,  // full at start
		node.scale.x * 0.7, node.scale.y * 0.7, node.scale.z * 0.7,  // medium mid-way
		node.scale.x * 0.3, node.scale.y * 0.3, node.scale.z * 0.3  // small at distance
	];

	const pTrack = vectorTrack( node.uuid, 'position', times, pValues );
	const sTrack = vectorTrack( node.uuid, 'scale', times, scaleValues );
	return new THREE.AnimationClip( 'SlideOutBack', -1, [ pTrack, sTrack ] );

}

/**
 * BounceOut recipe: scale out with bounce.
 * Params: {duration:1.2}
 */
export function bounceOutRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1.2;

	const times = [ 0, 0.25, 0.5, 0.75, 1.0 ];
	const tVals = times.map( t => t * duration );

	const values = [];
	for ( const t of times ) {

		// Bounce easing: out-bounce curve reversed
		let scale;
		if ( t < 0.15 ) scale = 1.0;
		else if ( t < 0.4 ) scale = 0.95;
		else if ( t < 0.7 ) scale = 0.8;
		else scale = 0.2;

		values.push( node.scale.x * scale, node.scale.y * scale, node.scale.z * scale );

	}

	const track = vectorTrack( node.uuid, 'scale', tVals, values );
	return new THREE.AnimationClip( 'BounceOut', -1, [ track ] );

}

/**
 * FlipOut recipes: rotate out.
 */
export function flipOutXRecipe( node, params = {} ) {

	return flipInXRecipe( node, params ); // Same rotation out effect

}

export function flipOutYRecipe( node, params = {} ) {

	return flipInYRecipe( node, params ); // Same rotation out effect

}

/**
 * RotateOut recipe: rotate away.
 * Params: {angle:90, duration:0.8}
 */
export function rotateOutRecipe( node, params = {} ) {

	return rotateInRecipe( node, params ); // Same rotation effect

}

/**
 * Flash recipe: rapidly toggle opacity.
 * Params: {times:3, duration:1}
 * Note: Skips nodes without materials (Groups, etc.).
 */
export function flashRecipe( node, params = {} ) {

	// Skip nodes without materials
	if ( ! node.material ) {

		console.warn( `Flash: skipping ${ node.name } (no material)` );
		return null;

	}

	const duration = params.duration ?? 1;
	const times = params.times ?? 3;
	node.material.transparent = true;
	
	// Ensure opacity is initialized so animation has valid reference
	if ( node.material.opacity === undefined ) {
		node.material.opacity = 1;
	}

	const initialOpacity = node.material.opacity;
	const steps = times * 2 + 1;
	const keyTimes = [];
	const values = [];

	for ( let i = 0; i <= steps; i ++ ) {

		keyTimes.push( ( i / steps ) * duration );
		values.push( i % 2 === 0 ? initialOpacity : 0 );

	}

	const track = numberTrack( node.uuid, 'material.opacity', keyTimes, values );
	return new THREE.AnimationClip( 'Flash', -1, [ track ] );

}

/**
 * RubberBand recipe: stretchy scale oscillation.
 * Params: {scale:1.3, duration:0.8}
 */
export function rubberBandRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const scale = params.scale ?? 1.3;
	const duration = params.duration ?? 0.8;

	const times = [ 0, 0.2, 0.4, 0.6, 0.8, 1.0 ];
	const tVals = times.map( t => t * duration );

	const values = [];
	for ( const t of times ) {

		let s;
		if ( t < 0.2 ) s = 1.0 + ( scale - 1 ) * ( t / 0.2 );
		else if ( t < 0.4 ) s = scale - ( scale - 1 ) * ( ( t - 0.2 ) / 0.2 );
		else if ( t < 0.6 ) s = 1.0 + ( scale - 1 ) * 0.5 * ( ( t - 0.4 ) / 0.2 );
		else if ( t < 0.8 ) s = 1.0 + ( scale - 1 ) * 0.25 * ( ( t - 0.6 ) / 0.2 );
		else s = 1.0;

		values.push( node.scale.x * s, node.scale.y * s, node.scale.z * s );

	}

	const track = vectorTrack( node.uuid, 'scale', tVals, values );
	return new THREE.AnimationClip( 'RubberBand', -1, [ track ] );

}

/**
 * Jello recipe: wobbly elastic deformation.
 * Params: {intensity:0.05, duration:0.9}
 */
export function jelloRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const intensity = params.intensity ?? 0.05;
	const duration = params.duration ?? 0.9;

	const steps = 8;
	const times = [];
	const xValues = [];
	const yValues = [];
	const zValues = [];

	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		times.push( t * duration );

		const skew = Math.sin( t * Math.PI * 4 ) * intensity;
		xValues.push( node.scale.x * ( 1 + skew ) );
		yValues.push( node.scale.y * ( 1 - skew * 0.5 ) );
		zValues.push( node.scale.z );

	}

	const values = [];
	for ( let i = 0; i <= steps; i ++ ) {

		values.push( xValues[ i ], yValues[ i ], zValues[ i ] );

	}

	const track = vectorTrack( node.uuid, 'scale', times, values );
	return new THREE.AnimationClip( 'Jello', -1, [ track ] );

}

/**
 * HeartBeat recipe: pulse like a heartbeat.
 * Params: {scale:1.1, duration:1.3}
 */
export function heartBeatRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const scale = params.scale ?? 1.1;
	const duration = params.duration ?? 1.3;

	// Heartbeat: quick pulse, pause, quick pulse again
	const times = [ 0, 0.15, 0.3, 0.45, 1.0 ];
	const tVals = times.map( t => t * duration );

	const values = [];
	for ( const t of times ) {

		let s;
		if ( t < 0.15 ) s = 1.0 + ( scale - 1 ) * ( t / 0.15 );
		else if ( t < 0.3 ) s = scale - ( scale - 1 ) * ( ( t - 0.15 ) / 0.15 );
		else if ( t < 0.45 ) s = 1.0 + ( scale - 1 ) * 0.5 * ( ( t - 0.3 ) / 0.15 );
		else s = 1.0;

		values.push( node.scale.x * s, node.scale.y * s, node.scale.z * s );

	}

	const track = vectorTrack( node.uuid, 'scale', tVals, values );
	return new THREE.AnimationClip( 'HeartBeat', -1, [ track ] );

}

/**
 * Tada recipe: spin + scale celebration.
 * Params: {rotations:1, scale:1.1, duration:1}
 */
export function tadaRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const rotations = params.rotations ?? 1;
	const scale = params.scale ?? 1.1;
	const duration = params.duration ?? 1;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );

	const steps = 12;
	const times = [];
	const qValues = [];
	const sValues = [];

	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		times.push( t * duration );

		// Rotation
		const angle = t * rotations * Math.PI * 2;
		tmpQ.setFromAxisAngle( axisVec, angle ).premultiply( baseQ );
		qValues.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

		// Scale pulse
		let s = 1.0 + ( scale - 1 ) * Math.sin( t * Math.PI * 3 ) * 0.5;
		sValues.push( node.scale.x * s, node.scale.y * s, node.scale.z * s );

	}

	const qTrack = quaternionTrack( node.uuid, times, qValues );
	const sTrack = vectorTrack( node.uuid, 'scale', times, sValues );

	return new THREE.AnimationClip( 'Tada', -1, [ qTrack, sTrack ] );

}

/**
 * Wobble recipe: gentle side-to-side sway.
 * Params: {angle:15, duration:1}
 */
export function wobbleRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const angle = ( params.angle ?? 15 ) * Math.PI / 180;
	const duration = params.duration ?? 1;

	const baseQ = node.quaternion.clone();
	const tmpQ = new THREE.Quaternion();
	const axisVec = new THREE.Vector3( 0, 1, 0 );

	const steps = 8;
	const times = [];
	const values = [];

	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		times.push( t * duration );

		// Wobble: sine wave back and forth
		const a = Math.sin( t * Math.PI * 2 ) * angle;
		tmpQ.setFromAxisAngle( axisVec, a ).premultiply( baseQ );
		values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'Wobble', -1, [ track ] );

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

// ── Camera / dolly tweens (absolute-target animations) ────────────────────────

/**
 * FlyTo recipe: animate position from the current pose to an ABSOLUTE point.
 * The animated counterpart of the instant `moveTo` edit — used to author camera
 * (or object) keyframes on the timeline: $S('camera').flyTo(x,y,z,dur).
 * Params: {x, y, z, duration}
 */
export function flyToRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1;

	const sx = node.position.x, sy = node.position.y, sz = node.position.z;
	const tx = params.x ?? sx, ty = params.y ?? sy, tz = params.z ?? sz;

	const times = [ 0, duration ];
	const values = [ sx, sy, sz, tx, ty, tz ];

	const track = vectorTrack( node.uuid, 'position', times, values );
	return new THREE.AnimationClip( 'FlyTo', -1, [ track ] );

}

/**
 * TurnTo recipe: animate rotation from the current pose to an ABSOLUTE Euler
 * orientation (degrees). Winding-safe via slerp sub-division.
 * Params: {x, y, z, duration}
 */
export function turnToRecipe( node, params = {} ) {

	const THREE = window.THREE;
	const duration = params.duration ?? 1;

	const baseQ = node.quaternion.clone();
	const euler = new THREE.Euler(
		THREE.MathUtils.degToRad( params.x ?? 0 ),
		THREE.MathUtils.degToRad( params.y ?? 0 ),
		THREE.MathUtils.degToRad( params.z ?? 0 )
	);
	const targetQ = new THREE.Quaternion().setFromEuler( euler );

	const steps = 4; // ≤90°-ish steps keep the slerp winding-safe
	const times = [];
	const values = [];
	const tmp = new THREE.Quaternion();
	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		times.push( ( duration * i ) / steps );
		tmp.copy( baseQ ).slerp( targetQ, t );
		values.push( tmp.x, tmp.y, tmp.z, tmp.w );

	}

	const track = quaternionTrack( node.uuid, times, values );
	return new THREE.AnimationClip( 'TurnTo', -1, [ track ] );

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

			// Camera / dolly tweens (absolute-target)
			case 'flyTo':
				return flyToRecipe( node, params );
			case 'turnTo':
				return turnToRecipe( node, params );

			// Entrance animations
			case 'fadeIn':
				return fadeInRecipe( node, params );
			case 'zoomIn':
				return zoomInRecipe( node, params );
			case 'slideInUp':
				return slideInUpRecipe( node, params );
			case 'slideInDown':
				return slideInDownRecipe( node, params );
			case 'slideInLeft':
				return slideInLeftRecipe( node, params );
			case 'slideInRight':
				return slideInRightRecipe( node, params );
			case 'slideInForward':
				return slideInForwardRecipe( node, params );
			case 'slideInBack':
				return slideInBackRecipe( node, params );
			case 'bounceIn':
				return bounceInRecipe( node, params );
			case 'flipInX':
				return flipInXRecipe( node, params );
			case 'flipInY':
				return flipInYRecipe( node, params );
		case 'flipInZ':
			return flipInZRecipe( node, params );
		case 'rotateIn':
			return rotateInRecipe( node, params );

		// Exit animations
		case 'fadeOut':
			return fadeOutRecipe( node, params );
		case 'zoomOut':
			return zoomOutRecipe( node, params );
		case 'slideOutUp':
			return slideOutUpRecipe( node, params );
		case 'slideOutDown':
			return slideOutDownRecipe( node, params );
		case 'slideOutLeft':
			return slideOutLeftRecipe( node, params );
		case 'slideOutRight':
			return slideOutRightRecipe( node, params );
		case 'slideOutForward':
			return slideOutForwardRecipe( node, params );
		case 'slideOutBack':
			return slideOutBackRecipe( node, params );
		case 'bounceOut':
			return bounceOutRecipe( node, params );
		case 'flipOutX':
			return flipOutXRecipe( node, params );
		case 'flipOutY':
			return flipOutYRecipe( node, params );
		case 'flipOutZ':
			return flipOutZRecipe( node, params );
			case 'flash':
				return flashRecipe( node, params );
			case 'rubberBand':
				return rubberBandRecipe( node, params );
			case 'jello':
				return jelloRecipe( node, params );
			case 'heartBeat':
				return heartBeatRecipe( node, params );
			case 'tada':
				return tadaRecipe( node, params );
			case 'wobble':
				return wobbleRecipe( node, params );

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
/**
 * Expand Groups to their descendant meshes (used for opacity animations).
 * Returns a flat list of all meshes in the hierarchies.
 */
function expandGroupsToMeshes( nodes ) {

	const result = [];
	const visited = new Set();

	function traverse( node ) {

		if ( visited.has( node ) ) return;
		visited.add( node );

		if ( node.isMesh ) result.push( node );
		else if ( node.isGroup ) {

			for ( const child of node.children ) traverse( child );

		}

	}

	for ( const node of nodes ) traverse( node );
	return result;

}

export function executeRecipeOp( editor, recipeData ) {

	if ( ! editor || ! editor.scene ) return { success: false, message: 'No editor' };

	const err = validateRecipe( recipeData );
	if ( err ) return { success: false, message: `Invalid recipe: ${ err }` };

	const { recipe, selector, params } = recipeData;
	let nodes = selectorEngine.query( editor.scene, selector );

	if ( nodes.length === 0 ) {

		console.warn( `Recipe: selector "${ selector }" matched no nodes` );
		return { success: false, message: 'No nodes matched', count: 0 };

	}

	// ── Auto-show on entrance animations (fadeIn, zoomIn, slideIn*, etc.) ───
	// When an animation shows an object, ensure it's visible first so the
	// animation is actually rendered (not hidden by node.visible = false).
	const ENTRANCE_RECIPES = new Set( [
		'fadeIn', 'zoomIn',
		'slideInUp', 'slideInDown', 'slideInLeft', 'slideInRight',
		'bounceIn',
		'flipInX', 'flipInY',
		'rotateInX', 'rotateInY', 'rotateInZ',
	] );

	// ── Auto-hide on exit animations (fadeOut, zoomOut, slideOut*, etc.) ───
	// Note: We don't auto-hide after the animation completes, because the
	// animation system doesn't have an easy way to hook into completion.
	// Users should chain .hide() after .fadeOut() if they want that behavior.
	const EXIT_RECIPES = new Set( [
		'fadeOut', 'zoomOut',
		'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight',
		'bounceOut',
		'flipOutX', 'flipOutY',
		'rotateOutX', 'rotateOutY', 'rotateOutZ',
	] );

	// ── Opacity-based animations need meshes (Groups can't have opacity) ───
	// For fade/flash recipes, expand Groups to their descendant meshes so
	// we always have nodes that can receive opacity tracks.
	const OPACITY_RECIPES = new Set( [ 'fade', 'fadeIn', 'fadeOut', 'flash' ] );
	if ( OPACITY_RECIPES.has( recipe ) ) {

		nodes = expandGroupsToMeshes( nodes );
		if ( nodes.length === 0 ) {

			return { success: false, message: 'No meshes found (Groups have no materials)', count: 0 };

		}

	}

	// Auto-show before entrance animations
	if ( ENTRANCE_RECIPES.has( recipe ) ) {

		for ( const node of nodes ) {

			if ( ! node.visible ) {

				node.visible = true;

			}

			// For fadeIn, also reset opacity to 1 so the animation has a proper target.
			// If opacity is already 0 from a previous fadeOut, fadeIn would animate 0→0 (no-op).
			if ( recipe === 'fadeIn' && node.material ) {

				node.material.opacity = 1;

			}

		}

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
