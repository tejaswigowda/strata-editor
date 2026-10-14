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

function maxError( keys, picked ) {

	// worst position / aim deviation of the dropped keys from the curve through the picked ones
	const curve = makeCurve( picked.map( i => keys[ i ] ) );
	let worst = 0, at = - 1;
	for ( let i = 0; i < keys.length; i ++ ) {

		if ( picked.includes( i ) ) continue;
		const s = curve.at( keys[ i ].time );
		const p = s.position, k = keys[ i ].position;
		let d = Math.hypot( p[ 0 ] - k[ 0 ], p[ 1 ] - k[ 1 ], p[ 2 ] - k[ 2 ] );
		// the aim point matters too, at half weight (it sits further from the camera)
		if ( isVec3( keys[ i ].lookAt ) && isVec3( s.lookAt ) ) d = Math.max( d, 0.5 * Math.hypot( ...s.lookAt.map( ( v, n ) => v - keys[ i ].lookAt[ n ] ) ) );
		if ( d > worst ) { worst = d; at = i; }

	}
	return { worst, at };

}

/**
 * Reduce a dense run of keys to a few that reproduce the path. Greedy: start with
 * the ends, keep adding the key the curve misses by the most until every other key
 * is within `tolerance` (world units) or `maxKeys` is reached.
 * Returns indices into `keys`.
 */
export function simplifyKeys( keys, { tolerance = 0.01, maxKeys = 20 } = {} ) {

	if ( keys.length <= 2 ) return keys.map( ( _, i ) => i );
	const picked = [ 0, keys.length - 1 ];
	while ( picked.length < maxKeys ) {

		const { worst, at } = maxError( keys, picked );
		if ( worst <= tolerance || at < 0 ) break;
		picked.push( at );
		picked.sort( ( a, b ) => a - b );

	}
	return picked;

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
