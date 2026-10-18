// ── faceRuntime.js ────────────────────────────────────────────────────────────
// Editor-bound half of the authored face (the pure half is faceTrack.js).
//
// holdTimelineAt() calls applyFaceAt( editor, t ) right after the mixer has posed the body, so the
// face is a pure function of (timeline, t): scrub, play, the Render tab and the export bake all
// land on the same numbers. What it writes:
//
//   morph weights   authored keys + the idle layer, composed by faceTrack.composeShapes
//   eye + head aim  authored gaze + idle micro-noise, as a rotation ON TOP of whatever the body
//                   clip put on the head (the head) and the rest pose (the eyes)
//
// Rig-safe: morph influences and bone ROTATION poses only — no vertex, skin-weight or skeleton edit.
// A shape or bone the face layer stops driving is handed back exactly as it was found.

import * as THREE from 'three';
import { nodesForTarget, importedClipsOf } from './clipDirectives.js';
import { boneKey } from '../presets/rigParts.js';
import * as F from './faceTrack.js';

const rigCache = new WeakMap(); // root -> rig
const stateCache = new WeakMap(); // root -> { last, base, rest, touched, driven }

const EYE_NAME = /eye/i;
const NOT_EYEBALL = /brow|lid|lash|lower|upper|hair|iris|highlight|white/i;
const LEFT = /(^|[^a-z])l([^a-z]|$)|left/i;
const RIGHT = /(^|[^a-z])r([^a-z]|$)|right/i;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3( 0, 1, 0 );

/** Morph meshes, head bone and eye bones of a character root (cached). */
export function rigOf( root ) {

	const hit = rigCache.get( root );
	if ( hit ) return hit;

	const meshes = [], bones = [];

	root.traverse( o => {

		if ( o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences ) meshes.push( o );
		if ( o.isBone ) bones.push( o );

	} );

	const head = bones.find( b => boneKey( b.name ) === 'head' ) || bones.find( b => /head$/i.test( b.name ) ) || null;
	const eyeBones = bones.filter( b => EYE_NAME.test( b.name ) && ! NOT_EYEBALL.test( b.name ) );
	const eyeL = eyeBones.find( b => LEFT.test( b.name ) && ! RIGHT.test( b.name ) ) || null;
	const eyeR = eyeBones.find( b => RIGHT.test( b.name ) && ! LEFT.test( b.name ) ) || null;
	const shapes = new Set();
	for ( const m of meshes ) for ( const k of Object.keys( m.morphTargetDictionary ) ) shapes.add( k );

	const rig = { root, meshes, head, eyeL, eyeR, shapes, basis: null };
	rigCache.set( root, rig );
	return rig;

}

function stateOf( root ) {

	let st = stateCache.get( root );
	if ( ! st ) stateCache.set( root, st = { last: new Map(), base: new Map(), rec: new Map() } );
	return st;

}

// ── Morph weights ────────────────────────────────────────────────────────────

const clipMorphCache = new WeakMap(); // clip -> [ [ nodeRef, shape ] ]

function clipMorphShapes( editor, rig ) {

	const out = new Set();
	const own = new Set( rig.meshes.map( m => m.uuid ) );
	const ownNames = new Set( rig.meshes.map( m => m.name ) );

	for ( const clip of importedClipsOf( editor ) ) {

		let list = clipMorphCache.get( clip );

		if ( ! list ) {

			list = [];

			for ( const t of clip.tracks ) {

				const m = /^(.+)\.morphTargetInfluences\[(.+)\]$/.exec( t.name );
				if ( m ) list.push( [ m[ 1 ], m[ 2 ] ] );

			}

			clipMorphCache.set( clip, list );

		}

		for ( const [ node, shape ] of list ) if ( own.has( node ) || ownNames.has( node ) ) out.add( shape );

	}

	return out;

}

function readInfluence( rig, shape ) {

	for ( const m of rig.meshes ) {

		const i = m.morphTargetDictionary[ shape ];
		if ( i !== undefined ) return m.morphTargetInfluences[ i ];

	}

	return undefined;

}

function writeInfluence( rig, shape, value ) {

	for ( const m of rig.meshes ) {

		const i = m.morphTargetDictionary[ shape ];
		if ( i !== undefined ) m.morphTargetInfluences[ i ] = value;

	}

}

/**
 * The morph weights the layers produce at T: Map shape -> final weight. `base` is whatever the rig had
 * (the customizer's static pose) so the idle layer adds to it rather than replacing it.
 */
function layeredShapes( editor, rig, st, target, fk, idle, T ) {

	const authored = F.evalShapes( fk, T );
	const idleW = F.idleShapes( idle, target, T, F.heldBeats( fk ) );
	const base = new Map();

	// A shape written by someone else since we last wrote it (the customizer, a slider) becomes the new base.
	for ( const s of new Set( [ ...authored.keys(), ...idleW.keys() ] ) ) {

		if ( ! rig.shapes.has( s ) ) continue;
		const cur = readInfluence( rig, s );
		if ( ! st.last.has( s ) || st.last.get( s ) !== cur ) st.base.set( s, cur );
		base.set( s, st.base.get( s ) );

	}

	return F.composeShapes( { base, idle: idleW, authored, clipDriven: clipMorphShapes( editor, rig ) } );

}

// ── Gaze ─────────────────────────────────────────────────────────────────────

// The head's bind-pose frame: up, forward and left, in the head bone's own coordinates. Taken from the
// skin's inverse bind matrices, so it does not depend on whatever pose the body clip is in.
function basisOf( rig ) {

	if ( rig.basis ) return rig.basis;
	if ( ! rig.head ) return null;

	let skinned = null, idx = - 1;
	rig.root.traverse( o => {

		if ( skinned || ! o.isSkinnedMesh || ! o.skeleton ) return;
		const i = o.skeleton.bones.indexOf( rig.head );
		if ( i >= 0 ) { skinned = o; idx = i; }

	} );

	if ( ! skinned ) return null;

	const bindWorld = b => {

		const i = skinned.skeleton.bones.indexOf( b );
		return i < 0 ? null : _m.copy( skinned.skeleton.boneInverses[ i ] ).invert().clone();

	};

	const hm = bindWorld( rig.head );
	const eyes = [ rig.eyeL, rig.eyeR ].filter( Boolean ).map( bindWorld ).filter( Boolean );
	if ( ! hm || eyes.length === 0 ) return null;

	const hp = new THREE.Vector3(), hq = new THREE.Quaternion(), hs = new THREE.Vector3();
	hm.decompose( hp, hq, hs );
	const inv = hq.clone().invert();

	const mid = new THREE.Vector3();
	for ( const e of eyes ) mid.add( new THREE.Vector3().setFromMatrixPosition( e ) );
	mid.multiplyScalar( 1 / eyes.length ).sub( hp ).applyQuaternion( inv );

	const up = Y.clone().applyQuaternion( inv ).normalize();
	const fwd = mid.clone().addScaledVector( up, - mid.dot( up ) );
	if ( fwd.lengthSq() < 1e-12 ) return null;
	fwd.normalize();
	const left = new THREE.Vector3().crossVectors( up, fwd ).normalize();

	rig.basis = { up, fwd, left };
	return rig.basis;

}

function targetPoint( editor, spec, out ) {

	if ( Array.isArray( spec ) ) return out.set( spec[ 0 ], spec[ 1 ], spec[ 2 ] );

	const nodes = nodesForTarget( editor, spec );
	if ( nodes.length === 0 ) return null;

	let n = 0;
	out.set( 0, 0, 0 );

	for ( const node of nodes ) {

		node.updateWorldMatrix( true, true );
		const rig = rigOf( node );

		if ( rig.head ) out.add( rig.head.getWorldPosition( _v2 ) );
		else out.add( new THREE.Box3().setFromObject( node ).getCenter( _v2 ) );

		n ++;

	}

	return out.multiplyScalar( 1 / n );

}

// Aim of `spec` as { yaw, pitch } in the head frame (null = straight ahead). yaw + = left, pitch + = up.
function aimOf( editor, rig, basis, headInvQ, eyeMid, spec ) {

	if ( spec === null || spec === undefined ) return null;
	if ( spec === 'away' ) return { yaw: F.AWAY_AIM.yaw, pitch: F.AWAY_AIM.pitch };

	const P = targetPoint( editor, spec, new THREE.Vector3() );
	if ( ! P ) return null; // a target that no longer resolves: look straight ahead rather than throw mid-scrub

	const d = P.sub( eyeMid ).applyQuaternion( headInvQ );
	const l = d.dot( basis.left ), u = d.dot( basis.up ), f = d.dot( basis.fwd );
	return { yaw: Math.atan2( l, f ), pitch: Math.atan2( u, Math.hypot( l, f ) ) };

}

// The pose a bone has WITHOUT the face layer. three.js only rewrites a driven bone when its clip value changed
// since the previous update, so "the bone's current quaternion" may still carry the aim we put there last time.
// If the bone still holds exactly what we wrote, the clip didn't move it: its pose is the one we saved.
function poseWithoutUs( st, bone ) {

	const rec = st.rec.get( bone );
	if ( rec && bone.quaternion.equals( rec.written ) ) return rec.before.clone();
	return bone.quaternion.clone();

}

function writeAim( st, bone, pose, aimed ) {

	bone.quaternion.copy( aimed );
	st.rec.set( bone, { before: pose, written: bone.quaternion.clone() } );

}

function aimQuat( basis, yaw, pitch ) {

	_q.setFromAxisAngle( basis.up, yaw );
	_q2.setFromAxisAngle( basis.left, - pitch );
	return _q.multiply( _q2 ).clone();

}

function applyGaze( editor, rig, st, target, gk, idle, held, T ) {

	const g = F.evalGaze( gk, T );
	const noise = F.gazeNoise( idle, target, T, held );
	const bones = [ rig.head, rig.eyeL, rig.eyeR ].filter( Boolean );
	const basis = basisOf( rig );

	// each bone's pose with no face layer on it; put it back first so nothing accumulates between samples
	const pose = new Map( bones.map( b => [ b, poseWithoutUs( st, b ) ] ) );
	for ( const [ b, q ] of pose ) { b.quaternion.copy( q ); st.rec.delete( b ); }

	if ( ( ! g && ! noise ) || ! basis || bones.length === 0 ) return;

	rig.root.updateMatrixWorld( true );

	const eyes = [ rig.eyeL, rig.eyeR ].filter( Boolean );
	const eyeMid = new THREE.Vector3();
	for ( const e of eyes ) eyeMid.add( e.getWorldPosition( _v ) );
	if ( eyes.length ) eyeMid.multiplyScalar( 1 / eyes.length ); else rig.head.getWorldPosition( eyeMid );

	const headInv = ( rig.head ? rig.head.getWorldQuaternion( new THREE.Quaternion() ) : new THREE.Quaternion() ).invert();

	const gz = g || { from: null, to: null, eye: 1, head: 1, headWeight: F.GAZE_DEFAULTS.head };
	const from = g ? aimOf( editor, rig, basis, headInv, eyeMid.clone(), g.from ) : null;
	const to = g ? aimOf( editor, rig, basis, headInv, eyeMid.clone(), g.to ) : null;
	const r = F.resolveAim( gz, from, to, noise );

	if ( rig.head ) writeAim( st, rig.head, pose.get( rig.head ), pose.get( rig.head ).clone().multiply( aimQuat( basis, r.head.yaw, r.head.pitch ) ) );

	const qe = aimQuat( basis, r.eye.yaw, r.eye.pitch );

	// premultiply: the aim is a rotation in the head's frame, which is the eye bone's parent frame
	for ( const e of eyes ) writeAim( st, e, pose.get( e ), qe.clone().multiply( pose.get( e ) ) );

}

// ── The sampler ──────────────────────────────────────────────────────────────

/** Selectors that have a face or gaze key, or an idle layer. */
export function faceTargets( model ) {

	const out = new Set( Object.keys( model.faces || {} ) );
	for ( const t of model.tracks ) if ( t.events.some( e => e.op === F.FACE_OP || e.op === F.GAZE_OP ) ) out.add( t.target );
	return [ ...out ];

}

/**
 * Pose every character's face for global time `t`. Call after the body has been posed (mixer.update).
 * @returns {boolean} whether any character has a face layer
 */
export function applyFaceAt( editor, t ) {

	const model = editor.timeline;
	if ( ! model ) return false;

	const targets = faceTargets( model );
	if ( targets.length === 0 ) return false;

	let any = false;

	for ( const target of targets ) {

		const nodes = nodesForTarget( editor, target );
		if ( nodes.length === 0 ) continue;

		const root = nodes[ 0 ];
		const rig = rigOf( root );
		const st = stateOf( root );
		const track = model.track( target );
		const fk = F.keyEvents( track, F.FACE_OP ), gk = F.keyEvents( track, F.GAZE_OP );
		const cfg = model.face( target );
		const idle = cfg && cfg.idle ? cfg.idle : null;
		const held = F.heldBeats( fk );

		// morph weights
		if ( rig.meshes.length ) {

			const final = layeredShapes( editor, rig, st, target, fk, idle, t );

			for ( const [ s, v ] of final ) {

				if ( ! rig.shapes.has( s ) ) continue;
				writeInfluence( rig, s, v );
				st.last.set( s, v );

			}

			// a shape we drove before but no longer do goes back to what it was
			for ( const s of [ ...st.last.keys() ] ) {

				if ( final.has( s ) ) continue;
				writeInfluence( rig, s, st.base.get( s ) || 0 );
				st.last.delete( s );

			}

		}

		// eye + head aim
		applyGaze( editor, rig, st, target, gk, idle, held, t );
		any = true;

	}

	return any;

}

// ── Export bake ──────────────────────────────────────────────────────────────

/**
 * Tracks that carry the authored face into a glTF export: morph weights for every shape the layers touch,
 * and — when the character has gaze or a micro-noise layer — the eye and head rotations, baked by running the
 * real sampler at `fps`. Same numbers as playback, so export cannot drift from the viewport.
 *
 * @param {Editor} editor
 * @param {(t:number)=>void} sample  poses the scene at time t (holdTimelineAt bound to the editor)
 * @returns {{ tracks: THREE.KeyframeTrack[], replaces: Set<string> }} `replaces` — names of baked-clip tracks these supersede
 */
export function faceExportTracks( editor, sample, { fps = 30, duration } = {} ) {

	const model = editor.timeline;
	const out = { tracks: [], replaces: new Set() };
	if ( ! model ) return out;

	const total = duration === undefined ? model.duration : duration;
	const targets = faceTargets( model );
	if ( targets.length === 0 || ! ( total > 0 ) ) return out;

	const n = Math.max( 1, Math.ceil( total * fps ) );
	const times = Array.from( { length: n + 1 }, ( _, i ) => Math.min( total, i / fps ) );

	for ( const target of targets ) {

		const nodes = nodesForTarget( editor, target );
		if ( nodes.length === 0 ) continue;

		const rig = rigOf( nodes[ 0 ] );
		const track = model.track( target );
		const fk = F.keyEvents( track, F.FACE_OP ), gk = F.keyEvents( track, F.GAZE_OP );
		const cfg = model.face( target );
		const idle = cfg && cfg.idle ? cfg.idle : null;
		const st = stateOf( nodes[ 0 ] );

		// morph weights — sampled from the layers directly (no scene pose needed)
		const shapes = new Set( F.drivenShapes( track ) );
		if ( idle && idle.blink ) { shapes.add( 'eyeBlinkLeft' ); shapes.add( 'eyeBlinkRight' ); }
		if ( idle && idle.breath ) shapes.add( 'jawOpen' );

		const held = F.heldBeats( fk );
		const series = new Map( [ ...shapes ].filter( s => rig.shapes.has( s ) ).map( s => [ s, [] ] ) );
		const clipDriven = clipMorphShapes( editor, rig );

		for ( const T of times ) {

			const final = F.composeShapes( {
				base: new Map( [ ...series.keys() ].map( s => [ s, st.base.get( s ) || 0 ] ) ),
				idle: F.idleShapes( idle, target, T, held ),
				authored: F.evalShapes( fk, T ),
				clipDriven,
			} );

			for ( const [ s, arr ] of series ) arr.push( final.has( s ) ? final.get( s ) : ( st.base.get( s ) || 0 ) );

		}

		for ( const [ s, arr ] of series ) {

			const keep = [];
			for ( let i = 0; i < arr.length; i ++ ) if ( i === 0 || i === arr.length - 1 || arr[ i ] !== arr[ i - 1 ] || arr[ i ] !== arr[ i + 1 ] ) keep.push( i );
			if ( keep.length === 2 && arr[ 0 ] === 0 && arr[ arr.length - 1 ] === 0 ) continue; // never moves: nothing to export

			for ( const m of rig.meshes ) {

				if ( m.morphTargetDictionary[ s ] === undefined ) continue;
				out.tracks.push( new THREE.NumberKeyframeTrack( `${ m.uuid }.morphTargetInfluences[${ s }]`, keep.map( i => times[ i ] ), keep.map( i => arr[ i ] ) ) );

			}

		}

		// gaze: bake the bones through the real sampler
		const aims = ( gk.length > 0 || ( idle && idle.gazeNoise ) ) && sample;
		const bones = [ rig.head, rig.eyeL, rig.eyeR ].filter( Boolean );

		if ( aims && bones.length ) {

			const rec = new Map( bones.map( b => [ b, [] ] ) );

			for ( const T of times ) {

				sample( T );
				for ( const b of bones ) rec.get( b ).push( ...b.quaternion.toArray() );

			}

			for ( const b of bones ) {

				const name = `${ b.uuid }.quaternion`;
				out.tracks.push( new THREE.QuaternionKeyframeTrack( name, times, rec.get( b ) ) );
				out.replaces.add( name );

			}

		}

	}

	return out;

}
