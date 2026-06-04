// ── observe.js ────────────────────────────────────────────────────────────────
// Deterministic observation for the agentic loop (Technique 3c). No model.
//
// snapshotScene(editor)  → compact map of scene state (existence/transform/color)
// sceneDiff(before, after) → { added, removed, moved, recolored, scaled }
// confirmChange(diff, intent) → loose "did anything matching the intent happen?"
//
// The loop uses this to OBSERVE: did the expected object appear/change? The check
// is intentionally loose (per spec risk #6) — it detects "nothing happened",
// not exact value equality, to avoid false-failure retry storms.

function r3( v ) { return Math.round( v * 1e3 ) / 1e3; }

function colorHexOf( obj ) {

	const mat = Array.isArray( obj.material ) ? obj.material[ 0 ] : obj.material;
	if ( mat && mat.color ) return mat.color.getHex();
	return null;

}

/**
 * @param {Editor} editor
 * @returns {Map<string, object>}  uuid → { name, type, pos, scale, color }
 */
export function snapshotScene( editor ) {

	const snap = new Map();

	editor.scene.traverse( obj => {

		if ( obj === editor.scene || obj.isCamera ) return;
		snap.set( obj.uuid, {
			name:  obj.name || obj.type,
			type:  obj.type,
			pos:   [ r3( obj.position.x ), r3( obj.position.y ), r3( obj.position.z ) ],
			scale: [ r3( obj.scale.x ), r3( obj.scale.y ), r3( obj.scale.z ) ],
			color: colorHexOf( obj ),
		} );

	} );

	return snap;

}

function arrNe( a, b, eps = 1e-3 ) {

	for ( let i = 0; i < a.length; i ++ ) if ( Math.abs( a[ i ] - b[ i ] ) > eps ) return true;
	return false;

}

/**
 * @returns {{ added:[], removed:[], moved:[], scaled:[], recolored:[], total:number }}
 */
export function sceneDiff( before, after ) {

	const added = [], removed = [], moved = [], scaled = [], recolored = [];

	for ( const [ uuid, a ] of after ) {

		const b = before.get( uuid );
		if ( ! b ) { added.push( a.name ); continue; }
		if ( arrNe( a.pos, b.pos ) ) moved.push( a.name );
		if ( arrNe( a.scale, b.scale ) ) scaled.push( a.name );
		if ( a.color !== b.color ) recolored.push( a.name );

	}

	for ( const [ uuid, b ] of before ) {

		if ( ! after.has( uuid ) ) removed.push( b.name );

	}

	const total = added.length + removed.length + moved.length + scaled.length + recolored.length;
	return { added, removed, moved, scaled, recolored, total };

}

/** Human-readable one-liner for the shell. */
export function diffSummary( d ) {

	const parts = [];
	if ( d.added.length )     parts.push( `+${ d.added.length } added (${ d.added.slice( 0, 3 ).join( ', ' ) })` );
	if ( d.removed.length )   parts.push( `−${ d.removed.length } removed` );
	if ( d.moved.length )     parts.push( `${ d.moved.length } moved` );
	if ( d.scaled.length )    parts.push( `${ d.scaled.length } scaled` );
	if ( d.recolored.length ) parts.push( `${ d.recolored.length } recolored` );
	return parts.length ? parts.join( ', ' ) : 'no change';

}

// Intent → which diff bucket should be non-empty.
const INTENT_EXPECT = [
	{ re: /\b(add|create|new|place|spawn|build)\b/, buckets: [ 'added' ] },
	{ re: /\b(remove|delete|clear)\b/,              buckets: [ 'removed' ] },
	{ re: /\b(move|position|next to|above|below)\b/, buckets: [ 'moved', 'added' ] },
	{ re: /\b(scale|bigger|smaller|resize|grow|shrink)\b/, buckets: [ 'scaled' ] },
	{ re: /\b(color|colour|paint|recolor|red|green|blue|purple|yellow|orange)\b/, buckets: [ 'recolored', 'added' ] },
	{ re: /\b(rotate|turn|spin)\b/,                 buckets: [ 'moved' ] }, // rotation not tracked → allow moved/none
];

/**
 * Loose confirmation: did SOMETHING matching the intent happen?
 * Returns { ok, expected, reason }. ok=true unless we strongly expected a change
 * and got literally nothing — the only safe signal to trigger a retry.
 */
export function confirmChange( diff, intent ) {

	const text = String( intent ).toLowerCase();
	const expect = INTENT_EXPECT.find( e => e.re.test( text ) );

	// No clear expectation → accept any non-empty diff, don't punish.
	if ( ! expect ) return { ok: diff.total > 0, expected: 'any', reason: diff.total > 0 ? 'changed' : 'no change' };

	const hit = expect.buckets.some( b => diff[ b ] && diff[ b ].length > 0 );

	// Rotation isn't tracked in the snapshot — never fail a rotate on "no change".
	if ( /\b(rotate|turn|spin)\b/.test( text ) ) return { ok: true, expected: 'rotation', reason: 'not tracked' };

	return {
		ok: hit,
		expected: expect.buckets.join( '/' ),
		reason: hit ? 'matched' : `expected ${ expect.buckets.join( '/' ) } change but scene was unchanged`,
	};

}
