// ── AIUtils.js ────────────────────────────────────────────────────────────────
// Utilities shared between Shell.js and AIEngine.js.

import { summarizeScene as _summarizeScene, sceneContextString } from './scene/summarize.js';
import { selectorCounts } from './intelligence/vocabInjection.js';

export { sceneContextString };

// Build the "ADDRESSABLE PARTS" line for the prompt — the REAL selectors present
// in the current scene, with counts. Feeds the op/$S edit path so the model picks
// ".rims" (what the asset actually has) instead of guessing ".wheel". Empty when
// nothing is labeled/classed yet (no import). Capped for context budget.
function addressablePartsBlock( editor ) {

	if ( ! editor || ! editor.scene ) return '';
	let counts;
	try { counts = selectorCounts( editor.scene ); } catch { return ''; }
	if ( ! counts || counts.length === 0 ) return '';

	const line = counts
		.slice( 0, 30 )
		.map( ( { selector, count } ) => count > 1 ? `${ selector }(×${ count })` : selector )
		.join( '  ' );

	// Compact EDIT OPS reference — injected ONLY when there are parts to edit (kept
	// OUT of the always-on system prompt to save the local model's 8k context).
	return 'EDIT OPS — this scene HAS addressable parts. To edit any part LISTED below you\n' +
		'MUST use the op surface ($S / op / ops) — NOT findObject / Set*Command / traverse /\n' +
		'raw three.js. Wrap in one IIFE (or emit a bare op call). Examples:\n' +
		"  (function(){ $S('.sel').recolor('#111'); })();\n" +
		"  (function(){ ops([{type:'recolor',selector:'.a',color:'#111'},{type:'scale',selector:'.b',factor:1.5}]); })();\n" +
		'Ops & args: recolor(color) scale(factor,axis?) move(dx,dy,dz) rotate(axis,deg) delete()\n' +
		'  duplicate(dx,dy,dz) setMaterial({color,roughness,metalness}) spin(axis?,turns?,dur?)\n' +
		'  bounce/pulse/fade/orbit/shake(…opts). Fuzzy: bigger≈1.5 a-bit≈1.2 smaller≈0.6 slowly≈dur4.\n' +
		'recolor TINTS a textured part — for SOLID color use setMaterial. Use ONLY listed selectors;\n' +
		'map the user\'s noun to the CLOSEST listed one (asked "wheels", list has .rims → .rims).\n' +
		'ADDRESSABLE PARTS (do NOT invent others):\n' + line + '\n\n';

}

export function summarizeScene( editor ) {

	return _summarizeScene( editor );

}

// ── Code extractor ────────────────────────────────────────────────────────────
// HARD RULE (B1): only real code ever reaches execute(). Prose NEVER runs.
//   • If a COMPLETE fenced block exists, return the first non-empty fence body.
//   • An opening fence with no close = truncated output → extraction FAILURE ('').
//   • No fence: recover a balanced IIFE if present; else accept only if the text
//     BEGINS as code. Prose ("The error…", "Here's…") → extraction failure ('').
// Returns '' to mean "no executable code" — callers must treat that as a failure
// and feed back a code-only retry, never execute it.

// Allowed code-start tokens for the no-fence path (model is told to emit an IIFE).
const CODE_START = /^(?:\(\s*(?:async\s+)?function|\(\s*\)|const\s|let\s|var\s|function\s|editor\b|scene\b|new\s|\$S\s*\(|ops?\s*\(|\/\/|\/\*|;|\{|if\s*\(|for\s*\(|while\s*\()/;

// Strip a stray leading language tag the model sometimes emits ("javascript\n…").
function stripLangTag( s ) {

	return s.replace( /^(?:javascript|js|json)\b[ \t]*\r?\n?/i, '' ).trim();

}

// Recover a balanced (function(){ … })() span. Returns '' if unbalanced
// (truncated mid-output) — we never execute a half-written IIFE.
function extractIIFE( s ) {

	const start = s.search( /\(\s*(?:async\s+)?function/ );
	if ( start === - 1 ) return '';

	let depth = 0, end = - 1;
	for ( let i = start; i < s.length; i ++ ) {

		const c = s[ i ];
		if ( c === '(' ) depth ++;
		else if ( c === ')' ) { depth --; if ( depth === 0 ) { end = i; break; } }

	}
	if ( end === - 1 ) return ''; // unbalanced → truncated → fail

	// Include the trailing call "()" and optional ";".
	let tail = end + 1;
	const call = s.slice( tail ).match( /^\s*\(\s*\)\s*;?/ );
	if ( call ) tail += call[ 0 ].length;
	return s.slice( start, tail ).trim();

}

// Models frequently emit "smart"/Unicode look-alikes for plain ASCII operators
// and whitespace (e.g. the U+2212 MINUS SIGN in `position.set(0,1,−3.5)`), which
// the JS engine rejects as "Invalid or unexpected token". Fold the unambiguous
// offenders back to ASCII so an otherwise-correct generation isn't wasted on a
// retry. Only characters that are never valid JS tokens (and not meaningful as
// literal text in editor code) are converted.
export function normalizeCodeChars( text ) {

	return String( text )
		// Minus-sign / non-ASCII hyphen look-alikes → ASCII hyphen-minus.
		.replace( /[\u2212\u2010\u2011]/g, '-' )
		// Unicode spaces (incl. NBSP) → regular space.
		.replace( /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ' )
		// Zero-width and BOM → removed.
		.replace( /[\u200B\u200C\u200D\uFEFF]/g, '' );

}

export function extractCode( text ) {

	if ( ! text ) return '';
	const raw = normalizeCodeChars( String( text ) );

	// 1. Prefer the FIRST complete fenced block; discard everything outside it.
	const fenceRe = /```[ \t]*[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g;
	let fm;
	while ( ( fm = fenceRe.exec( raw ) ) !== null ) {

		const body = stripLangTag( fm[ 1 ].trim() );
		if ( body ) return body;

	}

	// 2. An opening fence with no matching close = truncated/unterminated output.
	//    Before giving up, try to salvage a BALANCED IIFE from the post-fence
	//    body: if the fenced code happens to be complete (a balanced (function(){…})())
	//    even though the closing ``` was cut off (e.g. max_tokens truncation that
	//    clipped only the trailing fence), it's safe to run. extractIIFE returns ''
	//    unless the parens balance, so genuinely incomplete code is still rejected.
	const openFence = raw.lastIndexOf( '```' );
	if ( openFence !== - 1 ) {

		const afterFence = stripLangTag( raw.slice( openFence + 3 ).replace( /^[a-zA-Z]*[ \t]*\r?\n?/, '' ) );
		const salvaged = extractIIFE( afterFence );
		if ( salvaged ) return salvaged;
		return '';

	}

	// 3. No fences. Strip a stray language tag, then recover a balanced IIFE, or
	//    accept the text ONLY if it begins as code. Prose never passes.
	const body = stripLangTag( raw.trim() );

	const iife = extractIIFE( body );
	if ( iife ) return iife;

	// Began as an IIFE but didn't balance → truncated mid-output → fail (don't
	// hand a half-written function to the executor).
	if ( /^\(\s*(?:async\s+)?function/.test( body ) ) return '';

	if ( CODE_START.test( body ) ) return body;
	return '';

}

// ── Context budget helpers (B3) ────────────────────────────────────────────────
// Keep retry context small and the prompt under the model's window.

// Conservative token estimate (~chars/4). Err high — better to trim than to hit
// MLC's hard context-overflow throw.
export function estimateTokens( messages ) {

	const text = Array.isArray( messages )
		? messages.map( m => String( m.content || '' ) ).join( '\n' )
		: String( messages || '' );
	return Math.ceil( text.length / 4 );

}

// Truncate a (possibly multi-KB, possibly looping) generation to a short
// head+tail snippet so the wreckage never bloats the next retry's context.
export function truncateForContext( s, head = 200, tail = 200 ) {

	const str = String( s || '' );
	if ( str.length <= head + tail + 20 ) return str;
	return str.slice( 0, head ) + '\n… [truncated] …\n' + str.slice( - tail );

}

// ── Message builder ───────────────────────────────────────────────────────────
// Uses sceneContextString (JS-comment format) as the scene context — code models
// read this more naturally than raw JSON.  Falls back to a compact JSON summary
// if the JS string exceeds the token budget.

// System prompt is ~900 tokens; leave ~900 for context + user message in a 4096 window
const CTX_CHAR_LIMIT = 900; // ~225 tokens

// ── Q&A message builder ───────────────────────────────────────────────────────
// Used for plain-text scene interrogation (no code generation).

export function buildQAMessages( qaSystemPrompt, editor, question ) {

	const ctx = sceneContextString( editor );
	return [
		{ role: 'system', content: qaSystemPrompt },
		{ role: 'user',   content: 'Scene:\n' + ctx + '\n\nQuestion: ' + question },
	];

}

export function buildMessages( systemPrompt, editor, userPrompt, apiHints = '', opts = {} ) {

	// Prefer the JS-comment representation — the model "speaks" JS
	let ctxStr = sceneContextString( editor );

	if ( ctxStr.length > CTX_CHAR_LIMIT ) {

		// Fall back to compact JSON summary, capped at 8 objects
		const summary = _summarizeScene( editor );
		const compact = { ...summary, objects: summary.objects.slice( 0, 8 ), truncated: true };
		try {
			ctxStr = JSON.stringify( compact );
		} catch {
			ctxStr = '// (scene too complex to summarize)';
		}

	}

	// Inject retrieved REAL API signatures ahead of the request (Technique 2 RAG)
	const apiBlock = apiHints ? apiHints + '\n\n' : '';

	// Inject the scene's REAL addressable selectors so the model edits via op/$S
	// against parts that actually exist (".rims"), not invented ones (".wheel").
	// The eval matrix's BARE condition suppresses this to measure scaffolding lift.
	const partsBlock = opts.injectParts === false ? '' : addressablePartsBlock( editor );

	return [
		{ role: 'system', content: systemPrompt },
		{ role: 'user',   content: apiBlock + partsBlock + 'Scene:\n' + ctxStr + '\n\nRequest: ' + userPrompt },
	];

}
