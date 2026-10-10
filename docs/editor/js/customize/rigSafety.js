// ── rigSafety.js ──────────────────────────────────────────────────────────────
// The rig-safety invariant behind the character customizer:
//
//   Edits that do not change the VERTEX SET, the SKIN WEIGHTS or the SKELETON
//   preserve both rigs (body skeletal + face morph). Edits that change any of
//   the three break them.
//
// This module is the single place that states that rule in code:
//   • UNSAFE_OPS      — op names the headless `customize` stage must refuse, each
//                       with the reason and the rig step to use instead.
//   • rigFingerprint  — hashes exactly the three things the invariant protects
//                       (plus the morph deltas), so a customize run can PROVE it
//                       left the rig alone (and roll back if it did not).
//   • auditRig        — flags added deformable clothing that was never skinned.
//
// Pure: no DOM, no renderer. Works on any THREE.Object3D tree.

export const RIG_UNSAFE = 'RIG_UNSAFE';

const GEOMETRY = 'Changes the vertex set, which invalidates the per-vertex morph deltas and skin weights. Do it as an explicit rig step before baking, then re-run bodyrig / facerig.';
const SKELETON = 'Changes the skeleton (bone names, hierarchy, bind pose), which breaks the BVH retarget mapping. Do it as an explicit rig step, then re-bake.';
const WEIGHTS = 'Changes the skin weights, which are part of the rig. Do it as an explicit rig step (see rigSteps.js), not a customize op.';
const SWAP = 'Replaces the body mesh, so the skeleton binding and the 51 face morph targets no longer line up. Do it as an explicit rig step, then re-bake.';
const GARMENT = 'Adds deformable clothing. A new garment mesh must be skinned to the body skeleton or it z-fights, clips and stays static under animation, so it is an explicit rig step, not a customize op. Run rigSteps.skinGarmentToBody() on it (it will be flagged until you do). Cheaper and rig-safe: recolor the existing clothing (op "recolor"), or attach a rigid accessory to a bone (op "attachProp").';

/** op name (lower-cased) → { why, kind } */
export const UNSAFE_OPS = Object.fromEntries( [

	[ [ 'geometry', 'setgeometry', 'remesh', 'decimate', 'simplify', 'subdivide', 'sculpt', 'displace', 'deform', 'boolean', 'merge', 'mergemeshes', 'weld', 'extrude', 'bevel', 'flatten', 'flattenbelly', 'scalemesh', 'removetriangles', 'removecovered' ], 'geometry', GEOMETRY ],
	[ [ 'skeleton', 'renamebone', 'removebone', 'addbone', 'rebind', 'restpose', 'setrestpose', 'retarget', 'reparentbone' ], 'skeleton', SKELETON ],
	[ [ 'weights', 'skinweights', 'setweights', 'smoothweights', 'paintweights', 'transferweights' ], 'weights', WEIGHTS ],
	[ [ 'meshswap', 'replacemesh', 'swapmesh', 'swapbody', 'replacebody', 'setbody' ], 'meshSwap', SWAP ],
	[ [ 'addclothing', 'addgarment', 'addcloth', 'addjacket', 'addcoat', 'adddress', 'addshirt', 'addtrousers', 'addpants', 'clothing', 'garment' ], 'garment', GARMENT ],

].flatMap( ( [ names, kind, why ] ) => names.map( n => [ n, { kind, why } ] ) ) );

/** Prop kinds that read as deformable clothing — refused by attachProp. */
export const GARMENT_KINDS = /^(jacket|coat|dress|shirt|top|trousers|pants|shorts|skirt|hoodie|cloak|cape|garment|clothing|robe|suit|vest)$/i;

export function unsafeOp( name ) {

	return UNSAFE_OPS[ String( name ).toLowerCase() ] || null;

}

// ── Fingerprint ───────────────────────────────────────────────────────────────

// 32-bit FNV-1a over the 4-byte words of a buffer (tail bytes handled separately).
function hashBytes( h, view ) {

	const u8 = new Uint8Array( view.buffer, view.byteOffset, view.byteLength );
	const words = u8.byteLength >> 2;
	const w = u8.byteOffset % 4 === 0
		? new Uint32Array( u8.buffer, u8.byteOffset, words )
		: new Uint32Array( u8.buffer.slice( u8.byteOffset, u8.byteOffset + words * 4 ) );

	for ( let i = 0; i < w.length; i ++ ) h = Math.imul( h ^ w[ i ], 16777619 ) >>> 0;
	for ( let i = words * 4; i < u8.byteLength; i ++ ) h = Math.imul( h ^ u8[ i ], 16777619 ) >>> 0;

	return h;

}

function hashString( h, s ) {

	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 ) >>> 0;
	return h;

}

const hex = h => h.toString( 16 ).padStart( 8, '0' );
const SEED = 2166136261;

function hashAttribute( h, attr ) {

	if ( ! attr ) return hashString( h, '-' );
	const src = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
	return hashBytes( hashString( h, attr.itemSize + ':' + attr.count ), src );

}

function isCustomizerNode( o ) {

	for ( let n = o; n; n = n.parent ) if ( n.userData && n.userData.customizer ) return true;
	return false;

}

/**
 * Hash the three things the invariant protects.
 *   geometry — position + index of every mesh         (the vertex set)
 *   weights  — skinIndex + skinWeight                 (the skin weights)
 *   morphs   — morph target deltas + names            (the face rig)
 *   skeleton — bone names, parents, inverse binds     (the skeleton)
 * Nodes added by the customizer (userData.customizer) are not part of the rig
 * and are skipped, so attaching a prop to a bone leaves the fingerprint intact.
 */
export function rigFingerprint( root ) {

	let geometry = SEED, weights = SEED, morphs = SEED, skeleton = SEED;
	const skeletons = new Set();

	root.traverse( o => {

		if ( ! o.isMesh || isCustomizerNode( o ) || ! o.geometry ) return;

		const g = o.geometry;
		geometry = hashAttribute( geometry, g.attributes.position );
		if ( g.index ) geometry = hashBytes( geometry, g.index.array );

		weights = hashAttribute( weights, g.attributes.skinIndex );
		weights = hashAttribute( weights, g.attributes.skinWeight );

		const names = o.morphTargetDictionary ? Object.keys( o.morphTargetDictionary ) : [];
		morphs = hashString( morphs, names.join( ',' ) );
		for ( const key of Object.keys( g.morphAttributes || {} ).sort() ) {

			for ( const attr of g.morphAttributes[ key ] ) morphs = hashAttribute( morphs, attr );

		}

		if ( o.isSkinnedMesh && o.skeleton ) {

			skeletons.add( o.skeleton );
			skeleton = hashBytes( skeleton, new Float32Array( o.bindMatrix.elements ) );

		}

	} );

	for ( const sk of skeletons ) {

		sk.bones.forEach( ( b, i ) => {

			skeleton = hashString( skeleton, b.name + '<' + ( b.parent ? b.parent.name : '' ) + ';' );
			skeleton = hashBytes( skeleton, new Float32Array( sk.boneInverses[ i ].elements ) );

		} );

	}

	const all = hashString( hashString( hashString( hashString( SEED, hex( geometry ) ), hex( weights ) ), hex( morphs ) ), hex( skeleton ) );
	return { geometry: hex( geometry ), weights: hex( weights ), morphs: hex( morphs ), skeleton: hex( skeleton ), all: hex( all ) };

}

export function sameRig( a, b ) {

	return a.geometry === b.geometry && a.weights === b.weights && a.morphs === b.morphs && a.skeleton === b.skeleton;

}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function isGarment( o ) {

	const ud = o.userData || {};
	if ( ud.garment === true ) return true;
	const classes = ud.customClasses;
	return Array.isArray( classes ) ? classes.includes( 'garment' ) : false;

}

/**
 * Flags problems the invariant cannot express as a hash:
 *   UNSKINNED_GARMENT  — a garment (userData.garment / .garment class) that is not
 *                        a SkinnedMesh: it will z-fight / stay static under animation
 *   GARMENT_NO_WEIGHTS — a skinned garment whose weights do not sum to ~1
 *   GARMENT_WRONG_RIG  — a skinned garment bound to a skeleton outside this character
 * @returns {{ ok: boolean, flags: Array<{code, node, message}> }}
 */
export function auditRig( root ) {

	const flags = [];

	root.traverse( o => {

		if ( ! o.isMesh || ! isGarment( o ) ) return;

		if ( ! o.isSkinnedMesh ) {

			flags.push( { code: 'UNSKINNED_GARMENT', node: o.name, message: `Garment "${ o.name }" is not skinned to the body skeleton: it will z-fight, clip and stay static under animation. Skin it with rigSteps.skinGarmentToBody() (a rig step) — not shipped until then.` } );
			return;

		}

		const w = o.geometry.attributes.skinWeight;
		let bad = 0;
		const n = w ? w.count : 0;
		for ( let i = 0; i < n; i += Math.max( 1, Math.floor( n / 2000 ) ) ) {

			const sum = w.getX( i ) + w.getY( i ) + w.getZ( i ) + w.getW( i );
			if ( Math.abs( sum - 1 ) > 0.02 ) bad ++;

		}

		if ( ! w || bad > 0 ) flags.push( { code: 'GARMENT_NO_WEIGHTS', node: o.name, message: `Garment "${ o.name }" has missing or unnormalised skin weights.` } );

		const bone = o.skeleton && o.skeleton.bones[ 0 ];
		let inside = false;
		for ( let n2 = bone; n2; n2 = n2.parent ) if ( n2 === root ) inside = true;
		if ( bone && ! inside ) flags.push( { code: 'GARMENT_WRONG_RIG', node: o.name, message: `Garment "${ o.name }" is bound to a skeleton that is not part of this character.` } );

	} );

	return { ok: flags.length === 0, flags };

}
