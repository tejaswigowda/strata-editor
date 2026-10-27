#!/usr/bin/env node
// Measure how far the viewport is from the Render tab's output.
//
//   node scripts/compare-render.mjs [sceneUrl] [--times 1,3,5] [--threshold 16] [--out DIR] [--headed] [--size 1100x700]
//                                   [--override docs/path/file.js=local/file.js] [--hide ObjectName] [--real-gpu]
//
// --hide hides every object with that name (repeatable) to see how much of a gap they cause.
// --override serves a local file in place of a site file (repeatable), for A/B runs, e.g. the stand-ins
// as they were: git show HEAD:docs/editor/js/toon/WebGLFallback.js > old.js
//
// Loads the scene in a throwaway Chromium page, then for each playhead time captures
//   (1) the normal viewport,
//   (2) the viewport in "as render" mode (Preview as render),
//   (3) a Render-tab snapshot (Take Snapshot, "Viewport size", PNG),
// and prints the per-shot differences (mean absolute error, per channel, % of pixels over the
// threshold). Side-by-side PNGs [viewport | as render | export | |viewport - export|] go to a
// temp dir (never the repo). The image maths is docs/editor/js/toon/pixelMetrics.js.
//
// Needs the static dev server running (default http://localhost:5503/docs/) and Playwright:
// installed next to this repo, or point PLAYWRIGHT_MODULE at its entry file.
// A viewport that fell back to the classic WebGLRenderer already draws through the same stand-ins as the
// export, so the script flags that: the gap is only meaningful with WebGPURenderer (which also runs on its
// WebGL2 backend, as in headless Chromium without a GPU).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareImages, diffImage, sideBySide, averageMetrics } from '../docs/editor/js/toon/pixelMetrics.js';

const DEFAULT_URL = 'http://localhost:5503/docs/#repo=tejaswigowda/test1&file=cafe.json&branch=main';

const argv = process.argv.slice( 2 );
const flag = ( name, fallback ) => { const i = argv.indexOf( '--' + name ); return i < 0 ? fallback : ( argv[ i + 1 ] && ! argv[ i + 1 ].startsWith( '--' ) ? argv[ i + 1 ] : true ); };
const valueFlags = new Set( [ '--times', '--threshold', '--out', '--size', '--timeout', '--override', '--hide' ] );
const hidden = argv.flatMap( ( a, i ) => ( a === '--hide' && argv[ i + 1 ] ? [ argv[ i + 1 ] ] : [] ) );
const overrides = argv.flatMap( ( a, i ) => ( a === '--override' && argv[ i + 1 ] ? [ argv[ i + 1 ].split( '=' ) ] : [] ) );
const positional = argv.filter( ( a, i ) => ! a.startsWith( '--' ) && ! valueFlags.has( argv[ i - 1 ] ) );

const url = positional[ 0 ] || DEFAULT_URL;
const times = String( flag( 'times', '1,3,5' ) ).split( ',' ).map( Number ).filter( Number.isFinite );
const threshold = Number( flag( 'threshold', 16 ) );
const [ vw, vh ] = String( flag( 'size', '1100x700' ) ).split( 'x' ).map( Number );
const loadTimeout = Number( flag( 'timeout', 300 ) ) * 1000;
const outDir = flag( 'out', null ) || fs.mkdtempSync( path.join( os.tmpdir(), 'strata-compare-' ) );
fs.mkdirSync( outDir, { recursive: true } );

async function loadPlaywright() {

	const spec = process.env.PLAYWRIGHT_MODULE || 'playwright';
	try {

		return await import( spec );

	} catch ( e ) {

		throw new Error( `Could not load Playwright (${ spec }). Install it or set PLAYWRIGHT_MODULE to its entry file.\n${ e.message }` );

	}

}

const { chromium } = await loadPlaywright();

// --real-gpu: leave the software-GL flags off, so a machine with WebGPU runs the viewport on the real WebGPU backend (the comparison the Render tab's note is about)
const realGpu = argv.includes( '--real-gpu' );
const browser = await chromium.launch( {
	headless: ! flag( 'headed', false ),
	channel: realGpu ? 'chrome' : undefined,
	args: realGpu ? [] : [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );

try {

	const context = await browser.newContext( { viewport: { width: vw, height: vh }, deviceScaleFactor: 1, colorScheme: 'light', acceptDownloads: true } );
	const page = await context.newPage();
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	// the dev server's live reload would reload the page mid-capture whenever a source file changes
	await page.addInitScript( () => { window.WebSocket = class { constructor() { this.readyState = 3; } addEventListener() {} removeEventListener() {} send() {} close() {} }; } );
	for ( const [ site, local ] of overrides ) {

		await page.route( '**/' + site.replace( /^\/+/, '' ).replace( /^docs\//, '' ), route => route.fulfill( { path: path.resolve( local ), contentType: 'text/javascript' } ) );
		console.log( `Serving ${ local } as ${ site }` );

	}

	// a second page decodes / encodes PNGs so the script needs no image library
	const codec = await context.newPage();
	await codec.goto( 'about:blank' );
	const decode = buffer => codec.evaluate( async b64 => {

		const bitmap = await createImageBitmap( await ( await fetch( 'data:image/png;base64,' + b64 ) ).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } );
		const canvas = new OffscreenCanvas( bitmap.width, bitmap.height );
		const ctx = canvas.getContext( '2d', { willReadFrequently: true } );
		ctx.drawImage( bitmap, 0, 0 );
		const px = ctx.getImageData( 0, 0, bitmap.width, bitmap.height ).data;
		let bin = '';
		for ( let i = 0; i < px.length; i += 0x8000 ) bin += String.fromCharCode.apply( null, px.subarray( i, i + 0x8000 ) );
		return { width: bitmap.width, height: bitmap.height, b64: btoa( bin ) };

	}, buffer.toString( 'base64' ) ).then( r => ( { width: r.width, height: r.height, data: new Uint8ClampedArray( Buffer.from( r.b64, 'base64' ) ) } ) );

	const encode = image => codec.evaluate( async ( { width, height, b64 } ) => {

		const bytes = Uint8ClampedArray.from( atob( b64 ), c => c.charCodeAt( 0 ) );
		const canvas = new OffscreenCanvas( width, height );
		canvas.getContext( '2d' ).putImageData( new ImageData( bytes, width, height ), 0, 0 );
		const blob = await canvas.convertToBlob( { type: 'image/png' } );
		const buf = new Uint8Array( await blob.arrayBuffer() );
		let bin = '';
		for ( let i = 0; i < buf.length; i += 0x8000 ) bin += String.fromCharCode.apply( null, buf.subarray( i, i + 0x8000 ) );
		return btoa( bin );

	}, { width: image.width, height: image.height, b64: Buffer.from( image.data.buffer, image.data.byteOffset, image.data.byteLength ).toString( 'base64' ) } ).then( b64 => Buffer.from( b64, 'base64' ) );

	console.log( 'Loading ' + url );
	page.on( 'framenavigated', f => { if ( f === page.mainFrame() ) console.log( '  (page navigated: ' + f.url().slice( 0, 90 ) + ')' ); } );
	await page.goto( url );

	// the editor can reload itself while a repo scene loads: wait for it to settle, retrying the setup
	let info;
	for ( let attempt = 0; attempt < 4 && ! info; attempt ++ ) {

		try {

			await page.waitForFunction( () => window.editor && window.editor.scene.children.length > 5, null, { timeout: loadTimeout } );
			await page.waitForTimeout( 3000 );

			// keep the capture clean: no helpers, and nothing but the viewport's canvases (no panels, badge,
			// view cube, play overlay, subtitles)
			await page.addStyleTag( { content: 'body * { visibility: hidden !important; } #viewport canvas { visibility: visible !important; }' } );
			info = await page.evaluate( hide => {

				const editor = window.editor;
				editor.sceneHelpers.visible = false;
				editor.scene.traverse( o => { if ( hide.includes( o.name ) ) o.visible = false; } );
				window.__playhead = { time: 0, duration: 0 };
				editor.signals.timelinePlayheadUpdated.add( i => { window.__playhead = i; } );
				let mtoon = 0;
				editor.scene.traverse( o => { if ( o.material ) for ( const m of [].concat( o.material ) ) if ( m && m.isMToonNodeMaterial && ! m.isOutline ) mtoon ++; } );
				const canvas = [ ...document.querySelectorAll( '#viewport canvas' ) ].sort( ( a, b ) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight )[ 0 ];
				return { mtoon, renderer: editor.config.getKey( 'project/renderer/type' ), width: canvas.clientWidth, height: canvas.clientHeight };

			}, hidden );

		} catch ( e ) {

			if ( e.name === 'TimeoutError' ) throw e;
			console.log( '  (setup interrupted, retrying: ' + e.message.split( '\n' )[ 0 ].slice( 0, 80 ) + ')' );

		}

	}

	if ( ! info ) throw new Error( 'The scene did not settle after repeated page navigations' );

	console.log( `Viewport ${ info.width }x${ info.height }, ${ info.renderer === 'WebGPURenderer' ? 'WebGPURenderer (node materials)' : info.renderer + ' (viewport already uses the stand-ins, so the gap reads ~0)' }, ${ info.mtoon } MToon material(s)` );


	const settle = async ( ms = 600 ) => {

		await page.evaluate( () => { window.editor.signals.cameraChanged.dispatch( window.editor.viewportCamera ); } );
		await page.waitForTimeout( ms );
		await page.evaluate( () => new Promise( res => { let n = 0; const f = () => { if ( ++ n >= 2 ) { window.editor.signals.sceneRendered.remove( f ); res(); } }; window.editor.signals.sceneRendered.add( f ); window.editor.signals.cameraChanged.dispatch( window.editor.viewportCamera ); setTimeout( () => { window.editor.signals.sceneRendered.remove( f ); res(); }, 30000 ); } ) );

	};

	const seek = async t => {

		await page.evaluate( t => { const s = window.editor.signals; s.timelinePauseRequested.dispatch(); s.timelineSeekRequested.dispatch( t ); }, t );
		await page.waitForTimeout( 400 );
		await page.evaluate( t => { window.editor.signals.timelineSeekRequested.dispatch( t ); }, t );

	};

	const setShading = value => page.evaluate( value => {

		const select = [ ...document.querySelectorAll( '#viewport select' ) ].find( s => [ ...s.options ].some( o => o.value === 'render' ) );
		select.value = value;
		select.dispatchEvent( new Event( 'change' ) );

	}, value );

	const shoot = async () => {

		const box = await page.evaluate( () => { const r = document.getElementById( 'viewport' ).getBoundingClientRect(); return { x: Math.round( r.x ), y: Math.round( r.y ), width: Math.round( r.width ), height: Math.round( r.height ) }; } );
		return decode( await page.screenshot( { clip: box } ) );

	};

	const snapshot = async () => {

		const download = page.waitForEvent( 'download', { timeout: 120000 } );
		await page.evaluate( () => {

			const sizeSelect = [ ...document.querySelectorAll( 'select' ) ].find( s => [ ...s.options ].some( o => o.value === 'viewport2x' ) );
			sizeSelect.value = 'viewport';
			sizeSelect.dispatchEvent( new Event( 'change' ) );
			const formatSelect = [ ...document.querySelectorAll( 'select' ) ].find( s => [ ...s.options ].some( o => o.value === 'webp' ) );
			formatSelect.value = 'png';
			formatSelect.dispatchEvent( new Event( 'change' ) );
			[ ...document.querySelectorAll( 'button' ) ].find( b => /Take Snapshot/.test( b.textContent ) ).click();

		} );
		const file = await ( await download ).path();
		return decode( fs.readFileSync( file ) );

	};

	const shots = times.map( t => ( { t } ) );
	const actual = [];

	const step = ( what, t ) => console.log( `  ${ what } @ ${ t }s` );
	for ( const shot of shots ) { step( 'viewport', shot.t ); await seek( shot.t ); await settle(); shot.viewport = await shoot(); actual.push( await page.evaluate( () => ( { time: window.__playhead.time, duration: window.__playhead.duration } ) ) ); }
	await setShading( 'render' );
	for ( const shot of shots ) { step( 'as render', shot.t ); await seek( shot.t ); await settle( 1200 ); shot.preview = await shoot(); }
	for ( const shot of shots ) { step( 'snapshot', shot.t ); await seek( shot.t ); await settle(); shot.export = await snapshot(); }
	await setShading( 'solid' );

	// the axis gizmo is drawn into the viewport canvas itself (ViewHelper, 128px at the top left), so blank it in every capture
	const maskViewHelper = im => {

		const data = new Uint8ClampedArray( im.data );
		for ( let y = 0; y < Math.min( 140, im.height ); y ++ ) for ( let x = 0; x < Math.min( 130, im.width ); x ++ ) data.set( [ 0, 0, 0, 255 ], ( y * im.width + x ) * 4 );
		return { width: im.width, height: im.height, data };

	};

	const row = ( label, m ) => `  ${ label.padEnd( 22 ) } MAE ${ m.mae.toFixed( 2 ).padStart( 6 ) }  (R ${ m.maePerChannel[ 0 ].toFixed( 1 ) } G ${ m.maePerChannel[ 1 ].toFixed( 1 ) } B ${ m.maePerChannel[ 2 ].toFixed( 1 ) })  RMSE ${ m.rmse.toFixed( 2 ).padStart( 6 ) }  >${ threshold }: ${ m.pctOver.toFixed( 2 ).padStart( 6 ) }%  max ${ m.maxDiff }`;
	const pairs = { 'viewport vs export': [], 'as render vs export': [], 'viewport vs as render': [] };
	const report = [];

	for ( let i = 0; i < shots.length; i ++ ) {

		const s = shots[ i ];
		console.log( `\nt = ${ s.t }s (playhead ${ actual[ i ].time.toFixed( 2 ) }s of ${ actual[ i ].duration.toFixed( 2 ) }s)` );
		const sizes = [ s.viewport, s.preview, s.export ].map( im => `${ im.width }x${ im.height }` );
		if ( new Set( sizes ).size > 1 ) console.log( '  note: capture sizes differ ' + sizes.join( ' / ' ) + '; comparing the overlap' );

		const w = Math.min( s.viewport.width, s.preview.width, s.export.width ), h = Math.min( s.viewport.height, s.preview.height, s.export.height );
		const crop = im => {

			if ( im.width === w && im.height === h ) return im;
			const data = new Uint8ClampedArray( w * h * 4 );
			for ( let y = 0; y < h; y ++ ) data.set( im.data.subarray( y * im.width * 4, y * im.width * 4 + w * 4 ), y * w * 4 );
			return { width: w, height: h, data };

		};
		const [ a, b, c ] = [ s.viewport, s.preview, s.export ].map( crop ).map( maskViewHelper );

		const result = {
			'viewport vs export': compareImages( a, c, { threshold } ),
			'as render vs export': compareImages( b, c, { threshold } ),
			'viewport vs as render': compareImages( a, b, { threshold } ),
		};

		for ( const k in result ) { console.log( row( k, result[ k ] ) ); pairs[ k ].push( result[ k ] ); }
		report.push( { t: s.t, playhead: actual[ i ].time, duration: actual[ i ].duration, ...result } );

		const sheet = sideBySide( [ a, b, c, diffImage( a, c, { threshold } ) ] );
		const file = path.join( outDir, `compare-t${ String( s.t ).replace( '.', '_' ) }.png` );
		fs.writeFileSync( file, await encode( sheet ) );

	}

	console.log( '\nMean over ' + shots.length + ' shot(s)' );
	const summary = {};
	for ( const k in pairs ) { summary[ k ] = averageMetrics( pairs[ k ] ); console.log( row( k, summary[ k ] ) ); }

	fs.writeFileSync( path.join( outDir, 'report.json' ), JSON.stringify( { url, threshold, viewport: info, shots: report, mean: summary }, null, 2 ) );
	console.log( `\nSide-by-side PNGs [viewport | as render | export | diff] and report.json: ${ outDir }` );

} finally {

	await browser.close();

}
