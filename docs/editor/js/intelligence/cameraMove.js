// ── cameraMove.js ─────────────────────────────────────────────────────────────
// Every edit to a shot camera's move, as pure functions over ONE track object
// ({ target, events, spline? }). The viewport (CameraPath.js, Timeline.js) and the
// JS shell ($S('#cam').keyAt() / moveKey() / ...) both call these, so a key means
// the same thing wherever it is edited and the baked result is identical.
//
// No three.js, no DOM, no editor: the caller owns undo (see cameraMoveEdit.js) and
// passes a track it is free to mutate.
//
// A key is an `animate` event that ARRIVES at time (at + dur) at a position, with an
// optional aim point (`lookAt`: [x,y,z] static point, or a '#name' that follows the
// subject) and `fov`. Indices are positions in the key list sorted by arrival time:
// keys()[i] in the shell is the handle labelled `key i+1/N` in the viewport.

import { cameraKeys, makeCurve, simplifyKeys, eventsFromKeys } from './splineTrack.js';

export const KEY_EPS = 0.0015; // two keys closer than this in time are the same key

const isVec3 = v => Array.isArray( v ) && v.length === 3 && v.every( Number.isFinite );
const r3 = v => Math.round( v * 1e3 ) / 1e3;
const r4 = v => Math.round( v * 1e4 ) / 1e4;
const has = ( o, k ) => Object.prototype.hasOwnProperty.call( o, k );

// ── reading ──────────────────────────────────────────────────────────────────

/** The label the viewport shows for a handle: `key 8/20 · 6.00s` (1-based). */
export function keyLabel( index, count, time, kind = 'key' ) {

	return ( kind === 'look' ? 'aim ' : 'key ' ) + ( index + 1 ) + '/' + count + ' · ' + time.toFixed( 2 ) + 's';

}

/** The keys as the shell and the viewport address them: index is 0-based. */
export function keyList( track ) {

	const keys = cameraKeys( track ? track.events : [] );
	return keys.map( ( k, index ) => ( {
		index,
		id: k.id,
		time: k.time,
		pos: k.position.slice(),
		lookAt: Array.isArray( k.lookAt ) ? k.lookAt.slice() : k.lookAt,
		fov: k.fov,
		label: keyLabel( index, keys.length, k.time ),
	} ) );

}

/** Where the track puts the camera at time t (curve for smooth tracks, straight legs otherwise). */
export function sampleKeys( keys, spline, t ) {

	if ( keys.length === 0 ) return null;
	if ( spline && keys.length > 1 ) return makeCurve( keys ).at( t );
	const prev = [ ...keys ].reverse().find( k => k.time <= t ) || keys[ 0 ];
	const next = keys.find( k => k.time > t ) || keys[ keys.length - 1 ];
	if ( prev === next || next.time <= prev.time ) return { position: prev.position.slice(), lookAt: prev.lookAt, fov: prev.fov };
	const u = ( t - prev.time ) / ( next.time - prev.time );
	const lerp = ( a, b ) => a.map( ( v, d ) => v + ( b[ d ] - v ) * u );
	return {
		position: lerp( prev.position, next.position ),
		lookAt: isVec3( prev.lookAt ) && isVec3( next.lookAt ) ? lerp( prev.lookAt, next.lookAt ) : next.lookAt,
		fov: prev.fov !== null && next.fov !== null ? prev.fov + ( next.fov - prev.fov ) * u : next.fov,
	};

}

// ── input checking ───────────────────────────────────────────────────────────

/** Accepts { pos | position, lookAt, fov, time | t }; throws a readable error on bad input. */
export function normalizeSpec( spec, what = 'key' ) {

	if ( ! spec || typeof spec !== 'object' ) throw new Error( what + ': expected an object like { pos: [x,y,z], lookAt: "#maya" | [x,y,z], fov: 35 }' );
	const out = {};
	const pos = has( spec, 'pos' ) ? spec.pos : spec.position;
	if ( pos !== undefined ) {

		if ( ! isVec3( pos ) ) throw new Error( what + ': pos must be [x, y, z] numbers' );
		out.pos = pos.map( r4 );

	}
	if ( has( spec, 'lookAt' ) ) {

		const l = spec.lookAt;
		if ( l === null ) out.lookAt = null;
		else if ( isVec3( l ) ) out.lookAt = l.map( r4 );
		else if ( typeof l === 'string' && l.trim() ) out.lookAt = l.trim();
		else throw new Error( what + ': lookAt must be [x, y, z], a "#name" to follow, or null' );

	}
	if ( has( spec, 'fov' ) ) {

		if ( spec.fov === null ) out.fov = null;
		else if ( Number.isFinite( spec.fov ) && spec.fov > 0 && spec.fov < 180 ) out.fov = r4( spec.fov );
		else throw new Error( what + ': fov must be a number between 0 and 180 (degrees), or null' );

	}
	const time = has( spec, 'time' ) ? spec.time : spec.t;
	if ( time !== undefined ) {

		if ( ! Number.isFinite( time ) || time < 0 ) throw new Error( what + ': time must be a number of seconds >= 0' );
		out.time = r3( time );

	}
	return out;

}

function checkIndex( keys, i ) {

	if ( ! Number.isInteger( i ) || i < 0 || i >= keys.length ) throw new RangeError( 'no key ' + i + ' (this camera has ' + keys.length + ' key' + ( keys.length === 1 ? '' : 's' ) + ', indices 0 to ' + ( keys.length - 1 ) + ')' );

}

// ── writing ──────────────────────────────────────────────────────────────────
// Each key is a leg that starts after the previous key and arrives at its time. When a
// key moves, is added or removed, the legs around it are re-timed so the motion between
// the neighbours is what the keys say, while untouched events stay byte-for-byte as they
// were (holds, easing, ids).

function describe( track ) {

	const keys = cameraKeys( track.events );
	const byId = new Map( track.events.map( e => [ e.id, e ] ) );
	return keys.map( ( k, i ) => {

		const e = byId.get( k.id );
		const prevTime = i > 0 ? keys[ i - 1 ].time : null;
		const tied = i > 0 && Math.abs( e.at - prevTime ) <= 0.002; // starts when the previous key arrives
		return { e, time: k.time, pos: k.position, lookAt: k.lookAt, fov: k.fov, at0: e.at, dur0: e.dur, prevTime0: prevTime, tied, offset: tied ? e.at - prevTime : 0, snap: i === 0 && e.dur <= 0.0015 };

	} );

}

function uniqueId( track, time ) {

	const base = 'ck_' + Math.round( time * 1000 );
	const used = new Set( track.events.map( e => e.id ) );
	let id = base, n = 2;
	while ( used.has( id ) ) id = base + '_' + ( n ++ );
	return id;

}

function commit( track, items ) {

	items.sort( ( a, b ) => a.time - b.time );
	for ( let i = 1; i < items.length; i ++ ) if ( items[ i ].time - items[ i - 1 ].time <= KEY_EPS ) throw new Error( 'two keys would share the time ' + items[ i ].time + 's' );

	const keep = new Set( items.filter( it => it.e ).map( it => it.e.id ) );
	const old = new Set( track.events.filter( e => cameraKeys( [ e ] ).length ).map( e => e.id ) );
	track.events = track.events.filter( e => ! old.has( e.id ) || keep.has( e.id ) );

	items.forEach( ( it, n ) => {

		const T = r3( it.time );
		const prevT = n > 0 ? r3( items[ n - 1 ].time ) : null;
		let at;
		if ( n === 0 ) {

			if ( ! it.e || it.tied || it.snap ) at = Math.max( 0, r3( T - ( it.snap ? it.dur0 : 0.001 ) ) );
			else at = it.at0;

		} else if ( ! it.e ) at = r3( prevT + 0.001 );
		else if ( it.tied ) at = r3( prevT + it.offset );
		else {

			at = it.at0;
			if ( prevT !== it.prevTime0 && at < prevT ) at = r3( prevT + 0.001 ); // a neighbour moved over this leg's start

		}
		at = Math.max( 0, Math.min( at, r3( T - 0.001 ) ) );
		const dur = Math.max( 0.001, r3( T - at ) );

		let e = it.e;
		const props = e && e.args.props ? { ...e.args.props } : {};
		props.to = { ...( props.to || {} ), position: it.pos.map( r4 ) };
		if ( it.lookAt !== null && it.lookAt !== undefined ) props.lookAt = Array.isArray( it.lookAt ) ? it.lookAt.map( r4 ) : it.lookAt; else delete props.lookAt;
		if ( it.fov !== null && it.fov !== undefined ) props.fov = r4( it.fov ); else delete props.fov;

		if ( ! e ) {

			e = { id: uniqueId( track, T ), at, op: 'animate', args: { props, easing: 'linear', duration: dur }, dur };
			track.events.push( e );
			it.e = e;
			return;

		}
		e.args = { ...e.args, props };
		if ( Math.abs( e.at - at ) > 1e-6 || Math.abs( e.dur - dur ) > 1e-6 ) { e.at = at; e.dur = dur; e.args.duration = dur; }

	} );
	return items;

}

/** Add a key at `spec.time`, or merge into the key already there. Returns its index. */
export function upsertKey( track, spec ) {

	const s = normalizeSpec( spec, 'keyAt' );
	if ( s.time === undefined ) throw new Error( 'keyAt: a time is required' );
	const items = describe( track );
	const keys = items.map( it => ( { time: it.time, position: it.pos, lookAt: it.lookAt, fov: it.fov } ) );
	let it = items.find( it => Math.abs( it.time - s.time ) <= KEY_EPS );

	if ( it ) {

		if ( s.pos ) it.pos = s.pos;
		if ( has( s, 'lookAt' ) ) it.lookAt = s.lookAt;
		if ( has( s, 'fov' ) ) it.fov = s.fov;

	} else {

		const at = sampleKeys( keys, !! track.spline, s.time );
		if ( ! s.pos && ! at ) throw new Error( 'keyAt: the first key of a camera needs a pos' );
		it = {
			e: null, time: s.time, pos: s.pos || at.position.map( r4 ),
			lookAt: has( s, 'lookAt' ) ? s.lookAt : ( at ? at.lookAt : null ),
			fov: has( s, 'fov' ) ? s.fov : ( at ? at.fov : null ),
			tied: false, offset: 0, snap: false, prevTime0: null,
		};
		items.push( it );

	}
	commit( track, items );
	return items.indexOf( it );

}

/** Change a key's position, aim, fov and/or arrival time. Returns its new index. */
export function moveKey( track, index, spec ) {

	const items = describe( track );
	checkIndex( items, index );
	const s = normalizeSpec( spec, 'moveKey' );
	const it = items[ index ];
	if ( s.pos ) it.pos = s.pos;
	if ( has( s, 'lookAt' ) ) it.lookAt = s.lookAt;
	if ( has( s, 'fov' ) ) it.fov = s.fov;
	if ( s.time !== undefined ) it.time = s.time;
	commit( track, items );
	return items.indexOf( it );

}

/** Remove a key. A camera always keeps at least one. */
export function deleteKey( track, index ) {

	const items = describe( track );
	checkIndex( items, index );
	if ( items.length <= 1 ) throw new Error( 'deleteKey: a camera keeps at least one key' );
	const [ gone ] = items.splice( index, 1 );
	track.events = track.events.filter( e => e.id !== gone.e.id );
	commit( track, items );
	return items.length;

}

export function setSmooth( track, on ) {

	if ( on ) track.spline = true; else delete track.spline;

}

/**
 * Replace the whole move: keys are [{ t | time, pos, lookAt?, fov? }]. At least one key.
 * `simplify` (off by default, so asCommand() round-trips exactly) thins a dense run after writing it:
 * true = the conservative 'tight' preset with beats kept, or any simplifyOptions() value.
 */
export function setKeys( track, specs, { smooth, simplify } = {} ) {

	if ( ! Array.isArray( specs ) || specs.length === 0 ) throw new Error( 'setKeys: expected a non-empty array of keys' );
	const items = specs.map( ( spec, i ) => {

		const s = normalizeSpec( spec, 'setKeys[' + i + ']' );
		if ( ! s.pos ) throw new Error( 'setKeys[' + i + ']: pos is required' );
		if ( s.time === undefined ) throw new Error( 'setKeys[' + i + ']: t is required' );
		return { e: null, time: s.time, pos: s.pos, lookAt: s.lookAt === undefined ? null : s.lookAt, fov: s.fov === undefined ? null : s.fov, tied: false, offset: 0, snap: false, prevTime0: null };

	} );
	const old = new Set( cameraKeys( track.events ).map( k => k.id ) );
	track.events = track.events.filter( e => ! old.has( e.id ) );
	commit( track, items );
	if ( smooth !== undefined ) setSmooth( track, !! smooth );
	if ( simplify ) return simplifyTrack( track, simplify === true ? { preset: 'tight', keepBeats: true } : simplify ).after;
	return items.length;

}

/** The Tight / Normal / Loose steps of the Simplify control: position in scene units, rotation and fov in degrees. */
export const SIMPLIFY_PRESETS = {
	tight: { tolerance: 0.005, rotation: 0.25, fov: 0.1, maxKeys: 60 },
	normal: { tolerance: 0.01, rotation: 0.5, fov: 0.25, maxKeys: 40 },
	loose: { tolerance: 0.05, rotation: 2, fov: 1, maxKeys: 12 },
};

/**
 * Simplify options from what a caller passes: a number (position tolerance), a preset name
 * ('tight' | 'normal' | 'loose'), or { preset?, tolerance, rotation, fov, maxKeys, keepBeats, beats }.
 * Explicit fields win over the preset. With nothing given: tolerance 0.01, aim checked as a point, 20 keys.
 */
export function simplifyOptions( opts ) {

	const o = typeof opts === 'number' ? { tolerance: opts } : typeof opts === 'string' ? { preset: opts } : ( opts || {} );
	if ( o.preset !== undefined && ! SIMPLIFY_PRESETS[ o.preset ] ) throw new Error( 'simplify: preset must be one of ' + Object.keys( SIMPLIFY_PRESETS ).join( ', ' ) );
	const { preset, ...rest } = o;
	const out = { tolerance: 0.01, maxKeys: 20, keepBeats: false, beats: [], ...( preset ? SIMPLIFY_PRESETS[ preset ] : {} ) };
	for ( const k of Object.keys( rest ) ) if ( rest[ k ] !== undefined ) out[ k ] = rest[ k ];
	for ( const k of [ 'tolerance', 'rotation', 'fov', 'maxKeys' ] ) {

		if ( out[ k ] !== undefined && ( ! Number.isFinite( out[ k ] ) || out[ k ] < 0 ) ) throw new Error( 'simplify: ' + k + ' must be a non-negative number' );

	}
	out.keepBeats = !! out.keepBeats;
	out.beats = ( Array.isArray( out.beats ) ? out.beats : [] ).filter( Number.isFinite );
	return out;

}

function planSimplify( track, opts ) {

	const keys = cameraKeys( track.events );
	if ( keys.length < 4 ) return { keys, picked: null, before: keys.length, after: keys.length, changed: false, worst: 0 };
	const picked = simplifyKeys( keys, simplifyOptions( opts ) );
	const changed = picked.length < keys.length;
	return { keys, picked, before: keys.length, after: picked.length, changed, worst: Math.round( picked.worst * 1000 ) / 1000 };

}

/** What simplifyTrack would do, without touching the track: { before, after, changed, worst } (worst <= 1: every dropped key is within tolerance). */
export function previewSimplify( track, opts ) {

	const { before, after, changed, worst } = planSimplify( track, opts );
	return { before, after, changed, worst };

}

/** Collapse a dense run of keys to a few on a smooth path (the viewport's Simplify button). See simplifyOptions. */
export function simplifyTrack( track, opts ) {

	const { keys, picked, before, after, changed, worst } = planSimplify( track, opts );
	if ( ! changed ) return { before, after, changed: false, worst };
	const ids = new Set( keys.map( k => k.id ) );
	track.events = track.events.filter( e => ! ids.has( e.id ) ).concat( eventsFromKeys( keys, picked, 'ck' ) );
	track.spline = true;
	return { before, after, changed: true, worst };

}

// ── serializing ──────────────────────────────────────────────────────────────

const num = v => String( r4( v ) );
const vec = v => '[' + v.map( num ).join( ', ' ) + ']';

/** The shell command that rebuilds this move exactly: run it and the track has the same keys. */
export function toCommand( track, selector ) {

	const keys = cameraKeys( track.events );
	if ( ! keys.length ) return '// ' + selector + ' has no camera keys';
	const rows = keys.map( k => {

		const parts = [ 't: ' + r3( k.time ), 'pos: ' + vec( k.position ) ];
		if ( isVec3( k.lookAt ) ) parts.push( 'lookAt: ' + vec( k.lookAt ) );
		else if ( typeof k.lookAt === 'string' ) parts.push( 'lookAt: ' + JSON.stringify( k.lookAt ) );
		if ( k.fov !== null ) parts.push( 'fov: ' + num( k.fov ) );
		return '\t{ ' + parts.join( ', ' ) + ' }';

	} );
	const quoted = '\'' + String( selector ).replace( /\\/g, '\\\\' ).replace( /'/g, '\\\'' ) + '\'';
	return '$S(' + quoted + ').setKeys([\n' + rows.join( ',\n' ) + '\n], { smooth: ' + ( track.spline ? 'true' : 'false' ) + ' })';

}
