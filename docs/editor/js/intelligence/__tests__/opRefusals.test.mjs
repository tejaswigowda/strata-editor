import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from '../../../../build/three.module.js';
import { assertLoadableScene, assertSceneGraph, validateSceneJSON } from '../sceneValidation.js';

registerHooks( { resolve: ( specifier, context, next ) => next( specifier === 'three' ? import.meta.resolve( '../../../../build/three.module.js' ) : specifier, context ) } );
globalThis.window = { THREE };
globalThis.THREE = THREE;
const { validateCommand } = await import( '../commandConstraints.js' );
const { SetScaleCommand } = await import( '../../commands/SetScaleCommand.js' );
const { AddAnimationClipCommand } = await import( '../../commands/AddAnimationClipCommand.js' );
const { executeEditOp } = await import( '../editOps.js' );
const { makeQuery, op, OP_VOCABULARY } = await import( '../opPrimitive.js' );

function fixture() {

	const scene = new THREE.Scene();
	const tree = new THREE.Object3D();
	tree.name = 'tree4';
	scene.add( tree );
	const editor = {
		scene, strings: { getKey: key => key },
		signals: { objectChanged: { dispatch() {} } },
		execute( command ) {

			const refusal = validateCommand( command );
			if ( refusal ) return refusal;
			command.execute();

		}
	};
	return { tree, editor };

}

test( 'GUI command, Shell transform handle, and structured edit refuse zero; catalogue floor retries', () => {

	const { tree, editor } = fixture();
	const gui = editor.execute( new SetScaleCommand( editor, tree, new THREE.Vector3( 0, 1, 1 ) ) );
	const shell = makeQuery( editor )( '#tree4' ).scale.set( 0, 1, 1 );
	const agent = executeEditOp( editor, { op: 'scaleTo', selector: '#tree4', args: { factor: 0 } } );
	const vectorMethod = makeQuery( editor )( '#tree4' ).scale.multiplyScalar( 0 );
	for ( const result of [ gui, shell, agent, vectorMethod ] ) {

		assert.equal( result.success, false );
		assert.equal( result.code, 'SCALE_ZERO' );
		assert.equal( result.nearest, 0.001 );
		assert.match( result.message, /got 0/ );

	}
	assert.deepEqual( tree.scale.toArray(), [ 1, 1, 1 ] );
	const factor = OP_VOCABULARY.scaleTo.domains.factor.minimumMagnitude;
	assert.equal( executeEditOp( editor, { op: 'scaleTo', selector: '#tree4', args: { factor } } ).success, true );
	assert.deepEqual( tree.scale.toArray(), [ 0.001, 0.001, 0.001 ] );

} );

test( 'zero quaternion, invalid duration and non-finite position refuse before execution', () => {

	const { editor } = fixture();
	editor.execute = () => assert.fail( 'invalid command executed' );
	assert.equal( makeQuery( editor )( '#tree4' ).quaternion.set( 0, 0, 0, 0 ).code, 'QUAT_NOT_NORMALIZED' );
	assert.equal( op( editor, { type: 'spin', selector: '#tree4', duration: 0 } ).code, 'CLIP_DURATION_INVALID' );
	assert.equal( makeQuery( editor )( '#tree4' ).animate( { rotateY: 45 }, 0 ).result().code, 'CLIP_DURATION_INVALID' );
	assert.equal( op( editor, { type: 'moveTo', selector: '#tree4', x: NaN, y: 1, z: 1 } ).code, 'NUMBER_NOT_FINITE' );

} );

test( 'importing a clip with duplicate keys refuses before it is registered', () => {

	const { editor, tree } = fixture();
	const track = new THREE.NumberKeyframeTrack( '.position[x]', [ 38, 38.00000001 ], [ 1, 2 ] );
	const clip = new THREE.AnimationClip( 'broken', 40, [ track ] );
	const result = editor.execute( new AddAnimationClipCommand( editor, clip, tree ) );
	assert.equal( result.code, 'KEYFRAME_TIME_DUPLICATE' );
	assert.deepEqual( tree.animations, [] );

} );

test( 'save and load report all broken objects and disallow float32 duplicate keys', () => {

	const { editor, tree } = fixture();
	tree.scale.x = 0;
	const other = tree.clone();
	other.name = 'tree5';
	other.scale.set( 1, 0, 1 );
	editor.scene.add( other );
	editor.scene.updateMatrixWorld( true );
	const json = { scene: editor.scene.toJSON(), animations: [ {
		object: tree.uuid, clip: { duration: 40, tracks: [ { name: '.position', type: 'vector', times: [ 38, 38.00000001 ], values: [ 1, 2, 3, 4, 5, 6 ] } ] }
	} ] };
	assert.throws( () => assertLoadableScene( json, 'save' ), error => {

		assert.deepEqual( error.issues.map( issue => [ issue.object, issue.argument, issue.code ] ), [
			[ 'tree4', 'scale.x', 'SCALE_ZERO' ], [ 'tree5', 'scale.y', 'SCALE_ZERO' ], [ 'tree4', 'track .position.times[1]', 'KEYFRAME_TIME_DUPLICATE' ]
		] );
		return true;

	} );
	assert.throws( () => assertLoadableScene( json, 'load' ), /tree5.*scale\.y.*got 0/ );

} );

test( 'cycles and missing references have distinct refusal codes', () => {

	const { editor, tree } = fixture();
	const json = { scene: editor.scene.toJSON() };
	json.scene.object.children[ 0 ].geometry = 'missing-geometry';
	assert.equal( validateSceneJSON( json )[ 0 ].code, 'REFERENCE_MISSING' );
	tree.children.push( editor.scene );
	assert.throws( () => assertSceneGraph( editor.scene ), error => error.issues[ 0 ].code === 'PARENT_CYCLE' );

} );

test( 'short identical-value holds normalize without changing duration or the input', () => {

	const { editor, tree } = fixture();
	const clip = { duration: 40, tracks: [ { name: '.position', type: 'vector', times: [ 38, 38.000999450683594 ], values: [ 1, 2, 3, 1, 2, 3 ] } ] };
	const json = { scene: editor.scene.toJSON(), animations: [ { object: tree.uuid, clip } ] };
	const saved = assertLoadableScene( json, 'save' );
	assert.deepEqual( saved.animations[ 0 ].clip.tracks[ 0 ].times, [ 38 ] );
	assert.deepEqual( saved.animations[ 0 ].clip.tracks[ 0 ].values, [ 1, 2, 3 ] );
	assert.equal( saved.animations[ 0 ].clip.duration, 40 );
	assert.equal( clip.tracks[ 0 ].times.length, 2 );
	assert.deepEqual( validateSceneJSON( saved ), [] );

} );

test( 'optional real FutureFlux fixture passes scene validation', { skip: ! process.env.STRATA_TREE_FIXTURE }, async () => {

	const json = JSON.parse( await readFile( process.env.STRATA_TREE_FIXTURE, 'utf8' ) );
	assert.deepEqual( validateSceneJSON( json ), [] );

} );
