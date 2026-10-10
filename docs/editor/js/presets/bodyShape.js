import * as THREE from 'three';
import { findParts } from './rigParts.js';

// ── Body shaping ──────────────────────────────────────────────────────────────
// flattenBelly() pushes the front of the belly and pelvis back toward the chest
// line on the skinned body, shirt and shorts together. Below `yTaper` the target
// depth eases forward again (`pelvisSlope`) so the pelvis flows into the thighs
// instead of forming a step at the shirt hem. The same displacement (a function of
// the vertex's x/y only) is applied to every layer, so the clothes keep their
// distance from the skin. Idempotent: once the front is at the target depth,
// running it again moves nothing.
//
// Usage (console): ( await import( './editor/js/presets/bodyShape.js' ) ).flattenBelly( editor );

const smoothstep = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// Smooth normals for the displaced vertices: accumulate face normals per
// position (not per vertex) so UV-seam duplicates stay consistent.
function recomputeNormals( geometry, weights ) {

	const pos = geometry.attributes.position;
	const normal = geometry.attributes.normal;
	const index = geometry.index;
	if ( ! normal || ! index ) return;

	const key = i => `${ Math.round( pos.getX( i ) * 1e4 ) },${ Math.round( pos.getY( i ) * 1e4 ) },${ Math.round( pos.getZ( i ) * 1e4 ) }`;
	const sums = new Map();
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	const n = new THREE.Vector3();

	for ( let t = 0; t < index.count; t += 3 ) {

		const ia = index.getX( t ), ib = index.getX( t + 1 ), ic = index.getX( t + 2 );
		a.fromBufferAttribute( pos, ia ); b.fromBufferAttribute( pos, ib ); c.fromBufferAttribute( pos, ic );
		n.subVectors( c, b ).cross( n.subVectors( a, b ) ); // area-weighted

		[ ia, ib, ic ].forEach( i => {

			const k = key( i );
			const s = sums.get( k ) || new THREE.Vector3();
			s.add( n );
			sums.set( k, s );

		} );

	}

	const v = new THREE.Vector3();

	for ( let i = 0; i < pos.count; i ++ ) {

		if ( weights[ i ] <= 0 ) continue;

		const s = sums.get( key( i ) );
		if ( ! s || s.lengthSq() === 0 ) continue;

		v.fromBufferAttribute( normal, i ).lerp( s.clone().normalize(), Math.min( 1, weights[ i ] * 2 ) ).normalize();
		normal.setXYZ( i, v.x, v.y, v.z );

	}

	normal.needsUpdate = true;

}

export function flattenBelly( editor, { target = 0.125, yLow = 0.74, yHigh = 1.32, yTaper = 0.98, pelvisSlope = 0.25, squeeze = 0.05 } = {} ) {

	const root = editor.scene;
	root.updateMatrixWorld( true );

	const { shirt, bottom, body } = findParts( root );
	const meshes = [ body, shirt, bottom ].filter( Boolean );
	if ( ! shirt ) return false;

	const toWorld = mesh => mesh.matrixWorld.clone().multiply( mesh.bindMatrix );
	const v = new THREE.Vector3();

	// Front-most outfit surface (|x| < 12 cm) per height band → how far to push back
	const step = 0.02;
	const front = new Map();

	[ shirt, bottom ].filter( Boolean ).forEach( outfit => {

		const outfitM = toWorld( outfit );
		const outfitPos = outfit.geometry.attributes.position;

		for ( let i = 0; i < outfitPos.count; i ++ ) {

			v.fromBufferAttribute( outfitPos, i ).applyMatrix4( outfitM );
			if ( Math.abs( v.x ) > 0.12 || v.y < yLow || v.y > yHigh ) continue;
			const band = Math.round( v.y / step );
			front.set( band, Math.max( front.get( band ) ?? - Infinity, v.z ) );

		}

	} );

	// Nothing to flatten when the belly doesn't stand out from the chest
	let chest = - Infinity, belly = - Infinity;
	front.forEach( ( z, band ) => {

		const y = band * step;
		if ( y >= 1.28 && y <= 1.36 ) chest = Math.max( chest, z );
		if ( y >= 1.0 && y <= 1.2 ) belly = Math.max( belly, z );

	} );

	if ( belly - chest < 0.02 ) return false;

	const pushBack = y => {

		const f = front.get( Math.round( y / step ) );
		if ( f === undefined ) return 0;
		return Math.max( 0, f - ( target + Math.max( 0, yTaper - y ) * pelvisSlope ) );

	};

	let moved = 0;

	meshes.forEach( mesh => {

		const geo = mesh.geometry;
		const pos = geo.attributes.position;
		if ( pos.isInterleavedBufferAttribute ) return;

		const m = toWorld( mesh );
		const inv = m.clone().invert();
		const weights = new Float32Array( pos.count );

		for ( let i = 0; i < pos.count; i ++ ) {

			v.fromBufferAttribute( pos, i ).applyMatrix4( m );

			const wy = smoothstep( yLow, yLow + 0.1, v.y ) * ( 1 - smoothstep( yHigh - 0.12, yHigh, v.y ) );
			const wx = 1 - smoothstep( 0.1, 0.24, Math.abs( v.x ) );
			const wz = smoothstep( - 0.02, 0.06, v.z ); // front half only
			const w = wy * wx * wz;
			if ( w <= 0 ) continue;

			// The waist is also drawn in a little, scaled by how much belly there was
			const push = pushBack( v.y );
			const dz = push * w;
			const sq = 1 - squeeze * Math.min( 1, push / 0.03 ) * wy * smoothstep( 0, 0.12, Math.abs( v.x ) ) * wz;
			if ( dz < 1e-5 && sq > 0.9999 ) continue;

			v.z -= dz;
			v.x *= sq;
			v.applyMatrix4( inv );
			pos.setXYZ( i, v.x, v.y, v.z );
			weights[ i ] = w;
			moved ++;

		}

		pos.needsUpdate = true;
		recomputeNormals( geo, weights );
		geo.boundingBox = null;
		geo.boundingSphere = null;

	} );

	editor.signals.sceneGraphChanged.dispatch();

	return moved > 0;

}
