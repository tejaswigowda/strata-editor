// ── Sidebar.Export.js ───────────────────────────────────────────────────────
// Export panel in the right sidebar. Provides the same exporters that used to
// live in the File → Export submenu (DRC, GLB, GLTF, OBJ, PLY, STL, USDZ).

import { UIPanel } from './libs/ui.js';
import { PropertyBinding, AnimationClip, AnimationMixer, Mesh, BufferGeometry, VectorKeyframeTrack, NumberKeyframeTrack } from 'three';
import { GLTFImportDialog } from './GLTFImportDialog.js';
import { optimizeObject, formatBytes, createProgressBanner } from './mesh/GeometryOptimizer.js';
import { includeCameraForBinding } from './intelligence/timelineController.js';
import { hasChangeEvents, lowerChangeEventsForExport } from './intelligence/textChange.js';
import { commitExportToRepo } from './Menubar.Git.js';

// Coerces an exporter's raw output (string / ArrayBuffer / Uint8Array) into
// the Uint8Array commitExportToRepo needs.
function toBytes( data ) {

	if ( typeof data === 'string' ) return new TextEncoder().encode( data );
	if ( data instanceof Uint8Array ) return data;
	return new Uint8Array( data );

}

const REPO_UPDATE_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-1-7.87A5 5 0 0 1 16 8.5 4 4 0 0 1 17 18H7z"/><path d="M12 12.5v6M9.5 15l2.5-2.5 2.5 2.5"/></svg>';

// Minimal THREE-shaped namespace for lowerChangeEventsForExport (this file
// imports individual classes rather than `* as THREE`, matching its style).
const THREE_NS = { Mesh, BufferGeometry, VectorKeyframeTrack, NumberKeyframeTrack, AnimationClip };

// change() lowering: materialize text states + scale/opacity tracks onto
// `scene` (a clone — never the live scene), warn (don't silently drop) on
// failure, and return clips to merge into the export's animations array.
function lowerChangesForExport( editor, scene ) {

	if ( ! hasChangeEvents( editor ) ) return [];

	const { clips, warnings } = lowerChangeEventsForExport( editor, scene, THREE_NS );

	if ( warnings.length > 0 ) {

		alert( 'Some change() events could not be exported:\n\n' + warnings.join( '\n' ) );

	}

	return clips;

}

// Object3D.clone() does NOT preserve uuids (a fresh one is generated per
// node) and only shallow-copies `.animations` — so a bare clone silently
// breaks every property-binding track in the compiled Timeline clip (which
// targets the ORIGINAL nodes' uuids). Walk both trees in the same
// deterministic pre-order traversal and copy uuids across so animation
// bindings (transform tracks AND change()'s lowered tracks) keep resolving
// against the clone. Also deep-clones geometry AND material so compression,
// change()-lowering, and rest-pose baking never mutate the live scene —
// Object3D.clone() shares the SAME material instance between original and
// clone by reference, so writing to a "cloned" mesh's material.opacity (e.g.
// via cloneSceneAtRestPose's mixer) would otherwise silently corrupt the live
// scene's materials too.
function cloneSceneForExport( scene ) {

	const clone = scene.clone( true );

	const originals = [];
	scene.traverse( ( o ) => originals.push( o ) );
	const clones = [];
	clone.traverse( ( o ) => clones.push( o ) );
	for ( let i = 0; i < originals.length; i ++ ) clones[ i ].uuid = originals[ i ].uuid;

	clone.traverse( ( child ) => {

		if ( child.geometry ) child.geometry = child.geometry.clone();
		if ( child.material ) child.material = Array.isArray( child.material ) ? child.material.map( m => m.clone() ) : child.material.clone();

	} );

	return clone;

}

// Exports must show a sensible STATIC pose to viewers that don't auto-play the
// embedded clip (most standalone glTF/USDZ viewers, AR Quick Look, etc.) — but
// the live scene's actual node transforms are whatever pose the Animations tab
// last happened to be scrubbed/held to, which can be any mid-animation frame
// (a rider/scooter/etc. can look "missing" simply because it got baked off in
// its position from t=40s instead of its resting spot). Resetting the LIVE
// scene to t=0 and restoring it after export sounds simpler, but races the
// live viewport/mixer (which can re-sample the old scrub position from its own
// state in between) — so instead this bakes t=0 onto the EXPORT CLONE only,
// via a throwaway AnimationMixer bound to the clone, never touching
// editor.mixer/editor.scene at all.
function cloneSceneAtRestPose( editor, scene ) {

	const clone = cloneSceneForExport( scene );

	const clip = ( editor.scene.animations || [] ).find( c => c.userData && c.userData.isTimeline );
	if ( clip ) {

		const mixer = new AnimationMixer( clone );
		const action = mixer.clipAction( clip, clone );
		action.play();
		action.paused = true;
		action.time = 0;
		mixer.update( 0 );

	}

	return clone;

}

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

	// `repo`, when given, is `{ ext, build }` — `build()` re-runs the same
	// export pipeline as the download button and resolves to the raw exporter
	// output (string/ArrayBuffer/Uint8Array), or null if the user cancelled a
	// confirm() along the way. Adds a small cloud badge that commits the result
	// to `outputs/<scene-basename>.<ext>` in the configured Git repo.
	function addButton( label, onClick, repo ) {

		const button = document.createElement( 'div' );
		button.title = label;
		button.style.position = 'relative';
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

		if ( repo ) {

			// Bigger than it looks: the OUTER element is the click target (22x22,
			// flush to the corner) so a slightly-off click still lands on it —
			// a 16x16 badge with no margin was too easy to miss and fall through
			// to the download button underneath with zero visible feedback.
			const badge = document.createElement( 'div' );
			badge.title = `Update outputs/<scene>.${ repo.ext } in the configured Git repo`;
			badge.style.cssText = 'position:absolute;top:0;right:0;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;';

			const dot = document.createElement( 'div' );
			dot.style.cssText = 'width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#08f;color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,0.9);transition:transform 0.1s;';
			dot.innerHTML = REPO_UPDATE_ICON;
			badge.appendChild( dot );

			badge.addEventListener( 'mouseenter', function () { dot.style.transform = 'scale(1.15)'; } );
			badge.addEventListener( 'mouseleave', function () { dot.style.transform = ''; } );
			badge.addEventListener( 'click', function ( event ) {

				event.stopPropagation();
				commitExportBuild( repo, label );

			} );
			button.appendChild( badge );

		}

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

	// Runs `repo.build()` then uploads the result to the configured repo,
	// reusing the progress banner already used by GLB (Opt)'s compression step.
	async function commitExportBuild( repo, label ) {

		const banner = createProgressBanner( `Building ${ label }…` );
		banner.indeterminate();

		try {

			const data = await repo.build();
			if ( data === null || data === undefined ) { banner.remove(); return; } // cancelled a confirm() in build()

			const { path } = await commitExportToRepo( repo.ext, toBytes( data ), `Update ${ label } export`, {
				onProgress: ( fraction, message ) => { if ( fraction !== null ) banner.update( fraction, 1, message ); }

			} );

			banner.done( `✓ Committed ${ path }` );
			setTimeout( () => banner.remove(), 1500 );

		} catch ( error ) {

			banner.remove();
			alert( `Could not update repo: ${ error.message }` );

		}

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

	// Shared by the download button and the "update repo" badge. Returns null
	// if the user cancelled the duplicate-names confirm().
	async function buildGLB() {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return null;

			ensureUniqueNames( scene );

		}

		// Always export a clone baked at the t=0 rest pose (see
		// cloneSceneAtRestPose) rather than whatever the live scene happens to
		// be scrubbed to, then lower any change() events onto that same clone.
		const exportScene = cloneSceneAtRestPose( editor, scene );
		const changeClips = lowerChangesForExport( editor, exportScene );

		const animations = combineAnimations( exportScene, changeClips.flatMap( c => c.tracks ) );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );

		const exporter = new GLTFExporter();

		const restoreCamera = includeCameraForExport( exportScene, optimizedAnimations );

		try {

			return await new Promise( ( resolve, reject ) => {

				exporter.parse( exportScene, resolve, reject, { binary: true, animations: optimizedAnimations } );

			} );

		} finally {

			restoreCamera();

		}

	}

	addButton( 'GLB', async function () {

		try {

			const result = await buildGLB();
			if ( result ) saveArrayBuffer( result, 'scene.glb' );

		} catch ( error ) {

			console.error( 'GLB export failed:', error );

		}

	}, { ext: 'glb', build: buildGLB } );

	// Export GLB (Optimized) — clones the scene, compresses geometry via the
	// wizard (weld / simplify / quantize), then writes a binary .glb. The live
	// editor scene is left untouched (geometries are cloned before optimizing).

	addButton( 'GLB (Opt)', async function () {

		const scene = editor.scene;

		if ( needsUniqueNames( scene ) ) { // see #25179

			if ( confirm( strings.getKey( 'prompt/file/export/duplicateNames' ) ) === false ) return;

			ensureUniqueNames( scene );

		}

		// Bake at the t=0 rest pose (see cloneSceneAtRestPose) rather than
		// whatever the live scene happens to be scrubbed to. Uuids are
		// preserved (see cloneSceneForExport) so the compiled Timeline clip's
		// tracks keep resolving to the right nodes in the clone.
		const clone = cloneSceneAtRestPose( editor, scene );

		// change() must be LOWERED onto this SAME clone (before compression, so
		// materialized text meshes get optimized too) — never silently dropped.
		const changeClips = lowerChangesForExport( editor, clone );

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

		const animations = combineAnimations( clone, changeClips.flatMap( c => c.tracks ) );

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

		// Always export a clone baked at the t=0 rest pose (see
		// cloneSceneAtRestPose) rather than whatever the live scene happens to
		// be scrubbed to, then lower any change() events onto that same clone.
		const exportScene = cloneSceneAtRestPose( editor, scene );
		const changeClips = lowerChangesForExport( editor, exportScene );

		const animations = combineAnimations( exportScene, changeClips.flatMap( c => c.tracks ) );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { GLTFExporter } = await import( 'three/addons/exporters/GLTFExporter.js' );

		const exporter = new GLTFExporter();

		const restoreCamera = includeCameraForExport( exportScene, optimizedAnimations );

		exporter.parse( exportScene, function ( result ) {

			restoreCamera();
			saveString( JSON.stringify( result, null, 2 ), 'scene.gltf' );

		}, function ( error ) {

			restoreCamera();
			console.error( 'GLTF export failed:', error );

		}, { animations: optimizedAnimations } );

	} );

	// Export OBJ

	async function buildOBJ() {

		const object = editor.selected;

		if ( object === null ) {

			alert( strings.getKey( 'prompt/file/export/noObjectSelected' ) );
			return null;

		}

		const { OBJExporter } = await import( 'three/addons/exporters/OBJExporter.js' );

		const exporter = new OBJExporter();

		return exporter.parse( object );

	}

	addButton( 'OBJ', async function () {

		const result = await buildOBJ();
		if ( result !== null ) saveString( result, 'model.obj' );

	}, { ext: 'obj', build: buildOBJ } );

	// Export PLY (ASCII)

	async function buildPLY( binary ) {

		const { PLYExporter } = await import( 'three/addons/exporters/PLYExporter.js' );

		const exporter = new PLYExporter();

		return await new Promise( ( resolve ) => {

			exporter.parse( editor.scene, resolve, { binary } );

		} );

	}

	addButton( 'PLY', async function () {

		saveArrayBuffer( await buildPLY( false ), 'model.ply' );

	}, { ext: 'ply', build: () => buildPLY( false ) } );

	// Export PLY (BINARY)

	addButton( 'PLY (BINARY)', async function () {

		saveArrayBuffer( await buildPLY( true ), 'model-binary.ply' );

	}, { ext: 'ply', build: () => buildPLY( true ) } );

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

	async function buildUSDZ() {

		// Always export a clone baked at the t=0 rest pose (see
		// cloneSceneAtRestPose) rather than whatever the live scene happens to
		// be scrubbed to. Same change()-lowering + animation-combining as
		// GLB/GLTF above — USDZ's exporter silently exports zero animation
		// unless clips are explicitly passed via options.animations.
		const scene = cloneSceneAtRestPose( editor, editor.scene );
		const changeClips = lowerChangesForExport( editor, scene );

		const animations = combineAnimations( scene, changeClips.flatMap( c => c.tracks ) );

		const optimizedAnimations = [];

		for ( const animation of animations ) {

			optimizedAnimations.push( animation.clone().optimize() );

		}

		const { USDZExporter } = await import( 'three/addons/exporters/USDZExporter.js' );

		const exporter = new USDZExporter();

		const restoreCamera = includeCameraForExport( scene, optimizedAnimations );

		try {

			return await exporter.parseAsync( scene, { animations: optimizedAnimations } );

		} finally {

			restoreCamera();

		}

	}

	addButton( 'USDZ', async function () {

		saveArrayBuffer( await buildUSDZ(), 'model.usdz' );

	}, { ext: 'usdz', build: buildUSDZ } );

	//

	// Merge every clip's tracks into ONE AnimationClip so the exported glTF/GLB
	// plays all animations together. glTF animations are independent and most
	// viewers play only one at a time, so separate clips would look like "only
	// one animation applied" — this is also why change()'s lowered tracks are
	// merged in here (as `extraTracks`) rather than kept as their own clips.
	// Returns [] when there's nothing to export.
	function combineAnimations( scene, extraTracks = [] ) {

		const tracks = [ ...extraTracks ];

		scene.traverse( function ( object ) {

			for ( const clip of object.animations ) {

				for ( const track of clip.tracks ) tracks.push( track );

			}

		} );

		return tracks.length > 0 ? [ new AnimationClip( 'Animation', - 1, tracks ) ] : [];

	}

	// The Universal Timeline can animate the viewport camera, which lives OUTSIDE
	// the exported scene graph. When a combined clip references the camera, parent
	// it under the scene for the duration of the export so GLTFExporter can bind
	// its channel and emit a camera node. Returns a restore() to undo it after.
	// (Shared with Timeline.js playback — same underlying gap, same fix.)
	function includeCameraForExport( scene, animations ) {

		return includeCameraForBinding( editor, animations );

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
