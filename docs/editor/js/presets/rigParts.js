// ── rigParts.js ───────────────────────────────────────────────────────────────
// Finds the named parts of an Epic MetaHuman-style character (bo.glb, ada.glb,
// bruce.glb, ...). Outfit pieces are classified by mesh + material name, since
// their mesh names differ per character (Outfits_1 is the shirt on one rig and
// the shorts on another).

const text = mesh => mesh.name + ' ' + [].concat( mesh.material ).map( m => m.name ).join( ' ' );

const TOP = /shirt|jacket|top\b|hoodie|coat/i;
const BOTTOM = /short|pant|slack|trouser|jean|btm/i;
const SHOES = /shoe|boot|flats|sneaker/i;

export function findParts( root ) {

	const parts = { facialHair: [] };

	root.traverse( o => {

		if ( ! o.isMesh ) return;

		const n = o.name;
		const t = text( o );

		if ( /^(Beard|Mustache|Moustache)_/i.test( n ) ) parts.facialHair.push( o );
		else if ( /^Hair_/i.test( n ) ) parts.hair ??= o;
		else if ( /^Eyebrows_/i.test( n ) ) parts.brows ??= o;
		else if ( /BodyMesh|^f_med_nrw_body/i.test( n ) ) parts.body ??= o;
		else if ( /FaceMesh(_LOD0)?(_1)?$/.test( n ) ) parts.face ??= o;
		else if ( /FaceMesh(_LOD0)?_2$/.test( n ) ) parts.teeth ??= o;
		else if ( /FaceMesh(_LOD0)?_4$/.test( n ) ) parts.eyeL ??= o;
		else if ( /FaceMesh(_LOD0)?_5$/.test( n ) ) parts.eyeR ??= o;
		else if ( o.isSkinnedMesh && SHOES.test( t ) ) parts.shoes ??= o;
		else if ( o.isSkinnedMesh && BOTTOM.test( t ) ) parts.bottom ??= o;
		else if ( o.isSkinnedMesh && TOP.test( t ) ) parts.shirt ??= o;

	} );

	return parts;

}

/**
 * Canonical bone name: lower-case, without the "_N" suffix the editor adds to make
 * duplicate bone names unique. Only suffixes WITHOUT a leading zero count, so the
 * MetaHuman chain names spine_01 / spine_02 / neck_01 stay distinct from each other.
 * VRoid centre-line bones ("J_Bip_C_Head") drop their prefix so "head" resolves on them too.
 */
export function boneKey( name ) {

	return name.replace( /_[1-9]\d*$/, '' ).replace( /^j_bip_c_/i, '' ).toLowerCase();

}
