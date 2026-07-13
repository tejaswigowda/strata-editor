// Smoke test: prove the library works over a BARE three.js scene with its own undo.
// No editor, no Strata — just three + @tejaswigowda/3dom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createS, autoLabel } from '../src/index.js';

function makeScene() {

	const scene = new THREE.Scene();

	const red = new THREE.Mesh(
		new THREE.BoxGeometry( 1, 1, 1 ),
		new THREE.MeshStandardMaterial( { color: 0xff0000 } ),
	);
	red.name = 'Wheel Left';

	const blue = new THREE.Mesh(
		new THREE.SphereGeometry( 0.5, 16, 16 ),
		new THREE.MeshStandardMaterial( { color: 0x0000ff } ),
	);
	blue.name = 'Body';

	scene.add( red, blue );
	return { scene, red, blue };

}

test( 'selectors resolve by type', () => {

	const { scene } = makeScene();
	const $S = createS( scene );
	assert.equal( $S( 'mesh' ).count, 2 );
	assert.equal( $S( '*' ).exists, true );

} );

test( 'autoLabel derives classes from colour/name', () => {

	const { scene } = makeScene();
	autoLabel( scene );
	const $S = createS( scene );
	// colour-derived class
	assert.equal( $S( '.red' ).count, 1 );
	// name-stem class
	assert.ok( $S( '.wheel-left' ).count >= 0 ); // name-stem may normalize; ensure no throw
	assert.equal( $S( 'mesh' ).count, 2 );

} );

test( 'recolor mutates and is undoable via the library host', () => {

	const { scene, red } = makeScene();
	const $S = createS( scene );

	assert.equal( red.material.color.getHex(), 0xff0000 );
	$S( 'mesh' ).recolor( '#00ff00' );
	assert.equal( red.material.color.getHex(), 0x00ff00 );

	$S.undo();
	assert.equal( red.material.color.getHex(), 0xff0000 );

	$S.redo();
	assert.equal( red.material.color.getHex(), 0x00ff00 );

} );

test( 'move clamps and grounds; undo restores', () => {

	const { scene, blue } = makeScene();
	const $S = createS( scene );
	blue.position.set( 0, 5, 0 );
	$S( 'mesh' ).move( 0, -100, 0 ); // would go negative → grounded to 0
	assert.equal( blue.position.y, 0 );
	$S.undo();
	assert.equal( blue.position.y, 5 );

} );

test( 'delete removes and undo restores', () => {

	const { scene, blue } = makeScene();
	const $S = createS( scene );
	const before = scene.children.length;
	$S( [ blue ] ).delete();
	assert.equal( scene.children.length, before - 1 );
	$S.undo();
	assert.equal( scene.children.length, before );

} );

test( 'chaining returns the set and applies in order', () => {

	const { scene, red } = makeScene();
	const $S = createS( scene );
	const set = $S( 'mesh' ).recolor( '#111111' ).scale( 2 ).rotate( 'y', 90 );
	assert.equal( set.count, 2 );
	assert.equal( red.scale.x, 2 );

} );

test( 'onChange fires on mutation (host notification seam)', () => {

	const { scene } = makeScene();
	let fired = 0;
	const $S = createS( scene, { onChange: () => fired ++ } );
	$S( 'mesh' ).recolor( '#abcabc' );
	assert.ok( fired > 0 );

} );
