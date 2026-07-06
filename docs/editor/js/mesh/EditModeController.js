// ── EditModeController.js ─────────────────────────────────────────────────────
// Manages Edit Mode: enter / exit, visual overlay, sub-object picking, op dispatch.
//
// Usage:
//   const emc = new EditModeController(editor);
//   emc.enter(mesh)          // select a mesh then call this
//   emc.setMode('vertex')    // 'vertex' | 'edge' | 'face'
//   emc.runOp(fn)            // fn(editableMesh, selection) — auto wraps in command
//   emc.exit()               // bake back to BufferGeometry
//
// Keyboard shortcuts (active when edit mode is on):
//   Tab / Esc — exit edit mode
//   1     — vertex mode
//   2     — edge mode
//   3     — face mode
//   A     — select all / deselect all
// Drag the transform gizmo to move the current vertex / edge / face selection
// (translate, rotate, or scale) — the mesh itself no longer moves in edit mode.

import * as THREE from 'three';
import { EditableMesh } from './EditableMesh.js';
import { Selection }    from './Selection.js';
import { SetGeometryCommand } from '../commands/SetGeometryCommand.js';
import { PARAM_ORDER, PARAM_DEFAULTS } from '../scene/geometryParams.js';

// Edit-mode ops that are safe to record in a recipe (all others produce non-replayable geometry)
const RECIPE_OPS = new Set( [ 'extrude', 'inset', 'bevel', 'deleteFaces', 'weld', 'planarUV', 'boxUV' ] );

// Detect the primitive constructor entry from a geometry
function _primitiveEntry( geom ) {

	const type   = geom.type;
	const params = geom.parameters;
	const order  = PARAM_ORDER[ type ];

	if ( ! order || ! params ) return { op: 'primitive', type, args: [] };

	const defs = PARAM_DEFAULTS[ type ] || {};
	const args = order.map( k => {

		const v = params[ k ] ?? defs[ k ] ?? 0;
		return typeof v === 'number' ? Math.round( v * 1e5 ) / 1e5 : v;

	} );

	// Drop trailing values that equal the default
	while ( args.length > 1 ) {

		const last  = args[ args.length - 1 ];
		const defLast = defs[ order[ args.length - 1 ] ];
		if ( last === defLast ) args.pop(); else break;

	}

	return { op: 'primitive', type, args };

}

// Visual style constants
const VERT_COLOR     = 0xffffff;
const VERT_SEL_COLOR = 0xff8800;
const EDGE_COLOR     = 0x444488;
const EDGE_SEL_COLOR = 0x0088ff;
const FACE_SEL_COLOR = 0x0055ff;
const VERT_SIZE      = 4;

export class EditModeController {

	constructor( editor ) {

		this.editor        = editor;
		this.active        = false;
		this.mesh          = null;   // THREE.Mesh being edited
		this.em            = null;   // EditableMesh (half-edge)
		this.selection     = new Selection();
		this._overlay      = null;   // THREE.Group in sceneHelpers
		this._origSelect   = null;   // saved editor.selector.select
		this._keyHandler   = null;

		// Intercept intersectionsDetected for sub-object picking
		editor.signals.intersectionsDetected.add( ( intersects ) => {

			if ( ! this.active ) return;
			this._handleIntersections( intersects );

		} );

		// Keep the overlay aligned when the edited mesh is transformed (gizmo or a
		// position/rotation/scale command) — otherwise the handles drift away from
		// the real object until the next edit action.
		editor.signals.objectChanged.add( ( object ) => {

			if ( this.active && object === this.mesh ) this.updateOverlay();

		} );

	}

	// ── Public API ────────────────────────────────────────────────────────────

	enter( mesh ) {

		if ( this.active ) this.exit();
		if ( ! mesh || ! mesh.isMesh ) return;

		this.mesh      = mesh;
		this.em        = new EditableMesh().fromBufferGeometry( mesh.geometry );
		this.selection = new Selection();
		this.active    = true;

		// Initialise recipe with the primitive entry (preserves any existing recipe)
		if ( ! mesh.userData.recipe ) {

			mesh.userData.recipe = [ _primitiveEntry( mesh.geometry ) ];

		}

		// Block normal object selection while in edit mode
		this._origSelect = this.editor.selector.select.bind( this.editor.selector );
		this.editor.selector.select = () => {};

		this._buildOverlay();
		this._attachKeys();

		this.editor.signals.editModeChanged.dispatch( { active: true, mesh } );
		this._notifySelection();

	}

	exit() {

		if ( ! this.active ) return;

		// Bake geometry back — skip undo entry during recipe replay
		const newGeom = this.em.compact().toBufferGeometry();

		if ( this.mesh.userData._recipeReplay ) {

			this.mesh.geometry.dispose();
			this.mesh.geometry = newGeom;
			this.mesh.geometry.computeBoundingSphere();

		} else {

			this.editor.execute( new SetGeometryCommand( this.editor, this.mesh, newGeom ) );

		}

		// Restore normal object selection
		this.editor.selector.select = this._origSelect;
		this._origSelect = null;

		this._destroyOverlay();
		this._detachKeys();

		const mesh   = this.mesh;
		this.mesh    = null;
		this.em      = null;
		this.active  = false;

		this.editor.signals.editModeChanged.dispatch( { active: false, mesh } );

	}

	toggle( mesh ) {

		if ( this.active && this.mesh === mesh ) this.exit();
		else this.enter( mesh );

	}

	setMode( mode ) {

		this.selection.setMode( mode );
		this.updateOverlay();
		this.editor.signals.editModeChanged.dispatch( { active: true, mesh: this.mesh, mode } );
		this._notifySelection();

	}

	/**
	 * Run a modeling op inside edit mode.
	 * fn(editableMesh, selection) — mutates the EditableMesh.
	 * Emits a SetGeometryCommand so the op is undoable.
	 *
	 * @param {Function} fn        (em, sel) → void
	 * @param {string}   [opName]  name for recipe recording
	 * @param {object}   [params]  params for recipe recording
	 */
	runOp( fn, opName = null, params = {} ) {

		if ( ! this.active ) return;

		const isReplay = !! this.mesh.userData._recipeReplay;

		// Snapshot selection BEFORE running (IDs reference current EM state)
		const selSnapshot = ( opName && RECIPE_OPS.has( opName ) ) ? {
			mode: this.selection.mode,
			ids:  [ ...this.selection.ids ],
		} : null;

		fn( this.em, this.selection );

		// Bake: skip undo stack during replay to keep history clean
		const newGeom = this.em.compact().toBufferGeometry();

		if ( isReplay ) {

			this.mesh.geometry.dispose();
			this.mesh.geometry = newGeom;
			this.mesh.geometry.computeBoundingSphere();

		} else {

			this.editor.execute( new SetGeometryCommand( this.editor, this.mesh, newGeom ) );

		}

		this.em = new EditableMesh().fromBufferGeometry( this.mesh.geometry );
		this.selection.clear();
		this.updateOverlay();

		// Record to recipe (only during real edits, not replays)
		if ( opName && RECIPE_OPS.has( opName ) && ! isReplay ) {

			if ( ! this.mesh.userData.recipe ) this.mesh.userData.recipe = [];
			this.mesh.userData.recipe.push( { op: opName, params, selection: selSnapshot } );

		}

		this._notifySelection();

	}

	// ── Sub-object transform (viewport gizmo drags the SELECTION, not the mesh) ──
	// The Viewport attaches a TransformControls gizmo to a proxy placed at the
	// selection centroid and feeds us the drag delta so vertices move — the whole
	// object no longer moves in edit mode. Works in vertex / edge / face mode.

	// Vertex ids touched by the current selection, resolved per mode.
	affectedVertexIds() {

		const em = this.em, sel = this.selection, out = new Set();
		if ( ! em ) return out;

		if ( sel.mode === 'vertex' ) {

			for ( const vid of sel.vertices ) out.add( vid );

		} else if ( sel.mode === 'edge' ) {

			for ( const heId of sel.edges ) {

				const he = em.halfEdges[ heId ];
				if ( ! he ) continue;
				out.add( he.v );
				out.add( em.halfEdges[ he.next ].v );

			}

		} else {

			for ( const fid of sel.faces ) {

				for ( const v of em.faceVertices( fid ) ) out.add( v.id );

			}

		}

		return out;

	}

	// World-space centroid of the current selection (or null when empty).
	selectionCentroidWorld( target = new THREE.Vector3() ) {

		const ids = this.affectedVertexIds();
		if ( ! ids.size ) return null;

		target.set( 0, 0, 0 );
		const p = new THREE.Vector3();
		for ( const vid of ids ) {

			const v = this.em.vertices[ vid ];
			p.set( v.x, v.y, v.z );
			this.mesh.localToWorld( p );
			target.add( p );

		}

		return target.divideScalar( ids.size );

	}

	// Snapshot the world positions of the affected vertices before a drag.
	beginTransform() {

		this._dragStartWorld = new Map();
		if ( ! this.active ) return false;

		const p = new THREE.Vector3();
		for ( const vid of this.affectedVertexIds() ) {

			const v = this.em.vertices[ vid ];
			p.set( v.x, v.y, v.z );
			this.mesh.localToWorld( p );
			this._dragStartWorld.set( vid, p.clone() );

		}

		return this._dragStartWorld.size > 0;

	}

	// Apply the gizmo's world delta matrix to every affected vertex, then refresh
	// the overlay so the wireframe deforms live. The solid surface is baked on drop.
	applyTransform( deltaMatrix ) {

		if ( ! this._dragStartWorld ) return;

		const p = new THREE.Vector3();
		for ( const [ vid, startWorld ] of this._dragStartWorld ) {

			p.copy( startWorld ).applyMatrix4( deltaMatrix );
			this.mesh.worldToLocal( p );
			const v = this.em.vertices[ vid ];
			v.x = p.x; v.y = p.y; v.z = p.z;

		}

		this.updateOverlay();

	}

	// Bake the moved vertices into the mesh geometry as ONE undoable command. A
	// pure move keeps topology, so `em` and the selection stay valid for more drags.
	commitTransform() {

		if ( ! this._dragStartWorld ) return;
		this._dragStartWorld = null;

		const newGeom = this.em.toBufferGeometry();

		if ( this.mesh.userData._recipeReplay ) {

			this.mesh.geometry.dispose();
			this.mesh.geometry = newGeom;
			this.mesh.geometry.computeBoundingSphere();

		} else {

			this.editor.execute( new SetGeometryCommand( this.editor, this.mesh, newGeom ) );

		}

		this.updateOverlay();
		this._notifySelection();

	}

	// Tell the viewport the selection changed so it can reposition / hide the gizmo.
	_notifySelection() {

		if ( ! this.active ) return;
		const c = this.selectionCentroidWorld();
		this.editor.signals.subObjectSelected.dispatch( {
			mode: this.selection.mode,
			ids: [ ...this.selection.ids ],
			centroidWorld: c ? c.toArray() : null,
		} );

	}

	// ── Visual overlay ────────────────────────────────────────────────────────

	_buildOverlay() {

		this._overlay = new THREE.Group();
		this._overlay.name = '__editModeOverlay';
		this.editor.sceneHelpers.add( this._overlay );
		this.updateOverlay();

	}

	_destroyOverlay() {

		if ( this._overlay ) {

			this.editor.sceneHelpers.remove( this._overlay );
			this._overlay.traverse( c => {
				if ( c.geometry ) c.geometry.dispose();
				if ( c.material ) c.material.dispose();
			} );
			this._overlay = null;

		}

	}

	updateOverlay() {

		if ( ! this._overlay || ! this.em ) return;

		// Remove old children
		while ( this._overlay.children.length ) {

			const c = this._overlay.children[ 0 ];
			if ( c.geometry ) c.geometry.dispose();
			if ( c.material ) c.material.dispose();
			this._overlay.remove( c );

		}

		const em  = this.em;
		const sel = this.selection;

		// ── Edge lines ────────────────────────────────────────────────────────
		const edgePos = [];
		const edgeCol = [];

		for ( const [ heId ] of em.edges() ) {

			const he  = em.halfEdges[ heId ];
			const src = em.vertices[ he.v ];
			const dst = em.vertices[ em.halfEdges[ he.next ].v ];
			const isSel = sel.mode === 'edge' && ( sel.edges.has( heId ) || ( he.twin !== - 1 && sel.edges.has( he.twin ) ) );
			const col = isSel ? new THREE.Color( EDGE_SEL_COLOR ) : new THREE.Color( EDGE_COLOR );

			edgePos.push( src.x, src.y, src.z, dst.x, dst.y, dst.z );
			edgeCol.push( col.r, col.g, col.b, col.r, col.g, col.b );

		}

		const edgeGeo = new THREE.BufferGeometry();
		edgeGeo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( edgePos ), 3 ) );
		edgeGeo.setAttribute( 'color',    new THREE.BufferAttribute( new Float32Array( edgeCol ), 3 ) );
		const edgeMat = new THREE.LineBasicMaterial( { vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 } );
		this._overlay.add( new THREE.LineSegments( edgeGeo, edgeMat ) );

		// ── Vertex points ─────────────────────────────────────────────────────
		const vertPos = [];
		const vertCol = [];

		for ( const v of em.vertices ) {

			const isSel = sel.mode === 'vertex' && sel.vertices.has( v.id );
			const col = isSel ? new THREE.Color( VERT_SEL_COLOR ) : new THREE.Color( VERT_COLOR );
			vertPos.push( v.x, v.y, v.z );
			vertCol.push( col.r, col.g, col.b );

		}

		const vertGeo = new THREE.BufferGeometry();
		vertGeo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( vertPos ), 3 ) );
		vertGeo.setAttribute( 'color',    new THREE.BufferAttribute( new Float32Array( vertCol ), 3 ) );
		const vertMat = new THREE.PointsMaterial( { vertexColors: true, size: VERT_SIZE, sizeAttenuation: false, depthTest: false } );
		this._overlay.add( new THREE.Points( vertGeo, vertMat ) );

		// ── Selected face highlight ───────────────────────────────────────────
		if ( sel.mode === 'face' && sel.faces.size ) {

			const facePos = [];

			for ( const fid of sel.faces ) {

				for ( const v of em.faceVertices( fid ) ) facePos.push( v.x, v.y, v.z );

			}

			const faceGeo = new THREE.BufferGeometry();
			faceGeo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( facePos ), 3 ) );
			const faceMat = new THREE.MeshBasicMaterial( { color: FACE_SEL_COLOR, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide } );
			this._overlay.add( new THREE.Mesh( faceGeo, faceMat ) );

		}

		// Align the overlay with the mesh's WORLD transform. The overlay lives in
		// sceneHelpers (an identity-transform scene), and its vertices are the mesh's
		// LOCAL coordinates — so it must carry the mesh's full world matrix. Copying
		// only the mesh's LOCAL position/rotation/scale left the handles offset from
		// the real object whenever the mesh was nested in a Group (or under any
		// transformed ancestor). Decompose matrixWorld so nested meshes line up.
		this.mesh.updateWorldMatrix( true, false );
		this.mesh.matrixWorld.decompose( this._overlay.position, this._overlay.quaternion, this._overlay.scale );

		this.editor.signals.sceneRendered.dispatch();

	}

	// ── Picking ───────────────────────────────────────────────────────────────

	_handleIntersections( intersects ) {

		// Find first intersection with the edited mesh
		const hit = intersects.find( i => i.object === this.mesh );
		if ( ! hit ) { this.selection.clear(); this.updateOverlay(); return; }

		const mode = this.selection.mode;

		if ( mode === 'face' ) {

			const fid = hit.faceIndex;
			if ( fid !== undefined && this.em.faces[ fid ] ) this.selection.toggle( fid );

		} else if ( mode === 'vertex' ) {

			// Pick nearest vertex of the hit triangle to the ray
			const bc  = hit.barycoord;
			const hes = this.em.faceHalfEdges( hit.faceIndex );
			if ( hes.length === 3 && bc ) {

				const bary = [ bc.x, bc.y, bc.z ];
				const maxI = bary.indexOf( Math.max( ...bary ) );
				this.selection.toggle( hes[ maxI ].v );

			}

		} else if ( mode === 'edge' ) {

			// Pick nearest edge of the hit triangle to the camera ray
			const hes = this.em.faceHalfEdges( hit.faceIndex );
			if ( hes.length === 3 ) {

				// hit.point is WORLD space; EM vertices are LOCAL. Compare in the mesh's
				// local frame so transformed/nested meshes pick the right edge.
				const ray = this.mesh.worldToLocal( hit.point.clone() );
				let bestHe = hes[ 0 ], bestDist = Infinity;

				for ( const he of hes ) {

					const a = this.em.vertices[ he.v ];
					const b = this.em.vertices[ this.em.halfEdges[ he.next ].v ];
					const mid = new THREE.Vector3( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2, ( a.z + b.z ) / 2 );
					const d = mid.distanceToSquared( ray );
					if ( d < bestDist ) { bestDist = d; bestHe = he; }

				}

				const canonical = bestHe.twin !== - 1 ? Math.min( bestHe.id, bestHe.twin ) : bestHe.id;
				this.selection.toggle( canonical );

			}

		}

		this.updateOverlay();
		this._notifySelection();

	}

	// ── Keyboard shortcuts ────────────────────────────────────────────────────

	_attachKeys() {

		this._keyHandler = ( e ) => {

			if ( ! this.active ) return;
			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ) ) return;

			switch ( e.key ) {

				case 'Tab':      e.preventDefault(); this.exit(); break;
				case 'Escape':   e.preventDefault(); this.exit(); break;
				case '1':        this.setMode( 'vertex' ); break;
				case '2':        this.setMode( 'edge' );   break;
				case '3':        this.setMode( 'face' );   break;
				case 'a': case 'A':
					if ( this.selection.count ) this.selection.clear();
					else this.selection.selectAll( this.em );
					this.updateOverlay();
					this._notifySelection();
					break;

			}

		};

		document.addEventListener( 'keydown', this._keyHandler );

	}

	_detachKeys() {

		if ( this._keyHandler ) {

			document.removeEventListener( 'keydown', this._keyHandler );
			this._keyHandler = null;

		}

	}

}
