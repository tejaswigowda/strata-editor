// Node tests for the motion edit list (pure; no editor, no DOM). Run with:
//   node docs/editor/js/intelligence/__tests__/motionEdit.test.mjs

import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const docs = path.resolve( here, '../../../..' );

register( 'data:text/javascript,' + encodeURIComponent( `
export async function resolve( spec, ctx, next ) {
	if ( spec === 'three' ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'build/three.module.js' ) ).href ) }, shortCircuit: true };
	return next( spec, ctx );
}` ) );

const THREE = await import( 'three' );
const M = await import( '../motionEdit.js' );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

// A performer: hips travel across the floor, hips + arm rotate. 30 fps over `dur` seconds.
function performer( dur, { x0 = 0, z0 = 0, dir = 1, phase = 0 } = {} ) {

	const times = [], pos = [], hq = [], aq = [];
	const q = new THREE.Quaternion(), e = new THREE.Euler();

	for ( let i = 0; i <= dur * 30; i ++ ) {

		const t = i / 30;
		times.push( t );
		pos.push( x0 + dir * 0.5 * t + Math.sin( t * 0.7 + phase ), 1, z0 + Math.cos( t * 0.5 + phase ) );
		q.setFromEuler( e.set( 0, 0.4 * t + phase, 0 ) ); hq.push( q.x, q.y, q.z, q.w );
		q.setFromEuler( e.set( Math.sin( t ) * 0.8, 0, 0.2 ) ); aq.push( q.x, q.y, q.z, q.w );

	}

	return new THREE.AnimationClip( 'cap', dur, [
		new THREE.VectorKeyframeTrack( 'hips.position', times, pos ),
		new THREE.QuaternionKeyframeTrack( 'hips.quaternion', times, hq ),
		new THREE.QuaternionKeyframeTrack( 'arm.quaternion', times, aq ),
	] );

}

const fingerprint = clip => JSON.stringify( clip.tracks.map( t => [ t.name, Array.from( t.times ), Array.from( t.values ) ] ) );
const group = () => [ { id: '#f1', clip: performer( 60, { x0: 0, dir: 1 } ) }, { id: '#f2', clip: performer( 60, { x0: 3, dir: - 1, phase: 1 } ) } ];
const posAt = ( clip, t ) => Array.from( clip.tracks[ 0 ].createInterpolant().evaluate( t ) );
const quatAt = ( clip, i, t ) => Array.from( clip.tracks[ i ].createInterpolant().evaluate( t ) );
const dist = ( a, b ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 2 ] - b[ 2 ] );
const SPANS = [ [ 2, 8 ], [ 20, 27 ], [ 41, 50 ] ];

test( 'ops: trim / splice / speed / retime / hold are pure and validated', () => {

	const e0 = M.fullEdl( 60 );
	const e1 = M.trim( e0, 5, 15, 60 );
	assert.deepStrictEqual( e1.spans, [ { from: 5, to: 15 } ] );
	assert.deepStrictEqual( e0.spans, [ { from: 0, to: 60 } ] ); // input untouched

	const e2 = M.splice( e0, SPANS, { blend: 0.3 }, 60 );
	assert.strictEqual( M.edlDuration( e2 ), 22 );
	assert.strictEqual( e2.blend, 0.3 );

	assert.strictEqual( M.edlDuration( M.speed( e2, 0.5, 60 ) ), 44 );

	const rt = M.retime( M.trim( e0, 0, 10, 60 ), [ [ 0, 1 ], [ 4, 0.5 ] ], 60 );
	assert.deepStrictEqual( rt.spans.map( s => [ s.from, s.to, s.speed || 1 ] ), [ [ 0, 4, 1 ], [ 4, 10, 0.5 ] ] );
	assert.strictEqual( M.edlDuration( rt ), 4 + 12 );

	const h = M.hold( M.trim( e0, 0, 10, 60 ), 4, 2, 60 );
	assert.deepStrictEqual( h.spans, [ { from: 0, to: 4 }, { hold: 4, dur: 2 }, { from: 4, to: 10 } ] );
	assert.strictEqual( M.edlDuration( h ), 12 );

} );

test( 'ops refuse bad input: no blend, out of range, empty', () => {

	const e0 = M.fullEdl( 60 );
	assert.throws( () => M.splice( e0, SPANS, { blend: 0 }, 60 ), err => err.code === 'NO_BLEND' );
	assert.throws( () => M.splice( e0, [ [ 10, 70 ] ], {}, 60 ), /outside the clip/ );
	assert.throws( () => M.splice( e0, [ [ 10, 10 ] ], {}, 60 ), /greater than/ );
	assert.throws( () => M.splice( e0, [], {}, 60 ), /non-empty/ );
	assert.throws( () => M.speed( e0, 0, 60 ), /positive/ );

} );

test( 'source <-> output time mapping', () => {

	const e = M.splice( M.fullEdl( 60 ), SPANS, {}, 60 );
	assert.strictEqual( M.sourceToOutput( e, 2 ), 0 );
	assert.strictEqual( M.sourceToOutput( e, 21 ), 7 );
	assert.strictEqual( M.sourceToOutput( e, 12 ), null ); // dropped
	assert.strictEqual( M.outputToSource( e, 5.5 ), 7.5 );
	assert.strictEqual( M.outputToSource( e, 6.5 ), 20.5 );
	assert.strictEqual( M.outputToSource( e, 21 ), 49 );

} );

test( 'compile: the cut is the sum of its spans and the capture is never modified', () => {

	const members = group();
	const before = members.map( m => fingerprint( m.clip ) );
	const e = M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.25 }, 60 );
	const out = M.buildEditedClips( members, e );

	for ( const m of members ) {

		const c = out.get( m.id );
		assert.ok( Math.abs( c.duration - 22 ) < 1e-9 );
		assert.ok( Math.abs( c.tracks[ 0 ].times[ c.tracks[ 0 ].times.length - 1 ] - 22 ) < 1e-9 );

	}

	assert.deepStrictEqual( members.map( m => fingerprint( m.clip ) ), before );

} );

test( 'compile: the first span plays the source exactly', () => {

	const members = group();
	const out = M.buildEditedClips( members, M.splice( M.fullEdl( 60 ), SPANS, {}, 60 ) );

	for ( const m of members ) for ( const u of [ 0, 1.5, 4, 5.9 ] ) {

		const a = posAt( out.get( m.id ), u ), b = posAt( m.clip, 2 + u );
		assert.ok( dist( a, b ) < 1e-6 && Math.abs( a[ 1 ] - b[ 1 ] ) < 1e-6, `${ m.id } @${ u }` );

	}

} );

test( 'compile: no teleport at a cut — the group centroid and every pose are continuous', () => {

	const members = group();
	const out = M.buildEditedClips( members, M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.25 }, 60 ) );
	const cut = 6; // end of span 0 / start of span 1

	const centroid = t => {

		const ps = members.map( m => posAt( out.get( m.id ), t ) );
		return [ ( ps[ 0 ][ 0 ] + ps[ 1 ][ 0 ] ) / 2, 0, ( ps[ 0 ][ 2 ] + ps[ 1 ][ 2 ] ) / 2 ];

	};

	const eps = 1e-4;
	assert.ok( dist( centroid( cut - eps ), centroid( cut + eps ) ) < 1e-3, 'centroid jumps at the cut' );

	for ( const m of members ) {

		const c = out.get( m.id );
		assert.ok( dist( posAt( c, cut - eps ), posAt( c, cut + eps ) ) < 1e-3, `${ m.id } root pops` );

		for ( const ti of [ 1, 2 ] ) {

			const q0 = new THREE.Quaternion().fromArray( quatAt( c, ti, cut - eps ) );
			const q1 = new THREE.Quaternion().fromArray( quatAt( c, ti, cut + eps ) );
			assert.ok( q0.angleTo( q1 ) < 1e-2, `${ m.id } track ${ ti } pops (${ q0.angleTo( q1 ) })` );

		}

	}

} );

test( 'compile: blend slerps — unit quaternions throughout the window, then the source resumes', () => {

	const members = group();
	const out = M.buildEditedClips( members, M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.5 }, 60 ) );
	const c = out.get( '#f1' );

	for ( let u = 5.9; u < 6.7; u += 0.013 ) {

		const q = new THREE.Quaternion().fromArray( quatAt( c, 2, u ) );
		assert.ok( Math.abs( q.length() - 1 ) < 1e-6, `non-unit quaternion at ${ u }` );

	}

	// past the window the arm is exactly the source again (rotation tracks are not offset)
	const after = new THREE.Quaternion().fromArray( quatAt( c, 2, 7.5 ) );
	const src = new THREE.Quaternion().fromArray( quatAt( members[ 0 ].clip, 2, 20 + 1.5 ) );
	assert.ok( after.angleTo( src ) < 1e-4 );

} );

test( 'registration: the same cut keeps the two performers where the capture put them', () => {

	const members = group();
	const e = M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.25 }, 60 );
	const out = M.buildEditedClips( members, e );

	// well after each blend window, the separation equals the capture's separation at the same source moment
	for ( const [ outT, srcT ] of [ [ 3, 5 ], [ 8, 22 ], [ 16, 44 ], [ 20, 48 ] ] ) {

		const edited = dist( posAt( out.get( '#f1' ), outT ), posAt( out.get( '#f2' ), outT ) );
		const source = dist( posAt( members[ 0 ].clip, srcT ), posAt( members[ 1 ].clip, srcT ) );
		assert.ok( Math.abs( edited - source ) < 1e-6, `separation drifted at ${ outT }: ${ edited } vs ${ source }` );

	}

} );

test( 'speed: a slowed span reads the source at half rate', () => {

	const members = group();
	const e = M.speed( M.trim( M.fullEdl( 60 ), 10, 20, 60 ), 0.5, 60 );
	const c = M.buildEditedClips( members, e ).get( '#f1' );
	assert.ok( Math.abs( c.duration - 20 ) < 1e-9 );
	assert.ok( dist( posAt( c, 8 ), posAt( members[ 0 ].clip, 14 ) ) < 1e-6 );

} );

test( 'hold: the pose is frozen for the held duration', () => {

	const members = group();
	const e = M.hold( M.trim( M.fullEdl( 60 ), 0, 10, 60 ), 4, 2, 60 );
	const c = M.buildEditedClips( members, e ).get( '#f1' );
	assert.ok( Math.abs( c.duration - 12 ) < 1e-9 );
	assert.ok( dist( posAt( c, 4.5 ), posAt( c, 5.9 ) ) < 1e-3 );

} );

test( 'rootOffset moves the whole group by one vector; rootYaw turns it about its centre', () => {

	const members = group();
	const base = M.trim( M.fullEdl( 60 ), 0, 10, 60 );
	const plain = M.buildEditedClips( members, base );
	const moved = M.buildEditedClips( members, M.rootOffset( base, [ 2, 0, - 1 ], 60 ) );

	for ( const m of members ) {

		const a = posAt( plain.get( m.id ), 5 ), b = posAt( moved.get( m.id ), 5 );
		assert.ok( Math.abs( b[ 0 ] - a[ 0 ] - 2 ) < 1e-5 && Math.abs( b[ 2 ] - a[ 2 ] + 1 ) < 1e-5 ); // tracks store float32

	}

	const turned = M.buildEditedClips( members, M.rootYaw( base, 90, 60 ) );
	const sep = ( set, t ) => dist( posAt( set.get( '#f1' ), t ), posAt( set.get( '#f2' ), t ) );
	assert.ok( Math.abs( sep( turned, 5 ) - sep( plain, 5 ) ) < 1e-6, 'yaw must preserve the separation' );

	const q0 = new THREE.Quaternion().fromArray( quatAt( plain.get( '#f1' ), 1, 5 ) );
	const q1 = new THREE.Quaternion().fromArray( quatAt( turned.get( '#f1' ), 1, 5 ) );
	assert.ok( Math.abs( q0.angleTo( q1 ) - Math.PI / 2 ) < 1e-6 );

} );

test( 'determinism: identical input compiles to byte-identical output', () => {

	const e = M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.25 }, 60 );
	const a = M.buildEditedClips( group(), e ), b = M.buildEditedClips( group(), e );
	assert.strictEqual( fingerprint( a.get( '#f1' ) ), fingerprint( b.get( '#f1' ) ) );
	assert.strictEqual( fingerprint( a.get( '#f2' ) ), fingerprint( b.get( '#f2' ) ) );

} );

test( 'collisionReport: finds the closest approach, flags spans under the floor', () => {

	// two performers that pass 0.4 m apart at t = 5 s
	const make = ( xs, z ) => new THREE.AnimationClip( 'c', 10, [ new THREE.VectorKeyframeTrack( 'hips.position', [ 0, 5, 10 ], [ xs[ 0 ], 0, z, 0, 0, z, xs[ 1 ], 0, z ] ) ] );
	const members = [ { id: 'a', clip: make( [ - 5, 5 ], 0 ) }, { id: 'b', clip: make( [ 5, - 5 ], 0.4 ) } ];
	const r = M.collisionReport( members, { floor: 0.6 } );

	assert.strictEqual( r.min, 0.4 );
	assert.ok( Math.abs( r.minAt - 5 ) < 0.04 );
	assert.strictEqual( r.ok, false );
	assert.strictEqual( r.violations.length, 1 );
	assert.ok( r.violations[ 0 ].from < 5 && r.violations[ 0 ].to > 5 );
	assert.strictEqual( M.collisionReport( members, { floor: 0.3 } ).ok, true );

	// per-span minimum and the group's start time on the shared clock
	const spans = M.edlTable( { spans: [ { from: 0, to: 4 }, { from: 4, to: 10 } ] } );
	const per = M.collisionReport( members, { floor: 0.6, spans, at: 100 } );
	assert.strictEqual( per.spans.length, 2 );
	assert.ok( per.spans[ 1 ].min === 0.4 && per.spans[ 0 ].min > 0.4 );
	assert.ok( Math.abs( per.minAt - 105 ) < 0.04 );

	// world transform: the second performer's frame scaled changes the distance
	const scaled = [ members[ 0 ], { ...members[ 1 ], matrix: new THREE.Matrix4().makeScale( 2, 2, 2 ) } ];
	assert.ok( M.collisionReport( scaled ).min !== r.min );

} );

test( 'collisionReport on an edited cut reports the cut, not the source', () => {

	const members = group();
	const e = M.splice( M.fullEdl( 60 ), SPANS, { blend: 0.25 }, 60 );
	const cut = M.buildEditedClips( members, e );
	const r = M.collisionReport( [ { id: '#f1', clip: cut.get( '#f1' ) }, { id: '#f2', clip: cut.get( '#f2' ) } ], { spans: M.edlTable( e ) } );

	assert.ok( Math.abs( r.duration - 22 ) < 1e-2 );
	assert.strictEqual( r.spans.length, 3 );
	assert.ok( r.min > 0 );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
