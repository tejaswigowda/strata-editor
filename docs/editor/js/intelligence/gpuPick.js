// ── gpuPick.js ────────────────────────────────────────────────────────────────
// Scene grounding WITHOUT a vision model (Technique 3b): classic GPU color-picking.
// Render the scene offscreen with each mesh in a unique ID color, read pixels,
// map screen regions/points → exact object IDs. Reuses the existing renderer.
// Deterministic, no download, no inference.
//
//   whatsVisible(editor)        → [{ name, uuid, coverage }]  visible objects by screen area
//   whatsAt(editor, x, y)       → object under a DOM-space screen point (or null)
//
// Full 24-bit RGB id space (handles >256 objects). Restores the live viewport.

import { registerOp } from '../mesh/ops/index.js';

const _v2 = () => new window.THREE.Vector2();

function _collectMeshes( editor ) {

	const meshes = [];
	editor.scene.traverse( o => { if ( o.isMesh && o.visible ) meshes.push( o ); } );
	return meshes;

}

function _idToColor( id ) {

	// id starts at 1 (0 = background)
	return [ ( id & 0xff ) / 255, ( ( id >> 8 ) & 0xff ) / 255, ( ( id >> 16 ) & 0xff ) / 255 ];

}

function _colorToId( r, g, b ) { return r + ( g << 8 ) + ( b << 16 ); }

// Render an ID buffer; returns { buffer, width, height, idToObj } or null if the
// renderer can't read pixels (e.g. WebGPU path).
function _renderIds( editor ) {

	const THREE = window.THREE;
	const renderer = editor.renderer;
	const camera = editor.viewportCamera || editor.camera;

	if ( ! renderer || typeof renderer.readRenderTargetPixels !== 'function' ) return null;

	const size = renderer.getSize( _v2() );
	const w = Math.max( 1, Math.floor( size.x ) );
	const h = Math.max( 1, Math.floor( size.y ) );

	const target = new THREE.WebGLRenderTarget( w, h );
	const meshes = _collectMeshes( editor );
	const idToObj = new Map();
	const saved = [];
	const idMat = [];

	for ( let i = 0; i < meshes.length; i ++ ) {

		const id = i + 1;
		idToObj.set( id, meshes[ i ] );
		saved.push( meshes[ i ].material );
		const [ r, g, b ] = _idToColor( id );
		const m = new THREE.MeshBasicMaterial( { color: new THREE.Color( r, g, b ), fog: false } );
		idMat.push( m );
		meshes[ i ].material = m;

	}

	const prevTarget = renderer.getRenderTarget();
	const prevBg = editor.scene.background;
	editor.scene.background = null;

	const buffer = new Uint8Array( w * h * 4 );

	try {

		renderer.setRenderTarget( target );
		renderer.setClearColor( 0x000000, 1 );
		renderer.clear();
		renderer.render( editor.scene, camera );
		renderer.readRenderTargetPixels( target, 0, 0, w, h, buffer );

	} finally {

		// Restore everything
		for ( let i = 0; i < meshes.length; i ++ ) { meshes[ i ].material = saved[ i ]; idMat[ i ].dispose(); }
		editor.scene.background = prevBg;
		renderer.setRenderTarget( prevTarget );
		target.dispose();

	}

	return { buffer, width: w, height: h, idToObj };

}

/**
 * Visible objects ranked by how much of the screen they occupy.
 * @returns {Array<{ name, uuid, coverage }>}  coverage = fraction of pixels (0..1)
 */
export function whatsVisible( editor ) {

	const r = _renderIds( editor );
	if ( ! r ) return [ { name: '(GPU pick unavailable on this renderer)', uuid: null, coverage: 0 } ];

	const counts = new Map();
	const px = r.buffer;
	for ( let i = 0; i < px.length; i += 4 ) {

		const id = _colorToId( px[ i ], px[ i + 1 ], px[ i + 2 ] );
		if ( id === 0 ) continue;
		counts.set( id, ( counts.get( id ) || 0 ) + 1 );

	}

	const totalPx = r.width * r.height;
	const out = [];
	for ( const [ id, n ] of counts ) {

		const obj = r.idToObj.get( id );
		if ( obj ) out.push( { name: obj.name || obj.type, uuid: obj.uuid, coverage: Math.round( n / totalPx * 1000 ) / 1000 } );

	}

	out.sort( ( a, b ) => b.coverage - a.coverage );
	return out;

}

/**
 * Object under a DOM-space screen point (x from left, y from top).
 * Pass pixel coordinates relative to the viewport canvas.
 * @returns {THREE.Object3D|null}
 */
export function whatsAt( editor, x, y ) {

	const r = _renderIds( editor );
	if ( ! r ) return null;

	const px = Math.max( 0, Math.min( r.width - 1, Math.floor( x ) ) );
	// readRenderTargetPixels origin is bottom-left; DOM y is top-down → flip.
	const py = Math.max( 0, Math.min( r.height - 1, Math.floor( r.height - 1 - y ) ) );
	const i = ( py * r.width + px ) * 4;
	const id = _colorToId( r.buffer[ i ], r.buffer[ i + 1 ], r.buffer[ i + 2 ] );
	return id === 0 ? null : ( r.idToObj.get( id ) || null );

}

// ── Register as AI-callable tools ─────────────────────────────────────────────

registerOp( 'whatsVisible', {
	description: 'GPU color-pick: list objects currently visible on screen, ranked by screen area (occlusion proxy). No vision model.',
	params: {},
	example: 'whatsVisible()',
} );

registerOp( 'whatsAt', {
	description: 'GPU color-pick: the object under a viewport screen point (x from left, y from top, pixels).',
	params: { x: 'number', y: 'number' },
	example: 'whatsAt(400, 300)',
} );
