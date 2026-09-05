// ── argNormalize.js ───────────────────────────────────────────────────────────
// Host arg-normalization guards — same class as clone-on-write / texture-tint
// (editGuards.js): the model expresses intent, the host enforces the closed op
// set. Model-agnostic, runs regardless of engine. PURE (no DOM, no three.js) so
// it's node-unit-testable.
//
// canonicalizeColorOnlySetMaterial: the dominant op-selection failure is the model
// picking the general `setMaterial` (inventing a different malformed arg shape
// every time) where the request is really just "make it <color>" — a deterministic
// `recolor`. When a setMaterial op's args reduce to ONLY a color (across every
// shape observed: {color}, {material:{color}}, {newMaterial:{color,...}},
// {properties:{color}}, or a top-level color beside a string material-type tag),
// rewrite it to `recolor`. A genuine multi-property setMaterial (roughness,
// metalness, map, ...) is left untouched.

const COLOR_KEY_RE = /^colou?r$/i;
const NESTED_KEY_RE = /^(material|newMaterial|properties|props)$/i;
const TYPE_TAG_KEY_RE = /^(material|newMaterial|type)$/i;

// { color: <anything> } and nothing else → the color value; otherwise null.
function colorOnlyValue( obj ) {

	if ( ! obj || typeof obj !== 'object' ) return null;
	const keys = Object.keys( obj );
	const colorKey = keys.find( k => COLOR_KEY_RE.test( k ) );
	if ( ! colorKey ) return null;
	if ( keys.some( k => ! COLOR_KEY_RE.test( k ) ) ) return null; // any other property blocks the collapse
	return obj[ colorKey ];

}

/**
 * @param {object} args  the emitted op's `args`
 * @returns {*} the color value IF `args` reduces to color-only, else null (genuine
 *   setMaterial — do NOT collapse).
 */
export function extractColorOnlyArg( args ) {

	if ( ! args || typeof args !== 'object' ) return null;
	const keys = Object.keys( args );

	// A string material-type TAG ("MeshStandardMaterial") is a (usually wrong) hint,
	// not a material PROPERTY — it doesn't block the collapse either alongside a
	// nested object or a flat color.
	const typeTagKeys = keys.filter( k => TYPE_TAG_KEY_RE.test( k ) && typeof args[ k ] === 'string' );

	// {material:{color}} / {newMaterial:{color}} / {properties:{color}} / {props:{color}}
	const nestedKey = keys.find( k => NESTED_KEY_RE.test( k ) && args[ k ] && typeof args[ k ] === 'object' );
	if ( nestedKey ) {

		const outerExtra = keys.filter( k => k !== nestedKey && ! typeTagKeys.includes( k ) );
		if ( outerExtra.length > 0 ) return null;
		return colorOnlyValue( args[ nestedKey ] );

	}

	// Flat {color:...}, possibly beside a string material-type tag.
	const rest = Object.fromEntries( keys.filter( k => ! typeTagKeys.includes( k ) ).map( k => [ k, args[ k ] ] ) );
	return colorOnlyValue( rest );

}

/**
 * @param {{op:string, selector?:string, args?:object}} opObj
 * @returns {{op:string, selector?:string, args?:object}} a NEW op object rewritten
 *   to `recolor` when `opObj` is a color-only `setMaterial`; otherwise the SAME
 *   reference (no-op).
 */
export function canonicalizeColorOnlySetMaterial( opObj ) {

	if ( ! opObj || opObj.op !== 'setMaterial' ) return opObj;
	const color = extractColorOnlyArg( opObj.args );
	if ( color == null ) return opObj;
	return { ...opObj, op: 'recolor', args: { color } };

}
