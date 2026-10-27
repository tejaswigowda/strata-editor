// ── canonical.js ───────────────────────────────────────────────────────────────
// A canonical serialization of a scene, and its hash: the staleness check that render.json carries.
//
// Never the file as written. The same scene saved twice must give the same hash, and a re-save that changes nothing must not
// look like an edit, or staleness detection turns into noise. So:
//   - keys sorted, no whitespace
//   - numbers by the same fixed rule the scene save uses (SceneQuantize): times 4 decimals, positions 4, quaternions and matrices 5
//   - transient fields left out: the editor camera and controls, the undo history, the metadata stamp
//   - the baked timeline clip is left out too (in `animations` and in `scene.animations`): it is a cache the editor recompiles, with a new uuid,
//     from `scene.userData.timeline`, which IS hashed. Imported clips (mocap, glTF) are content and are hashed.
// What is hashed: the project settings, the scene graph (objects, geometries, materials, textures, images), the scripts and the
// background / environment. Geometry buffers are hashed as they are.
// It is the same precondition as reviewable diffs: one deterministic serialization gives readable diffs and meaningful hashes.

import { QUANTIZE_DECIMALS } from '../SceneQuantize.js';

/** The top-level fields of editor.toJSON() that make up the scene. Everything else is transient or derived. */
export const HASHED_FIELDS = [ 'project', 'scene', 'scripts', 'backgroundType', 'environmentType' ];

const TIME_KEYS = new Set( [ 'at', 'dur', 'duration', 'start', 'end', 'time', 'times', 'transitionDur' ] );
const POSITION_KEYS = new Set( [ 'position', 'translate', 'lookAt', 'lookAtWorld' ] );
const QUAT_KEYS = new Set( [ 'matrix', 'quaternion' ] );

const pow = d => 10 ** d;

function round( v, decimals ) {

	if ( ! Number.isFinite( v ) ) return v;
	const s = pow( decimals );
	const r = Math.round( v * s ) / s;
	return r === 0 ? 0 : r;

}

// Geometry buffers are structural data: never rounded, whatever they are called.
const isBuffer = key => key === 'array' || key === 'data' || key === 'indices';

function canon( value, key, decimals ) {

	if ( typeof value === 'number' ) return decimals == null ? value : round( value, decimals );
	if ( Array.isArray( value ) ) {

		const d = isBuffer( key ) ? null : decimals != null ? decimals : arrayDecimals( key );
		return value.map( v => canon( v, key, d ) );

	}
	if ( value && typeof value === 'object' ) {

		const out = {};
		for ( const k of Object.keys( value ).sort() ) {

			if ( value[ k ] === undefined ) continue;
			out[ k ] = canon( value[ k ], k, numberDecimals( k ) );

		}
		return out;

	}
	return value;

}

function numberDecimals( key ) {

	if ( TIME_KEYS.has( key ) ) return QUANTIZE_DECIMALS.time;
	return undefined;

}

function arrayDecimals( key ) {

	if ( TIME_KEYS.has( key ) ) return QUANTIZE_DECIMALS.time;
	if ( POSITION_KEYS.has( key ) ) return QUANTIZE_DECIMALS.position;
	if ( QUAT_KEYS.has( key ) ) return QUANTIZE_DECIMALS.quaternion;
	return undefined;

}

// The timeline's compiled clip is rebuilt (with a fresh uuid) every time a scene loads, so it is a cache, never content. Imported clips
// (mocap, glTF animation) are content and stay in.
function isTimelineClip( clip ) {

	const u = clip && clip.userData;
	if ( u && typeof u === 'object' ) return u.isTimeline === true;
	if ( typeof u === 'string' ) { try { return JSON.parse( u ).isTimeline === true; } catch ( e ) { return false; } }
	return false;

}

// Objects list the clips they own by uuid; forget the ones that were dropped.
function stripClipRefs( object, dropped ) {

	const out = { ...object };
	if ( Array.isArray( out.animations ) ) {

		out.animations = out.animations.filter( u => ! dropped.has( u ) );
		if ( out.animations.length === 0 ) delete out.animations;

	}
	if ( Array.isArray( out.children ) ) out.children = out.children.map( c => stripClipRefs( c, dropped ) );
	return out;

}

/** The canonical object for an editor.toJSON() result: only the hashed fields, numbers fixed, keys sorted. */
export function canonicalScene( json ) {

	const picked = {};
	for ( const f of HASHED_FIELDS ) if ( json && json[ f ] !== undefined ) picked[ f ] = json[ f ];
	if ( picked.scene && Array.isArray( picked.scene.animations ) ) {

		const dropped = new Set( picked.scene.animations.filter( isTimelineClip ).map( c => c.uuid ) );
		picked.scene = { ...picked.scene, animations: picked.scene.animations.filter( c => ! isTimelineClip( c ) ) };
		if ( dropped.size && picked.scene.object ) picked.scene.object = stripClipRefs( picked.scene.object, dropped );

	}
	// `undefined` here means "no rule for this key": numbers are left exactly as they are
	return canon( picked, '', undefined );

}

/** The canonical text: sorted keys, compact. */
export function canonicalText( json ) {

	return JSON.stringify( canonicalScene( json ) );

}

const hex = bytes => Array.from( new Uint8Array( bytes ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

/** "sha256:<hex>" of the canonical text. */
export async function sceneHash( json, subtle = globalThis.crypto && globalThis.crypto.subtle ) {

	if ( ! subtle ) throw new Error( 'sceneHash: Web Crypto is not available' );
	return 'sha256:' + hex( await subtle.digest( 'SHA-256', new TextEncoder().encode( canonicalText( json ) ) ) );

}
