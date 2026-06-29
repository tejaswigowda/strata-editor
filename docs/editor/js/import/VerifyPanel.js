// ── import/VerifyPanel.js ─────────────────────────────────────────────────────
// The Import + Verify UX (M7) panel — a thin DOM layer over verifyModel.js.
// FACTS (auto-classes) are never shown; only the SEMANTIC label guesses are
// surfaced, collapsed into one row per symmetric family ("Wheel ×4"), low-
// confidence first. "Apply" writes every family's label to all its members in
// ONE undoable batch (accept-all default = family normalization + corrections).
//
// All intelligence lives in verifyModel.js; this file is plain DOM + wiring, kept
// dependency-injected so it's testable-by-inspection and host-agnostic.

import { buildVerifyGroups, verifySummary, baseLabel, normLabel } from './verifyModel.js';

/**
 * @param {THREE.Object3D} root  imported asset root (carries labeled nodes)
 * @param {object} deps
 *   applyAll([{ nodes, label }])  — write labels to members (host: one MultiCmds → one undo)
 *   selectNodes(nodes)            — highlight a family in the viewport (optional)
 *   onClose()                     — called after apply/cancel (optional)
 *   log(msg)                      — surface a status line (optional)
 *   mount                         — DOM element to append into (default document.body)
 * @returns {{ element:HTMLElement, close:Function }|null}  null if nothing to verify
 */
export function createVerifyPanel( root, deps = {} ) {

	const groups = buildVerifyGroups( root );
	if ( groups.length === 0 ) {

		if ( deps.log ) deps.log( 'Nothing to verify — no semantic labels yet (facts are auto-assigned). Run relabelAsset() to label parts.' );
		return null;

	}

	const el = document.createElement( 'div' );
	Object.assign( el.style, {
		position: 'fixed', top: '56px', right: '12px', width: '310px', maxHeight: '72vh',
		overflowY: 'auto', background: '#1e1e1e', color: '#eee', border: '1px solid #444',
		borderRadius: '6px', padding: '10px', font: '12px/1.5 system-ui, sans-serif',
		zIndex: 10000, boxShadow: '0 6px 20px rgba(0,0,0,.55)',
	} );

	const head = document.createElement( 'div' );
	head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
	const title = document.createElement( 'strong' ); title.textContent = 'Verify part labels';
	head.appendChild( title );
	el.appendChild( head );

	const sub = document.createElement( 'div' );
	sub.style.cssText = 'opacity:.7;margin-bottom:8px;';
	sub.textContent = verifySummary( groups );
	el.appendChild( sub );

	// One row per family. Input pre-filled with the family base label.
	const rows = groups.map( g => {

		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 2px;border-top:1px solid #333;'
			+ ( g.lowConfidence ? 'background:#3a2a18;' : '' );

		const badge = document.createElement( 'span' );
		badge.textContent = g.count > 1 ? '×' + g.count : ' ';
		badge.title = g.count > 1 ? `${ g.count } symmetric parts — one decision` : 'single part';
		badge.style.cssText = 'min-width:26px;text-align:center;opacity:.65;';

		const input = document.createElement( 'input' );
		input.value = g.display;
		input.spellcheck = false;
		input.style.cssText = 'flex:1;background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:3px 6px;';
		input.addEventListener( 'focus', () => { if ( deps.selectNodes ) deps.selectNodes( g.nodes ); } );
		input.addEventListener( 'keydown', e => { if ( e.key === 'Enter' ) apply(); } );

		const warn = document.createElement( 'span' );
		warn.textContent = g.lowConfidence ? '⚠' : '';
		warn.title = 'low-confidence guess — check this one';
		warn.style.cssText = 'color:#fa3;min-width:12px;';

		row.append( badge, input, warn );
		return { group: g, input, row };

	} );
	rows.forEach( r => el.appendChild( r.row ) );

	// Footer actions.
	const foot = document.createElement( 'div' );
	foot.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
	const applyBtn = document.createElement( 'button' );
	applyBtn.textContent = 'Apply ✓';
	applyBtn.style.cssText = 'flex:1;cursor:pointer;background:#2a8a5a;color:#fff;border:0;border-radius:4px;padding:5px;';
	const cancelBtn = document.createElement( 'button' );
	cancelBtn.textContent = 'Keep guesses';
	cancelBtn.style.cssText = 'cursor:pointer;background:#333;color:#ccc;border:0;border-radius:4px;padding:5px 8px;';
	foot.append( applyBtn, cancelBtn );
	el.appendChild( foot );

	function apply() {

		// Only write families whose label actually changed from the per-member text
		// (so accepting an unedited family that already shares its base is a no-op,
		// but accepting distinct member labels normalizes them to the family label).
		const assignments = [];
		for ( const { group, input } of rows ) {

			const label = input.value.trim();
			if ( ! label ) continue;
			const allAgree = group.nodes.every( n => normLabel( n.userData.label ) === normLabel( label ) );
			if ( ! allAgree ) assignments.push( { nodes: group.nodes, label } );

		}
		if ( assignments.length && deps.applyAll ) deps.applyAll( assignments );
		if ( deps.log ) deps.log( `Verified ${ rows.length } label group(s)${ assignments.length ? `; updated ${ assignments.length }` : ' (no changes)' }. Reflected in the next AI request.` );
		close();

	}

	applyBtn.addEventListener( 'click', apply );
	cancelBtn.addEventListener( 'click', () => { if ( deps.log ) deps.log( 'Kept the model\'s label guesses.' ); close(); } );

	function close() { el.remove(); if ( deps.onClose ) deps.onClose(); }

	( deps.mount || document.body ).appendChild( el );
	return { element: el, close };

}
