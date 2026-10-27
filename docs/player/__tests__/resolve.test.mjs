// Run: node docs/player/__tests__/resolve.test.mjs
import assert from 'node:assert';
import { resolveBase, followsBranch, formatDuration } from '../resolve.js';

const B = 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/';
let pass = 0, fail = 0;
const test = ( name, fn ) => { try { fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } };

test( 'the folder, with or without the trailing slash', () => {

	assert.strictEqual( resolveBase( B ).base, B );
	assert.strictEqual( resolveBase( B.slice( 0, -1 ) ).base, B );

} );
test( 'any file in the set resolves to its folder', () => {

	for ( const f of [ 'master.m3u8', 'render.json', 'poster.jpg', 'captions.vtt' ] ) assert.strictEqual( resolveBase( B + f ).base, B, f );
	assert.strictEqual( resolveBase( B + 'master.m3u8?x=1#y' ).base, B );

} );
test( 'the GitHub page of the folder becomes the jsDelivr address', () => {

	assert.strictEqual( resolveBase( 'https://github.com/tejaswigowda/test1/tree/main/renders/projectile' ).base, B );
	assert.strictEqual( resolveBase( 'https://github.com/tejaswigowda/test1/tree/renders/renders/projectile/' ).base, 'https://cdn.jsdelivr.net/gh/tejaswigowda/test1@renders/renders/projectile/' );

} );
test( 'a percent-encoded hash, and the path without the host', () => {

	assert.strictEqual( resolveBase( encodeURIComponent( B ) ).base, B );
	assert.strictEqual( resolveBase( 'gh/tejaswigowda/test1@main/renders/projectile' ).base, B );
	assert.strictEqual( resolveBase( 'cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile' ).base, B );

} );
test( 'nothing, or something that is not an address, is an error', () => {

	assert.ok( resolveBase( '' ).error );
	assert.ok( resolveBase( 'projectile' ).error );

} );
test( 'a branch address is flagged, a commit address is not', () => {

	assert.strictEqual( followsBranch( B ), true );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/a/b@89f9272c7b891ab7bf798a2b58de4b3a08a36eab/renders/x/' ), false );
	assert.strictEqual( followsBranch( 'https://cdn.jsdelivr.net/gh/a/b@89f9272/renders/x/' ), false );

} );
test( 'durations are m:ss', () => { assert.strictEqual( formatDuration( 80.7 ), '1:21' ); assert.strictEqual( formatDuration( 5 ), '0:05' ); } );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
