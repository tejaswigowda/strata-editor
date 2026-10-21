// ── ShaderLibrary.js ──────────────────────────────────────────────────────────
// Apply any shader to any object (see guides/SHADERS.md). The renderer is WebGPU, so a
// "shader" here is a material: a stock three.js material type, the MToon node material,
// a TSL node-material preset, or a material / function the caller supplies.
//
//   applyShader(roots, shader, params?, options?)   shader: id | THREE.Material | (src, mesh) => Material
//   revertShader(roots)                             back to the materials the meshes had before
//   restoreShaders(scene)                           re-hydrate TSL presets after a scene load
//   describeShader(mesh)                            the id of what a mesh currently wears
//   collectMeshes(roots, options)                   the meshes applyShader would touch
//
// Shared materials stay shared: meshes that used one source material get one converted
// material, so a 71-mesh glTF with 15 materials ends up with 15, not 71.
//
// Persistence. Stock material types serialise as themselves. Node materials (MToon, the TSL
// presets, a caller's own) serialise as a MeshStandardMaterial twin carrying userData.shader,
// and restoreShaders() rebuilds the preset from it on load. A function shader is NEVER stored
// or re-run on load (scenes arrive from GitHub; that would be arbitrary code execution), so
// it comes back as its twin.

import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { color, float, vec3, mix, pow, saturate, dot, sin, smoothstep, time, texture, normalView, positionViewDirection, positionWorld, materialEmissive } from 'three/tsl';
import * as ToonLook from '../toon/ToonLook.js';
import { SetShaderCommand } from '../commands/SetShaderCommand.js';
import { getShaderDef, normalizeShaderParams, mtoonLookSpec, isOutlineName, sceneHasShaders, unknownShaderMessage, splitLookSpec } from './shaderSpec.js';

const isNode = m => !! ( m && m.isNodeMaterial );

// Properties carried from the source material to its replacement, where the replacement has them.
const COPY = [ 'name', 'color', 'map', 'normalMap', 'alphaMap', 'emissive', 'emissiveMap', 'emissiveIntensity', 'side', 'transparent', 'opacity', 'alphaTest', 'depthWrite', 'depthTest' ];

function copyBase( target, src ) {

	for ( const k of COPY ) {

		if ( ! ( k in target ) || src[ k ] === undefined || src[ k ] === null && ! k.endsWith( 'Map' ) ) continue;
		const v = src[ k ];
		if ( target[ k ] && target[ k ].isColor ) { if ( v && v.isColor ) target[ k ].copy( v ); } else target[ k ] = v;

	}
	if ( target.normalScale && src.normalScale ) target.normalScale.copy( src.normalScale );
	return target;

}

// ── Builders ──────────────────────────────────────────────────────────────────

const NATIVE = {
	standard: p => new THREE.MeshStandardMaterial( { roughness: p.roughness, metalness: p.metalness } ),
	physical: p => new THREE.MeshPhysicalMaterial( { roughness: p.roughness, metalness: p.metalness, clearcoat: p.clearcoat } ),
	lambert: () => new THREE.MeshLambertMaterial(),
	phong: p => new THREE.MeshPhongMaterial( { shininess: p.shininess, specular: new THREE.Color( p.specular ) } ),
	basic: () => new THREE.MeshBasicMaterial(),
	'toon-basic': () => new THREE.MeshToonMaterial(),
	normal: () => new THREE.MeshNormalMaterial(),
	wireframe: () => new THREE.MeshBasicMaterial( { wireframe: true } ),
};

const fresnelTerm = power => pow( float( 1 ).sub( saturate( dot( normalView, positionViewDirection ) ) ), float( power ) );

const TSL = {

	fresnel( src, p ) {

		const m = copyBase( new MeshStandardNodeMaterial(), src );
		if ( src.roughness !== undefined ) m.roughness = src.roughness;
		if ( src.metalness !== undefined ) m.metalness = src.metalness;
		m.emissiveNode = materialEmissive.add( color( p.color ).mul( fresnelTerm( p.power ) ).mul( p.intensity ) );
		return m;

	},

	hologram( src, p ) {

		const m = new MeshBasicNodeMaterial();
		m.name = src.name || '';
		m.transparent = true;
		m.depthWrite = false;
		m.side = THREE.DoubleSide;
		m.blending = THREE.AdditiveBlending;
		const scan = smoothstep( 0.3, 0.7, sin( positionWorld.y.mul( p.lines ).add( time.mul( p.speed * 10 ) ) ).mul( 0.5 ).add( 0.5 ) );
		m.colorNode = color( p.color );
		m.opacityNode = fresnelTerm( 2 ).mul( 0.7 ).add( 0.3 ).mul( scan.mul( 0.6 ).add( 0.4 ) ).mul( p.opacity );
		return m;

	},

	gradient( src, p ) {

		const m = copyBase( new MeshStandardNodeMaterial(), src );
		if ( src.roughness !== undefined ) m.roughness = src.roughness;
		if ( src.metalness !== undefined ) m.metalness = src.metalness;
		const to = p.to === p.from ? p.from + 1e-4 : p.to;
		const t = smoothstep( p.from, to, positionWorld[ p.axis ] );
		let c = mix( color( p.colorA ), color( p.colorB ), t );
		if ( src.map ) c = c.mul( texture( src.map ).rgb );
		m.colorNode = c;
		return m;

	},

};

// ── Serialisation twin ────────────────────────────────────────────────────────

function twinOf( m, base, tag ) {

	const t = copyBase( new THREE.MeshStandardMaterial(), base );
	t.uuid = m.uuid;
	t.name = m.name || base.name || '';
	const user = { ...( base.userData || {} ) };
	delete user.shader;
	t.userData = tag ? { ...user, shader: tag } : user;
	return t;

}

function install( m, base, tag ) {

	m.__base = base;
	m.userData = { ...( m.userData || {} ), shader: tag };
	m.toJSON = meta => twinOf( m, base, tag ).toJSON( meta );
	return m;

}

// ── Selecting meshes ──────────────────────────────────────────────────────────

const asRoots = roots => ( Array.isArray( roots ) ? roots : [ roots ] ).filter( Boolean );

function wanted( mesh, options ) {

	if ( ! mesh.isMesh || ! mesh.material ) return false;
	if ( mesh.userData && ( mesh.userData.noShader || mesh.userData.noToon ) ) return false;
	if ( options.skipOutlines !== false ) {

		const mats = [].concat( mesh.material );
		if ( isOutlineName( mesh.name ) || mats.every( m => isOutlineName( m.name ) && m.side === THREE.BackSide ) ) return false;

	}
	return ! options.filter || !! options.filter( mesh );

}

/** The meshes under `roots` that applyShader would touch. */
export function collectMeshes( roots, options = {} ) {

	const out = [];
	const seen = new Set();
	for ( const r of asRoots( roots ) ) r.traverse( o => { if ( ! seen.has( o ) && wanted( o, options ) ) { seen.add( o ); out.push( o ); } } );
	return out;

}

const TYPE_TO_ID = {
	MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong',
	MeshBasicMaterial: 'basic', MeshToonMaterial: 'toon-basic', MeshNormalMaterial: 'normal',
};

/** The shader id a mesh currently wears: a registry id, 'custom', or the raw material type. */
export function describeShader( mesh ) {

	const m = [].concat( mesh.material || [] ).find( x => x && ! x.isOutline );
	if ( ! m ) return null;
	if ( ToonLook.isToon( m ) ) return 'mtoon';
	if ( m.userData && m.userData.shader && m.userData.shader.id ) return m.userData.shader.id;
	if ( m.isMeshBasicMaterial && m.wireframe ) return 'wireframe';
	return TYPE_TO_ID[ m.type ] || m.type;

}

const clearLook = roots => { for ( const r of asRoots( roots ) ) if ( r.userData && r.userData.look ) delete r.userData.look; };

// ── Apply ─────────────────────────────────────────────────────────────────────

function convert( src, id, p, custom ) {

	if ( custom ) {

		const out = typeof custom === 'function' ? custom( src ) : custom;
		if ( ! out || ! out.isMaterial ) throw new Error( 'shader: the function must return a THREE.Material' );
		if ( out.__base ) return out;
		if ( isNode( out ) ) return install( out, src.__base || src, { id: 'custom' } );
		out.__base = src.__base || src;
		return out;

	}

	const def = getShaderDef( id );
	const base = src.__base || src;

	if ( def.persist === 'native' ) {

		const m = copyBase( NATIVE[ def.id ]( p ), src );
		if ( def.id === 'wireframe' ) m.color.set( p.color );
		if ( def.id === 'standard' || def.id === 'physical' ) { m.roughness = p.roughness; m.metalness = p.metalness; }
		m.userData = { ...( src.userData || {} ), shader: { id: def.id, params: p } };
		delete m.userData.toon;
		m.__base = base;
		return m;

	}

	return install( TSL[ def.id ]( src, p ), base, { id: def.id, params: p } );

}

/** Check a shader argument and its params without touching anything. Returns { custom, def, id, p } or throws. */
function resolveShader( shader, params ) {

	const custom = typeof shader === 'function' || ( shader && shader.isMaterial ) ? shader : null;
	const def = custom ? null : getShaderDef( shader );
	if ( ! custom && ! def ) throw new Error( unknownShaderMessage( shader ) );
	if ( custom && params !== undefined && params !== null && ! ( typeof params === 'object' && ! Object.keys( params ).length ) ) {

		throw new Error( 'shader: a material or function takes no params; build them into it' );

	}

	let p = {};
	if ( def ) {

		const n = normalizeShaderParams( def.id, params, def.id !== 'mtoon' );
		if ( ! n.ok ) throw new Error( n.errors.join( '; ' ) );
		p = n.params;

	}
	return { custom, def, id: custom ? 'custom' : def.id, p };

}

/**
 * Give every mesh under `roots` the shader.
 *  shader   a registry id (see listShaders), a THREE.Material (shared by every mesh), or a
 *           function (sourceMaterial) => Material (called once per source material)
 *  params   the shader's parameters (validated; MToon forwards only the keys you give)
 *  options  { skipOutlines = true, filter(mesh), addLight(scene, light) }
 * Returns { id, params, meshes, materials }.
 */
export function applyShader( roots, shader, params, options = {} ) {

	const rootList = asRoots( roots );
	const { custom, id, p } = resolveShader( shader, params );

	const meshes = collectMeshes( rootList, options );
	const set = new Set( meshes );
	const filter = m => set.has( m );
	const cache = new Map();

	if ( id === 'mtoon' ) {

		const spec = mtoonLookSpec( p );
		for ( const r of rootList ) ToonLook.applyToonLook( r, spec, { filter, cache, addLight: options.addLight } );
		return { id, params: p, meshes: meshes.length, materials: new Set( meshes.flatMap( m => [].concat( m.material ) ) ).size };

	}

	// leave the toon outline passes and groups behind before another material goes on
	clearLook( rootList );
	for ( const m of meshes ) {

		if ( [].concat( m.material ).some( ToonLook.isToon ) ) ToonLook.revertToonLook( m, {} );

	}

	for ( const mesh of meshes ) {

		const before = [].concat( mesh.material );
		const next = before.map( src => {

			if ( ! cache.has( src ) ) cache.set( src, convert( src, id, p, custom ) );
			return cache.get( src );

		} );
		mesh.material = Array.isArray( mesh.material ) ? next : next[ 0 ];

	}

	return { id, params: p, meshes: meshes.length, materials: cache.size };

}

/** Undo applyShader outside the undo stack: restore each mesh's original material(s). Returns { id: 'original', params: {}, meshes, materials }. */
export function revertShader( roots, options = {} ) {

	let count = 0;
	const worn = new Set();
	clearLook( roots );
	for ( const mesh of collectMeshes( roots, { ...options, skipOutlines: false } ) ) {

		let changed = false;
		if ( [].concat( mesh.material ).some( ToonLook.isToon ) ) { ToonLook.revertToonLook( mesh, {} ); changed = true; }

		const mats = [].concat( mesh.material );
		const back = mats.map( m => {

			if ( ! m.__base ) return m;
			changed = true;
			const b = m.__base;
			if ( b.userData && b.userData.shader ) { b.userData = { ...b.userData }; delete b.userData.shader; }
			return b;

		} );
		if ( changed ) {

			mesh.material = Array.isArray( mesh.material ) ? back : back[ 0 ];
			count ++;
			for ( const m of back ) worn.add( m );

		}

	}
	return { id: 'original', params: {}, meshes: count, materials: worn.size };

}

// ── Undoable entry points (the Shader tab and the shell) ──────────────────────

function runCommand( editor, roots, name, run ) {

	const cmd = new SetShaderCommand( editor, roots, run, name );
	try {

		editor.execute( cmd );

	} catch ( e ) {

		const undos = editor.history.undos;
		if ( undos[ undos.length - 1 ] === cmd ) undos.pop();
		cmd.undo();
		throw e;

	}
	return cmd.result;

}

/** applyShader as one undo step (also removes any toon lights it added on undo). A bad shader or spec throws before anything is touched. */
export function executeShader( editor, roots, shader, params, options = {} ) {

	const list = asRoots( roots );
	resolveShader( shader, params );
	return runCommand( editor, list, 'Shader: ' + ( typeof shader === 'string' ? shader : 'custom' ), () => applyShader( list, shader, params, options ) );

}

/** revertShader as one undo step. Returns { id: 'original', params: {}, meshes, materials }. */
export function executeRevert( editor, roots, options = {} ) {

	const list = asRoots( roots );
	return runCommand( editor, list, 'Revert Shader', () => revertShader( list, options ) );

}

/** toon(): a look spec (mtoon params, or look: 'native' to revert) as one undo step; the same result shape as executeShader. */
export function executeLook( editor, roots, spec, options = {} ) {

	const { look, params } = splitLookSpec( spec );
	if ( look === 'toon' ) return executeShader( editor, roots, 'mtoon', params, options );

	const n = normalizeShaderParams( 'mtoon', params, false );
	if ( ! n.ok ) throw new Error( n.errors.join( '; ' ) );
	return executeRevert( editor, roots, { ...options, skipOutlines: false } );

}

// ── Scene load ────────────────────────────────────────────────────────────────

/** Rebuild TSL presets from their standard twins. Call after ObjectLoader. Returns the count. */
export function restoreShaders( scene ) {

	let count = 0;
	const cache = new Map();

	scene.traverse( mesh => {

		if ( ! mesh.isMesh ) return;
		const mats = [].concat( mesh.material );
		if ( ! mats.some( m => m && m.userData && m.userData.shader ) ) return;

		const rebuilt = mats.map( m => {

			const tag = m && m.userData && m.userData.shader;
			if ( ! tag || isNode( m ) ) return m;
			const def = getShaderDef( tag.id );
			if ( ! def || def.persist !== 'twin' || def.id === 'mtoon' ) return m;
			if ( cache.has( m ) ) return cache.get( m );

			const n = normalizeShaderParams( def.id, tag.params );
			if ( ! n.ok ) return m;
			try {

				const out = install( TSL[ def.id ]( m, n.params ), m, { id: def.id, params: n.params } );
				out.uuid = m.uuid;
				cache.set( m, out );
				count ++;
				return out;

			} catch ( e ) {

				console.warn( 'restoreShaders: could not rebuild ' + def.id, e );
				return m;

			}

		} );

		mesh.material = Array.isArray( mesh.material ) ? rebuilt : rebuilt[ 0 ];

	} );

	return count;

}

export { sceneHasShaders };
