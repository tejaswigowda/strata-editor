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
import { kmeans, textureReader, dataOfGeometry } from './textureColour.js';

export { kmeans, textureReader };

/** Written into every record. Records made before 1.1.0 carry no version, no plan and no evidence. */
export const SEG_VERSION = '1.1.0';

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
 *       { island, subdivide, palette: [ { name, color: [r, g, b], classes } ] } ] }   an island is divided by colour; entries with the same name make one part
 * Every island must go to exactly one part. A palette part is first subdivided (each triangle becomes 4^subdivide smaller ones, the same surface and
 * texture) because the triangles of a flat patch are far larger than the rings painted on it; then each small triangle goes to the palette colour
 * nearest the texture colour at its centre. Returns [ { name, classes, triangles } ].
 */
export function planParts( data, plan, read ) {

	if ( ! plan || ! Array.isArray( plan.parts ) || plan.parts.length === 0 ) throw new Error( 'SEG.split: the plan needs a parts list' );
	const names = Object.keys( data.attrs ), idx = triangleIndex( data ), islands = islandsOf( data ), used = new Set();
	const UV = names.indexOf( 'uv' ) < 0 ? - 1 : names.slice( 0, names.indexOf( 'uv' ) ).reduce( ( s, n ) => s + data.attrs[ n ].itemSize, 0 );
	const addPart = partCollector( 'SEG.split' ), made = addPart.made;
	for ( const part of plan.parts ) {

		const ids = [].concat( part.island );
		for ( const i of ids ) {

			if ( ! islands[ i ] ) throw new Error( 'SEG.split: there is no island ' + i + ' (the mesh has ' + islands.length + ')' );
			if ( used.has( i ) ) throw new Error( 'SEG.split: island ' + i + ' is used twice' );
			used.add( i );

		}
		const tris = ids.flatMap( i => islands[ i ] ).map( t => [ 0, 1, 2 ].map( k => vertexOf( data, names, idx[ t * 3 + k ] ) ) );
		const from = { islands: ids, subdivide: part.subdivide || 0, source_triangles: tris.length };
		if ( ! part.palette ) { addPart( part.name, part.classes, tris, from ); continue; }
		if ( ! read || UV < 0 ) throw new Error( 'SEG.split: dividing an island by colour needs a mesh with uv and a base-colour texture' );
		if ( ! part.palette.length ) throw new Error( 'SEG.split: an empty palette' );
		const bins = new Map();             // several palette colours may share one name (a part with a gradient in it)
		part.palette.forEach( p => { if ( ! bins.has( p.name ) ) bins.set( p.name, { classes: p.classes, triangles: [] } ); } );
		for ( const t of tris.flatMap( s => subdivide( s, part.subdivide || 0 ) ) ) {

			const c = read( ( t[ 0 ][ UV ] + t[ 1 ][ UV ] + t[ 2 ][ UV ] ) / 3, ( t[ 0 ][ UV + 1 ] + t[ 1 ][ UV + 1 ] + t[ 2 ][ UV + 1 ] ) / 3 );
			let best = part.palette[ 0 ];
			for ( const p of part.palette ) if ( d2( c, p.color ) < d2( c, best.color ) ) best = p;
			bins.get( best.name ).triangles.push( t );

		}
		bins.forEach( ( bin, name ) => { if ( bin.triangles.length ) addPart( name, bin.classes, bin.triangles, from ); } );

	}
	if ( used.size !== islands.length ) throw new Error( 'SEG.split: every island must go to a part, and ' + ( islands.length - used.size ) + ' of ' + islands.length + ' have none' );
	return made;

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

/**
 * A segmentation is a derivative work, so the record must say what it derives from. `source` is { url, licence, attribution }: the address of the
 * original model, the licence it is under (as its owner states it) and the credit line. SEG cannot check them; it refuses to cut without them, so
 * that no segmented asset exists without them.
 */
export function validateSource( source, who = 'SEG.split' ) {

	if ( ! source || typeof source !== 'object' ) throw new Error( who + ': the plan needs a source: { url, licence, attribution }. A segmentation is a derivative work, and its record must say what it derives from and under what licence' );
	for ( const k of [ 'url', 'licence', 'attribution' ] ) if ( typeof source[ k ] !== 'string' || ! source[ k ].trim() ) throw new Error( who + ': source.' + k + ' is missing' );
	if ( ! /^https?:\/\/\S+$/i.test( source.url.trim() ) ) throw new Error( who + ': source.url must be the http(s) address of the original model' );
	return { source_url: source.url.trim(), source_licence: source.licence.trim(), attribution: source.attribution.trim() };

}

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
 *   source_url, source_licence, attribution, modifications   (the provenance, and what was done to the model),
 *   plan        the plan as given, verbatim: re-running SEG.split on the same model with it gives the same parts,
 *   describe    the report the decision was made from (the islands with their sizes and colours, or the materials),
 *   parts       { name: triangles },
 *   signals     facts about the cut that may one day be worth refusing on (nothing is refused on them yet).
 */
export function buildRecord( { method, from, plan, describe, made, data, sourceTriangles, sourceUnits, source } ) {

	const names = Object.keys( data.attrs );
	const at = names.slice( 0, names.indexOf( 'position' ) ).reduce( ( s, n ) => s + data.attrs[ n ].itemSize, 0 );
	const areas = made.map( p => areaOf( p.triangles, at ) ), total = areas.reduce( ( a, b ) => a + b, 0 ) || 1;
	const mods = [ method === 'material'
		? `Cut "${ from }" (${ sourceTriangles } triangles, ${ sourceUnits } materials) into ${ made.length } meshes by material, with SEG ${ SEG_VERSION }. The geometry is unchanged.`
		: `Cut "${ from }" (${ sourceTriangles } triangles, ${ sourceUnits } islands) into ${ made.length } meshes with SEG ${ SEG_VERSION }.` ];
	const seen = new Set();
	for ( const p of made ) {

		if ( ! p.subdivide || seen.has( p.islands.join() ) ) continue;
		seen.add( p.islands.join() );
		const after = made.filter( q => q.islands && q.islands.join() === p.islands.join() ).reduce( ( s, q ) => s + q.triangles.length, 0 );
		mods.push( `Island${ p.islands.length > 1 ? 's' : '' } ${ p.islands.join( ', ' ) } divided by colour: each triangle subdivided into ${ 4 ** p.subdivide } (${ p.source_triangles } to ${ after } triangles); the surface and the texture mapping are unchanged.` );

	}
	mods.push( method === 'material' ? 'Each part keeps its original material and texture, unchanged.' : 'The original material and texture are shared by all the parts and are unchanged.' );
	for ( const m of [].concat( plan.modifications || [] ) ) if ( typeof m === 'string' && m.trim() ) mods.push( m.trim() );
	return {
		from, seg_version: SEG_VERSION, method,
		...validateSource( source ),
		modifications: mods,
		plan: JSON.parse( JSON.stringify( plan ) ),
		describe,
		parts: Object.fromEntries( made.map( p => [ p.name, p.triangles.length ] ) ),
		signals: {
			source_units: sourceUnits, part_count: made.length,
			largest_part_area_share: +( Math.max( ...areas ) / total ).toFixed( 3 ),
			compound_names: made.map( p => p.name ).filter( n => /(^|_)and(_|$)/i.test( n ) || n.includes( '&' ) )
		}
	};

}

/** Does a mesh match the description a record was made from? Returns the differences, empty when it does (tiny float noise is allowed). */
export function compareDescribe( recorded, fresh ) {

	const out = [], close = ( a, b, tol ) => Math.abs( a - b ) <= tol * Math.max( 1, Math.abs( a ), Math.abs( b ) );
	if ( ! recorded ) return [ 'the record has no description to compare with' ];
	const A = recorded.islands || recorded.materials || [], B = fresh.islands || fresh.materials || [];
	if ( ( recorded.islands ? 'islands' : 'materials' ) !== ( fresh.islands ? 'islands' : 'materials' ) ) return [ 'the record was made from ' + ( recorded.islands ? 'islands' : 'materials' ) + ' and this mesh has ' + ( fresh.islands ? 'islands' : 'materials' ) ];
	if ( A.length !== B.length ) out.push( `the record has ${ A.length } ${ recorded.islands ? 'islands' : 'materials' } and this mesh has ${ B.length }` );
	for ( let i = 0; i < Math.min( A.length, B.length ); i ++ ) {

		const a = A[ i ], b = B[ i ], w = ( recorded.islands ? 'island ' : 'material ' ) + i;
		if ( a.triangles !== b.triangles ) out.push( `${ w } has ${ b.triangles } triangles, the record says ${ a.triangles }` );
		if ( a.size && ! a.size.every( ( x, c ) => close( x, b.size[ c ], 1e-4 ) ) ) out.push( `${ w } is ${ b.size.map( x => x.toFixed( 3 ) ) } in size, the record says ${ a.size.map( x => x.toFixed( 3 ) ) }` );
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
		add( part.name, part.classes, tris, { source_triangles: tris.length }, { material: part.material } );

	}
	if ( used.size !== by.size ) throw new Error( 'SEG.byMaterial: every material must go to a part, and ' + ( by.size - used.size ) + ' of ' + by.size + ' have none' );
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
 *   SEG.describe(node | selector, k = 3)      text: every island (or, on a mesh with several materials, every material)
 *   SEG.data(node | selector, k = 3)          the same as objects
 *   SEG.split(node | selector, plan)          cut into named, classed meshes in one group (one undo step). plan.source is required
 *   SEG.byMaterial(node | selector, plan)     the same for a mesh with several materials, cut by material: exact evidence from the model's author
 *   SEG.replay(node | selector, record)       cut again from a recorded plan; refuses if the mesh is not the one the record was made from
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
			if ( node.isSkinnedMesh ) throw new Error( 'SEG: skinned meshes are not supported (cutting would break the skeleton)' );
			if ( node.geometry.morphAttributes && Object.keys( node.geometry.morphAttributes ).length ) throw new Error( 'SEG: meshes with morph targets are not supported' );
			if ( ! node.geometry.attributes.position ) throw new Error( 'SEG: the mesh has no positions' );
			if ( kind === 'mesh' && isMulti( node ) ) throw new Error( 'SEG: "' + node.name + '" has ' + new Set( groupsOf( node ).map( g => g.materialIndex ) ).size + ' materials. Cut it by material first with SEG.byMaterial: the author of the model assigned them, so they are better evidence than islands' );

		}
		return node;

	};
	const dataOf = node => dataOfGeometry( node.geometry );
	const readerOf = node => {

		const m = isMulti( node ) ? null : singleMaterial( node );
		return ( m && m.map && m.map.image && node.geometry.attributes.uv ) ? textureReader( m.map ) : null;

	};
	const hex = c => '#' + ( c && c.getHexString ? c.getHexString() : 'ffffff' );

	const materialReport = node => {

		const by = materialParts( dataOf( node ), groupsOf( node ) ), mats = materialsOf( node );
		return { materials: [ ...by.keys() ].sort( ( a, b ) => a - b ).map( i => ( { material: i, name: mats[ i ] ? mats[ i ].name || '' : '', colour: hex( mats[ i ] && mats[ i ].color ), textured: !! ( mats[ i ] && mats[ i ].map ), triangles: by.get( i ).length } ) ) };

	};
	const reportOf = ( node, k ) => ( isMulti( node ) ? materialReport( node ) : { k, islands: describeIslands( dataOf( node ), readerOf( node ), k ) } );
	const formatMaterials = r => r.materials.map( m => `material ${ m.material }: "${ m.name }", ${ m.triangles } triangles, colour ${ m.colour }, ${ m.textured ? 'textured' : 'flat' }` ).join( '\n' )
		+ '\n(this mesh has several materials: cut it with SEG.byMaterial, which is exact; then SEG.describe each part if it needs cutting further)';

	SEG.data = ( what, k = 3 ) => { const r = reportOf( resolve( what, 'any' ), k ); return r.islands || r.materials; };
	SEG.describe = ( what, k = 3 ) => { const r = reportOf( resolve( what, 'any' ), k ); return r.islands ? formatIslands( r.islands ) : formatMaterials( r ); };

	// everything about a cut except doing it: the parts, the record, the names it will use
	const prepare = ( what, plan, method ) => {

		const node = resolve( what, method === 'material' ? 'any' : 'mesh' ), data = dataOf( node );
		const who = method === 'material' ? 'SEG.byMaterial' : 'SEG.split';
		if ( ! plan || typeof plan !== 'object' ) throw new Error( who + ': the plan is missing' );
		validateSource( plan.source, who );
		if ( ! plan.group || isDefaultName( plan.group ) ) throw new Error( who + ': the plan needs a group name an author chose' );
		let made, describe, units;
		if ( method === 'material' ) {

			if ( ! isMulti( node ) ) throw new Error( 'SEG.byMaterial: "' + node.name + '" has one material; use SEG.split' );
			made = planMaterialParts( data, groupsOf( node ), plan ); describe = materialReport( node ); units = describe.materials.length;

		} else {

			const k = 3;
			describe = { k, islands: describeIslands( data, readerOf( node ), k ) }; units = describe.islands.length;
			made = planParts( data, plan, readerOf( node ) );

		}
		const sourceTriangles = triangleIndex( data ).length / 3;
		const record = buildRecord( { method, from: node.name || 'mesh', plan, describe, made, data, sourceTriangles, sourceUnits: units, source: plan.source } );
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
		return { node, gone, place, data, made, record, plan };

	};

	const commit = ( { node, gone, place, data, made, record, plan } ) => {

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
			const m = new THREE.Mesh( geo, part.material !== undefined ? node.material[ part.material ] : singleMaterial( node ) );   // the original material, so the object looks exactly as it did
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
		return made.map( p => p.name + ': ' + p.triangles.length + ' triangles' ).join( ' | ' );

	};

	SEG.split = ( what, plan ) => commit( prepare( what, plan, 'islands' ) );
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

	/** Cut again from a record: the same plan on the same model. Refuses, before changing anything, if the mesh differs from the one the record describes. */
	SEG.replay = ( what, record, { check = true } = {} ) => {

		const rec = record && record.userData ? record.userData.segmentation : typeof record === 'string' ? ( query( record ).nodes[ 0 ] || {} ).userData?.segmentation : record;
		if ( ! rec || ! rec.plan ) throw new Error( 'SEG.replay: there is no recorded plan (records made before SEG ' + SEG_VERSION + ' kept only the part sizes)' );
		const method = rec.method || 'islands';
		const node = resolve( what, 'any' );
		if ( check ) {

			const diffs = compareDescribe( rec.describe, method === 'material' ? ( isMulti( node ) ? materialReport( node ) : { islands: [] } ) : ( isMulti( node ) ? materialReport( node ) : reportOf( node, rec.describe && rec.describe.k || 3 ) ) );
			if ( diffs.length ) throw new Error( 'SEG.replay: this mesh is not the one the record was made from: ' + diffs.slice( 0, 4 ).join( '; ' ) + ( diffs.length > 4 ? ' (and ' + ( diffs.length - 4 ) + ' more)' : '' ) );

		}
		const done = prepare( what, rec.plan, method );
		const want = JSON.stringify( rec.parts ), got = JSON.stringify( done.record.parts );
		if ( want !== got ) throw new Error( 'SEG.replay: the plan gives different parts from the record (' + got + ' against ' + want + '); nothing was changed' );
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
