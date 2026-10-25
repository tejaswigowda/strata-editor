// Run: node docs/editor/js/intelligence/__tests__/renderFileName.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const { slug, projectName, resolutionLabel, durationLabel, fillTemplate, renderBaseName, DEFAULT_SNAPSHOT_TEMPLATE } = await import( path.join( here, '..', 'renderFileName.js' ) );

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

const date = new Date( 2026, 9, 25, 14, 10 );

test( 'slug keeps letters and digits, turns the rest into single dashes', () => {

	assert.strictEqual( slug( '  My Scene: v2!! ' ), 'My-Scene-v2' );
	assert.strictEqual( slug( 'Café déjà' ), 'Cafe-deja' );
	assert.strictEqual( slug( '' ), '' );
	assert.strictEqual( slug( null ), '' );

} );

test( 'projectName drops the folder and the extension', () => {

	assert.strictEqual( projectName( 'pyth.json' ), 'pyth' );
	assert.strictEqual( projectName( 'scenes/My Scene.json' ), 'My-Scene' );
	assert.strictEqual( projectName( '' ), '' );

} );

test( 'resolutionLabel uses p names for 16:9 and sizes otherwise', () => {

	assert.strictEqual( resolutionLabel( 1920, 1080 ), '1080p' );
	assert.strictEqual( resolutionLabel( 1280, 720 ), '720p' );
	assert.strictEqual( resolutionLabel( 854, 480 ), '480p' );
	assert.strictEqual( resolutionLabel( 1080, 1080 ), '1080x1080' );
	assert.strictEqual( resolutionLabel( 4096, 2048 ), '4096x2048' );

} );

test( 'durationLabel reads like a person would say it', () => {

	assert.strictEqual( durationLabel( 45 ), '45s' );
	assert.strictEqual( durationLabel( 100.5 ), '1m41s' );
	assert.strictEqual( durationLabel( 120 ), '2m0s' );
	assert.strictEqual( durationLabel( 3725 ), '1h2m5s' );

} );

test( 'the default video name is readable', () => {

	assert.strictEqual( renderBaseName( { project: 'pyth.json', width: 1920, height: 1080, fps: 30, duration: 100.5, date } ), 'pyth_1m41s_1080p_30fps_2026-10-25' );

} );

test( '360 renders say so, and others leave no gap', () => {

	assert.strictEqual( renderBaseName( { project: 'pyth.json', width: 4096, height: 2048, fps: 30, duration: 10, is360: true, date } ), 'pyth_360_10s_4096x2048_30fps_2026-10-25' );

} );

test( 'a custom template is filled and cleaned', () => {

	assert.strictEqual( renderBaseName( { template: 'Pythagoras - {res} {fps}fps', project: 'pyth.json', width: 1280, height: 720, fps: 24, duration: 60, date } ), 'Pythagoras-720p-24fps' );
	assert.strictEqual( renderBaseName( { template: '{project}__{nonsense}__{date}', project: 'a.json', width: 640, height: 360, fps: 30, duration: 5, date } ), 'a_2026-10-25' );

} );

test( 'a template that fills to nothing falls back to a usable name', () => {

	assert.strictEqual( renderBaseName( { template: '{camera}', project: 'a', width: 640, height: 360, fps: 30, duration: 5, date } ), 'render' );
	assert.strictEqual( fillTemplate( '///', {} ), 'render' );

} );

test( 'path characters cannot get into a name', () => {

	const name = renderBaseName( { template: '../../{project}\\x', project: 'a', width: 640, height: 360, fps: 30, duration: 5, date } );
	assert.ok( ! /[\\/]/.test( name ), name );

} );

test( 'a snapshot name has the camera, size and time, and skips the default camera', () => {

	const info = { template: DEFAULT_SNAPSHOT_TEMPLATE, project: 'pyth.json', width: 1920, height: 1080, date };
	assert.strictEqual( renderBaseName( { ...info, camera: 'Close Up' } ), 'pyth_Close-Up_1080p_2026-10-25_1410' );
	assert.strictEqual( renderBaseName( { ...info, camera: 'PerspectiveCamera' } ), 'pyth_1080p_2026-10-25_1410' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
if ( fail ) process.exit( 1 );
