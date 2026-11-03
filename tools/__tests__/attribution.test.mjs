// Run: node tools/__tests__/attribution.test.mjs
// tools/attribution.mjs on throwaway logs: the summary and its exit codes, the log validated, and the scene file checked for carrying none of the record (A6).
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OpLog, snapshotState } from '../../docs/editor/js/export/oplog.js';
import { report, sceneCarriesAttribution } from '../attribution.mjs';
import { attribute } from '../../docs/editor/js/export/attribution.js';

const TOOL = path.join( path.dirname( fileURLToPath( import.meta.url ) ), '..', 'attribution.mjs' );
let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

let uid = 0;
function node( name, { parent = null, tri = 0 } = {} ) {

	const o = { uuid: 'n' + ( ++ uid ), name, type: tri ? 'Mesh' : 'Group', isMesh: tri > 0, visible: true, parent, children: [], position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, userData: { customClasses: new Set() }, geometry: tri ? { index: null, attributes: { position: { count: tri * 3 } } } : null, traverse( fn ) { fn( this ); for ( const c of this.children ) c.traverse( fn ); } };
	if ( parent ) parent.children.push( o );
	return o;

}
const cmd = ( type, f ) => ( { type, name: type, ...f } );
let clock = 1e12;

/** A session in which an agent names a scene and a person corrects one name and undoes one of the agent's operations. */
function mixedSession() {

	const l = new OpLog( { now: () => ( clock += 1000 ) } ), s = node( 'Scene' );
	const parts = [ 'Tram', 'Cat', 'Bird' ].map( ( n, i ) => node( n + '_raw', { parent: s, tri: 100 * ( i + 1 ) } ) );
	l.setActor( { id: 'copilot-cli:test', kind: 'agent' } );
	l.withOrigin( { kind: 'import', file: 'x.glb' }, () => { for ( const p of parts ) l.recordExecute( cmd( 'AddObjectCommand', { object: p } ) ); } );
	l.runShell( 'rename the three', () => { for ( const p of parts ) { p.name = p.name.replace( '_raw', '' ); l.recordExecute( cmd( 'SetValueCommand', { object: p, attributeName: 'name', newValue: p.name } ) ); } } );
	const wrong = cmd( 'SetClassCommand', { object: parts[ 2 ], className: 'mammal', add: true } ); parts[ 2 ].userData.customClasses.add( 'mammal' ); l.runShell( 'tag the bird', () => l.recordExecute( wrong ) );
	l.setActor( { id: 'tej', kind: 'user' } );
	parts[ 2 ].userData.customClasses.delete( 'mammal' ); l.recordHistory( 'undo', wrong );
	parts[ 1 ].name = 'Lucky_Cat'; l.recordExecute( cmd( 'SetValueCommand', { object: parts[ 1 ], attributeName: 'name', newValue: 'Lucky_Cat' } ) );
	return { log: l.toJSON(), state: snapshotState( s ), s };

}

const tmp = () => fs.mkdtemp( path.join( os.tmpdir(), 'attribution-test-' ) );
const run = ( ...args ) => spawnSync( process.execPath, [ TOOL, ...args ], { encoding: 'utf8' } );

await test( 'a mixed session: the person\'s correction is agent-originated and human-refined, the undone tag counts for nothing, the others are the agent\'s', async () => {

	const { log, state } = mixedSession(), a = attribute( log, state );
	const byName = n => Object.values( a.map ).find( o => o.name === n );
	assert.equal( byName( 'Lucky_Cat' ).props.name.category, 'agent-originated-human-refined' );
	assert.equal( byName( 'Lucky_Cat' ).props.name.last.actor, 'tej' ); assert.equal( byName( 'Lucky_Cat' ).props.name.originating.actor, 'copilot-cli:test' );
	assert.equal( byName( 'Tram' ).props.name.category, 'agent-authored' );
	assert.ok( ! byName( 'Bird' ).props[ 'class:mammal' ], 'the undone class is not on the bird, so it is attributed to no one' );
	assert.equal( a.summary.undone_by.of_agent_operations_by_human, 1 );
	assert.equal( a.summary.degenerate, null, 'both drivers acted, so this is not the degenerate case' );
	assert.ok( a.summary.headline.shares[ 'agent-originated-human-refined' ] > 0 );

} );

await test( 'the CLI prints the headline and the categories, writes the attribution beside the log, and exits 0', async () => {

	const dir = await tmp(), { log, state } = mixedSession();
	await fs.writeFile( path.join( dir, 's.oplog.json' ), JSON.stringify( log ) ); await fs.writeFile( path.join( dir, 's.state.json' ), JSON.stringify( state ) );
	const r = run( path.join( dir, 's.oplog.json' ), path.join( dir, 's.state.json' ) );
	assert.equal( r.status, 0, r.stderr ); assert.match( r.stdout, /HEADLINE: triangles/ ); assert.match( r.stdout, /agent-originated-human-refined/ ); assert.match( r.stdout, /written:/ );
	const out = JSON.parse( await fs.readFile( path.join( dir, 's.attribution.json' ), 'utf8' ) );
	assert.equal( out.schema, 'strata-attribution/1' ); assert.ok( out.map && out.ops && out.summary.headline );
	assert.ok( ! JSON.stringify( out ).includes( '"geometries"' ), 'it is a record of who, not a copy of the scene' );

} );

await test( '--exec reads one Shell pass: what each property it wrote did', async () => {

	const dir = await tmp(), { log, state } = mixedSession();
	await fs.writeFile( path.join( dir, 's.oplog.json' ), JSON.stringify( log ) ); await fs.writeFile( path.join( dir, 's.state.json' ), JSON.stringify( state ) );
	const r = run( path.join( dir, 's.oplog.json' ), path.join( dir, 's.state.json' ), '--exec', '1' );
	assert.equal( r.status, 0, r.stderr ); assert.match( r.stdout, /exec 1 \(agent/ ); assert.match( r.stdout, /name\s+survived 2, overwritten 1/ );
	assert.equal( run( path.join( dir, 's.oplog.json' ), path.join( dir, 's.state.json' ), '--exec', '99' ).status, 2 );

} );

await test( 'a log in which only an agent acted is reported as the degenerate case, not as a finding', async () => {

	const l = new OpLog( { now: () => ( clock += 1000 ) } ), s = node( 'Scene' ), a = node( 'A', { parent: s, tri: 9 } );
	l.setActor( { id: 'copilot-cli:test', kind: 'agent' } ); l.recordExecute( cmd( 'AddObjectCommand', { object: a } ) );
	const text = report( attribute( l.toJSON(), snapshotState( s ) ) );
	assert.match( text, /100% agent by construction/ ); assert.match( text, /human taking over was never exercised/ );

} );

await test( '--validate names an operation without a driver and exits 1; a good log exits 0', async () => {

	const dir = await tmp(), { log } = mixedSession();
	await fs.writeFile( path.join( dir, 'ok.oplog.json' ), JSON.stringify( log ) );
	assert.equal( run( path.join( dir, 'ok.oplog.json' ), '--validate' ).status, 0 );
	delete log.ops[ 2 ].driver; await fs.writeFile( path.join( dir, 'bad.oplog.json' ), JSON.stringify( log ) );
	const bad = run( path.join( dir, 'bad.oplog.json' ), '--validate' );
	assert.equal( bad.status, 1 ); assert.match( bad.stdout, /driver/ );

} );

await test( 'a missing state is a usage error, and an unusable log is refused rather than guessed at', async () => {

	const dir = await tmp(), { log, state } = mixedSession();
	await fs.writeFile( path.join( dir, 'l.oplog.json' ), JSON.stringify( log ) );
	assert.equal( run( path.join( dir, 'l.oplog.json' ) ).status, 2 );
	delete log.ops[ 0 ].actor; await fs.writeFile( path.join( dir, 'l.oplog.json' ), JSON.stringify( log ) ); await fs.writeFile( path.join( dir, 's.state.json' ), JSON.stringify( state ) );
	const r = run( path.join( dir, 'l.oplog.json' ), path.join( dir, 's.state.json' ) );
	assert.equal( r.status, 1 ); assert.match( r.stderr, /not usable/ );

} );

await test( 'A6: a scene file that carries no attribution is separable; one that does is refused', async () => {

	const dir = await tmp(), { log, state } = mixedSession();
	await fs.writeFile( path.join( dir, 'l.oplog.json' ), JSON.stringify( log ) ); await fs.writeFile( path.join( dir, 's.state.json' ), JSON.stringify( state ) );
	const clean = { metadata: { type: 'App' }, scene: { object: { type: 'Scene', userData: { renderSubtitles: [] } } }, history: { undos: [], redos: [] } };
	await fs.writeFile( path.join( dir, 'clean.json' ), JSON.stringify( clean ) );
	assert.deepEqual( sceneCarriesAttribution( clean ), [] );
	assert.equal( run( path.join( dir, 'l.oplog.json' ), path.join( dir, 's.state.json' ), '--scene', path.join( dir, 'clean.json' ) ).status, 0 );
	const dirty = { ...clean, oplog: log };
	await fs.writeFile( path.join( dir, 'dirty.json' ), JSON.stringify( dirty ) );
	assert.ok( sceneCarriesAttribution( dirty ).length );
	const r = run( path.join( dir, 'l.oplog.json' ), path.join( dir, 's.state.json' ), '--scene', path.join( dir, 'dirty.json' ) );
	assert.equal( r.status, 1 ); assert.match( r.stderr, /cannot be shown without its history/ );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
