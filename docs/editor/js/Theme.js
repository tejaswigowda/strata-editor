// ── Theme.js ──────────────────────────────────────────────────────────────────
// Explicit colour theme: Auto / Light / Dark. Strata's stylesheet is dark-only by default, so
// Auto keeps exactly that (no attribute is set and nothing changes); Dark pins it; Light sets
// html[data-theme="light"], which the "Light theme" block at the end of main.css restyles.
// Stored in localStorage and applied live, no reload.

export const THEME_KEY = 'strata/theme';
export const THEMES = [ 'auto', 'light', 'dark' ];

export function normalizeTheme( value ) {

	return THEMES.includes( value ) ? value : 'auto';

}

export function getTheme( storage = localStorage ) {

	try { return normalizeTheme( storage.getItem( THEME_KEY ) ); } catch ( e ) { return 'auto'; }

}

/** The value for <html data-theme>, or null to remove it (Auto). */
export function themeAttribute( theme ) {

	const t = normalizeTheme( theme );
	return t === 'auto' ? null : t;

}

export function applyTheme( theme, root = document.documentElement ) {

	const attr = themeAttribute( theme );
	if ( attr === null ) root.removeAttribute( 'data-theme' ); else root.setAttribute( 'data-theme', attr );

}

export function setTheme( theme, storage = localStorage ) {

	const t = normalizeTheme( theme );
	try { if ( t === 'auto' ) storage.removeItem( THEME_KEY ); else storage.setItem( THEME_KEY, t ); } catch ( e ) { /* storage blocked: applies for this session */ }
	applyTheme( t );
	return t;

}

export function applyStoredTheme() {

	applyTheme( getTheme() );

}
