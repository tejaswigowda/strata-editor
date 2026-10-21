// Run: node docs/editor/js/intelligence/__tests__/cameraKeysCode.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { collapseCameraKeys, parseSetKeys, eventsFromSetKeys, COLLAPSE_MIN_KEYS } = await import( path.join( here, '..', 'cameraKeysCode.js' ) );
const { eventLineMap } = await import( path.join( here, '..', 'timelineCodeMap.js' ) );
const { setKeys } = await import( path.join( here, '..', 'cameraMove.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

// a baked move like the cafe scene's: a key every 0.1 s, first key a 1 ms snap
function baked( n, { smooth = false, lookAt = true } = {} ) {

	const specs = Array.from( { length: n }, ( _, i ) => ( {
		t: Math.round( ( 125.5 + 0.001 + i * 0.1 ) * 1000 ) / 1000,
		pos: [ 0.66 - i * 0.0001, 0.19 + i * 0.0003, 0.06 ],
		...( lookAt ? { lookAt: i % 2 ? [ 0.455, 0.12, 0.216 ] : '#maya' } : {} ),
		fov: 34 - i * 0.01,
	} ) );
	const track = { target: '#cam11', events: [] };
	setKeys( track, specs, { smooth } );
	return track;

}

// what parseAndApplyCode does with the text, minus the editor
function save( text ) {

	const out = [];
	for ( const block of text.split( /\$S\(/ ) ) {

		const m = block.match( /^(['"`])(.+?)\1\)/ );
		if ( ! m ) continue;
		const after = block.slice( m[ 0 ].length );
		if ( ! /^\s*\.setKeys\(/.test( after ) ) continue;
		const { specs, opts } = parseSetKeys( after );
		out.push( eventsFromSetKeys( m[ 2 ], specs, opts ) );

	}
	return out;

}

const shape = e => JSON.stringify( { at: e.at, dur: e.dur, args: e.args } );
const sorted = events => [ ...events ].sort( ( a, b ) => a.at - b.at );

test( 'a dense camera track becomes one statement, one key per line', () => {

	const track = baked( 195 );
	const c = collapseCameraKeys( track, sorted( track.events ) );
	assert.ok( c );
	assert.strictEqual( c.ids.length, 195 );
	assert.strictEqual( c.lines.length, 195 + 3 ); // comment, opener, keys, closer
	assert.ok( c.lines[ 0 ].startsWith( '//' ) );
	assert.ok( c.lines[ 1 ].startsWith( "$S('#cam11').setKeys([" ) );
	assert.ok( c.lines[ c.lines.length - 1 ].endsWith( '});' ) );
	assert.deepStrictEqual( c.rest, [] );
	assert.ok( ! c.lines.join( '\n' ).includes( '.at(' ), 'no per-event chain is left' );

} );

test( 'saving the collapsed text rebuilds exactly the same events', () => {

	for ( const opts of [ { smooth: false }, { smooth: true }, { smooth: false, lookAt: false } ] ) {

		const track = baked( 195, opts );
		if ( opts.smooth ) track.spline = true;
		const c = collapseCameraKeys( track, sorted( track.events ) );
		assert.ok( c, JSON.stringify( opts ) );
		const [ back ] = save( 'warning line\n\n' + c.lines.join( '\n' ) + '\n\n$S(\'#other\').at(1).fadeIn(200);' );
		assert.strictEqual( back.target, '#cam11' );
		assert.strictEqual( !! back.spline, !! track.spline );
		assert.deepStrictEqual( sorted( back.events ).map( shape ), sorted( track.events ).map( shape ) );

	}

} );

test( 'legs that start the instant the previous key arrives still collapse, keys unchanged', () => {

	const track = baked( 50 );
	const evs = sorted( track.events );
	for ( let i = 1; i < evs.length; i ++ ) { const arrive = evs[ i - 1 ].at + evs[ i - 1 ].dur; evs[ i ].dur = Math.round( ( evs[ i ].at + evs[ i ].dur - arrive ) * 1000 ) / 1000; evs[ i ].at = Math.round( arrive * 1000 ) / 1000; evs[ i ].args.duration = evs[ i ].dur; }
	const c = collapseCameraKeys( track, evs );
	assert.ok( c );
	const [ back ] = save( c.lines.join( '\n' ) );
	const arrivals = list => sorted( list ).map( e => Math.round( ( e.at + e.dur ) * 1000 ) / 1000 + ' ' + JSON.stringify( e.args.props ) + e.args.easing );
	assert.deepStrictEqual( arrivals( back.events ), arrivals( evs ) );
	assert.ok( sorted( back.events ).every( ( e, i ) => Math.abs( e.at - evs[ i ].at ) <= 0.0015 + 1e-9 ) );
	// and the collapsed form is a fixed point
	assert.strictEqual( collapseCameraKeys( back, sorted( back.events ) ).lines.join( '\n' ), c.lines.join( '\n' ) );

} );

test( 'the text survives a second collapse unchanged (idempotent)', () => {

	const track = baked( 60, { smooth: true } );
	track.spline = true;
	const a = collapseCameraKeys( track, sorted( track.events ) );
	const [ back ] = save( a.lines.join( '\n' ) );
	const b = collapseCameraKeys( back, sorted( back.events ) );
	assert.strictEqual( b.lines.join( '\n' ), a.lines.join( '\n' ) );

} );

test( 'each key maps to its own line', () => {

	const track = baked( 40 );
	const evs = sorted( track.events );
	const c = collapseCameraKeys( track, evs );
	const blocks = [ '// WARNING: x', c.lines.join( '\n' ), `$S('#b').at(5).fadeIn(200);` ];
	const m = eventLineMap( blocks, [ { block: 1, ids: c.ids, lead: c.lead } ] );
	const text = blocks.join( '\n\n' ).split( '\n' );
	assert.strictEqual( new Set( c.ids.map( id => m.get( id ) ) ).size, 40 );
	for ( const e of evs ) {

		const line = text[ m.get( e.id ) - 1 ];
		assert.ok( line.includes( 't: ' + ( Math.round( ( e.at + e.dur ) * 1000 ) / 1000 ) + ',' ), line );

	}

} );

test( 'below the key threshold, or not a camera track, nothing is collapsed', () => {

	const few = baked( COLLAPSE_MIN_KEYS - 1 );
	assert.strictEqual( collapseCameraKeys( few, sorted( few.events ) ), null );
	const notCam = { target: '#box', events: Array.from( { length: 30 }, ( _, i ) => ( { id: 'e' + i, at: i, op: 'animate', args: { props: { rotateY: i }, easing: 'linear', duration: 1 }, dur: 1 } ) ) };
	assert.strictEqual( collapseCameraKeys( notCam, notCam.events ), null );
	const fades = { target: '#box', events: Array.from( { length: 30 }, ( _, i ) => ( { id: 'f' + i, at: i, op: 'fadeIn', args: {}, dur: 0.2 } ) ) };
	assert.strictEqual( collapseCameraKeys( fades, fades.events ), null );

} );

test( 'a track the statement could not rebuild exactly is left as events', () => {

	const eased = baked( 30 );
	eased.events[ 10 ].args = { ...eased.events[ 10 ].args, easing: 'ease-in' };
	assert.strictEqual( collapseCameraKeys( eased, sorted( eased.events ) ), null );

	const extra = baked( 30 );
	extra.events[ 4 ].args.props.rotateY = 10;
	assert.strictEqual( collapseCameraKeys( extra, sorted( extra.events ) ), null );

	const gap = baked( 30 );
	gap.events[ 7 ].at += 0.02; // a leg that does not start where the previous key arrives
	gap.events[ 7 ].dur -= 0.02;
	gap.events[ 7 ].args.duration = gap.events[ 7 ].dur;
	assert.strictEqual( collapseCameraKeys( gap, sorted( gap.events ) ), null );

} );

test( 'events that are not camera keys stay in the chain, keys still collapse', () => {

	const track = baked( 30 );
	const fade = { id: 'fade1', at: 130, op: 'fadeOut', args: {}, dur: 0.5 };
	const c = collapseCameraKeys( track, sorted( [ ...track.events, fade ] ) );
	assert.ok( c );
	assert.deepStrictEqual( c.rest.map( e => e.id ), [ 'fade1' ] );
	assert.strictEqual( c.ids.length, 30 );

} );

test( 'parseSetKeys reads the shell form and reports bad input', () => {

	const { specs, opts } = parseSetKeys( ".setKeys([\n\t{ t: 0, pos: [0, 1, 5], lookAt: \"#a)b\" },\n\t{ t: 2, pos: [1, 1, 5], fov: 30 }\n], { smooth: true });" );
	assert.strictEqual( specs.length, 2 );
	assert.strictEqual( specs[ 0 ].lookAt, '#a)b' );
	assert.deepStrictEqual( opts, { smooth: true } );
	assert.deepStrictEqual( parseSetKeys( '.setKeys([{ t: 0, pos: [0,0,1] }]);' ).opts, {} );
	assert.throws( () => parseSetKeys( '.setKeys({ t: 0 });' ), /array/ );
	assert.throws( () => parseSetKeys( '.setKeys([{ t: 0, pos: [0,0,1] }' ), /unbalanced/ );
	assert.throws( () => eventsFromSetKeys( '#c', [ { t: 0 } ] ), /pos is required/ );

} );

console.log( `${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
