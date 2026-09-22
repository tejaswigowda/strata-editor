// ── Sidebar.Git.js ────────────────────────────────────────────────────────────
// Git repository panel in the right sidebar: Settings (inline), Load Scene,
// Compare with Remote, and Commit Scene — all inline, no popup dialogs. A
// shared progress bar + status line reports whichever action is running, and
// every action button disables while busy so they can't overlap.

import { UIPanel, UIRow, UIText, UIInput, UIButton, UIHorizontalRule } from './libs/ui.js';
import { loadSceneFromRepo, commitSceneToRepo, openGitCompare, generateCommitMessage, showLoadOverlay, setLoadProgress, hideLoadOverlay } from './Menubar.Git.js';

const LS_KEY = 'git-settings';

function loadSettings() {

	try { return JSON.parse( localStorage.getItem( LS_KEY ) ) || {}; } catch { return {}; }

}

function saveSettings( s ) {

	localStorage.setItem( LS_KEY, JSON.stringify( s ) );

}

function SidebarGit( editor ) {

	const strings = editor.strings;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	const s = loadSettings();

	// ── Settings (inline) ─────────────────────────────────────────────────────

	const settingsTitle = new UIText( strings.getKey( 'menubar/git/settings/title' ) ).setTextTransform( 'uppercase' );
	settingsTitle.setStyle( 'fontWeight', [ 'bold' ] );
	container.add( new UIRow().add( settingsTitle ) );

	// Repository
	const repoRow = new UIRow();
	repoRow.add( new UIText( strings.getKey( 'menubar/git/settings/repo' ) ).setClass( 'Label' ) );
	const repoInput = new UIInput( s.repoUrl || '' ).setWidth( '160px' );
	repoInput.dom.placeholder = 'https://github.com/user/repo';
	repoRow.add( repoInput );
	container.add( repoRow );

	// Branch
	const branchRow = new UIRow();
	branchRow.add( new UIText( strings.getKey( 'menubar/git/settings/branch' ) ).setClass( 'Label' ) );
	const branchInput = new UIInput( s.branch || 'main' ).setWidth( '160px' );
	branchInput.dom.placeholder = 'main';
	branchRow.add( branchInput );
	container.add( branchRow );

	// Scene file
	const pathRow = new UIRow();
	pathRow.add( new UIText( strings.getKey( 'menubar/git/settings/path' ) ).setClass( 'Label' ) );
	const pathInput = new UIInput( s.scenePath || 'scene.json' ).setWidth( '160px' );
	pathInput.dom.placeholder = 'scene.json';
	pathRow.add( pathInput );
	container.add( pathRow );

	// Access token
	const patRow = new UIRow();
	patRow.add( new UIText( strings.getKey( 'menubar/git/settings/pat' ) ).setClass( 'Label' ) );
	const patInput = new UIInput( s.pat || '' ).setWidth( '160px' );
	patInput.dom.type = 'password';
	patInput.dom.placeholder = 'ghp_…';
	patRow.add( patInput );
	container.add( patRow );

	// PAT note
	const noteRow = new UIRow();
	const note = new UIText( strings.getKey( 'menubar/git/settings/pat_note' ) ).setWidth( '100%' );
	note.setStyle( 'fontSize', [ '11px' ] );
	note.setStyle( 'opacity', [ '0.6' ] );
	noteRow.add( note );
	container.add( noteRow );

	// A token is only ever REQUIRED to commit (GitHub always needs auth to
	// write). Reading a PUBLIC repo — by hand here, or via a #repo=...&file=...
	// URL hash preload — works with no token at all, at GitHub's lower anonymous
	// rate limit. Private repos need a token for reads too.
	const tokenHintRow = new UIRow();
	const tokenHint = new UIText( 'Token required to commit. Loading a public repo (incl. via a #repo=…&file=… URL) works without one.' ).setWidth( '100%' );
	tokenHint.setStyle( 'fontSize', [ '11px' ] );
	tokenHint.setStyle( 'opacity', [ '0.5' ] );
	tokenHintRow.add( tokenHint );
	container.add( tokenHintRow );

	function persist() {

		saveSettings( {
			repoUrl:   repoInput.getValue().trim(),
			branch:    branchInput.getValue().trim() || 'main',
			scenePath: pathInput.getValue().trim() || 'scene.json',
			pat:       patInput.getValue().trim(),
		} );

	}

	// Auto-save when a field loses focus / changes.
	[ repoInput, branchInput, pathInput, patInput ].forEach( input => input.onChange( persist ) );

	// Reflect settings changed elsewhere (e.g. a #repo=...&file=... URL hash
	// preload on this same page load) without clobbering what the user is
	// actively typing.
	editor.signals.gitSettingsChanged.add( function () {

		const fresh = loadSettings();
		repoInput.setValue( fresh.repoUrl || '' );
		branchInput.setValue( fresh.branch || 'main' );
		pathInput.setValue( fresh.scenePath || 'scene.json' );
		patInput.setValue( fresh.pat || '' );

	} );

	container.add( new UIHorizontalRule() );

	// ── Shared progress bar + status (Load/Compare/Commit are mutually
	// exclusive, so one area covers all three instead of each having its own).
	const progressOuter = document.createElement( 'div' );
	progressOuter.style.cssText = 'height:6px;background:rgba(128,128,128,0.25);border-radius:3px;overflow:hidden;margin:2px 0 4px;display:none;';
	const progressInner = document.createElement( 'div' );
	progressInner.style.cssText = 'height:100%;width:0%;background:#08f;transition:width 0.15s linear;';
	progressOuter.appendChild( progressInner );
	container.dom.appendChild( progressOuter );

	const statusText = document.createElement( 'div' );
	statusText.style.cssText = 'font-size:11px;opacity:0.75;min-height:14px;margin-bottom:6px;';
	container.dom.appendChild( statusText );

	// fraction === null hides the bar (idle/done) but leaves the message showing.
	function setProgress( fraction, message ) {

		progressOuter.style.display = fraction === null ? 'none' : '';
		if ( fraction !== null ) progressInner.style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 0 ) + '%';
		statusText.textContent = message || '';

	}

	let busy = false;

	// Disables every action (not just the one running) so Load/Commit/Compare
	// can't overlap, and the commit-message field can't be edited mid-upload.
	function setBusy( isBusy ) {

		busy = isBusy;
		loadButton.dom.disabled = isBusy;
		compareButton.dom.disabled = isBusy;
		commitButton.dom.disabled = isBusy;
		msgInput.dom.disabled = isBusy;

	}

	// ── Actions ───────────────────────────────────────────────────────────────

	// Load scene — no dialog: click, watch the progress bar, done.
	const loadRow = new UIRow();
	const loadButton = new UIButton( strings.getKey( 'menubar/git/load' ) ).setWidth( '100%' );
	loadButton.onClick( async () => {

		if ( busy ) return;
		persist();
		setBusy( true );
		setProgress( 0.05, 'Loading…' );
		showLoadOverlay();

		try {

			await loadSceneFromRepo( editor, { onStatus: ( fraction, message ) => { setProgress( fraction, message ); setLoadProgress( fraction, message ); } } );
			setTimeout( () => setProgress( null, '' ), 1500 );

		} catch ( err ) {

			setProgress( null, `Error: ${ err.message }` );

		} finally {

			setBusy( false );
			hideLoadOverlay();

		}

	} );
	loadRow.add( loadButton );
	container.add( loadRow );

	// Compare with remote
	const compareRow = new UIRow();
	const compareButton = new UIButton( strings.getKey( 'menubar/git/compare' ) ).setWidth( '100%' );
	compareButton.onClick( async () => {

		if ( busy ) return;
		persist();
		setBusy( true );

		try {

			await openGitCompare( editor, strings );

		} finally {

			setBusy( false );

		}

	} );
	compareRow.add( compareButton );
	container.add( compareRow );

	container.add( new UIHorizontalRule() );

	// Commit scene — message stays inline (no separate dialog): auto-filled by
	// the local AI once when this panel is built, editable before committing.
	const msgRow = new UIRow();
	msgRow.add( new UIText( strings.getKey( 'menubar/git/commit/message' ) ).setClass( 'Label' ) );
	const msgInput = new UIInput( 'Update scene' ).setWidth( '160px' );
	msgRow.add( msgInput );
	container.add( msgRow );

	if ( editor.aiEngine && editor.aiEngine.ready ) {

		msgInput.setValue( '…' );
		msgInput.dom.disabled = true;

		generateCommitMessage( editor ).then( msg => {

			msgInput.dom.disabled = false;
			msgInput.setValue( msg || 'Update scene' );

		} ).catch( () => {

			msgInput.dom.disabled = false;
			msgInput.setValue( 'Update scene' );

		} );

	}

	const commitRow = new UIRow();
	const commitButton = new UIButton( strings.getKey( 'menubar/git/commit' ) ).setWidth( '100%' );
	commitButton.onClick( async () => {

		if ( busy ) return;
		persist();
		setBusy( true );
		setProgress( 0, 'Preparing assets…' );

		try {

			await commitSceneToRepo( editor, msgInput.getValue(), { onProgress: setProgress } );
			setTimeout( () => setProgress( null, '' ), 1500 );

		} catch ( err ) {

			setProgress( null, `Error: ${ err.message }` );

		} finally {

			setBusy( false );

		}

	} );
	commitRow.add( commitButton );
	container.add( commitRow );

	return container;

}

export { SidebarGit };
