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

	const here = new URL( 'https://strataeditor.dev/about/' );		// .../about/
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


// Enhancement only: the list above is already in the page (and in tutorials.json, which a script elsewhere reads).
// This adds a search box that hides the cards that do not match, and the sections that are left empty.
( function () {

	const list = document.getElementById( 'list' );
	if ( ! list ) return;
	const cards = [ ...list.querySelectorAll( '.card' ) ];
	const sections = [ ...list.querySelectorAll( 'section' ) ];
	const box = document.createElement( 'input' );
	box.type = 'search';
	box.placeholder = 'Search the tutorials';
	box.setAttribute( 'aria-label', 'Search the tutorials' );
	box.style.cssText = 'display:block;width:100%;max-width:360px;margin:1em 0 0;padding:0.5em 0.8em;border-radius:8px;border:1px solid #2a2e36;background:#1a1d23;color:#d9dde3;font:inherit';
	document.getElementById( 'jump' ).after( box );

	box.addEventListener( 'input', () => {

		const words = box.value.toLowerCase().split( /\s+/ ).filter( Boolean );
		for ( const c of cards ) {

			const text = c.textContent.toLowerCase();
			c.hidden = ! words.every( ( w ) => text.includes( w ) );

		}
		for ( const s of sections ) s.hidden = ! s.querySelector( '.card:not([hidden])' );

	} );

}() );
