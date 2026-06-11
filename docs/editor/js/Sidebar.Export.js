// ── Sidebar.Export.js ───────────────────────────────────────────────────────
// Export panel in the right sidebar. Provides the same exporters that used to
// live in the File → Export submenu (DRC, GLB, GLTF, OBJ, PLY, STL, USDZ).

import { UIPanel, UIRow, UIButton } from './libs/ui.js';
import { PropertyBinding } from 'three';

function SidebarExport( editor ) {

	const strings = editor.strings;

	const saveArrayBuffer = editor.utils.saveArrayBuffer;
	const saveString = editor.utils.saveString;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	function addButton( label, onClick ) {

		const row = new UIRow();
		const button = new UIButton( label ).setWidth( '100%' );
		button.onClick( onClick );
		row.add( button );
		container.add( row );

	}

	// Export DRC

	addButton( 'DRC', async function () {

		const object = editor.selected;

		if ( object === null || object.isMesh === undefined ) {

			alert( strings.getKey( 'prompt/file/export/noMeshSelected' ) );
			return;

		}

		const { DRACOExporter } = await import( 'three/addons/exporters/DRACOExporter.js' );

		const exporter = new DRACOExporter();

		const options = {
			decodeSpeed: 5,
			encodeSpeed: 5,
			encoderMethod: DRACOExporter.MESH_EDGEBREAKER_ENCODING,
			quantization: [ 16, 8, 8, 8, 8 ],
			exportUvs: true,
			exportNormals: true,
			exportColor: object.geometry.hasAttribute( 'color' )
		};

		// TODO: Change to DRACOExporter's parse( geometry, onParse )?
		const result = exporter.parse( object, options );
		saveArrayBuffer( result, 'model.drc' );

	} );

	// Export GLB

	addButton( 'GLB', async function () {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return;

			ensureUniqueNames( scene );

		}

		const animations = getAnimations( scene );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );

		const exporter = new GLTFExporter();

		exporter.parse( scene, function ( result ) {

			saveArrayBuffer( result, 'scene.glb' );

		}, undefined, { binary: true, animations: optimizedAnimations } );

	} );

	// Export GLTF

	addButton( 'GLTF', async function () {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return;

			ensureUniqueNames( scene );

		}

		const animations = getAnimations( scene );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );

		const exporter = new GLTFExporter();

		exporter.parse( scene, function ( result ) {

			saveString( JSON.stringify( result, null, 2 ), 'scene.gltf' );

		}, undefined, { animations: optimizedAnimations } );

	} );

	// Export OBJ

	addButton( 'OBJ', async function () {

		const object = editor.selected;

		if ( object === null ) {

			alert( strings.getKey( 'prompt/file/export/noObjectSelected' ) );
			return;

		}

		const { OBJExporter } = await import( 'three/addons/exporters/OBJExporter.js' );

		const exporter = new OBJExporter();

		saveString( exporter.parse( object ), 'model.obj' );

	} );

	// Export PLY (ASCII)

	addButton( 'PLY', async function () {

		const { PLYExporter } = await import( 'three/addons/exporters/PLYExporter.js' );

		const exporter = new PLYExporter();

		exporter.parse( editor.scene, function ( result ) {

			saveArrayBuffer( result, 'model.ply' );

		} );

	} );

	// Export PLY (BINARY)

	addButton( 'PLY (BINARY)', async function () {

		const { PLYExporter } = await import( 'three/addons/exporters/PLYExporter.js' );

		const exporter = new PLYExporter();

		exporter.parse( editor.scene, function ( result ) {

			saveArrayBuffer( result, 'model-binary.ply' );

		}, { binary: true } );

	} );

	// Export STL (ASCII)

	addButton( 'STL', async function () {

		const { STLExporter } = await import( 'three/addons/exporters/STLExporter.js' );

		const exporter = new STLExporter();

		saveString( exporter.parse( editor.scene ), 'model.stl' );

	} );

	// Export STL (BINARY)

	addButton( 'STL (BINARY)', async function () {

		const { STLExporter } = await import( 'three/addons/exporters/STLExporter.js' );

		const exporter = new STLExporter();

		saveArrayBuffer( exporter.parse( editor.scene, { binary: true } ), 'model-binary.stl' );

	} );

	// Export USDZ

	addButton( 'USDZ', async function () {

		const { USDZExporter } = await import( 'three/addons/exporters/USDZExporter.js' );

		const exporter = new USDZExporter();

		saveArrayBuffer( await exporter.parseAsync( editor.scene ), 'model.usdz' );

	} );

	//

	function getAnimations( scene ) {

		const animations = [];

		scene.traverse( function ( object ) {

			animations.push( ... object.animations );

		} );

		return animations;

	}

	function needsUniqueNames( scene ) {

		const usedNames = new Set();
		let duplicate = false;
		let animated = false;

		scene.traverse( function ( object ) {

			if ( object.animations.length > 0 ) animated = true;

			if ( object.name === '' ) return;

			if ( usedNames.has( object.name ) ) duplicate = true;

			usedNames.add( object.name );

		} );

		return duplicate && animated;

	}

	// Gives every object a unique name and keeps the animation tracks that
	// reference them by name in sync. The renamed scene mirrors the result of a
	// glTF round-trip, where the loader makes all names unique, too.

	function ensureUniqueNames( scene ) {

		// Resolve each track's target object up front, scoped to the object that
		// owns the clip. This disambiguates colliding names before they change.

		const trackBindings = [];

		scene.traverse( function ( owner ) {

			for ( const clip of owner.animations ) {

				for ( const track of clip.tracks ) {

					const nodeName = PropertyBinding.parseTrackName( track.name ).nodeName;
					const target = PropertyBinding.findNode( owner, nodeName );

					// References by UUID stay valid, so only track name-based ones.

					if ( target !== null && target.name === nodeName ) {

						trackBindings.push( { track, target, nodeName } );

					}

				}

			}

		} );

		// Assign a unique name to every named object.

		let changed = false;
		const usedNames = new Set();

		scene.traverse( function ( object ) {

			if ( object.name === '' ) return;

			if ( usedNames.has( object.name ) ) {

				let suffix = 1, name;
				do {

					name = object.name + '_' + ( suffix ++ );

				} while ( usedNames.has( name ) );

				object.name = name;
				changed = true;

			}

			usedNames.add( object.name );

		} );

		if ( changed === false ) return;

		// Point the affected tracks at their renamed targets.

		for ( const { track, target, nodeName } of trackBindings ) {

			if ( target.name !== nodeName ) {

				track.name = target.name + track.name.slice( nodeName.length );

			}

		}

		editor.signals.sceneGraphChanged.dispatch();

	}

	return container;

}

export { SidebarExport };
