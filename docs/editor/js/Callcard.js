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
				.then( function ( canvas ) {

					// html2canvas rasterizes <img> elements through its own,
					// separate resource loader — even once the DOM's own decode
					// (imagesReady above) has finished, that internal pass has an
					// intermittent race that can still bake the QR as a blank
					// box. Composite every already-decoded <img> onto the
					// finished canvas ourselves (redundant, harmless if
					// html2canvas already drew it correctly) so the QR is never
					// missing regardless of that race.
					const ctx = canvas.getContext( '2d' );
					for ( const img of images ) {

						const rect = img.getBoundingClientRect();
						try {

							ctx.drawImage( img, rect.left, rect.top, rect.width, rect.height );

						} catch ( e ) { /* non-fatal — leave whatever html2canvas already drew */ }

					}

					return canvas;

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

	// Bake at a resolution matching the card's ACTUAL on-screen size, not just
	// its unscaled geometry — fitCallcardToCamera() scales the object up
	// (often 5-10x) to fill the frame, and a fixed low-res bake then gets
	// GPU-magnified that far, reading as soft/blurry instead of crisp text.
	object.updateWorldMatrix( true, false );
	const worldScale = object.getWorldScale( new THREE.Vector3() );
	const MAX_PX = 2048; // cap so an extreme scale can't blow past canvas/texture limits
	let pxWidth  = width * worldScale.x * PIXELS_PER_UNIT;
	let pxHeight = height * worldScale.y * PIXELS_PER_UNIT;
	const overshoot = Math.max( pxWidth, pxHeight ) / MAX_PX;
	if ( overshoot > 1 ) { pxWidth /= overshoot; pxHeight /= overshoot; } // scale both down together — keeps the aspect ratio intact
	pxWidth = Math.round( pxWidth );
	pxHeight = Math.round( pxHeight );

	return snapshotCallcard( pxWidth, pxHeight )
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
 * facing.
 *
 * Matches the camera's own world orientation exactly (rather than
 * `object.lookAt(camPos)`, which rebuilds an orientation from world-up and
 * goes unstable — flipping the card upside down/mirrored — whenever the
 * camera itself is rolled or looking near-straight up/down, e.g. an animated
 * StoryCam). Since the plane's front (+Z) and the camera's local +Z both then
 * point back along the same world direction, and the plane's +Y matches the
 * camera's actual (possibly rolled) up, the card reads upright and unmirrored
 * from that camera's point of view no matter how it's tilted.
 */
export function fitCallcardToCamera( object, camera, { distance = 6, fill = 0.85 } = {} ) {

	camera.updateWorldMatrix( true, false );
	const camPos = camera.getWorldPosition( new THREE.Vector3() );
	const camDir = camera.getWorldDirection( new THREE.Vector3() );

	object.position.copy( camPos ).addScaledVector( camDir, distance );
	camera.getWorldQuaternion( object.quaternion );

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
