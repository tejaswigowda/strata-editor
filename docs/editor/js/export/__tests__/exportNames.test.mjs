// Run: node docs/editor/js/export/__tests__/exportNames.test.mjs
// What the Export tab, the File menu and the Shell call the files they download.
import assert from 'node:assert';
import { safeName, baseOf, exportBaseName, exportFileName, exportNameFor } from '../exportNames.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  \u2713 ' + name ); pass ++; }
	catch ( e ) { console.error( '  \u2717 ' + name + '\n      ' + e.message ); fail ++; }

}

test( 'a name is safe for a file system and keeps an author\'s underscores', () => {

	assert.strictEqual( safeName( 'Duck_Beak' ), 'Duck_Beak' );
	assert.strictEqual( safeName( 'My Scene: v2?' ), 'My-Scene-v2' );
	assert.strictEqual( safeName( 'Café déjà vu' ), 'Cafe-deja-vu' );
	assert.strictEqual( safeName( '../../etc/passwd' ), 'etc-passwd' );
	assert.strictEqual( safeName( '' ), '' );
	assert.strictEqual( safeName( null ), '' );
	assert.strictEqual( safeName( 'x'.repeat( 200 ) ).length, 80 );

} );

test( 'a base name drops the folder and a known extension, and only those', () => {

	assert.strictEqual( baseOf( 'scenes/My Scene.json' ), 'My-Scene' );
	assert.strictEqual( baseOf( 'cyberpunk_micro-apartments.glb' ), 'cyberpunk_micro-apartments' );
	assert.strictEqual( baseOf( 'Avocado' ), 'Avocado' );
	assert.strictEqual( baseOf( 'v1.2 model' ), 'v1.2-model' );

} );

test( 'the selection names the file when the export is of the selection', () => {

	assert.strictEqual( exportBaseName( { selected: 'Duck_Beak', source: 'duck.json', sceneName: 'Scene' } ), 'Duck_Beak' );

} );

test( 'the file the scene came from names it, unless that name says nothing', () => {

	assert.strictEqual( exportBaseName( { source: 'pyth.json', sceneName: 'Scene' } ), 'pyth' );
	assert.strictEqual( exportBaseName( { source: 'scene.json', sceneName: 'Kitchen' } ), 'Kitchen' );
	assert.strictEqual( exportBaseName( { source: 'scene.json', sceneName: 'Scene', roots: [ 'Avocado' ] } ), 'Avocado' );

} );

test( 'the scene\'s own name comes next, but not the default one', () => {

	assert.strictEqual( exportBaseName( { sceneName: 'Night Market' } ), 'Night-Market' );
	assert.strictEqual( exportBaseName( { sceneName: 'Scene', roots: [ 'a.glb', 'b.glb' ] } ), 'scene' );

} );

test( 'a scene with one thing in it is named after it, as an import is', () => {

	assert.strictEqual( exportBaseName( { sceneName: 'Scene', roots: [ 'cyberpunk_micro-apartments.glb' ] } ), 'cyberpunk_micro-apartments' );
	assert.strictEqual( exportBaseName( { roots: [ 'Group' ] } ), 'scene', 'a generic name is not a name' );
	assert.strictEqual( exportBaseName( { roots: [ 'Sketchfab_model' ] } ), 'scene' );

} );

test( 'nothing to go on gives the caller\'s fallback, and never an empty name', () => {

	assert.strictEqual( exportBaseName( {} ), 'scene' );
	assert.strictEqual( exportBaseName(), 'scene' );
	assert.strictEqual( exportBaseName( { fallback: 'project' } ), 'project' );
	assert.strictEqual( exportBaseName( { fallback: '???' } ), 'scene' );
	assert.strictEqual( exportBaseName( { source: 'scene.json' } ), 'scene', 'the generic file name is the last resort, not skipped' );

} );

test( 'a file name is base, suffix, extension', () => {

	assert.strictEqual( exportFileName( 'Duck', 'glb' ), 'Duck.glb' );
	assert.strictEqual( exportFileName( 'Duck', '.glb' ), 'Duck.glb' );
	assert.strictEqual( exportFileName( 'Duck', 'glb', '.optimized' ), 'Duck.optimized.glb' );
	assert.strictEqual( exportFileName( 'Duck', 'ply', '-binary' ), 'Duck-binary.ply' );
	assert.strictEqual( exportFileName( '', 'obj' ), 'scene.obj' );

} );

// a stand-in for the editor: the scene, the selection and the work state's source key
function fakeEditor( { key = 'local', sceneName = 'Scene', roots = [], selected = null } = {} ) {

	const children = roots.map( n => ( typeof n === 'string' ? { name: n } : n ) );
	return { scene: { name: sceneName, children }, selected: selected && { name: selected }, work: { status: () => ( { key } ) } };

}

test( 'from an editor: an imported model, exported whole', () => {

	const ed = fakeEditor( { roots: [ { name: 'Edit Camera', isCamera: true }, { name: 'sun', isLight: true }, 'cyberpunk_micro-apartments.glb' ] } );
	assert.strictEqual( exportNameFor( ed, 'glb' ), 'cyberpunk_micro-apartments.glb' );
	assert.strictEqual( exportNameFor( ed, 'glb', { suffix: '.optimized' } ), 'cyberpunk_micro-apartments.optimized.glb' );
	assert.strictEqual( exportNameFor( ed, 'stl', { suffix: '-binary' } ), 'cyberpunk_micro-apartments-binary.stl' );

} );

test( 'from an editor: a scene loaded from a repo file', () => {

	const ed = fakeEditor( { key: 'git:tejaswigowda/test1@main:scenes/duck.json', roots: [ 'Duck', 'Floor' ] } );
	assert.strictEqual( exportNameFor( ed, 'glb' ), 'duck.glb' );
	assert.strictEqual( exportNameFor( ed, 'json', { fallback: 'project' } ), 'duck.json' );

} );

test( 'from an editor: the selection, when the export is of the selection, else the scene', () => {

	const ed = fakeEditor( { key: 'git:tejaswigowda/test1@main:duck.json', roots: [ 'Duck' ], selected: 'Duck_Beak' } );
	assert.strictEqual( exportNameFor( ed, 'obj', { selection: true } ), 'Duck_Beak.obj' );
	assert.strictEqual( exportNameFor( ed, 'glb' ), 'duck.glb', 'a whole-scene export ignores the selection' );
	assert.strictEqual( exportNameFor( fakeEditor( { key: 'git:o/r@main:duck.json' } ), 'obj', { selection: true } ), 'duck.obj', 'nothing selected: the scene' );

} );

test( 'from an editor: a bare scene, and one with no work state at all', () => {

	assert.strictEqual( exportNameFor( fakeEditor( { roots: [ 'a', 'b' ] } ), 'glb' ), 'scene.glb' );
	assert.strictEqual( exportNameFor( { scene: { name: 'Scene', children: [] } }, 'json', { fallback: 'project' } ), 'project.json' );
	assert.strictEqual( exportNameFor( fakeEditor( { key: 'git:o/r@main:scene.json', roots: [ 'a', 'b' ] } ), 'glb' ), 'scene.glb', 'the repo\'s own default file name, as before' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
