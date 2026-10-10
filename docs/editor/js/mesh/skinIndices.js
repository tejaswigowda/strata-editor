import * as THREE from 'three';

// A Uint32/Int32 skinIndex (the WebGPU backend widens it in place, and it then
// gets saved) is bound as an integer attribute by WebGL, but the WebGL skinning
// shader declares it float — the draw fails and skinned meshes vanish (only the
// skeleton helper shows, e.g. in Firefox). Store it as Uint16 instead.
function normalizeSkinIndices( root ) {

	root.traverse( function ( o ) {

		const attr = o.isSkinnedMesh && o.geometry.attributes.skinIndex;
		if ( ! attr || attr.isInterleavedBufferAttribute ) return;
		if ( ! ( attr.array instanceof Uint32Array || attr.array instanceof Int32Array ) ) return;

		o.geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( new Uint16Array( attr.array ), attr.itemSize ) );

	} );

}

export { normalizeSkinIndices };
