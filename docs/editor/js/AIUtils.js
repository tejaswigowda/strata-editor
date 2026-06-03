// ── AIUtils.js ────────────────────────────────────────────────────────────────
// Utilities shared between Shell.js and AIEngine.js.

import { summarizeScene as _summarizeScene, sceneContextString } from './scene/summarize.js';

export function summarizeScene( editor ) {

	return _summarizeScene( editor );

}

// ── Code extractor ────────────────────────────────────────────────────────────

export function extractCode( text ) {

	const fenced = text.match( /```(?:[a-zA-Z]*)?\n?([\s\S]*?)```/ );
	if ( fenced ) return fenced[ 1 ].trim();
	return text.trim()
		.replace( /^```[a-zA-Z]*\n?/, '' )
		.replace( /\n?```$/, '' )
		.trim();

}

// ── Message builder ───────────────────────────────────────────────────────────
// Uses sceneContextString (JS-comment format) as the scene context — code models
// read this more naturally than raw JSON.  Falls back to a compact JSON summary
// if the JS string exceeds the token budget.

const CTX_CHAR_LIMIT = 1800; // ~450 tokens for a 1.5B model

export function buildMessages( systemPrompt, editor, userPrompt ) {

	// Prefer the JS-comment representation — the model "speaks" JS
	let ctxStr = sceneContextString( editor );

	if ( ctxStr.length > CTX_CHAR_LIMIT ) {

		// Fall back to compact JSON summary, capped at 15 objects
		const summary = _summarizeScene( editor );
		const compact = { ...summary, objects: summary.objects.slice( 0, 15 ), truncated: true };
		try {
			ctxStr = JSON.stringify( compact );
		} catch {
			ctxStr = '// (scene too complex to summarize)';
		}

	}

	return [
		{ role: 'system', content: systemPrompt },
		{ role: 'user',   content: 'Scene:\n' + ctxStr + '\n\nRequest: ' + userPrompt },
	];

}
