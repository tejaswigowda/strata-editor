// ── timeline.js ─────────────────────────────────────────────────────────────
// THE universal timeline — ONE scene-wide absolute clock (the "op-JSON of time").
//
// REPRESENTATION (this file):  an absolute-time TRACK LIST. One duration, tracks
//   that target scene entities (objects / camera / later emitters), each holding
//   absolute-time events { at, op, args, dur }. This is what is VERSIONED (in the
//   scene JSON, git-diffable) and EXPORTED (to glTF keyframes).
// SUGAR (opPrimitive.js $S .then/.with/.at):  sequential authoring that COMPILES
//   to the absolute `at` values on this clock — the same sugar→representation
//   relationship $S() has with op-JSON.
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
// The $S .then()/.with()/.at() chain uses this cursor logic to assign absolute
// `at` values as ops are chained. Kept here (pure) so the same rules are testable
// independently of the ChainableSet host.

/**
 * A time cursor that turns sequential authoring into absolute `at` values.
 *   .place(dur)  → returns the absolute `at` for the next op (then advances state)
 *   .then(gap)   → cursor = prevAt + prevDur + gap   (start when previous ENDS)
 *   .at(t)       → cursor = t                        (explicit absolute placement)
 *   .with()      → next op shares the previous op's `at` (parallel, not sequential)
 */
export class TimeCursor {

	constructor() {

		this.cursor = 0;
		this.prevAt = 0;
		this.prevDur = 0;
		this.parallelNext = false;
		this.started = false;

	}

	/** Compute + commit the absolute `at` for an op of length `dur`. */
	place( dur ) {

		const at = this.parallelNext && this.started ? this.prevAt : this.cursor;
		this.prevAt = at;
		this.prevDur = Math.max( 0, Number( dur ) || 0 );
		this.cursor = at; // a bare following op stays parallel until .then() advances
		this.parallelNext = false;
		this.started = true;
		return at;

	}

	/** Next op starts when the previous ENDS (+ optional gap seconds). */
	then( gap = 0 ) {

		this.cursor = this.prevAt + this.prevDur + ( Number( gap ) || 0 );
		this.parallelNext = false;
		return this;

	}

	/** Next op starts at the SAME absolute time as the previous (parallel). */
	with() {

		this.parallelNext = true;
		return this;

	}

	/** Explicitly place the next op at absolute time `t`. */
	at( t ) {

		this.cursor = Math.max( 0, Number( t ) || 0 );
		this.parallelNext = false;
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

			for ( const node of nodes ) {

				let clip;
				try {

					clip = recipeFn( node, params );

				} catch ( e ) {

					clip = null;

				}

				if ( ! clip || ! clip.tracks ) continue;

				// Offset every keyframe by the event's ABSOLUTE start time.
				for ( const t of clip.tracks ) {

					const times = event.at === 0 ? t.times : t.times.map( x => x + event.at );
					rawTracks.push( new t.constructor( t.name, Array.from( times ), Array.from( t.values ) ) );

				}

			}

		}

	}

	if ( rawTracks.length === 0 ) return null;

	const merged = mergeTracks( THREE, rawTracks );
	const clip = new THREE.AnimationClip( TIMELINE_CLIP_NAME, model.duration || - 1, merged );
	clip.userData = clip.userData || {};
	clip.userData.isTimeline = true;
	clip.resetDuration();
	if ( model.duration > 0 ) clip.duration = model.duration;
	return clip;

}

export { TIMELINE_CLIP_NAME };
