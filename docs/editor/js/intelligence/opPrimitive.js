// ── opPrimitive.js ──────────────────────────────────────────────────────────────
// THE op-JSON contract — ONE schema, four consumers (model tool-list / decoding
// grammar, MCP tools, op() dispatcher, human $S sugar).
//
// op-JSON shape:  { type: <op>, selector: <css-like>, ...typed args }
// Closed op set:  recolor scale move rotate delete duplicate retexture setMaterial
//                 spin bounce pulse fade orbit shake raw
//                 [NEW] fadeIn zoomIn slideIn* bounceIn flipIn* rotateIn
//                 [NEW] fadeOut zoomOut slideOut* bounceOut flipOut* rotateOut
//                 [NEW] flash rubberBand jello heartBeat tada wobble
// Escape hatch:   { type:'raw', selector, code }  ← raw JS as ONE op type
//
// Non-negotiables honored:
//   - One execution surface: every op → editor.execute(Command) → undo stack.
//   - Model expresses intent; host enforces correctness (guards live here).
//   - Resolution is deterministic (selectorEngine; model only NL→selector).
//   - Everything returns the set (chainable, jQuery PATTERN — not the lib).

import * as selectorEngine from './selectorEngine.js';
import { selectorCounts } from './vocabInjection.js';
import {
	recolorOp, scaleOp, moveOp, rotateOp, deleteOp, duplicateOp, setMaterialOp,
	bulkApply, setObjectPropOp, setMaterialPropOp, setMaterialColorOp,
	setLightPropOp, setLightColorOp, setCameraPropOp,
} from './editOps.js';
import { executeRecipeOp } from './animationRecipes.js';
import { TimelineModel } from './timeline.js';
import { SetTimelineCommand } from '../commands/SetTimelineCommand.js';
import { SetClassCommand } from '../commands/SetClassCommand.js';
import { SetLabelCommand } from '../commands/SetLabelCommand.js';
import { MultiCmdsCommand } from '../commands/MultiCmdsCommand.js';
import { SetPositionCommand } from '../commands/SetPositionCommand.js';
import { SetRotationCommand } from '../commands/SetRotationCommand.js';
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { hasClass, normalizeClassName, toClassSet } from './classDerive.js';

// ── The single op vocabulary definition ──────────────────────────────────────
// Drives: model tool-list, decoding grammar, dispatcher, and human sugar.
// Each entry: args (typed arg names), kind (edit|anim|raw), summary.

export const OP_VOCABULARY = {
	// ── Edit ops (command-backed, guarded) ──
	recolor:     { kind: 'edit', args: { color: 'color' },                          summary: 'set base color (tints if textured)' },
	scale:       { kind: 'edit', args: { factor: 'number', axis: 'axis?' },         summary: 'scale uniformly or on one axis' },
	move:        { kind: 'edit', args: { dx: 'number', dy: 'number', dz: 'number' }, summary: 'translate by offset (grounded y>=0)' },
	rotate:      { kind: 'edit', args: { axis: 'axis', degrees: 'number' },         summary: '⚠️  INSTANT rotation ONLY (NOT animated) — never use for "animate" requests. For animation, use addSpinClip() instead.' },
	delete:      { kind: 'edit', args: {},                                          summary: 'remove nodes (merged-mesh parts fail gracefully)' },
	duplicate:   { kind: 'edit', args: { dx: 'number', dy: 'number', dz: 'number' }, summary: 'clone with offset' },
	retexture:   { kind: 'edit', args: { texture: 'string' },                       summary: 'apply a named/procedural texture map' },
	setMaterial: { kind: 'edit', args: { props: 'object' },                         summary: 'replace material with props' },
	setOpacity:  { kind: 'edit', args: { value: 'number' },                         summary: 'set transparency (0–1)' },
	setVisible:  { kind: 'edit', args: { visible: 'boolean' },                      summary: 'set visibility' },
	wireframe:   { kind: 'edit', args: { wireframe: 'boolean' },                    summary: 'toggle wireframe render mode' },
	moveTo:      { kind: 'edit', args: { x: 'number', y: 'number', z: 'number' },  summary: 'set absolute world position' },
	rotateTo:    { kind: 'edit', args: { x: 'number', y: 'number', z: 'number' },  summary: 'set absolute rotation (Euler in degrees)' },
	scaleTo:     { kind: 'edit', args: { factor: 'number' },                        summary: 'set absolute uniform scale' },
	reset:       { kind: 'edit', args: {},                                          summary: 'restore to original transform' },
	lookAt:      { kind: 'edit', args: { target: 'vector3|string' },               summary: 'orient toward a point or object' },

	// ── Bulk property setters (fan out over the whole set; ONE undoable batch) ──
	// Named to match three.js property names (the dense prior the model knows).
	castShadow:       { kind: 'edit', args: { value: 'boolean' },   summary: 'per-mesh/light shadow casting on/off (bulk)' },
	receiveShadow:    { kind: 'edit', args: { value: 'boolean' },   summary: 'per-mesh shadow receiving on/off (bulk)' },
	frustumCulled:    { kind: 'edit', args: { value: 'boolean' },   summary: 'per-mesh frustum culling on/off (bulk)' },
	renderOrder:      { kind: 'edit', args: { value: 'number' },    summary: 'per-mesh render order (transparency sort fixes)' },
	flatShading:      { kind: 'edit', args: { value: 'boolean' },   summary: 'material flat vs smooth shading (bulk, clone-on-write)' },
	metalness:        { kind: 'edit', args: { value: 'number' },    summary: 'material metalness 0–1 (bulk, clone-on-write)' },
	roughness:        { kind: 'edit', args: { value: 'number' },    summary: 'material roughness 0–1 (bulk, clone-on-write)' },
	emissive:         { kind: 'edit', args: { color: 'color' },     summary: 'material emissive color (bulk, clone-on-write)' },
	emissiveIntensity:{ kind: 'edit', args: { value: 'number' },    summary: 'material emissive intensity (bulk, clone-on-write)' },
	doubleSided:      { kind: 'edit', args: { value: 'boolean' },   summary: 'material side: double vs front (bulk, clone-on-write)' },
	intensity:        { kind: 'edit', args: { value: 'number' },    summary: 'light intensity (bulk)' },
	lightColor:       { kind: 'edit', args: { color: 'color' },     summary: 'light color (bulk)' },
	groundColor:      { kind: 'edit', args: { color: 'color' },     summary: 'hemisphere-light ground color (bulk)' },
	distance:         { kind: 'edit', args: { value: 'number' },    summary: 'point/spot light distance (bulk)' },
	angle:            { kind: 'edit', args: { value: 'number' },    summary: 'spot-light cone angle in radians (bulk)' },
	penumbra:         { kind: 'edit', args: { value: 'number' },    summary: 'spot-light penumbra 0–1 (bulk)' },
	decay:            { kind: 'edit', args: { value: 'number' },    summary: 'point/spot light decay (bulk)' },
	fov:              { kind: 'edit', args: { value: 'number' },    summary: 'perspective camera field of view in degrees' },
	near:             { kind: 'edit', args: { value: 'number' },    summary: 'camera near clip plane' },
	far:              { kind: 'edit', args: { value: 'number' },    summary: 'camera far clip plane' },

	// ── Animation recipe ops (deterministic winding-safe keyframes) ──
	spin:        { kind: 'anim', args: { axis: 'axis?', turns: 'number?', duration: 'number?' },        summary: 'continuous rotation (winding-safe)' },
	bounce:      { kind: 'anim', args: { height: 'number?', duration: 'number?' },                      summary: 'oscillate up/down' },
	pulse:       { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                       summary: 'scale up/down' },
	fade:        { kind: 'anim', args: { from: 'number?', to: 'number?', duration: 'number?' },         summary: 'opacity transition' },
	orbit:       { kind: 'anim', args: { center: 'vec3?', radius: 'number?', duration: 'number?' },     summary: 'circular motion around a point' },
	shake:       { kind: 'anim', args: { intensity: 'number?', duration: 'number?' },                   summary: 'jittery motion' },

	// ── Absolute-target tweens (camera dolly / object move over time) ──
	flyTo:       { kind: 'anim', args: { x: 'number?', y: 'number?', z: 'number?', duration: 'number?' }, summary: 'animate to an absolute position (the animated moveTo; camera/object dolly)' },
	turnTo:      { kind: 'anim', args: { x: 'number?', y: 'number?', z: 'number?', duration: 'number?' }, summary: 'animate to an absolute rotation (Euler degrees; the animated rotateTo)' },

	// ── Entrance animations (appear with style) ──
	fadeIn:        { kind: 'anim', args: { duration: 'number?' },                                         summary: 'fade in from transparent' },
	zoomIn:        { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'scale from zero to full size' },
	slideInUp:     { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from below with 3D rotation' },
	slideInDown:   { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from above with 3D rotation' },
	slideInLeft:   { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from left with 3D rotation' },
	slideInRight:  { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from right with 3D rotation' },
	slideInForward:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: '3D: zoom in from far back' },
	slideInBack:   { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: '3D: zoom out to far back' },
	bounceIn:      { kind: 'anim', args: { duration: 'number?' },                                         summary: 'scale in with bounce' },
	flipInX:       { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate in around X-axis' },
	flipInY:       { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate in around Y-axis' },
	flipInZ:       { kind: 'anim', args: { duration: 'number?' },                                         summary: '3D: flip/spin around Z-axis' },
	rotateIn:      { kind: 'anim', args: { angle: 'number?', duration: 'number?' },                      summary: 'rotate in place' },

	// ── Exit animations (disappear with style) ──
	fadeOut:       { kind: 'anim', args: { duration: 'number?' },                                         summary: 'fade out to transparent' },
	zoomOut:       { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'scale from full size to zero' },
	slideOutUp:    { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out upward with 3D rotation' },
	slideOutDown:  { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out downward with 3D rotation' },
	slideOutLeft:  { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out to left with 3D rotation' },
	slideOutRight: { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out to right with 3D rotation' },
	slideOutForward:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                  summary: '3D: zoom out toward camera' },
	slideOutBack:  { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: '3D: zoom out to far back' },
	bounceOut:     { kind: 'anim', args: { duration: 'number?' },                                         summary: 'scale out with bounce' },
	flipOutX:      { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate out around X-axis' },
	flipOutY:      { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate out around Y-axis' },
	flipOutZ:      { kind: 'anim', args: { duration: 'number?' },                                         summary: '3D: flip/spin out around Z-axis' },
	rotateOut:     { kind: 'anim', args: { angle: 'number?', duration: 'number?' },                      summary: 'rotate out of place' },

	// ── Attention seekers (grab focus on objects) ──
	flash:       { kind: 'anim', args: { times: 'number?', duration: 'number?' },                      summary: 'rapidly toggle opacity' },
	rubberBand:  { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'stretchy scale oscillation' },
	jello:       { kind: 'anim', args: { intensity: 'number?', duration: 'number?' },                  summary: 'wobbly elastic deformation' },
	heartBeat:   { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'pulse like a heartbeat' },
	tada:        { kind: 'anim', args: { rotations: 'number?', scale: 'number?', duration: 'number?' }, summary: 'spin + scale celebration' },
	wobble:      { kind: 'anim', args: { angle: 'number?', duration: 'number?' },                      summary: 'gentle side-to-side sway' },

	// ── Escape hatch ──
	raw:         { kind: 'raw',  args: { code: 'string' },                          summary: 'raw JS (loop-protected, UNGUARDED) — last resort' },
};

// Ops that are animation recipes (delegate to executeRecipeOp).
const ANIM_OPS = new Set( Object.keys( OP_VOCABULARY ).filter( k => OP_VOCABULARY[ k ].kind === 'anim' ) );
// Ops that are edits (delegate to editOps with {op,selector,args} shape).
const EDIT_OPS = new Set( Object.keys( OP_VOCABULARY ).filter( k => OP_VOCABULARY[ k ].kind === 'edit' ) );

export const OP_TYPES = Object.keys( OP_VOCABULARY );

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate an op-JSON object against the vocabulary.
 * @param {object} opJSON  { type, selector, ...args }
 * @returns {string|null}  error message or null if valid
 */
export function validateOpJSON( opJSON ) {

	if ( ! opJSON || typeof opJSON !== 'object' ) return 'op must be an object';
	if ( typeof opJSON.type !== 'string' ) return 'op.type must be a string';
	if ( ! OP_VOCABULARY[ opJSON.type ] ) {

		return `op.type "${ opJSON.type }" not in closed set: ${ OP_TYPES.join( ', ' ) }`;

	}
	if ( typeof opJSON.selector !== 'string' ) return 'op.selector must be a string';
	// raw allows any selector context (even empty for global); others must parse.
	if ( opJSON.type !== 'raw' && ! selectorEngine.isValid( opJSON.selector ) ) {

		return `op.selector "${ opJSON.selector }" is not valid selector syntax`;

	}
	if ( opJSON.type === 'raw' && typeof opJSON.code !== 'string' ) {

		return 'raw op requires a "code" string';

	}
	return null;

}

// ── raw escape hatch (loop-protected, unguarded) ──────────────────────────────

const RAW_LOOP_GUARD = /\b(while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)|requestAnimationFrame)\b/;

/**
 * Execute a raw-JS op. UNGUARDED by design (escape hatch) but loop-protected.
 * The code runs with `nodes` (resolved set) and `editor` in scope.
 * @param {Editor} editor
 * @param {Array} nodes  resolved selector set
 * @param {string} code
 * @returns {object}  { success, message? }
 */
function executeRaw( editor, nodes, code ) {

	if ( typeof code !== 'string' || ! code.trim() ) return { success: false, message: 'raw: empty code' };
	if ( RAW_LOOP_GUARD.test( code ) ) {

		return { success: false, message: 'raw: infinite loops / rAF forbidden (Strata authors scenes, not runtimes)' };

	}

	try {

		// nodes + editor + THREE in scope; no `this`.
		const fn = new Function( 'editor', 'nodes', 'THREE', code );
		fn( editor, nodes, window.THREE );
		return { success: true };

	} catch ( e ) {

		return { success: false, message: `raw error: ${ e.message }` };

	}

}

// ── "Subset named but all changed" guard (never silently wrong) ───────────────

/**
 * If a NAMED subset selector (#id / .class) resolves to EVERY mesh in the scene,
 * that is almost certainly wrong resolution (e.g. ".wheel" hitting all 12 meshes
 * of a dumptruck). Return a warning so the op is flagged, not silently ✓'d.
 * Broad selectors ("*", bare type like "mesh") are intentional and never flagged.
 * @returns {string|null}
 */
function subsetSanityWarning( editor, type, selector ) {

	if ( type === 'raw' || typeof selector !== 'string' ) return null;
	if ( ! selectorEngine.hasNamedMatcher( selector ) ) return null;

	const matched = selectorEngine.query( editor.scene, selector );
	const matchedMesh = matched.filter( n => n.isMesh ).length;
	if ( matchedMesh < 2 ) return null;

	let totalMesh = 0;
	editor.scene.traverse( n => { if ( n.isMesh ) totalMesh ++; } );

	if ( totalMesh > 1 && matchedMesh === totalMesh ) {

		return `selector "${ selector }" matched ALL ${ totalMesh } meshes — a named part selector that hits everything is likely a wrong resolution (flagged, not a silent success).`;

	}
	return null;

}

// ── The op() dispatcher (the primitive) ───────────────────────────────────────

/**
 * Execute a single op-JSON. Resolves the selector deterministically, then routes
 * to the guarded edit op / animation recipe / raw hatch. Command-backed.
 *
 * @param {Editor} editor
 * @param {object} opJSON  { type, selector, ...args }
 * @returns {object}  { success, message?, count?, nodes? }
 */
export function op( editor, opJSON ) {

	if ( ! editor || ! editor.scene ) return { success: false, message: 'no editor' };

	const err = validateOpJSON( opJSON );
	if ( err ) return { success: false, message: `invalid op: ${ err }` };

	const { type, selector } = opJSON;

	// ── raw: resolve (best-effort) then run unguarded code ──
	if ( type === 'raw' ) {

		const nodes = selector ? selectorEngine.query( editor.scene, selector ) : [];
		return executeRaw( editor, nodes, opJSON.code );

	}

	// Never-silently-wrong: flag (don't block) a named subset that hit everything.
	const flag = subsetSanityWarning( editor, type, selector );
	const withFlag = ( result ) => {

		if ( ! flag || ! result ) return result;
		result.flagged = true;
		result.message = result.message ? `${ flag } ${ result.message }` : flag;
		return result;

	};

	// ── animation recipe ops ──
	if ( ANIM_OPS.has( type ) ) {

		// Flatten {type, selector, ...params} → {recipe, selector, params}.
		const { type: _t, selector: _s, ...params } = opJSON;
		return withFlag( executeRecipeOp( editor, { recipe: type, selector, params } ) );

	}

	// ── edit ops (delegate to editOps with explicit args) ──
	if ( EDIT_OPS.has( type ) ) {

		// ⚠️  FIX 1: RUNTIME VALIDATION — Catch animation misuse of rotate
		// If rotate is used with animation-like parameters, fail immediately with guidance
		if ( type === 'rotate' && ( opJSON.seconds !== undefined || opJSON.duration !== undefined ) ) {

			return {
				success: false,
				message: '❌ ops({type:"rotate",...}) is INSTANT, not animation. Use addSpinClip(findObject("..."), {axis:"x", turns:1, seconds:2}) instead.',
				animated: true,
			};

		}

		switch ( type ) {

			case 'recolor':     return withFlag( recolorOp( editor, selector, opJSON.color ) );
			case 'scale':       return withFlag( scaleOp( editor, selector, opJSON.factor, opJSON.axis ) );
			case 'move':        return withFlag( moveOp( editor, selector, opJSON.dx, opJSON.dy, opJSON.dz ) );
			case 'rotate':      return withFlag( rotateOp( editor, selector, opJSON.axis, opJSON.degrees ) );
			case 'delete':      return withFlag( deleteOp( editor, selector ) );
			case 'duplicate':   return withFlag( duplicateOp( editor, selector, opJSON.dx, opJSON.dy, opJSON.dz ) );
			case 'setMaterial': return withFlag( setMaterialOp( editor, selector, opJSON.props ) );
			case 'retexture':   return withFlag( setMaterialOp( editor, selector, { map: opJSON.texture } ) );

			// ── Bulk property setters (fan-out over the whole set, one undo batch) ──
			case 'castShadow':        return withFlag( setObjectPropOp( editor, selector, 'castShadow', Boolean( opJSON.value ), n => n.isMesh || n.isLight ) );
			case 'receiveShadow':     return withFlag( setObjectPropOp( editor, selector, 'receiveShadow', Boolean( opJSON.value ), n => n.isMesh ) );
			case 'frustumCulled':     return withFlag( setObjectPropOp( editor, selector, 'frustumCulled', Boolean( opJSON.value ), n => n.isMesh ) );
			case 'renderOrder':       return withFlag( setObjectPropOp( editor, selector, 'renderOrder', Number( opJSON.value ) || 0, n => n.isMesh ) );
			case 'flatShading':       return withFlag( setMaterialPropOp( editor, selector, 'flatShading', Boolean( opJSON.value ) ) );
			case 'metalness':         return withFlag( setMaterialPropOp( editor, selector, 'metalness', Number( opJSON.value ) ) );
			case 'roughness':         return withFlag( setMaterialPropOp( editor, selector, 'roughness', Number( opJSON.value ) ) );
			case 'emissiveIntensity': return withFlag( setMaterialPropOp( editor, selector, 'emissiveIntensity', Number( opJSON.value ) ) );
			case 'doubleSided':       return withFlag( setMaterialPropOp( editor, selector, 'side', Boolean( opJSON.value ) ? 2 : 0 ) );
			case 'emissive':          return withFlag( setMaterialColorOp( editor, selector, 'emissive', opJSON.color ) );
			case 'intensity':         return withFlag( setLightPropOp( editor, selector, 'intensity', Number( opJSON.value ) ) );
			case 'distance':          return withFlag( setLightPropOp( editor, selector, 'distance', Number( opJSON.value ) ) );
			case 'angle':             return withFlag( setLightPropOp( editor, selector, 'angle', Number( opJSON.value ) ) );
			case 'penumbra':          return withFlag( setLightPropOp( editor, selector, 'penumbra', Number( opJSON.value ) ) );
			case 'decay':             return withFlag( setLightPropOp( editor, selector, 'decay', Number( opJSON.value ) ) );
			case 'lightColor':        return withFlag( setLightColorOp( editor, selector, 'color', opJSON.color ) );
			case 'groundColor':       return withFlag( setLightColorOp( editor, selector, 'groundColor', opJSON.color ) );
			case 'fov':               return withFlag( setCameraPropOp( editor, selector, 'fov', Number( opJSON.value ) ) );
			case 'near':              return withFlag( setCameraPropOp( editor, selector, 'near', Number( opJSON.value ) ) );
			case 'far':               return withFlag( setCameraPropOp( editor, selector, 'far', Number( opJSON.value ) ) );

			default:            return { success: false, message: `unhandled edit op: ${ type }` };

		}

	}

	return { success: false, message: `unhandled op type: ${ type }` };

}

/**
 * Execute many ops in sequence (multi-op decomposition result).
 * @param {Editor} editor
 * @param {Array<object>} ops
 * @returns {Array<object>}  per-op results
 */
export function ops( editor, opList ) {

	if ( ! Array.isArray( opList ) ) return [ op( editor, opList ) ];
	return opList.map( o => op( editor, o ) );

}

// ── $S chainable set (jQuery PATTERN; methods are 3D ops) ─────────────────────

class ChainableSet {

	constructor( editor, selectorOrNodes ) {

		this.editor = editor;
		if ( Array.isArray( selectorOrNodes ) ) {

			this.selector = '*';
			this.nodes = selectorOrNodes;

		} else {

			this.selector = String( selectorOrNodes );
			this.nodes = selectorEngine.query( editor.scene, this.selector );

			// `:lasso` / `:selected` (and the bare forms) resolve to the CURRENT
			// editor selection — i.e. whatever the interactive lasso / click select
			// last produced. This is how the mouse-driven lasso is addressable from
			// the shell: $S(':lasso').recolor('#f00').
			if ( this.nodes.length === 0 && /^:?(lasso|selected)$/i.test( this.selector ) && typeof editor.getSelectedObjects === 'function' ) {

				this.nodes = editor.getSelectedObjects().filter( o => o && o !== editor.scene && o !== editor.camera );

			}

			// The viewport camera is $S-addressable but lives outside the scene
			// graph — resolve `camera`/`#camera` to it so it's a real, non-empty set.
			if ( this.nodes.length === 0 && /^#?camera$/i.test( this.selector ) && editor.camera ) {

				this.nodes = [ editor.camera ];

			}

			// Track when selector matches no nodes
			if ( this.nodes.length === 0 && this.selector !== '*' ) {
				this._noMatchWarning = `⚠️ No parts matched selector '${ this.selector }'`;
				console.warn( this._noMatchWarning );
			}

		}

	}

	get length() { return this.nodes.length; }

	/** The op primitive over THIS set's selector. Returns the set (chainable). */
	op( partialOpJSON ) {

		// ── Animation ops author the UNIVERSAL TIMELINE (the "op-JSON of time") ──
		// Every anim op becomes an absolute-time event on the scene-wide clock; the
		// sugar (.then/.with/.at cursor) assigns the absolute `at`. A lone anim op
		// is simply a one-event chain at t=0 — same visible result as before, but
		// now stored as the versionable, exportable absolute representation. These
		// are recorded by SELECTOR STRING (resolved at compile time), so scene-wide
		// addressables that live outside the graph — e.g. the camera — still record
		// even when the live set is empty.
		if ( ANIM_OPS.has( partialOpJSON.type ) ) {

			return this._recordAnim( partialOpJSON );

		}

		// Warn and skip operation if selector matched no nodes
		if ( this.nodes.length === 0 ) {
			if ( this._noMatchWarning ) {
				console.warn( this._noMatchWarning );
			}
			return this; // return self, don't execute
		}

		const opJSON = { selector: this.selector, ...partialOpJSON };
		const result = op( this.editor, opJSON );
		this._last = result;
		return this; // chainable

	}

	// ── Timeline authoring cursor (.then / .with / .at compile to absolute) ──────

	_ensureChain() {

		if ( ! this._chain ) {

			this._chain = { cursor: 0, prevAt: 0, prevDur: 0, parallelNext: false, started: false };

		}

		return this._chain;

	}

	/** Duration this anim op occupies on the clock (drives block width + `dur`). */
	_animDuration( opJSON ) {

		const d = opJSON.duration ?? opJSON.dur;
		const n = Number( d );
		return Number.isFinite( n ) && n >= 0 ? n : 1;

	}

	/**
	 * Record an anim op as an absolute-time timeline event, command-backed so the
	 * edit is undoable and the scene-wide clip recompiles live.
	 */
	_recordAnim( partialOpJSON ) {

		const c = this._ensureChain();
		const dur = this._animDuration( partialOpJSON );
		const at = ( c.parallelNext && c.started ) ? c.prevAt : c.cursor;

		const { type, ...rest } = partialOpJSON;
		delete rest.selector;

		const model = TimelineModel.fromJSON( this.editor.timeline ? this.editor.timeline.toJSON() : null );
		model.addEvent( this.selector, { at, op: type, args: rest, dur } );
		this.editor.execute( new SetTimelineCommand( this.editor, model.toJSON(), `Timeline: ${ type } ${ this.selector }` ) );

		// Advance cursor state: a bare following op stays parallel until .then().
		c.prevAt = at;
		c.prevDur = dur;
		c.cursor = at;
		c.parallelNext = false;
		c.started = true;
		this._last = { success: true, at, dur, op: type };
		return this;

	}

	/** Next op starts when the previous ENDS (+ optional gap seconds). Chainable. */
	then( gap = 0 ) {

		const c = this._ensureChain();
		c.cursor = c.prevAt + c.prevDur + ( Number( gap ) || 0 );
		c.parallelNext = false;
		return this;

	}

	/** Next op starts at the SAME absolute time as the previous (parallel). */
	with() {

		this._ensureChain().parallelNext = true;
		return this;

	}


	/** Prevent dumping entire scene when stringified (for console logging). */
	toJSON() {
		return {
			_type: 'ChainableSet',
			selector: this.selector,
			matchCount: this.nodes.length,
			warning: this._noMatchWarning || undefined
		};
	}

	// ── Named-method sugar (thin wrappers over .op()) ──
	recolor( color )                    { return this.op( { type: 'recolor', color } ); }
	move( dx = 0, dy = 0, dz = 0 )      { return this.op( { type: 'move', dx, dy, dz } ); }
	rotate( axis = 'y', degrees = 90 )  { return this.op( { type: 'rotate', axis, degrees } ); }
	delete()                            { return this.op( { type: 'delete' } ); }
	duplicate( dx = 0, dy = 0, dz = 0 ) { return this.op( { type: 'duplicate', dx, dy, dz } ); }
	retexture( texture )                { return this.op( { type: 'retexture', texture } ); }
	setMaterial( props )                { return this.op( { type: 'setMaterial', props } ); }

	// ── Bulk property setters (jQuery `.css()` mechanic) ────────────────────────
	// One value fanned out over the whole set as ONE undoable batch. Named to
	// match three.js property names directly (.castShadow, .metalness, .fov, …).
	// Material sets clone-on-write. All delegate to the same .op() → editOps path.
	castShadow( on = true )        { return this.op( { type: 'castShadow', value: !! on } ); }
	receiveShadow( on = true )     { return this.op( { type: 'receiveShadow', value: !! on } ); }
	frustumCulled( on = true )     { return this.op( { type: 'frustumCulled', value: !! on } ); }
	renderOrder( n = 0 )           { return this.op( { type: 'renderOrder', value: Number( n ) || 0 } ); }
	flatShading( on = true )       { return this.op( { type: 'flatShading', value: !! on } ); }
	metalness( v )                 { return this.op( { type: 'metalness', value: Number( v ) } ); }
	roughness( v )                 { return this.op( { type: 'roughness', value: Number( v ) } ); }
	emissive( color )              { return this.op( { type: 'emissive', color } ); }
	emissiveIntensity( v )         { return this.op( { type: 'emissiveIntensity', value: Number( v ) } ); }
	doubleSided( on = true )       { return this.op( { type: 'doubleSided', value: !! on } ); }
	setColor( color )              { return this.recolor( color ); }
	intensity( v )                 { return this.op( { type: 'intensity', value: Number( v ) } ); }
	lightColor( color )            { return this.op( { type: 'lightColor', color } ); }
	groundColor( color )           { return this.op( { type: 'groundColor', color } ); }
	distance( v )                  { return this.op( { type: 'distance', value: Number( v ) } ); }
	angle( v )                     { return this.op( { type: 'angle', value: Number( v ) } ); }
	penumbra( v )                  { return this.op( { type: 'penumbra', value: Number( v ) } ); }
	decay( v )                     { return this.op( { type: 'decay', value: Number( v ) } ); }
	fov( v )                       { return this.op( { type: 'fov', value: Number( v ) } ); }
	near( v )                      { return this.op( { type: 'near', value: Number( v ) } ); }
	far( v )                       { return this.op( { type: 'far', value: Number( v ) } ); }

	/**
	 * The raw fan-out primitive, exposed for power-users. Runs `factory(node)`
	 * (returns a Command | Command[] | null) over every matched node (optionally
	 * expanded to descendants via `pred`) and commits ONE undoable batch.
	 * `$S('*').bulkSet(n => new SetValueCommand(editor, n, 'renderOrder', 1), x => x.isMesh)`
	 */
	bulkSet( factory, pred = null ) {
		const targets = pred ? this._collect( pred ) : this.nodes;
		this._last = bulkApply( this.editor, targets, factory );
		return this;
	}

	/** Collect matched nodes + descendants satisfying `pred`, de-duplicated. */
	_collect( pred ) {
		const out = [];
		const seen = new Set();
		for ( const root of this.nodes ) {
			root.traverse( n => { if ( pred( n ) && ! seen.has( n ) ) { seen.add( n ); out.push( n ); } } );
		}
		return out;
	}

	// ── Semantic class / id authoring (jQuery-style, command-backed, chainable) ──
	// Classes (→ .foo) and ids (→ #foo) drive selector resolution AND the injected
	// ADDRESSABLE PARTS list, so tagging here makes the set addressable next time.
	// Every mutation goes through a Command (undoable) and batches into ONE undo.

	/** Add a semantic class to every node in the set. `$S(':selected').addClass('wheel')` */
	addClass( cls ) { return this._classCmd( cls, () => true ); }

	/** Remove a semantic class from every node in the set. */
	removeClass( cls ) { return this._classCmd( cls, () => false ); }

	/**
	 * Toggle a class per node. Pass `force` to set an explicit state on all nodes
	 * (true = add, false = remove), mirroring DOM `classList.toggle`.
	 */
	toggleClass( cls, force ) {
		const decide = ( typeof force === 'boolean' )
			? () => force
			: ( node ) => ! hasClass( node, normalizeClassName( cls ) );
		return this._classCmd( cls, decide );
	}

	/** Internal: build one batched, undoable class-mutation command over the set. */
	_classCmd( cls, decide ) {
		const name = typeof cls === 'string' ? normalizeClassName( cls ) : '';
		if ( ! name || this.nodes.length === 0 ) return this;
		const cmds = this.nodes.map( n => new SetClassCommand( this.editor, n, name, !! decide( n ) ) );
		this.editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( this.editor, cmds ) );
		return this;
	}

	/** Set the semantic id (→ #id / userData.label) on every node in the set. */
	editID( newId ) {
		const label = typeof newId === 'string' ? newId.trim() : '';
		if ( ! label || this.nodes.length === 0 ) return this;
		const cmds = this.nodes.map( n => new SetLabelCommand( this.editor, n, label ) );
		this.editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( this.editor, cmds ) );
		return this;
	}

	bounce( height = 0.5, duration = 1 )        { return this.op( { type: 'bounce', height, duration } ); }
	pulse( scale = 1.2, duration = 1 )          { return this.op( { type: 'pulse', scale, duration } ); }
	fade( from = 1, to = 0, duration = 1 )      { return this.op( { type: 'fade', from, to, duration } ); }
	orbit( center = [ 0, 0, 0 ], radius = 2, duration = 4 ) { return this.op( { type: 'orbit', center, radius, duration } ); }
	shake( intensity = 0.1, duration = 1 )      { return this.op( { type: 'shake', intensity, duration } ); }

	// ── Absolute-target tweens (animated moveTo/rotateTo — camera dolly) ──
	flyTo( x, y, z, duration = 1 )   { return this.op( { type: 'flyTo', x, y, z, duration } ); }
	turnTo( x, y, z, duration = 1 )  { return this.op( { type: 'turnTo', x, y, z, duration } ); }

	// ── Entrance animations ──
	fadeIn( duration = 1 )                               { return this.op( { type: 'fadeIn', duration } ); }
	zoomIn( scale = 1.5, duration = 1 )                  { return this.op( { type: 'zoomIn', scale, duration } ); }
	slideInUp( distance = 1, duration = 0.8 )            { return this.op( { type: 'slideInUp', distance, duration } ); }
	slideInDown( distance = 1, duration = 0.8 )          { return this.op( { type: 'slideInDown', distance, duration } ); }
	slideInLeft( distance = 1, duration = 0.8 )          { return this.op( { type: 'slideInLeft', distance, duration } ); }
	slideInRight( distance = 1, duration = 0.8 )         { return this.op( { type: 'slideInRight', distance, duration } ); }
	slideInForward( distance = 2, duration = 0.8 )       { return this.op( { type: 'slideInForward', distance, duration } ); }
	slideInBack( distance = 2, duration = 0.8 )          { return this.op( { type: 'slideInBack', distance, duration } ); }
	bounceIn( duration = 1.2 )                           { return this.op( { type: 'bounceIn', duration } ); }
	flipInX( duration = 0.8 )                            { return this.op( { type: 'flipInX', duration } ); }
	flipInY( duration = 0.8 )                            { return this.op( { type: 'flipInY', duration } ); }
	flipInZ( duration = 0.8 )                            { return this.op( { type: 'flipInZ', duration } ); }
	rotateIn( angle = 90, duration = 0.8 )               { return this.op( { type: 'rotateIn', angle, duration } ); }

	// ── Exit animations ──
	fadeOut( duration = 1 )                            { return this.op( { type: 'fadeOut', duration } ); }
	zoomOut( scale = 0.3, duration = 1 )               { return this.op( { type: 'zoomOut', scale, duration } ); }
	slideOutUp( distance = 1, duration = 0.8 )         { return this.op( { type: 'slideOutUp', distance, duration } ); }
	slideOutDown( distance = 1, duration = 0.8 )       { return this.op( { type: 'slideOutDown', distance, duration } ); }
	slideOutLeft( distance = 1, duration = 0.8 )       { return this.op( { type: 'slideOutLeft', distance, duration } ); }
	slideOutRight( distance = 1, duration = 0.8 )      { return this.op( { type: 'slideOutRight', distance, duration } ); }
	slideOutForward( distance = 2, duration = 0.8 )    { return this.op( { type: 'slideOutForward', distance, duration } ); }
	slideOutBack( distance = 2, duration = 0.8 )       { return this.op( { type: 'slideOutBack', distance, duration } ); }
	bounceOut( duration = 1.2 )                        { return this.op( { type: 'bounceOut', duration } ); }
	flipOutX( duration = 0.8 )                         { return this.op( { type: 'flipOutX', duration } ); }
	flipOutY( duration = 0.8 )                         { return this.op( { type: 'flipOutY', duration } ); }
	flipOutZ( duration = 0.8 )                         { return this.op( { type: 'flipOutZ', duration } ); }
	rotateOut( angle = 90, duration = 0.8 )            { return this.op( { type: 'rotateOut', angle, duration } ); }

	// ── Attention seekers ──
	flash( times = 3, duration = 1 )                  { return this.op( { type: 'flash', times, duration } ); }
	rubberBand( scale = 1.3, duration = 0.8 )         { return this.op( { type: 'rubberBand', scale, duration } ); }
	jello( intensity = 0.05, duration = 0.9 )         { return this.op( { type: 'jello', intensity, duration } ); }
	heartBeat( scale = 1.1, duration = 1.3 )          { return this.op( { type: 'heartBeat', scale, duration } ); }
	tada( rotations = 1, scale = 1.1, duration = 1 )  { return this.op( { type: 'tada', rotations, scale, duration } ); }
	wobble( angle = 15, duration = 1 )                { return this.op( { type: 'wobble', angle, duration } ); }

	raw( code )                         { return this.op( { type: 'raw', code } ); }

	// ────────────────────────────────────────────────────────────────────────────
	// ── QUERY / INSPECTION (READ-ONLY) ──────────────────────────────────────────
	// ────────────────────────────────────────────────────────────────────────────

	/** How many nodes matched this selector? */
	count() { return this.nodes.length; }

	/** Did the selector match anything? (opposite of isEmpty) */
	exists() { return this.nodes.length > 0; }

	/** Is this selection empty? */
	isEmpty() { return this.nodes.length === 0; }

	/** Get names of all matched nodes. */
	names() { return this.nodes.map( n => n.name || 'unnamed' ); }

	/** Get UUIDs of all matched nodes. */
	ids() { return this.nodes.map( n => n.uuid ); }

	/** Get custom classes on a node (or first node if multiple matched). */
	classes( node = this.nodes[ 0 ] ) {
		if ( ! node ) return [];
		return Array.from( toClassSet( node.userData?.customClasses ) );
	}

	/**
	 * jQuery-style: true if ANY node in the set has the class (auto-derived,
	 * custom, or label). Read-only. `$S('.wheel').isClass('front')`
	 */
	isClass( cls ) {
		if ( ! cls ) return false;
		const name = normalizeClassName( cls );
		return this.nodes.some( n => hasClass( n, name ) );
	}

	/**
	 * Read the semantic id (→ #id) of the set: `userData.label`, falling back to
	 * the object name. Returns a string for a single node, an array for many,
	 * or null when empty. Read-only — use `editID()` to change it.
	 */
	id() {
		const ids = this.nodes.map( n => n.userData?.label ?? n.name ?? null );
		if ( ids.length === 0 ) return null;
		return ids.length === 1 ? ids[ 0 ] : ids;
	}

	/** Get bounding box dimensions of this selection. */
	bounds() {
		if ( this.nodes.length === 0 ) return null;
		const box3 = new THREE.Box3();
		this.nodes.forEach( n => box3.expandByObject( n ) );
		return { min: box3.min, max: box3.max, size: box3.getSize( new THREE.Vector3() ) };
	}

	/** Alias for bounds().size */
	size() {
		const b = this.bounds();
		return b ? b.size : null;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// ── VALUE GETTERS (READ-ONLY) ──────────────────────────────────────────────
	// ────────────────────────────────────────────────────────────────────────────

	// ────────────────────────────────────────────────────────────────────────────
	// ── TRANSFORM ACCESSORS (LIVE, READ + COMMAND-BACKED WRITE) ─────────────────
	// ────────────────────────────────────────────────────────────────────────────
	// `.position/.rotation/.scale/.quaternion` return a live handle over the first
	// node's LOCAL transform (three.js-native, mirroring `mesh.position`):
	//   read   →  $S('#box').position.x            // live component value
	//   write  →  $S('#box').position.x = 4        // → SetPositionCommand (undoable)
	//   vector →  $S('#box').scale.set( 2, 2, 2 )  // → SetScaleCommand (undoable)
	// Writes route through the command surface and apply to EVERY node in the set
	// (batched into ONE undo via MultiCmdsCommand), so the viewport + inspector
	// refresh — honoring the "one execution surface" invariant. Rotation uses
	// radians (native THREE.Euler). Calling the handle preserves the legacy forms:
	//   $S('.wheel').scale( 1.5 )       // relative-scale op (flagship)
	//   $S('#box').position()           // world-space THREE.Vector3 (read-only)

	/** Live LOCAL position handle of the set (read component / command-backed write). */
	get position() { return this._transformHandle( 'position' ); }

	/** Live LOCAL rotation handle (Euler, radians) of the set. */
	get rotation() { return this._transformHandle( 'rotation' ); }

	/** Live LOCAL scale handle of the set. Callable: `.scale(factor, axis)` relative-scales. */
	get scale() { return this._transformHandle( 'scale' ); }

	/** Live LOCAL quaternion handle of the set (writes convert to Euler → SetRotationCommand). */
	get quaternion() { return this._transformHandle( 'quaternion' ); }

	/** Build a live transform handle (Proxy) over the first node's local `kind` value. */
	_transformHandle( kind ) {
		const chain = this;
		const COMPONENTS = kind === 'quaternion' ? [ 'x', 'y', 'z', 'w' ] : [ 'x', 'y', 'z' ];
		const liveLocal = () => { const n = chain.nodes[ 0 ]; return n ? n[ kind ] : null; };

		// Callable target preserves the legacy method forms (back-compat).
		const callable = function ( arg, arg2 ) {
			if ( kind === 'scale' && typeof arg === 'number' ) {
				return chain.op( { type: 'scale', factor: arg, axis: arg2 } );
			}
			const node = ( arg && arg.isObject3D ) ? arg : chain.nodes[ 0 ];
			return chain._readWorld( kind, node );
		};

		return new Proxy( callable, {
			get( target, prop ) {
				const v = liveLocal();
				if ( prop === 'x' || prop === 'y' || prop === 'z' || prop === 'w' ) {
					return v ? v[ prop ] : undefined;
				}
				if ( prop === 'set' ) {
					return ( ...vals ) => {
						const patch = {};
						COMPONENTS.forEach( ( c, i ) => { if ( vals[ i ] !== undefined ) patch[ c ] = vals[ i ]; } );
						return chain._writeTransform( kind, patch );
					};
				}
				if ( prop === 'copy' ) {
					return ( src ) => {
						const patch = {};
						COMPONENTS.forEach( c => { if ( src && src[ c ] !== undefined ) patch[ c ] = src[ c ]; } );
						return chain._writeTransform( kind, patch );
					};
				}
				if ( prop === 'toArray' ) return () => v ? v.toArray() : [];
				if ( prop === 'clone' ) return () => v ? v.clone() : null;
				if ( prop === 'toString' || prop === Symbol.toPrimitive ) {
					return () => v ? `${ kind }(${ COMPONENTS.map( c => v[ c ] ).join( ', ' ) })` : `${ kind }(empty)`;
				}
				// Reflect any other live property/method (e.g. euler.order, isVector3).
				if ( v && prop in v ) {
					const val = v[ prop ];
					return ( typeof val === 'function' ) ? val.bind( v ) : val;
				}
				return undefined;
			},
			set( target, prop, value ) {
				if ( prop === 'x' || prop === 'y' || prop === 'z' || prop === 'w' ) {
					chain._writeTransform( kind, { [ prop ]: value } );
				}
				return true;
			}
		} );
	}

	/** Read the WORLD-space `kind` value of a node (legacy read form, non-mutating). */
	_readWorld( kind, node ) {
		if ( ! node ) return null;
		node.updateWorldMatrix( true, false );
		if ( kind === 'position' ) return node.getWorldPosition( new THREE.Vector3() );
		if ( kind === 'scale' ) return node.getWorldScale( new THREE.Vector3() );
		if ( kind === 'quaternion' ) return node.getWorldQuaternion( new THREE.Quaternion() );
		if ( kind === 'rotation' ) {
			const euler = new THREE.Euler();
			euler.setFromQuaternion( node.getWorldQuaternion( new THREE.Quaternion() ) );
			return euler;
		}
		return null;
	}

	/**
	 * Apply a partial LOCAL transform change (per-component patch) to EVERY node in
	 * the set through the command surface, batched into one undo step. Each node's
	 * current transform is read fresh so sequential writes compose correctly.
	 */
	_writeTransform( kind, patch ) {
		if ( this.nodes.length === 0 || ! patch || Object.keys( patch ).length === 0 ) return this;
		const editor = this.editor;
		const cmds = [];
		for ( const node of this.nodes ) {
			let cmd = null;
			if ( kind === 'position' ) {
				const v = node.position.clone();
				if ( patch.x !== undefined ) v.x = patch.x;
				if ( patch.y !== undefined ) v.y = patch.y;
				if ( patch.z !== undefined ) v.z = patch.z;
				cmd = new SetPositionCommand( editor, node, v );
			} else if ( kind === 'scale' ) {
				const v = node.scale.clone();
				if ( patch.x !== undefined ) v.x = patch.x;
				if ( patch.y !== undefined ) v.y = patch.y;
				if ( patch.z !== undefined ) v.z = patch.z;
				cmd = new SetScaleCommand( editor, node, v );
			} else if ( kind === 'rotation' ) {
				const e = node.rotation.clone();
				if ( patch.x !== undefined ) e.x = patch.x;
				if ( patch.y !== undefined ) e.y = patch.y;
				if ( patch.z !== undefined ) e.z = patch.z;
				cmd = new SetRotationCommand( editor, node, e );
			} else if ( kind === 'quaternion' ) {
				const q = node.quaternion.clone();
				if ( patch.x !== undefined ) q.x = patch.x;
				if ( patch.y !== undefined ) q.y = patch.y;
				if ( patch.z !== undefined ) q.z = patch.z;
				if ( patch.w !== undefined ) q.w = patch.w;
				q.normalize();
				const e = new THREE.Euler().setFromQuaternion( q, node.rotation.order );
				cmd = new SetRotationCommand( editor, node, e );
			}
			if ( cmd ) cmds.push( cmd );
		}
		if ( cmds.length ) {
			editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );
		}
		return this;
	}

	/** Get material color of first node (if it's a Mesh). */
	color( node = this.nodes[ 0 ] ) {
		if ( ! node || ! node.material ) return null;
		return node.material.color ? node.material.color.getHexString() : null;
	}

	/** Get material properties of first node. */
	material( node = this.nodes[ 0 ] ) {
		if ( ! node || ! node.material ) return null;
		return {
			type: node.material.type,
			color: node.material.color?.getHexString() || null,
			metalness: node.material.metalness,
			roughness: node.material.roughness,
			emissive: node.material.emissive?.getHexString() || null,
			opacity: node.material.opacity,
			transparent: node.material.transparent
		};
	}

	/** Get opacity (0-1) of first node. */
	opacity( node = this.nodes[ 0 ] ) {
		if ( ! node || ! node.material ) return null;
		return node.material.opacity;
	}

	/** Get visibility state of first node. */
	visible( node = this.nodes[ 0 ] ) {
		if ( ! node ) return null;
		return node.visible;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// ── TRAVERSAL (GRAPH NAVIGATION) ────────────────────────────────────────────
	// ────────────────────────────────────────────────────────────────────────────

	/** Exclude nodes matching a selector. Returns new ChainableSet. */
	not( selector ) {
		const exclude = new Set( selectorEngine.query( this.editor.scene, selector ) );
		const next = new ChainableSet( this.editor, this.nodes.filter( n => ! exclude.has( n ) ) );
		return next;
	}

	/** Get first matched node as a new ChainableSet. */
	first() {
		if ( this.nodes.length === 0 ) return new ChainableSet( this.editor, [] );
		return new ChainableSet( this.editor, [ this.nodes[ 0 ] ] );
	}

	/** Get last matched node as a new ChainableSet. */
	last() {
		if ( this.nodes.length === 0 ) return new ChainableSet( this.editor, [] );
		return new ChainableSet( this.editor, [ this.nodes[ this.nodes.length - 1 ] ] );
	}

	/** Get nth matched node (zero-indexed) as a new ChainableSet. */
	eq( index ) {
		if ( index < 0 || index >= this.nodes.length ) return new ChainableSet( this.editor, [] );
		return new ChainableSet( this.editor, [ this.nodes[ index ] ] );
	}

	/**
	 * Timeline `.at(t)` — place the NEXT animation op at absolute time `t` on the
	 * scene clock (the "raw" escape of timing). This starts a timeline chain, so
	 * it works at the head of a chain too: `$S('.a-cube').at(2).spin('y',1,1)`.
	 * For picking the nth matched node, use `.eq()` (unambiguous node index).
	 */
	at( value ) {

		const c = this._ensureChain();
		c.cursor = Math.max( 0, Number( value ) || 0 );
		c.parallelNext = false;
		c.started = true;
		return this;

	}

	/** Get parent nodes of matched nodes. */
	parent() {
		const parents = new Set();
		this.nodes.forEach( n => {
			if ( n.parent ) parents.add( n.parent );
		} );
		return new ChainableSet( this.editor, Array.from( parents ) );
	}

	/** Get direct child nodes of matched nodes. */
	children() {
		const allChildren = [];
		this.nodes.forEach( n => {
			allChildren.push( ...n.children );
		} );
		return new ChainableSet( this.editor, allChildren );
	}

	/** Find nearest ancestor matching selector. */
	closest( selector ) {
		const matching = new Set( selectorEngine.query( this.editor.scene, selector ) );
		const ancestors = [];
		this.nodes.forEach( n => {
			let current = n.parent;
			while ( current ) {
				if ( matching.has( current ) ) {
					ancestors.push( current );
					break;
				}
				current = current.parent;
			}
		} );
		return new ChainableSet( this.editor, ancestors );
	}

	/** Union: combine with results of another selector. */
	add( selector ) {
		const others = selectorEngine.query( this.editor.scene, selector );
		const combined = [ ...new Set( [ ...this.nodes, ...others ] ) ];
		return new ChainableSet( this.editor, combined );
	}

	// ────────────────────────────────────────────────────────────────────────────
	// ── APPEARANCE OPS (MUTATIONS) ──────────────────────────────────────────────
	// ────────────────────────────────────────────────────────────────────────────

	/** Set opacity (0-1). */
	setOpacity( value ) { return this.op( { type: 'setOpacity', value } ); }

	/** Set visibility (true/false). */
	setVisible( bool ) { return this.op( { type: 'setVisible', visible: bool } ); }

	/** Show (alias for setVisible(true)). */
	show() { return this.op( { type: 'setVisible', visible: true } ); }

	/** Hide (alias for setVisible(false)). */
	hide() { return this.op( { type: 'setVisible', visible: false } ); }

	/** Toggle wireframe mode. */
	wireframe( bool = true ) { return this.op( { type: 'wireframe', wireframe: bool } ); }

	// ────────────────────────────────────────────────────────────────────────────
	// ── TRANSFORMS: RELATIVE vs ABSOLUTE ────────────────────────────────────────
	// ────────────────────────────────────────────────────────────────────────────

	// Relative forms (already exist):
	// .move(dx, dy, dz) - relative offset
	// .rotate(axis, degrees) - relative rotation
	// .scale(factor, axis?) - relative scale

	/** Set absolute world position. */
	moveTo( x, y, z ) { return this.op( { type: 'moveTo', x, y, z } ); }

	/** Set absolute rotation (Euler angles in degrees). */
	rotateTo( x, y, z ) { return this.op( { type: 'rotateTo', x, y, z } ); }

	/** Set absolute uniform scale. */
	scaleTo( factor ) { return this.op( { type: 'scaleTo', factor } ); }

	/** Reset to original transform. */
	reset() { return this.op( { type: 'reset' } ); }

	/** Orient nodes toward a target point or object. */
	lookAt( target ) { return this.op( { type: 'lookAt', target } ); }

	/** Narrow the set with an additional selector (compound on results). */
	filter( extraSelector ) {

		const extra = new Set( selectorEngine.query( this.editor.scene, extraSelector ) );
		const next = new ChainableSet( this.editor, this.nodes.filter( n => extra.has( n ) ) );
		return next;

	}

	/** Iterate (read-only). */
	each( fn ) { this.nodes.forEach( fn ); return this; }

	/** Last op's result object. */
	result() { return this._last; }

}

/**
 * makeQuery(editor) → bind editor once so callers use the bare $S(selector) form.
 * Curry-friendly: const $S = makeQuery(editor); $S('.wheel').recolor('#111').
 * @param {Editor} editor
 * @returns {(selector:string)=>ChainableSet}
 */
export function makeQuery( editor ) {

	// Make `:selected` / `:lasso` first-class selectors EVERYWHERE (op() dispatch,
	// validateOpJSON, subset sanity) — not just in the ChainableSet constructor —
	// by resolving them to the editor's live selection. Without this, chained ops
	// like $S(':selected').recolor('#000') re-query the raw selector string in the
	// edit op and match nothing. Selection lives on the editor, not the scene.
	selectorEngine.setSelectionProvider( () =>
		typeof editor.getSelectedObjects === 'function'
			? editor.getSelectedObjects().filter( o => o && o !== editor.scene && o !== editor.camera )
			: ( editor.selected ? [ editor.selected ] : [] )
	);

	const $S = ( selectorOrNodes ) => new ChainableSet( editor, selectorOrNodes );

	// ── $S.listSelectors() — the addressable parts in the current scene ──────
	// Attached as a static method so library consumers can call $S.listSelectors()
	// without importing vocabInjection directly.
	$S.listSelectors = () => selectorCounts( editor.scene );

	return $S;

}

export { ChainableSet };
