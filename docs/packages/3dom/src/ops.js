// ── ops.js — the closed op set, routed through a Host ─────────────────────────
//
// Every mutation $S can perform is one of these ops. They resolve a selector over
// host.scene, apply deterministic GUARDS (clamp, ground, clone-on-write on shared
// materials, graceful merged-mesh fail), build commands via the HOST factories, and
// run them through host.execute as ONE undo unit. No editor, no concrete command
// class is imported here — that is the dependency cut.
//
// Each op returns { success, count, message? } so callers (and the AI) get a
// uniform, inspectable result.

import * as selectorEngine from './selectorEngine.js';
import { THREE } from './three.js';

// ── Guards / helpers ──────────────────────────────────────────────────────────

function clamp( val, min = -1000, max = 1000 ) { return Math.max( min, Math.min( max, val ) ); }

// Resolve targets from EITHER a selector string OR an explicit node array, so the
// chain can operate on resolved sets (.parent, .not, .first) as well as selectors.
function query( host, sel ) {

	if ( Array.isArray( sel ) ) return sel;
	return selectorEngine.query( host.scene, sel );

}

function* expandToMeshes( node ) {

	if ( node.isMesh ) { yield node; }
	else if ( node.children ) { for ( const child of node.children ) yield* expandToMeshes( child ); }

}

function collectMeshes( nodes ) {

	const meshes = [];
	for ( const node of nodes ) for ( const m of expandToMeshes( node ) ) meshes.push( m );
	return meshes;

}

function hasTextureMap( mesh ) {

	if ( ! mesh || ! mesh.isMesh ) return false;
	const mat = Array.isArray( mesh.material ) ? mesh.material[ 0 ] : mesh.material;
	return !! ( mat && mat.map );

}

function isMaterialShared( material, scene ) {

	if ( ! material ) return false;
	let count = 0;
	scene.traverse( node => {

		if ( node.isMesh ) {

			const mat = Array.isArray( node.material ) ? node.material[ 0 ] : node.material;
			if ( mat === material ) count ++;

		}

	} );
	return count > 1;

}

function isMergedMeshNode( node ) {

	if ( ! node ) return false;
	let root = node;
	while ( root.parent && root.parent.parent ) root = root.parent;
	let meshCount = 0;
	root.traverse( n => { if ( n.isMesh ) meshCount ++; } );
	return meshCount === 1 && root.userData.mergedMesh;

}

function run( host, cmds ) {

	const list = cmds.filter( Boolean );
	if ( list.length === 0 ) return 0;
	host.execute( list.length === 1 ? list[ 0 ] : host.multi( list ) );
	return list.length;

}

function noMatch( selector ) { return { success: false, message: `No nodes matched "${ selector }"`, count: 0 }; }

/** Recolor. Guards: warn if textured (tint), clone-on-write on shared materials. */
export function recolorOp( host, selector, color ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	let hex;
	try { hex = new THREE.Color( color ).getHex(); }
	catch { return { success: false, message: `recolor: unrecognized color "${ color }"`, count: 0 }; }

	const warnings = [];
	const cmds = [];
	for ( const node of collectMeshes( nodes ) ) {

		const isArrayMat = Array.isArray( node.material );
		const mat = isArrayMat ? node.material[ 0 ] : node.material;
		if ( ! mat ) continue;
		if ( hasTextureMap( node ) ) warnings.push( `"${ node.name }" is textured — color TINTS, not replaces.` );

		if ( ! isArrayMat && isMaterialShared( mat, host.scene ) ) {

			const cloned = mat.clone();
			if ( cloned.color ) cloned.color.setHex( hex );
			cmds.push( host.setMaterial( node, cloned ) );

		} else {

			cmds.push( host.setMaterialColor( node, 'color', hex ) );

		}

	}

	if ( cmds.length === 0 ) return { success: false, message: 'No recolorable meshes matched', count: 0 };
	const count = run( host, cmds );
	return { success: true, message: warnings.length ? warnings.join( '; ' ) : null, count };

}

/** Scale. Guards: clamp factor to [0.1, 10]. Optional single axis. */
export function scaleOp( host, selector, factor, axis = null ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const safe = clamp( factor, 0.1, 10 );
	const cmds = [];
	for ( const node of nodes ) {

		const s = node.scale.clone();
		const a = axis ? String( axis ).toLowerCase() : null;
		if ( a && [ 'x', 'y', 'z' ].includes( a ) ) s[ a ] *= safe; else s.multiplyScalar( safe );
		cmds.push( host.setScale( node, s ) );

	}

	return { success: true, count: run( host, cmds ) };

}

/** Move (relative). Guards: clamp offsets, keep y ≥ 0 (above ground). */
export function moveOp( host, selector, dx, dy, dz ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const off = { x: clamp( dx, -100, 100 ), y: clamp( dy, -100, 100 ), z: clamp( dz, -100, 100 ) };
	const cmds = [];
	let grounded = 0;
	for ( const node of nodes ) {

		const p = node.position.clone();
		p.x += off.x; p.y += off.y; p.z += off.z;
		if ( p.y < 0 ) { p.y = 0; grounded ++; }
		cmds.push( host.setPosition( node, p ) );

	}

	const count = run( host, cmds );
	return { success: true, message: grounded ? `${ grounded } node(s) grounded (y≥0)` : null, count };

}

/** Rotate around an axis by degrees (relative). Guards: clamp to ±360. */
export function rotateOp( host, selector, axis, degrees ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const a = String( axis ).toLowerCase();
	if ( ! [ 'x', 'y', 'z' ].includes( a ) ) return { success: false, message: `Invalid axis "${ axis }"; use x, y, or z` };

	const rad = ( clamp( degrees, -360, 360 ) * Math.PI ) / 180;
	const cmds = [];
	for ( const node of nodes ) {

		const e = node.rotation.clone();
		e[ a ] += rad;
		cmds.push( host.setRotation( node, e ) );

	}

	return { success: true, count: run( host, cmds ) };

}

/** Delete. Guards: skip merged-mesh subparts (not separable); skip detached roots. */
export function deleteOp( host, selector ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const cmds = [];
	const skipped = [];
	for ( const node of nodes ) {

		if ( isMergedMeshNode( node ) ) { skipped.push( node.name || node.uuid.slice( 0, 6 ) ); continue; }
		if ( ! node.parent ) continue;
		cmds.push( host.removeObject( node ) );

	}

	const count = run( host, cmds );
	const msg = skipped.length ? `${ skipped.length } node(s) skipped (merged mesh): ${ skipped.join( ', ' ) }` : null;
	return { success: count > 0, message: msg, skipped: skipped.length, count };

}

/** Duplicate with offset. Bakes world transform onto the clone (re-parented to scene). */
export function duplicateOp( host, selector, dx = 0.5, dy = 0, dz = 0.5 ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const off = { x: clamp( dx, -100, 100 ), y: clamp( dy, -100, 100 ), z: clamp( dz, -100, 100 ) };
	const cmds = [];
	const clones = [];
	for ( const node of nodes ) {

		const clone = node.clone();
		node.updateWorldMatrix( true, false );
		node.getWorldPosition( clone.position );
		node.getWorldQuaternion( clone.quaternion );
		node.getWorldScale( clone.scale );
		clone.position.x += off.x; clone.position.y += off.y; clone.position.z += off.z;
		if ( clone.name ) clone.name += ' (copy)';
		cmds.push( host.addObject( clone, host.scene ) );
		clones.push( clone );

	}

	const count = run( host, cmds );
	return { success: count > 0, count, clones };

}

/** Replace material with a MeshStandardMaterial built from props. */
export function setMaterialOp( host, selector, materialProps ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );
	if ( ! materialProps || typeof materialProps !== 'object' ) return { success: false, message: 'materialProps must be an object' };
	if ( 'map' in materialProps && materialProps.map != null && ! materialProps.map.isTexture ) {

		return { success: false, message: 'setMaterial: map must be a THREE.Texture' };

	}

	const cmds = [];
	for ( const node of collectMeshes( nodes ) ) {

		cmds.push( host.setMaterial( node, new THREE.MeshStandardMaterial( materialProps ) ) );

	}

	return { success: cmds.length > 0, count: run( host, cmds ) };

}

/** Set opacity (0–1); flips transparent on. */
export function setOpacityOp( host, selector, value ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const v = clamp( parseFloat( value ) || 1, 0, 1 );
	const cmds = [];
	for ( const node of collectMeshes( nodes ) ) {

		if ( ! node.material ) continue;
		cmds.push( host.setMaterialValue( node, 'transparent', true ) );
		cmds.push( host.setMaterialValue( node, 'opacity', v ) );

	}

	return { success: cmds.length > 0, count: run( host, cmds ) };

}

/** Set visibility on matched nodes (undoable). */
export function setVisibleOp( host, selector, visible ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const cmds = nodes.map( node => host.setValue( node, 'visible', Boolean( visible ) ) );
	return { success: true, count: run( host, cmds ) };

}

/** Toggle wireframe on matched meshes' materials. */
export function wireframeOp( host, selector, on = true ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );

	const cmds = collectMeshes( nodes ).map( node => host.setMaterialValue( node, 'wireframe', Boolean( on ) ) );
	return { success: cmds.length > 0, count: run( host, cmds ) };

}

/** Generic object-property setter over matched nodes (castShadow, renderOrder, …). */
export function setObjectPropOp( host, selector, key, value ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );
	const cmds = nodes.filter( n => key in n ).map( n => host.setValue( n, key, value ) );
	return { success: cmds.length > 0, count: run( host, cmds ) };

}

/** Generic material-property setter over matched meshes (metalness, roughness, …). */
export function setMaterialPropOp( host, selector, key, value ) {

	const nodes = query( host, selector );
	if ( nodes.length === 0 ) return noMatch( selector );
	const cmds = collectMeshes( nodes ).map( n => host.setMaterialValue( n, key, value ) );
	return { success: cmds.length > 0, count: run( host, cmds ) };

}

// ── op-JSON dispatch (the serialized surface) ─────────────────────────────────
// A single op is { op, selector, args }. This is what the AI emits and what the
// timeline stores. dispatchOp turns one op-JSON into an executed, undoable result.

export const OP_SET = [
	'recolor', 'scale', 'move', 'rotate', 'delete', 'duplicate',
	'setMaterial', 'setOpacity', 'setVisible', 'wireframe',
	'castShadow', 'receiveShadow', 'metalness', 'roughness',
];

export const OP_SCHEMA = {
	type: 'object',
	properties: {
		op: { type: 'string', enum: OP_SET },
		selector: { type: 'string' },
		args: { type: 'object' },
	},
	required: [ 'op', 'selector' ],
};

/**
 * Execute one op-JSON against a host.
 * @param {object} host
 * @param {{op:string, selector:string, args?:object}} j
 */
export function dispatchOp( host, j ) {

	if ( ! j || typeof j.op !== 'string' ) return { success: false, message: 'op must have a string .op' };
	const sel = j.selector;
	const a = j.args || {};

	switch ( j.op ) {

		case 'recolor':     return recolorOp( host, sel, a.color );
		case 'scale':       return scaleOp( host, sel, a.factor ?? a.value, a.axis ?? null );
		case 'move':        return moveOp( host, sel, a.x ?? a.dx ?? 0, a.y ?? a.dy ?? 0, a.z ?? a.dz ?? 0 );
		case 'rotate':      return rotateOp( host, sel, a.axis, a.degrees ?? a.value );
		case 'delete':      return deleteOp( host, sel );
		case 'duplicate':   return duplicateOp( host, sel, a.x ?? a.dx, a.y ?? a.dy, a.z ?? a.dz );
		case 'setMaterial': return setMaterialOp( host, sel, a.props ?? a );
		case 'setOpacity':  return setOpacityOp( host, sel, a.value ?? a.opacity );
		case 'setVisible':  return setVisibleOp( host, sel, a.value ?? a.visible );
		case 'wireframe':   return wireframeOp( host, sel, a.value ?? a.on ?? true );
		case 'castShadow':    return setObjectPropOp( host, sel, 'castShadow', Boolean( a.value ) );
		case 'receiveShadow': return setObjectPropOp( host, sel, 'receiveShadow', Boolean( a.value ) );
		case 'metalness':     return setMaterialPropOp( host, sel, 'metalness', a.value );
		case 'roughness':     return setMaterialPropOp( host, sel, 'roughness', a.value );
		default:            return { success: false, message: `Unknown op "${ j.op }"` };

	}

}

/** Execute a list of op-JSON in order. Returns per-op results. */
export function dispatchOps( host, list ) {

	return ( Array.isArray( list ) ? list : [ list ] ).map( j => dispatchOp( host, j ) );

}
