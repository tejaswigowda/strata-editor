// ── Sidebar.Export.js ───────────────────────────────────────────────────────
// Export panel in the right sidebar. Provides the same exporters that used to
// live in the File → Export submenu (DRC, GLB, GLTF, OBJ, PLY, STL, USDZ).

import { UIPanel } from './libs/ui.js';
import { PropertyBinding, AnimationClip } from 'three';
import { GLTFImportDialog } from './GLTFImportDialog.js';
import { optimizeObject, formatBytes, createProgressBanner } from './mesh/GeometryOptimizer.js';

// Per-format icons for the export buttons (same box-button style as Stencils).
function svg( inner ) {

	return `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ inner }</svg>`;

}

// Fallback download icon for any format without a dedicated glyph.
const EXPORT_ICON = svg( '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' );

const EXPORT_ICONS = {

	'DRC':          svg( '<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10h16M10 6V4h4v2"/><path d="M9 14l3 2.5 3-2.5"/>' ),      // compressed package
	'GLB':          svg( '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>' ),                                       // solid cube
	'GLTF':         svg( '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12s-1.2 0-1.2 1.2 1.2 1.2 1.2 2.4-1.2 1.2-1.2 1.2M14 12s1.2 0 1.2 1.2-1.2 1.2-1.2 2.4 1.2 1.2 1.2 1.2"/>' ), // doc with braces
	'OBJ':          svg( '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><path d="M12 2v20M3.3 7l8.7 5 8.7-5"/>' ),                                       // wireframe polyhedron
	'PLY':          '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" stroke="none"><circle cx="6" cy="9" r="1.3"/><circle cx="12" cy="5.5" r="1.3"/><circle cx="18" cy="9.5" r="1.3"/><circle cx="8.5" cy="15" r="1.3"/><circle cx="14.5" cy="14" r="1.3"/><circle cx="17.5" cy="18.5" r="1.3"/><circle cx="9" cy="19" r="1.3"/></svg>', // point cloud
	'STL':          svg( '<path d="M12 3l9 16H3z"/><path d="M6.5 15h11M8.5 11h7"/>' ),                                                              // triangle layers
	'USDZ':         svg( '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/><path d="M18.3 3.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>' ), // AR cube + sparkle

};

EXPORT_ICONS[ 'PLY (BINARY)' ] = EXPORT_ICONS[ 'PLY' ];
EXPORT_ICONS[ 'STL (BINARY)' ] = EXPORT_ICONS[ 'STL' ];
EXPORT_ICONS[ 'GLB (OPT)' ] = svg( '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/><path d="M18.5 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>' );

function SidebarExport( editor ) {

	const strings = editor.strings;

	const saveArrayBuffer = editor.utils.saveArrayBuffer;
	const saveString = editor.utils.saveString;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	// Box buttons flow inline and wrap inside a grid — identical to Stencils.
	const grid = document.createElement( 'div' );
	grid.style.display = 'flex';
	grid.style.flexWrap = 'wrap';
	grid.style.gap = '6px';
	grid.style.padding = '4px 0 12px';
	container.dom.appendChild( grid );

	function addButton( label, onClick ) {

		const button = document.createElement( 'div' );
		button.title = label;
		button.style.display = 'inline-flex';
		button.style.flexDirection = 'column';
		button.style.alignItems = 'center';
		button.style.justifyContent = 'center';
		button.style.boxSizing = 'border-box';
		button.style.width = '64px';
		button.style.height = '64px';
		button.style.padding = '6px';
		button.style.border = '1px solid rgba(127,127,127,0.3)';
		button.style.borderRadius = '4px';
		button.style.cursor = 'pointer';
		button.style.userSelect = 'none';

		const icon = document.createElement( 'span' );
		icon.innerHTML = EXPORT_ICONS[ label ] || EXPORT_ICON;
		const svgEl = icon.firstChild;
		if ( svgEl ) {

			svgEl.style.width = '28px';
			svgEl.style.height = '28px';
			svgEl.style.display = 'block';
			svgEl.style.opacity = '0.85';

		}

		button.appendChild( icon );

		const text = document.createElement( 'span' );
		text.textContent = label;
		text.style.marginTop = '5px';
		text.style.maxWidth = '100%';
		text.style.fontSize = '10px';
		text.style.lineHeight = '1.1';
		text.style.textAlign = 'center';
		text.style.whiteSpace = 'nowrap';
		text.style.overflow = 'hidden';
		text.style.textOverflow = 'ellipsis';
		button.appendChild( text );

		button.addEventListener( 'click', onClick );

		button.addEventListener( 'mouseenter', function () {

			button.style.background = 'rgba(127,127,127,0.15)';

		} );

		button.addEventListener( 'mouseleave', function () {

			button.style.background = '';

		} );

		grid.appendChild( button );

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

		const animations = combineAnimations( scene );

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

	// Export GLB (Optimized) — clones the scene, compresses geometry via the
	// wizard (weld / simplify / quantize), then writes a binary .glb. The live
	// editor scene is left untouched (geometries are cloned before optimizing).

	addButton( 'GLB (Opt)', async function () {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return;

			ensureUniqueNames( scene );

		}

		// Work on a deep copy so compression never mutates the live scene.
		const clone = scene.clone( true );
		clone.traverse( ( child ) => {

			if ( child.geometry ) child.geometry = child.geometry.clone();

		} );

		let options;

		try {

			const dialog = new GLTFImportDialog( strings, clone, {
				hideAsScene: true,
				title: 'Export Optimized GLB',
				confirmLabel: 'Export',
				defaultPreset: 'medium',
			} );
			options = await dialog.show();

		} catch ( e ) {

			return; // cancelled

		}

		if ( options.compress && options.compressionOptions ) {

			const banner = createProgressBanner( 'Compressing geometry…' );

			try {

				const { before, after } = await optimizeObject(
					clone,
					options.compressionOptions,
					( done, total ) => banner.update( done, total, `Compressing geometry… ${ done }/${ total }` )
				);
				const pct = before.bytes > 0 ? Math.round( ( 1 - after.bytes / before.bytes ) * 100 ) : 0;

				if ( editor.importLog ) {

					editor.importLog(
						`🗜 Optimized export: ${ before.triangles.toLocaleString() }→${ after.triangles.toLocaleString() } tris, ` +
						`${ formatBytes( before.bytes ) }→${ formatBytes( after.bytes ) } (−${ pct }%)`
					);

				}

			} finally {

				banner.remove();

			}

		}

		const animations = combineAnimations( scene );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );

		const exporter = new GLTFExporter();

		const exportBanner = createProgressBanner();
		exportBanner.done( 'Writing GLB…' );

		exporter.parse( clone, function ( result ) {

			exportBanner.remove();
			saveArrayBuffer( result, 'scene.optimized.glb' );

		}, function ( error ) {

			exportBanner.remove();
			console.error( 'GLB (Opt) export failed:', error );

		}, { binary: true, animations: optimizedAnimations } );

	} );

	// Export GLTF

	addButton( 'GLTF', async function () {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return;

			ensureUniqueNames( scene );

		}

		const animations = combineAnimations( scene );

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

	// Merge every clip's tracks into ONE AnimationClip so the exported glTF/GLB
	// plays all animations together. glTF animations are independent and most
	// viewers play only one at a time, so separate clips would look like "only
	// one animation applied". Returns [] when there's nothing to export.
	function combineAnimations( scene ) {

		const tracks = [];

		scene.traverse( function ( object ) {

			for ( const clip of object.animations ) {

				for ( const track of clip.tracks ) tracks.push( track );

			}

		} );

		return tracks.length > 0 ? [ new AnimationClip( 'Animation', - 1, tracks ) ] : [];

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
