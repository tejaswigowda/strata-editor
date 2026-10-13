// ── shaderSpec.js ─────────────────────────────────────────────────────────────
// The shader registry, pure (no DOM, no renderer, no three.js), so the Shader tab,
// the shell and the node tests all validate parameters the same way without a GPU.
// The material work lives in ShaderLibrary.js, which looks each id up here.
//
// A shader definition: { id, label, group, desc, persist, params: [ ... ] }
//   persist  'native'  serialises as itself (a stock three.js material type)
//            'twin'    a node material; serialises as a standard-material twin and is rebuilt on load
// A param: { key, label, type: 'color' | 'number' | 'boolean' | 'select', default, min, max, step, options }
//
// Colors are written as "#rrggbb" (a 0xrrggbb number is accepted and normalised).

const color = ( key, label, def ) => ( { key, label, type: 'color', default: def } );
const num = ( key, label, def, min, max, step ) => ( { key, label, type: 'number', default: def, min, max, step } );
const select = ( key, label, def, options ) => ( { key, label, type: 'select', default: def, options } );

export const SHADER_GROUPS = [ 'Toon', 'Surface', 'Stylized', 'Effects', 'Debug' ];

export const SHADERS = [

	{
		id: 'mtoon', label: 'MToon (VRM anime toon)', group: 'Toon', persist: 'twin',
		desc: 'Light-responsive banded toon with rim light and inverted-hull outlines, the VRM MToon model.',
		params: [
			color( 'shade', 'Shade color', '#8a7fb0' ),
			num( 'shift', 'Shading shift', 0, - 1, 1, 0.01 ),
			num( 'toony', 'Toonyness', 0.9, 0, 1, 0.01 ),
			color( 'rimColor', 'Rim color', '#ffffff' ),
			num( 'rimPower', 'Rim power', 5, 0.1, 20, 0.1 ),
			num( 'rimMix', 'Rim lighting mix', 0, 0, 1, 0.01 ),
			num( 'outlineWidth', 'Outline width', 0.002, 0, 0.05, 0.0005 ),
			color( 'outlineColor', 'Outline color', '#1a0f14' ),
		],
	},
	{
		id: 'toon-basic', label: 'Three.js toon (stepped)', group: 'Toon', persist: 'native',
		desc: 'The stock MeshToonMaterial: a plain stepped ramp, no outline.',
		params: [],
	},

	{ id: 'standard', label: 'Standard (PBR)', group: 'Surface', persist: 'native', desc: 'Physically based metal / roughness.',
		params: [ num( 'roughness', 'Roughness', 0.8, 0, 1, 0.01 ), num( 'metalness', 'Metalness', 0, 0, 1, 0.01 ) ] },
	{ id: 'physical', label: 'Physical (clearcoat)', group: 'Surface', persist: 'native', desc: 'Standard plus clearcoat.',
		params: [ num( 'roughness', 'Roughness', 0.5, 0, 1, 0.01 ), num( 'metalness', 'Metalness', 0, 0, 1, 0.01 ), num( 'clearcoat', 'Clearcoat', 1, 0, 1, 0.01 ) ] },
	{ id: 'lambert', label: 'Lambert (matte)', group: 'Surface', persist: 'native', desc: 'Cheap diffuse-only lighting.', params: [] },
	{ id: 'phong', label: 'Phong (glossy)', group: 'Surface', persist: 'native', desc: 'Classic specular highlight.',
		params: [ num( 'shininess', 'Shininess', 30, 0, 200, 1 ), color( 'specular', 'Specular color', '#111111' ) ] },
	{ id: 'basic', label: 'Unlit (flat color)', group: 'Surface', persist: 'native', desc: 'Ignores lights; shows the color and texture as they are.', params: [] },

	{
		id: 'gradient', label: 'Gradient', group: 'Stylized', persist: 'twin',
		desc: 'A two-color blend along one world axis, multiplied into the original texture.',
		params: [
			color( 'colorA', 'From color', '#ff7a59' ),
			color( 'colorB', 'To color', '#3b2a7a' ),
			select( 'axis', 'Axis', 'y', [ 'x', 'y', 'z' ] ),
			num( 'from', 'From', 0, - 1000, 1000, 0.01 ),
			num( 'to', 'To', 1, - 1000, 1000, 0.01 ),
		],
	},

	{
		id: 'fresnel', label: 'Fresnel rim glow', group: 'Effects', persist: 'twin',
		desc: 'Keeps the original lit look and adds a glowing edge that brightens at grazing angles.',
		params: [
			color( 'color', 'Glow color', '#4fd2ff' ),
			num( 'power', 'Power', 3, 0.1, 10, 0.1 ),
			num( 'intensity', 'Intensity', 1.5, 0, 10, 0.05 ),
		],
	},
	{
		id: 'hologram', label: 'Hologram', group: 'Effects', persist: 'twin',
		desc: 'Translucent additive scan lines with a fresnel edge.',
		params: [
			color( 'color', 'Color', '#44ddff' ),
			num( 'speed', 'Scroll speed', 1, - 10, 10, 0.1 ),
			num( 'lines', 'Line density', 60, 1, 400, 1 ),
			num( 'opacity', 'Opacity', 0.7, 0, 1, 0.01 ),
		],
	},

	{ id: 'normal', label: 'Normals', group: 'Debug', persist: 'native', desc: 'Shows the surface normal as color.', params: [] },
	{ id: 'wireframe', label: 'Wireframe', group: 'Debug', persist: 'native', desc: 'Unlit wireframe.', params: [ color( 'color', 'Color', '#00ff88' ) ] },

];

const BY_ID = new Map( SHADERS.map( s => [ s.id, s ] ) );

const ALIASES = {
	toon: 'mtoon', vrm: 'mtoon', anime: 'mtoon',
	unlit: 'basic', flat: 'basic', pbr: 'standard', rim: 'fresnel', holo: 'hologram',
	'three-toon': 'toon-basic', cel: 'toon-basic', normals: 'normal', wire: 'wireframe',
};

export function getShaderDef( id ) {

	if ( typeof id !== 'string' ) return null;
	const key = id.trim().toLowerCase();
	return BY_ID.get( ALIASES[ key ] || key ) || null;

}

/** What the shell's shaders() and the UI list: no functions, safe to JSON. */
export function listShaders() {

	return SHADERS.map( s => ( { id: s.id, label: s.label, group: s.group, persist: s.persist, desc: s.desc, params: s.params.map( p => ( { ...p } ) ) } ) );

}

export function defaultParams( id ) {

	const def = getShaderDef( id );
	if ( ! def ) return null;
	const out = {};
	for ( const p of def.params ) out[ p.key ] = p.default;
	return out;

}

const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeColor( v ) {

	if ( typeof v === 'number' && Number.isInteger( v ) && v >= 0 && v <= 0xffffff ) return '#' + v.toString( 16 ).padStart( 6, '0' );
	if ( typeof v === 'string' ) {

		const m = HEX.exec( v.trim() );
		if ( m ) return '#' + m[ 1 ].toLowerCase();

	}
	return null;

}

/**
 * Validate `input` against a shader's parameter schema. Missing keys take defaults when
 * `fill` is true (the default); numbers are clamped to the range; unknown keys and wrong
 * types are errors. With fill false only the keys given come back (MToon uses this so a
 * file's own values survive). Returns { ok, params, errors }.
 */
export function normalizeShaderParams( id, input, fill = true ) {

	const def = getShaderDef( id );
	if ( ! def ) return { ok: false, params: null, errors: [ `unknown shader "${ id }"` ] };

	const src = input === undefined || input === null ? {} : input;
	if ( typeof src !== 'object' || Array.isArray( src ) ) return { ok: false, params: null, errors: [ 'params must be an object' ] };

	const errors = [];
	const params = {};
	const known = new Set( def.params.map( p => p.key ) );
	for ( const k of Object.keys( src ) ) if ( ! known.has( k ) ) errors.push( `${ def.id }: unknown param "${ k }" (known: ${ [ ...known ].join( ', ' ) || 'none' })` );

	for ( const p of def.params ) {

		const v = src[ p.key ];
		if ( v === undefined ) { if ( fill ) params[ p.key ] = p.default; continue; }

		if ( p.type === 'color' ) {

			const c = normalizeColor( v );
			if ( c ) params[ p.key ] = c; else errors.push( `${ def.id }.${ p.key }: expected a color like "#ff8800"` );

		} else if ( p.type === 'number' ) {

			if ( typeof v === 'number' && Number.isFinite( v ) ) params[ p.key ] = Math.min( p.max, Math.max( p.min, v ) );
			else errors.push( `${ def.id }.${ p.key }: expected a number` );

		} else if ( p.type === 'select' ) {

			if ( p.options.includes( v ) ) params[ p.key ] = v; else errors.push( `${ def.id }.${ p.key }: expected one of ${ p.options.join( ', ' ) }` );

		}

	}

	return errors.length ? { ok: false, params: null, errors } : { ok: true, params, errors: [] };

}

/** MToon params → the `look` spec ToonLook understands. Only the keys given are forwarded. */
export function mtoonLookSpec( given ) {

	const g = given || {};
	const spec = { look: 'toon' };
	if ( g.shade !== undefined ) spec.shade = g.shade;
	if ( g.shift !== undefined ) spec.shift = g.shift;
	if ( g.toony !== undefined ) spec.toony = g.toony;

	const rim = {};
	if ( g.rimColor !== undefined ) rim.color = g.rimColor;
	if ( g.rimPower !== undefined ) rim.power = g.rimPower;
	if ( g.rimMix !== undefined ) rim.mix = g.rimMix;
	if ( Object.keys( rim ).length ) spec.rim = rim;

	const outline = {};
	if ( g.outlineWidth !== undefined ) outline.width = g.outlineWidth;
	if ( g.outlineColor !== undefined ) outline.color = g.outlineColor;
	if ( Object.keys( outline ).length ) spec.outline = outline;

	return spec;

}

/** The nested look form toon() takes ({ rim: { color }, outline: { width } }) → the flat mtoon params. Flat keys pass through. */
export function flattenMtoon( spec ) {

	if ( ! spec || typeof spec !== 'object' || Array.isArray( spec ) ) return spec;
	const { look, rim, outline, ...rest } = spec;
	const out = { ...rest };
	if ( rim && typeof rim === 'object' ) {

		if ( rim.color !== undefined ) out.rimColor = rim.color;
		if ( rim.power !== undefined ) out.rimPower = rim.power;
		if ( rim.mix !== undefined ) out.rimMix = rim.mix;

	}
	if ( outline && typeof outline === 'object' ) {

		if ( outline.width !== undefined ) out.outlineWidth = outline.width;
		if ( outline.color !== undefined ) out.outlineColor = outline.color;

	}
	return out;

}

/** True for a mesh / material name that marks a baked outline pass ("Object_outline_0", "outline"). */
export function isOutlineName( name ) {

	return typeof name === 'string' && /outline/i.test( name );

}

export const SCOPES = [ 'tree', 'self', 'scene' ];

/** True when a loaded scene holds a non-node material tagged with userData.shader (a twin to rebuild). */
export function sceneHasShaders( scene ) {

	let found = false;
	scene.traverse( o => {

		if ( found || ! o.isMesh ) return;
		for ( const m of [].concat( o.material ) ) if ( m && m.userData && m.userData.shader && ! m.isNodeMaterial ) { found = true; return; }

	} );
	return found;

}
