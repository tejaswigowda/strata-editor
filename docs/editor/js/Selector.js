import * as THREE from 'three';

const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

class Selector {

	constructor( editor ) {

		const signals = editor.signals;

		this.editor = editor;
		this.signals = signals;

		// signals

		signals.intersectionsDetected.add( ( intersects, additive = false ) => {

			if ( intersects.length > 0 ) {

				// Resolve helpers to their actual objects

				const objects = [];

				for ( let i = 0; i < intersects.length; i ++ ) {

					let object = intersects[ i ].object;

					if ( object.userData.object !== undefined ) {

						object = object.userData.object;

					}

					if ( objects.indexOf( object ) === - 1 ) {

						objects.push( object );

					}

				}

				if ( additive ) {

					// Toggle the first picked object in the multi-selection

					this.select( objects[ 0 ], true );

				} else {

					// Cycle through objects if the first one is already selected

					const index = objects.indexOf( editor.selected );

					if ( index !== - 1 && index < objects.length - 1 ) {

						this.select( objects[ index + 1 ] );

					} else {

						this.select( objects[ 0 ] );

					}

				}

			} else if ( additive === false ) {

				this.select( null );

			}

		} );

	}

	getIntersects( raycaster ) {

		const objects = [];

		this.editor.scene.traverseVisible( function ( child ) {

			objects.push( child );

		} );

		this.editor.sceneHelpers.traverseVisible( function ( child ) {

			if ( child.name === 'picker' ) objects.push( child );

		} );

		return raycaster.intersectObjects( objects, false );

	}

	getPointerIntersects( point, camera ) {

		mouse.set( ( point.x * 2 ) - 1, - ( point.y * 2 ) + 1 );

		raycaster.setFromCamera( mouse, camera );

		return this.getIntersects( raycaster );

	}

	select( object, additive = false ) {

		const editor = this.editor;
		const selection = editor.selectionMultiple;

		if ( additive && object !== null ) {

			// Toggle the object in the current multi-selection

			const index = selection.indexOf( object );

			if ( index === - 1 ) {

				selection.push( object );

			} else {

				selection.splice( index, 1 );

			}

		} else {

			// Replace the selection

			if ( object === null ) {

				selection.length = 0;

			} else {

				selection.length = 0;
				selection.push( object );

			}

		}

		// The primary object is the last one in the selection ( drives the sidebar )

		const primary = selection.length > 0 ? selection[ selection.length - 1 ] : null;

		const changed = editor.selected !== primary || additive;

		editor.selected = primary;
		editor.config.setKey( 'selected', primary !== null ? primary.uuid : null );

		if ( changed ) {

			this.signals.objectSelected.dispatch( primary );

		}

		this.signals.selectionChanged.dispatch( selection.slice() );

	}

	deselect() {

		this.select( null );

	}

}

export { Selector };
