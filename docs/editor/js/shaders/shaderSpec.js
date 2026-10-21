// ── shaderSpec.js ─────────────────────────────────────────────────────────────
// The shader registry, pure (no DOM, no renderer, no three.js), so the Shader tab,
// the shell and the node tests all validate parameters the same way without a GPU.
// The material work lives in ShaderLibrary.js, which looks each id up here.
//
// A shader definition: { id, label, group, desc, persist, params: [ ... ] }
//   persist  'native'  serialises as itself (a stock three.js material type)
//            'twin'    a node material; serialises as a standard-material twin and is rebuilt on load
// A param: { key, label, type: 'color' | 'number' | 'boolean' | 'select', default, min, max, step, options }
// A definition may also carry `nested`: the grouped spelling of some params (MToon's rim / outline).
//
// Every route (shader(), mtoon(), toon() / the look spec, the Shader tab) validates through
// normalizeShaderParams, so one spec means one thing everywhere: flat and nested keys may be mixed,
// unknown keys are refused with a suggestion, numbers are clamped to their range.
//
// Colors are written as "#rrggbb" or "#rgb" (a 0xrrggbb number is accepted and normalised).

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
			num( 'rimLift', 'Rim lift', 0, 0, 1, 0.01 ),
			num( 'rimMix', 'Rim lighting mix', 0, 0, 1, 0.01 ),
			num( 'outlineWidth', 'Outline width', 0.002, 0, 0.05, 0.0005 ),
			color( 'outlineColor', 'Outline color', '#1a0f14' ),
			select( 'outlineMode', 'Outline mode', 'world', [ 'world', 'screen', 'none' ] ),
			num( 'outlineMix', 'Outline lighting mix', 1, 0, 1, 0.01 ),
		],
		// The nested form toon() / the `look` spec use: group → { nested key → flat key }
		nested: {
			rim: { color: 'rimColor', power: 'rimPower', lift: 'rimLift', mix: 'rimMix' },
			outline: { width: 'outlineWidth', color: 'outlineColor', mode: 'outlineMode', mix: 'outlineMix' },
		},
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

	return SHADERS.map( s => {

		const out = { id: s.id, label: s.label, group: s.group, persist: s.persist, desc: s.desc, params: s.params.map( p => ( { ...p } ) ) };
		if ( s.nested ) out.nested = JSON.parse( JSON.stringify( s.nested ) );
		return out;

	} );

}

/** The alias spellings that resolve to a shader id (for docs and help). */
export function aliasesOf( id ) {

	return Object.keys( ALIASES ).filter( a => ALIASES[ a ] === id );

}

export function defaultParams( id ) {

	const def = getShaderDef( id );
	if ( ! def ) return null;
	const out = {};
	for ( const p of def.params ) out[ p.key ] = p.default;
	return out;

}

// ── Did-you-mean ──────────────────────────────────────────────────────────────

const squash = s => String( s ).toLowerCase().replace( /[^a-z0-9]/g, '' );

function editDistance( a, b ) {

	let prev = Array.from( { length: b.length + 1 }, ( _, i ) => i );
	for ( let i = 1; i <= a.length; i ++ ) {

		const row = [ i ];
		for ( let j = 1; j <= b.length; j ++ ) row[ j ] = Math.min( prev[ j ] + 1, row[ j - 1 ] + 1, prev[ j - 1 ] + ( a[ i - 1 ] === b[ j - 1 ] ? 0 : 1 ) );
		prev = row;

	}
	return prev[ b.length ];

}

/** The closest candidate to `word` (case, `_`, `-` and `.` ignored), or null when nothing is close. */
export function didYouMean( word, candidates ) {

	const w = squash( word );
	if ( ! w ) return null;
	let best = null, bestD = Infinity;
	for ( const c of candidates ) {

		const d = editDistance( w, squash( c ) );
		if ( d < bestD ) { best = c; bestD = d; }

	}
	return best !== null && bestD <= Math.max( 1, Math.floor( w.length / 3 ) ) ? best : null;

}

/** "shader: unknown shader "x" — did you mean "y"? ..." One wording for every route. */
export function unknownShaderMessage( id ) {

	const names = [ ...BY_ID.keys(), ...Object.keys( ALIASES ) ];
	const near = typeof id === 'string' ? didYouMean( id, names ) : null;
	return `shader: unknown shader ${ JSON.stringify( id ) }${ near ? ` — did you mean "${ near }"?` : '.' } Call shaders() for the list.`;

}

/** The legal spellings for a shader's params, flat and nested, as one line. */
export function legalParamsText( def ) {

	const flat = def.params.map( p => p.key ).join( ', ' ) || 'none';
	if ( ! def.nested ) return flat;
	const groups = Object.entries( def.nested ).map( ( [ g, keys ] ) => `${ g }:{ ${ Object.keys( keys ).join( ', ' ) } }` ).join( ', ' );
	return `flat: ${ flat }; nested: ${ groups } (flat and nested can be mixed)`;

}

function unknownParamMessage( def, key, group ) {

	const full = group ? `${ group }.${ key }` : key;
	const nestedPaths = Object.entries( def.nested || {} ).flatMap( ( [ g, keys ] ) => Object.keys( keys ).map( k => `${ g }.${ k }` ) );
	const pool = group ? Object.keys( def.nested[ group ] ).map( k => `${ group }.${ k }` ) : [ ...def.params.map( p => p.key ), ...Object.keys( def.nested || {} ), ...nestedPaths ];
	const near = didYouMean( full, pool );
	return `${ def.id }: unknown param "${ full }"${ near ? ` — did you mean "${ near }"?` : '.' } Legal: ${ legalParamsText( def ) }`;

}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor( v ) {

	if ( typeof v === 'number' && Number.isInteger( v ) && v >= 0 && v <= 0xffffff ) return '#' + v.toString( 16 ).padStart( 6, '0' );
	if ( typeof v === 'string' ) {

		const m = HEX.exec( v.trim() );
		if ( m ) return '#' + ( m[ 1 ].length === 3 ? [ ...m[ 1 ] ].map( c => c + c ).join( '' ) : m[ 1 ] ).toLowerCase();

	}
	return null;

}

const isPlainObject = v => v !== null && typeof v === 'object' && ! Array.isArray( v );

// Spellings that are not params of their own: a look spec's `look: "toon"` and `bands: 2`.
const SUGAR = {

	mtoon: {

		look( v, add, errors ) {

			if ( v === 'native' ) errors.push( 'mtoon: look "native" removes the look; use unshader( target ) or toon( target, { look: \'native\' } )' );
			else if ( v !== 'toon' ) errors.push( `mtoon: "look" must be "toon" (or "native" in toon()), got ${ JSON.stringify( v ) }` );

		},

		bands( v, add, errors ) {

			if ( v === 2 ) add( 'toony', 1, 'bands' );
			else errors.push( 'mtoon.bands: must be 2 (two hard tones, lit / shade); MToon has no 3+ band ramp — use toony for a softer edge' );

		},

	},

};

/** Flat key → { value, label } from a spec that may be flat, nested or both; pushes the problems it finds. */
function gatherParams( def, src, errors ) {

	const flat = new Map();
	const nested = def.nested || {};
	const sugar = SUGAR[ def.id ] || {};
	const known = new Set( def.params.map( p => p.key ) );

	const add = ( key, value, label ) => {

		if ( value === undefined ) return;
		const had = flat.get( key );
		if ( had && had.value !== value ) errors.push( `${ def.id }: "${ had.label }" and "${ label }" set the same thing to different values; give it once` );
		else if ( ! had ) flat.set( key, { value, label } );

	};

	for ( const [ k, v ] of Object.entries( src ) ) {

		if ( known.has( k ) ) add( k, v, k );
		else if ( nested[ k ] ) {

			if ( v === undefined ) continue;
			if ( ! isPlainObject( v ) ) { errors.push( `${ def.id }.${ k }: expected an object like { ${ Object.keys( nested[ k ] ).join( ', ' ) } }` ); continue; }
			for ( const [ nk, nv ] of Object.entries( v ) ) {

				if ( nested[ k ][ nk ] ) add( nested[ k ][ nk ], nv, `${ k }.${ nk }` );
				else errors.push( unknownParamMessage( def, nk, k ) );

			}

		} else if ( sugar[ k ] ) sugar[ k ]( v, add, errors );
		else errors.push( unknownParamMessage( def, k ) );

	}

	return flat;

}

/**
 * Validate `input` against a shader's parameter schema. Missing keys take defaults when
 * `fill` is true (the default); numbers are clamped to the range; unknown keys and wrong
 * types are errors. With fill false only the keys given come back (MToon uses this so a
 * file's own values survive). MToon's spec may be flat (rimColor), nested (rim: { color })
 * or a mix; `params` always comes back flat. Returns { ok, params, errors }.
 */
export function normalizeShaderParams( id, input, fill = true ) {

	const def = getShaderDef( id );
	if ( ! def ) return { ok: false, params: null, errors: [ unknownShaderMessage( id ) ] };

	const src = input === undefined || input === null ? {} : input;
	if ( ! isPlainObject( src ) ) return { ok: false, params: null, errors: [ `${ def.id }: params must be an object (legal: ${ legalParamsText( def ) })` ] };

	const errors = [];
	const params = {};
	const given = gatherParams( def, src, errors );

	for ( const p of def.params ) {

		const entry = given.get( p.key );
		if ( entry === undefined ) { if ( fill ) params[ p.key ] = p.default; continue; }
		const { value: v, label } = entry;
		const at = `${ def.id }.${ label }`;

		if ( p.type === 'color' ) {

			const c = normalizeColor( v );
			if ( c ) params[ p.key ] = c; else errors.push( `${ at }: expected a color like "#ff8800" or 0xff8800, got ${ JSON.stringify( v ) }` );

		} else if ( p.type === 'number' ) {

			if ( typeof v === 'number' && Number.isFinite( v ) ) params[ p.key ] = Math.min( p.max, Math.max( p.min, v ) );
			else errors.push( `${ at }: expected a number (${ p.min } to ${ p.max }), got ${ JSON.stringify( v ) }` );

		} else if ( p.type === 'select' ) {

			if ( p.options.includes( v ) ) params[ p.key ] = v; else errors.push( `${ at }: expected one of ${ p.options.join( ', ' ) }, got ${ JSON.stringify( v ) }` );

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
	if ( g.rimLift !== undefined ) rim.lift = g.rimLift;
	if ( g.rimMix !== undefined ) rim.mix = g.rimMix;
	if ( Object.keys( rim ).length ) spec.rim = rim;

	const outline = {};
	if ( g.outlineWidth !== undefined ) outline.width = g.outlineWidth;
	if ( g.outlineColor !== undefined ) outline.color = g.outlineColor;
	if ( g.outlineMode !== undefined ) outline.mode = g.outlineMode;
	if ( g.outlineMix !== undefined ) outline.mix = g.outlineMix;
	if ( Object.keys( outline ).length ) spec.outline = outline;

	return spec;

}

/**
 * toon()'s argument: a mode string or a spec with `look` / `mode` ("toon" by default, or "native" to revert).
 * Returns { look, params } with the rest of the spec, still unvalidated; the caller runs it through
 * normalizeShaderParams like any other mtoon spec. Throws on a mode that is neither.
 */
export function splitLookSpec( spec ) {

	if ( spec === undefined || spec === null ) return { look: 'toon', params: {} };
	if ( typeof spec === 'string' ) return splitLookSpec( { look: spec } );
	if ( ! isPlainObject( spec ) ) throw new Error( 'toon: the spec must be an object such as { shade: \'#3a2c5a\', rim: { color: \'#fff\' } }, or \'native\'' );

	const { look, mode, ...params } = spec;
	const which = look !== undefined ? look : mode !== undefined ? mode : 'toon';
	if ( which !== 'toon' && which !== 'native' ) throw new Error( `toon: look must be "toon" or "native", got ${ JSON.stringify( which ) }` );
	return { look: which, params };

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
