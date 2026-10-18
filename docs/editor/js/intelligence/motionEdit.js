// ── motionEdit.js ─────────────────────────────────────────────────────────────
// Motion as an EDIT LIST (EDL), not a re-bake. A captured clip is never touched;
// a cut is a handful of spans over it:
//
//   { spans: [ { from, to, speed? } | { hold, dur } ],   // clip-local seconds
//     blend, rootOffset: [x,y,z], rootYaw }              // blend window in seconds
//
// This module is pure (THREE only, no editor, no DOM) so a cut can be authored,
// compiled and checked headless:
//   * EDL ops: trim / splice / speed / retime / hold / rootOffset / rootYaw
//   * buildEditedClips(): compiles an EDL over a registered GROUP of clips into
//     in-memory derived clips (a compile product like the Timeline clip — never
//     serialized, never the authoring path)
//   * collisionReport(): min hip-to-hip floor distance over a timeline
//
// Registration: performers captured in one shared metric world frame are edited
// as ONE unit. The same spans / blend windows apply to every member, and the
// root-continuity offset at each cut is computed from the group's centroid and
// applied identically to every member, so their relative placement survives the
// cut. Per-member timeOffset / speed break that by definition (see the shell op
// breakRegistration()).

import * as THREE from 'three';

export const DEFAULT_BLEND = 0.25; // seconds (≈ 8 frames at 30 fps)
export const MIN_BLEND = 1 / 60;
export const COLLISION_FLOOR = 0.6; // metres, hip-to-hip on the floor (non-contact sparring)
export const BLEND_KEY_STEP = 1 / 60; // synthetic keys inside a blend window, so the slerp has a shape

export class MotionEditError extends Error {

	constructor( message, code = 'BAD_ARGS' ) {

		super( message );
		this.name = 'MotionEditError';
		this.code = code;

	}

}

const fail = ( m, code ) => { throw new MotionEditError( m, code ); };
const isNum = v => typeof v === 'number' && Number.isFinite( v );
const clamp = ( v, lo, hi ) => Math.min( hi, Math.max( lo, v ) );

// ── Edit list ────────────────────────────────────────────────────────────────

/** The unedited cut: the whole capture, one span. */
export function fullEdl( duration, blend = DEFAULT_BLEND ) {

	return { spans: [ { from: 0, to: duration } ], blend, rootOffset: [ 0, 0, 0 ], rootYaw: 0 };

}

function checkBlend( blend ) {

	if ( ! isNum( blend ) || blend < MIN_BLEND ) {

		fail( `blend must be a number >= ${ MIN_BLEND.toFixed( 4 ) }s — a splice without a blend pops the pose`, 'NO_BLEND' );

	}

	return blend;

}

function normalizeSpan( s, i, duration ) {

	if ( Array.isArray( s ) ) s = { from: s[ 0 ], to: s[ 1 ] };
	if ( ! s || typeof s !== 'object' ) fail( `span ${ i }: expected { from, to } or [from, to]` );

	if ( s.hold !== undefined ) {

		if ( ! isNum( s.hold ) || s.hold < 0 || s.hold > duration ) fail( `span ${ i }: hold time must be within 0–${ duration.toFixed( 2 ) }s` );
		if ( ! isNum( s.dur ) || s.dur <= 0 ) fail( `span ${ i }: hold dur must be a positive number of seconds` );
		return { hold: s.hold, dur: s.dur };

	}

	if ( ! isNum( s.from ) || ! isNum( s.to ) ) fail( `span ${ i }: from/to must be numbers (seconds)` );
	if ( s.from < 0 || s.to > duration + 1e-9 ) fail( `span ${ i }: ${ s.from }–${ s.to }s is outside the clip (0–${ duration.toFixed( 2 ) }s)` );
	if ( ! ( s.to > s.from ) ) fail( `span ${ i }: "to" must be greater than "from"` );

	const out = { from: s.from, to: Math.min( s.to, duration ) };
	if ( s.speed !== undefined && s.speed !== 1 ) {

		if ( ! isNum( s.speed ) || s.speed <= 0 ) fail( `span ${ i }: speed must be a positive number` );
		out.speed = s.speed;

	}

	return out;

}

/** Validate + canonicalise an EDL against the clip duration. Throws MotionEditError. */
export function normalizeEdl( edl, duration ) {

	if ( ! edl || ! Array.isArray( edl.spans ) || edl.spans.length === 0 ) fail( 'an edit list needs at least one span' );

	const out = {
		spans: edl.spans.map( ( s, i ) => normalizeSpan( s, i, duration ) ),
		blend: checkBlend( edl.blend === undefined ? DEFAULT_BLEND : edl.blend ),
		rootOffset: [ 0, 0, 0 ],
		rootYaw: 0,
	};

	if ( edl.rootOffset !== undefined ) {

		if ( ! Array.isArray( edl.rootOffset ) || edl.rootOffset.length !== 3 || ! edl.rootOffset.every( isNum ) ) fail( 'rootOffset must be [x, y, z]' );
		out.rootOffset = edl.rootOffset.slice();

	}

	if ( edl.rootYaw !== undefined ) {

		if ( ! isNum( edl.rootYaw ) ) fail( 'rootYaw must be a number (degrees)' );
		out.rootYaw = edl.rootYaw;

	}

	return out;

}

/** Output layout of an EDL: each span with its start/length on the cut's own clock. */
export function edlTable( edl ) {

	let t = 0;

	return edl.spans.map( ( s, index ) => {

		const hold = s.hold !== undefined;
		const speed = hold ? 1 : ( s.speed || 1 );
		const outDur = hold ? s.dur : ( s.to - s.from ) / speed;
		const row = { index, hold, from: hold ? s.hold : s.from, to: hold ? s.hold : s.to, speed, outStart: t, outDur };
		t += outDur;
		return row;

	} );

}

export function edlDuration( edl ) {

	const rows = edlTable( edl );
	const last = rows[ rows.length - 1 ];
	return last ? Math.round( ( last.outStart + last.outDur ) * 1e6 ) / 1e6 : 0; // no 52.89999999999999

}

/** Source (clip-local) time -> time on the cut, or null when the cut dropped that moment. */
export function sourceToOutput( edl, tSrc ) {

	for ( const r of edlTable( edl ) ) {

		if ( ! r.hold && tSrc >= r.from && tSrc <= r.to ) return r.outStart + ( tSrc - r.from ) / r.speed;

	}

	return null;

}

/** Time on the cut -> source (clip-local) time. */
export function outputToSource( edl, tOut ) {

	const rows = edlTable( edl );
	if ( rows.length === 0 ) return 0;

	for ( const r of rows ) {

		if ( tOut <= r.outStart + r.outDur + 1e-12 ) return r.hold ? r.from : r.from + clamp( tOut - r.outStart, 0, r.outDur ) * r.speed;

	}

	const last = rows[ rows.length - 1 ];
	return last.to;

}

// Every op is a pure transform: (edl, ...args, duration) -> new edl. `duration` is the clip length.

/** .play(clip, { from, to }) — the subclip primitive; everything else composes from it. */
export function trim( edl, from, to, duration ) {

	return normalizeEdl( { ...edl, spans: [ { from, to } ] }, duration );

}

/** .splice([{from,to}, …], { blend }) — join non-adjacent spans. Blend is mandatory (see MIN_BLEND). */
export function splice( edl, spans, opts = {}, duration ) {

	if ( ! Array.isArray( spans ) || spans.length === 0 ) fail( 'splice(): expected a non-empty list of spans' );
	return normalizeEdl( { ...edl, spans, blend: opts.blend === undefined ? edl.blend : opts.blend }, duration );

}

/** .speed(f) — resample every span at f× (0.5 = slow motion). Applied to the whole group. */
export function speed( edl, f, duration ) {

	if ( ! isNum( f ) || f <= 0 ) fail( 'speed(): factor must be a positive number' );
	return normalizeEdl( { ...edl, spans: edl.spans.map( s => s.hold !== undefined ? s : { ...s, speed: f } ) }, duration );

}

/**
 * .retime(curve) — piecewise-constant speed over SOURCE time: [[srcTime, speed], …].
 * Spans are split at the knots; each piece runs at the speed of the last knot at or before it.
 */
export function retime( edl, curve, duration ) {

	if ( ! Array.isArray( curve ) || curve.length === 0 || ! curve.every( k => Array.isArray( k ) && isNum( k[ 0 ] ) && isNum( k[ 1 ] ) && k[ 1 ] > 0 ) ) {

		fail( 'retime(): curve must be [[sourceTime, speed], …] with positive speeds' );

	}

	const knots = [ ...curve ].sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	const spans = [];

	for ( const s of edl.spans ) {

		if ( s.hold !== undefined ) { spans.push( s ); continue; }

		const cuts = [ s.from, ...knots.map( k => k[ 0 ] ).filter( t => t > s.from && t < s.to ), s.to ];

		for ( let i = 0; i < cuts.length - 1; i ++ ) {

			const k = [ ...knots ].reverse().find( kn => kn[ 0 ] <= cuts[ i ] );
			spans.push( { from: cuts[ i ], to: cuts[ i + 1 ], ...( k ? { speed: k[ 1 ] } : s.speed ? { speed: s.speed } : {} ) } );

		}

	}

	return normalizeEdl( { ...edl, spans }, duration );

}

/** .hold(t, dur) — freeze the pose at cut-time `t` for `dur` seconds (inserted into the cut). */
export function hold( edl, t, dur, duration ) {

	if ( ! isNum( t ) || t < 0 ) fail( 'hold(): t must be a time on the cut (seconds)' );
	if ( ! isNum( dur ) || dur <= 0 ) fail( 'hold(): dur must be a positive number of seconds' );

	const total = edlDuration( edl );
	if ( t > total + 1e-9 ) fail( `hold(): ${ t }s is past the end of the cut (${ total.toFixed( 2 ) }s)` );

	const src = outputToSource( edl, t );
	const spans = [];
	let placed = false;

	for ( const r of edlTable( edl ) ) {

		const s = edl.spans[ r.index ];

		if ( ! placed && t <= r.outStart + r.outDur + 1e-12 ) {

			placed = true;

			if ( r.hold ) { spans.push( { hold: s.hold, dur: s.dur + dur } ); continue; }

			if ( src > s.from + 1e-9 ) spans.push( { ...s, to: src } );
			spans.push( { hold: src, dur } );
			if ( src < s.to - 1e-9 ) spans.push( { ...s, from: src } );
			continue;

		}

		spans.push( s );

	}

	return normalizeEdl( { ...edl, spans }, duration );

}

/** .rootOffset([x,y,z]) — move the performance in the world (the group's roots, same vector). */
export function rootOffset( edl, v, duration ) {

	return normalizeEdl( { ...edl, rootOffset: v }, duration );

}

/** .rootYaw(deg) — turn the performance about the group's centre. */
export function rootYaw( edl, deg, duration ) {

	return normalizeEdl( { ...edl, rootYaw: deg }, duration );

}

/** Compact text form of an EDL, for code panels and the shell. */
export function describeEdl( edl ) {

	const f = n => Math.round( n * 1000 ) / 1000;
	const spans = edl.spans.map( s => s.hold !== undefined ? `{ hold: ${ f( s.hold ) }, dur: ${ f( s.dur ) } }` : `{ from: ${ f( s.from ) }, to: ${ f( s.to ) }${ s.speed ? `, speed: ${ s.speed }` : '' } }` );
	return `[ ${ spans.join( ', ' ) } ], { blend: ${ f( edl.blend ) } }`;

}

// ── Root detection ───────────────────────────────────────────────────────────

const prefixOf = name => name.slice( 0, name.lastIndexOf( '.' ) );

/**
 * The performer's root: the position track that travels furthest across the floor
 * (the hips on a mocap skeleton). Returns { posIndex, quatIndex } into clip.tracks, or null.
 */
export function findRoot( clip ) {

	let best = null, bestRange = - 1;

	clip.tracks.forEach( ( t, i ) => {

		if ( ! t.name.endsWith( '.position' ) || t.getValueSize() !== 3 ) return;

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;
		for ( let k = 0; k < t.values.length; k += 3 ) {

			minX = Math.min( minX, t.values[ k ] ); maxX = Math.max( maxX, t.values[ k ] );
			minZ = Math.min( minZ, t.values[ k + 2 ] ); maxZ = Math.max( maxZ, t.values[ k + 2 ] );

		}

		const range = Math.hypot( maxX - minX, maxZ - minZ );
		if ( range > bestRange ) { bestRange = range; best = i; }

	} );

	if ( best === null ) return null;

	const want = prefixOf( clip.tracks[ best ].name ) + '.quaternion';
	const quatIndex = clip.tracks.findIndex( t => t.name === want );
	return { posIndex: best, quatIndex: quatIndex === - 1 ? null : quatIndex };

}

// ── Sampling helpers ─────────────────────────────────────────────────────────

function trackInfo( clip ) {

	return clip.tracks.map( track => ( {
		track,
		interp: track.createInterpolant(),
		size: track.getValueSize(),
		quat: track.ValueTypeName === 'quaternion',
	} ) );

}

function sampleInfo( info, time ) {

	return Array.from( info.interp.evaluate( time ) );

}

const smooth = k => k * k * ( 3 - 2 * k );

function blendValues( info, a, b, k ) {

	if ( info.quat ) {

		const out = [ 0, 0, 0, 0 ];
		THREE.Quaternion.slerpFlat( out, 0, a, 0, b, 0, k );
		return out;

	}

	return a.map( ( v, i ) => v + ( b[ i ] - v ) * k );

}

// ── Compile: EDL over a registered group -> derived clips ────────────────────

/**
 * @param {Array<{ id:string, clip:THREE.AnimationClip, timeOffset?:number, speed?:number }>} members
 * @param {object} edl  a normalized EDL (see normalizeEdl)
 * @returns {Map<string, THREE.AnimationClip>} id -> derived clip of length edlDuration(edl)
 *
 * Every member gets the SAME spans and blend windows. At each cut the incoming span is blended
 * from the outgoing span's last pose (quaternion slerp / linear for the rest) over `edl.blend`
 * seconds, and the root is shifted on the floor so the group's centroid continues from where
 * it ended — one offset vector for the whole group, so the members' separation is preserved.
 * Source clips are only read.
 */
export function buildEditedClips( members, edl ) {

	const table = edlTable( edl );
	const total = edlDuration( edl );
	const yaw = THREE.MathUtils.degToRad( edl.rootYaw || 0 );
	const prep = members.map( m => {

		const infos = trackInfo( m.clip );
		const root = findRoot( m.clip );
		return { m, infos, root, dur: m.clip.duration, off: m.timeOffset || 0, rate: m.speed || 1 };

	} );

	const rawXZ = ( p, t ) => {

		if ( ! p.root ) return null;
		const v = sampleInfo( p.infos[ p.root.posIndex ], clamp( t, 0, p.dur ) );
		return [ v[ 0 ], v[ 2 ] ];

	};

	// Source range each member reads for a span: [a, b] clip-local, plus the effective rate.
	const sourceRange = ( p, row ) => {

		if ( row.hold ) { const a = clamp( row.from + p.off, 0, p.dur ); return { a, b: a, rate: 1 }; }
		const rate = row.speed * p.rate;
		const a = clamp( row.from + p.off, 0, p.dur );
		return { a, b: clamp( row.from + p.off + row.outDur * rate, 0, p.dur ), rate, free: row.from + p.off };

	};

	const centroid = ( pts ) => {

		const ok = pts.filter( Boolean );
		return ok.length ? [ ok.reduce( ( s, v ) => s + v[ 0 ], 0 ) / ok.length, ok.reduce( ( s, v ) => s + v[ 1 ], 0 ) / ok.length ] : null;

	};

	// Continuity offset per span (same for every member).
	const offsets = [];
	let prevEnd = null;

	table.forEach( ( row, k ) => {

		const ranges = prep.map( p => sourceRange( p, row ) );
		const start = centroid( prep.map( ( p, i ) => rawXZ( p, ranges[ i ].a ) ) );
		const end = centroid( prep.map( ( p, i ) => rawXZ( p, ranges[ i ].b ) ) );
		let d = [ 0, 0 ];
		if ( k > 0 && prevEnd && start ) d = [ prevEnd[ 0 ] - start[ 0 ], prevEnd[ 1 ] - start[ 1 ] ];
		offsets.push( d );
		prevEnd = end ? [ end[ 0 ] + d[ 0 ], end[ 1 ] + d[ 1 ] ] : null;

	} );

	const first = table[ 0 ];
	const pivot = centroid( prep.map( p => rawXZ( p, sourceRange( p, first ).a ) ) ) || [ 0, 0 ];
	const [ ox, oy, oz ] = edl.rootOffset || [ 0, 0, 0 ];
	const cosY = Math.cos( yaw ), sinY = Math.sin( yaw );
	const yawQ = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), yaw );

	const out = new Map();

	for ( const p of prep ) {

		const tracks = p.infos.map( ( info, ti ) => {

			const isRootPos = p.root && ti === p.root.posIndex;
			const isRootQuat = p.root && ti === p.root.quatIndex;
			const times = [];
			const values = [];

			const push = ( t, v ) => {

				if ( times.length && Math.abs( times[ times.length - 1 ] - t ) < 1e-9 ) return; // coincident with the previous key (cut point)
				times.push( t );
				for ( const x of v ) values.push( x );

			};

			const lastValue = () => values.slice( values.length - info.size );

			const place = ( v, k ) => {

				if ( isRootPos ) {

					let x = v[ 0 ] + offsets[ k ][ 0 ];
					let z = v[ 2 ] + offsets[ k ][ 1 ];

					if ( yaw !== 0 ) {

						const dx = x - pivot[ 0 ], dz = z - pivot[ 1 ];
						x = pivot[ 0 ] + dx * cosY + dz * sinY;
						z = pivot[ 1 ] - dx * sinY + dz * cosY;

					}

					return [ x + ox, v[ 1 ] + oy, z + oz ];

				}

				if ( isRootQuat && yaw !== 0 ) {

					const q = new THREE.Quaternion( v[ 0 ], v[ 1 ], v[ 2 ], v[ 3 ] ).premultiply( yawQ );
					return [ q.x, q.y, q.z, q.w ];

				}

				return v;

			};

			table.forEach( ( row, k ) => {

				const { a, b, rate } = sourceRange( p, row );
				const O = row.outStart, D = row.outDur;
				const w = k > 0 ? Math.min( edl.blend, D ) : 0;
				const pOut = k > 0 && values.length ? lastValue() : null;

				const blendWindow = ( v, tau ) => {

					if ( ! pOut || tau >= w ) return v;
					return blendValues( info, pOut, v, smooth( tau / w ) );

				};

				if ( row.hold ) {

					const v = place( sampleInfo( info, a ), k );
					push( O, pOut || v );
					if ( pOut ) push( O + w, v );
					push( O + D, v );
					return;

				}

				const taus = new Set( [ 0, D ] );
				const srcTimes = info.track.times;

				for ( let i = 0; i < srcTimes.length; i ++ ) {

					const t = srcTimes[ i ];
					if ( t > a && t < b ) taus.add( ( t - a ) / rate );

				}

				if ( w > 0 ) {

					for ( let s = BLEND_KEY_STEP; s < w - 1e-9; s += BLEND_KEY_STEP ) taus.add( s );
					taus.add( w );

				}

				const ordered = [ ...taus ].sort( ( x, y ) => x - y );

				for ( const tau of ordered ) {

					const srcT = clamp( a + tau * rate, 0, p.dur );
					const v = place( sampleInfo( info, srcT ), k );
					push( O + tau, blendWindow( v, tau ) );

				}

			} );

			if ( times.length === 1 ) { times.push( total ); for ( let i = 0; i < info.size; i ++ ) values.push( values[ i ] ); }
			return new info.track.constructor( info.track.name, times, values, info.track.getInterpolation() );

		} );

		const clip = new THREE.AnimationClip( `${ p.m.clip.name } [cut]`, total, tracks );
		clip.userData = { isMotionEdit: true, source: p.m.clip.uuid };
		out.set( p.m.id, clip );

	}

	return out;

}

// ── Collision report ─────────────────────────────────────────────────────────

/**
 * Hip-to-hip distance on the floor (world x/z) between every pair of members, over a timeline.
 *
 * @param {Array<{ id:string, clip:THREE.AnimationClip, matrix?:THREE.Matrix4 }>} members
 *        `matrix` takes the root's local position to world (its parent's matrixWorld); identity by default.
 * @param {object} [opts]
 * @param {number} [opts.floor]  flag spans below this many metres (default COLLISION_FLOOR)
 * @param {number} [opts.step]   sampling step in seconds (default 1/30)
 * @param {number} [opts.at]     added to every reported time (the group's start on the shared clock)
 * @param {Array}  [opts.spans]  edlTable() rows, for a per-span minimum
 */
export function collisionReport( members, opts = {} ) {

	const floor = opts.floor === undefined ? COLLISION_FLOOR : opts.floor;
	const step = opts.step || 1 / 30;
	const at = opts.at || 0;

	if ( members.length < 2 ) fail( 'collisionReport needs at least two performers', 'BAD_ARGS' );

	const rigs = members.map( m => {

		const root = findRoot( m.clip );
		if ( ! root ) fail( `collisionReport: "${ m.id }" has no position track to use as the root`, 'NO_ROOT' );
		return { m, info: trackInfo( m.clip )[ root.posIndex ], v: new THREE.Vector3() };

	} );

	const duration = Math.min( ...members.map( m => m.clip.duration ) );
	const n = Math.max( 1, Math.ceil( duration / step ) );
	const spans = opts.spans || [];
	const spanMin = spans.map( s => ( { index: s.index, from: at + s.outStart, to: at + s.outStart + s.outDur, min: Infinity, minAt: null } ) );
	const violations = [];
	let min = Infinity, minAt = 0, run = null;

	for ( let i = 0; i <= n; i ++ ) {

		const t = Math.min( duration, i * step );
		const pts = rigs.map( r => {

			const v = sampleInfo( r.info, t );
			r.v.set( v[ 0 ], v[ 1 ], v[ 2 ] );
			if ( r.m.matrix ) r.v.applyMatrix4( r.m.matrix );
			return [ r.v.x, r.v.z ];

		} );

		let d = Infinity;
		for ( let a = 0; a < pts.length; a ++ ) for ( let b = a + 1; b < pts.length; b ++ ) d = Math.min( d, Math.hypot( pts[ a ][ 0 ] - pts[ b ][ 0 ], pts[ a ][ 1 ] - pts[ b ][ 1 ] ) );

		if ( d < min ) { min = d; minAt = at + t; }

		for ( const s of spanMin ) {

			const T = at + t;
			if ( T >= s.from - 1e-9 && T <= s.to + 1e-9 && d < s.min ) { s.min = d; s.minAt = T; }

		}

		if ( d < floor ) {

			if ( ! run ) run = { from: at + t, to: at + t, min: d, minAt: at + t };
			run.to = at + t;
			if ( d < run.min ) { run.min = d; run.minAt = at + t; }

		} else if ( run ) {

			violations.push( run );
			run = null;

		}

	}

	if ( run ) violations.push( run );

	const r3 = x => Math.round( x * 1000 ) / 1000;

	return {
		floor,
		duration: r3( duration ),
		min: r3( min ),
		minAt: r3( minAt ),
		ok: violations.length === 0,
		violations: violations.map( v => ( { from: r3( v.from ), to: r3( v.to ), min: r3( v.min ), minAt: r3( v.minAt ) } ) ),
		spans: spanMin.map( s => ( { index: s.index, from: r3( s.from ), to: r3( s.to ), min: s.min === Infinity ? null : r3( s.min ), minAt: s.minAt === null ? null : r3( s.minAt ) } ) ),
	};

}

/** Plain-text form of a collisionReport(), for the shell and the Animations tab. */
export function formatCollisionReport( r ) {

	const lines = [ `hip-to-hip min ${ r.min.toFixed( 2 ) } m at ${ r.minAt.toFixed( 2 ) }s over ${ r.duration.toFixed( 2 ) }s — ${ r.ok ? `OK (no span under ${ r.floor } m)` : `${ r.violations.length } span${ r.violations.length === 1 ? '' : 's' } UNDER ${ r.floor } m` }` ];
	for ( const v of r.violations ) lines.push( `  ! ${ v.from.toFixed( 2 ) }–${ v.to.toFixed( 2 ) }s  min ${ v.min.toFixed( 2 ) } m` );
	for ( const s of r.spans ) lines.push( `  span ${ s.index + 1 }  ${ s.from.toFixed( 2 ) }–${ s.to.toFixed( 2 ) }s  min ${ s.min === null ? '—' : s.min.toFixed( 2 ) + ' m' }` );
	if ( r.warning ) lines.push( `  (${ r.warning })` );
	return lines.join( '\n' );

}
