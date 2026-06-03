// ── Midpoint subdivision operation (M2) ──────────────────────────────────────
// Linear (non-smoothing) subdivision: splits every triangle into 4 by inserting
// midpoints on each edge. Each iteration multiplies triangle count by 4.
// Uses SetGeometryCommand so the op is undoable.
//
// This is pure midpoint subdivision (no Loop/Catmull-Clark stencil weights),
// which preserves the original shape and adds polygons for detail.

import * as THREE from 'three';
import { SetGeometryCommand } from '../../commands/SetGeometryCommand.js';
import { registerOp } from './index.js';

// ── Core subdivision pass ─────────────────────────────────────────────────────

function _subdivideOnce( geom ) {

	// Work from a non-indexed form so every triangle is self-contained
	const src   = geom.index ? geom.toNonIndexed() : geom.clone();
	const srcPos = src.attributes.position.array;
	const triCount = srcPos.length / 9;          // 3 verts × 3 floats

	// Each triangle → 4 triangles = 12 new vertices per old triangle
	const newPos = new Float32Array( triCount * 4 * 3 * 3 );

	let wi = 0; // write index into newPos

	for ( let t = 0; t < triCount; t ++ ) {

		const b = t * 9;

		// Vertices A, B, C
		const ax = srcPos[ b ], ay = srcPos[ b + 1 ], az = srcPos[ b + 2 ];
		const bx = srcPos[ b + 3 ], by = srcPos[ b + 4 ], bz = srcPos[ b + 5 ];
		const cx = srcPos[ b + 6 ], cy = srcPos[ b + 7 ], cz = srcPos[ b + 8 ];

		// Midpoints M=AB, N=BC, O=CA
		const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2, mz = ( az + bz ) / 2;
		const nx = ( bx + cx ) / 2, ny = ( by + cy ) / 2, nz = ( bz + cz ) / 2;
		const ox = ( ax + cx ) / 2, oy = ( ay + cy ) / 2, oz = ( az + cz ) / 2;

		// Sub-triangle 1: A, M, O
		newPos[ wi ++ ] = ax; newPos[ wi ++ ] = ay; newPos[ wi ++ ] = az;
		newPos[ wi ++ ] = mx; newPos[ wi ++ ] = my; newPos[ wi ++ ] = mz;
		newPos[ wi ++ ] = ox; newPos[ wi ++ ] = oy; newPos[ wi ++ ] = oz;

		// Sub-triangle 2: M, B, N
		newPos[ wi ++ ] = mx; newPos[ wi ++ ] = my; newPos[ wi ++ ] = mz;
		newPos[ wi ++ ] = bx; newPos[ wi ++ ] = by; newPos[ wi ++ ] = bz;
		newPos[ wi ++ ] = nx; newPos[ wi ++ ] = ny; newPos[ wi ++ ] = nz;

		// Sub-triangle 3: O, N, C
		newPos[ wi ++ ] = ox; newPos[ wi ++ ] = oy; newPos[ wi ++ ] = oz;
		newPos[ wi ++ ] = nx; newPos[ wi ++ ] = ny; newPos[ wi ++ ] = nz;
		newPos[ wi ++ ] = cx; newPos[ wi ++ ] = cy; newPos[ wi ++ ] = cz;

		// Sub-triangle 4: M, N, O  (centre triangle, keeps winding)
		newPos[ wi ++ ] = mx; newPos[ wi ++ ] = my; newPos[ wi ++ ] = mz;
		newPos[ wi ++ ] = nx; newPos[ wi ++ ] = ny; newPos[ wi ++ ] = nz;
		newPos[ wi ++ ] = ox; newPos[ wi ++ ] = oy; newPos[ wi ++ ] = oz;

	}

	const out = new THREE.BufferGeometry();
	out.setAttribute( 'position', new THREE.BufferAttribute( newPos, 3 ) );
	out.computeVertexNormals();
	return out;

}

// ── Public op ─────────────────────────────────────────────────────────────────

/**
 * Subdivide a mesh's geometry in-place using midpoint subdivision.
 * Each iteration multiplies triangle count by 4.
 *
 * @param {Editor}     editor
 * @param {THREE.Mesh} mesh         mesh to subdivide (geometry is replaced)
 * @param {number}     [iterations=1]
 * @returns {THREE.Mesh}            the same mesh with new geometry
 */
export function subdivide( editor, mesh, iterations = 1 ) {

	if ( ! mesh || ! mesh.isMesh ) throw new Error( 'subdivide: first arg must be a THREE.Mesh' );

	const n = Math.max( 1, Math.min( Math.round( iterations ), 4 ) ); // cap at 4 (4^4 = 256× triangles)

	let geom = mesh.geometry;

	for ( let i = 0; i < n; i ++ ) {

		geom = _subdivideOnce( geom );

	}

	editor.execute( new SetGeometryCommand( editor, mesh, geom ) );
	return mesh;

}

registerOp( 'subdivide', {
	description: 'Subdivide mesh geometry (midpoint, 4× triangles per iteration, max 4 iterations)',
	params: { mesh: 'Mesh', 'iterations?': 'number=1' },
	example: 'subdivide(editor.selected, 2)',
} );
