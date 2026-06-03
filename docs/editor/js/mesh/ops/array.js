// ── Array / duplicate-along operation (M2) ────────────────────────────────────
// Creates N copies of a mesh, each offset by (offsetX, offsetY, offsetZ) from
// the previous one. All copies are emitted as a single undoable MultiCmdsCommand.

import * as THREE from 'three';
import { AddObjectCommand } from '../../commands/AddObjectCommand.js';
import { MultiCmdsCommand } from '../../commands/MultiCmdsCommand.js';
import { registerOp } from './index.js';

/**
 * Duplicate a mesh N times in a linear array.
 *
 * @param {Editor}     editor
 * @param {THREE.Mesh} mesh          source mesh to duplicate
 * @param {number}     count         number of additional copies (>= 1)
 * @param {number}     [offsetX=0]   X step between copies
 * @param {number}     [offsetY=0]   Y step between copies
 * @param {number}     [offsetZ=0]   Z step between copies
 * @returns {THREE.Mesh[]}           array of created meshes
 */
export function arrayDuplicate( editor, mesh, count, offsetX = 0, offsetY = 0, offsetZ = 0 ) {

	if ( ! mesh || ! mesh.isMesh ) throw new Error( 'arrayDuplicate: first arg must be a THREE.Mesh' );
	if ( ! Number.isFinite( count ) || count < 1 ) throw new Error( 'arrayDuplicate: count must be a positive integer' );

	const cmds    = [];
	const created = [];

	for ( let i = 1; i <= count; i ++ ) {

		const clone      = mesh.clone();
		clone.geometry   = mesh.geometry.clone();
		clone.material   = Array.isArray( mesh.material )
			? mesh.material.map( m => m.clone() )
			: mesh.material.clone();
		clone.name       = ( mesh.name || 'Mesh' ) + '_' + i;
		clone.castShadow = mesh.castShadow;
		clone.receiveShadow = mesh.receiveShadow;

		clone.position.set(
			mesh.position.x + offsetX * i,
			mesh.position.y + offsetY * i,
			mesh.position.z + offsetZ * i,
		);

		cmds.push( new AddObjectCommand( editor, clone ) );
		created.push( clone );

	}

	const multi = new MultiCmdsCommand( editor, cmds );
	multi.name  = `Array Duplicate ×${ count }`;
	editor.execute( multi );

	return created;

}

registerOp( 'arrayDuplicate', {
	description: 'Create N copies of a mesh, each offset by (offsetX, offsetY, offsetZ) from the previous',
	params: { mesh: 'Mesh', count: 'number', 'offsetX?': 'number=0', 'offsetY?': 'number=0', 'offsetZ?': 'number=0' },
	example: 'arrayDuplicate(editor.selected, 4, 2, 0, 0)',
} );
