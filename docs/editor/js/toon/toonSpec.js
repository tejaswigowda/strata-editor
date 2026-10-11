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
// Deterministic: the same spec on the same scene gives the same materials, so a
// render is reproducible from the scene spec alone.

export const LOOK_MODES = [ 'toon', 'native' ];
export const OUTLINE_MODES = { world: 'worldCoordinates', screen: 'screenCoordinates', none: 'none' };

const isNumber = v => typeof v === 'number' && Number.isFinite( v );
const isColor = v => isNumber( v ) || ( typeof v === 'string' && v.trim().length > 0 );
const isObject = v => v && typeof v === 'object' && ! Array.isArray( v );

const TOP_KEYS = [ 'op', 'look', 'mode', 'shade', 'bands', 'toony', 'shift', 'rim', 'outline', 'optional', 'target' ];
const RIM_KEYS = [ 'color', 'power', 'lift', 'mix' ];
const OUTLINE_KEYS = [ 'width', 'color', 'mode', 'mix' ];

/**
 * Validate + normalise a look spec. Accepts the scene-spec form ({ look: "toon", … })
 * and the customize-op form ({ op: "look", mode: "toon", … }).
 * Returns { ok, errors, spec } where spec has the canonical shape
 * { look, shade?, toony?, shift?, rim?, outline? } (bands folded into toony).
 */
export function normalizeLook( input ) {

	const errors = [];
	const err = m => errors.push( m );

	if ( typeof input === 'string' ) input = { look: input };
	if ( ! isObject( input ) ) return { ok: false, errors: [ 'look: expected an object such as { "look": "toon" }' ], spec: null };

	const mode = input.look !== undefined ? input.look : input.mode;
	if ( ! LOOK_MODES.includes( mode ) ) err( `look: "look" must be one of ${ LOOK_MODES.join( ', ' ) }` );

	for ( const k of Object.keys( input ) ) if ( ! TOP_KEYS.includes( k ) ) err( `look: unknown field "${ k }"` );

	const spec = { look: mode };

	if ( input.shade !== undefined ) {

		if ( ! isColor( input.shade ) ) err( 'look: "shade" must be a colour such as "#3a2c5a"' );
		else spec.shade = input.shade;

	}

	if ( input.shift !== undefined ) {

		if ( ! isNumber( input.shift ) || input.shift < - 1 || input.shift > 1 ) err( 'look: "shift" must be a number in -1..1' );
		else spec.shift = input.shift;

	}

	if ( input.bands !== undefined ) {

		if ( input.bands !== 2 ) err( 'look: "bands" must be 2 (two hard tones, lit / shade); MToon has no 3+ band ramp — use "toony" for a softer edge' );
		else spec.toony = 1;

	}

	if ( input.toony !== undefined ) {

		if ( ! isNumber( input.toony ) || input.toony < 0 || input.toony > 1 ) err( 'look: "toony" must be a number in 0..1' );
		else if ( input.bands !== undefined && input.toony !== 1 ) err( 'look: "bands": 2 means toony 1; drop one of them' );
		else spec.toony = input.toony;

	}

	if ( input.rim !== undefined ) {

		if ( ! isObject( input.rim ) ) err( 'look: "rim" must be an object { color?, power?, lift?, mix? }' );
		else {

			const rim = {};
			for ( const k of Object.keys( input.rim ) ) if ( ! RIM_KEYS.includes( k ) ) err( `look: unknown rim field "${ k }"` );
			if ( input.rim.color !== undefined ) { if ( ! isColor( input.rim.color ) ) err( 'look: rim.color must be a colour' ); else rim.color = input.rim.color; }
			if ( input.rim.power !== undefined ) { if ( ! isNumber( input.rim.power ) || input.rim.power <= 0 ) err( 'look: rim.power must be a positive number' ); else rim.power = input.rim.power; }
			if ( input.rim.lift !== undefined ) { if ( ! isNumber( input.rim.lift ) || input.rim.lift < 0 || input.rim.lift > 1 ) err( 'look: rim.lift must be a number in 0..1' ); else rim.lift = input.rim.lift; }
			if ( input.rim.mix !== undefined ) { if ( ! isNumber( input.rim.mix ) || input.rim.mix < 0 || input.rim.mix > 1 ) err( 'look: rim.mix must be a number in 0..1 (0 = rim glows regardless of light, 1 = lit by the lights)' ); else rim.mix = input.rim.mix; }
			spec.rim = rim;

		}

	}

	if ( input.outline !== undefined ) {

		if ( ! isObject( input.outline ) ) err( 'look: "outline" must be an object { width?, color?, mode?, mix? }' );
		else {

			const o = {};
			for ( const k of Object.keys( input.outline ) ) if ( ! OUTLINE_KEYS.includes( k ) ) err( `look: unknown outline field "${ k }"` );
			if ( input.outline.width !== undefined ) { if ( ! isNumber( input.outline.width ) || input.outline.width < 0 ) err( 'look: outline.width must be a number >= 0 (metres in "world" mode)' ); else o.width = input.outline.width; }
			if ( input.outline.color !== undefined ) { if ( ! isColor( input.outline.color ) ) err( 'look: outline.color must be a colour' ); else o.color = input.outline.color; }
			if ( input.outline.mode !== undefined ) { if ( ! OUTLINE_MODES[ input.outline.mode ] ) err( `look: outline.mode must be one of ${ Object.keys( OUTLINE_MODES ).join( ', ' ) }` ); else o.mode = input.outline.mode; }
			if ( input.outline.mix !== undefined ) { if ( ! isNumber( input.outline.mix ) || input.outline.mix < 0 || input.outline.mix > 1 ) err( 'look: outline.mix must be a number in 0..1' ); else o.mix = input.outline.mix; }
			spec.outline = o;

		}

	}

	return { ok: errors.length === 0, errors, spec: errors.length === 0 ? spec : null };

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
