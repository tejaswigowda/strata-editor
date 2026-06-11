import * as THREE from 'three';

import { Command } from '../Command.js';

/**
 * Groups a set of objects under a new THREE.Group while preserving each
 * object's world transform. The group is added to the common ancestor of the
 * selected objects ( or the scene as a fallback ).
 *
 * @param {Editor} editor
 * @param {Array<THREE.Object3D>} [objects=[]]
 * @param {THREE.Group|null} [group=null] optional pre-made group ( a new one is created otherwise )
 * @constructor
 */
class GroupObjectsCommand extends Command {

	constructor( editor, objects = [], group = null ) {

		super( editor );

		this.type = 'GroupObjectsCommand';
		this.name = 'Group Objects';

		// Keep a stable, top-most-first ordering so reparenting is deterministic

		this.objects = objects.slice();

		this.group = group;

		// Per-object bookkeeping for undo

		this.records = this.objects.map( ( object ) => ( {
			object: object,
			parent: object.parent,
			index: object.parent ? object.parent.children.indexOf( object ) : - 1
		} ) );

		this.parent = null; // resolved on execute

	}

	execute() {

		const editor = this.editor;

		if ( this.objects.length === 0 ) return;

		if ( this.group === null ) {

			this.group = new THREE.Group();
			this.group.name = 'Group';

		}

		// Choose the parent for the new group: the parent of the first object,
		// falling back to the scene.

		this.parent = this.records[ 0 ].parent || editor.scene;

		this.parent.add( this.group );
		this.parent.updateMatrixWorld( true );

		// Reparent each object into the group, preserving its world transform.

		for ( let i = 0; i < this.objects.length; i ++ ) {

			const object = this.objects[ i ];

			object.updateMatrixWorld( true );
			this.group.attach( object ); // attach() preserves the world transform

		}

		this.group.updateMatrixWorld( true );

		editor.signals.sceneGraphChanged.dispatch();
		editor.select( this.group );

	}

	undo() {

		const editor = this.editor;

		if ( this.group === null ) return;

		// Move every object back to its original parent / index, preserving the
		// world transform.

		for ( let i = 0; i < this.records.length; i ++ ) {

			const record = this.records[ i ];
			const object = record.object;
			const originalParent = record.parent || editor.scene;

			originalParent.updateMatrixWorld( true );
			originalParent.attach( object );

			// Restore the original child index when possible

			if ( record.index !== - 1 ) {

				const children = originalParent.children;
				const current = children.indexOf( object );

				if ( current !== - 1 && current !== record.index ) {

					children.splice( current, 1 );
					children.splice( Math.min( record.index, children.length ), 0, object );

				}

			}

		}

		if ( this.group.parent !== null ) this.group.parent.remove( this.group );

		editor.signals.sceneGraphChanged.dispatch();
		editor.deselect();

	}

	toJSON() {

		const output = super.toJSON( this );

		output.groupUuid = this.group ? this.group.uuid : null;
		output.objectUuids = this.objects.map( object => object.uuid );

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.group = json.groupUuid ? this.editor.objectByUuid( json.groupUuid ) : null;
		this.objects = json.objectUuids
			.map( uuid => this.editor.objectByUuid( uuid ) )
			.filter( object => object !== undefined );

		this.records = this.objects.map( ( object ) => ( {
			object: object,
			parent: object.parent,
			index: object.parent ? object.parent.children.indexOf( object ) : - 1
		} ) );

	}

}

export { GroupObjectsCommand };
