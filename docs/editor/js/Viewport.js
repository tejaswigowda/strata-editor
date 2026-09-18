import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';

import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { UIPanel } from './libs/ui.js';

import { EditorControls } from './EditorControls.js';

import { ViewportControls } from './Viewport.Controls.js';

import { ViewHelper } from './Viewport.ViewHelper.js';
import { XR } from './Viewport.XR.js';

import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';

import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ViewportPathtracer } from './Viewport.Pathtracer.js';
import { createProgressBanner } from './mesh/GeometryOptimizer.js';
import { lassoSelect } from './intelligence/lassoSelect.js';
import { releaseTimelineObject, syncMaterialTransparency } from './intelligence/timelineController.js';
import { hydrateHtmlEmbed } from './HtmlEmbed.js';
import { hydrateMarkdownEmbed } from './MarkdownEmbed.js';
import { hydrateCallcard } from './Callcard.js';

/**
 * Cube border helper: `node.userData.hasEdgeOutline` is a plain, serializable
 * boolean flag (set via the JS Shell, e.g. `$S('.cube').each(n =>
 * n.userData.hasEdgeOutline = true)`); the actual LineSegments/EdgesGeometry
 * child is rebuilt here on demand instead of being persisted, since
 * EdgesGeometry has no registered loader in this build (see
 * withoutEdgeOutlines's doc comment in timeline.js for what happens if one
 * DOES end up serialized). Idempotent — skips nodes that already have one.
 */
function hydrateEdgeOutline( node ) {

	if ( ! node.isMesh || ! node.geometry || ! node.userData || ! node.userData.hasEdgeOutline ) return;
	if ( node.children.some( c => c.userData && c.userData.isEdgeOutline ) ) return;

	const outline = new THREE.LineSegments(
		new THREE.EdgesGeometry( node.geometry ),
		new THREE.LineBasicMaterial( { color: 0x000000 } )
	);
	outline.name = '__edgeOutline';
	outline.userData.isEdgeOutline = true;
	node.add( outline );

}

function Viewport( editor ) {

	const selector = editor.selector;
	const signals = editor.signals;

	const container = new UIPanel();
	container.setId( 'viewport' );
	container.setPosition( 'absolute' );

	const vControls = ViewportControls( editor );
	container.add( vControls[ 0 ] );
	container.add( vControls[ 1 ] );

	//

	let renderer = null;
	let pmremGenerator = null;
	let pathtracer = null;
	let contextLostTimer = null;

	const camera = editor.camera;
	const scene = editor.scene;
	const sceneHelpers = editor.sceneHelpers;

	// helpers

	const viewHelper = new ViewHelper( camera, container );
	viewHelper.onRequireRender = () => render();

	//

	const box = new THREE.Box3();

	const selectionBox = new THREE.Box3Helper( box );
	selectionBox.material.depthTest = false;
	selectionBox.material.transparent = true;
	selectionBox.visible = false;
	sceneHelpers.add( selectionBox );

	// Extra selection boxes for the non-primary objects of a multi-selection

	const multiSelectionBoxes = [];

	function clearMultiSelectionBoxes() {

		for ( let i = 0; i < multiSelectionBoxes.length; i ++ ) {

			sceneHelpers.remove( multiSelectionBoxes[ i ] );
			multiSelectionBoxes[ i ].geometry.dispose();

		}

		multiSelectionBoxes.length = 0;

	}

	function addMultiSelectionBox( object ) {

		const helperBox = new THREE.Box3();
		helperBox.setFromObject( object, true );

		if ( helperBox.isEmpty() ) return;

		const helper = new THREE.Box3Helper( helperBox, 0xffaa00 );
		helper.material.depthTest = false;
		helper.material.transparent = true;
		helper.userData.object = object;
		sceneHelpers.add( helper );
		multiSelectionBoxes.push( helper );

	}

	function updateMultiSelectionBoxes() {

		for ( let i = 0; i < multiSelectionBoxes.length; i ++ ) {

			const helper = multiSelectionBoxes[ i ];
			helper.box.setFromObject( helper.userData.object, true );

		}

	}

	// Pivot used as a shared transform anchor when several objects are selected

	const selectionPivot = new THREE.Group();
	selectionPivot.name = '__selectionPivot';

	let pivotActive = false;
	const _pivotStartMatrix = new THREE.Matrix4();
	const _pivotStartInverse = new THREE.Matrix4();
	const _dragStartWorld = new Map(); // object -> Matrix4 ( world at drag start )
	const _dragStartLocal = new Map(); // object -> { position, rotation, scale }

	const _tmpMatrix = new THREE.Matrix4();
	const _tmpDelta = new THREE.Matrix4();
	const _tmpParentInverse = new THREE.Matrix4();

	let objectPositionOnDown = null;
	let objectRotationOnDown = null;
	let objectScaleOnDown = null;

	// Edit Mode: the gizmo drags this proxy (parked at the selection centroid) and
	// the delta is applied to the selected vertices, so the mesh itself never moves.
	const editProxy = new THREE.Object3D();
	editProxy.name = '__editGizmoProxy';
	sceneHelpers.add( editProxy );
	let editDragActive = false;
	const _editStartInverse = new THREE.Matrix4();
	const _editDelta = new THREE.Matrix4();

	function editModeActive() {

		const emc = editor.editModeController;
		return !! ( emc && emc.active );

	}

	// Park the gizmo on the current sub-object selection (or hide it when empty).
	function syncEditGizmo() {

		const emc = editor.editModeController;
		if ( ! emc || ! emc.active ) return;

		const c = emc.selectionCentroidWorld();
		if ( c ) {

			editProxy.position.copy( c );
			editProxy.rotation.set( 0, 0, 0 );
			editProxy.scale.set( 1, 1, 1 );
			editProxy.updateMatrixWorld( true );
			if ( transformControls.object !== editProxy ) transformControls.attach( editProxy );

		} else if ( transformControls.object === editProxy ) {

			transformControls.detach();

		}

		render();

	}

	const transformControls = new TransformControls( camera );
	transformControls.addEventListener( 'axis-changed', function () {

		render();

	} );
	transformControls.addEventListener( 'objectChange', function () {

		if ( editDragActive ) {

			editProxy.updateMatrixWorld( true );
			_editDelta.multiplyMatrices( editProxy.matrixWorld, _editStartInverse );
			editor.editModeController.applyTransform( _editDelta );
			render();
			return;

		}

		if ( pivotActive ) {

			// Apply the pivot's delta transform to every selected object

			selectionPivot.updateMatrixWorld( true );

			_tmpDelta.multiplyMatrices( selectionPivot.matrixWorld, _pivotStartInverse );

			const selection = editor.getSelectedObjects();

			for ( let i = 0; i < selection.length; i ++ ) {

				const object = selection[ i ];
				const startWorld = _dragStartWorld.get( object );
				if ( startWorld === undefined ) continue;

				_tmpMatrix.multiplyMatrices( _tmpDelta, startWorld );

				object.parent.updateMatrixWorld( true );
				_tmpParentInverse.copy( object.parent.matrixWorld ).invert();
				_tmpMatrix.premultiply( _tmpParentInverse );

				_tmpMatrix.decompose( object.position, object.quaternion, object.scale );
				object.updateMatrixWorld( true );

				signals.objectChanged.dispatch( object );

			}

		} else {

			signals.objectChanged.dispatch( transformControls.object );

		}

	} );
	transformControls.addEventListener( 'mouseDown', function () {

		const object = transformControls.object;

		// Scoped release: if the timeline is holding a sampled pose (paused/
		// scrubbed frame), gizmo-editing THIS object must not fight its held
		// binding. Every OTHER held target is unaffected — a no-op when `object`
		// isn't a timeline target at all (e.g. play() is running, or nothing's
		// authored on it).
		releaseTimelineObject( editor, object );

		if ( editModeActive() && object === editProxy ) {

			editProxy.updateMatrixWorld( true );
			_editStartInverse.copy( editProxy.matrixWorld ).invert();
			editDragActive = editor.editModeController.beginTransform();
			controls.enabled = false;
			return;

		}

		if ( pivotActive ) {

			selectionPivot.updateMatrixWorld( true );
			_pivotStartMatrix.copy( selectionPivot.matrixWorld );
			_pivotStartInverse.copy( _pivotStartMatrix ).invert();

			_dragStartWorld.clear();
			_dragStartLocal.clear();

			const selection = editor.getSelectedObjects();

			for ( let i = 0; i < selection.length; i ++ ) {

				const selected = selection[ i ];
				selected.updateMatrixWorld( true );
				_dragStartWorld.set( selected, selected.matrixWorld.clone() );
				_dragStartLocal.set( selected, {
					position: selected.position.clone(),
					rotation: selected.rotation.clone(),
					scale: selected.scale.clone()
				} );

			}

		} else {

			objectPositionOnDown = object.position.clone();
			objectRotationOnDown = object.rotation.clone();
			objectScaleOnDown = object.scale.clone();

		}

		controls.enabled = false;

	} );
	transformControls.addEventListener( 'mouseUp', function () {

		const object = transformControls.object;

		if ( editDragActive ) {

			editDragActive = false;
			editor.editModeController.commitTransform();
			syncEditGizmo();
			controls.enabled = true;
			return;

		}

		if ( pivotActive ) {

			const selection = editor.getSelectedObjects();
			const commands = [];

			for ( let i = 0; i < selection.length; i ++ ) {

				const selected = selection[ i ];
				const start = _dragStartLocal.get( selected );
				if ( start === undefined ) continue;

				if ( ! start.position.equals( selected.position ) ) {

					commands.push( new SetPositionCommand( editor, selected, selected.position.clone(), start.position ) );

				}

				if ( ! start.rotation.equals( selected.rotation ) ) {

					commands.push( new SetRotationCommand( editor, selected, selected.rotation.clone(), start.rotation ) );

				}

				if ( ! start.scale.equals( selected.scale ) ) {

					commands.push( new SetScaleCommand( editor, selected, selected.scale.clone(), start.scale ) );

				}

			}

			if ( commands.length > 0 ) {

				editor.execute( new MultiCmdsCommand( editor, commands ) );

			}

			updateSelectionPivot();

		} else if ( object !== undefined ) {

			switch ( transformControls.getMode() ) {

				case 'translate':

					if ( ! objectPositionOnDown.equals( object.position ) ) {

						editor.execute( new SetPositionCommand( editor, object, object.position, objectPositionOnDown ) );

					}

					break;

				case 'rotate':

					if ( ! objectRotationOnDown.equals( object.rotation ) ) {

						editor.execute( new SetRotationCommand( editor, object, object.rotation, objectRotationOnDown ) );

					}

					break;

				case 'scale':

					if ( ! objectScaleOnDown.equals( object.scale ) ) {

						editor.execute( new SetScaleCommand( editor, object, object.scale, objectScaleOnDown ) );

					}

					break;

			}

		}

		controls.enabled = true;

	} );

	sceneHelpers.add( transformControls.getHelper() );

	//

	const xr = new XR( editor, transformControls ); // eslint-disable-line no-unused-vars

	// events

	function updateAspectRatio() {

		for ( const uuid in editor.cameras ) {

			const camera = editor.cameras[ uuid ];

			const aspect = container.dom.offsetWidth / container.dom.offsetHeight;

			if ( camera.isPerspectiveCamera ) {

				camera.aspect = aspect;

			} else {

				camera.left = - aspect;
				camera.right = aspect;

			}

			camera.updateProjectionMatrix();

			const cameraHelper = editor.helpers[ camera.id ];
			if ( cameraHelper ) cameraHelper.update();

		}

	}

	const onDownPosition = new THREE.Vector2();
	const onUpPosition = new THREE.Vector2();
	const onDoubleClickPosition = new THREE.Vector2();

	function getMousePosition( dom, x, y ) {

		const rect = dom.getBoundingClientRect();
		return [ ( x - rect.left ) / rect.width, ( y - rect.top ) / rect.height ];

	}

	function handleClick( additive = false ) {

		if ( onDownPosition.distanceTo( onUpPosition ) === 0 ) {

			const intersects = selector.getPointerIntersects( onUpPosition, camera );
			signals.intersectionsDetected.dispatch( intersects, additive );

			render();

		}

	}

	function onMouseDown( event ) {

		// event.preventDefault();

		if ( event.target !== renderer.domElement ) return;

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onDownPosition.fromArray( array );

		document.addEventListener( 'mouseup', onMouseUp );

	}

	function onMouseUp( event ) {

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onUpPosition.fromArray( array );

		handleClick( event.shiftKey || event.ctrlKey || event.metaKey );

		document.removeEventListener( 'mouseup', onMouseUp );

	}

	function onTouchStart( event ) {

		const touch = event.changedTouches[ 0 ];

		const array = getMousePosition( container.dom, touch.clientX, touch.clientY );
		onDownPosition.fromArray( array );

		document.addEventListener( 'touchend', onTouchEnd );

	}

	function onTouchEnd( event ) {

		const touch = event.changedTouches[ 0 ];

		const array = getMousePosition( container.dom, touch.clientX, touch.clientY );
		onUpPosition.fromArray( array );

		handleClick();

		document.removeEventListener( 'touchend', onTouchEnd );

	}

	function onDoubleClick( event ) {

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onDoubleClickPosition.fromArray( array );

		const intersects = selector.getPointerIntersects( onDoubleClickPosition, camera );

		if ( intersects.length > 0 ) {

			const intersect = intersects[ 0 ];

			signals.objectFocused.dispatch( intersect.object );

		}

	}

	// ── Lasso selection tool ──────────────────────────────────────────────────
	let lassoMode = false;
	let lassoActive = false;
	let lassoPoints = [];
	let lassoProgress = null; // indeterminate progress banner shown while lassoing

	function removeLassoProgress() {
		if ( lassoProgress ) {
			lassoProgress.remove();
			lassoProgress = null;
		}
	}

	const lassoCanvas = document.createElement( 'canvas' );
	lassoCanvas.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair;display:none;z-index:10;pointer-events:none;';
	container.dom.appendChild( lassoCanvas );
	const lassoCtx = lassoCanvas.getContext( '2d' );

	function resizeLassoCanvas() {
		// Get dimensions from container.dom, or fallback to viewport element if available
		let width = container.dom.clientWidth;
		let height = container.dom.clientHeight;
		
		// If container has no size, try to get viewport element by ID
		if ( ( width === 0 || height === 0 ) && typeof document !== 'undefined' ) {
			const viewportElement = document.getElementById( 'viewport' );
			if ( viewportElement ) {
				width = viewportElement.clientWidth;
				height = viewportElement.clientHeight;
			}
		}
		
		// Always set dimensions (even if 0, to clear old content)
		lassoCanvas.width = width;
		lassoCanvas.height = height;
	}

	resizeLassoCanvas();
	window.addEventListener( 'resize', resizeLassoCanvas );

	function drawLasso() {
		lassoCtx.clearRect( 0, 0, lassoCanvas.width, lassoCanvas.height );
		lassoCtx.strokeStyle = '#ff6600';
		lassoCtx.lineWidth = 2;
		lassoCtx.lineJoin = 'round';
		lassoCtx.lineCap = 'round';
		if ( lassoPoints.length > 1 ) {
			lassoCtx.beginPath();
			lassoCtx.moveTo( lassoPoints[ 0 ].x, lassoPoints[ 0 ].y );
			for ( let i = 1; i < lassoPoints.length; i ++ ) {
				lassoCtx.lineTo( lassoPoints[ i ].x, lassoPoints[ i ].y );
			}
			lassoCtx.stroke();
		}
	}

	function finalizeLasso() {
		lassoActive = false;
		lassoCanvas.style.display = 'none';
		if ( editor.controls ) editor.controls.enabled = true; // Re-enable camera controls

		const points = lassoPoints;
		lassoPoints = [];

		if ( points.length < 3 ) { removeLassoProgress(); return; }

		// Delegate to the shared screen-space lasso (same code path as the shell's
		// $S lasso() surface) so interactive and programmatic selection are identical.
		lassoSelect( editor, points, {
			camera,
			width: lassoCanvas.width,
			height: lassoCanvas.height,
			apply: true
		} );

		removeLassoProgress();
	}

	const onLassoMouseMove = ( event ) => {
		if ( ! lassoActive ) return;
		const rect = container.dom.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		lassoPoints.push( { x, y } );
		drawLasso();
	};

	const onLassoMouseUp = ( event ) => {
		if ( ! lassoActive ) return;
		finalizeLasso();
		document.removeEventListener( 'mousemove', onLassoMouseMove );
		document.removeEventListener( 'mouseup', onLassoMouseUp );
	};

	function onLassoStart( event ) {
		if ( ! lassoMode ) return;
		lassoActive = true;
		lassoPoints = [];
		lassoCanvas.style.display = 'block';
		// Ensure canvas has correct size
		resizeLassoCanvas();
		if ( editor.controls ) editor.controls.enabled = false; // Disable camera controls during lasso drawing
		// Indeterminate progress bar shown while the lasso is being drawn.
		removeLassoProgress();
		lassoProgress = createProgressBanner();
		lassoProgress.indeterminate( 'Lasso selecting…' );
		const rect = container.dom.getBoundingClientRect();
		lassoPoints.push( { x: event.clientX - rect.left, y: event.clientY - rect.top } );
		document.addEventListener( 'mousemove', onLassoMouseMove );
		document.addEventListener( 'mouseup', onLassoMouseUp );
	}

	container.dom.addEventListener( 'mousedown', ( event ) => {
		if ( lassoMode && ! event.shiftKey && ! event.ctrlKey && ! event.metaKey ) {
			// Check if the event target is the renderer canvas or within the viewport container
			const isOnCanvas = event.target === renderer.domElement || container.dom.contains( event.target );
			if ( isOnCanvas ) {
				onLassoStart( event );
				return;
			}
		}
		onMouseDown( event );
	} );

	// Listen for lasso mode change
	signals.lassoModeChanged.add( ( { active } ) => {
		lassoMode = active;
		container.dom.style.cursor = active ? 'crosshair' : 'auto';
		if ( ! active ) removeLassoProgress();
	} );

	container.dom.addEventListener( 'touchstart', onTouchStart, { passive: false } );
	container.dom.addEventListener( 'dblclick', onDoubleClick );

	// controls need to be added *after* main logic,
	// otherwise controls.enabled doesn't work.

	const controls = new EditorControls( camera );
	controls.addEventListener( 'change', function () {

		signals.cameraChanged.dispatch( camera );
		signals.refreshSidebarObject3D.dispatch( camera );

	} );
	viewHelper.center = controls.center;

	editor.controls = controls;

	// signals

	signals.editorCleared.add( function () {

		controls.center.set( 0, 0, 0 );
		if ( pathtracer ) pathtracer.reset();

		initPT();

		signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

	} );

	signals.transformModeChanged.add( function ( mode ) {

		transformControls.setMode( mode );

		render();

	} );

	signals.snapChanged.add( function ( dist ) {

		transformControls.setTranslationSnap( dist );

	} );

	signals.spaceChanged.add( function ( space ) {

		transformControls.setSpace( space );

		render();

	} );

	signals.rendererUpdated.add( function () {

		scene.traverse( function ( child ) {

			if ( child.material !== undefined ) {

				child.material.needsUpdate = true;

			}

		} );

		render();

	} );

	signals.rendererCreated.add( function ( newRenderer ) {

		hideContextLostOverlay();

		if ( renderer !== null ) {

			renderer.setAnimationLoop( null );

			try {

				pmremGenerator.dispose();

			} catch ( e ) {

				console.warn( 'PMREMGenerator dispose error:', e );

			}

			renderer.dispose();

			container.dom.removeChild( renderer.domElement );

		}

		controls.connect( newRenderer.domElement );
		transformControls.connect( newRenderer.domElement );

		renderer = newRenderer;

		renderer.setAnimationLoop( animate );
		renderer.setClearColor( 0xaaaaaa );

		if ( window.matchMedia ) {

			const mediaQuery = window.matchMedia( '(prefers-color-scheme: dark)' );
			mediaQuery.addEventListener( 'change', function ( event ) {

				renderer.setClearColor( event.matches ? 0x333333 : 0xaaaaaa );

				render();

			} );

			renderer.setClearColor( mediaQuery.matches ? 0x333333 : 0xaaaaaa );

		}

		renderer.getClearColor( editor.viewportColor );

		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );

		if ( renderer.isWebGLRenderer ) {

			pmremGenerator = new THREE.PMREMGenerator( renderer );
			pmremGenerator.compileEquirectangularShader();

			pathtracer = new ViewportPathtracer( renderer );

		} else {

			pmremGenerator = new PMREMGenerator( renderer );

			pathtracer = null;

		}

		container.dom.appendChild( renderer.domElement );

		// Mobile GPUs (Android in particular) can drop the context under memory/
		// thermal pressure mid-session — e.g. while an animation is playing and
		// draw calls spike — leaving the canvas permanently blank with no error.
		// three.js itself no-ops render() once lost and restores its own GL state
		// if/when the browser fires 'webglcontextrestored', but that isn't
		// guaranteed to happen, so surface it instead of silently freezing.
		renderer.domElement.addEventListener( 'webglcontextlost', function ( event ) {

			event.preventDefault();
			console.warn( 'Strata: WebGL context lost.' );
			showContextLostOverlay( true );

			contextLostTimer = setTimeout( function () {

				showContextLostOverlay( false );

			}, 4000 );

		}, false );

		renderer.domElement.addEventListener( 'webglcontextrestored', function () {

			console.info( 'Strata: WebGL context restored.' );
			hideContextLostOverlay();
			render();

		}, false );

		signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

		render();

	} );

	function showContextLostOverlay( canRecoverAutomatically ) {

		let overlay = document.getElementById( 'webgl-context-lost-overlay' );

		if ( overlay === null ) {

			overlay = document.createElement( 'div' );
			overlay.id = 'webgl-context-lost-overlay';
			overlay.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;' +
				'align-items:center;justify-content:center;text-align:center;' +
				'background:rgba(25,25,25,0.92);color:#d6d6d6;' +
				'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
				'padding:24px;box-sizing:border-box;';
			container.dom.appendChild( overlay );

		}

		overlay.innerHTML =
			'<div style="max-width:360px;line-height:1.5;">' +
				'<p style="margin:0 0 12px;font-size:14px;">The 3D view lost its graphics ' +
				'context (common on mobile under memory or thermal pressure) ' +
				( canRecoverAutomatically ?
					'and is trying to recover\u2026</p>' :
					'and couldn\u2019t recover automatically.</p>' +
					'<button id="webgl-context-lost-reload" style="padding:6px 14px;' +
						'background:#2a82da;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reload</button>' ) +
			'</div>';

		const reloadButton = document.getElementById( 'webgl-context-lost-reload' );
		if ( reloadButton !== null ) reloadButton.onclick = () => location.reload();

	}

	function hideContextLostOverlay() {

		const overlay = document.getElementById( 'webgl-context-lost-overlay' );
		if ( overlay !== null ) overlay.remove();

		if ( contextLostTimer !== null ) {

			clearTimeout( contextLostTimer );
			contextLostTimer = null;

		}

	}

	signals.rendererDetectKTX2Support.add( function ( ktx2Loader ) {

		ktx2Loader.detectSupport( renderer );

	} );

	signals.sceneGraphChanged.add( function () {

		initPT();
		render();

	} );

	signals.cameraChanged.add( function () {

		if ( pathtracer ) pathtracer.reset();

		render();

	} );

	signals.objectSelected.add( function ( object ) {

		selectionBox.visible = false;
		transformControls.detach();

		if ( object !== null && object !== scene && object !== camera ) {

			box.setFromObject( object, true );

			if ( box.isEmpty() === false ) {

				selectionBox.visible = true;

			}

		}

		render();

	} );

	function useCenteredPivot( object ) {

		// Container objects have no geometry of their own, so their transform origin
		// carries no visual meaning — center the gizmo on their contents instead.
		return object.isGroup === true || object.type === 'Object3D' || object.type === 'Group';

	}

	function updateSelectionPivot() {

		const selection = editor.getSelectedObjects();
		const center = new THREE.Vector3();

		if ( selection.length > 0 ) {

			const bounds = new THREE.Box3();
			const objectBox = new THREE.Box3();

			for ( let i = 0; i < selection.length; i ++ ) {

				selection[ i ].updateMatrixWorld( true );
				objectBox.setFromObject( selection[ i ], true );
				if ( objectBox.isEmpty() === false ) bounds.union( objectBox );

			}

			if ( bounds.isEmpty() === false ) {

				bounds.getCenter( center );

			} else {

				// Fallback for objects with no renderable bounds: average of origins.
				const objectPosition = new THREE.Vector3();

				for ( let i = 0; i < selection.length; i ++ ) {

					objectPosition.setFromMatrixPosition( selection[ i ].matrixWorld );
					center.add( objectPosition );

				}

				center.divideScalar( selection.length );

			}

		}

		selectionPivot.position.copy( center );
		selectionPivot.rotation.set( 0, 0, 0 );
		selectionPivot.scale.set( 1, 1, 1 );
		selectionPivot.updateMatrixWorld( true );

	}

	signals.selectionChanged.add( function ( selection ) {

		clearMultiSelectionBoxes();
		transformControls.detach();
		pivotActive = false;

		if ( selectionPivot.parent !== null ) selectionPivot.parent.remove( selectionPivot );

		// In Edit Mode the gizmo belongs to the sub-object selection — never let an
		// object-level selection change steal it back onto the whole mesh.
		if ( editModeActive() ) { syncEditGizmo(); return; }

		// Filter out non-transformable picks ( scene / camera )

		const transformable = selection.filter( o => o !== null && o !== scene && o !== camera );

		if ( transformable.length === 1 && useCenteredPivot( transformable[ 0 ] ) ) {

			// Container objects ( Group / plain Object3D ) keep their transform origin at
			// an arbitrary point — usually the world origin — so the gizmo would sit at
			// 0,0,0 instead of on the object. Drive the transform through a pivot placed
			// at the object's bounding-box center instead.

			sceneHelpers.add( selectionPivot );
			updateSelectionPivot();
			pivotActive = true;
			transformControls.attach( selectionPivot );

		} else if ( transformable.length === 1 ) {

			transformControls.attach( transformable[ 0 ] );

		} else if ( transformable.length > 1 ) {

			// Draw a box for every selected object and attach the gizmo to a shared pivot

			selectionBox.visible = false;

			for ( let i = 0; i < transformable.length; i ++ ) {

				addMultiSelectionBox( transformable[ i ] );

			}

			sceneHelpers.add( selectionPivot );
			updateSelectionPivot();
			pivotActive = true;
			transformControls.attach( selectionPivot );

		}

		render();

	} );

	signals.editModeChanged.add( function ( { active } ) {

		if ( active ) {

			// Hand the gizmo to the sub-object selection and hide the object gizmo /
			// selection box so dragging edits vertices instead of moving the mesh.
			selectionBox.visible = false;
			transformControls.detach();
			syncEditGizmo();

		} else {

			editDragActive = false;
			if ( transformControls.object === editProxy ) transformControls.detach();

			// Restore the object gizmo on the mesh we were editing.
			const sel = editor.selected;
			if ( sel && sel !== scene && sel !== camera ) transformControls.attach( sel );
			render();

		}

	} );

	signals.subObjectSelected.add( function () {

		if ( ! editDragActive && editModeActive() ) syncEditGizmo();

	} );

	signals.objectFocused.add( function ( object ) {

		controls.focus( object );

	} );

	signals.geometryChanged.add( function ( object ) {

		if ( object !== undefined ) {

			box.setFromObject( object, true );

		}

		initPT();
		render();

	} );

	signals.objectChanged.add( function ( object ) {

		if ( editor.selected === object ) {

			box.setFromObject( object, true );

		}

		if ( multiSelectionBoxes.length > 0 ) {

			updateMultiSelectionBoxes();

		}

		if ( object.isPerspectiveCamera ) {

			object.updateProjectionMatrix();

		}

		const helper = editor.helpers[ object.id ];

		if ( helper !== undefined && helper.isSkeletonHelper !== true ) {

			helper.update();

		}

		// update light helper when light target is changed

		for ( const id in editor.helpers ) {

			const helper = editor.helpers[ id ];

			if ( helper.light && helper.light.target === object ) {

				helper.update();

			}

		}

		initPT();
		render();

	} );

	signals.objectRemoved.add( function ( object ) {

		controls.enabled = true; // see #14180

		if ( object === transformControls.object ) {

			transformControls.detach();

		}

	} );

	signals.materialChanged.add( function () {

		updatePTMaterials();
		render();

	} );

	// background

	signals.sceneBackgroundChanged.add( function ( backgroundType, backgroundColor, backgroundTexture, backgroundEquirectangularTexture, backgroundColorSpace, backgroundBlurriness, backgroundIntensity, backgroundRotation ) {

		editor.backgroundType = backgroundType;

		scene.background = null;

		switch ( backgroundType ) {

			case 'Color':

				scene.background = new THREE.Color( backgroundColor );

				break;

			case 'Texture':

				if ( backgroundTexture ) {

					backgroundTexture.colorSpace = backgroundColorSpace;
					backgroundTexture.needsUpdate = true;

					scene.background = backgroundTexture;

				}

				break;

			case 'Equirectangular':

				if ( backgroundEquirectangularTexture ) {

					backgroundEquirectangularTexture.mapping = THREE.EquirectangularReflectionMapping;
					backgroundEquirectangularTexture.colorSpace = backgroundColorSpace;
					backgroundEquirectangularTexture.needsUpdate = true;

					scene.background = backgroundEquirectangularTexture;
					scene.backgroundBlurriness = backgroundBlurriness;
					scene.backgroundIntensity = backgroundIntensity;
					scene.backgroundRotation.y = backgroundRotation * THREE.MathUtils.DEG2RAD;

				}

				break;

		}

		if ( useBackgroundAsEnvironment ) {

			signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

		}

		updatePTBackground();
		render();

	} );

	// environment

	let useBackgroundAsEnvironment = false;

	signals.sceneEnvironmentChanged.add( function ( environmentType, environmentEquirectangularTexture ) {

		editor.environmentType = environmentType;

		scene.environment = null;

		useBackgroundAsEnvironment = false;

		switch ( environmentType ) {

			case 'Equirectangular':

				if ( environmentEquirectangularTexture ) {

					scene.environment = environmentEquirectangularTexture;
					scene.environment.mapping = THREE.EquirectangularReflectionMapping;

				}

				break;

			case 'Default':

				useBackgroundAsEnvironment = true;

				if ( scene.background !== null ) {

					if ( scene.background.isColor ) {

						scene.environment = pmremGenerator.fromScene( new ColorEnvironment( scene.background ), 0.04 ).texture;

					} else if ( scene.background.isTexture ) {

						scene.environment = scene.background;
						scene.environment.mapping = THREE.EquirectangularReflectionMapping;
						scene.environmentRotation.y = scene.backgroundRotation.y;

					}

				} else {

					scene.environment = pmremGenerator.fromScene( new RoomEnvironment(), 0.04 ).texture;

				}

				break;

		}

		updatePTEnvironment();
		render();

	} );

	// fog

	signals.sceneFogChanged.add( function ( fogType, fogColor, fogNear, fogFar, fogDensity ) {

		switch ( fogType ) {

			case 'None':
				scene.fog = null;
				break;
			case 'Fog':
				scene.fog = new THREE.Fog( fogColor, fogNear, fogFar );
				break;
			case 'FogExp2':
				scene.fog = new THREE.FogExp2( fogColor, fogDensity );
				break;

		}

		render();

	} );

	signals.sceneFogSettingsChanged.add( function ( fogType, fogColor, fogNear, fogFar, fogDensity ) {

		switch ( fogType ) {

			case 'Fog':
				scene.fog.color.setHex( fogColor );
				scene.fog.near = fogNear;
				scene.fog.far = fogFar;
				break;
			case 'FogExp2':
				scene.fog.color.setHex( fogColor );
				scene.fog.density = fogDensity;
				break;

		}

		render();

	} );

	signals.viewportCameraChanged.add( function () {

		const viewportCamera = editor.viewportCamera;

		if ( viewportCamera.isPerspectiveCamera || viewportCamera.isOrthographicCamera ) {

			updateAspectRatio();

		}

		// disable EditorControls when setting a user camera

		controls.enabled = ( viewportCamera === editor.camera );

		initPT();
		render();

	} );

	signals.viewportShadingChanged.add( function () {

		const viewportShading = editor.viewportShading;

		switch ( viewportShading ) {

			case 'solid':
				scene.overrideMaterial = null;
				break;

			case 'normals':
				scene.overrideMaterial = new THREE.MeshNormalMaterial();
				break;

			case 'wireframe':
				scene.overrideMaterial = new THREE.MeshBasicMaterial( { color: 0x000000, wireframe: true } );
				break;

		}

		render();

	} );

	//

	signals.windowResize.add( function () {

		updateAspectRatio();

		if ( renderer === null ) return;

		renderer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );
		if ( pathtracer ) pathtracer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );

		render();

	} );

	signals.showHelpersChanged.add( function ( appearanceStates ) {

		sceneHelpers.traverse( function ( object ) {

			switch ( object.type ) {

				case 'CameraHelper':

				{

					object.visible = appearanceStates.cameraHelpers;
					break;

				}

				case 'PointLightHelper':
				case 'DirectionalLightHelper':
				case 'SpotLightHelper':
				case 'HemisphereLightHelper':

				{

					object.visible = appearanceStates.lightHelpers;
					break;

				}

				case 'SkeletonHelper':

				{

					object.visible = appearanceStates.skeletonHelpers;
					break;

				}

				default:

				{

					// not a helper, skip.

				}

			}

		} );


		render();

	} );

	signals.cameraResetted.add( updateAspectRatio );

	// animations

	let prevActionsInUse = 0;

	const timer = new THREE.Timer(); // only used for animations

	function animate() {

		timer.update();

		const mixer = editor.mixer;
		const delta = timer.getDelta();

		let needsUpdate = false;

		// Animations

		const actions = mixer.stats.actions;

		if ( actions.inUse > 0 || prevActionsInUse > 0 ) {

			prevActionsInUse = actions.inUse;

			mixer.update( delta );
			needsUpdate = true;
			// Keep fully-faded-in/out materials genuinely opaque/depth-inert instead
			// of permanently sitting in the transparent render pass (see
			// syncMaterialTransparency's own comment for why that looks wrong).
			syncMaterialTransparency( editor );

			if ( editor.selected !== null ) {

				editor.selected.updateWorldMatrix( false, true ); // avoid frame late effect for certain skinned meshes (e.g. Michelle.glb)
				selectionBox.box.setFromObject( editor.selected, true ); // selection box should reflect current animation state

			}

			signals.morphTargetsUpdated.dispatch();

		}

		// View Helper

		if ( viewHelper.animating === true ) {

			viewHelper.update( delta );
			needsUpdate = true;

		}

		// Timeline.js's own rAF loop samples change()-event content independently
		// of this mixer-driven loop (see its tick() for why) — honor its request
		// for one more render so a content update settled there always shows up.
		if ( editor.needsContentRender === true ) {

			editor.needsContentRender = false;
			needsUpdate = true;

		}

		if ( renderer.xr.isPresenting === true ) {

			needsUpdate = true;

		}

		if ( needsUpdate === true ) render();

		updatePT();

	}

	function initPT() {

		// Realistic viewport shading is no longer available

	}

	function updatePTBackground() {

		// Realistic viewport shading is no longer available

	}

	function updatePTEnvironment() {

		// Realistic viewport shading is no longer available

	}

	function updatePTMaterials() {

		// Realistic viewport shading is no longer available

	}

	function updatePT() {

		// Realistic viewport shading is no longer available

	}

	//

	let startTime = 0;
	let endTime = 0;

	function render() {

		if ( renderer === null ) return;

		startTime = performance.now();

		renderer.setViewport( 0, 0, container.dom.offsetWidth, container.dom.offsetHeight );
		renderer.render( scene, editor.viewportCamera );

		// 'html'/'md' stencil meshes never carry baked pixels out of a scene load
		// (see HtmlEmbed.js / MarkdownEmbed.js) — re-rasterize the ones still
		// missing their texture, then re-render once the (async) bake lands.
		scene.traverse( function ( o ) {

			const bake = hydrateHtmlEmbed( o ) || hydrateMarkdownEmbed( o ) || hydrateCallcard( o );
			if ( bake ) bake.then( render );
			hydrateEdgeOutline( o );

		} );

		if ( camera === editor.viewportCamera ) {

			renderer.autoClear = false;
			if ( sceneHelpers.visible === true ) renderer.render( sceneHelpers, camera );
			if ( renderer.xr.isPresenting !== true ) viewHelper.render( renderer );
			renderer.autoClear = true;

		}

		endTime = performance.now();
		editor.signals.sceneRendered.dispatch( endTime - startTime );

	}

	return container;

}

export { Viewport };
