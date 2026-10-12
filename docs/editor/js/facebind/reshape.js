// Reshape a VRoid-style VRM's face toward measured proportions (from the photo), by editing the face
// mesh's base POSITION data in the file's binary chunk.
//
// What is touched: the POSITION accessor shared by the face primitives (and its min/max bounds).
// What is not: indices, UVs, normals, the 100+ morph targets (they are deltas, so every existing
// blendshape keeps working on the new base), skeleton, skin weights, textures, hair, body.
// bindVRM() audits that, byte for byte, before it writes anything.

import { measureFace, planFaceRefine, applyPlan } from '../face/FaceRefine.js';
import { GLBError } from './glb.js';

const FACE_MATERIAL = /_(FaceMouth|EyeIris|EyeHighlight|EyeWhite|FaceBrow|FaceEyelash|FaceEyeline|Face)_\d+_(FACE|EYE|SKIN)/;
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

/**
 * @param {{ json: object, chunks: {type:number,data:Uint8Array}[] }} vrm parsed VRM; its BIN chunk is replaced by an edited copy
 * @param {object} reference proportions: { eyeSeparationW, eyeWidthW, eyeOpenness?, mouthWidthW, jawWidthW?, jawT?, depth? }
 * @param {number} strength 0–1
 * @returns {{ ranges: {start:number,end:number}[], accessors: number[], measured: object, maxMove: number }}
 */
export function reshapeFace( vrm, reference, strength ) {

	const { json } = vrm;
	const binIndex = vrm.chunks.findIndex( c => c.type === BIN );
	if ( binIndex < 0 ) throw new GLBError( 'UNSUPPORTED', 'the VRM has no binary chunk' );
	const bin = { type: BIN, data: vrm.chunks[ binIndex ].data.slice() }; // never edit the caller's bytes

	const prims = [];
	( json.meshes || [] ).forEach( mesh => mesh.primitives.forEach( p => {

		const name = p.material !== undefined && json.materials[ p.material ] ? json.materials[ p.material ].name || '' : '';
		if ( FACE_MATERIAL.test( name ) && p.attributes && p.attributes.POSITION !== undefined && p.indices !== undefined ) prims.push( { p, name } );

	} ) );
	if ( ! prims.length ) throw new GLBError( 'NO_FACE_MESH', 'no VRoid-style face meshes found in the VRM' );

	const accessors = [ ...new Set( prims.map( q => q.p.attributes.POSITION ) ) ];
	const main = accessors.reduce( ( best, i ) => json.accessors[ i ].count > json.accessors[ best ].count ? i : best, accessors[ 0 ] );
	const { a: pa, bv: pbv, start } = viewOf( json, main );
	if ( pa.componentType !== 5126 || pa.type !== 'VEC3' ) throw new GLBError( 'UNSUPPORTED', 'POSITION is not float32 vec3' );
	if ( pbv.byteStride && pbv.byteStride !== 12 ) throw new GLBError( 'UNSUPPORTED', 'interleaved POSITION data is not supported' );

	const dv = new DataView( bin.data.buffer, bin.data.byteOffset );
	const positions = new Float32Array( pa.count * 3 );
	for ( let i = 0; i < positions.length; i ++ ) positions[ i ] = dv.getFloat32( start + i * 4, true );

	// vertex sets per part (the skin material is split into a face piece and an ears/sides piece: the larger is the face)
	const sets = { skin: [], iris: [], white: [], mouth: [] };
	for ( const { p, name } of prims.filter( q => q.p.attributes.POSITION === main ) ) {

		const part = PARTS.find( ( [ , re ] ) => re.test( name ) );
		if ( ! part ) continue;
		const verts = [ ...new Set( readIndices( json, bin, p.indices ) ) ];
		if ( part[ 0 ] === 'skin' ) { if ( verts.length > sets.skin.length ) sets.skin = verts; } else sets[ part[ 0 ] ].push( ...verts );

	}

	const m = measureFace( positions, sets );
	const plan = planFaceRefine( m, reference, strength );
	const moved = new Float32Array( positions.length );
	const maxMove = applyPlan( plan, positions, moved );

	const ranges = [];
	const same = [];
	for ( const idx of accessors ) {

		const { a, start: s } = viewOf( json, idx );
		if ( a.count !== pa.count ) continue; // a different layout: leave it alone
		const mn = [ Infinity, Infinity, Infinity ], mx = [ - Infinity, - Infinity, - Infinity ];
		const out = new DataView( bin.data.buffer, bin.data.byteOffset );
		for ( let i = 0; i < moved.length; i ++ ) {

			out.setFloat32( s + i * 4, moved[ i ], true );
			const v = out.getFloat32( s + i * 4, true ), c = i % 3;
			mn[ c ] = Math.min( mn[ c ], v ); mx[ c ] = Math.max( mx[ c ], v );

		}
		a.min = mn; a.max = mx;
		ranges.push( { start: s, end: s + a.count * 12 } );
		same.push( idx );

	}

	vrm.chunks[ binIndex ] = bin;
	return {
		ranges, accessors: same, maxMove,
		measured: {
			eyeSeparationW: m.eyeSeparationW, eyeWidthW: m.eyeWidthW, eyeOpenness: m.eyeOpenness, mouthWidthW: m.mouth.widthW,
			jawWidthW: reference.jawWidthW ? m.widthAt( m.chinY + ( reference.jawT || 0.25 ) * m.E ) / m.W : null,
		},
	};

}

/** Throws unless every byte of the binary chunk outside `ranges` is identical. */
export function assertBinOnlyChanged( before, after, ranges ) {

	if ( before.length !== after.length ) throw new GLBError( 'RIG_UNSAFE', 'refusing to write: the binary chunk changed size' );
	const inRange = i => ranges.some( r => i >= r.start && i < r.end );
	for ( let i = 0; i < before.length; i ++ ) if ( before[ i ] !== after[ i ] && ! inRange( i ) ) throw new GLBError( 'RIG_UNSAFE', `refusing to write: byte ${ i } outside the face POSITION data changed` );

}
