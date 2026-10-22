// glTF 1.0 → 2.0 upgrader. three's GLTFLoader only reads glTF 2.0, so legacy 1.0
// files (.gltf, and binary .glb with the KHR_binary_glTF container, version 1)
// are rewritten as an in-memory 2.0 GLB before parsing. Pure (no DOM / three).
//
// Geometry, nodes, skins, cameras and animations are converted losslessly.
// 1.0 materials are shader "techniques"; they are approximated as
// metal-rough PBR (diffuse → base colour, shininess → roughness, emission).

const GLB_MAGIC = 0x46546C67; // 'glTF'
const CHUNK_JSON = 0x4E4F534A;
const CHUNK_BIN = 0x004E4942;

const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const ATTRIBUTE_RENAMES = { COLOR: 'COLOR_0', JOINT: 'JOINTS_0', WEIGHT: 'WEIGHTS_0' };
const CULL_FACE = 2884;
const BLEND = 3042;

const UTF8 = new TextDecoder();

function isRecord( v ) {

	return v !== null && typeof v === 'object' && ! Array.isArray( v );

}

function parseJSON( text ) {

	try {

		return JSON.parse( text );

	} catch ( e ) {

		return null;

	}

}

/** Reads a binary glTF 1.0 container: { json, body } or null if it is not one. */
function readGLB1( buffer ) {

	if ( ! ( buffer instanceof ArrayBuffer ) || buffer.byteLength < 20 ) return null;

	const view = new DataView( buffer );
	if ( view.getUint32( 0, true ) !== GLB_MAGIC || view.getUint32( 4, true ) !== 1 ) return null;

	const contentOffset = 20;
	const contentLength = view.getUint32( 12, true );
	if ( contentOffset + contentLength > buffer.byteLength ) return null;

	const json = parseJSON( UTF8.decode( new Uint8Array( buffer, contentOffset, contentLength ) ) );
	if ( ! json ) return null;

	return { json, body: new Uint8Array( buffer, contentOffset + contentLength ) };

}

function isGLTF1Asset( json ) {

	return isRecord( json ) && isRecord( json.asset ) && /^1\./.test( String( json.asset.version ) );

}

/** True when `data` (ArrayBuffer GLB or glTF JSON text/ArrayBuffer) is glTF 1.0. */
function isGLTF1( data ) {

	if ( typeof data === 'string' ) return isGLTF1Asset( parseJSON( data ) );
	if ( ! ( data instanceof ArrayBuffer ) ) return false;
	if ( readGLB1( data ) ) return true;

	const view = new DataView( data );
	if ( data.byteLength >= 4 && view.getUint32( 0, true ) === GLB_MAGIC ) return false; // GLB 2.x
	return isGLTF1Asset( parseJSON( UTF8.decode( new Uint8Array( data ) ) ) );

}

// Ordered id list + id → index map for a 1.0 dictionary.
function indexDictionary( dict ) {

	const keys = isRecord( dict ) ? Object.keys( dict ) : [];
	const map = new Map();
	keys.forEach( ( key, i ) => map.set( key, i ) );
	return { keys, map };

}

function pad4( n ) {

	return ( n + 3 ) & ~ 3;

}

async function loadBuffers( json, glbBody, resolve ) {

	const loaded = new Map(); // buffer id → Uint8Array

	for ( const [ id, buffer ] of Object.entries( json.buffers || {} ) ) {

		if ( glbBody && id === 'binary_glTF' ) {

			loaded.set( id, glbBody );
			continue;

		}

		const uri = buffer.uri;
		if ( ! uri || uri === 'data:,' ) {

			if ( glbBody ) loaded.set( id, glbBody );
			continue;

		}

		const response = await fetch( resolve ? resolve( uri ) : uri );
		if ( ! response.ok ) throw new Error( 'glTF 1.0: failed to load buffer "' + uri + '"' );
		loaded.set( id, new Uint8Array( await response.arrayBuffer() ) );

	}

	return loaded;

}

function convertMaterial( id, material, json, textureIndex ) {

	const common = material.extensions && material.extensions.KHR_materials_common;
	const technique = json.techniques && json.techniques[ material.technique ];

	// Technique parameter defaults first, then the material's own values.
	const values = {};

	if ( technique && isRecord( technique.parameters ) ) {

		for ( const [ name, p ] of Object.entries( technique.parameters ) ) {

			if ( p && p.value !== undefined ) values[ name ] = p.value;

		}

	}

	Object.assign( values, common && common.values, material.values );

	const colorOf = ( v ) => Array.isArray( v ) ? v : null;
	const textureOf = ( v ) => typeof v === 'string' && textureIndex.has( v ) ? textureIndex.get( v ) : undefined;

	const out = { name: material.name || id, pbrMetallicRoughness: { metallicFactor: 0 } };
	const pbr = out.pbrMetallicRoughness;

	const diffuse = values.diffuse !== undefined ? values.diffuse : values.baseColor;
	const diffuseTexture = textureOf( diffuse );
	const diffuseColor = colorOf( diffuse );

	const baseColor = [ 1, 1, 1, 1 ];
	if ( diffuseColor ) for ( let i = 0; i < 4; i ++ ) baseColor[ i ] = diffuseColor[ i ] ?? 1;
	if ( diffuseTexture !== undefined ) pbr.baseColorTexture = { index: diffuseTexture };

	let alpha = baseColor[ 3 ];
	if ( typeof values.transparency === 'number' ) alpha *= values.transparency;
	baseColor[ 3 ] = alpha;
	pbr.baseColorFactor = baseColor;

	const shininess = typeof values.shininess === 'number' ? values.shininess : undefined;
	// Blinn-Phong exponent → roughness
	pbr.roughnessFactor = shininess !== undefined ? Math.min( 1, Math.sqrt( 2 / ( shininess + 2 ) ) ) : 1;

	const emission = values.emission;
	const emissionTexture = textureOf( emission );
	const emissionColor = colorOf( emission );
	if ( emissionTexture !== undefined ) {

		out.emissiveTexture = { index: emissionTexture };
		out.emissiveFactor = [ 1, 1, 1 ];

	} else if ( emissionColor && ( emissionColor[ 0 ] || emissionColor[ 1 ] || emissionColor[ 2 ] ) ) {

		out.emissiveFactor = emissionColor.slice( 0, 3 );

	}

	const enable = ( technique && technique.states && technique.states.enable ) || [];
	if ( alpha < 1 || enable.includes( BLEND ) ) out.alphaMode = 'BLEND';

	out.doubleSided = technique ? ! enable.includes( CULL_FACE ) : ( common ? common.doubleSided === true : false );

	return out;

}

/**
 * Converts glTF 1.0 JSON + buffers into a glTF 2.0 GLB.
 * @param {object} json parsed glTF 1.0
 * @param {Map<string, Uint8Array>} buffers buffer id → bytes
 * @returns {ArrayBuffer}
 */
function convert( json, buffers ) {

	const out = { asset: { version: '2.0', generator: 'Strata glTF 1.0 upgrader' } };

	// ---- single merged binary buffer --------------------------------------
	const bufferOffsets = new Map();
	let total = 0;

	for ( const [ id, bytes ] of buffers ) {

		bufferOffsets.set( id, total );
		total += pad4( bytes.byteLength );

	}

	// Data the upgrader rewrites (joint indices, bind-shape-baked matrices) is appended after the source buffers.
	const extraParts = [];
	let extraSize = 0;

	const appendData = ( bytes ) => {

		const offset = total + extraSize;
		extraParts.push( { offset, bytes } );
		extraSize += pad4( bytes.byteLength );
		return offset;

	};

	const readElements = ( a ) => {

		const view = json.bufferViews[ a.bufferView ];
		const bytes = view && buffers.get( view.buffer );
		const size = COMPONENT_SIZE[ a.componentType ];
		const n = TYPE_SIZE[ a.type ];
		if ( ! bytes || ! size || ! n ) return null;

		const stride = a.byteStride || size * n;
		const dv = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
		const base = ( view.byteOffset || 0 ) + ( a.byteOffset || 0 );
		const read = {
			5120: ( o ) => dv.getInt8( o ),
			5121: ( o ) => dv.getUint8( o ),
			5122: ( o ) => dv.getInt16( o, true ),
			5123: ( o ) => dv.getUint16( o, true ),
			5125: ( o ) => dv.getUint32( o, true ),
			5126: ( o ) => dv.getFloat32( o, true )
		}[ a.componentType ];

		const values = new Float64Array( a.count * n );

		for ( let i = 0; i < a.count; i ++ ) {

			for ( let c = 0; c < n; c ++ ) values[ i * n + c ] = read( base + i * stride + c * size );

		}

		return values;

	};

	// ---- buffer views & accessors -----------------------------------------
	const outViews = [];
	const viewCache = new Map();

	const makeView = ( viewId, stride, target, role = '' ) => {

		const key = viewId + '\u0000' + stride + '\u0000' + target + '\u0000' + role;
		if ( viewCache.has( key ) ) return viewCache.get( key );

		const view = json.bufferViews[ viewId ];
		const offset = ( bufferOffsets.get( view.buffer ) ?? 0 ) + ( view.byteOffset || 0 );
		const outView = { buffer: 0, byteOffset: offset, byteLength: view.byteLength };
		if ( target ) outView.target = target;
		if ( stride ) outView.byteStride = stride;

		outViews.push( outView );
		viewCache.set( key, outViews.length - 1 );
		return outViews.length - 1;

	};

	const makeAppendedView = ( bytes, target ) => {

		outViews.push( { buffer: 0, byteOffset: appendData( bytes ), byteLength: bytes.byteLength, ...( target ? { target } : {} ) } );
		return outViews.length - 1;

	};

	const accessors = indexDictionary( json.accessors );

	// Roles decide the 2.0 bufferView target and which data must be rewritten.
	const indexAccessors = new Set();
	const attributeAccessors = new Set();
	const jointAccessors = new Set();
	const positionAccessors = new Set();
	const weightAccessors = new Set();
	const timeAccessors = new Set();
	const ibmAccessors = new Set( Object.values( json.skins || {} ).map( ( skin ) => skin.inverseBindMatrices ) );

	for ( const mesh of Object.values( json.meshes || {} ) ) {

		for ( const p of mesh.primitives || [] ) {

			if ( p.indices !== undefined ) indexAccessors.add( p.indices );

			for ( const [ name, accessorId ] of Object.entries( p.attributes || {} ) ) {

				attributeAccessors.add( accessorId );
				if ( name === 'JOINT' || name.startsWith( 'JOINT_' ) ) jointAccessors.add( accessorId );
				if ( name === 'WEIGHT' || name.startsWith( 'WEIGHT_' ) ) weightAccessors.add( accessorId );
				if ( name === 'POSITION' ) positionAccessors.add( accessorId );

			}

		}

	}

	for ( const a of Object.values( json.animations || {} ) ) {

		for ( const sampler of Object.values( a.samplers || {} ) ) timeAccessors.add( a.parameters && a.parameters[ sampler.input ] );

	}

	const boundsOf = ( values, n ) => {

		const min = new Array( n ).fill( Infinity );
		const max = new Array( n ).fill( - Infinity );

		for ( let i = 0; i < values.length; i ++ ) {

			const c = i % n;
			if ( values[ i ] < min[ c ] ) min[ c ] = values[ i ];
			if ( values[ i ] > max[ c ] ) max[ c ] = values[ i ];

		}

		return values.length ? { min, max } : null;

	};

	const outAccessors = accessors.keys.map( ( id ) => {

		const a = json.accessors[ id ];
		const n = TYPE_SIZE[ a.type ] || 1;
		const elementSize = n * ( COMPONENT_SIZE[ a.componentType ] || 4 );
		const accessor = { componentType: a.componentType, count: a.count, type: a.type };

		// 1.0 joint indices may be floats; 2.0 requires unsigned integers.
		if ( jointAccessors.has( id ) && a.componentType === 5126 ) {

			const values = readElements( a );
			const joints = new Uint16Array( values ? values.length : 0 );
			if ( values ) values.forEach( ( v, i ) => joints[ i ] = Math.round( v ) );

			accessor.bufferView = makeAppendedView( new Uint8Array( joints.buffer ), 34962 );
			accessor.componentType = 5123;
			return accessor;

		}

		// 1.0 skin weights often do not sum to 1.
		if ( weightAccessors.has( id ) && a.componentType === 5126 ) {

			const values = readElements( a );

			if ( values ) {

				const weights = new Float32Array( values.length );

				for ( let i = 0; i < values.length; i += n ) {

					let sum = 0;
					for ( let c = 0; c < n; c ++ ) sum += values[ i + c ];
					for ( let c = 0; c < n; c ++ ) weights[ i + c ] = sum > 0 ? values[ i + c ] / sum : values[ i + c ];

				}

				accessor.bufferView = makeAppendedView( new Uint8Array( weights.buffer ), 34962 );
				return accessor;

			}

		}

		let target = 0;
		if ( indexAccessors.has( id ) ) target = 34963;
		else if ( attributeAccessors.has( id ) ) target = 34962;

		// 2.0 only allows 4-byte-aligned strides, and only on vertex-attribute views
		const stride = target === 34962 && ( a.byteStride || elementSize ) % 4 === 0 ? ( a.byteStride || elementSize ) : 0;
		accessor.bufferView = makeView( a.bufferView, stride, target, ibmAccessors.has( id ) ? 'ibm' : '' );
		accessor.byteOffset = a.byteOffset || 0;

		// Declared bounds are unreliable in 1.0 exports; only POSITION and animation
		// input (required by 2.0) are recomputed from the data.
		if ( positionAccessors.has( id ) || timeAccessors.has( id ) ) {

			const values = readElements( a );
			const bounds = values && boundsOf( values, n );
			if ( bounds ) Object.assign( accessor, bounds );
			else if ( a.min && a.max ) Object.assign( accessor, { min: a.min, max: a.max } );

		}

		return accessor;

	} );

	// ---- images / samplers / textures -------------------------------------
	const images = indexDictionary( json.images );
	const outImages = images.keys.map( ( id ) => {

		const image = json.images[ id ];
		const binary = image.extensions && image.extensions.KHR_binary_glTF;
		const outImage = {};
		if ( image.name ) outImage.name = image.name;

		if ( binary && binary.bufferView !== undefined ) {

			outImage.bufferView = makeView( binary.bufferView, 0, 0 );
			outImage.mimeType = binary.mimeType || 'image/png';

		} else {

			outImage.uri = image.uri;

		}

		return outImage;

	} );

	const samplers = indexDictionary( json.samplers );
	const outSamplers = samplers.keys.map( ( id ) => {

		const { magFilter, minFilter, wrapS, wrapT } = json.samplers[ id ];
		const sampler = {};
		if ( magFilter ) sampler.magFilter = magFilter;
		if ( minFilter ) sampler.minFilter = minFilter;
		if ( wrapS ) sampler.wrapS = wrapS;
		if ( wrapT ) sampler.wrapT = wrapT;
		return sampler;

	} );

	const textures = indexDictionary( json.textures );
	const outTextures = textures.keys.map( ( id ) => {

		const t = json.textures[ id ];
		const texture = { source: images.map.get( t.source ) };
		if ( t.sampler !== undefined && samplers.map.has( t.sampler ) ) texture.sampler = samplers.map.get( t.sampler );
		return texture;

	} );

	// ---- materials ---------------------------------------------------------
	const materials = indexDictionary( json.materials );
	const outMaterials = materials.keys.map( ( id ) => convertMaterial( id, json.materials[ id ], json, textures.map ) );

	// ---- meshes ------------------------------------------------------------
	const meshes = indexDictionary( json.meshes );
	const outMeshes = meshes.keys.map( ( id ) => {

		const mesh = json.meshes[ id ];
		const outMesh = { primitives: ( mesh.primitives || [] ).map( ( p ) => {

			const attributes = {};

			for ( const [ name, accessorId ] of Object.entries( p.attributes || {} ) ) {

				attributes[ ATTRIBUTE_RENAMES[ name ] || name ] = accessors.map.get( accessorId );

			}

			const primitive = { attributes, mode: p.mode !== undefined ? p.mode : 4 };
			if ( p.indices !== undefined ) primitive.indices = accessors.map.get( p.indices );
			if ( p.material !== undefined && materials.map.has( p.material ) ) primitive.material = materials.map.get( p.material );
			return primitive;

		} ) };
		if ( mesh.name ) outMesh.name = mesh.name;
		return outMesh;

	} );

	// ---- cameras -----------------------------------------------------------
	const cameras = indexDictionary( json.cameras );
	const outCameras = cameras.keys.map( ( id ) => {

		const c = json.cameras[ id ];
		const camera = { type: c.type };
		if ( c.name ) camera.name = c.name;

		if ( c.type === 'orthographic' ) {

			camera.orthographic = { xmag: c.orthographic.xmag, ymag: c.orthographic.ymag, znear: c.orthographic.znear, zfar: c.orthographic.zfar };

		} else {

			const p = c.perspective || {};
			camera.perspective = { yfov: p.yfov, znear: p.znear };
			if ( p.aspect_ratio ) camera.perspective.aspectRatio = p.aspect_ratio;
			if ( p.zfar ) camera.perspective.zfar = p.zfar;

		}

		return camera;

	} );

	// ---- nodes (a 1.0 node may reference several meshes) -------------------
	const nodes = indexDictionary( json.nodes );
	const outNodes = nodes.keys.map( ( id ) => {

		const n = json.nodes[ id ];
		const node = {};
		if ( n.name ) node.name = n.name;
		if ( n.matrix && n.matrix.some( ( v, i ) => v !== ( i % 5 === 0 ? 1 : 0 ) ) ) node.matrix = n.matrix;
		if ( n.translation ) node.translation = n.translation;
		if ( n.rotation ) node.rotation = n.rotation;
		if ( n.scale ) node.scale = n.scale;
		if ( n.children && n.children.length ) node.children = n.children.map( ( c ) => nodes.map.get( c ) ).filter( ( c ) => c !== undefined );
		if ( n.camera !== undefined && cameras.map.has( n.camera ) ) node.camera = cameras.map.get( n.camera );
		return node;

	} );

	const skins = indexDictionary( json.skins );
	const jointNodes = new Map(); // jointName → node index
	nodes.keys.forEach( ( id, i ) => {

		const jointName = json.nodes[ id ].jointName;
		if ( jointName ) jointNodes.set( jointName, i );

	} );

	const outSkins = skins.keys.map( ( id ) => {

		const s = json.skins[ id ];
		const skin = { joints: ( s.jointNames || [] ).map( ( name ) => jointNodes.get( name ) ).filter( ( j ) => j !== undefined ) };
		if ( s.inverseBindMatrices !== undefined ) skin.inverseBindMatrices = accessors.map.get( s.inverseBindMatrices );
		if ( s.name ) skin.name = s.name;

		// bindShapeMatrix has no 2.0 equivalent: bake it into the inverse bind matrices (IBM' = IBM · BSM).
		const shape = s.bindShapeMatrix;
		const ibm = s.inverseBindMatrices !== undefined ? json.accessors[ s.inverseBindMatrices ] : null;
		const values = shape && shape.some( ( v, i ) => v !== ( i % 5 === 0 ? 1 : 0 ) ) && ibm ? readElements( ibm ) : null;

		if ( values ) {

			const baked = new Float32Array( values.length );

			for ( let m = 0; m < values.length; m += 16 ) {

				for ( let col = 0; col < 4; col ++ ) {

					for ( let row = 0; row < 4; row ++ ) {

						let sum = 0;
						for ( let k = 0; k < 4; k ++ ) sum += values[ m + k * 4 + row ] * shape[ col * 4 + k ];
						baked[ m + col * 4 + row ] = sum;

					}

				}

			}

			outAccessors.push( { bufferView: makeAppendedView( new Uint8Array( baked.buffer ), 0 ), componentType: 5126, count: ibm.count, type: 'MAT4' } );
			skin.inverseBindMatrices = outAccessors.length - 1;

		}

		return skin;

	} );

	nodes.keys.forEach( ( id, i ) => {

		const n = json.nodes[ id ];
		const meshIds = ( n.meshes || [] ).filter( ( m ) => meshes.map.has( m ) );
		const skin = n.skin !== undefined && skins.map.has( n.skin ) ? skins.map.get( n.skin ) : undefined;

		const attach = ( target, meshId ) => {

			target.mesh = meshes.map.get( meshId );
			if ( skin !== undefined ) target.skin = skin;

		};

		if ( meshIds.length === 1 ) {

			attach( outNodes[ i ], meshIds[ 0 ] );

		} else if ( meshIds.length > 1 ) {

			outNodes[ i ].children = outNodes[ i ].children || [];

			for ( const meshId of meshIds ) {

				const child = { name: ( n.name || id ) + '_' + meshId };
				attach( child, meshId );
				outNodes.push( child );
				outNodes[ i ].children.push( outNodes.length - 1 );

			}

		}

	} );

	// ---- scenes ------------------------------------------------------------
	const scenes = indexDictionary( json.scenes );
	const outScenes = scenes.keys.map( ( id ) => ( {
		name: id,
		nodes: ( json.scenes[ id ].nodes || [] ).map( ( n ) => nodes.map.get( n ) ).filter( ( n ) => n !== undefined )
	} ) );

	// ---- animations --------------------------------------------------------
	const outAnimations = [];

	for ( const [ id, a ] of Object.entries( json.animations || {} ) ) {

		const samplerIndex = new Map();
		const animation = { name: a.name || id, channels: [], samplers: [] };

		for ( const channel of a.channels || [] ) {

			const sampler = a.samplers && a.samplers[ channel.sampler ];
			const nodeIndex = nodes.map.get( channel.target && channel.target.id );
			if ( ! sampler || nodeIndex === undefined ) continue;

			if ( ! samplerIndex.has( channel.sampler ) ) {

				const input = accessors.map.get( a.parameters[ sampler.input ] );
				const output = accessors.map.get( a.parameters[ sampler.output ] );
				if ( input === undefined || output === undefined ) continue;

				animation.samplers.push( { input, output, interpolation: sampler.interpolation || 'LINEAR' } );
				samplerIndex.set( channel.sampler, animation.samplers.length - 1 );

			}

			animation.channels.push( { sampler: samplerIndex.get( channel.sampler ), target: { node: nodeIndex, path: channel.target.path } } );

		}

		if ( animation.channels.length ) outAnimations.push( animation );

	}

	// ---- assemble ----------------------------------------------------------
	const bin = new Uint8Array( total + extraSize );

	for ( const [ id, bytes ] of buffers ) bin.set( bytes, bufferOffsets.get( id ) );
	for ( const part of extraParts ) bin.set( part.bytes, part.offset );

	out.buffers = [ { byteLength: bin.byteLength } ];
	out.bufferViews = outViews;
	out.accessors = outAccessors;
	if ( outImages.length ) out.images = outImages;
	if ( outSamplers.length ) out.samplers = outSamplers;
	if ( outTextures.length ) out.textures = outTextures;
	if ( outMaterials.length ) out.materials = outMaterials;
	out.meshes = outMeshes;
	if ( outCameras.length ) out.cameras = outCameras;
	out.nodes = outNodes;
	if ( outSkins.length ) out.skins = outSkins;
	out.scenes = outScenes;
	out.scene = json.scene !== undefined && scenes.map.has( json.scene ) ? scenes.map.get( json.scene ) : 0;
	if ( outAnimations.length ) out.animations = outAnimations;

	return writeGLB2( out, bin );

}

function writeGLB2( json, bin ) {

	const jsonBytes = new TextEncoder().encode( JSON.stringify( json ) );
	const jsonLength = pad4( jsonBytes.byteLength );
	const binLength = pad4( bin.byteLength );
	const total = 12 + 8 + jsonLength + ( binLength ? 8 + binLength : 0 );

	const out = new Uint8Array( total );
	const view = new DataView( out.buffer );

	view.setUint32( 0, GLB_MAGIC, true );
	view.setUint32( 4, 2, true );
	view.setUint32( 8, total, true );

	view.setUint32( 12, jsonLength, true );
	view.setUint32( 16, CHUNK_JSON, true );
	out.fill( 0x20, 20, 20 + jsonLength ); // JSON chunks are space-padded
	out.set( jsonBytes, 20 );

	if ( binLength ) {

		const binStart = 20 + jsonLength;
		view.setUint32( binStart, binLength, true );
		view.setUint32( binStart + 4, CHUNK_BIN, true );
		out.set( bin, binStart + 8 );

	}

	return out.buffer;

}

/**
 * Upgrades glTF 1.0 data to a glTF 2.0 GLB ArrayBuffer; returns `data` untouched
 * when it is not glTF 1.0. `resolve(uri)` maps relative buffer URIs (e.g. a
 * LoadingManager's resolveURL) for .gltf files with external .bin files.
 * @param {ArrayBuffer|string} data
 * @param {(uri: string) => string} [resolve]
 * @returns {Promise<ArrayBuffer|string>}
 */
async function upgradeGLTF1( data, resolve ) {

	if ( ! isGLTF1( data ) ) return data;

	let json, body = null;
	const glb = data instanceof ArrayBuffer ? readGLB1( data ) : null;

	if ( glb ) {

		json = glb.json;
		body = glb.body;

	} else {

		json = typeof data === 'string' ? parseJSON( data ) : parseJSON( UTF8.decode( new Uint8Array( data ) ) );

	}

	const buffers = await loadBuffers( json, body, resolve );
	return convert( json, buffers );

}

export { upgradeGLTF1, isGLTF1 };
