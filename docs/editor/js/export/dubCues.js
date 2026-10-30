// ── dubCues.js ────────────────────────────────────────────────────────────────────────────────────
// Subtitles in, a timed narration WAV out, by dub.webcli.app (Kokoro, in the browser; nothing is uploaded). Shared by the Subtitles tab's "Dub .srt" button, which
// works any time, and the Publish panel's Audio row, which needs a finished render. `handle` is what openTool( toolFor( 'dub' ) ) returned: open it from the click,
// or the browser blocks the window.

import { cuesToSrt } from '../intelligence/subtitles.js';

/**
 * Resolves { wav, voice, model, report, summary }. Throws if the tool sends no audio. The caller closes the handle.
 * `report` is the tool's own (duration_s, synthesized, collisions, ok): `summary` says it in one line, and says so when the cues collide.
 */
export async function dubCues( cues, handle, { voice = 'af_heart', name = 'subtitles', onProgress } = {} ) {

	const v = String( voice || '' ).trim() || 'af_heart';
	const out = await handle.job( {
		op: 'dub', args: { voice: v, tier: 'default', device: 'wasm', name: name + '.srt' },
		files: { 'subtitles.srt': new TextEncoder().encode( cuesToSrt( cues ) ) },
		onProgress
	} );
	const wav = out.files && out.files[ 'narration.wav' ];
	if ( ! wav || wav.length < 100 ) throw new Error( 'dub.webcli.app sent no audio.' );
	const meta = out.meta || {}, report = meta.report || {}, m = report.model || {}, used = meta.voice || v;
	return {
		wav, voice: used, report,
		model: m.id ? `${ m.id }@${ m.revision } ${ m.dtype }/${ m.device }` : 'unknown',
		summary: `Narration by dub.webcli.app: voice ${ used }, ${ report.duration_s } s, ${ report.synthesized } cues, ${ report.ok ? 'no collisions' : 'WITH PROBLEMS (' + ( report.collisions || 0 ) + ' collisions)' }.`
	};

}
