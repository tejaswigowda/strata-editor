// Run: node docs/editor/js/intelligence/__tests__/meshSegment.test.mjs
// SEG's pure core: islands, colour description, the plan (every island to exactly one part), subdivision by colour, and the carved arrays.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { islandsOf, kmeans, describeIslands, formatIslands, planParts, carveAttributes, triangleIndex } = await import( pathToFileURL( path.join( here, '..', 'meshSegment.js' ) ).href );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// Two squares of two triangles each, apart in space and in the texture; the second is a flat patch the texture paints as a left half red, right half blue.
// Vertices are duplicated per triangle with a different normal on one of them, to prove that a hard edge is not a seam.
function mesh( { indexed = true } = {} ) {

	const P = [], U = [], N = [], I = [];
	const quad = ( x0, u0 ) => {

		const c = [ [ x0, 0, 0, u0, 0 ], [ x0 + 1, 0, 0, u0 + 0.4, 0 ], [ x0 + 1, 1, 0, u0 + 0.4, 0.4 ], [ x0, 1, 0, u0, 0.4 ] ];
		for ( const [ a, b, d ] of [ [ 0, 1, 2 ], [ 0, 2, 3 ] ] ) for ( const k of [ a, b, d ] ) { P.push( c[ k ][ 0 ], c[ k ][ 1 ], c[ k ][ 2 ] ); U.push( c[ k ][ 3 ], c[ k ][ 4 ] ); N.push( k === 2 && a === 0 && b === 2 ? 0.1 : 0, 0, 1 ); }

	};
	quad( 0, 0.05 ); quad( 5, 0.55 );
	const n = P.length / 3;
	const attrs = { position: { array: new Float32Array( P ), itemSize: 3 }, normal: { array: new Float32Array( N ), itemSize: 3 }, uv: { array: new Float32Array( U ), itemSize: 2 } };
	return { index: indexed ? Array.from( { length: n }, ( _, i ) => i ) : null, attrs };

}
const read = ( u ) => ( u < 0.75 ? [ 220, 30, 30 ] : [ 30, 30, 220 ] );        // the second island's u runs 0.55 to 0.95: red below 0.75, blue above

test( 'a non-indexed mesh gets an index of its own', () => { assert.deepStrictEqual( triangleIndex( mesh( { indexed: false } ) ).length, 12 ); } );

test( 'islands are the pieces that share vertices; a hard edge (a different normal) does not split one', () => {

	const isl = islandsOf( mesh() );
	assert.strictEqual( isl.length, 2 );
	assert.deepStrictEqual( isl.map( a => a.length ), [ 2, 2 ] );
	assert.deepStrictEqual( isl[ 0 ], [ 0, 1 ] );               // ties go to the lowest triangle number, so the order is stable
	assert.deepStrictEqual( islandsOf( mesh( { indexed: false } ) ).map( a => a.length ), [ 2, 2 ] );

} );

test( 'islands are largest first', () => {

	const m = mesh(); m.index = m.index.slice( 0, 9 );        // three triangles: the first quad (2) and one of the second (1)
	assert.deepStrictEqual( islandsOf( m ).map( a => a.length ), [ 2, 1 ] );

} );

test( 'k-means is deterministic and orders the colours by share', () => {

	const cols = [ ...Array( 6 ).fill( [ 255, 0, 0 ] ), ...Array( 2 ).fill( [ 0, 0, 255 ] ) ];
	const a = kmeans( cols, 2 ), b = kmeans( cols, 2 );
	assert.deepStrictEqual( a, b );
	assert.deepStrictEqual( a.map( c => c.rgb ), [ [ 255, 0, 0 ], [ 0, 0, 255 ] ] );
	assert.strictEqual( a[ 0 ].share, 0.75 );
	assert.deepStrictEqual( kmeans( [], 3 ), [] );

} );

test( 'the description reports size, texture position and colours, and survives a mesh with no texture', () => {

	const d = describeIslands( mesh(), read, 2 );
	assert.strictEqual( d.length, 2 );
	assert.deepStrictEqual( d[ 0 ].size.map( x => +x.toFixed( 2 ) ), [ 1, 1, 0 ] );
	assert.ok( d[ 0 ].colours[ 0 ].rgb[ 0 ] > 200 );              // the first island is red
	assert.deepStrictEqual( d[ 0 ].at.map( x => +x.toFixed( 3 ) ), [ 0.083, 0.5, 0.5 ] );       // the first square's centre, across the whole mesh (x runs 0 to 6)
	assert.ok( formatIslands( d ).includes( 'island 1: 2 triangles' ) );
	const bare = describeIslands( mesh(), null );
	assert.strictEqual( bare[ 0 ].colours, null );
	assert.ok( formatIslands( bare ).includes( 'no texture' ) );

} );

const whole = { parts: [ { island: 0, name: 'Left_Square', classes: [ 'square' ] }, { island: 1, name: 'Right_Square', classes: [ 'square' ] } ] };

test( 'a plan that gives every island a part keeps every triangle', () => {

	const made = planParts( mesh(), whole, read );
	assert.deepStrictEqual( made.map( p => [ p.name, p.triangles.length ] ), [ [ 'Left_Square', 2 ], [ 'Right_Square', 2 ] ] );

} );

test( 'a list of islands makes one part', () => {

	const made = planParts( mesh(), { parts: [ { island: [ 0, 1 ], name: 'Both', classes: [ 'all' ] } ] }, read );
	assert.deepStrictEqual( made.map( p => p.triangles.length ), [ 4 ] );

} );

test( 'a plan is refused when an island has no part, is used twice, does not exist, or a name is bad', () => {

	assert.throws( () => planParts( mesh(), { parts: [ whole.parts[ 0 ] ] }, read ), /every island must go to a part, and 1 of 2 have none/ );
	assert.throws( () => planParts( mesh(), { parts: [ whole.parts[ 0 ], { ...whole.parts[ 1 ], island: 0 } ] }, read ), /island 0 is used twice/ );
	assert.throws( () => planParts( mesh(), { parts: [ { island: 7, name: 'X_Part', classes: [ 'x' ] } ] }, read ), /there is no island 7/ );
	assert.throws( () => planParts( mesh(), { parts: [ { ...whole.parts[ 0 ], name: 'Mesh' }, whole.parts[ 1 ] ] }, read ), /default/ );
	assert.throws( () => planParts( mesh(), { parts: [ whole.parts[ 0 ], { ...whole.parts[ 1 ], name: 'left_square' } ] }, read ), /used by two parts/ );
	assert.throws( () => planParts( mesh(), { parts: [ whole.parts[ 0 ], { ...whole.parts[ 1 ], classes: [] } ] }, read ), /at least one class/ );
	assert.throws( () => planParts( mesh(), { parts: [] }, read ), /parts list/ );

} );

const area = ( tris ) => tris.reduce( ( s, t ) => { const [ a, b, c ] = t.map( v => v.slice( 0, 3 ) ), ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ], vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ]; return s + Math.hypot( uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ) / 2; }, 0 );

const byColour = { parts: [
	{ island: 0, name: 'Red_Square', classes: [ 'red' ] },
	{ island: 1, subdivide: 3, palette: [ { name: 'Red_Half', classes: [ 'red' ], color: [ 220, 30, 30 ] }, { name: 'Blue_Half', classes: [ 'blue' ], color: [ 30, 30, 220 ] } ] }
] };

test( 'dividing an island by colour: the triangles multiply by 4^n, the surface is unchanged, and each colour gets its own part', () => {

	const made = planParts( mesh(), byColour, read ), by = Object.fromEntries( made.map( p => [ p.name, p ] ) );
	assert.strictEqual( made.length, 3 );
	assert.strictEqual( by.Red_Half.triangles.length + by.Blue_Half.triangles.length, 2 * 64 );
	assert.ok( Math.abs( area( by.Red_Half.triangles ) + area( by.Blue_Half.triangles ) - 1 ) < 1e-9 );       // the square has area 1
	assert.ok( Math.abs( area( by.Red_Half.triangles ) - 0.5 ) < 0.07 && Math.abs( area( by.Blue_Half.triangles ) - 0.5 ) < 0.07 );   // the cut is where the paint changes

} );

test( 'two palette colours with one name make one part', () => {

	const plan = { parts: [ whole.parts[ 0 ], { island: 1, subdivide: 2, palette: [ { name: 'Painted', classes: [ 'p' ], color: [ 220, 30, 30 ] }, { name: 'Painted', classes: [ 'p' ], color: [ 30, 30, 220 ] } ] } ] };
	const made = planParts( mesh(), plan, read );
	assert.deepStrictEqual( made.map( p => p.name ), [ 'Left_Square', 'Painted' ] );
	assert.strictEqual( made[ 1 ].triangles.length, 2 * 16 );

} );

test( 'a colour cut needs a texture', () => {

	assert.throws( () => planParts( mesh(), byColour, null ), /needs a mesh with uv and a base-colour texture/ );

} );

test( 'carving a part gives every attribute, one vertex per corner, and renormalised normals', () => {

	const data = mesh(), made = planParts( data, byColour, read ), part = made.find( p => p.name === 'Blue_Half' );
	const out = carveAttributes( data, part.triangles );
	assert.deepStrictEqual( Object.keys( out.attrs ), [ 'position', 'normal', 'uv' ] );
	assert.strictEqual( out.attrs.position.array.length, part.triangles.length * 9 );
	assert.strictEqual( out.attrs.uv.array.length, part.triangles.length * 6 );
	assert.strictEqual( out.index.length, part.triangles.length * 3 );
	for ( let i = 0; i < part.triangles.length * 3; i ++ ) { const a = out.attrs.normal.array; assert.ok( Math.abs( Math.hypot( a[ i * 3 ], a[ i * 3 + 1 ], a[ i * 3 + 2 ] ) - 1 ) < 1e-6 ); }
	assert.ok( out.attrs.uv.array.every( ( x, i ) => i % 2 || x >= 0.55 - 1e-6 ) );            // the blue half keeps its own uvs

} );

test( 'integer attributes are rounded, not truncated, after subdividing', () => {

	const data = { index: [ 0, 1, 2 ], attrs: {
		position: { array: new Float32Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ] ), itemSize: 3 },
		uv: { array: new Float32Array( [ 0, 0, 1, 0, 0, 1 ] ), itemSize: 2 },
		color: { array: new Uint8Array( [ 0, 0, 0, 255, 255, 255, 255, 255, 255 ] ), itemSize: 3, normalized: true }
	} };
	const made = planParts( data, { parts: [ { island: 0, subdivide: 1, palette: [ { name: 'Only_Part', classes: [ 'o' ], color: [ 0, 0, 0 ] } ] } ] }, () => [ 0, 0, 0 ] );
	const out = carveAttributes( data, made[ 0 ].triangles );
	assert.strictEqual( made[ 0 ].triangles.length, 4 );
	assert.ok( out.attrs.color.array instanceof Uint8Array && out.attrs.color.normalized );
	assert.ok( out.attrs.color.array.includes( 128 ) && ! out.attrs.color.array.includes( 127 ) );    // the midpoint of 0 and 255 is 127.5

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
