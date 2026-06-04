// ── sceneIndex.js ─────────────────────────────────────────────────────────────
// Query primitives over the descriptor index + the SceneIntelligence controller
// that keeps descriptors fresh (eager-on-import, debounced; lazy-on-query).
//
// Public (also registered in the op registry → AI-callable):
//   findByDescription(text)  → { node, confidence, method, candidates }
//   describeObject(node)     → descriptor bundle (computed on demand)
//   listCandidates(text)     → ranked candidates [{ node, score, reasons }]
//   resolvePartAI(text)      → async: Path A then existing-LLM Path B
//
// Never silently wrong: ambiguous queries return ranked candidates + low
// confidence; merged-mesh GLBs (no per-part nodes) are detected and reported.

import { indexSubtree } from './descriptors.js';
import { parseQuery, scoreCandidates, resolveWithLLM } from './resolver.js';
import { registerOp } from '../mesh/ops/index.js';

// ── Index maintenance ─────────────────────────────────────────────────────────

/** Recompute descriptors for any scene subtree that lacks fresh ones. */
export function ensureIndexed( editor, force = false ) {

	for ( const child of editor.scene.children ) {

		if ( child.isCamera ) continue;
		indexSubtree( child, force );

	}

}

/** All nodes (excluding scene root + cameras) that carry descriptors. */
function indexedNodes( editor ) {

	const out = [];
	editor.scene.traverse( n => {

		if ( n === editor.scene || n.isCamera ) return;
		if ( n.userData && n.userData.descriptors ) out.push( n );

	} );
	return out;

}

// ── Merged-mesh detection ─────────────────────────────────────────────────────
// A query referencing a sub-part can't be served if the scene is a single mesh
// with no per-part hierarchy.

function looksLikeSubPartQuery( q ) {

	return q.shapes.length > 0 || q.regions.length > 0 || q.pair;

}

function onlyMergedMeshes( nodes ) {

	const meshes = nodes.filter( n => n.isMesh );
	const groups = nodes.filter( n => n.userData.descriptors && n.userData.descriptors.role === 'group' );
	return groups.length === 0 && meshes.every( m => m.children.length === 0 ) && meshes.length <= 1;

}

// ── Path A (sync, free) ───────────────────────────────────────────────────────

/**
 * @returns {{ node, confidence, method, candidates, message? }}
 *   method: 'A' | 'ambiguous' | 'merged' | 'none'
 */
export function findByDescription( editor, text ) {

	ensureIndexed( editor );

	const nodes = indexedNodes( editor );
	const q = parseQuery( text );

	if ( looksLikeSubPartQuery( q ) && onlyMergedMeshes( nodes ) ) {

		return {
			node: null, confidence: 0, method: 'merged', candidates: [],
			message: 'This scene has no per-part nodes (single merged mesh) — individual parts can\'t be selected without geometry segmentation.',
		};

	}

	const ranked = scoreCandidates( nodes, q );

	if ( ranked.length === 0 ) {

		return { node: null, confidence: 0, method: 'none', candidates: [] };

	}

	// Confidence from score margin between #1 and #2
	const top = ranked[ 0 ];
	const second = ranked[ 1 ];
	const margin = second ? ( top.score - second.score ) / ( top.score || 1 ) : 1;
	const confidence = Math.max( 0, Math.min( 1, 0.5 + 0.5 * margin ) );

	if ( ! second || margin >= 0.34 ) {

		return { node: top.node, confidence, method: 'A', candidates: ranked.slice( 0, 6 ) };

	}

	// Ambiguous — surface candidates, do not guess
	return { node: top.node, confidence, method: 'ambiguous', candidates: ranked.slice( 0, 6 ) };

}

// ── Path A + Path B (async, uses loaded LLM only when ambiguous) ──────────────

export async function resolvePartAI( editor, text ) {

	const a = findByDescription( editor, text );
	if ( a.method === 'A' || a.method === 'merged' ) return a;

	// Pre-filtered candidate set for the LLM (keeps context small)
	const candidates = ( a.candidates.length ? a.candidates.map( c => c.node ) : indexedNodes( editor ) );

	const b = await resolveWithLLM( editor.aiEngine, text, candidates );
	if ( b && b.node ) return { node: b.node, confidence: b.confidence, method: 'B', candidates: a.candidates };

	return a; // fall back to ambiguous/none from Path A

}

// ── Describe / list ───────────────────────────────────────────────────────────

export function describeObject( editor, node ) {

	if ( ! node ) return null;
	if ( ! node.userData.descriptors ) {

		// Index its top-level ancestor so sibling-relative facts are correct
		let root = node;
		while ( root.parent && root.parent !== editor.scene ) root = root.parent;
		indexSubtree( root, true );

	}
	return node.userData.descriptors || null;

}

export function listCandidates( editor, text ) {

	ensureIndexed( editor );
	return scoreCandidates( indexedNodes( editor ), parseQuery( text ) );

}

// ── SceneIntelligence controller ──────────────────────────────────────────────

export class SceneIntelligence {

	constructor( editor ) {

		this.editor = editor;
		this._dirty = new Set();
		this._timer = null;

		// Eager-on-import, debounced so a 200-node bulk load doesn't thrash.
		editor.signals.objectAdded.add( obj => {

			let root = obj;
			while ( root.parent && root.parent !== editor.scene ) root = root.parent;
			if ( root && ! root.isCamera ) this._dirty.add( root );
			this._schedule();

		} );

		// Invalidate descriptors when geometry changes (modeling ops).
		editor.signals.geometryChanged.add( obj => {

			if ( obj && obj.userData && obj.userData.descriptors ) {

				delete obj.userData.descriptors.geomHash; // forces recompute next pass
				let root = obj;
				while ( root.parent && root.parent !== editor.scene ) root = root.parent;
				if ( root ) { this._dirty.add( root ); this._schedule(); }

			}

		} );

	}

	_schedule() {

		if ( this._timer ) return;
		this._timer = setTimeout( () => {

			this._timer = null;
			const roots = [ ...this._dirty ];
			this._dirty.clear();
			for ( const r of roots ) {

				if ( r.parent ) indexSubtree( r ); // still in scene

			}

		}, 250 );

	}

}

// ── Register query primitives in the op registry (AI-discoverable) ────────────

registerOp( 'findByDescription', {
	description: 'Resolve a natural-language part reference (e.g. "right arm of the red person") to a scene node using geometry+color+symmetry descriptors. Returns { node, confidence, method, candidates }.',
	params: { text: 'string' },
	example: 'findByDescription("the red box on the left")',
} );

registerOp( 'describeObject', {
	description: 'Return the derived descriptor bundle (region, shape, color, symmetry pair, size rank) for a node.',
	params: { node: 'Object3D' },
	example: 'describeObject(editor.selected)',
} );

registerOp( 'listCandidates', {
	description: 'Return ranked candidate nodes for an ambiguous description, for disambiguation.',
	params: { text: 'string' },
	example: 'listCandidates("the two wheels at the back")',
} );
