import * as THREE from 'three';

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';

import { UIPanel, UIRow, UIText, UIButton, UISelect, UINumber } from './libs/ui.js';
import { holdTimelineAt } from './intelligence/timelineController.js';

// ── Sidebar.Render.js ─────────────────────────────────────────────────────────
// The "Render" tab: renders the Universal Timeline to a video file through a
// chosen camera. Uses a dedicated offscreen WebGLRenderer (so the viewport is
// untouched), steps the ONE shared clock frame-by-frame via holdTimelineAt(),
// and captures frames with canvas.captureStream() + MediaRecorder. The loop is
// paced to wall-clock (MediaRecorder timestamps frames by real time), so the
// output video duration matches the timeline duration exactly.

function SidebarRender( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	// NOT 'render' — the sidebar tab span itself gets id 'render' (same collision
	// rule as the Shell tab: tab id must differ from the panel's own id).
	container.setId( 'render-panel' );

	// ── Header ────────────────────────────────────────────────────────────────

	const header = new UIRow();
	header.add( new UIText( 'Video Render' ).setFontWeight( 'bold' ) );
	container.add( header );

	const help = new UIText( 'Renders the Universal Timeline to a video. Use the camera sequence below to cut/fade between cameras over time; with no shots the single camera above is used throughout.' );
	help.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	container.add( help );

	// ── Camera ────────────────────────────────────────────────────────────────

	const cameraRow = new UIRow();
	cameraRow.add( new UIText( 'Camera' ).setClass( 'Label' ) );
	const cameraSelect = new UISelect().setWidth( '160px' );
	cameraRow.add( cameraSelect );
	container.add( cameraRow );

	function updateCameraList() {

		const options = {};
		for ( const uuid in editor.cameras ) {

			const cam = editor.cameras[ uuid ];
			options[ uuid ] = cam.name || 'Camera';

		}

		const prev = cameraSelect.getValue();
		cameraSelect.setOptions( options );
		cameraSelect.setValue( options[ prev ] !== undefined ? prev : editor.camera.uuid );

	}

	signals.cameraAdded.add( updateCameraList );
	signals.cameraRemoved.add( updateCameraList );
	signals.objectChanged.add( function ( object ) {

		if ( object && object.isCamera ) updateCameraList();

	} );
	signals.editorCleared.add( updateCameraList );
	updateCameraList();

	// ── Resolution ────────────────────────────────────────────────────────────

	const resolutionRow = new UIRow();
	resolutionRow.add( new UIText( 'Resolution' ).setClass( 'Label' ) );
	const resolutionSelect = new UISelect().setWidth( '160px' );
	resolutionSelect.setOptions( {
		'1920x1080': '1920 × 1080 (1080p)',
		'1280x720': '1280 × 720 (720p)',
		'854x480': '854 × 480 (480p)',
		'640x360': '640 × 360 (360p)',
		'1080x1080': '1080 × 1080 (square)',
	} );
	resolutionSelect.setValue( '1280x720' );
	resolutionRow.add( resolutionSelect );
	container.add( resolutionRow );

	// ── FPS ───────────────────────────────────────────────────────────────────

	const fpsRow = new UIRow();
	fpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
	const fpsSelect = new UISelect().setWidth( '160px' );
	fpsSelect.setOptions( { '24': '24', '30': '30', '60': '60' } );
	fpsSelect.setValue( '30' );
	fpsRow.add( fpsSelect );
	container.add( fpsRow );

	// ── Duration (from the universal timeline — read-only) ───────────────────

	const durationRow = new UIRow();
	durationRow.add( new UIText( 'Duration' ).setClass( 'Label' ) );
	const durationText = new UIText( '0.00 s' );
	durationRow.add( durationText );
	container.add( durationRow );

	function timelineDuration() {

		const anims = editor.scene.animations || [];
		const clip = anims.find( c => c.userData && c.userData.isTimeline );
		if ( clip && clip.duration > 0 ) return clip.duration;
		return editor.timeline ? editor.timeline.duration : 0;

	}

	function updateDuration() {

		const d = timelineDuration();
		durationText.setValue( d > 0 ? d.toFixed( 2 ) + ' s' : 'Timeline is empty' );
		renderButton.dom.disabled = ( d <= 0 ) || rendering;

	}

	signals.timelineChanged.add( updateDuration );
	signals.animationsChanged.add( updateDuration );
	signals.editorCleared.add( updateDuration );

	// ── Camera sequence (shots + transitions) ─────────────────────────────────
	// Persisted in scene.userData.renderShots (same versioning path as the
	// timeline model). A shot = { id, at, camera:uuid, transition:'cut'|'fade',
	// transitionDur }. A shot runs from its `at` until the next shot's `at` (or
	// the timeline end); `transition` describes how the shot is ENTERED.

	const seqHeader = new UIRow();
	seqHeader.add( new UIText( 'Camera Sequence' ).setFontWeight( 'bold' ) );
	container.add( seqHeader );

	const seqLane = document.createElement( 'div' );
	seqLane.style.cssText = 'position:relative;height:34px;border:1px solid rgba(128,128,128,0.4);border-radius:4px;background:rgba(128,128,128,0.12);margin:4px 0 6px;overflow:hidden;';
	container.dom.appendChild( seqLane );

	const seqControls = document.createElement( 'div' );
	seqControls.style.cssText = 'margin-bottom:8px;';
	container.dom.appendChild( seqControls );

	const addShotButton = new UIButton( '+ Add Shot' );
	addShotButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	addShotButton.onClick( addShot );
	seqControls.appendChild( addShotButton.dom );

	const shotDetail = document.createElement( 'div' );
	shotDetail.style.cssText = 'margin-top:6px;display:none;';
	seqControls.appendChild( shotDetail );

	let selectedShotId = null;

	function getShots() {

		const ud = editor.scene.userData = editor.scene.userData || {};
		if ( ! Array.isArray( ud.renderShots ) ) ud.renderShots = [];
		ud.renderShots.sort( ( a, b ) => a.at - b.at );
		return ud.renderShots;

	}

	function cameraOf( shot ) {

		return ( shot && editor.cameras[ shot.camera ] ) || editor.camera;

	}

	function addShot() {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 1 );
		const lastAt = shots.length ? shots[ shots.length - 1 ].at : - 1;
		const at = shots.length === 0 ? 0 : Math.min( dur - 0.1, lastAt + Math.max( 0.5, ( dur - lastAt ) / 2 ) );
		const shot = {
			id: 'shot-' + Math.random().toString( 36 ).slice( 2, 9 ),
			at: Math.max( 0, at ),
			camera: cameraSelect.getValue() || editor.camera.uuid,
			transition: shots.length === 0 ? 'cut' : 'fade',
			transitionDur: 0.5,
		};
		shots.push( shot );
		selectedShotId = shot.id;
		refreshSequencer();

	}

	function refreshSequencer() {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 0.001 );
		seqLane.innerHTML = '';

		if ( shots.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:0.55;';
			empty.textContent = 'No shots — single camera render';
			seqLane.appendChild( empty );
			shotDetail.style.display = 'none';
			return;

		}

		const COLORS = [ '#3b82c4', '#c46a3b', '#5aa860', '#9a5ac4', '#c4b23b', '#c45a7a' ];

		for ( let i = 0; i < shots.length; i ++ ) {

			const shot = shots[ i ];
			const end = i + 1 < shots.length ? shots[ i + 1 ].at : dur;
			const left = ( shot.at / dur ) * 100;
			const width = Math.max( 0.5, ( ( end - shot.at ) / dur ) * 100 );

			const block = document.createElement( 'div' );
			const selected = shot.id === selectedShotId;
			block.style.cssText = `position:absolute;top:2px;bottom:2px;left:${ left }%;width:${ width }%;background:${ COLORS[ i % COLORS.length ] };border-radius:3px;cursor:${ i === 0 ? 'pointer' : 'ew-resize' };overflow:hidden;white-space:nowrap;font-size:10px;color:#fff;display:flex;align-items:center;padding:0 5px;box-sizing:border-box;${ selected ? 'outline:2px solid #08f;outline-offset:-2px;' : 'opacity:0.85;' }`;
			block.title = `${ cameraOf( shot ).name || 'Camera' } @ ${ shot.at.toFixed( 2 ) }s (${ shot.transition }${ shot.transition === 'fade' ? ' ' + shot.transitionDur + 's' : '' })`;
			block.textContent = ( shot.transition === 'fade' && i > 0 ? '◤ ' : '' ) + ( cameraOf( shot ).name || 'Camera' );
			seqLane.appendChild( block );

			block.addEventListener( 'pointerdown', ( e ) => {

				e.preventDefault();
				selectedShotId = shot.id;
				refreshSequencer();

				if ( i === 0 ) return; // first shot is pinned to t=0

				const startX = e.clientX;
				const startAt = shot.at;
				const laneW = seqLane.getBoundingClientRect().width;
				const minAt = shots[ i - 1 ].at + 0.05;
				const maxAt = ( i + 1 < shots.length ? shots[ i + 1 ].at : dur ) - 0.05;

				function onMove( me ) {

					shot.at = Math.min( maxAt, Math.max( minAt, startAt + ( ( me.clientX - startX ) / laneW ) * dur ) );
					refreshSequencer();

				}

				function onUp() {

					window.removeEventListener( 'pointermove', onMove );
					window.removeEventListener( 'pointerup', onUp );
					refreshSequencer();

				}

				window.addEventListener( 'pointermove', onMove );
				window.addEventListener( 'pointerup', onUp );

			} );

		}

		refreshShotDetail();

	}

	function refreshShotDetail() {

		const shots = getShots();
		const shot = shots.find( s => s.id === selectedShotId );
		shotDetail.innerHTML = '';

		if ( ! shot ) {

			shotDetail.style.display = 'none';
			return;

		}

		shotDetail.style.display = '';
		const index = shots.indexOf( shot );

		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;';
		shotDetail.appendChild( row );

		// camera picker
		const camSel = new UISelect().setWidth( '110px' );
		const camOptions = {};
		for ( const uuid in editor.cameras ) camOptions[ uuid ] = editor.cameras[ uuid ].name || 'Camera';
		camSel.setOptions( camOptions );
		camSel.setValue( shot.camera );
		camSel.onChange( function () { shot.camera = this.getValue(); refreshSequencer(); } );
		row.appendChild( camSel.dom );

		// start time (first shot pinned to 0)
		const atLabel = document.createElement( 'span' );
		atLabel.textContent = 'at';
		row.appendChild( atLabel );
		const atNum = new UINumber( shot.at ).setWidth( '44px' ).setPrecision( 2 ).setRange( 0, 10000 );
		atNum.dom.style.pointerEvents = index === 0 ? 'none' : '';
		atNum.onChange( function () {

			if ( index === 0 ) { atNum.setValue( 0 ); return; }
			const minAt = shots[ index - 1 ].at + 0.05;
			const maxAt = ( index + 1 < shots.length ? shots[ index + 1 ].at : timelineDuration() ) - 0.05;
			shot.at = Math.min( maxAt, Math.max( minAt, atNum.getValue() ) );
			refreshSequencer();

		} );
		row.appendChild( atNum.dom );

		// transition (only meaningful from the 2nd shot on)
		if ( index > 0 ) {

			const transSel = new UISelect().setWidth( '64px' );
			transSel.setOptions( { 'cut': 'cut', 'fade': 'fade' } );
			transSel.setValue( shot.transition || 'cut' );
			transSel.onChange( function () { shot.transition = this.getValue(); refreshSequencer(); } );
			row.appendChild( transSel.dom );

			const fadeNum = new UINumber( shot.transitionDur || 0.5 ).setWidth( '38px' ).setPrecision( 2 ).setRange( 0.05, 30 );
			fadeNum.dom.title = 'Fade duration (s)';
			fadeNum.dom.style.display = ( shot.transition === 'fade' ) ? '' : 'none';
			fadeNum.onChange( function () { shot.transitionDur = fadeNum.getValue(); refreshSequencer(); } );
			row.appendChild( fadeNum.dom );

		}

		const delBtn = new UIButton( 'Delete' );
		delBtn.dom.style.cssText = 'height:20px;padding:0 8px;border-radius:4px;font-size:10px;';
		delBtn.onClick( function () {

			shots.splice( shots.indexOf( shot ), 1 );
			if ( shots.length > 0 ) shots[ 0 ].at = 0; // keep the first shot pinned
			selectedShotId = null;
			refreshSequencer();

		} );
		row.appendChild( delBtn.dom );

	}

	// Cheap + debounced: covers load (setScene), camera renames, timeline edits.
	let seqRefreshTimer = null;
	function scheduleSeqRefresh() {

		clearTimeout( seqRefreshTimer );
		seqRefreshTimer = setTimeout( refreshSequencer, 200 );

	}

	signals.timelineChanged.add( scheduleSeqRefresh );
	signals.cameraAdded.add( scheduleSeqRefresh );
	signals.cameraRemoved.add( scheduleSeqRefresh );
	signals.editorCleared.add( scheduleSeqRefresh );
	signals.sceneGraphChanged.add( scheduleSeqRefresh );

	// ── Render / Cancel buttons ───────────────────────────────────────────────

	const buttonRow = new UIRow();

	const renderButton = new UIButton( 'Render & Export' );
	renderButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;';
	renderButton.onClick( function () { startRender(); } );
	buttonRow.add( renderButton );

	const cancelButton = new UIButton( 'Cancel' );
	cancelButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;margin-left:6px;display:none;';
	cancelButton.onClick( function () { cancelRequested = true; } );
	buttonRow.add( cancelButton );

	container.add( buttonRow );

	// ── Progress bar + status ─────────────────────────────────────────────────

	const progressOuter = document.createElement( 'div' );
	progressOuter.style.cssText = 'height:8px;background:rgba(128,128,128,0.25);border-radius:4px;overflow:hidden;margin:10px 0 4px;display:none;';
	const progressInner = document.createElement( 'div' );
	progressInner.style.cssText = 'height:100%;width:0%;background:#08f;transition:width 0.1s linear;';
	progressOuter.appendChild( progressInner );
	container.dom.appendChild( progressOuter );

	const statusText = document.createElement( 'div' );
	statusText.style.cssText = 'font-size:11px;opacity:0.75;min-height:16px;margin-bottom:8px;';
	container.dom.appendChild( statusText );

	function setProgress( fraction, message ) {

		progressOuter.style.display = '';
		progressInner.style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';
		statusText.textContent = message || '';

	}

	// ── Live preview area ─────────────────────────────────────────────────────

	const previewWrap = document.createElement( 'div' );
	previewWrap.style.cssText = 'margin-top:6px;border:1px solid rgba(128,128,128,0.35);border-radius:4px;overflow:hidden;display:none;line-height:0;';
	container.dom.appendChild( previewWrap );

	// ── Render pipeline ───────────────────────────────────────────────────────

	let rendering = false;
	let cancelRequested = false;

	function pickMimeType() {

		const candidates = [
			'video/mp4;codecs=avc1.42E01E',
			'video/mp4',
			'video/webm;codecs=vp9',
			'video/webm;codecs=vp8',
			'video/webm',
		];
		for ( const m of candidates ) {

			if ( window.MediaRecorder && MediaRecorder.isTypeSupported( m ) ) return m;

		}

		return '';

	}

	function extensionFor( mime ) {

		return mime.indexOf( 'mp4' ) !== - 1 ? 'mp4' : 'webm';

	}

	function sleep( ms ) {

		return new Promise( resolve => setTimeout( resolve, ms ) );

	}

	function downloadBlob( blob, filename ) {

		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout( () => URL.revokeObjectURL( url ), 5000 );

	}

	async function startRender() {

		if ( rendering ) return;

		const duration = timelineDuration();
		if ( ! ( duration > 0 ) ) {

			setProgress( 0, 'Timeline is empty — nothing to render.' );
			return;

		}

		const mime = pickMimeType();
		if ( ! mime ) {

			setProgress( 0, 'MediaRecorder video capture is not supported in this browser.' );
			return;

		}

		const shots = getShots().slice();
		const fallbackCamera = editor.cameras[ cameraSelect.getValue() ] || editor.camera;
		const [ width, height ] = resolutionSelect.getValue().split( 'x' ).map( Number );
		const fps = parseInt( fpsSelect.getValue(), 10 );

		rendering = true;
		cancelRequested = false;
		renderButton.dom.disabled = true;
		cancelButton.dom.style.display = '';

		// Two canvases: WebGL renders offscreen, a 2D canvas composites (needed
		// for crossfades: draw shot A, then shot B on top with globalAlpha) and is
		// the captureStream() source + live preview.
		const glCanvas = document.createElement( 'canvas' );
		glCanvas.width = width;
		glCanvas.height = height;

		const outCanvas = document.createElement( 'canvas' );
		outCanvas.width = width;
		outCanvas.height = height;
		outCanvas.style.cssText = 'width:100%;height:auto;display:block;';
		const ctx = outCanvas.getContext( '2d' );
		previewWrap.innerHTML = '';
		previewWrap.appendChild( outCanvas );
		previewWrap.style.display = '';

		const renderer = new THREE.WebGLRenderer( { canvas: glCanvas, antialias: true, preserveDrawingBuffer: true } );
		renderer.setPixelRatio( 1 );
		renderer.setSize( width, height, false );
		renderer.setClearColor( 0xaaaaaa ); // same base as the viewport; scene.background overrides

		// Mirror the project renderer settings (shadows / tone mapping) so the
		// output matches what the viewport shows.
		const config = editor.config;
		renderer.shadowMap.enabled = config.getKey( 'project/renderer/shadows' ) !== false;
		renderer.shadowMap.type = parseFloat( config.getKey( 'project/renderer/shadowType' ) ) || THREE.PCFShadowMap;
		renderer.toneMapping = parseFloat( config.getKey( 'project/renderer/toneMapping' ) ) || THREE.NoToneMapping;
		renderer.toneMappingExposure = parseFloat( config.getKey( 'project/renderer/toneMappingExposure' ) ) || 1;

		// The viewport's PMREM environment is a render-target texture bound to the
		// VIEWPORT's WebGL context — it cannot upload into this renderer, so PBR
		// materials would render black ("no colors"). Regenerate an equivalent
		// environment in THIS context and restore the original afterwards.
		const scene = editor.scene;
		let restoreEnvironment = function () {};
		if ( scene.environment && scene.environment.isRenderTargetTexture ) {

			const pmrem = new THREE.PMREMGenerator( renderer );
			const envScene = ( scene.background && scene.background.isColor )
				? new ColorEnvironment( scene.background )
				: new RoomEnvironment();
			const envRT = pmrem.fromScene( envScene, 0.04 );
			const prevEnv = scene.environment;
			scene.environment = envRT.texture;
			restoreEnvironment = function () {

				scene.environment = prevEnv;
				envRT.dispose();
				pmrem.dispose();

			};

		}

		// Set the render aspect on EVERY camera used (sequence + fallback),
		// restore all afterwards.
		const aspect = width / height;
		const camerasUsed = new Set( [ fallbackCamera ] );
		for ( const s of shots ) camerasUsed.add( cameraOf( s ) );
		const cameraRestores = [];
		for ( const cam of camerasUsed ) {

			if ( cam.isPerspectiveCamera ) {

				const prevAspect = cam.aspect;
				cam.aspect = aspect;
				cam.updateProjectionMatrix();
				cameraRestores.push( () => { cam.aspect = prevAspect; cam.updateProjectionMatrix(); } );

			} else if ( cam.isOrthographicCamera ) {

				const prev = { left: cam.left, right: cam.right };
				cam.left = - aspect;
				cam.right = aspect;
				cam.updateProjectionMatrix();
				cameraRestores.push( () => { cam.left = prev.left; cam.right = prev.right; cam.updateProjectionMatrix(); } );

			}

		}

		// Which camera(s) drive the frame at time t: current shot, plus the
		// previous shot's camera while inside a fade window (blend 0→1).
		function shotStateAt( t ) {

			if ( shots.length === 0 ) return { camera: fallbackCamera, from: null, blend: 1 };
			let i = shots.length - 1;
			while ( i > 0 && shots[ i ].at > t ) i --;
			const cur = shots[ i ];
			const prev = i > 0 ? shots[ i - 1 ] : null;
			if ( prev && cur.transition === 'fade' && cur.transitionDur > 0 && t < cur.at + cur.transitionDur ) {

				const k = ( t - cur.at ) / cur.transitionDur;
				return { camera: cameraOf( cur ), from: cameraOf( prev ), blend: k * k * ( 3 - 2 * k ) };

			}

			return { camera: cameraOf( cur ), from: null, blend: 1 };

		}

		// captureStream(fps) auto-samples on canvas repaint; requestFrame() (where
		// supported) forces an exact capture per composited frame.
		const stream = outCanvas.captureStream( fps );
		const videoTrack = stream.getVideoTracks()[ 0 ];
		const recorder = new MediaRecorder( stream, {
			mimeType: mime,
			videoBitsPerSecond: Math.min( 24_000_000, width * height * fps * 0.15 ),
		} );
		const chunks = [];
		recorder.ondataavailable = e => { if ( e.data && e.data.size > 0 ) chunks.push( e.data ); };
		const recorderStopped = new Promise( resolve => { recorder.onstop = resolve; } );
		recorder.start();

		const totalFrames = Math.max( 1, Math.round( duration * fps ) );
		const frameMs = 1000 / fps;

		try {

			// Wall-clock driven: MediaRecorder timestamps frames by real time, so
			// sampling the timeline at the true elapsed time keeps the output video
			// duration equal to the timeline duration even when the browser
			// throttles timers (background tab) — throttling just drops frames.
			const startWall = performance.now();

			while ( true ) {

				if ( cancelRequested ) break;

				const elapsed = ( performance.now() - startWall ) / 1000;
				const t = Math.min( duration, elapsed );

				holdTimelineAt( editor, t );

				const state = shotStateAt( t );

				if ( state.from ) {

					// crossfade: previous shot full, current shot on top with alpha
					renderer.render( scene, state.from );
					ctx.globalAlpha = 1;
					ctx.drawImage( glCanvas, 0, 0 );
					renderer.render( scene, state.camera );
					ctx.globalAlpha = state.blend;
					ctx.drawImage( glCanvas, 0, 0 );
					ctx.globalAlpha = 1;

				} else {

					renderer.render( scene, state.camera );
					ctx.drawImage( glCanvas, 0, 0 );

				}

				if ( videoTrack.requestFrame ) videoTrack.requestFrame();

				setProgress( t / duration, `Rendering ${ t.toFixed( 2 ) }s / ${ duration.toFixed( 2 ) }s (${ Math.round( t * fps ) } / ${ totalFrames } frames)` );

				if ( t >= duration ) break;

				await sleep( frameMs );

			}

		} finally {

			recorder.stop();
			await recorderStopped;

			for ( const restore of cameraRestores ) restore();
			restoreEnvironment();
			holdTimelineAt( editor, 0 );
			signals.sceneGraphChanged.dispatch();
			renderer.dispose();

			rendering = false;
			cancelButton.dom.style.display = 'none';
			updateDuration(); // re-enables the render button if timeline non-empty

		}

		if ( cancelRequested ) {

			setProgress( 0, 'Render cancelled.' );
			previewWrap.style.display = 'none';
			return;

		}

		const blob = new Blob( chunks, { type: mime.split( ';' )[ 0 ] } );
		const label = shots.length > 0 ? 'sequence' : ( fallbackCamera.name || 'camera' ).replace( /[^\w\-]+/g, '_' );
		downloadBlob( blob, `render-${ label }-${ width }x${ height }-${ fps }fps.${ extensionFor( mime ) }` );
		setProgress( 1, 'Done — video downloaded.' );

	}

	updateDuration();
	refreshSequencer();

	return container;

}

export { SidebarRender };
