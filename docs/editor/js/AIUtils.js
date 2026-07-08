// ── AIUtils.js ────────────────────────────────────────────────────────────────
// Utilities shared between Shell.js and AIEngine.js.

import { summarizeScene as _summarizeScene, sceneContextString } from './scene/summarize.js';
import { selectorCounts } from './intelligence/vocabInjection.js';

export { sceneContextString };

// Build the "ADDRESSABLE PARTS" line for the prompt — the REAL selectors present
// in the current scene, with counts. Feeds the op/$S edit path so the model picks
// ".rims" (what the asset actually has) instead of guessing ".wheel". Empty when
// nothing is labeled/classed yet (no import). Capped for context budget.
export function addressablePartsBlock( editor ) {

	if ( ! editor || ! editor.scene ) return '';
	let counts;
	try { counts = selectorCounts( editor.scene ); } catch { return ''; }
	if ( ! counts || counts.length === 0 ) return '';

	const line = counts
		.slice( 0, 30 )
		.map( ( { selector, count } ) => count > 1 ? `${ selector }(×${ count })` : selector )
		.join( '  ' );

	// ⚠️  FIX 3: Enhanced block showing both EDIT and ANIMATION usage patterns
	// Simple, direct enforcement: show ONLY allowed selectors, repeated, with examples
	return '🔒 ADDRESSABLE PARTS MODE: Use ONLY these selectors (nothing else works):\n' +
		'ALLOWED: ' + line + '\n\n' +
		'TO EDIT A PART (instant transform) — use $S() the fluent authoring language:\n' +
		"  $S('.body').recolor('#ff0000')  ← primary form: fluent, chainable, readable\n" +
		"  $S('.body').recolor('#ff0000').scale(1.5)  ← chain ops on same selector\n" +
		"  $S('.body').recolor('#ff0000'); $S('.wheel').recolor('#111');  ← separate statements for different selectors\n" +
		'Edit ops: recolor(color) scale(factor) move(dx,dy,dz) delete() setMaterial({color,roughness,metalness})\n\n' +
		'🎬 TO ANIMATE A PART (keyframe-based, NOT instant):\n' +
		"  const o=findObject('name'); if(o) addSpinClip(o, {axis:'y', turns:1, seconds:2});\n" +
		"  — OR use ops recipe: ops([{type:'spin',selector:'.part',turns:1,duration:2000}])\n" +
		'Animation ops: spin(turns,duration) bounce(height,duration) pulse(scale,duration) fade(from,to,duration) orbit(center,radius,duration)\n' +
		'⚠️  NEVER: ops({type:"rotate",...}) for animation — rotate is INSTANT only. Use addSpinClip() or ops({type:"spin",...}).\n\n' +
		'Wrap in (function(){ ... })();\n' +
		'⚠️  MUST use EXACT selectors from the list above — do NOT combine or add spaces (e.g., ".tree bark" fails, use ".treebark" or "#tree-bark").\n' +
		'Any selector not in ALLOWED list above will fail silently and do nothing.\n\n';

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

// Scene-context budget for the CODE-GEN path. This used to be 900 chars (~225
// tokens), sized for a 4096-token window — but the models now load with a 16384
// window, so that tiny cap needlessly STARVED code-gen of the per-mesh detail
// the read-only Q&A path (which sends the full sceneContextString uncapped) uses
// to map a noun like "body" to the real node ("Object_07"). Raised to fit the
// larger window so mutable mode "sees" the same scene read-only does. Only a
// genuinely huge scene now falls back to the compact summary.
const CTX_CHAR_LIMIT = 8000; // ~2000 tokens — full mesh listing for typical imported assets

// ── Q&A message builder ───────────────────────────────────────────────────────
// Used for plain-text scene interrogation (no code generation).

export function buildQAMessages( qaSystemPrompt, editor, question ) {

	const ctx = sceneContextString( editor );
	
	// IMPORTANT: Include addressable parts in read-only mode too, so the model
	// knows what selectors (.body, .wheel, etc.) are available on imported parts.
	// Without this, the model falls back to guessing or using generic object names.
	const partsBlock = addressablePartsBlock( editor );
	const contextWithParts = partsBlock ? partsBlock + 'Scene:\n' + ctx : 'Scene:\n' + ctx;
	
	// Detect bulk scene operations and add explicit warning
	const isClearRequest = /\b(clear|empty|wipe|reset|remove all|remove everything)\b/i.test( question );
	const bulkWarning = isClearRequest ? 
		'\n🔴 SCENE CLEAR REQUIRED: You must use EXACTLY this pattern:\n' +
		'const toRemove = scene.children.filter(o=>o.type!==\'Camera\');\n' +
		'toRemove.forEach(o=>editor.execute(new RemoveObjectCommand(editor,o)));\n' +
		'editor.signals.sceneGraphChanged.dispatch();\n\n' +
		'✗ NEVER use: editor.snapshot() — this function does not exist\n' +
		'✗ NEVER use: scene.children.forEach(...) without snapshot — modifies array during iteration\n' +
		'✗ NEVER use: ops([{type:\'delete\',selector:\'all\'}]) — CRASHES with "No nodes matched"\n\n' : ''
	
	// Detect object creation requests and add API warning
	const isAddRequest = /\b(add|create|make)\s+[a-z]|new\s+[a-z]/i.test( question );
	const addWarning = isAddRequest ?
		'\n⚠️  OBJECT CREATION DETECTED: Use THREE.js classes with FULL material names (not abbreviated).\n' +
		'✓ AVAILABLE MATERIALS: MeshStandardMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshPhysicalMaterial, LineBasicMaterial\n' +
		'✗ WRONG: BasicMaterial, StandardMaterial, PhongMaterial (abbreviated names do not exist)\n' +
		'✓ PATTERN: const obj = new Mesh(<geometry>, new Mesh<Material>({color: 0xHHHHHH, ...})); obj.name = \'Name\'; editor.execute(new AddObjectCommand(editor, obj));\n' +
		'✓ GEOMETRY CHOICES: BoxGeometry (cubes), SphereGeometry (balls), CylinderGeometry (pipes/trees), ConeGeometry (cones), TorusGeometry (rings), etc.\n\n' : '';
	
	// Detect modification requests and add ops() guidance
	const isModifyRequest = /\b(make|change|set|rotate|scale|move|color|material|red|blue|green|yellow)\b/i.test( question ) && !/\badd\b|create\b|new\b/i.test( question );
	const modifyWarning = isModifyRequest ?
		'\n🔴 CRITICAL: OBJECT MODIFICATION MUST USE ops() — NOT raw JavaScript!\n' +
		'✓ REQUIRED: ops([{type:\'recolor\',selector:\'.object-name\',color:\'#ff0000\'}])\n' +
		'✗ FORBIDDEN: scene.children.find(...).material.color.set(...) — WRONG, breaks undo/redo\n' +
		'✗ FORBIDDEN: Raw loops on scene.children — WRONG, use ops() instead\n' +
		'✗ FORBIDDEN: Inventing selectors with spaces like ".tree bark" — ONLY use exact selectors from the addressable parts list\n' +
		'ALWAYS prefer ops() for any modification, color, rotation, or property changes.\n\n' : '';
	
	return [
		{ role: 'system', content: qaSystemPrompt },
		{ role: 'user',   content: contextWithParts + bulkWarning + modifyWarning + addWarning + 'Question: ' + question },
	];

}

export function buildMessages( systemPrompt, editor, userPrompt, apiHints = '', opts = {} ) {

	// Prefer the JS-comment representation — the model "speaks" JS
	let ctxStr = sceneContextString( editor );

	if ( ctxStr.length > CTX_CHAR_LIMIT ) {

		// Fall back to compact JSON summary, capped at 40 objects
		const summary = _summarizeScene( editor );
		const compact = { ...summary, objects: summary.objects.slice( 0, 40 ), truncated: true };
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
		{ role: 'user',   content: partsBlock + apiBlock + 'Scene:\n' + ctxStr + '\n\nRequest: ' + userPrompt },
	];

}
