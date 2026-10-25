// brand.js — the Strata mark in the top-right corner of every page under /about.
//
// One shared script instead of markup copied into each page: include it with
//   <script src="brand.js" defer></script>          (about/index.html)
//   <script src="../brand.js" defer></script>       (about/<folder>/*.html)
// It floats the icon right at the top of <main>, and clicking it asks first, then
// goes to the Strata home page (the editor at the site root). Same-origin, no
// third-party calls. Deliberately NOT included by /about/callcard: that page is
// rasterised into rendered shorts, so a clickable logo there would end up in the video.
//
// When the page is shown inside the editor (the welcome overlay is an iframe),
// "home" replaces the whole editor view, so the prompt says so and the top window
// is the one that navigates.

( function () {

	const script = document.currentScript;
	if ( ! script ) return;

	const here = new URL( '.', script.src );		// .../about/
	const home = new URL( '../', here ).href;		// the editor, at the site root
	const framed = window.top !== window;

	const style = document.createElement( 'style' );
	style.textContent = `
		.strata-brand { float: right; margin: 0 0 0.5em 1.2em; line-height: 0; border-radius: 16px; }
		.strata-brand img { width: 110px; height: 110px; display: block; object-fit: contain; opacity: 0.92; transition: opacity 0.15s, transform 0.15s; }
		.strata-brand:hover img { opacity: 1; transform: scale( 1.06 ); }
		.strata-brand:focus-visible { outline: 2px solid #7db2ff; outline-offset: 3px; }
		@media ( max-width: 520px ) { .strata-brand img { width: 80px; height: 80px; } }
	`;
	document.head.appendChild( style );

	const link = document.createElement( 'a' );
	link.className = 'strata-brand';
	link.href = home;
	link.title = 'Strata home';
	link.setAttribute( 'aria-label', 'Strata: back to the home page' );

	const img = document.createElement( 'img' );
	img.src = new URL( 'strata-icon.png', here ).href;
	img.alt = '';
	img.width = 110;
	img.height = 110;
	link.appendChild( img );

	link.addEventListener( 'click', ( event ) => {

		// Open-in-new-tab gestures leave this page alone, so they need no prompt.
		if ( event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) return;

		event.preventDefault();

		const message = framed
			? 'Leave this view and go to the Strata home page? Anything unsaved in the editor behind it may be lost.'
			: 'Go to the Strata home page?';
		if ( ! window.confirm( message ) ) return;

		try { ( framed ? window.top : window ).location.href = home; } catch ( e ) { window.location.href = home; }

	} );

	const host = document.querySelector( 'main' ) || document.body;
	host.insertBefore( link, host.firstChild );

}() );
