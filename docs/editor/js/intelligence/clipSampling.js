// ── clipSampling.js ───────────────────────────────────────────────────────────
// Pure (no THREE, no DOM — node-testable) clip-control semantics: given a clip
// duration, its authored play/pause/stop/seek events and a global time, what
// clip-local time and blend weight apply? See clipDirectives.js for how events
// are resolved onto clips.

export const PLAY_DEFAULTS = Object.freeze( { loop: false, speed: 1, weight: 1, fade: 0, clampWhenFinished: true } );

const clamp = ( v, lo, hi ) => Math.min( hi, Math.max( lo, v ) );

/**
 * Clip-local time + blend weight at global time `t`.
 *
 * Semantics (all deterministic, so scrub order never matters):
 *  - no directive            -> auto-play: local = clamp(t), weight 1
 *  - before the first `play` -> hold the clip's first frame (what native
 *                               keyframes do before their first key)
 *  - `play`                  -> starts at `at`, runs at `speed` (negative plays
 *                               backward), `loop` wraps, otherwise holds the
 *                               last frame (or releases to the rest pose when
 *                               clampWhenFinished is false)
 *  - `pause`                 -> freezes local time; a later `play` restarts
 *  - `stop`                  -> rewinds to the first frame and holds
 *  - `seek`                  -> jumps local time, keeps the running/paused state
 *  - `fade` (seconds)        -> ease-in of the weight over [at, at + fade]
 *
 * @param {{duration:number}} clip
 * @param {Array<{at:number, op:string, args:object}>} events  sorted by `at`
 * @param {number} t
 * @returns {{ local:number, weight:number }}
 */
export function sampleClipState( clip, events, t ) {

	const dur = clip.duration;
	if ( ! ( dur > 0 ) ) return { local: 0, weight: 1 };

	const plays = events.filter( e => e.op === 'play' );
	if ( plays.length === 0 ) return { local: clamp( t, 0, dur ), weight: 1 };

	let P = null;
	for ( const e of plays ) { if ( e.at <= t ) P = e; }
	if ( ! P ) return { local: 0, weight: 1 };

	const o = { ...PLAY_DEFAULTS, ...P.args };
	const speed = Number.isFinite( Number( o.speed ) ) && Number( o.speed ) !== 0 ? Number( o.speed ) : 1;

	const norm = ( v ) => o.loop ? ( ( v % dur ) + dur ) % dur : clamp( v, 0, dur );

	let local = speed < 0 ? dur : 0;
	let running = true;
	let last = P.at;

	const advance = ( to ) => {

		if ( running && to > last ) local = norm( local + speed * ( to - last ) );
		last = Math.max( last, to );

	};

	for ( const e of events ) {

		if ( e.op === 'play' || e.at < P.at || e.at > t ) continue;
		advance( e.at );

		if ( e.op === 'pause' ) running = false;
		else if ( e.op === 'stop' ) { running = false; local = 0; }
		else if ( e.op === 'seek' ) local = clamp( Number( e.args.time ) || 0, 0, dur );

	}

	const ranToEnd = running && ! o.loop && ( speed > 0 ? local + speed * ( t - last ) >= dur : local + speed * ( t - last ) <= 0 );
	advance( t );

	let weight = Math.max( 0, Number( o.weight ) );
	if ( ! Number.isFinite( weight ) ) weight = 1;

	const fade = Math.max( 0, Number( o.fade ) || 0 );
	if ( fade > 0 ) {

		const k = clamp( ( t - P.at ) / fade, 0, 1 );
		weight *= k * k * ( 3 - 2 * k );

	}

	if ( ranToEnd && o.clampWhenFinished === false ) weight = 0;

	return { local, weight };

}
