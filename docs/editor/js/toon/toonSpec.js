// ── toonSpec.js ───────────────────────────────────────────────────────────────
// The `look` render-mode spec, pure (no DOM, no renderer, no three.js), so the
// headless scene-spec stage and the node tests can validate / normalise it
// without a GPU. The material work lives in ToonLook.js, which registers itself
// here as the "applier".
//
//   look: "toon"                         light-responsive banded toon (MToon) + outlines
//   look: "native"                       back to the file's own materials
//
// Optional per-parameter overrides. Anything you leave out keeps the value the
// VRM file carries (VRM/MToon → shade colour, shading shift/toony, rim, outline),
// or, for a non-VRM character, a sensible default derived from its base colour.
//
//   { "look": "toon",
//     "shade":   "#3a2c5a",              shade-band colour (MToon "shade colour")
//     "bands":   2,                      two hard tones (lit / shade): same as toony 1
//     "toony":   1,                      0 = smooth ramp … 1 = hard edge
//     "shift":   0.1,                    where the lit/shade edge falls (-1 … 1)
//     "rim":     { "color": "#ff2ea6", "power": 3, "lift": 0, "mix": 0 },
//     "outline": { "width": 0.002, "color": "#14080f", "mode": "world", "mix": 1 } }
//
// MToon is a two-tone model (one threshold between "lit" and "shade"); a 3+ band
// ramp is not part of MToon and is refused rather than silently approximated.
//
// The same fields can be written flat (rimColor, outlineWidth, ...) and the two spellings
// can be mixed; shaders/shaderSpec.js owns the schema (see guides/SHADERS.md).
//
// Deterministic: the same spec on the same scene gives the same materials, so a
// render is reproducible from the scene spec alone.

import { normalizeShaderParams, mtoonLookSpec } from '../shaders/shaderSpec.js';

export const LOOK_MODES = [ 'toon', 'native' ];
export const OUTLINE_MODES = { world: 'worldCoordinates', screen: 'screenCoordinates', none: 'none' };

const isObject = v => v && typeof v === 'object' && ! Array.isArray( v );

// What a look spec carries besides the MToon params themselves (shaders/shaderSpec.js owns those).
const ENVELOPE_KEYS = [ 'op', 'look', 'mode', 'optional', 'target' ];

/**
 * Validate + normalise a look spec. Accepts the scene-spec form ({ look: "toon", … })
 * and the customize-op form ({ op: "look", mode: "toon", … }). The MToon fields go through the
 * shader registry's normaliser, so a look spec means exactly what mtoon() / toon() / the Shader
 * tab take: nested or flat, numbers clamped, unknown keys refused with a suggestion.
 * Returns { ok, errors, spec } where spec has the canonical shape
 * { look, shade?, toony?, shift?, rim?, outline? } (bands folded into toony).
 */
export function normalizeLook( input ) {

	const errors = [];

	if ( typeof input === 'string' ) input = { look: input };
	if ( ! isObject( input ) ) return { ok: false, errors: [ 'look: expected an object such as { "look": "toon" }' ], spec: null };

	const mode = input.look !== undefined ? input.look : input.mode;
	if ( ! LOOK_MODES.includes( mode ) ) errors.push( `look: "look" must be one of ${ LOOK_MODES.join( ', ' ) }` );

	const params = {};
	for ( const k of Object.keys( input ) ) if ( ! ENVELOPE_KEYS.includes( k ) ) params[ k ] = input[ k ];
	const n = normalizeShaderParams( 'mtoon', params, false );
	if ( ! n.ok ) errors.push( ...n.errors );

	if ( errors.length ) return { ok: false, errors, spec: null };
	return { ok: true, errors, spec: { ...mtoonLookSpec( n.params ), look: mode } };

}

/** True for a VRM (0.x or 1.0) GLB / glTF buffer or JSON string: it has an MToon block to honour. */
export function isVRMSource( data ) {

	let json = '';

	if ( typeof data === 'string' ) json = data;
	else if ( data instanceof ArrayBuffer && data.byteLength > 20 ) {

		const dv = new DataView( data );
		if ( dv.getUint32( 0, true ) !== 0x46546c67 ) return false; // 'glTF'
		const len = dv.getUint32( 12, true );
		json = new TextDecoder().decode( new Uint8Array( data, 20, Math.min( len, data.byteLength - 20 ) ) );

	}

	return /"(?:VRM|VRMC_vrm|VRMC_materials_mtoon)"\s*:/.test( json );

}

// ── Applier registry ──────────────────────────────────────────────────────────
// ToonLook.js (browser, WebGPU) registers the function that turns a spec into
// materials. Headless runs (node tests, the agent's dry run) have none, and then
// the spec is only recorded on the character (userData.look) — still deterministic,
// and it is applied the moment a renderer-side applier exists (see restoreLooks).

let applier = null;

export function registerLookApplier( fn ) { applier = fn; }

export function hasLookApplier() { return applier !== null; }

/** Record the spec on `root` and, when an applier is registered, apply it (options.swap routes material swaps through a recorder). */
export function applyLookSpec( root, spec, options ) {

	const n = normalizeLook( spec );
	if ( ! n.ok ) throw new Error( n.errors.join( '; ' ) );

	root.userData = root.userData || {};
	if ( n.spec.look === 'native' ) delete root.userData.look;
	else root.userData.look = n.spec;

	if ( applier ) applier( root, n.spec, options );
	return n.spec;

}

/** True when `object` (or a descendant) carries material-level toon metadata. */
export function sceneHasToon( object ) {

	let found = false;
	object.traverse( o => {

		if ( found ) return;
		if ( o.userData && o.userData.look ) { found = true; return; }
		if ( ! o.isMesh ) return;
		for ( const m of [].concat( o.material ) ) if ( m && m.userData && m.userData.toon ) { found = true; return; }

	} );
	return found;

}

/** The look of the nearest ancestor that has one (props use their character's look). */
export function lookOf( object ) {

	for ( let n = object; n; n = n.parent ) if ( n.userData && n.userData.look ) return n.userData.look;
	return null;

}

/** Called by the customizer for each prop it adds: a prop under a toon character is toon too. */
export function applyLookToProp( prop ) {

	const look = lookOf( prop );
	if ( look && applier ) applier( prop, look );

}
