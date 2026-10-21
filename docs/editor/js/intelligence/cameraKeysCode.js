// cameraKeysCode.js: dense camera tracks as ONE `setKeys` statement in the Animations tab's code panel.
// A baked move (a key every 0.1 s) would otherwise print hundreds of `.at(..).animate(..)` lines.
// Pure (no DOM, no editor) so the panel and the node test share one definition of the round trip:
//   collapseCameraKeys()  events -> statement text        (refreshCode)
//   parseSetKeys() + eventsFromSetKeys()  text -> events  (parseAndApplyCode, on Save)
//
// A track is only collapsed when the statement rebuilds the same move: every key keeps its pose, easing and
// arrival time exactly, and a leg may only start up to SLACK later or earlier than before (some bakers start
// a leg the instant the previous key arrives, setKeys leaves 1 ms). After one save the text is a fixed point.

import { cameraKeys } from './splineTrack.js';
import { toCommand, setKeys } from './cameraMove.js';

export const COLLAPSE_MIN_KEYS = 12; // fewer camera keys than this read fine as an `.at(..)` chain

const EPS = 5e-7;
const SLACK = 0.0015; // seconds a leg's start may move

function same( a, b ) {

	if ( typeof a === 'number' && typeof b === 'number' ) return Math.abs( a - b ) <= EPS;
	if ( Array.isArray( a ) ) return Array.isArray( b ) && a.length === b.length && a.every( ( v, i ) => same( v, b[ i ] ) );
	if ( a && b && typeof a === 'object' && typeof b === 'object' ) {

		const ka = Object.keys( a ), kb = Object.keys( b );
		return ka.length === kb.length && ka.every( k => Object.prototype.hasOwnProperty.call( b, k ) && same( a[ k ], b[ k ] ) );

	}
	return a === b;

}

function sameKey( a, b ) {

	const { duration: da, ...argsA } = a.args || {}, { duration: db, ...argsB } = b.args || {};
	return same( a.at + a.dur, b.at + b.dur ) && Math.abs( a.at - b.at ) <= SLACK && same( argsA, argsB ) && ( da === undefined ) === ( db === undefined );

}

/** The events `$S(sel).setKeys(specs, { smooth })` creates, as a camera track { events, spline? }. */
export function eventsFromSetKeys( target, specs, opts ) {

	const track = { target, events: [] };
	setKeys( track, specs, opts || {} );
	return track;

}

/**
 * @param {{ target: string, spline?: boolean }} track
 * @param {object[]} events   the track's events in print order (sorted by `at`)
 * @returns {null | { lines: string[], lead: number, ids: string[], rest: object[] }}
 *   `lines`: the statement (a comment line, then one line per key); `lead`: lines before the first key;
 *   `ids`: the key events' ids in line order; `rest`: the events that stay in the `.at(..)` chain
 *   null when the track is not dense enough or the statement would not rebuild it exactly.
 */
export function collapseCameraKeys( track, events, { min = COLLAPSE_MIN_KEYS } = {} ) {

	const keys = cameraKeys( events );
	if ( keys.length < min ) return null;

	const keyIds = new Set( keys.map( k => k.id ) );
	const keyEvents = events.filter( e => keyIds.has( e.id ) );
	const rest = events.filter( e => ! keyIds.has( e.id ) );

	const scratch = { target: track.target, events: keyEvents.map( e => ( { ...e } ) ), ...( track.spline ? { spline: true } : {} ) };
	const text = toCommand( scratch, track.target );
	let rebuilt;
	try {

		const { specs, opts } = parseSetKeys( text.slice( text.indexOf( '.setKeys(' ) ) );
		rebuilt = eventsFromSetKeys( track.target, specs, opts );

	} catch ( e ) {

		return null;

	}

	const byTime = [ ...keyEvents ].sort( ( a, b ) => ( a.at + a.dur ) - ( b.at + b.dur ) );
	if ( rebuilt.events.length !== byTime.length || !! rebuilt.spline !== !! track.spline ) return null;
	const mine = [ ...rebuilt.events ].sort( ( a, b ) => ( a.at + a.dur ) - ( b.at + b.dur ) );
	if ( ! byTime.every( ( e, i ) => sameKey( e, mine[ i ] ) ) ) return null;

	const comment = `// ${ keys.length } camera keys collapsed from ${ keyEvents.length } animate events, one key per line; saving rebuilds the same move`;
	return { lines: [ comment, ...text.split( '\n' ) ].map( ( l, i, all ) => i === all.length - 1 ? l + ';' : l ), lead: 2, ids: keys.map( k => k.id ), rest };

}

/**
 * `.setKeys([ { t, pos, lookAt?, fov? }, ... ], { smooth })` (the text after the selector, `)` of the
 * selector already consumed) -> { specs, opts }. Throws a readable error on a malformed statement.
 */
export function parseSetKeys( text ) {

	const open = text.indexOf( '(' );
	if ( open === - 1 ) throw new Error( 'setKeys: missing (' );
	let depth = 0, quote = null, end = - 1;
	for ( let i = open; i < text.length; i ++ ) {

		const c = text[ i ];
		if ( quote ) {

			if ( c === '\\' ) i ++;
			else if ( c === quote ) quote = null;
			continue;

		}
		if ( c === '"' || c === '\'' || c === '`' ) quote = c;
		else if ( c === '(' || c === '[' || c === '{' ) depth ++;
		else if ( c === ')' || c === ']' || c === '}' ) {

			depth --;
			if ( depth === 0 ) { end = i; break; }

		}

	}
	if ( end === - 1 ) throw new Error( 'setKeys: unbalanced brackets' );

	const list = Function( `"use strict"; return [ ${ text.slice( open + 1, end ) } ]` )();
	if ( ! Array.isArray( list[ 0 ] ) ) throw new Error( 'setKeys: expected an array of keys like [{ t: 0, pos: [0, 1, 5] }]' );
	return { specs: list[ 0 ], opts: list[ 1 ] && typeof list[ 1 ] === 'object' ? list[ 1 ] : {} };

}
