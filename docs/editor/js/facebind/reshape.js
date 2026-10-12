// Reshape a VRoid-style VRM toward measurements taken from a photo, by editing base POSITION data in the
// file's binary chunk:
//   · face: eyes, mouth, jaw and the nose / lips / chin profile (FaceRefine.js)
//   · hair: volume, height, length and fringe of the existing hairstyle (hairShape.js)
//
// What is touched: the POSITION accessors of the face and hair primitives (only the face's and the hair's
// own vertices; the body vertices that share an accessor with the back hair are left alone), plus those
// accessors' min/max. What is not: indices, UVs, normals, the 100+ morph targets (deltas, so every
// existing blendshape keeps working on the new base), skeleton, skin weights, textures, body.
// bindVRM() audits that, byte for byte, before it writes anything.

import { measureFace, planFaceRefine, warpPoint } from '../face/FaceRefine.js';
import { measureHair, planHair, warpHairPoint, summarizePlan } from './hairShape.js';
import { GLBError } from './glb.js';

const FACE_MATERIAL = /_(FaceMouth|EyeIris|EyeHighlight|EyeWhite|FaceBrow|FaceEyelash|FaceEyeline|Face)_\d+_(FACE|EYE|SKIN)/;
const HAIR_MATERIAL = /_HAIR$/;
const PARTS = [ [ 'iris', /_EyeIris_/ ], [ 'white', /_EyeWhite_/ ], [ 'mouth', /_FaceMouth_/ ], [ 'skin', /_Face_\d+_SKIN/ ] ];
const BIN = 0x004e4942;

function viewOf( json, accessorIndex ) {

	const a = json.accessors[ accessorIndex ];
	const bv = json.bufferViews[ a.bufferView ];
	return { a, bv, start: ( bv.byteOffset || 0 ) + ( a.byteOffset || 0 ) };

}

function readIndices( json, bin, accessorIndex ) {

	const { a, start } = viewOf( json, accessorIndex );
	const size = { 5121: 1, 5123: 2, 5125: 4 }[ a.componentType ];
	if ( ! size ) throw new GLBError( 'UNSUPPORTED', 'unsupported index type' );
	const dv = new DataView( bin.data.buffer, bin.data.byteOffset + start, a.count * size );
	const out = new Uint32Array( a.count );
	for ( let i = 0; i < a.count; i ++ ) out[ i ] = size === 2 ? dv.getUint16( i * 2, true ) : size === 4 ? dv.getUint32( i * 4, true ) : dv.getUint8( i );
	return out;

}

function readPositions( json, bin, accessorIndex ) {

	const { a, bv, start } = viewOf( json, accessorIndex );
	if ( a.componentType !== 5126 || a.type !== 'VEC3' ) throw new GLBError( 'UNSUPPORTED', 'POSITION is not float32 vec3' );
	if ( bv.byteStride && bv.byteStride !== 12 ) throw new GLBError( 'UNSUPPORTED', 'interleaved POSITION data is not supported' );
	const dv = new DataView( bin.data.buffer, bin.data.byteOffset );
	const out = new Float32Array( a.count * 3 );
	for ( let i = 0; i < out.length; i ++ ) out[ i ] = dv.getFloat32( start + i * 4, true );
	return out;

}

// merge consecutive vertex indices into byte ranges
function rangesOf( start, ids ) {

	const sorted = [ ...ids ].sort( ( p, q ) => p - q ), out = [];
	for ( const i of sorted ) {

		const s = start + i * 12, last = out[ out.length - 1 ];
		if ( last && last.end === s ) last.end = s + 12; else out.push( { start: s, end: s + 12 } );

	}
	return out;

}

/**
 * @param {{ json: object, chunks: {type:number,data:Uint8Array}[] }} vrm parsed VRM; its BIN chunk is replaced by an edited copy
 * @param {{ face?: { reference: object, strength: number }, hair?: { reference: object, strength: number } }} what
 * @returns {{ ranges: {start:number,end:number}[], accessors: number[], face: object|null, hair: object|null }}
 */
export function reshapeVRM( vrm, { face = null, hair = null } ) {

	const { json } = vrm;
	const binIndex = vrm.chunks.findIndex( c => c.type === BIN );
	if ( binIndex < 0 ) throw new GLBError( 'UNSUPPORTED', 'the VRM has no binary chunk' );
	const bin = { type: BIN, data: vrm.chunks[ binIndex ].data.slice() }; // never edit the caller's bytes

	const prims = [];
	( json.meshes || [] ).forEach( mesh => mesh.primitives.forEach( p => {

		const name = p.material !== undefined && json.materials[ p.material ] ? json.materials[ p.material ].name || '' : '';
		if ( p.attributes && p.attributes.POSITION !== undefined && p.indices !== undefined ) prims.push( { p, name } );

	} ) );
	const facePrims = prims.filter( q => FACE_MATERIAL.test( q.name ) );
	if ( ! facePrims.length ) throw new GLBError( 'NO_FACE_MESH', 'no VRoid-style face meshes found in the VRM' );

	// ── face measurement (also the frame the hair is measured in) ──
	const faceAccessors = [ ...new Set( facePrims.map( q => q.p.attributes.POSITION ) ) ];
	const main = faceAccessors.reduce( ( best, i ) => json.accessors[ i ].count > json.accessors[ best ].count ? i : best, faceAccessors[ 0 ] );
	const facePositions = readPositions( json, bin, main );
	const sets = { skin: [], iris: [], white: [], mouth: [] };
	for ( const { p, name } of facePrims.filter( q => q.p.attributes.POSITION === main ) ) {

		const part = PARTS.find( ( [ , re ] ) => re.test( name ) );
		if ( ! part ) continue;
		const verts = [ ...new Set( readIndices( json, bin, p.indices ) ) ];
		if ( part[ 0 ] === 'skin' ) { if ( verts.length > sets.skin.length ) sets.skin = verts; } else sets[ part[ 0 ] ].push( ...verts );

	}
	const m = measureFace( facePositions, sets );

	const modified = new Map(); // accessor -> { positions, ids }
	const result = { face: null, hair: null };

	// ── face ──
	if ( face ) {

		const plan = planFaceRefine( m, face.reference, face.strength );
		let maxMove = 0;
		const moved = new Float32Array( facePositions.length );
		for ( let i = 0; i < facePositions.length; i += 3 ) {

			const [ dx, dy, dz ] = warpPoint( plan, facePositions[ i ], facePositions[ i + 1 ], facePositions[ i + 2 ] );
			moved[ i ] = facePositions[ i ] + dx; moved[ i + 1 ] = facePositions[ i + 1 ] + dy; moved[ i + 2 ] = facePositions[ i + 2 ] + dz;
			maxMove = Math.max( maxMove, Math.hypot( dx, dy, dz ) );

		}
		const count = json.accessors[ main ].count;
		for ( const idx of faceAccessors ) if ( json.accessors[ idx ].count === count ) modified.set( idx, { positions: moved, ids: Array.from( { length: count }, ( _, i ) => i ) } );
		result.face = {
			maxMove,
			measured: {
				eyeSeparationW: m.eyeSeparationW, eyeWidthW: m.eyeWidthW, eyeOpenness: m.eyeOpenness, mouthWidthW: m.mouth.widthW,
				jawWidthW: face.reference.jawWidthW ? m.widthAt( m.chinY + ( face.reference.jawT || 0.25 ) * m.E ) / m.W : null,
			},
		};

	}

	// ── hair ──
	if ( hair ) {

		const byAccessor = new Map();
		for ( const { p } of prims.filter( q => HAIR_MATERIAL.test( q.name ) ) ) {

			const a = p.attributes.POSITION;
			if ( ! byAccessor.has( a ) ) byAccessor.set( a, new Set() );
			for ( const i of readIndices( json, bin, p.indices ) ) byAccessor.get( a ).add( i );

		}
		if ( ! byAccessor.size ) throw new GLBError( 'NO_HAIR_MESH', 'no hair meshes found in the VRM' );

		const store = new Map( [ ...byAccessor.keys() ].map( a => [ a, readPositions( json, bin, a ) ] ) );
		const flat = [];
		for ( const [ a, ids ] of byAccessor ) for ( const i of ids ) flat.push( store.get( a )[ i * 3 ], store.get( a )[ i * 3 + 1 ], store.get( a )[ i * 3 + 2 ] );
		const hp = Float32Array.from( flat );
		const cur = measureHair( hp, Array.from( { length: hp.length / 3 }, ( _, i ) => i ), m );

		const plan = planHair( cur, hair.reference, m, hair.strength );
		let maxMove = 0;
		for ( const [ a, ids ] of byAccessor ) {

			const src = store.get( a ), dst = Float32Array.from( src );
			for ( const i of ids ) {

				const [ dx, dy, dz ] = warpHairPoint( plan, src[ i * 3 ], src[ i * 3 + 1 ], src[ i * 3 + 2 ] );
				dst[ i * 3 ] += dx; dst[ i * 3 + 1 ] += dy; dst[ i * 3 + 2 ] += dz;
				maxMove = Math.max( maxMove, Math.hypot( dx, dy, dz ) );

			}
			modified.set( a, { positions: dst, ids: [ ...ids ] } );

		}
		result.hair = { maxMove, measured: cur, plan: summarizePlan( plan ) };

	}

	// ── write back, update bounds ──
	const ranges = [];
	const out = new DataView( bin.data.buffer, bin.data.byteOffset );
	for ( const [ idx, { positions, ids } ] of modified ) {

		const { a, start } = viewOf( json, idx );
		const mn = [ Infinity, Infinity, Infinity ], mx = [ - Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < positions.length; i ++ ) {

			out.setFloat32( start + i * 4, positions[ i ], true );
			const v = out.getFloat32( start + i * 4, true ), c = i % 3;
			mn[ c ] = Math.min( mn[ c ], v ); mx[ c ] = Math.max( mx[ c ], v );

		}
		a.min = mn; a.max = mx;
		ranges.push( ...rangesOf( start, ids ) );

	}

	vrm.chunks[ binIndex ] = bin;
	return { ranges, accessors: [ ...modified.keys() ], ...result };

}

/** Throws unless every byte of the binary chunk outside `ranges` is identical. */
export function assertBinOnlyChanged( before, after, ranges ) {

	if ( before.length !== after.length ) throw new GLBError( 'RIG_UNSAFE', 'refusing to write: the binary chunk changed size' );
	const allowed = new Uint8Array( before.length );
	for ( const r of ranges ) allowed.fill( 1, r.start, r.end );
	for ( let i = 0; i < before.length; i ++ ) if ( before[ i ] !== after[ i ] && ! allowed[ i ] ) throw new GLBError( 'RIG_UNSAFE', `refusing to write: byte ${ i } outside the face / hair POSITION data changed` );

}
