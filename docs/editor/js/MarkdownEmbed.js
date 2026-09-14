// ── MarkdownEmbed.js ─────────────────────────────────────────────────────────
// "Markdown" stencil: same baked-texture "slide" as HtmlEmbed.js, but authored
// as Markdown — object.userData.markdown is the source of truth, converted to
// HTML via `marked` and rasterized through the SAME html2canvas pipeline (see
// HtmlEmbed.js for the tainted-canvas rationale). A real WebGL mesh, so it's
// automatically baked into viewport screenshots, Render tab video, and glTF
// export with no special-case rendering path.

import * as THREE from 'three';
import { marked } from 'marked';
import { rasterizeHtml, DEFAULT_WIDTH, DEFAULT_HEIGHT } from './HtmlEmbed.js';

// Minimal default typography so raw <h1>/<p>/<ul> etc. from marked() look
// reasonable without the author having to write their own CSS. font/color are
// overridable per-object via userData.font/userData.color (see Sidebar.Object.js).
const DEFAULT_FONT = 'sans-serif';
const DEFAULT_COLOR = '#111111';

function baseStyle( font, color ) {

	return `
		font: 14px/1.5 ${ font }; color: ${ color }; padding: 12px; box-sizing: border-box;
		width: 100%; height: 100%; overflow: hidden;
	`;

}

const HEADING_STYLE = `
	<style>
		h1,h2,h3 { margin: 0 0 8px; line-height: 1.25; }
		p { margin: 0 0 8px; }
		ul,ol { margin: 0 0 8px; padding-left: 1.4em; }
		code { background: rgba(0,0,0,0.08); border-radius: 3px; padding: 0 3px; }
		pre code { display: block; padding: 8px; overflow: hidden; }
		blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid rgba(0,0,0,0.2); opacity: 0.85; }
	</style>
`;

/** Re-rasterize object.userData.markdown/width/height and bake it onto the mesh's material. Returns a Promise (resolves once the bake lands). */
export function refreshMarkdownEmbed( object ) {

	const markdown = object.userData.markdown || '';
	const width = object.userData.width || DEFAULT_WIDTH;
	const height = object.userData.height || DEFAULT_HEIGHT;
	const font = object.userData.font || DEFAULT_FONT;
	const color = object.userData.color || DEFAULT_COLOR;

	if ( object.geometry.parameters.width !== width || object.geometry.parameters.height !== height ) {

		object.geometry.dispose();
		object.geometry = new THREE.PlaneGeometry( width, height );

	}

	const html = HEADING_STYLE + `<div style="${ baseStyle( font, color ) }">${ marked.parse( markdown ) }</div>`;

	return rasterizeHtml( html, Math.round( width * 200 ), Math.round( height * 200 ) )
		.then( function ( canvas ) {

			const texture = new THREE.CanvasTexture( canvas );
			texture.colorSpace = THREE.SRGBColorSpace;

			if ( object.material.map ) object.material.map.dispose();
			object.material.map = texture;
			object.material.needsUpdate = true;

		} )
		.catch( function ( error ) {

			console.error( 'Markdown embed: failed to rasterize', error );

		} );

}

/** Create a brand-new Markdown-embed object (used by the Stencils drop/click factory). */
export function createMarkdownEmbed( markdown, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT ) {

	const geometry = new THREE.PlaneGeometry( width, height );
	const material = new THREE.MeshBasicMaterial( { transparent: true, side: THREE.DoubleSide, depthWrite: false } );
	const object = new THREE.Mesh( geometry, material );

	object.name = 'Markdown';
	object.userData.isMarkdownEmbed = true;
	object.userData.markdown = markdown;
	object.userData.width = width;
	object.userData.height = height;
	object.userData.font = DEFAULT_FONT;
	object.userData.color = DEFAULT_COLOR;

	refreshMarkdownEmbed( object );

	return object;

}

/**
 * Fallback re-bake for a Markdown-embed mesh missing its texture — mirrors
 * hydrateHtmlEmbed() (see HtmlEmbed.js). No-op if already baked.
 */
export function hydrateMarkdownEmbed( object ) {

	if ( ! object.userData || ! object.userData.isMarkdownEmbed ) return;
	if ( object.material && object.material.map ) return;
	return refreshMarkdownEmbed( object );

}
