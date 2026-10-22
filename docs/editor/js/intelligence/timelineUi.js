// timelineUi.js: the pure logic behind the Animations tab's polish: track kinds and icons, key navigation,
// the mini-map, the snap grid, shot markers and the hover card. No DOM, no editor, no three.js, so the panel
// and the node test share one definition (the zoom / snap arithmetic itself is in timelineView.js).

import { clampView, rulerTicks } from './timelineView.js';

// ── Track kinds ───────────────────────────────────────────────────────────────

export const TRACK_KINDS = [ 'camera', 'character', 'prop', 'light', 'group', 'other' ];

const MAX_WALK = 5000; // a bound for the skinned-mesh search in a huge import

function hasSkinned( object ) {

	let seen = 0;
	const stack = [ object ];
	while ( stack.length && seen < MAX_WALK ) {

		const o = stack.pop();
		seen ++;
		if ( o.isSkinnedMesh ) return true;
		if ( o.children ) for ( const c of o.children ) stack.push( c );

	}
	return false;

}

/** Kind of a scene object: camera, light, character (skinned, or a VRM / body), group, prop (a drawable) or other. */
export function classifyObject( object ) {

	if ( ! object ) return null;
	if ( object.isCamera ) return 'camera';
	if ( object.isLight ) return 'light';
	const ud = object.userData || {};
	if ( ud.vrm || ud.body || ud.humanoid || object.isSkinnedMesh || hasSkinned( object ) ) return 'character';
	if ( object.isMesh || object.isPoints || object.isLine || object.isSprite ) return 'prop';
	if ( ( object.children || [] ).length > 0 ) return 'group';
	return 'other';

}

const poseOf = args => ( args && args.props && typeof args.props === 'object' ? args.props : args ) || {};

/** Does this event steer a camera (an aim point or a field of view)? */
function eventLooksLikeCamera( e ) {

	const p = poseOf( e.args );
	return p.fov !== undefined || p.lookAt !== undefined || ( p.to && typeof p.to === 'object' && ( p.to.fov !== undefined || p.to.lookAt !== undefined ) );

}

/**
 * Kind of a track: from the object its selector resolves to, else from what its events do.
 * @param {{ target: string, events: object[] }} track
 * @param {object|null} object   the first scene object the selector resolves to
 * @param {string|null} [objectKind]   that object's kind when already known (a cache), instead of classifying `object`
 */
export function classifyTrack( track, object, objectKind ) {

	const events = track.events || [];
	if ( events.some( e => e.args && e.args.group ) ) return 'group';
	const byObject = objectKind !== undefined ? objectKind : classifyObject( object );
	if ( byObject ) return byObject;
	if ( /^#?camera$/i.test( track.target || '' ) || events.some( eventLooksLikeCamera ) ) return 'camera';
	return 'other';

}

const SVG = body => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ body }</svg>`;

export const KIND_ICONS = {
	camera: SVG( '<path d="M3 8h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><path d="M15 11l6-3v8l-6-3"/>' ),
	character: SVG( '<circle cx="12" cy="6" r="3"/><path d="M5 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3"/>' ),
	prop: SVG( '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>' ),
	light: SVG( '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>' ),
	group: SVG( '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h4a2 2 0 0 1 2 2v4"/>' ),
	other: SVG( '<circle cx="12" cy="12" r="4"/>' ),
	clip: SVG( '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/>' ),
};

// ── Key navigation ────────────────────────────────────────────────────────────

const T_EPS = 0.0005;

/** Sorted, de-duplicated times (ms precision) of every block edge on the given tracks: where a key lands. */
export function keyTimes( tracks ) {

	const set = new Set();
	for ( const t of tracks ) for ( const e of t.events || [] ) {

		set.add( Math.round( e.at * 1000 ) );
		set.add( Math.round( ( e.at + ( e.dur || 0 ) ) * 1000 ) );

	}
	return [ ...set ].filter( Number.isFinite ).sort( ( a, b ) => a - b ).map( x => x / 1000 );

}

/** The nearest key time before `t` (strictly), or null. `times` is sorted. */
export function prevKeyTime( times, t ) {

	for ( let i = times.length - 1; i >= 0; i -- ) if ( times[ i ] < t - T_EPS ) return times[ i ];
	return null;

}

/** The nearest key time after `t` (strictly), or null. `times` is sorted. */
export function nextKeyTime( times, t ) {

	for ( const x of times ) if ( x > t + T_EPS ) return x;
	return null;

}

// ── Mini-map ──────────────────────────────────────────────────────────────────

/** How many event blocks overlap each of `bins` equal slices of [0, total]: [ count, ... ]. */
export function densityBins( events, total, bins ) {

	const out = new Array( Math.max( 0, bins ) ).fill( 0 );
	if ( ! ( total > 0 ) || bins < 1 ) return out;
	const diff = new Array( bins + 1 ).fill( 0 );
	for ( const e of events ) {

		const a = Math.min( bins - 1, Math.max( 0, Math.floor( ( e.at / total ) * bins ) ) );
		const b = Math.min( bins - 1, Math.max( a, Math.floor( ( ( e.at + ( e.dur || 0 ) ) / total ) * bins ) ) );
		diff[ a ] ++;
		diff[ b + 1 ] --;

	}
	let run = 0;
	for ( let i = 0; i < bins; i ++ ) { run += diff[ i ]; out[ i ] = run; }
	return out;

}

/** The view window drawn on a mini-map `width` px wide: { left, width } (never narrower than `minPx`). */
export function miniMapWindow( view, total, width, minPx = 8 ) {

	if ( ! ( total > 0 ) ) return { left: 0, width };
	const w = Math.min( width, Math.max( minPx, ( view.span / total ) * width ) );
	const left = Math.min( Math.max( 0, ( view.start / total ) * width ), width - w );
	return { left, width: w };

}

/** The view after dragging the mini-map's window so its left edge is at `leftPx` (same span). */
export function miniMapDragView( view, total, width, leftPx ) {

	return clampView( ( leftPx / width ) * total, view.span, total );

}

/** The view after clicking the mini-map at `px`: the same span, centred there. */
export function miniMapCenterView( view, total, width, px ) {

	return clampView( ( px / width ) * total - view.span / 2, view.span, total );

}

// ── Snap grid ─────────────────────────────────────────────────────────────────

/** The grid step in seconds: the spacing of the ruler's smallest visible ticks for this zoom. */
export function gridUnit( span, laneW ) {

	const { ticks } = rulerTicks( 0, span, laneW );
	return ticks.length > 1 ? Math.round( ( ticks[ 1 ].t - ticks[ 0 ].t ) * 1e6 ) / 1e6 : 1;

}

/** Nearest grid line to `t`. */
export function snapToGrid( t, unit ) {

	return Math.round( Math.round( t / unit ) * unit * 1e6 ) / 1e6;

}

/** Snap a moving block to the grid by its start or its end, whichever has the smaller shift. Returns the new start. */
export function snapMoveToGrid( start, dur, unit ) {

	const a = snapToGrid( start, unit ), b = snapToGrid( start + dur, unit ) - dur;
	return Math.abs( a - start ) <= Math.abs( b - start ) ? a : b;

}

/** CSS for the grid overlay on a lane: lines every `unit` seconds, through the view { start, span } over `laneW` px; null when too dense to be useful. */
export function gridBackground( view, unit, laneW, minPx = 5 ) {

	const px = ( unit / view.span ) * laneW;
	if ( ! ( px >= minPx ) ) return null;
	const first = ( Math.ceil( view.start / unit - 1e-9 ) * unit - view.start ) / view.span * laneW;
	return { size: px, offset: first };

}

// ── Shot markers ──────────────────────────────────────────────────────────────

/**
 * Where a camera track's shots start: the Camera Sequence shots that use this camera (labelled S1, S2 ... by their
 * place in the whole sequence), else the track's first key.
 * @param {{ at: number }[]} shots        the sequence (any order)
 * @param {(shot: object) => boolean} usesTrack   does the shot's camera own this track?
 * @param {number|null} firstAt        time of the track's first event
 */
export function shotMarkers( shots, usesTrack, firstAt ) {

	const sorted = ( shots || [] ).filter( s => s && Number.isFinite( s.at ) ).sort( ( a, b ) => a.at - b.at );
	const out = [];
	sorted.forEach( ( s, i ) => { if ( usesTrack( s ) ) out.push( { t: s.at, label: 'S' + ( i + 1 ) } ); } );
	if ( out.length === 0 && Number.isFinite( firstAt ) ) out.push( { t: firstAt, label: 'start' } );
	return out;

}

// ── Hover card ────────────────────────────────────────────────────────────────

const num = v => ( Math.round( v * 100 ) / 100 ).toString();

function fmtValue( v ) {

	if ( typeof v === 'number' ) return Number.isFinite( v ) ? num( v ) : String( v );
	if ( Array.isArray( v ) ) return '[' + v.slice( 0, 4 ).map( fmtValue ).join( ', ' ) + ( v.length > 4 ? ', ...' : '' ) + ']';
	if ( v && typeof v === 'object' ) return '{...}';
	return String( v );

}

/** The pose an `animate` event arrives at, as short "name value" strings: at most `max`, then "+N more". */
export function poseSummary( args, max = 4 ) {

	const props = args && args.props && typeof args.props === 'object' ? args.props : null;
	if ( ! props ) return [];
	const flat = [];
	for ( const [ k, v ] of Object.entries( props ) ) {

		if ( k === 'to' && v && typeof v === 'object' && ! Array.isArray( v ) ) for ( const [ k2, v2 ] of Object.entries( v ) ) flat.push( [ k2, v2 ] );
		else flat.push( [ k, v ] );

	}
	const lines = flat.slice( 0, max ).map( ( [ k, v ] ) => `${ k } ${ fmtValue( v ) }` );
	if ( flat.length > max ) lines.push( `+${ flat.length - max } more` );
	return lines;

}

/**
 * The content of a block's hover card.
 * @param {{ at: number, dur: number, op: string, args?: object }} ev
 * @param {{ group?: { id: string, broken?: boolean }|null, target?: string }} [ctx]
 * @returns {{ title: string, range: string, lines: string[] }}
 */
export function tooltipModel( ev, ctx = {} ) {

	const dur = ev.dur || 0, end = ev.at + dur;
	const range = `${ num( ev.at ) }s \u2013 ${ num( end ) }s \u00b7 ${ num( dur ) }s`;
	const lines = [];
	let title = ev.op;
	if ( ctx.group ) {

		title = `${ ctx.group.id } (performance group)`;
		lines.push( ctx.group.broken ? 'registration BROKEN' : 'registered pair: moves as one unit' );

	} else if ( ev.op === 'animate' ) lines.push( ...poseSummary( ev.args ) );
	else if ( ev.op === 'face' || ev.op === 'gaze' ) lines.push( `a key arriving at ${ num( end ) }s` + ( ev.args && ev.args.easing ? `, ${ ev.args.easing }` : '' ) );
	else if ( ev.args && typeof ev.args.text === 'string' && ev.args.text ) lines.push( JSON.stringify( ev.args.text.slice( 0, 40 ) ) );
	else if ( ev.args && ev.args.target && typeof ev.args.target === 'string' ) lines.push( '\u2192 ' + ev.args.target );
	if ( ctx.target ) lines.unshift( ctx.target );
	return { title, range, lines };

}

/**
 * Where to put a card of `size` near the pointer so it is fully inside the window: below right of the pointer,
 * flipped to the left / above when that would leave the window, then clamped.
 */
export function placeTip( pointer, size, win, margin = 8, offset = 14 ) {

	let left = pointer.x + offset, top = pointer.y + offset;
	if ( left + size.w > win.w - margin ) left = pointer.x - offset - size.w;
	if ( top + size.h > win.h - margin ) top = pointer.y - offset - size.h;
	left = Math.min( Math.max( margin, left ), Math.max( margin, win.w - size.w - margin ) );
	top = Math.min( Math.max( margin, top ), Math.max( margin, win.h - size.h - margin ) );
	return { left: Math.round( left ), top: Math.round( top ) };

}
