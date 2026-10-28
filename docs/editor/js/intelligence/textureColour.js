// textureColour.js — the colour a mesh really has: the texture sampled over the part of it the mesh covers.
//
// A texture is an atlas shared by every part of a model, so "the texture's dominant colour" is one number for the whole model. What distinguishes a
// beak from a body is where in the atlas each one points. `footprintColour` samples the texture at points spread over the mesh's own surface (by
// area, deterministically), through the mesh's own UVs, so the answer is that part's colour, and it reports the main colour clusters as well.
// The sampler and k-means are pure (plain arrays), so they run in node; only `textureReader` needs a DOM.

/** A mesh as plain data: `index` is an array of vertex numbers (three per triangle) or null; `attrs` is { name: { array, itemSize, normalized } }. */
export function dataOfGeometry( g ) {

	const attrs = {};
	for ( const [ name, a ] of Object.entries( g.attributes ) ) {

		if ( a.isInterleavedBufferAttribute ) {

			const arr = new Float32Array( a.count * a.itemSize );
			for ( let i = 0; i < a.count; i ++ ) for ( let c = 0; c < a.itemSize; c ++ ) arr[ i * a.itemSize + c ] = a.getComponent( i, c );
			attrs[ name ] = { array: arr, itemSize: a.itemSize, normalized: a.normalized };

		} else attrs[ name ] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized };

	}
	return { index: g.index ? g.index.array : null, attrs };

}

const d2 = ( p, q ) => ( p[ 0 ] - q[ 0 ] ) ** 2 + ( p[ 1 ] - q[ 1 ] ) ** 2 + ( p[ 2 ] - q[ 2 ] ) ** 2;

/** k-means on colours, started from the colour farthest from those already chosen, so the same input always gives the same answer. */
export function kmeans( cols, k ) {

	if ( cols.length === 0 ) return [];
	const c = [ cols[ 0 ] ];
	while ( c.length < Math.min( k, cols.length ) ) {

		let best = cols[ 0 ], bestD = - 1;
		for ( const p of cols ) { const d = Math.min( ...c.map( q => d2( p, q ) ) ); if ( d > bestD ) { bestD = d; best = p; } }
		c.push( best );

	}
	let groups = [];
	for ( let it = 0; it < 12; it ++ ) {

		groups = c.map( () => [] );
		for ( const p of cols ) { let bi = 0; for ( let i = 1; i < c.length; i ++ ) if ( d2( p, c[ i ] ) < d2( p, c[ bi ] ) ) bi = i; groups[ bi ].push( p ); }
		groups.forEach( ( g, i ) => { if ( g.length ) c[ i ] = [ 0, 1, 2 ].map( a => g.reduce( ( s, p ) => s + p[ a ], 0 ) / g.length ); } );

	}
	return c.map( ( m, i ) => ( { rgb: m.map( Math.round ), share: groups[ i ].length / cols.length } ) ).filter( x => x.share > 0 ).sort( ( a, b ) => b.share - a.share );

}

export const hexOf = rgb => '#' + rgb.map( c => Math.max( 0, Math.min( 255, Math.round( c ) ) ).toString( 16 ).padStart( 2, '0' ) ).join( '' );

/**
 * The colour of the texture under a mesh. `read( u, v )` returns [r, g, b] (0 to 255). Samples are spread over the surface by area, at positions of a
 * fixed low-discrepancy sequence, so the same mesh and texture always give the same answer. Returns null when the mesh has no UVs or no triangles.
 *   { median: [r, g, b], clusters: [ { rgb, hex, share } ], samples }
 */
export function footprintColour( data, read, { samples = 2048, k = 3 } = {} ) {

	const pos = data.attrs.position, uv = data.attrs.uv;
	if ( ! pos || ! uv ) return null;
	const n = ( data.index ? data.index.length : pos.array.length / pos.itemSize ) / 3, I = t => ( data.index ? data.index[ t ] : t );
	if ( n === 0 ) return null;
	const P = pos.array, ps = pos.itemSize, U = uv.array, us = uv.itemSize;
	const cum = new Float64Array( n );
	let total = 0;
	for ( let t = 0; t < n; t ++ ) {

		const a = I( t * 3 ) * ps, b = I( t * 3 + 1 ) * ps, c = I( t * 3 + 2 ) * ps;
		const ux = P[ b ] - P[ a ], uy = P[ b + 1 ] - P[ a + 1 ], uz = P[ b + 2 ] - P[ a + 2 ], vx = P[ c ] - P[ a ], vy = P[ c + 1 ] - P[ a + 1 ], vz = P[ c + 2 ] - P[ a + 2 ];
		total += Math.hypot( uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ) / 2;
		cum[ t ] = total;

	}
	const byArea = total > 0;
	const out = [];
	let t = 0;
	for ( let s = 0; s < samples; s ++ ) {

		const target = ( s + 0.5 ) / samples;
		if ( byArea ) { const want = target * total; while ( t < n - 1 && cum[ t ] < want ) t ++; } else t = Math.min( n - 1, Math.floor( target * n ) );
		let x = ( 0.5 + s * 0.7548776662466927 ) % 1, y = ( 0.5 + s * 0.5698402909980532 ) % 1;
		if ( x + y > 1 ) { x = 1 - x; y = 1 - y; }
		const z = 1 - x - y, a = I( t * 3 ) * us, b = I( t * 3 + 1 ) * us, c = I( t * 3 + 2 ) * us;
		out.push( read( U[ a ] * z + U[ b ] * x + U[ c ] * y, U[ a + 1 ] * z + U[ b + 1 ] * x + U[ c + 1 ] * y ) );

	}
	const median = [ 0, 1, 2 ].map( ch => { const v = out.map( p => p[ ch ] ).sort( ( p, q ) => p - q ); return v[ Math.floor( v.length / 2 ) ]; } );
	return {
		median,
		clusters: kmeans( out, k ).map( c => ( { rgb: c.rgb, hex: hexOf( c.rgb ), share: Math.round( c.share * 1000 ) / 1000 } ) ),
		samples: out.length
	};

}

const readers = new WeakMap();

/** The reader of a texture's base colour: (u, v) → [r, g, b], honouring the texture's own transform and flip. Needs a DOM; cached per texture. */
export function textureReader( map ) {

	const img = map.image, cached = readers.get( map );
	if ( cached && cached.img === img ) return cached.read;
	const w = img.width, h = img.height;
	const cv = document.createElement( 'canvas' ); cv.width = w; cv.height = h;
	const cx = cv.getContext( '2d', { willReadFrequently: true } ); cx.drawImage( img, 0, 0 );
	const px = cx.getImageData( 0, 0, w, h ).data;
	map.updateMatrix();
	const e = map.matrix.elements, flip = map.flipY;
	const read = ( u0, v0 ) => {

		let u = e[ 0 ] * u0 + e[ 3 ] * v0 + e[ 6 ], v = e[ 1 ] * u0 + e[ 4 ] * v0 + e[ 7 ];
		u -= Math.floor( u ); v -= Math.floor( v );
		const x = Math.min( w - 1, Math.floor( u * w ) ), y = Math.min( h - 1, Math.floor( ( flip ? 1 - v : v ) * h ) ), p = ( y * w + x ) * 4;
		return [ px[ p ], px[ p + 1 ], px[ p + 2 ] ];

	};
	readers.set( map, { img, read } );
	return read;

}
