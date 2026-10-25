// ── cameraPresets.js ──────────────────────────────────────────────────────────
// One-click camera moves for a shot: push in, pull back, orbit, truck, crane, drift. Each preset is
// a short list of keys ({ t, pos, lookAt, fov }) that cameraMove.setKeys() turns into the same keyed
// track the viewport's camera-path editor and the shell's keyAt() write, so a preset is only a
// starting point: every key can be dragged or edited afterwards.
//
// Pure maths, no three.js and no DOM, so it is testable in Node. All vectors are [x, y, z].

export const MOVE_PRESETS = {
	push: { label: 'Push in', unit: 'of the distance', amount: 0.3, min: 0.02, max: 0.9, step: 0.05 },
	pull: { label: 'Pull back', unit: 'of the distance', amount: 0.3, min: 0.02, max: 3, step: 0.05 },
	orbit: { label: 'Orbit', unit: 'degrees', amount: 40, min: 5, max: 360, step: 5 },
	truck: { label: 'Truck sideways', unit: 'of the distance', amount: 0.25, min: 0.02, max: 2, step: 0.05 },
	crane: { label: 'Crane up', unit: 'of the distance', amount: 0.2, min: 0.02, max: 2, step: 0.05 },
	drift: { label: 'Drift', unit: 'of the distance', amount: 0.04, min: 0.005, max: 0.3, step: 0.005 },
};

const add = ( a, b ) => [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ], a[ 2 ] + b[ 2 ] ];
const sub = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
const mul = ( a, s ) => [ a[ 0 ] * s, a[ 1 ] * s, a[ 2 ] * s ];
const len = a => Math.hypot( a[ 0 ], a[ 1 ], a[ 2 ] );
const norm = a => { const l = len( a ) || 1; return mul( a, 1 / l ); };
const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];
const round = a => a.map( v => Math.round( v * 1e4 ) / 1e4 );
const easeInOut = u => u * u * ( 3 - 2 * u );

/**
 * Keys for a move.
 * @param {string} kind      one of MOVE_PRESETS
 * @param {object} base      { pos, lookAt, fov } — the camera at the start of the shot
 * @param {object} [opts]    { start, end (seconds on the clock), amount (see MOVE_PRESETS) }
 * @returns {Array<{t:number,pos:number[],lookAt:number[],fov:number|undefined}>}
 */
export function presetKeys( kind, base, opts = {} ) {

	const preset = MOVE_PRESETS[ kind ];
	if ( ! preset ) throw new Error( 'camera move: kind must be one of ' + Object.keys( MOVE_PRESETS ).join( ', ' ) );
	if ( ! base || ! Array.isArray( base.pos ) || ! Array.isArray( base.lookAt ) ) throw new Error( 'camera move: needs the camera position and what it looks at' );

	const start = Number.isFinite( opts.start ) ? opts.start : 0;
	const end = Number.isFinite( opts.end ) && opts.end > start ? opts.end : start + 4;
	const amount = Number.isFinite( opts.amount ) && opts.amount > 0 ? opts.amount : preset.amount;

	const { pos, lookAt, fov } = base;
	const toTarget = sub( lookAt, pos );
	const dist = Math.max( len( toTarget ), 1e-3 );
	const forward = norm( toTarget );
	// camera right and up, from the world up (a camera looking straight up or down falls back to +X)
	let right = cross( forward, [ 0, 1, 0 ] );
	if ( len( right ) < 1e-6 ) right = [ 1, 0, 0 ];
	right = norm( right );
	const up = norm( cross( right, forward ) );

	const keys = [];
	const key = ( u, p, look = lookAt ) => keys.push( { t: Math.round( ( start + ( end - start ) * u ) * 1e3 ) / 1e3, pos: round( p ), lookAt: round( look ), fov } );

	// A move eases in and out: the position at key i is the path at ease(i / n), spaced evenly in time
	const along = ( n, pathAt ) => { for ( let i = 0; i <= n; i ++ ) key( i / n, pathAt( easeInOut( i / n ) ) ); };

	switch ( kind ) {

		case 'push': along( 6, k => add( pos, mul( forward, dist * amount * k ) ) ); break;
		case 'pull': along( 6, k => sub( pos, mul( forward, dist * amount * k ) ) ); break;
		case 'truck': along( 6, k => add( pos, mul( right, dist * amount * k ) ) ); break;
		case 'crane': along( 6, k => add( pos, mul( up, dist * amount * k ) ) ); break;

		case 'orbit': {

			// about the vertical axis through the point being looked at, keeping height and distance
			const radius = sub( pos, lookAt );
			const total = amount * Math.PI / 180;
			const n = Math.max( 4, Math.ceil( amount / 15 ) );
			along( n, k => {

				const a = total * k, c = Math.cos( a ), s = Math.sin( a );
				return add( lookAt, [ radius[ 0 ] * c + radius[ 2 ] * s, radius[ 1 ], - radius[ 0 ] * s + radius[ 2 ] * c ] );

			} );
			break;

		}

		case 'drift': {

			// a slow figure of eight in the camera's own plane, back to where it began
			const n = 8, r = dist * amount;
			for ( let i = 0; i <= n; i ++ ) {

				const a = ( i / n ) * 2 * Math.PI;
				key( i / n, add( pos, add( mul( right, r * Math.sin( a ) ), mul( up, r * 0.5 * Math.sin( 2 * a ) ) ) ) );

			}

			break;

		}

	}

	return keys;

}
