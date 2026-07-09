import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

// ── GeometryOptimizer.js ──────────────────────────────────────────────────────
// Local-first mesh compression for imported assets. Uses only three.js addons
// already vendored in this repo (no external / CDN dependency), so it works
// offline. Operations reduce the geometry that ends up stored in the scene and
// committed to git:
//   • weld     — merge duplicate vertices (BufferGeometryUtils.mergeVertices)
//   • simplify — decimate triangles (SimplifyModifier), lossy, user-controlled
//   • quantize — store normals/tangents (and optionally UVs) as 16-bit ints
//
// Draco / meshopt / KTX2 ENCODING are intentionally not offered: this repo only
// ships their decoders, and those formats are decoded back to full-size buffers
// once loaded into the editor — so they give no in-editor or committed-size win.

const _simplifier = new SimplifyModifier();

// Presets tune the toggles + strength. `simplifyRatio` is the fraction of
// vertices to REMOVE (0 = keep all, 0.5 = remove half).
export const PRESETS = {
	none:       { label: 'None',       weld: false, simplify: false, simplifyRatio: 0,    quantizeNormals: false, quantizeUVs: false },
	light:      { label: 'Light',      weld: true,  simplify: false, simplifyRatio: 0,    quantizeNormals: true,  quantizeUVs: false },
	medium:     { label: 'Medium',     weld: true,  simplify: true,  simplifyRatio: 0.25, quantizeNormals: true,  quantizeUVs: true  },
	aggressive: { label: 'Aggressive', weld: true,  simplify: true,  simplifyRatio: 0.5,  quantizeNormals: true,  quantizeUVs: true  },
};

// ── Measurement ───────────────────────────────────────────────────────────────

export function measureObject( object ) {

	let meshes = 0, vertices = 0, triangles = 0, bytes = 0;
	const seen = new Set();

	object.traverse( ( child ) => {

		if ( ! child.isMesh && ! child.isPoints && ! child.isLine ) return;

		const geometry = child.geometry;
		if ( ! geometry || ! geometry.attributes.position ) return;

		meshes ++;

		const position = geometry.attributes.position;
		vertices += position.count;

		if ( child.isMesh ) {

			triangles += geometry.index ? geometry.index.count / 3 : position.count / 3;

		}

		// Count each unique geometry's bytes once (instanced meshes share data).
		if ( ! seen.has( geometry.uuid ) ) {

			seen.add( geometry.uuid );
			bytes += BufferGeometryUtils.estimateBytesUsed( geometry );

		}

	} );

	return { meshes, vertices, triangles: Math.round( triangles ), bytes };

}

export function formatBytes( bytes ) {

	if ( bytes < 1024 ) return bytes + ' B';
	if ( bytes < 1024 * 1024 ) return ( bytes / 1024 ).toFixed( 1 ) + ' KB';
	return ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB';

}

// ── Attribute quantization ────────────────────────────────────────────────────
// Convert a signed [-1, 1] Float32 attribute (normals, tangents) to normalized
// Int16 — halving its footprint. three.js renders normalized int attributes
// natively, and our git binary externalizer stores them by dtype, so the saving
// persists into the committed scene.

function quantizeSignedAttribute( attribute ) {

	if ( ! attribute || attribute.isInterleavedBufferAttribute ) return attribute;
	if ( ! ( attribute.array instanceof Float32Array ) ) return attribute; // already quantized

	const src = attribute.array;
	const dst = new Int16Array( src.length );

	for ( let i = 0; i < src.length; i ++ ) {

		const v = Math.max( - 1, Math.min( 1, src[ i ] ) );
		dst[ i ] = Math.round( v * 32767 );

	}

	return new THREE.BufferAttribute( dst, attribute.itemSize, true );

}

// UVs are quantized to normalized Uint16 only when they stay within [0, 1]
// (no tiling / wrapping), otherwise the attribute is left untouched.
function quantizeUVAttribute( attribute ) {

	if ( ! attribute || attribute.isInterleavedBufferAttribute ) return attribute;
	if ( ! ( attribute.array instanceof Float32Array ) ) return attribute;

	const src = attribute.array;

	for ( let i = 0; i < src.length; i ++ ) {

		if ( src[ i ] < 0 || src[ i ] > 1 ) return attribute; // tiled UVs — leave as float

	}

	const dst = new Uint16Array( src.length );
	for ( let i = 0; i < src.length; i ++ ) dst[ i ] = Math.round( src[ i ] * 65535 );

	return new THREE.BufferAttribute( dst, attribute.itemSize, true );

}

// ── Per-geometry optimization ─────────────────────────────────────────────────

function optimizeGeometry( geometry, options ) {

	let geo = geometry;

	if ( options.weld ) {

		try {

			geo = BufferGeometryUtils.mergeVertices( geo, options.weldTolerance ?? 1e-4 );

		} catch ( e ) { /* non-manifold / unsupported layout — keep original */ }

	}

	if ( options.simplify && options.simplifyRatio > 0 ) {

		const position = geo.attributes.position;
		const count = Math.floor( position.count * Math.min( 0.95, options.simplifyRatio ) );

		if ( count > 0 ) {

			try {

				geo = _simplifier.modify( geo, count );

			} catch ( e ) { /* simplification failed — keep welded geometry */ }

		}

	}

	if ( options.quantizeNormals ) {

		if ( geo.attributes.normal )  geo.setAttribute( 'normal',  quantizeSignedAttribute( geo.attributes.normal ) );
		if ( geo.attributes.tangent ) geo.setAttribute( 'tangent', quantizeSignedAttribute( geo.attributes.tangent ) );

	}

	if ( options.quantizeUVs ) {

		if ( geo.attributes.uv )  geo.setAttribute( 'uv',  quantizeUVAttribute( geo.attributes.uv ) );
		if ( geo.attributes.uv1 ) geo.setAttribute( 'uv1', quantizeUVAttribute( geo.attributes.uv1 ) );

	}

	if ( geo !== geometry ) {

		geo.name = geometry.name;
		if ( ! geo.boundingBox ) geo.computeBoundingBox();
		if ( ! geo.boundingSphere ) geo.computeBoundingSphere();

	}

	return geo;

}

// ── Object optimization ───────────────────────────────────────────────────────
// Mutates the object graph in place, replacing each mesh's geometry with an
// optimized one. Shared geometries are optimized once and reused. Returns
// before/after stats. `onProgress( done, total )` is optional.

export async function optimizeObject( object, options, onProgress ) {

	// Let the browser paint any progress UI (which the caller has just shown)
	// before we start the heavy, synchronous measure/weld/simplify work.
	if ( onProgress ) {

		await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );

	}

	const before = measureObject( object );

	const meshes = [];
	object.traverse( ( child ) => {

		if ( ( child.isMesh || child.isPoints || child.isLine ) && child.geometry && child.geometry.attributes.position ) {

			meshes.push( child );

		}

	} );

	const cache = new Map(); // original geometry uuid → optimized geometry
	const total = meshes.length;
	let done = 0;

	for ( const mesh of meshes ) {

		const original = mesh.geometry;

		let optimized = cache.get( original.uuid );

		if ( optimized === undefined ) {

			optimized = optimizeGeometry( original, options );
			cache.set( original.uuid, optimized );

		}

		if ( optimized !== original ) mesh.geometry = optimized;

		done ++;
		if ( onProgress ) onProgress( done, total );

		// Yield so the UI can paint progress on large scenes.
		if ( done % 4 === 0 ) await new Promise( ( r ) => setTimeout( r, 0 ) );

	}

	const after = measureObject( object );

	return { before, after };

}

// ── Progress banner ───────────────────────────────────────────────────────────
// Small transient overlay with a label and progress bar, shared by the import
// and export compression flows. Returns { update, setLabel, done, remove }.

export function createProgressBanner( label = '' ) {

	const el = document.createElement( 'div' );
	el.style.cssText = [
		'position:fixed', 'top:32px', 'left:50%', 'transform:translateX(-50%)',
		'background:rgba(0,0,0,0.82)', 'color:#fff', 'font:12px/1.5 monospace',
		'padding:10px 16px', 'border-radius:6px', 'z-index:99999', 'pointer-events:none',
		'box-shadow:0 4px 16px rgba(0,0,0,0.4)', 'min-width:200px', 'text-align:center',
	].join( ';' );

	const text = document.createElement( 'div' );
	text.textContent = label;
	text.style.marginBottom = '7px';
	el.appendChild( text );

	const track = document.createElement( 'div' );
	track.style.cssText = 'width:100%;height:6px;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden;';
	const bar = document.createElement( 'div' );
	bar.style.cssText = 'width:0%;height:100%;background:#7ec699;transition:width 0.15s ease;';
	track.appendChild( bar );
	el.appendChild( track );

	// Add CSS for indeterminate animation
	if ( ! document.getElementById( '__progress-banner-keyframes' ) ) {
		const style = document.createElement( 'style' );
		style.id = '__progress-banner-keyframes';
		style.textContent = `
			@keyframes indeterminate-progress {
				0% { width: 30%; }
				50% { width: 70%; }
				100% { width: 30%; }
			}
			.__progress-indeterminate {
				animation: indeterminate-progress 1.5s ease-in-out infinite !important;
			}
		`;
		document.head.appendChild( style );
	}

	document.body.appendChild( el );

	let removed = false;

	return {

		el,

		setLabel( msg ) {

			text.textContent = msg;

		},

		// Fractional (0..1) or done/total progress. Optional label override.
		update( done, total, msg ) {

			if ( msg !== undefined ) text.textContent = msg;
			const pct = total > 0 ? Math.max( 0, Math.min( 100, Math.round( ( done / total ) * 100 ) ) ) : 0;
			bar.style.width = pct + '%';
			bar.classList.remove( '__progress-indeterminate' );

		},

		// Show indeterminate/loading animation (no specific percentage).
		indeterminate( msg ) {

			if ( msg !== undefined ) text.textContent = msg;
			bar.classList.add( '__progress-indeterminate' );

		},

		// Mark as indeterminate/complete (full bar).
		done( msg ) {

			if ( msg !== undefined ) text.textContent = msg;
			bar.style.width = '100%';
			bar.classList.remove( '__progress-indeterminate' );

		},

		remove() {

			if ( removed ) return;
			removed = true;
			el.remove();

		},

	};

}
