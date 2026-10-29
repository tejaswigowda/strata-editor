// meshSegment.js — cut one textured mesh into named, addressable parts (the Shell's `SEG`).
//
// A mesh arrives as one object with one material, so nothing in the scene says "this is the seed". Two things in the file do carry hints:
//   1. UV islands: pieces of surface that the texture artist laid out as separate patches of the texture (a piece is a set of triangles
//      that share vertices once vertices are welded on position + uv, so a hard edge is not a seam);
//   2. the colours painted on the texture: inside one island, a ring of orange and a ring of cream are different things.
// `describeIslands` reports both, so a person (or an AI shown the report) can decide what each piece is; `planParts` then cuts by that decision
// and never loses a triangle. Nothing here recognises anything: the names come from the plan.
//
// The first half is pure (plain arrays, no three.js, no DOM) so it can be tested in node; `makeSegment(editor)` at the bottom is the Shell surface.

import { isDefaultName } from './sceneLint.js';
import { kmeans, textureReader, dataOfGeometry, footprintColour } from './textureColour.js';
import { validateSource, initialVerification, sha256Hex } from '../export/records.js';

export { kmeans, textureReader };

/** Written into every record. Records made before 1.1.0 carry no version, no plan and no evidence; 1.2.0 adds components, attachment and the post-cut assertions; 1.3.0 pins and hashes the source and adds the verification block (see export/records.js); 1.4.0 cuts skinned meshes; 1.5.0 records the parent triangle of every output triangle (`parents`); 1.6.0 adds SEG.wouldRefuse and regenerating a plan record from its source. */
export const SEG_VERSION = '1.6.0';   // the schema itself (records.js, SCHEMA_SEG_VERSION) has not changed since 1.3.0; `parents` is an addition, and optional in a saved record

/**
 * The numbers the scene methods use, all recorded with the cut (`attach.parameters`, `signals.assertion_parameters`) so that a cut can be audited and run again.
 * Distances are in world units (the units of the scene), not of the mesh.
 */
export const SCENE = {
	weld_digits: 4,           // components: two vertices that agree to this many decimals (mesh units) are one vertex
	attach_tie: 0.05,         // attach: an anchor within this much of the nearest one is tied with it, and the smaller bounding box wins
	attach_samples: 6,        // attach: sample points per island (triangle centres, evenly spaced)
	attach_max_fraction: 0.1, // attach: the default maxDistance, as a share of the scene's bounding-box diagonal
	grain_ratio: 0.75         // describe: components are the grain when there are at most this many per island
};
export const ASSERTIONS = {
	min_parts: 4,             // fewer parts than this and no assertion is checked: there is nothing to compare a part with
	oversize_span: 0.6,       // oversize: a part's box spans this share of the scene on all three axes ...
	oversize_area: 0.25,      // ... and carries less than this share of the surface
	absorbed_components: 8,   // absorbed: a part assembled from at least this many components ...
	absorbed_colour: 0.85,    // ... whose main colour holds at least this share of its texture footprint
	engulf_share: 0.5,        // engulfing: a part's box contains at least this share of the other parts' centres ...
	engulf_area: 0.1,         // ... and the part carries less than this share of the surface
	orphan_share: 0.5,        // orphan sink: one part received at least this share of all the components that were attached ...
	orphan_min: 10,           // ... out of at least this many
	spread_classes: [ 'trim', 'frame', 'cable', 'pipe', 'wire', 'rail', 'network', 'edge', 'outline' ]   // a part that declares one of these is expected to be spread out
};
const BASES = [ 'position', 'size', 'colour', 'shape' ];

// ── pure core ─────────────────────────────────────────────────────────────────────────────────────

/** A mesh as plain data: `index` is an array of vertex numbers (three per triangle) or null for a non-indexed mesh; `attrs` is { name: { array, itemSize } }. */
export function triangleIndex( data ) {

	if ( data.index ) return data.index;
	const n = data.attrs.position.array.length / data.attrs.position.itemSize;
	return Array.from( { length: n }, ( _, i ) => i );

}

/**
 * The islands of a mesh: arrays of triangle numbers, largest first (ties by the lowest triangle number, so the order is the same every run).
 * Vertices are welded on position and uv, so duplicated vertices that differ only in normal, tangent or colour stay in one island.
 */
export function islandsOf( data ) {

	const idx = triangleIndex( data ), pos = data.attrs.position, uv = data.attrs.uv, n = idx.length / 3;
	const weld = new Map(), wid = new Int32Array( pos.array.length / pos.itemSize );
	for ( let i = 0; i < wid.length; i ++ ) {

		let key = pos.array[ i * pos.itemSize ] + ',' + pos.array[ i * pos.itemSize + 1 ] + ',' + pos.array[ i * pos.itemSize + 2 ];
		if ( uv ) key += ',' + uv.array[ i * uv.itemSize ] + ',' + uv.array[ i * uv.itemSize + 1 ];
		if ( ! weld.has( key ) ) weld.set( key, weld.size );
		wid[ i ] = weld.get( key );

	}
	const par = Int32Array.from( { length: weld.size }, ( _, i ) => i );
	const find = a => { while ( par[ a ] !== a ) { par[ a ] = par[ par[ a ] ]; a = par[ a ]; } return a; };
	for ( let t = 0; t < n; t ++ ) {

		const r = find( wid[ idx[ t * 3 ] ] );
		par[ find( wid[ idx[ t * 3 + 1 ] ] ) ] = r;
		par[ find( wid[ idx[ t * 3 + 2 ] ] ) ] = find( r );

	}
	const by = new Map();
	for ( let t = 0; t < n; t ++ ) {

		const r = find( wid[ idx[ t * 3 ] ] );
		if ( ! by.has( r ) ) by.set( r, [] );
		by.get( r ).push( t );

	}
	return [ ...by.values() ].sort( ( a, b ) => b.length - a.length || a[ 0 ] - b[ 0 ] );

}

const d2 = ( p, q ) => ( p[ 0 ] - q[ 0 ] ) ** 2 + ( p[ 1 ] - q[ 1 ] ) ** 2 + ( p[ 2 ] - q[ 2 ] ) ** 2;

// colours sampled across a triangle's face on a small grid of barycentric points, so that even a few large triangles give many samples
function sampleTriangle( idx, uv, t, read, k = 5 ) {

	const a = idx[ t * 3 ], b = idx[ t * 3 + 1 ], c = idx[ t * 3 + 2 ], s = uv.itemSize, A = uv.array, out = [];
	for ( let i = 0; i <= k; i ++ ) for ( let j = 0; i + j <= k; j ++ ) {

		const x = i / k, y = j / k, z = 1 - x - y;
		out.push( read( A[ a * s ] * x + A[ b * s ] * y + A[ c * s ] * z, A[ a * s + 1 ] * x + A[ b * s + 1 ] * y + A[ c * s + 1 ] * z ) );

	}
	return out;

}

/** What is in a mesh, per island: triangle count, where it sits in the texture, how big it is in space, and its main colours (when `read` is given). */
export function describeIslands( data, read, k = 3 ) {

	const idx = triangleIndex( data ), pos = data.attrs.position, uv = data.attrs.uv;
	const whole = [ Infinity, Infinity, Infinity ], wholeHi = [ - Infinity, - Infinity, - Infinity ];      // the box of the whole mesh, so a centre can be said as 0 to 1 across it
	for ( let i = 0; i < pos.array.length; i += pos.itemSize ) for ( let c = 0; c < 3; c ++ ) { whole[ c ] = Math.min( whole[ c ], pos.array[ i + c ] ); wholeHi[ c ] = Math.max( wholeHi[ c ], pos.array[ i + c ] ); }
	return islandsOf( data ).map( ( ts, i ) => {

		const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
		const u = [ Infinity, - Infinity ], v = [ Infinity, - Infinity ];
		for ( const t of ts ) for ( let q = 0; q < 3; q ++ ) {

			const a = idx[ t * 3 + q ];
			for ( let c = 0; c < 3; c ++ ) { const p = pos.array[ a * pos.itemSize + c ]; lo[ c ] = Math.min( lo[ c ], p ); hi[ c ] = Math.max( hi[ c ], p ); }
			if ( uv ) { const x = uv.array[ a * uv.itemSize ], y = uv.array[ a * uv.itemSize + 1 ]; u[ 0 ] = Math.min( u[ 0 ], x ); u[ 1 ] = Math.max( u[ 1 ], x ); v[ 0 ] = Math.min( v[ 0 ], y ); v[ 1 ] = Math.max( v[ 1 ], y ); }

		}
		return {
			island: i, triangles: ts.length, size: hi.map( ( x, c ) => x - lo[ c ] ),
			at: hi.map( ( x, c ) => ( wholeHi[ c ] > whole[ c ] ? ( ( x + lo[ c ] ) / 2 - whole[ c ] ) / ( wholeHi[ c ] - whole[ c ] ) : 0.5 ) ),      // the centre, 0 to 1 across the whole mesh on x, y and z
			uv: uv ? { u, v } : null,
			colours: read && uv ? kmeans( ts.flatMap( t => sampleTriangle( idx, uv, t, read ) ), k ) : null
		};

	} );

}

export function formatIslands( list ) {

	return list.map( d =>
		`island ${ d.island }: ${ d.triangles } triangles`
		+ ( d.uv ? `, texture u ${ d.uv.u.map( x => x.toFixed( 2 ) ) } v ${ d.uv.v.map( x => x.toFixed( 2 ) ) }` : ', no uv' )
		+ `, size ${ d.size.map( x => x.toFixed( 3 ) ) }, at ${ d.at.map( x => x.toFixed( 2 ) ) }`
		+ ( d.colours ? `, colours ${ d.colours.map( c => `rgb(${ c.rgb }) ${ Math.round( c.share * 100 ) }%` ).join( '  ' ) }` : ', no texture' )
	).join( '\n' );

}

// ── scenes: components, attachment, assertions ────────────────────────────────────────────────────
//
// An object (an avocado, a duck) has a handful of islands and each is a part. A scene (a furnished room) is one mesh with hundreds of islands, most
// of them a few triangles of trim or a prop's label. Two things the model does not need to re-derive for each scene are here as plain functions:
//   components   islands that touch in space are one piece of surface (welded on position only, not uv); measured in the WORLD frame;
//   attach       every other component goes to the nearest named anchor, by distance to its triangles, unless it is too far.
// What stays with the person or the model is the naming of the anchors. Nothing here names anything.

const worldOf = ( m, x, y, z ) => ( m
	? [ m[ 0 ] * x + m[ 4 ] * y + m[ 8 ] * z + m[ 12 ], m[ 1 ] * x + m[ 5 ] * y + m[ 9 ] * z + m[ 13 ], m[ 2 ] * x + m[ 6 ] * y + m[ 10 ] * z + m[ 14 ] ]
	: [ x, y, z ] );

/** Every vertex of the mesh in the world frame (`matrix` is a node's matrixWorld elements, column-major; none means the mesh frame is the world). */
function worldVertices( data, matrix ) {

	const pos = data.attrs.position, s = pos.itemSize, n = pos.array.length / s, out = new Float64Array( n * 3 );
	for ( let i = 0; i < n; i ++ ) { const w = worldOf( matrix, pos.array[ i * s ], pos.array[ i * s + 1 ], pos.array[ i * s + 2 ] ); out[ i * 3 ] = w[ 0 ]; out[ i * 3 + 1 ] = w[ 1 ]; out[ i * 3 + 2 ] = w[ 2 ]; }
	return out;

}

function boxOf( wv, idx, triangles ) {

	const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const t of triangles ) for ( let k = 0; k < 3; k ++ ) for ( let c = 0; c < 3; c ++ ) { const v = wv[ idx[ t * 3 + k ] * 3 + c ]; if ( v < lo[ c ] ) lo[ c ] = v; if ( v > hi[ c ] ) hi[ c ] = v; }
	return { lo, hi };

}

const sig = x => + x.toPrecision( 5 );

/**
 * The components of a mesh: islands that touch in space. Vertices are welded on POSITION ONLY (to `digits` decimals), so a texture seam, which splits
 * a physical object into several islands, does not split it here. Every island lies inside exactly one component, so a plan may list islands or components.
 * Components are largest first (ties by the lowest island number), so the numbering is the same every run.
 *   { islands: [ [triangle numbers] ], components: [ { component, islands: [island numbers], triangles } ] }
 */
export function componentsOf( data, { digits = SCENE.weld_digits } = {} ) {

	const idx = triangleIndex( data ), pos = data.attrs.position, ps = pos.itemSize, islands = islandsOf( data ), scale = 10 ** digits;
	const weld = new Map(), wid = new Int32Array( pos.array.length / ps );
	for ( let i = 0; i < wid.length; i ++ ) {

		const key = [ 0, 1, 2 ].map( c => Math.round( pos.array[ i * ps + c ] * scale ) + 0 ).join( ',' );
		if ( ! weld.has( key ) ) weld.set( key, weld.size );
		wid[ i ] = weld.get( key );

	}
	const par = Int32Array.from( { length: islands.length }, ( _, i ) => i );
	const find = a => { while ( par[ a ] !== a ) { par[ a ] = par[ par[ a ] ]; a = par[ a ]; } return a; };
	const owner = new Map();
	islands.forEach( ( ts, i ) => { for ( const t of ts ) for ( let k = 0; k < 3; k ++ ) { const w = wid[ idx[ t * 3 + k ] ]; if ( owner.has( w ) ) par[ find( i ) ] = find( owner.get( w ) ); else owner.set( w, i ); } } );
	const by = new Map();
	islands.forEach( ( ts, i ) => { const r = find( i ); if ( ! by.has( r ) ) by.set( r, { islands: [], triangles: 0 } ); const c = by.get( r ); c.islands.push( i ); c.triangles += ts.length; } );
	const components = [ ...by.values() ].sort( ( a, b ) => b.triangles - a.triangles || a.islands[ 0 ] - b.islands[ 0 ] ).map( ( c, i ) => ( { component: i, ...c } ) );
	return { islands, components };

}

/**
 * Is the scene grain (components) the right one for this mesh? When the components are far fewer than the islands, the mesh was unwrapped in pieces and an island is
 * the wrong unit. One component is the opposite case: the whole mesh is welded in space (a skinned animal, a character), so the report has nothing to say and the
 * islands are the only grain there is.
 */
export function grainOf( islandCount, componentCount, requested = 'auto' ) {

	if ( requested === 'islands' || requested === 'components' ) return requested;
	if ( requested !== 'auto' ) throw new Error( 'SEG: grain must be "auto", "islands" or "components"' );
	return componentCount > 1 && componentCount <= islandCount * SCENE.grain_ratio ? 'components' : 'islands';

}

/**
 * What is in a scene, per component, measured in the world frame: triangles, size, centre, `at` (the centre as 0 to 1 across the whole mesh on world x, y, z),
 * the islands it is made of, and its main colours (when `read` is given). A mesh imported with a rotation (Z-up models are) has a different mesh-frame
 * `size` and `at`; these are the numbers a person means by "tall" and "left".
 */
export function describeComponents( data, read, { k = 3, matrix = null, digits = SCENE.weld_digits } = {} ) {

	const idx = triangleIndex( data ), uv = data.attrs.uv, wv = worldVertices( data, matrix ), { islands, components } = componentsOf( data, { digits } );
	const whole = boxOf( wv, idx, islands.flat() );
	return components.map( c => {

		const tris = c.islands.flatMap( i => islands[ i ] ), { lo, hi } = boxOf( wv, idx, tris );
		return {
			component: c.component, triangles: c.triangles, islands: c.islands,
			size: hi.map( ( x, a ) => sig( x - lo[ a ] ) ),
			centre: hi.map( ( x, a ) => sig( ( x + lo[ a ] ) / 2 ) ),
			at: hi.map( ( x, a ) => ( whole.hi[ a ] > whole.lo[ a ] ? sig( ( ( x + lo[ a ] ) / 2 - whole.lo[ a ] ) / ( whole.hi[ a ] - whole.lo[ a ] ) ) : 0.5 ) ),
			colours: read && uv ? kmeans( tris.flatMap( t => sampleTriangle( idx, uv, t, read ) ), k ) : null
		};

	} );

}

/** The scene report: it leads with size and position, because in a room that is what tells a wall from a prop; colour comes last. */
export function formatComponents( list, islandCount ) {

	const lines = list.map( d =>
		`component ${ d.component }: ${ d.triangles } triangles (${ d.islands.length } island${ d.islands.length === 1 ? '' : 's' }: ${ d.islands.length > 6 ? d.islands.slice( 0, 6 ).join( ',' ) + ',…' : d.islands.join( ',' ) })`
		+ `, size ${ d.size.map( x => x.toFixed( 3 ) ) }, centre ${ d.centre.map( x => x.toFixed( 3 ) ) }, at ${ d.at.map( x => x.toFixed( 2 ) ) }`
		+ ( d.colours ? `, colours ${ d.colours.map( c => `rgb(${ c.rgb }) ${ Math.round( c.share * 100 ) }%` ).join( '  ' ) }` : ', no texture' ) );
	if ( islandCount !== undefined ) lines.push( `(${ islandCount } islands joined into ${ list.length } components where they touch in space; world frame, y up. Pass { grain: 'islands' } for the islands. Name anchors: { name, classes, component: [..] }, and let SEG.attach place the rest)` );
	return lines.join( '\n' );

}

// the squared distance from a point to a triangle (Ericson, Real-Time Collision Detection), on plain numbers so that it is fast enough to run thousands of times
function pointTriangleD2( px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz ) {

	const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
	if ( d1 <= 0 && d2 <= 0 ) return apx * apx + apy * apy + apz * apz;
	const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
	if ( d3 >= 0 && d4 <= d3 ) return bpx * bpx + bpy * bpy + bpz * bpz;
	const vc = d1 * d4 - d3 * d2;
	if ( vc <= 0 && d1 >= 0 && d3 <= 0 ) { const v = d1 / ( d1 - d3 ), x = apx - abx * v, y = apy - aby * v, z = apz - abz * v; return x * x + y * y + z * z; }
	const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
	if ( d6 >= 0 && d5 <= d6 ) return cpx * cpx + cpy * cpy + cpz * cpz;
	const vb = d5 * d2 - d1 * d6;
	if ( vb <= 0 && d2 >= 0 && d6 <= 0 ) { const w = d2 / ( d2 - d6 ), x = apx - acx * w, y = apy - acy * w, z = apz - acz * w; return x * x + y * y + z * z; }
	const va = d3 * d6 - d5 * d4;
	if ( va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0 ) { const w = ( d4 - d3 ) / ( ( d4 - d3 ) + ( d5 - d6 ) ), x = bpx - ( cx - bx ) * w, y = bpy - ( cy - by ) * w, z = bpz - ( cz - bz ) * w; return x * x + y * y + z * z; }
	const den = 1 / ( va + vb + vc );
	if ( ! Number.isFinite( den ) ) return Math.min( apx * apx + apy * apy + apz * apz, bpx * bpx + bpy * bpy + bpz * bpz, cpx * cpx + cpy * cpy + cpz * cpz );      // a triangle with no area
	const v = vb * den, w = vc * den, x = apx - abx * v - acx * w, y = apy - aby * v - acy * w, z = apz - abz * v - acz * w;
	return x * x + y * y + z * z;

}

const quantile = ( sorted, q ) => ( sorted.length ? sig( sorted[ Math.min( sorted.length - 1, Math.floor( q * sorted.length ) ) ] ) : 0 );

/**
 * Attach every component that is not an anchor to the nearest anchor. `anchors` is [ { name, classes, component: n | [n, ...] } ]; the components an anchor
 * names are its own, and are never moved. A component's distance to an anchor is the shortest distance from a few sample points on it (the centres of up
 * to `samples` triangles of each of its islands) to the anchor's TRIANGLES, not to its vertices: a floor is a few huge triangles, and its vertices are far
 * from anything standing on it. The nearest anchor wins; every anchor within `tie` of the nearest is tied with it, and among the tied the one with the
 * smaller bounding box wins, so a mug beats the counter and a prop beats the wall it stands against. A component further than `maxDistance` from every
 * anchor is NOT attached: it is returned in `unattached` to be named, or to be described, by whoever wrote the plan.
 * `maxDistance` defaults to `attach_max_fraction` of the scene's bounding-box diagonal.
 * Returns { of, distance, attached, unattached, tieBroken, parameters, perAnchor }: `of[c]` is the anchor index of component c (or -1), `distance[c]` its distance,
 * `tieBroken` the components the tie-break gave to an anchor that was not the nearest.
 */
export function attachComponents( data, scene, anchors, { matrix = null, maxDistance, tie = SCENE.attach_tie, samples = SCENE.attach_samples } = {} ) {

	const { islands, components } = scene, idx = triangleIndex( data ), wv = worldVertices( data, matrix );
	if ( ! Array.isArray( anchors ) || anchors.length === 0 ) throw new Error( 'SEG.attach: give at least one anchor: [ { name, classes, component: [..] } ]' );
	const of = new Int32Array( components.length ).fill( - 1 ), mine = anchors.map( () => [] );
	anchors.forEach( ( a, ai ) => {

		const ids = [].concat( a.component === undefined ? [] : a.component );
		if ( ! ids.length ) throw new Error( 'SEG.attach: anchor "' + a.name + '" names no component' );
		for ( const c of ids ) {

			if ( ! Number.isInteger( c ) || ! components[ c ] ) throw new Error( 'SEG.attach: there is no component ' + c + ' (the mesh has ' + components.length + ')' );
			if ( of[ c ] >= 0 ) throw new Error( 'SEG.attach: component ' + c + ' is named by two anchors ("' + anchors[ of[ c ] ].name + '" and "' + a.name + '")' );
			of[ c ] = ai; mine[ ai ].push( c );

		}

	} );
	const trisOf = c => components[ c ].islands.flatMap( i => islands[ i ] );
	const whole = boxOf( wv, idx, islands.flat() ), diag = Math.hypot( whole.hi[ 0 ] - whole.lo[ 0 ], whole.hi[ 1 ] - whole.lo[ 1 ], whole.hi[ 2 ] - whole.lo[ 2 ] );
	const byDefault = maxDistance === undefined || maxDistance === null;
	if ( ! byDefault && ! ( maxDistance >= 0 ) ) throw new Error( 'SEG.attach: maxDistance must be a number of world units' );
	const limit = byDefault ? SCENE.attach_max_fraction * diag : maxDistance;
	// each anchor as flat arrays of its triangles, each with its own small box so that most triangles are skipped without being measured
	const geo = anchors.map( ( _, ai ) => {

		const tris = mine[ ai ].flatMap( trisOf ), T = new Float64Array( tris.length * 9 ), B = new Float64Array( tris.length * 6 );
		const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
		tris.forEach( ( t, j ) => {

			for ( let k = 0; k < 3; k ++ ) for ( let c = 0; c < 3; c ++ ) {

				const v = wv[ idx[ t * 3 + k ] * 3 + c ];
				T[ j * 9 + k * 3 + c ] = v;
				if ( k === 0 || v < B[ j * 6 + c ] ) B[ j * 6 + c ] = v;
				if ( k === 0 || v > B[ j * 6 + 3 + c ] ) B[ j * 6 + 3 + c ] = v;
				if ( v < lo[ c ] ) lo[ c ] = v; if ( v > hi[ c ] ) hi[ c ] = v;

			}

		} );
		return { n: tris.length, T, B, Bhi: B.subarray( 3 ), lo, hi, volume: ( hi[ 0 ] - lo[ 0 ] + 0.01 ) * ( hi[ 1 ] - lo[ 1 ] + 0.01 ) * ( hi[ 2 ] - lo[ 2 ] + 0.01 ) };

	} );
	const boxD2 = ( p, lo, hi, o ) => { let s = 0; for ( let c = 0; c < 3; c ++ ) { const d = Math.max( lo[ o + c ] - p[ c ], 0, p[ c ] - hi[ o + c ] ); s += d * d; } return s; };
	const distance = new Float64Array( components.length ), unattached = [], tieBroken = [], attached = anchors.map( () => [] );
	for ( let c = 0; c < components.length; c ++ ) {

		if ( of[ c ] >= 0 ) continue;
		const pts = [];
		for ( const i of components[ c ].islands ) {

			const ts = islands[ i ], step = Math.max( 1, Math.floor( ts.length / samples ) );
			for ( let q = 0; q < ts.length; q += step ) {

				const t = ts[ q ], p = [ 0, 0, 0 ];
				for ( let k = 0; k < 3; k ++ ) for ( let a = 0; a < 3; a ++ ) p[ a ] += wv[ idx[ t * 3 + k ] * 3 + a ] / 3;
				pts.push( p );

			}

		}
		const d = geo.map( g => {

			let best = Infinity;
			for ( const p of pts ) {

				if ( boxD2( p, g.lo, g.hi, 0 ) >= best ) continue;
				for ( let j = 0; j < g.n; j ++ ) {

					if ( boxD2( p, g.B, g.Bhi, j * 6 ) >= best ) continue;
					const T = g.T, o = j * 9, v = pointTriangleD2( p[ 0 ], p[ 1 ], p[ 2 ], T[ o ], T[ o + 1 ], T[ o + 2 ], T[ o + 3 ], T[ o + 4 ], T[ o + 5 ], T[ o + 6 ], T[ o + 7 ], T[ o + 8 ] );
					if ( v < best ) best = v;

				}

			}
			return Math.sqrt( best );

		} );
		const nearest = Math.min( ...d );
		let pick = - 1, vol = Infinity;
		d.forEach( ( v, ai ) => { if ( v <= nearest + tie && geo[ ai ].volume < vol ) { vol = geo[ ai ].volume; pick = ai; } } );
		if ( nearest > limit ) { unattached.push( { component: c, nearest: anchors[ d.indexOf( nearest ) ].name, distance: sig( nearest ) } ); continue; }
		if ( d[ pick ] > nearest ) tieBroken.push( { component: c, anchor: anchors[ pick ].name, distance: sig( d[ pick ] ), nearest: anchors[ d.indexOf( nearest ) ].name, nearest_distance: sig( nearest ) } );     // the rule overrode the nearest
		of[ c ] = pick; distance[ c ] = d[ pick ]; attached[ pick ].push( c );

	}
	const perAnchor = anchors.map( ( a, ai ) => {

		const ds = attached[ ai ].map( c => distance[ c ] ).sort( ( x, y ) => x - y );
		return { name: a.name, anchor_components: mine[ ai ], attached_components: attached[ ai ].length, components: mine[ ai ].length + attached[ ai ].length, distance: { median: quantile( ds, 0.5 ), p90: quantile( ds, 0.9 ), max: ds.length ? sig( ds[ ds.length - 1 ] ) : 0 } };

	} );
	return {
		of, distance, mine, attached, unattached, tieBroken, perAnchor,
		parameters: { max_distance: sig( limit ), max_distance_default: byDefault, tie, samples_per_island: samples, weld_digits: SCENE.weld_digits, scene_diagonal: sig( diag ), frame: 'world' }
	};

}

/** The parts an attachment makes: each anchor with everything attached to it, as the plan's own part shape ({ name, classes, island }). */
export function anchorParts( scene, anchors, result ) {

	return anchors.map( ( a, ai ) => {

		const comps = [ ...result.mine[ ai ], ...result.attached[ ai ] ].sort( ( x, y ) => x - y );
		return { name: a.name, classes: a.classes, basis: a.basis, component: comps, island: comps.flatMap( c => scene.components[ c ].islands ).sort( ( x, y ) => x - y ) };

	} );

}

/**
 * Checks a finished cut against the evidence it was made from, and reports what looks wrong. It never corrects anything: the right response to a failed
 * check is to undo and cut again from a revised plan, and that decision belongs to whoever wrote the plan. Each entry is { assertion, part, message, ...numbers }.
 *   oversize        a part whose box fills the scene on every axis while carrying little of its surface: trim, or several objects, swallowed
 *   absorbed        a part assembled from many components that is almost all one colour
 *   engulfing       a part whose box contains most of the other parts' centres while carrying little of the surface
 *   orphan sink     one part that received most of everything that was attached
 * A part that declares itself spread out (class trim, frame, cable, …) is exempt from oversize and engulfing.
 */
export function cutAssertions( { made, data, scene, matrix = null, attach = null, read = null } ) {

	const A = ASSERTIONS, fired = [];
	if ( made.length < A.min_parts ) return { parameters: A, fired };
	const idx = triangleIndex( data ), wv = worldVertices( data, matrix ), names = Object.keys( data.attrs );
	const at = names.slice( 0, names.indexOf( 'position' ) ).reduce( ( s, n ) => s + data.attrs[ n ].itemSize, 0 );
	const isl2comp = new Map(); scene.components.forEach( c => c.islands.forEach( i => isl2comp.set( i, c.component ) ) );
	const area = made.map( p => areaOf( p.triangles, at ) ), totalArea = area.reduce( ( a, b ) => a + b, 0 ) || 1;
	const sceneBox = boxOf( wv, idx, scene.islands.flat() );
	const boxes = made.map( p => { const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ]; for ( const t of p.triangles ) for ( const v of t ) { const w = worldOf( matrix, v[ at ], v[ at + 1 ], v[ at + 2 ] ); for ( let c = 0; c < 3; c ++ ) { lo[ c ] = Math.min( lo[ c ], w[ c ] ); hi[ c ] = Math.max( hi[ c ], w[ c ] ); } } return { lo, hi }; } );
	const centres = boxes.map( b => b.hi.map( ( x, c ) => ( x + b.lo[ c ] ) / 2 ) );
	const pct = x => Math.round( x * 100 ) + '%';
	made.forEach( ( p, i ) => {

		const spread = ( p.classes || [] ).some( c => A.spread_classes.includes( String( c ).toLowerCase() ) ), share = area[ i ] / totalArea, b = boxes[ i ];
		const span = b.hi.map( ( x, c ) => ( sceneBox.hi[ c ] > sceneBox.lo[ c ] ? ( x - b.lo[ c ] ) / ( sceneBox.hi[ c ] - sceneBox.lo[ c ] ) : 0 ) );
		if ( ! spread && span.every( s => s >= A.oversize_span ) && share < A.oversize_area )
			fired.push( { assertion: 'oversize', part: p.name, span: span.map( sig ), area_share: sig( share ), message: `its box spans ${ span.map( pct ).join( ', ' ) } of the scene on x, y, z but it carries only ${ pct( share ) } of the surface: it has swallowed trim or several objects. Declare class "trim" if it is trim; otherwise undo and cut again` } );
		const inside = centres.filter( ( c, j ) => j !== i && c.every( ( x, a ) => x >= b.lo[ a ] && x <= b.hi[ a ] ) ).length / ( made.length - 1 );
		if ( ! spread && inside >= A.engulf_share && share < A.engulf_area )
			fired.push( { assertion: 'engulfing', part: p.name, contains_centres: sig( inside ), area_share: sig( share ), message: `its box contains the centres of ${ pct( inside ) } of the other parts while it carries only ${ pct( share ) } of the surface: it reaches into everything. Move the pieces that run through the scene to a part of their own` } );
		const comps = new Set( ( p.islands || [] ).map( x => isl2comp.get( x ) ) );
		if ( read && comps.size >= A.absorbed_components && data.attrs.uv ) {

			const col = footprintColour( carveAttributes( data, p.triangles ), read );
			if ( col && col.clusters[ 0 ] && col.clusters[ 0 ].share >= A.absorbed_colour )
				fired.push( { assertion: 'absorbed', part: p.name, components: comps.size, colour: col.clusters[ 0 ].hex, colour_share: col.clusters[ 0 ].share, message: `it is assembled from ${ comps.size } components and ${ pct( col.clusters[ 0 ].share ) } of its texture is one colour (${ col.clusters[ 0 ].hex }): it has probably absorbed a run of similar pieces` } );

		}

	} );
	if ( attach ) {

		const total = attach.perAnchor.reduce( ( s, a ) => s + a.attached_components, 0 );
		for ( const a of attach.perAnchor ) {

			if ( total >= A.orphan_min && a.attached_components / total >= A.orphan_share )
				fired.push( { assertion: 'orphan sink', part: a.name, attached: a.attached_components, of: total, message: `it received ${ a.attached_components } of the ${ total } components that were attached (${ pct( a.attached_components / total ) }): it is the nearest anchor to everything that has no anchor of its own. Name more anchors` } );

		}

	}
	return { parameters: A, fired };

}

// one triangle is [vertexA, vertexB, vertexC], a vertex one flat list of every attribute's numbers in attribute order
function vertexOf( data, names, i ) {

	const out = [];
	for ( const n of names ) { const a = data.attrs[ n ]; for ( let c = 0; c < a.itemSize; c ++ ) out.push( a.array[ i * a.itemSize + c ] ); }
	return out;

}
const mid = ( a, b ) => a.map( ( x, k ) => ( x + b[ k ] ) / 2 );
function subdivide( t, n ) {

	if ( ! n ) return [ t ];
	const [ a, b, c ] = t, ab = mid( a, b ), bc = mid( b, c ), ca = mid( c, a );
	return [ [ a, ab, ca ], [ ab, b, bc ], [ ca, bc, c ], [ ab, bc, ca ] ].flatMap( s => subdivide( s, n - 1 ) );

}

/** Collects parts, refusing a default or repeated name and a part with no class. `collector.made` is the list so far. */
function partCollector( who ) {

	const made = [], taken = new Set();
	const add = ( name, classes, triangles, from = {}, extra = {} ) => {

		if ( ! name || isDefaultName( name ) ) throw new Error( who + ': every part needs a name an author chose, and "' + name + '" is a default' );
		if ( taken.has( name.toLowerCase() ) ) throw new Error( who + ': the name "' + name + '" is used by two parts' );
		if ( ! Array.isArray( classes ) || classes.length === 0 ) throw new Error( who + ': part "' + name + '" needs at least one class' );
		taken.add( name.toLowerCase() );
		made.push( { name, classes, triangles, ...from, ...extra } );

	};
	add.made = made;
	return add;

}

/**
 * Cut by a plan:
 *   { group, classes, parts: [
 *       { name, island, classes },                                              a whole island (or a list of them) becomes one part
 *       { name, component, classes },                                           the same, by component (islands that touch in space; see SEG.components)
 *       { island, subdivide, palette: [ { name, color: [r, g, b], classes } ] } ],   an island is divided by colour; entries with the same name make one part
 *     anchors: [ { name, classes, component, basis } ],                          a scene: name the anchors, and every other component goes to the nearest
 *     attach: { maxDistance, tie } }                                             (optional; see attachComponents). `basis` says what the name rests on: position, size, colour or shape
 * Every island must go to exactly one part. A palette part is first subdivided (each triangle becomes 4^subdivide smaller ones, the same surface and
 * texture) because the triangles of a flat patch are far larger than the rings painted on it; then each small triangle goes to the palette colour
 * nearest the texture colour at its centre. Returns [ { name, classes, triangles } ].
 * `ctx` is { matrix, meta }: the node's matrixWorld elements (scenes are measured in the world frame), and an object that is filled with what the record keeps
 * (the grain, the component counts, the attachment report, the assertions that fired).
 */
export function planParts( data, plan, read, ctx = {} ) {

	if ( ! plan || ! Array.isArray( plan.parts || [] ) || ( ( plan.parts || [] ).length === 0 && ! ( plan.anchors && plan.anchors.length ) ) ) throw new Error( 'SEG.split: the plan needs a parts list (or anchors)' );
	const names = Object.keys( data.attrs ), idx = triangleIndex( data ), scene = componentsOf( data ), islands = scene.islands, used = new Set();
	const UV = names.indexOf( 'uv' ) < 0 ? - 1 : names.slice( 0, names.indexOf( 'uv' ) ).reduce( ( s, n ) => s + data.attrs[ n ].itemSize, 0 );
	const addPart = partCollector( 'SEG.split' ), made = addPart.made, meta = ctx.meta || {};
	const anchored = Array.isArray( plan.anchors ) && plan.anchors.length > 0;
	const byComponent = ( plan.parts || [] ).some( p => p.component !== undefined ) || anchored;
	// a part given by component is the islands of those components
	const expand = ( part, who ) => {

		if ( part.component === undefined ) return part;
		if ( part.island !== undefined ) throw new Error( 'SEG.split: part "' + part.name + '" gives both island and component' );
		const ids = [].concat( part.component );
		for ( const c of ids ) if ( ! scene.components[ c ] ) throw new Error( 'SEG.split: there is no component ' + c + ' (the mesh has ' + scene.components.length + ')' );
		return { ...part, island: ids.flatMap( c => scene.components[ c ].islands ).sort( ( a, b ) => a - b ) };

	};
	let parts = ( plan.parts || [] ).map( p => expand( p ) ), attach = null;
	if ( anchored ) {

		if ( parts.some( p => p.component === undefined && p.island !== undefined ) ) throw new Error( 'SEG.split: with anchors, give the other parts by component (component: [..]), not by island: attaching works on whole components' );
		const claimed = new Set( ( plan.parts || [] ).flatMap( p => [].concat( p.component === undefined ? [] : p.component ) ) );
		for ( const a of plan.anchors ) for ( const c of [].concat( a.component === undefined ? [] : a.component ) ) if ( claimed.has( c ) ) throw new Error( 'SEG.split: component ' + c + ' is in a part and in the anchor "' + a.name + '"' );
		attach = attachComponents( data, scene, plan.anchors, { matrix: ctx.matrix, ...( plan.attach || {} ) } );
		if ( attach.unattached.length ) {

			const shown = attach.unattached.slice( 0, 6 ).map( u => `component ${ u.component } (nearest "${ u.nearest }", ${ u.distance })` ).join( ', ' );
			throw new Error( `SEG.split: ${ attach.unattached.length } component${ attach.unattached.length === 1 ? ' is' : 's are' } further than maxDistance (${ attach.parameters.max_distance }) from every anchor: ${ shown }${ attach.unattached.length > 6 ? ', …' : '' }. Name each as an anchor of its own (component: [n]) or raise attach.maxDistance. Nothing was changed` );

		}
		parts = [ ...parts, ...anchorParts( scene, plan.anchors, attach ).map( p => ( { ...p, component: undefined } ) ) ];

	}
	for ( const part of parts ) {

		const ids = [].concat( part.island );
		for ( const i of ids ) {

			if ( ! islands[ i ] ) throw new Error( 'SEG.split: there is no island ' + i + ' (the mesh has ' + islands.length + ')' );
			if ( used.has( i ) ) throw new Error( 'SEG.split: island ' + i + ' is used twice' );
			used.add( i );

		}
		if ( part.basis !== undefined && ! [].concat( part.basis ).every( b => BASES.includes( b ) ) ) throw new Error( 'SEG.split: part "' + part.name + '" has a basis that is not one of ' + BASES.join( ', ' ) );
		const parentOf = ids.flatMap( i => islands[ i ] );     // the input triangle each of `tris` is, so every output triangle can say where it came from
		const tris = parentOf.map( t => [ 0, 1, 2 ].map( k => vertexOf( data, names, idx[ t * 3 + k ] ) ) );
		const from = { islands: ids, subdivide: part.subdivide || 0, source_triangles: tris.length, basis: part.basis };
		if ( ! part.palette ) { addPart( part.name, part.classes, tris, from, { parents: parentOf } ); continue; }
		if ( ! read || UV < 0 ) throw new Error( 'SEG.split: dividing an island by colour needs a mesh with uv and a base-colour texture' );
		if ( ! part.palette.length ) throw new Error( 'SEG.split: an empty palette' );
		const bins = new Map();             // several palette colours may share one name (a part with a gradient in it)
		part.palette.forEach( p => { if ( ! bins.has( p.name ) ) bins.set( p.name, { classes: p.classes, triangles: [], parents: [] } ); } );
		for ( const [ j, source ] of tris.entries() ) for ( const t of subdivide( source, part.subdivide || 0 ) ) {

			const c = read( ( t[ 0 ][ UV ] + t[ 1 ][ UV ] + t[ 2 ][ UV ] ) / 3, ( t[ 0 ][ UV + 1 ] + t[ 1 ][ UV + 1 ] + t[ 2 ][ UV + 1 ] ) / 3 );
			let best = part.palette[ 0 ];
			for ( const p of part.palette ) if ( d2( c, p.color ) < d2( c, best.color ) ) best = p;
			bins.get( best.name ).triangles.push( t );
			bins.get( best.name ).parents.push( parentOf[ j ] );

		}
		bins.forEach( ( bin, name ) => { if ( bin.triangles.length ) addPart( name, bin.classes, bin.triangles, from, { parents: bin.parents } ); } );

	}
	if ( used.size !== islands.length ) throw new Error( 'SEG.split: every island must go to a part, and ' + ( islands.length - used.size ) + ' of ' + islands.length + ' have none' );
	const isl2comp = new Map(); scene.components.forEach( c => c.islands.forEach( i => isl2comp.set( i, c.component ) ) );
	meta.grain = byComponent ? 'components' : 'islands';
	meta.islands = islands.length; meta.components = scene.components.length;
	meta.componentsPerPart = Object.fromEntries( made.map( p => [ p.name, new Set( p.islands.map( i => isl2comp.get( i ) ) ).size ] ) );
	meta.attach = attach && { parameters: attach.parameters, per_part: Object.fromEntries( attach.perAnchor.map( a => [ a.name, { anchor_components: a.anchor_components, attached_components: a.attached_components, components: a.components, distance: a.distance } ] ) ), tie_broken: attach.tieBroken, unattached: attach.unattached };
	meta.anchors = anchored ? plan.anchors.length : 0;
	meta.assertions = cutAssertions( { made, data, scene, matrix: ctx.matrix, attach, read } );
	const broken = parentProblems( made, idx.length / 3 );
	if ( broken.length ) throw new Error( 'SEG.split: the parent triangles are inconsistent, which is a bug in SEG and not in the plan: ' + broken.join( '; ' ) );
	return made;

}

/**
 * Provenance check: every output triangle names the input triangle it was cut from (`parents`, one entry per output triangle, in the part's own order).
 * Cutting never loses or invents surface, so every input triangle must appear in total 4^n times, over all parts together, for one n: once when it was not
 * divided (so an undivided cut's parents are a permutation of the input triangles, split across the parts with nothing twice and nothing missing), and
 * 4^n times when it was divided by colour, where its children may land in different parts. Returns what is wrong, empty when it is sound.
 */
export function parentProblems( made, inputTriangles ) {

	const out = [], seen = new Uint32Array( inputTriangles );
	for ( const p of made ) {

		if ( ! Array.isArray( p.parents ) || p.parents.length !== p.triangles.length ) { out.push( `part "${ p.name }" has ${ p.parents ? p.parents.length : 'no' } parents for ${ p.triangles.length } triangles` ); continue; }
		for ( const t of p.parents ) { if ( ! ( Number.isInteger( t ) && t >= 0 && t < inputTriangles ) ) { out.push( `part "${ p.name }" has a parent ${ t } that is not an input triangle` ); break; } seen[ t ] ++; }

	}
	if ( out.length ) return out;
	let missing = 0, notPower = 0;
	for ( let t = 0; t < inputTriangles; t ++ ) {

		let n = seen[ t ];
		if ( n === 0 ) { missing ++; continue; }
		while ( n % 4 === 0 ) n /= 4;
		if ( n !== 1 ) notPower ++;

	}
	if ( missing ) out.push( missing + ' input triangles have no output triangle' );
	if ( notPower ) out.push( notPower + ' input triangles were cut into a number of pieces that is not a power of 4' );
	return out;

}

/**
 * A skinned mesh can be cut (every part keeps the skeleton, the bone indices and the weights) but not subdivided: a new vertex halfway along an edge has no
 * meaningful bone index, and averaging indices picks the wrong bone. Returns what is wrong with the plan, or null.
 */
export function skinnedPlanProblem( plan ) {

	const bad = ( plan.parts || [] ).filter( p => p && p.subdivide > 0 );
	return bad.length ? 'a skinned mesh cannot be divided by colour with subdivide (' + bad.map( p => p.name || 'a part' ).join( ', ' ) + '): new vertices would have no bone indices. Give whole islands or components, or palette with subdivide: 0' : null;

}

/**
 * Why SEG refused, as a code a program can switch on, from the message it threw. `reason` is stable across versions; `detail` is the message, for a person.
 * The codes: not-a-mesh, skinned-no-skeleton, skinned-subdivide, morph-targets, no-positions, multi-material, single-material, no-source, bad-source, group-name,
 * no-colour-evidence, name-in-use, plan-coverage (an island or component left over, used twice, or missing), plan-names (a default or missing name or class),
 * unattached (a component further than maxDistance from every anchor), bad-material-groups, no-selection, plan-invalid (anything else the plan got wrong).
 */
export function refusalOf( message ) {

	const m = String( message );
	const table = [
		[ /nothing matches/, 'no-selection' ],
		[ /is not a mesh/, 'not-a-mesh' ],
		[ /skinned mesh with no skeleton/, 'skinned-no-skeleton' ],
		[ /skinned mesh cannot be divided by colour with subdivide/, 'skinned-subdivide' ],
		[ /morph targets/, 'morph-targets' ],
		[ /has no positions/, 'no-positions' ],
		[ /materials\. Cut it by material first/, 'multi-material' ],
		[ /has one material; use SEG\.split/, 'single-material' ],
		[ /material group|material groups|cut by material would lose/, 'bad-material-groups' ],
		[ /plan needs a source|source is missing/, 'no-source' ],
		[ /source\.(url|sha256|bytes|commit|licence|attribution)|is a web page|names "main"/, 'bad-source' ],
		[ /group name an author chose/, 'group-name' ],
		[ /needs a mesh with uv and a base-colour texture|an empty palette/, 'no-colour-evidence' ],
		[ /is already used in the scene/, 'name-in-use' ],
		[ /every island must go to a part|every component|used twice|there is no (island|component|material)|is in a part and in the anchor|every material must go/, 'plan-coverage' ],
		[ /name an author chose|needs a name|at least one class|default/, 'plan-names' ],
		[ /further than maxDistance/, 'unattached' ],
	];
	for ( const [ re, reason ] of table ) if ( re.test( m ) ) return { reason, detail: m };
	return { reason: 'plan-invalid', detail: m };

}


/** The arrays of one part's geometry: every attribute, one vertex per triangle corner, and an index. Normals are renormalised after subdividing. */
export function carveAttributes( data, triangles ) {

	const names = Object.keys( data.attrs ), n = triangles.length * 3, out = {};
	let at = 0;
	for ( const name of names ) {

		const a = data.attrs[ name ], arr = new a.array.constructor( n * a.itemSize ), integer = ! ( a.array instanceof Float32Array || a.array instanceof Float64Array );
		triangles.forEach( ( t, i ) => t.forEach( ( v, k ) => { for ( let c = 0; c < a.itemSize; c ++ ) arr[ ( i * 3 + k ) * a.itemSize + c ] = integer ? Math.round( v[ at + c ] ) : v[ at + c ]; } ) );
		if ( name === 'normal' && a.itemSize === 3 && ! integer ) {

			for ( let i = 0; i < n; i ++ ) {

				const x = arr[ i * 3 ], y = arr[ i * 3 + 1 ], z = arr[ i * 3 + 2 ], l = Math.hypot( x, y, z ) || 1;
				arr[ i * 3 ] = x / l; arr[ i * 3 + 1 ] = y / l; arr[ i * 3 + 2 ] = z / l;

			}

		}
		out[ name ] = { array: arr, itemSize: a.itemSize, normalized: !! a.normalized };
		at += a.itemSize;

	}
	return { attrs: out, index: Array.from( { length: n }, ( _, i ) => i ) };

}

// ── the record: what the decision was made from, and what it was ───────────────────────────────────

// The source is validated by records.js (the one definition of the schema, shared with CI): see validateSource there.
export { validateSource };

function areaOf( triangles, at ) {

	let s = 0;
	for ( const t of triangles ) {

		const a = t[ 0 ], b = t[ 1 ], c = t[ 2 ];
		const ux = b[ at ] - a[ at ], uy = b[ at + 1 ] - a[ at + 1 ], uz = b[ at + 2 ] - a[ at + 2 ], vx = c[ at ] - a[ at ], vy = c[ at + 1 ] - a[ at + 1 ], vz = c[ at + 2 ] - a[ at + 2 ];
		s += Math.hypot( uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ) / 2;

	}
	return s;

}

/**
 * The record kept on the group (`userData.segmentation`), so the asset carries what it was made from, not only what came out:
 *   from, seg_version, method ('islands' | 'material'),
 *   source      { url, page, commit, sha256, bytes, licence, attribution }: the exact file the model came from, pinned to a commit and hashed, and its licence and credit,
 *   modifications   what was done to the model,
 *   plan        the plan as given, verbatim: re-running SEG.split on the same model with it gives the same parts,
 *   describe    the report the decision was made from (the islands with their sizes and colours, or the materials),
 *   parts       { name: triangles },
 *   parents     { name: [ parent triangle, … ] }: for every output triangle of a part, in the part's order, the number of the input triangle it was cut from
 *               (identity for a part that was not divided; the same number 4^n times when an island was divided by colour). Exact provenance: nothing has to be matched by position.
 *   signals     facts about the cut that may one day be worth refusing on (nothing is refused on them yet),
 *   verification  { status: 'seeded', reviews: [] }: who has looked, appended to by each review.
 */
export function buildRecord( { method, from, plan, describe, made, data, sourceTriangles, sourceUnits, source, meta = {} } ) {

	const names = Object.keys( data.attrs );
	const at = names.slice( 0, names.indexOf( 'position' ) ).reduce( ( s, n ) => s + data.attrs[ n ].itemSize, 0 );
	const areas = made.map( p => areaOf( p.triangles, at ) ), total = areas.reduce( ( a, b ) => a + b, 0 ) || 1;
	const mods = [ method === 'material'
		? `Cut "${ from }" (${ sourceTriangles } triangles, ${ sourceUnits } materials) into ${ made.length } meshes by material, with SEG ${ SEG_VERSION }. The geometry is unchanged.`
		: meta.grain === 'components'
			? `Cut "${ from }" (${ sourceTriangles } triangles, ${ meta.islands } islands in ${ meta.components } components) into ${ made.length } meshes with SEG ${ SEG_VERSION }, by component${ meta.attach ? ', attaching what was not named to the nearest named anchor' : '' }.`
			: `Cut "${ from }" (${ sourceTriangles } triangles, ${ sourceUnits } islands) into ${ made.length } meshes with SEG ${ SEG_VERSION }.` ];
	const seen = new Set();
	for ( const p of made ) {

		if ( ! p.subdivide || seen.has( p.islands.join() ) ) continue;
		seen.add( p.islands.join() );
		const after = made.filter( q => q.islands && q.islands.join() === p.islands.join() ).reduce( ( s, q ) => s + q.triangles.length, 0 );
		mods.push( `Island${ p.islands.length > 1 ? 's' : '' } ${ p.islands.join( ', ' ) } divided by colour: each triangle subdivided into ${ 4 ** p.subdivide } (${ p.source_triangles } to ${ after } triangles); the surface and the texture mapping are unchanged.` );

	}
	if ( meta.skinned ) mods.push( 'The mesh is skinned: every part is bound to the original skeleton with the original bind matrix, and the bone indices and weights are carried over unchanged, so the animations still drive every part.' );
	mods.push( method === 'material' ? 'Each part keeps its original material and texture, unchanged.' : 'The original material and texture are shared by all the parts and are unchanged.' );
	for ( const m of [].concat( plan.modifications || [] ) ) if ( typeof m === 'string' && m.trim() ) mods.push( m.trim() );
	const basisOf = p => { const b = [].concat( p.basis || [] ); return b.some( x => x !== 'shape' ) ? 'evidence' : b.length ? 'shape' : 'unstated'; };
	const scene = meta.components === undefined ? {} : {
		island_count: meta.islands, component_count: meta.components, anchor_count: meta.anchors,
		components_per_part: meta.componentsPerPart,
		names_by_basis: made.reduce( ( o, p ) => { o[ basisOf( p ) ] ++; return o; }, { evidence: 0, shape: 0, unstated: 0 } ),
		assertions: meta.assertions ? meta.assertions.fired : [],
		assertion_parameters: meta.assertions ? meta.assertions.parameters : undefined
	};
	return {
		from, seg_version: SEG_VERSION, method,
		...( meta.grain ? { grain: meta.grain } : {} ),
		source: validateSource( source ).source,
		modifications: mods,
		plan: JSON.parse( JSON.stringify( plan ) ),
		describe,
		...( meta.attach ? { attach: meta.attach } : {} ),
		parts: Object.fromEntries( made.map( p => [ p.name, p.triangles.length ] ) ),
		parents: Object.fromEntries( made.map( p => [ p.name, p.parents ] ) ),
		signals: {
			source_units: sourceUnits, part_count: made.length,
			largest_part_area_share: +( Math.max( ...areas ) / total ).toFixed( 3 ),
			compound_names: made.map( p => p.name ).filter( n => /(^|_)and(_|$)/i.test( n ) || n.includes( '&' ) ),
			...scene
		},
		// nobody has looked yet: a review appends to this, so agreement is a visible diff (see export/records.js)
		verification: initialVerification()
	};

}

/** Does a mesh match the description a record was made from? Returns the differences, empty when it does (tiny float noise is allowed). */
export function compareDescribe( recorded, fresh ) {

	const out = [], close = ( a, b, tol ) => Math.abs( a - b ) <= tol * Math.max( 1, Math.abs( a ), Math.abs( b ) );
	if ( ! recorded ) return [ 'the record has no description to compare with' ];
	const kind = r => ( r.components ? 'components' : r.islands ? 'islands' : 'materials' ), what = kind( recorded );
	const A = recorded.components || recorded.islands || recorded.materials || [], B = fresh.components || fresh.islands || fresh.materials || [];
	if ( what !== kind( fresh ) ) return [ 'the record was made from ' + what + ' and this mesh has ' + kind( fresh ) ];
	if ( A.length !== B.length ) out.push( `the record has ${ A.length } ${ what } and this mesh has ${ B.length }` );
	for ( let i = 0; i < Math.min( A.length, B.length ); i ++ ) {

		const a = A[ i ], b = B[ i ], w = what.slice( 0, - 1 ) + ' ' + i;
		if ( a.triangles !== b.triangles ) out.push( `${ w } has ${ b.triangles } triangles, the record says ${ a.triangles }` );
		if ( what === 'components' && a.islands.join() !== b.islands.join() ) out.push( `${ w } is made of islands ${ b.islands.join() }, the record says ${ a.islands.join() }` );
		if ( what !== 'components' && a.size && ! a.size.every( ( x, c ) => close( x, b.size[ c ], 1e-4 ) ) ) out.push( `${ w } is ${ b.size.map( x => x.toFixed( 3 ) ) } in size, the record says ${ a.size.map( x => x.toFixed( 3 ) ) }` );
		if ( a.colours && b.colours ) {

			if ( a.colours.length !== b.colours.length || a.colours.some( ( c, j ) => c.rgb.some( ( x, k ) => Math.abs( x - b.colours[ j ].rgb[ k ] ) > 4 ) || Math.abs( c.share - b.colours[ j ].share ) > 0.03 ) ) out.push( `${ w } is painted differently from the record` );

		}

	}
	return out;

}

/** The triangles of each material of a multi-material mesh: Map( materialIndex → triangle numbers ). Every triangle must be in exactly one group. */
export function materialParts( data, groups ) {

	const total = triangleIndex( data ).length / 3, by = new Map(), seen = new Uint8Array( total );
	for ( const g of groups ) {

		const first = g.start / 3, last = ( g.start + g.count ) / 3;
		if ( ! Number.isInteger( first ) || ! Number.isInteger( last ) ) throw new Error( 'SEG: a material group does not start and end on a triangle' );
		for ( let t = first; t < last; t ++ ) {

			if ( t >= total ) throw new Error( 'SEG: a material group runs past the end of the mesh' );
			if ( seen[ t ] ) throw new Error( 'SEG: material groups overlap' );
			seen[ t ] = 1;
			if ( ! by.has( g.materialIndex ) ) by.set( g.materialIndex, [] );
			by.get( g.materialIndex ).push( t );

		}

	}
	if ( seen.some( v => ! v ) ) throw new Error( 'SEG: the material groups do not cover every triangle, so a cut by material would lose some' );
	return by;

}

/**
 * Cut by material: { group, classes, source, parts: [ { material: 0, name, classes } ] }. Every material that has triangles must have a part.
 * Material assignment is exact evidence, given by the author of the model: no seam artefacts and no guessing. Returns [ { name, classes, triangles, material } ].
 */
export function planMaterialParts( data, groups, plan ) {

	if ( ! plan || ! Array.isArray( plan.parts ) || plan.parts.length === 0 ) throw new Error( 'SEG.byMaterial: the plan needs a parts list' );
	const names = Object.keys( data.attrs ), idx = triangleIndex( data ), by = materialParts( data, groups ), used = new Set(), add = partCollector( 'SEG.byMaterial' );
	for ( const part of plan.parts ) {

		if ( ! by.has( part.material ) ) throw new Error( 'SEG.byMaterial: there is no material ' + part.material + ' with triangles' );
		if ( used.has( part.material ) ) throw new Error( 'SEG.byMaterial: material ' + part.material + ' is used twice' );
		used.add( part.material );
		const tris = by.get( part.material ).map( t => [ 0, 1, 2 ].map( k => vertexOf( data, names, idx[ t * 3 + k ] ) ) );
		add( part.name, part.classes, tris, { source_triangles: tris.length }, { material: part.material, parents: by.get( part.material ).slice() } );

	}
	if ( used.size !== by.size ) throw new Error( 'SEG.byMaterial: every material must go to a part, and ' + ( by.size - used.size ) + ' of ' + by.size + ' have none' );
	const broken = parentProblems( add.made, idx.length / 3 );
	if ( broken.length ) throw new Error( 'SEG.byMaterial: the parent triangles are inconsistent, which is a bug in SEG and not in the plan: ' + broken.join( '; ' ) );
	return add.made;

}

// ── the Shell surface ─────────────────────────────────────────────────────────────────────────────

const PREVIEW = [ '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#008080', '#9a6324' ];

// the materials a preview replaced, per editor: the Shell builds its globals again for every command, so this cannot live inside makeSegment
const SAVED = new WeakMap();

// what an importer leaves round a mesh: nameless nodes, a node named after the file
const wrapperLike = o => ! o.name || isDefaultName( o.name ) || /\.(glb|gltf|vrm|obj|fbx|dae|stl|ply)$/i.test( o.name );

const slug = s => String( s ).trim().toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

/**
 * makeSegment( editor, { THREE, commands, query, index } ) → SEG
 *   SEG.describe(node | selector, k = 3, { grain })   text: every island, or every component on a mesh unwrapped in pieces (grain 'auto'), or every material
 *   SEG.data(node | selector, k = 3, { grain })       the same as objects
 *   SEG.components(node | selector, { k })             the components: islands that touch in space, in the world frame
 *   SEG.attach(node | selector, anchors, { maxDistance, tie })   where every unnamed component would go, without cutting
 *   SEG.split(node | selector, plan)          cut into named, classed meshes in one group (one undo step). plan.source is required; a scene plan gives anchors
 *   SEG.byMaterial(node | selector, plan)     the same for a mesh with several materials, cut by material: exact evidence from the model's author
 *   SEG.replay(node | selector, record)       cut again from a recorded plan; refuses if the mesh is not the one the record was made from
 *   SEG.wouldRefuse(node | selector, plan?)   null, or { reason, detail, seg_version }: would SEG refuse this mesh (and plan)? nothing is changed
 *   SEG.preview(group | selector)             a flat colour per part, to check the cut;  SEG.restore() puts the materials back
 * `index(root, force)` (the descriptor writer) is called on the new group, so every part has its own descriptors from the start.
 */
export function makeSegment( editor, { THREE, commands, query, index } ) {

	const { AddObjectCommand, RemoveObjectCommand, SetMaterialCommand, MultiCmdsCommand } = commands;
	const SEG = {};

	const materialsOf = node => ( Array.isArray( node.material ) ? node.material : [ node.material ] );
	const groupsOf = node => ( node.geometry.groups || [] );
	// several materials only when the mesh really has more than one material in use
	const isMulti = node => Array.isArray( node.material ) && groupsOf( node ).length > 0 && new Set( groupsOf( node ).map( g => g.materialIndex ) ).size > 1;
	const singleMaterial = node => ( Array.isArray( node.material ) ? node.material[ ( groupsOf( node )[ 0 ] || {} ).materialIndex || 0 ] : node.material );

	const resolve = ( what, kind ) => {

		const node = typeof what === 'string' ? query( what ).nodes[ 0 ] : what;
		if ( ! node ) throw new Error( 'SEG: nothing matches ' + JSON.stringify( what ) );
		if ( kind === 'mesh' || kind === 'any' ) {

			if ( ! node.isMesh ) throw new Error( 'SEG: "' + node.name + '" is not a mesh (select the mesh itself, not its group)' );
			if ( node.isSkinnedMesh && ! node.skeleton ) throw new Error( 'SEG: "' + node.name + '" is a skinned mesh with no skeleton, so its parts could not be bound to anything' );
			if ( node.geometry.morphAttributes && Object.keys( node.geometry.morphAttributes ).length ) throw new Error( 'SEG: meshes with morph targets are not supported' );
			if ( ! node.geometry.attributes.position ) throw new Error( 'SEG: the mesh has no positions' );
			if ( kind === 'mesh' && isMulti( node ) ) throw new Error( 'SEG: "' + node.name + '" has ' + new Set( groupsOf( node ).map( g => g.materialIndex ) ).size + ' materials. Cut it by material first with SEG.byMaterial: the author of the model assigned them, so they are better evidence than islands' );

		}
		return node;

	};
	const dataOf = node => dataOfGeometry( node.geometry );
	// the node's matrixWorld as a plain array: scenes are measured in the world frame, because an importer often rotates a Z-up model and a mesh-frame "up" is not y
	const matrixOf = node => { node.updateWorldMatrix( true, false ); return Array.from( node.matrixWorld.elements ); };
	const readerOf = node => {

		const m = isMulti( node ) ? null : singleMaterial( node );
		return ( m && m.map && m.map.image && node.geometry.attributes.uv ) ? textureReader( m.map ) : null;

	};
	const hex = c => '#' + ( c && c.getHexString ? c.getHexString() : 'ffffff' );

	const materialReport = node => {

		const by = materialParts( dataOf( node ), groupsOf( node ) ), mats = materialsOf( node );
		return { materials: [ ...by.keys() ].sort( ( a, b ) => a - b ).map( i => ( { material: i, name: mats[ i ] ? mats[ i ].name || '' : '', colour: hex( mats[ i ] && mats[ i ].color ), textured: !! ( mats[ i ] && mats[ i ].map ), triangles: by.get( i ).length } ) ) };

	};
	const reportOf = ( node, k, grain = 'auto' ) => {

		if ( isMulti( node ) ) return materialReport( node );
		const data = dataOf( node ), read = readerOf( node ), { islands, components } = componentsOf( data );
		if ( grainOf( islands.length, components.length, grain ) === 'components' ) return { grain: 'components', k, components: describeComponents( data, read, { k, matrix: matrixOf( node ) } ), island_count: islands.length };
		return { k, islands: describeIslands( data, read, k ) };

	};
	const formatMaterials = r => r.materials.map( m => `material ${ m.material }: "${ m.name }", ${ m.triangles } triangles, colour ${ m.colour }, ${ m.textured ? 'textured' : 'flat' }` ).join( '\n' )
		+ '\n(this mesh has several materials: cut it with SEG.byMaterial, which is exact; then SEG.describe each part if it needs cutting further)';

	// describe and data take ( what, k, { grain } ) or ( what, { k, grain } ); the grain is chosen here when it is not given: an object report leads with colours and
	// islands, a scene report with size and position and components, and the caller can always say which
	const argsOf = ( k, opts ) => { if ( k && typeof k === 'object' ) { opts = k; k = opts.k; } return { k: k || 3, grain: ( opts && opts.grain ) || 'auto' }; };
	SEG.data = ( what, k, opts ) => { const a = argsOf( k, opts ), r = reportOf( resolve( what, 'any' ), a.k, a.grain ); return r.components || r.islands || r.materials; };
	SEG.describe = ( what, k, opts ) => { const a = argsOf( k, opts ), r = reportOf( resolve( what, 'any' ), a.k, a.grain ); return r.components ? formatComponents( r.components, r.island_count ) : r.islands ? formatIslands( r.islands ) : formatMaterials( r ); };
	/** The components of a mesh (islands that touch in space), measured in the world frame: triangles, size, centre, at, the islands in each, colours. */
	SEG.components = ( what, opts ) => { const a = argsOf( opts && opts.k, opts ), node = resolve( what, 'mesh' ); return describeComponents( dataOf( node ), readerOf( node ), { k: a.k, matrix: matrixOf( node ) } ); };
	/**
	 * Where would everything go? Attach every component that is not an anchor to the nearest anchor, without cutting: returns the parts it would make, what it
	 * would leave unattached (further than maxDistance from every anchor), the parameters used, and the distance of every attachment per part.
	 *   SEG.attach('#Mesh', [ { name: 'Floor_Deck', classes: ['floor'], component: [29] }, … ], { maxDistance, tie })
	 */
	SEG.attach = ( what, anchors, opts = {} ) => {

		const node = resolve( what, 'mesh' ), data = dataOf( node ), scene = componentsOf( data ), r = attachComponents( data, scene, anchors, { matrix: matrixOf( node ), ...opts } );
		return { parts: anchorParts( scene, anchors, r ), unattached: r.unattached, tie_broken: r.tieBroken, parameters: r.parameters, per_part: r.perAnchor };

	};

	// everything about a cut except doing it: the parts, the record, the names it will use
	const prepare = ( what, plan, method ) => {

		const node = resolve( what, method === 'material' ? 'any' : 'mesh' ), data = dataOf( node );
		const who = method === 'material' ? 'SEG.byMaterial' : 'SEG.split';
		if ( ! plan || typeof plan !== 'object' ) throw new Error( who + ': the plan is missing' );
		validateSource( plan.source, who );
		if ( ! plan.group || isDefaultName( plan.group ) ) throw new Error( who + ': the plan needs a group name an author chose' );
		if ( node.isSkinnedMesh ) { const bad = skinnedPlanProblem( plan ); if ( bad ) throw new Error( who + ': ' + bad ); }
		let made, describe, units;
		const meta = { skinned: !! node.isSkinnedMesh };
		if ( method === 'material' ) {

			if ( ! isMulti( node ) ) throw new Error( 'SEG.byMaterial: "' + node.name + '" has one material; use SEG.split' );
			made = planMaterialParts( data, groupsOf( node ), plan ); describe = materialReport( node ); units = describe.materials.length;

		} else {

			const k = 3, read = readerOf( node );
			made = planParts( data, plan, read, { matrix: matrixOf( node ), meta } );
			describe = meta.grain === 'components' ? { grain: 'components', k, components: describeComponents( data, read, { k, matrix: matrixOf( node ) } ) } : { k, islands: describeIslands( data, read, k ) };
			units = meta.grain === 'components' ? describe.components.length : describe.islands.length;

		}
		const sourceTriangles = triangleIndex( data ).length / 3;
		const record = buildRecord( { method, from: node.name || 'mesh', plan, describe, made, data, sourceTriangles, sourceUnits: units, source: plan.source, meta } );
		// the names: nothing already in the scene (outside what is about to be removed) may use them
		let gone = node;
		while ( gone.parent && gone.parent !== editor.scene && gone.parent.children.length === 1 && wrapperLike( gone.parent ) ) gone = gone.parent;
		const removed = new Set(); gone.traverse( o => removed.add( o ) );
		const existing = new Set();
		editor.scene.traverse( o => { if ( ! removed.has( o ) && o.name ) existing.add( o.name.toLowerCase() ); } );
		for ( const n of [ plan.group, ...made.map( p => p.name ) ] ) if ( existing.has( n.toLowerCase() ) ) throw new Error( who + ': the name "' + n + '" is already used in the scene' );
		// the new group goes where the mesh was, but not into an importer's wrapper: it goes to the first node an author would recognise (the scene, usually)
		let place = node.parent || editor.scene;
		while ( place !== editor.scene && wrapperLike( place ) && place.parent ) place = place.parent;
		return { node, gone, place, data, made, record, plan, meta };

	};

	const commit = ( { node, gone, place, data, made, record, plan, meta = {} } ) => {

		const group = new THREE.Group();
		group.name = plan.group;
		group.userData.customClasses = plan.classes && plan.classes.length ? plan.classes : [ 'segmented' ];
		const parent = place;
		node.updateWorldMatrix( true, false ); parent.updateWorldMatrix( true, false );
		new THREE.Matrix4().copy( parent.matrixWorld ).invert().multiply( node.matrixWorld ).decompose( group.position, group.quaternion, group.scale );   // where the mesh was, in its parent's frame
		for ( const part of made ) {

			const { attrs, index: ix } = carveAttributes( data, part.triangles ), geo = new THREE.BufferGeometry();
			for ( const [ name, a ] of Object.entries( attrs ) ) geo.setAttribute( name, new THREE.BufferAttribute( a.array, a.itemSize, a.normalized ) );
			geo.setIndex( ix ); geo.computeBoundingBox(); geo.computeBoundingSphere();
			const material = part.material !== undefined ? node.material[ part.material ] : singleMaterial( node );   // the original material, so the object looks exactly as it did
			let m;
			if ( node.isSkinnedMesh ) {

				// every part is bound to the original skeleton with the original bind matrix: the bones, and the animations that drive them, are not touched
				m = new THREE.SkinnedMesh( geo, material );
				m.bind( node.skeleton, node.bindMatrix );
				m.bindMode = node.bindMode;

			} else m = new THREE.Mesh( geo, material );
			m.name = part.name; m.castShadow = node.castShadow; m.receiveShadow = node.receiveShadow; m.visible = node.visible;
			m.userData.customClasses = part.classes;
			group.add( m );

		}
		group.userData.segmentation = record;
		// the mesh goes, and so do the empty wrapper nodes an importer leaves round it (a file name, a root), so nothing nameless is left behind
		const add = new AddObjectCommand( editor, group );
		if ( parent !== editor.scene ) add.execute = () => { editor.addObject( group, parent, parent.children.length ); editor.select( group ); };   // added under its parent; undo is the usual remove
		editor.execute( new MultiCmdsCommand( editor, [ new RemoveObjectCommand( editor, gone ), add ] ) );
		if ( index ) index( group, true );          // every part gets descriptors now, with its own colour, so the exported asset carries them
		// a failed check does not stop the cut (it is one undo step) and is never corrected here: it is said, with the numbers, for whoever wrote the plan to act on
		const fired = ( meta.assertions ? meta.assertions.fired : [] ).map( f => `⚠ ${ f.assertion }: ${ f.part }: ${ f.message }` );
		return [ made.map( p => p.name + ': ' + p.triangles.length + ' triangles' ).join( ' | ' ), ...fired ].join( '\n' );

	};

	SEG.split = ( what, plan ) => commit( prepare( what, plan, 'islands' ) );
	/**
	 * Would SEG refuse this? null when it would not, else { reason, detail, seg_version }: `reason` is a stable code (see refusalOf), `detail` the message a person
	 * reads, `seg_version` the SEG that answered, so a verdict can be filed with the version it is true for. Nothing is changed. With no plan, only what is wrong
	 * with the mesh itself is checked (not a mesh, morph targets, several materials, …); with a plan, the whole cut is prepared and discarded.
	 *   SEG.wouldRefuse('#Mesh', plan)  // method 'islands'; give plan.method = 'material' for SEG.byMaterial
	 */
	SEG.wouldRefuse = ( what, plan ) => {

		try {

			if ( plan === undefined || plan === null ) resolve( what, 'mesh' );
			else prepare( what, plan, plan.method === 'material' ? 'material' : 'islands' );
			return null;

		} catch ( e ) { return { ...refusalOf( e && e.message ), seg_version: SEG_VERSION }; }

	};
	SEG.byMaterial = ( what, plan = {} ) => {

		const node = resolve( what, 'any' );
		if ( isMulti( node ) && ! plan.parts ) {

			// no parts given: one part per material, named from the material's own name
			const r = materialReport( node );
			plan = { ...plan, parts: r.materials.map( m => {

				const name = m.name && ! /^material(\.\d+)?$/i.test( m.name.trim() ) ? m.name.trim() : null;
				if ( ! name || isDefaultName( name ) ) throw new Error( 'SEG.byMaterial: material ' + m.material + ' has no name an author chose ("' + m.name + '"); give the parts: parts: [ { material: ' + m.material + ', name, classes } ]' );
				return { material: m.material, name: ( node.name ? node.name + '_' : '' ) + name.replace( /\s+/g, '_' ), classes: [ slug( name ) || 'part' ] };

			} ) };

		}
		return commit( prepare( what, plan, 'material' ) );

	};

	/**
	 * The source block for a model, computed, not typed: fetches the file, hashes it and measures it. `url` must be the raw, commit-pinned address
	 * (https://raw.githubusercontent.com/<owner>/<repo>/<commit sha>/<path>); a `blob/` page or a branch name is refused before anything is fetched.
	 *   SEG.source('https://raw.githubusercontent.com/…/<sha>/…/Duck.glb', { licence: '…', attribution: '…' }).then( s => { plan.source = s; } )   // the Shell has no top-level await
	 */
	SEG.source = async ( url, { licence, attribution, page, commit } = {} ) => {

		validateSource( { url, licence, attribution, page, commit, sha256: '0'.repeat( 64 ), bytes: 1 }, 'SEG.source' );     // the address, the licence and the credit, before any fetch
		const res = await fetch( url );
		if ( ! res.ok ) throw new Error( `SEG.source: ${ url } answered ${ res.status }` );
		const bytes = new Uint8Array( await res.arrayBuffer() );
		return validateSource( { url, licence, attribution, page, commit, sha256: await sha256Hex( bytes ), bytes: bytes.byteLength }, 'SEG.source' ).source;

	};

	/**
	 * Cut again from a record: the same plan on the same model. Refuses, before changing anything, if the mesh differs from the one the record describes.
	 * A record made before SEG 1.3.0 has a source that floats and is not hashed; replaying it makes a new record, which must not be like that, so give the
	 * pinned source: SEG.replay('#Mesh', record, { source }) with source from SEG.source(url, { licence, attribution }).then( s => { source = s; } ).
	 */
	SEG.replay = ( what, record, { check = true, source } = {} ) => {

		const rec = record && record.userData ? record.userData.segmentation : typeof record === 'string' ? ( query( record ).nodes[ 0 ] || {} ).userData?.segmentation : record;
		if ( ! rec || ! rec.plan ) throw new Error( 'SEG.replay: there is no recorded plan (records made before SEG ' + SEG_VERSION + ' kept only the part sizes)' );
		const plan = { ...rec.plan, source: source || rec.source || rec.plan.source };
		try { validateSource( plan.source, 'SEG.replay' ); } catch ( e ) { throw new Error( e.message + '. This record predates pinned sources: pass { source } (from SEG.source(url, { licence, attribution }).then( s => { source = s; } )) to replay it' ); }
		const method = rec.method || 'islands';
		const node = resolve( what, 'any' );
		if ( check ) {

			const diffs = compareDescribe( rec.describe, method === 'material' ? ( isMulti( node ) ? materialReport( node ) : { islands: [] } ) : ( isMulti( node ) ? materialReport( node ) : reportOf( node, rec.describe && rec.describe.k || 3, rec.grain === 'components' ? 'components' : 'islands' ) ) );
			if ( diffs.length ) throw new Error( 'SEG.replay: this mesh is not the one the record was made from: ' + diffs.slice( 0, 4 ).join( '; ' ) + ( diffs.length > 4 ? ' (and ' + ( diffs.length - 4 ) + ' more)' : '' ) );

		}
		const done = prepare( what, plan, method );
		const want = JSON.stringify( rec.parts ), got = JSON.stringify( done.record.parts );
		if ( want !== got ) throw new Error( 'SEG.replay: the plan gives different parts from the record (' + got + ' against ' + want + '); nothing was changed' );
		if ( rec.parents && JSON.stringify( rec.parents ) !== JSON.stringify( done.record.parents ) ) throw new Error( 'SEG.replay: the plan gives the same part sizes as the record but different parent triangles; nothing was changed' );
		return commit( done ) + '\nreplayed: all ' + done.made.length + ' parts match the record';

	};

	SEG.preview = what => {

		const group = resolve( what );
		if ( ! SAVED.has( editor ) ) SAVED.set( editor, new Map() );
		const saved = SAVED.get( editor );
		const meshes = []; group.traverse( o => { if ( o.isMesh ) meshes.push( o ); } );
		const cmds = meshes.map( ( m, i ) => { if ( ! saved.has( m ) ) saved.set( m, m.material ); return new SetMaterialCommand( editor, m, new THREE.MeshBasicMaterial( { color: PREVIEW[ i % PREVIEW.length ] } ) ); } );
		if ( cmds.length ) editor.execute( new MultiCmdsCommand( editor, cmds ) );
		return meshes.map( ( m, i ) => PREVIEW[ i % PREVIEW.length ] + '  ' + m.name ).join( '\n' );

	};
	SEG.restore = () => {

		const saved = SAVED.get( editor ) || new Map();
		const cmds = [ ...saved ].filter( ( [ m ] ) => m.parent ).map( ( [ m, material ] ) => new SetMaterialCommand( editor, m, material ) );
		saved.clear();
		if ( cmds.length ) editor.execute( new MultiCmdsCommand( editor, cmds ) );
		return 'textured materials restored';

	};
	return SEG;

}
