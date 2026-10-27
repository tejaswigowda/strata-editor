// ── PublishPanel.js ────────────────────────────────────────────────────────────
// The Render tab's Publish step: after a finished offline render, encode the ladder, show exactly what will be written (a file tree
// with sizes), say whether the scene has changed since the render, warn about size with real numbers, and commit the whole set as
// ONE commit. Nothing is uploaded until the button is pressed.
//
//   panel.setRender( info )   a finished full-range offline render is available
//   panel.clear()             a new render started: the old one is gone
//
// info: { width, height, fps, frames, samples, keyframes (0-based), avcC, sceneHash, source, renderer, device, renderedAt, cues, burned, baseName }

import { UIButton, UICheckbox, UIInput, UISelect } from './libs/ui.js';
import { sceneHash } from './export/canonical.js';
import { transcodeLadder } from './export/ladder.js';
import { planLadder, assemblePublishSet, cuesToVtt, defaultPublishPath, stalenessLine } from './export/publishSet.js';
import { formatBytes } from './export/renderJson.js';
import { publishSource, commitPublishToRepo } from './Menubar.Git.js';

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
			const result = await transcodeLadder( {
				master: { width: info.width, height: info.height, fps: info.fps, samples: info.samples, keyframes: info.keyframes, avcC: info.avcC },
				ladder: chosen,
				onProgress: ( f, text ) => setStatus( text, f ),
				shouldCancel: () => cancelRequested,
			} );
			if ( ! result ) { setStatus( 'Publish cancelled.' ); return; }

			const src = info.source;
			const set = assemblePublishSet( {
				path: t.path,
				scene: { repo: ( src && src.repo ) || t.repo, file: ( src && src.file ) || '', branch: ( src && src.branch ) || t.branch, commit: src && src.commit, hash: info.sceneHash },
				render: { mode: 'offline', renderer: info.renderer, device: info.device, fps: info.fps, frames: info.frames, frameRange: [ 0, info.frames - 1 ], width: info.width, height: info.height, renderedAt: info.renderedAt },
				rungs: result.rungs, poster: result.poster,
				// burned-in captions would show twice beside a caption track
				captions: info.burned ? null : cuesToVtt( info.cues ),
			} );
			prepared = set;
			treeBox.textContent = set.tree.map( f => `${ formatBytes( f.bytes ).padStart( 8 ) }  ${ f.path }` ).join( '\n' ) + `\n${ formatBytes( set.total ).padStart( 8 ) }  total, ${ set.tree.length } files`;
			errorsBox.textContent = set.errors.join( '\n' );
			warningsBox.textContent = [ ...set.warnings, ...( info.burned ? [ 'Subtitles are burned into the picture, so no captions.vtt is published.' ] : [] ), ...( ! ( src && src.commit ) ? [ 'The scene has not been committed from this editor (no commit is recorded in render.json): commit it first so the render points at a commit.' ] : [] ) ].join( '\n\n' );
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
