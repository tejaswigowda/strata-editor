// ── opResolve.js ────────────────────────────────────────────────────────────────
// HOST-SIDE verb→op resolution — the same closed-set decomposition already applied
// to selectors (selectorIndex.js), now applied to op-TYPE. "make it red" is ALWAYS
// `recolor`; it is not a fuzzy judgment call, so an unambiguous verb should never
// reach the model as a free choice among recolor/setMaterial/etc. PURE (no DOM,
// no three.js) so it's node-unit-testable.
//
// classifyOpVerb(text) → { op, confident, reason }
//   op         the SINGLE closed-set op (matching OP_SCHEMA.properties.op.enum in
//              editOps.js) the text's verb maps to, or null.
//   confident  true only when exactly one op's pattern set matched — no hits or
//              hits on MORE THAN ONE op both mean "let the model choose" (an
//              unconfident result is the safe default, same as selector ambiguity).

const OP_VERB_PATTERNS = [
	// "make X <colorword>" covers the common phrasing that carries no explicit verb.
	{ op: 'recolor', re: /\b(paint|colou?r|recolou?r|tint|darken|lighten|brighten)\b/i },
	{ op: 'recolor', re: /\bmake\b.*\b(red|blue|green|yellow|black|white|orange|purple|pink|gray|grey|brown|silver|gold|chrome|bright|dark)\b/i },
	{ op: 'scale', re: /\b(scale|resize|shrink|grow|enlarge)\b/i },
	{ op: 'scale', re: /\bmake\b.*\b(bigger|smaller|larger|tinier|huge|tiny)\b/i },
	{ op: 'move', re: /\b(move|lift|raise|lower|shift|translate|nudge)\b/i },
	{ op: 'rotate', re: /\b(rotate|turn|spin)\b/i },
	{ op: 'delete', re: /\b(delete|remove|discard|hide)\b/i },
	{ op: 'duplicate', re: /\b(duplicate|copy|clone)\b/i },
];

/**
 * @param {string} text  the request text or a segment's op-phrase — verb keywords
 *                       are searched anywhere in the string.
 * @returns {{ op:string|null, confident:boolean, reason:string }}
 */
export function classifyOpVerb( text ) {

	const s = String( text || '' );
	const ops = [ ...new Set( OP_VERB_PATTERNS.filter( p => p.re.test( s ) ).map( p => p.op ) ) ];
	if ( ops.length === 1 ) return { op: ops[ 0 ], confident: true, reason: 'verb-match' };
	if ( ops.length === 0 ) return { op: null, confident: false, reason: 'no-verb-match' };
	return { op: null, confident: false, reason: 'ambiguous-verb' };

}
