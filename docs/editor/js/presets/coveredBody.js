import * as THREE from 'three';

// ── Remove the body under the clothes ─────────────────────────────────────────
// MetaHuman GLBs keep the full body mesh under the outfit. Wherever the cloth
// lies a few millimetres from the skin the two surfaces are almost coplanar, so
// the skin flickers through the cloth (z-fighting) on some frames of an animation.
// Nobody can see that skin, so its triangles are dropped: a triangle goes when all
// three corners sit within `distance` of a cloth vertex at the rest pose. Triangles
// along the cloth's edge (neck, wrists, ankles) stay, so no hole opens up.
// Idempotent (flag on the geometry). Run at rest pose, before applying a clip.

const CELL = 0.02;

function worldPoints( mesh ) {

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

export function removeCoveredBody( body, cloth, { distance = 0.012 } = {} ) {

	if ( ! body || ! body.isSkinnedMesh || ! body.geometry.index || body.geometry.userData.coveredRemoved ) return 0;

	body.updateMatrixWorld( true );
	const key = ( x, y, z ) => Math.floor( x / CELL ) + ',' + Math.floor( y / CELL ) + ',' + Math.floor( z / CELL );
	const cells = new Map();
	const clothPoints = [];

	for ( const mesh of cloth ) {

		if ( ! mesh || ! mesh.isMesh || ! mesh.visible ) continue;
		mesh.updateMatrixWorld( true );
		const pts = mesh.isSkinnedMesh ? worldPoints( mesh ) : null;
		if ( ! pts ) continue;
		clothPoints.push( pts );

		for ( let i = 0; i < pts.length / 3; i ++ ) {

			const k = key( pts[ i * 3 ], pts[ i * 3 + 1 ], pts[ i * 3 + 2 ] );
			let list = cells.get( k );
			if ( ! list ) cells.set( k, list = [] );
			list.push( pts, i );

		}

	}

	if ( clothPoints.length === 0 ) return 0;

	const bodyPts = worldPoints( body );
	const limit = distance * distance;

	const covered = new Uint8Array( bodyPts.length / 3 );
	for ( let i = 0; i < covered.length; i ++ ) {

		const x = bodyPts[ i * 3 ], y = bodyPts[ i * 3 + 1 ], z = bodyPts[ i * 3 + 2 ];
		const cx = Math.floor( x / CELL ), cy = Math.floor( y / CELL ), cz = Math.floor( z / CELL );

		search: for ( let dx = - 1; dx <= 1; dx ++ ) for ( let dy = - 1; dy <= 1; dy ++ ) for ( let dz = - 1; dz <= 1; dz ++ ) {

			const list = cells.get( ( cx + dx ) + ',' + ( cy + dy ) + ',' + ( cz + dz ) );
			if ( ! list ) continue;

			for ( let j = 0; j < list.length; j += 2 ) {

				const p = list[ j ], q = list[ j + 1 ];
				if ( ( p[ q * 3 ] - x ) ** 2 + ( p[ q * 3 + 1 ] - y ) ** 2 + ( p[ q * 3 + 2 ] - z ) ** 2 < limit ) {

					covered[ i ] = 1;
					break search;

				}

			}

		}

	}

	const index = body.geometry.index.array;
	const kept = [];

	for ( let t = 0; t < index.length; t += 3 ) {

		if ( covered[ index[ t ] ] && covered[ index[ t + 1 ] ] && covered[ index[ t + 2 ] ] ) continue;
		kept.push( index[ t ], index[ t + 1 ], index[ t + 2 ] );

	}

	const removed = ( index.length - kept.length ) / 3;
	if ( removed === 0 ) return 0;

	body.geometry.setIndex( new THREE.BufferAttribute( new index.constructor( kept ), 1 ) );
	body.geometry.userData.coveredRemoved = true;
	return removed;

}
