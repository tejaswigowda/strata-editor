import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

import { UINumber, UIPanel, UIRow, UISelect, UIText } from './libs/ui.js';
import { UIBoolean } from './libs/ui.three.js';

function SidebarProjectRenderer( editor ) {

	const config = editor.config;
	const signals = editor.signals;
	const strings = editor.strings;

	let currentRenderer = null;

	const container = new UIPanel();
	container.setBorderTop( '0px' );

	// Renderer

	const rendererRow = new UIRow();
	container.add( rendererRow );

	rendererRow.add( new UIText( strings.getKey( 'sidebar/project/renderer' ) ).setClass( 'Label' ) );

	const rendererTypeSelect = new UISelect().setOptions( {
		'WebGLRenderer': 'WebGL',
		'WebGPURenderer': 'WebGPU'
	} ).setWidth( '150px' ).onChange( createRenderer );
	rendererTypeSelect.setValue( config.getKey( 'project/renderer/type' ) );
	rendererRow.add( rendererTypeSelect );

	// Antialias

	const antialiasRow = new UIRow();
	container.add( antialiasRow );

	antialiasRow.add( new UIText( strings.getKey( 'sidebar/project/antialias' ) ).setClass( 'Label' ) );

	const antialiasBoolean = new UIBoolean( config.getKey( 'project/renderer/antialias' ) ).onChange( createRenderer );
	antialiasRow.add( antialiasBoolean );

	// Shadows

	const shadowsRow = new UIRow();
	container.add( shadowsRow );

	shadowsRow.add( new UIText( strings.getKey( 'sidebar/project/shadows' ) ).setClass( 'Label' ) );

	const shadowsBoolean = new UIBoolean( config.getKey( 'project/renderer/shadows' ) ).onChange( updateShadows );
	shadowsRow.add( shadowsBoolean );

	const shadowTypeSelect = new UISelect().setOptions( {
		0: 'Basic',
		1: 'PCF',
		3: 'VSM'
	} ).setWidth( '125px' ).onChange( updateShadows );
	shadowTypeSelect.setValue( config.getKey( 'project/renderer/shadowType' ) );
	shadowsRow.add( shadowTypeSelect );

	function updateShadows() {

		currentRenderer.shadowMap.enabled = shadowsBoolean.getValue();
		currentRenderer.shadowMap.type = parseFloat( shadowTypeSelect.getValue() );

		signals.rendererUpdated.dispatch();

	}

	// Tonemapping

	const toneMappingRow = new UIRow();
	container.add( toneMappingRow );

	toneMappingRow.add( new UIText( strings.getKey( 'sidebar/project/toneMapping' ) ).setClass( 'Label' ) );

	const toneMappingSelect = new UISelect().setOptions( {
		0: 'No',
		1: 'Linear',
		2: 'Reinhard',
		3: 'Cineon',
		4: 'ACESFilmic',
		6: 'AgX',
		7: 'Neutral'
	} ).setWidth( '120px' ).onChange( updateToneMapping );
	toneMappingSelect.setValue( config.getKey( 'project/renderer/toneMapping' ) );
	toneMappingRow.add( toneMappingSelect );

	const toneMappingExposure = new UINumber( config.getKey( 'project/renderer/toneMappingExposure' ) );
	toneMappingExposure.setDisplay( toneMappingSelect.getValue() === '0' ? 'none' : '' );
	toneMappingExposure.setWidth( '30px' ).setMarginLeft( '10px' );
	toneMappingExposure.setRange( 0, 10 );
	toneMappingExposure.onChange( updateToneMapping );
	toneMappingRow.add( toneMappingExposure );

	function updateToneMapping() {

		toneMappingExposure.setDisplay( toneMappingSelect.getValue() === '0' ? 'none' : '' );

		currentRenderer.toneMapping = parseFloat( toneMappingSelect.getValue() );
		currentRenderer.toneMappingExposure = toneMappingExposure.getValue();
		signals.rendererUpdated.dispatch();

	}

	//

	// Build a WebGLRenderer, retrying with progressively more permissive attributes.
	// Software/ANGLE setups (llvmpipe, SwiftShader) often reject the default context
	// but accept one with failIfMajorPerformanceCaveat:false and no antialias, or a
	// hand-created WebGL2/WebGL1 context. We try those before giving up.

	function createWebGLRenderer( antialias ) {

		const attempts = [
			{ antialias: antialias, logarithmicDepthBuffer: true },
			{ antialias: false, logarithmicDepthBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
		];

		let lastError = null;

		for ( const params of attempts ) {

			try {

				return new THREE.WebGLRenderer( params );

			} catch ( error ) {

				lastError = error;

			}

		}

		// Last resort: hand-create a context ourselves (webgl2 → webgl) with the
		// performance-caveat guard relaxed, and hand it to the renderer.

		const canvas = document.createElement( 'canvas' );
		const contextAttributes = { antialias: false, failIfMajorPerformanceCaveat: false, powerPreference: 'low-power' };
		const context = canvas.getContext( 'webgl2', contextAttributes ) ||
			canvas.getContext( 'webgl', contextAttributes );

		if ( context !== null ) {

			try {

				return new THREE.WebGLRenderer( { canvas: canvas, context: context, logarithmicDepthBuffer: false } );

			} catch ( error ) {

				lastError = error;

			}

		}

		throw lastError || new Error( 'WebGL context could not be created.' );

	}

	// Android in particular sometimes fails the *first* context request right after
	// a backgrounded tab is resumed (or right after page load) because the GPU
	// process hasn't finished restarting yet, then succeeds a moment later. Retry
	// a couple of times with short backoff before treating it as a real failure.

	async function createWebGLRendererWithRetries( antialias ) {

		const delays = [ 0, 300, 800 ];
		let lastError = null;

		for ( const ms of delays ) {

			if ( ms > 0 ) await new Promise( resolve => setTimeout( resolve, ms ) );

			try {

				return createWebGLRenderer( antialias );

			} catch ( error ) {

				lastError = error;

			}

		}

		throw lastError;

	}

	async function createRenderer() {

		let rendererType = rendererTypeSelect.getValue();
		const antialias = antialiasBoolean.getValue();

		let newRenderer = null;
		let fellBackToWebGL = false;

		try {

			if ( rendererType === 'WebGPURenderer' ) {

				if ( ! navigator.gpu ) throw new Error( 'WebGPU is not available in this browser (navigator.gpu is undefined).' );
				newRenderer = new WebGPURenderer( { antialias: antialias, logarithmicDepthBuffer: true } );
				await newRenderer.init();

			} else {

				newRenderer = await createWebGLRendererWithRetries( antialias );

			}

		} catch ( error ) {

			if ( rendererType !== 'WebGPURenderer' ) {

				console.error( error );
				showRendererError( rendererType, error );
				if ( newRenderer && typeof newRenderer.dispose === 'function' ) newRenderer.dispose();
				return;

			}

			// WebGPU unavailable/failed — WebGL is the broadly-supported baseline,
			// so fall back to it automatically rather than showing an error.
			console.warn( 'WebGPU unavailable, falling back to WebGL:', ( error && error.message ) || error );
			if ( newRenderer && typeof newRenderer.dispose === 'function' ) newRenderer.dispose();

			try {

				newRenderer = await createWebGLRendererWithRetries( antialias );
				rendererType = 'WebGLRenderer';
				rendererTypeSelect.setValue( 'WebGLRenderer' );
				fellBackToWebGL = true;

			} catch ( fallbackError ) {

				console.error( fallbackError );
				showRendererError( 'WebGLRenderer', fallbackError );
				if ( newRenderer && typeof newRenderer.dispose === 'function' ) newRenderer.dispose();
				return;

			}

		}

		hideRendererError();

		currentRenderer = newRenderer;

		currentRenderer.shadowMap.enabled = shadowsBoolean.getValue();
		currentRenderer.shadowMap.type = parseFloat( shadowTypeSelect.getValue() );
		currentRenderer.toneMapping = parseFloat( toneMappingSelect.getValue() );
		currentRenderer.toneMappingExposure = toneMappingExposure.getValue();

		if ( fellBackToWebGL ) {

			// Persist directly — `createRenderer()` runs synchronously all the way
			// through on this (no-WebGPU) path, i.e. before the `signals.rendererUpdated.add(...)`
			// listener below even gets registered on first load, so dispatching the
			// signal alone wouldn't save it.
			config.setKey( 'project/renderer/type', 'WebGLRenderer' );

		}

		signals.rendererCreated.dispatch( currentRenderer );
		signals.rendererUpdated.dispatch(); // persists the (possibly fallen-back-to) rendererType

		if ( fellBackToWebGL ) {

			console.info( 'Strata: WebGPU was requested but unavailable — using WebGL instead. Retry WebGPU any time in Project \u203A Renderer.' );

		}

	}

	// Graceful fallback when a GPU context can't be created (e.g. Linux/Chrome
	// software rendering with llvmpipe/SwiftShader, or a blocklisted GPU). Without
	// this the WebGLRenderer constructor throws and the editor renders a blank page.

	function showRendererError( rendererType, error ) {

		let overlay = document.getElementById( 'webgl-error-overlay' );

		if ( overlay === null ) {

			overlay = document.createElement( 'div' );
			overlay.id = 'webgl-error-overlay';
			overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;' +
				'align-items:center;justify-content:center;background:#191919;color:#d6d6d6;' +
				'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
				'padding:24px;box-sizing:border-box;';
			document.body.appendChild( overlay );

		}

		const isWebGPU = rendererType === 'WebGPURenderer';
		const api = isWebGPU ? 'WebGPU' : 'WebGL';
		const message = ( error && error.message ) ? String( error.message ) : String( error );

		overlay.innerHTML =
			'<div style="max-width:560px;line-height:1.55;">' +
				'<h2 style="margin:0 0 12px;font-size:18px;color:#fff;">Could not start the 3D view</h2>' +
				'<p style="margin:0 0 12px;">Your browser was unable to create a <strong>' + api + '</strong> ' +
				'context, so the editor can\u2019t render. This usually means hardware ' +
				'acceleration is disabled or the GPU is being emulated in software ' +
				'(e.g. <code>llvmpipe</code> / SwiftShader on Linux).</p>' +
				'<p style="margin:0 0 8px;">Try one of the following, then reload:</p>' +
				'<ul style="margin:0 0 14px;padding-left:20px;">' +
					'<li>Enable <em>Use hardware acceleration when available</em> in your browser settings and restart it.</li>' +
					'<li>Confirm WebGL works at <a href="https://get.webgl.org/" style="color:#4ea1ff;" target="_blank" rel="noopener">get.webgl.org</a>.</li>' +
					'<li>On Linux, update your GPU drivers, or launch Chrome with ' +
						'<code>--enable-unsafe-swiftshader</code> (software fallback) or ' +
						'<code>--use-gl=angle --use-angle=gl</code>.</li>' +
					( isWebGPU ? '<li>Switch the renderer back to <strong>WebGL</strong> in Project \u203A Renderer.</li>' : '' ) +
					'<li>On mobile, this can happen transiently after switching apps or tabs — <strong>Try again</strong> often recovers without a full reload.</li>' +
				'</ul>' +
				'<button id="webgl-error-retry" style="margin-right:8px;padding:6px 14px;' +
					'background:#2a82da;color:#fff;border:none;border-radius:4px;cursor:pointer;">Try again</button>' +
				'<button id="webgl-error-reload" style="margin-right:8px;padding:6px 14px;' +
					'background:#3a3a3a;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reload</button>' +
				'<details style="margin-top:14px;color:#9a9a9a;">' +
					'<summary style="cursor:pointer;">Technical details</summary>' +
					'<pre style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;font-size:12px;">' +
						message.replace( /[<>&]/g, c => ( { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ c ] ) ) +
					'</pre>' +
				'</details>' +
			'</div>';

		const retryButton = document.getElementById( 'webgl-error-retry' );
		if ( retryButton !== null ) retryButton.onclick = () => createRenderer();

		const reloadButton = document.getElementById( 'webgl-error-reload' );
		if ( reloadButton !== null ) reloadButton.onclick = () => location.reload();

	}

	function hideRendererError() {

		const overlay = document.getElementById( 'webgl-error-overlay' );
		if ( overlay !== null ) overlay.remove();

	}

	createRenderer();


	// Signals

	signals.editorCleared.add( function () {

		currentRenderer.shadowMap.enabled = true;
		currentRenderer.shadowMap.type = THREE.PCFShadowMap;
		currentRenderer.toneMapping = THREE.NeutralToneMapping;
		currentRenderer.toneMappingExposure = 1;

		shadowsBoolean.setValue( currentRenderer.shadowMap.enabled );
		shadowTypeSelect.setValue( currentRenderer.shadowMap.type );
		toneMappingSelect.setValue( currentRenderer.toneMapping );
		toneMappingExposure.setValue( currentRenderer.toneMappingExposure );
		toneMappingExposure.setDisplay( currentRenderer.toneMapping === 0 ? 'none' : '' );

		signals.rendererUpdated.dispatch();

	} );

	signals.rendererUpdated.add( function () {

		config.setKey(
			'project/renderer/type', rendererTypeSelect.getValue(),
			'project/renderer/antialias', antialiasBoolean.getValue(),
			'project/renderer/shadows', shadowsBoolean.getValue(),
			'project/renderer/shadowType', parseFloat( shadowTypeSelect.getValue() ),
			'project/renderer/toneMapping', parseFloat( toneMappingSelect.getValue() ),
			'project/renderer/toneMappingExposure', toneMappingExposure.getValue()
		);

	} );

	return container;

}

export { SidebarProjectRenderer };
