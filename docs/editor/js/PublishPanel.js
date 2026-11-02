// ── PublishPanel.js ────────────────────────────────────────────────────────────
// The Render tab's Publish step: after a finished offline render, encode the ladder, show exactly what will be written (a file tree
// with sizes), say whether the scene has changed since the render, warn about size with real numbers, and commit the whole set as
// ONE commit. Nothing is uploaded until the button is pressed.
//
//   panel.setRender( info )   a finished full-range offline render is available
//   panel.clear()             a new render started: the old one is gone
//
// info: { width, height, fps, frames, samples, keyframes (0-based), avcC, sceneHash, source, renderer, device, renderedAt, cues, burned, baseName,
//         encoder: 'software' | 'hardware', playbackWasRunning, hasEndCard, audioRef: { src, language, label } | null, uncommitted, masterBlob }

import { UIButton, UICheckbox, UIInput, UISelect } from './libs/ui.js';
import { sceneHash } from './export/canonical.js';
import { transcodeLadder } from './export/ladder.js';
import { planLadder, assemblePublishSet, defaultPublishPath, stalenessLine } from './export/publishSet.js';
import { sceneSlug, planRelease, commitRelease, gateRelease, releaseBase, pinnedUrl, playerLink, ReleaseError, STORAGE } from './export/releases.js';
import { cueTrack } from './export/captions.js';
import { EXPORTER } from './export/renderJson.js';
import { formatBytes } from './export/renderJson.js';
import { buildAudioRendition, aacSupport, probeAudio } from './export/audio.js';
import { openTool, toolFor } from './export/handoff.js';
import { cuesToSrt } from './intelligence/subtitles.js';
import { dubCues } from './export/dubCues.js';
import { publishSource, commitPublishToRepo, fetchRepoFile, githubApi, defaultRendersRepo } from './Menubar.Git.js';

const FIELD = 'display:flex;align-items:center;gap:6px;margin:4px 0;font-size:12px;';
const LABEL = 'width:64px;flex:none;opacity:0.8;';
const NOTE = 'font-size:11px;line-height:1.45;margin:4px 0;';

function el( tag, css, text ) {

	const e = document.createElement( tag );
	if ( css ) e.style.cssText = css;
	if ( text !== undefined ) e.textContent = text;
	return e;

}

function iconButton( icon, label ) {

	const b = new UIButton();
	b.dom.innerHTML = `<i class="fa-solid fa-${ icon } btn-icon" aria-hidden="true"></i>`;
	if ( label ) b.dom.appendChild( document.createTextNode( label ) );
	return b;

}

export function createPublishPanel( editor ) {

	const root = el( 'div', 'display:none;margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,0.35);' );
	root.id = 'publish-panel';

	const heading = el( 'div', 'font-weight:bold;margin-bottom:4px;' );
	heading.innerHTML = '<i class="fa-solid fa-cloud-arrow-up btn-icon" aria-hidden="true"></i>Publish this render';
	root.appendChild( heading );
	root.appendChild( el( 'div', NOTE + 'opacity:0.8;', 'Encodes a 1080 / 720 / 480 ladder as fragmented MP4 segments with HLS playlists, a poster, captions and render.json, then publishes all of it as one new version (a tag that never moves) in your renders repository.' ) );
	const stateChip = el( 'div', NOTE + 'font-weight:bold;' );
	root.appendChild( stateChip );
	const setState = ( text, color ) => { stateChip.textContent = text; stateChip.style.color = color || ''; };

	const stale = el( 'div', NOTE + 'font-weight:bold;' );
	root.appendChild( stale );

	// ── where ──
	// Two layouts. The renders repository is the default: scenes stay small and clonable, every render is a new immutable tag. The scene's own repo (renders/<scene>/,
	// untagged, pinned by commit) is the legacy layout: it stays available, and it is an explicit choice.
	const where = el( 'div' );
	const modeSelect = new UISelect().setOptions( { renders: 'Renders repository (recommended)', source: 'Scene\u2019s repo, legacy layout (no tag)' } ).setValue( 'renders' );
	modeSelect.dom.style.flex = '1';
	const repoInput = new UIInput( '' );
	repoInput.dom.style.flex = '1';
	const branchSelect = new UISelect().setOptions( { same: 'Scene\u2019s branch', renders: 'A separate "renders" branch' } ).setValue( 'same' );
	const pathInput = new UIInput( '' );
	pathInput.dom.style.flex = '1';
	const rows = {};
	for ( const [ key, label, control ] of [ [ 'mode', 'Publish to', modeSelect ], [ 'repo', 'Repo', repoInput ], [ 'branch', 'Branch', branchSelect ], [ 'path', 'Folder', pathInput ] ] ) {

		const row = el( 'div', FIELD );
		row.appendChild( el( 'span', LABEL, label ) );
		row.appendChild( control.dom );
		where.appendChild( row );
		rows[ key ] = row;

	}
	const planLine = el( 'div', NOTE + 'font-weight:bold;' );
	where.appendChild( planLine );
	root.appendChild( where );

	// ── ladder ──
	const ladderRow = el( 'div', FIELD + 'flex-wrap:wrap;' );
	root.appendChild( ladderRow );
	let rungBoxes = [];

	// ── narration (when the scene declares one) ──
	// Two ways to get one: upload a WAV (the button, or drop a file on the row: a native file dialog never appears in some embedded browsers, a drop always works),
	// or have dub.webcli.app speak the subtitles.
	const narrationRow = el( 'div', 'display:none;flex-direction:column;gap:6px;margin:6px 0;padding:6px 8px;border:1px solid rgba(128,128,128,0.35);border-radius:6px;font-size:12px;' );
	const narrationText = el( 'div', 'min-height:16px;line-height:1.4;' );
	const narrationFile = el( 'input' );
	narrationFile.type = 'file';
	narrationFile.accept = 'audio/*,.wav';
	narrationFile.style.display = 'none';
	const uploadButton = iconButton( 'upload', 'Upload a WAV' );
	uploadButton.dom.title = 'Choose a WAV (or MP3 or M4A) as the narration, instead of the scene\u2019s.';
	const dropHint = el( 'span', 'opacity:0.6;font-size:11px;', 'or drop a file here' );
	const dubVoice = new UIInput( 'af_heart' );
	dubVoice.dom.style.cssText = 'width:74px;font-size:11px;';
	dubVoice.dom.title = 'A Kokoro voice id, e.g. af_heart, af_sarah, bf_emma';
	const dubButton = iconButton( 'microphone', 'Generate with dub.webcli.app' );
	dubButton.dom.title = 'Opens dub.webcli.app in a window. It speaks the subtitle cues with Kokoro in your browser and sends the timed WAV back; nothing is uploaded.';
	const upRow = el( 'div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' );
	upRow.append( uploadButton.dom, dropHint, narrationFile );
	const dubRow = el( 'div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' );
	const voiceLine = el( 'div', 'display:flex;align-items:center;gap:6px;flex:1 1 100%;' );
	voiceLine.append( el( 'span', 'opacity:0.7;font-size:11px;', 'Voice' ), dubVoice.dom );
	dubRow.append( voiceLine, dubButton.dom );
	narrationRow.append( el( 'div', 'font-weight:bold;', 'Narration audio' ), narrationText, upRow, dubRow );
	root.appendChild( narrationRow );
	uploadButton.onClick( () => narrationFile.click() );
	let captionTracks = [];             // the cue-derived caption files of the set being prepared (captions.js)
	let narrationOverride = null;     // bytes of a file the user chose, or dub.webcli.app made, instead of the repo's
	let narrationSource = null;       // { tool, voice, model, summary } when dub.webcli.app made it
	/**
	 * Takes a narration the person supplied: `read` resolves its bytes. It is decoded now, so a file the browser cannot read is refused here, with the reason,
	 * not at Prepare. Two ways in, because the editor can run where a native file dialog never appears (VS Code's built-in browser): the Upload button,
	 * and a file dropped on the narration box.
	 */
	async function useNarration( name, read ) {

		narrationSource = null;
		prepared = null; review.style.display = 'none';
		narrationText.textContent = `Reading ${ name }\u2026`;
		try {

			const bytes = new Uint8Array( await read() );
			const { seconds } = await probeAudio( bytes );
			narrationOverride = bytes;
			const film = info ? info.frames / info.fps : 0;
			const length = film && seconds > film + 0.05 ? ` It is ${ ( seconds - film ).toFixed( 1 ) } s longer than the film (${ film.toFixed( 1 ) } s), so the end is cut off.` : '';
			narrationText.textContent = `Using ${ name } (${ seconds.toFixed( 1 ) } s) instead of the repo\u2019s file.${ length } It is encoded when you press Prepare publish.`;

		} catch ( e ) {

			narrationOverride = null;
			narrationFile.value = '';
			narrationText.textContent = `${ name } was not used: ${ e && e.message ? e.message : e }.`;

		}

	}
	narrationFile.addEventListener( 'change', () => {

		const f = narrationFile.files && narrationFile.files[ 0 ];
		if ( ! f ) { narrationOverride = null; narrationSource = null; narrationText.textContent = describeNarration(); return; }
		useNarration( f.name, () => f.arrayBuffer() );

	} );
	const takeFile = f => { narrationFile.value = ''; useNarration( f.name || 'the dropped file', () => f.arrayBuffer() ); };
	narrationRow.addEventListener( 'dragover', e => { if ( e.dataTransfer && [ ...e.dataTransfer.types ].includes( 'Files' ) ) { e.preventDefault(); narrationRow.style.outline = '2px dashed #08f'; narrationRow.style.outlineOffset = '-2px'; } } );
	narrationRow.addEventListener( 'dragleave', () => { narrationRow.style.outline = ''; } );
	narrationRow.addEventListener( 'drop', e => {

		narrationRow.style.outline = '';
		const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[ 0 ];
		if ( ! f ) return;
		e.preventDefault();
		e.stopPropagation();     // the editor imports anything dropped on the page: a narration is not a model
		takeFile( f );

	} );
	const describeNarration = () => narrationSource ? narrationSource.summary : info && info.audioRef ? `Narration: ${ info.audioRef.src } (${ info.audioRef.label || info.audioRef.language }), from the scene.` : 'No narration: the scene declares none (setRenderAudio), so the set is silent. Upload a WAV, or generate one with dub.webcli.app.';

	// ── prepare ──
	const buttons = el( 'div', 'margin:6px 0;display:flex;gap:6px;flex-wrap:wrap;' );
	const prepareButton = iconButton( 'gears', 'Prepare publish' );
	const cancelButton = iconButton( 'xmark', 'Cancel' );
	cancelButton.dom.style.display = 'none';
	const checkButton = iconButton( 'rotate', 'Check scene' );
	buttons.append( prepareButton.dom, cancelButton.dom, checkButton.dom );
	root.appendChild( buttons );

	const status = el( 'div', 'font-size:11px;opacity:0.8;min-height:14px;' );
	const bar = el( 'div', 'height:6px;background:rgba(128,128,128,0.25);border-radius:3px;overflow:hidden;margin:4px 0;display:none;' );
	const barInner = el( 'div', 'height:100%;width:0%;background:#08f;' );
	bar.appendChild( barInner );
	root.append( bar, status );

	// ── what will be written ──
	const review = el( 'div', 'display:none;' );
	const treeBox = el( 'div', 'max-height:170px;overflow:auto;font:11px/1.5 ui-monospace,Menlo,monospace;border:1px solid rgba(128,128,128,0.35);border-radius:4px;padding:4px 6px;margin:6px 0;white-space:pre;' );
	const errorsBox = el( 'div', NOTE + 'color:#e5484d;' );
	const warningsBox = el( 'div', NOTE + 'color:#e0a000;' );
	const commitRow = el( 'div', 'margin:6px 0;' );
	const commitButton = iconButton( 'code-commit', 'Commit to repo' );
	commitRow.appendChild( commitButton.dom );
	const resultBox = el( 'div', NOTE );
	const mp4Row = el( 'div', 'margin:6px 0;' );
	const mp4Source = new UISelect();
	mp4Source.dom.style.cssText = 'max-width:220px;margin-right:6px;font-size:11px;';
	mp4Source.dom.title = 'Which video the MP4 carries. A rung is smaller; the master is the best quality. jsDelivr will not serve a file over 20 MB.';
	const mp4Button = iconButton( 'film', 'Add a single-file MP4 (ffmpeg.webcli.app)' );
	mp4Button.dom.title = 'Opens ffmpeg.webcli.app in a window. It copies the video (no re-encode), encodes the narration to AAC and adds the captions as a soft track, then sends one MP4 back; nothing is uploaded.';
	const mp4Note = el( 'div', NOTE + 'opacity:0.8;', 'Optional: one MP4 next to the HLS set, with the narration and a caption track the viewer can switch off.' );
	mp4Row.append( mp4Source.dom, mp4Button.dom, mp4Note );
	review.append( treeBox, errorsBox, warningsBox, mp4Row, commitRow, resultBox );
	root.appendChild( review );

	// ── state ──
	let info = null;          // the render being published
	let prepared = null;      // the set built by Prepare
	let currentHash = null;
	let build = null;         // ( download | null ) => the set; lets the MP4 be added without redoing the ladder
	let narrationBytes = null;    // the WAV the prepared set was built from
	let mp4Sources = [];          // what the single-file MP4 can carry: each rung of the ladder, or the master
	let busy = false;
	let cancelRequested = false;
	let currentPlan = null;       // planRelease()'s answer for the set being prepared: which tag it will be published as

	const setStatus = ( text, fraction ) => {

		status.textContent = text || '';
		if ( fraction === undefined ) { bar.style.display = 'none'; return; }
		bar.style.display = '';
		barInner.style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';

	};

	const isRenders = () => modeSelect.getValue() === 'renders';

	function target() {

		const src = info && info.source;
		if ( isRenders() ) {

			// the renders repository: its default branch, and the folder is the scene's slug (the tag namespace)
			return { storage: STORAGE.renders, repo: repoInput.getValue().trim() || defaultRendersRepo(), branch: 'main', createFrom: null, path: sceneSlug( ( src && src.file ) || 'scene.json' ) };

		}
		const repo = repoInput.getValue().trim() || ( src && src.repo ) || '';
		const branchName = branchSelect.getValue() === 'renders' ? 'renders' : ( src && src.branch ) || 'main';
		return { storage: STORAGE.source, repo, branch: branchName, createFrom: branchSelect.getValue() === 'renders' ? ( ( src && src.branch ) || 'main' ) : null, path: pathInput.getValue().trim().replace( /^\/+|\/+$/g, '' ) };

	}

	/** Shows the fields of the layout in use: the renders repo has no branch or folder to choose. */
	function layoutChanged() {

		const renders = isRenders();
		rows.branch.style.display = renders ? 'none' : '';
		pathInput.dom.disabled = renders;
		const src = info && info.source;
		if ( renders ) { repoInput.dom.placeholder = defaultRendersRepo() || 'owner/renders'; pathInput.setValue( sceneSlug( ( src && src.file ) || 'scene.json' ) ); }
		else { repoInput.dom.placeholder = 'owner/name (blank: the scene\u2019s repo)'; pathInput.setValue( defaultPublishPath( ( src && src.file ) || 'scene.json' ) ); }
		prepared = null; currentPlan = null; review.style.display = 'none'; planLine.textContent = '';
		refreshCommit();

	}

	async function refreshStaleness() {

		if ( ! info ) return null;
		try { currentHash = await sceneHash( editor.toJSON() ); } catch ( e ) { currentHash = null; }
		const s = stalenessLine( info.sceneHash, currentHash );
		stale.textContent = s.text;
		stale.style.color = s.stale ? '#e0a000' : '#2ea44f';
		refreshCommit();
		return s;

	}

	function refreshCommit() {

		const src = publishSource();
		const t = target();
		const errors = prepared ? prepared.gate.failures : [];
		const noToken = ! ( src && src.hasToken );
		const isStale = info && stalenessLine( info.sceneHash, currentHash ).stale;
		commitButton.dom.disabled = ! prepared || errors.length > 0 || noToken || busy;
		const what = isRenders() ? ( currentPlan ? `Publish as ${ currentPlan.tag }` : 'Publish' ) : `Commit to ${ t.repo || '?' }@${ t.branch }`;
		commitButton.dom.innerHTML = '<i class="fa-solid fa-code-commit btn-icon" aria-hidden="true"></i>';
		commitButton.dom.append( document.createTextNode( isStale ? 'Publish this stale render anyway' : what ) );
		if ( prepared && noToken ) errorsBox.textContent = [ ...errors, 'A token is required to publish: add one in the Git tab.' ].join( '\n' );

	}

	function renderLadderChoices() {

		ladderRow.innerHTML = '';
		ladderRow.appendChild( el( 'span', LABEL, 'Ladder' ) );
		rungBoxes = [];
		for ( const rung of planLadder( { width: info.width, height: info.height, fps: info.fps } ) ) {

			const box = new UICheckbox( true );
			box.dom.addEventListener( 'change', () => { prepared = null; review.style.display = 'none'; } );
			const label = el( 'label', 'display:flex;align-items:center;gap:3px;' );
			label.append( box.dom, document.createTextNode( `${ rung.height }p (${ rung.kbps / 1000 } Mbps)` ) );
			ladderRow.appendChild( label );
			rungBoxes.push( { rung, box } );

		}

	}

	/** Fill the review with a built set: the tree, the gates, the warnings (the notes about this particular render come last). */
	function showSet( set ) {

		prepared = set;
		root.dispatchEvent( new CustomEvent( 'publish-prepared', { detail: set } ) );     // for tests and tools: the set as it will be committed
		treeBox.textContent = set.tree.map( f => `${ formatBytes( f.bytes ).padStart( 8 ) }  ${ f.path }` ).join( '\n' ) + `\n${ formatBytes( set.total ).padStart( 8 ) }  total, ${ set.tree.length } files`;
		// R6: a failed check blocks the publish. It is not a warning.
		set.gate = gateRelease( { renderJson: set.renderJson, errors: set.errors } );
		errorsBox.textContent = set.gate.failures.join( '\n' );
		const notes = [];
		const det = set.renderJson.render.determinism;
		if ( ! det.frames ) notes.push( 'Frames not claimed deterministic: ' + det.reasons.frames.join( '; ' ) + '. The duration and frame count are still exact (frame n shows n / fps).' );
		if ( ! det.bytes ) notes.push( 'Bytes not promised to repeat: ' + det.reasons.bytes.join( '; ' ) + '.' );
		if ( info.height < 1080 || info.fps < 60 ) notes.push( `This master is ${ info.width }\u00d7${ info.height } at ${ info.fps } fps, so the ladder has ${ set.renderJson.outputs.renditions.length } rung(s). Render at 1920 \u00d7 1080 and 60 fps for the full ladder.` );
		if ( info.burned ) notes.push( 'Subtitles are burned into the picture and captions.vtt is published as well: players that show the caption track will show the words twice.' );
		if ( info.cues.length === 0 ) notes.push( 'The scene has no subtitle cues, so there is no captions.vtt.' );
		warningsBox.textContent = [ ...set.warnings, ...notes ].join( '\n\n' );
		review.style.display = '';
		resultBox.textContent = '';
		setStatus( ! set.gate.ok ? 'REFUSED: this render fails a check, so it cannot be published as it is.' : `Ready: ${ set.tree.length } files, ${ formatBytes( set.total ) }. Nothing has been uploaded yet.` );
		mp4Row.style.display = narrationBytes || info.cues.length ? '' : 'none';
		if ( mp4Source.dom.options.length !== mp4Sources.length ) {

			// default: the best video that keeps the MP4 under the 20 MB jsDelivr serves (the audio adds about 128 kbps), else the smallest
			const audioBytes = narrationBytes ? 128000 / 8 * ( info.frames / info.fps ) + 100000 : 0;
			const fit = mp4Sources.filter( x => x.size + audioBytes < 19 * 1024 * 1024 ).sort( ( a, b ) => b.size - a.size )[ 0 ] || mp4Sources.slice().sort( ( a, b ) => a.size - b.size )[ 0 ];
			mp4Source.setOptions( Object.fromEntries( mp4Sources.map( x => [ x.key, `${ x.key === 'master' ? 'Master, best quality' : x.key + ' rung' } (${ formatBytes( x.size ) })` ] ) ) );
			if ( fit ) mp4Source.setValue( fit.key );

		}

	}

	function languageCode3() {

		const l = ( prepared && prepared.renderJson.outputs.audio && prepared.renderJson.outputs.audio.language ) || 'en';
		return { en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', ja: 'jpn', zh: 'zho', hi: 'hin' }[ l ] || ( /^[a-z]{3}$/.test( l ) ? l : 'eng' );

	}

	/** dub.webcli.app: the subtitles in, a timed WAV out. Must start from the click, or the browser blocks the window. */
	function dubSubtitles() {

		if ( ! info || busy ) return;
		if ( info.cues.length === 0 ) { setStatus( 'There are no subtitle cues to speak. Add them in the Subtitles tab first.' ); return; }
		let handle;
		try { handle = openTool( toolFor( 'dub' ) ); } catch ( e ) { setStatus( e.message ); return; }
		runDub( handle );

	}

	async function runDub( handle ) {

		busy = true;
		dubButton.dom.disabled = true;
		prepareButton.dom.disabled = true;
		setStatus( 'Dubbing in dub.webcli.app\u2026 the first run downloads the voice model.', 0 );
		try {

			const r = await dubCues( info.cues, handle, { voice: dubVoice.getValue(), name: info.baseName || 'subtitles', onProgress: ( f, text ) => setStatus( 'dub.webcli.app: ' + text, f ) } );
			handle.close();
			narrationOverride = r.wav;
			narrationFile.value = '';
			narrationSource = { tool: 'dub.webcli.app', voice: r.voice, model: r.model, summary: r.summary };
			narrationText.textContent = narrationSource.summary;
			prepared = null; review.style.display = 'none';
			setStatus( 'The narration is ready. Press Prepare publish to encode it into the set.' );

		} catch ( e ) {

			handle.close();
			setStatus( 'Dub failed: ' + ( e && e.message ? e.message : e ) );

		} finally {

			busy = false;
			dubButton.dom.disabled = false;
			prepareButton.dom.disabled = false;

		}

	}

	/** ffmpeg.webcli.app: the master + narration + captions in, one MP4 with a soft caption track out. */
	function muxMp4() {

		if ( ! prepared || busy || ! build ) return;
		let handle;
		try { handle = openTool( toolFor( 'ffmpeg' ) ); } catch ( e ) { setStatus( e.message ); return; }
		runMux( handle );

	}

	async function runMux( handle ) {

		busy = true;
		mp4Button.dom.disabled = true;
		setStatus( 'Muxing in ffmpeg.webcli.app\u2026 the first run downloads ffmpeg.wasm (about 31 MB).', 0 );
		try {

			const source = mp4Sources.find( x => x.key === mp4Source.getValue() );
			if ( ! source ) throw new Error( 'There is no video to put in the MP4.' );
			const files = { 'video.mp4': await source.load() };
			if ( narrationBytes ) files[ 'audio.wav' ] = narrationBytes.slice();   // a copy: sending detaches the buffer
			if ( captionTracks.length ) files[ 'captions.vtt' ] = new TextEncoder().encode( captionTracks[ 0 ].text );     // the very file the set publishes: same ids, same NOTE
			const out = await handle.job( { op: 'mux', args: { language: languageCode3(), audio_kbps: 128 }, files, onProgress: ( f, text ) => setStatus( 'ffmpeg.webcli.app: ' + text, f ) } );
			handle.close();
			const mp4 = out.files[ 'out.mp4' ];
			if ( ! mp4 || mp4.length < 1000 || String.fromCharCode( ...mp4.slice( 4, 8 ) ) !== 'ftyp' ) throw new Error( 'ffmpeg.webcli.app did not send a valid MP4.' );
			const name = ( target().path.split( '/' ).pop() || 'render' ) + '.mp4';
			showSet( build( { name, bytes: mp4, command: out.meta.command || '', audio: !! narrationBytes, captions: info.cues.length > 0, videoFrom: source.key } ) );

		} catch ( e ) {

			handle.close();
			setStatus( 'The MP4 could not be made: ' + ( e && e.message ? e.message : e ) );

		} finally {

			busy = false;
			mp4Button.dom.disabled = false;
			refreshCommit();

		}

	}

	async function prepare() {

		if ( ! info || busy ) return;
		const chosen = rungBoxes.filter( r => r.box.getValue() ).map( r => r.rung );
		if ( chosen.length === 0 ) { setStatus( 'Keep at least one rung of the ladder.' ); return; }
		const t = target();
		if ( ! /^[^/\s]+\/[^/\s]+$/.test( t.repo ) ) { setStatus( isRenders() ? 'Set the renders repository as owner/name (the default is <owner of the scene repo>/renders, which needs a scene repo set in the Git tab).' : 'Set a repository: in the Git tab, or here as owner/name.' ); return; }
		if ( ! t.path ) { setStatus( 'Set a path to publish under.' ); return; }

		busy = true;
		cancelRequested = false;
		prepared = null;
		review.style.display = 'none';
		prepareButton.dom.disabled = true;
		cancelButton.dom.style.display = '';
		setStatus( 'Preparing\u2026', 0 );
		try {

			await refreshStaleness();
			// Provenance: the commit this render came from. It is the render-time one if the scene was synced then, or the current one if the scene
			// is unchanged since and has been committed since; otherwise the render cannot be traced to a repo state, and publishing is blocked.
			const nowSource = publishSource();
			const cleanNow = ! ( editor.work && editor.work.isDirty() );
			let commitSha = null;
			if ( currentHash && currentHash === info.sceneHash && cleanNow && nowSource && nowSource.commit ) commitSha = nowSource.commit;
			else if ( info.source && info.source.commit && ! info.uncommitted ) commitSha = info.source.commit;
			if ( ! commitSha ) {

				setStatus( 'Sync the scene first: this render cannot name the commit it came from' + ( info.uncommitted || ! cleanNow ? ', because the scene has changes that are not committed.' : ', because the scene is not synced to a commit.' ) + ' Commit the scene from the Git tab (the render stays valid while the scene is unchanged), then press Prepare again.' );
				return;

			}
			const hasNarration = !! ( info.audioRef || narrationOverride );
			const audioSupport = hasNarration ? await aacSupport() : { ok: true };
			if ( ! audioSupport.ok ) { setStatus( 'This scene has narration, and ' + audioSupport.reason ); return; }

			const result = await transcodeLadder( {
				master: { width: info.width, height: info.height, fps: info.fps, samples: info.samples, keyframes: info.keyframes, avcC: info.avcC },
				ladder: chosen,
				onProgress: ( f, text ) => setStatus( text, f ),
				shouldCancel: () => cancelRequested,
				software: info.encoder === 'software',
			} );
			if ( ! result ) { setStatus( 'Publish cancelled.' ); return; }

			const concat = ( parts ) => { const out = new Uint8Array( parts.reduce( ( n, p ) => n + p.length, 0 ) ); let o = 0; for ( const p of parts ) { out.set( p, o ); o += p.length; } return out; };
			mp4Sources = [
				...result.rungs.map( r => ( { key: r.rung.name, size: r.packaged.segments.reduce( ( n, sg ) => n + sg.data.length, r.packaged.init.length ), load: async () => concat( [ r.packaged.init, ...r.packaged.segments.map( sg => sg.data ) ] ) } ) ),
				...( info.masterBlob ? [ { key: 'master', size: info.masterBlob.size, load: async () => new Uint8Array( await info.masterBlob.arrayBuffer() ) } ] : [] ),
			];

			mp4Source.dom.innerHTML = '';
			let audio = null;
			narrationBytes = null;
			if ( hasNarration ) {

				setStatus( 'Loading the narration\u2026', 0 );
				let bytes = narrationOverride;
				if ( ! bytes ) {

					try { bytes = await fetchRepoFile( info.audioRef.src ); } catch ( e ) {

						throw new Error( `The scene's narration ${ info.audioRef.src } could not be read from the repo (${ e.message }). Commit that file, or upload one below.` );

					}

				}
				const digest = await crypto.subtle.digest( 'SHA-256', bytes );
				const sha = 'sha256:' + Array.from( new Uint8Array( digest ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				const starts = result.rungs[ 0 ].packaged.segments.map( sg => sg.first / info.fps );
				narrationBytes = bytes;
				const built = await buildAudioRendition( { bytes, durationSeconds: info.frames / info.fps, videoStartsSeconds: starts, onProgress: ( f, text ) => setStatus( text, f ) } );
				const chosenName = narrationFile.files && narrationFile.files[ 0 ] ? narrationFile.files[ 0 ].name : null;
				audio = {
					packaged: built.packaged, name: ( info.audioRef && info.audioRef.label ) || 'English', language: ( info.audioRef && info.audioRef.language ) || 'en', delaySamples: built.delaySamples,
					source: narrationSource
						? { path: 'narration.wav', sha256: sha, tool: narrationSource.tool, voice: narrationSource.voice, model: narrationSource.model }
						: { path: narrationOverride ? ( chosenName || 'narration.wav' ) : info.audioRef.src, sha256: sha },
					wavBytes: narrationSource ? bytes : null,
				};

			}

			// Which tag this will be, and that it is free: read before the ladder is built, because render.json records it. Nothing is written.
			currentPlan = null;
			if ( t.storage === STORAGE.renders ) {

				setStatus( 'Checking the renders repository\u2026' );
				try {

					currentPlan = await planRelease( githubApi(), { repo: t.repo, slug: t.path, branch: t.branch, sceneRepo: ( info.source && info.source.repo ) || null } );

				} catch ( e ) {

					setStatus( e instanceof ReleaseError ? e.message : /404/.test( e.message ) ? `The repository ${ t.repo } was not found (or is private and no token is set). Create it on GitHub (public, one commit is enough), then press Prepare publish again.` : 'Could not read the renders repository: ' + e.message );
					return;

				}
				planLine.textContent = `This will be published as ${ currentPlan.tag }` + ( currentPlan.version > 1 ? ` (the next version after v${ currentPlan.version - 1 })` : ' (the first version)' ) + '.';

			} else planLine.textContent = 'Legacy layout: committed to the scene repo with no tag, pinned by the commit it lands in.';

			const src = { ...( info.source || {} ), commit: commitSha };
			const sceneRec = { repo: ( src && src.repo ) || t.repo, file: ( src && src.file ) || '', branch: ( src && src.branch ) || t.branch, commit: src && src.commit, hash: info.sceneHash };
			// The captions are a projection of the scene's cue list, written with the cue ids as WebVTT identifiers and a NOTE saying what they were made from.
			// A cue with a missing, malformed or duplicate id stops the publish here, with the cue named: nothing renumbers it.
			captionTracks = info.cues.length ? [ await cueTrack( { cues: info.cues, language: ( info.audioRef && info.audioRef.language ) || 'en', scene: sceneRec, exporter: EXPORTER } ) ].filter( Boolean ) : [];
			build = ( download ) => assemblePublishSet( {
				path: t.path,
				scene: sceneRec,
				render: { mode: 'offline', renderer: info.renderer, device: info.device, encoder: info.encoder, fps: info.fps, frames: info.frames, frameRange: [ 0, info.frames - 1 ], width: info.width, height: info.height, renderedAt: info.renderedAt },
				rungs: result.rungs, poster: result.poster,
				// always written when there are cues: burning them in is an extra, never a way to skip the file (burned-in text cannot be switched off, styled, read aloud or translated)
				captionTracks,
				audio, download,
				determinism: { mode: 'offline', encoder: info.encoder, hasEndCard: info.hasEndCard, playbackWasRunning: info.playbackWasRunning, verification: info.verification || null },
				frameHashes: info.frameHashes || null, endCard: info.endCard || null,
				publication: { storage: t.storage, repo: t.repo, tag: currentPlan ? currentPlan.tag : null },
			} );
			showSet( build( null ) );

		} catch ( e ) {

			console.error( 'Publish prepare failed', e );
			setStatus( 'Could not prepare the publish set: ' + ( e && e.message ? e.message : e ) );

		} finally {

			busy = false;
			prepareButton.dom.disabled = false;
			cancelButton.dom.style.display = 'none';
			refreshCommit();

		}

	}

	async function commit() {

		if ( ! prepared || busy ) return;
		if ( ! prepared.gate.ok ) { setStatus( 'REFUSED: ' + prepared.gate.failures[ 0 ] ); return; }     // belt and braces: the button is disabled too
		busy = true;
		commitButton.dom.disabled = true;
		const t = target();
		const set = prepared;
		let published = null;
		try {

			const message = `Publish render of ${ ( info.source && info.source.file ) || 'scene' }: ${ info.frames } frames at ${ info.fps } fps, ${ set.renderJson.outputs.renditions.map( r => r.name ).join( ', ' ) }`;
			const onProgress = ( f, text ) => setStatus( text, f );
			if ( t.storage === STORAGE.renders ) {

				// planned again with the tag the set was built for: if that tag exists by now the publish is refused and nothing is written
				const api = githubApi( { onWait: seconds => setStatus( `GitHub rate limit \u2014 retrying in ${ seconds }s\u2026` ) } );
				const plan = await planRelease( api, { repo: t.repo, slug: t.path, branch: t.branch, sceneRepo: ( info.source && info.source.repo ) || null, version: currentPlan.version } );
				const out = await commitRelease( api, plan, { files: set.files, message: `${ plan.tag }: ${ message }`, onProgress } );
				published = { storage: t.storage, repo: t.repo, tag: out.tag, commit: out.commit.sha, base: out.base };

			} else {

				const out = await commitPublishToRepo( set.files, message, { repo: t.repo, branch: t.branch, createFrom: t.createFrom }, { onProgress } );
				const sha = out.commit && out.commit.sha;
				published = { storage: t.storage, repo: out.repo, tag: null, commit: sha, base: sha ? pinnedUrl( { repo: out.repo, ref: sha, path: t.path + '/' } ) : null, branch: out.branch, path: t.path };

			}
			showPublished( published, set );
			setStatus( '' );
			root.dispatchEvent( new CustomEvent( 'release-published', { bubbles: true, detail: published } ) );

		} catch ( e ) {

			console.error( 'Publish commit failed', e );
			if ( e instanceof ReleaseError && e.code === 'tag-exists' ) { prepared = null; review.style.display = 'none'; currentPlan = null; setStatus( e.message + ' Press Prepare publish again.' ); }
			else setStatus( 'Publish failed, nothing was published: ' + ( e && e.message ? e.message : e ) );

		} finally {

			busy = false;
			refreshCommit();

		}

	}

	/** The result: the pinned share link is the primary action. The link is to a tag or a commit, never to a branch or @latest. */
	function showPublished( p, set ) {

		resultBox.innerHTML = '';
		const head = el( 'div', 'font-weight:bold;color:#2ea44f;' );
		head.textContent = p.tag ? `\u2713 Published ${ p.tag }` : `\u2713 Committed ${ set.tree.length } files to ${ p.repo }@${ p.branch }/${ p.path } (legacy layout, not tagged)`;
		resultBox.appendChild( head );
		setState( p.tag ? `Published as ${ p.tag }` : `Committed (legacy layout) at ${ ( p.commit || '' ).slice( 0, 7 ) }`, '#2ea44f' );
		if ( ! p.base ) return;
		const share = playerLink( new URL( 'player/', location.href ).href, p.base );
		const line = el( 'div', 'margin:4px 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center;' );
		const copy = iconButton( 'link', 'Copy share link' );
		copy.dom.title = 'A link that plays exactly this render. Pinned to ' + ( p.tag || ( p.commit || '' ).slice( 0, 7 ) ) + '.';
		copy.onClick( async () => { try { await navigator.clipboard.writeText( share ); copy.dom.lastChild.textContent = 'Copied'; } catch ( e ) { window.prompt( 'Copy this pinned link:', share ); } } );
		const a = el( 'a', 'color:inherit;text-decoration:underline;font-size:11px;word-break:break-all;', share );
		a.href = share; a.target = '_blank'; a.rel = 'noopener';
		line.append( copy.dom, a );
		resultBox.appendChild( line );
		const where = el( 'div', NOTE + 'opacity:0.85;' );
		where.append( 'Files: ' );
		const g = el( 'a', 'color:inherit;text-decoration:underline;', p.tag ? `${ p.repo } @ ${ p.tag }` : `${ p.repo }@${ ( p.commit || '' ).slice( 0, 7 ) }` );
		g.href = p.tag ? `https://github.com/${ p.repo }/tree/${ p.tag }` : `https://github.com/${ p.repo }/commit/${ p.commit }`;
		g.target = '_blank'; g.rel = 'noopener';
		where.append( g, p.tag ? '. The tag is permanent: a re-render will be the next version, never a replacement.' : '.' );
		resultBox.appendChild( where );

	}

	prepareButton.onClick( prepare );
	dubButton.onClick( dubSubtitles );
	mp4Button.onClick( muxMp4 );
	cancelButton.onClick( () => { cancelRequested = true; } );
	checkButton.onClick( refreshStaleness );
	commitButton.onClick( commit );
	for ( const c of [ repoInput, pathInput ] ) c.dom.addEventListener( 'input', () => { prepared = null; currentPlan = null; planLine.textContent = ''; review.style.display = 'none'; refreshCommit(); } );
	branchSelect.onChange( () => { prepared = null; review.style.display = 'none'; refreshCommit(); } );
	modeSelect.onChange( layoutChanged );

	return {
		dom: root,
		/** A finished full-range offline render is available to publish. */
		setRender( newInfo ) {

			info = newInfo;
			prepared = null;
			review.style.display = 'none';
			resultBox.textContent = '';
			root.style.display = '';
			currentPlan = null;
			planLine.textContent = '';
			setState( 'Draft: not published. This render exists only in this browser until you publish it.', '#e0a000' );
			layoutChanged();
			renderLadderChoices();
			narrationOverride = null;
			narrationSource = null;
			narrationBytes = null;
			build = null;
			narrationFile.value = '';
			// the Subtitles tab's Dub .srt button already spoke these very cues: use that narration rather than make the person do it again
			const d = editor.lastDub;
			if ( d && d.srt === cuesToSrt( info.cues ) ) { narrationOverride = d.wav; narrationSource = { tool: 'dub.webcli.app', voice: d.voice, model: d.model, summary: d.summary + ' (made in the Subtitles tab)' }; }
			narrationRow.style.display = 'flex';
			narrationText.textContent = describeNarration();
			setStatus( '' );
			const src = publishSource();
			if ( ! src ) setStatus( 'No repository is set in the Git tab: enter owner/name above to publish to.' );
			refreshStaleness();

		},
		clear() {

			info = null;
			prepared = null;
			currentPlan = null;
			root.style.display = 'none';

		},
		/** Render & publish: prepare, then publish if (and only if) every check passes. A failed check stops here with the reason; it does not warn and continue. */
		async publishNow() {

			await prepare();
			if ( ! prepared ) return { published: false, reason: status.textContent };
			if ( ! prepared.gate.ok ) return { published: false, reason: 'REFUSED: ' + prepared.gate.failures.join( '; ' ) };
			const src = publishSource();
			if ( ! ( src && src.hasToken ) ) { setStatus( 'Prepared, but a token is required to publish: add one in the Git tab, then press Publish.' ); return { published: false, reason: 'no token' }; }
			await commit();
			return { published: !! resultBox.textContent && /Published|Committed/.test( resultBox.textContent ), reason: status.textContent };

		},
		/** For tests: the prepared set. */
		get prepared() { return prepared; },
		get info() { return info; },
	};

}
