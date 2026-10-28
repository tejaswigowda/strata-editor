// Run: node docs/editor/js/intelligence/__tests__/meshSegment.test.mjs
// SEG's pure core: islands, colour description, the plan (every island to exactly one part), subdivision by colour, and the carved arrays.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { skinnedPlanProblem, islandsOf, kmeans, describeIslands, formatIslands, planParts, carveAttributes, triangleIndex, validateSource, buildRecord, compareDescribe, materialParts, planMaterialParts, SEG_VERSION,
	componentsOf, describeComponents, formatComponents, grainOf, attachComponents, anchorParts, cutAssertions, SCENE, ASSERTIONS } = await import( pathToFileURL( path.join( here, '..', 'meshSegment.js' ) ).href );
const { footprintColour } = await import( pathToFileURL( path.join( here, '..', 'textureColour.js' ) ).href );

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

// ── the record, the provenance, the replay, the colour of a part, the cut by material ──────────────────

const COMMIT_SHA = 'd7a3cc8e51d7c573771ae77a57f16b0662a905c6', FILE_SHA = '65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5';
const SOURCE = { url: `https://raw.githubusercontent.com/example/models/${ COMMIT_SHA }/squares/squares.glb`, sha256: FILE_SHA, bytes: 120484, licence: 'CC0 1.0', attribution: 'Test Studio' };

test( 'skinned mesh: bone indices and weights survive the cut unchanged, and subdividing a skinned mesh is refused', () => {

	const data = mesh(), n = data.attrs.position.array.length / 3;
	data.attrs.skinIndex = { array: new Uint16Array( Array.from( { length: n * 4 }, ( _, i ) => ( Math.floor( i / 4 ) % 7 ) + ( i % 4 ) ) ), itemSize: 4 };
	data.attrs.skinWeight = { array: new Float32Array( Array.from( { length: n * 4 }, ( _, i ) => ( i % 4 === 0 ? 0.75 : 0.25 / 3 ) ) ), itemSize: 4 };
	const made = planParts( data, { parts: [ { island: 0, name: 'Left_Square', classes: [ 'l' ] }, { island: 1, name: 'Right_Square', classes: [ 'r' ] } ] }, null );
	const out = carveAttributes( data, made[ 1 ].triangles ), idx = triangleIndex( data );
	assert.ok( out.attrs.skinIndex.array instanceof Uint16Array && out.attrs.skinWeight.array instanceof Float32Array );
	const first = idx.slice( 6, 9 ).map( v => Array.from( data.attrs.skinIndex.array.slice( v * 4, v * 4 + 4 ) ) ).flat();
	assert.deepStrictEqual( Array.from( out.attrs.skinIndex.array.slice( 0, 12 ) ), first );
	assert.strictEqual( skinnedPlanProblem( { parts: [ { island: 0, name: 'A' } ] } ), null );
	assert.strictEqual( skinnedPlanProblem( { parts: [ { island: 0, name: 'A', subdivide: 0, palette: [] } ] } ), null );
	assert.match( skinnedPlanProblem( { parts: [ { island: 0, name: 'Dye_Job', subdivide: 2, palette: [] } ] } ), /skinned mesh cannot be divided by colour.*Dye_Job.*bone indices/ );
	assert.ok( buildRecord( { method: 'islands', from: 'fox', plan: { group: 'Fox_Parts' }, describe: {}, made, data, sourceTriangles: 8, sourceUnits: 2, source: SOURCE, meta: { skinned: true } } ).modifications.some( m => /bound to the original skeleton/.test( m ) ) );

} );

test( 'A / V1: a source is the file itself, pinned to a commit, hashed and measured, with its licence and credit', () => {

	const { source, legacy } = validateSource( SOURCE );
	assert.strictEqual( legacy, false );
	assert.deepStrictEqual( source, {
		url: SOURCE.url, page: `https://github.com/example/models/blob/${ COMMIT_SHA }/squares/squares.glb`, commit: COMMIT_SHA,
		sha256: FILE_SHA, bytes: 120484, licence: 'CC0 1.0', attribution: 'Test Studio'
	} );
	assert.deepStrictEqual( Object.keys( source ), [ 'url', 'page', 'commit', 'sha256', 'bytes', 'licence', 'attribution' ], 'where, what, which exact file, under what licence' );
	assert.throws( () => validateSource( undefined ), /derivative work/ );
	assert.throws( () => validateSource( { ...SOURCE, licence: ' ' } ), /source\.licence is missing/ );
	assert.throws( () => validateSource( { ...SOURCE, attribution: undefined } ), /source\.attribution is missing/ );
	assert.throws( () => validateSource( { ...SOURCE, url: 'squares.glb' } ), /http\(s\)/ );

} );

test( 'A / V1: a floating ref, a web page, a missing or wrong hash, a missing size are all refused, each with what to do', () => {

	const at = ( ref ) => `https://raw.githubusercontent.com/example/models/${ ref }/squares/squares.glb`;
	assert.throws( () => validateSource( { ...SOURCE, url: at( 'main' ) } ), /"main", which is a ref that moves.*Pin the commit/ );
	assert.throws( () => validateSource( { ...SOURCE, url: at( COMMIT_SHA.slice( 0, 7 ) ) } ), /ref that moves/, 'an abbreviated sha is not a pin' );
	assert.throws( () => validateSource( { ...SOURCE, url: 'https://github.com/example/models/blob/main/squares/squares.glb' } ), /web page \(blob\/\), not the file.*raw\.githubusercontent\.com\/example\/models\/<commit sha>\/squares\/squares\.glb/ );
	assert.throws( () => validateSource( { ...SOURCE, sha256: undefined } ), /source\.sha256 is missing/ );
	assert.throws( () => validateSource( { ...SOURCE, sha256: 'abc' } ), /not 64 hex digits/ );
	assert.throws( () => validateSource( { ...SOURCE, bytes: undefined } ), /source\.bytes is missing/ );
	assert.throws( () => validateSource( { ...SOURCE, bytes: '120484' } ), /source\.bytes is missing/ );
	assert.throws( () => validateSource( { ...SOURCE, commit: 'f'.repeat( 40 ) } ), /is not the commit in source\.url/ );
	assert.strictEqual( validateSource( { ...SOURCE, sha256: FILE_SHA.toUpperCase() } ).source.sha256, FILE_SHA, 'the hash is stored lower-case' );

} );

test( 'A: a source from another host is hashed and measured too, and may carry its own commit and page', () => {

	const other = { url: 'https://models.example.org/duck.glb', licence: 'CC BY 4.0', attribution: 'A. Author', sha256: FILE_SHA, bytes: 5 };
	assert.deepStrictEqual( validateSource( other ).source, { url: other.url, sha256: FILE_SHA, bytes: 5, licence: 'CC BY 4.0', attribution: 'A. Author' } );
	assert.throws( () => validateSource( { ...other, sha256: undefined } ), /source\.sha256 is missing/ );
	const withPage = validateSource( { ...other, page: 'https://models.example.org/duck', commit: 'a'.repeat( 40 ) } ).source;
	assert.strictEqual( withPage.page, 'https://models.example.org/duck' );
	assert.strictEqual( withPage.commit, 'a'.repeat( 40 ) );

} );

test( 'A: a record from before 1.3.0 is let through only when asked, so it can be recognised and replayed with a pinned source', () => {

	const old = { url: 'https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Duck/glTF-Binary/Duck.glb', licence: 'SCEA Shared Source License 1.0', attribution: 'Copyright 2006 Sony Computer Entertainment Inc.' };
	assert.throws( () => validateSource( old ), /web page/ );
	assert.deepStrictEqual( validateSource( old, 'x', { legacy: true } ), { source: old, legacy: true } );
	assert.throws( () => validateSource( { ...old, sha256: undefined, bytes: 1 }, 'x', { legacy: true } ), /web page/, 'but not half-migrated' );

} );

function recordOf( plan, data = mesh() ) {

	const made = planParts( data, plan, read );
	return { made, rec: buildRecord( { method: 'islands', from: 'Squares', plan, describe: { k: 3, islands: describeIslands( data, read, 3 ) }, made, data, sourceTriangles: 4, sourceUnits: 2, source: plan.source } ) };

}
const planA = { group: 'Squares_Group', classes: [ 'toy' ], source: SOURCE, modifications: 'Recoloured nothing.', parts: byColour.parts };

test( 'the record carries the provenance, the plan verbatim, the evidence, the counts, the version and the modifications', () => {

	const { rec } = recordOf( planA );
	assert.strictEqual( rec.seg_version, SEG_VERSION );
	assert.strictEqual( rec.from, 'Squares' );
	assert.deepStrictEqual( rec.source, validateSource( SOURCE ).source );
	assert.ok( ! ( 'source_url' in rec ) && ! ( 'source_licence' in rec ) && ! ( 'attribution' in rec ), 'the old flat fields are gone: a second copy is a second source of truth' );
	assert.deepStrictEqual( rec.verification, { status: 'seeded', reviews: [] } );
	assert.deepStrictEqual( rec.plan, JSON.parse( JSON.stringify( planA ) ) );       // as given, with the palette, subdivide and island numbers
	assert.notStrictEqual( rec.plan, planA );                                         // a copy: later edits to the plan do not change the record
	assert.strictEqual( rec.describe.islands.length, 2 );
	assert.ok( rec.describe.islands[ 0 ].colours.length > 0 );
	assert.deepStrictEqual( Object.keys( rec.parts ).sort(), [ 'Blue_Half', 'Red_Half', 'Red_Square' ] );
	assert.ok( rec.modifications.some( m => /subdivided into 64 \(2 to 128 triangles\)/.test( m ) ), rec.modifications.join( ' | ' ) );
	assert.ok( rec.modifications.includes( 'Recoloured nothing.' ) );
	assert.ok( rec.modifications[ 0 ].includes( 'SEG ' + SEG_VERSION ) );
	assert.deepStrictEqual( rec.signals.compound_names, [] );
	assert.strictEqual( rec.signals.source_units, 2 );
	assert.ok( rec.signals.largest_part_area_share > 0 && rec.signals.largest_part_area_share <= 1 );

} );

test( 'the signals note a compound name', () => {

	const plan = { group: 'G_Group', source: SOURCE, parts: [ { island: 0, name: 'Duck_Body_And_Head', classes: [ 'a' ] }, { island: 1, name: 'Wing_Left', classes: [ 'b' ] } ] };
	assert.deepStrictEqual( recordOf( plan ).rec.signals.compound_names, [ 'Duck_Body_And_Head' ] );

} );

test( 'G4: the recorded plan, kept as JSON and run again on the same mesh, gives exactly the same parts', () => {

	const first = recordOf( planA ), saved = JSON.parse( JSON.stringify( first.rec ) );          // what an exported asset keeps
	const again = recordOf( saved.plan );
	assert.deepStrictEqual( again.rec.parts, saved.parts );
	assert.deepStrictEqual( again.made.map( p => p.triangles ), first.made.map( p => p.triangles ) );     // the very triangles, not only the counts
	assert.deepStrictEqual( again.rec.describe, saved.describe );

} );

test( 'a record is checked against the mesh it is replayed on: the same mesh matches, a changed one is named', () => {

	const { rec } = recordOf( planA );
	const fresh = { k: 3, islands: describeIslands( mesh(), read, 3 ) };
	assert.deepStrictEqual( compareDescribe( rec.describe, fresh ), [] );
	const other = mesh(); other.index = other.index.slice( 0, 9 );                                   // one triangle fewer in island 1
	const diffs = compareDescribe( rec.describe, { k: 3, islands: describeIslands( other, read, 3 ) } );
	assert.ok( diffs.some( d => /island 1 has 1 triangles, the record says 2/.test( d ) ), diffs.join( ' | ' ) );
	assert.ok( compareDescribe( rec.describe, { k: 3, islands: [] } )[ 0 ].includes( 'the record has 2 islands and this mesh has 0' ) );
	assert.ok( compareDescribe( rec.describe, { materials: [] } )[ 0 ].includes( 'made from islands' ) );

} );

// a 4-triangle mesh in two materials: triangles 0 and 2 in material 0, 1 and 3 in material 1, as four groups
function twoMaterials() {

	const m = mesh();
	return { data: { index: m.index.slice( 0, 12 ), attrs: m.attrs }, groups: [ { start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 }, { start: 6, count: 3, materialIndex: 0 }, { start: 9, count: 3, materialIndex: 1 } ] };

}

test( 'cut by material: every triangle of each material, nothing lost, exact', () => {

	const { data, groups } = twoMaterials();
	const by = materialParts( data, groups );
	assert.deepStrictEqual( [ ...by.get( 0 ) ], [ 0, 2 ] );
	assert.deepStrictEqual( [ ...by.get( 1 ) ], [ 1, 3 ] );
	const made = planMaterialParts( data, groups, { parts: [ { material: 0, name: 'Body_Part', classes: [ 'body' ] }, { material: 1, name: 'Trim_Part', classes: [ 'trim' ] } ] } );
	assert.deepStrictEqual( made.map( p => [ p.name, p.material, p.triangles.length ] ), [ [ 'Body_Part', 0, 2 ], [ 'Trim_Part', 1, 2 ] ] );

} );

test( 'a cut by material is refused when the groups leave a triangle out, overlap, or a material has no part', () => {

	const { data, groups } = twoMaterials();
	assert.throws( () => materialParts( data, groups.slice( 0, 3 ) ), /do not cover every triangle/ );
	assert.throws( () => materialParts( data, [ ...groups, { start: 0, count: 3, materialIndex: 1 } ] ), /overlap/ );
	assert.throws( () => planMaterialParts( data, groups, { parts: [ { material: 0, name: 'Body_Part', classes: [ 'body' ] } ] } ), /every material must go to a part, and 1 of 2 have none/ );
	assert.throws( () => planMaterialParts( data, groups, { parts: [ { material: 0, name: 'Mesh', classes: [ 'a' ] }, { material: 1, name: 'B_Part', classes: [ 'b' ] } ] } ), /default/ );
	assert.throws( () => planMaterialParts( data, groups, { parts: [ { material: 5, name: 'X_Part', classes: [ 'x' ] } ] } ), /no material 5/ );

} );

test( 'the colour of a part is the texture under that part, not the whole atlas', () => {

	const data = mesh(), atlasRead = u => ( u < 0.5 ? [ 220, 30, 30 ] : [ 30, 30, 220 ] );        // a red patch and a blue patch in one texture
	const parts = islandsOf( data ).map( ts => ( { index: ts.flatMap( t => [ 0, 1, 2 ].map( k => data.index[ t * 3 + k ] ) ), attrs: data.attrs } ) );
	const left = footprintColour( parts[ 0 ], atlasRead ), right = footprintColour( parts[ 1 ], atlasRead );
	assert.deepStrictEqual( left.median, [ 220, 30, 30 ] );
	assert.deepStrictEqual( right.median, [ 30, 30, 220 ] );
	assert.strictEqual( left.clusters.length, 1 );
	assert.ok( left.clusters[ 0 ].hex === '#dc1e1e' && left.clusters[ 0 ].share === 1 );
	const both = footprintColour( parts[ 1 ], read );                                              // this one is painted half red, half blue
	assert.ok( both.clusters.length === 2 && both.clusters.some( c => c.rgb[ 2 ] > 200 ) && both.clusters.some( c => c.rgb[ 0 ] > 200 ) );
	assert.deepStrictEqual( footprintColour( parts[ 1 ], atlasRead ), right );                     // deterministic
	assert.strictEqual( footprintColour( { index: null, attrs: { position: data.attrs.position } }, read ), null );   // no uv: no footprint

} );

// ── scenes: components, the world frame, attachment, the assertions, the record ───────────────────────

// A room of boxes, modelled Z-up (as importers deliver many models) and mounted with a -90° turn about x, so mesh z is world y and mesh y is world -z.
// Every face of every box has its own patch of texture: a box is 6 islands but ONE component, which is the whole point of welding on position only.
const ZUP_TO_YUP = [ 1, 0, 0, 0, 0, 0, - 1, 0, 0, 1, 0, 0, 0, 0, 0, 1 ];
function room( boxes ) {

	const P = [], U = [], N = [];
	boxes.forEach( ( b, bi ) => {

		const [ x0, y0, z0 ] = b.lo, [ x1, y1, z1 ] = b.hi;
		const c = [ [ x0, y0, z0 ], [ x1, y0, z0 ], [ x1, y1, z0 ], [ x0, y1, z0 ], [ x0, y0, z1 ], [ x1, y0, z1 ], [ x1, y1, z1 ], [ x0, y1, z1 ] ];
		const faces = [ [ 0, 3, 2, 1 ], [ 4, 5, 6, 7 ], [ 0, 1, 5, 4 ], [ 1, 2, 6, 5 ], [ 2, 3, 7, 6 ], [ 3, 0, 4, 7 ] ];
		faces.forEach( ( f, fi ) => {

			const u0 = ( ( bi * 6 + fi ) % 20 ) * 0.05, uv = [ [ u0, 0 ], [ u0 + 0.04, 0 ], [ u0 + 0.04, 0.04 ], [ u0, 0.04 ] ];
			for ( const k of [ 0, 1, 2, 0, 2, 3 ] ) { P.push( ...c[ f[ k ] ] ); U.push( ...uv[ k ] ); N.push( 0, 0, 1 ); }

		} );

	} );
	const n = P.length / 3;
	return { index: Array.from( { length: n }, ( _, i ) => i ), attrs: { position: { array: new Float32Array( P ), itemSize: 3 }, normal: { array: new Float32Array( N ), itemSize: 3 }, uv: { array: new Float32Array( U ), itemSize: 2 } } };

}
// the component a box ended up in (a box is 12 triangles, built in order)
function idsOf( data, boxes ) {

	const sc = componentsOf( data ), isl = new Map(); sc.islands.forEach( ( ts, i ) => ts.forEach( t => isl.set( t, i ) ) );
	const comp = new Map(); sc.components.forEach( c => c.islands.forEach( i => comp.set( i, c.component ) ) );
	return Object.fromEntries( boxes.map( ( b, i ) => [ b.name, comp.get( isl.get( i * 12 ) ) ] ) );

}
const ROOM = [
	{ name: 'floor', lo: [ 0, 0, - 0.1 ], hi: [ 10, 10, 0 ] },
	{ name: 'wall', lo: [ 0, 0, 0.05 ], hi: [ 10, 0.1, 3 ] },               // 0.05 above the floor: a box that shares a corner with another is one component with it
	{ name: 'table', lo: [ 4, 4, 0 ], hi: [ 6, 6, 1 ] },
	{ name: 'mug', lo: [ 4.8, 4.8, 1 ], hi: [ 5.2, 5.2, 1.3 ] },
	{ name: 'lamp', lo: [ 9, 9, 2.5 ], hi: [ 9.4, 9.4, 3 ] },                 // hangs alone, far from the wall and 2.5 above the floor
	{ name: 'trim', lo: [ 0, 0.2, 2.8 ], hi: [ 10, 0.25, 2.9 ] },              // a bar a little way in front of the wall
	{ name: 'book', lo: [ 3.8, 4.4, 0 ], hi: [ 3.97, 4.6, 0.1 ] }              // resting on the floor, 0.03 from the table's side
];
const roomData = room( ROOM ), IDS = idsOf( roomData, ROOM );
const named = ( n, ...ids ) => ( { name: n, classes: [ n.toLowerCase() ], component: ids.length === 1 ? ids[ 0 ] : ids, basis: [ 'position', 'size' ] } );
const ANCHORS = [ named( 'Floor_Deck', IDS.floor ), named( 'Back_Wall', IDS.wall ), named( 'Round_Table', IDS.table ) ];

test( 'H1: a box is six islands and one component: welding on position only joins what a texture seam splits', () => {

	assert.strictEqual( islandsOf( roomData ).length, ROOM.length * 6 );
	const { components } = componentsOf( roomData );
	assert.strictEqual( components.length, ROOM.length );
	assert.ok( components.every( c => c.islands.length === 6 && c.triangles === 12 ) );
	assert.deepStrictEqual( components.map( c => c.component ), components.map( ( _, i ) => i ) );
	assert.deepStrictEqual( componentsOf( roomData ).components, components );                        // the same every run
	assert.strictEqual( componentsOf( mesh() ).components.length, 2 );                                // nothing touches: islands and components agree

} );

test( 'H1: components are largest first, ties by the lowest island, and every island lies inside exactly one', () => {

	const boxes = [ { name: 'small', lo: [ 0, 0, 0 ], hi: [ 1, 1, 1 ] }, { name: 'big', lo: [ 5, 5, 0 ], hi: [ 6, 6, 1 ] } ];
	const data = room( boxes );
	const sc = componentsOf( data );
	assert.deepStrictEqual( sc.components.map( c => c.islands.length ), [ 6, 6 ] );
	assert.strictEqual( new Set( sc.components.flatMap( c => c.islands ) ).size, sc.islands.length );
	assert.strictEqual( sc.components[ 0 ].islands[ 0 ], 0 );

} );

test( 'H3: the report is in the world frame: a Z-up mesh mounted with a turn has its height on y, not on z', () => {

	const world = describeComponents( roomData, null, { matrix: ZUP_TO_YUP } ), mesh_ = describeComponents( roomData, null, {} );
	const f = IDS.floor, l = IDS.lamp;
	assert.deepStrictEqual( mesh_[ f ].size, [ 10, 10, 0.1 ] );                                         // the mesh frame: the floor is thin in z
	assert.deepStrictEqual( world[ f ].size, [ 10, 0.1, 10 ] );                                         // the world: the floor is thin in y
	assert.ok( world[ l ].at[ 1 ] > 0.8 && world[ f ].at[ 1 ] < 0.1, 'the lamp is high and the floor low, on world y' );
	assert.ok( mesh_[ l ].at[ 2 ] > 0.8, 'in the mesh frame the same fact is on z, which is the wrong axis to call "up"' );
	assert.deepStrictEqual( world[ l ].centre.map( x => +x.toFixed(2) ), [ 9.2, 2.75, - 9.2 ] );
	assert.ok( world[ f ].islands.length === 6 && world[ f ].triangles === 12 && world[ f ].colours === null );
	const text = formatComponents( world, islandsOf( roomData ).length );
	assert.ok( text.indexOf( 'size ' ) < text.indexOf( 'no texture' ), 'a scene report leads with size and position, and puts colour last' );
	assert.ok( text.includes( '42 islands joined into 7 components' ) );

} );

test( 'the grain: components when they are far fewer than the islands, islands when they are not, and the caller can say', () => {

	assert.strictEqual( grainOf( 42, 7 ), 'components' );
	assert.strictEqual( grainOf( 538, 282 ), 'components' );
	assert.strictEqual( grainOf( 10, 9 ), 'islands' );
	assert.strictEqual( grainOf( 5, 5 ), 'islands' );
	assert.strictEqual( grainOf( 14, 1 ), 'islands' );                  // everything welded into one: components say nothing
	assert.strictEqual( grainOf( 42, 7, 'islands' ), 'islands' );
	assert.strictEqual( grainOf( 5, 5, 'components' ), 'components' );
	assert.throws( () => grainOf( 5, 5, 'tiles' ), /grain must be/ );

} );

function attach( anchors, opts = {} ) { const sc = componentsOf( roomData ); return { sc, r: attachComponents( roomData, sc, anchors, { matrix: ZUP_TO_YUP, ...opts } ) }; }

test( 'H2: attach puts a component on the nearest anchor, by distance to its triangles', () => {

	const { r } = attach( ANCHORS, { maxDistance: 100 } ), at = id => ANCHORS[ r.of[ id ] ].name;
	assert.strictEqual( at( IDS.mug ), 'Round_Table' );               // 0 from the table top
	assert.strictEqual( at( IDS.trim ), 'Back_Wall' );                // 0.1 from the wall, 2 from anything else
	assert.strictEqual( at( IDS.lamp ), 'Floor_Deck' );               // 2.5 above the floor, 8.9 from the wall: with no limit, the nearest wins
	assert.ok( Math.abs( r.distance[ IDS.lamp ] - 2.5 ) < 1e-6 );

} );

test( 'H2: the floor is a few huge triangles, and distance is to triangles, not vertices', () => {

	// the mug stands in the middle of a 10 x 10 floor: its distance to the floor's four corners is 7, to the floor itself 0 ... which is what the table is, and 1 from the table top
	const { r } = attach( [ named( 'Floor_Deck', IDS.floor ), named( 'Back_Wall', IDS.wall ) ], { maxDistance: 100 } );
	assert.ok( r.distance[ IDS.table ] < 1e-6, 'the table stands on the floor: distance 0, though the floor has no vertex near it' );

} );

test( 'H2: the tie-break is a rule: within `tie` of the nearest, the smaller bounding box wins (a prop beats the structure it stands against)', () => {

	const book = IDS.book;
	const a = attach( ANCHORS, { maxDistance: 100 } );             // the book rests on the floor (0) and is 0.03 from the table: tied within 0.05
	assert.strictEqual( ANCHORS[ a.r.of[ book ] ].name, 'Round_Table' );
	assert.ok( Math.abs( a.r.distance[ book ] - 0.03 ) < 1e-6 );
	const b = attach( ANCHORS, { maxDistance: 100, tie: 0.01 } );   // tie narrowed: no tie, the nearest (the floor) wins
	assert.strictEqual( ANCHORS[ b.r.of[ book ] ].name, 'Floor_Deck' );
	assert.deepStrictEqual( a.r.tieBroken.map( t => [ t.component, t.anchor, t.nearest ] ), [ [ book, 'Round_Table', 'Floor_Deck' ] ] );     // the rule overrode the nearest, and says so
	assert.deepStrictEqual( b.r.tieBroken, [] );
	assert.strictEqual( a.r.parameters.tie, SCENE.attach_tie );
	assert.strictEqual( b.r.parameters.tie, 0.01 );
	assert.strictEqual( SCENE.attach_tie, 0.05 );

} );

test( 'H5: a component further than maxDistance is not attached: it is returned to be named, not joined to a wall', () => {

	const { r, sc } = attach( ANCHORS );                           // the default limit comes from the scene's size
	const diag = Math.hypot( 10, 3.1, 10 );
	assert.ok( Math.abs( r.parameters.max_distance - SCENE.attach_max_fraction * diag ) < 0.01 );
	assert.strictEqual( r.parameters.max_distance_default, true );
	assert.deepStrictEqual( r.unattached.map( u => u.component ), [ IDS.lamp ] );
	assert.strictEqual( r.unattached[ 0 ].nearest, 'Floor_Deck' );
	assert.ok( Math.abs( r.unattached[ 0 ].distance - 2.5 ) < 1e-3 );
	assert.strictEqual( r.of[ IDS.lamp ], - 1 );
	assert.strictEqual( attach( ANCHORS, { maxDistance: 3 } ).r.unattached.length, 0 );
	assert.strictEqual( attach( ANCHORS, { maxDistance: 3 } ).r.parameters.max_distance_default, false );
	assert.strictEqual( sc.components.length, ROOM.length );

} );

test( 'attach refuses an empty anchor list, a component that does not exist, and one named by two anchors', () => {

	const sc = componentsOf( roomData );
	assert.throws( () => attachComponents( roomData, sc, [] ), /at least one anchor/ );
	assert.throws( () => attachComponents( roomData, sc, [ named( 'X_Part', 99 ) ] ), /no component 99/ );
	assert.throws( () => attachComponents( roomData, sc, [ named( 'X_Part', 0 ), named( 'Y_Part', 0 ) ] ), /named by two anchors/ );
	assert.throws( () => attachComponents( roomData, sc, [ { name: 'X_Part', classes: [ 'x' ] } ] ), /names no component/ );

} );

test( 'a plan with anchors: the host places the rest; the model supplies anchors and names, nothing else (H7)', () => {

	const plan = { group: 'Room_Group', source: SOURCE, anchors: [ ...ANCHORS, named( 'Hanging_Lamp', IDS.lamp ) ] };
	const meta = {}, made = planParts( roomData, plan, null, { matrix: ZUP_TO_YUP, meta } );
	assert.deepStrictEqual( made.map( p => p.name ), [ 'Floor_Deck', 'Back_Wall', 'Round_Table', 'Hanging_Lamp' ] );
	assert.strictEqual( made.reduce( ( s, p ) => s + p.triangles.length, 0 ), ROOM.length * 12 );    // every triangle, once
	assert.strictEqual( meta.grain, 'components' );
	assert.deepStrictEqual( [ meta.islands, meta.components, meta.anchors ], [ 42, 7, 4 ] );
	assert.deepStrictEqual( meta.componentsPerPart, { Floor_Deck: 1, Back_Wall: 2, Round_Table: 3, Hanging_Lamp: 1 } );      // wall + trim; table + mug + book

} );

test( 'a plan with anchors says exactly what is left, and changes nothing', () => {

	assert.throws( () => planParts( roomData, { anchors: ANCHORS }, null, { matrix: ZUP_TO_YUP } ), new RegExp( `1 component is further than maxDistance \\(1\\.4\\d*\\) from every anchor: component ${ IDS.lamp } \\(nearest "Floor_Deck", 2\\.5\\)` ) );
	assert.throws( () => planParts( roomData, { anchors: ANCHORS, parts: [ { name: 'Odd_Part', classes: [ 'a' ], island: 0 } ] }, null, { matrix: ZUP_TO_YUP } ), /by component/ );
	assert.throws( () => planParts( roomData, { anchors: ANCHORS, parts: [ { name: 'Odd_Part', classes: [ 'a' ], component: IDS.floor } ] }, null, { matrix: ZUP_TO_YUP } ), /is in a part and in the anchor/ );
	assert.throws( () => planParts( roomData, { parts: [ { name: 'Odd_Part', classes: [ 'a' ], component: 0, island: 1 } ] }, null ), /both island and component/ );
	assert.throws( () => planParts( roomData, { anchors: [ { ...ANCHORS[ 0 ], basis: 'vibes' }, ...ANCHORS.slice( 1 ) ], attach: { maxDistance: 100 } }, null, { matrix: ZUP_TO_YUP } ), /basis that is not one of/ );

} );

test( 'a part may be given by component, and a plan by component is the same cut as by island', () => {

	const byIsland = planParts( roomData, { parts: ROOM.map( ( b, i ) => ( { name: 'Box_' + b.name, classes: [ 'box' ], island: componentsOf( roomData ).components[ IDS[ b.name ] ].islands } ) ) }, null );
	const byComp = planParts( roomData, { parts: ROOM.map( b => ( { name: 'Box_' + b.name, classes: [ 'box' ], component: IDS[ b.name ] } ) ) }, null, { meta: {} } );
	assert.deepStrictEqual( byComp.map( p => p.triangles ), byIsland.map( p => p.triangles ) );

} );

// the failure the room run produced: the room-wide trim went to a part named as a column, and the part came out room-sized
const TRIM = [
	{ name: 'edge_x', lo: [ 0, 9.9, 0.02 ], hi: [ 10, 10, 0.1 ] }, { name: 'edge_y', lo: [ 9.9, 0.3, 2.9 ], hi: [ 10, 10, 3 ] }, { name: 'edge_z', lo: [ 0.2, 0.5, 0 ], hi: [ 0.3, 0.6, 3 ] }
];
const ROOM2 = [ ...ROOM, ...TRIM ], room2 = room( ROOM2 ), IDS2 = idsOf( room2, ROOM2 );
const planWith = ( netName, netClasses ) => ( { group: 'Room_Group', source: SOURCE, attach: { maxDistance: 100 }, anchors: [
	named( 'Floor_Deck', IDS2.floor ), named( 'Back_Wall', IDS2.wall ), named( 'Round_Table', IDS2.table ), named( 'Hanging_Lamp', IDS2.lamp ),
	{ name: netName, classes: netClasses, component: [ IDS2.edge_x, IDS2.edge_y, IDS2.edge_z ], basis: [ 'position' ] } ] } );
function assertionsOf( plan, read = null, data = room2 ) { const meta = {}; planParts( data, plan, read, { matrix: ZUP_TO_YUP, meta } ); return meta.assertions.fired; }

test( 'H4: the swallowed-trim failure fires an assertion on a re-created bad plan, naming the part and the numbers', () => {

	const fired = assertionsOf( planWith( 'Front_Right_Column', [ 'structure', 'wall' ] ) );
	const by = Object.fromEntries( fired.map( f => [ f.assertion, f ] ) );
	assert.ok( by.oversize && by.engulfing, JSON.stringify( fired.map( f => f.assertion ) ) );
	assert.strictEqual( by.oversize.part, 'Front_Right_Column' );
	assert.ok( by.oversize.span.every( s => s >= ASSERTIONS.oversize_span ), 'its box spans the scene on every axis: ' + by.oversize.span );
	assert.ok( by.oversize.area_share < ASSERTIONS.oversize_area );
	assert.ok( by.engulfing.contains_centres >= ASSERTIONS.engulf_share );
	assert.ok( /spans \d+%, \d+%, \d+% of the scene/.test( by.oversize.message ) && /undo and cut again/.test( by.oversize.message ) );
	assert.ok( fired.every( f => f.part === 'Front_Right_Column' ), 'only the bad part is named' );

} );

test( 'H4: the same pieces declared as trim are not flagged: a part that says it is spread out is allowed to be', () => {

	assert.deepStrictEqual( assertionsOf( planWith( 'Edge_Trim', [ 'structure', 'trim' ] ) ), [] );

} );

test( 'absorbed: a part assembled from many components that is almost all one colour', () => {

	const leaves = Array.from( { length: 9 }, ( _, i ) => ( { name: 'leaf' + i, lo: [ 1 + i * 0.5, 1, 0 ], hi: [ 1.3 + i * 0.5, 1.3, 0.3 ] } ) );
	const boxes = [ ROOM[ 0 ], ROOM[ 1 ], ROOM[ 2 ], ROOM[ 4 ], ...leaves ], data = room( boxes ), ids = idsOf( data, boxes );
	const plan = ( leafPart ) => ( { source: SOURCE, attach: { maxDistance: 100 }, anchors: [ named( 'Floor_Deck', ids.floor ), named( 'Back_Wall', ids.wall ), named( 'Round_Table', ids.table ), named( 'Hanging_Lamp', ids.lamp ),
		{ name: leafPart, classes: [ 'plant' ], component: leaves.map( l => ids[ l.name ] ) } ] } );
	const green = () => [ 20, 200, 20 ], mixed = ( u ) => ( u < 0.3 ? [ 20, 200, 20 ] : [ 200, 20, 20 ] );
	const hit = assertionsOf( plan( 'Plant_Cluster' ), green, data ).find( f => f.assertion === 'absorbed' );
	assert.ok( hit && hit.part === 'Plant_Cluster' && hit.components === 9 && hit.colour_share >= ASSERTIONS.absorbed_colour );
	assert.ok( ! assertionsOf( plan( 'Plant_Cluster' ), mixed, data ).some( f => f.assertion === 'absorbed' ), 'two colours: not absorbed' );
	assert.ok( ! assertionsOf( plan( 'Plant_Cluster' ), null, data ).some( f => f.assertion === 'absorbed' ), 'no texture: nothing to judge by' );

} );

test( 'orphan sink: one part that received most of everything that was attached', () => {

	const crumbs = Array.from( { length: 12 }, ( _, i ) => ( { name: 'crumb' + i, lo: [ 4.3 + i * 0.1, 4.2, 1 ], hi: [ 4.35 + i * 0.1, 4.25, 1.05 ] } ) );
	const boxes = [ ROOM[ 0 ], ROOM[ 1 ], ROOM[ 2 ], ROOM[ 4 ], ...crumbs ], data = room( boxes ), ids = idsOf( data, boxes );
	const plan = { source: SOURCE, attach: { maxDistance: 100 }, anchors: [ named( 'Floor_Deck', ids.floor ), named( 'Back_Wall', ids.wall ), named( 'Round_Table', ids.table ), named( 'Hanging_Lamp', ids.lamp ) ] };
	const hit = assertionsOf( plan, null, data ).find( f => f.assertion === 'orphan sink' );
	assert.ok( hit && hit.part === 'Round_Table' && hit.attached === 12 && hit.of === 12 );

} );

test( 'attach is how the failure happens: trim nobody named goes to the nearest anchor, and the part that took it is flagged', () => {

	// only one of the three trim bars is an anchor: the other two attach to the wall (the nearest thing with a surface), which then runs the length of the scene
	const fired = assertionsOf( { group: 'Room_Group', source: SOURCE, attach: { maxDistance: 100 }, anchors: [ named( 'Floor_Deck', IDS2.floor ), named( 'Back_Wall', IDS2.wall ), named( 'Round_Table', IDS2.table ), named( 'Hanging_Lamp', IDS2.lamp ), { ...named( 'Edge_Trim', IDS2.edge_x ), classes: [ 'trim' ] } ] } );
	assert.deepStrictEqual( fired.map( f => [ f.assertion, f.part ] ), [ [ 'oversize', 'Back_Wall' ] ] );

} );

test( 'a good cut fires nothing, and too few parts to compare are not judged', () => {

	assert.deepStrictEqual( assertionsOf( planWith( 'Edge_Trim', [ 'trim' ] ) ), [] );
	assert.deepStrictEqual( assertionsOf( { source: SOURCE, attach: { maxDistance: 1000 }, anchors: [ { ...named( 'Everything_Part', IDS2.floor ), classes: [ 'structure' ] } ] } ), [] );

} );

test( 'H6: the record carries components per part, the attach distances and the parameters used, the assertions and the grain', () => {

	const plan = planWith( 'Front_Right_Column', [ 'structure', 'wall' ] ), meta = {}, made = planParts( room2, plan, null, { matrix: ZUP_TO_YUP, meta } );
	const rec = buildRecord( { method: 'islands', from: 'Room', plan, describe: { grain: 'components', k: 3, components: describeComponents( room2, null, { matrix: ZUP_TO_YUP } ) }, made, data: room2, sourceTriangles: ROOM2.length * 12, sourceUnits: ROOM2.length, source: SOURCE, meta } );
	assert.strictEqual( rec.grain, 'components' );
	assert.strictEqual( rec.seg_version, SEG_VERSION );
	assert.deepStrictEqual( rec.plan, JSON.parse( JSON.stringify( plan ) ) );                                   // anchors, names, classes, basis, attach: as given
	assert.strictEqual( rec.describe.components.length, ROOM2.length );
	assert.deepStrictEqual( [ rec.signals.island_count, rec.signals.component_count, rec.signals.anchor_count, rec.signals.part_count ], [ ROOM2.length * 6, ROOM2.length, 5, 5 ] );
	assert.strictEqual( rec.signals.components_per_part.Round_Table, 3 );
	assert.strictEqual( rec.signals.components_per_part.Front_Right_Column, 3 );
	assert.deepStrictEqual( rec.signals.names_by_basis, { evidence: 5, shape: 0, unstated: 0 } );
	assert.ok( rec.signals.assertions.length >= 2 && rec.signals.assertions.every( a => a.part && a.assertion && a.message ) );
	assert.deepStrictEqual( rec.signals.assertion_parameters, ASSERTIONS );
	const p = rec.attach.parameters;
	assert.deepStrictEqual( [ p.max_distance, p.max_distance_default, p.tie, p.samples_per_island, p.weld_digits, p.frame ], [ 100, false, 0.05, 6, 4, 'world' ] );
	assert.deepStrictEqual( Object.keys( rec.attach.per_part ), [ 'Floor_Deck', 'Back_Wall', 'Round_Table', 'Hanging_Lamp', 'Front_Right_Column' ] );
	assert.strictEqual( rec.attach.per_part.Round_Table.attached_components, 2 );
	assert.ok( rec.attach.per_part.Round_Table.distance.max > 0 && rec.attach.per_part.Round_Table.distance.median >= 0 );
	assert.deepStrictEqual( rec.attach.unattached, [] );
	const book = rec.attach.tie_broken.find( t => t.component === IDS2.book );
	assert.ok( book && book.anchor === 'Round_Table' && book.nearest === 'Floor_Deck', 'the book: the rule, not the nearest, put it on the table' );
	assert.ok( rec.attach.tie_broken.every( t => t.distance - t.nearest_distance <= 0.05 + 1e-9 ), 'every override is within the tie' );
	assert.ok( rec.modifications[ 0 ].includes( 'in 10 components' ) && rec.modifications[ 0 ].includes( 'attaching what was not named' ) );
	// what each name rests on: position/size/colour is evidence, shape means it fell back to a description of the form, and a name with no basis is said to be unstated
	const mixed = { ...plan, anchors: plan.anchors.map( ( a, i ) => ( { ...a, basis: i === 0 ? [ 'shape' ] : i === 1 ? undefined : a.basis } ) ) }, m2 = {}, made2 = planParts( room2, mixed, null, { matrix: ZUP_TO_YUP, meta: m2 } );
	const rec2 = buildRecord( { method: 'islands', from: 'Room', plan: mixed, describe: rec.describe, made: made2, data: room2, sourceTriangles: 1, sourceUnits: 1, source: SOURCE, meta: m2 } );
	assert.deepStrictEqual( rec2.signals.names_by_basis, { evidence: 3, shape: 1, unstated: 1 } );

} );

test( 'H6: a record kept as JSON and run again gives the same parts, the same attachment, the same assertions', () => {

	const plan = planWith( 'Front_Right_Column', [ 'structure', 'wall' ] ), run = p => { const meta = {}; const made = planParts( room2, p, null, { matrix: ZUP_TO_YUP, meta } ); return { made, meta }; };
	const first = run( plan ), saved = JSON.parse( JSON.stringify( plan ) ), again = run( saved );
	assert.deepStrictEqual( again.made.map( p => p.triangles ), first.made.map( p => p.triangles ) );
	assert.deepStrictEqual( again.meta.attach, first.meta.attach );
	assert.deepStrictEqual( again.meta.assertions, first.meta.assertions );

} );

test( 'a record made from components is compared with the mesh by component, and a changed mesh is named', () => {

	const rec = { grain: 'components', k: 3, components: describeComponents( roomData, null, { matrix: ZUP_TO_YUP } ) };
	assert.deepStrictEqual( compareDescribe( rec, { grain: 'components', k: 3, components: describeComponents( roomData, null, { matrix: ZUP_TO_YUP } ) } ), [] );
	const other = { ...roomData, index: roomData.index.slice( 0, roomData.index.length - 36 ) };                 // the last box is gone
	const diffs = compareDescribe( rec, { components: describeComponents( other, null, { matrix: ZUP_TO_YUP } ) } );
	assert.ok( diffs.some( d => /the record has 7 components and this mesh has 6/.test( d ) ), diffs.join( ' | ' ) );
	assert.ok( compareDescribe( rec, { islands: [] } )[ 0 ].includes( 'made from components' ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
