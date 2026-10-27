// ── PublishPanel.js ────────────────────────────────────────────────────────────
// The Render tab's Publish step: after a finished offline render, encode the ladder, show exactly what will be written (a file tree
// with sizes), say whether the scene has changed since the render, warn about size with real numbers, and commit the whole set as
// ONE commit. Nothing is uploaded until the button is pressed.
//
//   panel.setRender( info )   a finished full-range offline render is available
//   panel.clear()             a new render started: the old one is gone
//
// info: { width, height, fps, frames, samples, keyframes (0-based), avcC, sceneHash, source, renderer, device, renderedAt, cues, burned, baseName,
//         encoder: 'software' | 'hardware', playbackWasRunning, hasEndCard, audioRef: { src, language, label } | null, uncommitted }

import { UIButton, UICheckbox, UIInput, UISelect } from './libs/ui.js';
import { sceneHash } from './export/canonical.js';
import { transcodeLadder } from './export/ladder.js';
import { planLadder, assemblePublishSet, cuesToVtt, defaultPublishPath, stalenessLine } from './export/publishSet.js';
import { formatBytes } from './export/renderJson.js';
import { buildAudioRendition, aacSupport } from './export/audio.js';
import { publishSource, commitPublishToRepo, fetchRepoFile } from './Menubar.Git.js';

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
	root.appendChild( el( 'div', NOTE + 'opacity:0.8;', 'Encodes a 1080 / 720 / 480 ladder as fragmented MP4 segments with HLS playlists, a poster, captions and render.json, then commits all of it to your repo in one commit.' ) );

	const stale = el( 'div', NOTE + 'font-weight:bold;' );
	root.appendChild( stale );

	// ── where ──
	const where = el( 'div' );
	const repoInput = new UIInput( '' );
	repoInput.dom.placeholder = 'owner/name (blank: the scene\u2019s repo)';
	repoInput.dom.style.flex = '1';
	const branchSelect = new UISelect().setOptions( { same: 'Scene\u2019s branch', renders: 'A separate "renders" branch' } ).setValue( 'same' );
	const pathInput = new UIInput( '' );
	pathInput.dom.style.flex = '1';
	for ( const [ label, control ] of [ [ 'Repo', repoInput ], [ 'Branch', branchSelect ], [ 'Path', pathInput ] ] ) {

		const row = el( 'div', FIELD );
		row.appendChild( el( 'span', LABEL, label ) );
		row.appendChild( control.dom );
		where.appendChild( row );

	}
	root.appendChild( where );

	// ── ladder ──
	const ladderRow = el( 'div', FIELD + 'flex-wrap:wrap;' );
	root.appendChild( ladderRow );
	let rungBoxes = [];

	// ── narration (when the scene declares one) ──
	const narrationRow = el( 'div', FIELD + 'flex-wrap:wrap;display:none;' );
	const narrationText = el( 'span', 'flex:1;min-width:160px;' );
	const narrationFile = el( 'input' );
	narrationFile.type = 'file';
	narrationFile.accept = 'audio/*,.wav';
	narrationFile.style.cssText = 'max-width:170px;font-size:11px;';
	narrationRow.append( el( 'span', LABEL, 'Audio' ), narrationText, narrationFile );
	root.appendChild( narrationRow );
	let narrationOverride = null;     // bytes of a file the user chose instead of the repo's
	narrationFile.addEventListener( 'change', async () => {

		const f = narrationFile.files && narrationFile.files[ 0 ];
		narrationOverride = f ? new Uint8Array( await f.arrayBuffer() ) : null;
		narrationText.textContent = f ? `Using ${ f.name } instead of the repo\u2019s file.` : describeNarration();
		prepared = null; review.style.display = 'none';

	} );
	const describeNarration = () => info && info.audioRef ? `Narration: ${ info.audioRef.src } (${ info.audioRef.label || info.audioRef.language }), from the scene.` : 'No narration: the scene declares none (setRenderAudio), so the set is silent.';

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
	review.append( treeBox, errorsBox, warningsBox, commitRow, resultBox );
	root.appendChild( review );

	// ── state ──
	let info = null;          // the render being published
	let prepared = null;      // the set built by Prepare
	let currentHash = null;
	let busy = false;
	let cancelRequested = false;

	const setStatus = ( text, fraction ) => {

		status.textContent = text || '';
		if ( fraction === undefined ) { bar.style.display = 'none'; return; }
		bar.style.display = '';
		barInner.style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';

	};

	function target() {

		const src = info && info.source;
		const repo = repoInput.getValue().trim() || ( src && src.repo ) || '';
		const branchName = branchSelect.getValue() === 'renders' ? 'renders' : ( src && src.branch ) || 'main';
		return { repo, branch: branchName, createFrom: branchSelect.getValue() === 'renders' ? ( ( src && src.branch ) || 'main' ) : null, path: pathInput.getValue().trim().replace( /^\/+|\/+$/g, '' ) };

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
		const errors = prepared ? prepared.errors : [];
		const noToken = ! ( src && src.hasToken );
		const isStale = info && stalenessLine( info.sceneHash, currentHash ).stale;
		commitButton.dom.disabled = ! prepared || errors.length > 0 || noToken || busy;
		commitButton.dom.innerHTML = '<i class="fa-solid fa-code-commit btn-icon" aria-hidden="true"></i>' + ( isStale ? 'Publish this stale render anyway' : 'Commit to ' ) ;
		if ( ! isStale ) commitButton.dom.append( document.createTextNode( `${ t.repo || '?' }@${ t.branch }` ) );
		if ( prepared && noToken ) errorsBox.textContent = [ ...errors, 'A token is required to commit: add one in the Git tab.' ].join( '\n' );

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

	async function prepare() {

		if ( ! info || busy ) return;
		const chosen = rungBoxes.filter( r => r.box.getValue() ).map( r => r.rung );
		if ( chosen.length === 0 ) { setStatus( 'Keep at least one rung of the ladder.' ); return; }
		const t = target();
		if ( ! /^[^/\s]+\/[^/\s]+$/.test( t.repo ) ) { setStatus( 'Set a repository: in the Git tab, or here as owner/name.' ); return; }
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
			const audioSupport = info.audioRef ? await aacSupport() : { ok: true };
			if ( ! audioSupport.ok ) { setStatus( 'This scene has narration, and ' + audioSupport.reason ); return; }

			const result = await transcodeLadder( {
				master: { width: info.width, height: info.height, fps: info.fps, samples: info.samples, keyframes: info.keyframes, avcC: info.avcC },
				ladder: chosen,
				onProgress: ( f, text ) => setStatus( text, f ),
				shouldCancel: () => cancelRequested,
				software: info.encoder === 'software',
			} );
			if ( ! result ) { setStatus( 'Publish cancelled.' ); return; }

			let audio = null;
			if ( info.audioRef ) {

				setStatus( 'Loading the narration\u2026', 0 );
				let bytes = narrationOverride;
				if ( ! bytes ) {

					try { bytes = await fetchRepoFile( info.audioRef.src ); } catch ( e ) {

						throw new Error( `The scene's narration ${ info.audioRef.src } could not be read from the repo (${ e.message }). Commit that file, or choose it below.` );

					}

				}
				const digest = await crypto.subtle.digest( 'SHA-256', bytes );
				const sha = 'sha256:' + Array.from( new Uint8Array( digest ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				const starts = result.rungs[ 0 ].packaged.segments.map( sg => sg.first / info.fps );
				const built = await buildAudioRendition( { bytes, durationSeconds: info.frames / info.fps, videoStartsSeconds: starts, onProgress: ( f, text ) => setStatus( text, f ) } );
				audio = { packaged: built.packaged, name: info.audioRef.label || 'English', language: info.audioRef.language || 'en', source: { path: info.audioRef.src, sha256: sha }, delaySamples: built.delaySamples };

			}

			const src = { ...( info.source || {} ), commit: commitSha };
			const set = assemblePublishSet( {
				path: t.path,
				scene: { repo: ( src && src.repo ) || t.repo, file: ( src && src.file ) || '', branch: ( src && src.branch ) || t.branch, commit: src && src.commit, hash: info.sceneHash },
				render: { mode: 'offline', renderer: info.renderer, device: info.device, encoder: info.encoder, fps: info.fps, frames: info.frames, frameRange: [ 0, info.frames - 1 ], width: info.width, height: info.height, renderedAt: info.renderedAt },
				rungs: result.rungs, poster: result.poster,
				// always written when there are cues: burning them in is an extra, never a way to skip the file (burned-in text cannot be switched off, styled, read aloud or translated)
				captions: cuesToVtt( info.cues ),
				audio,
				determinism: { mode: 'offline', encoder: info.encoder, hasEndCard: info.hasEndCard, hasCrossfades: info.hasCrossfades, playbackWasRunning: info.playbackWasRunning },
			} );
			prepared = set;
			treeBox.textContent = set.tree.map( f => `${ formatBytes( f.bytes ).padStart( 8 ) }  ${ f.path }` ).join( '\n' ) + `\n${ formatBytes( set.total ).padStart( 8 ) }  total, ${ set.tree.length } files`;
			errorsBox.textContent = set.errors.join( '\n' );
			const notes = [];
			if ( ! set.renderJson.render.deterministic ) notes.push( 'Not marked deterministic: ' + set.renderJson.render.not_deterministic_because.join('; ') + '. The frames and the duration are still exact (frame n shows n / fps); only the claim that a repeat render gives the same bytes is withheld.' );
			if ( info.height < 1080 || info.fps < 60 ) notes.push( `This master is ${ info.width }\u00d7${ info.height } at ${ info.fps } fps, so the ladder has ${ set.renderJson.outputs.renditions.length } rung(s). Render at 1920 \u00d7 1080 and 60 fps for the full ladder.` );
			if ( info.burned ) notes.push( 'Subtitles are burned into the picture and captions.vtt is published as well: players that show the caption track will show the words twice.' );
			if ( info.cues.length === 0 ) notes.push( 'The scene has no subtitle cues, so there is no captions.vtt.' );
			warningsBox.textContent = [ ...set.warnings, ...notes ].join( '\n\n' );
			review.style.display = '';
			resultBox.textContent = '';
			setStatus( set.errors.length ? 'The set is ready, but it cannot be published as it is.' : `Ready: ${ set.tree.length } files, ${ formatBytes( set.total ) }. Nothing has been uploaded yet.` );

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
		busy = true;
		commitButton.dom.disabled = true;
		const t = target();
		const set = prepared;
		try {

			const message = `Publish render of ${ ( info.source && info.source.file ) || 'scene' }: ${ info.frames } frames at ${ info.fps } fps, ${ set.renderJson.outputs.renditions.map( r => r.name ).join( ', ' ) }`;
			const out = await commitPublishToRepo( set.files, message, { repo: t.repo, branch: t.branch, createFrom: t.createFrom }, { onProgress: ( f, text ) => setStatus( text, f ) } );
			const sha = out.commit && out.commit.sha;
			resultBox.innerHTML = '';
			resultBox.append( document.createTextNode( `\u2713 Committed ${ set.tree.length } files in one commit${ sha ? ' (' + sha.slice( 0, 7 ) + ')' : '' }: ` ) );
			const a = el( 'a', 'color:inherit;text-decoration:underline;', `${ out.repo }@${ out.branch }/${ t.path }` );
			a.href = `https://github.com/${ out.repo }/tree/${ out.branch }/${ t.path }`;
			a.target = '_blank';
			a.rel = 'noopener';
			resultBox.appendChild( a );
			setStatus( '' );

		} catch ( e ) {

			console.error( 'Publish commit failed', e );
			setStatus( 'Commit failed, nothing was published: ' + ( e && e.message ? e.message : e ) );

		} finally {

			busy = false;
			refreshCommit();

		}

	}

	prepareButton.onClick( prepare );
	cancelButton.onClick( () => { cancelRequested = true; } );
	checkButton.onClick( refreshStaleness );
	commitButton.onClick( commit );
	for ( const c of [ repoInput, pathInput ] ) c.dom.addEventListener( 'input', () => { prepared = null; review.style.display = 'none'; refreshCommit(); } );
	branchSelect.onChange( () => { refreshCommit(); } );

	return {
		dom: root,
		/** A finished full-range offline render is available to publish. */
		setRender( newInfo ) {

			info = newInfo;
			prepared = null;
			review.style.display = 'none';
			resultBox.textContent = '';
			root.style.display = '';
			pathInput.setValue( defaultPublishPath( ( info.source && info.source.file ) || 'scene.json' ) );
			renderLadderChoices();
			narrationOverride = null;
			narrationFile.value = '';
			narrationRow.style.display = '';
			narrationText.textContent = describeNarration();
			setStatus( '' );
			const src = publishSource();
			if ( ! src ) setStatus( 'No repository is set in the Git tab: enter owner/name above to publish to.' );
			refreshStaleness();

		},
		clear() {

			info = null;
			prepared = null;
			root.style.display = 'none';

		},
		/** For tests: the prepared set. */
		get prepared() { return prepared; },
		get info() { return info; },
	};

}
