// ── faceTrack.js ──────────────────────────────────────────────────────────────
// The authored face as keyed channels on the universal timeline. Pure (no three.js,
// no DOM, no editor) so a performance can be authored, sampled and tested headless.
//
// Two kinds of event live on a character's track (the same track its body `play`
// events are on), addressed like a camera move:
//
//   face  { at, dur, args: { shapes: { jawOpen: 0.4, … }, easing, hold? } }
//   gaze  { at, dur, args: { target: '#f2' | [x,y,z] | 'away', head: 0..1, easing } }
//
// A key ARRIVES at `at + dur` (so `keyAt(t, { duration })` means "be there at t, having
// moved for `duration` ms"), exactly like a camera `animate` event. Values are continuous
// and interpolated with a CSS easing; a key only mentions the shapes it sets, every other
// shape keeps its previous value. A preset is not state: applying one writes explicit
// per-shape values (see expandPreset).
//
// Layers, lowest to highest (see composeShapes): procedural idle → authored → visemes.
// Visemes (audio-derived) are LOGGED, NOT BUILT: the slot exists, nothing fills it.
//
// Morph weights only. No vertex, skin-weight or skeleton edits.

import { cssEasingFunction } from './cssEasing.js';

export const FACE_OP = 'face';
export const GAZE_OP = 'gaze';
export const LAYERS = Object.freeze( [ 'idle', 'authored', 'viseme' ] ); // lowest -> highest
export const KEY_EPS = 0.0015;

/** Anatomical limits (radians). Eyes past these hand the rest to the head. */
export const GAZE_LIMITS = Object.freeze( {
	eyeYaw: 0.52, // ~30 deg
	eyeUp: 0.35, // ~20 deg
	eyeDown: 0.44, // ~25 deg
	headYaw: 1.22, // ~70 deg
	headPitch: 0.6, // ~35 deg
} );

export const GAZE_DEFAULTS = Object.freeze( {
	head: 0.35, // share of the aim the head takes (0 = eyes only: a glance; 1 = head does it all)
	headDelay: 0.1, // the head starts this long after the eyes (seconds)
	headLag: 0.4, // and takes this much longer than the eyes to arrive (fraction of the key duration)
} );

/** 'away': a fixed averted look — 35 deg to the character's left, 10 deg down. Deterministic, no target needed. */
export const AWAY_AIM = Object.freeze( { yaw: 0.61, pitch: - 0.17 } );

const has = ( o, k ) => Object.prototype.hasOwnProperty.call( o, k );
const isNum = v => typeof v === 'number' && Number.isFinite( v );
const clamp = ( v, lo, hi ) => Math.min( hi, Math.max( lo, v ) );
const r4 = v => Math.round( v * 1e4 ) / 1e4;

export class FaceError extends Error {

	constructor( message, code = 'BAD_ARGS' ) {

		super( message );
		this.name = 'FaceError';
		this.code = code;

	}

}

const fail = ( m, code ) => { throw new FaceError( m, code ); };

// ── Presets (authoring convenience only — a key is the truth) ─────────────────

export const PRESETS = Object.freeze( {
	neutral: {},
	smile: { mouthSmileLeft: 0.7, mouthSmileRight: 0.7, cheekSquintLeft: 0.3, cheekSquintRight: 0.3 },
	surprise: { jawOpen: 0.5, browInnerUp: 0.8, eyeWideLeft: 0.6, eyeWideRight: 0.6, browOuterUpLeft: 0.5, browOuterUpRight: 0.5 },
	frown: { mouthFrownLeft: 0.7, mouthFrownRight: 0.7, browDownLeft: 0.6, browDownRight: 0.6 },
	blink: { eyeBlinkLeft: 1, eyeBlinkRight: 1 },
	alarm: { jawOpen: 0.35, browInnerUp: 1, browOuterUpLeft: 0.8, browOuterUpRight: 0.8, eyeWideLeft: 1, eyeWideRight: 1 },
	focus: { browDownLeft: 0.35, browDownRight: 0.35, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, mouthPressLeft: 0.3, mouthPressRight: 0.3 },
} );

/**
 * A preset as explicit per-shape values: the preset's own shapes, plus a 0 for every shape in `alsoClear`
 * (the shapes the track already drives) so the new expression REPLACES the previous one instead of stacking
 * on it. `neutral` is just "clear what is driven" — with nothing driven it expands to nothing.
 */
export function expandPreset( name, alsoClear = [] ) {

	if ( ! has( PRESETS, name ) ) fail( `unknown preset "${ name }" (${ Object.keys( PRESETS ).join( ', ' ) })` );

	const out = {};
	for ( const s of alsoClear ) out[ s ] = 0;
	for ( const [ s, v ] of Object.entries( PRESETS[ name ] ) ) out[ s ] = v;
	return out;

}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Events of one op on a track, sorted by arrival. */
export function keyEvents( track, op ) {

	const evs = ( track ? track.events : [] ).filter( e => e.op === op );
	return evs.sort( ( a, b ) => ( a.at + a.dur ) - ( b.at + b.dur ) || a.at - b.at );

}

/** `face 3/9 · 2.40s` — the label GUI and shell both show. */
export function keyLabel( op, index, count, time ) {

	return `${ op } ${ index + 1 }/${ count } · ${ time.toFixed( 2 ) }s`;

}

/** The keys as the shell and the GUI address them: index is 0-based, time is the ARRIVAL. */
export function keyList( track, op ) {

	const evs = keyEvents( track, op );

	return evs.map( ( e, index ) => {

		const time = r4( e.at + e.dur );
		const base = { index, id: e.id, time, duration: Math.round( e.dur * 1000 ), easing: e.args.easing || 'linear', label: keyLabel( op, index, evs.length, time ) };

		if ( op === FACE_OP ) return { ...base, shapes: { ...e.args.shapes }, hold: !! e.args.hold };
		return { ...base, target: Array.isArray( e.args.target ) ? e.args.target.slice() : e.args.target, head: e.args.head === undefined ? GAZE_DEFAULTS.head : e.args.head };

	} );

}

// ── Validation + writing ─────────────────────────────────────────────────────

function checkEasing( easing ) {

	if ( easing === undefined ) return;
	const ok = typeof easing === 'string' && ( [ 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out' ].includes( easing ) || /^cubic-bezier\(/.test( easing ) );
	if ( ! ok ) fail( `easing must be a CSS timing function ('linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(...)') — got ${ JSON.stringify( easing ) }` );

}

function checkTime( t, what = 'time' ) {

	if ( ! isNum( t ) || t < 0 ) fail( `${ what } must be a time in seconds >= 0` );

}

function checkDuration( ms ) {

	if ( ms === undefined ) return 0;
	if ( ! isNum( ms ) || ms < 0 ) fail( 'duration must be a number of milliseconds >= 0' );
	return ms / 1000;

}

export function checkShapes( shapes ) {

	if ( ! shapes || typeof shapes !== 'object' || Array.isArray( shapes ) || Object.keys( shapes ).length === 0 ) fail( 'shapes must be an object { shapeName: 0..1 } with at least one shape' );

	for ( const [ k, v ] of Object.entries( shapes ) ) {

		if ( ! isNum( v ) || v < 0 || v > 1 ) fail( `shape "${ k }" must be a number in 0..1` );

	}

}

export function checkTarget( target ) {

	if ( target === 'away' ) return;
	if ( typeof target === 'string' && target.length > 0 ) return;
	if ( Array.isArray( target ) && target.length === 3 && target.every( isNum ) ) return;
	fail( 'gaze target must be a selector like \'#f2\', a point [x, y, z], or \'away\'' );

}

// `time` is the arrival; the move starts `duration` earlier (clamped to the clock's start).
function placement( time, durationSeconds ) {

	const start = Math.max( 0, time - durationSeconds );
	return { at: r4( start ), dur: r4( time - start ) };

}

function makeArgs( op, spec ) {

	const args = {};

	if ( op === FACE_OP ) {

		checkShapes( spec.shapes );
		args.shapes = { ...spec.shapes };
		if ( spec.hold ) args.hold = true;

	} else {

		checkTarget( spec.target );
		args.target = Array.isArray( spec.target ) ? spec.target.slice() : spec.target;
		if ( spec.head !== undefined ) {

			if ( ! isNum( spec.head ) || spec.head < 0 || spec.head > 1 ) fail( 'gaze head weight must be a number in 0..1 (0 = eyes only, 1 = head does the turn)' );
			args.head = spec.head;

		}

	}

	checkEasing( spec.easing );
	if ( spec.easing && spec.easing !== 'linear' ) args.easing = spec.easing;
	return args;

}

let seq = 0;
const newId = () => 'k' + Date.now().toString( 36 ) + ( seq ++ ).toString( 36 );

/**
 * Add a key at `time` (arrival, seconds). A key already ARRIVING at that time (within KEY_EPS)
 * is merged: face keys union their shapes, gaze keys replace the target. Returns the key's index.
 */
export function upsertKey( track, op, spec ) {

	checkTime( spec.time );
	const dur = checkDuration( spec.duration );
	const args = makeArgs( op, spec );
	const evs = keyEvents( track, op );
	const hit = evs.find( e => Math.abs( e.at + e.dur - spec.time ) < KEY_EPS );

	if ( hit ) {

		if ( op === FACE_OP ) hit.args = { ...hit.args, ...args, shapes: { ...hit.args.shapes, ...args.shapes } };
		else hit.args = { ...hit.args, ...args };
		if ( spec.duration !== undefined ) Object.assign( hit, placement( spec.time, dur ) );

	} else {

		track.events.push( { id: newId(), op, ...placement( spec.time, dur ), args } );

	}

	return keyEvents( track, op ).findIndex( e => Math.abs( e.at + e.dur - spec.time ) < KEY_EPS );

}

/** Change key `index`: any of { time, duration, easing, shapes | target, head, hold }. Shapes REPLACE the key's shapes. */
export function moveKey( track, op, index, patch ) {

	const evs = keyEvents( track, op );
	const e = evs[ index ];
	if ( ! e ) fail( `${ op } key ${ index } does not exist (${ evs.length } keys)`, 'NO_KEY' );

	const spec = { easing: e.args.easing, ...( op === FACE_OP ? { shapes: e.args.shapes, hold: e.args.hold } : { target: e.args.target, head: e.args.head } ), ...patch };
	const args = makeArgs( op, spec );
	const time = patch.time !== undefined ? patch.time : e.at + e.dur;
	checkTime( time );
	const dur = patch.duration !== undefined ? checkDuration( patch.duration ) : e.dur;

	e.args = args;
	Object.assign( e, placement( time, dur ) );
	return keyEvents( track, op ).indexOf( e );

}

export function deleteKey( track, op, index ) {

	const evs = keyEvents( track, op );
	const e = evs[ index ];
	if ( ! e ) fail( `${ op } key ${ index } does not exist (${ evs.length } keys)`, 'NO_KEY' );
	track.events.splice( track.events.indexOf( e ), 1 );
	return true;

}

/** Names of every shape the track's face keys drive. */
export function drivenShapes( track ) {

	const out = new Set();
	for ( const e of keyEvents( track, FACE_OP ) ) for ( const s of Object.keys( e.args.shapes || {} ) ) out.add( s );
	return [ ...out ].sort();

}

/** The command that rebuilds a track's face + gaze exactly. Paste it back to restore it. */
export function toCommand( track, selector ) {

	const f = n => Math.round( n * 1e4 ) / 1e4;
	const lines = [];

	for ( const k of keyList( track, FACE_OP ) ) {

		const shapes = Object.entries( k.shapes ).map( ( [ s, v ] ) => `${ s }: ${ f( v ) }` ).join( ', ' );
		const opts = [ `shapes: { ${ shapes } }` ];
		if ( k.duration ) opts.push( `duration: ${ k.duration }` );
		if ( k.easing && k.easing !== 'linear' ) opts.push( `easing: '${ k.easing }'` );
		if ( k.hold ) opts.push( 'hold: true' );
		lines.push( `.face.keyAt(${ f( k.time ) }, { ${ opts.join( ', ' ) } })` );

	}

	for ( const k of keyList( track, GAZE_OP ) ) {

		const t = Array.isArray( k.target ) ? `[${ k.target.map( f ).join( ', ' ) }]` : `'${ k.target }'`;
		const opts = [];
		if ( k.duration ) opts.push( `duration: ${ k.duration }` );
		if ( k.easing && k.easing !== 'linear' ) opts.push( `easing: '${ k.easing }'` );
		if ( k.head !== GAZE_DEFAULTS.head ) opts.push( `head: ${ f( k.head ) }` );
		lines.push( `.gaze(${ f( k.time ) }, ${ t }${ opts.length ? `, { ${ opts.join( ', ' ) } }` : '' })` );

	}

	return lines.map( l => `$S('${ selector }')${ l };` ).join( '\n' );

}

/** `$S('#f1').face.idle({ … })` — the idle layer's settings as a command (only what differs from the defaults, plus the seed). */
export function idleCommand( selector, idle ) {

	const d = IDLE_DEFAULTS, parts = [];
	for ( const k of [ 'blink', 'breath', 'gazeNoise' ] ) if ( idle[ k ] !== d[ k ] ) parts.push( `${ k }: ${ idle[ k ] }` );
	parts.push( `seed: ${ idle.seed }` );
	if ( idle.blinkInterval.join() !== d.blinkInterval.join() ) parts.push( `blinkInterval: [${ idle.blinkInterval.join( ', ' ) }]` );
	return `$S('${ selector }').face.idle({ ${ parts.join( ', ' ) } });`;

}

// ── Sampling: authored expression ────────────────────────────────────────────

function segmentsFor( keys ) {

	// per shape: ordered segments { t0, t1, v0, v1, ease }; v0 is where the shape actually is at t0
	const byShape = new Map();

	const valueAt = ( segs, T ) => {

		let seg = null;
		for ( const s of segs ) if ( s.t0 <= T ) seg = s;
		if ( ! seg ) return null;
		if ( T >= seg.t1 ) return seg.v1;
		return seg.v0 + ( seg.v1 - seg.v0 ) * seg.ease( ( T - seg.t0 ) / ( seg.t1 - seg.t0 ) );

	};

	for ( const e of keys ) {

		const ease = cssEasingFunction( e.args.easing );

		for ( const [ s, v ] of Object.entries( e.args.shapes || {} ) ) {

			const segs = byShape.get( s ) || [];
			const t0 = e.at, t1 = e.at + e.dur;
			const prev = segs.length ? valueAt( segs, t0 ) : null;
			segs.push( { t0, t1, v0: prev === null ? 0 : prev, v1: v, ease } );
			byShape.set( s, segs );

		}

	}

	return { byShape, valueAt };

}

/**
 * Authored shape values at time T: Map shape -> 0..1, only for shapes the keys drive and have
 * started driving by T. Deterministic: same keys, same T, same numbers.
 */
export function evalShapes( keys, T ) {

	const { byShape, valueAt } = segmentsFor( keys );
	const out = new Map();

	for ( const [ shape, segs ] of byShape ) {

		const v = valueAt( segs, T );
		if ( v !== null ) out.set( shape, v );

	}

	return out;

}

/** Compile a key list once and sample it many times (the export bake). */
export function shapeSampler( keys ) {

	const { byShape, valueAt } = segmentsFor( keys );

	return ( T ) => {

		const out = new Map();
		for ( const [ shape, segs ] of byShape ) {

			const v = valueAt( segs, T );
			if ( v !== null ) out.set( shape, v );

		}

		return out;

	};

}

/** Time intervals [from, to) of held authored beats: from a `hold` key's arrival to the next key's start. */
export function heldBeats( keys ) {

	const out = [];

	keys.forEach( ( e, i ) => {

		if ( ! e.args.hold ) return;
		const next = keys[ i + 1 ];
		out.push( [ e.at + e.dur, next ? next.at : Infinity ] );

	} );

	return out;

}

// ── Sampling: gaze ───────────────────────────────────────────────────────────

/**
 * Where the gaze channel is at T: { from, to, eye, head, headWeight } — `from`/`to` are the previous
 * and current targets (null = looking straight ahead), `eye`/`head` the 0..1 progress of each.
 * The head starts later and takes longer, so the eyes lead and the head lags. null before the first key.
 */
export function evalGaze( keys, T ) {

	let i = - 1;
	for ( let k = 0; k < keys.length; k ++ ) if ( keys[ k ].at <= T ) i = k;
	if ( i < 0 ) return null;

	const k = keys[ i ];
	const ease = cssEasingFunction( k.args.easing );
	const head = k.args.head === undefined ? GAZE_DEFAULTS.head : k.args.head;
	const eyeU = k.dur > 0 ? clamp( ( T - k.at ) / k.dur, 0, 1 ) : 1;
	const headDur = k.dur * ( 1 + GAZE_DEFAULTS.headLag );
	const headU = k.dur > 0 ? clamp( ( T - k.at - GAZE_DEFAULTS.headDelay ) / headDur, 0, 1 ) : ( T - k.at >= GAZE_DEFAULTS.headDelay ? 1 : 0 );

	return {
		from: i > 0 ? keys[ i - 1 ].args.target : null,
		to: k.args.target,
		eye: ease( eyeU ),
		head: ease( headU ),
		headWeight: head,
	};

}

/**
 * Split a total aim angle between head and eyes, one axis. The head takes `wHead` of it, plus
 * whatever the eyes cannot reach (so past the anatomical limit the head turns instead of the
 * eyes rolling into their sockets). eyeLo/eyeHi are the eye limits on this axis (radians).
 */
export function splitAxis( A, wHead, eyeLo, eyeHi, headMax ) {

	let H = A * wHead;
	const eyeNeeded = A - H;

	if ( eyeNeeded > eyeHi ) H = A - eyeHi;
	else if ( eyeNeeded < eyeLo ) H = A - eyeLo;

	H = clamp( H, - headMax, headMax );
	return { head: H, eye: clamp( A - H, eyeLo, eyeHi ) };

}

/**
 * Head and eye angles for one gaze sample. `aimFrom` / `aimTo` are { yaw, pitch } in the head frame
 * (null = straight ahead). Eyes follow `eye` progress, the head its own later, slower progress;
 * the eyes then take what the head hasn't, clamped to their range.
 * Yaw is positive toward the character's LEFT, pitch positive UP (radians).
 */
export function resolveAim( g, aimFrom, aimTo, noise = null ) {

	const L = GAZE_LIMITS;
	const a0 = aimFrom || { yaw: 0, pitch: 0 }, a1 = aimTo || { yaw: 0, pitch: 0 };
	const mix = ( u ) => ( { yaw: a0.yaw + ( a1.yaw - a0.yaw ) * u, pitch: a0.pitch + ( a1.pitch - a0.pitch ) * u } );
	const aEye = mix( g.eye ), aHead = mix( g.head );

	const hy = splitAxis( aHead.yaw, g.headWeight, - L.eyeYaw, L.eyeYaw, L.headYaw ).head;
	const hp = splitAxis( aHead.pitch, g.headWeight, - L.eyeDown, L.eyeUp, L.headPitch ).head;

	let ey = clamp( aEye.yaw - hy, - L.eyeYaw, L.eyeYaw );
	let ep = clamp( aEye.pitch - hp, - L.eyeDown, L.eyeUp );

	if ( noise ) { ey = clamp( ey + noise.yaw, - L.eyeYaw, L.eyeYaw ); ep = clamp( ep + noise.pitch, - L.eyeDown, L.eyeUp ); }

	return { head: { yaw: hy, pitch: hp }, eye: { yaw: ey, pitch: ep } };

}

// ── Idle layer (seeded, deterministic, an underlayer — never baked into keys) ─

export const IDLE_DEFAULTS = Object.freeze( {
	blink: true,
	breath: true,
	gazeNoise: true,
	seed: 1,
	blinkInterval: [ 2, 6 ], // seconds between blinks, uniform in this range
	blinkDuration: 0.24, // close ~1/3, open ~2/3
	breathPeriod: 4.2,
	breathAmount: 0.015, // jawOpen weight at the top of a breath
	noiseAmount: 0.012, // radians (~0.7 deg)
} );

/** Normalise `.idle(opts)` input. `false` turns the layer off; `true` / undefined means the defaults. */
export function normalizeIdle( opts ) {

	if ( opts === false || opts === null ) return null;
	const o = opts === true || opts === undefined ? {} : opts;
	if ( typeof o !== 'object' || Array.isArray( o ) ) fail( 'idle(): expected true, false or { blink, breath, gazeNoise, seed }' );

	const out = { ...IDLE_DEFAULTS };

	for ( const k of [ 'blink', 'breath', 'gazeNoise' ] ) if ( o[ k ] !== undefined ) out[ k ] = !! o[ k ];
	if ( o.seed !== undefined ) { if ( ! Number.isInteger( o.seed ) ) fail( 'idle(): seed must be an integer' ); out.seed = o.seed; }

	if ( o.blinkInterval !== undefined ) {

		const b = o.blinkInterval;
		if ( ! Array.isArray( b ) || b.length !== 2 || ! b.every( isNum ) || b[ 0 ] <= 0.3 || b[ 1 ] < b[ 0 ] ) fail( 'idle(): blinkInterval must be [min, max] seconds, min > 0.3' );
		out.blinkInterval = b.slice();

	}

	return out;

}

// mulberry32: a tiny, well-known seeded PRNG — the same seed gives the same stream on every machine.
function mulberry32( a ) {

	return function () {

		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul( a ^ a >>> 15, 1 | a );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

function hashString( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 16777619 ); }
	return h >>> 0;

}

const blinkCache = new Map();

/** Start times of the idle blinks up to `horizon` seconds. Same (seed, id, interval) -> same list, every run. */
export function blinkTimes( idle, id, horizon ) {

	const key = `${ idle.seed }|${ id }|${ idle.blinkInterval.join( ',' ) }`;
	let st = blinkCache.get( key );

	if ( ! st ) {

		const rnd = mulberry32( ( idle.seed * 2654435761 ) ^ hashString( id ) );
		st = { rnd, times: [], next: 0.6 + rnd() * 1.5 };
		blinkCache.set( key, st );

	}

	const [ lo, hi ] = idle.blinkInterval;

	while ( st.next <= horizon + idle.blinkDuration ) {

		st.times.push( r4( st.next ) );
		st.next += lo + st.rnd() * ( hi - lo );

	}

	return st.times;

}

const smooth = k => k * k * ( 3 - 2 * k );

/** Blink closure 0..1 at T: 0 while open, 1 fully closed. */
export function blinkWeight( idle, id, T, held = [] ) {

	const d = idle.blinkDuration;
	const times = blinkTimes( idle, id, T );

	for ( let i = times.length - 1; i >= 0; i -- ) {

		const s = times[ i ];
		if ( s > T ) continue;
		if ( T >= s + d ) return 0;
		if ( held.some( ( [ a, b ] ) => s >= a && s < b ) ) return 0; // a held beat owns the face: no blink fires inside it
		const p = ( T - s ) / d;
		return p < 1 / 3 ? smooth( p * 3 ) : 1 - smooth( ( p - 1 / 3 ) / ( 2 / 3 ) );

	}

	return 0;

}

function phases( idle, id ) {

	const rnd = mulberry32( ( idle.seed * 40503 ) ^ hashString( id + ':phase' ) );
	return [ rnd() * 6.2832, rnd() * 6.2832, rnd() * 6.2832, rnd() * 6.2832 ];

}

/** Idle shape weights at T (additive, small): blink on both eyes, a faint breath on the jaw. */
export function idleShapes( idle, id, T, held = [] ) {

	const out = new Map();
	if ( ! idle ) return out;

	if ( idle.blink ) {

		const w = blinkWeight( idle, id, T, held );
		out.set( 'eyeBlinkLeft', w );
		out.set( 'eyeBlinkRight', w );

	}

	if ( idle.breath ) {

		const ph = phases( idle, id )[ 0 ];
		out.set( 'jawOpen', idle.breathAmount * ( 0.5 + 0.5 * Math.sin( 6.2832 * T / idle.breathPeriod + ph ) ) );

	}

	return out;

}

/** Low-amplitude gaze micro-movement { yaw, pitch } at T: smooth, seeded, a pure function of T. */
export function gazeNoise( idle, id, T, held = [] ) {

	if ( ! idle || ! idle.gazeNoise ) return null;
	if ( held.some( ( [ a, b ] ) => T >= a && T < b ) ) return { yaw: 0, pitch: 0 }; // still beat: eyes hold

	const ph = phases( idle, id );
	const a = idle.noiseAmount;
	return {
		yaw: a * ( 0.6 * Math.sin( 1.7 * T + ph[ 1 ] ) + 0.4 * Math.sin( 4.3 * T + ph[ 2 ] ) ),
		pitch: a * ( 0.6 * Math.sin( 1.3 * T + ph[ 3 ] ) + 0.4 * Math.sin( 3.7 * T + ph[ 0 ] ) ),
	};

}

// ── Layering ─────────────────────────────────────────────────────────────────

/**
 * The precedence rule, in one place: idle < authored < viseme. A higher layer SUPPRESSES the lower
 * ones on the shapes it drives; elsewhere layers add (clamped to 0..1).
 *
 *   base       Map shape -> weight the rig has when no layer touches it (the customizer's static pose)
 *   idle       Map shape -> additive weight
 *   authored   Map shape -> absolute weight (only shapes the keys drive)
 *   viseme     Map shape -> absolute weight (audio-derived; LOGGED, NOT BUILT — always empty today)
 *   clipDriven Set of shapes a baked body clip already animates: the clip owns them against idle
 *              (authored still wins — it is the higher layer)
 *
 * Returns Map shape -> final weight, for every shape any layer touches.
 */
export function composeShapes( { base = new Map(), idle = new Map(), authored = new Map(), viseme = new Map(), clipDriven = new Set() } ) {

	const out = new Map();
	const names = new Set( [ ...idle.keys(), ...authored.keys(), ...viseme.keys() ] );

	for ( const s of names ) {

		if ( viseme.has( s ) ) { out.set( s, clamp( viseme.get( s ), 0, 1 ) ); continue; }
		if ( authored.has( s ) ) { out.set( s, clamp( authored.get( s ), 0, 1 ) ); continue; }
		if ( clipDriven.has( s ) ) continue;
		out.set( s, clamp( ( base.get( s ) || 0 ) + idle.get( s ), 0, 1 ) );

	}

	return out;

}
