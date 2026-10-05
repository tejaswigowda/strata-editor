// ── clipDirectives.js ─────────────────────────────────────────────────────────
// Imported glTF/GLB animation clips as first-class members of the ONE grammar.
//
// The baked keyframe tracks stay read-only data on `scene.animations`. What is
// authored — which clip, when it starts, loop / speed / weight / fade, and
// pause / stop / seek — is a set of ordinary timeline events (op: play | pause
// | stop | seek) on the scene-wide clock, so it serializes, versions and undoes
// exactly like `.animate()`. This module resolves those events against the
// clips and answers one question deterministically:
//
//     sampleClipState( clip, events, t )  ->  { local, weight }
//
// the clip-local time and blend weight to apply at global time `t`. Scrub,
// seek, live playback and the Render tab all funnel through that function (via
// timelineController.holdTimelineAt), so they cannot disagree.
//
// A clip with NO directive keeps today's behavior: starts at 0, plays once,
// holds its last frame, weight 1.

import * as THREE from 'three';
import * as selectorEngine from './selectorEngine.js';
import { CLIP_OPS } from './timeline.js';
import { sampleClipState, PLAY_DEFAULTS } from './clipSampling.js';

export { CLIP_OPS };

const TIMELINE_NAME = 'Timeline';

// ── Clip ↔ node resolution ────────────────────────────────────────────────────

function isImportedClip( c ) {

	return !! c && ! ( c.userData && c.userData.isTimeline ) && c.name !== TIMELINE_NAME;

}

/** Every raw imported clip with something to play (excludes the compiled Timeline clip). */
export function importedClipsOf( editor ) {

	return ( editor.scene.animations || [] ).filter( c => isImportedClip( c ) && c.duration > 0 );

}

// Tracks are uuid-keyed after import (Loader.retargetClipToUuid) but older
// scenes may still carry name-keyed ones — resolve both.
function trackNode( editor, track ) {

	const nodeName = THREE.PropertyBinding.parseTrackName( track.name ).nodeName;
	if ( ! nodeName ) return null;
	return editor.scene.getObjectByProperty( 'uuid', nodeName ) || THREE.PropertyBinding.findNode( editor.scene, nodeName ) || null;

}

const nodeCache = new WeakMap(); // clip -> { version, nodes }

export function clipNodes( editor, clip ) {

	const version = sceneVersion( editor );
	const hit = nodeCache.get( clip );
	if ( hit && hit.version === version ) return hit.nodes;

	const nodes = new Set();
	for ( const track of clip.tracks ) {

		const n = trackNode( editor, track );
		if ( n ) nodes.add( n );

	}

	nodeCache.set( clip, { version, nodes } );
	return nodes;

}

/** Lowest common ancestor of the nodes a clip animates (the clip's natural root). */
export function clipRoot( editor, clip ) {

	const nodes = [ ...clipNodes( editor, clip ) ];
	if ( nodes.length === 0 ) return null;

	const chains = nodes.map( n => { const a = []; for ( let o = n; o; o = o.parent ) a.unshift( o ); return a; } );
	let i = 0;
	while ( chains.every( ch => ch[ i ] && ch[ i ] === chains[ 0 ][ i ] ) ) i ++;
	return i > 0 ? chains[ 0 ][ i - 1 ] : null;

}

/** Clips that drive at least one node inside the subtree of any of `nodes`. */
export function clipsForNodes( editor, nodes ) {

	const roots = new Set( nodes );
	const out = [];

	for ( const clip of importedClipsOf( editor ) ) {

		for ( const n of clipNodes( editor, clip ) ) {

			let o = n;
			while ( o && ! roots.has( o ) ) o = o.parent;
			if ( o ) { out.push( clip ); break; }

		}

	}

	return out;

}

function describeClips( clips ) {

	return clips.length ? clips.map( c => c.name ).join( ', ' ) : '(none)';

}

/**
 * Resolve the clip a directive refers to. `name` omitted -> the first clip on
 * the target. Throws a named, actionable error — never a silent no-op.
 */
export function resolveClip( editor, selector, nodes, name, verb = 'play' ) {

	if ( ! nodes || nodes.length === 0 ) {

		throw new Error( `${ verb }(): selector "${ selector }" matched nothing — no clip to ${ verb }` );

	}

	const available = clipsForNodes( editor, nodes );

	if ( name === undefined || name === null || name === '' ) {

		if ( available.length === 0 ) throw new Error( `${ verb }(): no clip on ${ selector } — available: (none)` );
		return available[ 0 ];

	}

	const clip = available.find( c => c.name === String( name ) );
	if ( ! clip ) throw new Error( `no clip "${ name }" on ${ selector } — available: ${ describeClips( available ) }` );
	return clip;

}

// ── Timeline events → per-clip directive lists (memoized) ─────────────────────

function sceneVersion( editor ) {

	hookSignals( editor );
	return editor.__clipDirVersion;

}

function hookSignals( editor ) {

	if ( editor.__clipDirHooked ) return;
	editor.__clipDirHooked = true;
	editor.__clipDirVersion = 0;
	editor.__clipDirCache = null;
	const bump = () => { editor.__clipDirVersion ++; editor.__clipDirCache = null; };
	for ( const s of [ 'sceneGraphChanged', 'animationsChanged', 'objectChanged', 'timelineChanged', 'editorCleared' ] ) {

		if ( editor.signals && editor.signals[ s ] ) editor.signals[ s ].add( bump );

	}

}

/** Nodes a timeline track target (selector or raw uuid) resolves to. */
export function nodesForTarget( editor, target ) {

	let nodes = [];
	try { nodes = selectorEngine.query( editor.scene, target ); } catch ( e ) { nodes = []; }
	if ( nodes.length === 0 && editor.scene.getObjectByProperty ) {

		const byUuid = editor.scene.getObjectByProperty( 'uuid', target );
		if ( byUuid ) nodes = [ byUuid ];

	}

	return nodes;

}

// Which clip(s) does a directive event drive? Scoped to the selected subtree;
// falls back to a name-only match so scenes authored before scoping existed
// (and clips whose tracks sit on the import root) keep working.
function clipsForEvent( editor, nodes, event ) {

	const name = event.args && event.args.name;
	const scoped = clipsForNodes( editor, nodes );
	if ( ! name ) return scoped.slice( 0, 1 );

	const hit = scoped.filter( c => c.name === name );
	if ( hit.length ) return hit;

	const global = importedClipsOf( editor ).filter( c => c.name === name );
	return global.slice( 0, 1 );

}

/** Map<clip, events[]> — every clip that has at least one authored directive, events in clock order. */
export function directivesByClip( editor ) {

	hookSignals( editor );
	const model = editor.timeline;
	const cache = editor.__clipDirCache;
	if ( cache && cache.model === model ) return cache.map;

	const map = new Map();

	if ( model ) {

		for ( const track of model.tracks ) {

			if ( ! track.events.some( e => CLIP_OPS.has( e.op ) ) ) continue;
			const nodes = nodesForTarget( editor, track.target );

			for ( const event of model.sortedEvents( track ) ) {

				if ( ! CLIP_OPS.has( event.op ) ) continue;

				for ( const clip of clipsForEvent( editor, nodes, event ) ) {

					if ( ! map.has( clip ) ) map.set( clip, [] );
					map.get( clip ).push( event );

				}

			}

		}

		for ( const events of map.values() ) events.sort( ( a, b ) => a.at - b.at );

	}

	editor.__clipDirCache = { model, map };
	return map;

}

/** Human-readable problems with the authored directives (missing selector / clip). Empty = clean. */
export function clipDirectiveProblems( editor ) {

	const problems = [];
	const model = editor.timeline;
	if ( ! model ) return problems;

	for ( const track of model.tracks ) {

		for ( const event of track.events ) {

			if ( ! CLIP_OPS.has( event.op ) ) continue;

			const nodes = nodesForTarget( editor, track.target );
			if ( nodes.length === 0 ) {

				problems.push( `${ event.op }(): selector "${ track.target }" matches nothing` );
				continue;

			}

			const name = event.args && event.args.name;
			if ( clipsForEvent( editor, nodes, event ).length === 0 ) {

				const available = clipsForNodes( editor, nodes );
				problems.push( name
					? `no clip "${ name }" on ${ track.target } — available: ${ describeClips( available ) }`
					: `${ event.op }(): no clip on ${ track.target } — available: (none)` );

			}

		}

	}

	return problems;

}

// ── Sampling ──────────────────────────────────────────────────────────────────
// sampleClipState (the pure play/pause/stop/seek semantics) lives in
// clipSampling.js so it is node-testable; re-exported here as the one entry point.

export { sampleClipState, PLAY_DEFAULTS };

// ── glTF export: bake the directives into plain keyframes ─────────────────────
// glTF has no notion of loop/speed/pause, so a directive-controlled clip is
// exported as the keyframes it actually plays on the shared clock. Weight and
// fade are blend controls and are not baked.

const EXPORT_FPS = 30;

/**
 * @returns {THREE.KeyframeTrack[]} tracks for the exported (single, merged) clip
 */
export function exportTracksForClip( clip, events, totalDuration ) {

	const plays = events.filter( e => e.op === 'play' );
	const simple = plays.length === 1 && events.length === 1
		&& ! plays[ 0 ].args.loop && ( plays[ 0 ].args.speed === undefined || Number( plays[ 0 ].args.speed ) === 1 );

	if ( simple ) {

		const at = plays[ 0 ].at;
		if ( at === 0 ) return clip.tracks;
		return clip.tracks.map( t => new t.constructor( t.name, Array.from( t.times, x => x + at ), Array.from( t.values ), t.getInterpolation() ) );

	}

	const length = Math.max( totalDuration, 0 );
	const n = Math.max( 1, Math.ceil( length * EXPORT_FPS ) );
	const times = Array.from( { length: n + 1 }, ( _, i ) => Math.min( length, i / EXPORT_FPS ) );
	const locals = times.map( t => sampleClipState( clip, events, t ).local );

	return clip.tracks.map( track => {

		const interp = track.createInterpolant();
		const values = [];
		for ( const local of locals ) values.push( ...Array.from( interp.evaluate( local ) ) );
		return new track.constructor( track.name, times, values );

	} );

}
