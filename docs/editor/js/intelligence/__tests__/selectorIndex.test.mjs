// Node test for the two host-side selector-resolution correctness fixes:
//   Bug 1 — simplest-selector tie-break (Occam over specificity for equal sets).
//   Bug 2 — post-resolution dedupe of co-referring segments (identical + subset).
// Both surfaces are PURE (no DOM, no three.js), so they import directly. Run with:
//   node docs/editor/js/intelligence/__tests__/selectorIndex.test.mjs

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const mod = await import( path.resolve( here, '..', 'selectorIndex.js' ) );
const { selectorTokenCount, simplerSelector, dedupeResolvedOps, nodeSetEquals, resolveEmittedSelector } = mod;

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const setOf = ( ...n ) => new Set( n );

// ── Bug 1: token count ──────────────────────────────────────────────────────────

test( 'selectorTokenCount counts simple-selector atoms', () => {

	assert.strictEqual( selectorTokenCount( '.grille' ), 1 );
	assert.strictEqual( selectorTokenCount( '.grille.black' ), 2 );
	assert.strictEqual( selectorTokenCount( '#dump-bed' ), 1 );
	assert.strictEqual( selectorTokenCount( 'mesh' ), 1 );
	assert.strictEqual( selectorTokenCount( 'mesh.foo' ), 2 );
	assert.strictEqual( selectorTokenCount( '.wheel .front' ), 2 );   // descendant
	assert.strictEqual( selectorTokenCount( '.wheel > .rim' ), 2 );   // child combinator
	assert.strictEqual( selectorTokenCount( '' ), 0 );

} );

// ── Bug 1: Occam tie-break ──────────────────────────────────────────────────────

test( 'simplerSelector: fewer atoms wins (.grille over .grille.black)', () => {

	assert.ok( simplerSelector( '.grille', '.grille.black' ) );
	assert.ok( ! simplerSelector( '.grille.black', '.grille' ) );

} );

test( 'simplerSelector: equal atoms → shorter string, then stable lexical', () => {

	assert.ok( simplerSelector( '.rims', '.wheel' ) );        // 1 atom each, .rims shorter
	assert.ok( ! simplerSelector( '.wheel', '.rims' ) );
	// equal atoms + equal length → DETERMINISTIC code-point order (never localeCompare)
	assert.strictEqual( simplerSelector( '#cab', '.cab' ), '#cab' < '.cab' );
	assert.ok( simplerSelector( '#cab', '.cab' ) );           // '#'(0x23) < '.'(0x2E)

} );

test( 'simplerSelector: specificity does NOT win a same-set tie', () => {

	// A compound (more specific) must LOSE to the bare class when both express the
	// same set — the whole point of Bug 1.
	assert.ok( simplerSelector( '.wheel', '.wheel.front.left' ) );

} );

test( 'simplerSelector: among equally-simple, prefer id > class (even if longer)', () => {

	// Known-good preference: an #id beats a shorter color/region class for the same
	// single node (#grille over .black), so the tie-break never demotes to a poor
	// semantic selector just because it is shorter.
	assert.ok( simplerSelector( '#grille', '.black' ) );
	assert.ok( ! simplerSelector( '.black', '#grille' ) );

} );

// ── Node-set equality (content-based, order-independent, type-safe) ──────────────

test( 'nodeSetEquals: order-independent on name arrays', () => {

	assert.ok( nodeSetEquals( [ 'a', 'b', 'c' ], [ 'c', 'a', 'b' ] ) );
	assert.ok( ! nodeSetEquals( [ 'a', 'b' ], [ 'a', 'b', 'c' ] ) );

} );

test( 'nodeSetEquals: type-safe across Set / Array / {nodes} wrappers', () => {

	assert.ok( nodeSetEquals( new Set( [ 'a', 'b' ] ), [ 'b', 'a' ] ) );
	assert.ok( nodeSetEquals( { nodes: [ 'a', 'b' ] }, new Set( [ 'a', 'b' ] ) ) );

} );

test( 'nodeSetEquals: compares node OBJECTS by uuid, not reference', () => {

	const a = [ { uuid: 'u1' }, { uuid: 'u2' } ];
	const b = [ { uuid: 'u2' }, { uuid: 'u1' } ]; // same uuids, different objects + order
	assert.ok( nodeSetEquals( a, b ) );
	assert.ok( ! nodeSetEquals( a, [ { uuid: 'u1' }, { uuid: 'u3' } ] ) );

} );

test( 'nodeSetEquals: two empty sets are equal (∅ == ∅)', () => {

	assert.ok( nodeSetEquals( [], new Set() ) );

} );

// ── Bug 2: dedupe of co-referring segments ──────────────────────────────────────

const wheels = () => setOf( 'Object_20', 'Object_21', 'Object_22', 'Object_23' );

test( 'dedupe merges identical set + same op (wheels and rims → 1 op)', () => {

	const entries = [
		{ op: 'recolor', selector: '.rims', args: { color: 'black' }, nodes: wheels() },
		{ op: 'recolor', selector: '.wheel', args: { color: 'black' }, nodes: wheels() },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 1 );
	assert.strictEqual( out[ 0 ].selector, '.rims' ); // first survives

} );

test( 'dedupe drops a strict SUBSET of a same-op superset (.rims.bottom + .rims → 1)', () => {

	const entries = [
		{ op: 'recolor', selector: '.rims.bottom', args: {}, nodes: setOf( 'Object_22', 'Object_23' ) },
		{ op: 'recolor', selector: '.rims', args: {}, nodes: wheels() },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 1 );
	assert.strictEqual( out[ 0 ].selector, '.rims' ); // the superset covers it

} );

test( 'dedupe drops the subset regardless of order (superset first)', () => {

	const entries = [
		{ op: 'recolor', selector: '.rims', args: {}, nodes: wheels() },
		{ op: 'recolor', selector: '.rims.bottom', args: {}, nodes: setOf( 'Object_22', 'Object_23' ) },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 1 );
	assert.strictEqual( out[ 0 ].selector, '.rims' );

} );

test( 'dedupe KEEPS different ops on the same set (lift the cab and paint it)', () => {

	const cab = () => setOf( 'Object_03' );
	const entries = [
		{ op: 'move', selector: '#cab', args: { dy: 1 }, nodes: cab() },
		{ op: 'recolor', selector: '#cab', args: { color: 'blue' }, nodes: cab() },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 2 );
	assert.deepStrictEqual( out.map( o => o.op ), [ 'move', 'recolor' ] );

} );

test( 'dedupe KEEPS genuine distinct 2-op split (two different node sets)', () => {

	const entries = [
		{ op: 'recolor', selector: '.wheel', args: { color: 'black' }, nodes: wheels() },
		{ op: 'recolor', selector: '#dump-bed', args: { color: 'red' }, nodes: setOf( 'Object_07' ) },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 2 );

} );

test( 'dedupe never collapses unresolved (empty-set) entries', () => {

	const entries = [
		{ op: 'recolor', selector: null, args: {}, nodes: setOf() },
		{ op: 'recolor', selector: null, args: {}, nodes: setOf() },
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 2 );

} );

test( 'dedupe preserves the first position when merging', () => {

	const entries = [
		{ op: 'spin', selector: '.wheel', args: {}, nodes: wheels() },
		{ op: 'recolor', selector: '#dump-bed', args: {}, nodes: setOf( 'Object_07' ) },
		{ op: 'spin', selector: '.rims', args: {}, nodes: wheels() }, // dup of #0
	];
	const out = dedupeResolvedOps( entries );
	assert.strictEqual( out.length, 2 );
	assert.deepStrictEqual( out.map( o => o.op ), [ 'spin', 'recolor' ] );
	assert.strictEqual( out[ 0 ].selector, '.wheel' ); // first spin kept

} );

// ── Parity invariant: resolution is model-/engine-independent ────────────────────
// The host resolves the selector; the model only PICKS among host candidates. So
// any equivalent emission (a candidate id, the candidate's own selector, or a
// free-form spelling that resolves to the same set) must canonicalize to the SAME
// host selector — otherwise two engines drift (the .grille.black-on-API-path bug).

test( 'resolveEmittedSelector: equivalent emissions canonicalize identically', () => {

	// Two candidates for the SAME node set — a stale compound and the simple id.
	const cands = [
		{ id: 'c1', selector: '.grille.black', nodes: new Set( [ 'O3' ] ) },
		{ id: 'c2', selector: '#cab', nodes: new Set( [ 'O3' ] ) },
	];
	const byId1 = resolveEmittedSelector( 'c1', cands, {} ).selector;
	const byId2 = resolveEmittedSelector( 'c2', cands, {} ).selector;
	const bySel = resolveEmittedSelector( '#cab', cands, {} ).selector;
	const byCompound = resolveEmittedSelector( '.grille.black', cands, {} ).selector;
	// Whichever the "engine" emits, the host collapses to the SIMPLEST (Occam) selector.
	assert.strictEqual( byId1, '#cab' );
	assert.strictEqual( byId2, '#cab' );
	assert.strictEqual( bySel, '#cab' );
	assert.strictEqual( byCompound, '#cab' );

} );

test( 'resolveEmittedSelector: distinct node sets stay distinct (no over-collapse)', () => {

	const cands = [
		{ id: 'c1', selector: '.rims', nodes: new Set( [ 'W1', 'W2', 'W3', 'W4' ] ) },
		{ id: 'c2', selector: '#dump-bed', nodes: new Set( [ 'B1' ] ) },
	];
	assert.strictEqual( resolveEmittedSelector( 'c1', cands, {} ).selector, '.rims' );
	assert.strictEqual( resolveEmittedSelector( 'c2', cands, {} ).selector, '#dump-bed' );

} );

// ── Node-set parity over a REAL engine query (the .grille.black-on-API-path bug) ──
// Uses selectorEngine end-to-end (no window.THREE): a free-form emission that only
// the API path used to leave un-canonicalized ('.grille.black', which has no .black
// class) must resolve to the SAME NODES as the constrained id emission — and the
// FINAL selector must be the host's canonical one, not the model's spelling.

function mkNode( { name, label, classes = [] } ) {

	const n = {
		name, isMesh: true, type: 'Mesh', children: [],
		userData: { label, customClasses: new Set( classes ) },
		traverse( fn ) { fn( n ); for ( const c of n.children ) c.traverse( fn ); },
	};
	return n;

}

function dumptruckScene() {

	const root = {
		name: 'DumpTruck', isGroup: true, type: 'Group', children: [], userData: {},
		traverse( fn ) { fn( root ); for ( const c of root.children ) c.traverse( fn ); },
	};
	root.children = [
		mkNode( { name: 'Object_03', label: 'Cab', classes: [ 'cab', 'grille', 'front', 'top' ] } ),
		mkNode( { name: 'Object_20', label: 'Front Left Wheel', classes: [ 'wheel', 'rims', 'front', 'left' ] } ),
		mkNode( { name: 'Object_21', label: 'Front Right Wheel', classes: [ 'wheel', 'rims', 'front', 'right' ] } ),
		mkNode( { name: 'Object_22', label: 'Rear Left Wheel', classes: [ 'wheel', 'rims', 'back', 'left' ] } ),
		mkNode( { name: 'Object_23', label: 'Rear Right Wheel', classes: [ 'wheel', 'rims', 'back', 'right' ] } ),
	];
	return { scene: root };

}

const nodeSet = ( r ) => [ ...r.nodes ].sort().join( ',' );

test( 'node-set parity: .grille.black (free-emit) === #cab (constrained id) — same nodes', () => {

	const editor = dumptruckScene();
	const grilleCands = [ { id: 'c1', selector: '#cab', nodes: new Set( [ 'Object_03' ] ) } ];
	const haiku = resolveEmittedSelector( '.grille.black', grilleCands, editor ); // API-path free-emit
	const local = resolveEmittedSelector( 'c1', grilleCands, editor );            // WebLLM constrained id
	assert.strictEqual( nodeSet( haiku ), 'Object_03', 'free-emit must recover the grille node' );
	assert.strictEqual( nodeSet( haiku ), nodeSet( local ), 'node-set parity across engines' );
	assert.strictEqual( haiku.selector, '#cab', 'canonicalized to the host selector, not .grille.black' );
	assert.strictEqual( local.selector, '#cab' );

} );

test( 'node-set parity: wheels-and-rims (.wheel vs .rims) resolve to the SAME 4 wheels', () => {

	const editor = dumptruckScene();
	const wheelCands = [ { id: 'c1', selector: '.rims', nodes: new Set( [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] ) } ];
	const a = resolveEmittedSelector( '.wheel', wheelCands, editor );
	const b = resolveEmittedSelector( '.rims', wheelCands, editor );
	assert.strictEqual( nodeSet( a ), 'Object_20,Object_21,Object_22,Object_23' );
	assert.strictEqual( nodeSet( a ), nodeSet( b ), 'node-set parity: .wheel and .rims are the same nodes' );
	// Both spellings canonicalize to the one host candidate → dedupe can merge them.
	assert.strictEqual( a.selector, b.selector );
	const merged = dedupeResolvedOps( [
		{ op: 'recolor', selector: a.selector, args: {}, nodes: a.nodes },
		{ op: 'recolor', selector: b.selector, args: {}, nodes: b.nodes },
	] );
	assert.strictEqual( merged.length, 1, 'same nodes + same op → one op' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail ) process.exit( 1 );
