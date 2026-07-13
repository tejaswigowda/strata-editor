// ── @tejaswigowda/3dom — jQuery for 3D ─────────────────────────────────────────
//
// Address and edit ANY three.js scene with CSS-like selectors. Zero editor, zero
// framework — just three.js (a peer dependency) and this.
//
//   import * as THREE from 'three';
//   import { createS, autoLabel } from '@tejaswigowda/3dom';
//
//   const $S = createS( scene );     // bind to a scene (its own undo)
//   autoLabel( scene );              // derive classes from geometry/colour/…
//   $S('.wheel').recolor('#111').scale(1.2);
//   $S.undo();                       // library's built-in undo
//
// To wire into a host app (e.g. Strata) that has its own undo/redo + UI, pass a
// Host instead of a scene: createS({ scene, execute, undo, redo, notify, ...factories }).

import { resolveHost, DefaultHost, defaultCommands } from './host.js';
import { ChainableSet } from './chain.js';
import { autoLabel, indexSubtree, deriveAllClasses } from './autolabel.js';
import * as selectorEngine from './selectorEngine.js';
import * as ops from './ops.js';
import { setThree, getThree, THREE } from './three.js';

/**
 * Create a $S bound to a scene (or a host application's Host).
 * @param {THREE.Object3D|object} sceneOrHost  a scene root, or a Host object
 * @param {object} [opts]  onChange, historyLimit (when a bare scene is passed)
 * @returns {function(string|Array): ChainableSet} the bound $S, with helpers attached
 */
export function createS( sceneOrHost, opts = {} ) {

	const host = resolveHost( sceneOrHost, opts );

	const $S = ( selector ) => new ChainableSet( host, selector );

	// Helpers hung off the callable so a single import is enough.
	$S.host = host;
	$S.scene = host.scene;
	$S.autoLabel = ( o = {} ) => { autoLabel( host.scene, o ); host.notify( 'autoLabel' ); return $S; };
	$S.op = ( json ) => { ops.dispatchOp( host, json ); return $S; };
	$S.ops = ( list ) => { ops.dispatchOps( host, list ); return $S; };
	$S.undo = () => { host.undo(); return $S; };
	$S.redo = () => { host.redo(); return $S; };
	$S.query = ( selector ) => selectorEngine.query( host.scene, selector );

	return $S;

}

export {
	// core
	ChainableSet, DefaultHost, defaultCommands, resolveHost,
	// autolabel
	autoLabel, indexSubtree, deriveAllClasses,
	// selectors + ops (programmatic surface)
	selectorEngine, ops,
	// three peer hooks
	setThree, getThree, THREE,
};

export default createS;
