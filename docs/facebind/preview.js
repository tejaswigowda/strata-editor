// 3D preview of the bound VRM (and the base it came from), rendered on this device.
// The bytes never leave the page: GLTFLoader.parse reads the in-memory ArrayBuffer (textures become
// blob: URLs of in-memory data), and nothing here touches the network.
//
// The preview is flat (the VRM's unlit materials, no MToon shading). It shows the reshaped face and hair, the
// skin / hair / eye / brow colors, and lets you drive a few expressions through the bind map.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyFaceWeights } from '../editor/js/facebind/runtime.js';

// slider id -> the ARKit morphs it drives (names as in the face GLB / VRM)
export const EXPRESSIONS = {
	jawOpen: [ 'jawOpen' ],
	smile: [ 'mouthSmileLeft', 'mouthSmileRight' ],
	blink: [ 'eyeBlinkLeft', 'eyeBlinkRight' ],
	browsUp: [ 'browInnerUp' ],
};

export function createPreview( container ) {

	const renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( Math.min( 2, window.devicePixelRatio || 1 ) );
	container.appendChild( renderer.domElement );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x1b1e24 );
	const camera = new THREE.PerspectiveCamera( 30, 1, 0.01, 50 );
	const controls = new OrbitControls( camera, renderer.domElement );
	controls.enablePan = false;
	controls.enableDamping = false;

	const models = { base: null, bound: null };
	let view = 'bound', bind = null, weights = {}, disposed = false, raf = 0;

	const render = () => { raf = 0; if ( ! disposed ) renderer.render( scene, camera ); };
	const request = () => { if ( ! raf && ! disposed ) raf = requestAnimationFrame( render ); };
	controls.addEventListener( 'change', request );

	const resize = () => {

		const w = container.clientWidth || 480, h = container.clientHeight || 420;
		renderer.setSize( w, h, false );
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		request();

	};
	const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver( resize ) : null;
	if ( observer ) observer.observe( container ); else window.addEventListener( 'resize', resize );
	resize();

	function disposeModel( m ) {

		if ( ! m ) return;
		scene.remove( m );
		m.traverse( o => {

			if ( o.geometry ) o.geometry.dispose();
			for ( const mat of Array.isArray( o.material ) ? o.material : o.material ? [ o.material ] : [] ) {

				for ( const v of Object.values( mat ) ) if ( v && v.isTexture ) v.dispose();
				mat.dispose();

			}

		} );

	}

	async function load( bytes ) {

		const copy = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
		const gltf = await new GLTFLoader().parseAsync( copy, '' );
		const root = gltf.scene;
		if ( gltf.parser.json.extensions && gltf.parser.json.extensions.VRM ) root.rotation.y = Math.PI; // VRM 0.x faces -Z
		root.updateMatrixWorld( true );
		return root;

	}

	function setNamed( root, name, value ) {

		root.traverse( o => { if ( o.morphTargetDictionary && o.morphTargetDictionary[ name ] !== undefined ) o.morphTargetInfluences[ o.morphTargetDictionary[ name ] ] = value; } );

	}

	function applyWeights() {

		const named = {};
		for ( const [ k, v ] of Object.entries( weights ) ) for ( const n of EXPRESSIONS[ k ] || [] ) named[ n ] = v;
		if ( models.bound && bind ) applyFaceWeights( models.bound, named, { bind } ); // through the bind map
		if ( models.base ) for ( const [ n, v ] of Object.entries( named ) ) setNamed( models.base, n, v );
		request();

	}

	function frame( root ) {

		let face = null;
		root.traverse( o => { if ( ! face && o.isMesh && /^Face/.test( o.name ) ) face = o; } );
		const box = new THREE.Box3().setFromObject( face || root );
		const center = box.getCenter( new THREE.Vector3() ), size = box.getSize( new THREE.Vector3() );
		const dist = Math.max( size.y, size.x ) * 3.6;
		center.y += size.y * 0.15; // include the top of the hair
		camera.position.set( center.x, center.y, center.z + dist );
		controls.target.copy( center );
		controls.minDistance = dist * 0.4; controls.maxDistance = dist * 3;
		controls.update();

	}

	return {

		/** @param {{ base: Uint8Array, bound: Uint8Array, bind: object }} args */
		async show( { base, bound, bind: b } ) {

			disposeModel( models.base ); disposeModel( models.bound );
			models.base = await load( base ); models.bound = await load( bound );
			bind = b;
			scene.add( models.base, models.bound );
			this.setView( view );
			frame( models.bound );
			applyWeights();

		},

		setView( v ) {

			view = v;
			if ( models.base ) models.base.visible = v === 'base';
			if ( models.bound ) models.bound.visible = v === 'bound';
			request();

		},

		setExpression( key, value ) { weights[ key ] = value; applyWeights(); },

		resetExpressions() {

			weights = {};
			for ( const names of Object.values( EXPRESSIONS ) ) for ( const n of names ) { if ( models.bound ) setNamed( models.bound, n, 0 ); if ( models.base ) setNamed( models.base, n, 0 ); }
			request();

		},

		dispose() {

			disposed = true;
			disposeModel( models.base ); disposeModel( models.bound );
			if ( observer ) observer.disconnect(); else window.removeEventListener( 'resize', resize );
			controls.dispose(); renderer.dispose(); renderer.domElement.remove();

		},

	};

}
