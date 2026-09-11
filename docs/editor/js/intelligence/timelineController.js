// ── timelineController.js ─────────────────────────────────────────────────────
// Bridges the pure TimelineModel (the absolute-time representation) to the live
// editor: compiles the model into the ONE scene-wide 'Timeline' clip, registers
// it on scene.animations (so it PLAYS via the mixer AND EXPORTS via glTF), and
// keeps the serialized copy in scene.userData.timeline (versionable).

import * as THREE from 'three';
import * as recipes from './animationRecipes.js';
import * as selectorEngine from './selectorEngine.js';
import { TimelineModel, compileTimeline, TIMELINE_CLIP_NAME } from './timeline.js';

/** Remove any previously compiled Timeline clip from scene.animations. */
function stripTimelineClip( editor ) {

	const scene = editor.scene;
	if ( ! Array.isArray( scene.animations ) ) { scene.animations = []; return; }
	scene.animations = scene.animations.filter( c => {

		const isTimeline = c.name === TIMELINE_CLIP_NAME || ( c.userData && c.userData.isTimeline );
		if ( isTimeline && editor.mixer ) editor.mixer.uncacheClip( c );
		return ! isTimeline;

	} );

}

/**
 * Recompile the model → clip, (re)register it on the scene, and persist the
 * serialized representation. Dispatches timelineChanged so the UI refreshes.
 */
export function syncTimeline( editor ) {

	const model = editor.timeline;
	if ( ! model ) return null;

	// Recipes read each target's LIVE transform as their baseline (S0/P0/Q0).
	// If the timeline was left mid-scrub/paused (pose held, never restored —
	// see "Hold / release" below) when an edit triggers a recompile, that
	// transient pose would get baked in as the new rest pose, drifting scale/
	// position/rotation further with every play+edit cycle. Snap every
	// currently-held target back to the OLD clip's t=0 first so the recompile
	// always reads a stable rest pose.
	holdTimelineAt( editor, 0 );

	stripTimelineClip( editor );

	// Persist the canonical (absolute) representation into the scene JSON.
	editor.scene.userData = editor.scene.userData || {};
	if ( model.isEmpty() ) {

		delete editor.scene.userData.timeline;

	} else {

		editor.scene.userData.timeline = model.toJSON();

	}

	let clip = null;
	try {

		clip = compileTimeline( model, { editor, THREE, recipes, selectorEngine } );

	} catch ( e ) {

		console.error( 'Timeline compile error:', e );

	}

	if ( clip ) {

		editor.scene.animations.push( clip );
		if ( editor.mixer ) editor.mixer.uncacheRoot( editor.scene );

	}

	editor.signals.timelineChanged.dispatch( model );
	editor.signals.animationsChanged.dispatch();
	return clip;

}

/** Load a serialized timeline (from scene.userData) into the live model. */
export function loadTimeline( editor, json ) {

	editor.timeline = json ? TimelineModel.fromJSON( json ) : new TimelineModel();
	syncTimeline( editor );

}

// The Universal Timeline can animate the viewport camera, which lives OUTSIDE the
// exported/mixed scene graph (`editor.camera` is never a child of `editor.scene`).
// THREE.PropertyBinding resolves a clip's track names by searching the BOUND ROOT's
// subtree (`editor.scene` — used both as the GLTFExporter traversal root and as the
// AnimationMixer root), so a camera-uuid track silently fails to bind there ("No
// target node found") — the camera compiles correct keyframes but never actually
// moves, in export OR in live mixer playback. Fix: parent the camera under the
// scene just long enough for the FIRST bind to see it (PropertyBinding caches the
// found node by reference, so restoring the parent immediately after is safe — the
// binding keeps working against the captured object regardless of its later
// parent). Returns a restore() no-op when the camera isn't referenced or is
// already parented under `scene`.
export function includeCameraForBinding( editor, clipOrClips ) {

	const cam = editor.camera;
	const scene = editor.scene;
	if ( ! cam || ! clipOrClips ) return function () {};
	const clips = Array.isArray( clipOrClips ) ? clipOrClips : [ clipOrClips ];
	const referenced = clips.some( clip => clip && clip.tracks && clip.tracks.some( t => t.name.indexOf( cam.uuid ) === 0 ) );
	if ( ! referenced || cam.parent === scene ) return function () {};
	const prevParent = cam.parent;
	scene.add( cam );
	return function () { if ( prevParent ) prevParent.add( cam ); else scene.remove( cam ); };

}

// ── Hold / release (scrub & pause without the "restoreOriginalState" snap-back) ─
// AnimationAction.stop() decrements each binding's use-count to 0, which makes
// three.js write the ORIGINAL (pre-bind) value back onto the object immediately
// ("restoreOriginalState", three.core.js ~L54677) — so the old sampleAt() pattern
// (play → set time → update → stop) sampled the right pose and then IMMEDIATELY
// reverted it. Confirmed live: after stop(), a mid-spin cube's quaternion snapped
// back to identity, not the sampled value.
//
// Fix: hold with ONE THREE.AnimationAction PER TARGET (not the single merged
// clip) — paused, never stopped, so nothing ever restores. Splitting per target
// (rather than one action for the whole clip) is what makes a SCOPED release
// possible: releaseTimelineObject() can stop() just the one target the user is
// about to gizmo-edit while every other target stays held. Sub-clips get a
// STABLE uuid so AnimationMixer.clipAction() (which caches by clip.uuid + root
// uuid) returns the SAME action across repeated scrub calls instead of leaking a
// new one each time.

function targetUuidOf( trackName ) {

	return trackName.split( '.' )[ 0 ];

}

/**
 * One THREE.AnimationAction per distinct target (object/camera uuid) referenced
 * by the compiled Timeline clip. Cheap to call repeatedly (regroups an array;
 * the mixer's own (root,trackName) binding cache — not this function — is what
 * makes repeated calls reuse state).
 * @returns {THREE.AnimationAction[]}
 */
export function getTimelineTargetActions( editor ) {

	const clip = ( editor.scene.animations || [] ).find( c => c.userData && c.userData.isTimeline );
	if ( ! clip ) return [];

	const byTarget = new Map();
	for ( const track of clip.tracks ) {

		const uuid = targetUuidOf( track.name );
		if ( ! byTarget.has( uuid ) ) byTarget.set( uuid, [] );
		byTarget.get( uuid ).push( track );

	}

	const restoreCamera = includeCameraForBinding( editor, clip );
	const actions = [];
	for ( const [ uuid, tracks ] of byTarget ) {

		const subClip = new THREE.AnimationClip( `Timeline:${ uuid }`, clip.duration, tracks );
		subClip.uuid = `timeline-target:${ uuid }`; // stable -> clipAction() cache hit, no per-scrub leak
		actions.push( editor.mixer.clipAction( subClip, editor.scene ) );

	}
	restoreCamera();

	return actions;

}

/**
 * Sample the timeline at absolute time `t` and LEAVE the pose applied — every
 * target's action is activated + paused (never stopped), so nothing triggers
 * `restoreOriginalState()`; the written pose stays until the next hold/play/
 * release. This is scrub AND pause (both just "hold at time t").
 * @returns {boolean} whether there was anything to sample
 */
export function holdTimelineAt( editor, t ) {

	const actions = getTimelineTargetActions( editor );
	if ( actions.length === 0 ) return false;
	for ( const a of actions ) {

		a.play(); // idempotent activation — does NOT reset time/paused if already active
		a.enabled = true;
		a.paused = true;
		a.time = Math.min( Math.max( 0, t ), a.getClip().duration || 0 );

	}
	editor.mixer.update( 0 );
	refreshCameraProjections( editor ); // fov tracks write camera.fov but never the projection matrix
	return true;

}

/**
 * Animated `fov` (the camera's extra .animate() property) is written by the
 * mixer onto camera.fov, but PropertyBinding never calls
 * updateProjectionMatrix() — refresh every perspective camera after sampling.
 */
export function refreshCameraProjections( editor ) {

	if ( editor.camera && editor.camera.isPerspectiveCamera ) editor.camera.updateProjectionMatrix();
	for ( const uuid in editor.cameras || {} ) {

		const cam = editor.cameras[ uuid ];
		if ( cam && cam.isPerspectiveCamera ) cam.updateProjectionMatrix();

	}

}

/**
 * Release ONE object from timeline control — e.g. right before the user grabs
 * its gizmo — so the still-held actions for every OTHER target keep re-writing
 * their pose each frame without fighting an edit on THIS one. `stop()` on the
 * lone action for this target triggers `restoreOriginalState()` for just its
 * bindings; we capture the CURRENT (held) pose first and re-apply it right after,
 * so the object doesn't visually jump to its pre-timeline pose — it just becomes
 * a normal, freely-editable object sitting exactly where the playhead showed it.
 * A no-op when `object` isn't currently a Timeline target.
 */
export function releaseTimelineObject( editor, object ) {

	if ( ! object ) return;
	const action = getTimelineTargetActions( editor ).find( a => a.getClip().uuid === `timeline-target:${ object.uuid }` );
	if ( ! action ) return;

	const snapshot = {
		position: object.position.clone(),
		quaternion: object.quaternion.clone(),
		scale: object.scale.clone(),
	};
	action.stop();
	object.position.copy( snapshot.position );
	object.quaternion.copy( snapshot.quaternion );
	object.scale.copy( snapshot.scale );

}

export { TimelineModel };
