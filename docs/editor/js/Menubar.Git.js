// ── Menubar.Git.js ────────────────────────────────────────────────────────────
// Git repository settings and scene sync (load / commit).
// Uses the GitHub REST API directly via fetch() — no Octokit dependency.
// Settings (repo URL, branch, path, PAT) are persisted in localStorage.

import { UIRow, UIText, UIButton } from './libs/ui.js';
import { sceneContextString } from './scene/summarize.js';
import { diffScenes } from './SceneDiff.js';
import { MergeViewport } from './MergeViewport.js';
import { externalizeScene, internalizeScene, u8ToBase64 } from './GitAssets.js';

// ── Commit-message generation ─────────────────────────────────────────────────
// Uses the already-loaded local AI engine (editor.aiEngine) to generate a
// conventional commit message from the current scene description.
// Returns a plain string — no code, no markdown.

const COMMIT_MSG_SYSTEM = `You write git commit messages for 3D scene files. Rules:
- Output ONLY the message — a single line, no quotes, no trailing period.
- Imperative mood: "Add red box", "Remove sphere", "Reposition tree group".
- Max 72 characters.
- When a diff is provided, base the message on the CHANGES, not the full scene.
- When no diff is provided, summarise the scene contents briefly.
- If the scene is empty, write "Initialize empty scene".`;

const LS_LAST_CTX_KEY = 'git-last-scene-ctx';

// Remember the commit SHA the local copy was last synced to (loaded or committed),
// keyed by repo+branch+path. On startup we compare it against the branch head: if
// they match and a local autosave exists, the local scene is already current and
// we skip re-downloading it entirely.
const LS_SYNC_PREFIX = 'git-sync-commit:';

function syncKey( parsed, path, branch ) {

	return `${ LS_SYNC_PREFIX }${ parsed.owner }/${ parsed.repo }/${ branch }/${ path }`;

}

function getSyncedCommit( parsed, path, branch ) {

	return localStorage.getItem( syncKey( parsed, path, branch ) ) || null;

}

function setSyncedCommit( parsed, path, branch, sha ) {

	if ( sha ) localStorage.setItem( syncKey( parsed, path, branch ), sha );
	else localStorage.removeItem( syncKey( parsed, path, branch ) );

}

// ── Scene diff ────────────────────────────────────────────────────────────────
// Parses the JS-comment context lines and returns a compact change summary.

function diffContextStrings( oldCtx, newCtx ) {

	function parseNames( ctx ) {

		// Each object line looks like:  // [selected] "Name" Mesh ...
		// or                            // "Name" Group ...
		const map = new Map();

		ctx.split( '\n' ).forEach( line => {

			if ( ! line.startsWith( '// ' ) ) return;
			if ( line.includes( 'Camera at(' ) ) return;

			// Remove [selected] marker before comparing so selection state is ignored
			const normalised = line.replace( '\[selected\] ', '' );
			const m = normalised.match( /^\/\/ "([^"]+)"/ );
			if ( m ) map.set( m[ 1 ], normalised );

		} );

		return map;

	}

	const before = parseNames( oldCtx );
	const after  = parseNames( newCtx );

	const added    = [ ...after.keys() ].filter( k => ! before.has( k ) );
	const removed  = [ ...before.keys() ].filter( k => ! after.has( k ) );
	const modified = [ ...after.keys() ].filter( k => before.has( k ) && before.get( k ) !== after.get( k ) );

	const parts = [];
	if ( added.length )    parts.push( 'Added: '    + added.map( n => `"${ n }"` ).join( ', ' ) );
	if ( removed.length )  parts.push( 'Removed: '  + removed.map( n => `"${ n }"` ).join( ', ' ) );
	if ( modified.length ) parts.push( 'Modified: ' + modified.map( n => `"${ n }"` ).join( ', ' ) );

	return parts.length ? parts.join( '\n' ) : null;

}

// ── Message generation ────────────────────────────────────────────────────────

async function generateCommitMessage( editor ) {

	const ai = editor.aiEngine;
	if ( ! ai || ! ai.ready ) return null;

	const currentCtx = sceneContextString( editor );
	const lastCtx    = localStorage.getItem( LS_LAST_CTX_KEY );
	const diff       = lastCtx ? diffContextStrings( lastCtx, currentCtx ) : null;

	let userContent;

	if ( diff ) {

		userContent = 'Changes since last commit:\n' + diff
			+ '\n\nCurrent scene:\n' + currentCtx
			+ '\n\nCommit message:';

	} else {

		userContent = 'Scene (first commit):\n' + currentCtx + '\n\nCommit message:';

	}

	const messages = [
		{ role: 'system', content: COMMIT_MSG_SYSTEM },
		{ role: 'user',   content: userContent },
	];

	const raw = await ai.complete( messages, { maxTokens: 80, temperature: 0.3 } );

	return raw.trim()
		.replace( /^["'`]+|["'`]+$/g, '' )
		.replace( /^\s*commit[:\s]+/i, '' )
		.replace( /^(message|msg)[:\s]+/i, '' )
		.split( '\n' )[ 0 ]      // first line only
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

	// Append a timestamp to bust GitHub CDN caches after a recent commit.
	const sep = path.includes( '?' ) ? '&' : '?';
	const url = `https://api.github.com${ path }${ sep }_ts=${ Date.now() }`;

	const res = await fetch( url, {
		headers: { Authorization: `Bearer ${ token }`, Accept: 'application/vnd.github+json' },
		cache: 'no-store',   // bypass browser HTTP cache
	} );

	if ( ! res.ok ) throw new Error( `GitHub ${ res.status }: ${ await res.text() }` );
	return res.json();

}

// Fetch a file's content as parsed JSON using the GitHub "raw" media type.
// Unlike the default JSON wrapper (which caps at 1 MB and returns empty content
// for larger files), raw returns the file bytes directly up to 100 MB and lets
// fetch decode UTF-8 natively — so no base64/atob and no truncation.
async function ghGetSceneJSON( path, token ) {

	const sep = path.includes( '?' ) ? '&' : '?';
	const url = `https://api.github.com${ path }${ sep }_ts=${ Date.now() }`;

	const res = await fetch( url, {
		headers: { Authorization: `Bearer ${ token }`, Accept: 'application/vnd.github.raw' },
		cache: 'no-store',
	} );

	if ( ! res.ok ) {

		const err = new Error( `GitHub ${ res.status }: ${ await res.text() }` );
		err.status = res.status;   // let callers treat 404 (file not committed yet) specially
		throw err;

	}

	const text = await res.text();
	if ( ! text.trim() ) throw new Error( 'scene file is empty' );

	try {

		return JSON.parse( text );

	} catch ( e ) {

		throw new Error( 'scene file is not valid JSON — ' + e.message );

	}

}

// ── Git Data API (atomic multi-file commit) ───────────────────────────────────
// A single scene may need scene.json plus dozens of large binary asset blobs.
// The Contents API only writes one file at a time (and each PUT is a commit),
// so we use the low-level Git Data API to assemble one tree and one commit:
//   ref → base commit → base tree → blobs → new tree → new commit → move ref.
// Assets are content-addressed (filename embeds the SHA-1 of the bytes), so any
// blob whose path already exists in the base tree is byte-identical and reused —
// unchanged geometry is never re-uploaded.

async function ghSend( method, path, body, token ) {

	const res = await fetch( `https://api.github.com${ path }`, {
		method,
		headers: {
			Authorization: `Bearer ${ token }`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( body ),
	} );

	if ( ! res.ok ) {

		const err = new Error( `GitHub ${ res.status }: ${ await res.text() }` );
		err.status = res.status;
		throw err;

	}

	return res.json();

}

// Fetch a file's raw bytes (used to rehydrate externalized assets on load).
// Content-addressed asset paths (assets/<sha1>.*) are immutable, so their bytes
// are cached in the browser Cache Storage: on a later load only NEW blobs hit the
// network — unchanged geometry is served locally. Non-asset paths bypass the cache.
async function ghGetBytes( parsed, branch, path, token ) {

	const immutable = path.startsWith( 'assets/' );
	const cacheUrl  = `https://strata.local/git-asset/${ parsed.owner }/${ parsed.repo }/${ path }`;

	let cache = null;
	if ( immutable && typeof caches !== 'undefined' ) {

		try {

			cache = await caches.open( 'git-assets-v1' );
			const hit = await cache.match( cacheUrl );
			if ( hit ) return new Uint8Array( await hit.arrayBuffer() );

		} catch { cache = null; }

	}

	const url = `https://api.github.com/repos/${ parsed.owner }/${ parsed.repo }/contents/${ path }?ref=${ branch }&_ts=${ Date.now() }`;

	const res = await fetch( url, {
		headers: { Authorization: `Bearer ${ token }`, Accept: 'application/vnd.github.raw' },
		cache: 'no-store',
	} );

	if ( ! res.ok ) throw new Error( `GitHub ${ res.status } fetching ${ path }: ${ await res.text() }` );

	const bytes = new Uint8Array( await res.arrayBuffer() );

	if ( cache ) { try { await cache.put( cacheUrl, new Response( bytes ) ); } catch { /* cache full — non-fatal */ } }

	return bytes;

}

// files: [ { path, base64, immutable } ]. `immutable` files (content-addressed
// assets) are skipped when a blob already lives at that path in the base tree.
async function commitFiles( parsed, branch, token, files, message, onProgress ) {

	const base = `/repos/${ parsed.owner }/${ parsed.repo }`;

	// Resolve the branch head + its tree. A missing branch (empty repo / typo)
	// surfaces as a clear error rather than a cryptic 404 later.
	let ref;
	try {

		ref = await ghGet( `${ base }/git/ref/heads/${ branch }`, token );

	} catch ( err ) {

		if ( err.message && err.message.includes( '404' ) ) {

			throw new Error( `Branch "${ branch }" not found — create it with an initial commit first.` );

		}

		throw err;

	}

	const headSha    = ref.object.sha;
	const headCommit = await ghGet( `${ base }/git/commits/${ headSha }`, token );
	const baseTree   = headCommit.tree.sha;

	// Existing paths let us skip re-uploading unchanged, content-addressed assets.
	let existing = null;
	try {

		const tree = await ghGet( `${ base }/git/trees/${ baseTree }?recursive=1`, token );
		if ( ! tree.truncated ) {

			existing = new Set( ( tree.tree || [] ).map( t => t.path ) );

		}

	} catch { /* dedup is best-effort */ }

	const treeItems = [];
	let done = 0;

	for ( const f of files ) {

		if ( f.immutable && existing && existing.has( f.path ) ) { done ++; continue; }

		const blob = await ghSend( 'POST', `${ base }/git/blobs`, { content: f.base64, encoding: 'base64' }, token );
		treeItems.push( { path: f.path, mode: '100644', type: 'blob', sha: blob.sha } );

		done ++;
		if ( onProgress ) onProgress( done, files.length );

	}

	if ( treeItems.length === 0 ) {

		// Nothing changed — return the current head so callers can report success.
		return headCommit;

	}

	const newTree = await ghSend( 'POST', `${ base }/git/trees`, { base_tree: baseTree, tree: treeItems }, token );
	const commit  = await ghSend( 'POST', `${ base }/git/commits`, { message, tree: newTree.sha, parents: [ headSha ] }, token );
	await ghSend( 'PATCH', `${ base }/git/refs/heads/${ branch }`, { sha: commit.sha }, token );

	return commit;

}

// Rehydrate a scene fetched from GitHub: replace every { $bin } / { $img }
// reference with its bytes. Fetches are cached by path so buffers shared across
// geometries (deduped on commit) are downloaded only once. No-op for legacy
// inline scenes.
async function internalizeFromGit( json, parsed, branch, token ) {

	const cache = new Map();
	const fetchBytes = ( path ) => {

		if ( ! cache.has( path ) ) cache.set( path, ghGetBytes( parsed, branch, path, token ) );
		return cache.get( path );

	};

	return internalizeScene( json, fetchBytes );

}
// ── Compare with remote (merge conflict viewport) ─────────────────────────────

async function openGitCompare( editor, strings ) {

	const cfg    = loadSettings();
	const parsed = parseRepo( cfg.repoUrl );

	if ( ! parsed || ! cfg.pat ) {

		alert( strings.getKey( 'menubar/git/no_settings' ) );
		return;

	}

	const banner = document.createElement( 'div' );
	banner.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:6px 16px;border-radius:4px;z-index:9999;font:12px monospace;';
	banner.textContent = `Fetching ${ parsed.owner }/${ parsed.repo }…`;
	document.body.appendChild( banner );

	try {

		const apiPath  = `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ cfg.scenePath || 'scene.json' }?ref=${ cfg.branch || 'main' }`;
		const remote   = await ghGetSceneJSON( apiPath, cfg.pat );
		await internalizeFromGit( remote, parsed, cfg.branch || 'main', cfg.pat );
		const local    = editor.scene.toJSON();
		const diff     = diffScenes( local, remote );

		banner.remove();

		const mv = new MergeViewport( editor, local, remote, diff );
		await mv.open();

	} catch ( err ) {

		banner.remove();
		alert( `Compare failed: ${ err.message }` );

	}

}

// ── Settings Dialog ───────────────────────────────────────────────────────────

class GitSettingsDialog {

	constructor( strings, onSave ) {

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
			if ( typeof onSave === 'function' ) onSave();
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
				const json = await ghGetSceneJSON( apiPath, cfg.pat );
				await internalizeFromGit( json, parsed, cfg.branch || 'main', cfg.pat );
				editor.clear();
				await editor.fromJSON( json );

				// Establish baseline so the first commit after load diffs correctly
				localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

				// Record the commit we loaded so the next startup can skip re-downloading.
				try {

					const ref = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/git/ref/heads/${ cfg.branch || 'main' }`, cfg.pat );
					setSyncedCommit( parsed, cfg.scenePath || 'scene.json', cfg.branch || 'main', ref && ref.object && ref.object.sha );

				} catch { /* non-fatal */ }

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

		// (hint div removed — placeholder on msgInput carries the state)

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
			msgInput.placeholder = '…';
			commitBtn.dom.disabled = true;

			generateCommitMessage( editor ).then( msg => {

				msgInput.disabled = false;
				commitBtn.dom.disabled = false;
				msgInput.value = msg || 'Update scene';
				msgInput.placeholder = strings.getKey( 'menubar/git/commit/placeholder' );
				msgInput.focus();
				msgInput.select();

			} ).catch( () => {

				msgInput.disabled = false;
				commitBtn.dom.disabled = false;
				msgInput.value = 'Update scene';
				msgInput.placeholder = strings.getKey( 'menubar/git/commit/placeholder' );

			} );

		} else {

			msgInput.value = 'Update scene';

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

				const scenePath = cfg.scenePath || 'scene.json';
				const branch    = cfg.branch || 'main';
				const msg       = msgInput.value.trim() || 'Update scene';

				// Split the scene into a small, diffable scene.json plus separate
				// binary asset blobs (geometry buffers / images). This keeps the
				// committed scene file tiny and avoids serializing hundreds of MB
				// of float text — which previously overflowed btoa()/string limits
				// and exceeded GitHub's per-file size cap.
				status.textContent = 'Preparing assets…';
				const { json, assets } = await externalizeScene( editor.toJSON() );

				const sceneBytes = new TextEncoder().encode( JSON.stringify( json, null, 2 ) );

				const files = [];
				for ( const [ path, u8 ] of assets ) {

					files.push( { path, base64: u8ToBase64( u8 ), immutable: true } );

				}
				files.push( { path: scenePath, base64: u8ToBase64( sceneBytes ), immutable: false } );

				// One atomic commit for scene.json + all (new) assets.
				const commit = await commitFiles( parsed, branch, cfg.pat, files, msg, ( done, total ) => {

					status.textContent = `Uploading ${ done }/${ total }…`;

				} );

				// Record the commit we just synced to, so the next startup sees the
				// local copy as current and skips re-downloading the whole scene.
				setSyncedCommit( parsed, scenePath, branch, commit && commit.sha );

				// Snapshot current context so the next commit can diff against it
				localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

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

// ── Auto-load on page start ───────────────────────────────────────────────────
// Called from index.html after editor.storage.get() completes.
// If a GitHub repo is configured, fetches the scene file and replaces whatever
// the local autosave restored. Fails silently so the editor still opens normally
// when offline or when credentials have expired.

export async function autoLoadFromGit( editor, opts = {} ) {

	// User explicitly chose File → New — respect that choice for this reload.
	if ( localStorage.getItem( 'git-skip-autoload' ) ) {

		localStorage.removeItem( 'git-skip-autoload' );
		return;

	}

	const cfg    = loadSettings();
	const parsed = parseRepo( cfg.repoUrl );

	if ( ! parsed || ! cfg.pat ) return;  // not configured

	const scenePath = cfg.scenePath || 'scene.json';
	const branch    = cfg.branch || 'main';

	// Fast path: ask GitHub only for the branch head (a few hundred bytes). If it
	// matches the commit our local copy was last synced to — and a local autosave
	// actually exists — the local scene is already current, so skip downloading
	// the whole scene (and every asset blob) entirely.
	if ( opts.hasLocalScene ) {

		try {

			const ref     = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/git/ref/heads/${ branch }`, cfg.pat );
			const headSha = ref && ref.object && ref.object.sha;

			if ( headSha && headSha === getSyncedCommit( parsed, scenePath, branch ) ) {

				_showBanner( `✓ Local scene is current with ${ parsed.owner }/${ parsed.repo }`, 2000 );
				return;

			}

		} catch { /* head lookup failed — fall through to a normal full load */ }

	}

	const banner = _showBanner( `Loading scene from ${ parsed.owner }/${ parsed.repo }…` );

	try {

		const apiPath = `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ scenePath }?ref=${ branch }`;
		const json    = await ghGetSceneJSON( apiPath, cfg.pat );

		await internalizeFromGit( json, parsed, branch, cfg.pat );

		editor.clear();
		await editor.fromJSON( json );

		// Establish diff baseline for the next commit
		localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

		// Record the commit we just loaded so subsequent startups can skip the
		// full download while the local copy stays current.
		try {

			const ref = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/git/ref/heads/${ branch }`, cfg.pat );
			setSyncedCommit( parsed, scenePath, branch, ref && ref.object && ref.object.sha );

		} catch { /* non-fatal — next startup just does a normal load */ }

		_showBanner( `✓ Scene loaded from ${ parsed.owner }/${ parsed.repo }`, 2500 );

	} catch ( err ) {

		if ( err.status === 404 ) {

			// Scene file not committed yet — keep whatever is loaded locally and
			// let the first commit create it. This is a normal first-run state,
			// not a failure. (The browser still logs the 404 network response.)
			setSyncedCommit( parsed, scenePath, branch, null );
			_showBanner( `No scene at ${ scenePath } yet — commit to create it`, 3000 );

		} else {

			_showBanner( `Git auto-load failed: ${ err.message }`, 4000 );

		}

	} finally {

		banner.remove();

	}

}

// Transient status banner — appears at top of viewport, fades out automatically
function _showBanner( text, durationMs = 0 ) {

	const el = document.createElement( 'div' );

	el.textContent = text;
	el.style.cssText = [
		'position:fixed', 'top:32px', 'left:50%', 'transform:translateX(-50%)',
		'background:rgba(0,0,0,0.75)', 'color:#fff', 'font:12px/1.6 monospace',
		'padding:6px 14px', 'border-radius:4px', 'z-index:99999',
		'pointer-events:none', 'transition:opacity 0.4s',
	].join( ';' );

	document.body.appendChild( el );

	if ( durationMs > 0 ) {

		setTimeout( () => { el.style.opacity = '0'; setTimeout( () => el.remove(), 450 ); }, durationMs );

	}

	return el;

}

export { GitSettingsDialog, GitLoadDialog, GitCommitDialog, openGitCompare };
