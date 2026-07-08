import { Command } from '../Command.js';

import { ObjectLoader } from 'three';

class RemoveObjectCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [object=null]
	 * @constructor
	 */
	constructor( editor, object = null ) {

		super( editor );

		this.type = 'RemoveObjectCommand';

		this.object = object;
		this.parent = ( object !== null ) ? object.parent : null;

		if ( this.parent !== null ) {

			this.index = this.parent.children.indexOf( this.object );

		}

		if ( object !== null ) {

			this.name = editor.strings.getKey( 'command/RemoveObject' ) + ': ' + object.name;

		}

		// Store object animations for undo
		this.objectAnimations = ( object !== null && object.animations ) ? [ ...object.animations ] : [];
		// Store scene animations that reference this object for undo
		this.sceneAnimationsToRemove = [];

		if ( object !== null ) {

			const objectUuid = object.uuid;
			const sceneAnimations = editor.scene.animations || [];

			for ( const clip of sceneAnimations ) {

				// Check if this clip only references the object being deleted
				const referencesOnlyThisObject = clip.tracks.every( track => {

					const uuid = track.name.split( '.' )[ 0 ];
					return uuid === objectUuid;

				} );

				if ( referencesOnlyThisObject && clip.tracks.length > 0 ) {

					this.sceneAnimationsToRemove.push( clip );

				}

			}

		}

	}

	execute() {

		const mixer = this.editor.mixer;

		// Remove object-level animations
		if ( this.object.animations ) {

			for ( const clip of this.object.animations ) {

				if ( mixer ) mixer.uncacheClip( clip );

			}

			this.object.animations = [];

		}

		// Remove scene-level animations that only reference this object
		const scene = this.editor.scene;
		if ( scene.animations ) {

			scene.animations = scene.animations.filter( clip => {

				if ( this.sceneAnimationsToRemove.includes( clip ) ) {

					if ( mixer ) mixer.uncacheClip( clip );
					return false;

				}

				return true;

			} );

		}

		// Dispatch signal that animations were removed
		this.editor.signals.animationsChanged.dispatch();

		this.editor.removeObject( this.object );
		this.editor.deselect();

	}

	undo() {

		this.editor.addObject( this.object, this.parent, this.index );

		// Restore object animations
		if ( this.objectAnimations.length > 0 ) {

			if ( ! this.object.animations ) this.object.animations = [];
			this.object.animations.push( ...this.objectAnimations );

		}

		// Restore scene animations
		if ( this.sceneAnimationsToRemove.length > 0 ) {

			if ( ! this.editor.scene.animations ) this.editor.scene.animations = [];
			this.editor.scene.animations.push( ...this.sceneAnimationsToRemove );

		}

		// Dispatch signal that animations were restored
		this.editor.signals.animationsChanged.dispatch();

		this.editor.select( this.object );

	}

	toJSON() {

		const output = super.toJSON( this );

		output.object = this.object.toJSON();
		output.index = this.index;
		output.parentUuid = this.parent.uuid;

		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );

		this.parent = this.editor.objectByUuid( json.parentUuid );
		if ( this.parent === undefined ) {

			this.parent = this.editor.scene;

		}

		this.index = json.index;

		this.object = this.editor.objectByUuid( json.object.object.uuid );

		if ( this.object === undefined ) {

			const loader = new ObjectLoader();
			this.object = loader.parse( json.object );

		}

	}

}

export { RemoveObjectCommand };
