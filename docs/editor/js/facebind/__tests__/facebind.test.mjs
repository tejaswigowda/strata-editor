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
import { applyFaceWeights } from '../runtime.js';

let passed = 0, failed = 0, skipped = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };
const eq = ( a, b, m ) => { if ( JSON.stringify( a ) !== JSON.stringify( b ) ) throw new Error( ( m || 'not equal' ) + `: ${ JSON.stringify( a ) } vs ${ JSON.stringify( b ) }` ); };
const throws = ( fn, code ) => { try { fn(); } catch ( e ) { if ( code && e.code !== code ) throw new Error( `expected ${ code }, got ${ e.code }: ${ e.message }` ); return; } throw new Error( 'expected a throw' ); };
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

test( 'index-named morphs: 42 use the documented convention (flagged); other counts are unresolved and map nothing', () => {

	const idx = n => Array.from( { length: n }, ( _, i ) => String( i ) );
	const s42 = readFaceSource( glb( faceJson( idx( 42 ) ) ) );
	eq( s42.names, CONVENTION_42 ); ok( s42.resolution.startsWith( 'convention' ) && s42.warnings.length );
	const s5 = readFaceSource( glb( faceJson( idx( 5 ) ) ) );
	ok( s5.resolution === 'unresolved' && s5.names.every( n => n === null ) );
	const r = bindVRM( glb( vrmJson() ), glb( faceJson( idx( 5 ) ) ) );
	eq( r.bind.map, [] ); eq( r.bind.unmapped.length, 5 );

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

test( 'optional tint changes only skin colours, and says it is approximate', () => {

	const base = glb( vrmJson() );
	const r = bindVRM( base, glb( faceJson( [ 'jawOpen' ] ) ), { tint: { vrmSkinTextureRGB: [ 250, 232, 219 ], strength: 1 } } );
	ok( r.report.tint && r.report.tint.approximate );
	const j = parseGLB( r.bytes ).json;
	ok( j.materials[ 0 ].pbrMetallicRoughness.baseColorFactor[ 0 ] < 1, 'tint not applied' );
	ok( j.extensions.VRM.materialProperties[ 0 ].vectorProperties._Color[ 0 ] < 1, 'VRM0 _Color not applied' );
	const noMean = bindVRM( base, glb( faceJson( [ 'jawOpen' ] ) ), { tint: {} } );
	ok( noMean.report.tint === null && noMean.report.warnings.some( w => /skipped/.test( w ) ) );

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

test( 'zero-egress by construction: the bind modules have no network, storage or dynamic-import access', () => {

	const dir = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
	for ( const f of [ 'glb.js', 'faceSource.js', 'bind.js', 'runtime.js' ] ) {

		const src = fs.readFileSync( path.join( dir, f ), 'utf8' ).replace( /\/\/.*$/gm, '' );
		ok( ! /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|localStorage|indexedDB|importScripts)\b|import\s*\(/.test( src ), `${ f } references a network/storage API` );

	}

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
		ok( ! JSON.stringify( r.bind ).includes( 'skinColor' ), 'tint hint leaked without opting in' );

	} );
	test( 'a bound VRM can be re-bound (bind block replaced, not duplicated)', () => {

		const again = bindVRM( r.bytes, faceBytes ).bytes;
		ok( same( again, r.bytes ) );

	} );

}

console.log( `${ passed } passed, ${ failed } failed${ skipped ? `, ${ skipped } skipped` : '' }` );
process.exit( failed ? 1 : 0 );
