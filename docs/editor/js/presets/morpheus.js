import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SetClassCommand } from '../commands/SetClassCommand.js';
import { flattenBelly } from './bodyShape.js';
import { findParts } from './rigParts.js';
import { smoothOutfitWeights } from './smoothSkinWeights.js';

// ── Morpheus look ─────────────────────────────────────────────────────────────
// Restyles a loaded humanoid (Epic MetaHuman-style rigs such as bo.glb, ada.glb
// and bruce.glb; see rigParts.js) as Morpheus: bald and clean-shaven, brown
// skin, black leather jacket / trousers / shoes, small black sunglasses, plus
// semantic classes (.head, .skin, .jacket, .trousers, ...) so the parts can be
// addressed by selector, and a flatter belly where there is one (bodyShape.js).
// Outfit skin weights are smoothed so the cloth stays closed under motion capture
// (smoothSkinWeights.js). Parts that are not found are skipped, and re-running
// replaces the props it added earlier.
//
// Usage (console): ( await import( './editor/js/presets/morpheus.js' ) ).applyMorpheus( editor );

const SKIN_TINT = 0x9a6f57;
const PROP_PREFIXES = [ 'Sunglasses', 'Trousers', 'Shoe' ];

// Edits a clone of each material and swaps it in. Mutating a material that has
// already been rendered (dropping a map, enabling sheen) leaves the WebGPU
// backend with stale uniform buffers, so every edit gets a fresh material.
function eachMaterial( mesh, fn ) {

	if ( ! mesh ) return;

	const edit = old => {

		const m = old.clone();
		fn( m );
		old.dispose();
		return m;

	};

	mesh.material = Array.isArray( mesh.material ) ? mesh.material.map( edit ) : edit( mesh.material );

}

function findBone( skeleton, pattern ) {

	return skeleton.bones.find( b => pattern.test( b.name ) );

}

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

// Attach `object` to `bone` keeping its current world transform.
function attachToBone( root, object, bone ) {

	root.add( object );
	root.updateMatrixWorld( true );
	( bone || root ).attach( object );

}

function addClasses( editor, object, classes ) {

	if ( ! object ) return;
	classes.forEach( c => editor.execute( new SetClassCommand( editor, object, c, true ) ) );

}

function makeLeather( name ) {

	return new THREE.MeshPhysicalMaterial( {
		name, color: 0x070707, roughness: 0.4, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide
	} );

}

// Rigidly skin the glasses to the head bone of the face skeleton, as a
// SkinnedMesh next to the face mesh. A plain child of the bone goes through a
// different transform path than the skinned head and can drift off it under
// animation; a skinned mesh follows exactly the same bone matrices. Each part is
// a child mesh, so they are merged per material.
// Eyebrow (and other card) meshes ship as plain meshes, so they stay behind when
// the head moves. Re-create one as a SkinnedMesh rigidly bound to the head bone,
// keeping its material and morph targets.
// Rigid offset between where the head bone sits in the scene right now and
// where the skin's inverse bind matrix expects it. It is the identity for a
// rig imported as-is, but a baked clip can leave the skeleton in a frame that
// differs from the mesh's bind space (bodyrig-webCLI output does), so geometry
// placed from world positions must be pulled back through it to follow the head.
function headBindOffset( faceMesh, headIndex ) {

	const bone = faceMesh.skeleton.bones[ headIndex ];
	bone.updateWorldMatrix( true, false );
	const d = new THREE.Matrix4().multiplyMatrices( bone.matrixWorld, faceMesh.skeleton.boneInverses[ headIndex ] );
	return new THREE.Matrix4().multiplyMatrices( faceMesh.bindMatrix.clone().invert(), d.invert() ).multiply( faceMesh.bindMatrix );

}

export function skinCardToHead( mesh, faceMesh ) {

	const headIndex = faceMesh.skeleton.bones.findIndex( b => /^head(_\d+)?$/i.test( b.name ) );
	if ( headIndex < 0 || mesh.isSkinnedMesh ) return mesh;

	mesh.updateWorldMatrix( true, false );
	faceMesh.updateMatrixWorld( true );

	const toFace = new THREE.Matrix4().multiplyMatrices( headBindOffset( faceMesh, headIndex ), faceMesh.matrixWorld.clone().invert() );
	const geo = mesh.geometry.clone().applyMatrix4( new THREE.Matrix4().multiplyMatrices( toFace, mesh.matrixWorld ) );
	const n = geo.attributes.position.count;
	geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( new Uint16Array( n * 4 ).map( ( _, i ) => i % 4 === 0 ? headIndex : 0 ), 4 ) );
	geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( new Float32Array( n * 4 ).map( ( _, i ) => i % 4 === 0 ? 1 : 0 ), 4 ) );

	const skinned = new THREE.SkinnedMesh( geo, mesh.material );
	skinned.name = mesh.name;
	skinned.userData = mesh.userData;
	skinned.visible = mesh.visible;
	skinned.frustumCulled = false;
	skinned.morphTargetDictionary = mesh.morphTargetDictionary;
	skinned.morphTargetInfluences = mesh.morphTargetInfluences;
	skinned.bind( faceMesh.skeleton, faceMesh.bindMatrix );

	mesh.parent.add( skinned );
	mesh.removeFromParent();
	return skinned;

}

export function skinToHead( root, glasses, faceMesh ) {

	const headIndex = faceMesh.skeleton.bones.findIndex( b => /^head(_\d+)?$/i.test( b.name ) );
	if ( headIndex < 0 ) return glasses;

	glasses.updateMatrixWorld( true );
	faceMesh.updateMatrixWorld( true );

	// Glasses were modelled in world space at rest; express them in face-mesh space
	const toFace = new THREE.Matrix4().multiplyMatrices( headBindOffset( faceMesh, headIndex ), faceMesh.matrixWorld.clone().invert() );
	const group = new THREE.Group();
	group.name = 'Sunglasses';

	const byMaterial = new Map();
	glasses.children.forEach( part => {

		const geo = part.geometry.clone().applyMatrix4( new THREE.Matrix4().multiplyMatrices( toFace, part.matrix ) );
		const list = byMaterial.get( part.material ) || [];
		list.push( geo.toNonIndexed ? geo.toNonIndexed() : geo );
		byMaterial.set( part.material, list );

	} );

	for ( const [ material, geos ] of byMaterial ) {

		const geo = BufferGeometryUtils.mergeGeometries( geos.map( g => {

			g.deleteAttribute( 'uv' );
			return g;

		} ) );

		const n = geo.attributes.position.count;
		geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( new Uint16Array( n * 4 ).map( ( _, i ) => i % 4 === 0 ? headIndex : 0 ), 4 ) );
		geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( new Float32Array( n * 4 ).map( ( _, i ) => i % 4 === 0 ? 1 : 0 ), 4 ) );

		const skinned = new THREE.SkinnedMesh( geo, material );
		skinned.name = material.name === 'sunglasses_lens' ? 'Lens' : 'Frame';
		skinned.frustumCulled = false;
		skinned.bind( faceMesh.skeleton, faceMesh.bindMatrix );
		group.add( skinned );

	}

	faceMesh.parent.add( group );
	return group;

}

function makeSunglasses( root, faceMesh, eyeL, eyeR ) {

	const boxL = new THREE.Box3().setFromObject( eyeL );
	const boxR = new THREE.Box3().setFromObject( eyeR );
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

	return skinToHead( root, glasses, faceMesh );

}

// ── Trousers & shoes for rigs whose outfit only has shorts ───────────────────
// Each leg is lofted from elliptical rings fitted to the body mesh's rest-pose
// cross-sections (slightly oversized), split at the knee and parented to the
// thigh / calf bones so it keeps following the legs.

function worldVertices( mesh ) {

	const out = [];
	const v = new THREE.Vector3();
	const pos = mesh.geometry.attributes.position;

	for ( let i = 0; i < pos.count; i ++ ) {

		mesh.getVertexPosition( i, v );
		out.push( v.clone().applyMatrix4( mesh.matrixWorld ) );

	}

	return out;

}

function legRings( verts, side, yTop, yBottom, step ) {

	const rings = [];

	for ( let y = yTop; y >= yBottom - 1e-6; y -= step ) {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity, n = 0;

		for ( const v of verts ) {

			if ( Math.abs( v.y - y ) > step * 0.6 || v.x * side < 0.02 ) continue;
			minX = Math.min( minX, v.x ); maxX = Math.max( maxX, v.x );
			minZ = Math.min( minZ, v.z ); maxZ = Math.max( maxZ, v.z );
			n ++;

		}

		if ( n < 6 ) continue;

		rings.push( { y, cx: ( minX + maxX ) / 2, cz: ( minZ + maxZ ) / 2, hx: ( maxX - minX ) / 2, hz: ( maxZ - minZ ) / 2 } );

	}

	return rings;

}

function loftRings( rings, flareLast ) {

	const seg = 28;
	const positions = [];
	const indices = [];

	rings.forEach( ( r, k ) => {

		const flare = k >= rings.length - 2 ? flareLast : 1;
		const rx = ( r.hx * 1.07 + 0.008 ) * flare, rz = ( r.hz * 1.07 + 0.008 ) * flare;

		for ( let s = 0; s < seg; s ++ ) {

			const a = s / seg * Math.PI * 2;
			positions.push( r.cx + Math.cos( a ) * rx, r.y, r.cz + Math.sin( a ) * rz );

		}

	} );

	for ( let k = 0; k < rings.length - 1; k ++ ) {

		for ( let s = 0; s < seg; s ++ ) {

			const a = k * seg + s, b = k * seg + ( s + 1 ) % seg, c = a + seg, d = b + seg;
			indices.push( a, c, b, b, c, d );

		}

	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geo.setIndex( indices );
	geo.computeVertexNormals();
	return geo;

}

function makeTrousersAndShoes( root, body, material ) {

	const verts = worldVertices( body );
	const props = [];
	const skeleton = body.skeleton;

	[ [ 1, 'L', 'l' ], [ - 1, 'R', 'r' ] ].forEach( ( [ side, label, suffix ] ) => {

		const thigh = findBone( skeleton, new RegExp( `^thigh_${ suffix }(_\\d+)?$` ) );
		const calf = findBone( skeleton, new RegExp( `^calf_${ suffix }(_\\d+)?$` ) );
		const foot = findBone( skeleton, new RegExp( `^foot_${ suffix }(_\\d+)?$` ) );
		if ( ! thigh || ! calf || ! foot ) return;

		const kneeY = calf.getWorldPosition( new THREE.Vector3() ).y;
		const ankleY = foot.getWorldPosition( new THREE.Vector3() ).y;
		const hipY = thigh.getWorldPosition( new THREE.Vector3() ).y;

		const rings = legRings( verts, side, hipY - 0.2, ankleY - 0.01, 0.04 );
		const upper = rings.filter( r => r.y >= kneeY - 1e-6 );
		const lower = rings.filter( r => r.y <= kneeY + 0.041 );

		[ [ upper, thigh, 'Upper' ], [ lower, calf, 'Lower' ] ].forEach( ( [ part, bone, tag ] ) => {

			if ( part.length < 2 ) return;
			const mesh = new THREE.Mesh( loftRings( part, tag === 'Lower' ? 1.06 : 1 ), material );
			mesh.name = `Trousers ${ label } ${ tag }`;
			mesh.castShadow = true;
			attachToBone( root, mesh, bone );
			props.push( { mesh, kind: 'trousers' } );

		} );

		// Shoe: a stretched, flattened sphere over the foot.
		const footBox = new THREE.Box3();
		verts.forEach( v => { if ( v.x * side > 0.02 && v.y < ankleY ) footBox.expandByPoint( v ); } );

		const length = footBox.max.z - footBox.min.z;
		const width = footBox.max.x - footBox.min.x;
		const height = Math.max( ankleY - footBox.min.y, 0.05 );
		const shoe = new THREE.Mesh( new THREE.SphereGeometry( 1, 32, 20 ), material );
		shoe.name = `Shoe ${ label }`;
		shoe.castShadow = true;
		shoe.scale.set( width / 2 * 1.12, height * 0.62, length / 2 * 1.08 );
		shoe.position.set( ( footBox.min.x + footBox.max.x ) / 2, footBox.min.y + height * 0.6, ( footBox.min.z + footBox.max.z ) / 2 );
		attachToBone( root, shoe, foot );
		props.push( { mesh: shoe, kind: 'shoes' } );

	} );

	return props;

}

export function applyMorpheus( editor ) {

	const root = editor.scene;
	root.updateMatrixWorld( true );

	// Remove props from a previous run
	const old = [];
	root.traverse( o => {

		if ( PROP_PREFIXES.some( p => o.name.startsWith( p ) ) && ! o.isSkinnedMesh ) old.push( o );

	} );
	old.forEach( o => o.removeFromParent() );

	let { shirt, bottom, shoes: shoesMesh, body, face, eyeL, eyeR, teeth, hair, brows, facialHair } = findParts( root );
	const character = root.children[ 0 ];

	// Black leather: drop the textures, keep a glossy solid colour
	const leather = m => {

		m.map = null;
		m.color.set( 0x070707 );
		m.roughness = 0.4;
		m.metalness = 0;
		if ( 'clearcoat' in m ) {

			m.clearcoat = 0.4;
			m.clearcoatRoughness = 0.3;

		}

	};

	[ shirt, bottom ].forEach( mesh => eachMaterial( mesh, leather ) );
	eachMaterial( shoesMesh, m => {

		leather( m );
		m.roughness = 0.2;

	} );

	// Brown skin: the tint multiplies the skin texture. The texture's own roughness
	// map is glossy (wet-looking), so use a soft constant roughness with a warm
	// sheen instead, which reads as natural skin.
	[ body, face ].forEach( mesh => eachMaterial( mesh, m => {

		m.color.set( SKIN_TINT );
		m.roughnessMap = null;
		m.roughness = 0.55;
		if ( 'specularIntensity' in m ) m.specularIntensity = 0.45;
		if ( 'sheen' in m ) {

			m.sheen = 0.5;
			m.sheenRoughness = 0.5;
			m.sheenColor.set( 0xffc4a8 );

		}

		if ( 'clearcoat' in m ) m.clearcoat = 0;

	} ) );

	// The body lies under the clothes and the jacket/trousers hug it, so the two
	// surfaces are nearly coplanar and flicker (z-fighting) as the mocap moves.
	// Pushing the body slightly back in depth makes the clothes always win.
	if ( body ) eachMaterial( body, m => {

		m.polygonOffset = true;
		m.polygonOffsetFactor = 2;
		m.polygonOffsetUnits = 4;

	} );

	// Bald, with dark brows
	if ( hair ) hair.visible = false;
	facialHair.forEach( m => {

		m.visible = false;

	} );
	eachMaterial( brows, m => m.color.set( 0x1a120d ) );
	if ( brows && face ) brows = skinCardToHead( brows, face );

	// Props
	const glasses = face && eyeL && eyeR ? makeSunglasses( root, face, eyeL, eyeR ) : null;

	// Rigs whose outfit is shorts (bo.glb) get long trousers and shoes
	const needsTrousers = bottom && /short/i.test( [].concat( bottom.material ).map( m => m.name ).join( ' ' ) + bottom.name ) && body;
	const legProps = needsTrousers ? makeTrousersAndShoes( root, body, makeLeather( 'trousers_leather' ) ) : [];

	// Semantic classes (userData.customClasses) for selector-based addressing
	addClasses( editor, character, [ 'morpheus', 'character', 'humanoid' ] );
	addClasses( editor, face, [ 'head', 'face', 'skin' ] );
	addClasses( editor, body, [ 'body', 'skin' ] );
	addClasses( editor, eyeL, [ 'eye', 'eye-left' ] );
	addClasses( editor, eyeR, [ 'eye', 'eye-right' ] );
	addClasses( editor, teeth, [ 'teeth', 'mouth' ] );
	addClasses( editor, hair, [ 'hair' ] );
	facialHair.forEach( m => addClasses( editor, m, [ 'facial-hair' ] ) );
	addClasses( editor, brows, [ 'eyebrows' ] );
	addClasses( editor, shirt, [ 'jacket', 'clothing', 'leather', 'black' ] );
	addClasses( editor, bottom, [ 'trousers', 'clothing', 'leather', 'black' ] );
	addClasses( editor, shoesMesh, [ 'shoes', 'clothing', 'black' ] );
	if ( glasses ) {

		addClasses( editor, glasses, [ 'sunglasses', 'eyewear', 'accessory', 'black' ] );
		glasses.children.forEach( c => addClasses( editor, c, [ /^Lens/.test( c.name ) ? 'lens' : 'frame' ] ) );

	}

	legProps.forEach( ( { mesh, kind } ) => addClasses( editor, mesh, kind === 'shoes' ? [ 'shoes', 'clothing', 'black' ] : [ 'trousers', 'clothing', 'leather', 'black' ] ) );

	flattenBelly( editor );
	smoothOutfitWeights( root ); // keeps the cloth over the neck and shoulders under motion capture

	editor.signals.sceneGraphChanged.dispatch();

}
