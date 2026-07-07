// ── import/labelPass.js ───────────────────────────────────────────────────────
// Stage 4 (LLM LABELING PASS) — the key LLM use in import. ★
//
// Turns an opaque `Object_N` asset into a natural-language-addressable one. ONCE,
// at import, the LLM is handed the COMPACT descriptor table (NOT raw geometry)
// harvested deterministically in Stage 3, and proposes a human label per node.
// Labels are cached in node.userData.label so they serialize into scene JSON
// (git-diffable, survive reload) and resolution can match against them later.
//
// "Geometry supplies the modifier, the LLM supplies the noun": descriptors give
// "elongated / red / rear"; the LLM gives "tail light".
//
// For merged-mesh assets there are no separable parts — the whole thing is
// labeled as one object and the pipeline notes parts aren't separable.

import { decodeName } from '../scene/summarize.js';
import { isMeaningfulName } from './diagnostics.js';

const MAX_NODES = 40; // context budget — never dump a 200-node table

const LABEL_SYSTEM =
`You name the parts of a 3D model from a descriptor table (you cannot see geometry).
Each row: an id, then derived facts (shape, color, region, size, symmetry pair, parent, MATERIAL name, original-name-hint).
The MATERIAL name is a STRONG hint — "Rims"→wheel, "Grille"→grille, "Glass"→window — weight it heavily.
Reply with one line per id you can name: "<id>: <short human label> | <confidence 0-1>".
The confidence (how sure you are, 0-1) is OPTIONAL but helpful; omit it if unsure how to score.
Use concrete part nouns (e.g. "Tail Light (right)", "Dump Bed", "Cab", "Front Left Wheel").
Convention: +X / RIGHT = the model's own right. Skip ids you genuinely cannot name. No other text.`;

// ── Build the compact descriptor table the LLM reads ──────────────────────────

function labelableNodes( root ) {

	const out = [];
	root.traverse( n => {

		if ( n === root && ! n.isMesh ) return; // skip the bare wrapper group
		const d = n.userData && n.userData.descriptors;
		if ( ! d ) return;
		if ( n.isMesh || d.role === 'group' ) out.push( n );

	} );
	return out;

}

function row( id, node ) {

	const d = node.userData.descriptors;
	const bits = [ d.role ];
	if ( d.color ) bits.push( d.color.base );
	if ( d.shape ) bits.push( d.shape );
	if ( d.orientation ) bits.push( d.orientation );
	const reg = [ d.region.x, d.region.y, d.region.z ].filter( r => r !== 'center' );
	if ( reg.length ) bits.push( reg.join( '/' ) );
	if ( d.pair ) bits.push( `pair(${ d.pair.side })` );
	if ( d.sizeRank !== 'medium' ) bits.push( d.sizeRank );
	bits.push( `parent:${ d.parentName }` );

	// Material name(s) — a STRONG semantic hint that survives opaque Object_N names
	// ("Rims"→wheel, "Grille"→grille). Decoded already by the harvest.
	if ( d.materials && d.materials.length ) bits.push( `material:"${ d.materials.join( '/' ) }"` );

	// Original name only as a HINT, and only if it isn't an exporter placeholder.
	const hint = isMeaningfulName( node.name ) ? `, hint:"${ decodeName( node.name ) }"` : '';

	return `${ id }  ${ bits.join( ', ' ) }${ hint }`;

}

/**
 * Build the id→node map and the descriptor text block for the LLM.
 * @returns {{ idMap: Map<string,THREE.Object3D>, table: string, nodes: THREE.Object3D[] }}
 */
export function buildLabelTable( root ) {

	const nodes = labelableNodes( root ).slice( 0, MAX_NODES );
	const idMap = new Map();
	const lines = nodes.map( ( node, i ) => {

		const id = `n${ i }`;
		idMap.set( id, node );
		return row( id, node );

	} );

	return { idMap, table: lines.join( '\n' ), nodes };

}

// ── Parse the LLM reply ───────────────────────────────────────────────────────

/**
 * Parse "id: Label | confidence" lines into a Map of { label, confidence }.
 * Tolerant of ":", "=", "-" separators and surrounding quotes/bullets. The
 * confidence is OPTIONAL — accepts a trailing "| 0.8", "(0.8)" or " 0.8"; when
 * absent the label is kept with a neutral default the caller can treat as "ok".
 * Ignores anything that doesn't look like a row.
 * @param {string} text
 * @returns {Map<string,{ label:string, confidence:number|null }>}
 */
export function parseLabelRows( text ) {

	const out = new Map();
	for ( const raw of String( text || '' ).split( /\r?\n/ ) ) {

		const line = raw.replace( /^[\s*\-•\d.)]+/, '' ).trim();
		const m = line.match( /^([\w.-]+)\s*[:=]\s*(.+)$/ );
		if ( ! m ) continue;
		const id = m[ 1 ];
		let rest = m[ 2 ].trim();

		// Pull an OPTIONAL confidence off the end: "Label | 0.8", "Label (0.8)".
		let confidence = null;
		let cm = rest.match( /\s*[|(]\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)?\s*$/ );
		if ( cm ) { confidence = parseFloat( cm[ 1 ] ); rest = rest.slice( 0, cm.index ).trim(); }

		const label = rest.replace( /^["'`]|["'`]$/g, '' ).trim();
		if ( label ) out.set( id, { label, confidence } );

	}
	return out;

}

/**
 * Back-compat label-only parse: Map<id, label>. Delegates to parseLabelRows and
 * drops the confidence (kept so existing callers/tests that only want the label
 * still work).
 * @param {string} text
 * @returns {Map<string,string>}
 */
export function parseLabelReply( text ) {

	const out = new Map();
	for ( const [ id, row ] of parseLabelRows( text ) ) out.set( id, row.label );
	return out;

}

// ── Main: run the pass once, cache to userData.label ──────────────────────────

/**
 * @param {Editor} editor       needs editor.aiEngine (the already-loaded LLM)
 * @param {THREE.Object3D} root indexed (descriptors present) imported root
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] re-run even if labels already cached
 * @returns {Promise<{ labeled:number, total:number, skipped?:string }>}
 */
export async function labelImportedAsset( editor, root, opts = {} ) {

	const aiEngine = editor && editor.aiEngine;
	if ( ! aiEngine || ! aiEngine.ready ) return { labeled: 0, total: 0, skipped: 'no-llm' };

	// Run once: if the root already carries a label pass, don't re-spend tokens.
	if ( ! opts.force && root.userData.labelPass ) return { labeled: 0, total: 0, skipped: 'cached' };

	const { idMap, table, nodes } = buildLabelTable( root );
	if ( nodes.length === 0 ) return { labeled: 0, total: 0, skipped: 'no-nodes' };

	// Merged mesh: one renderable node — label the whole object, note non-separable.
	if ( nodes.length === 1 ) {

		const node = nodes[ 0 ];
		try {

			const reply = await aiEngine.complete( [
				{ role: 'system', content: 'Name this single 3D object in 1-4 words from its descriptor. Reply with only the name.' },
				{ role: 'user', content: table },
			], { maxTokens: 16, temperature: 0 } );
			const name = String( reply || '' ).split( /\r?\n/ )[ 0 ].trim().replace( /^["'`]|["'`]$/g, '' );
			if ( name ) node.userData.label = name;

		} catch { /* leave unlabeled */ }

		node.userData.partsSeparable = false;
		root.userData.labelPass = { v: 1, mergedMesh: true, labeled: node.userData.label ? 1 : 0 };
		return { labeled: node.userData.label ? 1 : 0, total: 1 };

	}

	let labels;
	try {

		const reply = await aiEngine.complete( [
			{ role: 'system', content: LABEL_SYSTEM },
			{ role: 'user', content: `DESCRIPTOR TABLE:\n${ table }` },
		], { maxTokens: 400, temperature: 0 } );
		labels = parseLabelRows( reply );

	} catch ( e ) {

		root.userData.labelPass = { v: 1, error: String( e && e.message || e ), labeled: 0 };
		return { labeled: 0, total: nodes.length, skipped: 'llm-error' };

	}

	// Low-confidence threshold: labels below this are still stored (so the part is
	// addressable) but flagged so the resolver/UI can treat them with suspicion and
	// the user can rename. A missing confidence is treated as neutral (not low).
	const LOW_CONF = 0.45;

	let labeled = 0, lowConfidence = 0;
	for ( const [ id, row ] of labels ) {

		const node = idMap.get( id );
		if ( ! node ) continue;
		node.userData.label = row.label;
		if ( row.confidence !== null && row.confidence !== undefined ) {

			node.userData.labelConfidence = row.confidence;
			if ( row.confidence < LOW_CONF ) { node.userData.labelLowConfidence = true; lowConfidence ++; }

		}
		labeled ++;

	}

	root.userData.labelPass = { v: 1, mergedMesh: false, labeled, lowConfidence, total: nodes.length };
	return { labeled, lowConfidence, total: nodes.length };

}

/**
 * Heuristic fallback labeling for unlabeled meshes in an imported asset.
 * If a mesh doesn't have userData.label set, assign one based on:
 *   - Size (triangles): largest → "body", others by position/count
 *   - Name patterns: "wheel" / "tire" → "wheel", "cab" / "cabin" → "cab"
 *   - Position: sides → "wheel", center → "body"
 * ALSO adds the label as a CLASS so selectors like ".body" are addressable.
 * This runs AFTER the LLM labeling to fill gaps.
 * @param {THREE.Object3D} root   the imported asset root
 * @returns {number}  count of newly-labeled meshes
 */
export function applyHeuristicLabels( root ) {

	const meshes = [];
	root.traverse( node => {

		if ( node.isMesh && ! node.userData.label ) meshes.push( node );

	} );

	if ( meshes.length === 0 ) return 0;

	let labeled = 0;

	// Try name-based heuristics first
	const namePattern = {
		wheel: /wheel|tire|tyre|rim|hubcap/i,
		cab: /cab|cabin|cockpit|driver|front/i,
		bed: /bed|cargo|trunk|box|dump/i,
		door: /door|hatch|lid/i,
		window: /window|glass|windshield|window|pane/i,
		bumper: /bumper|fender|guard/i,
		axle: /axle|chassis|frame|suspension/i,
	};

	for ( const mesh of meshes ) {

		for ( const [ label, pattern ] of Object.entries( namePattern ) ) {

			if ( pattern.test( mesh.name ) ) {

				mesh.userData.label = label;
				// Also add as a CLASS so selectors like ".wheel" work
				if ( ! mesh.userData.customClasses ) mesh.userData.customClasses = new Set();
				mesh.userData.customClasses.add( label );
				labeled ++;
				break;

			}

		}

	}

	// For remaining unlabeled, use size heuristic: label the largest as "body"
	const remaining = meshes.filter( m => ! m.userData.label );
	if ( remaining.length > 0 ) {

		let maxTriangles = 0, bodyMesh = null;
		for ( const mesh of remaining ) {

			let triCount = 0;
			if ( mesh.geometry && mesh.geometry.index ) {

				triCount = mesh.geometry.index.count / 3;

			} else if ( mesh.geometry && mesh.geometry.attributes.position ) {

				triCount = mesh.geometry.attributes.position.count / 3;

			}

			if ( triCount > maxTriangles ) {

				maxTriangles = triCount;
				bodyMesh = mesh;

			}

		}

		if ( bodyMesh && maxTriangles > 10 ) { // only label if substantial

			bodyMesh.userData.label = 'body';
			// Also add as a CLASS so selectors like ".body" work
			if ( ! bodyMesh.userData.customClasses ) bodyMesh.userData.customClasses = new Set();
			bodyMesh.userData.customClasses.add( 'body' );
			labeled ++;

		}

	}

	return labeled;

}
