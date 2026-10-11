// ── customizeOps.js ───────────────────────────────────────────────────────────
// Character CUSTOMIZER: look / wardrobe / expression edits for any rigged GLB
// (MetaHuman-derived or otherwise). It edits an existing character
// deterministically; it does not author or generate one.
//
// One op set, two surfaces:
//   • Strata panel (Sidebar.Customize.js) — a human builds ops and applies them
//     through a command (undoable).
//   • Headless scene-spec stage — an agent hands over the same op list as JSON:
//
//       { "customize": [ { "character": "#morpheus", "ops": [
//           { "op": "tint",       "target": "part:skin",    "color": "#8a5a3c" },
//           { "op": "hide",       "target": "part:hair" },
//           { "op": "recolor",    "target": "part:clothing", "color": "#080808" },
//           { "op": "blendshape", "preset": "smile" },
//           { "op": "attachProp", "prop": { "kind": "sunglasses" }, "bone": "head" },
//           { "op": "tag",        "target": "part:skin", "classes": ["skin"] }
//       ] } ] }
//
// RIG-SAFETY INVARIANT (rigSafety.js): an edit that does not change the vertex
// set, the skin weights or the skeleton preserves both rigs. Every op here is
// of that kind, the validator REFUSES the ones that are not (geometry, weights,
// skeleton, mesh swap, bare deformable clothing), and applyCustomize hashes the
// rig before and after and rolls the whole run back if the hash moved.
//
// Pure: no DOM, no renderer, no editor. Props are placed in the character's own mesh space, so
// the ops give the same result whether or not a clip is playing.

import * as THREE from 'three';
import * as selectorEngine from '../intelligence/selectorEngine.js';
import { normalizeClassName, toClassSet } from '../intelligence/classDerive.js';
import { findParts, boneKey } from '../presets/rigParts.js';
import { rigFingerprint, sameRig, auditRig, unsafeOp, RIG_UNSAFE, GARMENT_KINDS } from './rigSafety.js';
import { buildSunglasses, buildPrimitive, PRIMITIVE_KINDS } from './props.js';
import { normalizeLook, applyLookSpec, applyLookToProp } from '../toon/toonSpec.js';

// ── Vocabulary ────────────────────────────────────────────────────────────────

export const CUSTOMIZE_OPS = {
	tint: { summary: 'multiply a colour into the existing material(s); the texture is kept', args: 'target, color, roughness?, metalness?' },
	recolor: { summary: 'recolor EXISTING clothing (flat colour by default; flat:false keeps the texture)', args: 'target, color, flat?' },
	hide: { summary: 'hide meshes (hair / beard / eyebrow cards, ...)', args: 'target, optional?' },
	show: { summary: 'show meshes again', args: 'target' },
	blendshape: { summary: 'set ARKit blendshape (morph target) influences: a resting / posed expression', args: 'shapes? | preset?, target?, reset?' },
	tag: { summary: 'add semantic classes so the part is addressable as .class', args: 'target, classes' },
	attachProp: { summary: 'parent a RIGID accessory (sunglasses, primitive, or an outside object) to a bone', args: 'prop{kind,size?,color?,name?,source?}, bone?, offset?, rotation?' },
	frame: { summary: 'add / update a camera that frames a part (camera framing)', args: 'name?, framing?, target?, fov?, azimuth?, padding?' },
	look: { summary: 'render mode: light-responsive banded toon + rim + outlines (WebGPU MToon) for the character AND its props; materials only', args: 'mode: "toon"|"native", shade?, bands?, toony?, shift?, rim?{color,power,lift,mix}, outline?{width,color,mode,mix}' },
};

export const OP_NAMES = Object.keys( CUSTOMIZE_OPS );

/** Expression presets: ARKit blendshape name → influence (0..1). */
export const EXPRESSIONS = {
	neutral: {},
	smile: { mouthSmileLeft: 0.7, mouthSmileRight: 0.7, cheekSquintLeft: 0.3, cheekSquintRight: 0.3 },
	surprise: { jawOpen: 0.5, browInnerUp: 0.8, eyeWideLeft: 0.6, eyeWideRight: 0.6, browOuterUpLeft: 0.5, browOuterUpRight: 0.5 },
	frown: { mouthFrownLeft: 0.7, mouthFrownRight: 0.7, browDownLeft: 0.6, browDownRight: 0.6 },
	blink: { eyeBlinkLeft: 1, eyeBlinkRight: 1 },
};

export class CustomizeError extends Error {

	constructor( message, errors = [], code = 'CUSTOMIZE' ) {

		super( message );
		this.name = 'CustomizeError';
		this.errors = errors;
		this.code = code;

	}

}

// ── Validation ────────────────────────────────────────────────────────────────

const isNumber = v => typeof v === 'number' && Number.isFinite( v );
const isColor = v => isNumber( v ) || ( typeof v === 'string' && v.trim().length > 0 );
const isVec3 = v => Array.isArray( v ) && v.length === 3 && v.every( isNumber );

function validateOp( op, i ) {

	const errors = [];
	const err = ( code, message ) => errors.push( { index: i, op: op && op.op, code, message } );

	if ( ! op || typeof op !== 'object' || typeof op.op !== 'string' ) {

		err( 'BAD_OP', 'each op must be an object with a string "op"' );
		return errors;

	}

	const unsafe = unsafeOp( op.op );
	if ( unsafe ) {

		err( RIG_UNSAFE, `"${ op.op }" is not a customize op. ${ unsafe.why }` );
		return errors;

	}

	if ( ! CUSTOMIZE_OPS[ op.op ] ) {

		err( 'UNKNOWN_OP', `"${ op.op }" is not in the closed customize set: ${ OP_NAMES.join( ', ' ) }` );
		return errors;

	}

	if ( op.optional !== undefined && typeof op.optional !== 'boolean' ) err( 'BAD_ARGS', `${ op.op }: "optional" must be true or false` );

	const needsTarget = [ 'tint', 'recolor', 'hide', 'show', 'tag' ];
	if ( needsTarget.includes( op.op ) && ( typeof op.target !== 'string' || ! op.target ) ) err( 'BAD_ARGS', `${ op.op }: "target" (selector, "part:<name>" or "name:<text>") is required` );

	switch ( op.op ) {

		case 'tint':
		case 'recolor':
			if ( ! isColor( op.color ) ) err( 'BAD_ARGS', `${ op.op }: "color" is required (e.g. "#8a5a3c")` );
			for ( const k of [ 'roughness', 'metalness' ] ) if ( op[ k ] !== undefined && ( ! isNumber( op[ k ] ) || op[ k ] < 0 || op[ k ] > 1 ) ) err( 'BAD_ARGS', `${ op.op }: "${ k }" must be a number in 0..1` );
			break;

		case 'tag':
			if ( ! Array.isArray( op.classes ) || op.classes.length === 0 || op.classes.some( c => typeof c !== 'string' || ! normalizeClassName( c ) ) ) err( 'BAD_ARGS', 'tag: "classes" must be a non-empty array of strings' );
			break;

		case 'blendshape': {

			if ( op.preset !== undefined && ! EXPRESSIONS[ op.preset ] ) err( 'BAD_ARGS', `blendshape: unknown preset "${ op.preset }" (${ Object.keys( EXPRESSIONS ).join( ', ' ) })` );
			if ( op.shapes === undefined && op.preset === undefined && ! op.reset ) err( 'BAD_ARGS', 'blendshape: give "shapes", a "preset", or reset:true' );

			if ( op.shapes !== undefined ) {

				if ( ! op.shapes || typeof op.shapes !== 'object' || Array.isArray( op.shapes ) ) err( 'BAD_ARGS', 'blendshape: "shapes" must be an object { arkitName: 0..1 }' );
				else for ( const [ k, v ] of Object.entries( op.shapes ) ) if ( ! isNumber( v ) || v < 0 || v > 1 ) err( 'BAD_ARGS', `blendshape: "${ k }" must be a number in 0..1` );

			}

			break;

		}

		case 'attachProp': {

			const p = op.prop;
			if ( ! p || typeof p !== 'object' || typeof p.kind !== 'string' ) {

				err( 'BAD_ARGS', 'attachProp: "prop": { "kind": ... } is required' );
				break;

			}

			if ( GARMENT_KINDS.test( p.kind ) || p.skinned === true || p.deformable === true || ( op.mount !== undefined && op.mount !== 'bone' ) ) {

				const u = unsafeOp( 'addGarment' );
				err( RIG_UNSAFE, `attachProp only attaches RIGID accessories by bone (no skinning). "${ p.kind }" is deformable clothing. ${ u.why }` );
				break;

			}

			const kinds = [ 'sunglasses', 'object', ...PRIMITIVE_KINDS ];
			if ( ! kinds.includes( p.kind ) ) err( 'BAD_ARGS', `attachProp: prop.kind must be one of ${ kinds.join( ', ' ) }` );
			if ( p.kind === 'object' && typeof p.source !== 'string' ) err( 'BAD_ARGS', 'attachProp: prop.kind "object" needs prop.source (a selector for a rigid object outside the character)' );
			if ( p.size !== undefined && ( ! isNumber( p.size ) || p.size <= 0 ) ) err( 'BAD_ARGS', 'attachProp: prop.size must be a positive number (metres)' );
			if ( op.bone !== undefined && typeof op.bone !== 'string' ) err( 'BAD_ARGS', 'attachProp: "bone" must be a bone name such as "head"' );
			for ( const k of [ 'offset', 'rotation' ] ) if ( op[ k ] !== undefined && ! isVec3( op[ k ] ) ) err( 'BAD_ARGS', `attachProp: "${ k }" must be [x, y, z]` );
			break;

		}

		case 'frame':
			if ( op.fov !== undefined && ( ! isNumber( op.fov ) || op.fov <= 1 || op.fov >= 120 ) ) err( 'BAD_ARGS', 'frame: "fov" must be a number in (1, 120)' );
			if ( op.framing !== undefined && ! [ 'head', 'full', 'fit' ].includes( op.framing ) ) err( 'BAD_ARGS', 'frame: "framing" must be head, full or fit' );
			break;

		case 'look': {

			const n = normalizeLook( op );
			n.errors.forEach( m => err( 'BAD_ARGS', m ) );
			break;

		}

	}

	return errors;

}

/** Normalise any accepted spelling into an array of { character?, ops }. */
export function normalizeStages( spec ) {

	const s = spec && spec.customize !== undefined ? spec.customize : spec;
	if ( Array.isArray( s ) && s.length > 0 && s.every( e => e && typeof e === 'object' && Array.isArray( e.ops ) ) ) return s;
	if ( s && typeof s === 'object' && Array.isArray( s.ops ) ) return [ s ];
	if ( Array.isArray( s ) ) return [ { ops: s } ];
	return null;

}

/**
 * Validate a customize stage / spec without touching a scene.
 * @returns {{ ok: boolean, errors: Array<{index, op, code, message}> }}
 */
export function validateCustomize( spec ) {

	const stages = normalizeStages( spec );
	if ( ! stages ) return { ok: false, errors: [ { index: - 1, op: null, code: 'BAD_STAGE', message: 'expected { customize: [ { character?, ops: [...] } ] } or a list of ops' } ] };

	const errors = [];
	stages.forEach( ( st, s ) => st.ops.forEach( ( op, i ) => validateOp( op, i ).forEach( e => errors.push( { ...e, stage: s } ) ) ) );
	return { ok: errors.length === 0, errors };

}

// ── Targets ───────────────────────────────────────────────────────────────────

const meshesUnder = nodes => {

	const out = new Set();
	for ( const n of nodes ) n.traverse( o => { if ( o.isMesh && ! ( o.userData && o.userData.customizer ) ) out.add( o ); } );
	return [ ...out ];

};

const NAME = {
	hair: /hair/i,
	beard: /beard|mustache|moustache|goatee|stubble/i,
	brows: /eyebrow/i,
};

function partNodes( root, key ) {

	const meshes = meshesUnder( [ root ] );
	const byName = re => meshes.filter( m => re.test( m.name ) );
	const P = findParts( root );
	const generic = ( ...res ) => meshes.filter( m => res.some( re => re.test( m.name ) ) );
	const uniq = list => [ ...new Set( list.filter( Boolean ) ) ];

	const body = uniq( [ P.body, ...generic( /^body$/i ) ] );
	const face = uniq( [ P.face, ...generic( /^head$|^face$/i ) ] );
	const shirt = uniq( [ P.shirt, ...generic( /^tops?$/i ) ] );
	const bottom = uniq( [ P.bottom, ...generic( /^bottoms?$/i ) ] );
	const shoes = uniq( [ P.shoes, ...generic( /^shoes?$/i ) ] );
	const table = {
		hair: uniq( [ ...byName( NAME.hair ).filter( m => ! NAME.brows.test( m.name ) ) ] ),
		beard: uniq( [ ...P.facialHair, ...byName( NAME.beard ) ] ),
		brows: uniq( [ P.brows, ...byName( NAME.brows ) ] ),
		body, face, shirt, bottom, shoes,
		teeth: uniq( [ P.teeth ] ), eyes: uniq( [ P.eyeL, P.eyeR ] ), eyel: uniq( [ P.eyeL ] ), eyer: uniq( [ P.eyeR ] ),
	};

	table.top = table.shirt;
	table.trousers = table.bottom;
	table.facialhair = table.beard;
	table.skin = uniq( [ ...body, ...face ] );
	table.clothing = uniq( [ ...shirt, ...bottom, ...shoes ] );
	table.cards = uniq( [ ...table.hair, ...table.beard, ...table.brows ] );

	const list = table[ key.toLowerCase() ];
	if ( ! list ) throw new CustomizeError( `unknown part "${ key }" (have: ${ Object.keys( table ).join( ', ' ) })` );
	return list;

}

/** The meshes the customizer treats as a part ("hair", "skin", "clothing", ...) — [] when the rig has none. */
export function partMeshes( root, key ) {

	try { return partNodes( root, key ); } catch ( e ) { return []; }

}

function resolveTargets( root, target ) {

	if ( target.startsWith( 'part:' ) ) return partNodes( root, target.slice( 5 ).trim() );

	if ( target.startsWith( 'name:' ) ) {

		const m = target.slice( 5 ).match( /^\/(.+)\/([a-z]*)$/ );
		const re = m ? new RegExp( m[ 1 ], m[ 2 ] ) : new RegExp( target.slice( 5 ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ), 'i' );
		const hits = [];
		root.traverse( o => { if ( o !== root && re.test( o.name ) && ! ( o.userData && o.userData.customizer ) ) hits.push( o ); } );
		return hits;

	}

	return selectorEngine.query( root, target ).filter( o => o !== root );

}

function requireTargets( root, op ) {

	const nodes = resolveTargets( root, op.target );
	if ( nodes.length === 0 ) throw new CustomizeError( `${ op.op }: target "${ op.target }" matched nothing`, [], 'NO_MATCH' );
	return nodes;

}

// ── Recorder: every mutation goes through here so a run can be undone ─────────

class Recorder {

	constructor() { this.undos = []; }

	set( obj, key, value ) {

		const old = obj[ key ];
		obj[ key ] = value;
		this.undos.push( () => { obj[ key ] = old; } );

	}

	setIndex( arr, i, value ) {

		const old = arr[ i ];
		arr[ i ] = value;
		this.undos.push( () => { arr[ i ] = old; } );

	}

	add( parent, child ) {

		parent.add( child );
		this.undos.push( () => parent.remove( child ) );

	}

	remove( node ) {

		const parent = node.parent;
		if ( ! parent ) return;
		parent.remove( node );
		this.undos.push( () => parent.add( node ) );

	}

	undo() {

		while ( this.undos.length ) this.undos.pop()();

	}

}

// ── Ops ───────────────────────────────────────────────────────────────────────

function toColor( v ) {

	const c = new THREE.Color();
	c.set( v );
	return c;

}

// Clone-and-swap: a material that has already rendered must not be mutated (the
// WebGPU backend keeps stale uniform buffers), and cloning also un-shares
// materials, so editing one mesh never repaints another. Textures stay shared.
function editMaterials( rec, mesh, fn ) {

	const edit = old => {

		const m = old.clone();
		fn( m );
		return m;

	};

	rec.set( mesh, 'material', Array.isArray( mesh.material ) ? mesh.material.map( edit ) : edit( mesh.material ) );

}

function opTint( root, op, rec, flat ) {

	const color = toColor( op.color );
	const meshes = meshesUnder( requireTargets( root, op ) );
	if ( meshes.length === 0 ) throw new CustomizeError( `${ op.op }: target "${ op.target }" has no meshes`, [], 'NO_MATCH' );

	for ( const mesh of meshes ) {

		editMaterials( rec, mesh, m => {

			if ( ! m.color ) return;
			m.color.copy( color );
			if ( flat ) m.map = null;
			if ( op.roughness !== undefined ) { m.roughness = op.roughness; m.roughnessMap = null; }
			if ( op.metalness !== undefined ) { m.metalness = op.metalness; m.metalnessMap = null; }

		} );

	}

	return meshes.length;

}

function opVisible( root, op, rec, visible ) {

	const nodes = requireTargets( root, op );
	nodes.forEach( n => rec.set( n, 'visible', visible ) );
	return nodes.length;

}

function opTag( root, op, rec ) {

	const nodes = requireTargets( root, op );

	for ( const n of nodes ) {

		const set = toClassSet( n.userData.customClasses );
		op.classes.forEach( c => set.add( normalizeClassName( c ) ) );
		rec.set( n.userData, 'customClasses', [ ...set ].sort() );

	}

	return nodes.length;

}

function opBlendshape( root, op, rec ) {

	const scope = op.target ? meshesUnder( requireTargets( root, op ) ) : meshesUnder( [ root ] );
	const morphMeshes = scope.filter( m => m.morphTargetDictionary && m.morphTargetInfluences );
	if ( morphMeshes.length === 0 ) throw new CustomizeError( 'blendshape: no mesh with morph targets in scope' );

	const shapes = { ...( op.preset ? EXPRESSIONS[ op.preset ] : {} ), ...( op.shapes || {} ) };
	const reset = op.reset === true || op.preset !== undefined;

	if ( reset ) {

		for ( const m of morphMeshes ) m.morphTargetInfluences.forEach( ( v, i ) => { if ( v !== 0 ) rec.setIndex( m.morphTargetInfluences, i, 0 ); } );

	}

	let touched = 0;

	for ( const name of Object.keys( shapes ).sort() ) {

		const owners = morphMeshes.filter( m => m.morphTargetDictionary[ name ] !== undefined );

		if ( owners.length === 0 ) {

			const have = [ ...new Set( morphMeshes.flatMap( m => Object.keys( m.morphTargetDictionary ) ) ) ].sort();
			throw new CustomizeError( `blendshape: no morph target "${ name }" (e.g. ${ have.slice( 0, 6 ).join( ', ' ) }${ have.length > 6 ? ', ...' : '' })` );

		}

		for ( const m of owners ) {

			rec.setIndex( m.morphTargetInfluences, m.morphTargetDictionary[ name ], shapes[ name ] );
			touched ++;

		}

	}

	return touched;

}

// Bounding box of `mesh` in the REF mesh's local space — read from the raw geometry, so it
// does not depend on the current (animated) pose or on where the character was moved.
function localBox( mesh, ref ) {

	if ( ! mesh.geometry.boundingBox ) mesh.geometry.computeBoundingBox();

	const toRef = mesh.isSkinnedMesh
		? new THREE.Matrix4().copy( ref.bindMatrix ).invert().multiply( mesh.bindMatrix )
		: new THREE.Matrix4().copy( ref.matrixWorld ).invert().multiply( mesh.matrixWorld );

	return mesh.geometry.boundingBox.clone().applyMatrix4( toRef );

}

function opAttachProp( root, op, rec, ctx ) {

	root.updateMatrixWorld( true );
	const wanted = boneKey( op.bone || 'head' );
	const P = findParts( root );

	const skinned = [];
	root.traverse( o => { if ( o.isSkinnedMesh && o.skeleton && ! ( o.userData && o.userData.customizer ) ) skinned.push( o ); } );
	skinned.sort( ( a, b ) => ( b === P.face ) - ( a === P.face ) );

	const ref = skinned.find( m => m.skeleton.bones.some( b => boneKey( b.name ) === wanted ) );
	if ( ! ref ) {

		const have = [ ...new Set( skinned.flatMap( m => m.skeleton.bones.map( b => boneKey( b.name ) ) ) ) ].sort();
		throw new CustomizeError( `attachProp: no bone "${ wanted }" (e.g. ${ have.slice( 0, 8 ).join( ', ' ) })` );

	}

	const boneIndex = ref.skeleton.bones.findIndex( b => boneKey( b.name ) === wanted );
	const bone = ref.skeleton.bones[ boneIndex ];
	const boneInverse = ref.skeleton.boneInverses[ boneIndex ];

	const spec = op.prop;
	const name = spec.name || spec.kind;

	// Everything is placed in the reference skinned mesh's LOCAL space (its vertex units). A skinned
	// vertex v is rendered at  boneWorld × boneInverse × bindMatrix × v,  so a child of the bone
	// placed at  boneInverse × bindMatrix × Lp  follows the head exactly like a weight-1 skin vertex,
	// whatever the pose, scale or position the character currently has.
	const offset = new THREE.Vector3( ...( op.offset || [ 0, 0, 0 ] ) );
	const q = new THREE.Quaternion().setFromEuler( new THREE.Euler( ...( op.rotation || [ 0, 0, 0 ] ).map( THREE.MathUtils.degToRad ) ) );
	const Lp = new THREE.Matrix4(); // prop frame in the ref mesh's local space

	let prop;
	let oldParent = null;

	if ( spec.kind === 'sunglasses' ) {

		if ( ! P.eyeL || ! P.eyeR ) throw new CustomizeError( 'attachProp: "sunglasses" needs the eye meshes; use a primitive prop with an offset on this rig' );
		prop = buildSunglasses( P.eyeL, P.eyeR, m => localBox( m, ref ) ); // children already in ref-local coordinates
		Lp.compose( offset, q, new THREE.Vector3( 1, 1, 1 ) );

	} else if ( spec.kind === 'object' ) {

		const found = selectorEngine.query( ctx.scene || root, spec.source )[ 0 ];
		if ( ! found ) throw new CustomizeError( `attachProp: source "${ spec.source }" matched nothing` );

		let inside = false, deformable = false;
		for ( let n = found; n; n = n.parent ) if ( n === root ) inside = true;
		found.traverse( o => { if ( o.isSkinnedMesh ) deformable = true; } );
		if ( inside ) throw new CustomizeError( 'attachProp: a source inside the character is part of the rig; use a rigid object outside it' );
		if ( deformable ) throw new CustomizeError( `attachProp: "${ spec.source }" is skinned (deformable). ${ unsafeOp( 'addGarment' ).why }` );

		// Where it sits now → ref-local space: a skinned vertex v renders at boneWorld × boneInverse × bindMatrix × v
		found.updateWorldMatrix( true, false );
		prop = found;
		oldParent = found.parent;
		ref.skeleton.update();
		const rendered = new THREE.Matrix4().multiplyMatrices( bone.matrixWorld, boneInverse );
		Lp.copy( ref.bindMatrix ).invert().multiply( rendered.invert() ).multiply( found.matrixWorld );

		Lp.premultiply( new THREE.Matrix4().compose( offset, q, new THREE.Vector3( 1, 1, 1 ) ) );

	} else {

		prop = buildPrimitive( spec.kind, spec.size ?? 0.1, spec.color ?? 0x808080 );
		prop.name = name;

		// default: the bone's rest origin (pose-independent: bindMatrix⁻¹ × boneInverse⁻¹), then the offset
		const origin = new THREE.Vector3().setFromMatrixPosition( new THREE.Matrix4().copy( boneInverse ).invert() ).applyMatrix4( new THREE.Matrix4().copy( ref.bindMatrix ).invert() );
		Lp.compose( origin.add( offset ), q, new THREE.Vector3( 1, 1, 1 ) );

	}

	if ( spec.kind !== 'object' ) prop.name = name;

	const local = new THREE.Matrix4().copy( boneInverse ).multiply( ref.bindMatrix ).multiply( Lp );

	// Re-applying replaces an earlier prop of the same name
	const earlier = [];
	root.traverse( o => { if ( o.userData && o.userData.customizer && o.userData.propName === name && o !== prop ) earlier.push( o ); } );
	earlier.forEach( o => rec.remove( o ) );

	if ( oldParent ) rec.remove( prop );

	// prop (and, for sunglasses, its children) live in the ref-local units already: the bone-local
	// matrix is  boneInverse × bindMatrix × Lp, composed with the prop's own matrix when it is a plain primitive.
	local.decompose( prop.position, prop.quaternion, prop.scale );
	prop.userData.customizer = true;
	prop.userData.propName = name;
	prop.userData.attach = { bone: wanted };
	prop.userData.customClasses = [ 'prop', normalizeClassName( spec.kind ) ];
	rec.add( bone, prop );
	prop.updateMatrixWorld( true );
	applyLookToProp( prop ); // a prop under a toon character is toon too: one shading model per frame

	return 1;

}

// look: render mode, materials only. Recorded through the same undo as every other op; the
// rig fingerprint (vertices, weights, morphs, skeleton) is checked after the run and does not move.
function opLook( root, op, rec ) {

	const n = normalizeLook( op );
	rec.set( root.userData, 'look', n.spec.look === 'native' ? undefined : n.spec );
	applyLookSpec( root, n.spec, { swap: ( mesh, mat ) => rec.set( mesh, 'material', mat ) } );
	return 1;

}

function opFrame( root, op, rec, ctx ) {

	root.updateMatrixWorld( true );
	const framing = op.framing || 'full';
	const target = op.target || ( framing === 'head' ? 'part:face' : null );
	const nodes = target ? resolveTargets( root, target ) : [ root ];
	const meshes = meshesUnder( nodes );
	if ( meshes.length === 0 ) throw new CustomizeError( `frame: target "${ target }" has no meshes`, [], 'NO_MATCH' );

	// Frames where the character is right now (the rendered, possibly animated, pose)
	const box = new THREE.Box3();
	meshes.forEach( m => box.union( new THREE.Box3().setFromObject( m, true ) ) );
	const centre = box.getCenter( new THREE.Vector3() );
	const size = box.getSize( new THREE.Vector3() );

	const fov = op.fov ?? 30, aspect = 16 / 9, pad = op.padding ?? 1.25;
	const tan = Math.tan( THREE.MathUtils.degToRad( fov / 2 ) );
	const distance = Math.max( size.y / ( 2 * tan ), size.x / ( 2 * tan * aspect ) ) * pad + size.z / 2;
	const az = THREE.MathUtils.degToRad( op.azimuth ?? 0 );

	const name = op.name || 'Customizer Camera';
	const scene = ctx.scene || root.parent || root;
	let cam = null;
	scene.traverse( o => { if ( o.isCamera && o.name === name ) cam = o; } );

	if ( ! cam ) {

		cam = new THREE.PerspectiveCamera( fov, aspect, 0.1, 100 );
		cam.name = name;
		cam.userData.customizer = true;
		rec.add( scene, cam );

	}

	rec.set( cam, 'fov', fov );
	rec.set( cam, 'aspect', aspect );
	cam.updateProjectionMatrix();
	rec.set( cam.position, 'x', centre.x + Math.sin( az ) * distance );
	rec.set( cam.position, 'y', centre.y );
	rec.set( cam.position, 'z', centre.z + Math.cos( az ) * distance );
	cam.lookAt( centre );
	cam.updateMatrixWorld( true );
	return 1;

}

const RUNNERS = {
	tint: ( r, o, rec ) => opTint( r, o, rec, false ),
	recolor: ( r, o, rec ) => opTint( r, o, rec, o.flat !== false ),
	hide: ( r, o, rec ) => opVisible( r, o, rec, false ),
	show: ( r, o, rec ) => opVisible( r, o, rec, true ),
	blendshape: opBlendshape,
	tag: opTag,
	attachProp: opAttachProp,
	frame: opFrame,
	look: opLook,
};

// ── Look fingerprint: a canonical, uuid-free description of what customize owns ─

const round = n => Math.round( n * 1e6 ) / 1e6;

export function lookState( root ) {

	const nodes = [];

	root.traverse( o => {

		const cls = o.userData && Array.isArray( o.userData.customClasses ) ? [ ...o.userData.customClasses ].sort() : undefined;

		if ( o.userData && o.userData.customizer ) {

			nodes.push( { prop: o.name, parent: o.parent ? o.parent.name : null, matrix: o.matrix.elements.map( round ), visible: o.visible, cls } );
			return;

		}

		if ( ! o.isMesh ) return;

		const materials = [].concat( o.material ).map( m => ( {
			name: m.name, color: m.color ? m.color.getHexString() : null,
			roughness: m.roughness === undefined ? null : round( m.roughness ), metalness: m.metalness === undefined ? null : round( m.metalness ),
			map: !! m.map,
		} ) );

		const morph = {};
		if ( o.morphTargetDictionary ) for ( const [ k, i ] of Object.entries( o.morphTargetDictionary ).sort( ( a, b ) => a[ 0 ] < b[ 0 ] ? - 1 : 1 ) ) if ( o.morphTargetInfluences[ i ] ) morph[ k ] = round( o.morphTargetInfluences[ i ] );

		nodes.push( { mesh: o.name, visible: o.visible, materials, morph, cls } );

	} );

	return nodes;

}

export function lookFingerprint( root ) {

	const s = JSON.stringify( lookState( root ) );
	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 ) >>> 0;
	return h.toString( 16 ).padStart( 8, '0' );

}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Apply an ordered op list to one character. Atomic: if any op throws, or the
 * rig fingerprint moved, every change is rolled back and CustomizeError is thrown.
 *
 * @param {THREE.Object3D} root     the character (group containing the skinned meshes)
 * @param {Array|object}   ops      ops, or a stage { ops }
 * @param {object} [options]        { scene } — scene root for `frame` cameras / `object` props
 * @returns {{ applied: Array, rig: object, look: string, flags: Array, undo: Function }}
 */
export function applyCustomize( root, ops, options = {} ) {

	const stage = Array.isArray( ops ) ? { ops } : ops;
	const check = validateCustomize( stage );
	if ( ! check.ok ) throw new CustomizeError( check.errors.map( e => `[${ e.index }] ${ e.message }` ).join( '\n' ), check.errors );

	root.updateMatrixWorld( true );
	const before = rigFingerprint( root );
	const rec = new Recorder();
	const applied = [];

	try {

		stage.ops.forEach( ( op, i ) => {

			try {

				applied.push( { index: i, op: op.op, matched: RUNNERS[ op.op ]( root, op, rec, options ) } );

			} catch ( e ) {

				// optional:true lets one spec serve characters that lack a part (no beard, no hair)
				if ( op.optional === true && e instanceof CustomizeError && e.code === 'NO_MATCH' ) {

					applied.push( { index: i, op: op.op, matched: 0, skipped: true } );
					return;

				}

				if ( e instanceof CustomizeError ) e.message = `[${ i }] ${ e.message }`;
				throw e;

			}

		} );

		const after = rigFingerprint( root );

		if ( ! sameRig( before, after ) ) {

			throw new CustomizeError( `rig invariant violated: the vertex set, skin weights, morph targets or skeleton changed (${ JSON.stringify( before ) } -> ${ JSON.stringify( after ) })` );

		}

		return { applied, rig: after, look: lookFingerprint( root ), flags: auditRig( root ).flags, undo: () => rec.undo() };

	} catch ( e ) {

		rec.undo();
		throw e;

	}

}

/**
 * The scene-spec `customize` stage. Resolves each entry's character (by
 * selector, or the only skinned group in the scene) and applies its ops.
 * Accepts { customize: [...] }, a list of stages, or one stage.
 */
export function runCustomizeStage( scene, spec ) {

	const check = validateCustomize( spec );
	if ( ! check.ok ) throw new CustomizeError( check.errors.map( e => `[stage ${ e.stage }, op ${ e.index }] ${ e.message }` ).join( '\n' ), check.errors );

	const stages = normalizeStages( spec );
	const results = [];

	try {

		for ( const stage of stages ) {

			let root;

			if ( stage.character ) {

				root = selectorEngine.query( scene, stage.character )[ 0 ];
				if ( ! root ) throw new CustomizeError( `character "${ stage.character }" matched nothing` );

			} else {

				const groups = scene.children.filter( c => { let sk = false; c.traverse( o => { if ( o.isSkinnedMesh ) sk = true; } ); return sk; } );
				if ( groups.length !== 1 ) throw new CustomizeError( `stage has no "character" and the scene has ${ groups.length } rigged characters` );
				root = groups[ 0 ];

			}

			results.push( { character: root.name, ...applyCustomize( root, stage, { scene } ) } );

		}

	} catch ( e ) {

		results.forEach( r => r.undo() );
		throw e;

	}

	return { results, undo: () => results.slice().reverse().forEach( r => r.undo() ), flags: results.flatMap( r => r.flags ) };

}
