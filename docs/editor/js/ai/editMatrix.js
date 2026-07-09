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

	{ id: 'spin-wheels', asset: 'dumptruck', prompt: 'spin the wheels slowly',
		expect: { opType: 'spin', opCount: 1, args: { duration: { min: 3 } },
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },
	// ↑ "slowly" is the DURATION arg-extract case. RANGE target, not an exact number:
	// "slowly" has no single canonical value, so any duration slower than the default
	// (2) passes — ≥3, canonical ≈4 (see AIUtils "slowly≈dur4"). Omitting duration, or
	// picking the default/faster, correctly FAILS: the model didn't extract the modifier.

	{ id: 'lift', asset: 'dumptruck', prompt: 'lift the cab up a bit',
		expect: { opType: 'move', opCount: 1, args: { dy: { min: 0.01 } },
			targetNodes: [ 'Object_03' ] } },

	{ id: 'delete-front', asset: 'dumptruck', prompt: 'remove the front wheels',
		expect: { opType: 'delete', opCount: 1,
			targetNodes: [ 'Object_20', 'Object_21' ] } },

	// multi-op decomposition — the ONLY task-5 denominator (gated by multiOp:true in
	// the runner). Scored where op COUNT is the discriminator: compound requests that
	// must split into N, and traps that must NOT over-split. Single-op cases are NOT
	// counted here — emitting exactly 1 op on a single request is trivial and used to
	// inflate multi-op to ~9/11 for any coder model while a raw-JS model (0 parsed ops)
	// scored 0 everywhere. That artifact (1.5B-bare 91% > frontier-bare 9%) is the bug.
	{ id: 'two-colors', asset: 'dumptruck', prompt: 'make the wheels black and the bed red',
		expect: { multiOp: true, opCount: 2,
			ops: [ { opType: 'recolor', targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_07' ] } ] } },

	{ id: 'three-ops', asset: 'dumptruck', prompt: 'spin the wheels, paint the bed red, and remove the grille',
		expect: { multiOp: true, opCount: 3,
			ops: [ { opType: 'spin', targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_07' ] },
				{ opType: 'delete', targetNodes: [ 'Object_03' ] } ] } },

	{ id: 'no-oversplit', asset: 'dumptruck', prompt: 'make the wheels black',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },  // must NOT over-split to 4

	{ id: 'whole-truck', asset: 'dumptruck', prompt: 'paint the whole truck red',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'DumpTruck' ] } },                       // must NOT over-split per-part

	// ── expanded multi-op set ─────────────────────────────────────────────────
	// More genuine decompositions (clean N-splits, mixed op-types, same-target
	// different-op) AND more traps (co-reference, "all/both", whole-asset) so the
	// task-5 denominator is ~13 and a coder model can't inflate it by splitting
	// everything: half the set PUNISHES over-splitting.

	// clean 2-op splits — two parts, two recolors
	{ id: 'wheels-and-grille', asset: 'dumptruck', prompt: 'make the wheels black and paint the grille gold',
		expect: { multiOp: true, opCount: 2,
			ops: [ { opType: 'recolor', targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_03' ] } ] } },

	// 2-op split, DIFFERENT op-types (recolor + delete)
	{ id: 'bed-and-lights', asset: 'dumptruck', prompt: 'paint the bed red and remove the tail lights',
		expect: { multiOp: true, opCount: 2,
			ops: [ { opType: 'recolor', targetNodes: [ 'Object_07' ] },
				{ opType: 'delete', targetNodes: [ 'Object_12', 'Object_13' ] } ] } },

	// 2-op split, animate + recolor
	{ id: 'spin-and-color', asset: 'dumptruck', prompt: 'spin the wheels and make the bed grey',
		expect: { multiOp: true, opCount: 2,
			ops: [ { opType: 'spin', targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_07' ] } ] } },

	// 2 ops on the SAME target, different op-types (must still be 2, not merged to 1)
	{ id: 'lift-and-paint', asset: 'dumptruck', prompt: 'lift the cab up and paint it blue',
		expect: { multiOp: true, opCount: 2,
			ops: [ { opType: 'move', targetNodes: [ 'Object_03' ] },
				{ opType: 'recolor', targetNodes: [ 'Object_03' ] } ] } },

	// 3-op split across three op-types and three parts
	{ id: 'color-move-delete', asset: 'dumptruck', prompt: 'paint the cab blue, move the bed up, and delete the front wheels',
		expect: { multiOp: true, opCount: 3,
			ops: [ { opType: 'recolor', targetNodes: [ 'Object_03' ] },
				{ opType: 'move', targetNodes: [ 'Object_07' ] },
				{ opType: 'delete', targetNodes: [ 'Object_20', 'Object_21' ] } ] } },

	// TRAP — "all four" is ONE set op over the wheels, NOT four ops
	{ id: 'all-four-wheels', asset: 'dumptruck', prompt: 'make all four wheels black',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },

	// TRAP — "both" tail lights is ONE op, not two
	{ id: 'both-lights', asset: 'dumptruck', prompt: 'make both tail lights bright red',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'Object_12', 'Object_13' ] } },

	// TRAP — "everything" is the whole asset, ONE op (not one-per-part)
	{ id: 'everything-red', asset: 'dumptruck', prompt: 'make everything red',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'DumpTruck' ] } },

	// TRAP — ambiguous count via CO-REFERENCE: ".wheel" and ".rims" name the SAME
	// four nodes, so "the wheels and rims" is ONE op, not two.
	{ id: 'wheels-and-rims', asset: 'dumptruck', prompt: 'darken the wheels and rims',
		expect: { multiOp: true, opCount: 1, opType: 'recolor',
			targetNodes: [ 'Object_20', 'Object_21', 'Object_22', 'Object_23' ] } },

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
// Each: descriptor row (VERBATIM the import harvest's labelPass.row output — first
// token is the graph ROLE "leaf"=a mesh) + `asset` context + gold human label(s).
// `kind` splits the floor: material-named (strong hint) vs descriptor-only (weak).
//
// FAIRNESS: production labeling hands the LLM the WHOLE part table with a schema-
// explaining system prompt (labelPass.LABEL_SYSTEM: "first the role, then shape…
// MATERIAL name is a STRONG hint") — so it can infer the vehicle and read the row.
// The eval must not be HARDER than production: `asset` supplies the context prod
// gets from the full table, and the SCAFFOLDED probe (Shell.labelOnce) explains the
// row schema. The BARE probe omits both = the honest floor. gold accepts synonyms
// (scoreLabel is substring-either-direction) so valid variants are not rejected.

export const LABELING_CASES = [
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, round, low, pair(left), material:"Rims"', gold: [ 'wheel', 'tire', 'rim' ] },
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, blocky, front, material:"Grille"', gold: [ 'grille', 'grill' ] },
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, small, back, pair(right), material:"Tail Light"', gold: [ 'tail light', 'taillight', 'light', 'lamp' ] },
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, flat, front, low, material:"Bumper"', gold: [ 'bumper', 'fender', 'guard' ] },
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, transparent, front, top, material:"Windshield"', gold: [ 'windshield', 'windscreen', 'window', 'glass' ] },
	{ kind: 'material-named', asset: 'dump truck', desc: 'leaf, round, low, pair(right), material:"Rims"', gold: [ 'wheel', 'tire', 'rim' ] },
	{ kind: 'descriptor-only', asset: 'dump truck', desc: 'leaf, large, open-top, center, largest', gold: [ 'bed', 'dump bed', 'tray', 'bucket', 'cargo', 'flatbed', 'container' ] },
	{ kind: 'descriptor-only', asset: 'dump truck', desc: 'leaf, blocky, front, top', gold: [ 'cab', 'cabin', 'roof', 'canopy' ] },
	{ kind: 'descriptor-only', asset: 'dump truck', desc: 'leaf, round, low, pair(left)', gold: [ 'wheel', 'tire' ] },
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
		const base = m.index;
		const callRe = /\.\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
		let c;
		while ( ( c = callRe.exec( chain ) ) !== null ) {

			const method = c[ 1 ];
			if ( [ 'filter', 'each', 'result', 'op' ].includes( method ) && method !== 'op' ) continue;
			ops.push( { op: method === 'op' ? _opTypeFromArgs( c[ 2 ] ) : method, selector, args: _parseArgs( c[ 2 ] ), _i: base + c.index } );

		}

	}

	// 1b) CLASS 1 — a $S('sel') target followed by a RAW three.js property mutation
	//     (.material.color.set / .position.set / .scale.set / .rotation.set, or a
	//     .position.<axis> = n assignment) instead of a named op. The selector is
	//     there; the edit is a direct property set. Recover → canonical op. (Does not
	//     collide with named-op chains: those are `.method(` not `.prop.prop`.)
	_parseDirectMutations( code, ops );

	// 2) op({ type:'…', selector:'…', …args })   (also inside ops([ op({…}) ]))
	const opRe = /\bop\(\s*\{([^}]*)\}\s*\)/g;
	while ( ( m = opRe.exec( code ) ) !== null ) {

		const body = m[ 1 ];
		const type = _field( body, 'type' );
		const selector = _field( body, 'selector' );
		if ( type ) ops.push( { op: type, selector: selector || null, args: _opObjArgs( body ), _i: m.index } );

	}

	// 3) ops([ { type:'…', selector:'…', … }, … ])  — BARE op-objects in an array
	//    (the executable form: ops() maps each element through op()). op({…})
	//    elements are already handled by pass 2; strip them first so they are
	//    not double-counted, then read the remaining bare object literals with a
	//    BRACE-BALANCED scan (CLASS 3: a `material: new MeshXxxMaterial({color:…})`
	//    arg has nested braces — the old innermost-brace scan matched the material's
	//    inner object (no `type`) and DROPPED the whole op; balanced scan + arg
	//    unpacking recovers it).
	const opsArrRe = /\bops\(\s*\[([\s\S]*?)\]\s*\)/g;
	while ( ( m = opsArrRe.exec( code ) ) !== null ) {

		const arrBody = m[ 1 ].replace( /\bop\(\s*\{[^}]*\}\s*\)/g, '' );
		const base = m.index;
		for ( const obj of _extractJsonObjects( arrBody ) ) {

			const type = _field( obj, 'type' );
			if ( ! type ) continue;
			const selector = _field( obj, 'selector' );
			ops.push( { op: type, selector: selector || null, args: _opObjArgs( obj ), _i: base + arrBody.indexOf( obj ) } );

		}

	}

	// 3b) CLASS 2 — editor.execute(new XxxCommand(editor, target, …)) — the old
	//     command-object generation style, usually with `const o = findObject('name');
	//     if(o){ execute(…) }`. Each execute() block is one op; multiple blocks → N
	//     ops. Command class → canonical op; target from findObject(); value normalized.
	_parseCommandForms( code, ops );

	// 4) CONSTRAINED-DECODE form — pure JSON op(s). The 'constrained' condition
	//    forces schema-valid JSON ({ "ops":[ { "op","selector","args" } ] }, a bare
	//    { "op",… }, a top-level array, or one-JSON-per-line), NOT the $S/op() JS
	//    surface. Only run this when the JS passes found nothing, so a code answer
	//    that merely mentions JSON isn't double-counted.
	if ( ops.length === 0 ) return _parseJsonOps( code );

	// Emit in SOURCE ORDER — a mix of named-op chains and recovered raw mutations
	// (e.g. spin; .material.color.set; remove) must keep the order the model wrote so
	// the decomposition type-sequence is scored correctly. Strip the sort key.
	ops.sort( ( a, b ) => ( a._i || 0 ) - ( b._i || 0 ) );
	return ops.map( ( { _i, ...rest } ) => rest );

}

// ── DROPPED-OP RECOVERY (bounded to the 3 surveyed classes) ───────────────────

// Normalize a color literal to '#rrggbb': 0xRRGGBB → #rrggbb, #RGB/#RRGGBB → lower,
// leave named colors / already-normal strings untouched.
function _hexColor( v ) {

	if ( v == null ) return v;
	let s = String( v ).trim().replace( /^['"]|['"]$/g, '' );
	const hx = /^0x([0-9a-fA-F]+)$/.exec( s );
	if ( hx ) {

		let h = hx[ 1 ].toLowerCase();
		if ( h.length === 3 ) h = h.split( '' ).map( ch => ch + ch ).join( '' );
		if ( h.length < 6 ) h = h.padStart( 6, '0' );
		return '#' + h;

	}
	if ( /^#[0-9a-fA-F]{3,8}$/.test( s ) ) return s.toLowerCase();
	return s;

}

// Pull the numeric literals out of a string (ignores identifiers / member exprs).
function _nums( s ) {

	return ( String( s || '' ).match( /-?\d*\.?\d+/g ) || [] ).map( Number ).filter( n => ! Number.isNaN( n ) );

}

// Slice the paren-balanced argument list starting at the '(' index `open`.
function _balancedParens( s, open ) {

	let depth = 0;
	for ( let i = open; i < s.length; i ++ ) {

		if ( s[ i ] === '(' ) depth ++;
		else if ( s[ i ] === ')' ) { depth --; if ( depth === 0 ) return s.slice( open + 1, i ); }

	}
	return s.slice( open + 1 );

}

// _objArgs + CLASS-3 unpack: if an op object carries `material: new MeshXxxMaterial(
// { color:…, roughness:…, metalness:… } )`, lift those fields into args instead of
// dropping them. (op-type stays as emitted; opTypeMatches folds a color-only
// setMaterial into recolor at scoring time.)
function _opObjArgs( body ) {

	const args = _objArgs( body );
	const mat = /new\s+Mesh\w*Material\s*\(\s*\{([^}]*)\}/.exec( body );
	if ( mat ) {

		const inner = mat[ 1 ];
		const col = /\bcolor\s*:\s*(0x[0-9a-fA-F]+|'[^']*'|"[^"]*"|#[0-9a-fA-F]{3,8})/.exec( inner );
		if ( col && args.color == null ) args.color = _hexColor( col[ 1 ] );
		const rough = /\broughness\s*:\s*(-?[\d.]+)/.exec( inner );
		if ( rough && args.roughness == null ) args.roughness = parseFloat( rough[ 1 ] );
		const metal = /\bmetalness\s*:\s*(-?[\d.]+)/.exec( inner );
		if ( metal && args.metalness == null ) args.metalness = parseFloat( metal[ 1 ] );

	}
	if ( args.color != null ) args.color = _hexColor( args.color );
	return args;

}

// CLASS 1 — direct three.js property mutation on a $S/selected target.
const _MUT_OP = { material: 'recolor', position: 'move', scale: 'scale', rotation: 'rotate', quaternion: 'rotate' };
function _parseDirectMutations( code, ops ) {

	// $S('sel') . (material|position|scale|rotation|quaternion) . <tail> ( args )   — .set(…) form
	//                                                          . <tail> = value      — assignment form
	const re = /(?:\$S|\$\$|Pick|pick)\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*(material|position|scale|rotation|quaternion)\s*\.\s*([\w.]+?)\s*(?:\(\s*([^)]*)\)|(\+?=)\s*([^;\n]+))/g;
	let m;
	while ( ( m = re.exec( code ) ) !== null ) {

		const selector = m[ 1 ];
		const prop = m[ 2 ];
		const tail = m[ 3 ] || '';            // e.g. 'color.set', 'set', 'x'
		const callArgs = m[ 4 ];              // inside .set( … )
		const assignVal = m[ 6 ];             // after =
		const op = _MUT_OP[ prop ];
		const src = ( callArgs != null ? callArgs : ( assignVal || '' ) );
		let args = {};
		if ( op === 'recolor' ) {

			args = { color: _hexColor( src.split( ',' )[ 0 ] ) };

		} else if ( op === 'move' ) {

			const n = _nums( src );
			if ( callArgs != null && n.length >= 3 ) args = { dx: n[ 0 ], dy: n[ 1 ], dz: n[ 2 ] };
			else if ( n.length ) { const ax = ( tail.split( '.' ).pop() || '' ).toLowerCase(); args = ax && 'xyz'.includes( ax ) ? { [ 'd' + ax ]: n[ 0 ] } : { dy: n[ 0 ] }; }

		} else if ( op === 'scale' ) {

			const n = _nums( src ); if ( n.length ) args = { factor: n[ 0 ] };

		} else if ( op === 'rotate' ) {

			const n = _nums( src );
			if ( callArgs != null && n.length >= 3 ) args = { x: n[ 0 ], y: n[ 1 ], z: n[ 2 ] };
			else if ( n.length ) { const ax = ( tail.split( '.' ).pop() || '' ).toLowerCase(); args = { axis: 'xyz'.includes( ax ) ? ax : 'y', degrees: n[ 0 ] }; }

		}
		ops.push( { op, selector, args, _i: m.index } );

	}

}

// CLASS 2 — editor.execute(new XxxCommand(editor, target, …value)) command form.
const _CMD_OP = {
	SetMaterialColorCommand: 'recolor', SetColorCommand: 'recolor', SetMaterialValueCommand: 'recolor',
	SetPositionCommand: 'move', SetRotationCommand: 'rotate', SetScaleCommand: 'scale',
	RemoveObjectCommand: 'delete',
};
function _parseCommandForms( code, ops ) {

	// Map local vars assigned from findObject('name') so a command referencing the var
	// still resolves its target (const cab = findObject('cab'); … execute(new …(editor, cab, …))).
	const varMap = {};
	const vr = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*findObject\(\s*['"]([^'"]+)['"]\s*\)/g;
	let v; while ( ( v = vr.exec( code ) ) !== null ) varMap[ v[ 1 ] ] = v[ 2 ];

	const cr = /new\s+([A-Za-z_]\w*Command)\s*\(/g;
	let m;
	while ( ( m = cr.exec( code ) ) !== null ) {

		const op = _CMD_OP[ m[ 1 ] ];
		if ( ! op ) continue;                                   // bounded: unseen command → leave dropped
		const argStr = _balancedParens( code, m.index + m[ 0 ].length - 1 );

		let name = null;
		const fo = /findObject\(\s*['"]([^'"]+)['"]\s*\)/.exec( argStr );
		if ( fo ) name = fo[ 1 ];
		else {

			const ir = /\b([A-Za-z_$][\w$]*)\b/g; let im;
			while ( ( im = ir.exec( argStr ) ) !== null ) { if ( varMap[ im[ 1 ] ] ) { name = varMap[ im[ 1 ] ]; break; } }

		}
		const selector = name ? '#' + name.trim().replace( /\s+/g, '-' ) : null;
		ops.push( { op, selector, args: _cmdArgs( op, argStr ), _i: m.index } );

	}

}

function _cmdArgs( op, argStr ) {

	if ( op === 'recolor' ) {

		const h = /0x[0-9a-fA-F]+|#[0-9a-fA-F]{3,8}/.exec( argStr );
		return h ? { color: _hexColor( h[ 0 ] ) } : {};

	}
	if ( op === 'move' ) {

		const vec = /new\s+Vector3\s*\(([^)]*)\)/.exec( argStr );
		const n = _nums( vec ? vec[ 1 ] : '' );
		return n.length >= 3 ? { dx: n[ 0 ], dy: n[ 1 ], dz: n[ 2 ] } : ( n.length ? { dy: n[ n.length - 1 ] } : {} );

	}
	if ( op === 'rotate' ) {

		const eul = /new\s+Euler\s*\(([^)]*)\)/.exec( argStr );
		const n = _nums( eul ? eul[ 1 ] : '' );
		return n.length ? { x: n[ 0 ], y: n[ 1 ], z: n[ 2 ] } : {};

	}
	if ( op === 'scale' ) {

		const vec = /new\s+Vector3\s*\(([^)]*)\)/.exec( argStr );
		const n = _nums( vec ? vec[ 1 ] : argStr.replace( /findObject\([^)]*\)/g, '' ) );
		return n.length ? { factor: n[ 0 ] } : {};

	}
	return {};

}

// Parse the constrained-decode JSON op surface into the same [{op,selector,args}]
// shape. Accepts { ops:[…] }, a bare op object, a top-level array, or multiple
// brace-balanced JSON objects (one-per-line / fenced). Unknown shapes → [].
function _parseJsonOps( code ) {

	const out = [];
	const push = ( obj ) => {

		if ( ! obj || typeof obj !== 'object' ) return;
		if ( Array.isArray( obj ) ) { obj.forEach( push ); return; }
		if ( Array.isArray( obj.ops ) ) { obj.ops.forEach( push ); return; }
		const type = obj.op || obj.type;
		if ( typeof type === 'string' ) out.push( {
			op: type,
			selector: typeof obj.selector === 'string' ? obj.selector : null,
			args: obj.args && typeof obj.args === 'object' ? obj.args : {},
		} );

	};

	const trimmed = String( code || '' ).trim();
	try { push( JSON.parse( trimmed ) ); if ( out.length ) return out; } catch ( e ) { /* fall through */ }

	for ( const blob of _extractJsonObjects( code ) ) {

		try { push( JSON.parse( blob ) ); } catch ( e ) { /* skip non-JSON braces */ }

	}
	return out;

}

// Scan for top-level brace-balanced { … } substrings (handles nested args and
// multiple objects across lines / inside ```json fences).
function _extractJsonObjects( s ) {

	const out = [];
	let depth = 0, start = -1;
	for ( let i = 0; i < s.length; i ++ ) {

		const ch = s[ i ];
		if ( ch === '{' ) { if ( depth === 0 ) start = i; depth ++; }
		else if ( ch === '}' ) { if ( depth > 0 ) { depth --; if ( depth === 0 && start !== -1 ) { out.push( s.slice( start, i + 1 ) ); start = -1; } } }

	}
	return out;

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
	// 0x-hex BEFORE the bare-number alternative, else `[-\d.]+` grabs the leading 0.
	const re = /([A-Za-z_]\w*)\s*:\s*('[^']*'|"[^"]*"|0x[0-9a-fA-F]+|[-\d.]+|true|false|\[[^\]]*\])/g;
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
	if ( /^0x[0-9a-fA-F]+$/.test( s ) ) return _hexColor( s );   // color hex literal → '#rrggbb'
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

// Task 3 — argument extraction.  POLICY: canonical-KEY, lenient-VALUE — tied to
// the host boundary. The op() dispatcher (opPrimitive.js) reads opJSON.factor /
// .dx/.dy/.dz / .color / .axis+.degrees / .duration and does NOT map synonyms, so
// e.g. {value:2} for scale is genuinely wrong — the HOST would drop it too, so the
// scorer rejects it too, on purpose (measuring what actually executes).
//   • KEY (strict): the arg must use the schema key the host reads. Matches _argBag
//     — positional chain args map by op signature (SIG); object args read as-is.
//   • VALUE (lenient): a color passes if normalizeColor→colorBase equals the base
//     (host THREE.Color path — "black"→#111 all count). A magnitude with no single
//     canonical answer ("bigger", "slowly") is a {min}/{max} RANGE, not an exact
//     number; an explicit value is matched by string equality.
// INVARIANT: every arg case must have at least one reasonable answer that PASSES
// (a case nothing can pass tests nothing) — hence "slowly"→duration{min:3}, never an
// impossible exact target.
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

// Op-type SYNONYMS — decomposition (task 5) only. Two ops count as the same
// decomposition STEP if they share a family: the model split the request correctly
// even when it named the op with a different-but-equivalent verb (rotate/spin both
// "make it turn"; delete/remove; a COLOR-ONLY setMaterial IS a recolor). This does
// NOT loosen op-selection (task 1), which keeps the exact verb — the honest gap on
// decomposition should not be lost to a naming mismatch that the host would accept.
const OP_SYNONYMS = {
	recolor: [ 'recolor', 'setmaterial', 'material', 'retexture', 'paint', 'setcolor' ],
	spin: [ 'spin', 'rotate' ],
	rotate: [ 'rotate', 'spin' ],
	delete: [ 'delete', 'remove' ],
	move: [ 'move', 'translate', 'setposition' ],
	scale: [ 'scale', 'resize' ],
	duplicate: [ 'duplicate', 'clone', 'copy' ],
};

// True when an emitted op satisfies a wanted decomposition type, allowing synonyms.
// The setMaterial/material/retexture → recolor equivalence is gated on the op being
// COLOR-ONLY (it carries a `color`): a full material/texture swap with no color is a
// different intent and must not pass as a recolor.
export function opTypeMatches( emittedOp, wantType ) {

	const got = String( ( emittedOp && emittedOp.op ) || '' ).toLowerCase();
	const want = String( wantType || '' ).toLowerCase();
	if ( ! got ) return false;
	if ( got === want ) return true;
	const syns = OP_SYNONYMS[ want ];
	if ( ! syns || ! syns.includes( got ) ) return false;
	if ( want === 'recolor' && ( got === 'setmaterial' || got === 'material' || got === 'retexture' ) ) {

		const bag = _argBag( emittedOp );
		return !! ( bag && bag.color != null );

	}
	return true;

}

// Task 5 — multi-op decomposition: right NUMBER of ops (under AND over both fail)
// AND the right op TYPES in order (synonyms accepted) AND (when the runner supplies
// resolvedSets) each op HITTING its expected targets. Count-only over-credits a
// coder model that emits N arbitrary statements; requiring the type sequence makes
// it measure decomposition, not verbosity. The target check is decomposition-level:
// each op must HIT its expected node set (plural selectors that resolve to the whole
// set count — plural-resolution-to-multiple-ids), but OVER-coverage/bleed is the
// selector-resolution axis's job, not decomposition's, so extras do not fail here.
export function scoreMultiOp( emitted, expect, resolvedSets = null ) {

	if ( expect.mergedFail ) return { pass: true, reasons: [ 'n/a' ] };
	const want = expect.opCount != null ? expect.opCount : ( expect.ops ? expect.ops.length : 1 );
	const got = emitted.length;
	if ( got !== want ) return { pass: false, reasons: [ `${ got } ops ≠ expected ${ want } (${ got < want ? 'under' : 'over' }-split)` ] };
	const wantTypes = expect.ops ? expect.ops.map( e => e.opType ) : ( expect.opType ? [ expect.opType ] : null );
	if ( wantTypes ) {

		const bad = wantTypes.findIndex( ( t, i ) => ! opTypeMatches( emitted[ i ], t ) );
		if ( bad !== -1 ) return { pass: false, reasons: [ `op${ bad } "${ emitted[ bad ] ? emitted[ bad ].op : '∅' }" ≠ "${ wantTypes[ bad ] }"` ] };

	}

	// Target check (only when the runner resolved selectors for us). Each emitted op
	// must HIT its expected node set — a right-count/right-type split that MISSES the
	// expected parts is a wrong decomposition, so it fails here. Extra coverage
	// (a plural selector hitting more than one id) is NOT penalised here (bleed is
	// scored by scoreSelectorResolution); this is the plural-resolution allowance.
	if ( resolvedSets ) {

		const expectedList = expect.ops
			? expect.ops.map( e => new Set( e.targetNodes || [] ) )
			: [ new Set( expect.targetNodes || [] ) ];
		for ( let i = 0; i < expectedList.length; i ++ ) {

			const gotSet = resolvedSets[ i ] || new Set();
			const wantSet = expectedList[ i ];
			const missing = [ ...wantSet ].filter( n => ! gotSet.has( n ) );
			if ( missing.length ) {

				return { pass: false, reasons: [ `op${ i } wrong target (missed ${ missing.join( ',' ) })` ] };

			}

		}

	}

	return { pass: true, reasons: [ `${ got } op(s), types ok` ] };

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
		multiOp: scoreMultiOp( emitted, expect, resolvedSets ),
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
	lines.push( 'EVAL MATRIX — 5 tasks × model × {bare, scaffolded, constrained, reason-constrained}   (ceiling: ' + ( ceiling || 'none yet' ) + ')' );
	lines.push( 'task                  model        bare   scaffolded   constrained   reason-con   ' + ( ceiling || '' ) );
	lines.push( '─'.repeat( 90 ) );
	const short = ( m ) => String( m ).replace( /-\d{6,}$/, '' ).slice( 0, 12 );
	for ( const t of tasks ) {

		for ( const m of models ) {

			lines.push(
				t.padEnd( 22 ) + short( m ).padEnd( 13 ) +
				cell( t, m, 'bare' ).padEnd( 7 ) + cell( t, m, 'scaffolded' ).padEnd( 13 ) +
				cell( t, m, 'constrained' ).padEnd( 14 ) +
				cell( t, m, 'reason-constrained' ).padEnd( 13 ) +
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
//   labelOnce(labelCase) → Promise<string>,              // task-4 probe: {desc,asset,kind} → label (condition-aware)
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
		if ( c.expect.multiOp ) bump( 'multi-op', s.multiOp.pass );   // task-5 ONLY on genuine decomposition cases (not the trivial singles)
		progress( `edit ${ i + 1 }/${ EDIT_TASK_CASES.length } (${ c.id }): ${ emitted.length } op(s) emitted` );

		// Per-(task,case) JSONL row for the re-run artifact: the caller tags each row
		// with model+condition and appends {task,id,score,raw,parsed} to the log so a
		// run can be re-scored offline without re-invoking the model.
		if ( deps.onRow ) {

			const parsed = emitted.map( o => ( { op: o.op, selector: o.selector, args: o.args } ) );
			deps.onRow( { task: 'op-selection', id: c.id, score: s.opType.pass, raw: code, parsed } );
			deps.onRow( { task: 'selector-resolution', id: c.id, score: s.selectorResolution.pass, raw: code, parsed } );
			deps.onRow( { task: 'arg-extraction', id: c.id, score: s.argExtraction.pass, raw: code, parsed } );
			if ( c.expect.multiOp ) deps.onRow( { task: 'multi-op', id: c.id, score: s.multiOp.pass, raw: code, parsed } );

		}

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
		try { predicted = await deps.labelOnce( lc ); } catch ( e ) { progress( `label error — ${ e.message }` ); }
		const labelPass = scoreLabel( predicted, lc.gold ).pass;
		bump( 'labeling', labelPass );
		if ( deps.onRow ) deps.onRow( { task: 'labeling', id: `${ lc.kind }-${ i }`, score: labelPass, raw: predicted, parsed: predicted } );
		progress( `label ${ i + 1 }/${ LABELING_CASES.length } (${ lc.kind }): "${ predicted }"` );

	}

	return taskTally;

}
