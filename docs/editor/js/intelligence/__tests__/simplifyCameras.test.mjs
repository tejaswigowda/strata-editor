// Run: node docs/editor/js/intelligence/__tests__/simplifyCameras.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const M = await import( path.join( here, '..', 'cameraMove.js' ) );
const S = await import( path.join( here, '..', 'splineTrack.js' ) );
const T = await import( path.join( here, '..', 'cameraTracks.js' ) );
const { TimelineModel } = await import( path.join( here, '..', 'timeline.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}
const clone = o => JSON.parse( JSON.stringify( o ) );
const ev = ( id, at, dur, position, lookAt, fov ) => ( { id, at, dur, op: 'animate', args: { easing: 'linear', duration: dur, props: { to: { position }, ...( lookAt ? { lookAt } : {} ), ...( fov ? { fov } : {} ) } } } );
const smooth = u => u * u * ( 3 - 2 * u );
const AIM = [ 0, 1, 0 ];

/** A baked move, a key every 0.1 s: ease across the first half, hold, then push in to the callcard and settle back a little (the closest key is interior). */
function dense( n = 195, { withFov = true, pushBack = 0.4 } = {} ) {

	const events = [], times = [];
	for ( let i = 0; i < n; i ++ ) {

		const u = i / ( n - 1 );
		const x = - 2 + 4 * smooth( Math.min( 1, u / 0.5 ) );
		const push = u < 0.8 ? 0 : smooth( Math.min( 1, ( u - 0.8 ) / 0.18 ) );
		const z = 8 - 5 * push + ( u > 0.98 ? pushBack * ( u - 0.98 ) / 0.02 : 0 );
		const time = Math.round( i * 0.1 * 1000 ) / 1000;
		times.push( time );
		const at = i === 0 ? 0 : times[ i - 1 ] + 0.001;
		events.push( ev( 'd' + i, at, Math.max( 0.001, time - at ), [ x, 1.5 + 0.2 * Math.sin( u * 3 ), z ], AIM, withFov ? 40 - 6 * push : undefined ) );

	}
	return { target: '#cam11', events };

}
const keysOf = t => S.cameraKeys( t.events );
const distAim = k => Math.hypot( ...k.position.map( ( v, i ) => v - AIM[ i ] ) );
const timesOf = t => keysOf( t ).map( k => k.time );
const closestOf = keys => keys.reduce( ( a, k ) => distAim( k ) < distAim( a ) ? k : a );

console.log( 'simplify tolerances' );

test( 'no options = the original behaviour: tolerance 0.01, 20 keys max', () => {

	const o = M.simplifyOptions();
	assert.deepStrictEqual( [ o.tolerance, o.maxKeys, o.keepBeats, o.rotation, o.fov ], [ 0.01, 20, false, undefined, undefined ] );
	const r = M.simplifyTrack( dense() );
	assert.ok( r.changed && r.after <= 20 && r.after >= 2, JSON.stringify( r ) );

} );

test( 'looser tolerance keeps fewer keys than tighter', () => {

	const n = p => M.previewSimplify( dense(), { preset: p } ).after;
	const tight = n( 'tight' ), normal = n( 'normal' ), loose = n( 'loose' );
	assert.ok( tight >= normal && normal >= loose && tight > loose, [ tight, normal, loose ].join( ' ' ) );
	assert.ok( loose <= 12 );

} );

test( 'explicit fields win over the preset; numbers and bad input', () => {

	assert.strictEqual( M.simplifyOptions( { preset: 'loose', tolerance: 0.2 } ).tolerance, 0.2 );
	assert.strictEqual( M.simplifyOptions( { preset: 'loose', tolerance: 0.2 } ).rotation, 2 );
	assert.strictEqual( M.simplifyOptions( 0.3 ).tolerance, 0.3 );
	assert.throws( () => M.simplifyOptions( 'sloppy' ), /preset/ );
	assert.throws( () => M.simplifyOptions( { tolerance: - 1 } ), /non-negative/ );

} );

test( 'rotation tolerance (degrees of aim) drives the key count', () => {

	// a stationary camera whose aim point sweeps: only the rotation tolerance can see it
	const events = [];
	for ( let i = 0; i < 60; i ++ ) events.push( ev( 'r' + i, i === 0 ? 0 : i * 0.1 - 0.099, i === 0 ? 0.001 : 0.099, [ 0, 1, 10 ], [ 10 * Math.sin( i * 0.01 ), 1, 10 - 10 * Math.cos( i * 0.01 ) ], 40 ) );
	const track = { target: '#r', events };
	const fine = M.previewSimplify( track, { tolerance: 1, rotation: 0.1, maxKeys: 60 } ).after;
	const coarse = M.previewSimplify( track, { tolerance: 1, rotation: 45, maxKeys: 60 } ).after;
	assert.ok( fine > coarse, fine + ' vs ' + coarse );
	assert.strictEqual( coarse, 2 );

} );

test( 'fov tolerance keeps a zoom that the position alone would not need', () => {

	const events = [];
	for ( let i = 0; i < 40; i ++ ) events.push( ev( 'f' + i, i === 0 ? 0 : i * 0.1 - 0.099, i === 0 ? 0.001 : 0.099, [ 0, 1, 5 ], AIM, 20 + 30 * smooth( i / 39 ) * smooth( i / 39 ) ) );
	const track = { target: '#f', events };
	assert.strictEqual( M.previewSimplify( track, { tolerance: 0.01, maxKeys: 40 } ).after, 2 ); // fov ignored: the original behaviour
	assert.ok( M.previewSimplify( track, { tolerance: 0.01, fov: 0.2, maxKeys: 40 } ).after > 4 );

} );

console.log( '\npreview is pure' );

test( 'previewSimplify matches simplifyTrack and never mutates', () => {

	const t = dense(), before = JSON.stringify( t );
	const p = M.previewSimplify( t, 'normal' );
	assert.strictEqual( JSON.stringify( t ), before );
	assert.strictEqual( p.before, 195 );
	const r = M.simplifyTrack( t, 'normal' );
	assert.strictEqual( r.after, p.after );
	assert.strictEqual( keysOf( t ).length, p.after );
	assert.strictEqual( t.spline, true );

} );

test( 'a track with nothing to remove is left exactly as it was', () => {

	const t = { target: '#c', events: [ ev( 'a', 0, 0.001, [ 0, 0, 0 ] ), ev( 'b', 1, 1, [ 1, 0, 0 ] ), ev( 'c', 2, 1, [ 5, 5, 5 ] ) ] };
	const before = JSON.stringify( t );
	assert.strictEqual( M.simplifyTrack( t, 'loose' ).changed, false );
	assert.strictEqual( JSON.stringify( t ), before );

} );

console.log( '\nkeep beats' );

test( 'the final key and the closest-approach key survive; ends are exact', () => {

	const t = dense();
	const keys = keysOf( t );
	const last = keys[ keys.length - 1 ];
	const closest = closestOf( keys );
	assert.ok( closest.time < last.time, 'fixture: the min-distance key is interior' );

	for ( const preset of [ 'tight', 'normal', 'loose' ] ) {

		const c = clone( t );
		const r = M.simplifyTrack( c, { preset, keepBeats: true } );
		const ks = keysOf( c );
		assert.ok( r.after < r.before );
		assert.deepStrictEqual( ks[ ks.length - 1 ].position, last.position.map( v => Math.round( v * 1e4 ) / 1e4 ), preset + ': final key position is exact' );
		assert.strictEqual( ks[ ks.length - 1 ].time, last.time );
		assert.strictEqual( ks[ 0 ].time, keys[ 0 ].time );
		const kept = ks.find( k => k.time === closest.time );
		assert.ok( kept, preset + ': the min-distance key (t=' + closest.time + ') survives' );
		assert.deepStrictEqual( kept.position, closest.position.map( v => Math.round( v * 1e4 ) / 1e4 ) );

	}

} );

test( 'keys at the shot start and end land on kept keys', () => {

	const keys = keysOf( dense() );
	const c = dense();
	M.simplifyTrack( c, { preset: 'loose', keepBeats: true, beats: [ 6.04, 13.37 ] } );
	const ts = timesOf( c );
	const nearest = x => keys.reduce( ( a, k ) => Math.abs( k.time - x ) < Math.abs( a.time - x ) ? k : a ).time;
	assert.ok( ts.includes( nearest( 6.04 ) ) && ts.includes( nearest( 13.37 ) ), ts.join( ',' ) );

} );

test( 'speed turning points (ease in/out) are beats', () => {

	const keys = keysOf( dense() );
	const ts = S.beatIndices( keys ).map( i => keys[ i ].time );
	assert.ok( ts.length >= 4, 'expected ends + turning points, got ' + ts );
	assert.ok( ts.some( x => x > 1 && x < 8 ), 'a turning point in the ease across the first half: ' + ts );

} );

test( 'the key cap grows to hold the beats instead of dropping them', () => {

	const c = dense();
	const r = M.simplifyTrack( c, { tolerance: 100, maxKeys: 2, keepBeats: true } );
	assert.ok( r.after >= 2 );
	assert.ok( timesOf( c ).includes( 19.4 ) );

} );

console.log( '\nsimplify all cameras' );

const cam = ( uuid, label ) => ( { uuid, name: label, userData: { label } } );
function sceneTimeline() {

	const model = new TimelineModel();
	const tracks = [ [ 'cam01', 131 ], [ 'cam05', 79 ], [ 'cam11', 195 ], [ 'cam02', 3 ] ];
	for ( const [ label, n ] of tracks ) {

		const t = dense( n );
		t.events.forEach( e => { e.id = label + e.id; } );
		model.track( '#' + label, true ).events.push( ...t.events );

	}
	model.recomputeDuration();
	return { model, cameras: tracks.map( ( [ label ] ) => cam( 'u-' + label, label ) ) };

}

test( 'every camera with 4+ keys is thinned, small ones are untouched; the report adds up', () => {

	const { model, cameras } = sceneTimeline();
	const r = T.simplifyAllInModel( model, cameras, [], { preset: 'normal' } );
	assert.strictEqual( r.cameras, 3 );
	assert.strictEqual( r.before, 131 + 79 + 195 );
	assert.ok( r.after < r.before / 4, r.before + ' -> ' + r.after );
	assert.strictEqual( r.report.reduce( ( n, x ) => n + x.after, 0 ), r.after );
	assert.strictEqual( keysOf( T.findCameraTrack( model, cameras[ 3 ] ) ).length, 3 );
	assert.strictEqual( keysOf( T.findCameraTrack( model, cameras[ 2 ] ) ).length, r.report.find( x => x.camera === 'cam11' ).after );

} );

test( 'simplify all defaults to the normal preset with beats kept; a bare number is a tolerance', () => {

	const { model, cameras } = sceneTimeline();
	const def = T.simplifyAllInModel( model, cameras, [], undefined, { dryRun: true } );
	const normal = T.simplifyAllInModel( model, cameras, [], 'normal', { dryRun: true } );
	assert.strictEqual( def.after, normal.after );
	assert.ok( T.simplifyAllInModel( model, cameras, [], 0.5, { dryRun: true } ).after < def.after );

} );

test( 'dryRun reports the same numbers and changes nothing', () => {

	const { model, cameras } = sceneTimeline();
	const before = JSON.stringify( model.toJSON() );
	const dry = T.simplifyAllInModel( model, cameras, [], 'normal', { dryRun: true } );
	assert.strictEqual( JSON.stringify( model.toJSON() ), before );
	const real = T.simplifyAllInModel( model, cameras, [], 'normal' );
	assert.deepStrictEqual( [ dry.before, dry.after ], [ real.before, real.after ] );

} );

test( 'Camera Sequence shots become beats; other cameras\' shots do not', () => {

	const shots = [ { at: 0, camera: 'a' }, { at: 4.5, camera: 'b' }, { at: 9, camera: 'a' } ];
	assert.deepStrictEqual( T.shotBeats( shots, 20, { uuid: 'a' } ), [ 0, 4.5, 9, 20 ] );
	assert.deepStrictEqual( T.shotBeats( shots, 20, { uuid: 'b' } ), [ 4.5, 9 ] );
	assert.deepStrictEqual( T.shotBeats( [], 20, { uuid: 'a' } ), [] );
	const o = T.optionsForCamera( shots, 20, { uuid: 'b' }, { keepBeats: true, beats: [ 1 ] } );
	assert.deepStrictEqual( o.beats, [ 1, 4.5, 9 ] );
	assert.deepStrictEqual( T.optionsForCamera( shots, 20, { uuid: 'b' }, {} ).beats, [] );

} );

test( 'setKeys can simplify what it writes (opt-in) and is exact by default', () => {

	const specs = keysOf( dense() ).map( k => ( { t: k.time, pos: k.position, lookAt: AIM, fov: k.fov } ) );
	const exact = { target: '#c', events: [] };
	assert.strictEqual( M.setKeys( exact, specs ), 195 );
	const thin = { target: '#c', events: [] };
	const n = M.setKeys( thin, specs, { simplify: true } );
	assert.ok( n < 195 / 3 && n === keysOf( thin ).length, 'n=' + n );
	assert.strictEqual( thin.spline, true );
	assert.strictEqual( keysOf( thin )[ n - 1 ].time, 19.4 );

} );

test( 'simplified path stays close to the original (normal preset)', () => {

	const keys = keysOf( dense() ), c = dense();
	M.simplifyTrack( c, { preset: 'normal', keepBeats: true } );
	const curve = S.makeCurve( keysOf( c ) );
	let worst = 0;
	for ( const k of keys ) worst = Math.max( worst, Math.hypot( ...curve.at( k.time ).position.map( ( v, i ) => v - k.position[ i ] ) ) );
	assert.ok( worst < 0.2, 'worst deviation ' + worst );

} );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail ? 1 : 0 );
