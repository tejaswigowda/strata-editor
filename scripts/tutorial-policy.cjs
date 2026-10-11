// ── tutorial-policy.cjs ─────────────────────────────────────────────────────────
// Demo-target policy for PUBLIC tutorials (see guides/TUTORIAL_POLICY.md).
//
//   name and frame after the CAPABILITY, never the character;
//   named / registered IP is a PRIVATE-lane capability test only.
//
// This is the gate every tutorial generator (the Playwright auto-tutorial run,
// or a human) must call BEFORE writing a page to the public tree:
//
//   const policy = require( './scripts/tutorial-policy.cjs' );
//   const plan = policy.planPublication( {
//       capability: 'Restyle a VRM into an explorer with the JS Shell',   // what it teaches
//       title:      'Restyle a VRM into an explorer with the JS Shell',   // optional, defaults to capability
//       slug:       'vrm-restyle-explorer',                               // optional, derived from the title
//       headings:   [ ... ], alts: [ ... ], captions: [ ... ],            // everything the page will show
//       targetKind: 'archetype',     // 'original' | 'archetype' | 'public-domain' | 'named-ip'
//       targetName: 'expedition explorer',                                // what the run actually built
//   } );
//   if ( plan.path !== 'public' ) { /* write to the PRIVATE lane, never docs/ */ }
//   else { /* plan.slug / plan.title are safe to publish */ }
//
// CLI:
//   node scripts/tutorial-policy.cjs lint       lint every public tutorial + tutorials.json + redirects
//   node scripts/tutorial-policy.cjs selftest   one named-IP run (must refuse) + one archetype run (must publish)
//
// The denylist is a BACKSTOP for obvious names. It cannot see likeness: a page that
// reproduces a character's signature design under a clean name is still a violation
// (the generator must pick an original/archetype target — see PUBLIC_TARGET_KINDS).

const fs = require( 'fs' );
const path = require( 'path' );

const TUTORIAL_DIR = path.join( __dirname, '..', 'docs', 'about', 'tutorials' );
const PUBLIC_TARGET_KINDS = [ 'original', 'archetype', 'public-domain' ];

// Character, franchise and trademark terms. Matched case-insensitively on word
// boundaries, so the lowercase common word ("a construct, if you like") is fine
// only where it is not part of one of these phrases.
const DENY = [
	// Characters / franchises seen in this project and the usual suspects.
	'lara\\s+croft', 'croft', 'tomb\\s+raider', 'lara',
	'morpheus', 'neo', 'the\\s+matrix', 'matrix\\s+(?:reloaded|revolutions|resurrections)', 'agent\\s+smith', 'trinity',
	'batman', 'superman', 'wonder\\s+woman', 'spider[-\\s]?man', 'iron\\s*man', 'captain\\s+america', 'thor', 'hulk', 'deadpool', 'wolverine',
	'darth\\s+vader', 'star\\s+wars', 'yoda', 'luke\\s+skywalker', 'mandalorian', 'baby\\s+yoda', 'grogu',
	'harry\\s+potter', 'hermione', 'hogwarts', 'gandalf', 'frodo', 'lord\\s+of\\s+the\\s+rings',
	'mario', 'luigi', 'princess\\s+peach', 'bowser', 'zelda', 'pikachu', 'pok[eé]mon', 'sonic\\s+the\\s+hedgehog', 'kirby',
	'master\\s+chief', 'kratos', 'geralt', 'solid\\s+snake', 'cloud\\s+strife', 'final\\s+fantasy', 'resident\\s+evil', 'nathan\\s+drake', 'uncharted',
	'hatsune\\s+miku', 'naruto', 'goku', 'dragon\\s*ball', 'one\\s+piece', 'sailor\\s+moon', 'pac[-\\s]?man',
	'mickey\\s+mouse', 'minnie\\s+mouse', 'donald\\s+duck', 'elsa', 'simba', 'disney', 'pixar', 'marvel', 'dc\\s+comics',
	'indiana\\s+jones', 'james\\s+bond', 'jack\\s+sparrow', 'terminator', 'rambo', 'ripley', 'predator',
	'barbie', 'hello\\s+kitty', 'snoopy', 'spongebob', 'shrek', 'bugs\\s+bunny',
].map( ( p ) => new RegExp( '(?<![\\w-])(?:' + p + ')(?![\\w-])', 'i' ) );

// Proper-noun uses that are only a problem capitalised (a titled location), checked
// case-sensitively; the lowercase descriptor is fine.
const DENY_CASE_SENSITIVE = [ /(?<![\w-])(?:The\s+)?Construct(?![\w-])/ ];

function findViolations( text ) {

	const hits = [];
	const s = String( text || '' );
	for ( const re of DENY ) { const m = re.exec( s ); if ( m ) hits.push( m[ 0 ] ); }
	for ( const re of DENY_CASE_SENSITIVE ) { const m = re.exec( s ); if ( m ) hits.push( m[ 0 ] ); }
	// "Lara Croft" also matches "Croft" and "Lara": report only the longest phrase.
	return hits.filter( ( h, i ) => ! hits.some( ( o, j ) => j !== i && o.length > h.length && o.toLowerCase().includes( h.toLowerCase() ) ) );

}

function slugify( text ) {

	return String( text || '' ).toLowerCase().normalize( 'NFKD' ).replace( /[\u0300-\u036f]/g, '' )
		.replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' ).slice( 0, 60 ).replace( /-+$/, '' );

}

// Decide where a generated tutorial may go and with what title/slug. Never throws:
// it returns { path: 'public' | 'private', ... } so the caller can route the artifact.
function planPublication( run ) {

	const reasons = [];
	const capability = String( run.capability || '' ).trim();
	const title = String( run.title || capability ).trim();
	const slug = String( run.slug || slugify( title ) ).replace( /\.html$/, '' );
	const surfaces = [ [ 'title', title ], [ 'slug', slug ], [ 'capability', capability ] ]
		.concat( ( run.headings || [] ).map( ( h ) => [ 'heading', h ] ) )
		.concat( ( run.alts || [] ).map( ( a ) => [ 'alt', a ] ) )
		.concat( ( run.captions || [] ).map( ( c ) => [ 'caption', c ] ) );

	if ( ! capability ) reasons.push( 'no capability given — the title must name what the tutorial teaches' );

	if ( ! PUBLIC_TARGET_KINDS.includes( run.targetKind ) ) {

		reasons.push( 'target kind "' + run.targetKind + '" is not public (' + PUBLIC_TARGET_KINDS.join( ' | ' ) + '); named IP is a private-lane capability test only' );

	}

	for ( const [ where, text ] of surfaces ) {

		for ( const hit of findViolations( text ) ) reasons.push( 'protected name "' + hit + '" in ' + where );

	}

	// A target the run reports by a protected name can't be a public archetype either.
	for ( const hit of findViolations( run.targetName ) ) reasons.push( 'target "' + run.targetName + '" is a protected name ("' + hit + '")' );

	return reasons.length
		? { path: 'private', publish: false, reasons, title, slug }
		: { path: 'public', publish: true, reasons: [], title, slug };

}

// ── Lint the shipped public tutorials ──────────────────────────────────────────

function textOf( html ) { return html.replace( /<[^>]+>/g, ' ' ).replace( /&[a-z#0-9]+;/gi, ' ' ); }

function matchesAll( html, re ) { const out = []; let m; while ( ( m = re.exec( html ) ) ) out.push( m[ 1 ] ); return out; }

function lintTutorials( dir = TUTORIAL_DIR ) {

	const problems = [];
	const add = ( file, where, hit ) => problems.push( file + ': protected name "' + hit + '" in ' + where );

	let redirects = [];
	const redirectsFile = path.join( dir, 'redirects.json' );
	if ( fs.existsSync( redirectsFile ) ) redirects = JSON.parse( fs.readFileSync( redirectsFile, 'utf8' ) ).redirects || [];
	const oldSlugs = new Set( redirects.map( ( r ) => r.from ) );

	// Redirect map must be complete and consistent: stub page, target exists, _redirects line.
	const redirectLines = fs.existsSync( path.join( dir, '..', '..', '_redirects' ) ) ? fs.readFileSync( path.join( dir, '..', '..', '_redirects' ), 'utf8' ) : '';
	for ( const r of redirects ) {

		if ( ! fs.existsSync( path.join( dir, r.from ) ) ) problems.push( 'redirect stub missing: ' + r.from );
		if ( ! fs.existsSync( path.join( dir, r.to ) ) ) problems.push( 'redirect target missing: ' + r.to );
		if ( ! redirectLines.includes( '/about/tutorials/' + r.from ) || ! redirectLines.includes( '/about/tutorials/' + r.to ) ) problems.push( 'docs/_redirects has no 301 for ' + r.from );
		const stub = fs.existsSync( path.join( dir, r.from ) ) ? fs.readFileSync( path.join( dir, r.from ), 'utf8' ) : '';
		if ( stub && ! stub.includes( 'location.search' ) ) problems.push( r.from + ': stub does not preserve ?query / #hash' );

	}

	const pages = fs.readdirSync( dir ).filter( ( f ) => f.endsWith( '.html' ) );
	for ( const f of pages ) {

		const html = fs.readFileSync( path.join( dir, f ), 'utf8' );
		const isStub = oldSlugs.has( f );

		// URL / slug: old slugs exist only as redirects and are exempt.
		if ( ! isStub ) for ( const hit of findViolations( f.replace( /\.html$/, '' ) ) ) add( f, 'file slug', hit );

		const body = html.replace( /<!--[\s\S]*?-->/g, '' );
		const surfaces = [
			[ '<title>', matchesAll( body, /<title>([\s\S]*?)<\/title>/g ) ],
			[ 'meta description', matchesAll( body, /<meta name="description" content="([^"]*)"/g ) ],
			[ 'heading', matchesAll( body, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g ).map( textOf ) ],
			[ 'alt text', matchesAll( body, /\balt="([^"]*)"/g ) ],
			[ 'figcaption', matchesAll( body, /<figcaption>([\s\S]*?)<\/figcaption>/g ).map( textOf ) ],
			[ 'image path', matchesAll( body, /<img[^>]*\bsrc="([^"]*)"/g ) ],
			[ 'link target', matchesAll( body, /<a[^>]*\bhref="([^"]*)"/g ).filter( ( h ) => ! oldSlugs.has( h ) ) ],
		];
		if ( ! isStub ) surfaces.push( [ 'body text', [ textOf( body.replace( /<pre[\s\S]*?<\/pre>/g, ' ' ).replace( /<style[\s\S]*?<\/style>/g, ' ' ) ) ] ] );
		for ( const [ where, list ] of surfaces ) for ( const t of list ) for ( const hit of findViolations( t ) ) add( f, where, hit );

	}

	// Manifest + index page + screenshot filenames.
	for ( const t of JSON.parse( fs.readFileSync( path.join( dir, 'tutorials.json' ), 'utf8' ) ) ) {

		for ( const k of [ 'title', 'href', 'desc' ] ) for ( const hit of findViolations( t[ k ] ) ) add( 'tutorials.json', k + ' of "' + t.title + '"', hit );
		if ( ! fs.existsSync( path.join( dir, t.href ) ) ) problems.push( 'tutorials.json: ' + t.href + ' does not exist' );

	}
	for ( const f of fs.readdirSync( path.join( dir, 'screenshots' ) ) ) for ( const hit of findViolations( f ) ) add( 'screenshots/' + f, 'file name', hit );
	for ( const f of fs.readdirSync( dir ) ) if ( /\.(gif|png|jpe?g|webp)$/i.test( f ) ) for ( const hit of findViolations( f ) ) add( f, 'file name', hit );

	return problems;

}

// ── Self-test: one run of each kind ────────────────────────────────────────────

function selftest() {

	const results = [];
	const check = ( name, ok, detail ) => { results.push( { name, ok } ); console.log( ( ok ? 'PASS ' : 'FAIL ' ) + name + ( detail ? ' — ' + detail : '' ) ); };

	const named = planPublication( {
		capability: 'Restyle a VRM into a famous tomb raider',
		title: 'Turn a VRoid VRM into Lara Croft',
		headings: [ 'Turn a VRoid VRM into Lara Croft' ],
		alts: [ 'A character styled like Lara Croft' ],
		targetKind: 'named-ip',
		targetName: 'Lara Croft',
	} );
	check( 'named-IP run is routed to the private lane', named.path === 'private' && ! named.publish, named.reasons.join( '; ' ) );

	const namedClean = planPublication( { capability: 'Restyle a VRM', title: 'Restyle a VRM into an explorer', targetKind: 'named-ip', targetName: 'a certain adventurer' } );
	check( 'named-IP run is private even with a clean title', namedClean.path === 'private' );

	const arche = planPublication( {
		capability: 'Restyle a VRM into an explorer with the JS Shell',
		headings: [ 'Restyle a VRM into an explorer with the JS Shell', 'Cut a crop top and shorts' ],
		alts: [ 'An anime-style character with auburn hair, a red headband and a satchel' ],
		targetKind: 'archetype',
		targetName: 'expedition explorer',
	} );
	check( 'archetype run publishes under a capability-framed title', arche.path === 'public' && arche.slug === 'restyle-a-vrm-into-an-explorer-with-the-js-shell', arche.slug );

	const proper = planPublication( { capability: 'Retarget one motion onto two rigs', title: 'Dance in the Construct', targetKind: 'original', targetName: 'Bruce' } );
	check( 'capitalised "Construct" title is refused', proper.path === 'private' );
	const lower = planPublication( { capability: 'Retarget one motion onto two rigs', title: 'One dance, two characters', headings: [ 'Two dancers on a blank white stage — a construct, if you like' ], targetKind: 'original', targetName: 'Bruce' } );
	check( 'lowercase descriptor "construct" is allowed', lower.path === 'public' );

	return results.every( ( r ) => r.ok );

}

module.exports = { planPublication, findViolations, slugify, lintTutorials, selftest, PUBLIC_TARGET_KINDS };

if ( require.main === module ) {

	const cmd = process.argv[ 2 ] || 'lint';
	if ( cmd === 'selftest' ) process.exit( selftest() ? 0 : 1 );
	if ( cmd === 'lint' ) {

		const problems = lintTutorials( process.argv[ 3 ] ? path.resolve( process.argv[ 3 ] ) : TUTORIAL_DIR );
		if ( problems.length ) { console.error( problems.join( '\n' ) ); console.error( '\n' + problems.length + ' tutorial policy violation(s)' ); process.exit( 1 ); }
		console.log( 'tutorial policy: clean' );

	} else {

		console.error( 'usage: node scripts/tutorial-policy.cjs [lint [dir] | selftest]' );
		process.exit( 2 );

	}

}
