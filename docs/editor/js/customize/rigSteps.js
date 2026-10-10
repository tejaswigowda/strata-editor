// ── rigSteps.js ───────────────────────────────────────────────────────────────
// EXPLICIT rig steps. These change the rig (skin weights / the skin binding), so
// they are deliberately NOT customize ops: the headless `customize` stage refuses
// to run them, and a human (or an agent acting as the rigger) runs them on purpose,
// then re-bakes with bodyrig / facerig.
//
// The main one is the rule for ADDED DEFORMABLE CLOTHING: a new garment mesh must
// be skinned to the body skeleton, otherwise it z-fights / clips / stays static
// under animation. Rigid accessories do not need this: parent them to a bone
// (customize op "attachProp").
//
// The garment is skinned where it sits against the displayed character (any pose works).

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { findParts } from '../presets/rigParts.js';
import { smoothMeshWeights } from '../presets/smoothSkinWeights.js';
import { normalizeClassName, toClassSet } from '../intelligence/classDerive.js';

/**
 * Skin a plain garment mesh to the character's body skeleton.
 *
 * The garment is taken as it sits NOW, against the character as currently displayed (modelled
 * at the bind pose, or at whatever pose the character is in: it need not be a rest pose).
 * Each vertex copies the skin weights of the nearest body / head vertex, so the cloth moves
 * exactly like the skin under it, the weights are smoothed so neighbouring vertices near
 * different limbs do not tear apart, and finally each vertex is placed in the skin's own space
 * so that it renders exactly where it sits now and follows the skeleton from there.
 *
 * @param {THREE.Mesh} garment   plain (unskinned) mesh, positioned against the displayed character
 * @param {THREE.Object3D} root  the character
 * @param {object} [options]     { body, face } override the detected parts
 * @returns {THREE.SkinnedMesh}  the skinned replacement (already swapped in under the body's parent)
 */
export function skinGarmentToBody( garment, root, options = {} ) {

	const parts = findParts( root );
	const body = options.body || parts.body;
	const face = options.face || parts.face;

	if ( ! body || ! body.isSkinnedMesh ) throw new Error( 'skinGarmentToBody: no skinned body mesh found on the character' );
	if ( garment.isSkinnedMesh ) return garment;

	root.updateMatrixWorld( true );
	garment.updateMatrixWorld( true );
	body.skeleton.update();

	let geo = garment.geometry.clone();
	for ( const k of Object.keys( geo.attributes ) ) if ( ! [ 'position', 'normal', 'uv', 'uv1', 'color' ].includes( k ) ) geo.deleteAttribute( k );
	if ( ! geo.index ) geo = BufferGeometryUtils.mergeVertices( geo );

	const n = geo.attributes.position.count;

	// Where each vertex sits in the world right now
	const world = new Float32Array( n * 3 );
	const p = new THREE.Vector3();
	for ( let i = 0; i < n; i ++ ) {

		p.fromBufferAttribute( geo.attributes.position, i ).applyMatrix4( garment.matrixWorld );
		world.set( [ p.x, p.y, p.z ], i * 3 );

	}

	geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( new Uint16Array( n * 4 ), 4 ) );
	geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( Float32Array.from( { length: n * 4 }, ( _, i ) => i % 4 === 0 ? 1 : 0 ), 4 ) );

	const skinned = new THREE.SkinnedMesh( geo, garment.material );
	skinned.name = garment.name;
	skinned.userData = { ...garment.userData, garment: true, rigStep: 'skinGarmentToBody' };
	skinned.frustumCulled = false;
	skinned.castShadow = garment.castShadow;
	skinned.receiveShadow = garment.receiveShadow;

	skinned.position.copy( body.position );
	skinned.quaternion.copy( body.quaternion );
	skinned.scale.copy( body.scale );
	body.parent.add( skinned );
	skinned.updateMatrixWorld( true );
	skinned.bind( body.skeleton, body.bindMatrix );

	smoothMeshWeights( skinned, { rigid: true, references: [ body, face ], positions: world } );

	// A skinned vertex v renders at B × bindMatrix × v, with B the weight-blended bone matrix
	// (boneWorld × boneInverse). Solve for the v that renders at the world position it has now.
	const { bones, boneInverses } = body.skeleton;
	const boneMatrix = bones.map( ( b, i ) => new THREE.Matrix4().multiplyMatrices( b.matrixWorld, boneInverses[ i ] ) );
	const bindInverse = new THREE.Matrix4().copy( body.bindMatrix ).invert();
	const indices = geo.attributes.skinIndex, weights = geo.attributes.skinWeight;
	const B = new THREE.Matrix4(), A = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), normal = new THREE.Vector3();
	const position = geo.attributes.position, normals = geo.attributes.normal;
	const worldNormal = garment.matrixWorld.clone();
	const garmentNormals = new THREE.Matrix3().getNormalMatrix( worldNormal );

	for ( let i = 0; i < n; i ++ ) {

		B.elements.fill( 0 );

		for ( let k = 0; k < 4; k ++ ) {

			const w = weights.getComponent( i, k );
			if ( w === 0 ) continue;
			const m = boneMatrix[ indices.getComponent( i, k ) ].elements;
			for ( let e = 0; e < 16; e ++ ) B.elements[ e ] += m[ e ] * w;

		}

		A.copy( B ).invert().premultiply( bindInverse );
		p.set( world[ i * 3 ], world[ i * 3 + 1 ], world[ i * 3 + 2 ] ).applyMatrix4( A );
		position.setXYZ( i, p.x, p.y, p.z );

		if ( normals ) {

			normal.fromBufferAttribute( normals, i ).applyNormalMatrix( garmentNormals ).applyNormalMatrix( normalMatrix.getNormalMatrix( A ) ).normalize();
			normals.setXYZ( i, normal.x, normal.y, normal.z );

		}

	}

	position.needsUpdate = true;
	if ( normals ) normals.needsUpdate = true; else geo.computeVertexNormals();
	geo.computeBoundingBox();
	geo.computeBoundingSphere();

	const classes = toClassSet( skinned.userData.customClasses );
	[ 'garment', 'clothing' ].forEach( c => classes.add( normalizeClassName( c ) ) );
	skinned.userData.customClasses = [ ...classes ].sort();

	if ( garment.parent ) garment.parent.remove( garment );
	return skinned;

}

/**
 * STOPGAP, not a fix, for a near-static shot with an UNSKINNED garment: push the
 * body back in depth so the garment wins the depth test. It hides z-fighting
 * only while the garment and the skin stay close; once the body moves the garment
 * still floats / clips. Skin the garment instead (skinGarmentToBody).
 */
export function depthBiasStopgap( body, { factor = 2, units = 4 } = {} ) {

	const edit = old => {

		const m = old.clone();
		m.polygonOffset = true;
		m.polygonOffsetFactor = factor;
		m.polygonOffsetUnits = units;
		return m;

	};

	body.material = Array.isArray( body.material ) ? body.material.map( edit ) : edit( body.material );

}
