// check-shorts.mjs — the standard every tutorial for a Lyceum short must meet (guides/SHORTS_TEMPLATE.md).
//   node scripts/check-shorts.mjs
// Each page must carry one <div id="film-contract"> that states, in this order, the units, the assumptions, whether the
// render was run, and that the scene is addressable (every object named and classed, gated by requireLabels); and none
// may call a demonstration a proof (a page that really proves something is listed in PROOF_OK with the reason).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', 'docs', 'about', 'tutorials' );
const SHORTS = [ 'makeshort.html', 'a-plus-b-cubed.html', 'hardy-weinberg.html', 'area-volume.html', 'projectile.html', 'piston.html', 'molecule-shapes.html' ];
const PROOF_OK = { 'a-plus-b-cubed.html': 'it is a genuine dissection proof of the identity for positive lengths, and says so in its contract' };
const REQUIRED = [ 'Units:', 'Assumptions:', 'Render:', 'Addressable:' ];

let problems = 0;
const fail = ( file, msg ) => { console.error( `✗ ${ file }: ${ msg }` ); problems ++; };

for ( const file of SHORTS ) {

	const html = fs.readFileSync( path.join( dir, file ), 'utf8' );
	const m = /<div class="note" id="film-contract">([\s\S]*?)<\/div>/.exec( html );
	if ( ! m ) { fail( file, 'no <div id="film-contract">' ); continue; }
	const text = m[ 1 ].replace( /<[^>]+>/g, '' );
	let at = - 1;
	for ( const key of REQUIRED ) {

		const i = text.indexOf( key );
		if ( i < 0 ) fail( file, `contract has no "${ key }"` );
		else if ( i < at ) fail( file, `contract lists "${ key }" out of order` );
		else at = i;

	}
	const render = /Render:([\s\S]*?)Addressable:/.exec( text );
	if ( render && ! /was not run|was run|has not been re-rendered|was committed/.test( render[ 1 ] ) ) fail( file, 'the Render line must say whether the render was run' );
	if ( ! /requireLabels/.test( m[ 1 ] ) ) fail( file, 'the Addressable line must name requireLabels' );

	if ( ! PROOF_OK[ file ] ) {

		const visible = html.replace( /<pre[\s\S]*?<\/pre>/g, '' ).replace( /<img[^>]*>/g, '' ).replace( /<[^>]+>/g, ' ' );
		const hit = /\bproofs?\b/i.exec( visible );
		if ( hit ) fail( file, `calls its film a "${ hit[ 0 ] }" (a demonstration is not a proof)` );

	}

}

const index = fs.readFileSync( path.join( dir, 'tutorials.json' ), 'utf8' );
for ( const e of JSON.parse( index ) ) {

	if ( ! SHORTS.includes( e.href ) || PROOF_OK[ e.href ] ) continue;
	if ( /\bproofs?\b/i.test( e.title + ' ' + e.blurb + ' ' + e.desc ) ) fail( 'tutorials.json', `${ e.href }: the index calls it a proof` );

}

if ( problems ) { console.error( `\n${ problems } problem(s)` ); process.exit( 1 ); }
console.log( `${ SHORTS.length } shorts meet the standard.` );
