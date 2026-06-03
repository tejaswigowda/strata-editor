// ── Menubar.Git.js ────────────────────────────────────────────────────────────
// Git repository settings and scene sync (load / commit).
// Uses the GitHub REST API directly via fetch() — no Octokit dependency.
// Settings (repo URL, branch, path, PAT) are persisted in localStorage.

import { UIPanel, UIRow, UIText, UIButton, UIHorizontalRule } from './libs/ui.js';
import { sceneContextString } from './scene/summarize.js';

// ── Commit-message generation ─────────────────────────────────────────────────
// Uses the already-loaded local AI engine (editor.aiEngine) to generate a
// conventional commit message from the current scene description.
// Returns a plain string — no code, no markdown.

const COMMIT_MSG_SYSTEM = `You write git commit messages for 3D scene files. Rules:
- Output ONLY the commit message — a single line, no quotes, no trailing period.
- Imperative mood ("Add red box", "Remove ground plane", "Arrange 5 columns").
- Max 72 characters.
- Be specific: mention the notable objects, colors, or arrangements in the scene.
- If the scene is empty, say "Initialize empty scene".`;

async function generateCommitMessage( editor ) {

	const ai = editor.aiEngine;
	if ( ! ai || ! ai.ready ) return null;

	const sceneCtx = sceneContextString( editor );

	const messages = [
		{ role: 'system', content: COMMIT_MSG_SYSTEM },
		{ role: 'user',   content: 'Scene:\n' + sceneCtx + '\n\nCommit message:' },
	];

	const raw = await ai.complete( messages, { maxTokens: 80, temperature: 0.3 } );

	// Strip any accidental quotes, backticks, or leading "commit:" prefixes the model may emit
	return raw.trim()
		.replace( /^["'`]+|["'`]+$/g, '' )
		.replace( /^\s*commit[:\s]+/i, '' )
		.slice( 0, 72 )
		.trim();

}

const LS_KEY = 'git-settings';

function loadSettings() {

	try { return JSON.parse( localStorage.getItem( LS_KEY ) ) || {}; } catch { return {}; }

}

function saveSettings( s ) {

	localStorage.setItem( LS_KEY, JSON.stringify( s ) );

}

// ── Parse owner/repo from a GitHub URL ───────────────────────────────────────

function parseRepo( url ) {

	const m = String( url ).trim().replace( /\.git$/, '' )
		.match( /github\.com[/:]([^/]+)\/([^/]+)/ );
	if ( ! m ) return null;
	return { owner: m[ 1 ], repo: m[ 2 ] };

}

// ── GitHub REST helpers ───────────────────────────────────────────────────────

async function ghGet( path, token ) {

	const res = await fetch( `https://api.github.com${ path }`, {
		headers: { Authorization: `Bearer ${ token }`, Accept: 'application/vnd.github+json' },
	} );

	if ( ! res.ok ) throw new Error( `GitHub ${ res.status }: ${ await res.text() }` );
	return res.json();

}

async function ghPut( path, body, token ) {

	const res = await fetch( `https://api.github.com${ path }`, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${ token }`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( body ),
	} );

	if ( ! res.ok ) throw new Error( `GitHub ${ res.status }: ${ await res.text() }` );
	return res.json();

}

// ── Menu factory ──────────────────────────────────────────────────────────────

function MenubarGit( editor ) {

	const strings = editor.strings;

	const container = new UIPanel();
	container.setClass( 'menu' );

	const title = new UIPanel();
	title.setClass( 'title' );
	title.setTextContent( strings.getKey( 'menubar/git' ) );
	container.add( title );

	const options = new UIPanel();
	options.setClass( 'options' );
	container.add( options );

	// Settings

	let option = new UIRow();
	option.setClass( 'option' );
	option.setTextContent( strings.getKey( 'menubar/git/settings' ) );
	option.onClick( () => {

		document.body.appendChild( new GitSettingsDialog( strings ).dom );

	} );
	options.add( option );

	options.add( new UIHorizontalRule() );

	// Load scene

	option = new UIRow();
	option.setClass( 'option' );
	option.setTextContent( strings.getKey( 'menubar/git/load' ) );
	option.onClick( () => {

		document.body.appendChild( new GitLoadDialog( editor, strings ).dom );

	} );
	options.add( option );

	// Commit scene

	option = new UIRow();
	option.setClass( 'option' );
	option.setTextContent( strings.getKey( 'menubar/git/commit' ) );
	option.onClick( () => {

		document.body.appendChild( new GitCommitDialog( editor, strings ).dom );

	} );
	options.add( option );

	return container;

}

// ── Settings Dialog ───────────────────────────────────────────────────────────

class GitSettingsDialog {

	constructor( strings ) {

		const s = loadSettings();

		const dom = document.createElement( 'div' );
		dom.className = 'Dialog';
		this.dom = dom;

		const bg = document.createElement( 'div' );
		bg.className = 'Dialog-background';
		bg.addEventListener( 'click', () => this.close() );
		dom.appendChild( bg );

		const content = document.createElement( 'div' );
		content.className = 'Dialog-content';
		dom.appendChild( content );

		const titleBar = document.createElement( 'div' );
		titleBar.className = 'Dialog-title';
		titleBar.textContent = strings.getKey( 'menubar/git/settings/title' );
		content.appendChild( titleBar );

		const body = document.createElement( 'div' );
		body.className = 'Dialog-body';
		content.appendChild( body );

		// Repo URL
		const repoRow = new UIRow();
		repoRow.add( new UIText( strings.getKey( 'menubar/git/settings/repo' ) ).setClass( 'Label' ) );
		const repoInput = document.createElement( 'input' );
		repoInput.className = 'Input';
		repoInput.style.cssText = 'flex:1;padding:2px;width:240px;';
		repoInput.placeholder = 'https://github.com/user/repo';
		repoInput.value = s.repoUrl || '';
		repoInput.addEventListener( 'keydown', e => e.stopPropagation() );
		repoRow.dom.appendChild( repoInput );
		body.appendChild( repoRow.dom );

		// Branch
		const branchRow = new UIRow();
		branchRow.add( new UIText( strings.getKey( 'menubar/git/settings/branch' ) ).setClass( 'Label' ) );
		const branchInput = document.createElement( 'input' );
		branchInput.className = 'Input';
		branchInput.style.cssText = 'padding:2px;width:120px;';
		branchInput.placeholder = 'main';
		branchInput.value = s.branch || 'main';
		branchInput.addEventListener( 'keydown', e => e.stopPropagation() );
		branchRow.dom.appendChild( branchInput );
		body.appendChild( branchRow.dom );

		// Scene path
		const pathRow = new UIRow();
		pathRow.add( new UIText( strings.getKey( 'menubar/git/settings/path' ) ).setClass( 'Label' ) );
		const pathInput = document.createElement( 'input' );
		pathInput.className = 'Input';
		pathInput.style.cssText = 'padding:2px;width:160px;';
		pathInput.placeholder = 'scene.json';
		pathInput.value = s.scenePath || 'scene.json';
		pathInput.addEventListener( 'keydown', e => e.stopPropagation() );
		pathRow.dom.appendChild( pathInput );
		body.appendChild( pathRow.dom );

		// PAT
		const patRow = new UIRow();
		patRow.add( new UIText( strings.getKey( 'menubar/git/settings/pat' ) ).setClass( 'Label' ) );
		const patInput = document.createElement( 'input' );
		patInput.className = 'Input';
		patInput.type = 'password';
		patInput.style.cssText = 'flex:1;padding:2px;width:240px;';
		patInput.placeholder = 'ghp_…';
		patInput.value = s.pat || '';
		patInput.addEventListener( 'keydown', e => e.stopPropagation() );
		patRow.dom.appendChild( patInput );
		body.appendChild( patRow.dom );

		// PAT note
		const note = document.createElement( 'div' );
		note.style.cssText = 'font-size:11px;opacity:0.6;margin:4px 0 8px 120px;';
		note.textContent = strings.getKey( 'menubar/git/settings/pat_note' );
		body.appendChild( note );

		// Buttons
		const buttonsRow = document.createElement( 'div' );
		buttonsRow.className = 'Dialog-buttons';
		body.appendChild( buttonsRow );

		const saveBtn = new UIButton( strings.getKey( 'menubar/git/settings/save' ) );
		saveBtn.setWidth( '80px' );
		saveBtn.onClick( () => {

			saveSettings( {
				repoUrl:   repoInput.value.trim(),
				branch:    branchInput.value.trim() || 'main',
				scenePath: pathInput.value.trim() || 'scene.json',
				pat:       patInput.value.trim(),
			} );
			this.close();

		} );
		buttonsRow.appendChild( saveBtn.dom );

		const cancelBtn = new UIButton( strings.getKey( 'menubar/git/cancel' ) );
		cancelBtn.setWidth( '80px' );
		cancelBtn.setMarginLeft( '8px' );
		cancelBtn.onClick( () => this.close() );
		buttonsRow.appendChild( cancelBtn.dom );

	}

	close() { this.dom.remove(); }

}

// ── Load Dialog ───────────────────────────────────────────────────────────────

class GitLoadDialog {

	constructor( editor, strings ) {

		const dom = document.createElement( 'div' );
		dom.className = 'Dialog';
		this.dom = dom;

		const bg = document.createElement( 'div' );
		bg.className = 'Dialog-background';
		bg.addEventListener( 'click', () => this.close() );
		dom.appendChild( bg );

		const content = document.createElement( 'div' );
		content.className = 'Dialog-content';
		dom.appendChild( content );

		const titleBar = document.createElement( 'div' );
		titleBar.className = 'Dialog-title';
		titleBar.textContent = strings.getKey( 'menubar/git/load/title' );
		content.appendChild( titleBar );

		const body = document.createElement( 'div' );
		body.className = 'Dialog-body';
		content.appendChild( body );

		// Status text
		const status = document.createElement( 'div' );
		status.style.cssText = 'min-height:40px;padding:8px 0;font-size:12px;';
		const s = loadSettings();
		status.textContent = s.repoUrl
			? `${ s.repoUrl }  /  ${ s.scenePath || 'scene.json' }  @  ${ s.branch || 'main' }`
			: strings.getKey( 'menubar/git/no_settings' );
		body.appendChild( status );

		// Buttons
		const buttonsRow = document.createElement( 'div' );
		buttonsRow.className = 'Dialog-buttons';
		body.appendChild( buttonsRow );

		const loadBtn = new UIButton( strings.getKey( 'menubar/git/load/confirm' ) );
		loadBtn.setWidth( '100px' );
		loadBtn.onClick( async () => {

			const cfg = loadSettings();
			const parsed = parseRepo( cfg.repoUrl );

			if ( ! parsed ) {

				status.textContent = strings.getKey( 'menubar/git/error/no_repo' );
				return;

			}

			if ( ! cfg.pat ) {

				status.textContent = strings.getKey( 'menubar/git/error/no_pat' );
				return;

			}

			loadBtn.dom.disabled = true;
			status.textContent = strings.getKey( 'menubar/git/loading' );

			try {

				const apiPath = `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ cfg.scenePath || 'scene.json' }?ref=${ cfg.branch || 'main' }`;
				const file = await ghGet( apiPath, cfg.pat );
				const json = JSON.parse( atob( file.content.replace( /\n/g, '' ) ) );
				editor.clear();
				await editor.fromJSON( json );
				status.textContent = strings.getKey( 'menubar/git/load/success' );
				setTimeout( () => this.close(), 800 );

			} catch ( err ) {

				loadBtn.dom.disabled = false;
				status.textContent = `Error: ${ err.message }`;

			}

		} );
		buttonsRow.appendChild( loadBtn.dom );

		const cancelBtn = new UIButton( strings.getKey( 'menubar/git/cancel' ) );
		cancelBtn.setWidth( '80px' );
		cancelBtn.setMarginLeft( '8px' );
		cancelBtn.onClick( () => this.close() );
		buttonsRow.appendChild( cancelBtn.dom );

	}

	close() { this.dom.remove(); }

}

// ── Commit Dialog ─────────────────────────────────────────────────────────────

class GitCommitDialog {

	constructor( editor, strings ) {

		const dom = document.createElement( 'div' );
		dom.className = 'Dialog';
		this.dom = dom;

		const bg = document.createElement( 'div' );
		bg.className = 'Dialog-background';
		bg.addEventListener( 'click', () => this.close() );
		dom.appendChild( bg );

		const content = document.createElement( 'div' );
		content.className = 'Dialog-content';
		dom.appendChild( content );

		const titleBar = document.createElement( 'div' );
		titleBar.className = 'Dialog-title';
		titleBar.textContent = strings.getKey( 'menubar/git/commit/title' );
		content.appendChild( titleBar );

		const body = document.createElement( 'div' );
		body.className = 'Dialog-body';
		content.appendChild( body );

		// ── Commit message row ────────────────────────────────────────────────
		const msgRow = new UIRow();
		msgRow.add( new UIText( strings.getKey( 'menubar/git/commit/message' ) ).setClass( 'Label' ) );

		const msgInput = document.createElement( 'input' );
		msgInput.className = 'Input';
		msgInput.style.cssText = 'flex:1;padding:2px;width:240px;';
		msgInput.placeholder = strings.getKey( 'menubar/git/commit/placeholder' );
		msgInput.addEventListener( 'keydown', e => e.stopPropagation() );
		msgRow.dom.appendChild( msgInput );
		body.appendChild( msgRow.dom );

		// ── AI generation hint ────────────────────────────────────────────────
		const aiHint = document.createElement( 'div' );
		aiHint.style.cssText = 'font-size:11px;opacity:0.6;margin:-2px 0 6px 120px;';
		body.appendChild( aiHint );

		// ── Target / status line ──────────────────────────────────────────────
		const status = document.createElement( 'div' );
		status.style.cssText = 'min-height:32px;padding:6px 0;font-size:12px;';
		const cfg = loadSettings();
		status.textContent = cfg.repoUrl
			? `→  ${ cfg.repoUrl }  /  ${ cfg.scenePath || 'scene.json' }  @  ${ cfg.branch || 'main' }`
			: strings.getKey( 'menubar/git/no_settings' );
		body.appendChild( status );

		// ── Buttons ───────────────────────────────────────────────────────────
		const buttonsRow = document.createElement( 'div' );
		buttonsRow.className = 'Dialog-buttons';
		body.appendChild( buttonsRow );

		const commitBtn = new UIButton( strings.getKey( 'menubar/git/commit/confirm' ) );
		commitBtn.setWidth( '100px' );
		buttonsRow.appendChild( commitBtn.dom );

		const cancelBtn = new UIButton( strings.getKey( 'menubar/git/cancel' ) );
		cancelBtn.setWidth( '80px' );
		cancelBtn.setMarginLeft( '8px' );
		cancelBtn.onClick( () => this.close() );
		buttonsRow.appendChild( cancelBtn.dom );

		// ── Auto-generate message on open ─────────────────────────────────────
		const ai = editor.aiEngine;

		if ( ai && ai.ready ) {

			msgInput.value = '';
			msgInput.disabled = true;
			msgInput.placeholder = strings.getKey( 'menubar/git/commit/generating' );
			aiHint.textContent = strings.getKey( 'menubar/git/commit/ai_hint' );
			commitBtn.dom.disabled = true;

			generateCommitMessage( editor ).then( msg => {

				msgInput.disabled = false;
				commitBtn.dom.disabled = false;

				if ( msg ) {

					msgInput.value = msg;
					aiHint.textContent = strings.getKey( 'menubar/git/commit/ai_done' );

				} else {

					msgInput.value = 'Update scene';
					aiHint.textContent = '';

				}

				msgInput.focus();
				msgInput.select();

			} ).catch( () => {

				msgInput.disabled = false;
				msgInput.value = 'Update scene';
				commitBtn.dom.disabled = false;
				aiHint.textContent = '';

			} );

		} else {

			msgInput.value = 'Update scene';
			aiHint.textContent = ai
				? strings.getKey( 'menubar/git/commit/ai_not_loaded' )
				: '';

		}

		// ── Commit action ─────────────────────────────────────────────────────
		commitBtn.onClick( async () => {

			const cfg = loadSettings();
			const parsed = parseRepo( cfg.repoUrl );

			if ( ! parsed ) { status.textContent = strings.getKey( 'menubar/git/error/no_repo' ); return; }
			if ( ! cfg.pat )  { status.textContent = strings.getKey( 'menubar/git/error/no_pat' );  return; }

			commitBtn.dom.disabled = true;
			status.textContent = strings.getKey( 'menubar/git/committing' );

			try {

				const apiPath = `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ cfg.scenePath || 'scene.json' }`;
				const branch  = cfg.branch || 'main';

				let sha;
				try {

					const existing = await ghGet( `${ apiPath }?ref=${ branch }`, cfg.pat );
					sha = existing.sha;

				} catch { /* new file */ }

				const sceneJSON  = JSON.stringify( editor.toJSON(), null, 2 );
				const contentB64 = btoa( unescape( encodeURIComponent( sceneJSON ) ) );
				const msg        = msgInput.value.trim() || 'Update scene';

				const payload = { message: msg, content: contentB64, branch };
				if ( sha ) payload.sha = sha;

				await ghPut( apiPath, payload, cfg.pat );
				status.textContent = strings.getKey( 'menubar/git/commit/success' );
				setTimeout( () => this.close(), 800 );

			} catch ( err ) {

				commitBtn.dom.disabled = false;
				status.textContent = `Error: ${ err.message }`;

			}

		} );

	}

	close() { this.dom.remove(); }

}

export { MenubarGit };
