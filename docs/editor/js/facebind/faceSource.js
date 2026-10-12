// Reads the *metadata* of a face-blendshape GLB (autorigger output: a standalone face mesh with N
// morph targets, no skeleton). Only the JSON chunk is used — morph count, morph names and a
// skin-tone hint. The face mesh's vertices, morph deltas and texture are never read, and nothing
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
 * @returns {{ count:number, names:(string|null)[], resolution:string, warnings:string[], skinColor:{r:number,g:number,b:number}|null }}
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

	let skinColor = null;
	for ( const node of json.nodes || [] ) {

		const c = node.extras && node.extras.skinColor;
		if ( c && [ c.r, c.g, c.b ].every( v => typeof v === 'number' ) ) { skinColor = { r: c.r, g: c.g, b: c.b }; break; }

	}

	return { count, names, resolution, warnings, skinColor };

}
