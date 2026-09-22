// ── Menubar.Git.js ────────────────────────────────────────────────────────────
// Git repository settings and scene sync (load / commit).
// READS (scene JSON + assets) resolve through CDN edges (GitResolver.js) —
// api.github.com is a last resort fallback only, never the common path (see
// GitResolver.js for why: the API's 60 req/hr anonymous cap breaks a
// classroom behind one shared IP, or an embed link that gets real traffic).
// WRITES (commits) still use the GitHub REST API directly via fetch() (no
// Octokit dependency) — there is no CDN write path, only reads.
// Settings (repo URL, branch, path, PAT) are persisted in localStorage.

import { UIRow, UIText, UIButton } from './libs/ui.js';
import { sceneContextString } from './scene/summarize.js';
import { diffScenes } from './SceneDiff.js';
import { MergeViewport } from './MergeViewport.js';
import { externalizeScene, internalizeScene, u8ToBase64 } from './GitAssets.js';
import { splitRepoRef, resolveSceneJSON, resolveAssetBytes } from './GitResolver.js';

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

// ── Parse owner/repo from a GitHub URL, or the bare "owner/repo" shorthand ────

function parseRepo( url ) {

	const str = String( url ).trim().replace( /\.git$/, '' );

	const m = str.match( /github\.com[/:]([^/]+)\/([^/]+)/ );
	if ( m ) return { owner: m[ 1 ], repo: m[ 2 ] };

	// Bare "owner/repo" (no host) — what a URL hash preload naturally carries.
	const shorthand = str.match( /^([\w.-]+)\/([\w.-]+)$/ );
	if ( shorthand ) return { owner: shorthand[ 1 ], repo: shorthand[ 2 ] };

	return null;

}

// ── GitHub REST helpers ───────────────────────────────────────────────────────

// Omits Authorization entirely when no token is given, rather than sending a
// malformed "Bearer undefined"/"Bearer null" — GitHub treats a bad bearer token
// as a 401 even on public repos, whereas a genuinely anonymous request is
// allowed (at a lower, IP-based rate limit) for public-repo reads. Committing
// always needs a real token regardless; only reads can go tokenless.
function ghHeaders( token, accept ) {

	const headers = { Accept: accept };
	if ( token ) headers.Authorization = `Bearer ${ token }`;
	return headers;

}

async function ghGet( path, token ) {

	// Append a timestamp to bust GitHub CDN caches after a recent commit.
	const sep = path.includes( '?' ) ? '&' : '?';
	const url = `https://api.github.com${ path }${ sep }_ts=${ Date.now() }`;

	const res = await fetch( url, {
		headers: ghHeaders( token, 'application/vnd.github+json' ),
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
		headers: ghHeaders( token, 'application/vnd.github.raw' ),
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

// ── Repo browsing (branches / commits / root scene files) ────────────────────
// Backs the small "▾" pickers next to Branch/Commit/Scene file in the Git tab.
// Unlike the automatic scene-load path, these are one-off, user-triggered
// lookups with no CDN equivalent ("list branches"/"list commits"/"list a
// directory" aren't single files jsDelivr/raw can serve), so they go straight
// to the GitHub API — infrequent enough that the anonymous rate limit isn't a
// concern here the way it was for the hot load path.

export async function listBranches( parsed, token ) {

	const branches = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/branches?per_page=100`, token );
	return branches.map( b => b.name );

}

export async function listCommits( parsed, ref, path, token ) {

	const q = new URLSearchParams( { sha: ref || 'main', per_page: '30' } );
	if ( path ) q.set( 'path', path );
	const commits = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/commits?${ q }`, token );
	return commits.map( c => ( {
		sha: c.sha,
		message: ( c.commit.message || '' ).split( '\n' )[ 0 ],
		date: c.commit.author && c.commit.author.date,
	} ) );

}

export async function listRootJsonFiles( parsed, ref, token ) {

	const q = ref ? `?ref=${ encodeURIComponent( ref ) }` : '';
	const entries = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ q }`, token );
	if ( ! Array.isArray( entries ) ) return [];
	return entries.filter( e => e.type === 'file' && e.name.endsWith( '.json' ) ).map( e => e.name );

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
//
// The network fetch itself goes through GitResolver's CDN-first resolver
// (raw.githubusercontent.com / jsDelivr, ordered by `mode` — see that module's
// comment for why), with the GitHub Contents API only as a last resort — the
// API can also serve stale bytes for a short while right after a large
// multi-file commit, on top of being rate-limited, so falling back to it is
// strictly worse than the CDN reads on both counts, not just quota.
async function ghGetBytes( parsed, branch, path, token, mode ) {

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

	const bytes = await resolveAssetBytes( {
		owner: parsed.owner,
		repo: parsed.repo,
		ref: branch,
		path,
		mode,
		apiFetch: async ( apiRef ) => {

			// Last resort: the Contents API — needs a token for private repos,
			// works even when both CDN backends are unreachable.
			const url = `https://api.github.com/repos/${ parsed.owner }/${ parsed.repo }/contents/${ path }?ref=${ apiRef }&_ts=${ Date.now() }`;

			const res = await fetch( url, {
				headers: ghHeaders( token, 'application/vnd.github.raw' ),
				cache: 'no-store',
			} );

			if ( ! res.ok ) throw new Error( `GitHub ${ res.status } fetching ${ path }: ${ await res.text() }` );

			return new Uint8Array( await res.arrayBuffer() );

		},
	} );

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
// inline scenes. `mode` ('authoring' | 'present') picks the CDN backend order —
// see GitResolver.js.
async function internalizeFromGit( json, parsed, branch, token, mode ) {

	const cache = new Map();
	const fetchBytes = ( path ) => {

		if ( ! cache.has( path ) ) cache.set( path, ghGetBytes( parsed, branch, path, token, mode ) );
		return cache.get( path );

	};

	return internalizeScene( json, fetchBytes );

}
// ── Compare with remote (merge conflict viewport) ─────────────────────────────

async function openGitCompare( editor, strings ) {

	const cfg    = loadSettings();
	const parsed = parseRepo( cfg.repoUrl );

	// Comparing is a read, same as loading — no token needed for a public repo.
	if ( ! parsed ) {

		alert( strings.getKey( 'menubar/git/no_settings' ) );
		return;

	}

	const banner = document.createElement( 'div' );
	banner.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:6px 16px;border-radius:4px;z-index:9999;font:12px monospace;';
	banner.textContent = `Fetching ${ parsed.owner }/${ parsed.repo }…`;
	document.body.appendChild( banner );

	try {

		const scenePath = cfg.scenePath || 'scene.json';
		const branch    = cfg.branch || null; // null -> resolveSceneJSON tries main then master
		const commitCfg = ( cfg.commit || '' ).trim() || null; // pinned SHA/tag override; empty = "latest" (use branch)
		const resolved  = await resolveSceneJSON( {
			owner: parsed.owner, repo: parsed.repo, ref: commitCfg || branch, path: scenePath, mode: 'authoring',
			apiFetch: ( apiRef ) => ghGetSceneJSON( `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ scenePath }?ref=${ apiRef }`, cfg.pat ),
		} );
		const remote = resolved.json;
		await internalizeFromGit( remote, parsed, resolved.ref, cfg.pat, 'authoring' );
		// ghGetSceneJSON returns the FULL editor.toJSON() wrapper
		// ({ metadata, project, camera, scene: {...}, ... }) — but `local` below
		// and diffScenes()/MergeViewport both expect a raw THREE.Scene.toJSON()
		// shape (`.object.children` at the top level, no `scene:` wrapper).
		// Passing the wrapper directly made `remoteJSON.object` always undefined,
		// so every local object was misreported as "added" regardless of whether
		// it actually matched the remote content.
		const remoteScene = remote.scene || remote;
		const local    = editor.scene.toJSON();
		const diff     = diffScenes( local, remoteScene );

		banner.remove();

		const mv = new MergeViewport( editor, local, remoteScene, diff );
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

// ── Shared load/commit logic ──────────────────────────────────────────────────
// Used by autoLoadFromGit (page-start) AND SidebarGit's inline Load/Commit
// buttons — one code path, reported through an onStatus/onProgress callback
// instead of each caller re-implementing the same fetch/internalize/apply
// (or externalize/upload) sequence behind its own popup.

// Fetches scene.json + assets from the configured repo and swaps it into the
// editor. Throws (with `.status` set for a 404) on failure — callers decide
// how to surface that.
export async function loadSceneFromRepo( editor, { onStatus = () => {} } = {} ) {

	const cfg    = loadSettings();
	const parsed = parseRepo( cfg.repoUrl );
	if ( ! parsed ) throw new Error( 'No repository configured' );

	const scenePath = cfg.scenePath || 'scene.json';
	const branchCfg = cfg.branch || null; // null -> resolveSceneJSON tries main then master
	const commitCfg = ( cfg.commit || '' ).trim() || null; // pinned SHA/tag override; empty = "latest" (use branchCfg)

	onStatus( 0.15, `Fetching ${ scenePath }…` );
	const resolved = await resolveSceneJSON( {
		owner: parsed.owner, repo: parsed.repo, ref: commitCfg || branchCfg, path: scenePath, mode: 'authoring',
		apiFetch: ( apiRef ) => ghGetSceneJSON( `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ scenePath }?ref=${ apiRef }`, cfg.pat ),
	} );
	const json   = resolved.json;
	const branch = resolved.ref; // the ref that actually resolved (commitCfg/branchCfg, or main/master if both were null)

	onStatus( 0.5, 'Fetching assets…' );
	await internalizeFromGit( json, parsed, branch, cfg.pat, 'authoring' );

	onStatus( 0.85, 'Applying scene…' );
	editor.clear();
	await editor.fromJSON( json );

	localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

	// Record the commit we just loaded so a later startup/compare can skip a
	// redundant re-download while the local copy stays current. Best-effort —
	// a failure here doesn't affect the load that already succeeded. Skipped
	// when pinned to a specific commit/tag: there is no "heads/<sha>" ref to
	// look up, and the whole point of a pin is to ignore the branch's HEAD.
	if ( ! commitCfg ) {

		try {

			const ref = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/git/ref/heads/${ branch }`, cfg.pat );
			setSyncedCommit( parsed, scenePath, branch, ref && ref.object && ref.object.sha );

		} catch { /* non-fatal */ }

	}

	onStatus( 1, `✓ Loaded ${ parsed.owner }/${ parsed.repo }` );

	return { owner: parsed.owner, repo: parsed.repo, scenePath, branch };

}

// Externalizes + uploads the current scene as one atomic commit. Reports real
// upload progress (blob count, not just a spinner) via onProgress(fraction, msg).
export async function commitSceneToRepo( editor, message, { onProgress = () => {} } = {} ) {

	const cfg    = loadSettings();
	const parsed = parseRepo( cfg.repoUrl );
	if ( ! parsed ) throw new Error( 'No repository configured' );
	if ( ! cfg.pat ) throw new Error( 'A token is required to commit' );

	const scenePath = cfg.scenePath || 'scene.json';
	const branch    = cfg.branch || 'main';
	const msg       = ( message || '' ).trim() || 'Update scene';

	onProgress( 0, 'Preparing assets…' );

	// Split the scene into a small, diffable scene.json plus separate binary
	// asset blobs (geometry buffers / images) — keeps the committed scene file
	// tiny and avoids serializing hundreds of MB of float text.
	const { json, assets } = await externalizeScene( editor.toJSON() );
	const sceneBytes = new TextEncoder().encode( JSON.stringify( json, null, 2 ) );

	const files = [];
	for ( const [ path, u8 ] of assets ) files.push( { path, base64: u8ToBase64( u8 ), immutable: true } );
	files.push( { path: scenePath, base64: u8ToBase64( sceneBytes ), immutable: false } );

	// One atomic commit for scene.json + all (new) assets.
	const commit = await commitFiles( parsed, branch, cfg.pat, files, msg, ( done, total ) => {

		onProgress( done / total, `Uploading ${ done }/${ total }…` );

	} );

	setSyncedCommit( parsed, scenePath, branch, commit && commit.sha );
	localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

	onProgress( 1, '✓ Committed' );

	return commit;

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

	// A token is only required to COMMIT — every read call below (ghGet,
	// ghGetSceneJSON, ghGetBytes via internalizeFromGit) already omits the
	// Authorization header entirely when cfg.pat is falsy, so a saved repo URL
	// alone is enough to auto-load a public repo tokenlessly.
	if ( ! parsed ) return;  // no repo configured

	const scenePath = cfg.scenePath || 'scene.json';
	const branch    = cfg.branch || 'main';
	const commitCfg = ( cfg.commit || '' ).trim() || null; // pinned SHA/tag override; empty = "latest" (track branch HEAD)

	// Fast path: ask GitHub only for the branch head (a few hundred bytes). If it
	// matches the commit our local copy was last synced to — and a local autosave
	// actually exists — the local scene is already current, so skip downloading
	// the whole scene (and every asset blob) entirely. Meaningless (and skipped)
	// when pinned to a specific commit/tag — there's no moving HEAD to track.
	if ( opts.hasLocalScene && ! commitCfg ) {

		try {

			const ref     = await ghGet( `/repos/${ parsed.owner }/${ parsed.repo }/git/ref/heads/${ branch }`, cfg.pat );
			const headSha = ref && ref.object && ref.object.sha;

			if ( headSha && headSha === getSyncedCommit( parsed, scenePath, branch ) ) {

				// The remote head still points at the commit we last synced to, so
				// there is nothing new to pull. That alone does NOT prove parity: the
				// user may have edited (and autosaved) the scene locally since then.
				// Confirm the local scene still matches the baseline captured at the
				// last sync before claiming it is current. diffContextStrings ignores
				// selection/camera and returns null only when nothing meaningful changed.
				const baseline    = localStorage.getItem( LS_LAST_CTX_KEY );
				const localChanged = baseline === null
					|| diffContextStrings( baseline, sceneContextString( editor ) ) !== null;

				if ( localChanged ) {

					_showBanner( `Local scene has uncommitted changes — ${ parsed.owner }/${ parsed.repo } is unchanged`, 3500 );

				} else {

					_showBanner( `✓ Local scene is current with ${ parsed.owner }/${ parsed.repo }`, 2000 );

				}

				return;

			}

		} catch { /* head lookup failed — fall through to a normal full load */ }

	}

	const banner = _showBanner( `Loading scene from ${ parsed.owner }/${ parsed.repo }…` );
	showLoadOverlay();

	try {

		await loadSceneFromRepo( editor, { onStatus: ( fraction, message ) => { banner.textContent = message; setLoadProgress( fraction, message ); } } );

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
		hideLoadOverlay();

	}

}

// ── Hash-based scene preload ──────────────────────────────────────────────────
// #repo=<owner>/<repo>[@ref]&file=<path>[&branch=<branch>][&commit=<sha|tag>]
// [&play=true|false][&present=true|preview=true] in the URL loads that scene
// from a repo on page load. No token, and (the common case) no GitHub API
// calls at all — the file and its assets resolve through CDN edges (jsDelivr /
// raw.githubusercontent.com, see GitResolver.js) so a classroom behind one
// shared IP, or an embed link under real traffic, never hits the GitHub API's
// 60 req/hr anonymous cap. The API is only ever used as a last-resort fallback
// (a CDN miss on a very fresh push, or a CDN outage) — `existingPat`, if any,
// applies ONLY to that fallback.
// An optional "@ref" on the repo param (branch/tag/commit SHA) picks a specific
// version; `&branch=` (if present) wins over it; `&commit=` — a pin to an
// EXACT commit SHA or tag — wins over both (most specific always wins); with
// none of the three given, 'main' is tried then 'master'. present=true (or its
// alias preview=true) prefers jsDelivr first (scale over freshness); otherwise
// raw is tried first (freshness).
// The overlay play button (see index.html) shows by default whenever the loaded
// scene actually has an animation to play — a shareable "watch this" link needs
// no extra flag. play=true forces it on (e.g. for a scene whose animation lives
// off a Timeline clip in some other form); play=false forces it off even if the
// scene does have one (e.g. sharing a static pose/build, not the animated short).
// Any parse or network failure here is swallowed (console-warned, never
// thrown/alerted) so a bad or absent hash always falls through to the normal
// boot sequence unchanged — this is a pure addition, never a way to break it.
// Committing back still needs a real PAT, entered in the Git tab as usual.
// Returns `false` on any failure/absence, or `{ loaded: true, play: boolean }`
// on success — both forms are correctly truthy/falsy for a plain `if (...)` check.
export async function loadSceneFromHash( editor ) {

	const hash = window.location.hash;
	if ( ! hash || hash.indexOf( 'repo=' ) === - 1 ) return false;

	let params;
	try {

		// Strip ALL leading '#' (not just one) — a stray "##repo=…" (e.g. from a
		// pasted URL or an extra '#' typed in the address bar) otherwise leaves a
		// literal '#' stuck onto the first param name, so URLSearchParams parses
		// it as key "#repo" instead of "repo" and this silently no-ops below.
		params = new URLSearchParams( hash.replace( /^#+/, '' ) );

	} catch {

		return false;

	}

	const repoParam  = params.get( 'repo' );
	const file       = params.get( 'file' );
	const branchParam = params.get( 'branch' ); // explicit &branch= wins over an "@ref" on the repo param
	const commitParam = params.get( 'commit' ); // explicit &commit= wins over everything else (most specific pin)
	const playParam  = params.get( 'play' ); // 'true' | 'false' | null (default: on iff the scene has an animation)
	const presentMode = params.get( 'present' ) === 'true' || params.get( 'preview' ) === 'true'; // 'preview' is an accepted alias

	if ( ! repoParam || ! file ) return false;

	const { base: repoBase, ref: repoRef } = splitRepoRef( repoParam ); // optional "owner/repo@ref" — never required
	const parsed = parseRepo( repoBase );

	if ( ! parsed ) {

		console.warn( `loadSceneFromHash(): "${ repoParam }" is not a valid GitHub repo ("owner/repo" or a github.com URL) — ignoring URL hash, booting normally.` );
		return false;

	}

	// null -> resolveSceneJSON tries 'main' then 'master'. Precedence when more
	// than one is given: &commit= (most specific pin) > &branch= > an "@ref" on
	// repo= itself > nothing.
	const ref  = commitParam || branchParam || repoRef || null;
	const mode = presentMode ? 'present' : 'authoring'; // picks the CDN backend order — see GitResolver.js

	// An existing token (saved from a prior session) is reused if it happens to
	// cover this repo — but reading never REQUIRES one for a public repo, so a
	// missing/wrong token here still degrades to a plain anonymous read rather
	// than failing outright. Only ever used for the GitHub-API fallback (the
	// common path below is CDN-only, no token needed or sent).
	const existingPat = loadSettings().pat || null;

	const banner = _showBanner( `Loading ${ parsed.owner }/${ parsed.repo } from URL…` );
	showLoadOverlay();
	setLoadProgress( 0.1, `Loading ${ parsed.owner }/${ parsed.repo }…` );

	try {

		setLoadProgress( 0.15, `Fetching ${ file }…` );
		const resolved = await resolveSceneJSON( {
			owner: parsed.owner, repo: parsed.repo, ref, path: file, mode,
			apiFetch: ( apiRef ) => ghGetSceneJSON( `/repos/${ parsed.owner }/${ parsed.repo }/contents/${ file }?ref=${ apiRef }`, existingPat ),
		} );
		const json   = resolved.json;
		const branch = resolved.ref; // the ref that actually resolved (ref, or main/master if it was null)

		setLoadProgress( 0.5, 'Fetching assets…' );
		await internalizeFromGit( json, parsed, branch, existingPat, mode );

		setLoadProgress( 0.85, 'Applying scene…' );
		editor.clear();
		await editor.fromJSON( json );

		// play=true/false always wins explicitly; with neither, the overlay
		// defaults to showing whenever the loaded scene actually has something to
		// play — a shared link to a static (non-animated) scene shouldn't offer a
		// play button that does nothing.
		const hasAnimation = ( editor.timeline && editor.timeline.duration > 0 )
			|| ( Array.isArray( editor.scene.animations ) && editor.scene.animations.some( c => c.duration > 0 ) );
		const play = playParam === 'false' ? false : ( playParam === 'true' ? true : !! hasAnimation );

		localStorage.setItem( LS_LAST_CTX_KEY, sceneContextString( editor ) );

		// Reflect what was loaded in the Git tab (repo/branch/commit/file) so
		// Compare/Commit target the same place — WITHOUT touching any saved
		// token; that keeps working (or keeps being absent) exactly as it already
		// was. The Branch field only ever shows an actual branch name — a
		// &commit= pin lives in its own field, never overwriting Branch with a
		// raw SHA.
		const priorSettings = loadSettings();
		saveSettings( { ...priorSettings, repoUrl: `https://github.com/${ parsed.owner }/${ parsed.repo }`, branch: branchParam || repoRef || priorSettings.branch || 'main', commit: commitParam || '', scenePath: file } );
		editor.signals.gitSettingsChanged.dispatch();

		// Deliberately NOT recording a synced-commit SHA here (unlike
		// loadSceneFromRepo) — that bookkeeping exists purely so a LATER
		// autoLoadFromGit can skip a redundant re-download, and doing it would
		// mean an api.github.com ref lookup on every hash-loaded scene. This is
		// exactly the common/high-traffic path (shared classroom links, embeds)
		// GitResolver.js exists to keep off the GitHub API entirely.

		setLoadProgress( 1, `✓ Loaded ${ parsed.owner }/${ parsed.repo }/${ file }` );
		hideLoadOverlay();
		banner.remove();
		const tokenHint = existingPat ? '' : ' — add a token in the Git tab to enable commits';
		_showBanner( `✓ Loaded ${ parsed.owner }/${ parsed.repo }/${ file } from URL${ tokenHint }`, 4000 );

		return { loaded: true, play };

	} catch ( err ) {

		hideLoadOverlay();
		banner.remove();

		// Accurate, distinct messages per failure kind — a missing file should
		// never be reported as "rate limited" (SceneFetchError.kind, set by
		// GitResolver.js; a plain Error from elsewhere just falls to 'network').
		const kind = err.kind || 'network';
		const reason = kind === 'not-found' ? `no "${ file }" at ${ parsed.owner }/${ parsed.repo }`
			: kind === 'rate-limited' ? 'GitHub API rate limit reached (CDN reads also failed)'
			: kind === 'parse-error' ? 'scene file is not valid JSON'
			: `network error — ${ err.message }`;

		console.warn( `loadSceneFromHash(): failed to load ${ parsed.owner }/${ parsed.repo }/${ file } — ${ reason }. Falling back to normal startup.` );
		_showBanner( `Could not load ${ parsed.owner }/${ parsed.repo }/${ file } — ${ reason }`, 5000 );
		return false;

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

// ── Scene-load viewport overlay ────────────────────────────────────────────────
// Mirrors Sidebar.Render.js's render-progress overlay (same look, same
// title/bar/label structure) so loading a scene (URL-hash preload, boot-time
// git auto-load, or the Git tab's manual Load button) reads as the same kind
// of "this takes a moment, here's how far along it is" operation as a render —
// shown over the 3D view itself so it's visible even if the sidebar is
// scrolled out of sight/collapsed/on a different tab.
let _loadOverlay = null;

function _ensureLoadOverlay() {

	if ( _loadOverlay ) return _loadOverlay;

	_loadOverlay = document.createElement( 'div' );
	_loadOverlay.id = 'scene-load-overlay';
	_loadOverlay.style.cssText = 'position:absolute;inset:0;z-index:90;display:none;' +
		'flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
		'background:rgba(20,20,20,0.75);color:#eee;' +
		'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
		'text-align:center;padding:24px;box-sizing:border-box;pointer-events:none;';
	_loadOverlay.innerHTML =
		'<div style="font-size:14px;font-weight:bold;">Loading Scene\u2026</div>' +
		'<div style="width:min(320px,70%);height:10px;background:rgba(255,255,255,0.15);border-radius:5px;overflow:hidden;">' +
			'<div class="bar" style="height:100%;width:0%;background:#08f;transition:width 0.1s linear;"></div>' +
		'</div>' +
		'<div class="label" style="font-size:12px;opacity:0.85;max-width:360px;"></div>';

	return _loadOverlay;

}

export function showLoadOverlay() {

	const overlay = _ensureLoadOverlay();
	const viewport = document.getElementById( 'viewport' );
	if ( viewport && overlay.parentNode !== viewport ) viewport.appendChild( overlay );
	overlay.style.display = 'flex';

}

export function setLoadProgress( fraction, message ) {

	const overlay = _ensureLoadOverlay();
	overlay.querySelector( '.bar' ).style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';
	overlay.querySelector( '.label' ).textContent = message || '';

}

export function hideLoadOverlay() {

	if ( _loadOverlay ) _loadOverlay.style.display = 'none';

}

// Big centered "▶" overlay for a #...&play=true shareable link — a viewer lands
// on a fully-loaded, non-animating scene and clicks once to start the Universal
// Timeline (autoplay-on-load is blocked by browsers for audio/video anyway, and
// an explicit click is clearer than a scene that silently starts moving).
// Dispatches timelinePlayRequested (Timeline.js owns the actual play() call)
// then removes itself — one-shot, not a persistent playback control.
export function showPlayOverlay( editor ) {

	const overlay = document.createElement( 'div' );
	overlay.style.cssText = [
		'position:fixed', 'inset:0', 'display:flex', 'align-items:center', 'justify-content:center',
		'background:rgba(0,0,0,0.25)', 'z-index:99998', 'cursor:pointer',
	].join( ';' );
	overlay.title = 'Play';

	const button = document.createElement( 'div' );
	button.style.cssText = [
		'width:96px', 'height:96px', 'border-radius:50%',
		'background:rgba(20,20,20,0.85)', 'border:3px solid #fff',
		'display:flex', 'align-items:center', 'justify-content:center',
		'box-shadow:0 4px 24px rgba(0,0,0,0.5)', 'transition:transform 0.15s',
	].join( ';' );
	button.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg>';
	overlay.appendChild( button );

	overlay.addEventListener( 'mouseenter', () => { button.style.transform = 'scale(1.08)'; } );
	overlay.addEventListener( 'mouseleave', () => { button.style.transform = 'scale(1)'; } );

	overlay.addEventListener( 'click', () => {

		editor.signals.timelinePlayRequested.dispatch();
		overlay.remove();

	}, { once: true } );

	document.body.appendChild( overlay );
	return overlay;

}

export { GitSettingsDialog, openGitCompare, generateCommitMessage, parseRepo };
