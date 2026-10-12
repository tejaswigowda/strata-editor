// Run: node docs/editor/js/facebind/__tests__/page.test.mjs
// Static checks on the face-bind page's zero-egress setup (no browser needed).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', '..', '..', '..', 'facebind' );
const read = f => fs.readFileSync( path.join( root, f ), 'utf8' );
const sha = ( f, enc ) => crypto.createHash( 'sha256' ).update( fs.readFileSync( path.join( root, f ) ) ).digest( enc );

let passed = 0, failed = 0;
const test = ( name, fn ) => { try { fn(); passed ++; console.log( '  ✓ ' + name ); } catch ( e ) { failed ++; console.log( '  ✗ ' + name + '\n      ' + e.message ); } };
const ok = ( v, m ) => { if ( ! v ) throw new Error( m || 'expected truthy' ); };
const strip = s => s.replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /^\s*\/\/.*$/gm, '' ).replace( /\s\/\/ .*$/gm, '' );

console.log( 'face bind page (static)' );
const html = read( 'index.html' );
const csp = ( html.match( /Content-Security-Policy" content="([^"]*)"/ ) || [] )[ 1 ] || '';

test( 'CSP: no remote scripts, no inline script except the import map (by hash), connect-src is same-origin + the VRM host', () => {

	ok( /default-src 'none'/.test( csp ) );
	const script = csp.match( /script-src ([^;]*)/ )[ 1 ];
	ok( ! /unsafe-inline|https?:/.test( script ), 'script-src is not strict: ' + script );
	const connect = csp.match( /connect-src ([^;]*)/ )[ 1 ].split( /\s+/ );
	ok( connect.every( c => c === "'self'" || c === 'https://raw.githubusercontent.com' ), 'unexpected connect-src: ' + connect.join( ' ' ) );
	ok( /form-action 'none'/.test( csp ) );

} );

test( 'the inline import map is covered by the CSP hash', () => {

	const maps = [ ...html.matchAll( /<script type="importmap">([\s\S]*?)<\/script>/g ) ];
	ok( maps.length === 1, 'expected exactly one import map' );
	const want = `'sha256-${ crypto.createHash( 'sha256' ).update( maps[ 0 ][ 1 ] ).digest( 'base64' ) }'`;
	ok( csp.includes( want ), `CSP is missing ${ want } — re-hash the import map` );
	const inline = [ ...html.matchAll( /<script(?![^>]*\ssrc=)(?![^>]*importmap)[^>]*>/g ) ];
	ok( inline.length === 0, 'inline script found' );

} );

test( 'no CDN or other remote URL is loaded by the page, the glue, or the vendored autorigger', () => {

	for ( const f of [ 'index.html', 'page.js', 'egressGuard.js', 'autorig/faceFromImage.js', 'autorig/arkit-mapper.js', 'autorig/face-mesh-generator.js', 'autorig/texture-mapper.js' ] ) {

		const src = strip( read( f ) ).replace( /<!--[\s\S]*?-->/g, '' ).replace( /Content-Security-Policy" content="[^"]*"/, '' );
		const urls = ( src.match( /https?:\/\/[^\s'"`)<]+/g ) || [] ).filter( u => ! /^https?:\/\/(www\.w3\.org|raw\.githubusercontent\.com\/…)/.test( u ) );
		ok( urls.length === 0, `${ f } mentions ${ urls.join( ', ' ) }` );

	}

} );

test( 'the page\'s only network call is a GET of the base VRM; photos and face GLBs are never sent anywhere', () => {

	const src = strip( read( 'page.js' ) ) + strip( read( 'autorig/faceFromImage.js' ) );
	const calls = src.match( /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/g ) || [];
	ok( calls.length === 1 && calls[ 0 ] === 'fetch', `network APIs used: ${ calls.join( ', ' ) }` );
	ok( /await fetch\( vrm \)/.test( src ), 'the fetch is not the base-VRM GET' );
	ok( ! /method\s*:/.test( src ) && ! /body\s*:/.test( src ), 'a request method/body is set' );

} );

test( 'vendored MediaPipe files match their recorded SHA-256', () => {

	const readme = read( 'vendor/mediapipe/README.md' );
	for ( const f of [ 'vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'face_landmarker.task' ] ) {

		const h = sha( 'vendor/mediapipe/' + f, 'hex' );
		ok( readme.includes( `${ h }  ${ f }` ), `${ f }: hash ${ h } is not in the README` );

	}

} );

console.log( `${ passed } passed, ${ failed } failed` );
process.exit( failed ? 1 : 0 );
