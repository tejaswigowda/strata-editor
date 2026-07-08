import { Command } from '../Command.js';
import { AnimationClip } from 'three';

/**
 * Register a THREE.AnimationClip on an object's `animations` array (default: the
 * scene). Command-backed so animation recipes go through the ONE execution
 * surface — undoable / versioned like every other op.
 *
 * @param {Editor} editor
 * @param {THREE.AnimationClip|null} [clip=null]
 * @param {THREE.Object3D|null} [object=null]  owner; defaults to editor.scene
 * @constructor
 */
class AddAnimationClipCommand extends Command {

	constructor( editor, clip = null, object = null ) {

		super( editor );

		this.type = 'AddAnimationClipCommand';

		this.object = ( object && object.isObject3D ) ? object : editor.scene;
		this.clip = clip;

		if ( clip !== null ) {

			// No Strings key for this command — getKey() would return '???'.
			this.name = 'Add Animation Clip: ' + ( clip.name || 'Clip' );

		}

	}

	execute() {

		const target = this.object;
		if ( ! Array.isArray( target.animations ) ) target.animations = [];
		if ( target.animations.indexOf( this.clip ) === - 1 ) target.animations.push( this.clip );

		if ( this.editor.mixer ) this.editor.mixer.uncacheRoot( target );

		// Same refresh path createClip()/registerAnimationClip() use so the
		// Animations panel rebuilds its clip list.
		this.editor.signals.objectSelected.dispatch( target );
		this.editor.signals.sceneGraphChanged.dispatch();
		this.editor.signals.animationClipAdded.dispatch( this.clip );

	}

	undo() {

		const target = this.object;
		if ( Array.isArray( target.animations ) ) {

			const i = target.animations.indexOf( this.clip );
			if ( i !== - 1 ) target.animations.splice( i, 1 );

		}

		if ( this.editor.mixer ) this.editor.mixer.uncacheRoot( target );

		this.editor.signals.objectSelected.dispatch( target );
		this.editor.signals.sceneGraphChanged.dispatch();

	}

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.clip = AnimationClip.toJSON( this.clip );
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid ) || this.editor.scene;
		this.clip = AnimationClip.parse( json.clip );

	}

}

export { AddAnimationClipCommand };
