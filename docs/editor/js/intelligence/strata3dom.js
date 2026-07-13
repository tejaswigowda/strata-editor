// ── strata3dom.js — the consumer bridge ───────────────────────────────────────
//
// Wires the standalone @onlyconnect/3dom library into Strata: it builds a $S that
// resolves selectors over the editor's scene and routes every edit through a
// StrataHost, so mutations land in Strata's undo/redo history and refresh its UI.
//
// This is the "Strata is a consumer of the library" seam. The library brings the
// selector engine, auto-labelling, chain API and ops; Strata brings the command
// stack and signals (via StrataHost). three.js is shared (the editor's importmap
// resolves the bare `three` specifier the library imports).
//
//   import { createStrataS } from './intelligence/strata3dom.js';
//   const $S = createStrataS( editor );
//   $S('.wheel').recolor('#111').scale(1.2);   // real, undoable Strata edits

import createS from '/packages/3dom/src/index.js';
import { StrataHost } from './StrataHost.js';

/**
 * Build a $S bound to the Strata editor, backed by the library + StrataHost.
 * @param {Editor} editor
 * @returns {(selector:string|Array)=>import('/packages/3dom/src/chain.js').ChainableSet}
 */
export function createStrataS( editor ) {

	return createS( new StrataHost( editor ) );

}

export { StrataHost };
export { createS };
