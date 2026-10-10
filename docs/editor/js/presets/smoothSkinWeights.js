import * as THREE from 'three';
import { findParts } from './rigParts.js';

// ── Smooth outfit skin weights ────────────────────────────────────────────────
// MetaHuman outfits ship with skin weights meant for cloth simulation and
// corrective joints. Under plain linear-blend skinning with motion capture, the
// weights jump sharply between neighbouring vertices (e.g. at the armpit and
// collar, where one vertex follows the torso and its neighbour 1 cm away follows
// the upper arm), so those vertices are pulled up to ~30 cm apart: the cloth
// shreds and bare skin shows through at the neck and shoulders.
//
// smoothSkinWeights() relaxes each vertex's weights toward its neighbours'
// (Laplacian smoothing of the weight vectors), so the transition spreads over
// several rings of vertices. Vertices that share a position (UV / normal seams)
// are treated as one, so seams stay closed.
//
// Smoothing alone lets the collar's neck weights bleed down into the shoulders, so
// the neckline sags open. Vertices that lie on the skin — the body, and the head
// mesh, whose neck the collar sits on — within NEAR_BODY are therefore pinned to
// that skin's own weights, easing back to the smoothed cloth weights by FAR_BODY:
// cloth hugging the skin follows it exactly, loose cloth keeps a soft swing. Idempotent: a flag on the geometry
// stops it being applied twice. Run it at rest pose, before applying a clip.
//
// Pass { rigid: true } when the cloth does not need to swing: every outfit vertex then
// copies its nearest skin vertex's weights outright.
//
// Usage (console): ( await import( './editor/js/presets/smoothSkinWeights.js' ) ).smoothOutfitWeights( editor.scene );

const MAX_INFLUENCES = 4;
const NEAR_BODY = 0.025; // m — fully follows the body
const FAR_BODY = 0.07; // m — beyond this, smoothed cloth weights only
const RIGID_RANGE = 0.35; // m — how far a vertex may be from the skin and still copy it (rigid mode)

function restPositions( mesh ) {

	const n = mesh.geometry.attributes.position.count;
	const out = new Float32Array( n * 3 );
	const v = new THREE.Vector3();

	for ( let i = 0; i < n; i ++ ) {

		mesh.getVertexPosition( i, v ).applyMatrix4( mesh.matrixWorld );
		out[ i * 3 ] = v.x;
		out[ i * 3 + 1 ] = v.y;
		out[ i * 3 + 2 ] = v.z;

	}

	return out;

}

// Nearest body vertex (within maxDistance) via a uniform grid.
function nearestBodyVertex( points, cell ) {

	const cells = new Map();
	const key = ( x, y, z ) => Math.floor( x / cell ) + ',' + Math.floor( y / cell ) + ',' + Math.floor( z / cell );

	for ( let i = 0; i < points.length / 3; i ++ ) {

		const k = key( points[ i * 3 ], points[ i * 3 + 1 ], points[ i * 3 + 2 ] );
		let list = cells.get( k );
		if ( ! list ) cells.set( k, list = [] );
		list.push( i );

	}

	return function ( x, y, z, maxDistance ) {

		const cx = Math.floor( x / cell ), cy = Math.floor( y / cell ), cz = Math.floor( z / cell );
		const rings = Math.ceil( maxDistance / cell );
		let best = - 1, bestSq = maxDistance * maxDistance;

		for ( let dx = - rings; dx <= rings; dx ++ ) for ( let dy = - rings; dy <= rings; dy ++ ) for ( let dz = - rings; dz <= rings; dz ++ ) {

			const list = cells.get( ( cx + dx ) + ',' + ( cy + dy ) + ',' + ( cz + dz ) );
			if ( ! list ) continue;

			for ( const i of list ) {

				const d = ( points[ i * 3 ] - x ) ** 2 + ( points[ i * 3 + 1 ] - y ) ** 2 + ( points[ i * 3 + 2 ] - z ) ** 2;
				if ( d < bestSq ) {

					bestSq = d;
					best = i;

				}

			}

		}

		return best < 0 ? null : { index: best, distance: Math.sqrt( bestSq ) };

	};

}

// Bones are matched across skeletons by name, ignoring case and the "_N" suffix
// the editor adds to make duplicate bone names unique.
function boneKey( name ) {

	return name.replace( /_\d+$/, '' ).toLowerCase();

}

// Merge vertices that share a position, and build the node adjacency.
function buildGraph( geometry ) {

	const pos = geometry.attributes.position;
	const index = geometry.index.array;
	const n = pos.count;

	const nodeOf = new Int32Array( n );
	const lookup = new Map();
	let nodes = 0;

	for ( let i = 0; i < n; i ++ ) {

		const key = Math.round( pos.getX( i ) * 1e5 ) + ',' + Math.round( pos.getY( i ) * 1e5 ) + ',' + Math.round( pos.getZ( i ) * 1e5 );
		let node = lookup.get( key );
		if ( node === undefined ) lookup.set( key, node = nodes ++ );
		nodeOf[ i ] = node;

	}

	const neighbours = Array.from( { length: nodes }, () => new Set() );

	for ( let t = 0; t < index.length; t += 3 ) {

		const a = nodeOf[ index[ t ] ], b = nodeOf[ index[ t + 1 ] ], c = nodeOf[ index[ t + 2 ] ];
		neighbours[ a ].add( b ).add( c );
		neighbours[ b ].add( a ).add( c );
		neighbours[ c ].add( a ).add( b );

	}

	return { nodeOf, neighbours, nodes };

}

// rigid: the cloth does not need to flow, so every vertex copies the weights of the
// nearest skin vertex (within RIGID_RANGE) instead of keeping its own cloth-sim
// weights. Layers that lie close together (jacket over trousers over shoes) then
// move exactly like the body underneath and like each other, so they stop
// crossing each other (z-fighting / poke-through) at certain frames of a clip.
export function smoothMeshWeights( mesh, { iterations = 24, strength = 0.7, references = [], rigid = false } = {} ) {

	const geo = mesh.geometry;
	if ( geo.userData.weightsSmoothed || ! geo.index ) return false;

	const idx = geo.attributes.skinIndex, wgt = geo.attributes.skinWeight;
	const n = geo.attributes.position.count;
	const { nodeOf, neighbours, nodes } = buildGraph( geo );

	// Per node: a sparse { bone → weight } map (taken from its first vertex)
	let current = new Array( nodes );
	for ( let i = 0; i < n; i ++ ) {

		const node = nodeOf[ i ];
		if ( current[ node ] ) continue;

		const m = new Map();
		for ( let k = 0; k < 4; k ++ ) {

			const w = wgt.getComponent( i, k );
			if ( w > 0 ) m.set( idx.getComponent( i, k ), w );

		}

		current[ node ] = m;

	}

	const newIndex = new Uint16Array( n * 4 );
	const newWeight = new Float32Array( n * 4 );

	// Pin vertices that lie on the skin (body, and the head mesh whose neck the
	// collar sits on) to that skin's weights
	let pinned = null;
	const skins = ( references || [] ).filter( r => r && r.isSkinnedMesh );

	if ( skins.length > 0 ) {

		mesh.updateMatrixWorld( true );
		const outPos = restPositions( mesh );
		const outBones = new Map( mesh.skeleton.bones.map( ( b, i ) => [ boneKey( b.name ), i ] ) );
		const headBone = outBones.get( 'head' ) ?? 0;

		const sources = skins.map( skin => {

			skin.updateMatrixWorld( true );
			// skin bone index → outfit bone index (facial rig bones fold into the head)
			const remap = skin.skeleton.bones.map( b => outBones.get( boneKey( b.name ) ) ?? headBone );
			return { skin, remap, nearest: nearestBodyVertex( restPositions( skin ), rigid ? RIGID_RANGE / 3 : FAR_BODY ) };

		} );

		pinned = new Array( n );

		for ( let i = 0; i < n; i ++ ) {

			let best = null;

			for ( const src of sources ) {

				const hit = src.nearest( outPos[ i * 3 ], outPos[ i * 3 + 1 ], outPos[ i * 3 + 2 ], rigid ? RIGID_RANGE : FAR_BODY );
				if ( hit && ( ! best || hit.distance < best.hit.distance ) ) best = { hit, src };

			}

			if ( ! best ) continue;

			const { hit, src } = best;
			const t = rigid || hit.distance <= NEAR_BODY ? 1 : 1 - ( hit.distance - NEAR_BODY ) / ( FAR_BODY - NEAR_BODY );
			const sIdx = src.skin.geometry.attributes.skinIndex, sWgt = src.skin.geometry.attributes.skinWeight;
			const m = new Map();

			for ( let k = 0; k < 4; k ++ ) {

				const w = sWgt.getComponent( hit.index, k );
				if ( w > 0 ) {

					const bone = src.remap[ sIdx.getComponent( hit.index, k ) ];
					m.set( bone, ( m.get( bone ) || 0 ) + w );

				}

			}

			pinned[ i ] = { t, m };

		}

	}

	// Rigid cloth starts from the skin's weights, then the smoothing below spreads
	// them so neighbouring vertices that sit near different limbs (sleeve against
	// torso) do not tear apart
	if ( rigid && pinned ) {

		for ( let i = 0; i < n; i ++ ) if ( pinned[ i ] ) current[ nodeOf[ i ] ] = pinned[ i ].m;

	}

	for ( let it = 0; it < iterations; it ++ ) {

		const next = new Array( nodes );

		for ( let v = 0; v < nodes; v ++ ) {

			const nb = neighbours[ v ];
			if ( nb.size === 0 ) {

				next[ v ] = current[ v ];
				continue;

			}

			const acc = new Map();
			const own = ( 1 - strength );
			for ( const [ bone, w ] of current[ v ] ) acc.set( bone, own * w );

			const share = strength / nb.size;
			for ( const u of nb ) for ( const [ bone, w ] of current[ u ] ) acc.set( bone, ( acc.get( bone ) || 0 ) + share * w );

			// Keep the strongest influences so the vertex stays within 4 bones
			const top = [ ...acc ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, MAX_INFLUENCES );
			const total = top.reduce( ( s, e ) => s + e[ 1 ], 0 ) || 1;
			next[ v ] = new Map( top.map( ( [ bone, w ] ) => [ bone, w / total ] ) );

		}

		current = next;

	}

	for ( let i = 0; i < n; i ++ ) {

		let weights = current[ nodeOf[ i ] ];
		const pin = ! rigid && pinned && pinned[ i ];

		if ( pin ) {

			const acc = new Map();
			for ( const [ bone, w ] of weights ) acc.set( bone, ( 1 - pin.t ) * w );
			for ( const [ bone, w ] of pin.m ) acc.set( bone, ( acc.get( bone ) || 0 ) + pin.t * w );

			const top = [ ...acc ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, MAX_INFLUENCES );
			const total = top.reduce( ( sum, e ) => sum + e[ 1 ], 0 ) || 1;
			weights = new Map( top.map( ( [ bone, w ] ) => [ bone, w / total ] ) );

		}

		let k = 0;
		for ( const [ bone, w ] of weights ) {

			newIndex[ i * 4 + k ] = bone;
			newWeight[ i * 4 + k ] = w;
			k ++;

		}

	}

	geo.setAttribute( 'skinIndex', new THREE.BufferAttribute( newIndex, 4 ) );
	geo.setAttribute( 'skinWeight', new THREE.BufferAttribute( newWeight, 4 ) );
	geo.userData.weightsSmoothed = true;

	return true;

}

/**
 * Smooth the weights of a character's outfit meshes (jacket, trousers, shoes).
 * @param {THREE.Object3D} root
 * @returns {number} how many meshes were changed
 */
export function smoothOutfitWeights( root, options ) {

	const { shirt, bottom, shoes, body, face } = findParts( root );
	let changed = 0;

	for ( const mesh of [ shirt, bottom, shoes ] ) {

		if ( mesh && mesh.isSkinnedMesh && smoothMeshWeights( mesh, { references: [ body, face ], ...options } ) ) changed ++;

	}

	return changed;

}
