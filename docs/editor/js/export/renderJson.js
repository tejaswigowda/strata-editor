// ── renderJson.js ──────────────────────────────────────────────────────────────
// render.json: what a published render says about itself. Pure functions; the Render tab fills them in.
// Four fields must not lie (docs: guides/PUBLISH.md):
//   mode           'offline' (every frame drawn at n / fps) or 'realtime' (a wall-clock capture: variable frame rate)
//   deterministic  true only for an offline render whose time-source audit passed. TEMPORAL determinism: frame n shows
//                  timeline time n / fps and the duration is exact. It is NOT a claim about pixels: GPUs differ in the last bit.
//   scene.hash     canonical hash of the scene at render time (canonical.js): the staleness check
//   frames         frames == round(duration_s * fps), or the capture is variable-rate and mode says 'realtime'

export const RENDER_JSON_VERSION = 1;
export const EXPORTER = 'strata-export/1.1.0';

/**
 * The time-source audit (guides/TIME_SOURCES.md) leaves three residuals. They are classified, not counted:
 *   accepted           bounded and harmless for a published render: it never makes `deterministic` false by itself
 *   live-when-present  a real input the render reads while it runs: when it applies to THIS render, `deterministic` is false
 */
export const TIME_SOURCE_AUDIT = Object.freeze( {
	document: 'guides/TIME_SOURCES.md',
	passed: true,
	residuals: Object.freeze( [
		{ id: 'shell-wall-clock-loops', status: 'accepted', why: 'A hand-written Shell timer lives in the page, not in the scene file: a render from a freshly loaded scene cannot contain one.' },
		{ id: 'end-card', status: 'live-when-present', why: 'The end card is a living web page, re-fetched and re-rasterised at the start of every render, so frames that show it are only as reproducible as that page.' },
		{ id: 'playback-running', status: 'live-when-present', why: 'A render started while timeline playback was running differed by a few hundred pixels per frame from one started when idle (cause not found).' },
	] ),
} );

/**
 * Why a render is, or is not, deterministic. `deterministic` means: frame n shows timeline time n / fps AND the same scene on the same device
 * gives byte-identical segments. It is never a claim about pixels across GPUs. Every reason below makes it false.
 */
/**
 * The repeat-render test (guides/TIME_SOURCES.md, "Repeat-render test"): the same scene, rendered twice with the same settings, did NOT give
 * byte-identical segments on the machines tested. Until a repeat-render test passes, no render may say it is byte-reproducible; flip `verified`
 * only with that test's result.
 */
export const REPEAT_RENDER = Object.freeze( {
	verified: false,
	reason: 'repeat renders were not byte-identical when tested (frames inside camera crossfades and the end card differed between two renders; cause not found)',
} );

export function assessDeterminism( { mode, encoder, hasEndCard = false, hasCrossfades = false, playbackWasRunning = false, audit = TIME_SOURCE_AUDIT, repeat = REPEAT_RENDER } ) {

	const reasons = [];
	if ( mode !== 'offline' ) reasons.push( 'a realtime capture: wall-clock timing' );
	if ( audit.passed !== true ) reasons.push( 'the time-source audit did not pass' );
	if ( encoder !== 'software' ) reasons.push( 'a hardware encoder: its bytes are not promised to repeat' );
	if ( hasEndCard ) reasons.push( 'the scene shows the live end card (a web page rasterised at render time)' );
	if ( hasCrossfades ) reasons.push( 'the shot sequence has camera crossfades: frames inside a transition depended on render history when measured' );
	if ( playbackWasRunning ) reasons.push( 'playback was running when the render started' );
	if ( repeat.verified !== true ) reasons.push( repeat.reason );
	return { deterministic: reasons.length === 0, reasons };

}

export const LIMITS = Object.freeze( {
	segmentBytes: 20 * 1024 * 1024,        // jsDelivr's cap per file served from a repo
	fileBytes: 100 * 1024 * 1024,          // GitHub's hard limit per file
	warnTotalBytes: 100 * 1024 * 1024,     // warn before a commit larger than this
} );

const MB = 1024 * 1024;
export const formatBytes = n => n >= MB ? ( n / MB ).toFixed( n >= 10 * MB ? 0 : 1 ) + ' MB' : n >= 1024 ? Math.round( n / 1024 ) + ' KB' : n + ' B';

/** deterministic is derived, never typed in. */

/**
 * @param {object} i
 *   scene:   { repo, file, branch, commit|null, hash }
 *   render:  { mode, renderer, device, fps, frames, frameRange:[a,b], width, height, seed?, renderedAt, durationS? }
 *   renditions: [{ name, width, height, bitrateKbps, playlist, segments, maxSegmentBytes }]
 *   audio:   null, or { name, language, bitrateKbps, sampleRate, channels, playlist, segments, maxSegmentBytes, durationS, source: { path, sha256, tool?, voice?, model? }, delaySamples }
 *   download: null, or { name, bytes (Uint8Array), command, audio, captions, videoFrom ('master' or a rung name) }: one MP4 with the video copied, AAC audio and a soft caption track
 *   determinism: assessDeterminism() output; render.encoder: 'software' | 'hardware'
 *   files:   [{ path, bytes }]  every file of the set, for the size checks
 */
export function buildRenderJson( { scene, render, renditions, files, poster = 'poster.jpg', captions = null, audio = null, download = null, determinism, audit = TIME_SOURCE_AUDIT } ) {

	const durationS = render.durationS !== undefined ? render.durationS : render.frames / render.fps;
	const out = {
		version: RENDER_JSON_VERSION,
		scene: { repo: scene.repo, file: scene.file, branch: scene.branch, commit: scene.commit || null, hash: scene.hash },
		render: {
			mode: render.mode,
			deterministic: determinism.deterministic,
			encoder: render.encoder,
			renderer: render.renderer,
			device: render.device,
			fps: render.fps,
			frames: render.frames,
			frame_range: render.frameRange,
			duration_s: Math.round( durationS * 1e6 ) / 1e6,
			width: render.width,
			height: render.height,
			seed: render.seed === undefined ? null : render.seed,
			exporter: EXPORTER,
			rendered_at: render.renderedAt,
			time_source_audit: { document: audit.document, passed: audit.passed, residuals_accepted: audit.residuals.filter( r => r.status === 'accepted' ).map( r => r.id ) },
			not_deterministic_because: determinism.reasons,
		},
		outputs: {
			master: 'master.m3u8',
			renditions: renditions.map( r => ( {
				name: r.name, width: r.width, height: r.height, bitrate_kbps: r.bitrateKbps,
				playlist: r.playlist, segments: r.segments, max_segment_bytes: r.maxSegmentBytes,
			} ) ),
			poster,
			captions,
			audio: audio ? {
				name: audio.name, language: audio.language, codec: 'mp4a.40.2', sample_rate: audio.sampleRate, channels: audio.channels, bitrate_kbps: audio.bitrateKbps,
				playlist: audio.playlist, segments: audio.segments, max_segment_bytes: audio.maxSegmentBytes, duration_s: Math.round( audio.durationS * 1e6 ) / 1e6,
				source: audio.source, encoder_delay_samples: audio.delaySamples,
			} : null,
			...( download ? { file: {
				path: download.name, bytes: download.bytes.length, container: 'mp4', video: `copied from the ${ download.videoFrom && download.videoFrom !== 'master' ? download.videoFrom + ' rung' : 'master' }, not re-encoded`,
				audio: download.audio ? 'aac-lc, 48 kHz stereo, 128 kbps' : null, captions: download.captions ? 'mov_text, a soft track the viewer can switch off' : null,
				made_by: 'ffmpeg.webcli.app', command: download.command,
			} } : {} ),
		},
		checks: {
			segments_under_20mb: renditions.every( r => r.maxSegmentBytes < LIMITS.segmentBytes ),
			files_under_100mb: files.every( f => f.bytes < LIMITS.fileBytes ),
			frame_count_matches_duration: render.frames === Math.round( durationS * render.fps ),
			...( audio ? { audio_duration_matches_video: Math.abs( audio.durationS - durationS ) < 0.05 } : {} ),
		},
	};
	return out;

}

const isStr = v => typeof v === 'string' && v.length > 0;
const isInt = v => Number.isInteger( v ) && v >= 0;
const isPos = v => typeof v === 'number' && Number.isFinite( v ) && v > 0;

/** Validates a render.json against the schema in docs/schemas/render.schema.json (kept in step by a test). Returns [] when valid. */
export function validateRenderJson( j ) {

	const e = [];
	const need = ( cond, msg ) => { if ( ! cond ) e.push( msg ); };
	need( j && j.version === RENDER_JSON_VERSION, 'version must be 1' );
	if ( ! j || typeof j !== 'object' ) return e;

	const s = j.scene || {};
	need( isStr( s.repo ) && /^[^/\s]+\/[^/\s]+$/.test( s.repo ), 'scene.repo must be owner/name' );
	need( isStr( s.file ), 'scene.file is required' );
	need( isStr( s.branch ), 'scene.branch is required' );
	need( s.commit === null || /^[0-9a-f]{7,40}$/.test( s.commit || '' ), 'scene.commit must be a hex sha or null' );
	need( /^sha256:[0-9a-f]{64}$/.test( s.hash || '' ), 'scene.hash must be sha256:<64 hex>' );

	const r = j.render || {};
	need( r.mode === 'offline' || r.mode === 'realtime', 'render.mode must be offline or realtime' );
	need( typeof r.deterministic === 'boolean', 'render.deterministic must be a boolean' );
	need( ! r.deterministic || r.mode === 'offline', 'render.deterministic is true only for mode offline' );
	need( r.encoder === 'software' || r.encoder === 'hardware', 'render.encoder must be software or hardware' );
	need( ! r.deterministic || r.encoder === 'software', 'render.deterministic is true only with the software encoder' );
	need( Array.isArray( r.not_deterministic_because ), 'render.not_deterministic_because must be a list' );
	need( ! r.deterministic || ( Array.isArray( r.not_deterministic_because ) && r.not_deterministic_because.length === 0 ), 'a deterministic render has no reasons against it' );
	need( r.deterministic || ( Array.isArray( r.not_deterministic_because ) && r.not_deterministic_because.length > 0 ), 'a render that is not deterministic says why' );
	need( r.time_source_audit && Array.isArray( r.time_source_audit.residuals_accepted ), 'render.time_source_audit.residuals_accepted is required' );
	need( isStr( r.renderer ) && isStr( r.device ) && isStr( r.exporter ), 'render.renderer, device and exporter are required' );
	need( isPos( r.fps ), 'render.fps must be positive' );
	need( isInt( r.frames ) && r.frames > 0, 'render.frames must be a positive integer' );
	need( Array.isArray( r.frame_range ) && r.frame_range.length === 2 && isInt( r.frame_range[ 0 ] ) && isInt( r.frame_range[ 1 ] ) && r.frame_range[ 1 ] - r.frame_range[ 0 ] + 1 === r.frames, 'render.frame_range must be [first, last] covering render.frames frames' );
	need( isPos( r.duration_s ), 'render.duration_s must be positive' );
	need( r.mode !== 'offline' || r.frames === Math.round( r.duration_s * r.fps ), 'an offline render has frames == round(duration_s * fps)' );
	need( isInt( r.width ) && isInt( r.height ) && r.width > 0 && r.height > 0, 'render.width and height must be positive integers' );
	need( r.seed === null || typeof r.seed === 'number', 'render.seed must be a number or null' );
	need( isStr( r.rendered_at ) && ! Number.isNaN( Date.parse( r.rendered_at ) ), 'render.rendered_at must be an ISO date' );

	const o = j.outputs || {};
	need( o.master === 'master.m3u8', 'outputs.master must be master.m3u8' );
	need( Array.isArray( o.renditions ) && o.renditions.length > 0, 'outputs.renditions must list at least one rendition' );
	for ( const x of o.renditions || [] ) {

		need( isStr( x.name ) && isInt( x.width ) && isInt( x.height ) && isPos( x.bitrate_kbps ), `rendition ${ x && x.name }: name, width, height and bitrate_kbps are required` );
		need( isStr( x.playlist ) && isInt( x.segments ) && x.segments > 0 && isInt( x.max_segment_bytes ), `rendition ${ x && x.name }: playlist, segments and max_segment_bytes are required` );

	}
	need( isStr( o.poster ), 'outputs.poster is required' );
	need( o.captions === null || isStr( o.captions ), 'outputs.captions must be a path or null' );
	if ( o.audio !== null && o.audio !== undefined ) {

		const a = o.audio;
		need( a.codec === 'mp4a.40.2' && isStr( a.playlist ) && isInt( a.segments ) && a.segments > 0 && isInt( a.max_segment_bytes ) && isPos( a.duration_s ) && isPos( a.sample_rate ) && isPos( a.channels ) && isPos( a.bitrate_kbps ), 'outputs.audio: codec, playlist, segments, max_segment_bytes, duration_s, sample_rate, channels and bitrate_kbps are required' );
		need( a.source && isStr( a.source.path ) && /^sha256:[0-9a-f]{64}$/.test( a.source.sha256 || '' ), 'outputs.audio.source needs a path and a sha256' );

	}

	const c = j.checks || {};
	for ( const k of [ 'segments_under_20mb', 'files_under_100mb', 'frame_count_matches_duration' ] ) need( typeof c[ k ] === 'boolean', `checks.${ k } must be a boolean` );
	if ( o.file !== undefined ) need( o.file && isStr( o.file.path ) && isInt( o.file.bytes ) && o.file.bytes > 0 && o.file.container === 'mp4' && isStr( o.file.made_by ), 'outputs.file needs path, bytes, container mp4 and made_by' );
	need( ! o.audio || typeof c.audio_duration_matches_video === 'boolean', 'checks.audio_duration_matches_video is required when there is audio' );
	return e;

}
