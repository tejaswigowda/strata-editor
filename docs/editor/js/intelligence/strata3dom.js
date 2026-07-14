// ── strata3dom.js — the consumer bridge ───────────────────────────────────────
//
// Wires the standalone @tejaswigowda/3dom library into Strata: it builds a $S that
// resolves selectors over the editor's scene and routes every edit through a
// StrataHost, so mutations land in Strata's undo/redo history and refresh its UI.
//
// This is the "Strata is a consumer of the library" seam. The library brings the
// selector engine, auto-labelling, chain API and ops; Strata brings the command
// stack and signals (via StrataHost). three.js is shared (the editor's importmap
// resolves the bare `three` specifier the library imports).
//
// The library itself is loaded from a pinned jsDelivr CDN build, mapped to the
// bare specifier `@tejaswigowda/3dom` in the editor's importmap (docs/index.html):
//   https://cdn.jsdelivr.net/gh/tejaswigowda/3dom@602ee8bb081df171cb3bc7cb6a621babc3a84faf/dist/3dom.esm.min.js
//
//   import { createStrataS } from './intelligence/strata3dom.js';
//   const $S = createStrataS( editor );
//   $S('.wheel').recolor('#111').scale(1.2);   // real, undoable Strata edits

import createS from '@tejaswigowda/3dom';
import { StrataHost } from './StrataHost.js';

/**
 * Build a $S bound to the Strata editor, backed by the library + StrataHost.
 * @param {Editor} editor
 * @returns {(selector:string|Array)=>object} a ChainableSet ($S) bound to the editor
 */
export function createStrataS( editor ) {

	return createS( new StrataHost( editor ) );

}

export { StrataHost };
export { createS };
