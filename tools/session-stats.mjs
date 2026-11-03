#!/usr/bin/env node
// tools/session-stats.mjs: the operational numbers of an agent-driven session, from a GitHub Copilot CLI session log (events.jsonl).
//
//   node tools/session-stats.mjs events.jsonl                          the whole log
//   node tools/session-stats.mjs events.jsonl --from-user 3 --to-user 4      between the 3rd and the 4th user message (1-based): one request and what followed
//   node tools/session-stats.mjs events.jsonl --from 2026-11-02T21:31Z --to 2026-11-03T00:28Z      by time
//   node tools/session-stats.mjs events.jsonl --windows "segment:from=1,to=2;save:from=2,to=5"      several named windows at once (user-message numbers)
//   options: --json   --idle 300 (a gap longer than this many seconds is not counted as active time)
//
// What it reports, and how sure it is: duration (wall clock) and active time (the gaps between events, none longer than --idle); model calls and tokens (one
// usage record is one call to the model); tool calls by name and how many failed; calls that reached the editor (the driver script or a browser tool); user
// messages, which is how often a person intervened; and RETRIES, which is a heuristic, not a count the log states: a tool call that failed, or whose output
// shows the page was reloaded under it (a retry the driver made for the agent). The editor's own count of operations is in the operation log, not here: this
// is the model side of the loop, the other half of "how long does it take".
//
// The log's format is the Copilot CLI's and is not a stable interface: the fields read here are named in `FIELDS`, and a window with none of them says so.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOOL = 'strata-session-stats/1';
export const FIELDS = { time: 'timestamp', type: 'type', tool: 'data.toolName', usage: 'data.usage', ok: 'data.success', result: 'data.result.content', user: 'user.message' };

const EDITOR_TOOLS = /^(runPlaywrightCode|openBrowserPage|navigatePage|readPage|screenshotPage|clickElement|typeInPage|hoverElement|dragElement)$/;
const DRIVER_CMD = /run\.sh|localhost:9444|driver\.mjs/;
const RELOADED = /execution context was destroyed|context was destroyed|target closed|target crashed|page crashed|net::ERR|navigation/i;

export function parseLog( text ) {

	const events = [];
	for ( const line of text.split( '\n' ) ) { if ( ! line.trim() ) continue; try { events.push( JSON.parse( line ) ); } catch ( e ) { /* a torn last line */ } }
	return events;

}

/** The events between two user messages (1-based, `to` exclusive of that message's own turn), or two times. */
export function windowOf( events, { fromUser = null, toUser = null, from = null, to = null } = {} ) {

	const users = events.map( ( e, i ) => [ e, i ] ).filter( ( [ e ] ) => e.type === 'user.message' );
	let a = 0, b = events.length;
	if ( fromUser != null ) { if ( ! users[ fromUser - 1 ] ) throw new Error( 'there is no user message ' + fromUser ); a = users[ fromUser - 1 ][ 1 ]; }
	if ( toUser != null ) b = users[ toUser - 1 ] ? users[ toUser - 1 ][ 1 ] : events.length;
	let out = events.slice( a, b );
	if ( from ) out = out.filter( e => Date.parse( e.timestamp ) >= Date.parse( from ) );
	if ( to ) out = out.filter( e => Date.parse( e.timestamp ) < Date.parse( to ) );
	return out;

}

const iso = ms => new Date( ms ).toISOString();
const secs = ms => Math.round( ms / 1000 );

export function statsOf( events, { idle = 300 } = {} ) {

	if ( ! events.length ) return { events: 0, note: 'the window holds no events' };
	const times = events.map( e => Date.parse( e.timestamp ) ).filter( t => ! Number.isNaN( t ) );
	const first = Math.min( ...times ), last = Math.max( ...times );
	let active = 0;
	for ( let i = 1; i < times.length; i ++ ) { const gap = ( times[ i ] - times[ i - 1 ] ) / 1000; if ( gap > 0 && gap <= idle ) active += gap; }

	const usage = events.filter( e => e.type === 'session.usage_record' && e.data && e.data.usage ).map( e => e.data.usage );
	const sum = k => usage.reduce( ( n, u ) => n + ( u[ k ] || 0 ), 0 );
	const models = {}; for ( const u of usage ) models[ u.model ] = ( models[ u.model ] || 0 ) + 1;

	const starts = events.filter( e => e.type === 'tool.execution_start' ), completes = events.filter( e => e.type === 'tool.execution_complete' );
	const byTool = {}; for ( const e of starts ) { const n = e.data.toolName || 'unknown'; byTool[ n ] = ( byTool[ n ] || 0 ) + 1; }
	const external = events.filter( e => e.type === 'external_tool.requested' );
	for ( const e of external ) { const n = e.data.toolName || 'unknown'; byTool[ n ] = ( byTool[ n ] || 0 ) + 1; }
	const failed = completes.filter( e => e.data.success === false );
	const reachedEditor = starts.filter( e => EDITOR_TOOLS.test( e.data.toolName || '' ) || ( e.data.toolName === 'bash' && DRIVER_CMD.test( ( e.data.arguments && e.data.arguments.command ) || '' ) ) ).length
		+ external.filter( e => EDITOR_TOOLS.test( e.data.toolName || '' ) ).length;
	const driverCalls = starts.filter( e => e.data.toolName === 'bash' && DRIVER_CMD.test( ( e.data.arguments && e.data.arguments.command ) || '' ) ).length;
	const reloaded = completes.filter( e => RELOADED.test( String( ( e.data.result && e.data.result.content ) || '' ).slice( 0, 4000 ) ) ).length;
	const users = events.filter( e => e.type === 'user.message' );

	return {
		events: events.length, from: iso( first ), to: iso( last ),
		duration_seconds: secs( last - first ), active_seconds: Math.round( active ), idle_threshold_seconds: idle,
		model: { calls: usage.length, input_tokens: sum( 'inputTokens' ), output_tokens: sum( 'outputTokens' ), cache_read_tokens: sum( 'cacheReadTokens' ), reasoning_tokens: sum( 'reasoningTokens' ), cost_units: sum( 'cost' ), by_model: models, model_seconds: Math.round( sum( 'duration' ) / 1000 ) },
		tools: { calls: starts.length + external.length, by_tool: byTool, failed: failed.length },
		editor: { calls_that_reached_the_editor: reachedEditor, driver_script_calls: driverCalls },
		retries: { heuristic: true, failed_tool_calls: failed.length, calls_whose_output_shows_a_reload_or_crash: reloaded, visible_total: failed.length + reloaded },
		human: { user_messages: users.length, interventions_after_the_first: Math.max( 0, users.length - 1 ) }
	};

}

export function report( name, s ) {

	if ( s.note ) return name + ': ' + s.note;
	const h = secs => ( secs >= 3600 ? Math.floor( secs / 3600 ) + ' h ' : '' ) + Math.floor( ( secs % 3600 ) / 60 ) + ' min';
	return [
		`${ name }: ${ s.from } → ${ s.to }`,
		`  duration ${ h( s.duration_seconds ) } (${ s.duration_seconds } s); active ${ h( s.active_seconds ) } (gaps over ${ s.idle_threshold_seconds } s not counted); model busy ${ h( s.model.model_seconds ) }`,
		`  model calls ${ s.model.calls }; tokens in ${ s.model.input_tokens.toLocaleString() } (cache ${ s.model.cache_read_tokens.toLocaleString() }), out ${ s.model.output_tokens.toLocaleString() }; cost units ${ s.model.cost_units }; ${ Object.entries( s.model.by_model ).map( ( [ k, v ] ) => k + ' ×' + v ).join( ', ' ) }`,
		`  tool calls ${ s.tools.calls} (${ Object.entries( s.tools.by_tool ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 6 ).map( ( [ k, v ] ) => k + ' ' + v ).join( ', ' ) }); ${ s.editor.calls_that_reached_the_editor } reached the editor (${ s.editor.driver_script_calls } driver scripts)`,
		`  retries (heuristic): ${ s.retries.failed_tool_calls } failed tool calls, ${ s.retries.calls_whose_output_shows_a_reload_or_crash } outputs showing a reload or crash`,
		`  human: ${ s.human.user_messages } user message${ s.human.user_messages === 1 ? '' : 's' } (${ s.human.interventions_after_the_first } after the first)`
	].join( '\n' );

}

async function main( argv ) {

	const args = argv.slice( 2 ), flag = n => args.includes( n ), opt = n => { const i = args.indexOf( n ); return i >= 0 ? args[ i + 1 ] : null; };
	const file = args.find( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--from', '--to', '--from-user', '--to-user', '--windows', '--idle' ].includes( args[ i - 1 ] ) );
	if ( ! file ) { console.error( 'usage: node tools/session-stats.mjs events.jsonl [--from-user N --to-user M | --from T --to T | --windows "name:from=1,to=2;..."] [--json] [--idle SECONDS]' ); return 2; }
	const events = parseLog( await fs.readFile( file, 'utf8' ) );
	const idle = Number( opt( '--idle' ) || 300 );
	const out = {};
	if ( opt( '--windows' ) ) {

		for ( const w of opt( '--windows' ).split( ';' ) ) {

			const [ name, spec ] = w.split( ':' ), p = Object.fromEntries( spec.split( ',' ).map( kv => kv.split( '=' ) ) );
			out[ name ] = statsOf( windowOf( events, { fromUser: p.from ? Number( p.from ) : null, toUser: p.to ? Number( p.to ) : null } ), { idle } );

		}

	} else out.window = statsOf( windowOf( events, { fromUser: opt( '--from-user' ) ? Number( opt( '--from-user' ) ) : null, toUser: opt( '--to-user' ) ? Number( opt( '--to-user' ) ) : null, from: opt( '--from' ), to: opt( '--to' ) } ), { idle } );
	console.log( flag( '--json' ) ? JSON.stringify( { tool: TOOL, source: path.basename( file ), windows: out }, null, 1 ) : Object.entries( out ).map( ( [ n, s ] ) => report( n, s ) ).join( '\n\n' ) );
	return 0;

}

if ( import.meta.url === pathToFileURL( process.argv[ 1 ] || '' ).href ) main( process.argv ).then( c => process.exit( c ), e => { console.error( e.message ); process.exit( 2 ); } );
