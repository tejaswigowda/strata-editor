// ── ReleasesPanel.js ───────────────────────────────────────────────────────────
// The Render tab's Releases list. A scene is live and editable; a render is frozen and versioned, so the tab shows RELEASES the way the Git tab shows commits:
// one row per published render, newest first, with the pinned share link as the primary action. Every link it copies is pinned to a tag or a commit, never @latest.
// Above the list: whether the scene's latest render is current, behind (by how many commits that change the scene) or none.
//
//   panel.refresh()   reload the list for the scene the Git tab is set to
//
// deps: { localRender() -> editor.lastRender | null }   the last offline render made in this editor, whose per-frame hashes Verify compares with the published ones

import { UIButton, UIInput } from './libs/ui.js';
import { sceneHash } from './export/canonical.js';
import { formatBytes } from './export/renderJson.js';
import {
	sceneSlug, listReleaseTags, releaseBase, pinnedUrl, playerLink, releaseSummary, publicationOf, shareBase, assessStaleness, verifyPlan, verifyOutcome, STORAGE,
} from './export/releases.js';
import { publishSource, githubApi, defaultRendersRepo } from './Menubar.Git.js';

const NOTE = 'font-size:11px;line-height:1.45;margin:4px 0;';

function el( tag, css, text ) {

	const e = document.createElement( tag );
	if ( css ) e.style.cssText = css;
	if ( text !== undefined ) e.textContent = text;
	return e;

}

function link( text, href ) {

	const a = el( 'a', 'color:inherit;text-decoration:underline;', text );
	a.href = href;
	a.target = '_blank';
	a.rel = 'noopener';
	return a;

}

function smallButton( label, title ) {

	const b = new UIButton( label );
	b.dom.style.cssText = 'padding:2px 8px;font-size:11px;';
	if ( title ) b.dom.title = title;
	return b;

}

const playerRoot = () => new URL( 'player/', location.href ).href;

async function fetchJson( url ) {

	const res = await fetch( url, { cache: 'no-store' } );
	if ( ! res.ok ) throw new Error( `${ res.status } for ${ url }` );
	return res.json();

}

/** render.json at a pinned ref: from the repository itself (the source of truth, which has a tag the moment it is created), then from the CDN mirror. */
async function fetchRenderJson( { repo, ref, path } ) {

	try { return await fetchJson( `https://raw.githubusercontent.com/${ repo }/${ ref }/${ path }/render.json` ); } catch ( e ) { /* fall back */ }
	return fetchJson( pinnedUrl( { repo, ref, path: path + '/render.json' } ) );

}

/** The first of `bases` that serves `file`: the canonical address, then the mirrors in order. */
async function fetchFromBases( bases, file ) {

	let last = null;
	for ( const b of bases ) {

		try { const res = await fetch( b + file, { cache: 'no-store', signal: AbortSignal.timeout( 15000 ) } ); if ( res.ok ) return res; last = new Error( `HTTP ${ res.status } from ${ new URL( b ).host }` ); } catch ( e ) { last = e; }

	}
	throw last || new Error( 'no address to fetch from' );

}

export function createReleasesPanel( editor, deps = {} ) {

	const root = el( 'div' );
	root.id = 'releases-panel';
	root.appendChild( el( 'div', NOTE + 'opacity:0.8;', 'Published renders of this scene, newest first. A render is frozen: a re-render is a new version (a tag that never moves), and every link here is pinned to one.' ) );

	const repoRow = el( 'div', 'display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;' );
	const repoInput = new UIInput( '' );
	repoInput.dom.style.flex = '1';
	repoInput.dom.placeholder = 'owner/renders';
	repoInput.dom.title = 'The repository the renders are published to. Default: <owner of the scene repo>/renders.';
	const refreshButton = new UIButton( 'Refresh' );
	repoRow.append( el( 'span', 'width:64px;flex:none;opacity:0.8;', 'Renders in' ), repoInput.dom, refreshButton.dom );
	root.appendChild( repoRow );

	const staleBox = el( 'div', NOTE + 'font-weight:bold;min-height:16px;' );
	const status = el( 'div', NOTE + 'opacity:0.8;min-height:14px;' );
	const list = el( 'div' );
	root.append( staleBox, status, list );

	let loading = false;

	const commitLink = ( repo, sha ) => link( `${ repo }@${ sha.slice( 0, 7 ) }`, `https://github.com/${ repo }/commit/${ sha }` );

	/** The scene's latest state on its branch, and how far a render's commit is behind it (one compare per render, over the commits that change the scene). */
	async function stalenessContext( api, scene ) {

		try {

			const q = new URLSearchParams( { sha: scene.branch, per_page: '100', path: scene.file } );
			const [ head, touching ] = await Promise.all( [
				api.get( `/repos/${ scene.repo }/commits?${ new URLSearchParams( { sha: scene.branch, per_page: '1' } ) }` ),
				api.get( `/repos/${ scene.repo }/commits?${ q }` ),
			] );
			return { headCommit: head[ 0 ] && head[ 0 ].sha, touching: touching.map( c => c.sha ), ok: true };

		} catch ( e ) { return { ok: false, error: e }; }

	}

	async function stalenessOf( api, ctx, scene ) {

		if ( ! ctx.ok ) return assessStaleness( { published: true, sourceCommit: scene.commit, headCommit: null } );
		let compare = null;
		if ( scene.commit && ctx.headCommit && ! ctx.headCommit.startsWith( scene.commit ) ) {

			try { compare = await api.get( `/repos/${ scene.repo }/compare/${ scene.commit }...${ ctx.headCommit }` ); } catch ( e ) { compare = null; }

		}
		return assessStaleness( { published: true, sourceCommit: scene.commit, headCommit: ctx.headCommit, compare, touching: ctx.touching } );

	}

	async function load() {

		if ( loading ) return;
		loading = true;
		list.innerHTML = '';
		staleBox.textContent = '';
		const src = publishSource();
		if ( ! src ) { status.textContent = 'No repository is set in the Git tab, so there is no scene to list renders for.'; loading = false; return; }
		const slug = sceneSlug( src.file );
		const rendersRepo = repoInput.getValue().trim() || defaultRendersRepo();
		status.textContent = `Looking for renders of ${ slug }\u2026`;

		const api = githubApi();
		const entries = [];
		try {

			let tags = [];
			try { tags = await listReleaseTags( api, { repo: rendersRepo, slug } ); } catch ( e ) { if ( ! /404/.test( e.message ) ) throw e; }
			await Promise.all( tags.map( async t => {

				try {

					const json = await fetchRenderJson( { repo: rendersRepo, ref: t.tag, path: slug } );
					entries.push( { summary: releaseSummary( json, { ref: t.tag, base: shareBase( publicationOf( json ) ) || releaseBase( { repo: rendersRepo, tag: t.tag, slug } ), repo: rendersRepo } ), json, version: t.version } );

				} catch ( e ) { entries.push( { error: `${ t.tag }: render.json could not be read (${ e.message })`, version: t.version } ); }

			} ) );
			entries.sort( ( a, b ) => b.version - a.version );

			// renders published before renders moved to a repository of their own: left where they are, so every link made to them keeps working
			try {

				const legacyPath = `renders/${ slug }`;
				const commits = await api.get( `/repos/${ src.repo }/commits?${ new URLSearchParams( { sha: src.branch, path: legacyPath, per_page: '1' } ) }` );
				if ( commits.length ) {

					const sha = commits[ 0 ].sha;
					const json = await fetchRenderJson( { repo: src.repo, ref: sha, path: legacyPath } );
					const pub = publicationOf( json, { repo: src.repo, path: legacyPath } );
					if ( pub.storage === STORAGE.source ) entries.push( { legacy: true, summary: releaseSummary( json, { ref: sha, base: pinnedUrl( { repo: src.repo, ref: sha, path: legacyPath + '/' } ), repo: src.repo, date: json.render.rendered_at } ), json } );

				}

			} catch ( e ) { /* none, or unreadable: not listed */ }

		} catch ( e ) {

			status.textContent = 'Could not list renders: ' + e.message;
			loading = false;
			return;

		}

		// staleness: per row, and one line for the scene
		const real = entries.filter( e => e.summary );
		const ctxFor = new Map();
		for ( const e of real ) {

			const key = `${ e.json.scene.repo }@${ e.json.scene.branch }:${ e.json.scene.file }`;
			if ( ! ctxFor.has( key ) ) ctxFor.set( key, stalenessContext( api, e.json.scene ) );

		}
		await Promise.all( real.map( async e => {

			e.stale = await stalenessOf( api, await ctxFor.get( `${ e.json.scene.repo }@${ e.json.scene.branch }:${ e.json.scene.file }` ), e.json.scene );

		} ) );

		const latest = real[ 0 ];
		const s = latest ? latest.stale : assessStaleness( { published: false } );
		staleBox.textContent = latest ? `${ latest.summary.tag || 'Legacy render' }: ${ s.state }. ${ s.reason }` : s.reason + ' Use Render & publish in the Video tab.';
		staleBox.style.color = s.state === 'current' ? '#2ea44f' : s.state === 'behind' ? '#e0a000' : '';
		status.textContent = real.length ? `${ real.length } published render${ real.length === 1 ? '' : 's' } of ${ slug }.` : '';
		for ( const e of entries ) list.appendChild( e.error ? el( 'div', NOTE + 'color:#e5484d;', e.error ) : card( e ) );
		loading = false;

	}

	function card( entry ) {

		const s = entry.summary, st = entry.stale;
		const box = el( 'div', 'border:1px solid rgba(128,128,128,0.35);border-radius:6px;padding:6px 8px;margin:6px 0;font-size:12px;' );
		const dur = s.durationS >= 60 ? `${ Math.floor( s.durationS / 60 ) }:${ String( Math.round( s.durationS % 60 ) ).padStart( 2, '0' ) }` : `${ Math.round( s.durationS * 10 ) / 10 } s`;
		const title = el( 'div', 'font-weight:bold;' );
		title.textContent = entry.legacy ? 'Legacy render (in the scene repo)' : s.tag;
		if ( entry.legacy ) title.title = 'Published before renders had a repository of their own. It stays where it is so every existing link keeps working; a re-render is published to the renders repo.';
		box.appendChild( title );
		box.appendChild( el( 'div', 'opacity:0.85;', [ new Date( s.date ).toLocaleString(), dur, `${ s.fps } fps`, s.ladder.join(' / '), s.sizeBytes ? formatBytes( s.sizeBytes ) : null ].filter( Boolean ).join( ' \u00b7 ' ) ) );

		const row = el( 'div', 'margin:4px 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center;' );
		const share = playerLink( playerRoot(), s.base );
		const copy = new UIButton( 'Copy share link' );
		copy.dom.style.cssText = 'padding:3px 10px;font-weight:bold;';
		copy.dom.title = 'A link that plays exactly this render, pinned to ' + s.ref + '.';
		copy.onClick( async () => {

			try { await navigator.clipboard.writeText( share ); copy.dom.textContent = 'Copied'; } catch ( e ) { window.prompt( 'Copy this pinned link:', share ); }
			setTimeout( () => { copy.dom.textContent = 'Copy share link'; }, 1500 );

		} );
		const open = smallButton( 'Play' );
		open.onClick( () => window.open( share, '_blank', 'noopener' ) );
		const verify = smallButton( 'Verify', 'Rebuild this render from its recorded source and compare every frame with the published hashes.' );
		row.append( copy.dom, open.dom, verify.dom );
		box.appendChild( row );

		const facts = el( 'div', 'font-size:11px;opacity:0.9;line-height:1.5;' );
		facts.append( 'Source: ' );
		if ( s.sourceCommit ) facts.appendChild( commitLink( s.sourceRepo, s.sourceCommit ) ); else facts.append( `${ s.sourceRepo } (commit not recorded)` );
		if ( st ) { const chip = el( 'span', 'margin-left:8px;font-weight:bold;color:' + ( st.state === 'current' ? '#2ea44f' : '#e0a000' ), st.state === 'current' ? 'current' : st.behind === null ? 'behind' : `${ st.behind }${ st.atLeast ? '+' : '' } commit${ st.behind === 1 ? '' : 's' } behind` ); chip.title = st.reason; facts.append( ' \u00b7 ' ); facts.appendChild( chip ); }
		facts.appendChild( document.createElement( 'br' ) );
		facts.append( `Frames: ${ s.frames ? 'deterministic' : 'not claimed' } \u00b7 Bytes: ${ s.bytes ? 'repeat' : 'not promised' }` );
		facts.appendChild( document.createElement( 'br' ) );
		facts.append( 'Files: ' );
		const files = [ link( 'render.json', s.links.renderJson ), link( 'poster', s.links.poster ), ...s.links.captions.map( c => link( `captions.${ c.language }`, c.url ) ) ];
		files.forEach( ( a, i ) => { if ( i ) facts.append( ' \u00b7 ' ); facts.appendChild( a ); } );
		if ( s.tag ) { facts.append( ' \u00b7 ' ); facts.appendChild( link( 'tag on GitHub', `https://github.com/${ s.repo }/tree/${ s.tag }` ) ); }
		box.appendChild( facts );

		const result = el( 'div', NOTE + 'font-weight:bold;' );
		box.appendChild( result );
		verify.onClick( () => runVerify( entry, result, verify ) );
		return box;

	}

	async function runVerify( entry, out, button ) {

		const plan = verifyPlan( entry.json );
		const show = ( o, color ) => { out.textContent = o.summary; out.style.color = color || ( o.result === 'match' ? '#2ea44f' : o.result === 'differs' ? '#e5484d' : '#e0a000' ); };
		if ( ! plan.can ) { show( verifyOutcome( { plan, published: '', rebuilt: null } ) ); return; }
		button.dom.disabled = true;
		try {

			const set = plan.settings;
			out.style.color = ''; out.textContent = 'Checking the open scene\u2026';
			const open = await sceneHash( editor.toJSON() ).catch( () => null );
			if ( open !== set.sceneHash ) {

				show( { result: 'cannot-verify', summary: `Cannot verify yet: the open scene is not the one this render was made from. Load ${ set.file } at commit ${ set.commit.slice( 0, 7 ) } from the Git tab (its hash must be ${ set.sceneHash.slice( 0, 19 ) }\u2026), render it here, then press Verify.` } );
				return;

			}
			// What is compared is a render made in this editor, so nothing is re-rendered behind the person's back (a render downloads a file and replaces the draft).
			const local = deps.localRender && deps.localRender();
			const want = `Video tab, Mode: Offline, ${ set.width } \u00d7 ${ set.height } at ${ set.fps } fps, the whole film`;
			if ( ! local || ! local.frameHashes ) { show( { result: 'cannot-verify', summary: `Ready to verify, but no render has been made here yet. Render the scene (${ want }), then press Verify: its frame hashes are compared with the published ones.` } ); return; }
			if ( local.sceneHash !== set.sceneHash ) { show( { result: 'cannot-verify', summary: 'The last render made here was of a different state of the scene than this release. Render again, then press Verify.' } ); return; }
			if ( local.width !== set.width || local.height !== set.height || local.fps !== set.fps || local.range.start !== set.range[ 0 ] || local.range.end !== set.range[ 1 ] ) { show( { result: 'cannot-verify', summary: `The last render made here used other settings than this release. Render with ${ want }, then press Verify.` } ); return; }
			out.textContent = 'Fetching the published frame hashes\u2026';
			let res;
			try { res = await fetchFromBases( [ entry.summary.base, ...( entry.summary.mirrors || [] ) ], set.sidecar ); } catch ( e ) { throw new Error( `the published frame hashes could not be fetched (${ e.message })` ); }
			const o = verifyOutcome( { plan, published: await res.text(), rebuilt: { first: local.frameHashes.first, hashes: local.frameHashes.hashes }, sameDevice: local.device ? local.device === set.device : null } );
			show( o );
			root.dispatchEvent( new CustomEvent( 'release-verified', { detail: { ref: entry.summary.ref, ...o } } ) );

		} catch ( e ) {

			show( { result: 'cannot-verify', summary: 'Cannot verify: ' + ( e && e.message ? e.message : e ) } );

		} finally { button.dom.disabled = false; }

	}

	refreshButton.onClick( load );
	repoInput.dom.addEventListener( 'change', load );

	return {
		dom: root,
		refresh() { if ( ! repoInput.getValue() ) repoInput.setValue( defaultRendersRepo() ); return load(); },
		/** For tests. */
		get list() { return list; },
		get staleBox() { return staleBox; },
	};

}
