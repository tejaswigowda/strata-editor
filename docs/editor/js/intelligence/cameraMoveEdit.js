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
