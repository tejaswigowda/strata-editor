// Integration check on a REAL rigged GLB (not run by default: needs a local file).
//   RIG_GLB=~/Downloads/scene.optimized1_mocap-33s.glb node docs/editor/js/customize/__tests__/realRig.integration.mjs
// The GLB must be a MetaHuman-style rig with a baked clip (a bodyrig output). It checks, on that
// character: the rig fingerprint survives a full customize spec; the bone-attached sunglasses ride the
// head through the clip; the run is reproducible; and an added garment is only well-behaved once skinned.

import assert from 'node:assert';
import fs from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const docs = path.resolve( here, '../../../..' );
const file = ( process.env.RIG_GLB || '' ).replace( /^~/, process.env.HOME );
if ( ! file || ! fs.existsSync( file ) ) { console.log( 'set RIG_GLB to a rigged GLB with a baked clip' ); process.exit( 2 ); }

register( 'data:text/javascript,' + encodeURIComponent( `
export async function resolve( spec, ctx, next ) {
	if ( spec === 'three' ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'build/three.module.js' ) ).href ) }, shortCircuit: true };
	if ( spec.startsWith( 'three/addons/' ) ) return { url: ${ JSON.stringify( pathToFileURL( path.join( docs, 'examples/jsm' ) ).href + '/' ) } + spec.slice( 13 ), shortCircuit: true };
	return next( spec, ctx );
}` ) );

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ( { width: 1, height: 1, close() {} } );

const THREE = await import( 'three' );
const { GLTFLoader } = await import( 'three/addons/loaders/GLTFLoader.js' );
const { MeshoptDecoder } = await import( 'three/addons/libs/meshopt_decoder.module.js' );
const ops = await import( '../customizeOps.js' );
const safety = await import( '../rigSafety.js' );
const steps = await import( '../rigSteps.js' );

async function load() {

	const buf = fs.readFileSync( file );
	const loader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );
	const gltf = await new Promise( ( res, rej ) => loader.parse( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ), '', res, rej ) );
	const scene = new THREE.Scene();
	scene.add( gltf.scene );
	gltf.scene.userData.label = 'hero';
	scene.updateMatrixWorld( true );
	return { scene, root: gltf.scene, clips: gltf.animations };

}

const SPEC = [
	{ op: 'tint', target: 'part:skin', color: '#8a5a3c', roughness: 0.55 },
	{ op: 'hide', target: 'part:hair', optional: true },
	{ op: 'hide', target: 'part:beard', optional: true },
	{ op: 'recolor', target: 'part:clothing', color: '#080808' },
	{ op: 'blendshape', preset: 'smile' },
	{ op: 'attachProp', prop: { kind: 'sunglasses' }, bone: 'head' },
	{ op: 'tag', target: 'part:skin', classes: [ 'skin' ] },
];

let ok = true;
const check = ( name, cond, detail = '' ) => { console.log( ( cond ? '  ✓ ' : '  ✗ ' ) + name + ( detail ? '  ' + detail : '' ) ); if ( ! cond ) ok = false; };

const a = await load();
const meshes = []; a.root.traverse( o => { if ( o.isSkinnedMesh ) meshes.push( o.name ); } );
console.log( `${ path.basename( file ) }: ${ meshes.length } skinned meshes, clips: ${ a.clips.map( c => c.name + ' ' + c.duration.toFixed( 1 ) + 's' ).join( ', ' ) }` );

const t0 = Date.now();
const before = safety.rigFingerprint( a.root );
console.log( `rig fingerprint ${ before.all } (${ Date.now() - t0 } ms)` );

console.log( 'customize' );
const r = ops.applyCustomize( a.root, SPEC, { scene: a.scene } );
check( 'rig fingerprint unchanged by the full spec', safety.sameRig( before, safety.rigFingerprint( a.root ) ) );
check( 'ops matched (hair / beard are absent in this export, so skipped)', r.applied.every( x => x.matched > 0 || x.skipped ), r.applied.map( x => x.op + '×' + x.matched ).join( ' ' ) );
check( 'no rig flags', r.flags.length === 0 );

const b = await load();
const rb = ops.applyCustomize( b.root, SPEC, { scene: b.scene } );
check( 'a second load + the same spec gives the same look fingerprint', r.look === rb.look, r.look );
check( 'and the same rig fingerprint', safety.sameRig( r.rig, rb.rig ) );

console.log( 'sunglasses follow the head through the baked clip' );
const clip = a.clips.find( c => c.tracks.length > 20 );
const mixer = new THREE.AnimationMixer( a.root );
mixer.clipAction( clip ).play();

const glasses = []; a.root.traverse( o => { if ( o.userData.customizer && o.userData.propName === 'sunglasses' ) glasses.push( o ); } );
check( 'sunglasses parented to the head bone', glasses.length === 1 && glasses[ 0 ].parent.isBone && /^head/.test( glasses[ 0 ].parent.name ), glasses[ 0 ] && glasses[ 0 ].parent.name );

const face = a.root.getObjectByName( 'SKM_Bruce_FaceMesh_1' ) || a.root.getObjectByName( 'SKM_Bruce_FaceMesh' ) || [ ...( () => { const l = []; a.root.traverse( o => { if ( o.isSkinnedMesh && /FaceMesh/.test( o.name ) ) l.push( o ); } ); return l; } )() ][ 0 ];

mixer.setTime( 0 ); a.scene.updateMatrixWorld( true );
const lens = glasses[ 0 ].getObjectByName( 'Lens L' );
const lensWorld = () => new THREE.Box3().setFromObject( lens ).getCenter( new THREE.Vector3() );

// the face vertex nearest the lens at rest, and the head-bone weight it carries
face.skeleton.update();
const v = new THREE.Vector3();
let best = 0, bd = Infinity;
const L0 = lensWorld();
for ( let i = 0; i < face.geometry.attributes.position.count; i ++ ) {

	face.getVertexPosition( i, v ).applyMatrix4( face.matrixWorld );
	const d = v.distanceTo( L0 );
	if ( d < bd ) { bd = d; best = i; }

}

const headIdx = face.skeleton.bones.findIndex( x => /^head(_\d+)?$/.test( x.name ) );
let headW = 0; for ( let k = 0; k < 4; k ++ ) if ( face.geometry.attributes.skinIndex.getComponent( best, k ) === headIdx ) headW += face.geometry.attributes.skinWeight.getComponent( best, k );
console.log( `  reference vertex ${ best }: ${ ( bd * 100 ).toFixed( 1 ) } cm from the lens, ${ ( headW * 100 ).toFixed( 0 ) }% on the head bone` );

const rel = [];
const dur = clip.duration;
for ( let t = 0; t <= dur; t += dur / 12 ) {

	mixer.setTime( t ); a.scene.updateMatrixWorld( true ); face.skeleton.update();
	face.getVertexPosition( best, v ).applyMatrix4( face.matrixWorld );
	rel.push( v.distanceTo( lensWorld() ) );

}

const spread = Math.max( ...rel ) - Math.min( ...rel );
const headBone = face.skeleton.bones[ headIdx ], travel = [], p = new THREE.Vector3();
for ( let t = 0; t <= dur; t += dur / 12 ) { mixer.setTime( t ); a.scene.updateMatrixWorld( true ); travel.push( p.setFromMatrixPosition( headBone.matrixWorld ).clone() ); }
const box = new THREE.Box3().setFromPoints( travel ), moved = box.getSize( new THREE.Vector3() ).length();
const tilt = Math.max( ...( () => { const q0 = new THREE.Quaternion(); mixer.setTime( 0 ); a.scene.updateMatrixWorld( true ); headBone.getWorldQuaternion( q0 ); const out = []; for ( let t = 0; t <= dur; t += dur / 12 ) { mixer.setTime( t ); a.scene.updateMatrixWorld( true ); const q = new THREE.Quaternion(); headBone.getWorldQuaternion( q ); out.push( q0.angleTo( q ) ); } return out; } )() );
check( 'the head really moves in this clip (otherwise the check proves nothing)', moved > 0.1 && tilt > 0.2, `head travels ${ ( moved * 100 ).toFixed( 0 ) } cm, turns up to ${ ( tilt * 180 / Math.PI ).toFixed( 0 ) }°` );
check( 'lens-to-head distance is constant over the clip', spread < 2e-3, `spread ${ ( spread * 1000 ).toFixed( 2 ) } mm over ${ rel.length } samples` );

console.log( 'added deformable clothing' );
const g = await load();
Object.assign( a, g );
const body = ( () => { let m; a.root.traverse( o => { if ( ! m && o.isSkinnedMesh && /BodyMesh/.test( o.name ) ) m = o; } ); return m; } )();
const makeVest = nameOf => {

	// A torso shell 1 cm off the body, modelled at the rest pose in world space
	const pos = body.geometry.attributes.position, nrm = body.geometry.attributes.normal, idx = body.geometry.index.array;
	const w = new THREE.Vector3(), n = new THREE.Vector3(), keep = [], out = [];
	const ys = []; for ( let i = 0; i < pos.count; i ++ ) { body.getVertexPosition( i, w ).applyMatrix4( body.matrixWorld ); ys.push( w.y ); }
	const sorted = [ ...ys ].sort( ( p, q ) => p - q ), lo = sorted[ Math.floor( sorted.length * 0.45 ) ], hi = sorted[ Math.floor( sorted.length * 0.8 ) ];
	const map = new Map(); const P = [], N = [];
	for ( let t = 0; t < idx.length; t += 3 ) {

		if ( [ 0, 1, 2 ].every( k => ys[ idx[ t + k ] ] > lo && ys[ idx[ t + k ] ] < hi ) ) for ( let k = 0; k < 3; k ++ ) {

			const i = idx[ t + k ];
			if ( ! map.has( i ) ) { map.set( i, P.length / 3 ); body.getVertexPosition( i, w ).applyMatrix4( body.matrixWorld ); n.fromBufferAttribute( nrm, i ).transformDirection( body.matrixWorld ); w.addScaledVector( n, 0.01 ); P.push( w.x, w.y, w.z ); }
			out.push( map.get( i ) );

		}

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( P, 3 ) );
	g.setIndex( out );
	g.computeVertexNormals();
	const m = new THREE.Mesh( g, new THREE.MeshStandardMaterial( { color: 0x884422, side: THREE.DoubleSide } ) );
	m.name = nameOf;
	m.userData.garment = true;
	a.scene.add( m ); // modelled in world space against the displayed character
	a.scene.updateMatrixWorld( true );
	a.root.attach( m ); // then dropped into the character, world transform kept
	a.scene.updateMatrixWorld( true );
	return m;

};

const unskinned = makeVest( 'VestUnskinned' );
const flagged = safety.auditRig( a.root ).flags.filter( f => f.code === 'UNSKINNED_GARMENT' );
check( 'unskinned garment is flagged', flagged.length === 1 );
check( 'a customize run on that character reports the flag', ops.applyCustomize( a.root, [ { op: 'tag', target: 'part:skin', classes: [ 'x' ] } ] ).flags.some( f => f.code === 'UNSKINNED_GARMENT' ) );

const skinned = steps.skinGarmentToBody( makeVest( 'VestSkinned' ), a.root );
check( 'the skinned garment audits clean (only the unskinned one is still flagged)', safety.auditRig( a.root ).flags.every( f => f.node === 'VestUnskinned' ) && safety.auditRig( a.root ).flags.length === 1 );

const bodyPts = new Float32Array( body.geometry.attributes.position.count * 3 );
const clothStats = mesh => {

	a.scene.updateMatrixWorld( true ); body.skeleton.update();
	for ( let i = 0; i < body.geometry.attributes.position.count; i ++ ) { body.getVertexPosition( i, v ).applyMatrix4( body.matrixWorld ); bodyPts.set( [ v.x, v.y, v.z ], i * 3 ); }
	const dists = [];
	const n = mesh.geometry.attributes.position.count;

	for ( let i = 0; i < n; i += 4 ) {

		if ( mesh.isSkinnedMesh ) mesh.getVertexPosition( i, v ).applyMatrix4( mesh.matrixWorld ); else v.fromBufferAttribute( mesh.geometry.attributes.position, i ).applyMatrix4( mesh.matrixWorld );
		let d = Infinity;
		for ( let j = 0; j < bodyPts.length; j += 9 ) d = Math.min( d, Math.hypot( bodyPts[ j ] - v.x, bodyPts[ j + 1 ] - v.y, bodyPts[ j + 2 ] - v.z ) );
		dists.push( d );

	}

	dists.sort( ( p, q ) => p - q );
	return { median: dists[ dists.length >> 1 ], p95: dists[ Math.floor( dists.length * 0.95 ) ] };

};

const mixer2 = new THREE.AnimationMixer( a.root ); mixer2.clipAction( clip ).play();
const rows = [];
for ( let t = 0; t <= dur; t += dur / 6 ) {

	mixer2.setTime( t );
	rows.push( { t: +t.toFixed( 1 ), skinned: clothStats( skinned ), unskinned: clothStats( unskinned ) } );

}

for ( const r2 of rows ) console.log( `  t=${ String( r2.t ).padStart( 4 ) }s  skinned: median ${ ( r2.skinned.median * 100 ).toFixed( 1 ) } cm, p95 ${ ( r2.skinned.p95 * 100 ).toFixed( 1 ) } cm   unskinned: median ${ ( r2.unskinned.median * 100 ).toFixed( 1 ) } cm, p95 ${ ( r2.unskinned.p95 * 100 ).toFixed( 1 ) } cm` );

const sMax = Math.max( ...rows.map( x => x.skinned.p95 ) ), uMax = Math.max( ...rows.map( x => x.unskinned.p95 ) );
check( 'skinned garment stays on the body across the clip (p95 < 6 cm)', sMax < 0.06, `worst p95 ${ ( sMax * 100 ).toFixed( 1 ) } cm` );
check( 'the same garment unskinned drifts far off', uMax > sMax * 2, `worst p95 ${ ( uMax * 100 ).toFixed( 1 ) } cm` );

console.log( ok ? '\nOK' : '\nFAILED' );
process.exit( ok ? 0 : 1 );
