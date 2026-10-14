// Run: node docs/editor/js/intelligence/__tests__/cameraMove.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const M = await import( path.join( here, '..', 'cameraMove.js' ) );
const { expandSplineEvents, cameraKeys } = await import( path.join( here, '..', 'splineTrack.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}
const clone = o => JSON.parse( JSON.stringify( o ) );
const ev = ( id, at, dur, position, lookAt, fov ) => ( { id, at, dur, op: 'animate', args: { easing: 'linear', duration: dur, props: { to: { position }, ...( lookAt ? { lookAt } : {} ), ...( fov ? { fov } : {} ) } } } );
const base = () => ( { target: '#cam', events: [
	ev( 'a', 0, 0.001, [ 0, 1, 0 ], [ 0, 1, 5 ], 40 ),
	ev( 'b', 2, 3, [ 3, 1, 0 ], [ 0, 1, 5 ], 40 ),
	ev( 'c', 5, 5, [ 3, 2, 4 ], '#maya', 30 ),
] } );

console.log( 'cameraMove' );

test( 'keyList is sorted, 0-based, labelled like the viewport', () => {

	const l = M.keyList( base() );
	assert.deepStrictEqual( l.map( k => k.index ), [ 0, 1, 2 ] );
	assert.deepStrictEqual( l.map( k => k.time ), [ 0.001, 5, 10 ] );
	assert.strictEqual( l[ 2 ].label, 'key 3/3 · 10.00s' );
	assert.strictEqual( l[ 2 ].lookAt, '#maya' );

} );

test( 'moveKey in place leaves every other event byte-identical', () => {

	const t = base(), before = clone( t.events );
	M.moveKey( t, 1, { pos: [ 9, 9, 9 ] } );
	assert.deepStrictEqual( t.events[ 0 ], before[ 0 ] );
	assert.deepStrictEqual( t.events[ 2 ], before[ 2 ] );
	assert.deepStrictEqual( t.events[ 1 ].args.props.to.position, [ 9, 9, 9 ] );
	assert.strictEqual( t.events[ 1 ].at, 2 );

} );

test( 'moveKey can clear lookAt / fov with null and keeps a named lookAt', () => {

	const t = base();
	M.moveKey( t, 0, { lookAt: null, fov: null } );
	assert.strictEqual( M.keyList( t )[ 0 ].lookAt, null );
	assert.strictEqual( M.keyList( t )[ 0 ].fov, null );
	M.moveKey( t, 1, { lookAt: '#nico' } );
	assert.strictEqual( M.keyList( t )[ 1 ].lookAt, '#nico' );

} );

test( 'moveKey time re-times the legs on both sides (tied legs stay tied)', () => {

	const t = { target: '#c', events: [ ev( 'a', 0, 0.001, [ 0, 0, 0 ] ), ev( 'b', 0.001, 3.999, [ 1, 0, 0 ] ), ev( 'c', 4.001, 4, [ 2, 0, 0 ] ) ] };
	M.moveKey( t, 1, { time: 6 } );
	const k = M.keyList( t );
	assert.deepStrictEqual( k.map( x => x.time ), [ 0.001, 6, 8.001 ] );
	const c = t.events.find( e => e.id === 'c' );
	assert.ok( Math.abs( c.at - 6.001 ) < 1e-9 && Math.abs( c.at + c.dur - 8.001 ) < 1e-9 );

} );

test( 'moving a key past its neighbour reorders; the index follows', () => {

	const t = base();
	const i = M.moveKey( t, 0, { time: 7 } );
	assert.strictEqual( i, 1 );
	assert.deepStrictEqual( M.keyList( t ).map( k => k.time ), [ 5, 7, 10 ] );

} );

test( 'moveKey refuses to land on another key, and bad indices / values throw', () => {

	assert.throws( () => M.moveKey( base(), 0, { time: 5 } ), /share the time/ );
	assert.throws( () => M.moveKey( base(), 7, { pos: [ 0, 0, 0 ] } ), /no key 7/ );
	assert.throws( () => M.moveKey( base(), 0, { pos: [ 0, 0 ] } ), /pos must be/ );
	assert.throws( () => M.moveKey( base(), 0, { fov: 400 } ), /fov must be/ );

} );

test( 'keyAt adds a key, filling aim and fov from the path; merges when a key is already there', () => {

	const t = { target: '#c', events: base().events };
	const i = M.upsertKey( t, { time: 3.5, pos: [ 3, 1, 1 ] } );
	assert.strictEqual( i, 1 );
	const k = M.keyList( t );
	assert.strictEqual( k.length, 4 );
	assert.deepStrictEqual( k[ 1 ].lookAt, [ 0, 1, 5 ] );
	assert.strictEqual( k[ 1 ].fov, 40 );
	const j = M.upsertKey( t, { time: 3.5, fov: 55 } );
	assert.strictEqual( j, 1 );
	assert.strictEqual( M.keyList( t ).length, 4 );
	assert.strictEqual( M.keyList( t )[ 1 ].fov, 55 );
	assert.deepStrictEqual( M.keyList( t )[ 1 ].pos, [ 3, 1, 1 ] );

} );

test( 'keyAt with no pos on a camera that has no keys is an error; with keys it uses the path', () => {

	assert.throws( () => M.upsertKey( { target: '#c', events: [] }, { time: 1 } ), /needs a pos/ );
	const t = base();
	M.upsertKey( t, { time: 3.5 } );
	assert.strictEqual( M.keyList( t ).length, 4 );

} );

test( 'keyAt on an empty track creates the first key as a snap leg', () => {

	const t = { target: '#c', events: [] };
	M.upsertKey( t, { time: 2, pos: [ 1, 2, 3 ], lookAt: [ 0, 0, 0 ], fov: 35 } );
	assert.strictEqual( t.events.length, 1 );
	assert.ok( Math.abs( t.events[ 0 ].at + t.events[ 0 ].dur - 2 ) < 1e-9 );
	assert.ok( t.events[ 0 ].dur <= 0.0015 );

} );

test( 'deleteKey removes and re-ties the next leg; refuses to empty the track', () => {

	const t = { target: '#c', events: [ ev( 'a', 0, 0.001, [ 0, 0, 0 ] ), ev( 'b', 0.001, 3.999, [ 1, 0, 0 ] ), ev( 'c', 4.001, 4, [ 2, 0, 0 ] ) ] };
	M.deleteKey( t, 1 );
	assert.deepStrictEqual( M.keyList( t ).map( k => k.time ), [ 0.001, 8.001 ] );
	const c = t.events.find( e => e.id === 'c' );
	assert.ok( Math.abs( c.at - 0.002 ) < 1e-9, 'c now starts after key a: ' + c.at );
	M.deleteKey( t, 0 );
	assert.strictEqual( M.keyList( t ).length, 1 );
	assert.throws( () => M.deleteKey( t, 0 ), /at least one key/ );
	assert.strictEqual( M.keyList( t ).length, 1 );

} );

test( 'deleting the first key makes the next a snap start', () => {

	const t = { target: '#c', events: [ ev( 'a', 0, 0.001, [ 0, 0, 0 ] ), ev( 'b', 0.001, 3.999, [ 1, 0, 0 ] ) ] };
	M.deleteKey( t, 0 );
	assert.ok( t.events[ 0 ].dur <= 0.0015 );
	assert.ok( Math.abs( t.events[ 0 ].at + t.events[ 0 ].dur - 4 ) < 1e-9 );

} );

test( 'non-key events on the track survive every op', () => {

	const t = base();
	t.events.push( { id: 'f', at: 1, op: 'animate', args: { props: { fov: 20 }, duration: 1 }, dur: 1 } );
	M.upsertKey( t, { time: 3, pos: [ 1, 1, 1 ] } );
	M.deleteKey( t, 0 );
	M.moveKey( t, 0, { time: 4 } );
	assert.ok( t.events.some( e => e.id === 'f' ) );

} );

test( 'setSmooth toggles spline', () => {

	const t = base();
	M.setSmooth( t, true ); assert.strictEqual( t.spline, true );
	M.setSmooth( t, false ); assert.ok( ! ( 'spline' in t ) );

} );

test( 'simplify matches the GUI button: dense run -> few keys, smooth on', () => {

	const events = [];
	for ( let i = 0; i <= 60; i ++ ) events.push( ev( 'd' + i, i === 0 ? 0 : ( i - 1 ) * 0.1 + 0.001, i === 0 ? 0.001 : 0.099, [ i * 0.1, 0, 0 ], [ 0, 0, 5 ], 40 ) );
	const t = { target: '#c', events };
	const r = M.simplifyTrack( t );
	assert.ok( r.changed && r.after < r.before && r.after >= 2 );
	assert.strictEqual( t.spline, true );
	assert.strictEqual( M.simplifyTrack( { target: '#c', events: base().events } ).changed, false );

} );

test( 'asCommand round-trips: re-running setKeys reproduces the keys and smooth flag', () => {

	const t = base();
	t.spline = true;
	const cmd = M.toCommand( t, '#cam' );
	assert.ok( cmd.startsWith( "$S('#cam').setKeys([" ), cmd );
	const specs = [ new Function( 'return ' + cmd.slice( cmd.indexOf( '([' ) + 1, cmd.lastIndexOf( '], {' ) + 1 ) )() ];
	const opts = /smooth: (true|false)/.exec( cmd )[ 1 ] === 'true';
	const fresh = { target: '#cam', events: [ ev( 'zz', 0, 1, [ 9, 9, 9 ] ) ] };
	M.setKeys( fresh, specs[ 0 ], { smooth: opts } );
	assert.deepStrictEqual( M.keyList( fresh ).map( ( { id, label, ...k } ) => k ), M.keyList( t ).map( ( { id, label, ...k } ) => k ) );
	assert.strictEqual( fresh.spline, true );
	assert.strictEqual( M.toCommand( fresh, '#cam' ), cmd );

} );

test( 'determinism: the same ops give the same events and the same baked legs', () => {

	const run = () => {

		const t = { target: '#c', events: [] };
		M.upsertKey( t, { time: 0, pos: [ 0, 1, 0 ], lookAt: '#maya', fov: 35 } );
		M.upsertKey( t, { time: 4, pos: [ 2, 1, 2 ], lookAt: '#maya', fov: 30 } );
		M.upsertKey( t, { time: 9, pos: [ 5, 2, 1 ], lookAt: [ 1, 1, 1 ], fov: 28 } );
		M.moveKey( t, 1, { pos: [ 2, 1.5, 2 ] } );
		M.setSmooth( t, true );
		return t;

	};
	const a = run(), b = run();
	assert.strictEqual( JSON.stringify( a ), JSON.stringify( b ) );
	assert.strictEqual( JSON.stringify( expandSplineEvents( a.events ) ), JSON.stringify( expandSplineEvents( b.events ) ) );
	assert.strictEqual( cameraKeys( a.events ).length, 3 );

} );

test( 'setKeys needs >= 1 key and rejects duplicate times', () => {

	assert.throws( () => M.setKeys( { target: '#c', events: [] }, [] ), /non-empty/ );
	assert.throws( () => M.setKeys( { target: '#c', events: [] }, [ { t: 1, pos: [ 0, 0, 0 ] }, { t: 1, pos: [ 1, 0, 0 ] } ] ), /share the time/ );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
