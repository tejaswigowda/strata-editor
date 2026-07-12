import { Command } from '../Command.js';
import { toClassSet } from '../intelligence/classDerive.js';

/**
 * Add or remove a semantic CLASS on an object (userData.customClasses) — the
 * field BOTH the selector engine (hasClass) and the injected ADDRESSABLE PARTS
 * list (getAllClasses) read. Writing here (not userData.classes) keeps resolution
 * and the presented vocabulary consistent. Command-backed → undoable, and
 * reflected in the next AI request (the prompt recomputes per request).
 *
 * @param {Editor} editor
 * @param {THREE.Object3D|null} [object=null]
 * @param {string} [className='']
 * @param {boolean} [add=true]   true = add the class, false = remove it
 * @constructor
 */
class SetClassCommand extends Command {

	constructor( editor, object = null, className = '', add = true ) {

		super( editor );

		this.type = 'SetClassCommand';
		this.name = ( add ? 'Add Class: ' : 'Remove Class: ' ) + className;

		this.object = object;
		this.className = String( className );
		this.add = add === true;
		// Whether the object HAD the class before — so undo restores the prior state
		// regardless of whether this op was an add or a remove (and is a no-op if
		// the class already matched the target state).
		this.had = !! ( object && object.userData.customClasses && toClassSet( object.userData.customClasses ).has( this.className ) );

	}

	_set( present ) {

		const set = toClassSet( this.object.userData.customClasses );
		if ( present ) set.add( this.className ); else set.delete( this.className );
		// Persist as an Array so custom classes survive JSON / git / glTF round-trips.
		this.object.userData.customClasses = Array.from( set );
		this.editor.signals.objectChanged.dispatch( this.object );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	execute() { this._set( this.add ); }

	undo() { this._set( this.had ); }

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.className = this.className;
		output.add = this.add;
		output.had = this.had;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid );
		this.className = json.className;
		this.add = json.add;
		this.had = json.had;

	}

}

export { SetClassCommand };
