// Run: node docs/editor/js/facebind/__tests__/facebind.test.mjs
// Optional real-file checks run when these exist (override with VRM=… FACE=…):
//   ~/Downloads/52blendshapes-for-VRoid-face-main/VRoid_V110_Male_v1.1.3.vrm
//   ~/Downloads/face-model-blendshapes (2).glb
// The browser path (page, egress guard, loading the bound VRM into Strata) is checked in the browser;
// see guides/FACE_BIND.md "Verifying".

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGLB, writeGLB } from '../glb.js';
import { readFaceSource, CONVENTION_42 } from '../faceSource.js';
import { bindVRM, buildBinding, assertRigSafe, ARKIT_52 } from '../bind.js';
import { hairColorFromMask } from '../hair.js';
import { faceProportions } from '../proportions.js';
import { hairShapeFromMask, measureHair, planHair, warpHairPoint, summarizePlan, GRID } from '../hairShape.js';
import { applyFaceWeights, splitExpression } from '../runtime.js';

let passed = 0, failed = 0, skipped = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };
const eq = ( a, b, m ) => { if ( JSON.stringify( a ) !== JSON.stringify( b ) ) throw new Error( ( m || 'not equal' ) + `: ${ JSON.stringify( a ) } vs ${ JSON.stringify( b ) }` ); };
const throws = ( fn, code ) => { try { fn(); } catch ( e ) { if ( code && e.code !== code ) throw new Error( `expected ${ code }, got ${ e.code }: ${ e.message }` ); return; } throw new Error( 'expected a throw' ); };
const near = ( a, b, tol, m ) => { if ( Math.abs( a - b ) > tol ) throw new Error( `${ m || 'not near' }: ${ a } vs ${ b }` ); };
const same = ( a, b ) => a.length === b.length && a.every( ( v, i ) => v === b[ i ] );

// ── synthetic fixtures ──────────────────────────────────────────────────────
const MAGIC_BIN = 0x004e4942;
function glb( json, bin = new Uint8Array( [ 1, 2, 3, 4, 5, 6, 7, 8 ] ) ) { return writeGLB( { json, chunks: [ { type: MAGIC_BIN, data: bin } ] } ); }
const targets = n => Array.from( { length: n }, () => ( { POSITION: 0 } ) );

const faceJson = ( names, extra = {} ) => ( {
	asset: { version: '2.0' }, nodes: [ { name: 'faceMesh', mesh: 0, extras: { skinColor: { r: 0.8, g: 0.6, b: 0.5 } } } ],
	meshes: [ { primitives: [ { attributes: { POSITION: 0 }, targets: targets( names.length ), extras: names ? { targetNames: names } : undefined } ] } ], ...extra,
} );

const vrmJson = () => ( {
	asset: { version: '2.0' }, extensionsUsed: [ 'VRM' ], extensions: { VRM: { specVersion: '0.0', materialProperties: [ { name: 'Face_SKIN', vectorProperties: { _Color: [ 1, 1, 1, 1 ] } } ] } },
	materials: [ { name: 'Face_SKIN', pbrMetallicRoughness: { baseColorFactor: [ 1, 1, 1, 1 ] } } ],
	nodes: [ { name: 'Hips' } ], skins: [ { joints: [ 0 ] } ],
	meshes: [ { name: 'Face', extras: { targetNames: [ 'eyeBlinkLeft', 'jawOpen', 'mouthSmileLeft', 'mouthRollLower' ] }, primitives: [ { attributes: { POSITION: 0 }, targets: targets( 4 ) } ] } ],
} );

console.log( 'face bind (synthetic)' );

test( 'GLB write(parse(x)) keeps the BIN chunk byte for byte', () => {

	const bin = new Uint8Array( [ 9, 8, 7, 6, 5, 4, 3, 2 ] );
	const out = parseGLB( glb( vrmJson(), bin ) );
	ok( same( out.chunks[ 0 ].data, bin ) );

} );

test( 'maps by name, lists unmapped source morphs and undriven VRM shapes', () => {

	const r = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'eyeBlinkLeft', 'jawOpen', 'tongueOut' ] ) ) );
	eq( r.bind.map.map( m => [ m.source, m.name ] ), [ [ 0, 'eyeBlinkLeft' ], [ 1, 'jawOpen' ] ] );
	eq( r.bind.unmapped.map( u => u.name ), [ 'tongueOut' ] );
	eq( r.bind.undriven, [ 'mouthRollLower', 'mouthSmileLeft' ] );
	ok( r.bind.scope.includes( 'not a likeness' ) );

} );

test( 'only the bind block and extensionsUsed change; geometry, skeleton, skin, weights and BIN are untouched', () => {

	const base = glb( vrmJson() );
	const out = parseGLB( bindVRM( base, glb( faceJson( [ 'jawOpen' ] ) ) ).bytes );
	const orig = parseGLB( base );
	const a = JSON.parse( JSON.stringify( out.json ) ); delete a.extensions.STRATA_face_bind; a.extensionsUsed = orig.json.extensionsUsed;
	eq( a, orig.json );
	ok( same( out.chunks[ 0 ].data, orig.chunks[ 0 ].data ), 'BIN differs' );
	ok( out.json.extensionsUsed.includes( 'STRATA_face_bind' ) );

} );

test( 'deterministic: same inputs give the same bytes', () => {

	const a = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'jawOpen', 'eyeBlinkLeft' ] ) ) ).bytes;
	const b = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'jawOpen', 'eyeBlinkLeft' ] ) ) ).bytes;
	ok( same( a, b ) );

} );

// the autorigger's own structure with index-only names (the primitive's semantic names removed)
const autorigger42 = ( idxNames = true ) => {

	const j = faceJson( Array.from( { length: 42 }, ( _, i ) => String( i ) ) );
	j.asset = { version: '2.0', generator: 'THREE.GLTFExporter r185dev' };
	j.nodes = [ { name: 'faceMesh', mesh: 0, extras: { faceWidth: 2, faceHeight: 2, aspectRatio: 0.85, skinColor: { r: 0.8, g: 0.6, b: 0.5 } } } ];
	j.meshes[ 0 ].extras = { targetNames: Array.from( { length: 42 }, ( _, i ) => String( i ) ) };
	j.meshes[ 0 ].primitives[ 0 ].extras = undefined;
	j.accessors = [ { count: 478 } ]; j.meshes[ 0 ].primitives[ 0 ].attributes = { POSITION: 0 };
	return j;

};

test( 'index-only morphs: the 42-order is assumed ONLY for the autorigger\'s own structure, flagged `convention` with a loud warning; any other 42-morph file is `unresolved` and maps nothing', () => {

	const sig = readFaceSource( glb( autorigger42() ) );
	eq( sig.names, CONVENTION_42 ); eq( sig.resolution, 'convention' ); ok( sig.warnings.length === 1 && /check them/.test( sig.warnings[ 0 ] ) );
	const r = bindVRM( glb( vrmJson() ), glb( autorigger42() ) );
	eq( r.bind.source.nameResolution, 'convention' ); ok( r.bind.warnings.length === 1, 'the warning must ride in the STRATA_face_bind block' ); ok( r.report.warnings.some( w => /check them/.test( w ) ) );
	// the same 42 index-only morphs from any other source (no autorigger structure), in any order: nothing is mapped
	for ( const mutate of [ j => { j.nodes[ 0 ].name = 'head'; }, j => { delete j.nodes[ 0 ].extras.faceWidth; }, j => { j.asset.generator = 'Blender'; }, j => { j.accessors[ 0 ].count = 468; }, j => { j.meshes[ 0 ].extras.targetNames = j.meshes[ 0 ].extras.targetNames.slice().reverse(); } ] ) {

		const j = autorigger42(); mutate( j );
		const s = readFaceSource( glb( j ) );
		eq( s.resolution, 'unresolved', 'a lookalike must not be assumed' ); ok( s.names.every( n => n === null ) && s.warnings.length === 1 );
		const bound = bindVRM( glb( vrmJson() ), glb( j ) );
		eq( bound.bind.map, [] ); eq( bound.bind.unmapped.length, 42 );

	}
	const idx = n => Array.from( { length: n }, ( _, i ) => String( i ) );
	const s5 = readFaceSource( glb( faceJson( idx( 5 ) ) ) );
	ok( s5.resolution === 'unresolved' && s5.names.every( n => n === null ) );
	eq( bindVRM( glb( vrmJson() ), glb( faceJson( idx( 5 ) ) ) ).bind.map, [] );

} );

test( 'a bind resolved by real names carries no resolution warning; runtime hands the bind\'s warnings to the caller', () => {

	const clean = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'jawOpen' ] ) ) );
	eq( clean.bind.warnings, [] );
	const conv = bindVRM( glb( vrmJson() ), glb( autorigger42() ) );
	const mesh = { morphTargetDictionary: { eyeBlinkLeft: 0 }, morphTargetInfluences: [ 0 ] };
	const res = applyFaceWeights( { traverse: f => f( mesh ), userData: {} }, { eyeBlinkLeft: 0.5 }, { bind: conv.bind } );
	ok( res.warnings.length === 1, 'driving a convention bind must hand back the warning' );

} );

test( 'explicit names override the file', () => {

	const r = bindVRM( glb( vrmJson() ), glb( faceJson( [ '0', '1' ] ) ), { names: [ 'jawopen', 'EYEBLINKLEFT' ] } );
	eq( r.bind.map.map( m => m.name ), [ 'jawOpen', 'eyeBlinkLeft' ] );

} );

test( 'refuses a non-VRM base, a morph-less face, and a bind that would touch the rig', () => {

	const notVrm = vrmJson(); delete notVrm.extensions;
	throws( () => bindVRM( glb( notVrm ), glb( faceJson( [ 'jawOpen' ] ) ) ), 'NOT_VRM' );
	throws( () => readFaceSource( glb( { asset: { version: '2.0' }, meshes: [ { primitives: [ { attributes: {} } ] } ] } ) ), 'NO_MORPHS' );
	const before = vrmJson(), after = vrmJson(); after.nodes[ 0 ].name = 'Moved';
	throws( () => assertRigSafe( before, after ), 'RIG_UNSAFE' );
	const skinned = vrmJson(); skinned.skins[ 0 ].joints = [ 0, 1 ];
	throws( () => assertRigSafe( vrmJson(), skinned ), 'RIG_UNSAFE' );

} );

test( 'optional look: skin and hair tint change only material colors (base + shade), and say they are approximate', () => {

	const j = vrmJson();
	j.materials.push( { name: 'Hair_HAIR', pbrMetallicRoughness: { baseColorFactor: [ 1, 1, 1, 1 ] } } );
	j.extensions.VRM.materialProperties.push( { name: 'Hair_HAIR', vectorProperties: { _Color: [ 1, 1, 1, 1 ], _ShadeColor: [ 0.8, 0.8, 0.8, 1 ] } } );
	const base = glb( j );
	const face = glb( faceJson( [ 'jawOpen' ], { nodes: [ { name: 'faceMesh', mesh: 0, extras: { skinColor: { r: 0.8, g: 0.6, b: 0.5 }, hairColor: { r: 0.15, g: 0.1, b: 0.08 }, hairCoverage: 0.9 } } ] } ) );
	const r = bindVRM( base, face, { look: { skin: true, hair: true, strength: 1, textureMeans: { 0: [ 250, 232, 219 ], 1: [ 180, 180, 180 ] } } } );
	ok( r.report.look && r.report.look.approximate );
	eq( r.report.look.applied.map( a => a.role ), [ 'skin', 'hair' ] );
	const out = parseGLB( r.bytes ).json;
	ok( out.materials[ 0 ].pbrMetallicRoughness.baseColorFactor[ 0 ] < 1, 'skin not tinted' );
	ok( out.materials[ 1 ].pbrMetallicRoughness.baseColorFactor[ 0 ] < 0.2, 'hair not darkened' );
	ok( out.extensions.VRM.materialProperties[ 1 ].vectorProperties._Color[ 0 ] < 0.6, 'VRM0 hair _Color not applied' );
	ok( out.extensions.VRM.materialProperties[ 1 ].vectorProperties._ShadeColor[ 0 ] < 0.8, 'hair shade color did not follow' );
	ok( r.report.look.applied.every( a => a.reached ) );
	// a hair color lighter than the texture cannot be reached by a tint: it is reported, not faked
	const blond = bindVRM( base, glb( faceJson( [ 'jawOpen' ], { nodes: [ { extras: { hairColor: { r: 0.9, g: 0.8, b: 0.5 }, hairCoverage: 0.9 } } ] } ) ), { look: { hair: true, strength: 1, textureMeans: { 1: [ 120, 120, 120 ] } } } );
	ok( blond.report.look.applied[ 0 ].reached === false && blond.report.warnings.some( w => /could not be fully reached/.test( w ) ) );

} );

test( 'look is skipped, with a warning, when the data is missing: no hair in the photo, no hair hint, no texture mean', () => {

	const j = vrmJson();
	j.materials.push( { name: 'Hair_HAIR', pbrMetallicRoughness: { baseColorFactor: [ 1, 1, 1, 1 ] } } );
	const base = glb( j );
	const bald = bindVRM( base, glb( faceJson( [ 'jawOpen' ], { nodes: [ { extras: { hairColor: { r: 0.1, g: 0.1, b: 0.1 }, hairCoverage: 0.01 } } ] } ) ), { look: { hair: true, textureMeans: { 1: [ 180, 180, 180 ] } } } );
	ok( bald.report.look === null && bald.report.warnings.some( w => /little or no hair/.test( w ) ) );
	const noHint = bindVRM( base, glb( faceJson( [ 'jawOpen' ] ) ), { look: { hair: true, skin: true, textureMeans: {} } } );
	ok( noHint.report.look === null && noHint.report.warnings.length >= 2 );
	const noMean = bindVRM( base, glb( faceJson( [ 'jawOpen' ] ) ), { look: { skin: true } } );
	ok( noMean.report.look === null && noMean.report.warnings.some( w => /texture mean was not supplied/.test( w ) ) );

} );

test( 'runtime: face weights drive the VRM morphs by name, clamped; unknown entries are skipped', () => {

	const { bind } = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'eyeBlinkLeft', 'jawOpen' ] ) ) );
	const mesh = { morphTargetDictionary: { eyeBlinkLeft: 0, jawOpen: 1 }, morphTargetInfluences: [ 0, 0 ] };
	const root = { traverse: f => f( mesh ), userData: {} };
	const r = applyFaceWeights( root, [ 0.4, 1.7 ], { bind } );
	eq( mesh.morphTargetInfluences, [ 0.4, 1 ] ); eq( r.applied, 2 );
	applyFaceWeights( root, { jawOpen: 0.25 }, { bind } );
	eq( mesh.morphTargetInfluences, [ 0.4, 0.25 ] );

} );

test( 'expression from a photo: scores split into the bind-mapped morphs and the extra ARKit shapes the VRM has', () => {

	const { bind } = bindVRM( glb( vrmJson() ), glb( faceJson( [ 'eyeBlinkLeft', 'jawOpen' ] ) ) );
	const { mapped, extra } = splitExpression( { jawOpen: 0.6, eyeBlinkLeft: 0.2, mouthRollLower: 0.4, browInnerUp: 'x', cheekPuff: NaN }, bind );
	eq( mapped, { jawOpen: 0.6, eyeBlinkLeft: 0.2 } ); eq( extra, { mouthRollLower: 0.4 } );
	const mesh = { morphTargetDictionary: { eyeBlinkLeft: 0, jawOpen: 1 }, morphTargetInfluences: [ 0, 0 ] };
	applyFaceWeights( { traverse: f => f( mesh ), userData: {} }, mapped, { bind } );
	eq( mesh.morphTargetInfluences, [ 0.2, 0.6 ] );

} );

test( 'zero-egress by construction: the bind modules have no network, storage or dynamic-import access', () => {

	const dir = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
	for ( const f of [ 'glb.js', 'faceSource.js', 'bind.js', 'runtime.js' ] ) {

		const src = fs.readFileSync( path.join( dir, f ), 'utf8' ).replace( /\/\/.*$/gm, '' );
		ok( ! /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|localStorage|indexedDB|importScripts)\b|import\s*\(/.test( src ), `${ f } references a network/storage API` );

	}

} );

test( 'hair color: reads the masked pixels, ignores highlights, shadows and the mask edge', () => {

	const w = 20, h = 20, rgba = new Uint8ClampedArray( w * h * 4 ), mask = new Uint8Array( w * h );
	for ( let i = 0; i < w * h; i ++ ) { rgba.set( [ 240, 240, 240, 255 ], i * 4 ); } // white background
	for ( let y = 4; y < 16; y ++ ) for ( let x = 4; x < 16; x ++ ) { const i = y * w + x; mask[ i ] = 1; rgba.set( [ 60, 40, 30, 255 ], i * 4 ); }
	rgba.set( [ 255, 255, 255, 255 ], ( 8 * w + 8 ) * 4 ); // a specular highlight inside the hair
	const r = hairColorFromMask( rgba, mask, { width: w, height: h, faceArea: 100 } );
	ok( Math.abs( r.color.r * 255 - 60 ) < 3 && Math.abs( r.color.g * 255 - 40 ) < 3 && Math.abs( r.color.b * 255 - 30 ) < 3, 'color ' + JSON.stringify( r.color ) );
	ok( r.pixels === 100 && r.coverage === 1, 'pixels/coverage ' + r.pixels );
	eq( hairColorFromMask( rgba, new Uint8Array( w * h ), { width: w, height: h } ), null );

} );

test( 'hair shape from a mask: measures a whole head, and refuses what the frame crops', () => {

	// landmarks of a face centred in a 200x200 frame: eyes at y=.45, chin at .75, ears at x=.3/.7
	const lm = Array.from( { length: 478 }, () => ( { x: 0.5, y: 0.5 } ) );
	Object.assign( lm, { 33: { x: 0.38, y: 0.45 }, 133: { x: 0.46, y: 0.45 }, 362: { x: 0.54, y: 0.45 }, 263: { x: 0.62, y: 0.45 }, 234: { x: 0.3, y: 0.52 }, 454: { x: 0.7, y: 0.52 }, 152: { x: 0.5, y: 0.75 } } );
	const w = 200, h = 200, mask = new Uint8Array( w * h );
	const fill = ( x0, x1, y0, y1 ) => { for ( let y = y0; y < y1; y ++ ) for ( let x = x0; x < x1; x ++ ) mask[ y * w + x ] = 1; };
	fill( 52, 148, 20, 70 ); // crown and sides above the brows
	const full = hairShapeFromMask( lm, mask, { width: w, height: h } );
	ok( full.topV > 1 && full.topV < 2.2, 'topV ' + full.topV ); ok( full.widthW > 1 && full.widthW < 1.6, 'widthW ' + full.widthW );
	ok( ! full.cropped.top && ! full.cropped.side );
	fill( 90, 110, 0, 20 ); // hair touching the top edge
	const cropped = hairShapeFromMask( lm, mask, { width: w, height: h } );
	ok( cropped.cropped.top && cropped.topV === null, 'a hair-on-the-edge photo must not report a height' );
	eq( hairShapeFromMask( lm, new Uint8Array( w * h ), { width: w, height: h } ), null );

} );

const hairFrame = { eyeY: 1.61, E: 0.11, W: 0.18, front: - 1, zc: - 0.04 };
const lmFor = () => {

	const lm = Array.from( { length: 478 }, () => ( { x: 0.5, y: 0.5 } ) );
	Object.assign( lm, { 33: { x: 0.38, y: 0.45 }, 133: { x: 0.46, y: 0.45 }, 362: { x: 0.54, y: 0.45 }, 263: { x: 0.62, y: 0.45 }, 234: { x: 0.3, y: 0.52 }, 454: { x: 0.7, y: 0.52 }, 152: { x: 0.5, y: 0.75 } } );
	return lm;

};

test( 'hair silhouette from a mask: image-right and image-left reach separately, crown and fringe per column, cropped bands dropped', () => {

	const w = 200, h = 200, mask = new Uint8Array( w * h );
	const fill = ( x0, x1, y0, y1 ) => { for ( let y = y0; y < y1; y ++ ) for ( let x = x0; x < x1; x ++ ) mask[ y * w + x ] = 1; };
	fill( 60, 150, 30, 60 ); // wider to the image-right (x > 100) than to the left
	fill( 60, 80, 60, 130 ); // a lock hanging below the eye line on the image-left, connected to the hair above
	const s = hairShapeFromMask( lmFor(), mask, { width: w, height: h } );
	const iv = v => Math.floor( ( v - GRID.v.lo ) / GRID.v.step );
	ok( s.profile.halfR[ iv( 0.5 ) ] > s.profile.halfL[ iv( 0.5 ) ], 'right reach should exceed left: ' + s.profile.halfR[ iv( 0.5 ) ] + ' vs ' + s.profile.halfL[ iv( 0.5 ) ] );
	ok( s.profile.halfL[ iv( - 0.4 ) ] !== null && s.profile.halfR[ iv( - 0.4 ) ] === null, 'the hanging lock is on the image-left only' );
	ok( s.profile.topByU.some( v => v !== null ) && s.profile.lineByU.some( v => v !== null ) );
	fill( 90, 110, 0, 30 ); // touches the top edge
	const cropped = hairShapeFromMask( lmFor(), mask, { width: w, height: h } );
	ok( cropped.cropped.top && cropped.profile.topByU.some( v => v === null ), 'the columns at the top edge must be dropped' );

} );

test( 'VRM hair silhouette uses the same sides: on a VRM facing -z, image-right is model -x', () => {

	const pts = new Float32Array( [ - 0.1, 1.65, 0, 0.05, 1.65, 0, 0, 1.78, 0, 0, 1.7, - 0.1 ] );
	const m = measureHair( pts, [ 0, 1, 2, 3 ], hairFrame );
	const i = Math.floor( ( ( 1.65 - hairFrame.eyeY ) / hairFrame.E - GRID.v.lo ) / GRID.v.step );
	ok( Math.abs( m.profile.halfR[ i ] - 0.1 / 0.18 ) < 1e-6, 'right reach ' + m.profile.halfR[ i ] );
	ok( Math.abs( m.profile.halfL[ i ] - 0.05 / 0.18 ) < 1e-6, 'left reach ' + m.profile.halfL[ i ] );
	const flipped = measureHair( pts, [ 0, 1, 2, 3 ], { ...hairFrame, front: 1 } );
	ok( flipped.profile.halfL[ i ] > flipped.profile.halfR[ i ], 'a +z-facing VRM mirrors it' );

} );

test( 'hair plan and warp (silhouette): each side, the crown and the fringe follow the photo; strength 0 moves nothing; limits hold', () => {

	const m = hairFrame;
	const iv = v => Math.floor( ( v - GRID.v.lo ) / GRID.v.step );
	const cur = measureHair( new Float32Array( [ - 0.1, 1.65, 0, 0.1, 1.65, 0, - 0.1, 1.55, 0, 0.1, 1.55, 0, 0, 1.78, 0, 0.03, 1.72, 0, - 0.03, 1.72, 0 ] ), [ 0, 1, 2, 3, 4, 5, 6 ], m );
	// the photo's hair reaches much further to the image-right (model -x) than the VRM's, and the same to the left
	const half = a => Array.from( { length: 18 }, ( _, i ) => a[ i ] ?? null );
	const refProfile = { halfR: half( cur.profile.halfR.map( v => v === null ? null : v * 1.2 ) ), halfL: half( cur.profile.halfL ), topByU: cur.profile.topByU.map( v => v === null ? null : v * 1.2 ), lineByU: new Array( 12 ).fill( null ) };
	refProfile.lineByU[ 7 ] = 0.9; // a fringe edge over the right of the forehead only
	const plan = planHair( { ...cur }, { profile: refProfile, topV: null, widthW: null, lengthV: null, hairlineV: null }, m, 1 );
	eq( plan.mode, 'silhouette' );
	const right = warpHairPoint( plan, - 0.1, 1.65, 0 ), left = warpHairPoint( plan, 0.1, 1.65, 0 );
	ok( right[ 0 ] < - 1e-4, 'the image-right side (model -x) must move out: ' + right[ 0 ] );
	ok( Math.abs( left[ 0 ] ) < 1e-4, 'the unchanged side must not move: ' + left[ 0 ] );
	ok( warpHairPoint( plan, 0.02, 1.78, 0 )[ 1 ] > 0, 'the crown rises' );
	const zero = planHair( cur, { profile: refProfile }, m, 0 );
	for ( const pt of [ [ - 0.1, 1.65, 0 ], [ 0, 1.78, 0 ], [ 0.05, 1.7, - 0.1 ] ] ) ok( Math.hypot( ...warpHairPoint( zero, ...pt ) ) < 1e-12, 'strength 0 must not move anything' );
	for ( const pt of [ [ 0.3, 1.9, 0.3 ], [ - 0.2, 1.5, - 0.1 ] ] ) ok( Math.hypot( ...warpHairPoint( plan, ...pt ) ) <= 0.05 + 1e-9 );
	const sum = summarizePlan( plan );
	ok( sum.mode === 'silhouette' && sum.sides.right && sum.sides.right.some( v => v !== null && v > 1 ) );

} );

test( 'hair never sinks into the head: shrinking toward a much narrower photo silhouette is limited, and neighbors across the back center move alike', () => {

	const m = hairFrame, half = ( v ) => Array.from( { length: 18 }, () => v );
	// VRM-like back hair: a ring of strands at 1.5 cm outside a 9 cm head radius, at ear level
	const pts = []; for ( let a = 0; a < 360; a += 10 ) { const r = 0.105, t = a * Math.PI / 180; pts.push( r * Math.cos( t ), 1.64, - 0.04 + r * Math.sin( t ) ); }
	const arr = new Float32Array( pts ), ids = Array.from( { length: arr.length / 3 }, ( _, i ) => i );
	const cur = measureHair( arr, ids, m );
	const narrow = { topV: null, widthW: null, lengthV: null, hairlineV: null, profile: { halfR: half( 0.3 ), halfL: half( 0.3 ), topByU: new Array( 12 ).fill( null ), lineByU: new Array( 12 ).fill( null ) } };
	const plan = planHair( cur, narrow, m, 1 );
	for ( let i = 0; i < ids.length; i ++ ) {

		const d = warpHairPoint( plan, arr[ i * 3 ], arr[ i * 3 + 1 ], arr[ i * 3 + 2 ] );
		const r0 = Math.hypot( arr[ i * 3 ], arr[ i * 3 + 2 ] + 0.04 ), r1 = Math.hypot( arr[ i * 3 ] + d[ 0 ], arr[ i * 3 + 2 ] + 0.04 + d[ 2 ] );
		ok( r1 >= r0 * 0.93, `strand ${ i } sank into the head: radius ${ r0.toFixed( 4 ) } -> ${ r1.toFixed( 4 ) }` );

	}
	// a lopsided reference (left wide, right narrow): two strands 1 cm apart across the back center get nearly the same move
	const lop = { ...narrow, profile: { ...narrow.profile, halfR: half( 0.3 ), halfL: half( 0.9 ) } };
	const pl = planHair( cur, lop, m, 1 );
	const a1 = warpHairPoint( pl, - 0.005, 1.64, 0.07 ), a2 = warpHairPoint( pl, 0.005, 1.64, 0.07 );
	ok( Math.hypot( a1[ 0 ] - a2[ 0 ], a1[ 2 ] - a2[ 2 ] ) < 0.0015, 'neighbors across the back center were torn apart: ' + Math.hypot( a1[ 0 ] - a2[ 0 ], a1[ 2 ] - a2[ 2 ] ) );

} );

test( 'hair trims: a fringe longer than the photo\'s is folded up to the photo\'s edge, hair longer than the photo\'s is cut at its length, hair above is untouched', () => {

	const m = hairFrame;
	const front = [ - 0.02, 0.0, 0.02 ];
	// strands down the middle of the forehead, from the crown to the brows, in front of the head
	const pts = []; for ( const x of front ) for ( let y = 1.62; y <= 1.78; y += 0.01 ) pts.push( x, y, - 0.08 );
	// plus side hair hanging well below the ear line
	for ( let y = 1.30; y <= 1.6; y += 0.02 ) pts.push( 0.1, y, 0 );
	const arr = new Float32Array( pts ), ids = Array.from( { length: arr.length / 3 }, ( _, i ) => i );
	const cur = measureHair( arr, ids, m );
	const ref = { topV: null, widthW: null, lengthV: null, hairlineV: null, profile: { halfR: new Array( 18 ).fill( null ), halfL: new Array( 18 ).fill( null ), topByU: new Array( 12 ).fill( null ), lineByU: new Array( 12 ).fill( null ) } };
	for ( let j = 4; j < 8; j ++ ) ref.profile.lineByU[ j ] = 0.75; // the photo's hair starts high on the forehead
	const iv = v => Math.floor( ( v - GRID.v.lo ) / GRID.v.step );
	for ( let i = iv( - 0.5 ); i <= iv( 1.0 ); i ++ ) ref.profile.halfL[ i ] = cur.profile.halfL[ i ] ?? 0.62; // the photo's side hair stops at v = -0.5
	for ( let i = iv( - 0.5 ); i <= iv( 1.0 ); i ++ ) ref.profile.halfR[ i ] = cur.profile.halfR[ i ] ?? 0.62;
	const plan = planHair( cur, ref, m, 1 );
	ok( plan.profile.edge && plan.profile.edge( 0 ) === 0.75, 'a fringe edge to trim to' );
	const foldedUp = warpHairPoint( plan, 0, 1.62, - 0.08 ); // v = 0.09: well below the photo's edge at v = 0.75
	const yAfter = 1.62 + foldedUp[ 1 ], edgeY = m.eyeY + 0.75 * m.E;
	ok( yAfter > 1.62 + 0.04 && yAfter <= edgeY + 1e-9, `the fringe tip must rise toward the edge: ${ yAfter } (edge ${ edgeY })` );
	ok( warpHairPoint( plan, 0, 1.78, - 0.08 )[ 1 ] === 0 || Math.abs( warpHairPoint( plan, 0, 1.78, - 0.08 )[ 1 ] ) < 0.002, 'hair above the edge must not move' );
	// zero strength: nothing moves
	const none = planHair( cur, ref, m, 0 );
	ok( Math.hypot( ...warpHairPoint( none, 0, 1.62, - 0.08 ) ) < 1e-12 );

} );

test( 'a collar or stray blob below the hair is not counted as hair length (bands must connect to the hair above)', () => {

	const lm = lmFor(), w = 200, h = 200, mask = new Uint8Array( w * h );
	const fill = ( x0, x1, y0, y1 ) => { for ( let y = y0; y < y1; y ++ ) for ( let x = x0; x < x1; x ++ ) mask[ y * w + x ] = 1; };
	fill( 60, 140, 30, 80 ); // the hair
	fill( 50, 100, 150, 190 ); // a collar far below, not connected
	const s = hairShapeFromMask( lm, mask, { width: w, height: h } );
	const iv = v => Math.floor( ( v - GRID.v.lo ) / GRID.v.step );
	ok( s.profile.halfL[ iv( - 1.3 ) ] === null && s.profile.halfR[ iv( - 1.3 ) ] === null, 'the collar must be dropped' );
	ok( s.profile.halfR[ iv( 0.5 ) ] !== null, 'the hair must stay' );

} );

test( 'hair plan and warp (scalar fallback): moves toward the reference, stays within limits, strength 0 moves nothing', () => {

	const m = hairFrame;
	const cur = { topV: 1.5, widthW: 1.2, lengthV: - 0.8, hairlineV: 0.5, profile: null };
	const ref = { topV: 2.0, widthW: 1.6, lengthV: - 2.5, hairlineV: 0.9 };
	const p = planHair( cur, ref, m, 1 );
	ok( p.mode === 'scalar' && p.volume === 1.2 && p.top === 1.25 && p.length === 1.6, JSON.stringify( p ) ); // all at their limits
	ok( p.fringe.shift > 0 );
	const skip = planHair( cur, { topV: null, widthW: null, lengthV: null, hairlineV: null }, m, 1 );
	ok( ! skip.volume && ! skip.top && ! skip.length && ! skip.fringe );
	ok( warpHairPoint( p, 0, 1.78, 0 )[ 1 ] > 0 ); ok( warpHairPoint( p, 0.11, 1.65, 0 )[ 0 ] > 0 ); ok( warpHairPoint( p, 0.1, 1.53, 0 )[ 1 ] < 0 );
	for ( const pt of [ [ 0.2, 1.9, 0.3 ], [ 0.1, 1.5, - 0.1 ], [ 0, 1.7, - 0.2 ] ] ) ok( Math.hypot( ...warpHairPoint( p, ...pt ) ) <= 0.05 + 1e-9 );
	const zero = planHair( cur, ref, m, 0 );
	for ( const pt of [ [ 0.1, 1.65, 0 ], [ 0, 1.78, 0 ] ] ) ok( Math.hypot( ...warpHairPoint( zero, ...pt ) ) < 1e-12 );

} );

// ── real files ──────────────────────────────────────────────────────────────
const dl = path.join( os.homedir(), 'Downloads' );
const vrmPath = process.env.VRM || path.join( dl, '52blendshapes-for-VRoid-face-main', 'VRoid_V110_Male_v1.1.3.vrm' );
const facePath = process.env.FACE || path.join( dl, 'face-model-blendshapes (2).glb' );

console.log( 'face bind (real VRoid male + sample face GLB)' );
if ( ! fs.existsSync( vrmPath ) || ! fs.existsSync( facePath ) ) { skipped ++; console.log( '  - skipped (files not found)' ); } else {

	const vrmBytes = new Uint8Array( fs.readFileSync( vrmPath ) ), faceBytes = new Uint8Array( fs.readFileSync( facePath ) );
	const run = () => bindVRM( vrmBytes, faceBytes );
	const r = run();

	test( 'the sample resolves to 42 semantic names from the file itself', () => {

		const s = readFaceSource( faceBytes );
		eq( s.count, 42 ); eq( s.resolution, 'primitive.extras.targetNames' ); eq( s.names, CONVENTION_42 );

	} );
	test( 'all 42 map onto the VRoid base; the 10 ARKit shapes the source lacks are listed as undriven', () => {

		eq( r.report.mapped, 42 ); eq( r.report.unmapped, [] );
		eq( r.report.undriven, [ 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthPressLeft', 'mouthPressRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthStretchLeft', 'mouthStretchRight' ] );
		ok( r.bind.map.every( m => ARKIT_52.includes( m.name ) && m.targets.length === 1 && m.targets[ 0 ].mesh === 0 ) );

	} );
	test( 'every VRM byte except the JSON bind block is unchanged (BIN identical, rig JSON identical)', () => {

		const a = parseGLB( vrmBytes ), b = parseGLB( r.bytes );
		ok( a.chunks.length === b.chunks.length && a.chunks.every( ( c, i ) => c.type === b.chunks[ i ].type && same( c.data, b.chunks[ i ].data ) ), 'binary chunks differ' );
		const j = JSON.parse( JSON.stringify( b.json ) ); delete j.extensions.STRATA_face_bind; j.extensionsUsed = a.json.extensionsUsed;
		eq( j, a.json );

	} );
	test( 'byte-stable across runs', () => { ok( same( run().bytes, r.bytes ) ); } );
	test( 'the face GLB\'s mesh and texture are not in the output', () => {

		ok( r.bytes.length < vrmBytes.length + 20000, `output grew by ${ r.bytes.length - vrmBytes.length } bytes` );
		ok( ! JSON.stringify( parseGLB( r.bytes ).json ).includes( 'faceMesh' ) );
		ok( ! JSON.stringify( r.bind ).includes( 'skinColor' ) && ! JSON.stringify( r.bind ).includes( 'hairColor' ), 'color hints leaked into the bind block' );

	} );
	// a face GLB carrying the measured proportions, as a photo-made one does
	const photoFace = () => { const j = JSON.parse( JSON.stringify( parseGLB( faceBytes ).json ) ); j.nodes[ 0 ].extras = { ...j.nodes[ 0 ].extras, faceProportions: { eyeSeparationW: 0.43, eyeWidthW: 0.2023, eyeOpenness: 0.3322, mouthWidthW: 0.3706, jawWidthW: 0.8427, jawT: 0.2496, depth: { noseTip: { t: 0.65, dz: 0.182 }, lips: { t: 0.404, dz: 0.09 }, chin: { t: 0, dz: 0.035 } } }, irisColor: { r: 0.2, g: 0.12, b: 0.08 }, browColor: { r: 0.12, g: 0.09, b: 0.07 } }; return writeGLB( { json: j, chunks: parseGLB( faceBytes ).chunks } ); };

	// byte offsets of an accessor's vertex i attribute (tight layout)
	const attrRange = ( json, acc, ids, size = 12 ) => { const x = json.accessors[ acc ], st = ( json.bufferViews[ x.bufferView ].byteOffset || 0 ) + ( x.byteOffset || 0 ); const s = new Set(); for ( const i of ids ) for ( let k = 0; k < size; k ++ ) s.add( st + i * size + k ); return s; };
	const allIds = n => Array.from( { length: n }, ( _, i ) => i );

	test( 'face reshape: only the face POSITION and NORMAL bytes of the face vertices change; skeleton, weights, morph deltas, textures, hair, body are byte-identical', () => {

		const out = bindVRM( vrmBytes, photoFace(), { shape: { strength: 1 } } );
		ok( out.report.shape && out.report.shape.maxMoveMm > 0.5 && out.report.shape.maxMoveMm < 25, 'move ' + ( out.report.shape && out.report.shape.maxMoveMm ) );
		ok( out.report.normals && out.report.normals.updated > 100 && out.report.normals.maxAngleDeg < 70, JSON.stringify( out.report.normals ) );
		const a = parseGLB( vrmBytes ), b = parseGLB( out.bytes );
		const ja = a.json, jb = b.json;
		const prim = ja.meshes[ 0 ].primitives[ 0 ], count = ja.accessors[ prim.attributes.POSITION ].count;
		const allowed = new Set( [ ...attrRange( ja, prim.attributes.POSITION, allIds( count ) ), ...attrRange( ja, prim.attributes.NORMAL, allIds( count ) ) ] );
		let outside = 0, inside = 0;
		a.chunks[ 0 ].data.forEach( ( v, i ) => { if ( v !== b.chunks[ 0 ].data[ i ] ) { if ( allowed.has( i ) ) inside ++; else outside ++; } } );
		ok( outside === 0, outside + ' bytes outside the face POSITION / NORMAL data changed' ); ok( inside > 1000, 'positions barely changed: ' + inside );
		// morph target accessors (and their normal deltas) are untouched
		ok( ja.meshes[ 0 ].primitives[ 0 ].targets.length === 122 && JSON.stringify( ja.meshes[ 0 ].primitives[ 0 ].targets ) === JSON.stringify( jb.meshes[ 0 ].primitives[ 0 ].targets ) );
		const nb = jb.accessors[ prim.attributes.POSITION ]; ok( nb.min.every( ( v, i ) => v <= nb.max[ i ] ) );

	} );
	test( 'face reshape: normals follow the surface (not stale, not recomputed flat): unit length, seams kept, and their change matches the true change of the geometry', () => {

		const out = bindVRM( vrmBytes, photoFace(), { shape: { strength: 1 } } );
		const A = parseGLB( vrmBytes ), B = parseGLB( out.bytes ), j = A.json;
		const read = ( c, acc, n ) => { const x = j.accessors[ acc ], st = ( j.bufferViews[ x.bufferView ].byteOffset || 0 ) + ( x.byteOffset || 0 ), dv = new DataView( c.data.buffer, c.data.byteOffset + st ); return Array.from( { length: x.count * n }, ( _, i ) => dv.getFloat32( i * 4, true ) ); };
		const mesh = j.meshes[ 0 ], pAcc = mesh.primitives[ 0 ].attributes.POSITION, nAcc = mesh.primitives[ 0 ].attributes.NORMAL;
		const P0 = read( A.chunks[ 0 ], pAcc, 3 ), P1 = read( B.chunks[ 0 ], pAcc, 3 ), N0 = read( A.chunks[ 0 ], nAcc, 3 ), N1 = read( B.chunks[ 0 ], nAcc, 3 );
		const nv = P0.length / 3;
		// geometric normals from the triangles (area weighted), before and after
		const idxOf = p => { const x = j.accessors[ p.indices ], bv = j.bufferViews[ x.bufferView ], dv = new DataView( A.chunks[ 0 ].data.buffer, A.chunks[ 0 ].data.byteOffset + ( bv.byteOffset || 0 ) + ( x.byteOffset || 0 ) ); const sz = x.componentType === 5125 ? 4 : 2; return Array.from( { length: x.count }, ( _, i ) => sz === 4 ? dv.getUint32( i * 4, true ) : dv.getUint16( i * 2, true ) ); };
		const geo = P => { const N = new Float64Array( nv * 3 ); for ( const p of mesh.primitives ) { const ix = idxOf( p ); for ( let t = 0; t < ix.length; t += 3 ) { const [ a, b, c ] = [ ix[ t ], ix[ t + 1 ], ix[ t + 2 ] ]; const u = [ 0, 1, 2 ].map( k => P[ b * 3 + k ] - P[ a * 3 + k ] ), w = [ 0, 1, 2 ].map( k => P[ c * 3 + k ] - P[ a * 3 + k ] ); const n = [ u[ 1 ] * w[ 2 ] - u[ 2 ] * w[ 1 ], u[ 2 ] * w[ 0 ] - u[ 0 ] * w[ 2 ], u[ 0 ] * w[ 1 ] - u[ 1 ] * w[ 0 ] ]; for ( const v of [ a, b, c ] ) for ( let k = 0; k < 3; k ++ ) N[ v * 3 + k ] += n[ k ]; } } return N; };
		const G0 = geo( P0 ), G1 = geo( P1 );
		const norm = ( A, i ) => { const l = Math.hypot( A[ i * 3 ], A[ i * 3 + 1 ], A[ i * 3 + 2 ] ) || 1; return [ A[ i * 3 ] / l, A[ i * 3 + 1 ] / l, A[ i * 3 + 2 ] / l ]; };
		let n = 0, cosSum = 0, unitBad = 0, unmovedChanged = 0, unmoved = 0, staleBetter = 0;
		for ( let i = 0; i < nv; i ++ ) {

			const l1 = Math.hypot( N1[ i * 3 ], N1[ i * 3 + 1 ], N1[ i * 3 + 2 ] ); if ( Math.abs( l1 - 1 ) > 1e-3 ) unitBad ++;
			if ( P0[ i * 3 ] === P1[ i * 3 ] && P0[ i * 3 + 1 ] === P1[ i * 3 + 1 ] && P0[ i * 3 + 2 ] === P1[ i * 3 + 2 ] ) { unmoved ++; if ( N0[ i * 3 ] !== N1[ i * 3 ] || N0[ i * 3 + 1 ] !== N1[ i * 3 + 1 ] || N0[ i * 3 + 2 ] !== N1[ i * 3 + 2 ] ) unmovedChanged ++; }
			const g0 = norm( G0, i ), g1 = norm( G1, i );
			const dTrue = [ 0, 1, 2 ].map( k => g1[ k ] - g0[ k ] ), dOurs = [ 0, 1, 2 ].map( k => N1[ i * 3 + k ] - N0[ i * 3 + k ] );
			const lt = Math.hypot( ...dTrue ), lo = Math.hypot( ...dOurs );
			if ( lt > 0.06 && lo > 0.003 ) { n ++; cosSum += ( dTrue[ 0 ] * dOurs[ 0 ] + dTrue[ 1 ] * dOurs[ 1 ] + dTrue[ 2 ] * dOurs[ 2 ] ) / ( lt * lo ); }
			else if ( lt > 0.15 && lo <= 0.003 ) staleBetter ++;

		}
		ok( unitBad === 0, unitBad + ' normals are not unit length' );
		ok( unmoved > 0 && unmovedChanged <= unmoved * 0.03, `a vertex that did not move keeps its exact normal (a few at the very edge of the warp may tilt): ${ unmovedChanged } of ${ unmoved } changed` );
		ok( n > 50 && cosSum / n > 0.5, `the change of the normals must match the true change of the surface: mean cosine ${ ( cosSum / n ).toFixed( 2 ) } over ${ n }` );
		ok( staleBetter < n * 0.5, `too many warped vertices kept a stale normal: ${ staleBetter } vs ${ n } updated` );

	} );
	test( 'face reshape: strength 0 leaves the binary chunk identical; same inputs give the same bytes', () => {

		const none = bindVRM( vrmBytes, photoFace(), { shape: { strength: 0 } } );
		ok( same( parseGLB( none.bytes ).chunks[ 0 ].data, parseGLB( vrmBytes ).chunks[ 0 ].data ) );
		ok( same( bindVRM( vrmBytes, photoFace(), { shape: { strength: 0.7 } } ).bytes, bindVRM( vrmBytes, photoFace(), { shape: { strength: 0.7 } } ).bytes ) );

	} );
	test( 'face reshape is skipped, with a warning, when the face GLB has no measured proportions', () => {

		const r = bindVRM( vrmBytes, faceBytes, { shape: { strength: 1 } } );
		ok( r.report.shape === null && r.report.warnings.some( w => /no measured proportions/.test( w ) ) );
		ok( same( parseGLB( r.bytes ).chunks[ 0 ].data, parseGLB( vrmBytes ).chunks[ 0 ].data ) );

	} );
	test( 'iris and brow colors tint the VRM eye and brow materials (and the shade color follows)', () => {

		const j = parseGLB( vrmBytes ).json;
		const idx = ( re ) => j.materials.findIndex( m => re.test( m.name ) );
		const means = { [ idx( /_EyeIris_/ ) ]: [ 200, 160, 120 ], [ idx( /_FaceBrow_/ ) ]: [ 180, 170, 160 ] };
		const r = bindVRM( vrmBytes, photoFace(), { look: { iris: true, brow: true, strength: 1, textureMeans: means } } );
		eq( r.report.look.applied.map( a => a.role ), [ 'iris', 'brow' ] );
		const o = parseGLB( r.bytes ).json;
		ok( o.materials[ idx( /_EyeIris_/ ) ].pbrMetallicRoughness.baseColorFactor[ 0 ] < 1 );

	} );
	test( 'proportions from landmarks match the reference measured on the sample, and survive a turned / tilted head', () => {

		const { json, chunks } = parseGLB( faceBytes );
		const a = json.accessors[ json.meshes[ 0 ].primitives[ 0 ].attributes.POSITION ], bv = json.bufferViews[ a.bufferView ];
		const dv = new DataView( chunks[ 0 ].data.buffer, chunks[ 0 ].data.byteOffset + ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 ) );
		const raw = Array.from( { length: a.count }, ( _, i ) => [ dv.getFloat32( i * 12, true ), dv.getFloat32( i * 12 + 4, true ), dv.getFloat32( i * 12 + 8, true ) ] );
		const toLm = ( rot = 0, tilt = 0 ) => raw.map( ( [ x, y, z ] ) => {

			const c = Math.cos( rot ), s = Math.sin( rot ), x2 = x * c + z * s, z2 = - x * s + z * c; // yaw
			const ct = Math.cos( tilt ), st = Math.sin( tilt );
			return { x: ( x2 * ct - y * st ) * 0.25 + 0.5, y: - ( x2 * st + y * ct ) * 0.25 + 0.5, z: - z2 * 0.25 };

		} );
		const base = faceProportions( toLm(), { width: 1000, height: 1000 } );
		near( base.eyeSeparationW, 0.43, 0.01 ); near( base.eyeWidthW, 0.2023, 0.01 ); near( base.mouthWidthW, 0.3706, 0.01 ); near( base.jawWidthW, 0.8427, 0.02 );
		const turned = faceProportions( toLm( 0.25, 0.2 ), { width: 1000, height: 1000 } );
		near( turned.eyeSeparationW, base.eyeSeparationW, 0.02 ); near( turned.mouthWidthW, base.mouthWidthW, 0.02 );
		ok( faceProportions( toLm( 1.0 ), { width: 1000, height: 1000 } ).depth === null, 'a profile view should not report depth' );
		eq( faceProportions( [], { width: 1, height: 1 } ), null );

	} );
	test( 'hair reshape: only the hair vertices move (the body sharing an accessor with the back hair does not), everything else is byte-identical', () => {

		const j = JSON.parse( JSON.stringify( parseGLB( faceBytes ).json ) );
		j.nodes[ 0 ].extras = { ...j.nodes[ 0 ].extras, hairColor: { r: 0.1, g: 0.1, b: 0.1 }, hairCoverage: 0.5, hairShape: { topV: 1.9, widthW: 1.4, lengthV: - 1.6, hairlineV: 0.8, cropped: { top: false, side: false, bottom: false } } };
		const face = writeGLB( { json: j, chunks: parseGLB( faceBytes ).chunks } );
		const out = bindVRM( vrmBytes, face, { hairShape: { strength: 1 } } );
		ok( out.report.hairShape && out.report.hairShape.maxMoveMm > 2 && out.report.hairShape.maxMoveMm <= 50, 'move ' + ( out.report.hairShape && out.report.hairShape.maxMoveMm ) );
		ok( out.report.shape === null, 'the face must not move when only the hair is asked for' );
		const a = parseGLB( vrmBytes ), b = parseGLB( out.bytes ), ja = a.json;
		// the vertices that belong to the hair
		const hairVerts = new Map();
		const readIdx = acc => { const x = ja.accessors[ acc ], bv = ja.bufferViews[ x.bufferView ], dv = new DataView( a.chunks[ 0 ].data.buffer, a.chunks[ 0 ].data.byteOffset + ( bv.byteOffset || 0 ) + ( x.byteOffset || 0 ) ); return Array.from( { length: x.count }, ( _, i ) => x.componentType === 5125 ? dv.getUint32( i * 4, true ) : dv.getUint16( i * 2, true ) ); };
		ja.meshes.forEach( m => m.primitives.forEach( p => { if ( /_HAIR$/.test( ja.materials[ p.material ].name ) ) { const s = hairVerts.get( p.attributes.POSITION ) || new Set(); readIdx( p.indices ).forEach( i => s.add( i ) ); hairVerts.set( p.attributes.POSITION, s ); } } ) );
		const allowed = new Set();
		const normalOf = new Map(); ja.meshes.forEach( m => m.primitives.forEach( p => { if ( /_HAIR$/.test( ja.materials[ p.material ].name ) ) normalOf.set( p.attributes.POSITION, p.attributes.NORMAL ); } ) );
		for ( const [ acc, ids ] of hairVerts ) { for ( const s of [ attrRange( ja, acc, ids ), attrRange( ja, normalOf.get( acc ), ids ) ] ) for ( const o of s ) allowed.add( o ); }
		let outside = 0, inside = 0;
		a.chunks[ 0 ].data.forEach( ( v, i ) => { if ( v !== b.chunks[ 0 ].data[ i ] ) allowed.has( i ) ? inside ++ : outside ++; } );
		ok( outside === 0, outside + ' bytes outside the hair vertices changed' ); ok( inside > 1000, 'hair barely moved: ' + inside );
		ok( hairVerts.size >= 2, 'expected hair in more than one accessor (front hair + the back hair on the body mesh)' );

	} );
	test( 'hair silhouette on the real VRM: the hair moves toward the photo silhouette, measured again on the output', () => {

		const base = bindVRM( vrmBytes, faceBytes, { hairShape: { strength: 0, reference: { profile: null, topV: 1, widthW: 1, lengthV: -1, hairlineV: 0.5 } } } );
		const cur = base.report.hairShape.vrmBefore.profile;
		const ref = { halfR: cur.halfR.map( v => v === null ? null : v * 1.15 ), halfL: cur.halfL.slice(), topByU: cur.topByU.map( v => v === null ? null : v * 1.15 ), lineByU: cur.lineByU.slice(), };
		const refShape = { topV: null, widthW: null, lengthV: null, hairlineV: null, profile: ref };
		const out = bindVRM( vrmBytes, faceBytes, { hairShape: { strength: 1, reference: refShape } } );
		ok( out.report.hairShape.applied.mode === 'silhouette' && out.report.hairShape.maxMoveMm > 1 && out.report.hairShape.maxMoveMm <= 50, JSON.stringify( out.report.hairShape.applied ).slice( 0, 160 ) );
		const after = bindVRM( out.bytes, faceBytes, { hairShape: { strength: 0, reference: refShape } } ).report.hairShape.vrmBefore.profile;
		const err = p => p.halfR.reduce( ( s, v, i ) => v !== null && ref.halfR[ i ] !== null ? s + Math.abs( v - ref.halfR[ i ] ) : s, 0 );
		ok( err( after ) < err( cur ) * 0.7, `the right-side reach did not move toward the reference: ${ err( cur ).toFixed( 3 ) } -> ${ err( after ).toFixed( 3 ) }` );
		// the side that was meant to stay put moves far less than the side that was meant to move
		const moved = ( a, b, side ) => a[ side ].reduce( ( s, v, i ) => v !== null && b[ side ][ i ] !== null ? s + Math.abs( v - b[ side ][ i ] ) : s, 0 );
		ok( moved( after, cur, 'halfL' ) < 0.6 * moved( after, cur, 'halfR' ), `left moved ${ moved( after, cur, 'halfL' ).toFixed( 3 ) }, right ${ moved( after, cur, 'halfR' ).toFixed( 3 ) }` );

	} );
	test( 'hair reshape is skipped, with a warning, when the photo crops the hair on every side or has no hair data', () => {

		const none = bindVRM( vrmBytes, faceBytes, { hairShape: { strength: 1 } } );
		ok( none.report.hairShape === null && none.report.warnings.some( w => /no hair measurements/.test( w ) ) );
		const j = JSON.parse( JSON.stringify( parseGLB( faceBytes ).json ) );
		j.nodes[ 0 ].extras = { ...j.nodes[ 0 ].extras, hairShape: { topV: null, widthW: null, lengthV: null, hairlineV: null, cropped: { top: true, side: true, bottom: true } } };
		const cropped = bindVRM( vrmBytes, writeGLB( { json: j, chunks: parseGLB( faceBytes ).chunks } ), { hairShape: { strength: 1 } } );
		ok( cropped.report.hairShape === null && cropped.report.warnings.some( w => /crops the hair on every side/.test( w ) ) );
		ok( same( parseGLB( cropped.bytes ).chunks[ 0 ].data, parseGLB( vrmBytes ).chunks[ 0 ].data ) );

	} );
	test( 'the real sample with its semantic names removed binds 42 of 42 as `convention`, with the warning; a shuffled copy does not', () => {

		const g = parseGLB( faceBytes ), j = JSON.parse( JSON.stringify( g.json ) );
		j.meshes[ 0 ].primitives.forEach( p => { delete p.extras; } );
		const stripped = writeGLB( { json: j, chunks: g.chunks } );
		const r = bindVRM( vrmBytes, stripped );
		eq( r.report.mapped, 42 ); eq( r.bind.source.nameResolution, 'convention' ); ok( r.bind.warnings.length === 1 && r.report.warnings.length >= 1 );
		const shuffled = JSON.parse( JSON.stringify( j ) ); shuffled.nodes[ 0 ].name = 'someHead';
		const bad = bindVRM( vrmBytes, writeGLB( { json: shuffled, chunks: g.chunks } ) );
		eq( bad.report.mapped, 0 ); eq( bad.bind.source.nameResolution, 'unresolved' );

	} );
	test( 'a bound VRM can be re-bound (bind block replaced, not duplicated)', () => {

		const again = bindVRM( r.bytes, faceBytes ).bytes;
		ok( same( again, r.bytes ) );

	} );

}

console.log( `${ passed } passed, ${ failed } failed${ skipped ? `, ${ skipped } skipped` : '' }` );
process.exit( failed ? 1 : 0 );
