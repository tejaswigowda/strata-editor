// timelineView.js: the arithmetic behind the Animations tab's zoomable time axis, snapping and multi-select.
// Pure (no DOM, no editor) so the panel and the node test share one definition.
//
// A VIEW is { start, span } in seconds: the left edge of the lane and how much time it shows. The lane maps
// time to pixels as  px = (t - start) / span * laneWidth.

export const MIN_SPAN = 0.05; // seconds: the closest the lane zooms in
const STEPS = [ 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600 ];
const MINOR = { 2: 0.5, 15: 5, 30: 10, 60: 10, 120: 30, 300: 60, 600: 120, 1800: 300, 3600: 600 }; // otherwise a fifth of the step

const round = ( v, n = 1e6 ) => Math.round( v * n ) / n;

/** Keep a view inside [0, total] with a span between MIN_SPAN and total. */
export function clampView( start, span, total, minSpan = MIN_SPAN ) {

	const s = Math.min( Math.max( Number.isFinite( span ) ? span : total, Math.min( minSpan, total ) ), total );
	return { start: Math.min( Math.max( 0, Number.isFinite( start ) ? start : 0 ), Math.max( 0, total - s ) ), span: s };

}

/** Zoom by `factor` (>1 zooms in) keeping the time under `anchorFrac` (0..1 across the lane) where it is. */
export function zoomView( view, total, factor, anchorFrac ) {

	const anchor = view.start + anchorFrac * view.span;
	const span = Math.min( Math.max( view.span / factor, Math.min( MIN_SPAN, total ) ), total );
	return clampView( anchor - anchorFrac * span, span, total );

}

/** Shift a view by `dt` seconds. */
export function panView( view, total, dt ) {

	return clampView( view.start + dt, view.span, total );

}

/** Smallest "nice" step (1, 2, 5, 15 s ...) that is at least `minSeconds`. */
export function niceStep( minSeconds ) {

	return STEPS.find( s => s >= minSeconds - 1e-12 ) || STEPS[ STEPS.length - 1 ];

}

/**
 * Ruler ticks for the visible range. Majors (labelled) are at least `labelPx` apart; minors are drawn
 * only when at least `minorPx` apart. Only ticks inside the view are returned.
 * @returns {{ step: number, ticks: { t: number, major: boolean }[] }}
 */
export function rulerTicks( start, span, laneW, { labelPx = 64, minorPx = 8 } = {} ) {

	const pxPerSec = Math.max( 1e-9, laneW ) / Math.max( 1e-9, span );
	const step = niceStep( labelPx / pxPerSec );
	const minor = MINOR[ step ] || step / 5;
	const per = Math.round( step / minor );
	const unit = minor * pxPerSec >= minorPx ? minor : step;
	const every = unit === step ? 1 : per; // grid ticks between majors
	const ticks = [];
	const first = Math.ceil( start / unit - 1e-9 );
	for ( let n = first; n * unit <= start + span + 1e-9; n ++ ) ticks.push( { t: round( n * unit ), major: n % every === 0 } );
	return { step, ticks };

}

/** Sorted, de-duplicated times to snap to; `nearest( t, maxDist )` -> the closest within maxDist, or null. */
export function makeSnapper( times ) {

	const a = [ ...new Set( times.filter( Number.isFinite ).map( t => Math.round( t * 1000 ) ) ) ].sort( ( x, y ) => x - y ).map( x => x / 1000 );
	return {
		times: a,
		nearest( t, maxDist ) {

			let lo = 0, hi = a.length - 1, best = null;
			while ( lo <= hi ) {

				const mid = ( lo + hi ) >> 1;
				if ( a[ mid ] < t ) lo = mid + 1; else hi = mid - 1;

			}
			for ( const i of [ lo - 1, lo ] ) if ( i >= 0 && i < a.length && Math.abs( a[ i ] - t ) <= maxDist && ( best === null || Math.abs( a[ i ] - t ) < Math.abs( best - t ) ) ) best = a[ i ];
			return best;

		},
	};

}

/** Snap a block being moved: its start or its end, whichever is closer to a target. */
export function snapMove( snapper, start, dur, maxDist ) {

	const a = snapper.nearest( start, maxDist ), b = snapper.nearest( start + dur, maxDist );
	if ( a === null && b === null ) return { start, guide: null };
	if ( b === null || ( a !== null && Math.abs( a - start ) <= Math.abs( b - start - dur ) ) ) return { start: a, guide: a };
	return { start: b - dur, guide: b };

}

/** Snap a single edge (the end of a block being resized). */
export function snapEdge( snapper, t, maxDist ) {

	const s = snapper.nearest( t, maxDist );
	return s === null ? { time: t, guide: null } : { time: s, guide: s };

}

/** Ids between `a` and `b` inclusive in `ordered`; just [b] when `a` is not in the list. */
export function rangeIds( ordered, a, b ) {

	const i = ordered.indexOf( a ), j = ordered.indexOf( b );
	if ( j === - 1 ) return [];
	if ( i === - 1 ) return [ b ];
	return ordered.slice( Math.min( i, j ), Math.max( i, j ) + 1 );

}

/** `ids` with `id` added, or removed when it is already there. */
export function toggleId( ids, id ) {

	return ids.includes( id ) ? ids.filter( x => x !== id ) : [ ...ids, id ];

}

/** Does [at, at+dur] overlap the view (plus `pad` seconds each side)? */
export function inView( at, dur, start, span, pad = 0 ) {

	return at + dur >= start - pad && at <= start + span + pad;

}
