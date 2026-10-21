// ── RenderPipeline.js ─────────────────────────────────────────────────────────
// The Render tab (video + stills) draws through an offscreen WebGLRenderer, while the viewport is
// usually WebGPU. These are the pieces of that WebGL pipeline, shared so the viewport's
// "as render" preview (RenderPreview below) is built from the very same code as the export:
// project renderer settings, a WebGL-owned PMREM environment, the Uint16 skinIndex fix, and the
// node-material stand-ins (WebGLFallback.js).

import * as THREE from 'three';
import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { swapNodeMaterials } from './WebGLFallback.js';

export const RENDER_CLEAR_COLOR = 0xaaaaaa; // the Render tab's base colour; scene.background overrides

/** Mirror the project renderer settings (shadows / tone mapping) onto a WebGL renderer. */
export function applyRenderSettings( renderer, config ) {

	renderer.shadowMap.enabled = config.getKey( 'project/renderer/shadows' ) !== false;
	renderer.shadowMap.type = parseFloat( config.getKey( 'project/renderer/shadowType' ) ) || THREE.PCFShadowMap;
	renderer.toneMapping = parseFloat( config.getKey( 'project/renderer/toneMapping' ) ) || THREE.NoToneMapping;
	renderer.toneMappingExposure = parseFloat( config.getKey( 'project/renderer/toneMappingExposure' ) ) || 1;
	return renderer;

}

/**
 * The viewport's PMREM environment is a render-target texture bound to the VIEWPORT's context: it
 * cannot upload into another renderer, so PBR materials would render black. Build an equivalent in
 * `renderer`'s own context. Returns { texture, dispose() }, or null when the scene's environment is
 * an ordinary texture (those upload anywhere).
 */
export function webglEnvironment( renderer, scene ) {

	if ( ! ( scene.environment && scene.environment.isRenderTargetTexture ) ) return null;

	const pmrem = new THREE.PMREMGenerator( renderer );
	const envScene = ( scene.background && scene.background.isColor )
		? new ColorEnvironment( scene.background )
		: new RoomEnvironment();
	const target = pmrem.fromScene( envScene, 0.04 );
	return { texture: target.texture, dispose() { target.dispose(); pmrem.dispose(); } };

}

const SKIN_COPY = new WeakMap(); // Uint32 skinIndex attribute -> its Uint16 twin

/**
 * WebGL binds a Uint32 skinIndex as an integer attribute while the skinning shader declares a float:
 * the draw fails and every skinned mesh renders nothing. Swap in cached Uint16 copies; returns restore().
 */
export function swapSkinIndex( scene ) {

	const undo = [];

	scene.traverse( o => {

		const attr = o.isSkinnedMesh && o.geometry.attributes.skinIndex;
		if ( ! ( attr && attr.array instanceof Uint32Array ) ) return;
		if ( ! SKIN_COPY.has( attr ) ) SKIN_COPY.set( attr, new THREE.BufferAttribute( new Uint16Array( attr.array ), attr.itemSize ) );
		o.geometry.setAttribute( 'skinIndex', SKIN_COPY.get( attr ) );
		undo.push( () => o.geometry.setAttribute( 'skinIndex', attr ) );

	} );

	return () => { for ( const u of undo ) u(); };

}

/**
 * The viewport's "Preview as render": draws the scene through its own WebGLRenderer exactly as the
 * Render tab would (same settings, environment, skin fix, MToon stand-ins and outlines) onto a canvas
 * the viewport stacks over its own. Nothing here changes what is saved: every swap is undone after
 * the frame.
 */
export class RenderPreview {

	constructor( config ) {

		this.config = config;
		this.renderer = null;
		this.envKey = null;
		this.env = null;
		this.shadowMaps = new WeakMap(); // light -> the shadow map this renderer allocated for it

	}

	get domElement() {

		return this.renderer ? this.renderer.domElement : null;

	}

	ensure( width, height, pixelRatio ) {

		if ( ! this.renderer ) {

			this.renderer = new THREE.WebGLRenderer( { antialias: true } );
			this.renderer.setClearColor( RENDER_CLEAR_COLOR );

		}

		this.renderer.setPixelRatio( pixelRatio );
		this.renderer.setSize( width, height );
		applyRenderSettings( this.renderer, this.config );
		return this.renderer;

	}

	/** Render one frame. Does not touch the saved scene: everything swapped in is swapped back. */
	render( scene, camera, width, height, pixelRatio = 1 ) {

		const renderer = this.ensure( width, height, pixelRatio );
		const restores = [];

		// A light's shadow.map belongs to whichever backend allocated it; keep this renderer's apart.
		scene.traverse( o => {

			if ( ! ( o.isLight && o.castShadow && o.shadow ) ) return;
			const theirs = o.shadow.map;
			o.shadow.map = this.shadowMaps.get( o ) || null;
			o.shadow.needsUpdate = true;
			restores.push( () => { this.shadowMaps.set( o, o.shadow.map ); o.shadow.map = theirs; } );

		} );

		restores.push( swapSkinIndex( scene ) );

		const key = scene.environment && scene.environment.isRenderTargetTexture ? scene.environment.uuid + '|' + ( scene.background && scene.background.isColor ? scene.background.getHex() : 'room' ) : null;
		if ( key !== this.envKey ) {

			if ( this.env ) this.env.dispose();
			this.env = key ? webglEnvironment( renderer, scene ) : null;
			this.envKey = key;

		}

		if ( this.env ) {

			const prev = scene.environment;
			scene.environment = this.env.texture;
			restores.push( () => { scene.environment = prev; } );

		}

		restores.push( swapNodeMaterials( scene, { cache: true } ) );

		try {

			renderer.render( scene, camera );

		} finally {

			for ( const restore of restores.reverse() ) {

				try { restore(); } catch ( e ) { console.warn( 'Render preview cleanup failed', e ); }

			}

		}

	}

	dispose() {

		if ( this.env ) this.env.dispose();
		this.env = null;
		this.envKey = null;
		if ( this.renderer ) this.renderer.dispose();
		this.renderer = null;

	}

}
