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
	const made = [], taken = new Set();
	const addPart = ( name, classes, triangles ) => {

		if ( ! name || isDefaultName( name ) ) throw new Error( 'SEG.split: every part needs a name an author chose, and "' + name + '" is a default' );
		if ( taken.has( name.toLowerCase() ) ) throw new Error( 'SEG.split: the name "' + name + '" is used by two parts' );
		if ( ! Array.isArray( classes ) || classes.length === 0 ) throw new Error( 'SEG.split: part "' + name + '" needs at least one class' );
		taken.add( name.toLowerCase() );
		made.push( { name, classes, triangles } );

	};
	for ( const part of plan.parts ) {

		const ids = [].concat( part.island );
		for ( const i of ids ) {

			if ( ! islands[ i ] ) throw new Error( 'SEG.split: there is no island ' + i + ' (the mesh has ' + islands.length + ')' );
			if ( used.has( i ) ) throw new Error( 'SEG.split: island ' + i + ' is used twice' );
			used.add( i );

		}
		const tris = ids.flatMap( i => islands[ i ] ).map( t => [ 0, 1, 2 ].map( k => vertexOf( data, names, idx[ t * 3 + k ] ) ) );
		if ( ! part.palette ) { addPart( part.name, part.classes, tris ); continue; }
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
		bins.forEach( ( bin, name ) => { if ( bin.triangles.length ) addPart( name, bin.classes, bin.triangles ); } );

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

// ── the Shell surface ─────────────────────────────────────────────────────────────────────────────

// the materials a preview replaced, per editor: the Shell builds its globals again for every command, so this cannot live inside makeSegment
const SAVED = new WeakMap();

const PREVIEW = [ '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#008080', '#9a6324' ];

/** The reader of a texture's base colour: (u, v) → [r, g, b], honouring the texture's own transform and flip. Needs a DOM. */
export function textureReader( map ) {

	const img = map.image, w = img.width, h = img.height;
	const cv = document.createElement( 'canvas' ); cv.width = w; cv.height = h;
	const cx = cv.getContext( '2d', { willReadFrequently: true } ); cx.drawImage( img, 0, 0 );
	const px = cx.getImageData( 0, 0, w, h ).data;
	map.updateMatrix();
	const e = map.matrix.elements;
	return ( u0, v0 ) => {

		let u = e[ 0 ] * u0 + e[ 3 ] * v0 + e[ 6 ], v = e[ 1 ] * u0 + e[ 4 ] * v0 + e[ 7 ];
		u -= Math.floor( u ); v -= Math.floor( v );
		const x = Math.min( w - 1, Math.floor( u * w ) ), y = Math.min( h - 1, Math.floor( ( map.flipY ? 1 - v : v ) * h ) ), p = ( y * w + x ) * 4;
		return [ px[ p ], px[ p + 1 ], px[ p + 2 ] ];

	};

}

/**
 * makeSegment( editor, { THREE, commands, query } ) → SEG
 *   SEG.describe(node | selector, k = 3)   text: every island, with size, texture position and main colours
 *   SEG.data(node | selector, k = 3)       the same as objects
 *   SEG.split(node | selector, plan)       cut into named, classed meshes in one group (one undo step)
 *   SEG.preview(group | selector)          a flat colour per part, to check the cut;  SEG.restore() puts the materials back
 */
export function makeSegment( editor, { THREE, commands, query } ) {

	const { AddObjectCommand, RemoveObjectCommand, SetMaterialCommand, MultiCmdsCommand } = commands;
	const SEG = {};
	const resolve = ( what, kind ) => {

		const node = typeof what === 'string' ? query( what ).nodes[ 0 ] : what;
		if ( ! node ) throw new Error( 'SEG: nothing matches ' + JSON.stringify( what ) );
		if ( kind === 'mesh' ) {

			if ( ! node.isMesh ) throw new Error( 'SEG: "' + node.name + '" is not a mesh (select the mesh itself, not its group)' );
			if ( node.isSkinnedMesh ) throw new Error( 'SEG: skinned meshes are not supported (cutting would break the skeleton)' );
			if ( Array.isArray( node.material ) || node.geometry.groups.length ) throw new Error( 'SEG: the mesh has several materials; split it by material first' );
			if ( node.geometry.morphAttributes && Object.keys( node.geometry.morphAttributes ).length ) throw new Error( 'SEG: meshes with morph targets are not supported' );
			if ( ! node.geometry.attributes.position ) throw new Error( 'SEG: the mesh has no positions' );

		}
		return node;

	};
	const dataOf = node => {

		const g = node.geometry, attrs = {};
		for ( const [ name, a ] of Object.entries( g.attributes ) ) {

			if ( a.isInterleavedBufferAttribute ) { const arr = new Float32Array( a.count * a.itemSize ); for ( let i = 0; i < a.count; i ++ ) for ( let c = 0; c < a.itemSize; c ++ ) arr[ i * a.itemSize + c ] = a.getComponent( i, c ); attrs[ name ] = { array: arr, itemSize: a.itemSize, normalized: a.normalized }; }
			else attrs[ name ] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized };

		}
		return { index: g.index ? g.index.array : null, attrs };

	};
	const readerOf = node => ( node.material && node.material.map && node.material.map.image && node.geometry.attributes.uv ) ? textureReader( node.material.map ) : null;

	SEG.data = ( what, k = 3 ) => { const node = resolve( what, 'mesh' ); return describeIslands( dataOf( node ), readerOf( node ), k ); };
	SEG.describe = ( what, k = 3 ) => formatIslands( SEG.data( what, k ) );

	SEG.split = ( what, plan ) => {

		const node = resolve( what, 'mesh' ), data = dataOf( node );
		const made = planParts( data, plan, readerOf( node ) );
		if ( ! plan.group || isDefaultName( plan.group ) ) throw new Error( 'SEG.split: the plan needs a group name an author chose' );
		const existing = new Set();
		editor.scene.traverse( o => { if ( o !== node && o.name ) existing.add( o.name.toLowerCase() ); } );
		for ( const n of [ plan.group, ...made.map( p => p.name ) ] ) if ( existing.has( n.toLowerCase() ) ) throw new Error( 'SEG.split: the name "' + n + '" is already used in the scene' );

		const group = new THREE.Group();
		group.name = plan.group;
		group.userData.customClasses = plan.classes && plan.classes.length ? plan.classes : [ 'segmented' ];
		node.updateWorldMatrix( true, false );
		node.matrixWorld.decompose( group.position, group.quaternion, group.scale );   // the new group sits where the mesh was in the world
		for ( const part of made ) {

			const { attrs, index } = carveAttributes( data, part.triangles ), geo = new THREE.BufferGeometry();
			for ( const [ name, a ] of Object.entries( attrs ) ) geo.setAttribute( name, new THREE.BufferAttribute( a.array, a.itemSize, a.normalized ) );
			geo.setIndex( index ); geo.computeBoundingBox(); geo.computeBoundingSphere();
			const m = new THREE.Mesh( geo, node.material );    // the same material, so the object looks exactly as it did
			m.name = part.name; m.castShadow = node.castShadow; m.receiveShadow = node.receiveShadow; m.visible = node.visible;
			m.userData.customClasses = part.classes;
			group.add( m );

		}
		group.userData.segmentation = { from: node.name || 'mesh', parts: Object.fromEntries( made.map( p => [ p.name, p.triangles.length ] ) ) };
		// the mesh goes, and so do the empty wrapper nodes an importer leaves around it (a file name, a root), so nothing nameless is left behind
		let gone = node;
		while ( gone.parent && gone.parent !== editor.scene && gone.parent.children.length === 1 ) gone = gone.parent;
		editor.execute( new MultiCmdsCommand( editor, [ new RemoveObjectCommand( editor, gone ), new AddObjectCommand( editor, group ) ] ) );
		return made.map( p => p.name + ': ' + p.triangles.length + ' triangles' ).join( ' | ' );

	};

	SEG.preview = what => {

		if ( ! SAVED.has( editor ) ) SAVED.set( editor, new Map() );
		const saved = SAVED.get( editor );

		const group = resolve( what );
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
