import { UIPanel, UISelect } from './libs/ui.js';

function ViewportControls( editor ) {

	const signals = editor.signals;

	// camera panel — bottom left

	const cameraPanel = new UIPanel();
	cameraPanel.setPosition( 'absolute' );
	cameraPanel.setLeft( '10px' );
	cameraPanel.setBottom( '10px' );

	// Hide cameras: the camera helpers (frustum lines) disappear from the scene and, with them,
	// their pick targets, so cameras can't be clicked while selecting other objects. Same flag
	// as View > Camera Helpers.
	const hideCameras = document.createElement( 'button' );
	hideCameras.type = 'button';
	hideCameras.className = 'ViewportIconButton';
	hideCameras.style.cssText = 'display:inline-block;vertical-align:top;margin-right:6px;';
	const CAMERA_ICON = '<path d="M3 7h11v10H3z"/><path d="M14 10l7-3v10l-7-3z"/>';
	const SLASH = '<path d="M3 21 21 3" stroke-width="2.4"/>';
	const svg = inner => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ inner }</svg>`;

	function refreshHideCameras() {

		const hidden = ! editor.helperStates.cameraHelpers;
		hideCameras.classList.toggle( 'selected', hidden );
		hideCameras.innerHTML = svg( CAMERA_ICON + ( hidden ? SLASH : '' ) );
		hideCameras.title = hidden ? 'Show cameras' : 'Hide cameras (not visible or selectable in the scene)';

	}

	hideCameras.addEventListener( 'click', function () {

		const selected = editor.selected;
		editor.helperStates.cameraHelpers = ! editor.helperStates.cameraHelpers;
		signals.showHelpersChanged.dispatch( editor.helperStates );
		if ( ! editor.helperStates.cameraHelpers && selected && selected.isCamera && selected !== editor.camera ) editor.select( null );

	} );
	signals.showHelpersChanged.add( refreshHideCameras );
	refreshHideCameras();
	cameraPanel.dom.appendChild( hideCameras );

	const cameraSelect = new UISelect();
	cameraSelect.onChange( function () {

		editor.setViewportCamera( this.getValue() );

	} );
	cameraSelect.dom.style.display = 'inline-block';
	cameraPanel.add( cameraSelect );

	signals.cameraAdded.add( update );
	signals.cameraRemoved.add( update );
	// The dropdown's selected VALUE, not just its option list — e.g. fromJSON()
	// resolves the restored viewport camera asynchronously, after this panel's
	// own initial update() already ran with the default camera.
	signals.viewportCameraChanged.add( function () {

		cameraSelect.setValue( editor.viewportCamera.uuid );

	} );
	signals.objectChanged.add( function ( object ) {

		if ( object.isCamera ) {

			updateCameraList();

		}

	} );

	// shading panel — bottom right

	const shadingPanel = new UIPanel();
	shadingPanel.setPosition( 'absolute' );
	shadingPanel.setRight( '10px' );
	shadingPanel.setBottom( '10px' );

	const shadingSelect = new UISelect();
	shadingSelect.setOptions( { 'solid': 'solid', 'normals': 'normals', 'wireframe': 'wireframe' } );
	shadingSelect.setValue( 'solid' );
	shadingSelect.onChange( function () {

		editor.setViewportShading( this.getValue() );

	} );
	shadingPanel.add( shadingSelect );

	signals.editorCleared.add( function () {

		editor.setViewportCamera( editor.camera.uuid );

		shadingSelect.setValue( 'solid' );
		editor.setViewportShading( shadingSelect.getValue() );

	} );

	signals.cameraResetted.add( update );

	update();

	//

	function updateCameraList() {

		const options = {};

		const cameras = editor.cameras;

		for ( const key in cameras ) {

			const camera = cameras[ key ];
			options[ camera.uuid ] = camera.name;

		}

		cameraSelect.setOptions( options );

		const selectedCamera = ( editor.viewportCamera.uuid in options )
			? editor.viewportCamera
			: editor.camera;

		cameraSelect.setValue( selectedCamera.uuid );

		return selectedCamera;

	}

	function update() {

		const selectedCamera = updateCameraList();
		editor.setViewportCamera( selectedCamera.uuid );

	}

	return [ cameraPanel, shadingPanel ];

}

export { ViewportControls };
