// Run: node docs/editor/js/export/__tests__/dubCues.test.mjs
// Subtitles in, narration out: what is sent to dub.webcli.app, what comes back, and the one-line summary (which says so when the cues collide).
import assert from 'node:assert';
import { dubCues } from '../dubCues.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const cues = [ { id: 'a', start: 0, end: 2.5, text: 'One.' }, { id: 'b', start: 3, end: 5, text: 'Two.' } ];
const wav = new Uint8Array( 200 ).fill( 7 );
const handle = ( out, seen = {} ) => ( { job: async j => { seen.job = j; if ( j.onProgress ) j.onProgress( 0.5, 'speaking' ); return out; } } );

await test( 'it sends the cues as an .srt with the voice, and returns the WAV, the voice used, the model and a summary', async () => {

	const seen = {}, progress = [];
	const r = await dubCues( cues, handle( { files: { 'narration.wav': wav }, meta: { voice: 'af_sarah', report: { duration_s: 5.1, synthesized: 2, ok: true, model: { id: 'kokoro', revision: 'abc', dtype: 'q8', device: 'wasm' } } } }, seen ), { voice: ' af_sarah ', name: 'pyth', onProgress: ( f, t ) => progress.push( [ f, t ] ) } );
	assert.strictEqual( seen.job.op, 'dub' );
	assert.strictEqual( seen.job.args.voice, 'af_sarah' );
	assert.strictEqual( seen.job.args.name, 'pyth.srt' );
	const srt = new TextDecoder().decode( seen.job.files[ 'subtitles.srt' ] );
	assert.ok( /00:00:00,000 --> 00:00:02,500\s+One\./.test( srt ) && /Two\./.test( srt ), srt );
	assert.strictEqual( r.wav, wav );
	assert.strictEqual( r.voice, 'af_sarah' );
	assert.strictEqual( r.model, 'kokoro@abc q8/wasm' );
	assert.match( r.summary, /voice af_sarah, 5\.1 s, 2 cues, no collisions/ );
	assert.deepStrictEqual( progress, [ [ 0.5, 'speaking' ] ] );

} );

await test( 'the default voice is af_heart, and collisions are said, not hidden', async () => {

	const seen = {};
	const r = await dubCues( cues, handle( { files: { 'narration.wav': wav }, meta: { report: { duration_s: 4, synthesized: 2, ok: false, collisions: 1 } } }, seen ), { voice: '' } );
	assert.strictEqual( seen.job.args.voice, 'af_heart' );
	assert.match( r.summary, /WITH PROBLEMS \(1 collisions\)/ );
	assert.strictEqual( r.model, 'unknown' );

} );

await test( 'no audio, or a stub of a file, is an error', async () => {

	await assert.rejects( dubCues( cues, handle( { files: {}, meta: {} } ) ), /sent no audio/ );
	await assert.rejects( dubCues( cues, handle( { files: { 'narration.wav': new Uint8Array( 10 ) }, meta: {} } ) ), /sent no audio/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
