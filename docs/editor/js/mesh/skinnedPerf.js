import * as THREE from 'three';

const _inv = new THREE.Matrix4();
const _c = new THREE.Matrix4();

function sameBones( a, b ) {

	return a.length === b.length && a.every( ( bone, i ) => bone === b[ i ] );

}

// Inverse bind matrices of two skins over the same bones can differ by one
// constant matrix C (I_b = I_ref_b * C for every bone b), as exported by VRoid.
// Returns C, or null when the two skins are not related that way.
function constantOffset( ref, skel, eps ) {

	const n = ref.boneInverses.length;
	if ( skel.boneInverses.length !== n ) return null;

	let C = null;

	for ( let i = 0; i < n; i ++ ) {

		_c.copy( _inv.copy( ref.boneInverses[ i ] ).invert() ).multiply( skel.boneInverses[ i ] );

		if ( C === null ) {

			C = _c.clone();
			continue;

		}

		for ( let k = 0; k < 16; k ++ ) {

			if ( Math.abs( _c.elements[ k ] - C.elements[ k ] ) > eps ) return null;

		}

	}

	return C;

}

// Skinned meshes of one character normally each carry their own Skeleton, so
// the per-frame bone-matrix update runs once per mesh (dozens of times for the
// same 100+ bones). Share one Skeleton per bone set, folding each mesh's
// constant inverse-bind offset into its bindMatrix so the skinning is
// unchanged. Also turn off frustum culling: a skinned mesh's bounds come from
// its bind pose, so animated / root-motion characters get culled while visible.
function optimizeSkinnedMeshes( root, { eps = 1e-5 } = {} ) {

	const meshes = [];
	root.traverse( ( o ) => { if ( o.isSkinnedMesh ) meshes.push( o ); } );

	const shared = [];
	let merged = 0;

	for ( const mesh of meshes ) {

		mesh.frustumCulled = false;

		let hit = null;
		for ( const group of shared ) {

			if ( sameBones( group.skeleton.bones, mesh.skeleton.bones ) ) {

				hit = group;
				break;

			}

		}

		if ( hit === null ) {

			shared.push( { skeleton: mesh.skeleton } );
			continue;

		}

		if ( mesh.skeleton === hit.skeleton ) continue;

		const C = constantOffset( hit.skeleton, mesh.skeleton, eps );
		if ( C === null ) continue;

		mesh.bindMatrix.premultiply( C );
		mesh.skeleton = hit.skeleton;
		merged ++;

	}

	return { meshes: meshes.length, merged };

}

export { optimizeSkinnedMeshes };
