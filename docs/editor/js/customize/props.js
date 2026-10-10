import * as THREE from 'three';

// ── props.js ──────────────────────────────────────────────────────────────────
// Rigid accessories for the character customizer. Every builder returns an
// UNPARENTED Object3D positioned in world space at the rest pose; attachProp
// (customizeOps.js) then parents it to a bone. Nothing here is skinned and no
// builder touches the character's own meshes.

function roundedRect( w, h, r ) {

	const s = new THREE.Shape();
	const x = - w / 2, y = - h / 2;
	s.moveTo( x + r, y );
	s.lineTo( x + w - r, y );
	s.quadraticCurveTo( x + w, y, x + w, y + r );
	s.lineTo( x + w, y + h - r );
	s.quadraticCurveTo( x + w, y + h, x + w - r, y + h );
	s.lineTo( x + r, y + h );
	s.quadraticCurveTo( x, y + h, x, y + h - r );
	s.lineTo( x, y + r );
	s.quadraticCurveTo( x, y, x + r, y );
	return s;

}

export function buildSunglasses( eyeL, eyeR, boxOf = o => new THREE.Box3().setFromObject( o ) ) {

	const boxL = boxOf( eyeL );
	const boxR = boxOf( eyeR );
	const cL = boxL.getCenter( new THREE.Vector3() );
	const cR = boxR.getCenter( new THREE.Vector3() );

	// Proportions come from the eye spacing so the glasses fit any head size.
	const ipd = Math.abs( cL.x - cR.x );
	const lensW = ipd * 0.885, lensH = ipd * 0.56, depth = ipd * 0.1;

	const lensGeo = new THREE.ExtrudeGeometry( roundedRect( lensW, lensH, lensH * 0.32 ), {
		depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 10
	} );
	const lensMat = new THREE.MeshPhysicalMaterial( { name: 'sunglasses_lens', color: 0x030303, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 } );
	const frameMat = new THREE.MeshStandardMaterial( { name: 'sunglasses_frame', color: 0x050505, roughness: 0.3, metalness: 0.6 } );

	const glasses = new THREE.Group();
	glasses.name = 'Sunglasses';

	const lensZ = Math.max( boxL.max.z, boxR.max.z ) + ipd * 0.13;
	const lensY = ( cL.y + cR.y ) / 2 + ipd * 0.03;

	[ [ cL.x, 'Lens L' ], [ cR.x, 'Lens R' ] ].forEach( ( [ cx, name ] ) => {

		const lens = new THREE.Mesh( lensGeo, lensMat );
		lens.name = name;
		lens.position.set( cx, lensY, lensZ );
		glasses.add( lens );

	} );

	const bar = ( w, h, d, x, y, z, name ) => {

		const b = new THREE.Mesh( new THREE.BoxGeometry( w, h, d ), frameMat );
		b.name = name;
		b.position.set( x, y, z );
		glasses.add( b );

	};

	const edge = Math.max( cL.x, cR.x ) + lensW / 2;
	const armLen = ipd * 1.8;
	bar( ipd - lensW + 0.004, 0.004, 0.005, 0, lensY + lensH * 0.2, lensZ + depth / 2, 'Bridge' );
	bar( 0.004, 0.004, armLen, edge, lensY + lensH * 0.17, lensZ + depth / 2 - armLen / 2, 'Arm R' );
	bar( 0.004, 0.004, armLen, - edge, lensY + lensH * 0.17, lensZ + depth / 2 - armLen / 2, 'Arm L' );

	return glasses;

}

const PRIMITIVES = {
	box: s => new THREE.BoxGeometry( s, s, s ),
	sphere: s => new THREE.SphereGeometry( s / 2, 24, 16 ),
	cylinder: s => new THREE.CylinderGeometry( s / 2, s / 2, s, 24 ),
	cone: s => new THREE.ConeGeometry( s / 2, s, 24 ),
	torus: s => new THREE.TorusGeometry( s / 2, s / 8, 12, 32 ),
};

export const PRIMITIVE_KINDS = Object.keys( PRIMITIVES );

/** A plain coloured primitive of edge/diameter `size` metres. */
export function buildPrimitive( kind, size, color ) {

	const mesh = new THREE.Mesh( PRIMITIVES[ kind ]( size ), new THREE.MeshStandardMaterial( { color, roughness: 0.5, metalness: 0.1 } ) );
	mesh.name = kind;
	return mesh;

}
