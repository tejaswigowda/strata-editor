// Hair SHAPE: the silhouette of the photo's hair mask, the silhouette of the VRM's hair mesh, and a warp
// that moves the VRM's existing hairstyle toward the photo's silhouette. It scales and shifts what the VRM
// has, within limits; it cannot change the cut (curls, braids, a different style). Pure: arrays in, numbers out.
//
// Both silhouettes are measured the same way, in the same head units (u = sideways in head widths W, v = up
// from the eye line in units of E, the chin-to-eye-line height), so photo size and distance drop out:
//   half widths   how far the hair reaches out to the image-right and image-left, per height band
//   crown         how high the hair reaches, per sideways band
//   fringe        where the hair's lower edge sits over the forehead, per sideways band
//   scalar summary (top, width, length, hairline), used when a profile is not available
//
// "Image-right" is the right of the picture. On a VRM that faces -z that is model -x (see uOf).

const clamp = ( v, a, b ) => Math.min( b, Math.max( a, v ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const smooth = t => t * t * ( 3 - 2 * t );
const round = ( v, d = 3 ) => v === null || v === undefined ? null : +v.toFixed( d );

/** The measurement grid. Bin i covers [lo + i * step, lo + (i + 1) * step). */
export const GRID = { v: { lo: - 2.0, step: 0.25, n: 18 }, u: { lo: - 0.6, step: 0.1, n: 12 } };
const vBin = v => { const i = Math.floor( ( v - GRID.v.lo ) / GRID.v.step ); return i >= 0 && i < GRID.v.n ? i : - 1; };
const uBin = u => { const i = Math.floor( ( u - GRID.u.lo ) / GRID.u.step ); return i >= 0 && i < GRID.u.n ? i : - 1; };
const vCenter = i => GRID.v.lo + ( i + 0.5 ) * GRID.v.step;
const uCenter = j => GRID.u.lo + ( j + 0.5 ) * GRID.u.step;
const nulls = n => Array.from( { length: n }, () => null );

function newProfile() {

	return { halfR: nulls( GRID.v.n ), halfL: nulls( GRID.v.n ), topByU: nulls( GRID.u.n ), lineByU: nulls( GRID.u.n ) };

}

// ── from the photo ──────────────────────────────────────────────────────────

/**
 * @param {{x:number,y:number}[]} landmarks MediaPipe landmarks (0–1 of the image)
 * @param {Uint8Array} mask width*height, `hairValue` = hair
 * @returns {object|null} { topV, widthW, lengthV, hairlineV, profile, cropped } (null where the photo cannot tell)
 */
export function hairShapeFromMask( landmarks, mask, { width, height, hairValue = 1 } ) {

	if ( ! landmarks || landmarks.length < 468 ) return null;
	const P = i => [ landmarks[ i ].x * width, - landmarks[ i ].y * height ];
	const mid = ( ...ids ) => { const p = ids.map( P ); return [ p.reduce( ( s, a ) => s + a[ 0 ], 0 ) / p.length, p.reduce( ( s, a ) => s + a[ 1 ], 0 ) / p.length ]; };

	const [ ex, ey ] = mid( 33, 133, 263, 362 );
	const roll = Math.atan2( P( 263 )[ 1 ] - P( 33 )[ 1 ], P( 263 )[ 0 ] - P( 33 )[ 0 ] );
	const c = Math.cos( roll ), s = Math.sin( roll );
	const rot = ( x, y ) => [ ( x - ex ) * c + ( y - ey ) * s, - ( x - ex ) * s + ( y - ey ) * c ]; // level the eye line
	const earR = rot( ...P( 234 ) ), earL = rot( ...P( 454 ) ), chin = rot( ...P( 152 ) );
	const W = Math.hypot( earR[ 0 ] - earL[ 0 ], earR[ 1 ] - earL[ 1 ] ), E = - chin[ 1 ];
	if ( ! ( W > 0 ) || ! ( E > 0 ) ) return null;

	let topV = - Infinity, bottomV = Infinity, uMin = Infinity, uMax = - Infinity, lineV = Infinity, n = 0, lineN = 0;
	const cropped = { top: false, side: false, bottom: false };
	const prof = newProfile();
	const rowCut = new Array( GRID.v.n ).fill( false ), colCut = new Array( GRID.u.n ).fill( false );

	for ( let y = 0; y < height; y ++ ) {

		for ( let x = 0; x < width; x ++ ) {

			if ( mask[ y * width + x ] !== hairValue ) continue;
			n ++;
			const edgeX = x === 0 || x === width - 1, edgeTop = y === 0;
			if ( edgeTop ) cropped.top = true;
			if ( edgeX ) cropped.side = true;
			if ( y === height - 1 ) cropped.bottom = true;

			const [ rx, ry ] = rot( x, - y );
			const u = rx / W, v = ry / E;
			if ( Math.abs( u ) < 0.6 && v > topV ) topV = v;
			if ( Math.abs( u ) < 1.0 && v > - 3 && v < bottomV ) bottomV = v;
			if ( v >= 0 && v <= 0.7 ) { if ( u < uMin ) uMin = u; if ( u > uMax ) uMax = u; }
			if ( Math.abs( u ) < 0.12 && v > 0.3 ) { lineN ++; if ( v < lineV ) lineV = v; }

			// profile: sideways reach per height band, crown height and fringe edge per sideways band
			const i = vBin( v );
			if ( i >= 0 ) {

				if ( edgeX ) rowCut[ i ] = true;
				if ( u > 0 && ( prof.halfR[ i ] === null || u > prof.halfR[ i ] ) ) prof.halfR[ i ] = u;
				if ( u < 0 && ( prof.halfL[ i ] === null || - u > prof.halfL[ i ] ) ) prof.halfL[ i ] = - u;

			}
			const j = uBin( u );
			if ( j >= 0 ) {

				if ( edgeTop ) colCut[ j ] = true;
				if ( prof.topByU[ j ] === null || v > prof.topByU[ j ] ) prof.topByU[ j ] = v;
				if ( v > 0.2 && ( prof.lineByU[ j ] === null || v < prof.lineByU[ j ] ) ) prof.lineByU[ j ] = v;

			}

		}

	}
	if ( ! n ) return null;

	// a band that touches the frame edge is not a real silhouette: drop it
	for ( let i = 0; i < GRID.v.n; i ++ ) if ( rowCut[ i ] ) { prof.halfR[ i ] = null; prof.halfL[ i ] = null; }
	for ( let j = 0; j < GRID.u.n; j ++ ) if ( colCut[ j ] ) prof.topByU[ j ] = null;
	const r = a => a.map( v => round( v ) );

	return {
		topV: cropped.top || topV === - Infinity ? null : round( topV ),
		widthW: cropped.side || uMax === - Infinity ? null : round( uMax - uMin ),
		lengthV: cropped.bottom || bottomV === Infinity ? null : round( bottomV ),
		hairlineV: lineN > 20 ? round( lineV ) : null,
		profile: { halfR: r( prof.halfR ), halfL: r( prof.halfL ), topByU: r( prof.topByU ), lineByU: r( prof.lineByU ) },
		cropped,
	};

}

// ── from the VRM ────────────────────────────────────────────────────────────

/** Sideways position in head widths, positive toward the right of the picture. */
const uOf = ( x, m ) => ( m.front < 0 ? - x : x ) / m.W;

/**
 * @param {Float32Array} positions
 * @param {Iterable<number>} ids vertex indices of the hair
 * @param {{eyeY:number,E:number,W:number,front:number,zc:number}} m the face measurement (same space)
 */
export function measureHair( positions, ids, m ) {

	const { eyeY, E, W, front, zc } = m;
	let top = - Infinity, bottom = Infinity, xMin = Infinity, xMax = - Infinity, line = Infinity;
	const prof = newProfile();

	for ( const i of ids ) {

		const x = positions[ i * 3 ], y = positions[ i * 3 + 1 ], z = positions[ i * 3 + 2 ], v = ( y - eyeY ) / E, u = uOf( x, m );
		const isFront = front * ( z - zc ) > 0;
		if ( Math.abs( x ) < 0.6 * W && y > top ) top = y;
		if ( Math.abs( x ) < 1.0 * W && y < bottom ) bottom = y;
		if ( v >= 0 && v <= 0.7 ) { if ( x < xMin ) xMin = x; if ( x > xMax ) xMax = x; }
		if ( Math.abs( x ) < 0.12 * W && v > 0.3 && isFront && v < line ) line = v;

		const bi = vBin( v );
		if ( bi >= 0 ) {

			if ( u > 0 && ( prof.halfR[ bi ] === null || u > prof.halfR[ bi ] ) ) prof.halfR[ bi ] = u;
			if ( u < 0 && ( prof.halfL[ bi ] === null || - u > prof.halfL[ bi ] ) ) prof.halfL[ bi ] = - u;

		}
		const j = uBin( u );
		if ( j >= 0 ) {

			if ( prof.topByU[ j ] === null || v > prof.topByU[ j ] ) prof.topByU[ j ] = v;
			if ( isFront && v > 0.2 && ( prof.lineByU[ j ] === null || v < prof.lineByU[ j ] ) ) prof.lineByU[ j ] = v;

		}

	}
	return {
		topV: top === - Infinity ? null : ( top - eyeY ) / E,
		widthW: xMax === - Infinity ? null : ( xMax - xMin ) / W,
		lengthV: bottom === Infinity ? null : ( bottom - eyeY ) / E,
		hairlineV: line === Infinity ? null : line,
		profile: prof,
	};

}

// ── the plan ────────────────────────────────────────────────────────────────

const LIMITS = { volume: [ 0.85, 1.2 ], top: [ 0.8, 1.25 ], length: [ 0.6, 1.6 ], fringe: 0.35, hairline: [ 0.35, 1.3 ], maxMove: 0.04 };

// ratios (or shifts) per bin, with gaps filled by interpolating between the valid bins, flat past the ends
// Beyond the measured range the value fades back to `restValue` (1 for ratios, 0 for shifts; null = stay flat) over `fade`, so a measurement taken at
// the ears does not stretch the whole head.
function curve( values, centerOf, fade, restValue = 1 ) {

	const pts = values.map( ( v, i ) => v === null ? null : [ centerOf( i ), v ] ).filter( Boolean );
	if ( ! pts.length ) return null;
	const rest = ( edge, t ) => restValue === null ? edge[ 1 ] : lerp( edge[ 1 ], restValue, clamp( Math.abs( t - edge[ 0 ] ) / fade, 0, 1 ) );
	return t => {

		if ( t <= pts[ 0 ][ 0 ] ) return rest( pts[ 0 ], t );
		for ( let k = 1; k < pts.length; k ++ ) if ( t <= pts[ k ][ 0 ] ) { const [ a, av ] = pts[ k - 1 ], [ b, bv ] = pts[ k ]; return lerp( av, bv, ( t - a ) / ( b - a ) ); }
		return rest( pts[ pts.length - 1 ], t );

	};

}

const ratio = ( ref, cur, min, lo, hi ) => ref.map( ( r, i ) => r !== null && cur[ i ] !== null && cur[ i ] > min && r > min ? clamp( r / cur[ i ], lo, hi ) : null );

/** @returns {object} plan: what applies and by how much (it is also the report) */
export function planHair( cur, ref, m, strength ) {

	const s = clamp( strength, 0, 1 );
	const plan = { m, strength: s, mode: 'scalar', volume: null, top: null, length: null, fringe: null, profile: null };
	const rp = ref.profile, cp = cur.profile;

	if ( rp && cp ) {

		plan.mode = 'silhouette';
		const sm = a => curve( a, vCenter, 0.5 ), um = a => curve( a, uCenter, 0.3 );
		const widthR = sm( ratio( rp.halfR, cp.halfR, 0.25, ...LIMITS.volume ) ), widthL = sm( ratio( rp.halfL, cp.halfL, 0.25, ...LIMITS.volume ) );
		const crown = um( ratio( rp.topByU, cp.topByU, 0.3, ...LIMITS.top ) );
		// fringe: where the lower edge should sit, per sideways band
		const shift = rp.lineByU.map( ( r, j ) => r !== null && cp.lineByU[ j ] !== null ? clamp( clamp( r, ...LIMITS.hairline ) - cp.lineByU[ j ], - LIMITS.fringe, LIMITS.fringe ) : null );
		const fringe = curve( shift, uCenter, 0.3, 0 ), fringeAt = curve( cp.lineByU, uCenter, 0.3, null ); // shifts fade to 0; the edge position stays flat
		// length: how far down each side reaches (the lowest band that has hair)
		const lowest = a => { for ( let i = 0; i < a.length; i ++ ) if ( a[ i ] !== null ) return vCenter( i ) - GRID.v.step / 2; return null; };
		const lenR = lowest( rp.halfR ), lenL = lowest( rp.halfL ), curR = lowest( cp.halfR ), curL = lowest( cp.halfL );
		const lenRatio = ( refV, curV ) => refV !== null && curV !== null && 0.1 - refV > 0.05 && 0.1 - curV > 0.05 ? clamp( ( 0.1 - refV ) / ( 0.1 - curV ), ...LIMITS.length ) : null;
		plan.profile = { widthR, widthL, crown, fringe, fringeAt, lengthR: lenRatio( lenR, curR ), lengthL: lenRatio( lenL, curL ) };
		const any = widthR || widthL || crown || fringe || plan.profile.lengthR || plan.profile.lengthL;
		if ( ! any ) plan.mode = 'scalar';

	}
	if ( plan.mode === 'scalar' ) {

		if ( ref.widthW && cur.widthW ) plan.volume = clamp( ref.widthW / cur.widthW, ...LIMITS.volume );
		if ( ref.topV > 0 && cur.topV > 0 ) plan.top = clamp( ref.topV / cur.topV, ...LIMITS.top );
		if ( ref.lengthV !== null && ref.lengthV !== undefined && cur.lengthV !== null ) {

			const refL = 0.1 - ref.lengthV, curL = 0.1 - cur.lengthV; // how far below the ear line the hair hangs
			if ( refL > 0.05 && curL > 0.05 ) plan.length = clamp( refL / curL, ...LIMITS.length );

		}
		if ( ref.hairlineV !== null && ref.hairlineV !== undefined && cur.hairlineV !== null ) {

			const target = clamp( ref.hairlineV, ...LIMITS.hairline );
			plan.fringe = { v0: cur.hairlineV, shift: clamp( target - cur.hairlineV, - LIMITS.fringe, LIMITS.fringe ) };

		}

	}
	return plan;

}

/** What the plan does, for the report: ratios (1 = unchanged) at a few heights / positions, and fringe shifts in units of E. */
export function summarizePlan( plan ) {

	const s = plan.strength, f = k => k === null || k === undefined ? null : +lerp( 1, k, s ).toFixed( 3 );
	if ( plan.mode === 'silhouette' ) {

		const p = plan.profile, at = ( fn, ts ) => fn ? ts.map( t => f( fn( t ) ) ) : null;
		return { mode: 'silhouette', sides: { right: at( p.widthR, [ - 0.5, 0.25, 1.0 ] ), left: at( p.widthL, [ - 0.5, 0.25, 1.0 ] ) }, crown: at( p.crown, [ - 0.3, 0, 0.3 ] ), fringeShiftE: p.fringe ? [ - 0.3, 0, 0.3 ].map( t => +( p.fringe( t ) * s ).toFixed( 3 ) ) : null, length: { right: f( p.lengthR ), left: f( p.lengthL ) } };

	}
	return { mode: 'scalar', volume: f( plan.volume ), top: f( plan.top ), length: f( plan.length ), fringeShiftE: plan.fringe ? +( plan.fringe.shift * s ).toFixed( 3 ) : null };

}

// ── the warp ────────────────────────────────────────────────────────────────

export function warpHairPoint( plan, x, y, z ) {

	const { eyeY, E, W, front, zc } = plan.m;
	const v = ( y - eyeY ) / E, u = uOf( x, plan.m );
	const s = plan.strength;
	let dx = 0, dy = 0, dz = 0;
	const gate = front * ( z - zc ) > 0 ? 1 : 0;

	if ( plan.mode === 'silhouette' ) {

		const p = plan.profile;
		// sideways reach per height band, each side with its own ratio (they meet smoothly at the middle)
		const kr = p.widthR ? p.widthR( v ) : 1, kl = p.widthL ? p.widthL( v ) : 1;
		const mixR = smooth( clamp( ( u + 0.08 ) / 0.16, 0, 1 ) );
		const k = lerp( lerp( 1, kl, s ), lerp( 1, kr, s ), mixR );
		dx += ( k - 1 ) * x; dz += ( k - 1 ) * ( z - zc );
		// crown height per sideways band
		if ( p.crown ) dy += ( lerp( 1, p.crown( clamp( u, GRID.u.lo, GRID.u.lo + GRID.u.n * GRID.u.step ) ), s ) - 1 ) * ( y - ( eyeY + 0.5 * E ) ) * smooth( clamp( ( v - 0.5 ) / 0.6, 0, 1 ) );
		// length below the ear line, per side
		const kLen = lerp( lerp( 1, p.lengthL ?? 1, s ), lerp( 1, p.lengthR ?? 1, s ), mixR );
		dy += ( kLen - 1 ) * ( y - ( eyeY + 0.1 * E ) ) * smooth( clamp( ( 0.1 - v ) / 0.6, 0, 1 ) );
		// the fringe's lower edge, following the photo's edge across the forehead
		if ( p.fringe && Math.abs( u ) < 0.6 ) {

			const v0 = p.fringeAt ? p.fringeAt( u ) : 0.5;
			dy += s * p.fringe( u ) * E * gate * Math.exp( - 0.5 * ( ( v - v0 ) / 0.18 ) ** 2 );

		}

	} else {

		if ( plan.volume ) { const k = lerp( 1, plan.volume, s ); dx += ( k - 1 ) * x; dz += ( k - 1 ) * ( z - zc ); }
		if ( plan.top ) dy += ( lerp( 1, plan.top, s ) - 1 ) * ( y - ( eyeY + 0.5 * E ) ) * smooth( clamp( ( v - 0.5 ) / 0.6, 0, 1 ) );
		if ( plan.length ) dy += ( lerp( 1, plan.length, s ) - 1 ) * ( y - ( eyeY + 0.1 * E ) ) * smooth( clamp( ( 0.1 - v ) / 0.6, 0, 1 ) );
		if ( plan.fringe ) dy += s * plan.fringe.shift * E * gate * Math.exp( - 0.5 * ( ( v - plan.fringe.v0 ) / 0.18 ) ** 2 ) * ( 1 - smooth( clamp( ( Math.abs( x ) / W - 0.45 ) / 0.25, 0, 1 ) ) );

	}

	const len = Math.hypot( dx, dy, dz );
	const k = len > LIMITS.maxMove ? LIMITS.maxMove / len : 1;
	return [ dx * k, dy * k, dz * k ];

}
