// The color of the shirt in the photo, from the strip of chest just below the chin. Pure: pixels and landmarks in, a color out.
//
// It is an estimate: the strip is cleaned of skin (the neck, a V-neck) and of the plain background, and what is left is averaged
// with the darkest and lightest tenth dropped. A picture that stops at the chin, or whose strip is mostly skin or background,
// gives null and the VRM's shirt is left alone.

const clamp = ( v, a, b ) => Math.min( b, Math.max( a, v ) );
const dist = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] );

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba the photo, 4 bytes per pixel
 * @param {{x:number,y:number}[]} landmarks normalized face mesh landmarks
 * @param {{r:number,g:number,b:number}|null} skinColor the face's skin color, 0 to 1
 * @returns {{ r:number, g:number, b:number, share:number }|null} the color 0 to 1 and the share of the strip it was taken from
 */
export function shirtColorFromPhoto( rgba, { width, height }, landmarks, skinColor ) {

	if ( ! landmarks || landmarks.length < 468 ) return null;
	const P = i => [ landmarks[ i ].x * width, landmarks[ i ].y * height ];
	const W = Math.hypot( P( 234 )[ 0 ] - P( 454 )[ 0 ], P( 234 )[ 1 ] - P( 454 )[ 1 ] );
	if ( ! ( W > 30 ) ) return null;
	const chin = P( 152 ), cx = ( P( 234 )[ 0 ] + P( 454 )[ 0 ] ) / 2;
	const y0 = Math.round( chin[ 1 ] + 0.45 * W ), y1 = Math.min( height - 1, Math.round( chin[ 1 ] + 1.4 * W ) );
	const x0 = Math.max( 0, Math.round( cx - 1.0 * W ) ), x1 = Math.min( width - 1, Math.round( cx + 1.0 * W ) );
	if ( y1 - y0 < 0.25 * W || x1 - x0 < 0.8 * W ) return null; // the picture stops at the chin

	// the background: the median of the four corners (a plain wall or sheet, if there is one)
	const at = ( x, y ) => { const i = ( y * width + x ) * 4; return [ rgba[ i ], rgba[ i + 1 ], rgba[ i + 2 ] ]; };
	const corners = [ at( 1, 1 ), at( width - 2, 1 ), at( 1, height - 2 ), at( width - 2, height - 2 ) ];
	const bg = [ 0, 1, 2 ].map( c => corners.map( p => p[ c ] ).sort( ( a, b ) => a - b )[ 1 ] );
	const skin = skinColor ? [ skinColor.r, skinColor.g, skinColor.b ].map( v => v * 255 ) : null;

	const picked = [];
	let total = 0;
	for ( let y = y0; y <= y1; y ++ ) for ( let x = x0; x <= x1; x ++ ) {

		total ++;
		const p = at( x, y );
		if ( skin && dist( p, skin ) < 45 ) continue; // the neck
		if ( dist( p, bg ) < 24 ) continue; // the wall behind
		picked.push( p );

	}
	if ( total < 400 || picked.length < 0.3 * total ) return null;
	picked.sort( ( a, b ) => ( a[ 0 ] + a[ 1 ] + a[ 2 ] ) - ( b[ 0 ] + b[ 1 ] + b[ 2 ] ) );
	const cut = Math.floor( picked.length * 0.1 ), kept = picked.slice( cut, picked.length - cut );
	const mean = [ 0, 1, 2 ].map( c => kept.reduce( ( s, p ) => s + p[ c ], 0 ) / kept.length / 255 );
	return { r: +mean[ 0 ].toFixed( 4 ), g: +mean[ 1 ].toFixed( 4 ), b: +mean[ 2 ].toFixed( 4 ), share: +clamp( picked.length / total, 0, 1 ).toFixed( 3 ) };

}
