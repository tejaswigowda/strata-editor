import { Command } from '../Command.js';

/**
 * Set an object's semantic label (userData.label) — the field selectors match as
 * #id AND the field the injected ADDRESSABLE PARTS list reads. Command-backed so
 * a user re-label is undoable; because the prompt recomputes per request, the
 * change is reflected in the next AI request automatically.
 *
 * @param {Editor} editor
 * @param {THREE.Object3D|null} [object=null]
 * @param {string} [newLabel='']
 * @constructor
 */
class SetLabelCommand extends Command {

	constructor( editor, object = null, newLabel = '' ) {

		super( editor );

		this.type = 'SetLabelCommand';
		this.name = 'Set Label: ' + newLabel;
		this.updatable = true;

		this.object = object;
		this.oldLabel = ( object !== null ) ? ( object.userData.label ?? null ) : null;
		this.newLabel = newLabel;

	}

	execute() {

		this.object.userData.label = this.newLabel;
		this.editor.signals.objectChanged.dispatch( this.object );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	undo() {

		if ( this.oldLabel == null ) delete this.object.userData.label;
		else this.object.userData.label = this.oldLabel;
		this.editor.signals.objectChanged.dispatch( this.object );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	update( cmd ) { this.newLabel = cmd.newLabel; }

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.oldLabel = this.oldLabel;
		output.newLabel = this.newLabel;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid );
		this.oldLabel = json.oldLabel;
		this.newLabel = json.newLabel;

	}

}

export { SetLabelCommand };
