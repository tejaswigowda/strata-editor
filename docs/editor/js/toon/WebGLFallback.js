// ── WebGLFallback.js ──────────────────────────────────────────────────────────
// The viewport is a WebGPU renderer, but the Render tab (video + stills) draws through an
// offscreen WebGLRenderer. Node materials (MToon, the TSL shader presets) have no GLSL
// program, so WebGL throws while compiling them. swapNodeMaterials() puts a WebGL-renderable
// stand-in on every mesh that wears one and returns a function that puts the originals back.
//
//   MToon            -> MeshToonMaterial with a stepped ramp from the shade color, same
//                       color / maps / emissive / transparency. Outline hulls are hidden
//                       (WebGL cannot extrude them).
//   other node mats  -> the material the shader replaced (ShaderLibrary keeps it as __base),
//                       else a MeshStandardMaterial copy of the shared properties.
//
// Shared materials stay shared: one stand-in per original.

import * as THREE from 'three';
import { isToon } from './ToonLook.js';

const SHARED = [ 'color', 'map', 'normalMap', 'alphaMap', 'emissive', 'emissiveMap', 'emissiveIntensity', 'side', 'transparent', 'opacity', 'alphaTest', 'depthWrite', 'depthTest', 'blending' ];

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

const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function rampTexture( shade ) {

	const s = Math.min( 0.9, Math.max( 0.3, shade ) );
	const steps = [ s, ( s + 1 ) / 2, 1 ];
	const data = new Uint8Array( steps.map( v => Math.round( v * 255 ) ) );
	const t = new THREE.DataTexture( data, steps.length, 1, THREE.RedFormat );
	t.minFilter = t.magFilter = THREE.NearestFilter;
	t.generateMipmaps = false;
	t.needsUpdate = true;
	return t;

}

/** A WebGL-renderable stand-in for one node material. */
export function webglStandIn( m ) {

	if ( isToon( m ) ) {

		if ( m.isOutline ) return new THREE.MeshBasicMaterial( { visible: false } );
		const t = copyShared( new THREE.MeshToonMaterial(), m );
		const shade = m.shadeColorFactor && m.shadeColorFactor.isColor ? luminance( m.shadeColorFactor ) : 0.6;
		t.gradientMap = rampTexture( shade );
		t.userData = { webglStandIn: true };
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
export function swapNodeMaterials( root ) {

	const made = new Map(); // original -> stand-in
	const swaps = [];
	const standIn = m => {

		if ( ! made.has( m ) ) made.set( m, webglStandIn( m ) );
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
		for ( const s of made.values() ) {

			if ( s.userData && s.userData.webglStandIn ) {

				if ( s.gradientMap ) s.gradientMap.dispose();
				s.dispose();

			}

		}

	};

}
