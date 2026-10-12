// Photo -> face-blendshape GLB, entirely on this device.
//
// This is the "autorigger" from https://github.com/tejaswigowda/face-to-blendshape-3d (MIT, vendored
// in ./ as arkit-mapper.js, face-mesh-generator.js, face-mesh-triangulation.js, texture-mapper.js),
// driven by a MediaPipe Face Landmarker whose wasm and model are vendored in ../vendor/mediapipe/ and
// loaded with same-origin GETs. The photo is read from a local File / bitmap, decoded in memory and
// never sent anywhere: this module has no network code of its own, and the page's egress guard and
// Content-Security-Policy only allow same-origin GETs of the static files above.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { ARKitBlendshapeMapper } from './arkit-mapper.js';
import { FaceMeshGenerator } from './face-mesh-generator.js';
import { TextureMapper } from './texture-mapper.js';

const VENDOR = new URL( '../vendor/mediapipe/', import.meta.url ).href;

export class ImageError extends Error {

	constructor( code, message ) {

		super( message );
		this.code = code;

	}

}

let landmarker = null;

/** Load the on-device face model (static, same-origin; cached by the browser). Safe to call repeatedly. */
export function loadLandmarker() {

	if ( ! landmarker ) {

		landmarker = ( async () => {

			// CPU delegate: deterministic, and no GPU shader/driver variation between devices
			const vision = await FilesetResolver.forVisionTasks( VENDOR + 'wasm' );
			return FaceLandmarker.createFromOptions( vision, {
				baseOptions: { modelAssetPath: VENDOR + 'face_landmarker.task', delegate: 'CPU' },
				outputFaceBlendshapes: true,
				outputFacialTransformationMatrixes: true,
				runningMode: 'IMAGE',
				numFaces: 1,
			} );

		} )();
		landmarker.catch( () => { landmarker = null; } );

	}
	return landmarker;

}

async function toBitmap( image ) {

	if ( typeof image === 'string' || ( image && image.href ) ) throw new ImageError( 'IMAGE_MUST_BE_LOCAL', 'The photo must be a local file, never a URL.' );
	if ( typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ) return image;
	if ( typeof Blob !== 'undefined' && image instanceof Blob ) {

		try { return await createImageBitmap( image, { imageOrientation: 'from-image' } ); } catch ( e ) { throw new ImageError( 'BAD_IMAGE', 'Could not read that file as an image.' ); }

	}
	throw new ImageError( 'BAD_IMAGE', 'Expected an image file.' );

}

/**
 * @param {Blob|File|ImageBitmap} image a LOCAL photo of one face
 * @returns {Promise<{ glb: Uint8Array, blendshapes: Object<string, number>, skinColor: {r:number,g:number,b:number} }>}
 */
export async function faceGLBFromImage( image ) {

	const bitmap = await toBitmap( image );
	const lm = await loadLandmarker();

	const results = lm.detect( bitmap );
	if ( ! results.faceLandmarks || ! results.faceLandmarks.length ) throw new ImageError( 'NO_FACE_DETECTED', 'No face was detected in the photo. Use a clear, front-facing photo of one face.' );

	const landmarks = results.faceLandmarks[ 0 ];
	const categories = ( results.faceBlendshapes && results.faceBlendshapes[ 0 ] && results.faceBlendshapes[ 0 ].categories ) || [];
	const blendshapes = new ARKitBlendshapeMapper().mapMediaPipeToARKit( categories, landmarks );
	const transform = results.facialTransformationMatrixes && results.facialTransformationMatrixes[ 0 ];

	const texture = new TextureMapper().createFaceTexture( bitmap, landmarks );
	const generator = new FaceMeshGenerator();
	const mesh = generator.generateWithMorphTargets( landmarks, blendshapes, transform, texture );
	mesh.name = 'faceMesh';

	const group = new THREE.Group();
	group.add( mesh );
	const glb = await new Promise( ( resolve, reject ) => {

		new GLTFExporter().parse( group, r => r instanceof ArrayBuffer ? resolve( new Uint8Array( r ) ) : reject( new Error( 'GLB export did not return binary' ) ), reject,
			{ binary: true, maxTextureSize: 2048, embedImages: true, truncateDrawRange: false } );

	} );

	mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose();
	if ( bitmap.close && image !== bitmap ) bitmap.close();
	return { glb, blendshapes, skinColor: generator.skinColor };

}
