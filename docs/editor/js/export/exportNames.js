// ── exportNames.js ────────────────────────────────────────────────────────────
// Names the files the Export tab, the File menu and the Shell download, so that a duck exports as `Duck.glb`, a selected beak as `Duck_Beak.obj`,
// and a scene loaded from `pyth.json` as `pyth.glb`, instead of every export being `scene.glb` or `model.obj`. Pure functions, so the rules are testable.
//
// The base name is the first of these that says something:
//   1. the selected object, when the export is of the selection (OBJ, DRC; the Shell's exports);
//   2. the file the scene was loaded from or saved to (`duck.json` → `duck`), unless it is a generic name (`scene.json`);
//   3. the scene's own name, unless it is the default (`Scene`);
//   4. the one thing in the scene, when there is only one (an imported `Avocado.glb`; cameras and lights do not count);
//   5. the generic file name, then `scene` (or whatever the caller's fallback is).
// The same base is what a commit to the repo uses (`outputs/<scene>.<ext>`), so a download and a commit of the same scene agree.

import { sourceFile } from '../workState.js';

const KNOWN_EXT = /\.(json|glb|gltf|vrm|obj|fbx|dae|stl|ply|usdz|drc)$/i;
// names that say nothing: the default scene, the importers' wrappers, the file names this tool itself defaults to
const GENERIC = /^(scene|project|model|untitled|root|group|object3d|default|sketchfab[-_]model|gltf[-_]scenerootnode|auxscene)$/i;

/** A file-name-safe version of free text: letters, digits, dot, dash and underscore (an author's `Duck_Beak` stays); spaces and anything else become a dash. */
export function safeName( text ) {

	return String( text == null ? '' : text )
		.normalize( 'NFKD' ).replace( /[\u0300-\u036f]/g, '' )
		.replace( /[^A-Za-z0-9._-]+/g, '-' )
		.replace( /-{2,}/g, '-' )
		.replace( /^[-_.]+|[-_.]+$/g, '' )
		.slice( 0, 80 );

}

/** 'folder/My Scene.json' → 'My-Scene'; 'Avocado.glb' → 'Avocado'; '' → ''. */
export function baseOf( text ) {

	return safeName( String( text == null ? '' : text ).split( '/' ).pop().replace( KNOWN_EXT, '' ) );

}

const informative = base => !! base && ! GENERIC.test( base );

/**
 * The base name (no extension) of an export.
 * info: { selected, source, sceneName, roots, fallback }
 *   selected   name of the selected object, when the export is of the selection
 *   source     the file the scene was loaded from or saved to
 *   sceneName  the scene object's name
 *   roots      names of what is directly in the scene, cameras and lights left out
 */
export function exportBaseName( { selected, source, sceneName, roots = [], fallback = 'scene' } = {} ) {

	const sel = baseOf( selected );
	if ( sel ) return sel;
	const src = baseOf( source );
	if ( informative( src ) ) return src;
	const own = baseOf( sceneName );
	if ( informative( own ) ) return own;
	const only = roots.length === 1 ? baseOf( roots[ 0 ] ) : '';
	if ( informative( only ) ) return only;
	return src || safeName( fallback ) || 'scene';

}

/** base + suffix + extension: ('Duck', 'glb') → 'Duck.glb'; ('Duck', 'glb', '.optimized') → 'Duck.optimized.glb'; ('Duck', 'ply', '-binary') → 'Duck-binary.ply'. */
export function exportFileName( base, ext, suffix = '' ) {

	return `${ base || 'scene' }${ suffix }.${ String( ext ).replace( /^\./, '' ) }`;

}

/**
 * The file name for an export from this editor.
 *   exportNameFor( editor, 'glb' )                              the whole scene
 *   exportNameFor( editor, 'obj', { selection: true } )         the selection (or the scene, when nothing is selected)
 *   exportNameFor( editor, 'json', { fallback: 'project' } )    a project file
 */
export function exportNameFor( editor, ext, { selection = false, suffix = '', fallback = 'scene' } = {} ) {

	const status = editor.work && editor.work.status ? editor.work.status() : null;
	const scene = editor.scene;
	const roots = ( scene.children || [] ).filter( o => ! o.isCamera && ! o.isLight ).map( o => o.name );
	const base = exportBaseName( {
		selected: selection && editor.selected ? editor.selected.name : '',
		source: status ? sourceFile( status.key ) : '',
		sceneName: scene.name,
		roots, fallback
	} );
	return exportFileName( base, ext, suffix );

}
