// ── cameraMoveEdit.js ─────────────────────────────────────────────────────────
// The editor-side half of camera-move editing: find a camera's track in the ONE scene
// timeline and apply an edit from cameraMove.js as a single undoable SetTimelineCommand.
// The viewport (CameraPath, Timeline) and the shell ($S verbs in opPrimitive) both go
// through editCameraTrack, so a drag, a button and a shell call are the same kind of
// history entry and interleave on the one undo stack.

import { TimelineModel } from './timeline.js';
import { SetTimelineCommand } from '../commands/SetTimelineCommand.js';
import { cameraKeys } from './splineTrack.js';
import { cameraSelectors, findCameraTrack, optionsForCamera, simplifiableIn, simplifyAllInModel } from './cameraTracks.js';
import * as move from './cameraMove.js';
import { presetKeys, MOVE_PRESETS } from './cameraPresets.js';

export { move };

export { cameraSelectors, findCameraTrack };

/** The selector to read a camera's move back in: its track's target, else the best name. */
export function moveSelector( editor, camera ) {

	const t = findCameraTrack( editor.timeline, camera );
	return t ? t.target : cameraSelectors( camera )[ 0 ];

}

export function isShotCamera( editor, object ) {

	return !! object && object.isCamera && object !== editor.camera;

}

/** The track as the viewport and shell see it right now (read-only; do not mutate). */
export function liveTrack( editor, camera ) {

	return findCameraTrack( editor.timeline, camera );

}

/**
 * Apply `fn( track )` to the camera's track on a private deep copy, then execute the
 * result as ONE SetTimelineCommand. If `fn` throws nothing is executed. Creates the
 * track when the camera has none. Returns whatever `fn` returns.
 */
export function editCameraTrack( editor, camera, name, fn ) {

	if ( ! isShotCamera( editor, camera ) ) throw new Error( 'this is not a shot camera' );
	// deep copy: TimelineModel copies events shallowly and the undo snapshot must not change
	const json = editor.timeline ? JSON.parse( JSON.stringify( editor.timeline.toJSON() ) ) : { duration: 0, tracks: [] };
	const model = TimelineModel.fromJSON( json );
	const track = findCameraTrack( model, camera ) || model.track( cameraSelectors( camera )[ 0 ], true );
	const result = fn( track );
	if ( ! track.events.length ) model.tracks.splice( model.tracks.indexOf( track ), 1 );
	model.recomputeDuration();
	editor.execute( new SetTimelineCommand( editor, model.toJSON(), name ) );
	return result;

}

/** The Edit Camera pose as a key spec: where it is, where it looks, its fov. */
export function specFromEditCamera( editor ) {

	if ( editor.viewportCamera !== editor.camera ) throw new Error( 'from-view keys read the Edit Camera: switch the viewport to Edit Camera first (use keyAt for a headless key)' );
	const cam = editor.camera, c = editor.controls ? editor.controls.center : null;
	let look;
	if ( c ) look = [ c.x, c.y, c.z ];
	else {

		const d = cam.getWorldDirection( cam.position.clone() ).add( cam.position );
		look = [ d.x, d.y, d.z ];

	}
	return { pos: [ cam.position.x, cam.position.y, cam.position.z ], lookAt: look, fov: Math.round( cam.fov * 100 ) / 100 };

}

/** Seconds on the shared clock where the playhead sits (0 when no timeline UI exists). */
export function playheadTime( editor ) {

	return typeof editor.getTimelinePlayhead === 'function' ? editor.getTimelinePlayhead() : 0;

}

/** Index in the key list of the key currently selected in the viewport, or null. */
export function selectedKeyIndex( editor, camera ) {

	const cp = editor.cameraPath;
	const track = liveTrack( editor, camera );
	if ( ! cp || ! track || cp.trackTarget !== track.target || ! cp.selectedKeyId ) return null;
	const i = cameraKeys( track.events ).findIndex( k => k.id === cp.selectedKeyId );
	return i < 0 ? null : i;

}

function shotsOf( editor ) {

	return ( editor.scene && editor.scene.userData && editor.scene.userData.renderShots ) || [];

}

function shotCameras( editor ) {

	return Object.values( editor.cameras || {} ).filter( c => isShotCamera( editor, c ) );

}

/** The shot cameras that have a camera track with something to simplify (4+ keys). */
export function simplifiableCameras( editor ) {

	return simplifiableIn( editor.timeline, shotCameras( editor ) );

}

/** Options for one camera: with keepBeats on, its shot start/end in the Camera Sequence join the beats. */
export function optionsFor( editor, camera, opts ) {

	return optionsForCamera( shotsOf( editor ), editor.timeline ? editor.timeline.duration : 0, camera, opts );

}

/**
 * Simplify every shot camera's move. `dryRun` only reports. Otherwise it is ONE SetTimelineCommand
 * (one undo step) over a copy of the whole timeline. Returns
 * { cameras, before, after, changed, report: [{ camera, before, after, worst }] }.
 * Defaults to keepBeats on (see simplifyOptions for the fields).
 */
export function simplifyAllCameras( editor, opts = {}, { dryRun = false, name = 'Simplify all camera keys' } = {} ) {

	const json = editor.timeline ? JSON.parse( JSON.stringify( editor.timeline.toJSON() ) ) : { duration: 0, tracks: [] };
	const model = TimelineModel.fromJSON( json );
	const out = simplifyAllInModel( model, shotCameras( editor ), shotsOf( editor ), opts, { dryRun } );
	if ( ! dryRun && out.changed ) {

		model.recomputeDuration();
		editor.execute( new SetTimelineCommand( editor, model.toJSON(), name ) );

	}
	return out;

}

// ── One-click moves (the Render tab's Move menu, and $S('#cam').cameraMove()) ──────────────────

export { MOVE_PRESETS };

/**
 * Where a shot camera starts: the first key of its move when it has one (so applying a preset twice
 * starts from the same place), else its own pose looking `distance` ahead, where the distance is
 * how far away the scene's contents are along the view direction (12 for an empty scene).
 */
export function cameraBasePose( editor, camera ) {

	const track = liveTrack( editor, camera );
	const keys = track ? cameraKeys( track.events ) : [];
	const first = keys[ 0 ];
	const fov = Number.isFinite( camera.fov ) ? camera.fov : undefined;
	if ( first && Array.isArray( first.lookAt ) ) return { pos: first.position.slice(), lookAt: first.lookAt.slice(), fov: first.fov ?? fov };

	camera.updateWorldMatrix( true, false );
	const pos = camera.position.clone();
	const dir = camera.getWorldDirection( camera.position.clone() );
	let distance = 12;

	try {

		const THREE = window.THREE;
		const box = new THREE.Box3();
		editor.scene.traverse( o => { if ( o.isMesh && o.geometry && o.visible ) box.expandByObject( o, false ); } );
		if ( ! box.isEmpty() ) {

			const ahead = box.getCenter( new THREE.Vector3() ).sub( pos ).dot( dir );
			if ( ahead > 1 ) distance = Math.min( 80, Math.max( 3, ahead ) );

		}

	} catch ( e ) { /* keep the default */ }

	const look = pos.clone().addScaledVector( dir, distance );
	return { pos: [ pos.x, pos.y, pos.z ], lookAt: [ look.x, look.y, look.z ], fov: first && first.fov != null ? first.fov : fov };

}

/**
 * Give a shot camera a move from `start` to `end` (seconds on the shared clock). ONE undo step.
 * kind: push | pull | orbit | truck | crane | drift. amount: see MOVE_PRESETS (omit for its default).
 * Replaces the camera's existing keys; its other events (a rotation turn, say) are left alone.
 */
export function applyCameraMove( editor, camera, kind, { start = 0, end, amount } = {} ) {

	if ( ! isShotCamera( editor, camera ) ) throw new Error( 'camera move: pick a shot camera, not the Edit Camera' );
	const base = cameraBasePose( editor, camera );
	const keys = presetKeys( kind, base, { start, end, amount } );
	return editCameraTrack( editor, camera, 'Camera move: ' + MOVE_PRESETS[ kind ].label, track => move.setKeys( track, keys, { smooth: true } ) );

}

/** Remove a shot camera's keys (the move), keeping any other events on its track. ONE undo step. */
export function clearCameraMove( editor, camera ) {

	return editCameraTrack( editor, camera, 'Clear camera move', track => {

		const ids = new Set( cameraKeys( track.events ).map( k => k.id ) );
		track.events = track.events.filter( e => ! ids.has( e.id ) );

	} );

}
