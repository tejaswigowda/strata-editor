// Run: node tools/__tests__/size-check.test.mjs
import assert from 'node:assert';
import { assessSite, VIDEO_ALLOWED } from '../size-check.mjs';

let pass = 0, fail = 0;
const test = ( name, fn ) => { try { fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; } };
const MB = 1024 * 1024;

test( 'T7: a new render committed under docs/video, or any encoded video anywhere, fails; the grandfathered tutorial demo does not', () => {

	assert.strictEqual( assessSite( [ { path: 'docs/index.html', bytes: 5 }, { path: VIDEO_ALLOWED[ 0 ], bytes: 3 * MB } ] ).ok, true );
	for ( const p of [ 'docs/video/bus-stop/v1/1080p60/seg00001.m4s', 'docs/video/bus-stop/v1/master.m3u8', 'clip.MP4', 'docs/x/a.webm' ] ) {

		const r = assessSite( [ { path: p, bytes: 1 } ] );
		assert.deepStrictEqual( [ r.ok, r.video ], [ false, [ p ] ], p );

	}

} );

test( 'H: the Pages site is the tracked files of docs/; at the trip wire it fails, below it passes, and files outside docs/ do not count', () => {

	assert.strictEqual( assessSite( [ { path: 'docs/a.bin', bytes: 699 * MB } ] ).ok, true );
	const over = assessSite( [ { path: 'docs/a.bin', bytes: 700 * MB } ] );
	assert.deepStrictEqual( [ over.ok, over.overLimit ], [ false, true ] );
	assert.strictEqual( assessSite( [ { path: 'guides/a.bin', bytes: 900 * MB } ] ).ok, true );
	assert.strictEqual( assessSite( [ { path: 'docs/a.bin', bytes: 10 * MB } ], { limitMb: 5 } ).ok, false );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
