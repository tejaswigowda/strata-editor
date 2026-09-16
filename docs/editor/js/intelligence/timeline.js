// ── timeline.js ─────────────────────────────────────────────────────────────
// THE universal timeline — ONE scene-wide absolute clock (the "op-JSON of time").
//
// REPRESENTATION (this file):  an absolute-time TRACK LIST. One duration, tracks
//   that target scene entities (objects / camera / later emitters), each holding
//   absolute-time events { at, op, args, dur }. This is what is VERSIONED (in the
//   scene JSON, git-diffable) and EXPORTED (to glTF keyframes).
// SUGAR (opPrimitive.js $S .animate()/.at()):  jQuery-queue authoring that
//   COMPILES to the absolute `at` values on this clock — the same
//   sugar→representation relationship $S() has with op-JSON.
//
// `at`  = ABSOLUTE time on the scene clock (NOT relative to the previous event).
// `dur` = how long the event's animation runs from `at`.
//
// The model here is PURE (no THREE, no DOM) so it is node-testable. Compilation
// to a THREE.AnimationClip (which drives playback AND glTF export) is a separate,
// injectable function so the representation stays portable.

let _uidCounter = 0;
function uid() {

	_uidCounter ++;
	return 'ev' + Date.now().toString( 36 ) + '_' + _uidCounter.toString( 36 );

}

// ── Canonical rest state ───────────────────────────────────────────────────
// Compile must be a PURE function of (scene + animation model), never of
// leftover in-memory state from a previous scrub/play/compile. Recipes that
// read "the node's current value" as their baseline (fadeOut's start opacity,
// a relative translateX's start position, ...) need a stable rest pose to
// read from — so each node's PRISTINE transform/opacity is captured the first
// time compileTimeline ever sees it, cached by uuid, and reasserted at the
// START of every subsequent compile before any recipe runs. Recompiling the
// same model twice in a row therefore always samples identically, regardless
// of how much scrubbing/playing happened in between.
//
// The cache is invalidated per-node by genuine (non-timeline) edits — every
// SetPosition/Rotation/Scale/Material command dispatches `objectChanged` (see
// Editor.js, which wires that signal to invalidateRestState) — so
// intentionally re-posing an object's base pose after authoring an animation
// on it is honored as the new baseline. It's cleared wholesale on scene load.
const restStateCache = new Map(); // uuid -> { position, quaternion, scale, opacity?, fov? }

function captureRestState( node ) {

	const state = {
		position: node.position.clone(),
		quaternion: node.quaternion.clone(),
		scale: node.scale.clone(),
	};
	if ( node.material && ! Array.isArray( node.material ) && typeof node.material.opacity === 'number' ) {

		state.opacity = node.material.opacity;

	}

	if ( typeof node.fov === 'number' ) state.fov = node.fov;
	return state;

}

function resetToRestState( node ) {

	let state = restStateCache.get( node.uuid );
	if ( ! state ) {

		state = captureRestState( node );
		restStateCache.set( node.uuid, state );

	}

	node.position.copy( state.position );
	node.quaternion.copy( state.quaternion );
	node.scale.copy( state.scale );
	if ( state.opacity !== undefined && node.material && ! Array.isArray( node.material ) ) node.material.opacity = state.opacity;
	if ( state.fov !== undefined ) { node.fov = state.fov; if ( node.updateProjectionMatrix ) node.updateProjectionMatrix(); }

}

/**
 * Drop one node's cached rest state. Call after a genuine (non-timeline) edit
 * changes its base pose/opacity, so the next compile re-captures the edited
 * value as the new baseline instead of reasserting the stale one.
 */
export function invalidateRestState( node ) {

	if ( node && node.uuid ) restStateCache.delete( node.uuid );

}

/** Drop every cached rest state. Call on scene load — a freshly loaded scene's authored values are the new baseline. */
export function clearRestStateCache() {

	restStateCache.clear();

}

/**
 * Run `fn()` (e.g. `scene.toJSON()`) with every cached-rest-state node
 * TEMPORARILY snapped to its canonical rest pose, then restore whatever the
 * live scene was actually showing (mid-scrub/mid-play or otherwise)
 * immediately after — synchronous, so nothing visibly flickers in the
 * viewport. This is what makes serialization (autosave, manual Save, git
 * commit, export) safe to call at ANY moment: without it, saving while the
 * timeline is mid-animation bakes that transient pose into the object's
 * base transform/opacity, which the rest-state cache then (correctly, but
 * wrongly) treats as the new ground truth on the next load/compile — the
 * exact bug this cache exists to prevent, just moved to serialization time.
 */
export function withCanonicalRestState( scene, fn ) {

	const live = new Map(); // uuid -> live pose, restored in `finally`

	scene.traverse( function ( node ) {

		const rest = restStateCache.get( node.uuid );
		if ( ! rest ) return;

		live.set( node.uuid, {
			position: node.position.clone(),
			quaternion: node.quaternion.clone(),
			scale: node.scale.clone(),
			opacity: ( node.material && ! Array.isArray( node.material ) ) ? node.material.opacity : undefined,
			fov: typeof node.fov === 'number' ? node.fov : undefined,
		} );

		node.position.copy( rest.position );
		node.quaternion.copy( rest.quaternion );
		node.scale.copy( rest.scale );
		if ( rest.opacity !== undefined && node.material && ! Array.isArray( node.material ) ) node.material.opacity = rest.opacity;
		if ( rest.fov !== undefined ) node.fov = rest.fov;
		node.updateMatrix();

	} );

	try {

		return fn();

	} finally {

		scene.traverse( function ( node ) {

			const prev = live.get( node.uuid );
			if ( ! prev ) return;

			node.position.copy( prev.position );
			node.quaternion.copy( prev.quaternion );
			node.scale.copy( prev.scale );
			if ( prev.opacity !== undefined && node.material && ! Array.isArray( node.material ) ) node.material.opacity = prev.opacity;
			if ( prev.fov !== undefined ) node.fov = prev.fov;
			node.updateMatrix();

		} );

	}

}

/**
 * Run `fn()` (e.g. `scene.toJSON()`) with every edge-outline helper object
 * (see Viewport.js's `hydrateEdgeOutline` — a LineSegments over an
 * EdgesGeometry, added as a child of a cube to draw its border) TEMPORARILY
 * detached, then reattach them immediately after. EdgesGeometry has no
 * registered `fromJSON` in this three.js build's Geometries registry, so
 * `ObjectLoader.parseGeometries()` throws ("Geometries[data.type].fromJSON is
 * not a function") on the NEXT load if one ever gets serialized — this
 * silently corrupts the WHOLE saved scene (confirmed: 0 objects loaded).
 * Outlines are cheap to rebuild from `node.userData.hasEdgeOutline` (a plain,
 * serializable boolean) every load instead, so they're never persisted at
 * all — same rationale/pattern as `withCanonicalRestState` just above.
 */
export function withoutEdgeOutlines( scene, fn ) {

	const detached = []; // [ parent, outline ][]

	scene.traverse( function ( node ) {

		if ( node.userData && node.userData.isEdgeOutline && node.parent ) detached.push( [ node.parent, node ] );

	} );

	for ( const [ parent, outline ] of detached ) parent.remove( outline );

	try {

		return fn();

	} finally {

		for ( const [ parent, outline ] of detached ) parent.add( outline );

	}

}

// ── The model ─────────────────────────────────────────────────────────────────

/**
 * The scene-wide timeline: one clock, many tracks, absolute-time events.
 *
 * Shape (serialized):
 *   { duration, tracks: [ { target, events: [ { id, at, op, args, dur } ] } ] }
 */
export class TimelineModel {

	constructor( data = null ) {

		this.duration = 0;
		this.tracks = [];
		if ( data ) this._load( data );
		this.recomputeDuration();

	}

	_load( data ) {

		this.duration = Number( data.duration ) || 0;
		this.tracks = ( data.tracks || [] ).map( t => ( {
			target: String( t.target ),
			events: ( t.events || [] ).map( e => ( {
				id: e.id || uid(),
				at: Math.max( 0, Number( e.at ) || 0 ),
				op: String( e.op ),
				args: e.args && typeof e.args === 'object' ? { ...e.args } : {},
				dur: Math.max( 0, Number( e.dur ) || 0 ),
			} ) ),
		} ) );

	}

	isEmpty() {

		return this.tracks.every( t => t.events.length === 0 );

	}

	/** Find a track by target selector; optionally create it. */
	track( target, create = false ) {

		let t = this.tracks.find( t => t.target === target );
		if ( ! t && create ) {

			t = { target, events: [] };
			this.tracks.push( t );

		}

		return t || null;

	}

	/**
	 * Add an absolute-time event to a target's track (creating the track if new).
	 * @returns {object} the stored event (with generated id)
	 */
	addEvent( target, event ) {

		const t = this.track( target, true );
		const ev = {
			id: event.id || uid(),
			at: Math.max( 0, Number( event.at ) || 0 ),
			op: String( event.op ),
			args: event.args && typeof event.args === 'object' ? { ...event.args } : {},
			dur: Math.max( 0, Number( event.dur ) || 0 ),
		};
		t.events.push( ev );
		this.recomputeDuration();
		return ev;

	}

	/** Locate an event by id across all tracks. */
	findEvent( id ) {

		for ( const t of this.tracks ) {

			const i = t.events.findIndex( e => e.id === id );
			if ( i !== - 1 ) return { track: t, event: t.events[ i ], index: i };

		}

		return null;

	}

	/** Retime an event (change its absolute `at`). */
	moveEvent( id, at ) {

		const found = this.findEvent( id );
		if ( ! found ) return false;
		found.event.at = Math.max( 0, Number( at ) || 0 );
		this.recomputeDuration();
		return true;

	}

	/** Resize an event (change its `dur`). */
	resizeEvent( id, dur ) {

		const found = this.findEvent( id );
		if ( ! found ) return false;
		found.event.dur = Math.max( 0, Number( dur ) || 0 );
		this.recomputeDuration();
		return true;

	}

	/** Remove an event by id. Drops the track if it becomes empty. */
	removeEvent( id ) {

		const found = this.findEvent( id );
		if ( ! found ) return false;
		found.track.events.splice( found.index, 1 );
		if ( found.track.events.length === 0 ) {

			this.tracks.splice( this.tracks.indexOf( found.track ), 1 );

		}

		this.recomputeDuration();
		return true;

	}

	clear() {

		this.tracks = [];
		this.duration = 0;

	}

	/** Duration = the latest event end (at + dur) across all tracks. */
	recomputeDuration() {

		let max = 0;
		for ( const t of this.tracks ) {

			for ( const e of t.events ) {

				max = Math.max( max, e.at + e.dur );

			}

		}

		this.duration = max;
		return max;

	}

	/** Events sorted by absolute time (for display / compilation). */
	sortedEvents( track ) {

		return [ ...track.events ].sort( ( a, b ) => a.at - b.at );

	}

	toJSON() {

		return {
			duration: this.duration,
			tracks: this.tracks.map( t => ( {
				target: t.target,
				events: t.events.map( e => ( {
					id: e.id,
					at: e.at,
					op: e.op,
					args: { ...e.args },
					dur: e.dur,
				} ) ),
			} ) ),
		};

	}

	static fromJSON( json ) {

		return new TimelineModel( json );

	}

}

// ── Sugar → absolute compilation (authoring cursor) ───────────────────────────
// The $S .animate()/.at() chain uses this cursor logic to assign absolute `at`
// values as ops are chained. Kept here (pure) so the same rules are testable
// independently of the ChainableSet host.

/**
 * A time cursor that turns jQuery-queue authoring into absolute `at` values.
 *   .place(dur)        → absolute `at` for the op; cursor advances past its end
 *                        (jQuery QUEUE: chained .animate() calls are SEQUENTIAL)
 *   .place(dur, true)  → op runs PARALLEL with the previous ({queue:false});
 *                        the queue cursor is not advanced
 *   .at(t)             → cursor = t (explicit absolute placement — the one
 *                        timeline-specific extension over the jQuery prior)
 */
export class TimeCursor {

	constructor() {

		this.cursor = 0;
		this.prevAt = 0;
		this.prevDur = 0;
		this.started = false;

	}

	/** Compute + commit the absolute `at` for an op of length `dur`. */
	place( dur, parallel = false ) {

		const at = parallel && this.started ? this.prevAt : this.cursor;
		this.prevAt = at;
		this.prevDur = Math.max( 0, Number( dur ) || 0 );
		if ( ! ( parallel && this.started ) ) this.cursor = at + this.prevDur; // queue advances
		this.started = true;
		return at;

	}

	/** Explicitly place the next op at absolute time `t`. */
	at( t ) {

		this.cursor = Math.max( 0, Number( t ) || 0 );
		return this;

	}

}

// ── Compilation to a THREE.AnimationClip (the compile target) ─────────────────

const TIMELINE_CLIP_NAME = 'Timeline';

/**
 * Merge tracks that share a name (same node.property animated by several events)
 * by concatenating their keyframes, sorting by time, and dropping near-duplicate
 * times (a later event wins at a coincident time — e.g. fadeIn then fadeOut).
 */
function mergeTracks( THREE, rawTracks ) {

	const byName = new Map();

	for ( const t of rawTracks ) {

		if ( ! byName.has( t.name ) ) byName.set( t.name, [] );
		byName.get( t.name ).push( t );

	}

	const out = [];

	for ( const [ name, group ] of byName ) {

		if ( group.length === 1 ) {

			out.push( group[ 0 ] );
			continue;

		}

		const stride = group[ 0 ].getValueSize();
		const ctor = group[ 0 ].constructor;
		const pairs = [];

		for ( const t of group ) {

			for ( let i = 0; i < t.times.length; i ++ ) {

				pairs.push( { time: t.times[ i ], value: Array.from( t.values.slice( i * stride, i * stride + stride ) ) } );

			}

		}

		pairs.sort( ( a, b ) => a.time - b.time );

		const times = [];
		const values = [];
		for ( const p of pairs ) {

			// Drop a near-coincident earlier key (later event overwrites).
			if ( times.length && Math.abs( times[ times.length - 1 ] - p.time ) < 1e-4 ) {

				const base = ( times.length - 1 ) * stride;
				for ( let k = 0; k < stride; k ++ ) values[ base + k ] = p.value[ k ];
				continue;

			}

			times.push( p.time );
			values.push( ...p.value );

		}

		out.push( new ctor( name, times, values ) );

	}

	return out;

}

/**
 * Compile the absolute-time track list into ONE scene-wide THREE.AnimationClip.
 * This single clip IS the playback engine (played through the mixer) AND the glTF
 * export source (glTF animation tracks are absolute keyframes — near-direct map).
 *
 * @param {TimelineModel} model
 * @param {object} ctx  { editor, THREE, recipes, selectorEngine }
 * @returns {THREE.AnimationClip|null}
 */
export function compileTimeline( model, ctx ) {

	const { editor, THREE, recipes, selectorEngine } = ctx;
	if ( ! model || model.isEmpty() ) return null;

	// Selector → node(s), with the same camera/uuid fallbacks used for track
	// targets below. Shared by the lookAt and moveTo/moveToEach resolvers.
	function resolveSelectorNodes( selector ) {

		let found = [];
		try { found = selectorEngine.query( editor.scene, selector ); } catch ( e ) {}
		if ( found.length === 0 && /(^|[.#\s])camera\b/i.test( selector ) && editor.camera ) found = [ editor.camera ];
		if ( found.length === 0 && editor.scene.getObjectByProperty ) {

			const byUuid = editor.scene.getObjectByProperty( 'uuid', selector );
			if ( byUuid ) found = [ byUuid ];

		}

		return found;

	}

	function worldPositionOf( obj ) {

		if ( typeof obj.getWorldPosition === 'function' && THREE && THREE.Vector3 ) {

			const v = obj.getWorldPosition( new THREE.Vector3() );
			return [ v.x, v.y, v.z ];

		}

		return obj.position ? [ obj.position.x || 0, obj.position.y || 0, obj.position.z || 0 ] : null;

	}

	function worldQuaternionOf( obj ) {

		if ( typeof obj.getWorldQuaternion === 'function' && THREE && THREE.Quaternion ) {

			const q = obj.getWorldQuaternion( new THREE.Quaternion() );
			return [ q.x, q.y, q.z, q.w ];

		}

		return obj.quaternion ? [ obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w ] : null;

	}

	// Recipes read the node's LIVE transform as their baseline (P0/S0/Q0/etc.) —
	// this is what makes RELATIVE deltas (translateX, scaleX, spin turns, shake
	// jitter, ...) mean "relative to wherever this node currently is". Without
	// committing each event's OWN final pose back onto the live node before
	// compiling the NEXT (later) event on the same node, every event would
	// instead read the same frozen REST POSE regardless of what earlier events
	// already did — e.g. translateX:0.5 at t=0 then translateX:0.1 at t=10 would
	// merge into keyframes (0,0)(0.4,0.5)(10,0)(10.4,0.1): the mixer holds
	// nothing steady and instead DRIFTS from 0.5 back down to 0 across the
	// entire [0.4,10] gap, because the t=10 keyframe's start value (0, the rest
	// pose) doesn't match the t=0.4 segment's end value (0.5). Applying each
	// clip's final frame here makes every subsequent event on the same node
	// compose against the CORRECT "current" pose, so gaps between events hold
	// flat instead of drifting.
	function commitFinalPose( node, track ) {

		const stride = track.getValueSize();
		const last = Array.from( track.values.slice( track.values.length - stride ) );
		const propPath = track.name.slice( track.name.indexOf( '.' ) + 1 );

		if ( propPath === 'position' ) node.position.set( last[ 0 ], last[ 1 ], last[ 2 ] );
		else if ( propPath === 'scale' ) node.scale.set( last[ 0 ], last[ 1 ], last[ 2 ] );
		else if ( propPath === 'quaternion' ) node.quaternion.set( last[ 0 ], last[ 1 ], last[ 2 ], last[ 3 ] );
		else if ( propPath === 'fov' ) { node.fov = last[ 0 ]; if ( node.updateProjectionMatrix ) node.updateProjectionMatrix(); }
		else if ( propPath === 'material.opacity' && node.material ) node.material.opacity = last[ 0 ];

	}

	// Selector or literal [x,y,z] → a single WORLD position, averaging if the
	// selector matches multiple nodes (matches lookAt's existing convention).
	function resolveWorldPoint( selectorOrPoint ) {

		if ( Array.isArray( selectorOrPoint ) ) return selectorOrPoint.map( Number );
		if ( typeof selectorOrPoint !== 'string' ) return null;

		const targets = resolveSelectorNodes( selectorOrPoint );
		if ( targets.length === 0 ) return null;

		const p = [ 0, 0, 0 ];
		let n = 0;
		for ( const tgt of targets ) {

			const v = worldPositionOf( tgt );
			if ( v ) { p[ 0 ] += v[ 0 ]; p[ 1 ] += v[ 1 ]; p[ 2 ] += v[ 2 ]; n ++; }

		}

		return n > 0 ? [ p[ 0 ] / n, p[ 1 ] / n, p[ 2 ] / n ] : null;

	}

	// Selector → the WORLD rotation of the FIRST matched node (unlike position,
	// quaternions can't be meaningfully averaged across multiple targets — a
	// literal [x,y,z] point has no rotation to borrow, so this only handles
	// selector strings).
	function resolveWorldQuaternion( selectorOrPoint ) {

		if ( typeof selectorOrPoint !== 'string' ) return null;

		const targets = resolveSelectorNodes( selectorOrPoint );
		if ( targets.length === 0 ) return null;

		return worldQuaternionOf( targets[ 0 ] );

	}

	// Reset EVERY node this model could touch (including Group descendants, for
	// opacity recipes' Group→mesh expansion) to its canonical rest state BEFORE
	// any event compiles — a single pass up front, so no track's reset can undo
	// another track's already-compiled progress on a node they both happen to
	// touch (rare, but possible with overlapping selectors).
	{

		const toReset = new Set();
		for ( const track of model.tracks ) {

			let trackNodes = [];
			try { trackNodes = selectorEngine.query( editor.scene, track.target ); } catch ( e ) {}
			for ( const n of trackNodes ) n.traverse( child => toReset.add( child ) );

		}

		for ( const n of toReset ) resetToRestState( n );

	}

	const rawTracks = [];

	for ( const track of model.tracks ) {

		let nodes = [];
		try {

			nodes = selectorEngine.query( editor.scene, track.target );

		} catch ( e ) {

			nodes = [];

		}

		// Camera track: the viewport camera is $S-addressable but may live outside
		// the scene graph — fall back to it so camera keyframes still compile.
		if ( nodes.length === 0 && /(^|[.#\s])camera\b/i.test( track.target ) && editor.camera ) {

			nodes = [ editor.camera ];

		}

		// Raw-uuid target fallback (add-event-at-playhead stores the object uuid so
		// it resolves deterministically even without a label/class selector).
		if ( nodes.length === 0 && editor.scene.getObjectByProperty ) {

			const byUuid = editor.scene.getObjectByProperty( 'uuid', track.target );
			if ( byUuid ) nodes = [ byUuid ];

		}

		if ( nodes.length === 0 ) continue;

		for ( const event of model.sortedEvents( track ) ) {

			const recipeFn = recipes[ event.op + 'Recipe' ];
			if ( typeof recipeFn !== 'function' ) continue;

			const params = { ...event.args, duration: event.dur || event.args.duration };

			// Look-at (animate op): resolve the target selector/point to a WORLD
			// position HOST-SIDE at bake time (deterministic), so the recipe stays
			// pure. The aim bakes to rotation keyframes — the quaternion is a
			// transient computation detail, never authored/stored/exported.
			if ( event.op === 'animate' && params.props && params.props.lookAt != null ) {

				const world = resolveWorldPoint( params.props.lookAt );
				if ( world ) params.lookAtWorld = world;

			}

			// moveTo: resolve the target selector to a WORLD position HOST-SIDE at
			// bake time (compile-time resolution is the whole point — see
			// ANIMATION.md — it's what makes this a plain, portable position track).
			// Also resolve the target's WORLD rotation so the mover ends up facing
			// the same way as the target, not just standing in its spot.
			if ( event.op === 'moveTo' ) {

				const world = resolveWorldPoint( params.target );
				if ( world ) params.targetWorld = world;
				else console.warn( `moveTo(): target "${ params.target }" did not resolve to any object — "${ track.target }" was not moved.` );

				const worldQ = resolveWorldQuaternion( params.target );
				if ( worldQ ) params.targetQuaternion = worldQ;

			}

			// moveToEach: pair source[i] -> target[i] POSITIONALLY. A count
			// mismatch WARNS (never-silently-wrong) rather than truncating/
			// wrapping silently; only the min(source,target) count is paired.
			let perNodeTargetWorld = null;
			let perNodeTargetQuaternion = null;
			if ( event.op === 'moveToEach' ) {

				const targets = resolveSelectorNodes( params.target );
				const pairCount = Math.min( nodes.length, targets.length );

				if ( nodes.length !== targets.length ) {

					console.warn(
						`moveToEach(): "${ track.target }" has ${ nodes.length } source(s) but "${ params.target }" has ${ targets.length } target(s) — ` +
						`only the first ${ pairCount } pair(s) were animated. Subset your selectors so the counts match.`
					);

				}

				perNodeTargetWorld = nodes.map( ( n, i ) => i < pairCount ? worldPositionOf( targets[ i ] ) : null );
				perNodeTargetQuaternion = nodes.map( ( n, i ) => i < pairCount ? worldQuaternionOf( targets[ i ] ) : null );

			}

			// Opacity-based recipes (fade, fadeIn, fadeOut, flash) need meshes, not Groups
			// Expand Groups to their descendant meshes so compilation always succeeds
			const OPACITY_RECIPES = new Set( [ 'fade', 'fadeIn', 'fadeOut', 'flash' ] );
			let nodesToAnimate = nodes;
			if ( OPACITY_RECIPES.has( event.op ) ) {

				nodesToAnimate = [];
				const visited = new Set();
				function traverse( node ) {

					if ( visited.has( node ) ) return;
					visited.add( node );

					// fadeIn means "become visible" — opacity alone can't do that if
					// an ancestor Group (e.g. a hidden target scaffold, or any
					// setVisible(false) node) is still visible=false, since three.js
					// never renders a subtree under an invisible node regardless of
					// its own opacity. Force the WHOLE matched path visible so the
					// opacity ramp is actually seen.
					if ( event.op === 'fadeIn' ) node.visible = true;

					if ( node.isMesh ) nodesToAnimate.push( node );
					else if ( node.isGroup ) {

						for ( const child of node.children ) traverse( child );

					}

				}

				for ( const n of nodes ) traverse( n );

			}

			for ( let ni = 0; ni < nodesToAnimate.length; ni ++ ) {

				const node = nodesToAnimate[ ni ];

				// moveToEach: this source's paired target didn't resolve (mismatch,
				// already warned above) — skip rather than animate to a wrong point.
				if ( perNodeTargetWorld && ! perNodeTargetWorld[ ni ] ) continue;

				const nodeParams = perNodeTargetWorld
					? { ...params, targetWorld: perNodeTargetWorld[ ni ], targetQuaternion: perNodeTargetQuaternion[ ni ] }
					: params;

				let clip;
				try {

					clip = recipeFn( node, nodeParams );

				} catch ( e ) {

					clip = null;

				}

				if ( ! clip || ! clip.tracks ) continue;

				// Offset every keyframe by the event's ABSOLUTE start time.
				for ( const t of clip.tracks ) {

					const times = event.at === 0 ? t.times : t.times.map( x => x + event.at );
					rawTracks.push( new t.constructor( t.name, Array.from( times ), Array.from( t.values ) ) );
					commitFinalPose( node, t );

				}

			}

		}

	}

	if ( rawTracks.length === 0 ) {

		// A model can be non-empty (has events) yet produce zero transform
		// tracks — e.g. a timeline built entirely from 'change' events (content,
		// not a keyframe-track animation; see textChange.js). Still emit an
		// empty clip so scrub/playback timing (duration, mixer hold) keeps
		// working; content itself is sampled separately by applyContentAt().
		if ( ! ( model.duration > 0 ) ) return null;
		const empty = new THREE.AnimationClip( TIMELINE_CLIP_NAME, model.duration, [] );
		empty.userData = { isTimeline: true };
		return empty;

	}

	const merged = mergeTracks( THREE, rawTracks );
	const clip = new THREE.AnimationClip( TIMELINE_CLIP_NAME, model.duration || - 1, merged );
	clip.userData = clip.userData || {};
	clip.userData.isTimeline = true;
	clip.resetDuration();
	if ( model.duration > 0 ) clip.duration = model.duration;
	return clip;

}

export { TIMELINE_CLIP_NAME };
