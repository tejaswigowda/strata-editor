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

export { TimelineModel };
