// Node tests for the viewport Frame guides / Look logic. Run with:
//   node docs/editor/js/__tests__/viewLook.test.mjs

import assert from 'node:assert';
import {
	ASPECT_PRESETS, DEFAULTS, SAFE_ACTION, SAFE_TITLE, STORAGE_KEY,
	aspectRatio, anyActive, effectiveState, frameRect, hideOutlinePasses, loadSettings, safeRect, sanitizeSettings, saveSettings
} from '../ViewLookLogic.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, a + ' !~ ' + b );

test( 'everything is off by default', () => {

	assert.strictEqual( DEFAULTS.frame, 'off' );
	assert.ok( ! anyActive( effectiveState( DEFAULTS ) ) );

} );

test( 'presets: the required aspects exist', () => {

	const ids = ASPECT_PRESETS.map( p => p.id );
	for ( const id of [ 'off', '16:9', '2.39:1', '1.85:1', '4:3', '1:1', '9:16', 'render' ] ) assert.ok( ids.includes( id ), id );
	near( aspectRatio( '2.39:1' ), 2.39 );
	near( aspectRatio( '9:16' ), 9 / 16 );
	assert.strictEqual( aspectRatio( 'off' ), null );

} );

test( 'match render follows the render size, falls back to 16:9', () => {

	near( aspectRatio( 'render', { width: 1080, height: 1080 } ), 1 );
	near( aspectRatio( 'render', { width: 1920, height: 960 } ), 2 );
	near( aspectRatio( 'render', null ), 16 / 9 );
	near( aspectRatio( 'render', { width: 0, height: 10 } ), 16 / 9 );

} );

test( 'frameRect letterboxes a wide frame in a tall viewport and pillarboxes the reverse', () => {

	let r = frameRect( 1000, 800, 16 / 9 );
	near( r.width, 1000 ); near( r.height, 562.5 ); near( r.x, 0 ); near( r.y, 118.75 );

	r = frameRect( 1000, 400, 1 );
	near( r.width, 400 ); near( r.height, 400 ); near( r.x, 300 ); near( r.y, 0 );

	r = frameRect( 1000, 800, 9 / 16 );
	near( r.height, 800 ); near( r.width, 450 );

} );

test( 'frameRect with no ratio or a degenerate box is the whole viewport / empty', () => {

	assert.deepStrictEqual( frameRect( 640, 480, null ), { x: 0, y: 0, width: 640, height: 480 } );
	assert.deepStrictEqual( frameRect( 0, 0, 2 ), { x: 0, y: 0, width: 0, height: 0 } );

} );

test( 'safeRect insets symmetrically', () => {

	const frame = frameRect( 1000, 500, 2 );
	const title = safeRect( frame, SAFE_TITLE );
	near( title.width, 900 ); near( title.height, 450 ); near( title.x, 50 ); near( title.y, 25 );
	assert.ok( SAFE_TITLE < SAFE_ACTION );

} );

test( 'sanitizeSettings drops bad types / unknown presets and clamps amounts', () => {

	const s = sanitizeSettings( { frame: 'nope', safe: 'yes', vignette: true, vignetteAmount: 7, grainAmount: - 3, glowAmount: NaN, extra: 1 } );
	assert.strictEqual( s.frame, 'off' );
	assert.strictEqual( s.safe, false );
	assert.strictEqual( s.vignette, true );
	assert.strictEqual( s.vignetteAmount, 1 );
	assert.strictEqual( s.grainAmount, 0 );
	assert.strictEqual( s.glowAmount, DEFAULTS.glowAmount );
	assert.ok( ! ( 'extra' in s ) );
	assert.deepStrictEqual( sanitizeSettings( 'garbage' ), { ...DEFAULTS } );

} );

test( 'save / load round trip, corrupt JSON and blocked storage are harmless', () => {

	const data = new Map();
	const storage = { getItem: k => ( data.has( k ) ? data.get( k ) : null ), setItem: ( k, v ) => data.set( k, v ) };
	saveSettings( storage, { ...DEFAULTS, frame: '2.39:1', grain: true } );
	const back = loadSettings( storage );
	assert.strictEqual( back.frame, '2.39:1' );
	assert.strictEqual( back.grain, true );

	data.set( STORAGE_KEY, '{not json' );
	assert.deepStrictEqual( loadSettings( storage ), { ...DEFAULTS } );

	const blocked = { getItem() { throw new Error( 'blocked' ); }, setItem() { throw new Error( 'blocked' ); } };
	assert.deepStrictEqual( loadSettings( blocked ), { ...DEFAULTS } );
	saveSettings( blocked, DEFAULTS );

} );

test( 'effectiveState: never while exporting', () => {

	const all = { ...DEFAULTS, frame: '16:9', safe: true, vignette: true, grain: true, glow: true, hideOutlines: true, inPresent: true };
	assert.ok( anyActive( effectiveState( all ) ) );
	assert.ok( ! anyActive( effectiveState( all, { exporting: true } ) ) );
	assert.ok( ! anyActive( effectiveState( all, { exporting: true, presentMode: true } ) ) );

} );

test( 'effectiveState: present mode needs the opt-in', () => {

	const s = { ...DEFAULTS, vignette: true, vignetteAmount: 0.6 };
	assert.ok( ! anyActive( effectiveState( s, { presentMode: true } ) ) );
	const on = effectiveState( { ...s, inPresent: true }, { presentMode: true } );
	assert.strictEqual( on.vignette, 0.6 );
	assert.strictEqual( effectiveState( s ).vignette, 0.6 );

} );

test( 'effectiveState: an intensity only counts when its toggle is on', () => {

	const st = effectiveState( { ...DEFAULTS, vignetteAmount: 0.9, grainAmount: 0.9 } );
	assert.strictEqual( st.vignette, 0 );
	assert.strictEqual( st.grain, 0 );

} );

test( 'hideOutlinePasses hides only outline materials and restores exactly', () => {

	const body = { isOutline: false, visible: true };
	const outline = { isOutline: true, visible: true };
	const alreadyHidden = { isOutline: true, visible: false };
	const meshA = { material: [ body, outline ] };
	const meshB = { material: alreadyHidden };
	const meshC = { material: null };
	const root = { traverse( fn ) { [ this, meshA, meshB, meshC ].forEach( fn ); }, material: undefined };

	const restore = hideOutlinePasses( root );
	assert.strictEqual( outline.visible, false );
	assert.strictEqual( body.visible, true );
	restore();
	assert.strictEqual( outline.visible, true );
	assert.strictEqual( alreadyHidden.visible, false, 'a pass the file hid stays hidden' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
