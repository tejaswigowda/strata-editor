// ── vocabInjection.js ───────────────────────────────────────────────────────────
// Build context for constrained decoding: available parts (selectors), ops, and schema.
// Injected into LLM prompt so model picks from PRESENTED vocabulary, doesn't guess.
//
// Result: model emits {op, selector, args} JSON from constrained choices.

import { OP_SCHEMA } from './editOps.js';
import * as selectorEngine from './selectorEngine.js';
import { deriveClasses, getAllClasses } from './classDerive.js';

// ── Vocab building ──────────────────────────────────────────────────────────────

/**
 * Collect all unique selectors (labels, classes) available in scene.
 * @param {THREE.Object3D} root
 * @returns {Set<string>}  selectors (#label, .class, type)
 */
export function collectSelectors( root ) {

	const selectors = new Set();

	root.traverse( node => {

		// #id from label
		if ( node.userData.label ) {

			const label = String( node.userData.label )
				.toLowerCase()
				.replace( /\s+/g, '-' )
				.replace( /[^a-z0-9-]/g, '' );
			if ( label ) selectors.add( `#${ label }` );

		}

		// .classes from descriptors
		const classes = getAllClasses( node );
		for ( const cls of classes ) {

			selectors.add( `.${ cls }` );

		}

		// three.js type
		if ( node.isMesh ) selectors.add( 'mesh' );
		if ( node.isLight ) selectors.add( 'light' );
		if ( node.isCamera ) selectors.add( 'camera' );
		if ( node.isGroup || ( ! node.isMesh && node.children && node.children.length > 0 ) ) selectors.add( 'group' );

	} );

	return selectors;

}

/**
 * Group nodes by selector for display (show multiplicity).
 * Returns collapsed format: ".wheel(×4)" means 4 wheels.
 * @param {THREE.Object3D} root
 * @returns {Array<{selector:string, count:number}>}
 */
export function selectorCounts( root ) {

	const counts = new Map();

	root.traverse( node => {

		const classes = getAllClasses( node );
		for ( const cls of classes ) {

			const sel = `.${ cls }`;
			counts.set( sel, ( counts.get( sel ) || 0 ) + 1 );

		}

		// Label
		if ( node.userData.label ) {

			const label = String( node.userData.label )
				.toLowerCase()
				.replace( /\s+/g, '-' )
				.replace( /[^a-z0-9-]/g, '' );
			if ( label ) counts.set( `#${ label }`, ( counts.get( `#${ label }` ) || 0 ) + 1 );

		}

	} );

	return Array.from( counts.entries() )
		.map( ( [ selector, count ] ) => ( { selector, count } ) )
		.sort( ( a, b ) => b.count - a.count );

}

// ── Constrained decoding context ────────────────────────────────────────────────

/**
 * Build injection context for LLM (vocab + schema).
 * Compact format: "Parts: #dump-bed #cab .wheel(×4) .window(×6) ...
 *  Ops: recolor scale move delete rotate ... animate"
 * @param {THREE.Object3D} root
 * @returns {string}  injection text
 */
export function buildVocabInjection( root ) {

	const counts = selectorCounts( root );
	const parts = counts.map( ( { selector, count } ) => {

		if ( count === 1 ) return selector;
		return `${ selector }(×${ count })`;

	} ).slice( 0, 30 ); // Limit to 30 for context budget

	const ops = OP_SCHEMA.properties.op.enum;

	return `
ADDRESSABLE PARTS (selectors):
  ${parts.join(' ')}

AVAILABLE EDIT OPS:
  ${ops.join(', ')}

Op format: {"op":"<op>", "selector":"<selector>", "args":{...}}
- op must be one of: ${ops.join(', ')}
- selector: CSS subset (#id, .class, type, A B, A>B)
- args: op-specific (e.g., recolor:{color:0xRRGGBB}, scale:{factor:2})

CRITICAL: Respond ONLY with valid JSON op(s), no other text.
`.trim();

}

/**
 * Schema string for JSON-schema validation (if supported by model/API).
 * @returns {string}  JSON schema as string
 */
export function buildOpSchema() {

	return JSON.stringify( OP_SCHEMA, null, 2 );

}

// ── System prompt injection ─────────────────────────────────────────────────────

/**
 * Build a system prompt for edit tasks with vocab injection.
 * Constrains model to emit {op, selector, args} only.
 * @param {THREE.Object3D} root
 * @returns {string}  system prompt
 */
export function buildEditSystemPrompt( root ) {

	const vocab = buildVocabInjection( root );
	const schema = buildOpSchema();

	return `You edit 3D scenes using deterministic operations.

${vocab}

RESPONSE FORMAT: Output ONLY a single-line JSON object, no markdown, no explanations.
Example:
{"op":"recolor","selector":".wheel","args":{"color":"#000000"}}

For batch edits, output one JSON per line.

${schema}

Never output anything except valid JSON op objects. No explanations, no code blocks.
`.trim();

}

// ── Example helper ──────────────────────────────────────────────────────────────

/**
 * Generate example op for user education.
 * Shows model what to do for a common request.
 * @param {string} request  user's request (e.g., "make the wheels black")
 * @param {string} selector  inferred selector (e.g., ".wheel")
 * @param {object} args      op args (e.g., {color: "#000000"})
 * @returns {string}  example JSON for few-shot prompting
 */
export function exampleOp( request, selector, args = {} ) {

	const inferred = selectorEngine.isValid( selector ) ? selector : '.unknown';
	const parts = request.split( /\s+/ );
	
	let op = 'recolor';
	if ( /move|position/.test( request ) ) op = 'move';
	if ( /scale|big|small|bigger|smaller/.test( request ) ) op = 'scale';
	if ( /rotate|spin|turn/.test( request ) ) op = 'rotate';
	if ( /delete|remove/.test( request ) ) op = 'delete';
	if ( /duplicate|copy/.test( request ) ) op = 'duplicate';

	return JSON.stringify( {
		op,
		selector: inferred,
		args: args || {},
	} );

}

// ── Dynamic few-shot from history ───────────────────────────────────────────────

/**
 * Build few-shot examples from past successful edits.
 * Retrieves top-N by relevance (future: embeddings + similarity).
 * For now: manual static examples or placeholder for RAG.
 * @param {Array} editHistory  [{request, opData, success}]
 * @param {number} [limit=3]
 * @returns {Array<string>}  example op JSONs
 */
export function dynamicFewShot( editHistory = [], limit = 3 ) {

	if ( editHistory.length === 0 ) {

		// Fallback static examples
		return [
			'{"op":"recolor","selector":".wheel","args":{"color":"#111111"}}',
			'{"op":"scale","selector":"#truck","args":{"factor":1.5}}',
			'{"op":"move","selector":".window","args":{"dx":0,"dy":0.5,"dz":0}}',
		];

	}

	return editHistory
		.filter( ( e ) => e.success )
		.slice( 0, limit )
		.map( ( e ) => JSON.stringify( e.opData ) );

}
