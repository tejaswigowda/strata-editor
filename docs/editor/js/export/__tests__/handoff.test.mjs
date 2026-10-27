// Run: node docs/editor/js/export/__tests__/handoff.test.mjs
// The client side of the hand-off to the dub / ffmpeg popups, against a fake popup: origin and source checks, the ready handshake, progress,
// results, errors, a missing op, a closed window, a blocked popup, and the cross-origin-isolation message.
import assert from 'node:assert';
import { openTool, toolFor, TOOLS, PROTOCOL } from '../handoff.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const tool = { name: 'dub.webcli.app', url: 'http://x/', origin: 'https://dub.webcli.app' };

/** A fake opener window and popup. popup.reply( msg, origin ) is what the tool would post back. */
function fakes( { toolOrigin = tool.origin } = {} ) {

	const listeners = [];
	const listen = { addEventListener: ( t, f ) => listeners.push( f ), removeEventListener: ( t, f ) => listeners.splice( listeners.indexOf( f ), 1 ) };
	const sent = [];
	const popup = {
		closed: false, sent,
		postMessage: ( msg, origin, transfer ) => { sent.push( { msg, origin, transfer } ); popup.onSend && popup.onSend( msg ); },
		close() { popup.closed = true; },
	};
	const deliver = ( data, { source = popup, origin = toolOrigin } = {} ) => listeners.slice().forEach( f => f( { source, origin, data } ) );
	const reply = ( msg, o ) => deliver( { webcli: PROTOCOL, ...msg }, o );
	return { listen, popup, deliver, reply, sent, listeners };

}

await test( 'it says hello until the tool is ready, sends the job to the tool\u2019s origin only, and returns the files', async () => {

	const f = fakes();
	const h = openTool( tool, { open: () => f.popup, listen: f.listen, pollMs: 10 } );
	const p = h.job( { op: 'dub', args: { voice: 'af_heart' }, files: { 'subtitles.srt': new TextEncoder().encode( '1\n' ) } } );
	await new Promise( r => setTimeout( r, 40 ) );
	assert.ok( f.sent.some( s => s.msg.type === 'hello' && s.origin === tool.origin ), 'hello goes to the tool origin' );
	assert.ok( ! f.sent.some( s => s.msg.type === 'job' ), 'no job before ready' );
	f.reply( { type: 'ready', tool: 'dub.webcli.app', version: '1', ops: [ 'dub' ] } );
	await new Promise( r => setTimeout( r, 10 ) );
	const job = f.sent.find( s => s.msg.type === 'job' );
	assert.ok( job && job.origin === tool.origin && job.msg.op === 'dub' && job.msg.args.voice === 'af_heart' );
	assert.ok( job.msg.files[ 'subtitles.srt' ] instanceof ArrayBuffer && job.transfer.length === 1, 'buffers are transferred, not copied' );
	f.reply( { type: 'result', id: job.msg.id, files: { 'narration.wav': Uint8Array.of( 82, 73, 70, 70 ).buffer }, meta: { ok: true } } );
	const out = await p;
	assert.deepStrictEqual( Array.from( out.files[ 'narration.wav' ] ), [ 82, 73, 70, 70 ] );
	assert.deepStrictEqual( out.meta, { ok: true } );
	h.close();
	assert.ok( f.popup.closed );

} );

await test( 'messages from another origin or another window are ignored, as are other protocols', async () => {

	const f = fakes();
	const h = openTool( tool, { open: () => f.popup, listen: f.listen, pollMs: 10, readyTimeoutMs: 80 } );
	const p = h.job( { op: 'dub' } );
	f.reply( { type: 'ready', tool: 'x', version: '1', ops: [ 'dub' ] }, { origin: 'https://evil.example' } );
	f.reply( { type: 'ready', tool: 'x', version: '1', ops: [ 'dub' ] }, { source: {} } );
	f.deliver( { webcli: 99, type: 'ready', ops: [ 'dub' ] } );
	await assert.rejects( p, /did not answer/ );
	h.close();

} );

await test( 'progress is relayed; an error rejects with the tool\u2019s message; a result for another job is ignored', async () => {

	const f = fakes();
	const h = openTool( tool, { open: () => f.popup, listen: f.listen, pollMs: 10 } );
	f.reply( { type: 'ready', tool: 'dub', version: '1', ops: [ 'dub' ] } );
	const seen = [];
	const p = h.job( { op: 'dub', onProgress: ( fr, t ) => seen.push( [ fr, t ] ) } );
	await new Promise( r => setTimeout( r, 5 ) );
	const id = f.sent.find( s => s.msg.type === 'job' ).msg.id;
	f.reply( { type: 'progress', id, fraction: 0.5, text: 'Cue 6 of 12' } );
	f.reply( { type: 'result', id: 'other', files: {}, meta: {} } );
	f.reply( { type: 'error', id, message: 'The SRT is malformed' } );
	await assert.rejects( p, /The SRT is malformed/ );
	assert.deepStrictEqual( seen, [ [ 0.5, 'Cue 6 of 12' ] ] );
	h.close();

} );

await test( 'an op the tool does not offer is refused before anything is sent, naming what it does offer', async () => {

	const f = fakes();
	const h = openTool( tool, { open: () => f.popup, listen: f.listen, pollMs: 10 } );
	f.reply( { type: 'ready', tool: 'ffmpeg', version: '0', ops: [ 'trim' ] } );
	await assert.rejects( h.job( { op: 'mux' } ), /does not offer 'mux'.*trim/ );
	assert.ok( ! f.sent.some( s => s.msg.type === 'job' ) );
	h.close();

} );

await test( 'closing the window rejects the waiting job', async () => {

	const f = fakes();
	const h = openTool( tool, { open: () => f.popup, listen: f.listen, pollMs: 10 } );
	f.reply( { type: 'ready', tool: 'dub', version: '1', ops: [ 'dub' ] } );
	const p = h.job( { op: 'dub' } );
	setTimeout( () => { f.popup.closed = true; }, 20 );
	await assert.rejects( p, /window was closed before it finished/ );

} );

await test( 'a blocked popup says so, and an isolated page explains why the tool cannot answer', () => {

	const f = fakes();
	assert.throws( () => openTool( tool, { open: () => null, listen: f.listen } ), /blocked/ );
	globalThis.crossOriginIsolated = true;
	try { assert.throws( () => openTool( tool, { open: () => f.popup, listen: f.listen } ), /cross-origin isolated.*STRATA_NO_ISOLATION/ ); } finally { delete globalThis.crossOriginIsolated; }

} );

await test( 'the tool addresses can be pointed at localhost for testing, and nowhere else', () => {

	assert.strictEqual( toolFor( 'dub', '' ).origin, 'https://dub.webcli.app' );
	assert.strictEqual( toolFor( 'ffmpeg', '' ).url, TOOLS.ffmpeg.url );
	assert.strictEqual( toolFor( 'dub', '?dubUrl=http%3A%2F%2F127.0.0.1%3A5601%2F' ).origin, 'http://127.0.0.1:5601' );
	assert.throws( () => toolFor( 'dub', '?dubUrl=https%3A%2F%2Fevil.example%2F' ), /localhost/ );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
