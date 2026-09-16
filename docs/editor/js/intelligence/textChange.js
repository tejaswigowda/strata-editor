// ── textChange.js ─────────────────────────────────────────────────────────────
// change() — animates a text object's CONTENT (the string), not its transform.
// glTF has no "animate the string on this node" concept, so change() authors
// once and is realized by TWO SEPARATE mechanisms to the SAME observable result:
//
//   - LIVE render (applyContentAt):  content is a step function of time — the
//     label's TextGeometry is regenerated in place at the sampled time. This is
//     a manual post-sample step (mirrors refreshCameraProjections' role after
//     mixer.update()), since THREE has no string-typed keyframe track.
//   - glTF EXPORT (lowerChangeEventsForExport): each distinct text state is
//     MATERIALIZED as its own child text mesh, visibility switched via a scale
//     (or, for `transition:'fade'`, opacity) keyframe track — both are ordinary
//     TRS/material channels every glTF viewer honors, unlike "content".
//
// Both paths read the SAME 'change' events off the TimelineModel; scrubbing is
// always deterministic from the key list (never replayed edits).

import * as selectorEngine from './selectorEngine.js';

// ── shared helpers ────────────────────────────────────────────────────────────

function resolveTrackNodes( editor, target ) {

	let nodes = [];
	try {

		nodes = selectorEngine.query( editor.scene, target );

	} catch ( e ) {

		nodes = [];

	}

	if ( nodes.length === 0 && editor.scene.getObjectByProperty ) {

		const byUuid = editor.scene.getObjectByProperty( 'uuid', target );
		if ( byUuid ) nodes = [ byUuid ];

	}

	return nodes;

}

function isTextMesh( node ) {

	return !! ( node && node.geometry && node.geometry.parameters && node.geometry.parameters.options && typeof node.geometry.parameters.options.text === 'string' );

}

function changeEventsOf( track ) {

	return track.events.filter( e => e.op === 'change' ).sort( ( a, b ) => a.at - b.at );

}

// ── LIVE render: sample content + optional fade at time t ────────────────────

const lastText = new WeakMap(); // node -> last text applied (regen-avoidance cache)
const warnedNodes = new WeakSet(); // non-text nodes we already warned about once
const offsetApplied = new WeakSet(); // materials we've already nudged (avoid re-touching every frame)

// change() often labels a face it sits flush against (a cube top, a panel, the
// floor) — coplanar with the text's own back/side faces, which flickers
// (z-fighting) since the depth buffer can't consistently pick a winner between
// two surfaces at the same depth. Push the text slightly toward the camera in
// the DEPTH BUFFER only (no vertex/position change, so hit-testing/bounds are
// unaffected) the standard way: a small negative polygon offset.
function avoidZFighting( material ) {

	if ( ! material || offsetApplied.has( material ) ) return;
	material.polygonOffset = true;
	material.polygonOffsetFactor = -4;
	material.polygonOffsetUnits = -4;
	offsetApplied.add( material );

}

function regenerateText( node, text ) {

	if ( lastText.get( node ) === text ) return;
	const options = node.geometry.parameters.options;
	const geometry = new node.geometry.constructor( text, { ...options, text } );
	const old = node.geometry;
	node.geometry = geometry;
	lastText.set( node, text );
	avoidZFighting( node.material );

	// Deferred dispose: disposing the OLD geometry synchronously here races the
	// WebGPU renderer's already-in-flight frame, which can still reference the
	// old buffer — corrupting that frame into a garbled overlap of the old and
	// new glyphs for a single visible frame. Freeing it a frame later lets the
	// renderer finish drawing with the new geometry first.
	requestAnimationFrame( () => old.dispose() );

}

function removeGhost( node ) {

	const ghost = node.children.find( c => c.userData && c.userData.isChangeGhost );
	if ( ! ghost ) return;
	node.remove( ghost );
	ghost.geometry.dispose();
	ghost.material.dispose();

}

// A fade's incoming text gets its OWN hidden child mesh, rendered (at
// near-zero opacity) for the ENTIRE fade window instead of being created and
// shown on `node` itself right at the crossover. Building + first-rendering a
// TextGeometry is when the WebGPU renderer compiles that geometry/material's
// render pipeline — if that compile is still in flight the very frame the
// text needs to become significantly visible, the frame renders corrupted
// (garbled overlapping glyphs). Warming it at ~0 opacity across the whole
// fade gives the renderer the full duration to finish before it matters.
function getOrCreateNextSlot( node ) {

	let slot = node.children.find( c => c.userData && c.userData.isNextSlot );
	if ( slot ) return slot;
	slot = new node.constructor( node.geometry.clone(), node.material.clone() );
	slot.name = '__nextTextSlot';
	slot.userData.isNextSlot = true;
	slot.material.transparent = true;
	avoidZFighting( slot.material );
	node.add( slot );
	return slot;

}

function removeNextSlot( node ) {

	const slot = node.children.find( c => c.userData && c.userData.isNextSlot );
	if ( ! slot ) return;
	node.remove( slot );
	slot.geometry.dispose();
	slot.material.dispose();

}

/**
 * Sample every 'change' track in `model` at absolute time `t` and apply the
 * result directly to each target's live TextGeometry mesh (content swap, plus
 * fade opacity if inside a { transition:'fade' } window). Call after mixer
 * sampling (holdTimelineAt) and every playback tick — cheap when nothing
 * changed (text regeneration is cached per node).
 */
export function applyContentAt( editor, model, t ) {

	if ( ! model ) return;

	for ( const track of model.tracks ) {

		const changeEvents = changeEventsOf( track );
		if ( changeEvents.length === 0 ) continue;

		const nodes = resolveTrackNodes( editor, track.target );
		if ( nodes.length === 0 ) continue;

		let activeIdx = - 1;
		for ( let i = 0; i < changeEvents.length; i ++ ) {

			if ( changeEvents[ i ].at <= t ) activeIdx = i; else break;

		}

		if ( activeIdx === - 1 ) {

			// Before the first keyed change — leave the authored content as-is.
			for ( const node of nodes ) {

				if ( ! isTextMesh( node ) ) continue;
				removeGhost( node );
				removeNextSlot( node );
				node.material.opacity = 1;

			}

			continue;

		}

		const active = changeEvents[ activeIdx ];
		const isFade = active.args.transition === 'fade' && active.dur > 0;
		const fadeRatio = isFade ? Math.min( 1, Math.max( 0, ( t - active.at ) / active.dur ) ) : 1;
		const fading = isFade && fadeRatio < 1 && activeIdx > 0;

		for ( const node of nodes ) {

			if ( ! isTextMesh( node ) ) {

				if ( ! warnedNodes.has( node ) ) {

					warnedNodes.add( node );
					console.warn( `change(): "${ track.target }" is not a text mesh (no geometry.parameters.options.text) — content change skipped, not silently applied to a transform instead.` );

				}

				continue;

			}

			if ( fading ) {

				// Old and new strings are rarely the same width, so overlaying
				// both at once (classic crossfade, ghost + main simultaneously
				// visible) blends mismatched glyphs into an unreadable smear —
				// e.g. "5²" fading into "a² + b² = c²" left both partly opaque
				// at the same anchor and looked like garbled overlapping digits.
				// Fixed by never showing both at once: dip through zero opacity
				// instead — old text fades out over the first half of the
				// window, new text (pre-warmed on a hidden slot, see above)
				// fades in over the second half. Both materials also drop
				// depthWrite while translucent/hidden — a transparent mesh at
				// opacity 0 is invisible but, with depthWrite on, still wins the
				// depth test and blocks whatever draws behind/alongside it,
				// punching a silhouette-shaped hole out of the other mesh's text
				// wherever their glyphs overlap on screen.
				removeGhost( node );
				node.material.transparent = true;
				node.material.depthWrite = false;

				const nextSlot = getOrCreateNextSlot( node );
				regenerateText( nextSlot, active.args.text );
				nextSlot.material.transparent = true;
				nextSlot.material.depthWrite = false;
				nextSlot.visible = true;

				if ( fadeRatio < 0.5 ) {

					regenerateText( node, changeEvents[ activeIdx - 1 ].args.text );
					node.material.opacity = 1 - ( fadeRatio / 0.5 );
					nextSlot.material.opacity = 0.001; // "warm" but imperceptible

				} else {

					node.material.opacity = 0;
					nextSlot.material.opacity = ( fadeRatio - 0.5 ) / 0.5;

				}

			} else {

				// Settling right after a fade — adopt the pre-warmed slot's
				// (already rendered, pipeline-hot) geometry instead of building
				// + first-showing a fresh one exactly on this frame.
				const nextSlot = node.children.find( c => c.userData && c.userData.isNextSlot );
				if ( nextSlot && lastText.get( nextSlot ) === active.args.text ) {

					const old = node.geometry;
					node.geometry = nextSlot.geometry;
					lastText.set( node, active.args.text );
					avoidZFighting( node.material );
					requestAnimationFrame( () => old.dispose() );
					node.remove( nextSlot );
					nextSlot.material.dispose();

				} else {

					regenerateText( node, active.args.text );

				}

				// A node can ALSO carry an unrelated animate()-recipe opacity
				// track on the same material (e.g. a fadeOut() after its last
				// change()) — mirrors the mixer, so it's already been keyed to
				// whatever that recipe wants by now. Forcing opacity back to 1
				// here unconditionally fought with it every single frame after
				// this change()'s own fade window closed, permanently undoing
				// a fadeOut() that ran later and leaving the "old" text stuck
				// fully visible (looked like garbled overlapping glyphs once
				// stacked on top of whatever text replaced it at the same
				// position). Only claim opacity when nothing else owns it.
				if ( ! ( node.material.userData && node.material.userData.__fadeManaged ) ) {

					node.material.opacity = 1;
					node.material.depthWrite = true;

				}

				removeGhost( node );
				removeNextSlot( node );

			}

		}

	}

}

// ── glTF EXPORT: materialize states + scale/opacity visibility tracks ────────

/**
 * Lower every 'change' track onto `clonedScene` (a deep clone of editor.scene —
 * NEVER the live scene, this mutates geometry/children in place): for each
 * distinct text state, add a child text mesh co-located at the label (so it
 * inherits the label's own transform + any transform-animation tracks), keyed
 * visible only during its state's interval via a scale-to-zero keyframe track
 * (glTF has no boolean visibility channel, and this project's GLTFExporter
 * only emits scale/position/rotation/morph-weight channels — see
 * PATH_PROPERTIES in GLTFExporter.js). `transition:'fade'` states ALSO get a
 * material.opacity track for any consumer that does support it; this
 * project's own exporter drops it (console-warns and continues), so those
 * exports degrade to a hard cut — surfaced via a `warnings` entry rather than
 * silently losing the softness. The original label's own geometry is cleared
 * (it becomes an inert transform-carrier for its materialized children).
 *
 * @returns {{ clips: THREE.AnimationClip[], warnings: string[] }}
 */
export function lowerChangeEventsForExport( editor, clonedScene, THREE ) {

	const clips = [];
	const warnings = [];
	const model = editor.timeline;
	if ( ! model ) return { clips, warnings };

	for ( const track of model.tracks ) {

		const changeEvents = changeEventsOf( track );
		if ( changeEvents.length === 0 ) continue;

		const liveNodes = resolveTrackNodes( editor, track.target );

		for ( const liveNode of liveNodes ) {

			const node = clonedScene.getObjectByProperty( 'uuid', liveNode.uuid );
			if ( ! node ) continue;

			if ( ! isTextMesh( node ) ) {

				warnings.push( `change(): "${ track.target }" is not a text mesh — content changes were NOT lowered for export (they will not appear in the exported file).` );
				continue;

			}

			const options = node.geometry.parameters.options;
			const baseScale = node.scale.clone();

			const states = changeEvents.map( ( e, i ) => ( {
				text: e.args.text,
				fade: e.args.transition === 'fade' && e.dur > 0,
				fadeDur: e.dur || 0,
				start: e.at,
				end: i + 1 < changeEvents.length ? changeEvents[ i + 1 ].at : Math.max( model.duration, e.at + ( e.dur || 0 ) ),
			} ) );

			const newTracks = [];
			let hasFadeState = false;

			for ( const state of states ) {

				const stateNode = new THREE.Mesh(
					new node.geometry.constructor( state.text, { ...options, text: state.text } ),
					node.material.clone()
				);
				stateNode.name = `${ node.name || 'Text' }:${ state.text }`;
				stateNode.position.set( 0, 0, 0 );
				stateNode.rotation.set( 0, 0, 0 );
				stateNode.quaternion.identity();
				stateNode.scale.copy( baseScale );
				node.add( stateNode ); // child — inherits node's transform (+ its transform-animation tracks)

				// Visibility is ALWAYS keyed via scale, fade or not: glTF core
				// has no boolean visibility channel, and this project's vendored
				// GLTFExporter only emits scale/position/rotation/morph-weight
				// channels (see PATH_PROPERTIES in GLTFExporter.js) — a
				// material.opacity track is silently DROPPED by it. Scale-to-zero
				// keeps the exported CONTENT SEQUENCE correct even when the
				// softness of a fade can't be preserved.
				const times = [];
				const values = [];
				const addScale = ( time, s ) => { times.push( Math.max( 0, time ) ); values.push( s.x, s.y, s.z ); };
				const zero = { x: 0, y: 0, z: 0 };
				if ( state.start > 0 ) addScale( 0, zero );
				addScale( state.start, baseScale );
				addScale( Math.max( state.start, state.end - 1e-3 ), baseScale );
				addScale( state.end, zero );
				newTracks.push( new THREE.VectorKeyframeTrack( `${ stateNode.uuid }.scale`, times, values ) );

				if ( state.fade ) {

					// Best-effort extra: an opacity track too, for any consumer
					// that DOES support material-property animation (e.g. via a
					// KHR_animation_pointer-aware exporter/importer down the
					// line). Harmless where unsupported — see warning below.
					hasFadeState = true;
					stateNode.material.transparent = true;
					const oTimes = [];
					const oValues = [];
					const addOpacity = ( time, v ) => { oTimes.push( Math.max( 0, time ) ); oValues.push( v ); };
					if ( state.start > 0 ) addOpacity( 0, 0 );
					addOpacity( state.start, 0 );
					addOpacity( Math.min( state.end, state.start + state.fadeDur ), 1 );
					addOpacity( state.end, 1 );
					newTracks.push( new THREE.NumberKeyframeTrack( `${ stateNode.uuid }.material.opacity`, oTimes, oValues ) );

				}

			}

			if ( hasFadeState ) {

				warnings.push( `change(): "${ track.target }" has a { transition:'fade' } — this project's GLTFExporter can't animate material opacity (only scale/position/rotation/morph-weights), so the exported file shows a hard cut at the same correct time instead of a cross-fade.` );

			}

			// The original node becomes an inert transform-carrier: its own
			// content is cleared (materialized children render the states),
			// but its uuid — and any transform-animation tracks targeting it —
			// still apply, and its children inherit that transform for free.
			node.geometry.dispose();
			node.geometry = new THREE.BufferGeometry();

			if ( newTracks.length > 0 ) {

				clips.push( new THREE.AnimationClip( `change:${ node.uuid }`, model.duration || - 1, newTracks ) );

			}

		}

	}

	return { clips, warnings };

}

/** True if the model has any 'change' events at all (cheap pre-check). */
export function hasChangeEvents( editor ) {

	const model = editor.timeline;
	if ( ! model ) return false;
	return model.tracks.some( t => t.events.some( e => e.op === 'change' ) );

}
