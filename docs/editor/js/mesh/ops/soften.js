// ── soften.js ─────────────────────────────────────────────────────────────────
// Laplacian smoothing: repeatedly pull each target vertex toward the average
// position of its topological neighbors. Targets are the current selection's
// vertices, or every vertex in the mesh if nothing is selected — this is what
// turns a jagged/faceted displacement (e.g. from sculpt() with a tight radius,
// or hand-rolled vertex math) into a smooth-reading surface.
//
// Positions are double-buffered per iteration (all next-positions computed
// from the CURRENT pass before any are written) so relaxation is order
// independent, unlike naively mutating em.vertices in place mid-loop.

import { registerOp } from './index.js';

function buildAdjacency( em ) {

	const neighbors = new Map();
	for ( const v of em.vertices ) neighbors.set( v.id, new Set() );

	for ( const he of em.halfEdges ) {

		const a = he.v;
		const b = em.halfEdges[ he.next ].v;
		neighbors.get( a ).add( b );
		neighbors.get( b ).add( a );

	}

	return neighbors;

}

export function soften( em, selection, { iterations = 1, factor = 0.5 } = {} ) {

	const targetIds = selection.vertices.size > 0
		? [ ...selection.vertices ]
		: em.vertices.map( v => v.id );

	const neighbors = buildAdjacency( em );
	const t = Math.max( 0, Math.min( 1, factor ) );
	const n = Math.max( 1, Math.round( iterations ) );

	for ( let iter = 0; iter < n; iter ++ ) {

		const next = new Map(); // vertexId -> smoothed {x,y,z}, applied after the full pass

		for ( const id of targetIds ) {

			const nbrs = neighbors.get( id );
			if ( ! nbrs || nbrs.size === 0 ) continue;

			let sx = 0, sy = 0, sz = 0;
			for ( const nid of nbrs ) {

				const nv = em.vertices[ nid ];
				sx += nv.x; sy += nv.y; sz += nv.z;

			}

			const cx = sx / nbrs.size, cy = sy / nbrs.size, cz = sz / nbrs.size;
			const v = em.vertices[ id ];
			next.set( id, {
				x: v.x + ( cx - v.x ) * t,
				y: v.y + ( cy - v.y ) * t,
				z: v.z + ( cz - v.z ) * t,
			} );

		}

		for ( const [ id, p ] of next ) {

			const v = em.vertices[ id ];
			v.x = p.x; v.y = p.y; v.z = p.z;

		}

	}

}

registerOp( 'soften', {
	description: 'Laplacian-smooth selected vertices (or the whole mesh if nothing is selected) toward their neighbor average',
	params: { 'iterations?': 'number=1', 'factor?': 'number=0.5' },
	example: 'soften(em, selection, { iterations: 2, factor: 0.6 })',
} );
