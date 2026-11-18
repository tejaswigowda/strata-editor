// Node 22+, Chrome, network, and a running static server for docs/.
// Usage: node scripts/check-sandbox-presentation.mjs [http://127.0.0.1:5597/]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const chrome = [
	process.env.CHROME,
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( file => file && existsSync( file ) );
assert.ok( chrome, 'Set CHROME to a Chrome/Chromium executable.' );
const upstream = new URL( process.argv[ 2 ] || 'http://127.0.0.1:5597/' );
assert.ok( [ 'localhost', '127.0.0.1', '[::1]' ].includes( upstream.hostname ), 'Use a local docs server.' );
const pin = '7b9359e3b2226064e9852cbce5d2c721175957a1';
const sceneURL = `/#repo=tejaswigowda/test1&file=flux.json&commit=${ pin }&play=false&present=true`;
const profilePath = fileURLToPath( new URL( `../.strata-chrome-${ randomUUID() }`, import.meta.url ) );
await mkdir( profilePath );
const server = createServer( async ( req, res ) => {

	if ( req.url === '/__embed' ) {

		res.writeHead( 200, { 'content-type': 'text/html' } );
		return res.end( `<script>addEventListener('message', e => {
			if (e.source === document.querySelector('iframe')?.contentWindow) window.presentation = e.data;
		});</script><iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" width="560" height="320" src="${ sceneURL.replaceAll( '&', '&amp;' ) }"></iframe>` );

	}

	try {

		// Mirror production's CORS header for ES modules fetched from an opaque origin.
		const url = new URL( req.url, upstream );
		if ( url.origin !== upstream.origin ) return res.writeHead( 400 ).end();
		const asset = await fetch( url, { redirect: 'error' } );
		res.writeHead( asset.status, { 'content-type': asset.headers.get( 'content-type' ) || 'application/octet-stream', 'access-control-allow-origin': '*' } );
		if ( req.url === '/' && req.headers[ 'sec-fetch-dest' ] === 'iframe' ) {

			return res.end( ( await asset.text() ).replace( '</body>', `<script>(${ probe })()</script></body>` ) );

		}
		Readable.fromWeb( asset.body ).pipe( res );

	} catch ( error ) {

		res.writeHead( 502 ).end( String( error ) );

	}

} );

function probe() {

	const errors = [];
	addEventListener( 'error', e => errors.push( String( e.error || e.message || e.target?.src ) ), true );
	addEventListener( 'unhandledrejection', e => errors.push( String( e.reason?.stack || e.reason ) ) );
	const report = setInterval( async () => {

		const canvas = document.querySelector( '#viewport > canvas[data-engine]' );
		const overlay = document.querySelector( '#scene-load-overlay' );
		const loaded = overlay?.style.display === 'none' && !! window.editor?.scene.getObjectByName( 'Walkway by the community center' );
		if ( ! loaded || ! canvas?.width || ! canvas.height ) {

			parent.postMessage( { pending: document.body?.innerText.slice( 0, 500 ), scene: window.editor?.scene?.name, canvas: canvas && [ canvas.width, canvas.height ], loaded, errors }, '*' );
			return;

		}

		clearInterval( report );
		const denied = [ 'localStorage', 'sessionStorage' ].map( key => {

			try { void self[ key ]; return 'accessible'; } catch ( e ) { return e.name; }

		} );
		editor.signals.sceneGraphChanged.dispatch();
		const copy = document.createElement( 'canvas' );
		copy.width = copy.height = 32;
		const ctx = copy.getContext( '2d' );
		ctx.drawImage( canvas, 0, 0, 32, 32 );
		const pixels = new Uint32Array( ctx.getImageData( 0, 0, 32, 32 ).data.buffer );
		const visibleTransport = () => [ ...document.querySelectorAll( '#present-bar button:not(.present-remix), #present-bar input, #present-bar .present-time' ) ]
			.filter( node => getComputedStyle( node ).display !== 'none' ).length;
		const staticControls = visibleTransport();
		const clips = editor.scene.animations;
		const settle = () => new Promise( resolve => requestAnimationFrame( () => requestAnimationFrame( resolve ) ) );
		editor.scene.animations = [ ...( clips || [] ), new THREE.AnimationClip( 'Presentation regression', 2, [] ) ];
		editor.signals.animationsChanged.dispatch();
		await settle();
		const animatedControls = visibleTransport();
		const animatedMax = document.querySelector( '#present-bar input' ).max;
		editor.scene.animations = clips;
		editor.signals.animationsChanged.dispatch();
		await settle();
		const clearedControls = visibleTransport();
		const remix = document.querySelector( '#present-bar .present-remix' ).getBoundingClientRect();
		parent.postMessage( {
			origin: self.origin, denied, scene: editor.scene.uuid,
			walkway: !! editor.scene.getObjectByName( 'Walkway by the community center' ),
			colors: new Set( pixels ).size, width: canvas.width, height: canvas.height,
			chrome: !! document.querySelector( '#sidebar, #menubar' ),
			presentBar: getComputedStyle( document.querySelector( '#present-bar' ) ).display,
			playOverlay: !! document.querySelector( '[title="Click outside the button to close"]' ),
			staticControls, animatedControls, animatedMax, clearedControls,
			remix: { x: remix.x + remix.width / 2, y: remix.y + remix.height / 2 },
			errors
		}, '*' );

	}, 150 );

}
server.listen( 0, '127.0.0.1' );
await once( server, 'listening' );
const base = `http://127.0.0.1:${ server.address().port }`;
const browser = spawn( chrome, [ '--headless=new', '--remote-debugging-port=0', '--no-first-run',
	'--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--user-data-dir=${ profilePath }`, 'about:blank' ], { stdio: 'ignore' } );
const exited = once( browser, 'exit' );
let ws;

async function until( check, describe, ms = 30000 ) {

	const end = Date.now() + ms;
	do {

		const value = await check();
		if ( value ) return value;
		await delay( 150 );

	} while ( Date.now() < end );
	throw new Error( 'Timed out waiting for ' + describe() );

}

try {

	const port = await until( async () => {

		try { return Number( ( await readFile( `${ profilePath }/DevToolsActivePort`, 'utf8' ) ).split( '\n' )[ 0 ] ); }
		catch ( error ) { if ( error.code !== 'ENOENT' ) throw error; }

	}, () => 'Chrome DevTools port' );
	const [ tab ] = await ( await fetch( `http://127.0.0.1:${ port }/json/list` ) ).json();
	ws = new WebSocket( tab.webSocketDebuggerUrl );
	await once( ws, 'open' );
	const pending = new Map(), errors = [];
	let id = 0;
	ws.addEventListener( 'message', event => {

		const msg = JSON.parse( event.data );
		if ( msg.id ) pending.get( msg.id )?.( msg );
		if ( msg.method === 'Runtime.exceptionThrown' ) errors.push( msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text );
		if ( msg.method === 'Log.entryAdded' && [ 'warning', 'error' ].includes( msg.params.entry.level ) ) errors.push( `${ msg.params.entry.url || '' } ${ msg.params.entry.text }` );
		if ( msg.method === 'Runtime.consoleAPICalled' && [ 'warning', 'error' ].includes( msg.params.type ) ) errors.push( msg.params.args.map( arg => arg.value || arg.description ).join( ' ' ) );

	} );
	const send = ( method, params = {} ) => new Promise( ( resolve, reject ) => {

		const key = ++ id;
		const timer = setTimeout( () => { pending.delete( key ); reject( new Error( `No response to ${ method }` ) ); }, 10000 );
		pending.set( key, msg => {

			pending.delete( key );
			clearTimeout( timer );
			if ( msg.error ) reject( new Error( msg.error.message ) ); else resolve( msg.result );

		} );
		ws.send( JSON.stringify( { id: key, method, params } ) );

	} );
	const evaluate = async expression => {

		const result = await send( 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true } );
		assert.ok( ! result.exceptionDetails, result.exceptionDetails?.exception?.description );
		return result.result.value;

	};
	await send( 'Runtime.enable' );
	await send( 'Log.enable' );
	await send( 'Page.navigate', { url: `${ base }/__embed` } );
	let status;
	const result = await until( async () => {

		status = await evaluate( 'window.presentation' );
		return status?.colors ? status : null;

	}, () => `saved scene: ${ JSON.stringify( status ) }\n${ errors.join( '\n' ) }` );
	assert.equal( result.origin, 'null' );
	assert.deepEqual( result.denied, [ 'SecurityError', 'SecurityError' ] );
	assert.equal( result.scene, '44274d70-43e6-4017-8fdf-efaf4440ae9a' );
	assert.equal( result.walkway, true );
	assert.ok( result.colors > 1, 'Expected visible scene pixels on the canvas' );
	assert.equal( result.presentBar, 'flex' );
	assert.equal( result.chrome, false );
	assert.equal( result.playOverlay, false );
	assert.equal( result.staticControls, 0 );
	assert.equal( result.animatedControls, 4 );
	assert.equal( result.animatedMax, '2' );
	assert.equal( result.clearedControls, 0 );
	assert.deepEqual( result.errors, [] );
	assert.ok( ! errors.some( text => /SecurityError|Load failed|failed to load tejaswigowda/.test( text ) ), errors.join( '\n' ) );
	console.log( 'Opaque iframe rendered pinned scene:', result );

	const frame = await evaluate( 'document.querySelector("iframe").getBoundingClientRect().toJSON()' );
	const point = { x: frame.x + 2 + result.remix.x, y: frame.y + 2 + result.remix.y };
	await send( 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 } );
	await send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 } );
	const remixURL = base + sceneURL.replace( '&present=true', '' );
	const popup = await until( async () => {

		const { targetInfos } = await send( 'Target.getTargets' );
		return targetInfos.find( target => target.type === 'page' && target.url === remixURL );

	}, () => 'Remix to open the full editor in a new tab with the same pinned scene' );
	assert.equal( popup.canAccessOpener, false );
	await send( 'Target.closeTarget', { targetId: popup.targetId } );
	console.log( 'Remix opened an isolated full-editor tab with the original scene parameters.' );

	await send( 'Page.navigate', { url: `${ base }/` } );
	await until( () => evaluate( '!!document.querySelector("#viewport > canvas[data-engine]") && !!window.editor?.work && !!document.querySelector("#menubar")' ), () => `authoring canvas: ${ errors.join( '\n' ) }` );
	await evaluate( `editor.config.setKey('sandbox-regression-test', 'persists')` );
	await send( 'Page.reload' );
	await until( () => evaluate( `window.editor?.config.getKey('sandbox-regression-test') === 'persists'` ), () => 'normal editor config to persist across reload' );
	console.log( 'Normal editor persisted configuration across reload.' );

} finally {

	ws?.close();
	browser.kill();
	await exited;
	server.closeAllConnections();
	await new Promise( resolve => server.close( resolve ) );
	await rm( profilePath, { recursive: true, force: true, maxRetries: 5 } );

}
