// Run: ROOM_GLB=/path/to/cyberpunk_micro-apartments.glb node docs/editor/js/intelligence/__tests__/meshSegmentRoom.test.mjs
// The scene gates (H1 to H5) on the real room the heuristic was worked out on: Sketchfab "cyberpunk micro-apartments" by Mikita_Hubanau, CC Attribution-NonCommercial.
// The model is not in this repository (its licence does not allow it to be redistributed here), so this test reads it from ROOM_GLB and is skipped without it.
// It needs the file alone: no browser, no model call, no texture.
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const file = process.env.ROOM_GLB;
if ( ! file || ! fs.existsSync( file ) ) { console.log( 'skipped: set ROOM_GLB to cyberpunk_micro-apartments.glb (https://sketchfab.com/3d-models/cyberpunk-micro-apartments-fd8011e2af0e43288f5445600197ea77) to run the room gates' ); process.exit( 0 ); }

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { islandsOf, componentsOf, describeComponents, attachComponents, anchorParts, planParts, grainOf } = await import( pathToFileURL( path.join( here, '..', 'meshSegment.js' ) ).href );

// a glb read by hand: the first mesh (Object_4, the textured room), and the matrix that takes it to the world (Sketchfab_model × GLTF_SceneRootNode × Cyber_Room_Vf10_0)
function loadRoom() {

	const buf = fs.readFileSync( file ), jl = buf.readUInt32LE( 12 ), json = JSON.parse( buf.slice( 20, 20 + jl ).toString() );
	const start = 20 + jl + 8, bin = buf.buffer.slice( buf.byteOffset + start, buf.byteOffset + buf.length );
	const acc = i => {

		const a = json.accessors[ i ], v = json.bufferViews[ a.bufferView ], n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[ a.type ], off = ( v.byteOffset || 0 ) + ( a.byteOffset || 0 );
		return { array: new ( a.componentType === 5125 ? Uint32Array : Float32Array )( bin.slice( off, off + a.count * n * 4 ) ), itemSize: n };

	};
	const p = json.meshes[ 0 ].primitives[ 0 ];
	const data = { index: Array.from( acc( p.indices ).array ), attrs: { position: acc( p.attributes.POSITION ), normal: acc( p.attributes.NORMAL ), uv: acc( p.attributes.TEXCOORD_0 ) } };
	const I = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
	const mul = ( a, b ) => { const o = new Array( 16 ).fill( 0 ); for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < 4; r ++ ) for ( let k = 0; k < 4; k ++ ) o[ c * 4 + r ] += a[ k * 4 + r ] * b[ c * 4 + k ]; return o; };
	return { data, matrix: [ 0, 2, 3 ].reduce( ( m, n ) => mul( m, json.nodes[ n ].matrix || I ), I ) };

}
const { data, matrix } = loadRoom();

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// the anchors named in the room run, by component number: (name, classes, components)
const ROOM_ANCHORS = [
	[ 'Cyber_Cat', [ 'animal', 'cat' ], [ 1 ] ], [ 'Bed_Pillow', [ 'bedding', 'pillow' ], [ 2 ] ], [ 'Doorway_Frame', [ 'structure', 'doorway' ], [ 7 ] ],
	[ 'Ceiling_Panel', [ 'structure', 'ceiling' ], [ 21 ] ], [ 'Floor_Deck', [ 'structure', 'floor' ], [ 29 ] ], [ 'Wall_Left_Pillar', [ 'structure', 'wall' ], [ 14 ] ],
	[ 'Wall_Right_Unit', [ 'structure', 'wall' ], [ 19 ] ], [ 'Wall_Front_Right_Column', [ 'structure', 'wall' ], [ 28 ] ], [ 'Bed_Frame', [ 'furniture', 'bed' ], [ 16 ] ],
	[ 'Crate_Stack', [ 'furniture', 'crate' ], [ 3, 5, 8, 9, 10, 12, 15, 17 ] ], [ 'Plant_Cluster', [ 'plant', 'decor' ], [ 23 ] ], [ 'Kitchen_Counter', [ 'furniture', 'kitchen' ], [ 22 ] ],
	[ 'Dark_Wall_Panel', [ 'structure', 'panel' ], [ 0 ] ], [ 'Blue_Mug', [ 'prop', 'cup' ], [ 4 ] ]
].map( ( [ name, classes, component ] ) => ( { name, classes, component, basis: [ 'position', 'size' ] } ) );
// what that cut gave when it was made by hand, before this code existed: triangles and islands per part, in this order
const BY_HAND = { triangles: [ 1892, 663, 270, 142, 95, 251, 496, 119, 410, 2367, 1174, 1340, 2590, 342 ], islands: [ 13, 11, 17, 8, 15, 16, 34, 11, 21, 129, 202, 30, 22, 9 ] };

test( 'H1: 538 islands are 282 components, from the file alone', () => {

	const { islands, components } = componentsOf( data );
	assert.strictEqual( islandsOf( data ).length, 538 );
	assert.strictEqual( islands.length, 538 );
	assert.strictEqual( components.length, 282 );
	assert.strictEqual( data.index.length / 3, 12151 );
	assert.strictEqual( components.reduce( ( s, c ) => s + c.triangles, 0 ), 12151 );
	assert.deepStrictEqual( components.slice( 0, 4 ).map( c => c.triangles ), [ 2270, 1892, 574, 466 ] );       // the numbering the anchors above rely on
	assert.strictEqual( grainOf( 538, 282 ), 'components' );

} );

test( 'H2: attach reproduces the room\'s assignment, tie-break cases included', () => {

	const scene = componentsOf( data ), r = attachComponents( data, scene, ROOM_ANCHORS, { matrix } ), parts = anchorParts( scene, ROOM_ANCHORS, r );
	const tri = p => p.island.reduce( ( s, i ) => s + scene.islands[ i ].length, 0 );
	assert.deepStrictEqual( parts.map( tri ), BY_HAND.triangles );
	assert.deepStrictEqual( parts.map( p => p.island.length ), BY_HAND.islands );
	assert.strictEqual( r.unattached.length, 0 );
	assert.strictEqual( r.parameters.tie, 0.05 );
	assert.strictEqual( r.parameters.max_distance_default, true );
	assert.ok( Math.abs( r.parameters.scene_diagonal - 14.48 ) < 0.01, 'the room is about 14.5 across' );
	// the tie-break fired on the room: some components went to a smaller anchor that was not the nearest, within 0.05 of it
	assert.ok( r.tieBroken.length > 0, 'the tie-break decided at least one component' );
	assert.ok( r.tieBroken.every( t => t.distance - t.nearest_distance <= 0.05 + 1e-9 && t.anchor !== t.nearest ) );

} );

test( 'H3: the numbers are world-frame on the rotated import: the ceiling is high and the floor low, which the mesh frame says the other way round', () => {

	const w = describeComponents( data, null, { matrix } ), m = describeComponents( data, null, {} );
	assert.ok( w[ 21 ].at[ 1 ] > 0.9 && w[ 29 ].at[ 1 ] < 0.15, 'world y is up: ceiling ' + w[ 21 ].at[ 1 ] + ', floor ' + w[ 29 ].at[ 1 ] );
	assert.ok( m[ 21 ].at[ 2 ] < 0.1 && m[ 29 ].at[ 2 ] > 0.85, 'in the mesh frame "up" is on z and runs the other way: ceiling ' + m[ 21 ].at[ 2 ] + ', floor ' + m[ 29 ].at[ 2 ] );
	assert.ok( w[ 29 ].size[ 1 ] < 1.1 && m[ 29 ].size[ 1 ] > 6, 'the floor deck is about a metre thick: that is world y, and mesh y is its depth' );
	assert.ok( w[ 1 ].size[ 1 ] > 0.6 && w[ 1 ].size[ 1 ] < 0.8 && w[ 1 ].size[ 2 ] > 1.1, 'the cat is 0.7 high and 1.16 long' );

} );

test( 'H4: the first cut\'s failure fires an assertion: the room-wide trim went to the "front right column"', () => {

	const meta = {}; planParts( data, { anchors: ROOM_ANCHORS }, null, { matrix, meta } );
	const fired = meta.assertions.fired, by = Object.fromEntries( fired.map( f => [ f.assertion, f ] ) );
	assert.ok( by.oversize, 'oversize: ' + JSON.stringify( fired.map( f => f.assertion ) ) );
	assert.strictEqual( by.oversize.part, 'Wall_Front_Right_Column' );
	assert.ok( by.oversize.span[ 0 ] > 0.65 && by.oversize.span[ 1 ] > 0.9 && by.oversize.span[ 2 ] > 0.95, 'it spans the room: ' + by.oversize.span );
	assert.ok( by[ 'orphan sink' ] && by[ 'orphan sink' ].part === 'Plant_Cluster' && by[ 'orphan sink' ].attached === 169 && by[ 'orphan sink' ].of === 261, 'the plant cluster took 169 of the 261 attached components' );
	// the correction, with the trim named and declared: the oversize part is gone; the sink is not, and is still reported
	const fixed = ROOM_ANCHORS.map( a => ( a.name === 'Doorway_Frame' ? { ...a, name: 'Doorway_Frame_And_Trim', classes: [ 'structure', 'doorway', 'trim' ], component: [ 7, 47, 68 ] } : a ) );
	const meta2 = {}; planParts( data, { anchors: fixed }, null, { matrix, meta: meta2 } );
	assert.deepStrictEqual( meta2.assertions.fired.map( f => f.assertion ), [ 'orphan sink' ] );

} );

test( 'H5: with a limit, the components that are far from every anchor are left to be named, not joined to a wall', () => {

	const scene = componentsOf( data ), r = attachComponents( data, scene, ROOM_ANCHORS, { matrix, maxDistance: 0.3 } );
	assert.strictEqual( r.parameters.max_distance, 0.3 );
	assert.strictEqual( r.parameters.max_distance_default, false );
	assert.strictEqual( r.unattached.length, 5 );
	assert.ok( r.unattached.every( u => u.distance > 0.3 ) );
	assert.ok( r.unattached.every( u => r.of[ u.component ] === - 1 ) );
	assert.throws( () => planParts( data, { anchors: ROOM_ANCHORS, attach: { maxDistance: 0.3 } }, null, { matrix } ), /5 components are further than maxDistance \(0\.3\) from every anchor/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
