// ── ai/editMatrix.js ──────────────────────────────────────────────────────────
// THE EVAL MATRIX — the 5 fuzzy tasks scored INDEPENDENTLY, across model sizes,
// in {bare, scaffolded} conditions, against a Haiku ceiling. The keystone that
// turns "implemented" into "validated" (see STRATA_EVAL_MATRIX work order).
//
//   ONE matrix:  5 tasks × model sizes × {bare, scaffolded}  (+ Haiku ceiling)
//
// The 5 tasks (the ENTIRE model surface):
//   1. op-type selection      request verb  → op           (exact-match classify)
//   2. selector resolution ★  request noun  → selector     (RESOLVED-CORRECT-NODE)
//   3. argument extraction    modifiers      → args         (correct or host-normalizable)
//   4. labeling (import)      descriptors    → human label  (fraction correct, by asset type)
//   5. multi-op decomposition request        → N ops        (right COUNT, each correct)
//
// Tasks 1/2/3/5 all surface in ONE generated edit, so `parseEmittedOps` extracts
// (op, selector, args, count) from the code and each task is scored separately —
// "per-task, not blended" (a blended score hides the cliff). Task 4 (labeling) is
// a separate probe over the descriptor table.
//
// PURE scorers + parser are node-unit-testable (no DOM). The browser runner is
// dependency-injected (drives the agentic loop, resolves selectors via the real
// selectorEngine, swaps conditions) — same shape as editEval.runEditEval.

import {
	SETUP_DUMPTRUCK, SETUP_MERGED_BED, SETUP_SHARED_WHEELS,
} from './editEval.js';

// ── TASK CASES (rows) ─────────────────────────────────────────────────────────
// Each case is one editing request with a per-task gold expectation. `targetNodes`
// is the resolved-correct-node truth set (node NAMES the selector must hit, and
// ONLY those). `opType`/`args`/`opCount` are the other task golds. `asset` selects
// the synthetic setup. `mergedFail` marks a case that must fail gracefully.

export const EDIT_TASK_CASES = [

	// op-selection + selector-resolution + arg-extraction (single op)
	{ id: 'wheels-black', asset: 'dumptruck', prompt: 'make the wheels black',
		expect: { opType: 'recolor', opCount: 1, args: { color: 'black' },
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },

	{ id: 'front-wheels', asset: 'dumptruck', prompt: 'make the front wheels red',
		expect: { opType: 'recolor', opCount: 1, args: { color: 'red' },
			targetNodes: [ 'Object_20', 'Object_21' ] } },          // compound selector

	{ id: 'dump-bed', asset: 'dumptruck', prompt: 'make the dump bed grey',
		expect: { opType: 'recolor', opCount: 1, args: { color: 'gray' },
			targetNodes: [ 'Object_07' ] } },                       // single labelled part

	{ id: 'grille', asset: 'dumptruck', prompt: 'paint the grille gold',
		expect: { opType: 'recolor', opCount: 1, args: { color: 'gold' },
			targetNodes: [ 'Object_03' ] } },                       // material-name resolution (lenient)

	{ id: 'bigger', asset: 'dumptruck', prompt: 'make it bigger',
		expect: { opType: 'scale', opCount: 1, args: { factor: { min: 1.05 } },
			targetNodes: [ 'DumpTruck' ] } },                       // whole-asset transform

	{ id: 'spin-wheels', asset: 'dumptruck', prompt: 'spin the wheels',
		expect: { opType: 'spin', opCount: 1,
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },

	{ id: 'lift', asset: 'dumptruck', prompt: 'lift the cab up a bit',
		expect: { opType: 'move', opCount: 1, args: { dy: { min: 0.01 } },
			targetNodes: [ 'Object_03' ] } },

	{ id: 'delete-front', asset: 'dumptruck', prompt: 'remove the front wheels',
		expect: { opType: 'delete', opCount: 1,
			targetNodes: [ 'Object_20', 'Object_21' ] } },

	// multi-op decomposition (must split into the RIGHT number — not under/over)
	{ id: 'two-colors', asset: 'dumptruck', prompt: 'make the wheels black and the bed red',
		expect: { opCount: 2,
			ops: [ { opType: 'recolor', targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_07' ] } ] } },

	{ id: 'no-oversplit', asset: 'dumptruck', prompt: 'make the wheels black',
		expect: { opCount: 1, opType: 'recolor',
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },  // must NOT over-split to 4

	// graceful-fail (merged mesh) — selector resolution must NOT hit "everything"
	{ id: 'merged-sheets', asset: 'merged-bed', prompt: 'make the bed sheets blue',
		expect: { mergedFail: true, target: 'GothicBed' } },
];

export const ASSET_SETUPS = {
	'dumptruck': SETUP_DUMPTRUCK,
	'merged-bed': SETUP_MERGED_BED,
	'shared-wheels': SETUP_SHARED_WHEELS,
};

// ── LABELING CASES (task 4) — scored separately, SPLIT by asset type ──────────
// Each: descriptor row (what the import harvest produces) + gold human label.
// `kind` splits the floor: material-named (strong hint) vs descriptor-only (weak).

export const LABELING_CASES = [
	{ kind: 'material-named', desc: 'leaf, round, low, pair(left), material:"Rims"', gold: [ 'wheel', 'tire', 'rim' ] },
	{ kind: 'material-named', desc: 'leaf, blocky, front, material:"Grille"', gold: [ 'grille' ] },
	{ kind: 'material-named', desc: 'leaf, small, back, pair(right), material:"Tail Light"', gold: [ 'tail light', 'taillight', 'light' ] },
	{ kind: 'descriptor-only', desc: 'leaf, large, open-top, center, largest', gold: [ 'bed', 'dump bed', 'tray', 'bucket' ] },
	{ kind: 'descriptor-only', desc: 'leaf, blocky, front, top', gold: [ 'cab', 'cabin', 'roof' ] },
	{ kind: 'descriptor-only', desc: 'leaf, round, low, pair(left)', gold: [ 'wheel', 'tire' ] },
];

// ── PARSER: generated code → emitted ops ──────────────────────────────────────
// Extracts the op surface the model emitted. Returns [{ op, selector, args }].
// Empty array = the model did NOT use the op surface (raw findObject/Set*Command);
// that correctly fails the op/selector/arg tasks (it didn't do the task the way
// the architecture requires). Tolerant of $S chains, op({...}), and ops([...]).

const ANIM_METHODS = new Set( [ 'spin', 'bounce', 'pulse', 'fade', 'orbit', 'shake' ] );

export function parseEmittedOps( code ) {

	if ( typeof code !== 'string' || ! code.trim() ) return [];
	const ops = [];

	// 1) $S('sel').m(args).m2(args)…  — a chainable set; each method is one op.
	//    Also tolerates the legacy $$ and the Pick/pick aliases.
	const chainRe = /(?:\$S|\$\$|Pick|pick)\(\s*['"]([^'"]+)['"]\s*\)((?:\s*\.\s*[A-Za-z_]\w*\s*\([^)]*\))+)/g;
	let m;
	while ( ( m = chainRe.exec( code ) ) !== null ) {

		const selector = m[ 1 ];
		const chain = m[ 2 ];
		const callRe = /\.\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
		let c;
		while ( ( c = callRe.exec( chain ) ) !== null ) {

			const method = c[ 1 ];
			if ( [ 'filter', 'each', 'result', 'op' ].includes( method ) && method !== 'op' ) continue;
			ops.push( { op: method === 'op' ? _opTypeFromArgs( c[ 2 ] ) : method, selector, args: _parseArgs( c[ 2 ] ) } );

		}

	}

	// 2) op({ type:'…', selector:'…', …args })   (also inside ops([ op({…}) ]))
	const opRe = /\bop\(\s*\{([^}]*)\}\s*\)/g;
	while ( ( m = opRe.exec( code ) ) !== null ) {

		const body = m[ 1 ];
		const type = _field( body, 'type' );
		const selector = _field( body, 'selector' );
		if ( type ) ops.push( { op: type, selector: selector || null, args: _objArgs( body ) } );

	}

	// 3) ops([ { type:'…', selector:'…', … }, … ])  — BARE op-objects in an array
	//    (the executable form: ops() maps each element through op()). op({…})
	//    elements are already handled by pass 2; strip them first so they are
	//    not double-counted, then read the remaining bare object literals.
	const opsArrRe = /\bops\(\s*\[([\s\S]*?)\]\s*\)/g;
	while ( ( m = opsArrRe.exec( code ) ) !== null ) {

		const arrBody = m[ 1 ].replace( /\bop\(\s*\{[^}]*\}\s*\)/g, '' );
		const objRe = /\{([^{}]*)\}/g;
		let o;
		while ( ( o = objRe.exec( arrBody ) ) !== null ) {

			const type = _field( o[ 1 ], 'type' );
			const selector = _field( o[ 1 ], 'selector' );
			if ( type ) ops.push( { op: type, selector: selector || null, args: _objArgs( o[ 1 ] ) } );

		}

	}

	return ops;

}

function _opTypeFromArgs( argStr ) { return _field( argStr, 'type' ) || 'op'; }

// Parse a positional/object arg string into a loose args bag. For chains the
// args are positional ($S('.x').recolor('#111') → ['#111']); we keep them as a
// raw positional array AND a guessed bag so the arg scorer can read either form.
function _parseArgs( argStr ) {

	const s = ( argStr || '' ).trim();
	if ( ! s ) return { _positional: [] };
	if ( s[ 0 ] === '{' ) return _objArgs( s );
	// split top-level commas (args here are simple literals)
	const parts = s.split( ',' ).map( p => _lit( p.trim() ) );
	return { _positional: parts };

}

function _objArgs( body ) {

	const out = {};
	const re = /([A-Za-z_]\w*)\s*:\s*('[^']*'|"[^"]*"|[-\d.]+|true|false|\[[^\]]*\])/g;
	let m;
	while ( ( m = re.exec( body ) ) !== null ) out[ m[ 1 ] ] = _lit( m[ 2 ] );
	return out;

}

function _field( body, key ) {

	const m = new RegExp( key + "\\s*:\\s*('[^']*'|\"[^\"]*\")" ).exec( body );
	return m ? _lit( m[ 1 ] ) : null;

}

function _lit( s ) {

	if ( s == null ) return s;
	s = String( s ).trim();
	if ( /^['"]/.test( s ) ) return s.slice( 1, -1 );
	if ( s === 'true' ) return true;
	if ( s === 'false' ) return false;
	if ( /^-?[\d.]+$/.test( s ) ) return parseFloat( s );
	return s;

}

// ── TASK SCORERS (pure) ───────────────────────────────────────────────────────

// Task 1 — op-type selection: exact-match classification.
export function scoreOpType( emitted, expect ) {

	if ( expect.mergedFail ) return { pass: true, reasons: [ 'n/a (merged-fail case)' ] };
	if ( emitted.length === 0 ) return { pass: false, reasons: [ 'no op emitted (used raw codegen?)' ] };

	// Multi-op cases carry per-op expected types; single carries expect.opType.
	if ( expect.ops ) {

		const ok = expect.ops.every( ( e, i ) => emitted[ i ] && emitted[ i ].op === e.opType );
		return { pass: ok, reasons: ok ? [] : [ 'op types did not match the decomposition' ] };

	}
	const ok = emitted[ 0 ].op === expect.opType;
	return { pass: ok, reasons: ok ? [] : [ `op "${ emitted[ 0 ].op }" ≠ expected "${ expect.opType }"` ] };

}

// Task 2 ★ — selector resolution: RESOLVED-CORRECT-NODE. `resolvedSets` is an
// array (one per emitted op) of the NODE-NAME sets the emitted selector actually
// resolved to (via the real selectorEngine, supplied by the runner). Pass =
// resolves to EXACTLY the expected nodes (right nodes, none extra → no bleed).
export function scoreSelectorResolution( resolvedSets, expect ) {

	if ( expect.mergedFail ) {

		// On a merged mesh, a part selector must NOT resolve to the whole-mesh-as-all.
		// Acceptable: resolves to nothing (then host explains). Failure: resolves to
		// the single merged node and proceeds (scored in graceful-fail too).
		const hitSomething = resolvedSets.some( s => s && s.size > 0 );
		return { pass: ! hitSomething, reasons: hitSomething ? [ 'selector resolved into a merged mesh' ] : [ 'correctly resolved nothing' ] };

	}

	const expectedList = expect.ops
		? expect.ops.map( e => new Set( e.targetNodes ) )
		: [ new Set( expect.targetNodes || [] ) ];

	const reasons = [];
	let pass = true;
	for ( let i = 0; i < expectedList.length; i ++ ) {

		const got = resolvedSets[ i ] || new Set();
		const want = expectedList[ i ];
		const missing = [ ...want ].filter( n => ! got.has( n ) );
		const extra = [ ...got ].filter( n => ! want.has( n ) );
		if ( missing.length ) { pass = false; reasons.push( `op${ i }: missed ${ missing.join( ',' ) }` ); }
		if ( extra.length ) { pass = false; reasons.push( `op${ i }: also changed ${ extra.join( ',' ) } (bleed)` ); }

	}
	return { pass, reasons: pass ? [ 'right nodes, nothing extra' ] : reasons };

}

// Task 3 — argument extraction: each expected arg present & correct, OR
// host-normalizable. `normalizeColor` is injected (host THREE.Color path); a
// color passes if it normalizes to the expected base. Numeric args may specify
// {min}/{max}/exact. Positional chain args are matched by op signature.
export function scoreArgExtraction( emitted, expect, deps = {} ) {

	if ( expect.mergedFail || ! expect.args ) return { pass: true, reasons: [ 'n/a' ] };
	if ( emitted.length === 0 ) return { pass: false, reasons: [ 'no op emitted' ] };

	const op = emitted[ 0 ];
	const bag = _argBag( op );
	const reasons = [];
	let pass = true;

	for ( const [ key, want ] of Object.entries( expect.args ) ) {

		const got = bag[ key ];
		if ( got === undefined ) { pass = false; reasons.push( `missing arg ${ key }` ); continue; }

		if ( key === 'color' ) {

			const base = deps.colorBase ? deps.colorBase( deps.normalizeColor ? deps.normalizeColor( got ) : got ) : String( got );
			if ( base !== want ) { pass = false; reasons.push( `color "${ got }"→${ base } ≠ ${ want }` ); }

		} else if ( want && typeof want === 'object' ) {

			const n = Number( got );
			if ( want.min != null && ! ( n >= want.min ) ) { pass = false; reasons.push( `${ key }=${ got } < min ${ want.min }` ); }
			if ( want.max != null && ! ( n <= want.max ) ) { pass = false; reasons.push( `${ key }=${ got } > max ${ want.max }` ); }

		} else if ( String( got ) !== String( want ) ) {

			pass = false; reasons.push( `${ key }=${ got } ≠ ${ want }` );

		}

	}
	return { pass, reasons: pass ? [ 'args ok' ] : reasons };

}

// Map an emitted op's args to a named bag keyed by the op's arg names, so the
// scorer can read color/factor/dy regardless of positional vs object form.
const SIG = {
	recolor: [ 'color' ], scale: [ 'factor', 'axis' ], move: [ 'dx', 'dy', 'dz' ],
	rotate: [ 'axis', 'degrees' ], duplicate: [ 'dx', 'dy', 'dz' ],
	spin: [ 'axis', 'turns', 'duration' ],
};
function _argBag( op ) {

	const a = op.args || {};
	if ( a._positional ) {

		const names = SIG[ op.op ] || [];
		const bag = {};
		a._positional.forEach( ( v, i ) => { if ( names[ i ] ) bag[ names[ i ] ] = v; } );
		return bag;

	}
	return a;

}

// Task 5 — multi-op decomposition: right NUMBER of ops (under AND over both fail).
export function scoreMultiOp( emitted, expect ) {

	if ( expect.mergedFail ) return { pass: true, reasons: [ 'n/a' ] };
	const want = expect.opCount != null ? expect.opCount : ( expect.ops ? expect.ops.length : 1 );
	const got = emitted.length;
	const ok = got === want;
	return { pass: ok, reasons: ok ? [ `${ got } op(s)` ] : [ `${ got } ops ≠ expected ${ want } (${ got < want ? 'under' : 'over' }-split)` ] };

}

// Task 4 — labeling: predicted label matches any gold synonym (lenient: substring
// either direction, normalized). Returns per-case pass; the runner aggregates by
// `kind` to expose the descriptor-only FLOOR.
export function scoreLabel( predicted, gold ) {

	const p = _norm( predicted );
	if ( ! p ) return { pass: false, reasons: [ 'no label' ] };
	const hit = gold.some( g => { const n = _norm( g ); return p === n || p.includes( n ) || n.includes( p ); } );
	return { pass: hit, reasons: hit ? [ `"${ predicted }"` ] : [ `"${ predicted }" ∉ {${ gold.join( ',' ) }}` ] };

}

function _norm( s ) { return String( s || '' ).toLowerCase().trim().replace( /[^a-z0-9 ]/g, '' ); }

// ── Aggregate one editing case across tasks 1/2/3/5 ───────────────────────────
// `resolvedSets`: per-emitted-op resolved node-name Sets (from the runner's
// selectorEngine). `deps`: { colorBase, normalizeColor }.
export function scoreMatrixCase( emitted, resolvedSets, expect, deps = {} ) {

	return {
		opType: scoreOpType( emitted, expect ),
		selectorResolution: scoreSelectorResolution( resolvedSets, expect ),
		argExtraction: scoreArgExtraction( emitted, expect, deps ),
		multiOp: scoreMultiOp( emitted, expect ),
	};

}

// ── Matrix accumulation + print ───────────────────────────────────────────────
// One cell per (task, model, condition). Accumulate across runs (you load each
// model / flip each condition and call recordRun); print the matrix at the end.

export function newMatrix() { return { cells: {}, models: new Set(), tasks: new Set() }; }

const TASK_ORDER = [ 'op-selection', 'selector-resolution', 'arg-extraction', 'labeling', 'multi-op' ];

export function recordRun( matrix, { model, condition, taskScores } ) {

	matrix.models.add( model );
	for ( const [ task, { passed, total } ] of Object.entries( taskScores ) ) {

		matrix.tasks.add( task );
		const key = `${ task }|${ model }|${ condition }`;
		matrix.cells[ key ] = { passed, total, pct: total ? Math.round( 100 * passed / total ) : 0 };

	}
	return matrix;

}

export function formatMatrix( matrix, opts = {} ) {

	// The ceiling column is the cloud benchmark model (Haiku) — auto-detect it by
	// id so the caller needn't pass the exact string. Falls back to none.
	const all = [ ...matrix.models ];
	const ceiling = opts.ceiling || all.find( m => /haiku|claude|gpt-|sonnet|opus/i.test( m ) ) || null;
	// Rows = ALL models (so a single ceiling-only run still prints its row); the
	// ceiling column repeats the ceiling's scaffolded score for comparison.
	const models = all;
	const tasks = TASK_ORDER.filter( t => matrix.tasks.has( t ) );
	const cell = ( t, m, c ) => { const x = matrix.cells[ `${ t }|${ m }|${ c }` ]; return x ? `${ x.pct }%` : ' · '; };

	const lines = [];
	lines.push( 'EVAL MATRIX — 5 tasks × model × {bare, scaffolded}   (ceiling: ' + ( ceiling || 'none yet' ) + ')' );
	lines.push( 'task                  model        bare   scaffolded   ' + ( ceiling || '' ) );
	lines.push( '─'.repeat( 64 ) );
	const short = ( m ) => String( m ).replace( /-\d{6,}$/, '' ).slice( 0, 12 );
	for ( const t of tasks ) {

		for ( const m of models ) {

			lines.push(
				t.padEnd( 22 ) + short( m ).padEnd( 13 ) +
				cell( t, m, 'bare' ).padEnd( 7 ) + cell( t, m, 'scaffolded' ).padEnd( 13 ) +
				( ceiling ? cell( t, ceiling, 'scaffolded' ) : '' ) );

		}
		lines.push( '' );

	}
	return lines.join( '\n' );

}

// ── DEPENDENCY-INJECTED RUNNER (browser) ──────────────────────────────────────
// deps: {
//   clearScene(), runSetup(code),                        // scene fixtures
//   runOnce(prompt) → Promise<{ code, text, execOk }>,   // drives the agentic loop, returns generated CODE
//   resolveSelector(selector) → Set<string>,             // real selectorEngine over the CURRENT scene → node names
//   colorBase, normalizeColor,                           // host arg-normalization (THREE.Color path)
//   labelOnce(descRow) → Promise<string>,                // task-4 probe: descriptor row → predicted label
//   condition: 'bare' | 'scaffolded',                    // flips scaffolding (constrained decode / arg-norm / one-op)
//   model: string,                                       // tag for the matrix (caller sets the loaded model)
// }
// Returns per-task {passed,total}. Call once per (model, condition); feed into recordRun.

export async function runEditMatrix( deps ) {

	const taskTally = {
		'op-selection': p(), 'selector-resolution': p(), 'arg-extraction': p(),
		'multi-op': p(), 'labeling': p(),
	};
	function p() { return { passed: 0, total: 0 }; }
	const bump = ( t, ok ) => { taskTally[ t ].total ++; if ( ok ) taskTally[ t ].passed ++; };

	const progress = deps.onProgress || ( () => {} );

	// Tasks 1/2/3/5 — ONE quiet generation per case (no agentic loop, no retries,
	// no execution). The model's first-shot code is parsed into ops and each task
	// scored independently; selectors resolve deterministically against the intact
	// setup scene (so we never mutate it — a delete case still resolves correctly).
	for ( let i = 0; i < EDIT_TASK_CASES.length; i ++ ) {

		const c = EDIT_TASK_CASES[ i ];
		await deps.clearScene();
		await deps.runSetup( ASSET_SETUPS[ c.asset ] );

		let emitted = [], code = '';
		try { const out = await deps.runOnce( c.prompt ); code = out && out.code || ''; emitted = parseEmittedOps( code ); }
		catch ( e ) { progress( `case ${ c.id }: generation error — ${ e.message }` ); }

		const resolvedSets = emitted.map( o => o.selector ? deps.resolveSelector( o.selector ) : new Set() );
		const s = scoreMatrixCase( emitted, resolvedSets, c.expect, deps );
		bump( 'op-selection', s.opType.pass );
		bump( 'selector-resolution', s.selectorResolution.pass );
		bump( 'arg-extraction', s.argExtraction.pass );
		bump( 'multi-op', s.multiOp.pass );
		progress( `edit ${ i + 1 }/${ EDIT_TASK_CASES.length } (${ c.id }): ${ emitted.length } op(s) emitted` );

		// Per-case detail for debugging WHY a cell is low (emitted selector/op vs
		// expected, pass/fail per task). Wired to the shell's debug flag.
		if ( deps.onCase ) deps.onCase( {
			id: c.id, prompt: c.prompt, code, emitted,
			emittedSel: emitted.map( o => `${ o.op }(${ o.selector || '?' })` ).join( ' ' ) || '(no op — raw codegen?)',
			pass: { op: s.opType.pass, sel: s.selectorResolution.pass, arg: s.argExtraction.pass, multi: s.multiOp.pass },
			reasons: { op: s.opType.reasons, sel: s.selectorResolution.reasons },
		} );

	}

	// Task 4 — labeling probe (descriptor row → label), split tracked by caller.
	for ( let i = 0; i < LABELING_CASES.length; i ++ ) {

		const lc = LABELING_CASES[ i ];
		let predicted = '';
		try { predicted = await deps.labelOnce( lc.desc ); } catch ( e ) { progress( `label error — ${ e.message }` ); }
		bump( 'labeling', scoreLabel( predicted, lc.gold ).pass );
		progress( `label ${ i + 1 }/${ LABELING_CASES.length } (${ lc.kind }): "${ predicted }"` );

	}

	return taskTally;

}
