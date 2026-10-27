// ── renderJson.js ──────────────────────────────────────────────────────────────
// render.json: what a published render says about itself. Pure functions; the Render tab fills them in.
// Four fields must not lie (docs: guides/PUBLISH.md):
//   mode           'offline' (every frame drawn at n / fps) or 'realtime' (a wall-clock capture: variable frame rate)
//   deterministic  true only for an offline render whose time-source audit passed. TEMPORAL determinism: frame n shows
//                  timeline time n / fps and the duration is exact. It is NOT a claim about pixels: GPUs differ in the last bit.
//   scene.hash     canonical hash of the scene at render time (canonical.js): the staleness check
//   frames         frames == round(duration_s * fps), or the capture is variable-rate and mode says 'realtime'

export const RENDER_JSON_VERSION = 1;
export const EXPORTER = 'strata-export/1.0.0';

/** The time-source audit (guides/TIME_SOURCES.md): every hit has a disposition, and three residuals are stated, not hidden. */
export const TIME_SOURCE_AUDIT = Object.freeze( {
	document: 'guides/TIME_SOURCES.md',
	passed: true,
	residuals: Object.freeze( [ 'Shell wall-clock loops are not caught', 'the live end card is re-baked each render', 'rendering while playback is running differs by a few hundred pixels per frame' ] ),
} );

export const LIMITS = Object.freeze( {
	segmentBytes: 20 * 1024 * 1024,        // jsDelivr's cap per file served from a repo
	fileBytes: 100 * 1024 * 1024,          // GitHub's hard limit per file
	warnTotalBytes: 100 * 1024 * 1024,     // warn before a commit larger than this
} );

const MB = 1024 * 1024;
export const formatBytes = n => n >= MB ? ( n / MB ).toFixed( n >= 10 * MB ? 0 : 1 ) + ' MB' : n >= 1024 ? Math.round( n / 1024 ) + ' KB' : n + ' B';

/** deterministic is derived, never typed in. */
export const isDeterministic = ( mode, audit = TIME_SOURCE_AUDIT ) => mode === 'offline' && audit.passed === true;

/**
 * @param {object} i
 *   scene:   { repo, file, branch, commit|null, hash }
 *   render:  { mode, renderer, device, fps, frames, frameRange:[a,b], width, height, seed?, renderedAt, durationS? }
 *   renditions: [{ name, width, height, bitrateKbps, playlist, segments, maxSegmentBytes }]
 *   files:   [{ path, bytes }]  every file of the set, for the size checks
 */
export function buildRenderJson( { scene, render, renditions, files, poster = 'poster.jpg', captions = null, audit = TIME_SOURCE_AUDIT } ) {

	const durationS = render.durationS !== undefined ? render.durationS : render.frames / render.fps;
	const out = {
		version: RENDER_JSON_VERSION,
		scene: { repo: scene.repo, file: scene.file, branch: scene.branch, commit: scene.commit || null, hash: scene.hash },
		render: {
			mode: render.mode,
			deterministic: isDeterministic( render.mode, audit ),
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
		},
		outputs: {
			master: 'master.m3u8',
			renditions: renditions.map( r => ( {
				name: r.name, width: r.width, height: r.height, bitrate_kbps: r.bitrateKbps,
				playlist: r.playlist, segments: r.segments, max_segment_bytes: r.maxSegmentBytes,
			} ) ),
			poster,
			captions,
		},
		checks: {
			segments_under_20mb: renditions.every( r => r.maxSegmentBytes < LIMITS.segmentBytes ),
			files_under_100mb: files.every( f => f.bytes < LIMITS.fileBytes ),
			frame_count_matches_duration: render.frames === Math.round( durationS * render.fps ),
		},
	};
	if ( out.render.deterministic ) out.render.time_source_audit = { document: audit.document, passed: true, residuals: audit.residuals.length };
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

	const c = j.checks || {};
	for ( const k of [ 'segments_under_20mb', 'files_under_100mb', 'frame_count_matches_duration' ] ) need( typeof c[ k ] === 'boolean', `checks.${ k } must be a boolean` );
	return e;

}
