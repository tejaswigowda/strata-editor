// ── splineTrack.js ────────────────────────────────────────────────────────────
// Camera keys on the universal timeline, and the smooth path through them. Pure
// (no three.js, no DOM) so the compiler, the viewport path overlay and the node
// tests share one definition of "where is the camera at time t".
//
// A KEY is an `animate` event whose props.to.position is a [x,y,z] array. It
// ARRIVES at time at+dur with that position, optionally an aim point
// (props.lookAt as [x,y,z]) and a field of view (props.fov).
//
// Two ways a track plays:
//   linear  (default)  each key is its own leg: the existing `animate` behavior.
//   spline  (track.spline = true)  one smooth path through all key positions,
//           aim points and fovs: the camera holds its first key until that key's
//           time, speed is continuous through every key, and it eases to rest at
//           the last. Per-leg easing is ignored; the keys' times shape the motion.
//
// The curve is a cubic Hermite spline in TIME with finite-difference tangents
// (zero at both ends), so it never overshoots wildly and a key's time changes
// the speed, not the shape.

const isVec3 = v => Array.isArray( v ) && v.length === 3 && v.every( Number.isFinite );
const r4 = v => Math.round( v * 1e4 ) / 1e4;
const r3 = v => Math.round( v * 1e3 ) / 1e3;

export const SPLINE_DT = 0.1; // seconds between baked samples

/** Keys of a camera track, sorted by arrival time. */
export function cameraKeys( events ) {

	const keys = [];
	for ( const e of events || [] ) {

		if ( e.op !== 'animate' || ! e.args || ! e.args.props ) continue;
		const p = e.args.props, to = p.to;
		if ( ! to || ! isVec3( to.position ) ) continue;
		keys.push( {
			id: e.id,
			time: r3( e.at + ( e.dur || 0 ) ),
			position: to.position.slice(),
			lookAt: isVec3( p.lookAt ) ? p.lookAt.slice() : ( p.lookAt != null ? p.lookAt : null ),
			fov: Number.isFinite( p.fov ) ? p.fov : null,
		} );

	}
	return keys.sort( ( a, b ) => a.time - b.time );

}

function tangents( times, vals ) {

	const n = times.length;
	return vals.map( ( v, i ) => {

		if ( i === 0 || i === n - 1 ) return 0;
		const dt = times[ i + 1 ] - times[ i - 1 ];
		return dt > 0 ? ( vals[ i + 1 ] - vals[ i - 1 ] ) / dt : 0;

	} );

}

function hermite( times, vals, tans, t ) {

	const n = times.length;
	if ( n === 1 || t <= times[ 0 ] ) return vals[ 0 ];
	if ( t >= times[ n - 1 ] ) return vals[ n - 1 ];
	let i = 0;
	while ( i < n - 2 && t > times[ i + 1 ] ) i ++;
	const h = times[ i + 1 ] - times[ i ];
	const u = ( t - times[ i ] ) / h, u2 = u * u, u3 = u2 * u;
	return ( 2 * u3 - 3 * u2 + 1 ) * vals[ i ] + ( u3 - 2 * u2 + u ) * h * tans[ i ] + ( - 2 * u3 + 3 * u2 ) * vals[ i + 1 ] + ( u3 - u2 ) * h * tans[ i + 1 ];

}

/** A sampler for a list of keys: at(t) -> { position, lookAt, fov } on the smooth curve. */
export function makeCurve( keys ) {

	const ks = keys.filter( ( k, i ) => i === 0 || k.time - keys[ i - 1 ].time > 1e-4 ); // times must increase
	const times = ks.map( k => k.time );
	const pos = [ 0, 1, 2 ].map( d => ks.map( k => k.position[ d ] ) );
	const posT = pos.map( v => tangents( times, v ) );

	const allLook = ks.length > 0 && ks.every( k => isVec3( k.lookAt ) );
	const look = allLook ? [ 0, 1, 2 ].map( d => ks.map( k => k.lookAt[ d ] ) ) : null;
	const lookT = look ? look.map( v => tangents( times, v ) ) : null;

	const allFov = ks.length > 0 && ks.every( k => k.fov !== null );
	const fov = allFov ? ks.map( k => k.fov ) : null;
	const fovT = fov ? tangents( times, fov ) : null;

	return {
		start: times[ 0 ],
		end: times[ times.length - 1 ],
		at( t ) {

			const out = { position: [ 0, 1, 2 ].map( d => hermite( times, pos[ d ], posT[ d ], t ) ) };
			if ( look ) out.lookAt = [ 0, 1, 2 ].map( d => hermite( times, look[ d ], lookT[ d ], t ) );
			else {

				// a named aim target (selector) cannot be curved: use the nearest key at or after t
				const k = ks.find( k => k.time >= t ) || ks[ ks.length - 1 ];
				out.lookAt = k.lookAt;

			}

			out.fov = fov ? hermite( times, fov, fovT, t ) : null;
			return out;

		},
	};

}

/**
 * The events the compiler plays for a spline track: the position keys become a
 * dense run of tiny linear legs sampled from the curve. Events that are not
 * position keys (e.g. a lone fov animate) pass through unchanged.
 */
export function expandSplineEvents( events, dt = SPLINE_DT ) {

	const keys = cameraKeys( events );
	if ( keys.length === 0 ) return events;
	const keyIds = new Set( keys.map( k => k.id ) );
	const others = ( events || [] ).filter( e => ! keyIds.has( e.id ) );
	if ( keys.length === 1 ) return events;

	const curve = makeCurve( keys );
	const out = [];
	const n = Math.max( 1, Math.ceil( ( curve.end - curve.start ) / dt ) );
	let prevT = curve.start;
	for ( let i = 0; i <= n; i ++ ) {

		const t = i === n ? curve.end : r3( curve.start + i * ( curve.end - curve.start ) / n );
		const s = curve.at( t );
		const props = { to: { position: s.position.map( r4 ) } };
		if ( s.lookAt != null ) props.lookAt = Array.isArray( s.lookAt ) ? s.lookAt.map( r4 ) : s.lookAt;
		if ( s.fov !== null ) props.fov = r4( s.fov );
		const at = i === 0 ? Math.max( 0, r3( t - 0.001 ) ) : r3( prevT + 0.001 );
		const dur = Math.max( 0.001, r3( t - at ) );
		out.push( { id: 'sp_' + i, at, op: 'animate', args: { props, easing: 'linear', duration: dur }, dur } );
		prevT = t;

	}

	return out.concat( others ).sort( ( a, b ) => a.at - b.at );

}

/** Points along a track for drawing: the curve for spline tracks, the key polyline otherwise. */
export function samplePath( events, spline, dt = 0.25 ) {

	const keys = cameraKeys( events );
	if ( keys.length < 2 ) return keys.map( k => k.position );
	if ( ! spline ) return keys.map( k => k.position );
	const curve = makeCurve( keys );
	const pts = [];
	const n = Math.max( 2, Math.ceil( ( curve.end - curve.start ) / dt ) );
	for ( let i = 0; i <= n; i ++ ) pts.push( curve.at( curve.start + i * ( curve.end - curve.start ) / n ).position );
	return pts;

}

const DEG = 180 / Math.PI;

/** Angle in degrees between the camera's view direction at two poses (0 when either has no vec3 aim). */
function aimAngle( posA, lookA, posB, lookB ) {

	if ( ! isVec3( lookA ) || ! isVec3( lookB ) ) return 0;
	const a = lookA.map( ( v, n ) => v - posA[ n ] ), b = lookB.map( ( v, n ) => v - posB[ n ] );
	const la = Math.hypot( ...a ), lb = Math.hypot( ...b );
	if ( la < 1e-9 || lb < 1e-9 ) return 0;
	const dot = ( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] ) / ( la * lb );
	return Math.acos( Math.max( - 1, Math.min( 1, dot ) ) ) * DEG;

}

/**
 * Worst deviation of the dropped keys from the curve through the picked ones, as a multiple of
 * the tolerances (<= 1 means every dropped key is within tolerance). Position is in scene units.
 * `rotation` (degrees of view direction) and `fov` (degrees) are only checked when given; without
 * `rotation` the aim point counts at half weight in scene units (the original behaviour).
 */
function maxError( keys, picked, { tolerance = 0.01, rotation, fov } = {} ) {

	const curve = makeCurve( picked.map( i => keys[ i ] ) );
	const tol = Math.max( tolerance, 1e-9 );
	let worst = 0, at = - 1;
	for ( let i = 0; i < keys.length; i ++ ) {

		if ( picked.includes( i ) ) continue;
		const s = curve.at( keys[ i ].time );
		const p = s.position, k = keys[ i ].position;
		let e = Math.hypot( p[ 0 ] - k[ 0 ], p[ 1 ] - k[ 1 ], p[ 2 ] - k[ 2 ] ) / tol;
		if ( rotation > 0 ) e = Math.max( e, aimAngle( p, s.lookAt, k, keys[ i ].lookAt ) / rotation );
		else if ( isVec3( keys[ i ].lookAt ) && isVec3( s.lookAt ) ) e = Math.max( e, 0.5 * Math.hypot( ...s.lookAt.map( ( v, n ) => v - keys[ i ].lookAt[ n ] ) ) / tol );
		if ( fov > 0 && keys[ i ].fov !== null && s.fov !== null ) e = Math.max( e, Math.abs( s.fov - keys[ i ].fov ) / fov );
		if ( e > worst ) { worst = e; at = i; }

	}
	return { worst, at };

}

/** Indices of local maxima/minima of `vals` that stand out by at least `prominence` (a zigzag filter, so jitter is ignored). */
function extremaOf( vals, prominence ) {

	const out = [];
	if ( vals.length < 3 ) return out;
	let hi = 0, lo = 0, dir = 0;
	for ( let i = 1; i < vals.length; i ++ ) {

		if ( vals[ i ] > vals[ hi ] ) hi = i;
		if ( vals[ i ] < vals[ lo ] ) lo = i;
		if ( dir >= 0 && vals[ hi ] - vals[ i ] >= prominence ) { out.push( hi ); dir = - 1; lo = i; hi = i; }
		else if ( dir <= 0 && vals[ i ] - vals[ lo ] >= prominence ) { out.push( lo ); dir = 1; hi = i; lo = i; }

	}
	return out;

}

/**
 * Keys a move must keep to stay the same shot: the first and last, the key nearest each time in
 * `beats` (e.g. a shot's start and end in the render camera sequence), the turning points of its
 * speed (where it eases in or out), and the closest / farthest approach to a fixed aim point.
 * Returns sorted, unique indices into `keys`.
 */
export function beatIndices( keys, { beats = [] } = {} ) {

	const n = keys.length;
	if ( n === 0 ) return [];
	const set = new Set( [ 0, n - 1 ] );
	for ( const t of beats ) {

		if ( ! Number.isFinite( t ) ) continue;
		let best = 0;
		for ( let i = 1; i < n; i ++ ) if ( Math.abs( keys[ i ].time - t ) < Math.abs( keys[ best ].time - t ) ) best = i;
		set.add( best );

	}

	if ( n >= 5 ) {

		// speed at each key: mean of the legs on either side, then a 3-key moving average against baking jitter
		const leg = [];
		for ( let i = 0; i < n - 1; i ++ ) {

			const dt = Math.max( keys[ i + 1 ].time - keys[ i ].time, 1e-6 );
			leg.push( Math.hypot( ...keys[ i + 1 ].position.map( ( v, d ) => v - keys[ i ].position[ d ] ) ) / dt );

		}
		const raw = keys.map( ( _, i ) => ( leg[ Math.max( 0, i - 1 ) ] + leg[ Math.min( n - 2, i ) ] ) / 2 );
		const speed = raw.map( ( _, i ) => ( raw[ Math.max( 0, i - 1 ) ] + raw[ i ] + raw[ Math.min( n - 1, i + 1 ) ] ) / 3 );
		const top = Math.max( ...speed );
		if ( top > 1e-9 ) extremaOf( speed, 0.1 * top ).forEach( i => set.add( i ) );

		if ( keys.every( k => isVec3( k.lookAt ) ) ) {

			const dist = keys.map( k => Math.hypot( ...k.lookAt.map( ( v, d ) => v - k.position[ d ] ) ) );
			let lo = 0, hi = 0;
			dist.forEach( ( d, i ) => { if ( d < dist[ lo ] ) lo = i; if ( d > dist[ hi ] ) hi = i; } );
			if ( dist[ hi ] - dist[ lo ] > 1e-6 ) { set.add( lo ); set.add( hi ); }

		}

	}
	return [ ...set ].sort( ( a, b ) => a - b );

}

/**
 * Reduce a dense run of keys to a few that reproduce the path. Greedy: start with
 * the ends (and, with `keepBeats`, the beat keys), keep adding the key the curve misses
 * by the most until every other key is within tolerance or `maxKeys` is reached.
 *   tolerance  position, scene units (0.01)
 *   rotation   view direction, degrees (unset: the aim point is checked in scene units instead)
 *   fov        field of view, degrees (unset: not checked)
 *   keepBeats  always keep beatIndices(keys, { beats }); maxKeys never drops below their count
 * Returns indices into `keys`; `.worst` is the final error as a multiple of the tolerances.
 */
export function simplifyKeys( keys, { tolerance = 0.01, rotation, fov, maxKeys = 20, keepBeats = false, beats = [] } = {} ) {

	if ( keys.length <= 2 ) return Object.assign( keys.map( ( _, i ) => i ), { worst: 0 } );
	const picked = keepBeats ? beatIndices( keys, { beats } ) : [ 0, keys.length - 1 ];
	const cap = Math.max( maxKeys, picked.length );
	let worst = 0;
	for ( ;; ) {

		const r = maxError( keys, picked, { tolerance, rotation, fov } );
		worst = r.worst;
		if ( picked.length >= cap || worst <= 1 || r.at < 0 ) break;
		picked.push( r.at );
		picked.sort( ( a, b ) => a - b );

	}
	return Object.assign( picked, { worst } );

}

/** New key events for the picked keys (first one is the start key, the rest arrive on their times). */
export function eventsFromKeys( keys, indices, idPrefix = 'k' ) {

	const evs = [];
	let prev = null;
	indices.forEach( ( ix, n ) => {

		const k = keys[ ix ];
		const props = { to: { position: k.position.map( r4 ) } };
		if ( k.lookAt != null ) props.lookAt = Array.isArray( k.lookAt ) ? k.lookAt.map( r4 ) : k.lookAt;
		if ( k.fov !== null ) props.fov = r4( k.fov );
		const at = n === 0 ? Math.max( 0, r3( k.time - 0.001 ) ) : r3( prev.time + 0.001 );
		const dur = Math.max( 0.001, r3( k.time - at ) );
		evs.push( { id: idPrefix + '_' + n + '_' + Math.round( k.time * 1000 ), at, op: 'animate', args: { props, easing: 'linear', duration: dur }, dur } );
		prev = k;

	} );
	return evs;

}
