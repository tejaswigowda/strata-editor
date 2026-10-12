import { bindVRM, skinTextureOf, SCOPE } from '../editor/js/facebind/bind.js';

// ── pure transform: (base VRM = url | local file, face GLB = LOCAL file only) -> bound VRM ──
// window.__facebind.run({ vrm, image | face, tint })  -> window.__webcli_result
// The starting point is a photo: image -> on-device face landmarks -> face-blendshape GLB -> bind.
// `face` (an existing face GLB) skips the photo step.
// ?vrm=male|female|<url>&run=1   auto-runs as soon as a photo (or face GLB) is supplied from local disk.
// The base VRM defaults to the bundled male model; 'male' / 'female' select the bundled bases.
// The photo and the face GLB are identity data and are never URLs: `image=` / `face=` parameters are
// refused, and a string passed as `image` or `face` is rejected.

export const DEFAULT_BASES = {
	male: 'base/VRoid_V110_Male_v1.1.3.vrm',
	female: 'base/VRoid_V110_Female_v1.1.3.vrm',
};

// The photo pipeline (three.js + MediaPipe) loads in the background; binding an existing face GLB never waits on it.
const autorig = import( './autorig/faceFromImage.js' );
autorig.catch( e => console.warn( 'facebind: photo pipeline unavailable', e ) );

const $ = id => document.getElementById( id );
const params = new URLSearchParams( location.search );

const say = ( text, cls = '' ) => { const el = $( 'status' ); el.textContent = text; el.className = cls; };
const fileBase = name => String( name || 'avatar' ).split( /[\\/]/ ).pop().replace( /\?.*$/, '' ).replace( /\.(vrm|glb)$/i, '' );

async function readBytes( src, label ) {

	if ( src instanceof Uint8Array ) return src;
	if ( src instanceof ArrayBuffer ) return new Uint8Array( src );
	if ( typeof Blob !== 'undefined' && src instanceof Blob ) return new Uint8Array( await src.arrayBuffer() );
	throw Object.assign( new Error( `${ label }: expected a local file or bytes` ), { code: 'BAD_INPUT' } );

}

async function meanOpaqueRGB( bytes, mime ) {

	const bmp = await createImageBitmap( new Blob( [ bytes ], { type: mime } ) );
	const c = document.createElement( 'canvas' ); c.width = c.height = 64;
	const ctx = c.getContext( '2d', { willReadFrequently: true } );
	ctx.drawImage( bmp, 0, 0, 64, 64 );
	const d = ctx.getImageData( 0, 0, 64, 64 ).data;
	let n = 0; const s = [ 0, 0, 0 ];
	for ( let i = 0; i < d.length; i += 4 ) if ( d[ i + 3 ] > 200 ) { s[ 0 ] += d[ i ]; s[ 1 ] += d[ i + 1 ]; s[ 2 ] += d[ i + 2 ]; n ++; }
	return n ? s.map( v => v / n ) : null;

}

async function run( { vrm, image, face, tint = false, names } ) {

	try {

		for ( const [ label, v, code ] of [ [ 'photo', image, 'IMAGE_MUST_BE_LOCAL' ], [ 'face GLB', face, 'FACE_MUST_BE_LOCAL' ] ] ) {

			if ( typeof v === 'string' || ( v && v.href ) ) throw Object.assign( new Error( `The ${ label } must be a local file or bytes, never a URL (it is identity data and must not be fetched or sent anywhere).` ), { code } );

		}
		if ( ! image && ! face ) throw Object.assign( new Error( 'Choose a photo of a face (or a face-blendshape GLB) from local disk.' ), { code: 'NO_FACE' } );

		say( 'Binding on this device…' );
		vrm = vrm || 'male';
		if ( typeof vrm === 'string' && DEFAULT_BASES[ vrm ] ) vrm = DEFAULT_BASES[ vrm ];
		let vrmBytes, vrmName;
		if ( typeof vrm === 'string' ) {

			const res = await fetch( vrm ); // GET, audited by egressGuard.js
			if ( ! res.ok ) throw Object.assign( new Error( `Could not GET the base VRM (${ res.status }).` ), { code: 'VRM_FETCH' } );
			vrmBytes = new Uint8Array( await res.arrayBuffer() ); vrmName = fileBase( new URL( vrm, location.href ).pathname );

		} else { vrmBytes = await readBytes( vrm, 'base VRM' ); vrmName = fileBase( vrm.name ); }
		let faceBytes, faceGlbUrl = null;
		if ( image ) {

			say( 'Reading the face on this device…' );
			const { glb } = await ( await autorig ).faceGLBFromImage( image );
			faceBytes = glb;
			faceGlbUrl = URL.createObjectURL( new Blob( [ glb ], { type: 'model/gltf-binary' } ) );
			const f = $( 'faceGlbLink' ); f.href = faceGlbUrl; f.download = 'face-model-blendshapes.glb'; f.hidden = false;

		} else faceBytes = await readBytes( face, 'face GLB' );

		const opts = { names };
		if ( tint ) {

			const tex = skinTextureOf( vrmBytes );
			opts.tint = { strength: 0.5, vrmSkinTextureRGB: tex ? await meanOpaqueRGB( tex.bytes, tex.mime ) : null };

		}
		const { bytes, bind, report } = bindVRM( vrmBytes, faceBytes, opts );

		const blob = new Blob( [ bytes ], { type: 'model/gltf-binary' } );
		const filename = `${ vrmName }.bound.vrm`;
		const url = URL.createObjectURL( blob );
		const a = $( 'download' ); a.href = url; a.download = filename; a.hidden = false; a.textContent = `Download ${ filename } (${ ( bytes.length / 1048576 ).toFixed( 1 ) } MB)`;

		render( report );
		window.__webcli_result = { ok: true, filename, size: bytes.length, blobUrl: url, faceGlbBlobUrl: faceGlbUrl, bytes, bind, report, scope: SCOPE };
		say( `Bound ${ report.mapped } of ${ report.sourceMorphs } face morphs. ${ SCOPE }.`, 'ok' );
		if ( params.has( 'run' ) && params.get( 'download' ) !== '0' ) a.click();
		return window.__webcli_result;

	} catch ( e ) {

		window.__webcli_result = { ok: false, code: e.code || 'ERROR', error: e.message };
		say( e.message, 'err' );
		return window.__webcli_result;

	}

}

function render( report ) {

	const list = ( items, fmt ) => items.length ? `<ul>${ items.map( i => `<li>${ fmt( i ) }</li>` ).join( '' ) }</ul>` : '<p class="muted">none</p>';
	$( 'report' ).innerHTML = `
		<h2>Result</h2>
		<p><strong>${ report.mapped }</strong> of ${ report.sourceMorphs } face morphs mapped <span class="muted">(names from ${ report.nameResolution })</span>.</p>
		<h3>Skipped — face morph with no VRM target</h3>${ list( report.unmapped, u => `#${ u.source } ${ u.name ?? '(unnamed)' } — ${ u.reason }` ) }
		<h3>Not driven — VRM ARKit shapes the face GLB has no morph for</h3>${ list( report.undriven, n => n ) }
		${ report.warnings.length ? `<h3>Warnings</h3>${ list( report.warnings, w => w ) }` : '' }
		${ report.tint ? `<p class="muted">Skin tint applied to ${ report.tint.materials.join( ', ' ) } (approximate).</p>` : '' }`;

}

function showNetwork() {

	const log = window.__facebind_net || [];
	$( 'net' ).textContent = log.length ? log.map( r => `${ r.blocked ? 'BLOCKED ' : '' }${ r.method || '' } ${ r.url || r.kind }`.trim() ).join( '\n' ) : '(no requests)';

}

let vrmFile = null, faceFile = null, imageFile = null;
const ready = () => !! ( imageFile || faceFile );
const go = () => run( { vrm: vrmFile || $( 'vrmUrl' ).value.trim() || $( 'base' ).value, image: imageFile, face: imageFile ? null : faceFile, tint: $( 'tint' ).checked } ).then( showNetwork );

function setImage( f ) {

	imageFile = f || null;
	const img = $( 'preview' );
	if ( img.src ) URL.revokeObjectURL( img.src );
	if ( imageFile ) { img.src = URL.createObjectURL( imageFile ); img.hidden = false; } else { img.removeAttribute( 'src' ); img.hidden = true; }

}

$( 'imageFile' ).addEventListener( 'change', e => { setImage( e.target.files[ 0 ] ); if ( params.has( 'run' ) && ready() ) go(); } );

$( 'vrmFile' ).addEventListener( 'change', e => { vrmFile = e.target.files[ 0 ] || null; } );
$( 'faceFile' ).addEventListener( 'change', e => { faceFile = e.target.files[ 0 ] || null; if ( params.has( 'run' ) && ready() ) go(); } );
$( 'bind' ).addEventListener( 'click', () => ready() ? go() : say( 'Choose a photo of a face first.', 'err' ) );

document.addEventListener( 'dragover', e => e.preventDefault() );
document.addEventListener( 'drop', e => {

	e.preventDefault();
	for ( const f of e.dataTransfer.files ) {

		if ( /\.vrm$/i.test( f.name ) ) { vrmFile = f; $( 'vrmName' ).textContent = f.name; }
		else if ( /\.glb$/i.test( f.name ) ) { faceFile = f; $( 'faceName' ).textContent = f.name; }
		else if ( /^image\//.test( f.type ) ) setImage( f );

	}
	if ( params.has( 'run' ) && ready() ) go();

} );

if ( params.has( 'vrm' ) ) {

	const v = params.get( 'vrm' );
	if ( DEFAULT_BASES[ v ] ) $( 'base' ).value = v; else $( 'vrmUrl' ).value = v;

}
if ( params.has( 'face' ) || params.has( 'image' ) ) say( 'Ignoring ?image= / ?face=: the photo and the face GLB are local-only and are never loaded from a URL.', 'err' );

// load the on-device face model now, so the photo step also works with the network off afterwards
const model = $( 'model' );
const preload = async () => { model.textContent = 'loading…'; try { await ( await autorig ).loadLandmarker(); model.textContent = 'ready (runs on this device)'; return true; } catch ( e ) { model.textContent = 'unavailable: ' + e.message; return false; } };
const preloaded = preload();

window.__facebind = { run, preload: () => preloaded, network: () => window.__facebind_net };
window.__webcli_result = null;
