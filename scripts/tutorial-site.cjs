// ── tutorial-site.cjs ───────────────────────────────────────────────────────────
// What a crawler and a link preview see of /about/tutorials. There is NO build step: tutorials.json is the
// canonical definition of a tutorial, and the static pages repeat parts of it (the list in index.html, the
// social-preview tags in every page, sitemap.xml). Two sources of listing, so this file is the check that
// they agree: `node scripts/tutorial-policy.cjs lint` runs check() below, and a mismatch prints what the
// committed text should be, to paste in. Nothing here writes a file.
//
// The text a page must carry is produced by the render*() functions, so the check is "the committed text
// equals what tutorials.json says it should be", and an author can copy the expected block from the message.

const fs = require( 'fs' );
const path = require( 'path' );

const DIR = path.join( __dirname, '..', 'docs', 'about', 'tutorials' );
const DOCS = path.join( __dirname, '..', 'docs' );
const SITE = 'https://strataeditor.dev';
const DEFAULT_IMAGE = { url: SITE + '/demo.png', width: 800, height: 435 };

// Section order and the note under each heading (index.html's list follows this).
const GROUPS = [
	{ name: 'Scenes', note: 'Build and label a scene, or cut a model into named parts.' },
	{ name: 'Games', note: 'Build a scene, label it, and leave the behaviour to game code.' },
	{ name: 'Animation and rendering', note: 'Timelines, cameras and shots.' },
	{ name: 'Characters', note: 'Import, restyle, pose and animate a character.' },
	{ name: 'Motion capture', note: 'Work from recorded performances.' },
	{ name: 'Strata Play', note: 'The player: run, fork and wire up the games you build here.' },
];

const esc = ( s ) => String( s ).replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
const slug = ( s ) => s.toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );
const isExternal = ( href ) => /^https?:\/\//.test( href );
const norm = ( s ) => String( s ).replace( /\s+/g, ' ' ).trim();

function load( dir = DIR ) { return JSON.parse( fs.readFileSync( path.join( dir, 'tutorials.json' ), 'utf8' ) ); }
function visible( list ) { return list.filter( ( t ) => ! t.hidden ); }

// The picture a shared link shows: the entry's thumb (640 x 400), else the site's default.
function imageOf( t ) {

	return t.thumb ? { url: SITE + '/about/tutorials/' + t.thumb, width: 640, height: 400 } : DEFAULT_IMAGE;

}

const indexTitle = () => 'Tutorials — Strata';
const indexDescription = ( n ) => `${ n } step-by-step walkthroughs for building scenes, games, animation and characters with Strata — by hand, no AI required.`;

/** The social-preview tags for one page. `p` is { title, description, url, image, type }. */
function renderSocial( p ) {

	return [
		'<!-- social:start (generated from tutorials.json by hand; node scripts/tutorial-policy.cjs lint checks it) -->',
		`<link rel="canonical" href="${ esc( p.url ) }">`,
		`<meta property="og:site_name" content="Strata">`,
		`<meta property="og:type" content="${ p.type }">`,
		`<meta property="og:title" content="${ esc( p.title ) }">`,
		`<meta property="og:description" content="${ esc( p.description ) }">`,
		`<meta property="og:url" content="${ esc( p.url ) }">`,
		`<meta property="og:image" content="${ esc( p.image.url ) }">`,
		`<meta property="og:image:width" content="${ p.image.width }">`,
		`<meta property="og:image:height" content="${ p.image.height }">`,
		`<meta name="twitter:card" content="summary_large_image">`,
		`<meta name="twitter:title" content="${ esc( p.title ) }">`,
		`<meta name="twitter:description" content="${ esc( p.description ) }">`,
		`<meta name="twitter:image" content="${ esc( p.image.url ) }">`,
		'<!-- social:end -->',
	].join( '\n' );

}

function socialOf( t ) {

	return { title: t.title, description: t.blurb || t.desc, url: SITE + '/about/tutorials/' + t.href, image: imageOf( t ), type: 'article' };

}

function socialOfIndex( list ) {

	return { title: indexTitle(), description: indexDescription( visible( list ).length ), url: SITE + '/about/tutorials/', image: DEFAULT_IMAGE, type: 'website' };

}

function renderCard( t ) {

	const out = [ '\t\t\t<article class="card">' ];
	if ( t.thumb ) out.push( `\t\t\t\t<a class="thumb" href="${ esc( t.href ) }" tabindex="-1" aria-hidden="true"><img src="${ esc( t.thumb ) }" alt="" width="640" height="400" loading="lazy"></a>` );
	out.push( '\t\t\t\t<div class="body">' );
	out.push( `\t\t\t\t\t<h3><a href="${ esc( t.href ) }">${ esc( t.title ) }</a></h3>` );
	out.push( `\t\t\t\t\t<p>${ esc( t.blurb || t.desc ) }</p>` );
	if ( isExternal( t.href ) ) out.push( `\t\t\t\t\t<span class="ext">${ esc( new URL( t.href ).hostname ) } ↗</span>` );
	if ( t.embed ) out.push( `\t\t\t\t\t<a class="try" href="${ esc( '../../' + t.embed ) }" title="Open the finished scene in the editor">Open example →</a>` );
	out.push( '\t\t\t\t</div>', '\t\t\t</article>' );
	return out.join( '\n' );

}

/** The section list and the jump nav, in the order index.html shows them. */
function renderList( list ) {

	const items = visible( list ), byGroup = new Map();
	for ( const t of items ) {

		const key = GROUPS.some( ( g ) => g.name === t.group ) ? t.group : 'More';
		if ( ! byGroup.has( key ) ) byGroup.set( key, [] );
		byGroup.get( key ).push( t );

	}
	const order = GROUPS.map( ( g ) => g.name ).concat( 'More' ).filter( ( n ) => byGroup.has( n ) );
	const jump = order.map( ( n ) => `<a href="#${ slug( n ) }">${ esc( n ) }<span class="n">${ byGroup.get( n ).length }</span></a>` );
	const sections = order.map( ( n ) => {

		const note = ( GROUPS.find( ( g ) => g.name === n ) || {} ).note;
		return [
			'\t\t<section>',
			`\t\t\t<h2 id="${ slug( n ) }">${ esc( n ) }</h2>`,
			note ? `\t\t\t<p class="note">${ esc( note ) }</p>` : null,
			'\t\t\t<div class="grid">',
			byGroup.get( n ).map( renderCard ).join( '\n' ),
			'\t\t\t</div>',
			'\t\t</section>',
		].filter( Boolean ).join( '\n' );

	} );
	return { jump: jump.join( '\n\t\t' ), sections: sections.join( '\n' ), count: items.length };

}

/** The URLs sitemap.xml must list: the index and every visible local page. */
function sitemapUrls( list ) {

	return [ SITE + '/about/tutorials/' ].concat( visible( list ).filter( ( t ) => ! isExternal( t.href ) ).map( ( t ) => SITE + '/about/tutorials/' + t.href ) );

}

function between( text, a, b ) { const i = text.indexOf( a ); const j = text.indexOf( b, i + a.length ); return i < 0 || j < 0 ? null : text.slice( i, j + b.length ); }

// ── credits: who and what a tutorial stands on, declared in tutorials.json and generated into the page ────────────────
// "contributors": [ { name, role: scene | script | voice | review | asset, url } ]   people (an asset's author is credited in the asset's own attribution too)
// "assets":       [ { name, source, licence, attribution } ]                         every file a tutorial ships or loads that someone else made
// "tools":        [ { name, licence, url, note? } ]                                  software the walkthrough has you use that Strata is not
// All three are required on every listed tutorial (an empty list says "none used"), so a tutorial that was never audited fails. The page's credit block
// (between <!-- credits:start --> and <!-- credits:end -->, just before the footer) is generated from them. A licence of "not stated" is allowed, because
// it is true, and is reported as a note rather than a failure; a missing credit or licence is a failure.

const ROLES = [ 'scene', 'script', 'voice', 'review', 'asset' ];
const NOT_STATED = /^not stated/i;
const isUrl = ( u ) => /^https?:\/\/[^\s]+$/.test( String( u ) );
const blank = ( v ) => typeof v !== 'string' || ! v.trim();

/** What a page's prose names that tutorials.json must also declare, so that a credit cannot be dropped without the check noticing. */
const MENTIONS = [
	[ /Kokoro/, 'Kokoro', ( t ) => has( t.tools, /kokoro/i ) ],
	[ /Mixamo/, 'Mixamo', ( t ) => has( t.tools, /mixamo/i ) || has( t.assets, /mixamo/i ) ],
	[ /sketchfab\.com/i, 'a Sketchfab model', ( t ) => has( t.assets, /sketchfab/i ) ],
	[ /Khronos/, 'a Khronos sample model', ( t ) => has( t.assets, /khronos/i ) ],
	[ /metahuman-to-glb/, 'metahuman-to-glb', ( t ) => has( t.tools, /metahuman-to-glb/i ) ],
	[ /meshoptimizer/, 'meshoptimizer', ( t ) => has( t.tools, /meshoptimizer/i ) ],
	[ /bodyrig-webCLI/, 'bodyrig-webCLI', ( t ) => has( t.tools, /bodyrig/i ) ],
	[ /(portrait|look|rig|dub)\.webcli\.app/, 'a webcli.app tool', ( t ) => has( t.tools, /webcli/i ) ],
	[ /OptiTrack|arXiv:\d|170\.17 s/, 'captured motion', ( t ) => has( t.assets, /mocap|motion|clip|capture/i ) ],
	[ /52blendshapes-for-VRoid-face/, 'the VRoid base model', ( t ) => has( t.assets, /vroid|52blendshapes/i ) ]
];
function has( list, re ) { return ( list || [] ).some( ( x ) => re.test( [ x.name, x.source, x.url ].join( ' ' ) ) ); }

/** Problems (a credit is missing or malformed) and notes (true, but worth a person's attention) for one tutorial's declarations. */
function creditsOf( t ) {

	const problems = [], notes = [], who = t.href + ': ';
	for ( const k of [ 'contributors', 'assets', 'tools' ] ) if ( ! Array.isArray( t[ k ] ) ) problems.push( who + `"${ k }" is not declared (use [] to say none are used)` );
	( t.contributors || [] ).forEach( ( c, i ) => {

		if ( blank( c.name ) ) problems.push( who + `contributors[${ i }] has no name` );
		if ( ! ROLES.includes( c.role ) ) problems.push( who + `contributors[${ i }] (${ c.name }) has role "${ c.role }": use ${ ROLES.join( ', ' ) }` );
		if ( ! isUrl( c.url ) ) problems.push( who + `contributors[${ i }] (${ c.name }) has no https url` );

	} );
	if ( Array.isArray( t.contributors ) && ! t.contributors.some( ( c ) => c.role === 'script' ) ) problems.push( who + 'no contributor has the role "script": someone has to be accountable for the text' );
	( t.assets || [] ).forEach( ( a, i ) => {

		const n = `assets[${ i }] (${ a.name })`;
		if ( blank( a.name ) ) problems.push( who + `assets[${ i }] has no name` );
		if ( ! isUrl( a.source ) ) problems.push( who + `${ n } has no https source` );
		if ( blank( a.licence ) ) problems.push( who + `${ n } has no licence (say "not stated" if the source gives none)` );
		else if ( NOT_STATED.test( a.licence ) ) notes.push( who + `${ n }: licence not stated. Ask the owner, or do not redistribute it` );
		if ( blank( a.attribution ) ) problems.push( who + `${ n } has no attribution` );

	} );
	( t.tools || [] ).forEach( ( x, i ) => {

		const n = `tools[${ i }] (${ x.name })`;
		if ( blank( x.name ) ) problems.push( who + `tools[${ i }] has no name` );
		if ( blank( x.licence ) ) problems.push( who + `${ n } has no licence (say "not stated" if there is none)` );
		else if ( NOT_STATED.test( x.licence ) ) notes.push( who + `${ n }: licence not stated` );
		if ( ! isUrl( x.url ) ) problems.push( who + `${ n } has no https url` );

	} );
	return { problems, notes };

}

const creditsStyle = '<style>.credits{margin:2.2em 0 1em;padding-top:1em;border-top:1px solid rgba(127,127,127,.35);font-size:.9em}.credits h2{margin:0 0 .5em;font-size:1.05em}.credits h3{margin:.9em 0 .2em;font-size:.95em;opacity:.8}.credits ul{margin:.2em 0;padding-left:1.2em}.credits li{margin:.25em 0}.credits .lic{opacity:.8}</style>';
const link = ( text, url ) => ( url ? `<a href="${ esc( url ) }">${ esc( text ) }</a>` : esc( text ) );

/** The credit block for a tutorial's page, generated from its declarations. */
function renderCredits( t ) {

	const none = '<p>None used.</p>', ul = ( items ) => ( items.length ? '<ul>\n' + items.map( ( i ) => '\t\t\t<li>' + i + '</li>' ).join( '\n' ) + '\n\t\t</ul>' : none );
	const byPerson = new Map();
	for ( const c of t.contributors || [] ) { const k = c.name + '|' + c.url; if ( ! byPerson.has( k ) ) byPerson.set( k, { ...c, roles: [] } ); byPerson.get( k ).roles.push( c.role ); }
	const people = [ ...byPerson.values() ].map( ( c ) => `${ link( c.name, c.url ) } <span class="lic">(${ esc( c.roles.join( ', ' ) ) })</span>` );
	const assets = ( t.assets || [] ).map( ( a ) => `${ link( a.name, a.source ) }: ${ esc( a.attribution ) } <span class="lic">Licence: ${ esc( a.licence ) }.</span>` );
	const tools = ( t.tools || [] ).map( ( x ) => `${ link( x.name, x.url ) } <span class="lic">(${ esc( x.licence ) })</span>${ x.note ? ' ' + esc( x.note ) : '' }` );
	return [ '<!-- credits:start -->', '\t<section class="credits" id="credits">', '\t\t' + creditsStyle, '\t\t<h2>Credits and licences</h2>',
		'\t\t<h3>People</h3>', '\t\t' + ul( people ), '\t\t<h3>Assets</h3>', '\t\t' + ul( assets ), '\t\t<h3>Tools</h3>', '\t\t' + ul( tools ), '\t</section>', '\t<!-- credits:end -->' ].join( '\n' );

}

/** Credit problems and notes for every listed tutorial, plus the pages' own prose checked against what is declared. */
function auditCredits( list, dir = DIR ) {

	const problems = [], notes = [];
	for ( const t of visible( list ) ) {

		if ( isExternal( t.href ) ) continue;
		const c = creditsOf( t );
		problems.push( ...c.problems ); notes.push( ...c.notes );
		const file = path.join( dir, t.href );
		if ( ! fs.existsSync( file ) ) continue;
		const html = fs.readFileSync( file, 'utf8' );
		const got = between( html, '<!-- credits:start -->', '<!-- credits:end -->' );
		if ( ! got ) problems.push( t.href + ': no <!-- credits:start --> … <!-- credits:end --> block, just before <footer>' );
		else if ( norm( got ) !== norm( renderCredits( t ) ) ) problems.push( t.href + ': the credit block differs from tutorials.json. Expected:\n' + renderCredits( t ) );
		const prose = html.replace( /<!-- credits:start -->[\s\S]*?<!-- credits:end -->/, '' ).replace( /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ' );
		for ( const [ re, what, declared ] of MENTIONS ) if ( re.test( prose ) && ! declared( t ) ) problems.push( t.href + `: the page names ${ what }, but tutorials.json does not credit it (add it to "assets" or "tools")` );

	}
	return { problems, notes };

}

/** Everything wrong between tutorials.json and the static pages. */
function check( dir = DIR ) {

	const problems = [], list = load( dir ), shown = visible( list );

	// 1. index.html: the list is in the HTML source, not fetched.
	const indexHtml = fs.readFileSync( path.join( dir, 'index.html' ), 'utf8' );
	if ( /Loading tutorials/.test( indexHtml ) ) problems.push( 'index.html: still says "Loading tutorials…": the list must be in the HTML source' );
	const want = renderList( list ), block = between( indexHtml, '<!-- list:start -->', '<!-- list:end -->' ), jump = between( indexHtml, '<!-- jump:start -->', '<!-- jump:end -->' );
	if ( ! block ) problems.push( 'index.html: no <!-- list:start --> … <!-- list:end --> block' );
	else if ( norm( block ) !== norm( '<!-- list:start -->\n' + want.sections + '\n\t\t<!-- list:end -->' ) ) {

		const have = new Set( ( block.match( /<h3><a href="([^"]*)"/g ) || [] ).map( ( s ) => s.slice( 13, - 1 ) ) );
		const missing = shown.filter( ( t ) => ! have.has( esc( t.href ) ) ).map( ( t ) => t.href );
		problems.push( 'index.html: the list differs from tutorials.json' + ( missing.length ? ' (not listed: ' + missing.join( ', ' ) + ')' : ' (same entries, different text or order)' ) + '. Expected:\n' + want.sections );

	}
	if ( ! jump ) problems.push( 'index.html: no <!-- jump:start --> … <!-- jump:end --> block' );
	else if ( norm( jump ) !== norm( '<!-- jump:start -->\n\t\t' + want.jump + '\n\t\t<!-- jump:end -->' ) ) problems.push( 'index.html: the section links differ from tutorials.json. Expected:\n' + want.jump );
	if ( ! indexHtml.includes( `<span id="count">${ want.count } tutorials.</span>` ) ) problems.push( `index.html: the count should read <span id="count">${ want.count } tutorials.</span>` );

	// 2. Social-preview tags on the index and on every local page.
	const wantIndex = renderSocial( socialOfIndex( list ) ), haveIndex = between( indexHtml, '<!-- social:start', '<!-- social:end -->' );
	if ( ! haveIndex || norm( haveIndex ) !== norm( wantIndex ) ) problems.push( 'index.html: social-preview tags missing or out of date. Expected:\n' + wantIndex );
	if ( ! new RegExp( '<meta name="description" content="' + esc( indexDescription( want.count ) ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) + '"' ).test( indexHtml ) ) problems.push( 'index.html: <meta name="description"> should be: ' + indexDescription( want.count ) );
	for ( const t of shown ) {

		if ( isExternal( t.href ) ) continue;
		const file = path.join( dir, t.href );
		if ( ! fs.existsSync( file ) ) continue; // reported by the policy lint
		const html = fs.readFileSync( file, 'utf8' ), exp = renderSocial( socialOf( t ) ), got = between( html, '<!-- social:start', '<!-- social:end -->' );
		if ( ! got || norm( got ) !== norm( exp ) ) problems.push( t.href + ': social-preview tags missing or out of date (og:title, og:description, og:image, og:url, og:type, twitter:card). Expected, after <meta name="description">:\n' + exp );
		if ( ! /<meta name="description" content="[^"]+"/.test( html ) ) problems.push( t.href + ': no <meta name="description">' );

	}

	// 3. sitemap.xml and robots.txt (these live at the site root, docs/).
	if ( dir === DIR ) {

		const smFile = path.join( DOCS, 'sitemap.xml' ), robotsFile = path.join( DOCS, 'robots.txt' );
		if ( ! fs.existsSync( smFile ) ) problems.push( 'docs/sitemap.xml is missing' );
		else {

			const sm = fs.readFileSync( smFile, 'utf8' ), listed = ( sm.match( /<loc>([^<]*)<\/loc>/g ) || [] ).map( ( s ) => s.slice( 5, - 6 ) );
			const wantUrls = sitemapUrls( list );
			for ( const u of wantUrls ) if ( ! listed.includes( u ) ) problems.push( 'docs/sitemap.xml: missing ' + u );
			for ( const u of listed ) if ( u.startsWith( SITE + '/about/tutorials/' ) && ! wantUrls.includes( u ) ) problems.push( 'docs/sitemap.xml: lists ' + u + ', which tutorials.json does not' );
			const lm = sm.match( /<lastmod>([^<]*)<\/lastmod>/g ) || [];
			if ( lm.length < wantUrls.length || lm.some( ( s ) => ! /^<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>$/.test( s ) ) ) problems.push( 'docs/sitemap.xml: every <url> needs a <lastmod> in YYYY-MM-DD form' );

		}
		if ( ! fs.existsSync( robotsFile ) || ! new RegExp( '^Sitemap:\\s*' + SITE.replace( /\./g, '\\.' ) + '/sitemap\\.xml\\s*$', 'm' ).test( fs.readFileSync( robotsFile, 'utf8' ) ) ) problems.push( 'docs/robots.txt must exist and say: Sitemap: ' + SITE + '/sitemap.xml' );

	}

	// 4. credits: contributors, assets and tools declared, and generated into every page.
	problems.push( ...auditCredits( list, dir ).problems );

	return problems;

}

module.exports = { SITE, GROUPS, load, visible, imageOf, renderSocial, socialOf, socialOfIndex, renderCard, renderList, sitemapUrls, indexDescription, indexTitle, check, creditsOf, renderCredits, auditCredits, ROLES };

if ( require.main === module ) {

	const problems = check();
	if ( problems.length ) { console.error( problems.join( '\n\n' ) ); console.error( '\n' + problems.length + ' tutorial site problem(s)' ); process.exit( 1 ); }
	console.log( 'tutorial site: index, social tags, credits, sitemap and robots agree with tutorials.json' );
	const notes = auditCredits( load() ).notes;
	if ( notes.length ) console.log( '\n' + notes.length + ' note(s):\n' + notes.join( '\n' ) );

}
