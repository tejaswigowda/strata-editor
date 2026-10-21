// ── WebGLFallback.js ──────────────────────────────────────────────────────────
// The viewport is a WebGPU renderer, but the Render tab (video + stills) draws through an
// offscreen WebGLRenderer. Node materials (MToon, the TSL shader presets) have no GLSL
// program, so WebGL throws while compiling them. swapNodeMaterials() puts a WebGL-renderable
// stand-in on every mesh that wears one and returns a function that puts the originals back.
//
//   MToon            -> MeshToonMaterial whose lighting is patched to MToon's own maths (shade
//                       color mixed with the lit color by linearstep over N.L + shift, toony,
//                       parametric rim), same color / maps / emissive / transparency. Outline
//                       hulls are drawn too: the same inverted hull, extruded in the vertex shader.
//                       Not carried over: matcap, rim / outline-width / shading-shift textures, UV
//                       animation.
//   other node mats  -> the material the shader replaced (ShaderLibrary keeps it as __base),
//                       else a MeshStandardMaterial copy of the shared properties.
//
// Shared materials stay shared: one stand-in per original.
//
// Two uses. The Render tab swaps once per render and disposes the stand-ins afterwards. The
// viewport, when it has fallen back to WebGL (no WebGPU, e.g. most Android browsers), swaps
// around every frame with { cache: true }: stand-ins are kept per original material, re-synced
// from it each frame, so edits show and nothing is rebuilt. The viewport's "as render" shading
// (RenderPipeline.js) does the same on a WebGL canvas over a WebGPU viewport. The scene always
// keeps its real node materials (they are what gets saved).

import * as THREE from 'three';
import { isToon } from './ToonLook.js';

const SHARED = [ 'color', 'map', 'normalMap', 'alphaMap', 'emissive', 'emissiveMap', 'emissiveIntensity', 'side', 'transparent', 'opacity', 'alphaTest', 'depthWrite', 'depthTest', 'blending', 'toneMapped' ];

function copyShared( target, src ) {

	target.name = src.name || '';
	for ( const k of SHARED ) {

		if ( ! ( k in target ) || src[ k ] === undefined ) continue;
		const v = src[ k ];
		if ( target[ k ] && target[ k ].isColor ) { if ( v && v.isColor ) target[ k ].copy( v ); } else if ( ! ( v === null && ! k.endsWith( 'Map' ) ) ) target[ k ] = v;

	}
	if ( target.normalScale && src.normalScale ) target.normalScale.copy( src.normalScale );
	return target;

}

// ── MToon on MeshToonMaterial ─────────────────────────────────────────────────
// MeshToonMaterial lights through RE_Direct_Toon / RE_IndirectDiffuse_Toon; those two functions (and
// the final sum, which three's toon leaves without specular) are replaced by MToon's model as
// three-vrm's node material has it:
//   direct   = lightColor * BRDF_Lambert( mix( shade, lit, linearstep( -(1-toony), 1-toony, N.L + shift ) ) )
//   rim      = rimColor * pow( clamp( 1 - N.V + lift ), power ), added per light by rimMix and once
//              unlit by (1 - rimMix)
//   outline  = mix( outlineColor, lit * outlineColor, outlineMix ), on a hull pushed out along the normal
// The values live in uniforms that syncMToon() refreshes, so editing the MToon material shows.

const MT_PARS = `varying vec3 vViewPosition;
uniform vec3 mtShade;
uniform float mtShift;
uniform float mtToony;
uniform vec3 mtRimColor;
uniform float mtRimPower;
uniform float mtRimLift;
uniform float mtRimMix;
#ifdef MT_SHADE_MAP
uniform sampler2D mtShadeMap;
#endif
struct ToonMaterial {
	vec3 diffuseColor;
	vec3 shadeColor;
};
vec3 mtRim( const in vec3 normal, const in vec3 viewDir ) {
	return mtRimColor * pow( clamp( 1.0 - dot( normal, viewDir ) + mtRimLift, 0.0, 1.0 ), mtRimPower );
}
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	float s = clamp( dot( geometryNormal, directLight.direction ), - 1.0, 1.0 ) + mtShift;
	float w = 1.0 - mtToony;
	float shading = w <= 0.0 ? step( 0.0, s ) : clamp( ( s + w ) / ( 2.0 * w ), 0.0, 1.0 );
	reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( mix( material.shadeColor, material.diffuseColor, shading ) );
	reflectedLight.directSpecular += mtRim( geometryNormal, geometryViewDir ) * mtRimMix * BRDF_Lambert( directLight.color );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.indirectSpecular += mtRim( geometryNormal, geometryViewDir ) * ( 1.0 - mtRimMix );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon`;

const MT_MATERIAL = `ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.shadeColor = mtShade;
#if defined( MT_SHADE_MAP ) && defined( USE_MAP )
material.shadeColor *= texture2D( mtShadeMap, vMapUv ).rgb;
#endif`;

const MT_OUT_SURFACE = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;';
const MT_OUT_HULL = 'vec3 outgoingLight = mix( mtOutlineColor, ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular ) * mtOutlineColor, mtOutlineMix );';

const MT_HULL_PARS = `uniform float mtOutlineWidth;
void main() {`;

const MT_HULL_VERTEX = `{
	vec3 mtN = normalize( objectNormal );
	vec3 mtOffset = mtN * mtOutlineWidth * length( normalMatrix * mtN );
	#ifdef MT_OUTLINE_SCREEN
	mtOffset *= - ( modelViewMatrix * vec4( transformed, 1.0 ) ).z / projectionMatrix[ 1 ][ 1 ];
	#endif
	transformed += mtOffset;
}
#include <project_vertex>`;

function mtoonUniforms() {

	return {
		mtShade: { value: new THREE.Color() }, mtShift: { value: 0 }, mtToony: { value: 0.9 },
		mtRimColor: { value: new THREE.Color() }, mtRimPower: { value: 5 }, mtRimLift: { value: 0 }, mtRimMix: { value: 1 },
		mtShadeMap: { value: null },
		mtOutlineColor: { value: new THREE.Color() }, mtOutlineMix: { value: 1 }, mtOutlineWidth: { value: 0 },
	};

}

function replaceOnce( text, from, to ) {

	if ( ! text.includes( from ) ) { warnPatch( from ); return text; }
	return text.replace( from, to );

}

let warned = false;
function warnPatch( what ) {

	if ( warned ) return;
	warned = true;
	console.warn( 'WebGLFallback: three.js changed its toon shader (' + what + ' not found); MToon stand-ins fall back to plain toon shading.' );

}

/** Patch a MeshToonMaterial to light like MToon. `hull` makes it the outline pass. */
function patchToon( t, hull ) {

	const u = mtoonUniforms();
	t.userData.mt = { u, hull, key: '' };
	t.customProgramCacheKey = () => 'strataMToon' + t.userData.mt.key;
	t.onBeforeCompile = shader => {

		Object.assign( shader.uniforms, u );
		const flags = t.userData.mt.key;
		const f = ( flags.includes( 'M' ) ? '#define MT_SHADE_MAP\n' : '' ) + ( flags.includes( 'S' ) ? '#define MT_OUTLINE_SCREEN\n' : '' );
		let frag = shader.fragmentShader;
		frag = replaceOnce( frag, '#include <lights_toon_pars_fragment>', MT_PARS );
		frag = replaceOnce( frag, '#include <lights_toon_fragment>', MT_MATERIAL );
		frag = replaceOnce( frag, 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', hull ? MT_OUT_HULL : MT_OUT_SURFACE );
		if ( hull ) frag = 'uniform vec3 mtOutlineColor;\nuniform float mtOutlineMix;\n' + frag;
		shader.fragmentShader = f + frag;

		if ( hull ) {

			let vert = shader.vertexShader;
			vert = replaceOnce( vert, 'void main() {', MT_HULL_PARS );
			vert = replaceOnce( vert, '#include <project_vertex>', MT_HULL_VERTEX );
			shader.vertexShader = f + vert;

		}

	};

	return u;

}

/** Refresh a stand-in's uniforms (and program flags) from the MToon material it stands in for. */
function syncMToon( t, m ) {

	const { u, hull } = t.userData.mt;
	const hasColor = m.shadeColorFactor && m.shadeColorFactor.isColor;

	if ( hasColor ) u.mtShade.value.copy( m.shadeColorFactor ); else u.mtShade.value.copy( m.color ).multiplyScalar( 0.6 );
	u.mtShift.value = m.shadingShiftFactor ?? 0;
	u.mtToony.value = m.shadingToonyFactor ?? 0.9;
	u.mtRimColor.value.copy( m.parametricRimColorFactor );
	u.mtRimPower.value = m.parametricRimFresnelPowerFactor ?? 5;
	u.mtRimLift.value = m.parametricRimLiftFactor ?? 0;
	u.mtRimMix.value = m.rimLightingMixFactor ?? 1;
	const shadeTex = hasColor && m.map && m.shadeMultiplyTexture && m.shadeMultiplyTexture.isTexture ? m.shadeMultiplyTexture : null;
	u.mtShadeMap.value = shadeTex;

	let key = shadeTex ? 'M' : '';
	if ( hull ) {

		u.mtOutlineColor.value.copy( m.outlineColorFactor );
		u.mtOutlineMix.value = m.outlineLightingMixFactor ?? 1;
		u.mtOutlineWidth.value = m.outlineWidthFactor || 0;
		if ( m.outlineWidthMode === 'screenCoordinates' ) key += 'S';
		t.visible = m.visible !== false && m.outlineWidthMode !== 'none' && u.mtOutlineWidth.value > 0;

	}

	if ( key !== t.userData.mt.key ) { t.userData.mt.key = key; t.needsUpdate = true; }

}

const CACHE = new WeakMap(); // original node material -> stand-in, for the viewport's per-frame swap

function syncToon( t, m ) {

	copyShared( t, m );
	syncMToon( t, m );

}

/** A WebGL-renderable stand-in for one node material. */
export function webglStandIn( m, cache = false ) {

	if ( cache && CACHE.has( m ) ) {

		const hit = CACHE.get( m );
		if ( hit.userData && hit.userData.webglStandIn ) { if ( hit.isMeshToonMaterial ) syncToon( hit, m ); else { const k = hit.userData; copyShared( hit, m ); hit.userData = k; } }
		return hit;

	}
	const made = buildStandIn( m );
	if ( cache ) CACHE.set( m, made );
	return made;

}

function buildStandIn( m ) {

	if ( isToon( m ) ) {

		const t = copyShared( new THREE.MeshToonMaterial(), m );
		t.userData = { webglStandIn: true };
		patchToon( t, !! m.isOutline );
		syncMToon( t, m );
		return t;

	}
	if ( m.__base && ! m.__base.isNodeMaterial ) return m.__base;
	const s = copyShared( new THREE.MeshStandardMaterial(), m );
	if ( m.roughness !== undefined ) s.roughness = m.roughness;
	if ( m.metalness !== undefined ) s.metalness = m.metalness;
	s.userData = { webglStandIn: true };
	return s;

}

/** Swap every node material under `root` for a stand-in. Returns restore(). A no-op when there are none. */
export function swapNodeMaterials( root, { cache = false } = {} ) {

	const made = new Map(); // original -> stand-in
	const swaps = [];
	const standIn = m => {

		if ( ! made.has( m ) ) made.set( m, webglStandIn( m, cache ) );
		return made.get( m );

	};

	root.traverse( o => {

		const mat = o.material;
		if ( ! mat ) return;
		if ( Array.isArray( mat ) ) {

			if ( ! mat.some( m => m && m.isNodeMaterial ) ) return;
			const original = mat;
			o.material = mat.map( m => ( m && m.isNodeMaterial ? standIn( m ) : m ) );
			swaps.push( () => { o.material = original; } );

		} else if ( mat.isNodeMaterial ) {

			o.material = standIn( mat );
			swaps.push( () => { o.material = mat; } );

		}

	} );

	return function restore() {

		for ( const undo of swaps ) undo();
		if ( cache ) return;
		for ( const s of made.values() ) {

			if ( s.userData && s.userData.webglStandIn ) {

				s.dispose();

			}

		}

	};

}
