// ── Sidebar.Stencils.js ─────────────────────────────────────────────────────
// "Stencils" panel in the right sidebar. Replaces the old Add menubar: a
// palette of objects (Group, meshes, lights, cameras) that can be added to the
// scene either by clicking the row or by dragging it onto the viewport.
//
// Drag-and-drop: each row carries its stencil id on the custom dataTransfer
// type 'application/x-stencil'. A single document-level 'drop' listener looks
// the id up in the registry and runs its factory. The viewport's own file-drop
// handler (in index.html) ignores this type, just like it ignores Outliner
// 'text/plain' drops.

import * as THREE from 'three';

import { UIPanel, UIRow, UIText, UIHorizontalRule } from './libs/ui.js';

import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';

import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const DRAG_TYPE = 'application/x-stencil';

// Simple 24×24 line icons drawn with currentColor, so they inherit the row's
// text colour and theme. Keyed by stencil id (see addStencil calls below).

function svg( inner ) {

	return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

}

const ICONS = {

	// Group
	group: svg( '<rect x="3" y="3" width="12" height="12" rx="1"/><rect x="9" y="9" width="12" height="12" rx="1"/>' ),

	// Mesh
	box: svg( '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>' ),
	capsule: svg( '<rect x="8" y="2" width="8" height="20" rx="4"/>' ),
	circle: svg( '<circle cx="12" cy="12" r="9"/>' ),
	cylinder: svg( '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>' ),
	dodecahedron: svg( '<path d="M12 2l8.5 6.2-3.2 10H6.7L3.5 8.2z"/><path d="M12 8l3.3 2.4-1.3 3.9h-4l-1.3-3.9z"/>' ),
	icosahedron: svg( '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/><path d="M12 2v4m0 0l7 4m-7-4l-7 4m0 0v6l7 4 7-4v-6m-14 0l7 4 7-4"/>' ),
	lathe: svg( '<path d="M9 2c0 3-3 4-3 9s3 6 3 11M15 2c0 3 3 4 3 9s-3 6-3 11"/><path d="M9 2h6M9 22h6M6 11h12"/>' ),
	octahedron: svg( '<path d="M12 2l8 7-8 13-8-13z"/><path d="M4 9h16M12 2v20"/>' ),
	plane: svg( '<path d="M2 9l10-4 10 4-10 4z"/>' ),
	ring: svg( '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>' ),
	sphere: svg( '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="3.6" ry="9"/><path d="M3 12h18"/>' ),
	sprite: svg( '<rect x="4" y="4" width="16" height="16" rx="1.5"/><circle cx="9" cy="9" r="1.6"/><path d="M5 17l4.5-4.5L13 16l3-3 3 3"/>' ),
	tetrahedron: svg( '<path d="M12 3l9 16H3z"/><path d="M12 3v16"/>' ),
	text: svg( '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>' ),
	torus: svg( '<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="12" rx="3.2" ry="1.6"/>' ),
	torusknot: svg( '<path d="M9 5a5 7 0 0 0 0 14M15 5a5 7 0 0 1 0 14M5 9a7 5 0 0 0 14 0M5 15a7 5 0 0 1 14 0"/>' ),
	tube: svg( '<path d="M3 19C3 10 6 5 12 5s9 5 9 14"/><path d="M7 19c0-6 2-10 5-10s5 4 5 10"/>' ),

	// Light
	ambient: svg( '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" stroke-opacity=".4"/>' ),
	directional: svg( '<circle cx="7" cy="7" r="3"/><path d="M7 2v1.5M7 10.5V12M2 7h1.5M10.5 7H12M3.8 3.8l1 1M9.2 9.2l1 1M10.2 3.8l-1 1M4.8 9.2l-1 1"/><path d="M13 12l7 7M20 15v5h-5"/>' ),
	hemisphere: svg( '<path d="M21 16a9 9 0 0 0-18 0"/><path d="M2 16h20"/><path d="M12 3v4"/>' ),
	point: svg( '<circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M5.6 18.4l1.8-1.8"/>' ),
	spot: svg( '<circle cx="12" cy="4" r="2"/><path d="M10.3 5.5L5 19M13.7 5.5L19 19M5 19h14"/>' ),

	// Camera
	orthographic: svg( '<path d="M4 6h6v12H4z"/><path d="M10 6h10v12H10z"/>' ),
	perspective: svg( '<path d="M3 9.5h5v5H3z"/><path d="M8 4l13 3v10l-13 3z"/>' ),

};

// Adds an object via the undoable command, optionally at a drop position.
// When position is undefined (e.g. a click), the object keeps its default
// placement, preserving the old "Add" menu behaviour.

function addObject( editor, object, position ) {

	if ( position !== undefined ) object.position.copy( position );

	editor.execute( new AddObjectCommand( editor, object ) );

}

function SidebarStencils( editor ) {

	const strings = editor.strings;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	// id → factory. Shared by click and drop so both add the exact same object.
	const registry = new Map();

	// Box buttons flow inline and wrap inside a grid; each new section opens a
	// fresh grid so its items group together under the heading.
	let grid = null;

	function startGrid() {

		grid = document.createElement( 'div' );
		grid.style.display = 'flex';
		grid.style.flexWrap = 'wrap';
		grid.style.gap = '6px';
		grid.style.padding = '4px 0 12px';
		container.dom.appendChild( grid );

	}

	function addSection( label ) {

		const title = new UIText( label ).setTextTransform( 'uppercase' );
		title.setStyle( 'fontWeight', [ 'bold' ] );
		container.add( new UIRow().add( title ) );
		startGrid();

	}

	function addStencil( id, label, factory ) {

		registry.set( id, factory );

		if ( grid === null ) startGrid();

		const button = document.createElement( 'div' );
		button.title = label;
		button.draggable = true;
		button.style.display = 'inline-flex';
		button.style.flexDirection = 'column';
		button.style.alignItems = 'center';
		button.style.justifyContent = 'center';
		button.style.boxSizing = 'border-box';
		button.style.width = '64px';
		button.style.height = '64px';
		button.style.padding = '6px';
		button.style.border = '1px solid rgba(127,127,127,0.3)';
		button.style.borderRadius = '4px';
		button.style.cursor = 'grab';
		button.style.userSelect = 'none';

		const icon = document.createElement( 'span' );
		icon.innerHTML = ICONS[ id ] || '';
		const svgEl = icon.firstChild;
		if ( svgEl ) {

			svgEl.style.width = '28px';
			svgEl.style.height = '28px';
			svgEl.style.display = 'block';
			svgEl.style.opacity = '0.85';

		}

		button.appendChild( icon );

		const text = document.createElement( 'span' );
		text.textContent = label;
		text.style.marginTop = '5px';
		text.style.maxWidth = '100%';
		text.style.fontSize = '10px';
		text.style.lineHeight = '1.1';
		text.style.textAlign = 'center';
		text.style.whiteSpace = 'nowrap';
		text.style.overflow = 'hidden';
		text.style.textOverflow = 'ellipsis';
		button.appendChild( text );

		button.addEventListener( 'click', function () {

			factory( editor );

		} );

		button.addEventListener( 'dragstart', function ( event ) {

			event.dataTransfer.setData( DRAG_TYPE, id );
			event.dataTransfer.effectAllowed = 'copy';

		} );

		button.addEventListener( 'mouseenter', function () {

			button.style.background = 'rgba(127,127,127,0.15)';

		} );

		button.addEventListener( 'mouseleave', function () {

			button.style.background = '';

		} );

		grid.appendChild( button );

	}

	// ── How to use ──────────────────────────────────────────────────────────────

	const hint = new UIText( 'Drag a stencil into the viewport to drop it where you release — or click to add it at the origin.' ).setWidth( '100%' );
	hint.setStyle( 'fontSize', [ '11px' ] );
	hint.setStyle( 'opacity', [ '0.6' ] );
	hint.setStyle( 'lineHeight', [ '1.4' ] );
	container.add( new UIRow().add( hint ) );

	container.add( new UIHorizontalRule() );

	// ── Mesh ───────────────────────────────────────────────────────────────────

	addSection( strings.getKey( 'menubar/add/mesh' ) );

	addStencil( 'box', strings.getKey( 'menubar/add/mesh/box' ), function ( editor, position ) {

		const geometry = new THREE.BoxGeometry( 1, 1, 1, 1, 1, 1 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Box';
		addObject( editor, mesh, position );

	} );

	addStencil( 'capsule', strings.getKey( 'menubar/add/mesh/capsule' ), function ( editor, position ) {

		const geometry = new THREE.CapsuleGeometry( 1, 1, 4, 8, 1 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Capsule';
		addObject( editor, mesh, position );

	} );

	addStencil( 'circle', strings.getKey( 'menubar/add/mesh/circle' ), function ( editor, position ) {

		const geometry = new THREE.CircleGeometry( 1, 32, 0, Math.PI * 2 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Circle';
		addObject( editor, mesh, position );

	} );

	addStencil( 'cylinder', strings.getKey( 'menubar/add/mesh/cylinder' ), function ( editor, position ) {

		const geometry = new THREE.CylinderGeometry( 1, 1, 1, 32, 1, false, 0, Math.PI * 2 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Cylinder';
		addObject( editor, mesh, position );

	} );

	addStencil( 'dodecahedron', strings.getKey( 'menubar/add/mesh/dodecahedron' ), function ( editor, position ) {

		const geometry = new THREE.DodecahedronGeometry( 1, 0 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Dodecahedron';
		addObject( editor, mesh, position );

	} );

	addStencil( 'icosahedron', strings.getKey( 'menubar/add/mesh/icosahedron' ), function ( editor, position ) {

		const geometry = new THREE.IcosahedronGeometry( 1, 0 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Icosahedron';
		addObject( editor, mesh, position );

	} );

	addStencil( 'lathe', strings.getKey( 'menubar/add/mesh/lathe' ), function ( editor, position ) {

		const geometry = new THREE.LatheGeometry();
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { side: THREE.DoubleSide } ) );
		mesh.name = 'Lathe';
		addObject( editor, mesh, position );

	} );

	addStencil( 'octahedron', strings.getKey( 'menubar/add/mesh/octahedron' ), function ( editor, position ) {

		const geometry = new THREE.OctahedronGeometry( 1, 0 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Octahedron';
		addObject( editor, mesh, position );

	} );

	addStencil( 'plane', strings.getKey( 'menubar/add/mesh/plane' ), function ( editor, position ) {

		const geometry = new THREE.PlaneGeometry( 1, 1, 1, 1 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Plane';
		addObject( editor, mesh, position );

	} );

	addStencil( 'ring', strings.getKey( 'menubar/add/mesh/ring' ), function ( editor, position ) {

		const geometry = new THREE.RingGeometry( 0.5, 1, 32, 1, 0, Math.PI * 2 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Ring';
		addObject( editor, mesh, position );

	} );

	addStencil( 'sphere', strings.getKey( 'menubar/add/mesh/sphere' ), function ( editor, position ) {

		const geometry = new THREE.SphereGeometry( 1, 32, 16, 0, Math.PI * 2, 0, Math.PI );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Sphere';
		addObject( editor, mesh, position );

	} );

	addStencil( 'sprite', strings.getKey( 'menubar/add/mesh/sprite' ), function ( editor, position ) {

		const sprite = new THREE.Sprite( new THREE.SpriteMaterial() );
		sprite.name = 'Sprite';
		addObject( editor, sprite, position );

	} );

	addStencil( 'tetrahedron', strings.getKey( 'menubar/add/mesh/tetrahedron' ), function ( editor, position ) {

		const geometry = new THREE.TetrahedronGeometry( 1, 0 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Tetrahedron';
		addObject( editor, mesh, position );

	} );

	addStencil( 'text', strings.getKey( 'menubar/add/text' ), function ( editor, position ) {

		const loader = new FontLoader();
		loader.load( '../examples/fonts/helvetiker_bold.typeface.json', function ( font ) {

			const text = 'THREE.JS';

			const geometry = new TextGeometry( text, {
				text: text,
				font,
				size: 1,
				depth: 0.5,
				curveSegments: 4,

				bevelEnabled: false,
				bevelThickness: 0.1,
				bevelSize: 0.01,
				bevelOffset: 0,
				bevelSegments: 3

			} );

			const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
			mesh.name = 'Text';
			addObject( editor, mesh, position );

		} );

	} );

	addStencil( 'torus', strings.getKey( 'menubar/add/mesh/torus' ), function ( editor, position ) {

		const geometry = new THREE.TorusGeometry( 1, 0.4, 12, 48, Math.PI * 2 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Torus';
		addObject( editor, mesh, position );

	} );

	addStencil( 'torusknot', strings.getKey( 'menubar/add/mesh/torusknot' ), function ( editor, position ) {

		const geometry = new THREE.TorusKnotGeometry( 1, 0.4, 64, 8, 2, 3 );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'TorusKnot';
		addObject( editor, mesh, position );

	} );

	addStencil( 'tube', strings.getKey( 'menubar/add/mesh/tube' ), function ( editor, position ) {

		const path = new THREE.CatmullRomCurve3( [
			new THREE.Vector3( 2, 2, - 2 ),
			new THREE.Vector3( 2, - 2, - 0.6666666666666667 ),
			new THREE.Vector3( - 2, - 2, 0.6666666666666667 ),
			new THREE.Vector3( - 2, 2, 2 )
		] );

		const geometry = new THREE.TubeGeometry( path, 64, 1, 8, false );
		const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
		mesh.name = 'Tube';
		addObject( editor, mesh, position );

	} );

	container.add( new UIHorizontalRule() );

	// ── Light ──────────────────────────────────────────────────────────────────

	addSection( strings.getKey( 'menubar/add/light' ) );

	addStencil( 'ambient', strings.getKey( 'menubar/add/light/ambient' ), function ( editor, position ) {

		const light = new THREE.AmbientLight( 0x222222 );
		light.name = 'AmbientLight';
		addObject( editor, light, position );

	} );

	addStencil( 'directional', strings.getKey( 'menubar/add/light/directional' ), function ( editor, position ) {

		const light = new THREE.DirectionalLight( 0xffffff, 1 );
		light.name = 'DirectionalLight';
		light.target.name = 'DirectionalLight Target';
		if ( position !== undefined ) light.position.copy( position );
		else light.position.set( 5, 10, 7.5 );

		editor.execute( new MultiCmdsCommand( editor, [
			new AddObjectCommand( editor, light.target ),
			new AddObjectCommand( editor, light )
		] ) );

	} );

	addStencil( 'hemisphere', strings.getKey( 'menubar/add/light/hemisphere' ), function ( editor, position ) {

		const light = new THREE.HemisphereLight( 0x00aaff, 0xffaa00, 1 );
		light.name = 'HemisphereLight';
		light.position.set( 0, 10, 0 );
		addObject( editor, light, position );

	} );

	addStencil( 'point', strings.getKey( 'menubar/add/light/point' ), function ( editor, position ) {

		const light = new THREE.PointLight( 0xffffff, 1, 0 );
		light.name = 'PointLight';
		addObject( editor, light, position );

	} );

	addStencil( 'spot', strings.getKey( 'menubar/add/light/spot' ), function ( editor, position ) {

		const light = new THREE.SpotLight( 0xffffff, 1, 0, Math.PI * 0.1, 0 );
		light.name = 'SpotLight';
		light.target.name = 'SpotLight Target';
		if ( position !== undefined ) light.position.copy( position );
		else light.position.set( 5, 10, 7.5 );

		editor.execute( new MultiCmdsCommand( editor, [
			new AddObjectCommand( editor, light.target ),
			new AddObjectCommand( editor, light )
		] ) );

	} );

	container.add( new UIHorizontalRule() );

	// ── Camera ─────────────────────────────────────────────────────────────────

	addSection( strings.getKey( 'menubar/add/camera' ) );

	addStencil( 'orthographic', strings.getKey( 'menubar/add/camera/orthographic' ), function ( editor, position ) {

		const aspect = editor.camera.aspect;
		const camera = new THREE.OrthographicCamera( - aspect, aspect );
		camera.name = 'OrthographicCamera';
		addObject( editor, camera, position );

	} );

	addStencil( 'perspective', strings.getKey( 'menubar/add/camera/perspective' ), function ( editor, position ) {

		const camera = new THREE.PerspectiveCamera();
		camera.name = 'PerspectiveCamera';
		addObject( editor, camera, position );

	} );

	// ── Drop target ──────────────────────────────────────────────────────────────
	// Dropping a dragged stencil adds it to the scene at the point under the
	// mouse. Registers before index.html's file-drop listener (the sidebar is
	// built first), so stopImmediatePropagation keeps the file loader from
	// running on our empty payload.

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const groundPlane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );
	const planeHit = new THREE.Vector3();

	// World point under the drop, or undefined if the drop missed the viewport.
	function getDropPosition( event ) {

		const viewport = document.getElementById( 'viewport' );
		if ( viewport === null ) return undefined;

		const rect = viewport.getBoundingClientRect();

		if ( event.clientX < rect.left || event.clientX > rect.right ||
			event.clientY < rect.top || event.clientY > rect.bottom ) return undefined;

		const nx = ( event.clientX - rect.left ) / rect.width;
		const ny = ( event.clientY - rect.top ) / rect.height;

		// Prefer landing on existing scene geometry under the cursor.
		const intersects = editor.selector.getPointerIntersects( new THREE.Vector2( nx, ny ), editor.camera );
		if ( intersects.length > 0 ) return intersects[ 0 ].point.clone();

		// Otherwise fall back to the ground plane (y = 0).
		pointer.set( nx * 2 - 1, - ( ny * 2 ) + 1 );
		raycaster.setFromCamera( pointer, editor.camera );
		if ( raycaster.ray.intersectPlane( groundPlane, planeHit ) !== null ) return planeHit.clone();

		return undefined;

	}

	document.addEventListener( 'drop', function ( event ) {

		const id = event.dataTransfer.getData( DRAG_TYPE );
		if ( id === '' ) return;

		const factory = registry.get( id );
		if ( factory === undefined ) return;

		event.preventDefault();
		event.stopImmediatePropagation();

		factory( editor, getDropPosition( event ) );

	} );

	return container;

}

export { SidebarStencils };
