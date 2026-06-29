// ── import/verifyModel.js ─────────────────────────────────────────────────────
// The BRAIN of the Import + Verify UX (M7). Pure, node-testable (no DOM/THREE).
//
// Principle (work order item 3): FACTS are auto-assigned and never asked; only the
// SEMANTIC label GUESSES are verified. Symmetric/identical parts collapse into ONE
// decision ("Wheel ×4"), low-confidence guesses surface first, and accepting/
// renaming a group propagates to every member.
//
// A "group" = a set of labeled nodes that share a positional-stripped BASE label
// (so "Front Left Wheel" / "Rear Right Wheel" → one "Wheel ×4" row). The panel
// renders groups in order; relabeling a group writes the new label to ALL members
// (correction-propagation) via command-backed relabel.

// Positional / side qualifiers stripped to find the symmetry BASE of a label.
const POSITIONAL = new Set( [
	'left', 'right', 'front', 'back', 'rear', 'upper', 'lower', 'top', 'bottom',
	'inner', 'outer', 'center', 'centre', 'mid', 'middle', 'side', 'l', 'r', 'f', 'b',
] );

/** Normalize a label for display/compare: lowercase, collapse whitespace. */
export function normLabel( s ) {

	return String( s || '' ).toLowerCase().trim().replace( /[()_/]+/g, ' ' ).replace( /\s+/g, ' ' ).trim();

}

/**
 * The symmetry BASE of a label — positional words removed — so symmetric parts
 * collapse to one group. "Front Left Wheel" → "wheel"; "Tail Light (left)" →
 * "tail light"; "Dump Bed" → "dump bed".
 * @param {string} label
 * @returns {string}
 */
export function baseLabel( label ) {

	const words = normLabel( label ).split( ' ' ).filter( w => w && ! POSITIONAL.has( w ) && ! /^\d+$/.test( w ) );
	return words.join( ' ' ) || normLabel( label ); // never empty (a purely-positional label keeps itself)

}

/** Title-case a base label for display. */
function titleCase( s ) { return String( s ).replace( /\b\w/g, c => c.toUpperCase() ); }

/**
 * Collect leaf/meaningful nodes that carry a semantic label guess.
 * @param {THREE.Object3D} root  with .traverse and node.userData
 * @returns {Array} labeled nodes
 */
export function collectLabeledNodes( root ) {

	const out = [];
	if ( ! root || typeof root.traverse !== 'function' ) return out;
	root.traverse( n => { if ( n && n.userData && n.userData.label ) out.push( n ); } );
	return out;

}

/**
 * Build the ordered verify groups for an imported root.
 * Each group: { base, display, label, nodes, count, minConfidence, lowConfidence,
 *   symmetric }. Ordered LOW-CONFIDENCE first (surface the shaky guesses), then by
 *   count descending (the big symmetric families), then alphabetically.
 * @param {THREE.Object3D} root
 * @returns {Array<object>}
 */
export function buildVerifyGroups( root ) {

	const nodes = collectLabeledNodes( root );
	const byBase = new Map();

	for ( const n of nodes ) {

		const base = baseLabel( n.userData.label );
		if ( ! byBase.has( base ) ) byBase.set( base, [] );
		byBase.get( base ).push( n );

	}

	const groups = [];
	for ( const [ base, members ] of byBase ) {

		const confidences = members
			.map( n => ( typeof n.userData.labelConfidence === 'number' ) ? n.userData.labelConfidence : null )
			.filter( c => c != null );
		const minConfidence = confidences.length ? Math.min( ...confidences ) : null;
		const lowConfidence = members.some( n => n.userData.labelLowConfidence === true );
		// The current shared label, if every member already agrees; else the base.
		const labels = new Set( members.map( n => normLabel( n.userData.label ) ) );
		const display = titleCase( base );

		groups.push( {
			base,
			display,
			label: labels.size === 1 ? members[ 0 ].userData.label : display,
			nodes: members,
			count: members.length,
			minConfidence,
			lowConfidence,
			symmetric: members.length > 1,
		} );

	}

	// Order: low-confidence first, then larger families, then alphabetical.
	groups.sort( ( a, b ) => {

		if ( a.lowConfidence !== b.lowConfidence ) return a.lowConfidence ? - 1 : 1;
		const ac = a.minConfidence == null ? 1 : a.minConfidence;
		const bc = b.minConfidence == null ? 1 : b.minConfidence;
		if ( ac !== bc ) return ac - bc;          // lower confidence first
		if ( a.count !== b.count ) return b.count - a.count;  // bigger families first
		return a.display.localeCompare( b.display );

	} );

	return groups;

}

/**
 * A short summary line for the verify header.
 * @param {Array} groups
 * @returns {string}
 */
export function verifySummary( groups ) {

	const parts = groups.reduce( ( s, g ) => s + g.count, 0 );
	const low = groups.filter( g => g.lowConfidence ).length;
	return `${ groups.length } label group(s) over ${ parts } part(s)` +
		( low ? ` — ${ low } low-confidence, surfaced first` : '' );

}
