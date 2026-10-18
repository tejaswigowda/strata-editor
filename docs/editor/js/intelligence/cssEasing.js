// ── cssEasing.js ──────────────────────────────────────────────────────────────
// CSS timing functions as pure functions (no three.js): shared by the animation recipes and the
// authored face channel, so a curve means the same thing on a body, a camera and a face.

// ── CSS timing functions (the easing vocabulary) ─────────────────────────────
// Named CSS easings + cubic-bezier(...) — the recognized web vocabulary, not a
// bespoke curve system. Baked into sampled keyframes at compile time so the
// authored curve survives to glTF (renderer-agnostic round-trip).

const CSS_NAMED_EASINGS = {
	'ease':        [ 0.25, 0.1, 0.25, 1 ],
	'ease-in':     [ 0.42, 0, 1, 1 ],
	'ease-out':    [ 0, 0, 0.58, 1 ],
	'ease-in-out': [ 0.42, 0, 0.58, 1 ],
};

export function cubicBezier( p1x, p1y, p2x, p2y ) {

	const cx = 3 * p1x, bx = 3 * ( p2x - p1x ) - cx, ax = 1 - cx - bx;
	const cy = 3 * p1y, by = 3 * ( p2y - p1y ) - cy, ay = 1 - cy - by;
	const sampleX = t => ( ( ax * t + bx ) * t + cx ) * t;
	const sampleY = t => ( ( ay * t + by ) * t + cy ) * t;
	const sampleDX = t => ( 3 * ax * t + 2 * bx ) * t + cx;

	return function ( x ) {

		if ( x <= 0 ) return 0;
		if ( x >= 1 ) return 1;

		// Newton-Raphson, bisection fallback (the standard CSS bezier solver)
		let t = x;
		for ( let i = 0; i < 8; i ++ ) {

			const err = sampleX( t ) - x;
			if ( Math.abs( err ) < 1e-6 ) return sampleY( t );
			const d = sampleDX( t );
			if ( Math.abs( d ) < 1e-6 ) break;
			t -= err / d;

		}

		let lo = 0, hi = 1;
		while ( hi - lo > 1e-6 ) {

			t = ( lo + hi ) / 2;
			if ( sampleX( t ) < x ) lo = t; else hi = t;

		}

		return sampleY( t );

	};

}

/** Resolve a CSS timing-function string to f(t)→0..1. Unknown → linear. */
export function cssEasingFunction( easing ) {

	if ( ! easing || easing === 'linear' ) return t => t;
	let pts = CSS_NAMED_EASINGS[ String( easing ).trim() ];
	if ( ! pts ) {

		const m = /^cubic-bezier\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)$/.exec( String( easing ).trim() );
		if ( m ) pts = [ + m[ 1 ], + m[ 2 ], + m[ 3 ], + m[ 4 ] ];

	}

	if ( ! pts ) return t => t;
	return cubicBezier( pts[ 0 ], pts[ 1 ], pts[ 2 ], pts[ 3 ] );

}
