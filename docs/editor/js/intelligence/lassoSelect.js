// ── lassoSelect.js ────────────────────────────────────────────────────────────
// Screen-space lasso selection, shared by the interactive viewport tool AND the
// shell / AI surface. Given a polygon of viewport-pixel points, returns every
// mesh whose projected centre OR any bounding-box corner falls inside the
// polygon. Resolution-independent and catches objects occluded by others
// (unlike ray casting). No vision model — pure projection + point-in-polygon.
//
//   lassoSelect(editor, polygon, opts?) → Array<THREE.Object3D>
//
// `polygon` accepts either [ [x,y], … ] or [ {x,y}, … ] in viewport CSS pixels
// (origin top-left). `opts`:
//   camera          — override the camera used for projection
//   width, height   — viewport size in CSS px (defaults to the renderer canvas)
//   apply           — when true, also selects the matched nodes in the editor
//   includeInvisible— when true, traverse hidden nodes too (default: visible only)

import { registerOp } from '../mesh/ops/index.js';

/** Ray-casting point-in-polygon test. `point`/`polygon` use { x, y }. */
export function pointInPolygon( point, polygon ) {

	if ( ! polygon || polygon.length < 3 ) return false;

	let inside = false;

	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i ++ ) {

		const xi = polygon[ i ].x, yi = polygon[ i ].y;
		const xj = polygon[ j ].x, yj = polygon[ j ].y;

		if ( ( yi > point.y ) !== ( yj > point.y ) &&
			point.x < ( xj - xi ) * ( point.y - yi ) / ( yj - yi ) + xi ) {

			inside = ! inside;

		}

	}

	return inside;

}

/** Coerce mixed [x,y] / {x,y} points into a uniform [ {x,y} ] polygon. */
function _normalizePolygon( polygon ) {

	if ( ! Array.isArray( polygon ) ) return [];

	return polygon
		.map( p => Array.isArray( p ) ? { x: p[ 0 ], y: p[ 1 ] } : { x: p.x, y: p.y } )
		.filter( p => Number.isFinite( p.x ) && Number.isFinite( p.y ) );

}

/**
 * Select every mesh whose screen projection falls inside `polygon`.
 * @param {Editor} editor
 * @param {Array<[number,number]|{x:number,y:number}>} polygon  viewport-pixel points
 * @param {{camera?, width?, height?, apply?:boolean, includeInvisible?:boolean}} [opts]
 * @returns {Array<THREE.Object3D>}
 */
export function lassoSelect( editor, polygon, opts = {} ) {

	const THREE = window.THREE;
	const scene = editor.scene;
	const camera = opts.camera || editor.viewportCamera || editor.camera;

	if ( ! THREE || ! scene || ! camera ) return [];

	const poly = _normalizePolygon( polygon );
	if ( poly.length < 3 ) return [];

	let width = opts.width;
	let height = opts.height;

	if ( ! width || ! height ) {

		const dom = ( editor.renderer && editor.renderer.domElement )
			|| ( typeof document !== 'undefined' && document.getElementById( 'viewport' ) );
		width = dom ? ( dom.clientWidth || dom.width ) : window.innerWidth;
		height = dom ? ( dom.clientHeight || dom.height ) : window.innerHeight;

	}

	scene.updateMatrixWorld( true );

	const camDir = new THREE.Vector3();
	camera.getWorldDirection( camDir );

	const v = new THREE.Vector3();
	const center = new THREE.Vector3();
	const corner = new THREE.Vector3();
	const box = new THREE.Box3();

	// World point → viewport pixel, or null when it sits behind the camera.
	const projectToScreen = ( worldPos ) => {

		v.copy( worldPos ).sub( camera.position );
		if ( v.dot( camDir ) <= 0 ) return null;
		v.copy( worldPos ).project( camera );
		return { x: ( v.x + 1 ) / 2 * width, y: ( - v.y + 1 ) / 2 * height };

	};

	const matched = new Set();
	const walk = opts.includeInvisible ? 'traverse' : 'traverseVisible';

	scene[ walk ]( function ( obj ) {

		if ( ! obj.isMesh ) return;
		if ( obj.name && obj.name.startsWith( '__' ) ) return;

		// 1) Object centre.
		obj.getWorldPosition( center );
		let sp = projectToScreen( center );
		if ( sp && pointInPolygon( sp, poly ) ) { matched.add( obj ); return; }

		// 2) World-space bounding-box corners (covers large / off-centre meshes).
		box.setFromObject( obj );
		if ( box.isEmpty() ) return;

		const min = box.min, max = box.max;
		const xs = [ min.x, max.x ], ys = [ min.y, max.y ], zs = [ min.z, max.z ];

		for ( let ix = 0; ix < 2; ix ++ ) {

			for ( let iy = 0; iy < 2; iy ++ ) {

				for ( let iz = 0; iz < 2; iz ++ ) {

					corner.set( xs[ ix ], ys[ iy ], zs[ iz ] );
					sp = projectToScreen( corner );
					if ( sp && pointInPolygon( sp, poly ) ) { matched.add( obj ); return; }

				}

			}

		}

	} );

	const nodes = Array.from( matched );

	if ( opts.apply && editor.selector ) {

		editor.selector.select( null, false );
		for ( const obj of nodes ) editor.selector.select( obj, true );

	}

	return nodes;

}

// ── Register as an introspectable / AI-callable tool ──────────────────────────
registerOp( 'lasso', {
	description: 'Screen-space lasso select: returns a $S set of every mesh whose screen projection falls inside a polygon of viewport-pixel points. Chain ops: lasso([[x,y],…]).recolor("#f00").',
	params: { polygon: 'Array<[x,y]>  viewport pixels, origin top-left' },
	example: 'lasso([[20,20],[400,20],[400,300],[20,300]]).recolor("#ff0000")',
} );
