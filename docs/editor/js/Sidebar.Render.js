import * as THREE from 'three';

import { UIPanel, UIRow, UIText, UIButton, UISelect } from './libs/ui.js';
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

	const help = new UIText( 'Renders the Universal Timeline through the selected camera and downloads the video.' );
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

		const camera = editor.cameras[ cameraSelect.getValue() ] || editor.camera;
		const [ width, height ] = resolutionSelect.getValue().split( 'x' ).map( Number );
		const fps = parseInt( fpsSelect.getValue(), 10 );

		rendering = true;
		cancelRequested = false;
		renderButton.dom.disabled = true;
		cancelButton.dom.style.display = '';

		// Offscreen canvas + dedicated renderer (the viewport keeps its own).
		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		canvas.style.cssText = 'width:100%;height:auto;display:block;';
		previewWrap.innerHTML = '';
		previewWrap.appendChild( canvas );
		previewWrap.style.display = '';

		const renderer = new THREE.WebGLRenderer( { canvas, antialias: true, preserveDrawingBuffer: true } );
		renderer.setPixelRatio( 1 );
		renderer.setSize( width, height, false );
		renderer.shadowMap.enabled = true;
		renderer.setClearColor( 0xaaaaaa ); // same base as the viewport; scene.background overrides

		// Match the render aspect on the chosen camera, restore afterwards.
		const aspect = width / height;
		let restoreCamera = function () {};
		if ( camera.isPerspectiveCamera ) {

			const prevAspect = camera.aspect;
			camera.aspect = aspect;
			camera.updateProjectionMatrix();
			restoreCamera = function () { camera.aspect = prevAspect; camera.updateProjectionMatrix(); };

		} else if ( camera.isOrthographicCamera ) {

			const prev = { left: camera.left, right: camera.right };
			camera.left = - aspect;
			camera.right = aspect;
			camera.updateProjectionMatrix();
			restoreCamera = function () { camera.left = prev.left; camera.right = prev.right; camera.updateProjectionMatrix(); };

		}

		// captureStream(fps) auto-samples on canvas repaint; requestFrame() (where
		// supported) forces an exact capture per rendered frame.
		const stream = canvas.captureStream( fps );
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
				renderer.render( editor.scene, camera );
				if ( videoTrack.requestFrame ) videoTrack.requestFrame();

				setProgress( t / duration, `Rendering ${ t.toFixed( 2 ) }s / ${ duration.toFixed( 2 ) }s (${ Math.round( t * fps ) } / ${ totalFrames } frames)` );

				if ( t >= duration ) break;

				await sleep( frameMs );

			}

		} finally {

			recorder.stop();
			await recorderStopped;

			restoreCamera();
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
		const name = ( camera.name || 'camera' ).replace( /[^\w\-]+/g, '_' );
		downloadBlob( blob, `render-${ name }-${ width }x${ height }-${ fps }fps.${ extensionFor( mime ) }` );
		setProgress( 1, 'Done — video downloaded.' );

	}

	updateDuration();

	return container;

}

export { SidebarRender };
