import { Command } from '../Command.js';

/**
 * Ungroups a container object: moves all of its children up to its parent
 * ( preserving world transforms ) and removes the now-empty container.
 *
 * @param {Editor} editor
 * @param {THREE.Object3D|null} [group=null]
 * @constructor
 */
class UngroupObjectsCommand extends Command {

	constructor( editor, group = null ) {

		super( editor );

		this.type = 'UngroupObjectsCommand';
		this.name = 'Ungroup';

		this.group = group;
		this.parent = group ? group.parent : null;
		this.groupIndex = ( this.parent !== null ) ? this.parent.children.indexOf( group ) : - 1;

		// Snapshot the children that will be moved out

		this.children = group ? group.children.slice() : [];

	}

	execute() {

		const editor = this.editor;

		if ( this.group === null || this.parent === null ) return;

		this.parent.updateMatrixWorld( true );

		for ( let i = 0; i < this.children.length; i ++ ) {

			const child = this.children[ i ];
			child.updateMatrixWorld( true );
			this.parent.attach( child ); // preserves world transform

		}

		this.parent.remove( this.group );

		editor.signals.sceneGraphChanged.dispatch();
		editor.deselect();

	}

	undo() {

		const editor = this.editor;

		if ( this.group === null || this.parent === null ) return;

		// Put the group back where it was

		this.group.updateMatrixWorld( true );

		const children = this.parent.children;

		if ( this.groupIndex !== - 1 && this.groupIndex <= children.length ) {

			children.splice( this.groupIndex, 0, this.group );
			this.group.parent = this.parent;
			this.group.dispatchEvent( { type: 'added' } );

		} else {

			this.parent.add( this.group );

		}

		this.group.updateMatrixWorld( true );

		// Re-attach the children back into the group, preserving world transforms

		for ( let i = 0; i < this.children.length; i ++ ) {

			const child = this.children[ i ];
			child.updateMatrixWorld( true );
			this.group.attach( child );

		}

		editor.signals.sceneGraphChanged.dispatch();
		editor.select( this.group );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.groupUuid = this.group ? this.group.uuid : null;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.group = json.groupUuid ? this.editor.objectByUuid( json.groupUuid ) : null;
		this.parent = this.group ? this.group.parent : null;
		this.groupIndex = ( this.parent !== null ) ? this.parent.children.indexOf( this.group ) : - 1;
		this.children = this.group ? this.group.children.slice() : [];

	}

}

export { UngroupObjectsCommand };
