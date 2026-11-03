#!/usr/bin/env node
// tools/attribution.mjs: whose decisions are present in the finished work. Computes attribution by survival from an operation log and a final-state snapshot.
//
//   node tools/attribution.mjs scene.oplog.json scene.state.json            print the summary, write scene.attribution.json beside the log
//   node tools/attribution.mjs LOG STATE --out FILE                         write the attribution there
//   node tools/attribution.mjs LOG STATE --json                             print the whole attribution as JSON (the per-property map, the per-operation table)
//   node tools/attribution.mjs LOG STATE --exec 13                          one Shell pass: what each property it wrote did, survived or not
//   (add --compact to write the attribution without indentation)
//   node tools/attribution.mjs LOG STATE --scene scene.json                 also check that the scene file carries none of it (the record stays separable)
//   node tools/attribution.mjs LOG --validate                               only check that every operation names its driver and its actor
//
// The two inputs come from the editor: in the Shell, saveAttribution('name') downloads name.oplog.json and name.state.json; in code, editor.attributionArtifacts().
// They are kept apart from the scene on purpose: if the record shipped inside the file, showing someone the work without its history, and asking them to say who
// made it, could not be arranged later without cutting the file open. exit: 0 ok · 1 the log is not usable, or the scene carries an attribution · 2 usage.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attribute, CATEGORIES, ATTRIBUTION_SCHEMA } from '../docs/editor/js/export/attribution.js';
import { validateOpLog } from '../docs/editor/js/export/oplog.js';

export const TOOL = 'strata-attribution/1';

const readJson = async p => JSON.parse( await fs.readFile( p, 'utf8' ) );
const pct = x => ( x == null ? '   –  ' : ( x * 100 ).toFixed( 1 ).padStart( 5 ) + '%' );
const num = ( x, d = 0 ) => ( x == null ? '–' : Number( x ).toFixed( d ) );

/** What in a scene file would let a reader see who made it: nothing should. (The undo history is serialised only when a setting is on, and holds no driver.) */
export function sceneCarriesAttribution( scene ) {

	const hits = [];
	const walk = ( v, at ) => {

		if ( ! v || typeof v !== 'object' ) return;
		for ( const [ k, x ] of Object.entries( v ) ) {

			if ( /^(oplog|attribution|driver|actor)$/i.test( k ) ) hits.push( at + '.' + k );
			if ( typeof x === 'string' && /strata-oplog\/|strata-attribution\// .test( x ) ) hits.push( at + '.' + k );
			if ( at.split( '.' ).length < 6 ) walk( x, at + '.' + k );

		}

	};
	walk( scene, '$' );
	return hits;

}

export function report( a ) {

	const s = a.summary, lines = [];
	lines.push( `attribution by survival  (${ a.schema }; session ${ a.session && a.session.id })` );
	lines.push( `  ${ s.coverage.operations } operations: ${ s.coverage.live } live, ${ s.coverage.undone } undone, ${ s.coverage.discarded } discarded, ${ s.coverage.reset } reset` );
	lines.push( `  ${ s.totals.properties } final properties on ${ s.totals.objects } objects, ${ s.totals.triangles } triangles, ${ s.totals.seconds } s of timeline` );
	lines.push( `  actors: ${ s.actors.join( ', ' ) }` );
	if ( s.degenerate ) lines.push( '  NOTE: ' + s.degenerate );
	lines.push( '' );
	lines.push( `  ${ 'category'.padEnd( 34 ) }${ 'triangles'.padStart( 10 ) }${ 'objects'.padStart( 10 ) }${ 'seconds'.padStart( 10 ) }${ 'properties'.padStart( 12 ) }   (HEADLINE: triangles)` );
	for ( const c of CATEGORIES ) {

		const x = s.categories[ c ];
		if ( ! x.properties ) continue;
		lines.push( `  ${ c.padEnd( 34 ) }${ pct( x.triangles_share ).padStart( 10 ) }${ pct( x.objects_share ).padStart( 10 ) }${ pct( x.seconds_share ).padStart( 10 ) }${ pct( x.properties_share ).padStart( 12 ) }` );

	}
	lines.push( '' );
	lines.push( `  weighted shares: each object's triangles are shared equally among its properties; a timeline event weighs its seconds.` );
	lines.push( `  by count the agent made ${ s.naive.operations.agent } operations and a person ${ s.naive.operations.human } (undone and overwritten ones included: not what the work is made of)` );
	lines.push( `  readable: ${ pct( 1 - ( s.coverage.opaque_share || 0 ) ).trim() } of operations; unlogged properties ${ s.coverage.unlogged_properties } (${ pct( s.coverage.unlogged_share ).trim() }), baseline ${ s.coverage.baseline_properties }, discrepancies ${ s.coverage.discrepancies }` );
	if ( s.undone_by.human || s.undone_by.agent ) lines.push( `  undone: by a person ${ s.undone_by.human } (of which agent operations ${ s.undone_by.of_agent_operations_by_human }), by an agent ${ s.undone_by.agent }` );
	const passes = a.execs.filter( e => e.overwritten || e.dead ).slice( 0, 8 );
	if ( passes.length ) {

		lines.push( '', '  passes that only partly survived:' );
		for ( const e of passes ) lines.push( `    exec ${ String( e.exec ).padEnd( 4 ) } ${ e.driver.padEnd( 6 ) } ${ e.writes } writes: ${ e.survived } survived, ${ e.overwritten } overwritten, ${ e.dead } undone  ${ e.src ? '“' + e.src.slice( 0, 60 ) + '”' : '' }` );

	}
	return lines.join( '\n' );

}

async function main( argv ) {

	const args = argv.slice( 2 ), flag = n => args.includes( n ), opt = n => { const i = args.indexOf( n ); return i >= 0 ? args[ i + 1 ] : null; };
	const files = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--out', '--scene', '--exec' ].includes( args[ i - 1 ] ) );
	if ( ! files.length || flag( '--help' ) ) { console.error( 'usage: node tools/attribution.mjs LOG.oplog.json STATE.state.json [--out FILE] [--json] [--scene SCENE.json] | LOG --validate' ); return 2; }

	const log = await readJson( files[ 0 ] );
	if ( flag( '--validate' ) ) {

		const problems = validateOpLog( log );
		console.log( problems.length ? problems.slice( 0, 20 ).join( '\n' ) : `ok: ${ log.ops.length } operations, every one with a driver, an actor and a time` );
		return problems.length ? 1 : 0;

	}
	if ( ! files[ 1 ] ) { console.error( 'a final-state file is needed (the .state.json that saveAttribution() writes beside the log)' ); return 2; }
	let result;
	try { result = attribute( log, await readJson( files[ 1 ] ) ); } catch ( e ) { console.error( e.message ); return 1; }

	let code = 0;
	if ( opt( '--scene' ) ) {

		const hits = sceneCarriesAttribution( await readJson( opt( '--scene' ) ) );
		if ( hits.length ) { console.error( 'the scene file carries attribution, so it cannot be shown without its history: ' + hits.slice( 0, 5 ).join( ', ' ) ); code = 1; }
		else console.error( 'the scene file carries no attribution: the record is separable' );

	}
	const out = opt( '--out' ) || files[ 0 ].replace( /\.oplog\.json$|\.json$/, '' ) + '.attribution.json';
	await fs.writeFile( out, JSON.stringify( result, null, flag( '--compact' ) ? 0 : 1 ) + '\n' );
	if ( opt( '--exec' ) ) {

		const e = result.execs.find( x => x.exec === Number( opt( '--exec' ) ) );
		if ( ! e ) { console.error( 'no Shell pass numbered ' + opt( '--exec' ) ); return 2; }
		console.log( `exec ${ e.exec } (${ e.driver }, ${ e.actor }): ${ e.src || '' }\n  ${ e.ops } operations, ${ e.writes } writes: ${ e.survived } survived, ${ e.overwritten } overwritten, ${ e.dead } undone` );
		for ( const [ k, f ] of Object.entries( e.props ).sort() ) console.log( '  ' + k.padEnd( 14 ) + Object.entries( f ).map( ( [ a, n ] ) => a + ' ' + n ).join( ', ' ) );
		return code;

	}
	console.log( flag( '--json' ) ? JSON.stringify( result, null, 1 ) : report( result ) + '\n\nwritten: ' + path.relative( process.cwd(), out ) );
	return code;

}

if ( import.meta.url === pathToFileURL( process.argv[ 1 ] || '' ).href ) main( process.argv ).then( c => process.exit( c ), e => { console.error( e.stack || e.message ); process.exit( 2 ); } );
export { ATTRIBUTION_SCHEMA };
