// Run: node docs/editor/js/export/__tests__/attribution.test.mjs
// The operation log and attribution by survival: A1 (every operation names its driver and actor), A2 (last writer over the final state; undone and overwritten
// operations score zero), A3 (the rig-pass case: 143 survive, 9 do not), A4 (weighted beside unweighted), A5 (three categories, with the originating and the last
// operation), A6 (the record is a separate artifact).
import assert from 'node:assert';
import { OpLog, snapshotState, describeCommand, validateOpLog, flatState, diffState, OPLOG_SCHEMA, STATE_SCHEMA } from '../oplog.js';
import { attribute, liveEntries, categoryOf, CATEGORIES } from '../attribution.js';

let pass = 0, fail = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.stack.split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

// ── a tiny scene of duck-typed objects ──────────────────────────────────────────────────────────────────────

let uid = 0;
const V = ( x = 0, y = 0, z = 0 ) => ( { x, y, z } );
function node( name, { parent = null, tri = 0, classes = [], children = [] } = {} ) {

	const o = {
		uuid: 'u' + ( ++ uid ), name, type: tri ? 'Mesh' : 'Group', isMesh: tri > 0, visible: true, parent, children: [], position: V(), rotation: V(), scale: V( 1, 1, 1 ),
		userData: { customClasses: new Set( classes ) },
		geometry: tri ? { index: null, attributes: { position: { count: tri * 3 } } } : null,
		traverse( fn ) { fn( this ); for ( const c of this.children ) c.traverse( fn ); }
	};
	if ( parent ) parent.children.push( o );
	for ( const c of children ) { c.parent = o; o.children.push( c ); }
	return o;

}
const scene = () => node( 'Scene' );
const cmd = ( type, fields ) => ( { type, name: type, ...fields } );
const addCmd = object => cmd( 'AddObjectCommand', { object } );
const classCmd = ( object, className, add = true ) => cmd( 'SetClassCommand', { object, className, add } );
const nameCmd = ( object, v ) => cmd( 'SetValueCommand', { object, attributeName: 'name', newValue: v } );

let clock = 1e12;
const log = () => new OpLog( { now: () => ( clock += 1000 ) } );
const agent = { id: 'copilot-cli:test', kind: 'agent' };
/** Run a command as the history does: execute (the caller already changed the scene), then record. */
const run = ( l, c, opts ) => l.recordExecute( c, opts );
const attributeOf = ( l, s ) => attribute( l.toJSON(), snapshotState( s ) );
const prop = ( r, uuid, p ) => r.map[ uuid ].props[ p ];

// ── A1 ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A1: every operation carries a driver and an actor' );

await test( 'a plain operation is the gui, by the undeclared user', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 10 } );
	const op = run( l, addCmd( a ) );
	assert.equal( op.driver, 'gui' ); assert.equal( op.channel, 'gui' ); assert.deepEqual( op.actor, { id: 'user', kind: 'user' } ); assert.equal( op.declared, false );

} );

await test( 'inside the Shell it is the shell; a declared agent in the Shell is the agent, and an agent calling the editor directly is the agent', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 10 } );
	assert.equal( l.within( { channel: 'shell' }, () => run( l, addCmd( a ) ) ).driver, 'shell' );
	l.setActor( agent );
	const viaShell = l.within( { channel: 'shell' }, () => run( l, nameCmd( a, 'B' ) ) );
	assert.equal( viaShell.driver, 'agent' ); assert.equal( viaShell.channel, 'shell' ); assert.equal( viaShell.actor.id, 'copilot-cli:test' ); assert.equal( viaShell.declared, true );
	assert.equal( run( l, nameCmd( a, 'C' ) ).driver, 'agent' );
	assert.throws( () => l.setActor( { id: 'x', kind: 'robot' } ), /kind/ );

} );

await test( 'a promise result keeps the Shell context until it settles; the context does not leak', async () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 1 } );
	let release; const gate = new Promise( r => { release = r; } );
	const p = l.within( { channel: 'shell' }, async () => { await gate; return run( l, nameCmd( a, 'late' ) ); } );
	assert.equal( run( l, nameCmd( a, 'meanwhile' ) ).driver, 'shell', 'while the promise is pending the Shell still has the editor (documented limit)' );
	release(); const op = await p;
	assert.equal( op.driver, 'shell' );
	assert.equal( run( l, nameCmd( a, 'after' ) ).driver, 'gui' );

} );

await test( 'validateOpLog names an operation without a driver or an actor', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s } ); run( l, addCmd( a ) );
	assert.deepEqual( validateOpLog( l.toJSON() ), [] );
	const bad = l.toJSON(); delete bad.ops[ 0 ].driver; bad.ops[ 0 ].actor = null;
	assert.ok( validateOpLog( bad ).some( p => /driver/.test( p ) ) && validateOpLog( bad ).some( p => /actor/.test( p ) ) );
	assert.throws( () => attribute( bad, snapshotState( s ) ), /not usable/ );

} );

await test( 'what a command wrote: objects, triangles, and the properties', () => {

	const s = scene(), g = node( 'G', { parent: s }), m = node( 'M', { parent: g, tri: 40, classes: [ 'wheel' ] } );
	const d = describeCommand( addCmd( g ) );
	assert.equal( d.objects, 2 ); assert.equal( d.triangles, 40 );
	assert.ok( d.writes.some( w => w[ 0 ] === m.uuid && w[ 1 ] === 'class:wheel' && w[ 2 ] === true ) );
	const multi = describeCommand( cmd( 'MultiCmdsCommand', { cmdArray: [ classCmd( m, 'a' ), classCmd( m, 'b' ), cmd( 'CustomizeCommand', { object: m } ) ] } ) );
	assert.equal( multi.objects, 1 ); assert.deepEqual( multi.opaque, [ 'CustomizeCommand' ] );

} );

// ── A2 ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A2: last writer over the final state; undone and overwritten score zero' );

await test( 'an undone operation contributes nothing, and the value before it is the one attributed', () => {

	const l = log(), s = scene(), a = node( 'Old', { parent: s, tri: 12 } );
	l.setActor( agent ); run( l, addCmd( a ) );
	l.setActor( { id: 'user', kind: 'user' } );
	a.name = 'Mine'; const mine = run( l, nameCmd( a, 'Mine' ) );
	l.setActor( agent );
	a.name = 'Theirs'; const theirs = run( l, nameCmd( a, 'Theirs' ) );
	a.name = 'Mine'; l.recordHistory( 'undo', theirs.__cmd || { __opcid: theirs.cid, type: 'SetValueCommand' } );
	const r = attributeOf( l, s );
	assert.equal( prop( r, a.uuid, 'name' ).last.cid, mine.cid, 'the undone write is not the last writer' );
	assert.equal( r.ops.find( o => o.cid === theirs.cid ).fate, 'undone' );
	assert.equal( r.ops.find( o => o.cid === theirs.cid ).survived, 0 );

} );

await test( 'an overwritten operation scores zero for that property, a surviving one scores', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 5 } ); l.setActor( agent );
	run( l, addCmd( a ) );
	a.name = 'one'; const first = run( l, nameCmd( a, 'one' ) );
	a.name = 'two'; run( l, nameCmd( a, 'two' ) );
	const r = attributeOf( l, s );
	assert.equal( r.ops.find( o => o.cid === first.cid ).overwritten, 1 );
	assert.equal( prop( r, a.uuid, 'name' ).writes, 3, 'the chain holds the live writers: the add, then the two renames' );

} );

await test( 'redo restores an operation; a new operation after an undo discards the redo for good', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 5 } ); l.setActor( agent );
	const add = run( l, addCmd( a ) );
	const c1 = nameCmd( a, 'one' ); run( l, c1 ); l.recordHistory( 'undo', c1 ); l.recordHistory( 'redo', c1 );
	assert.ok( liveEntries( l.ops ).live.has( c1.__opcid ) );
	const c2 = nameCmd( a, 'two' ); run( l, c2 ); l.recordHistory( 'undo', c2 );
	const c3 = nameCmd( a, 'three' ); run( l, c3 );
	const e = liveEntries( l.ops );
	assert.equal( e.fate.get( c2.__opcid ), 'discarded' ); assert.ok( e.live.has( add.cid ) && e.live.has( c3.__opcid ) && ! e.live.has( c2.__opcid ) );
	l.note( 'reset' ); assert.equal( liveEntries( l.ops ).live.size, 0 );

} );

await test( 'clearing the history keeps what is in the scene (it can no longer be undone); File, New drops everything', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 5 } ); l.setActor( agent );
	const add = run( l, addCmd( a ) ); l.note( 'barrier' );
	assert.ok( liveEntries( l.ops ).live.has( add.cid ) );
	l.recordHistory( 'undo', { type: 'X', __opcid: add.cid } );
	assert.equal( liveEntries( l.ops ).anomalies.length, 1, 'past the barrier an undo cannot reach it' );
	l.note( 'reset' ); assert.equal( liveEntries( l.ops ).live.size, 0 ); assert.equal( liveEntries( l.ops ).fate.get( add.cid ), 'reset' );

} );

await test( 'an agent context around a Shell execution gives the agent, the Shell channel and the pass number', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 1 } );
	const op = l.within( { actor: { id: 'strata-ai:test', kind: 'agent' } }, () => l.runShell( 'tagClass(a, "x")', () => run( l, classCmd( a, 'x' ) ) ) );
	assert.equal( op.driver, 'agent' ); assert.equal( op.channel, 'shell' ); assert.equal( op.exec, 1 ); assert.equal( op.actor.id, 'strata-ai:test' );
	assert.equal( l.ops[ 0 ].verb, 'exec' ); assert.match( l.ops[ 0 ].src, /tagClass/ );
	assert.equal( l.runShell( 'x', () => run( l, classCmd( a, 'y' ) ) ).exec, 2 );

} );

await test( 'an undo that matches nothing is reported, not guessed', () => {

	const l = log(); l.recordHistory( 'undo', { type: 'X' } );
	assert.equal( liveEntries( l.ops ).anomalies.length, 1 );

} );

// ── A3 ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A3: the rig pass: 143 nodes survive, 9 do not' );

await test( 'one Shell line tags 152 nodes, a second removes the 9 that were tagged by mistake', () => {

	const l = log(), s = scene(); l.setActor( agent );
	const rig = Array.from( { length: 143 }, ( _, i ) => node( 'Rig_Node_' + i, { parent: s } ) );
	const groups = Array.from( { length: 9 }, ( _, i ) => node( 'Part_Group_' + i, { parent: s, tri: 100 + i } ) );
	for ( const n of [ ...rig, ...groups ] ) run( l, addCmd( n ) );
	l.note( 'exec', { exec: 7, src: "scene.traverse(n => tagClass(n, 'rig'))" } );
	l.within( { channel: 'shell', exec: 7 }, () => { for ( const n of [ ...rig, ...groups ] ) { n.userData.customClasses.add( 'rig' ); run( l, classCmd( n, 'rig' ) ); } } );
	l.note( 'exec', { exec: 8, src: "$S('.segmented').each(n => untagClass(n, 'rig'))" } );
	l.within( { channel: 'shell', exec: 8 }, () => { for ( const n of groups ) { n.userData.customClasses.delete( 'rig' ); run( l, classCmd( n, 'rig', false ) ); } } );
	const r = attributeOf( l, s );

	const pass1 = r.execs.find( e => e.exec === 7 ), pass2 = r.execs.find( e => e.exec === 8 );
	assert.equal( pass1.ops, 152 ); assert.equal( pass1.writes, 152 );
	assert.equal( pass1.survived, 143, 'the 143 correct tags survive' ); assert.equal( pass1.overwritten, 9, 'the 9 wrong tags do not' );
	assert.equal( pass2.survived, 9, 'the corrections stand' ); assert.equal( pass1.src.slice( 0, 14 ), 'scene.traverse' );
	assert.equal( rig.filter( n => prop( r, n.uuid, 'class:rig' ) && prop( r, n.uuid, 'class:rig' ).category === 'agent-authored' ).length, 143 );
	assert.ok( groups.every( n => ! prop( r, n.uuid, 'class:rig' ) ), 'a class that is not on the final object is not attributed' );

	// a count of operations calls this 161 agent operations and gets the work wrong in both directions
	assert.equal( r.summary.naive.operations.agent, 152 + 9 + 152 );
	assert.equal( r.summary.coverage.live, 152 + 9 + 152, 'every one of them is live: the 9 wrong tags were not undone, they were overwritten' );
	assert.equal( r.summary.coverage.unlogged_properties, 0 );

} );

// ── A5 / D ──────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A5: three categories, with the originating and the last-modifying operation' );

await test( 'agent-authored, human-authored, and agent-originated-human-refined, each with both ends of the chain', () => {

	const l = log(), s = scene();
	const a = node( 'a', { parent: s, tri: 10 } ), b = node( 'b', { parent: s, tri: 10 } ), c = node( 'c', { parent: s, tri: 10 } );
	l.setActor( agent ); run( l, addCmd( a ) ); run( l, addCmd( b ) );
	l.setActor( { id: 'user', kind: 'user' } ); run( l, addCmd( c ) );
	// b is renamed by the agent, then adjusted by a person; c is renamed by the person
	l.setActor( agent ); b.name = 'b1'; run( l, nameCmd( b, 'b1' ) );
	l.setActor( { id: 'tej', kind: 'user' } ); b.name = 'b2'; const fix = run( l, nameCmd( b, 'b2' ) );
	c.name = 'c1'; run( l, nameCmd( c, 'c1' ) );
	const r = attributeOf( l, s );
	assert.equal( prop( r, a.uuid, 'name' ).category, 'agent-authored' );
	assert.equal( prop( r, c.uuid, 'name' ).category, 'human-authored' );
	const refined = prop( r, b.uuid, 'name' );
	assert.equal( refined.category, 'agent-originated-human-refined' );
	assert.equal( refined.originating.driver, 'agent' ); assert.equal( refined.last.driver, 'gui' ); assert.equal( refined.last.actor, 'tej' ); assert.equal( refined.last.cid, fix.cid );
	assert.ok( refined.originating.seq < refined.last.seq );

} );

await test( 'the reverse is not folded into either: human-originated, agent-refined', () => {

	const chain = ( ...drivers ) => drivers.map( ( d, i ) => ( { driver: d, seq: i, origin: undefined } ) );
	assert.equal( categoryOf( chain( 'gui', 'agent' ) ).category, 'human-originated-agent-refined' );
	assert.equal( categoryOf( chain( 'agent', 'gui', 'agent' ) ).category, 'agent-authored' );
	assert.equal( categoryOf( chain( 'agent', 'gui', 'agent' ) ).interleaved, true );
	assert.equal( categoryOf( chain( 'shell', 'gui' ) ).category, 'human-authored' );
	assert.equal( categoryOf( [] ).category, 'baseline' );

} );

await test( 'what an import wrote is the source\'s, not a decision; a later rename is the namer\'s', () => {

	const l = log(), s = scene(), a = node( 'Object649_normal_0', { parent: s, tri: 50 } ), b = node( 'Object650', { parent: s, tri: 50 } ); l.setActor( agent );
	l.withOrigin( { kind: 'import', file: 'LittlestTokyo.glb' }, () => { run( l, addCmd( a ) ); run( l, addCmd( b ) ); } );
	a.name = 'Tram_Body'; run( l, nameCmd( a, 'Tram_Body' ) );
	const r = attributeOf( l, s );
	assert.equal( prop( r, a.uuid, 'name' ).category, 'agent-authored', 'the import wrote the name first; the rename is the decision' );
	assert.equal( prop( r, a.uuid, 'name' ).writes, 2 );
	assert.equal( prop( r, b.uuid, 'name' ).category, 'source' ); assert.equal( prop( r, b.uuid, 'exists' ).category, 'source' );
	assert.equal( prop( r, b.uuid, 'position' ), undefined, 'a default transform is not a decision, so it is not attributed to anyone' );

} );

await test( 'a property nobody in the log set is baseline; one changed outside the history is unlogged and is credited to no one', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 10 } ), b = node( 'B', { parent: s, tri: 10 } ); l.setActor( agent );
	run( l, addCmd( b ) );
	b.name = 'Renamed directly, outside the history';
	const r = attributeOf( l, s );
	assert.equal( prop( r, a.uuid, 'name' ).category, 'baseline' );
	const u = prop( r, b.uuid, 'name' );
	assert.equal( u.category, 'unlogged' ); assert.equal( u.logged_value, 'B' ); assert.equal( u.final_value, 'Renamed directly, outside the history' );
	assert.ok( r.summary.coverage.unlogged_properties >= 1 );
	assert.ok( r.summary.categories.unlogged.properties >= 1 );

} );

await test( 'a class the log says is there and the state says is not is a discrepancy', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 3 } ); l.setActor( agent );
	run( l, addCmd( a ) ); a.userData.customClasses.add( 'x' ); run( l, classCmd( a, 'x' ) ); a.userData.customClasses.delete( 'x' );
	const r = attributeOf( l, s );
	assert.equal( r.discrepancies.length, 1 ); assert.match( r.discrepancies[ 0 ].what, /outside the log/ );

} );

console.log( 'witnessing: what Shell code changes with no command' );

await test( 'a rename by direct assignment in a Shell line is witnessed, and credited to whoever drove the line', () => {

	const l = log(), s = scene(), a = node( 'Object649_normal_0', { parent: s, tri: 30 } ), b = node( 'Object650', { parent: s, tri: 70 } );
	l.witness = () => flatState( s ); l.setActor( agent );
	l.withOrigin( { kind: 'import', file: 'x.glb' }, () => { run( l, addCmd( a ) ); run( l, addCmd( b ) ); } );
	l.runShell( "scene.children.forEach(o => o.name = 'Named_' + o.name)", () => { a.name = 'Named_A'; b.name = 'Named_B'; } );
	const w = l.ops.find( o => o.witnessed );
	assert.equal( w.driver, 'agent' ); assert.equal( w.channel, 'shell' ); assert.equal( w.touched.objects, 2 ); assert.equal( w.touched.triangles, 100 ); assert.equal( w.w.length, 2 );
	const r = attributeOf( l, s );
	assert.equal( prop( r, a.uuid, 'name' ).category, 'agent-authored', 'not unlogged: the Shell line was seen to do it' );
	assert.equal( r.summary.coverage.unlogged_properties, 0 ); assert.equal( r.summary.witnessed.operations, 1 );
	assert.equal( r.ops.find( o => o.witnessed ).survived, 2 );

} );

await test( 'a change a command already recorded is not witnessed a second time, so undoing the command still undoes it', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 5 } ); l.witness = () => flatState( s ); l.setActor( agent ); run( l, addCmd( a ) );
	const c = classCmd( a, 'x' );
	l.runShell( "tagClass(a, 'x')", () => { a.userData.customClasses.add( 'x' ); run( l, c ); } );
	assert.equal( l.ops.filter( o => o.witnessed ).length, 0, 'the command explains the change' );
	a.userData.customClasses.delete( 'x' ); l.recordHistory( 'undo', c );
	const r = attributeOf( l, s );
	assert.ok( ! prop( r, a.uuid, 'class:x' ) && r.summary.coverage.unlogged_properties === 0 );

} );

await test( 'a direct change outside any Shell line is still unlogged; a witnessed one can be refined by a person', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 5 } ), b = node( 'B', { parent: s, tri: 5 } ); l.witness = () => flatState( s ); l.setActor( agent );
	run( l, addCmd( a ) ); run( l, addCmd( b ) );
	l.runShell( 'a.name = "A1"', () => { a.name = 'A1'; } );
	b.name = 'B_outside';                                   // not in a Shell line, not a command
	l.setActor( { id: 'tej', kind: 'user' } ); a.name = 'A2'; run( l, nameCmd( a, 'A2' ) );
	const r = attributeOf( l, s );
	assert.equal( prop( r, b.uuid, 'name' ).category, 'unlogged' );
	assert.equal( prop( r, a.uuid, 'name' ).category, 'agent-originated-human-refined' );
	assert.equal( prop( r, a.uuid, 'name' ).writes, 3, 'the add, the witnessed rename, the person\'s rename' );
	assert.ok( r.ops.find( o => o.witnessed ).overwritten === 1, 'the witnessed rename was refined, so it no longer survives' );

} );

await test( 'a promise-returning Shell line is witnessed when it settles; a new object added directly is seen with its properties', async () => {

	const l = log(), s = scene(); l.witness = () => flatState( s ); l.setActor( agent );
	await l.runShell( 'await add()', async () => { await null; const n = node( 'Added', { parent: s, tri: 12 } ); n.userData.customClasses.add( 'prop' ); } );
	const w = l.ops.find( o => o.witnessed );
	assert.ok( w.w.some( x => x[ 1 ] === 'exists' && x[ 2 ] === true ) && w.w.some( x => x[ 1 ] === 'class:prop' ) && w.touched.triangles === 12 );
	assert.equal( diffState( new Map(), flatState( s ) ).writes.some( x => x[ 1 ] === 'name' ), true );

} );

// ── A4 ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A4: weighted and unweighted, the weighted as the headline' );

await test( 'a hundred small agent edits and one person\'s edit of the big mesh: the counts say agent, the weights say human', () => {

	const l = log(), s = scene();
	const big = node( 'Big', { parent: s, tri: 100000 } );
	const smalls = Array.from( { length: 100 }, ( _, i ) => node( 's' + i, { parent: s, tri: 1 } ) );
	l.setActor( agent ); for ( const n of [ big, ...smalls ] ) run( l, addCmd( n ) );
	for ( const n of smalls ) { n.name = 'renamed ' + n.name; run( l, nameCmd( n, n.name ) ); }
	l.setActor( { id: 'user', kind: 'user' } );
	big.name = 'Terrain'; run( l, nameCmd( big, 'Terrain' ) ); big.userData.customClasses.add( 'ground' ); run( l, classCmd( big, 'ground' ) );
	const r = attributeOf( l, s );
	const c = r.summary.categories;
	assert.ok( r.summary.unweighted[ 'agent-authored' ] > 0.9, 'by count the agent did nearly everything' );
	assert.ok( r.summary.headline.shares[ 'human-authored' ] < 0.5 );
	assert.equal( r.summary.headline.weight, 'triangles' );
	assert.ok( Math.abs( Object.values( c ).reduce( ( t, x ) => t + x.triangles, 0 ) - 100100 ) < 1e-3, 'the triangle-weighted categories add to the model' );
	assert.ok( r.summary.headline.shares[ 'human-authored' ] + c[ 'agent-originated-human-refined' ].triangles_share > 0.4, 'the big mesh\'s name and class, a person\'s, weigh what the mesh weighs' );
	assert.ok( Math.abs( r.summary.categories[ 'agent-authored' ].objects + r.summary.categories[ 'agent-originated-human-refined' ].objects + r.summary.categories[ 'human-authored' ].objects + r.summary.categories.baseline.objects + r.summary.categories.source.objects + r.summary.categories.unlogged.objects - 101 ) < 1e-6, 'and the objects add to the objects' );

} );

await test( 'timeline work is weighted by seconds', () => {

	const l = log(), s = scene();
	const tl = ( events ) => ( { tracks: [ { target: 'cam', events } ] } );
	const ev = ( id, at, dur ) => ( { id, at, op: 'move', args: { x: at }, dur } );
	l.setActor( agent );
	const prev = tl( [] ), next = tl( [ ev( 'e1', 0, 2 ), ev( 'e2', 3, 8 ) ] );
	run( l, cmd( 'SetTimelineCommand', { prevJSON: prev, nextJSON: next } ) );
	l.setActor( { id: 'user', kind: 'user' } );
	const next2 = tl( [ ev( 'e1', 0, 2 ), ev( 'e2', 3, 5 ) ] );
	run( l, cmd( 'SetTimelineCommand', { prevJSON: next, nextJSON: next2 } ) );
	const r = attribute( l.toJSON(), snapshotState( s, { timeline: next2 } ) );
	assert.equal( r.summary.totals.seconds, 7 );
	assert.equal( r.summary.categories[ 'agent-authored' ].seconds, 2 ); assert.equal( r.summary.categories[ 'agent-originated-human-refined' ].seconds, 5 );
	assert.equal( l.ops[ 0 ].touched.seconds, 10 ); assert.equal( l.ops[ 1 ].touched.seconds, 8 );

} );

await test( 'a log in which nobody but the agent acted says so: the interesting condition was not exercised', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 4 } ); l.setActor( agent ); l.within( { channel: 'shell' }, () => run( l, addCmd( a ) ) );
	const r = attributeOf( l, s );
	assert.match( r.summary.degenerate, /100% agent/ ); assert.equal( r.summary.headline.shares[ 'agent-authored' ] + r.summary.headline.shares.baseline, 1 );

} );

// ── A6 ──────────────────────────────────────────────────────────────────────────────────────────────────────

console.log( 'A6: the record is a separate artifact from the scene' );

await test( 'the log and the state carry no scene, and survive a round trip on their own', () => {

	const l = log(), s = scene(), a = node( 'A', { parent: s, tri: 4 } ); l.setActor( agent ); run( l, addCmd( a ) );
	const json = JSON.parse( JSON.stringify( l.toJSON() ) );
	assert.equal( json.schema, OPLOG_SCHEMA ); assert.deepEqual( Object.keys( json ).sort(), [ 'ops', 'schema', 'session' ] );
	assert.ok( ! JSON.stringify( json ).includes( '"geometries"' ) );
	const again = OpLog.fromJSON( json ); again.setActor( agent ); run( again, nameCmd( a, 'B' ) ); assert.equal( again.ops.length, 2 ); assert.equal( again.ops[ 1 ].seq, 2 );
	assert.equal( snapshotState( s ).schema, STATE_SCHEMA ); assert.deepEqual( CATEGORIES.slice( 0, 2 ), [ 'agent-authored', 'human-authored' ] );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
