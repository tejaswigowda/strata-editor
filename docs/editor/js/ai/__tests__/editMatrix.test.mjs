// Node test for the eval-matrix PURE surface (parser + scorers + fixtures). No
// DOM, no three.js — editMatrix.js only imports the SETUP_* strings from
// editEval.js. Run with an ABSOLUTE path from this folder:
//   node docs/editor/js/ai/__tests__/editMatrix.test.mjs
//
// Covers: expanded multi-op fixtures, the hardened multi-op scorer (count + type
// sequence + targets + trap-non-splitting), selector-resolution bleed, arg
// extraction, and the constrained-decode JSON op parsing (schema-shaped output).

import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const aiDir = path.resolve( here, '..' );

const M = await import( path.join( aiDir, 'editMatrix.js' ) );
const {
	EDIT_TASK_CASES, parseEmittedOps,
	scoreOpType, scoreSelectorResolution, scoreArgExtraction, scoreMultiOp, scoreMatrixCase, scoreLabel,
	opTypeMatches,
} = M;

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const setOf = ( ...n ) => new Set( n );

// Host color-normalization deps (mirror the browser THREE.Color path with a tiny
// lookup so arg-extraction can be tested without three.js).
const COLOR_HEX = { black: 0x111111, red: 0xff0000, gray: 0x888888, grey: 0x888888, gold: 0xffd700, blue: 0x0000ff };
const deps = {
	normalizeColor: ( c ) => {

		if ( typeof c === 'number' ) return c;
		const s = String( c ).trim().toLowerCase();
		if ( s in COLOR_HEX ) return COLOR_HEX[ s ];
		if ( /^#?[0-9a-f]{6}$/.test( s ) ) return parseInt( s.replace( '#', '' ), 16 );
		return null;

	},
	colorBase: ( hex ) => {

		// Map a normalized hex back to the canonical base name used in fixtures.
		const near = { black: 0x111111, red: 0xff0000, gray: 0x888888, gold: 0xffd700, blue: 0x0000ff };
		for ( const [ name, h ] of Object.entries( near ) ) if ( h === hex ) return name;
		return String( hex );

	},
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

test( 'multi-op fixture set is ~13 genuine decomposition cases', () => {

	const multi = EDIT_TASK_CASES.filter( c => c.expect && c.expect.multiOp );
	assert.strictEqual( multi.length, 13, `expected 13 multiOp cases, got ${ multi.length }` );

} );

test( 'every multi-op case has an opCount and either ops[] or a single opType', () => {

	for ( const c of EDIT_TASK_CASES.filter( c => c.expect.multiOp ) ) {

		assert.ok( c.expect.opCount != null, `${ c.id }: missing opCount` );
		assert.ok( c.expect.ops || c.expect.opType, `${ c.id }: needs ops[] or opType` );
		if ( c.expect.ops ) assert.strictEqual( c.expect.ops.length, c.expect.opCount, `${ c.id }: ops[] length ≠ opCount` );

	}

} );

test( 'trap cases (all-four / both / everything / co-reference) expect exactly 1 op', () => {

	for ( const id of [ 'all-four-wheels', 'both-lights', 'everything-red', 'wheels-and-rims', 'no-oversplit', 'whole-truck' ] ) {

		const c = EDIT_TASK_CASES.find( x => x.id === id );
		assert.ok( c, `missing trap case ${ id }` );
		assert.strictEqual( c.expect.opCount, 1, `${ id }: trap must expect 1 op` );

	}

} );

// ── Parser: JS surface ──────────────────────────────────────────────────────────

test( 'parseEmittedOps reads a $S chain (one op per method)', () => {

	const ops = parseEmittedOps( `$S('.wheel').recolor('#111')` );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'recolor' );
	assert.strictEqual( ops[ 0 ].selector, '.wheel' );

} );

test( 'parseEmittedOps reads op({type,selector,...})', () => {

	const ops = parseEmittedOps( `op({ type:'scale', selector:'#dumptruck', factor:2 })` );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'scale' );
	assert.strictEqual( ops[ 0 ].selector, '#dumptruck' );

} );

test( 'parseEmittedOps reads ops([ {type,…}, {type,…} ])', () => {

	const ops = parseEmittedOps( `ops([ { type:'recolor', selector:'.wheel', color:'black' }, { type:'recolor', selector:'.bed', color:'red' } ])` );
	assert.strictEqual( ops.length, 2 );
	assert.deepStrictEqual( ops.map( o => o.op ), [ 'recolor', 'recolor' ] );

} );

// ── Parser: constrained-decode JSON surface ─────────────────────────────────────

test( 'parseEmittedOps reads schema-shaped {"ops":[…]} JSON', () => {

	const out = '{"ops":[{"op":"recolor","selector":".wheel","args":{"color":"black"}}]}';
	const ops = parseEmittedOps( out );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'recolor' );
	assert.strictEqual( ops[ 0 ].selector, '.wheel' );
	assert.strictEqual( ops[ 0 ].args.color, 'black' );

} );

test( 'parseEmittedOps reads a multi-op {"ops":[…]} envelope', () => {

	const out = '{"ops":[{"op":"spin","selector":".wheel","args":{}},{"op":"recolor","selector":".bed","args":{"color":"grey"}}]}';
	const ops = parseEmittedOps( out );
	assert.deepStrictEqual( ops.map( o => o.op ), [ 'spin', 'recolor' ] );

} );

test( 'parseEmittedOps reads a bare {op,selector,args} object', () => {

	const ops = parseEmittedOps( '{"op":"delete","selector":".front.wheel","args":{}}' );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'delete' );

} );

test( 'parseEmittedOps reads one-JSON-per-line and inside ```json fences', () => {

	const perLine = '{"op":"recolor","selector":".wheel","args":{"color":"black"}}\n{"op":"recolor","selector":".bed","args":{"color":"red"}}';
	assert.strictEqual( parseEmittedOps( perLine ).length, 2 );
	const fenced = '```json\n{"ops":[{"op":"scale","selector":"#dumptruck","args":{"factor":2}}]}\n```';
	const ops = parseEmittedOps( fenced );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'scale' );

} );

test( 'parseEmittedOps preserves the raw escape in JSON form', () => {

	const ops = parseEmittedOps( '{"ops":[{"op":"raw","args":{"code":"editor.scene.rotation.y=1"}}]}' );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'raw' );
	assert.strictEqual( ops[ 0 ].selector, null );

} );

test( 'parseEmittedOps prefers the JS surface when BOTH are present (no double count)', () => {

	// A JS answer that also mentions a JSON blob must not be counted twice.
	const code = `op({ type:'recolor', selector:'.wheel', color:'black' })  // like {"op":"recolor"}`;
	const ops = parseEmittedOps( code );
	assert.strictEqual( ops.length, 1 );

} );

// ── Dropped-op RECOVERY (bounded to the 3 surveyed classes) ─────────────────────

test( 'CLASS 1 — recovers a direct .material.color.set(0xHEX) mutation as recolor', () => {

	const ops = parseEmittedOps( `$S('#dump-bed').material.color.set(0x888888)` );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'recolor' );
	assert.strictEqual( ops[ 0 ].selector, '#dump-bed' );
	assert.strictEqual( ops[ 0 ].args.color, '#888888' );  // 0x… normalized to #…

} );

test( 'CLASS 1 — raw mutation keeps SOURCE ORDER when mixed with named ops', () => {

	// three-ops: spin ; raw .material.color.set ; remove → [spin, recolor, remove] in order.
	const code = `$S('.wheel').spin('y',1,2); $S('#dump-bed').material.color.set(0xff0000); $S('.grille').remove();`;
	const ops = parseEmittedOps( code );
	assert.deepStrictEqual( ops.map( o => o.op ), [ 'spin', 'recolor', 'remove' ] );

} );

test( 'CLASS 2 — recovers a single editor.execute(new XxxCommand) block', () => {

	const code = `const o = findObject('wheel'); if(o){ editor.execute(new SetMaterialColorCommand(editor, o, 'color', 0xff0000)); }`;
	const ops = parseEmittedOps( code );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'recolor' );
	assert.strictEqual( ops[ 0 ].selector, '#wheel' );
	assert.strictEqual( ops[ 0 ].args.color, '#ff0000' );

} );

test( 'CLASS 2 — multiple execute() blocks decompose to N ops with mapped types + targets', () => {

	const code = `const cab = findObject('cab');
		if(cab){
			editor.execute(new SetMaterialColorCommand(editor, cab, 'color', 0x0000ff));
			editor.execute(new SetPositionCommand(editor, cab, new Vector3(cab.position.x, cab.position.y+1, cab.position.z)));
			editor.execute(new RemoveObjectCommand(editor, findObject('front wheels')));
		}`;
	const ops = parseEmittedOps( code );
	assert.deepStrictEqual( ops.map( o => o.op ), [ 'recolor', 'move', 'delete' ] );
	assert.deepStrictEqual( ops.map( o => o.selector ), [ '#cab', '#cab', '#front-wheels' ] );

} );

test( 'CLASS 3 — unpacks a `material: new MeshXxxMaterial({color})` arg instead of dropping the op', () => {

	const ops = parseEmittedOps( `ops([{ type:'setMaterial', selector:'grille', material: new MeshStandardMaterial({ color: 0xffd700, roughness: 0.5, metalness: 0 }) }])` );
	assert.strictEqual( ops.length, 1 );
	assert.ok( ops[ 0 ].op === 'setMaterial' || ops[ 0 ].op === 'recolor' );
	assert.strictEqual( ops[ 0 ].selector, 'grille' );
	assert.strictEqual( ops[ 0 ].args.color, '#ffd700' );

} );

test( 'CLASS 3 — a material-ctor element no longer swallows a sibling recolor op', () => {

	const code = `ops([
		{ type:'recolor', selector:'.wheel', color:'#111' },
		{ type:'material', selector:'.grille', material: new MeshLambertMaterial({ color: 0xffd700, roughness: 0.5 }) }
	])`;
	const ops = parseEmittedOps( code );
	assert.strictEqual( ops.length, 2 );
	assert.strictEqual( ops[ 1 ].args.color, '#ffd700' );

} );

test( 'BOUNDED — an unknown edit form drops to [] (no half-parsing into wrong ops)', () => {

	assert.deepStrictEqual( parseEmittedOps( `doSomethingWeird(42); frobnicate(); scene.traverse(x=>x);` ), [] );

} );

test( 'NO DOUBLE COUNT — a canonical named-op chain stays exactly one op', () => {

	// `.recolor` is a named op (pass 1); the CLASS-1 raw-mutation pass requires
	// `.material/.position/.scale/.rotation .` and must NOT also fire here.
	const ops = parseEmittedOps( `$S('.wheel').recolor('#111')` );
	assert.strictEqual( ops.length, 1 );
	assert.strictEqual( ops[ 0 ].op, 'recolor' );

} );

// ── Scorer: op-type ─────────────────────────────────────────────────────────────

test( 'scoreOpType matches single and multi-op sequences', () => {

	assert.ok( scoreOpType( [ { op: 'recolor' } ], { opType: 'recolor' } ).pass );
	assert.ok( ! scoreOpType( [ { op: 'scale' } ], { opType: 'recolor' } ).pass );
	assert.ok( scoreOpType( [ { op: 'spin' }, { op: 'recolor' } ], { ops: [ { opType: 'spin' }, { opType: 'recolor' } ] } ).pass );

} );

// ── Scorer: selector resolution (bleed) ─────────────────────────────────────────

test( 'scoreSelectorResolution fails on missing and on extra (bleed)', () => {

	const expect = { targetNodes: [ 'Object_20', 'Object_21' ] };
	assert.ok( scoreSelectorResolution( [ setOf( 'Object_20', 'Object_21' ) ], expect ).pass );
	assert.ok( ! scoreSelectorResolution( [ setOf( 'Object_20' ) ], expect ).pass, 'missing must fail' );
	assert.ok( ! scoreSelectorResolution( [ setOf( 'Object_20', 'Object_21', 'Object_22' ) ], expect ).pass, 'bleed must fail' );

} );

test( 'scoreSelectorResolution merged-fail: resolving anything fails', () => {

	assert.ok( scoreSelectorResolution( [ setOf() ], { mergedFail: true } ).pass );
	assert.ok( ! scoreSelectorResolution( [ setOf( 'GothicBed' ) ], { mergedFail: true } ).pass );

} );

// ── Scorer: multi-op (count + type sequence + targets + traps) ───────────────────

const twoColors = EDIT_TASK_CASES.find( c => c.id === 'two-colors' );
const wheelSet = setOf( 'Object_20', 'Object_21', 'Object_22', 'Object_23' );
const bedSet = setOf( 'Object_07' );

test( 'scoreMultiOp passes a correct 2-op decomposition (count+types+targets)', () => {

	const emitted = [ { op: 'recolor' }, { op: 'recolor' } ];
	const resolved = [ wheelSet, bedSet ];
	assert.ok( scoreMultiOp( emitted, twoColors.expect, resolved ).pass );

} );

test( 'scoreMultiOp FAILS on wrong count (under-split)', () => {

	const r = scoreMultiOp( [ { op: 'recolor' } ], twoColors.expect, [ wheelSet ] );
	assert.ok( ! r.pass );
	assert.match( r.reasons[ 0 ], /under-split/ );

} );

test( 'scoreMultiOp FAILS on wrong op-type sequence', () => {

	const emitted = [ { op: 'recolor' }, { op: 'delete' } ];   // 2nd should be recolor
	assert.ok( ! scoreMultiOp( emitted, twoColors.expect, [ wheelSet, bedSet ] ).pass );

} );

test( 'scoreMultiOp FAILS on right count/type but WRONG targets', () => {

	const emitted = [ { op: 'recolor' }, { op: 'recolor' } ];
	const wrong = [ wheelSet, setOf( 'Object_03' ) ];   // 2nd op hit the cab, not the bed
	const r = scoreMultiOp( emitted, twoColors.expect, wrong );
	assert.ok( ! r.pass, 'wrong-target decomposition must fail multi-op' );
	assert.match( r.reasons[ 0 ], /wrong target/ );

} );

test( 'scoreMultiOp trap: over-splitting a 1-op request FAILS', () => {

	const trap = EDIT_TASK_CASES.find( c => c.id === 'all-four-wheels' );
	// Model emitted 4 per-wheel recolors instead of one set op.
	const emitted = [ { op: 'recolor' }, { op: 'recolor' }, { op: 'recolor' }, { op: 'recolor' } ];
	const resolved = [ setOf( 'Object_20' ), setOf( 'Object_21' ), setOf( 'Object_22' ), setOf( 'Object_23' ) ];
	const r = scoreMultiOp( emitted, trap.expect, resolved );
	assert.ok( ! r.pass, 'over-split trap must fail' );
	assert.match( r.reasons[ 0 ], /over-split/ );

} );

test( 'scoreMultiOp trap: correct single set op PASSES', () => {

	const trap = EDIT_TASK_CASES.find( c => c.id === 'all-four-wheels' );
	assert.ok( scoreMultiOp( [ { op: 'recolor' } ], trap.expect, [ wheelSet ] ).pass );

} );

test( 'scoreMultiOp without resolvedSets still checks count + types (back-compat)', () => {

	assert.ok( scoreMultiOp( [ { op: 'recolor' }, { op: 'recolor' } ], twoColors.expect ).pass );
	assert.ok( ! scoreMultiOp( [ { op: 'recolor' } ], twoColors.expect ).pass );

} );

test( 'opTypeMatches accepts spin/rotate and delete/remove synonyms', () => {

	assert.ok( opTypeMatches( { op: 'rotate' }, 'spin' ) );
	assert.ok( opTypeMatches( { op: 'spin' }, 'rotate' ) );
	assert.ok( opTypeMatches( { op: 'remove' }, 'delete' ) );
	assert.ok( ! opTypeMatches( { op: 'scale' }, 'move' ) );

} );

test( 'opTypeMatches: setMaterial ≈ recolor ONLY when color-only', () => {

	assert.ok( opTypeMatches( { op: 'setMaterial', args: { color: '#0000ff', roughness: 0.7 } }, 'recolor' ) );
	assert.ok( ! opTypeMatches( { op: 'setMaterial', args: { roughness: 0.7, metalness: 0.3 } }, 'recolor' ) );

} );

test( 'scoreMultiOp accepts a synonym decomposition (constrained schema names)', () => {

	const spinColor = EDIT_TASK_CASES.find( c => c.id === 'spin-and-color' );  // [spin, recolor]
	const emitted = [ { op: 'rotate' }, { op: 'setMaterial', args: { color: '#888888' } } ];
	assert.ok( scoreMultiOp( emitted, spinColor.expect ).pass, 'rotate≈spin + color-only setMaterial≈recolor' );

} );

test( 'scoreMultiOp target check: plural over-coverage passes, missing fails', () => {

	// op2 hits the bed AND an extra node — plural over-coverage is not a decomposition
	// failure (bleed is the selector-resolution axis); only a MISS fails here.
	const over = [ wheelSet, setOf( 'Object_07', 'Object_99' ) ];
	assert.ok( scoreMultiOp( [ { op: 'recolor' }, { op: 'recolor' } ], twoColors.expect, over ).pass );
	const miss = [ wheelSet, setOf( 'Object_03' ) ];   // op2 never hits the bed
	const r = scoreMultiOp( [ { op: 'recolor' }, { op: 'recolor' } ], twoColors.expect, miss );
	assert.ok( ! r.pass );
	assert.match( r.reasons[ 0 ], /wrong target/ );

} );

// ── Scorer: arg extraction (JSON args from constrained output) ───────────────────

test( 'scoreArgExtraction reads color from JSON args and normalizes it', () => {

	const emitted = parseEmittedOps( '{"ops":[{"op":"recolor","selector":".wheel","args":{"color":"black"}}]}' );
	const r = scoreArgExtraction( emitted, { args: { color: 'black' } }, deps );
	assert.ok( r.pass, r.reasons.join( '; ' ) );

} );

test( 'scoreArgExtraction range arg (duration ≥ 3) passes on 4, fails on default', () => {

	assert.ok( scoreArgExtraction( [ { op: 'spin', args: { duration: 4 } } ], { args: { duration: { min: 3 } } }, deps ).pass );
	assert.ok( ! scoreArgExtraction( [ { op: 'spin', args: { duration: 2 } } ], { args: { duration: { min: 3 } } }, deps ).pass );

} );

// ── Aggregate ───────────────────────────────────────────────────────────────────

test( 'scoreMatrixCase forwards resolvedSets to the multi-op scorer', () => {

	const emitted = [ { op: 'recolor' }, { op: 'recolor' } ];
	// Wrong 2nd target → selectorResolution AND multiOp both fail.
	const s = scoreMatrixCase( emitted, [ wheelSet, setOf( 'Object_03' ) ], twoColors.expect, deps );
	assert.ok( ! s.multiOp.pass, 'multiOp should fail on wrong target' );
	assert.ok( ! s.selectorResolution.pass, 'selectorResolution should also fail' );

} );

test( 'scoreLabel is lenient substring either direction', () => {

	assert.ok( scoreLabel( 'wheel', [ 'wheel', 'tire' ] ).pass );
	assert.ok( scoreLabel( 'front wheel', [ 'wheel' ] ).pass );
	assert.ok( ! scoreLabel( 'engine', [ 'wheel', 'tire' ] ).pass );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
