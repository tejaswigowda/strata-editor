// ── autolabel.js — deterministic class derivation over any three.js scene ─────
//
// The novel core: give it a plain THREE.Object3D and it derives stable, CSS-like
// classes from geometry / colour / symmetry / material / name — with ZERO manual
// tagging. After autoLabel(root), $S('.wheel'), $S('.red'), $S('.left') resolve.
//
// Pipeline:
//   1. indexSubtree(root)     → computes descriptors, writes node.userData.descriptors
//   2. deriveAllClasses(root) → derives classes,     writes node.userData.classes
//
// Both steps are pure functions of the scene graph; run again after mutation to
// re-label. autoLabel is idempotent and deterministic (same scene → same classes).

import { indexSubtree } from './descriptors.js';
import { deriveAllClasses } from './classDerive.js';

/**
 * Auto-label a subtree: compute descriptors, then derive classes.
 * @param {THREE.Object3D} root  scene or subtree root
 * @param {object} [opts]
 * @param {boolean} [opts.force]  recompute descriptors even if cached
 * @returns {THREE.Object3D} the same root (chainable)
 */
export function autoLabel( root, opts = {} ) {

	if ( ! root || ! root.traverse ) throw new Error( '3DOM.autoLabel: a THREE.Object3D is required' );
	indexSubtree( root, opts.force === true );
	deriveAllClasses( root );
	return root;

}

export { indexSubtree, deriveAllClasses };
