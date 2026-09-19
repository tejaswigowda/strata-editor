// ── sculpt.js ─────────────────────────────────────────────────────────────────
// Proportional-falloff brush: push/pull every vertex within `radius` of the
// current selection's centroid (or the whole mesh's centroid, if nothing is
// selected) along its own smooth vertex normal, weighted by distance so the
// effect fades to zero at the brush edge instead of cutting off sharply.
//
// Unlike pushing vertices "away from the mesh center" (only correct for
// roughly-spherical meshes), the displacement direction here is each vertex's
// true smooth normal — the average of its incident face normals — so this
// reads correctly on any topology, not just spheres.

import { registerOp } from './index.js';

/** Vertex ids referenced by the current selection, in whichever mode it's in. */
function selectedVertexIds( em, selection ) {

	if ( selection.vertices.size ) return [ ...selection.vertices ];

	if ( selection.faces.size ) {

		const ids = new Set();
		for ( const fid of selection.faces ) {

			if ( ! em.faces[ fid ] ) continue;
			for ( const v of em.faceVertices( fid ) ) ids.add( v.id );

		}

		return [ ...ids ];

	}

	if ( selection.edges.size ) {

		const ids = new Set();
		for ( const heId of selection.edges ) {

			const he = em.halfEdges[ heId ];
			if ( ! he ) continue;
			ids.add( he.v );
			ids.add( em.halfEdges[ he.next ].v );

		}

		return [ ...ids ];

	}

	return em.vertices.map( v => v.id );

}

function smoothstep( t ) { return t * t * ( 3 - 2 * t ); }

export function sculpt( em, selection, { strength = 0.2, radius = 0.5, falloff = 'smooth' } = {} ) {

	const THREE = window.THREE;

	const centerIds = selectedVertexIds( em, selection );
	if ( centerIds.length === 0 ) return;

	const center = { x: 0, y: 0, z: 0 };
	for ( const id of centerIds ) {

		const v = em.vertices[ id ];
		center.x += v.x; center.y += v.y; center.z += v.z;

	}

	center.x /= centerIds.length; center.y /= centerIds.length; center.z /= centerIds.length;

	// Faces incident to each vertex, for the smooth-normal average below.
	const faceIdsByVertex = new Map();
	for ( const face of em.faces ) {

		if ( ! face ) continue;
		for ( const v of em.faceVertices( face.id ) ) {

			if ( ! faceIdsByVertex.has( v.id ) ) faceIdsByVertex.set( v.id, [] );
			faceIdsByVertex.get( v.id ).push( face.id );

		}

	}

	const weightOf = ( t ) => falloff === 'linear' ? 1 - t : 1 - smoothstep( t );
	const n = new THREE.Vector3();

	for ( const v of em.vertices ) {

		const dx = v.x - center.x, dy = v.y - center.y, dz = v.z - center.z;
		const dist = Math.hypot( dx, dy, dz );
		if ( dist >= radius ) continue;

		const faceIds = faceIdsByVertex.get( v.id );
		if ( ! faceIds || faceIds.length === 0 ) continue;

		n.set( 0, 0, 0 );
		for ( const fid of faceIds ) n.add( em.faceNormal( fid ) );
		if ( n.lengthSq() === 0 ) continue;
		n.normalize();

		const w = weightOf( dist / radius ) * strength;
		v.x += n.x * w;
		v.y += n.y * w;
		v.z += n.z * w;

	}

}

registerOp( 'sculpt', {
	description: 'Proportional-falloff brush: push/pull vertices near the selection (or whole mesh) along their smooth normals, fading out over radius',
	params: { 'strength?': 'number=0.2', 'radius?': 'number=0.5', "falloff?": "'smooth'|'linear'='smooth'" },
	example: 'sculpt(em, selection, { strength: -0.15, radius: 0.4 })',
} );
