// ── HtmlEmbed.js ─────────────────────────────────────────────────────────────
// "HTML" stencil: a static, transparent-background "slide" — arbitrary HTML
// rasterized once into a CanvasTexture on a plane Mesh via html2canvas. This
// is a REAL WebGL mesh: it renders through the normal pipeline, so it's
// automatically baked into viewport screenshots, the Render tab's video
// export, and glTF export — no special-case rendering path needed. The baked
// canvas serializes as a data-URL image via THREE's normal Texture JSON, so a
// saved/reloaded scene shows the same result with no re-rasterize needed.
//
// Trade-off: no live interaction (no clickable iframes/links) since it's a
// flat baked image, not a live DOM element — by design, for a "slide".
// html2canvas paints the DOM manually (text/boxes/backgrounds/same-origin
// images) rather than via SVG <foreignObject>, so the result is a genuine,
// untainted canvas — unlike foreignObject rasterization, it can be uploaded
// to WebGL AND read back for JSON export. It does not support <iframe>.
//
// html2canvas is loaded from a pinned CDN build (see docs/index.html
// importmap) — same pattern as this project's existing @tejaswigowda/3dom
// import, not a departure from it.
//
// Security note: renders whatever HTML the user (or a loaded scene) provides.
// Treat scenes from others as you would any other executable content.

import * as THREE from 'three';
import html2canvas from 'html2canvas';

export const DEFAULT_WIDTH = 2;    // world units
export const DEFAULT_HEIGHT = 1.5; // world units
const PIXELS_PER_UNIT = 200; // rasterize resolution

/** Rasterize an HTML string into an offscreen, untainted canvas with a transparent background. */
export function rasterizeHtml( html, pxWidth, pxHeight ) {

	const container = document.createElement( 'div' );
	container.innerHTML = html;
	container.style.position = 'fixed';
	container.style.left = '-99999px';
	container.style.top = '0';
	container.style.width = pxWidth + 'px';
	container.style.height = pxHeight + 'px';
	container.style.overflow = 'hidden';
	document.body.appendChild( container );

	return html2canvas( container, {
		width: pxWidth,
		height: pxHeight,
		backgroundColor: null, // transparent
		scale: 1,
		logging: false
	} ).finally( function () {

		document.body.removeChild( container );

	} );

}

/** Re-rasterize object.userData.html/width/height and bake it onto the mesh's material. Returns a Promise (resolves once the bake lands, so callers can force a re-render). */
export function refreshHtmlEmbed( object ) {

	const html = object.userData.html || '';
	const width = object.userData.width || DEFAULT_WIDTH;
	const height = object.userData.height || DEFAULT_HEIGHT;

	if ( object.geometry.parameters.width !== width || object.geometry.parameters.height !== height ) {

		object.geometry.dispose();
		object.geometry = new THREE.PlaneGeometry( width, height );

	}

	return rasterizeHtml( html, Math.round( width * PIXELS_PER_UNIT ), Math.round( height * PIXELS_PER_UNIT ) )
		.then( function ( canvas ) {

			const texture = new THREE.CanvasTexture( canvas );
			texture.colorSpace = THREE.SRGBColorSpace;

			if ( object.material.map ) object.material.map.dispose();
			object.material.map = texture;
			object.material.needsUpdate = true;

		} )
		.catch( function ( error ) {

			console.error( 'HTML embed: failed to rasterize', error );

		} );

}

/** Create a brand-new HTML-embed object (used by the Stencils drop/click factory). */
export function createHtmlEmbed( html, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT ) {

	const geometry = new THREE.PlaneGeometry( width, height );
	const material = new THREE.MeshBasicMaterial( { transparent: true, side: THREE.DoubleSide, depthWrite: false } );
	const object = new THREE.Mesh( geometry, material );

	object.name = 'HTML';
	object.userData.isHtmlEmbed = true;
	object.userData.html = html;
	object.userData.width = width;
	object.userData.height = height;

	refreshHtmlEmbed( object );

	return object;

}

/**
 * Fallback re-bake for an HTML-embed mesh missing its texture. Normally
 * unnecessary: html2canvas produces a genuine, untainted canvas, so THREE's
 * regular Texture.toJSON()/ObjectLoader round-trip already carries the baked
 * pixels through save+load. This only kicks in if that somehow didn't happen
 * (e.g. a hand-authored scene, an older save). No-op (returns undefined) if
 * already baked — cheap to call every render tick.
 */
export function hydrateHtmlEmbed( object ) {

	if ( ! object.userData || ! object.userData.isHtmlEmbed ) return;
	if ( object.material && object.material.map ) return;
	return refreshHtmlEmbed( object );

}

