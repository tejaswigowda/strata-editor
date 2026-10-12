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
import { applyFaceWeights } from '../runtime.js';

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

test( 'optional look: skin and hair tint change only material colours (base + shade), and say they are approximate', () => {

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
	ok( out.extensions.VRM.materialProperties[ 1 ].vectorProperties._ShadeColor[ 0 ] < 0.8, 'hair shade colour did not follow' );
	ok( r.report.look.applied.every( a => a.reached ) );
	// a hair colour lighter than the texture cannot be reached by a tint: it is reported, not faked
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

test( 'zero-egress by construction: the bind modules have no network, storage or dynamic-import access', () => {

	const dir = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
	for ( const f of [ 'glb.js', 'faceSource.js', 'bind.js', 'runtime.js' ] ) {

		const src = fs.readFileSync( path.join( dir, f ), 'utf8' ).replace( /\/\/.*$/gm, '' );
		ok( ! /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|localStorage|indexedDB|importScripts)\b|import\s*\(/.test( src ), `${ f } references a network/storage API` );

	}

} );

test( 'hair colour: reads the masked pixels, ignores highlights, shadows and the mask edge', () => {

	const w = 20, h = 20, rgba = new Uint8ClampedArray( w * h * 4 ), mask = new Uint8Array( w * h );
	for ( let i = 0; i < w * h; i ++ ) { rgba.set( [ 240, 240, 240, 255 ], i * 4 ); } // white background
	for ( let y = 4; y < 16; y ++ ) for ( let x = 4; x < 16; x ++ ) { const i = y * w + x; mask[ i ] = 1; rgba.set( [ 60, 40, 30, 255 ], i * 4 ); }
	rgba.set( [ 255, 255, 255, 255 ], ( 8 * w + 8 ) * 4 ); // a specular highlight inside the hair
	const r = hairColorFromMask( rgba, mask, { width: w, height: h, faceArea: 100 } );
	ok( Math.abs( r.color.r * 255 - 60 ) < 3 && Math.abs( r.color.g * 255 - 40 ) < 3 && Math.abs( r.color.b * 255 - 30 ) < 3, 'colour ' + JSON.stringify( r.color ) );
	ok( r.pixels === 100 && r.coverage === 1, 'pixels/coverage ' + r.pixels );
	eq( hairColorFromMask( rgba, new Uint8Array( w * h ), { width: w, height: h } ), null );

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
		ok( ! JSON.stringify( r.bind ).includes( 'skinColor' ) && ! JSON.stringify( r.bind ).includes( 'hairColor' ), 'colour hints leaked into the bind block' );

	} );
	// a face GLB carrying the measured proportions, as a photo-made one does
	const photoFace = () => { const j = JSON.parse( JSON.stringify( parseGLB( faceBytes ).json ) ); j.nodes[ 0 ].extras = { ...j.nodes[ 0 ].extras, faceProportions: { eyeSeparationW: 0.43, eyeWidthW: 0.2023, eyeOpenness: 0.3322, mouthWidthW: 0.3706, jawWidthW: 0.8427, jawT: 0.2496, depth: { noseTip: { t: 0.65, dz: 0.182 }, lips: { t: 0.404, dz: 0.09 }, chin: { t: 0, dz: 0.035 } } }, irisColor: { r: 0.2, g: 0.12, b: 0.08 }, browColor: { r: 0.12, g: 0.09, b: 0.07 } }; return writeGLB( { json: j, chunks: parseGLB( faceBytes ).chunks } ); };

	test( 'face reshape: only the face POSITION bytes change; skeleton, weights, morph deltas, textures, hair are byte-identical', () => {

		const out = bindVRM( vrmBytes, photoFace(), { shape: { strength: 1 } } );
		ok( out.report.shape && out.report.shape.maxMoveMm > 0.5 && out.report.shape.maxMoveMm < 25, 'move ' + ( out.report.shape && out.report.shape.maxMoveMm ) );
		const a = parseGLB( vrmBytes ), b = parseGLB( out.bytes );
		const ja = a.json, jb = b.json;
		const posAcc = new Set( ja.meshes[ 0 ].primitives.map( p => p.attributes.POSITION ) );
		ok( posAcc.size === 1 );
		const pa = ja.accessors[ [ ...posAcc ][ 0 ] ];
		const start = ( ja.bufferViews[ pa.bufferView ].byteOffset || 0 ) + ( pa.byteOffset || 0 );
		let outside = 0, inside = 0;
		a.chunks[ 0 ].data.forEach( ( v, i ) => { if ( v !== b.chunks[ 0 ].data[ i ] ) { if ( i >= start && i < start + pa.count * 12 ) inside ++; else outside ++; } } );
		ok( outside === 0, outside + ' bytes outside the POSITION data changed' ); ok( inside > 1000, 'positions barely changed: ' + inside );
		// morph target accessors are untouched
		ok( ja.meshes[ 0 ].primitives[ 0 ].targets.length === 122 && JSON.stringify( ja.meshes[ 0 ].primitives[ 0 ].targets ) === JSON.stringify( jb.meshes[ 0 ].primitives[ 0 ].targets ) );
		// bounds updated, valid
		const nb = jb.accessors[ [ ...posAcc ][ 0 ] ]; ok( nb.min.every( ( v, i ) => v <= nb.max[ i ] ) );

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
	test( 'iris and brow colours tint the VRM eye and brow materials (and the shade colour follows)', () => {

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
	test( 'a bound VRM can be re-bound (bind block replaced, not duplicated)', () => {

		const again = bindVRM( r.bytes, faceBytes ).bytes;
		ok( same( again, r.bytes ) );

	} );

}

console.log( `${ passed } passed, ${ failed } failed${ skipped ? `, ${ skipped } skipped` : '' }` );
process.exit( failed ? 1 : 0 );
