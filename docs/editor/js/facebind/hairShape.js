// Hair SHAPE: measured from the photo's hair mask, measured on the VRM's hair mesh, and a gentle warp
// that moves the VRM's existing hairstyle toward the photo's volume, height, length and fringe.
// It cannot change the style (curls, braids, a different cut): it scales and shifts what the VRM has,
// within limits. Pure: arrays in, numbers out.
//
// Units match the face code: u = sideways in head widths (W), v = up from the eye line in units of E
// (the chin-to-eye-line height), so photo size and distance drop out.

const clamp = ( v, a, b ) => Math.min( b, Math.max( a, v ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const smooth = t => t * t * ( 3 - 2 * t );
const round = ( v, d = 3 ) => v === null ? null : +v.toFixed( d );

// ── from the photo ──────────────────────────────────────────────────────────

/**
 * @param {{x:number,y:number}[]} landmarks MediaPipe landmarks (0–1 of the image)
 * @param {Uint8Array} mask width*height, `hairValue` = hair
 * @returns {object|null} { topV, widthW, lengthV, hairlineV } (each null when the photo cannot tell), plus `cropped` flags
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

	for ( let y = 0; y < height; y ++ ) {

		for ( let x = 0; x < width; x ++ ) {

			if ( mask[ y * width + x ] !== hairValue ) continue;
			n ++;
			if ( y === 0 ) cropped.top = true;
			if ( x === 0 || x === width - 1 ) cropped.side = true;
			if ( y === height - 1 ) cropped.bottom = true;
			const [ rx, ry ] = rot( x, - y );
			const u = rx / W, v = ry / E;
			if ( Math.abs( u ) < 0.6 && v > topV ) topV = v;
			if ( Math.abs( u ) < 1.0 && v > - 3 && v < bottomV ) bottomV = v;
			if ( v >= 0 && v <= 0.7 ) { if ( u < uMin ) uMin = u; if ( u > uMax ) uMax = u; }
			if ( Math.abs( u ) < 0.12 && v > 0.3 ) { lineN ++; if ( v < lineV ) lineV = v; }

		}

	}
	if ( ! n ) return null;

	return {
		topV: cropped.top || topV === - Infinity ? null : round( topV ),
		widthW: cropped.side || uMax === - Infinity ? null : round( uMax - uMin ),
		lengthV: cropped.bottom || bottomV === Infinity ? null : round( bottomV ),
		hairlineV: lineN > 20 ? round( lineV ) : null,
		cropped,
	};

}

// ── from the VRM ────────────────────────────────────────────────────────────

/**
 * @param {Float32Array} positions
 * @param {Iterable<number>} ids vertex indices of the hair
 * @param {{eyeY:number,E:number,W:number,front:number,zc:number}} m the face measurement (same space)
 */
export function measureHair( positions, ids, m ) {

	const { eyeY, E, W, front, zc } = m;
	let top = - Infinity, bottom = Infinity, xMin = Infinity, xMax = - Infinity, line = Infinity;
	for ( const i of ids ) {

		const x = positions[ i * 3 ], y = positions[ i * 3 + 1 ], z = positions[ i * 3 + 2 ], v = ( y - eyeY ) / E;
		if ( Math.abs( x ) < 0.6 * W && y > top ) top = y;
		if ( Math.abs( x ) < 1.0 * W && y < bottom ) bottom = y;
		if ( v >= 0 && v <= 0.7 ) { if ( x < xMin ) xMin = x; if ( x > xMax ) xMax = x; }
		if ( Math.abs( x ) < 0.12 * W && v > 0.3 && front * ( z - zc ) > 0 && v < line ) line = v;

	}
	return {
		topV: top === - Infinity ? null : ( top - eyeY ) / E,
		widthW: xMax === - Infinity ? null : ( xMax - xMin ) / W,
		lengthV: bottom === Infinity ? null : ( bottom - eyeY ) / E,
		hairlineV: line === Infinity ? null : line,
	};

}

// ── the warp ────────────────────────────────────────────────────────────────

const LIMITS = { volume: [ 0.85, 1.2 ], top: [ 0.8, 1.25 ], length: [ 0.6, 1.6 ], fringe: 0.35, hairline: [ 0.35, 1.3 ], maxMove: 0.04 };

/** @returns {object} plan: which parts apply and by how much (also what the report shows) */
export function planHair( cur, ref, m, strength ) {

	const s = clamp( strength, 0, 1 );
	const plan = { m, strength: s, volume: null, top: null, length: null, fringe: null };

	if ( ref.widthW && cur.widthW ) plan.volume = clamp( lerp( 1, ref.widthW / cur.widthW, s ), ...LIMITS.volume );
	if ( ref.topV > 0 && cur.topV > 0 ) plan.top = clamp( lerp( 1, ref.topV / cur.topV, s ), ...LIMITS.top );
	if ( ref.lengthV !== null && ref.lengthV !== undefined && cur.lengthV !== null ) {

		const refL = 0.1 - ref.lengthV, curL = 0.1 - cur.lengthV; // how far below the ear line the hair hangs
		if ( refL > 0.05 && curL > 0.05 ) plan.length = clamp( lerp( 1, refL / curL, s ), ...LIMITS.length );

	}
	if ( ref.hairlineV !== null && ref.hairlineV !== undefined && cur.hairlineV !== null ) {

		const target = clamp( ref.hairlineV, ...LIMITS.hairline );
		plan.fringe = { v0: cur.hairlineV, shift: clamp( s * ( target - cur.hairlineV ), - LIMITS.fringe, LIMITS.fringe ) * m.E };

	}
	return plan;

}

export function warpHairPoint( plan, x, y, z ) {

	const { eyeY, E, W, front, zc } = plan.m;
	const v = ( y - eyeY ) / E;
	let dx = 0, dy = 0, dz = 0;

	if ( plan.volume ) { dx += ( plan.volume - 1 ) * x; dz += ( plan.volume - 1 ) * ( z - zc ); }
	if ( plan.top ) dy += ( plan.top - 1 ) * ( y - ( eyeY + 0.5 * E ) ) * smooth( clamp( ( v - 0.5 ) / 0.6, 0, 1 ) );
	if ( plan.length ) dy += ( plan.length - 1 ) * ( y - ( eyeY + 0.1 * E ) ) * smooth( clamp( ( 0.1 - v ) / 0.6, 0, 1 ) );
	if ( plan.fringe ) {

		// the front fringe's lower edge, near the middle of the forehead
		const gate = front * ( z - zc ) > 0 ? 1 : 0;
		dy += plan.fringe.shift * gate * Math.exp( - 0.5 * ( ( v - plan.fringe.v0 ) / 0.18 ) ** 2 ) * ( 1 - smooth( clamp( ( Math.abs( x ) / W - 0.45 ) / 0.25, 0, 1 ) ) );

	}

	const len = Math.hypot( dx, dy, dz );
	const k = len > LIMITS.maxMove ? LIMITS.maxMove / len : 1;
	return [ dx * k, dy * k, dz * k ];

}
