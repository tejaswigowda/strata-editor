// ── Sidebar.Git.js ────────────────────────────────────────────────────────────
// Git repository panel in the right sidebar. Provides the same functionality
// that used to live in the Git menubar: Settings (inline), Load Scene, Compare
// with Remote, and Commit Scene. Reuses the dialogs/helpers from Menubar.Git.js.

import { UIPanel, UIRow, UIText, UIInput, UIButton, UIHorizontalRule } from './libs/ui.js';
import { GitLoadDialog, GitCommitDialog, openGitCompare } from './Menubar.Git.js';

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

	container.add( new UIHorizontalRule() );

	// ── Actions ───────────────────────────────────────────────────────────────

	// Load scene
	const loadRow = new UIRow();
	const loadButton = new UIButton( strings.getKey( 'menubar/git/load' ) ).setWidth( '100%' );
	loadButton.onClick( () => {

		persist();
		document.body.appendChild( new GitLoadDialog( editor, strings ).dom );

	} );
	loadRow.add( loadButton );
	container.add( loadRow );

	// Compare with remote
	const compareRow = new UIRow();
	const compareButton = new UIButton( strings.getKey( 'menubar/git/compare' ) ).setWidth( '100%' );
	compareButton.onClick( () => {

		persist();
		openGitCompare( editor, strings );

	} );
	compareRow.add( compareButton );
	container.add( compareRow );

	// Commit scene
	const commitRow = new UIRow();
	const commitButton = new UIButton( strings.getKey( 'menubar/git/commit' ) ).setWidth( '100%' );
	commitButton.onClick( () => {

		persist();
		document.body.appendChild( new GitCommitDialog( editor, strings ).dom );

	} );
	commitRow.add( commitButton );
	container.add( commitRow );

	return container;

}

export { SidebarGit };
