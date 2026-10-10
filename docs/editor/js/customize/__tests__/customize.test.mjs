// Node tests for the character customizer (pure; no DOM, no renderer). Run with:
//   node docs/editor/js/customize/__tests__/customize.test.mjs
//
// Builds a small synthetic rigged character (skeleton, skinned body / face / eyes /
// jacket, 51-style morph targets, hair cards) and checks the rig-safety invariant,
// the validator's refusals, determinism, atomicity, bone-attached props and the
// garment skinning rule.

import assert from 'node:assert';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const docs = path.resolve( here, '../../../..' );

register( 'data:text/javascript,' + encodeURIComponent( `
export async function resolve( spec, ctx, next ) {
	if ( spec === 'three' ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'build/three.module.js' ) ).href ) }, shortCircuit: true };
	if ( spec.startsWith( 'three/addons/' ) ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'examples/jsm' ) ).href + '/' ) } + spec.slice( 13 ), shortCircuit: true };
	return next( spec, ctx );
}` ) );

const THREE = await import( 'three' );
const ops = await import( '../customizeOps.js' );
const safety = await import( '../rigSafety.js' );
const steps = await import( '../rigSteps.js' );

let pass = 0, fail = 0;
async function test( name, fn ) {

	try { await fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

// ── Synthetic character ───────────────────────────────────────────────────────

function skinTo( geo, boneOf ) {

	const n = geo.attributes.position.count, idx = new Uint16Array( n * 4 ), w = new Float32Array( n * 4 );

	for ( let i = 0; i < n; i ++ ) {

		const y = geo.attributes.position.getY( i );
		const [ a, b, t ] = boneOf( y );
		idx[ i * 4 ] = a; idx[ i * 4 + 1 ] = b;
		w[ i * 4 ] = 1 - t; w[ i * 4 + 1 ] = t;

	}

	geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( idx, 4 ) );
	geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( w, 4 ) );
	return geo;

}

// bones: 0 root(0) 1 pelvis(0.9) 2 spine(1.2) 3 neck(1.5) 4 head(1.6) — a vertical chain
function buildCharacter( label = 'hero' ) {

	const root = new THREE.Group();
	root.name = 'hero.glb';
	root.userData.label = label;

	const heights = [ 0, 0.9, 1.2, 1.5, 1.6 ];
	const names = [ 'root', 'pelvis', 'spine_03', 'neck_01', 'head' ];
	const bones = names.map( ( n, i ) => {

		const b = new THREE.Bone();
		b.name = n;
		b.position.y = i === 0 ? 0 : heights[ i ] - heights[ i - 1 ];
		return b;

	} );
	bones.forEach( ( b, i ) => { if ( i ) bones[ i - 1 ].add( b ); } );
	root.add( bones[ 0 ] );
	root.updateMatrixWorld( true );
	const skeleton = new THREE.Skeleton( bones );

	const boneOf = y => {

		if ( y >= 1.6 ) return [ 4, 4, 0 ];
		for ( let i = 3; i >= 0; i -- ) if ( y >= heights[ i ] ) return [ i, i + 1, ( y - heights[ i ] ) / ( heights[ i + 1 ] - heights[ i ] ) ];
		return [ 0, 0, 0 ];

	};

	const mk = ( name, geo, material, extra ) => {

		const m = new THREE.SkinnedMesh( skinTo( geo, boneOf ), material );
		m.name = name;
		root.add( m );
		m.updateMatrixWorld( true );
		m.bind( skeleton );
		if ( extra ) extra( m );
		return m;

	};

	const map = new THREE.Texture();
	const skinMat = new THREE.MeshStandardMaterial( { name: 'skin', color: 0xffffff, map, roughness: 0.4 } );

	const body = mk( 'SKM_Test_BodyMesh', new THREE.CylinderGeometry( 0.16, 0.2, 1.7, 16, 24 ).translate( 0, 0.85, 0 ), skinMat );

	const faceGeo = new THREE.SphereGeometry( 0.11, 16, 12 ).translate( 0, 1.7, 0 );
	const morphNames = [ 'mouthSmileLeft', 'mouthSmileRight', 'jawOpen', 'browInnerUp', 'eyeBlinkLeft', 'eyeBlinkRight', 'cheekSquintLeft', 'cheekSquintRight' ];
	faceGeo.morphAttributes.position = morphNames.map( ( _, k ) => {

		const a = new Float32Array( faceGeo.attributes.position.array.length );
		for ( let i = 0; i < a.length; i ++ ) a[ i ] = Math.sin( i * 0.37 + k ) * 0.004;
		return new THREE.Float32BufferAttribute( a, 3 );

	} );
	faceGeo.morphTargetsRelative = true; // as glTF stores them
	const face = mk( 'SKM_Test_FaceMesh', faceGeo, new THREE.MeshStandardMaterial( { name: 'face', color: 0xffffff, map } ), m => {

		m.updateMorphTargets();
		m.morphTargetDictionary = Object.fromEntries( morphNames.map( ( n, i ) => [ n, i ] ) );

	} );

	const eye = ( name, x ) => mk( name, new THREE.SphereGeometry( 0.015, 8, 6 ).translate( x, 1.69, 0.09 ), new THREE.MeshStandardMaterial( { name: 'eye' } ) );
	eye( 'SKM_Test_FaceMesh_4', 0.032 );
	eye( 'SKM_Test_FaceMesh_5', - 0.032 );

	mk( 'Test_Outfits_1', new THREE.CylinderGeometry( 0.2, 0.23, 0.6, 16, 8 ).translate( 0, 1.2, 0 ), new THREE.MeshStandardMaterial( { name: 'jacket', color: 0x445566 } ) );

	mk( 'Test_Outfits_2', new THREE.CylinderGeometry( 0.14, 0.12, 0.8, 12, 6 ).translate( 0, 0.4, 0 ), new THREE.MeshStandardMaterial( { name: 'pants', color: 0x222222 } ) );
	mk( 'Test_Outfits_3', new THREE.CylinderGeometry( 0.12, 0.12, 0.1, 12, 2 ).translate( 0, 0.05, 0 ), new THREE.MeshStandardMaterial( { name: 'shoes', color: 0xeeeeee } ) );

	const hair = new THREE.Mesh( new THREE.SphereGeometry( 0.12, 8, 6 ).translate( 0, 1.75, 0 ), new THREE.MeshStandardMaterial( { name: 'hair' } ) );
	hair.name = 'Hair_Test_CardsMesh';
	root.add( hair );

	const scene = new THREE.Scene();
	scene.add( root );
	scene.updateMatrixWorld( true );
	return { scene, root, body, face, skeleton, bones, map };

}

const SPEC = [
	{ op: 'tint', target: 'part:skin', color: '#8a5a3c', roughness: 0.55 },
	{ op: 'hide', target: 'part:hair' },
	{ op: 'recolor', target: 'part:clothing', color: '#080808' },
	{ op: 'blendshape', preset: 'smile' },
	{ op: 'attachProp', prop: { kind: 'sunglasses' }, bone: 'head' },
	{ op: 'tag', target: 'part:skin', classes: [ 'skin', 'Morpheus Skin' ] },
];

// ── Validator ─────────────────────────────────────────────────────────────────

console.log( 'validator' );

await test( 'accepts the full rig-safe op set', () => {

	const r = ops.validateCustomize( { customize: [ { character: '#hero', ops: SPEC } ] } );
	assert.deepStrictEqual( r.errors, [] );

} );

await test( 'rejects a geometry edit and points at the rig step', () => {

	for ( const name of [ 'geometry', 'remesh', 'decimate', 'simplify', 'flattenBelly' ] ) {

		const r = ops.validateCustomize( [ { op: name, target: 'part:body' } ] );
		assert.strictEqual( r.ok, false, name );
		assert.strictEqual( r.errors[ 0 ].code, 'RIG_UNSAFE' );
		assert.match( r.errors[ 0 ].message, /vertex set/ );
		assert.match( r.errors[ 0 ].message, /rig step/ );

	}

} );

await test( 'rejects a skeleton edit, a weight edit and a mesh swap', () => {

	for ( const [ name, re ] of [ [ 'renameBone', /skeleton/ ], [ 'removeBone', /skeleton/ ], [ 'restPose', /skeleton/ ], [ 'smoothWeights', /skin weights/ ], [ 'swapBody', /body mesh/ ] ] ) {

		const r = ops.validateCustomize( [ { op: name } ] );
		assert.strictEqual( r.errors[ 0 ].code, 'RIG_UNSAFE', name );
		assert.match( r.errors[ 0 ].message, re, name );

	}

} );

await test( 'rejects a bare add-deformable-clothing op with a pointer to skinning', () => {

	for ( const op of [ { op: 'addGarment' }, { op: 'addJacket' }, { op: 'attachProp', prop: { kind: 'jacket' } }, { op: 'attachProp', prop: { kind: 'box', skinned: true } }, { op: 'attachProp', prop: { kind: 'box' }, mount: 'skin' } ] ) {

		const r = ops.validateCustomize( [ op ] );
		assert.strictEqual( r.ok, false, JSON.stringify( op ) );
		assert.strictEqual( r.errors[ 0 ].code, 'RIG_UNSAFE' );
		assert.match( r.errors[ 0 ].message, /skinGarmentToBody/ );
		assert.match( r.errors[ 0 ].message, /skinned/ );

	}

} );

await test( 'rejects unknown ops and malformed arguments', () => {

	assert.strictEqual( ops.validateCustomize( [ { op: 'explode' } ] ).errors[ 0 ].code, 'UNKNOWN_OP' );
	assert.strictEqual( ops.validateCustomize( [ { op: 'tint', target: 'part:skin' } ] ).errors[ 0 ].code, 'BAD_ARGS' );
	assert.strictEqual( ops.validateCustomize( [ { op: 'blendshape', shapes: { jawOpen: 2 } } ] ).errors[ 0 ].code, 'BAD_ARGS' );
	assert.strictEqual( ops.validateCustomize( [ { op: 'attachProp', prop: { kind: 'teapot' } } ] ).errors[ 0 ].code, 'BAD_ARGS' );
	assert.strictEqual( ops.validateCustomize( 5 ).errors[ 0 ].code, 'BAD_STAGE' );

} );

await test( 'applyCustomize throws on an unsafe op before touching the scene', () => {

	const { root } = buildCharacter();
	const before = ops.lookFingerprint( root );
	assert.throws( () => ops.applyCustomize( root, [ { op: 'hide', target: 'part:hair' }, { op: 'decimate', target: 'part:body' } ] ), /vertex set/ );
	assert.strictEqual( ops.lookFingerprint( root ), before );
	assert.strictEqual( root.getObjectByName( 'Hair_Test_CardsMesh' ).visible, true );

} );

// ── Applying the rig-safe ops ─────────────────────────────────────────────────

console.log( 'rig-safe ops' );

await test( 'tint clones materials, keeps the texture, leaves the original untouched', () => {

	const { root, body, face, map } = buildCharacter();
	const original = body.material;
	ops.applyCustomize( root, [ { op: 'tint', target: 'part:skin', color: '#8a5a3c', roughness: 0.55 } ] );
	assert.notStrictEqual( body.material, original );
	assert.strictEqual( body.material.map, map );
	assert.strictEqual( face.material.map, map );
	assert.strictEqual( body.material.color.getHexString(), new THREE.Color( '#8a5a3c' ).getHexString() );
	assert.strictEqual( original.color.getHexString(), 'ffffff' );
	assert.strictEqual( body.material.roughness, 0.55 );

} );

await test( 'recolor makes existing clothing a flat colour', () => {

	const { root } = buildCharacter();
	const jacket = root.getObjectByName( 'Test_Outfits_1' );
	ops.applyCustomize( root, [ { op: 'recolor', target: 'part:clothing', color: '#080808' } ] );
	assert.strictEqual( jacket.material.color.getHexString(), new THREE.Color( '#080808' ).getHexString() );
	assert.strictEqual( jacket.material.map, null );

} );

await test( 'blendshape presets set ARKit influences; unknown shapes are an error', () => {

	const { root, face } = buildCharacter();
	ops.applyCustomize( root, [ { op: 'blendshape', preset: 'smile' }, { op: 'blendshape', shapes: { jawOpen: 0.25 } } ] );
	assert.strictEqual( face.morphTargetInfluences[ face.morphTargetDictionary.mouthSmileLeft ], 0.7 );
	assert.strictEqual( face.morphTargetInfluences[ face.morphTargetDictionary.jawOpen ], 0.25 );
	assert.throws( () => ops.applyCustomize( root, [ { op: 'blendshape', shapes: { notAShape: 0.5 } } ] ), /no morph target "notAShape"/ );

} );

await test( 'tag adds normalised classes; hide / show toggle visibility', () => {

	const { root } = buildCharacter();
	const hair = root.getObjectByName( 'Hair_Test_CardsMesh' );
	ops.applyCustomize( root, [ { op: 'tag', target: 'part:skin', classes: [ 'Morpheus Skin' ] }, { op: 'hide', target: 'part:hair' } ] );
	assert.strictEqual( hair.visible, false );
	assert.ok( root.getObjectByName( 'SKM_Test_BodyMesh' ).userData.customClasses.length > 0 );
	ops.applyCustomize( root, [ { op: 'show', target: 'part:hair' } ] );
	assert.strictEqual( hair.visible, true );

} );

await test( 'the full op set leaves the rig fingerprint unchanged and reports it', () => {

	const { root, bones } = buildCharacter();
	const before = safety.rigFingerprint( root );
	const r = ops.applyCustomize( root, SPEC );
	assert.ok( safety.sameRig( before, safety.rigFingerprint( root ) ) );
	assert.deepStrictEqual( r.rig, before );
	assert.strictEqual( r.flags.length, 0 );
	assert.strictEqual( bones[ 4 ].children.filter( c => c.userData.customizer ).length, 1 );

} );

await test( 'undo restores the look exactly', () => {

	const { root } = buildCharacter();
	const before = ops.lookFingerprint( root );
	const r = ops.applyCustomize( root, SPEC );
	assert.notStrictEqual( ops.lookFingerprint( root ), before );
	r.undo();
	assert.strictEqual( ops.lookFingerprint( root ), before );

} );

await test( 'a run is atomic: a failing op rolls back the ones before it', () => {

	const { root } = buildCharacter();
	const before = ops.lookFingerprint( root );
	assert.throws( () => ops.applyCustomize( root, [ ...SPEC, { op: 'blendshape', shapes: { nope: 1 } } ] ), /nope/ );
	assert.strictEqual( ops.lookFingerprint( root ), before );
	assert.strictEqual( root.getObjectByName( 'Hair_Test_CardsMesh' ).visible, true );

} );

// ── Bone-attached props ───────────────────────────────────────────────────────

console.log( 'props' );

await test( 'sunglasses sit at the eyes and follow the head bone like a weight-1 skin vertex', () => {

	const { scene, root, bones } = buildCharacter();
	ops.applyCustomize( root, [ { op: 'attachProp', prop: { kind: 'sunglasses' }, bone: 'head' } ] );
	const glasses = bones[ 4 ].children.find( c => c.userData.customizer );
	assert.ok( glasses );

	const lensCentre = () => {

		glasses.updateWorldMatrix( true, true );
		return new THREE.Box3().setFromObject( glasses.getObjectByName( 'Lens L' ) ).getCenter( new THREE.Vector3() );

	};

	const eye = root.getObjectByName( 'SKM_Test_FaceMesh_4' );
	const eyeCentre = () => {

		scene.updateMatrixWorld( true );
		eye.skeleton.update();
		const v = new THREE.Vector3(), sum = new THREE.Vector3(), n = eye.geometry.attributes.position.count;
		for ( let i = 0; i < n; i ++ ) sum.add( eye.getVertexPosition( i, v ).applyMatrix4( eye.matrixWorld ) );
		return sum.divideScalar( n );

	};

	const rest = lensCentre().sub( eyeCentre() );
	assert.ok( rest.length() < 0.12, 'lens near the eye at rest, got ' + rest.length() );

	for ( const [ rot, move ] of [ [ [ 0.5, 0.3, 0 ], [ 0, 0, 0 ] ], [ [ - 0.4, 0.9, 0.3 ], [ 0.7, 0, - 0.4 ] ] ] ) {

		bones[ 4 ].rotation.set( ...rot );
		bones[ 1 ].position.x += move[ 0 ]; bones[ 1 ].position.z += move[ 2 ];
		scene.updateMatrixWorld( true );
		const moved = lensCentre().sub( eyeCentre() );
		assert.ok( Math.abs( moved.length() - rest.length() ) < 1e-3, `offset drifted by ${ Math.abs( moved.length() - rest.length() ) }` );

	}

} );

await test( 'a primitive prop with an offset lands there at rest and rides the bone; re-applying replaces it', () => {

	const { scene, root, bones } = buildCharacter();
	const op = { op: 'attachProp', prop: { kind: 'sphere', size: 0.05, name: 'halo' }, bone: 'head', offset: [ 0, 0.2, 0 ] };
	ops.applyCustomize( root, [ op ] );
	const halo = bones[ 4 ].children.find( c => c.name === 'halo' );
	halo.updateWorldMatrix( true, false );
	const at = new THREE.Vector3().setFromMatrixPosition( halo.matrixWorld );
	assert.ok( Math.abs( at.y - 1.8 ) < 1e-4 && Math.abs( at.x ) < 1e-4, at.toArray().join( ',' ) );

	bones[ 4 ].rotation.x = Math.PI / 2;
	scene.updateMatrixWorld( true );
	const turned = new THREE.Vector3().setFromMatrixPosition( halo.matrixWorld );
	assert.ok( Math.abs( turned.z - 0.2 ) < 1e-3 || Math.abs( turned.z + 0.2 ) < 1e-3, 'prop did not swing with the head: ' + turned.toArray().join( ',' ) );

	bones[ 4 ].rotation.x = 0;
	ops.applyCustomize( root, [ op ] );
	assert.strictEqual( bones[ 4 ].children.filter( c => c.name === 'halo' ).length, 1 );

} );

await test( 'attachProp refuses a skinned (deformable) source object and unknown bones', () => {

	const { scene, root } = buildCharacter();
	const other = buildCharacter( 'other' );
	other.root.name = 'other.glb';
	scene.add( other.root );
	assert.throws( () => ops.applyCustomize( root, [ { op: 'attachProp', prop: { kind: 'object', source: '#other' } } ], { scene } ), /skinned \(deformable\)/ );
	assert.throws( () => ops.applyCustomize( root, [ { op: 'attachProp', prop: { kind: 'box' }, bone: 'tail' } ] ), /no bone "tail"/ );

} );

// ── Determinism / scene-spec stage ────────────────────────────────────────────

console.log( 'scene-spec stage' );

await test( 'the same ops reproduce the same character byte-stably', () => {

	const a = buildCharacter(), b = buildCharacter();
	const ra = ops.applyCustomize( a.root, SPEC ), rb = ops.applyCustomize( b.root, SPEC );
	assert.strictEqual( ra.look, rb.look );
	assert.strictEqual( JSON.stringify( ops.lookState( a.root ) ), JSON.stringify( ops.lookState( b.root ) ) );
	assert.deepStrictEqual( ra.rig, rb.rig );

	const c = buildCharacter();
	assert.notStrictEqual( ops.applyCustomize( c.root, SPEC.slice( 0, 3 ) ).look, ra.look );

} );

await test( 'runCustomizeStage resolves the character and applies the stage', () => {

	const { scene, root } = buildCharacter();
	const r = ops.runCustomizeStage( scene, { customize: [ { character: '#hero', ops: SPEC } ] } );
	assert.strictEqual( r.results.length, 1 );
	assert.strictEqual( root.getObjectByName( 'Hair_Test_CardsMesh' ).visible, false );
	r.undo();
	assert.strictEqual( root.getObjectByName( 'Hair_Test_CardsMesh' ).visible, true );
	assert.throws( () => ops.runCustomizeStage( scene, { customize: [ { character: '#nobody', ops: SPEC } ] } ), /matched nothing/ );
	assert.throws( () => ops.runCustomizeStage( scene, { customize: [ { ops: [ { op: 'addGarment' } ] } ] } ), /skinGarmentToBody/ );

} );

await test( 'frame adds one camera that looks at the character', () => {

	const { scene, root } = buildCharacter();
	ops.applyCustomize( root, [ { op: 'frame', name: 'Head Cam', framing: 'head' } ], { scene } );
	ops.applyCustomize( root, [ { op: 'frame', name: 'Head Cam', framing: 'head', azimuth: 30 } ], { scene } );
	const cams = []; scene.traverse( o => { if ( o.isCamera ) cams.push( o ); } );
	assert.strictEqual( cams.length, 1 );
	const dir = new THREE.Vector3(); cams[ 0 ].getWorldDirection( dir );
	assert.ok( dir.dot( new THREE.Vector3( 0, 1.7, 0 ).sub( cams[ 0 ].position ).normalize() ) > 0.99 );

} );

await test( 'the spec printed in the MetaHuman tutorial is a valid customize stage and runs', async () => {

	const fs = await import( 'node:fs' );
	const html = fs.readFileSync( path.join( docs, 'about/tutorials/make-your-own-metahuman.html' ), 'utf8' );
	const m = html.match( /<pre class="customize-spec"><code>([\s\S]*?)<\/code><\/pre>/ );
	assert.ok( m, 'tutorial has no customize-spec block' );
	const spec = JSON.parse( m[ 1 ].replace( /&quot;/g, '"' ).replace( /&amp;/g, '&' ).replace( /&lt;/g, '<' ).replace( /&gt;/g, '>' ) );
	assert.deepStrictEqual( ops.validateCustomize( spec ).errors, [] );

	const { scene, root, face } = buildCharacter();
	const r = ops.runCustomizeStage( scene, spec );
	assert.ok( r.results[ 0 ].applied.length === spec.customize[ 0 ].ops.length );
	assert.strictEqual( face.morphTargetInfluences[ face.morphTargetDictionary.mouthSmileLeft ], 0.8 );

} );

// ── The invariant itself ──────────────────────────────────────────────────────

console.log( 'invariant' );

await test( 'rigFingerprint detects vertex, weight, morph and skeleton edits', () => {

	const edits = {
		vertex: c => { const p = c.body.geometry.attributes.position; p.setX( 3, p.getX( 3 ) + 0.01 ); },
		weight: c => { const w = c.body.geometry.attributes.skinWeight; w.setX( 5, 0.5 ); w.setY( 5, 0.5 ); },
		morph: c => { c.face.geometry.morphAttributes.position[ 0 ].setX( 2, 1 ); },
		skeleton: c => { c.bones[ 3 ].name = 'neck_renamed'; },
		bind: c => { c.skeleton.boneInverses[ 2 ].elements[ 13 ] += 0.01; },
	};

	for ( const [ kind, edit ] of Object.entries( edits ) ) {

		const c = buildCharacter();
		const before = safety.rigFingerprint( c.root );
		edit( c );
		assert.ok( ! safety.sameRig( before, safety.rigFingerprint( c.root ) ), kind + ' edit went undetected' );

	}

} );

await test( 'materials, visibility and bone-parented props do not move the fingerprint', () => {

	const c = buildCharacter();
	const before = safety.rigFingerprint( c.root );
	c.body.material = c.body.material.clone();
	c.body.material.color.set( 0xff0000 );
	c.root.getObjectByName( 'Hair_Test_CardsMesh' ).visible = false;
	const prop = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), new THREE.MeshBasicMaterial() );
	prop.userData.customizer = true;
	c.bones[ 4 ].add( prop );
	assert.ok( safety.sameRig( before, safety.rigFingerprint( c.root ) ) );

} );

// ── Added deformable clothing: the rig step and the audit ─────────────────────

console.log( 'garments' );

function shell( c, offset = 0.012 ) {

	// An offset shell of the body torso, modelled in world space at the rest pose
	const geo = new THREE.CylinderGeometry( 0.1682 + offset, 0.18 + offset, 0.5, 16, 8, true ).translate( 0, 1.1, 0 );
	const mesh = new THREE.Mesh( geo, new THREE.MeshStandardMaterial( { color: 0x884422 } ) );
	mesh.name = 'Vest';
	mesh.userData.garment = true;
	c.root.add( mesh );
	c.scene.updateMatrixWorld( true );
	return mesh;

}

await test( 'an unskinned garment is flagged, not shipped', () => {

	const c = buildCharacter();
	shell( c );
	const audit = safety.auditRig( c.root );
	assert.strictEqual( audit.ok, false );
	assert.strictEqual( audit.flags[ 0 ].code, 'UNSKINNED_GARMENT' );
	assert.match( audit.flags[ 0 ].message, /skinGarmentToBody/ );
	assert.strictEqual( ops.applyCustomize( c.root, [ { op: 'hide', target: 'part:hair' } ] ).flags[ 0 ].code, 'UNSKINNED_GARMENT' );

} );

await test( 'skinGarmentToBody makes it a clean, rig-bound garment', () => {

	const c = buildCharacter();
	const vest = shell( c );
	const skinned = steps.skinGarmentToBody( vest, c.root );
	assert.ok( skinned.isSkinnedMesh );
	assert.strictEqual( skinned.skeleton, c.body.skeleton );
	assert.strictEqual( vest.parent, null );
	const audit = safety.auditRig( c.root );
	assert.deepStrictEqual( audit.flags, [] );

} );

await test( 'the skinned garment keeps its distance from the body across a pose; the unskinned one does not', () => {

	const sample = ( c, mesh ) => {

		c.scene.updateMatrixWorld( true );
		const bodyPts = [], v = new THREE.Vector3();
		c.body.skeleton.update();
		for ( let i = 0; i < c.body.geometry.attributes.position.count; i ++ ) bodyPts.push( c.body.getVertexPosition( i, new THREE.Vector3() ).applyMatrix4( c.body.matrixWorld ) );
		const dists = [];
		const n = mesh.geometry.attributes.position.count;

		for ( let i = 0; i < n; i += 3 ) {

			if ( mesh.isSkinnedMesh ) mesh.getVertexPosition( i, v ).applyMatrix4( mesh.matrixWorld ); else v.fromBufferAttribute( mesh.geometry.attributes.position, i ).applyMatrix4( mesh.matrixWorld );
			let d = Infinity;
			for ( const p of bodyPts ) d = Math.min( d, p.distanceTo( v ) );
			dists.push( d );

		}

		dists.sort( ( a, b ) => a - b );
		return { median: dists[ dists.length >> 1 ], p95: dists[ Math.floor( dists.length * 0.95 ) ] };

	};

	const pose = c => {

		c.bones[ 2 ].rotation.set( 0.5, 0.4, 0.2 );
		c.bones[ 1 ].position.x = 0.25;
		c.scene.updateMatrixWorld( true );

	};

	const a = buildCharacter(), b = buildCharacter();
	const unskinned = shell( a );
	const skinned = steps.skinGarmentToBody( shell( b ), b.root );

	const restSkinned = sample( b, skinned );
	pose( a ); pose( b );
	const movedUnskinned = sample( a, unskinned );
	const movedSkinned = sample( b, skinned );

	if ( process.env.DEBUG_NUMBERS ) console.log( { restSkinned, movedSkinned, movedUnskinned } );
	assert.ok( movedSkinned.p95 < restSkinned.p95 + 0.05, `skinned garment drifted: ${ restSkinned.p95 } -> ${ movedSkinned.p95 }` );
	assert.ok( movedUnskinned.p95 > movedSkinned.p95 * 3, `unskinned garment should drift away: ${ movedUnskinned.p95 } vs ${ movedSkinned.p95 }` );

} );

await test( 'skinGarmentToBody skins against the character as displayed, even mid-pose, and then follows the skeleton', () => {

	const c = buildCharacter();
	c.bones[ 2 ].rotation.set( 0.4, 0.3, 0.1 );
	c.bones[ 1 ].position.x = 0.3;
	c.scene.updateMatrixWorld( true );
	c.body.skeleton.update();

	// a vest modelled 1 cm off the CURRENT (posed) body
	const bodyPts = []; for ( let i = 0; i < c.body.geometry.attributes.position.count; i ++ ) bodyPts.push( c.body.getVertexPosition( i, new THREE.Vector3() ).applyMatrix4( c.body.matrixWorld ) );
	const ring = new THREE.CylinderGeometry( 1, 1, 1, 16, 8, true );
	const v = new THREE.Vector3(), pos = ring.attributes.position;
	for ( let i = 0; i < pos.count; i ++ ) {

		const y = 0.85 + ( pos.getY( i ) + 0.5 ) * 0.4;
		const near = bodyPts.filter( p => Math.abs( p.y - y ) < 0.05 );
		const ctr = near.reduce( ( a, p ) => a.add( p ), new THREE.Vector3() ).divideScalar( near.length );
		const dir = new THREE.Vector3( pos.getX( i ), 0, pos.getZ( i ) );
		const r = Math.max( ...near.map( p => Math.hypot( p.x - ctr.x, p.z - ctr.z ) ) );
		v.set( ctr.x + dir.x * ( r + 0.012 ), y, ctr.z + dir.z * ( r + 0.012 ) );
		pos.setXYZ( i, v.x, v.y, v.z );

	}

	const vest = new THREE.Mesh( ring, new THREE.MeshStandardMaterial() );
	vest.name = 'Vest'; vest.userData.garment = true;
	c.scene.add( vest ); // world-space, as modelled

	const worldNow = [ 0, 40, 80, 120 ].map( i => new THREE.Vector3().fromBufferAttribute( ring.attributes.position, i ) );
	const posedBefore = c.bones.map( x => x.matrixWorld.elements.slice() );
	const skinned = steps.skinGarmentToBody( vest, c.root );
	assert.deepStrictEqual( c.bones.map( x => x.matrixWorld.elements.slice() ), posedBefore, 'skinning moved the skeleton' );

	// it renders exactly where it was modelled...
	c.scene.updateMatrixWorld( true );
	[ 0, 40, 80, 120 ].forEach( ( i, k ) => {

		const p = skinned.getVertexPosition( i, new THREE.Vector3() ).applyMatrix4( skinned.matrixWorld );
		assert.ok( p.distanceTo( worldNow[ k ] ) < 1e-4, `vertex ${ i } rendered ${ p.distanceTo( worldNow[ k ] ) } away from where it was modelled` );

	} );

	// ...and keeps hugging the body when the pose changes
	const gap = () => {

		c.scene.updateMatrixWorld( true ); c.body.skeleton.update();
		const body = []; for ( let i = 0; i < c.body.geometry.attributes.position.count; i ++ ) body.push( c.body.getVertexPosition( i, new THREE.Vector3() ).applyMatrix4( c.body.matrixWorld ) );
		const d = []; for ( let i = 0; i < skinned.geometry.attributes.position.count; i += 3 ) { const p = skinned.getVertexPosition( i, new THREE.Vector3() ).applyMatrix4( skinned.matrixWorld ); d.push( Math.min( ...body.map( b => b.distanceTo( p ) ) ) ); }
		return d.sort( ( a, b ) => a - b )[ Math.floor( d.length * 0.9 ) ];

	};

	const before = gap();
	c.bones[ 2 ].rotation.set( - 0.5, 0.6, 0.3 );
	c.bones[ 1 ].position.x = - 0.2;
	assert.ok( gap() < before + 0.04, `garment drifted off the body: ${ before } -> ${ gap() }` );

} );

await test( 'props follow the head on a scaled character with the mesh node offset (the real-GLB case)', () => {

	const c = buildCharacter();
	c.root.scale.setScalar( 0.61 );
	c.root.position.set( 0.3, 1.1, 0.12 );
	c.scene.updateMatrixWorld( true );
	ops.applyCustomize( c.root, [ { op: 'attachProp', prop: { kind: 'sphere', size: 0.05, name: 'dot' }, bone: 'head', offset: [ 0, 0.2, 0 ] } ] );
	const dot = c.bones[ 4 ].children.find( x => x.name === 'dot' );

	const world = () => { c.scene.updateMatrixWorld( true ); return new THREE.Vector3().setFromMatrixPosition( dot.matrixWorld ); };
	const headWorld = () => new THREE.Vector3().setFromMatrixPosition( c.bones[ 4 ].matrixWorld );

	// at rest the dot sits 0.2 character-units above the head origin, in the character's own scale
	const rest = world().sub( headWorld() );
	assert.ok( Math.abs( rest.y - 0.2 * 0.61 ) < 1e-5, 'rest offset ' + rest.toArray().join( ',' ) );

	// and it keeps that offset (rotated with the head) through a pose
	c.bones[ 4 ].rotation.x = Math.PI / 2;
	const turned = world().sub( headWorld() );
	assert.ok( Math.abs( turned.length() - rest.length() ) < 1e-5 && Math.abs( Math.abs( turned.z ) - 0.2 * 0.61 ) < 1e-5, 'turned ' + turned.toArray().join( ',' ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
