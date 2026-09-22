// ── WelcomeOverlay.js ──────────────────────────────────────────────────────────
// A basic-info + tutorials overlay shown when the Strata logo (top-left) is
// clicked. The content itself lives at /about/welcome (a normal, directly-
// visitable static page — same "no build step" spirit as the rest of /about)
// and is embedded here in an <iframe>, created and pointed at that page only
// the first time the overlay is opened (never eagerly at load) — mirrors
// Callcard.js's "living, same-origin embed" pattern.

let overlay = null;
let iframe = null;

function welcomeUrl() {

	return new URL( 'about/welcome/', document.baseURI ).href;

}

function build() {

	const el = document.createElement( 'div' );
	el.id = 'welcome-overlay';
	el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:none;' +
		'align-items:center;justify-content:center;background:rgba(10,12,16,0.75);';

	const panel = document.createElement( 'div' );
	panel.style.cssText = 'position:relative;width:min(560px,90vw);height:min(600px,80vh);' +
		'border-radius:10px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);' +
		'background:#14161a;';
	el.appendChild( panel );

	iframe = document.createElement( 'iframe' );
	iframe.title = 'Welcome to Strata';
	iframe.style.cssText = 'display:block;width:100%;height:100%;border:none;';
	panel.appendChild( iframe );

	const closeButton = document.createElement( 'button' );
	closeButton.textContent = '\u00d7';
	closeButton.setAttribute( 'aria-label', 'Close' );
	closeButton.style.cssText = 'position:absolute;top:10px;right:10px;width:28px;height:28px;' +
		'border:none;border-radius:6px;background:rgba(20,22,26,0.7);color:#9aa4b2;font-size:20px;' +
		'line-height:1;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;';
	closeButton.addEventListener( 'mouseenter', () => { closeButton.style.background = 'rgba(40,42,48,0.85)'; } );
	closeButton.addEventListener( 'mouseleave', () => { closeButton.style.background = 'rgba(20,22,26,0.7)'; } );
	closeButton.addEventListener( 'click', hide );
	panel.appendChild( closeButton );

	document.body.appendChild( el );

	el.addEventListener( 'click', function ( event ) { if ( event.target === el ) hide(); } );

	return el;

}

function onKeydown( event ) {

	if ( event.key === 'Escape' ) hide();

}

export function showWelcomeOverlay() {

	if ( ! overlay ) overlay = build();

	// Load on demand: only point the iframe at the page the first time the
	// overlay is actually opened, not at module load / app boot.
	if ( ! iframe.src ) iframe.src = welcomeUrl();

	overlay.style.display = 'flex';
	document.addEventListener( 'keydown', onKeydown );

}

export function hideWelcomeOverlay() {

	if ( overlay ) overlay.style.display = 'none';
	document.removeEventListener( 'keydown', onKeydown );

}

function hide() { hideWelcomeOverlay(); }
