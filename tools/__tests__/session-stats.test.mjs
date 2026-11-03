// Run: node tools/__tests__/session-stats.test.mjs
// tools/session-stats.mjs on a small synthetic session log: windows by user message, active time with idle gaps left out, model calls, tool calls, the editor-facing
// calls, retries (a heuristic, and labelled one) and how often a person spoke.
import assert from 'node:assert';
import { parseLog, windowOf, statsOf, report } from '../session-stats.mjs';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

const T = s => '2026-11-02T12:' + s + 'Z';
const ev = ( type, at, data = {} ) => JSON.stringify( { type, timestamp: T( at ), data } );
const usage = at => ev( 'session.usage_record', at, { usage: { model: 'm1', inputTokens: 1000, outputTokens: 10, cacheReadTokens: 900, reasoningTokens: 5, cost: 1, duration: 2000 } } );
const LOG = [
	ev( 'user.message', '00:00', { content: 'segment it' } ),
	usage( '00:05' ),
	ev( 'tool.execution_start', '00:06', { toolName: 'bash', arguments: { command: './run.sh build.js' } } ), ev( 'tool.execution_complete', '00:20', { success: true, result: { content: 'ok' } } ),
	usage( '00:21' ),
	ev( 'tool.execution_start', '00:22', { toolName: 'bash', arguments: { command: './run.sh cut.js' } } ), ev( 'tool.execution_complete', '00:30', { success: true, result: { content: 'Execution context was destroyed, most likely because of a navigation' } } ),
	usage( '00:31' ),
	ev( 'tool.execution_start', '00:32', { toolName: 'view', arguments: {} } ), ev( 'tool.execution_complete', '00:33', { success: false, result: { content: 'no such file' } } ),
	ev( 'user.message', '30:00', { content: 'now save it' } ),     // a long silence, then a person speaks again
	usage( '30:05' ), ev( 'tool.execution_start', '30:06', { toolName: 'runPlaywrightCode', arguments: {} } ), ev( 'tool.execution_complete', '30:10', { success: true, result: { content: 'ok' } } ),
].join( '\n' ) + '\n{"torn":';

await test( 'a torn last line is skipped, and windows are cut at user messages', () => {

	const events = parseLog( LOG );
	assert.equal( events.length, 14 );
	assert.equal( windowOf( events, { fromUser: 1, toUser: 2 } ).length, 10 );
	assert.equal( windowOf( events, { fromUser: 2 } ).length, 4 );
	assert.throws( () => windowOf( events, { fromUser: 9 } ), /no user message 9/ );

} );

await test( 'duration, active time (the long silence is not work), model calls and tokens', () => {

	const s = statsOf( windowOf( parseLog( LOG ), { fromUser: 1, toUser: 2 } ), { idle: 300 } );
	assert.equal( s.duration_seconds, 33 ); assert.equal( s.active_seconds, 33 );
	const all = statsOf( parseLog( LOG ), { idle: 300 } );
	assert.equal( all.duration_seconds, 30 * 60 + 10 ); assert.ok( all.active_seconds < 120, 'the half hour between the two messages is idle, not active' );
	assert.equal( s.model.calls, 3 ); assert.equal( s.model.input_tokens, 3000 ); assert.equal( s.model.cost_units, 3 );

} );

await test( 'tool calls, the calls that reached the editor, retries as a labelled heuristic, and how many times a person spoke', () => {

	const s = statsOf( windowOf( parseLog( LOG ), { fromUser: 1, toUser: 2 } ) );
	assert.equal( s.tools.calls, 3 ); assert.equal( s.tools.by_tool.bash, 2 ); assert.equal( s.tools.failed, 1 );
	assert.equal( s.editor.calls_that_reached_the_editor, 2 ); assert.equal( s.editor.driver_script_calls, 2 );
	assert.equal( s.retries.heuristic, true ); assert.equal( s.retries.failed_tool_calls, 1 ); assert.equal( s.retries.calls_whose_output_shows_a_reload_or_crash, 1 ); assert.equal( s.retries.visible_total, 2 );
	assert.equal( s.human.user_messages, 1 ); assert.equal( s.human.interventions_after_the_first, 0 );
	assert.equal( statsOf( parseLog( LOG ) ).human.interventions_after_the_first, 1 );
	assert.equal( statsOf( parseLog( LOG ) ).editor.calls_that_reached_the_editor, 3, 'a browser tool counts too' );
	assert.match( report( 'x', s ), /retries \(heuristic\)/ );

} );

await test( 'an empty window says so rather than reporting zeros', () => {

	assert.match( statsOf( [] ).note, /no events/ );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
