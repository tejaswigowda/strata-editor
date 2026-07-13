// ── three.js peer resolution ─────────────────────────────────────────────────
// three.js is a PEER dependency: the consumer brings its own copy. This module is
// the single import site so the whole library shares one THREE instance.
//
//   • Bundler / npm         : resolves the `three` bare specifier normally.
//   • Browser <script type=module> / CDN : provide an import map entry for "three".
//   • A host that only exposes a global (e.g. window.THREE) can call setThree()
//     BEFORE using the library, which overrides the imported binding.
//
// We import `three` eagerly; if that resolution is unavailable at runtime a host
// may still inject via setThree(). Consumers that use an import map never notice.

import * as _three from 'three';

let THREE = _three && _three.Scene ? _three : ( ( typeof globalThis !== 'undefined' && globalThis.THREE ) || _three );

/**
 * Override the THREE instance the library uses. Call once, before createS().
 * Useful for hosts that expose three as a global rather than a module.
 * @param {object} instance  a three.js module namespace
 */
export function setThree( instance ) {

	if ( instance ) THREE = instance;

}

/** The resolved THREE instance. */
export function getThree() {

	return THREE;

}

export { THREE };
