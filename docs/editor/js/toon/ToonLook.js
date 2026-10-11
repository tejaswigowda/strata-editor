// ── ToonLook.js ───────────────────────────────────────────────────────────────
// Anime toon render mode for the WebGPU renderer: light-responsive banded toon
// (MToon) with a rim term and inverted-hull outlines, honouring the MToon block a
// VRM file already carries (shade colour, shading shift / toony, rim, outline) —
// which stock glTF loading discards.
//
// Route B1 (see guides/TOON_LOOK.md): the MToon *node material* from
// @pixiv/three-vrm (v3, WebGPU / TSL) plus its VRM 0.x → MToon 1.0 compat plugin,
// vendored under examples/jsm/libs/three-vrm/. Only the MATERIAL packages are
// loaded, never the humanoid / spring-bone runtime: this swaps materials and adds
// outline draw groups, and touches no vertex, skin weight, skeleton or morph
// target (the customizer's rig invariant; customize/rigSafety.js hashes exactly
// those). bodyrig / facerig are unaffected.
//
//   • registerToonPlugins(loader)   GLTFLoader plugins: VRM file → MToonNodeMaterial
//   • applyToonLook(root, spec)     convert any character / prop to toon + apply overrides
//   • restoreLooks(scene)           re-hydrate after a scene load (see "persistence")
//   • toonMaterial(color, opts)     a standalone toon material for a new prop
//
// Persistence. A node material is not a serialisable three.js material type, so
// each toon material serialises as a MeshStandardMaterial carrying the same
// textures plus its MToon parameters in userData.toon. Stock loaders (and older
// builds) still open the scene as lit PBR; Strata rebuilds the MToon material
// from it on load. The extra MToon textures ride in otherwise-unused standard
// slots (SLOT_MAP below), neutralised so the fallback looks sane.
//
// One shading model per frame: the character and every prop under it use the
// same toon material under the same lights (applyLookToProp in toonSpec.js).

import * as THREE from 'three';
import { MToonNodeMaterial } from '@pixiv/three-vrm-materials-mtoon/nodes';
import { MToonMaterialLoaderPlugin } from '@pixiv/three-vrm-materials-mtoon';
import { VRMMaterialsV0CompatPlugin } from '@pixiv/three-vrm-materials-v0compat';
import { registerLookApplier, normalizeLook, OUTLINE_MODES, sceneHasToon } from './toonSpec.js';

export { MToonNodeMaterial };

export const isToon = m => !! ( m && m.isMToonNodeMaterial );

const WHITE = new THREE.Color( 1, 1, 1 );

// Defaults for a character that has no MToon block of its own.
const DEFAULTS = {
	shift: 0,
	toony: 0.9,
	outline: { width: 0.002, color: '#1a0f14', mode: 'world', mix: 1 },
};

// MToon texture → the (otherwise unused) standard-material slot that carries it
// through scene.toJSON(); the fallback intensities are neutralised in toStandardProxy.
const SLOT_MAP = [
	[ 'shadeMultiplyTexture', 'lightMap' ],
	[ 'rimMultiplyTexture', 'roughnessMap' ],
	[ 'matcapTexture', 'metalnessMap' ],
	[ 'outlineWidthMultiplyTexture', 'displacementMap' ],
	[ 'shadingShiftTexture', 'bumpMap' ],
];

const originals = new WeakMap(); // mesh → the materials it had before toon
const originalGroups = new WeakMap(); // geometry → its groups before outlines

// ── Loading ───────────────────────────────────────────────────────────────────

/** True for a VRM (0.x or 1.0) GLB / glTF buffer or JSON string: has an MToon block to honour. */
export { isVRMSource } from './toonSpec.js';

/** Register the MToon material plugins on a GLTFLoader (VRM 0.x is converted to the 1.0 form first). */
export function registerToonPlugins( loader ) {

	loader.register( parser => new VRMMaterialsV0CompatPlugin( parser ) );
	loader.register( parser => new MToonMaterialLoaderPlugin( parser, { materialType: MToonNodeMaterial } ) );
	return loader;

}

/**
 * Called on a freshly loaded VRM scene: marks the toon materials (so they
 * serialise / restore), and records the character's look so props added later
 * follow it.
 */
export function adoptLoadedToon( scene ) {

	let count = 0;
	scene.traverse( o => { if ( o.isMesh ) for ( const m of [].concat( o.material ) ) if ( isToon( m ) ) { install( m ); count ++; } } );
	if ( count > 0 ) { scene.userData = scene.userData || {}; if ( ! scene.userData.look ) scene.userData.look = { look: 'toon' }; }
	return count;

}

// ── Material (de)serialisation ────────────────────────────────────────────────

const rgb = c => [ c.r, c.g, c.b ];
const setRGB = ( c, a ) => c.setRGB( a[ 0 ], a[ 1 ], a[ 2 ], THREE.LinearSRGBColorSpace );

function snapshot( m ) {

	return {
		v: 1,
		outline: !! m.isOutline,
		shade: rgb( m.shadeColorFactor ), shift: m.shadingShiftFactor, toony: m.shadingToonyFactor,
		rimColor: rgb( m.parametricRimColorFactor ), rimPower: m.parametricRimFresnelPowerFactor, rimLift: m.parametricRimLiftFactor, rimMix: m.rimLightingMixFactor,
		outlineMode: m.outlineWidthMode, outlineWidth: m.outlineWidthFactor, outlineColor: rgb( m.outlineColorFactor ), outlineMix: m.outlineLightingMixFactor,
		shadingShiftScale: m.shadingShiftTextureScale,
	};

}

function restoreParams( m, p ) {

	setRGB( m.shadeColorFactor, p.shade );
	m.shadingShiftFactor = p.shift; m.shadingToonyFactor = p.toony;
	setRGB( m.parametricRimColorFactor, p.rimColor ); m.parametricRimFresnelPowerFactor = p.rimPower; m.parametricRimLiftFactor = p.rimLift; m.rimLightingMixFactor = p.rimMix;
	m.outlineWidthMode = p.outlineMode; m.outlineWidthFactor = p.outlineWidth; setRGB( m.outlineColorFactor, p.outlineColor ); m.outlineLightingMixFactor = p.outlineMix;
	if ( p.shadingShiftScale !== undefined ) m.shadingShiftTextureScale = p.shadingShiftScale;
	m.isOutline = !! p.outline;

}

/** The standard-material twin of a toon material: what scene.toJSON() writes, and what "native" reverts to. */
export function toStandardProxy( m ) {

	const p = new THREE.MeshStandardMaterial();
	p.uuid = m.uuid; p.name = m.name;
	p.color.copy( m.color ); p.map = m.map || null;
	p.normalMap = m.normalMap || null; p.normalScale.copy( m.normalScale );
	p.emissive.copy( m.emissive ); p.emissiveIntensity = m.emissiveIntensity; p.emissiveMap = m.emissiveMap || null;
	p.alphaMap = m.alphaMap || null;
	p.side = m.side; p.transparent = m.transparent; p.opacity = m.opacity; p.alphaTest = m.alphaTest;
	p.depthWrite = m.depthWrite; p.depthTest = m.depthTest; p.blending = m.blending; p.visible = m.visible;
	p.roughness = 1; p.metalness = 0;

	for ( const [ toonSlot, stdSlot ] of SLOT_MAP ) if ( m[ toonSlot ] ) p[ stdSlot ] = m[ toonSlot ];
	p.lightMapIntensity = 0; p.bumpScale = 0; p.displacementScale = 0; p.displacementBias = 0;

	p.userData = { ...m.userData, toon: snapshot( m ) };
	return p;

}

function fromStandardProxy( p ) {

	const m = new MToonNodeMaterial();
	m.uuid = p.uuid; m.name = p.name;
	m.color.copy( p.color ); m.map = p.map || null;
	m.normalMap = p.normalMap || null; m.normalScale.copy( p.normalScale );
	m.emissive.copy( p.emissive ); m.emissiveIntensity = p.emissiveIntensity; m.emissiveMap = p.emissiveMap || null;
	if ( p.alphaMap ) m.alphaMap = p.alphaMap;
	m.side = p.side; m.transparent = p.transparent; m.opacity = p.opacity; m.alphaTest = p.alphaTest;
	m.depthWrite = p.depthWrite; m.depthTest = p.depthTest; m.blending = p.blending; m.visible = p.visible;

	for ( const [ toonSlot, stdSlot ] of SLOT_MAP ) if ( p[ stdSlot ] ) m[ toonSlot ] = p[ stdSlot ];
	restoreParams( m, p.userData.toon );

	m.userData = { ...p.userData };
	delete m.userData.toon;
	return install( m );

}

/** Make a toon material serialise as its standard-material twin (see "Persistence" above). */
function install( m ) {

	m.userData = m.userData || {};
	m.userData.toon = true;
	m.toJSON = function ( meta ) {

		return toStandardProxy( this ).toJSON( meta );

	};

	// the loader's own clone() (used for the outline pass) must carry the serialiser too
	const clone = m.clone.bind( m );
	m.clone = function () { return install( clone() ); };
	return m;

}

// ── Conversion of a non-toon material ─────────────────────────────────────────

function shadeFrom( color, hasMap ) {

	return hasMap
		? new THREE.Color( 0.58, 0.52, 0.72 ) // multiplied into the albedo map as the shade texture
		: new THREE.Color( color.r * 0.5 + 0.01, color.g * 0.45 + 0.01, color.b * 0.6 + 0.04 );

}

function toToon( old ) {

	if ( isToon( old ) ) return old;

	const m = new MToonNodeMaterial();
	m.name = old.name || '';
	m.color.copy( old.color || WHITE );
	m.map = old.map || null;
	if ( old.normalMap ) { m.normalMap = old.normalMap; if ( old.normalScale ) m.normalScale.copy( old.normalScale ); }
	if ( old.emissive ) { m.emissive.copy( old.emissive ); m.emissiveIntensity = old.emissiveIntensity ?? 1; m.emissiveMap = old.emissiveMap || null; }
	if ( old.alphaMap ) m.alphaMap = old.alphaMap;
	m.side = old.side; m.transparent = old.transparent; m.opacity = old.opacity; m.alphaTest = old.alphaTest;
	m.depthWrite = old.depthWrite; m.depthTest = old.depthTest; m.visible = old.visible;

	m.shadeColorFactor.copy( shadeFrom( m.color, !! m.map ) );
	if ( m.map ) m.shadeMultiplyTexture = m.map;
	m.shadingShiftFactor = DEFAULTS.shift;
	m.shadingToonyFactor = DEFAULTS.toony;
	m.rimLightingMixFactor = 0;
	m.userData = { ...( old.userData || {} ) };
	return install( m );

}

// ── Parameters ────────────────────────────────────────────────────────────────

function applyParams( m, spec ) {

	if ( spec.shade !== undefined ) m.shadeColorFactor.set( spec.shade );
	if ( spec.shift !== undefined ) m.shadingShiftFactor = spec.shift;
	if ( spec.toony !== undefined ) m.shadingToonyFactor = spec.toony;

	if ( spec.rim ) {

		if ( spec.rim.color !== undefined ) m.parametricRimColorFactor.set( spec.rim.color );
		if ( spec.rim.power !== undefined ) m.parametricRimFresnelPowerFactor = spec.rim.power;
		if ( spec.rim.lift !== undefined ) m.parametricRimLiftFactor = spec.rim.lift;
		if ( spec.rim.mix !== undefined ) m.rimLightingMixFactor = spec.rim.mix;

	}

	if ( spec.outline ) {

		const o = spec.outline;
		if ( o.mode !== undefined ) m.outlineWidthMode = OUTLINE_MODES[ o.mode ];
		if ( o.width !== undefined ) m.outlineWidthFactor = o.width;
		if ( o.color !== undefined ) m.outlineColorFactor.set( o.color );
		if ( o.mix !== undefined ) m.outlineLightingMixFactor = o.mix;

	}

	m.needsUpdate = true;

}

// ── Outlines (inverted hull) ──────────────────────────────────────────────────
// A second, back-face-culled copy of each surface material, drawn from a second
// draw group over the same triangles and pushed outward along the normal in the
// vertex shader — MToon's own method, so per-material width and colour apply.
// Only geometry.groups changes; vertices, weights, skeleton and morphs do not.

function ensureOutlines( mesh, outlineSpec ) {

	const mats = [].concat( mesh.material );
	if ( mats.some( m => m.isOutline ) ) return mats;

	const surfaces = mats.filter( isToon );
	if ( surfaces.length !== mats.length ) return mats;

	const geometry = mesh.geometry;
	const total = geometry.index ? geometry.index.count : geometry.attributes.position.count;
	const groups = geometry.groups.length ? geometry.groups.map( g => ( { start: g.start, count: g.count, materialIndex: g.materialIndex } ) ) : [ { start: 0, count: total, materialIndex: 0 } ];
	if ( ! originalGroups.has( geometry ) ) originalGroups.set( geometry, geometry.groups.map( g => ( { start: g.start, count: g.count, materialIndex: g.materialIndex } ) ) );

	const outlines = surfaces.map( s => {

		const o = s.clone();
		o.name = ( s.name || 'toon' ) + ' (Outline)';
		o.isOutline = true;
		o.side = THREE.BackSide;
		applyParams( o, { outline: { ...DEFAULTS.outline, ...( outlineSpec || {} ) } } );
		return o;

	} );

	const n = surfaces.length;
	geometry.clearGroups();
	for ( const g of groups ) geometry.addGroup( g.start, g.count, g.materialIndex );
	for ( const g of groups ) geometry.addGroup( g.start, g.count, n + g.materialIndex );

	// the caller assigns mesh.material (so a recorder can undo it); only the draw groups change here
	return [ ...surfaces, ...outlines ];

}

// ── Apply / revert ────────────────────────────────────────────────────────────

/**
 * Turn `root` (a character, or a single prop) toon, then apply the spec's overrides.
 * options.swap(mesh, material|materials) routes the material change through a
 * recorder (the customizer's undo); default is a direct assignment.
 */
export function applyToonLook( root, input, options = {} ) {

	const n = normalizeLook( input );
	if ( ! n.ok ) throw new Error( n.errors.join( '; ' ) );
	const spec = n.spec;
	const swap = options.swap || ( ( mesh, mat ) => { mesh.material = mat; } );

	if ( spec.look === 'native' ) return revertToonLook( root, options );

	root.userData = root.userData || {};
	root.userData.look = spec;

	root.traverse( mesh => {

		if ( ! mesh.isMesh || ! mesh.material || ( mesh.userData && mesh.userData.noToon ) ) return;

		const before = [].concat( mesh.material );
		const converted = before.map( m => ( m.isOutline ? m : toToon( m ) ) );
		const changed = converted.some( ( m, i ) => m !== before[ i ] );

		if ( changed ) {

			if ( ! originals.has( mesh ) ) originals.set( mesh, mesh.material );
			swap( mesh, Array.isArray( mesh.material ) ? converted : converted[ 0 ] );

		}

		// outlines: a converted material gets one by default; a VRM already has the file's own;
		// outline.width = 0 switches them off (the draw group stays, the pass is hidden)
		const outlinesWanted = ! ( spec.outline && spec.outline.width === 0 );
		const hasOutline = [].concat( mesh.material ).some( m => m.isOutline );

		if ( ! hasOutline && outlinesWanted && ! mesh.isPoints && ! mesh.isLine && ( changed || ( spec.outline && spec.outline.width > 0 ) ) ) {

			swap( mesh, ensureOutlines( mesh, spec.outline ) );

		}

		// the same overrides go to the surface and its outline copy, so the pair stays consistent
		for ( const m of [].concat( mesh.material ) ) {

			applyParams( m, spec );
			if ( m.isOutline ) m.visible = outlinesWanted;

		}

	} );

	return spec;

}

/** Back to the pre-toon materials (or their standard-material twins when the scene was reloaded). */
export function revertToonLook( root, options = {} ) {

	const swap = options.swap || ( ( mesh, mat ) => { mesh.material = mat; } );
	if ( root.userData ) delete root.userData.look;

	root.traverse( mesh => {

		if ( ! mesh.isMesh ) return;
		const had = originals.get( mesh );

		if ( had ) {

			swap( mesh, had );
			originals.delete( mesh );

		} else {

			const mats = [].concat( mesh.material );
			if ( ! mats.some( isToon ) ) return;
			const surfaces = mats.filter( m => ! m.isOutline ).map( m => ( isToon( m ) ? toStandardProxy( m ) : m ) );
			swap( mesh, Array.isArray( mesh.material ) && surfaces.length > 1 ? surfaces : surfaces[ 0 ] );

		}

		const groups = originalGroups.get( mesh.geometry );
		if ( groups ) {

			mesh.geometry.clearGroups();
			for ( const g of groups ) mesh.geometry.addGroup( g.start, g.count, g.materialIndex );
			originalGroups.delete( mesh.geometry );

		}

	} );

}

// ── Scene load ────────────────────────────────────────────────────────────────

/** Rebuild MToon materials from their serialised standard twins. Call after ObjectLoader. */
export function restoreLooks( scene ) {

	let count = 0;

	scene.traverse( mesh => {

		if ( ! mesh.isMesh ) return;
		const mats = [].concat( mesh.material );
		if ( ! mats.some( m => m && m.userData && m.userData.toon && ! isToon( m ) ) ) return;

		const rebuilt = mats.map( m => {

			if ( m && m.userData && m.userData.toon && typeof m.userData.toon === 'object' && ! isToon( m ) ) { count ++; return fromStandardProxy( m ); }
			return m;

		} );

		mesh.material = Array.isArray( mesh.material ) ? rebuilt : rebuilt[ 0 ];

	} );

	return count;

}

/** A standalone toon material for a new prop (see also applyToonLook, which also adds the outline). */
export function toonMaterial( color = 0x808080, opts = {} ) {

	const base = new THREE.MeshStandardMaterial( { color } );
	const m = toToon( base );
	applyParams( m, normalizeLook( { look: 'toon', ...opts } ).spec || {} );
	return m;

}

registerLookApplier( ( root, spec, options ) => applyToonLook( root, spec, options ) );

export { sceneHasToon };
