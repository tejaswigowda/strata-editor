// Reads the *metadata* of a face-blendshape GLB (autorigger output: a standalone face mesh with N
// morph targets, no skeleton). Only the JSON chunk is used — morph count, morph names, a skin-tone
// hint and, when made from a photo, hair / iris / brow colour hints and the measured face proportions. The face mesh's vertices, morph deltas and texture are never read, and nothing
// here touches the network: this module has no fetch / XHR / WebSocket.

import { parseGLB, GLBError } from './glb.js';

// The autorigger names its morphs by bare index. When the file carries no semantic names and has
// exactly 42 morphs, this order (the shared sample's) is assumed. It is a convention, not a
// guarantee, so the bind is flagged `convention` and the caller is warned.
export const CONVENTION_42 = [
	'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight',
	'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeSquintLeft', 'eyeSquintRight',
	'eyeWideLeft', 'eyeWideRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
	'jawOpen', 'jawForward', 'jawLeft', 'jawRight', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
	'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
	'mouthLowerDownLeft', 'mouthLowerDownRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
	'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];

const isIndexName = ( s, i ) => typeof s !== 'string' || s.trim() === '' || /^\d+$/.test( s.trim() ) || s === `morph_${ i }`;

/**
 * @param {ArrayBuffer|Uint8Array} input local bytes of the face GLB
 * @param {{ names?: string[] }} [opts] explicit names (override the file's)
 * @returns {{ count:number, names:(string|null)[], resolution:string, warnings:string[], skinColor:{r:number,g:number,b:number}|null, hair:{color:{r:number,g:number,b:number}, coverage:number|null}|null }}
 */
export function readFaceSource( input, opts = {} ) {

	const { json } = parseGLB( input );
	const warnings = [];

	// the face mesh is the one with the most morph targets
	let best = null;
	( json.meshes || [] ).forEach( ( mesh, mi ) => mesh.primitives.forEach( ( prim, pi ) => {

		const n = ( prim.targets || [] ).length;
		if ( n && ( ! best || n > best.count ) ) best = { mesh, prim, count: n, mi, pi };

	} ) );
	if ( ! best ) throw new GLBError( 'NO_MORPHS', 'the face GLB has no morph targets' );

	const { count } = best;
	const lists = [
		[ 'explicit names', opts.names ],
		[ 'primitive.extras.targetNames', best.prim.extras && best.prim.extras.targetNames ],
		[ 'mesh.extras.targetNames', best.mesh.extras && best.mesh.extras.targetNames ],
	];

	let names = null, resolution = null;
	for ( const [ label, list ] of lists ) {

		if ( Array.isArray( list ) && list.length === count && ! list.every( ( s, i ) => isIndexName( s, i ) ) ) { names = list.map( ( s, i ) => isIndexName( s, i ) ? null : s ); resolution = label; break; }

	}

	if ( ! names && count === CONVENTION_42.length ) {

		names = CONVENTION_42.slice();
		resolution = 'convention (42-morph autorigger order)';
		warnings.push( 'The morphs are named by index only; the standard 42-morph order was assumed. Check the mapping before relying on it, or pass explicit names.' );

	}
	if ( ! names ) {

		names = new Array( count ).fill( null );
		resolution = 'unresolved';
		warnings.push( `The ${ count } morphs are named by index only and match no known order, so none can be mapped.` );

	}

	const colour = c => c && [ c.r, c.g, c.b ].every( v => typeof v === 'number' ) ? { r: c.r, g: c.g, b: c.b } : null;
	let skinColor = null, hair = null, irisColor = null, browColor = null, proportions = null, hairShape = null;
	for ( const node of json.nodes || [] ) {

		const ex = node.extras;
		if ( ! ex ) continue;
		if ( ! skinColor ) skinColor = colour( ex.skinColor );
		if ( ! irisColor ) irisColor = colour( ex.irisColor );
		if ( ! browColor ) browColor = colour( ex.browColor );
		if ( ! hairShape && ex.hairShape && typeof ex.hairShape === 'object' ) hairShape = ex.hairShape;
		if ( ! proportions && ex.faceProportions && typeof ex.faceProportions.eyeSeparationW === 'number' ) proportions = ex.faceProportions;
		if ( ! hair && colour( ex.hairColor ) ) hair = { color: colour( ex.hairColor ), coverage: typeof ex.hairCoverage === 'number' ? ex.hairCoverage : null };

	}

	return { count, names, resolution, warnings, skinColor, hair, irisColor, browColor, proportions, hairShape };

}
