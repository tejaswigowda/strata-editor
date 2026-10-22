// ── PanelSizes.js ─────────────────────────────────────────────────────────────
// Saved panel sizes. The sidebar width (right / left dock) and the bottom-dock height live in the
// --sidebar-width / --sidebar-height CSS variables; Resizer.js stores what the user drags in
// localStorage and this restores it on load. A stored value is never trusted blindly: it is clamped
// to a sane range for the current window, and re-clamped when the window shrinks, without ever
// rewriting what was saved (so growing the window again gets the saved size back).

export const MIN_SIDEBAR_WIDTH = 335; // .TabbedPanel min-width
export const MIN_SIDEBAR_HEIGHT = 150;
export const MIN_VIEWPORT_WIDTH = 240; // room always left for the viewport beside a side dock
export const MENUBAR_ROOM = 80; // room left above a bottom dock

/** Parse a stored size; null for anything that is not a positive finite number. */
export function parseStoredSize( value ) {

	if ( value === null || value === undefined || value === '' ) return null;
	const n = Number( value );
	return Number.isFinite( n ) && n > 0 ? n : null;

}

export function clampSidebarWidth( width, windowWidth ) {

	const max = Math.max( MIN_SIDEBAR_WIDTH, ( windowWidth || 0 ) - MIN_VIEWPORT_WIDTH );
	return Math.round( Math.min( max, Math.max( MIN_SIDEBAR_WIDTH, width ) ) );

}

export function clampSidebarHeight( height, windowHeight ) {

	const max = Math.max( MIN_SIDEBAR_HEIGHT, ( windowHeight || 0 ) - MENUBAR_ROOM );
	return Math.round( Math.min( max, Math.max( MIN_SIDEBAR_HEIGHT, height ) ) );

}

/**
 * Apply the saved sizes to `rootStyle` (documentElement.style) and keep them clamped on window
 * resize. Returns { apply, dispose }.
 */
export function restorePanelSizes( { storage = localStorage, rootStyle = document.documentElement.style, win = window } = {} ) {

	function read( key ) {

		try { return parseStoredSize( storage.getItem( key ) ); } catch ( e ) { return null; }

	}

	function apply() {

		const width = read( 'sidebar-width' );
		const height = read( 'sidebar-height' );
		if ( width !== null ) rootStyle.setProperty( '--sidebar-width', clampSidebarWidth( width, win.innerWidth ) + 'px' );
		if ( height !== null ) rootStyle.setProperty( '--sidebar-height', clampSidebarHeight( height, win.innerHeight ) + 'px' );

	}

	apply();
	win.addEventListener( 'resize', apply );

	return { apply, dispose() { win.removeEventListener( 'resize', apply ); } };

}
