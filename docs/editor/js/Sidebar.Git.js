// ── Sidebar.Git.js ────────────────────────────────────────────────────────────
// Git repository panel in the right sidebar: Settings (inline), Load Scene,
// Compare with Remote, and Commit Scene — all inline, no popup dialogs. A
// shared progress bar + status line reports whichever action is running, and
// every action button disables while busy so they can't overlap.

import { UIPanel, UIRow, UIText, UIInput, UIButton, UIHorizontalRule } from './libs/ui.js';
import { loadSceneFromRepo, commitSceneToRepo, openGitCompare, generateCommitMessage, showLoadOverlay, setLoadProgress, hideLoadOverlay, parseRepo, listBranches, listCommits, listRootJsonFiles } from './Menubar.Git.js';

const LS_KEY = 'git-settings';

function loadSettings() {

	try { return JSON.parse( localStorage.getItem( LS_KEY ) ) || {}; } catch { return {}; }

}

function saveSettings( s ) {

	localStorage.setItem( LS_KEY, JSON.stringify( s ) );

}

// Small "▾" button next to a settings input that opens a lightweight popup
// list (branches / commits / root .json files — none of which have a CDN
// equivalent, so these go straight to the GitHub API on click; see
// Menubar.Git.js's listBranches/listCommits/listRootJsonFiles). Options are
// fetched lazily on open, never on mount — this is a manual, occasional
// lookup, not part of the automatic load path.
function createPicker( { title, fetchItems, onPick } ) {

	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.textContent = '▾';
	btn.title = title;
	btn.style.cssText = 'width:18px;height:20px;margin-left:4px;padding:0;font-size:10px;line-height:1;cursor:pointer;flex:none;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.25);border-radius:3px;';

	const panel = document.createElement( 'div' );
	panel.style.cssText = 'position:fixed;z-index:200;min-width:160px;max-width:280px;max-height:220px;overflow-y:auto;background:#222;border:1px solid rgba(255,255,255,0.25);border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,0.45);display:none;font-size:12px;';
	document.body.appendChild( panel );

	function close() {

		panel.style.display = 'none';
		document.removeEventListener( 'pointerdown', onDocPointerDown, true );

	}

	function onDocPointerDown( e ) {

		if ( e.target !== btn && ! panel.contains( e.target ) ) close();

	}

	function renderMessage( text, color ) {

		panel.innerHTML = '';
		const el = document.createElement( 'div' );
		el.style.cssText = `padding:6px 10px;opacity:0.7;${ color ? 'color:' + color + ';' : '' }`;
		el.textContent = text;
		panel.appendChild( el );

	}

	async function open() {

		const rect = btn.getBoundingClientRect();
		panel.style.left = rect.left + 'px';
		panel.style.top  = ( rect.bottom + 2 ) + 'px';
		panel.style.display = 'block';
		renderMessage( 'Loading…' );

		document.addEventListener( 'pointerdown', onDocPointerDown, true );

		let items;
		try {

			items = await fetchItems();

		} catch ( err ) {

			renderMessage( err.message || 'Failed to load', '#f88' );
			return;

		}

		if ( panel.style.display === 'none' ) return; // closed while loading

		if ( ! items || ! items.length ) {

			renderMessage( 'None found' );
			return;

		}

		panel.innerHTML = '';

		items.forEach( item => {

			const row = document.createElement( 'div' );
			row.style.cssText = 'padding:5px 10px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			row.textContent = item.label;
			row.title = item.label;
			row.addEventListener( 'mouseenter', () => row.style.background = 'rgba(255,255,255,0.12)' );
			row.addEventListener( 'mouseleave', () => row.style.background = '' );
			row.addEventListener( 'click', () => {

				onPick( item.value );
				close();

			} );
			panel.appendChild( row );

		} );

	}

	btn.addEventListener( 'click', ( e ) => {

		e.preventDefault();
		if ( panel.style.display === 'block' ) close(); else open();

	} );

	return btn;

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
	branchRow.dom.appendChild( createPicker( {
		title: 'Browse branches',
		fetchItems: async () => {

			const parsed = parseRepo( repoInput.getValue().trim() );
			if ( ! parsed ) throw new Error( 'Enter a repository above first' );
			const names = await listBranches( parsed, patInput.getValue().trim() || undefined );
			return names.map( n => ( { label: n, value: n } ) );

		},
		onPick: ( value ) => { branchInput.setValue( value ); persist(); },
	} ) );
	container.add( branchRow );

	// Commit — optional pin to a specific commit SHA or tag; empty means "latest"
	// (i.e. use Branch above as-is, tracking its moving HEAD).
	const commitPinRow = new UIRow();
	commitPinRow.add( new UIText( strings.getKey( 'menubar/git/settings/commit' ) ).setClass( 'Label' ) );
	const commitPinInput = new UIInput( s.commit || '' ).setWidth( '160px' );
	commitPinInput.dom.placeholder = 'latest';
	commitPinRow.add( commitPinInput );
	commitPinRow.dom.appendChild( createPicker( {
		title: 'Browse commits',
		fetchItems: async () => {

			const parsed = parseRepo( repoInput.getValue().trim() );
			if ( ! parsed ) throw new Error( 'Enter a repository above first' );
			const ref = commitPinInput.getValue().trim() || branchInput.getValue().trim() || 'main';
			const commits = await listCommits( parsed, ref, pathInput.getValue().trim() || undefined, patInput.getValue().trim() || undefined );
			return commits.map( c => ( { label: `${ c.sha.slice( 0, 7 ) } — ${ c.message }`, value: c.sha } ) );

		},
		onPick: ( value ) => { commitPinInput.setValue( value ); persist(); },
	} ) );
	container.add( commitPinRow );

	// Scene file
	const pathRow = new UIRow();
	pathRow.add( new UIText( strings.getKey( 'menubar/git/settings/path' ) ).setClass( 'Label' ) );
	const pathInput = new UIInput( s.scenePath || 'scene.json' ).setWidth( '160px' );
	pathInput.dom.placeholder = 'scene.json';
	pathRow.add( pathInput );
	pathRow.dom.appendChild( createPicker( {
		title: 'Browse .json files at repo root',
		fetchItems: async () => {

			const parsed = parseRepo( repoInput.getValue().trim() );
			if ( ! parsed ) throw new Error( 'Enter a repository above first' );
			const ref = commitPinInput.getValue().trim() || branchInput.getValue().trim() || 'main';
			const files = await listRootJsonFiles( parsed, ref, patInput.getValue().trim() || undefined );
			return files.map( f => ( { label: f, value: f } ) );

		},
		onPick: ( value ) => { pathInput.setValue( value ); persist(); },
	} ) );
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
			commit:    commitPinInput.getValue().trim(),
			scenePath: pathInput.getValue().trim() || 'scene.json',
			pat:       patInput.getValue().trim(),
		} );

	}

	// Auto-save when a field loses focus / changes.
	[ repoInput, branchInput, commitPinInput, pathInput, patInput ].forEach( input => input.onChange( persist ) );

	// Reflect settings changed elsewhere (e.g. a #repo=...&file=... URL hash
	// preload on this same page load) without clobbering what the user is
	// actively typing.
	editor.signals.gitSettingsChanged.add( function () {

		const fresh = loadSettings();
		repoInput.setValue( fresh.repoUrl || '' );
		branchInput.setValue( fresh.branch || 'main' );
		commitPinInput.setValue( fresh.commit || '' );
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
