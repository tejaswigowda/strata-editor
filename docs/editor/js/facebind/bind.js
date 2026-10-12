// Bind a face-blendshape GLB's morphs to a base VRM's expression blendshapes.
//
//   bindVRM( vrmBytes, faceBytes, opts? ) -> { bytes, bind, report }
//
// Rig-safe by construction: the VRM's meshes, skeleton, skin weights, morph deltas and BIN chunk are
// never touched. The only things written are
//   · an `extensions.STRATA_face_bind` block (a weight map: face morph -> the VRM's own morph targets), and
//   · optionally, a tint on the VRM's skin material(s) (a material change, off by default).
// A face morph with no matching VRM target is skipped and listed; nothing is synthesised from geometry.
// The face mesh is never copied into the VRM. This is expression binding, not a likeness: the VRM's
// face shape is unchanged.
//
// Pure and deterministic (no clock, no randomness, no network): same inputs + options -> same bytes.

import { parseGLB, writeGLB, GLBError } from './glb.js';
import { readFaceSource } from './faceSource.js';
import { retintSkin, linearToSrgb } from '../face/FaceRefine.js';

export const BIND_EXTENSION = 'STRATA_face_bind';
export const SCOPE = 'expression-bound; not a likeness; face shape unchanged';

export const ARKIT_52 = [
	'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
	'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
	'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
	'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
	'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
	'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
	'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];
const ARKIT_BY_LOWER = new Map( ARKIT_52.map( n => [ n.toLowerCase(), n ] ) );

export class BindError extends GLBError {}

const isVRM = json => !! ( json.extensions && ( json.extensions.VRM || json.extensions.VRMC_vrm ) );

// every morph target of the VRM, by name: name -> [{ mesh, morph, name }]
function vrmMorphIndex( json ) {

	const byName = new Map();
	( json.meshes || [] ).forEach( ( mesh, mi ) => {

		const prim = ( mesh.primitives || [] ).find( p => p.targets && p.targets.length );
		if ( ! prim ) return;
		const names = ( mesh.extras && mesh.extras.targetNames ) || ( prim.extras && prim.extras.targetNames );
		if ( ! Array.isArray( names ) ) return;
		names.forEach( ( name, morph ) => {

			if ( morph >= prim.targets.length ) return;
			if ( ! byName.has( name ) ) byName.set( name, [] );
			byName.get( name ).push( { mesh: mi, morph, name } );

		} );

	} );
	return byName;

}

/** Build the weight map. Exported for tests and for tools that only want the map. */
export function buildBinding( source, vrmJson ) {

	if ( ! isVRM( vrmJson ) ) throw new BindError( 'NOT_VRM', 'the base is not a VRM (no VRM / VRMC_vrm extension)' );
	const byName = vrmMorphIndex( vrmJson );
	if ( ! byName.size ) throw new BindError( 'VRM_NO_MORPHS', 'the base VRM has no named morph targets to bind to' );
	const byLower = new Map( [ ...byName.keys() ].map( n => [ n.toLowerCase(), n ] ) );

	const map = [], unmapped = [];
	source.names.forEach( ( raw, source_ ) => {

		if ( raw === null ) { unmapped.push( { source: source_, name: null, reason: 'unnamed morph (index only)' } ); return; }
		const semantic = ARKIT_BY_LOWER.get( raw.toLowerCase() ) || raw;
		const vrmName = byName.has( semantic ) ? semantic : byLower.get( semantic.toLowerCase() );
		if ( ! vrmName ) { unmapped.push( { source: source_, name: semantic, reason: 'the VRM has no morph target with this name' } ); return; }
		map.push( { source: source_, name: semantic, targets: byName.get( vrmName ).map( ( { mesh, morph, name } ) => ( { mesh, morph, name } ) ), weight: 1 } );

	} );

	const driven = new Set( map.flatMap( m => m.targets.map( t => t.name ) ) );
	const undriven = ARKIT_52.filter( n => byName.has( n ) && ! driven.has( n ) );

	return {
		version: 1,
		scope: SCOPE,
		source: { morphCount: source.count, nameResolution: source.resolution, names: source.names },
		map,
		unmapped,
		undriven,
	};

}

// ── optional look transfer ──────────────────────────────────────────────────

function skinMaterialIndices( json ) {

	return ( json.materials || [] ).map( ( m, i ) => [ m, i ] ).filter( ( [ m ] ) => /_SKIN$/.test( m.name || '' ) && m.pbrMetallicRoughness ).map( ( [ , i ] ) => i );

}

/** glTF image bytes of the first skin material's base-colour texture, so a caller can decode it (on device) and pass its mean back as opts.tint.vrmSkinTextureRGB. */
export function skinTextureOf( input ) {

	const { json, chunks } = parseGLB( input );
	const bin = chunks.find( c => c.type === 0x004e4942 );
	for ( const mi of skinMaterialIndices( json ) ) {

		const tex = json.materials[ mi ].pbrMetallicRoughness.baseColorTexture;
		const img = tex && json.images && json.images[ ( json.textures[ tex.index ] || {} ).source ];
		if ( ! img || img.bufferView === undefined || ! bin ) continue;
		const bv = json.bufferViews[ img.bufferView ];
		return { bytes: bin.data.subarray( bv.byteOffset || 0, ( bv.byteOffset || 0 ) + bv.byteLength ), mime: img.mimeType };

	}
	return null;

}

function applyTint( json, source, tint, report ) {

	if ( ! source.skinColor ) { report.warnings.push( 'Skin tint skipped: the face GLB has no skin-colour hint.' ); return; }
	if ( ! tint.vrmSkinTextureRGB ) { report.warnings.push( 'Skin tint skipped: the VRM skin texture mean was not supplied.' ); return; }
	const strength = tint.strength === undefined ? 0.5 : tint.strength;
	const target = [ source.skinColor.r, source.skinColor.g, source.skinColor.b ].map( v => v * 255 );
	const changed = [];

	for ( const mi of skinMaterialIndices( json ) ) {

		const pbr = json.materials[ mi ].pbrMetallicRoughness;
		const old = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
		const lin = retintSkin( tint.vrmSkinTextureRGB, old.slice( 0, 3 ), target, strength ).map( v => +v.toFixed( 5 ) );
		pbr.baseColorFactor = [ lin[ 0 ], lin[ 1 ], lin[ 2 ], old[ 3 ] === undefined ? 1 : old[ 3 ] ];
		// VRM 0.x keeps the same colour in sRGB under materialProperties[_].vectorProperties._Color
		const props = json.extensions.VRM && json.extensions.VRM.materialProperties && json.extensions.VRM.materialProperties[ mi ];
		if ( props && props.vectorProperties && props.vectorProperties._Color ) {

			const c = props.vectorProperties._Color;
			props.vectorProperties._Color = [ ...lin.map( v => +( linearToSrgb( v ) / 255 ).toFixed( 5 ) ), c[ 3 ] === undefined ? 1 : c[ 3 ] ];

		}
		changed.push( json.materials[ mi ].name );

	}
	report.tint = { approximate: true, strength, materials: changed };

}

// ── rig-safety audit ────────────────────────────────────────────────────────

function diffPaths( a, b, path = '', out = [] ) {

	if ( a === b ) return out;
	if ( a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray( a ) !== Array.isArray( b ) ) { out.push( path ); return out; }
	for ( const k of new Set( [ ...Object.keys( a ), ...Object.keys( b ) ] ) ) diffPaths( a[ k ], b[ k ], `${ path }/${ k }`, out );
	return out;

}

const ALLOWED_CHANGE = [
	/^\/extensions\/STRATA_face_bind($|\/)/,
	/^\/extensionsUsed($|\/)/,
	/^\/materials\/\d+\/pbrMetallicRoughness\/baseColorFactor($|\/)/,
	/^\/extensions\/VRM\/materialProperties\/\d+\/vectorProperties\/_Color($|\/)/,
];

/** Throws unless the only differences are the bind block, extensionsUsed and skin colours. */
export function assertRigSafe( before, after ) {

	const bad = diffPaths( before, after ).filter( p => ! ALLOWED_CHANGE.some( re => re.test( p ) ) );
	if ( bad.length ) throw new BindError( 'RIG_UNSAFE', `refusing to write: the bind would change ${ bad.slice( 0, 5 ).join( ', ' ) }` );

}

/**
 * @param {ArrayBuffer|Uint8Array} vrmInput base VRM bytes
 * @param {ArrayBuffer|Uint8Array} faceInput LOCAL face-blendshape GLB bytes (never a URL)
 * @param {{ names?: string[], tint?: { vrmSkinTextureRGB?: number[], strength?: number } }} [opts]
 */
export function bindVRM( vrmInput, faceInput, opts = {} ) {

	const vrm = parseGLB( vrmInput );
	const before = JSON.parse( JSON.stringify( vrm.json ) );
	const source = readFaceSource( faceInput, { names: opts.names } );

	const bind = buildBinding( source, vrm.json );
	const report = {
		scope: SCOPE,
		sourceMorphs: source.count,
		nameResolution: source.resolution,
		mapped: bind.map.length,
		unmapped: bind.unmapped,
		undriven: bind.undriven,
		warnings: [ ...source.warnings ],
		tint: null,
		egress: 'none: the face GLB was read from local bytes only; nothing derived from it left this process',
	};

	vrm.json.extensions[ BIND_EXTENSION ] = bind;
	vrm.json.extensionsUsed = [ ...new Set( [ ...( vrm.json.extensionsUsed || [] ), BIND_EXTENSION ] ) ];
	if ( opts.tint ) applyTint( vrm.json, source, opts.tint, report );

	assertRigSafe( before, vrm.json );
	return { bytes: writeGLB( vrm ), bind, report };

}
