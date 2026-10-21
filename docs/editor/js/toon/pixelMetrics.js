// ── pixelMetrics.js ───────────────────────────────────────────────────────────
// Pure image-difference metrics (no DOM, no three.js) behind scripts/compare-render.mjs, which
// measures how far the viewport is from the Render tab's output. Images are { width, height, data }
// with data an RGBA Uint8Array/Uint8ClampedArray/array. Alpha is ignored: compare opaque captures.

function check( a, b ) {

	if ( ! a || ! b || ! a.data || ! b.data ) throw new Error( 'pixelMetrics: expected { width, height, data } images' );
	if ( a.width !== b.width || a.height !== b.height ) throw new Error( `pixelMetrics: size mismatch ${ a.width }x${ a.height } vs ${ b.width }x${ b.height }` );
	if ( a.data.length !== a.width * a.height * 4 || b.data.length !== a.data.length ) throw new Error( 'pixelMetrics: data length does not match width * height * 4' );

}

/**
 * Differences between two same-sized images, in 0..255 units.
 *   mae          mean absolute error over R, G and B
 *   maePerChannel [r, g, b]
 *   rmse         root mean square error over R, G and B
 *   maxDiff      largest single-channel difference
 *   pctOver      % of pixels whose largest channel difference is greater than `threshold`
 */
export function compareImages( a, b, { threshold = 16 } = {} ) {

	check( a, b );

	const pixels = a.width * a.height;
	const sum = [ 0, 0, 0 ];
	let squares = 0, maxDiff = 0, over = 0;

	for ( let i = 0; i < pixels; i ++ ) {

		let worst = 0;

		for ( let c = 0; c < 3; c ++ ) {

			const d = Math.abs( a.data[ i * 4 + c ] - b.data[ i * 4 + c ] );
			sum[ c ] += d;
			squares += d * d;
			if ( d > worst ) worst = d;

		}

		if ( worst > maxDiff ) maxDiff = worst;
		if ( worst > threshold ) over ++;

	}

	const n = Math.max( 1, pixels );
	return {
		pixels,
		mae: ( sum[ 0 ] + sum[ 1 ] + sum[ 2 ] ) / ( 3 * n ),
		maePerChannel: sum.map( s => s / n ),
		rmse: Math.sqrt( squares / ( 3 * n ) ),
		maxDiff,
		pctOver: 100 * over / n,
		threshold,
	};

}

/** An RGBA image where each pixel is the amplified absolute difference (grey, red where over `threshold`). */
export function diffImage( a, b, { gain = 4, threshold = 16 } = {} ) {

	check( a, b );

	const data = new Uint8ClampedArray( a.data.length );

	for ( let i = 0; i < a.width * a.height; i ++ ) {

		let worst = 0;
		for ( let c = 0; c < 3; c ++ ) worst = Math.max( worst, Math.abs( a.data[ i * 4 + c ] - b.data[ i * 4 + c ] ) );
		const v = Math.min( 255, worst * gain );
		data[ i * 4 ] = worst > threshold ? Math.max( v, 160 ) : v;
		data[ i * 4 + 1 ] = worst > threshold ? 0 : v;
		data[ i * 4 + 2 ] = worst > threshold ? 0 : v;
		data[ i * 4 + 3 ] = 255;

	}

	return { width: a.width, height: a.height, data };

}

/** Lay same-height images out left to right (for a side-by-side contact sheet). */
export function sideBySide( images, gap = 4 ) {

	if ( ! images.length ) throw new Error( 'pixelMetrics: no images' );
	const height = images[ 0 ].height;
	if ( images.some( im => im.height !== height ) ) throw new Error( 'pixelMetrics: images must share a height' );

	const width = images.reduce( ( w, im ) => w + im.width, 0 ) + gap * ( images.length - 1 );
	const data = new Uint8ClampedArray( width * height * 4 );

	for ( let i = 3; i < data.length; i += 4 ) data[ i ] = 255;

	let x0 = 0;
	for ( const im of images ) {

		for ( let y = 0; y < height; y ++ ) {

			const row = im.data.subarray ? im.data.subarray( y * im.width * 4, ( y + 1 ) * im.width * 4 ) : im.data.slice( y * im.width * 4, ( y + 1 ) * im.width * 4 );
			data.set( row, ( y * width + x0 ) * 4 );

		}

		x0 += im.width + gap;

	}

	return { width, height, data };

}

/** Mean of a list of compareImages() results (for a one-line summary across shots). */
export function averageMetrics( list ) {

	if ( ! list.length ) return null;
	const mean = f => list.reduce( ( s, m ) => s + f( m ), 0 ) / list.length;
	return {
		mae: mean( m => m.mae ),
		maePerChannel: [ 0, 1, 2 ].map( c => mean( m => m.maePerChannel[ c ] ) ),
		rmse: mean( m => m.rmse ),
		maxDiff: Math.max( ...list.map( m => m.maxDiff ) ),
		pctOver: mean( m => m.pctOver ),
	};

}
