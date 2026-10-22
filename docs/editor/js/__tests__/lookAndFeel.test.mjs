// Node tests for the shot chip, saved panel sizes and theme helpers. Run with:
//   node docs/editor/js/__tests__/lookAndFeel.test.mjs

import assert from 'node:assert';
import { shotAt, shotCameraName } from '../ShotAt.js';
import { MIN_SIDEBAR_HEIGHT, MIN_SIDEBAR_WIDTH, clampSidebarHeight, clampSidebarWidth, parseStoredSize, restorePanelSizes } from '../PanelSizes.js';
import { applyTheme, getTheme, normalizeTheme, setTheme, themeAttribute } from '../Theme.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const memory = () => { const m = new Map(); return { getItem: k => ( m.has( k ) ? m.get( k ) : null ), setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: k => m.delete( k ) }; };

// ── shot chip ───────────────────────────────────────────────────────────────

const shots = [ { id: 'b', at: 4, camera: 'cam-b' }, { id: 'a', at: 0, camera: 'cam-a' }, { id: 'c', at: 9, camera: 'cam-c' } ];
const cameras = { 'cam-a': { name: 'Wide' }, 'cam-b': { name: 'Close up' }, 'cam-c': { name: '   ' } };

test( 'shotAt picks the last shot at or before the playhead (unsorted input)', () => {

	assert.strictEqual( shotAt( shots, 0 ).id, 'a' );
	assert.strictEqual( shotAt( shots, 3.99 ).id, 'a' );
	assert.strictEqual( shotAt( shots, 4 ).id, 'b' );
	assert.strictEqual( shotAt( shots, 100 ).id, 'c' );
	assert.strictEqual( shots[ 0 ].id, 'b', 'input order untouched' );

} );

test( 'shotAt before the first shot still uses the first; empty / bad input is null', () => {

	assert.strictEqual( shotAt( [ { id: 'x', at: 2, camera: 'c' } ], 0 ).id, 'x' );
	assert.strictEqual( shotAt( [], 1 ), null );
	assert.strictEqual( shotAt( undefined, 1 ), null );
	assert.strictEqual( shotAt( [ null, { at: 'soon' } ], 1 ), null );

} );

test( 'shotCameraName uses the shot camera, falls back to the active camera', () => {

	assert.strictEqual( shotCameraName( shots, 5, cameras, { name: 'Edit' } ), 'Close up' );
	assert.strictEqual( shotCameraName( [], 5, cameras, { name: 'Edit Camera' } ), 'Edit Camera' );
	assert.strictEqual( shotCameraName( [ { at: 0, camera: 'gone' } ], 1, cameras, { name: 'Edit Camera' } ), 'Edit Camera', 'deleted shot camera' );
	assert.strictEqual( shotCameraName( shots, 10, cameras, null ), 'Camera', 'unnamed camera' );
	assert.strictEqual( shotCameraName( [], 1, cameras, null ), '' );

} );

// ── panel sizes ─────────────────────────────────────────────────────────────

test( 'parseStoredSize accepts positive numbers only', () => {

	assert.strictEqual( parseStoredSize( '412' ), 412 );
	for ( const bad of [ null, undefined, '', 'abc', '-5', '0', 'Infinity', 'NaN' ] ) assert.strictEqual( parseStoredSize( bad ), null, String( bad ) );

} );

test( 'clampSidebarWidth keeps the dock usable and leaves room for the viewport', () => {

	assert.strictEqual( clampSidebarWidth( 100, 1600 ), MIN_SIDEBAR_WIDTH );
	assert.strictEqual( clampSidebarWidth( 500, 1600 ), 500 );
	assert.strictEqual( clampSidebarWidth( 5000, 1600 ), 1600 - 240 );
	assert.strictEqual( clampSidebarWidth( 5000, 400 ), MIN_SIDEBAR_WIDTH, 'tiny window never goes below the dock minimum' );

} );

test( 'clampSidebarHeight keeps room for the menu bar', () => {

	assert.strictEqual( clampSidebarHeight( 10, 900 ), MIN_SIDEBAR_HEIGHT );
	assert.strictEqual( clampSidebarHeight( 420, 900 ), 420 );
	assert.strictEqual( clampSidebarHeight( 9999, 900 ), 820 );

} );

test( 'restorePanelSizes clamps on load and re-clamps on resize without rewriting storage', () => {

	const storage = memory();
	storage.setItem( 'sidebar-width', '1500' );
	storage.setItem( 'sidebar-height', 'junk' );
	const style = new Map();
	const rootStyle = { setProperty: ( k, v ) => style.set( k, v ) };
	const listeners = [];
	const win = { innerWidth: 1000, innerHeight: 800, addEventListener: ( t, f ) => listeners.push( f ), removeEventListener() {} };

	restorePanelSizes( { storage, rootStyle, win } );
	assert.strictEqual( style.get( '--sidebar-width' ), '760px' );
	assert.ok( ! style.has( '--sidebar-height' ), 'junk is ignored, CSS default stays' );

	win.innerWidth = 2000;
	listeners.forEach( f => f() );
	assert.strictEqual( style.get( '--sidebar-width' ), '1500px', 'saved size comes back when the window grows' );
	assert.strictEqual( storage.getItem( 'sidebar-width' ), '1500' );

} );

// ── theme ───────────────────────────────────────────────────────────────────

test( 'theme: unknown values are Auto; Auto sets no attribute', () => {

	assert.strictEqual( normalizeTheme( 'neon' ), 'auto' );
	assert.strictEqual( themeAttribute( 'auto' ), null );
	assert.strictEqual( themeAttribute( 'light' ), 'light' );
	assert.strictEqual( themeAttribute( 'dark' ), 'dark' );

} );

test( 'theme: stored choice round-trips and Auto clears storage', () => {

	const storage = memory();
	const attrs = new Map();
	const root = { setAttribute: ( k, v ) => attrs.set( k, v ), removeAttribute: k => attrs.delete( k ) };
	assert.strictEqual( getTheme( storage ), 'auto' );
	// setTheme applies to the real document; in node, drive applyTheme directly
	applyTheme( 'light', root );
	assert.strictEqual( attrs.get( 'data-theme' ), 'light' );
	applyTheme( 'auto', root );
	assert.ok( ! attrs.has( 'data-theme' ) );

	globalThis.document = { documentElement: root };
	assert.strictEqual( setTheme( 'dark', storage ), 'dark' );
	assert.strictEqual( getTheme( storage ), 'dark' );
	assert.strictEqual( attrs.get( 'data-theme' ), 'dark' );
	setTheme( 'auto', storage );
	assert.strictEqual( storage.getItem( 'strata/theme' ), null );
	assert.ok( ! attrs.has( 'data-theme' ) );
	delete globalThis.document;

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
