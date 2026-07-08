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
import {
	recolorOp, scaleOp, moveOp, rotateOp, deleteOp, duplicateOp, setMaterialOp,
} from './editOps.js';
import { executeRecipeOp } from './animationRecipes.js';

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

	// ── Animation recipe ops (deterministic winding-safe keyframes) ──
	spin:        { kind: 'anim', args: { axis: 'axis?', turns: 'number?', duration: 'number?' },        summary: 'continuous rotation (winding-safe)' },
	bounce:      { kind: 'anim', args: { height: 'number?', duration: 'number?' },                      summary: 'oscillate up/down' },
	pulse:       { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                       summary: 'scale up/down' },
	fade:        { kind: 'anim', args: { from: 'number?', to: 'number?', duration: 'number?' },         summary: 'opacity transition' },
	orbit:       { kind: 'anim', args: { center: 'vec3?', radius: 'number?', duration: 'number?' },     summary: 'circular motion around a point' },
	shake:       { kind: 'anim', args: { intensity: 'number?', duration: 'number?' },                   summary: 'jittery motion' },

	// ── Entrance animations (appear with style) ──
	fadeIn:      { kind: 'anim', args: { duration: 'number?' },                                         summary: 'fade in from transparent' },
	zoomIn:      { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'scale from zero to full size' },
	slideInUp:   { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from below' },
	slideInDown: { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from above' },
	slideInLeft: { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from left' },
	slideInRight:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide in from right' },
	bounceIn:    { kind: 'anim', args: { duration: 'number?' },                                         summary: 'scale in with bounce' },
	flipInX:     { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate in around X-axis' },
	flipInY:     { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate in around Y-axis' },
	rotateIn:    { kind: 'anim', args: { angle: 'number?', duration: 'number?' },                      summary: 'rotate in place' },

	// ── Exit animations (disappear with style) ──
	fadeOut:     { kind: 'anim', args: { duration: 'number?' },                                         summary: 'fade out to transparent' },
	zoomOut:     { kind: 'anim', args: { scale: 'number?', duration: 'number?' },                      summary: 'scale from full size to zero' },
	slideOutUp:  { kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out upward' },
	slideOutDown:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out downward' },
	slideOutLeft:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                   summary: 'slide out to left' },
	slideOutRight:{ kind: 'anim', args: { distance: 'number?', duration: 'number?' },                  summary: 'slide out to right' },
	bounceOut:   { kind: 'anim', args: { duration: 'number?' },                                         summary: 'scale out with bounce' },
	flipOutX:    { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate out around X-axis' },
	flipOutY:    { kind: 'anim', args: { duration: 'number?' },                                         summary: 'rotate out around Y-axis' },
	rotateOut:   { kind: 'anim', args: { angle: 'number?', duration: 'number?' },                      summary: 'rotate out of place' },

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

		}

	}

	get length() { return this.nodes.length; }

	/** The op primitive over THIS set's selector. Returns the set (chainable). */
	op( partialOpJSON ) {

		const opJSON = { selector: this.selector, ...partialOpJSON };
		const result = op( this.editor, opJSON );
		this._last = result;
		return this; // chainable

	}

	// ── Named-method sugar (thin wrappers over .op()) ──
	recolor( color )                    { return this.op( { type: 'recolor', color } ); }
	scale( factor, axis )               { return this.op( { type: 'scale', factor, axis } ); }
	move( dx = 0, dy = 0, dz = 0 )      { return this.op( { type: 'move', dx, dy, dz } ); }
	rotate( axis = 'y', degrees = 90 )  { return this.op( { type: 'rotate', axis, degrees } ); }
	delete()                            { return this.op( { type: 'delete' } ); }
	duplicate( dx = 0, dy = 0, dz = 0 ) { return this.op( { type: 'duplicate', dx, dy, dz } ); }
	retexture( texture )                { return this.op( { type: 'retexture', texture } ); }
	setMaterial( props )                { return this.op( { type: 'setMaterial', props } ); }

	spin( axis = 'y', turns = 1, duration = 2 ) { return this.op( { type: 'spin', axis, turns, duration } ); }
	bounce( height = 0.5, duration = 1 )        { return this.op( { type: 'bounce', height, duration } ); }
	pulse( scale = 1.2, duration = 1 )          { return this.op( { type: 'pulse', scale, duration } ); }
	fade( from = 1, to = 0, duration = 1 )      { return this.op( { type: 'fade', from, to, duration } ); }
	orbit( center = [ 0, 0, 0 ], radius = 2, duration = 4 ) { return this.op( { type: 'orbit', center, radius, duration } ); }
	shake( intensity = 0.1, duration = 1 )      { return this.op( { type: 'shake', intensity, duration } ); }

	// ── Entrance animations ──
	fadeIn( duration = 1 )                            { return this.op( { type: 'fadeIn', duration } ); }
	zoomIn( scale = 1.5, duration = 1 )               { return this.op( { type: 'zoomIn', scale, duration } ); }
	slideInUp( distance = 1, duration = 0.8 )         { return this.op( { type: 'slideInUp', distance, duration } ); }
	slideInDown( distance = 1, duration = 0.8 )       { return this.op( { type: 'slideInDown', distance, duration } ); }
	slideInLeft( distance = 1, duration = 0.8 )       { return this.op( { type: 'slideInLeft', distance, duration } ); }
	slideInRight( distance = 1, duration = 0.8 )      { return this.op( { type: 'slideInRight', distance, duration } ); }
	bounceIn( duration = 1.2 )                        { return this.op( { type: 'bounceIn', duration } ); }
	flipInX( duration = 0.8 )                         { return this.op( { type: 'flipInX', duration } ); }
	flipInY( duration = 0.8 )                         { return this.op( { type: 'flipInY', duration } ); }
	rotateIn( angle = 90, duration = 0.8 )            { return this.op( { type: 'rotateIn', angle, duration } ); }

	// ── Exit animations ──
	fadeOut( duration = 1 )                           { return this.op( { type: 'fadeOut', duration } ); }
	zoomOut( scale = 0.3, duration = 1 )              { return this.op( { type: 'zoomOut', scale, duration } ); }
	slideOutUp( distance = 1, duration = 0.8 )        { return this.op( { type: 'slideOutUp', distance, duration } ); }
	slideOutDown( distance = 1, duration = 0.8 )      { return this.op( { type: 'slideOutDown', distance, duration } ); }
	slideOutLeft( distance = 1, duration = 0.8 )      { return this.op( { type: 'slideOutLeft', distance, duration } ); }
	slideOutRight( distance = 1, duration = 0.8 )     { return this.op( { type: 'slideOutRight', distance, duration } ); }
	bounceOut( duration = 1.2 )                       { return this.op( { type: 'bounceOut', duration } ); }
	flipOutX( duration = 0.8 )                        { return this.op( { type: 'flipOutX', duration } ); }
	flipOutY( duration = 0.8 )                        { return this.op( { type: 'flipOutY', duration } ); }
	rotateOut( angle = 90, duration = 0.8 )           { return this.op( { type: 'rotateOut', angle, duration } ); }

	// ── Attention seekers ──
	flash( times = 3, duration = 1 )                  { return this.op( { type: 'flash', times, duration } ); }
	rubberBand( scale = 1.3, duration = 0.8 )         { return this.op( { type: 'rubberBand', scale, duration } ); }
	jello( intensity = 0.05, duration = 0.9 )         { return this.op( { type: 'jello', intensity, duration } ); }
	heartBeat( scale = 1.1, duration = 1.3 )          { return this.op( { type: 'heartBeat', scale, duration } ); }
	tada( rotations = 1, scale = 1.1, duration = 1 )  { return this.op( { type: 'tada', rotations, scale, duration } ); }
	wobble( angle = 15, duration = 1 )                { return this.op( { type: 'wobble', angle, duration } ); }

	raw( code )                         { return this.op( { type: 'raw', code } ); }

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

	return ( selectorOrNodes ) => new ChainableSet( editor, selectorOrNodes );

}

export { ChainableSet };
