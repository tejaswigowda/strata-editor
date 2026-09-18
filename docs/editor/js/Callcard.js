// ── Callcard.js ──────────────────────────────────────────────────────────────
// "Call card" object: an addressable plane mesh that embeds the living
// /about/callcard end-card. Mirrors HtmlEmbed.js's bake-to-CanvasTexture
// approach (a REAL WebGL mesh — automatically included in viewport
// screenshots, the Render tab's video export, and glTF export), but the
// source is a URL, not an inline HTML string, and it never trusts a stale
// bake: every hydrate (scene load) and every render re-fetches the live page.
//
// Living vs baked (see guides/GIT_VERSIONING.md's URL-hash section for the
// same "reference, not a copy" idea applied to git-loaded scenes):
//   - Live / interactive view: hydrateCallcard() re-snapshots on scene load,
//     so the viewport always shows the CURRENT card.
//   - Render time: Sidebar.Render.js calls refreshCallcard() again right
//     before rendering starts, so the exported video bakes whatever the card
//     says *at render time* — updating the card updates the ending of every
//     FUTURE render without touching any short's scene. Already-rendered
//     mp4s keep their stamped older card (the version stamp lives on the
//     card page itself, baked into the pixels).
//
// The snapshot mechanism loads /about/callcard in a hidden same-origin
// iframe (a real navigation, so its <script type="module"> runs normally —
// unlike HtmlEmbed's plain innerHTML-string approach, which can't run
// scripts) and rasterizes the rendered iframe body with html2canvas.
//
// Storage: only a URL reference + width/height are persisted in userData —
// scene/serialize.js strips the baked texture before every toJSON() so scene
// JSON (autosave, git commits) never carries a copy of the card's pixels.
//
// Trust boundary: the embed URL is intentionally NOT free-form/user-editable
// to an arbitrary origin — it always resolves to this same-origin
// /about/callcard route. Do not repurpose this mechanism to embed arbitrary
// third-party URLs into a render without adding an explicit trust/sandbox
// model first (same concern as the git URL-hash preload's anonymous-read
// trust boundary).

import * as THREE from 'three';
import html2canvas from 'html2canvas';

export const DEFAULT_WIDTH = 1.8;   // world units (9:16-ish portrait, for shorts)
export const DEFAULT_HEIGHT = 3.2;
const PIXELS_PER_UNIT = 300;        // rasterize resolution
const EMBED_PATH = 'about/callcard/'; // resolved relative to document.baseURI

/** The (same-origin, first-party-only) URL the call card always embeds. */
export function callcardUrl() {

	return new URL( EMBED_PATH, document.baseURI ).href;

}

/** Load /about/callcard in a hidden same-origin iframe and rasterize it. */
function snapshotCallcard( pxWidth, pxHeight ) {

	const iframe = document.createElement( 'iframe' );
	iframe.style.position = 'fixed';
	iframe.style.left = '-99999px';
	iframe.style.top = '0';
	iframe.style.width = pxWidth + 'px';
	iframe.style.height = pxHeight + 'px';
	iframe.style.border = 'none';
	document.body.appendChild( iframe );

	return new Promise( function ( resolve, reject ) {

		const timeout = setTimeout( function () {

			reject( new Error( 'call card: timed out loading ' + callcardUrl() ) );

		}, 10000 );

		iframe.onload = function () {

			clearTimeout( timeout );

			// Wait for the card's own <script type="module"> (version stamp) to
			// run AND every <img> (the QR) to finish decoding before rasterizing —
			// a fixed short delay isn't reliable for image decode timing, and
			// html2canvas silently paints a blank box for an undecoded <img>.
			const doc = iframe.contentDocument;
			const images = Array.from( doc.images );
			const imagesReady = Promise.all( images.map( function ( img ) {

				if ( img.complete && img.naturalWidth > 0 ) return Promise.resolve();
				if ( typeof img.decode === 'function' ) return img.decode().catch( function () {} );
				return new Promise( function ( res ) { img.onload = img.onerror = res; } );

			} ) );

			imagesReady
				.then( function () { return new Promise( function ( res ) { requestAnimationFrame( function () { requestAnimationFrame( res ); } ); } ); } )
				.then( function () {

					return html2canvas( doc.body, {
						width: pxWidth,
						height: pxHeight,
						backgroundColor: null,
						scale: 1,
						logging: false
					} );

				} )
				.then( resolve )
				.catch( reject );

		};

		iframe.onerror = function () {

			clearTimeout( timeout );
			reject( new Error( 'call card: failed to load ' + callcardUrl() ) );

		};

		iframe.src = callcardUrl();

	} ).finally( function () {

		iframe.remove();

	} );

}

/** Re-fetch the live card and bake it onto the mesh's material. Always re-fetches (never trusts a persisted bake) — returns a Promise so callers (render setup, hydration) can await it. */
export function refreshCallcard( object ) {

	const width = object.userData.width || DEFAULT_WIDTH;
	const height = object.userData.height || DEFAULT_HEIGHT;

	if ( object.geometry.parameters.width !== width || object.geometry.parameters.height !== height ) {

		object.geometry.dispose();
		object.geometry = new THREE.PlaneGeometry( width, height );

	}

	return snapshotCallcard( Math.round( width * PIXELS_PER_UNIT ), Math.round( height * PIXELS_PER_UNIT ) )
		.then( function ( canvas ) {

			const texture = new THREE.CanvasTexture( canvas );
			texture.colorSpace = THREE.SRGBColorSpace;

			if ( object.material.map ) object.material.map.dispose();
			object.material.map = texture;
			object.material.needsUpdate = true;

		} )
		.catch( function ( error ) {

			console.warn( 'Call card: failed to refresh —', error.message );

		} );

}

/** Create a brand-new call-card object (used by the Stencils add-object factory). */
export function createCallcard( width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT ) {

	const geometry = new THREE.PlaneGeometry( width, height );
	const material = new THREE.MeshBasicMaterial( { transparent: true, side: THREE.DoubleSide, depthWrite: false } );
	const object = new THREE.Mesh( geometry, material );

	object.name = 'callcard';
	object.userData.isCallcard = true;
	object.userData.label = 'callcard'; // explicit, so $S('#callcard') resolves regardless of id/name fallback order
	object.userData.width = width;
	object.userData.height = height;

	hydrateCallcard( object );

	return object;

}

/**
 * Position, scale and orient a call-card (or any plane) so it fills `camera`'s
 * CURRENT view, front face toward the camera and right-side-forward (readable,
 * not mirrored) — regardless of which direction the camera happens to be
 * facing. Generalizes the old "rotate 180\u00b0 if the camera ends up on the
 * opposite side, else leave it at 0" manual rule (see guides/CALLCARD.md) to
 * any camera angle, not just the two axis-aligned cases.
 *
 * A plain `object.lookAt(camPos)` aims the object's local -Z at the camera,
 * which points this plane's FRONT (+Z) normal AWAY from it — the extra 180\u00b0
 * turn is what corrects that for an arbitrary relative angle.
 */
export function fitCallcardToCamera( object, camera, { distance = 6, fill = 0.85 } = {} ) {

	camera.updateWorldMatrix( true, false );
	const camPos = camera.getWorldPosition( new THREE.Vector3() );
	const camDir = camera.getWorldDirection( new THREE.Vector3() );

	object.position.copy( camPos ).addScaledVector( camDir, distance );
	object.lookAt( camPos );
	object.rotateY( Math.PI );

	if ( camera.isPerspectiveCamera ) {

		// Scale uniformly so the card's width spans `fill` of the camera's
		// horizontal FOV at `distance` — the card fills the frame, not just
		// exactly touches its edges.
		const width = object.userData.width || DEFAULT_WIDTH;
		const vFov = THREE.MathUtils.degToRad( camera.fov );
		const hFov = 2 * Math.atan( Math.tan( vFov / 2 ) * camera.aspect );
		const targetWidth = 2 * distance * Math.tan( hFov / 2 ) * fill;
		object.scale.setScalar( targetWidth / width );

	}

	return object;

}

// Tracked directly on the object (a non-enumerable runtime-only property, so
// it never serializes) rather than a module-scoped WeakSet — a WeakSet is
// only reliable if every caller shares the exact same module instance, which
// breaks under dev-time cache-busted re-imports and can otherwise cause the
// per-frame Viewport hydration pass (below) to see "not yet hydrated" forever
// and re-fetch/re-bake on every tick (visible as flicker). A fresh object
// instance from a new fromJSON() parse has no such property, so a reload
// always re-hydrates — only repeat ticks on the SAME instance skip.
const HYDRATED_FLAG = '__strataCallcardHydrated';

/**
 * Called on scene load (Viewport.js hydration pass, alongside
 * hydrateHtmlEmbed/hydrateEdgeOutline). Unlike HtmlEmbed's hydrate (a
 * missing-texture fallback only), this always re-fetches the FIRST time it
 * sees a given object instance — a call card should never show whatever was
 * baked the last time the scene was saved; it should show what
 * /about/callcard says right now. Safe to call every render tick: only the
 * first call per object instance does any work.
 */
export function hydrateCallcard( object ) {

	if ( ! object.userData || ! object.userData.isCallcard ) return;
	if ( object[ HYDRATED_FLAG ] ) return;
	Object.defineProperty( object, HYDRATED_FLAG, { value: true, enumerable: false, configurable: true } );
	return refreshCallcard( object );

}

/** Find every call-card object in a scene (used by the render setup step). */
export function findCallcards( scene ) {

	const found = [];
	scene.traverse( function ( node ) {

		if ( node.userData && node.userData.isCallcard ) found.push( node );

	} );
	return found;

}
