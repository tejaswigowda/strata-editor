// Node test for the imported-clip control semantics (clipSampling.js): what
// clip-local time / weight apply at global time t for play/pause/stop/seek
// directives, and the back-compat default (no directive => auto-play).
//   node docs/editor/js/intelligence/__tests__/clipSampling.test.mjs

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { sampleClipState } = await import( path.resolve( here, '..', 'clipSampling.js' ) );
const { classifyOpVerb } = await import( path.resolve( here, '..', 'opResolve.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

const near = ( a, b, msg ) => assert.ok( Math.abs( a - b ) < 1e-9, `${ msg || '' } expected ${ b }, got ${ a }` );
const clip = { duration: 10 };
const play = ( at, args = {} ) => ( { at, op: 'play', args: { name: 'c', ...args } } );

test( 'no directive: auto-play from 0, plays once, holds the last frame (back-compat)', () => {

	near( sampleClipState( clip, [], 0 ).local, 0 );
	near( sampleClipState( clip, [], 4 ).local, 4 );
	near( sampleClipState( clip, [], 25 ).local, 10, 'holds last frame' );
	near( sampleClipState( clip, [], 4 ).weight, 1 );

} );

test( 'play at 5: holds frame 0 before, starts at 5', () => {

	const ev = [ play( 5 ) ];
	near( sampleClipState( clip, ev, 2 ).local, 0, 'before start' );
	near( sampleClipState( clip, ev, 5 ).local, 0 );
	near( sampleClipState( clip, ev, 8 ).local, 3 );
	near( sampleClipState( clip, ev, 40 ).local, 10, 'clamps at the end' );

} );

test( 'loop wraps instead of clamping', () => {

	const ev = [ play( 0, { loop: true } ) ];
	near( sampleClipState( clip, ev, 12 ).local, 2 );
	near( sampleClipState( clip, ev, 25 ).local, 5 );

} );

test( 'speed scales local time, negative speed plays backward from the end', () => {

	near( sampleClipState( clip, [ play( 0, { speed: 2 } ) ], 3 ).local, 6 );
	near( sampleClipState( clip, [ play( 0, { speed: - 1 } ) ], 3 ).local, 7 );

} );

test( 'pause freezes local time; later samples stay frozen', () => {

	const ev = [ play( 0 ), { at: 4, op: 'pause', args: { name: 'c' } } ];
	near( sampleClipState( clip, ev, 3 ).local, 3 );
	near( sampleClipState( clip, ev, 4 ).local, 4 );
	near( sampleClipState( clip, ev, 9 ).local, 4, 'still frozen' );

} );

test( 'stop rewinds to the first frame and holds', () => {

	const ev = [ play( 0 ), { at: 4, op: 'stop', args: { name: 'c' } } ];
	near( sampleClipState( clip, ev, 3 ).local, 3 );
	near( sampleClipState( clip, ev, 7 ).local, 0 );

} );

test( 'seek jumps and keeps running', () => {

	const ev = [ play( 0 ), { at: 2, op: 'seek', args: { name: 'c', time: 8 } } ];
	near( sampleClipState( clip, ev, 1 ).local, 1 );
	near( sampleClipState( clip, ev, 3 ).local, 9 );

} );

test( 'seek while paused stays paused at the new time', () => {

	const ev = [ play( 0 ), { at: 2, op: 'pause', args: {} }, { at: 3, op: 'seek', args: { time: 7 } } ];
	near( sampleClipState( clip, ev, 6 ).local, 7 );

} );

test( 'a later play restarts the clip', () => {

	const ev = [ play( 0 ), play( 6 ) ];
	near( sampleClipState( clip, ev, 5 ).local, 5 );
	near( sampleClipState( clip, ev, 8 ).local, 2, 'restarted at 6' );

} );

test( 'weight and fade-in', () => {

	const ev = [ play( 2, { weight: 0.5, fade: 2 } ) ];
	near( sampleClipState( clip, ev, 2 ).weight, 0, 'fade starts at 0' );
	near( sampleClipState( clip, ev, 3 ).weight, 0.25, 'smoothstep midpoint x weight' );
	near( sampleClipState( clip, ev, 6 ).weight, 0.5, 'settled' );

} );

test( 'clampWhenFinished:false releases to the rest pose (weight 0) after the end', () => {

	const ev = [ play( 0, { clampWhenFinished: false } ) ];
	near( sampleClipState( clip, ev, 5 ).weight, 1 );
	near( sampleClipState( clip, ev, 12 ).weight, 0 );

} );

test( 'sampling is order independent (deterministic)', () => {

	const ev = [ play( 1 ), { at: 3, op: 'pause', args: {} }, { at: 5, op: 'seek', args: { time: 2 } } ];
	const a = [ 0, 2, 4, 6, 8 ].map( t => sampleClipState( clip, ev, t ).local );
	const b = [ 8, 6, 4, 2, 0 ].map( t => sampleClipState( clip, ev, t ).local ).reverse();
	assert.deepStrictEqual( a, b );

} );

test( 'AI host verb map: clip-control verbs resolve to a single op', () => {

	assert.strictEqual( classifyOpVerb( 'play the mocap at 2s looping' ).op, 'play' );
	assert.strictEqual( classifyOpVerb( 'pause the mocap' ).op, 'pause' );
	assert.strictEqual( classifyOpVerb( 'stop the walk cycle' ).op, 'stop' );
	assert.strictEqual( classifyOpVerb( 'seek to the wave' ).op, 'seek' );
	assert.strictEqual( classifyOpVerb( 'play the mocap at 2s looping' ).confident, true );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
