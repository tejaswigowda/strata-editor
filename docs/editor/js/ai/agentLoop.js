// ── agentLoop.js ──────────────────────────────────────────────────────────────
// The bounded agentic loop (Technique 1): generate → validate → execute →
// observe → fix, with capped retries. The reliability unlock.
//
// Pure orchestrator: all side-effecting capabilities are injected by Shell.js so
// the loop stays on the SAME single execution surface and is unit-reasonable.
//
//   runAgentic({ editor, messages, intent, deps, maxRetries })
//     deps = { streamCode, execute, appendOutput,
//              validateCode, snapshotScene, sceneDiff, confirmChange, diffSummary }
//
// Invariants:
//   • Every execution goes through deps.execute (editor.execute → undo stack).
//   • Validation failures are fed back BEFORE executing (no bad run).
//   • Observation only triggers a retry on the safe "nothing happened" signal
//     (diff.total === 0), never on fuzzy value mismatch (avoids retry storms).
//   • Hard cap on iterations — never runaway-loop the local model.

export const DEFAULT_MAX_RETRIES = 3;

export async function runAgentic( { editor, messages, intent, deps, maxRetries = DEFAULT_MAX_RETRIES } ) {

	const { streamCode, execute, appendOutput, validateCode, snapshotScene, sceneDiff, confirmChange, diffSummary } = deps;

	const convo = [ ...messages ];

	for ( let attempt = 0; attempt <= maxRetries; attempt ++ ) {

		const code = await streamCode( convo );

		// ── 1. Static validation against the real API index ──────────────────
		const v = validateCode( code );
		if ( ! v.ok && attempt < maxRetries ) {

			appendOutput( '⚠ API check: ' + v.issues.join( '  |  ' ), 'info' );
			convo.push( { role: 'assistant', content: code } );
			convo.push( { role: 'user', content:
				'Before running, these API problems were detected:\n- ' + v.issues.join( '\n- ' ) +
				'\nOutput corrected JavaScript only.' } );
			continue;

		}

		// ── 2. Execute (undo stack) with before/after observation ────────────
		const before = snapshotScene( editor );
		const result = execute( code );

		if ( ! result.ok ) {

			if ( attempt >= maxRetries ) break;
			appendOutput( `⟳ error — retrying (${ attempt + 1 }/${ maxRetries })…`, 'info' );
			convo.push( { role: 'assistant', content: code } );
			convo.push( { role: 'user', content:
				'That threw: ' + result.error + '\nFix the code. Output corrected JavaScript only.' } );
			continue;

		}

		// ── 3. Observe ───────────────────────────────────────────────────────
		const after = snapshotScene( editor );
		const diff = sceneDiff( before, after );
		const conf = confirmChange( diff, intent );

		// Safe retry signal: we expected a change and NOTHING happened (nothing to
		// undo, no compounding). Wrong-but-something is accepted (user can undo).
		if ( ! conf.ok && diff.total === 0 && attempt < maxRetries ) {

			appendOutput( `⟳ no effect (${ conf.reason }) — retrying (${ attempt + 1 }/${ maxRetries })…`, 'info' );
			convo.push( { role: 'assistant', content: code } );
			convo.push( { role: 'user', content:
				'The code ran but the scene did not change, though a change was expected (' + conf.reason + '). ' +
				'The target object was probably not found — re-check the lookup (findObject / findByDescription with the full descriptive phrase). Output corrected JavaScript only.' } );
			continue;

		}

		appendOutput( '✓ ' + diffSummary( diff ), 'info' );
		return { ok: true, diff, attempts: attempt + 1 };

	}

	appendOutput( `Stopped after ${ maxRetries + 1 } attempts — see messages above.`, 'error' );
	return { ok: false, attempts: maxRetries + 1 };

}
