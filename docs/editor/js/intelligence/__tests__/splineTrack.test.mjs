// Run: node docs/editor/js/intelligence/__tests__/splineTrack.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { cameraKeys, makeCurve, expandSplineEvents, samplePath, simplifyKeys, eventsFromKeys } = await import( path.join( here, '..', 'splineTrack.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}
const ev = ( id, at, dur, position, lookAt, fov ) => ( { id, at, dur, op: 'animate', args: { easing: 'linear', duration: dur, props: { to: { position }, ...( lookAt ? { lookAt } : {} ), ...( fov ? { fov } : {} ) } } } );
const near = ( a, b, eps = 1e-6 ) => Math.abs( a - b ) <= eps;

const events = [
	ev( 'a', 0, 0.001, [ 0, 0, 0 ], [ 0, 0, 5 ], 40 ),
	ev( 'b', 0.001, 1.999, [ 2, 1, 0 ], [ 1, 0, 5 ], 36 ),
	ev( 'c', 2.0, 2.0, [ 4, 0, 2 ], [ 2, 0, 5 ], 30 ),
	{ id: 'x', at: 1, dur: 1, op: 'fadeIn', args: {} },
];

console.log( 'keys' );
test( 'keys are animate events with a position, sorted by arrival', () => {

	const k = cameraKeys( [ events[ 2 ], events[ 0 ], events[ 3 ], events[ 1 ] ] );
	assert.deepStrictEqual( k.map( x => x.id ), [ 'a', 'b', 'c' ] );
	assert.strictEqual( k[ 2 ].time, 4 );
	assert.deepStrictEqual( k[ 1 ].lookAt, [ 1, 0, 5 ] );

} );

console.log( 'curve' );
test( 'passes through every key at its time', () => {

	const c = makeCurve( cameraKeys( events ) );
	for ( const k of cameraKeys( events ) ) {

		const s = c.at( k.time );
		k.position.forEach( ( v, d ) => assert.ok( near( s.position[ d ], v ), 'position ' + k.id ) );
		assert.ok( near( s.fov, k.fov ), 'fov ' + k.id );

	}

} );
test( 'holds the first key before it and the last key after it', () => {

	const c = makeCurve( cameraKeys( events ) );
	assert.deepStrictEqual( c.at( - 5 ).position, [ 0, 0, 0 ] );
	assert.deepStrictEqual( c.at( 99 ).position, [ 4, 0, 2 ] );

} );
test( 'starts and ends at rest', () => {

	const c = makeCurve( cameraKeys( events ) );
	const v = ( t ) => { const a = c.at( t ).position, b = c.at( t + 1e-4 ).position; return Math.hypot( ...a.map( ( x, i ) => ( b[ i ] - x ) / 1e-4 ) ); };
	assert.ok( v( c.start ) < 0.05 );
	assert.ok( v( c.end - 1e-4 ) < 0.05 );

} );
test( 'speed has no jump across a key', () => {

	const c = makeCurve( cameraKeys( events ) );
	const sp = t => { const a = c.at( t ).position, b = c.at( t + 1e-3 ).position; return Math.hypot( ...a.map( ( x, i ) => ( b[ i ] - x ) / 1e-3 ) ); };
	assert.ok( Math.abs( sp( 2 - 2e-3 ) - sp( 2 + 2e-3 ) ) < 0.02 );

} );
test( 'a named look-at target is carried, not curved', () => {

	const c = makeCurve( cameraKeys( [ ev( 'a', 0, 0.001, [ 0, 0, 0 ], '#maya' ), ev( 'b', 0.001, 1, [ 1, 0, 0 ], '#maya' ) ] ) );
	assert.strictEqual( c.at( 0.5 ).lookAt, '#maya' );

} );

console.log( 'expand' );
test( 'expands to dense linear legs that follow the curve', () => {

	const out = expandSplineEvents( events, 0.1 );
	assert.ok( out.length > 35 );
	const c = makeCurve( cameraKeys( events ) );
	for ( const e of out.filter( e => e.op === 'animate' ) ) {

		const t = e.at + e.dur;
		const s = c.at( t );
		assert.ok( near( e.args.props.to.position[ 0 ], s.position[ 0 ], 1e-3 ) );

	}

} );
test( 'non-key events pass through and times stay ordered', () => {

	const out = expandSplineEvents( events, 0.1 );
	assert.ok( out.some( e => e.id === 'x' ) );
	for ( let i = 1; i < out.length; i ++ ) assert.ok( out[ i ].at >= out[ i - 1 ].at );

} );
test( 'one key, or none, is left alone', () => {

	assert.strictEqual( expandSplineEvents( [ events[ 0 ] ] ).length, 1 );
	assert.strictEqual( expandSplineEvents( [] ).length, 0 );

} );

console.log( 'path + simplify' );
test( 'samplePath: key polyline when linear, curve when spline', () => {

	assert.strictEqual( samplePath( events, false ).length, 3 );
	assert.ok( samplePath( events, true ).length > 8 );

} );
test( 'simplify a dense path down to few keys that reproduce it', () => {

	const dense = events.length ? expandSplineEvents( events.filter( e => e.op === 'animate' ), 0.1 ) : [];
	const keys = cameraKeys( dense );
	const picked = simplifyKeys( keys, { tolerance: 0.01, maxKeys: 24 } );
	assert.ok( picked.length < keys.length / 2 && picked.length >= 2, 'picked ' + picked.length + ' of ' + keys.length );
	const rebuilt = eventsFromKeys( keys, picked );
	const c = makeCurve( cameraKeys( rebuilt ) );
	for ( const k of keys ) {

		const s = c.at( k.time ).position;
		assert.ok( Math.hypot( ...s.map( ( v, i ) => v - k.position[ i ] ) ) < 0.03 );

	}
	assert.strictEqual( cameraKeys( rebuilt ).length, picked.length );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
