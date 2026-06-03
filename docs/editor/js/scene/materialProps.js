// ── materialProps.js ──────────────────────────────────────────────────────────
// Defines which material properties to emit for each material type,
// what their default values are, and how to format them for codegen.
//
// Usage:
//   import { materialToOptions } from './scene/materialProps.js';
//   const optStr = materialToOptions(materialJSON);  // → "{ color: 0xff0000, roughness: 0.5 }"

// ── Shared defaults across materials ─────────────────────────────────────────

const SHARED = {
	color:        { default: 0xffffff,  format: 'hex'    },
	opacity:      { default: 1,         format: 'float'  },
	transparent:  { default: false,     format: 'bool'   },
	wireframe:    { default: false,     format: 'bool'   },
	side:         { default: 0,         format: 'THREE_SIDE' }, // 0=FrontSide
	visible:      { default: true,      format: 'bool'   },
	depthWrite:   { default: true,      format: 'bool'   },
	depthTest:    { default: true,      format: 'bool'   },
};

// ── Per-material prop tables ──────────────────────────────────────────────────
// Each entry: key → { default, format }
// format: 'hex' | 'float' | 'bool' | 'int' | 'THREE_SIDE' | 'THREE_COMBINE'

export const MATERIAL_PROPS = {

	MeshStandardMaterial: {
		...SHARED,
		roughness:           { default: 1,   format: 'float' },
		metalness:           { default: 0,   format: 'float' },
		emissive:            { default: 0,   format: 'hex'   },
		emissiveIntensity:   { default: 1,   format: 'float' },
		envMapIntensity:     { default: 1,   format: 'float' },
		flatShading:         { default: false, format: 'bool' },
	},

	MeshPhysicalMaterial: {
		...SHARED,
		roughness:           { default: 1,   format: 'float' },
		metalness:           { default: 0,   format: 'float' },
		emissive:            { default: 0,   format: 'hex'   },
		emissiveIntensity:   { default: 1,   format: 'float' },
		clearcoat:           { default: 0,   format: 'float' },
		clearcoatRoughness:  { default: 0,   format: 'float' },
		transmission:        { default: 0,   format: 'float' },
		ior:                 { default: 1.5, format: 'float' },
		thickness:           { default: 0,   format: 'float' },
		flatShading:         { default: false, format: 'bool' },
	},

	MeshBasicMaterial: {
		...SHARED,
		map:   { default: null, format: 'skip' }, // textures handled separately
	},

	MeshPhongMaterial: {
		...SHARED,
		shininess:  { default: 30,  format: 'float' },
		specular:   { default: 0x111111, format: 'hex' },
		emissive:   { default: 0,   format: 'hex'   },
		flatShading: { default: false, format: 'bool' },
	},

	MeshLambertMaterial: {
		...SHARED,
		emissive: { default: 0, format: 'hex' },
	},

	MeshToonMaterial: {
		...SHARED,
	},

	MeshDepthMaterial: {
		wireframe: { default: false, format: 'bool' },
	},

	MeshNormalMaterial: {
		wireframe:   { default: false, format: 'bool' },
		flatShading: { default: false, format: 'bool' },
	},

	LineBasicMaterial: {
		color:     { default: 0xffffff, format: 'hex'   },
		linewidth: { default: 1,        format: 'float' },
		linecap:   { default: 'round',  format: 'string' },
		linejoin:  { default: 'round',  format: 'string' },
		opacity:   { default: 1,        format: 'float'  },
	},

	LineDashedMaterial: {
		color:     { default: 0xffffff, format: 'hex'   },
		linewidth: { default: 1,        format: 'float' },
		scale:     { default: 1,        format: 'float' },
		dashSize:  { default: 3,        format: 'float' },
		gapSize:   { default: 1,        format: 'float' },
		opacity:   { default: 1,        format: 'float' },
	},

	PointsMaterial: {
		color:    { default: 0xffffff, format: 'hex'   },
		size:     { default: 1,        format: 'float' },
		sizeAttenuation: { default: true, format: 'bool' },
		opacity:  { default: 1,        format: 'float' },
	},

	SpriteMaterial: {
		color:   { default: 0xffffff, format: 'hex'  },
		opacity: { default: 1,        format: 'float' },
		sizeAttenuation: { default: true, format: 'bool' },
	},

};

// THREE.Side constants for code emission
const SIDE_MAP = { 0: 'THREE.FrontSide', 1: 'THREE.BackSide', 2: 'THREE.DoubleSide' };

// ── Value formatter ───────────────────────────────────────────────────────────

function formatValue( val, format ) {

	if ( format === 'skip' ) return null;

	if ( format === 'hex' ) {

		// three.js JSON stores colors as integers
		if ( typeof val === 'number' ) {

			return '0x' + val.toString( 16 ).padStart( 6, '0' );

		}

		// Could be a color object from live scene
		if ( val && typeof val.getHex === 'function' ) {

			return '0x' + val.getHex().toString( 16 ).padStart( 6, '0' );

		}

	}

	if ( format === 'THREE_SIDE' ) {

		return SIDE_MAP[ val ] ?? val;

	}

	if ( format === 'float' ) {

		return typeof val === 'number' ? +val.toFixed( 5 ) : val;

	}

	if ( format === 'string' ) {

		return JSON.stringify( val );

	}

	// bool, int
	return val;

}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Emit a JavaScript options-object string (the argument to the material constructor)
 * for the given material JSON record.  Only non-default props are included.
 *
 * @param  {object} matJSON  material record from scene.toJSON().materials[]
 *                           or live THREE.Material (needs .toJSON().materials[0])
 * @returns {string}  e.g. "{ color: 0xff0000, roughness: 0.5 }"
 */
export function materialToOptions( matJSON ) {

	const type   = matJSON.type;
	const table  = MATERIAL_PROPS[ type ] ?? MATERIAL_PROPS.MeshStandardMaterial;
	const parts  = [];

	for ( const [ key, spec ] of Object.entries( table ) ) {

		if ( spec.format === 'skip' ) continue;

		const val = matJSON[ key ];

		if ( val === undefined || val === null ) continue;

		// Skip defaults
		if ( val === spec.default ) continue;

		// Float comparison with tolerance
		if ( spec.format === 'float' && typeof val === 'number' && typeof spec.default === 'number' ) {

			if ( Math.abs( val - spec.default ) < 1e-6 ) continue;

		}

		const emitted = formatValue( val, spec.format );
		if ( emitted === null ) continue;

		parts.push( `${key}: ${emitted}` );

	}

	if ( parts.length === 0 ) return '{}';
	return '{ ' + parts.join( ', ' ) + ' }';

}

/**
 * Returns true if a material type is supported by codegen (has a known table).
 */
export function isSupportedMaterial( type ) {

	return type in MATERIAL_PROPS;

}
