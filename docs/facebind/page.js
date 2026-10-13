import { paintFacialHair } from '../editor/js/facebind/facialHair.js';
import { bindVRM, lookTexturesOf, SCOPE } from '../editor/js/facebind/bind.js';

// ── pure transform: (base VRM = url | local file, face GLB = LOCAL file only) -> bound VRM ──
// window.__facebind.run({ vrm, image | face, look, shape, hairShape, hairStyle, facialHair, bald })  -> window.__webcli_result
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

// The preview module (three.js, GLTFLoader, OrbitControls) also loads now, so the preview works with the network off.
const previewModule = import( './preview.js' );
previewModule.catch( e => console.warn( 'facebind: preview unavailable', e ) );

// Everything shown in the report that comes from a file (morph names, material names) is escaped.
const esc = v => String( v ).replace( /[&<>"']/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ] );

// object URLs of the previous run's outputs, revoked when a new run starts so identity-derived bytes do not linger
let objectUrls = [];
const makeUrl = blob => { const u = URL.createObjectURL( blob ); objectUrls.push( u ); return u; };

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

// decode a texture on this device into RGBA, and encode RGBA back to PNG bytes
async function decodeRGBA( bytes, mime ) {

	const bmp = await createImageBitmap( new Blob( [ bytes ], { type: mime } ) );
	const c = document.createElement( 'canvas' ); c.width = bmp.width; c.height = bmp.height;
	const ctx = c.getContext( '2d', { willReadFrequently: true } );
	ctx.drawImage( bmp, 0, 0 );
	return ctx.getImageData( 0, 0, c.width, c.height );

}

async function encodePNG( rgba, width, height ) {

	const c = document.createElement( 'canvas' ); c.width = width; c.height = height;
	c.getContext( '2d' ).putImageData( new ImageData( rgba, width, height ), 0, 0 );
	const blob = await new Promise( ( resolve, reject ) => c.toBlob( b => b ? resolve( b ) : reject( new Error( 'PNG encoding failed' ) ), 'image/png' ) );
	return new Uint8Array( await blob.arrayBuffer() );

}

let photoCache = null; // the last photo's reading, so toggling bald re-binds without reading the face again

async function run( { vrm, image, face, look, shape, hairShape, hairStyle, facialHair, bald, names } ) {

	try {

		for ( const [ label, v, code ] of [ [ 'photo', image, 'IMAGE_MUST_BE_LOCAL' ], [ 'face GLB', face, 'FACE_MUST_BE_LOCAL' ] ] ) {

			if ( typeof v === 'string' || ( v && v.href ) ) throw Object.assign( new Error( `The ${ label } must be a local file or bytes, never a URL (it is identity data and must not be fetched or sent anywhere).` ), { code } );

		}
		if ( ! image && ! face ) throw Object.assign( new Error( 'Choose a photo of a face (or a face-blendshape GLB) from local disk.' ), { code: 'NO_FACE' } );

		for ( const u of objectUrls ) URL.revokeObjectURL( u );
		objectUrls = [];
		for ( const id of [ 'download', 'faceGlbLink' ] ) { $( id ).hidden = true; $( id ).removeAttribute( 'href' ); }

		say( 'Binding on this device…' );
		vrm = vrm || 'male';
		if ( typeof vrm === 'string' && DEFAULT_BASES[ vrm ] ) vrm = DEFAULT_BASES[ vrm ];
		let vrmBytes, vrmName;
		if ( typeof vrm === 'string' ) {

			// a base VRM URL the user typed is the one cross-origin GET the guard allows, for exactly that URL
			const target = new URL( vrm, location.href );
			if ( target.origin !== location.origin ) window.__facebind_allow( target.href );
			const res = await fetch( target.href ); // GET, audited by egressGuard.js
			if ( ! res.ok ) throw Object.assign( new Error( `Could not GET the base VRM (${ res.status }).` ), { code: 'VRM_FETCH' } );
			vrmBytes = new Uint8Array( await res.arrayBuffer() ); vrmName = fileBase( new URL( vrm, location.href ).pathname );

		} else { vrmBytes = await readBytes( vrm, 'base VRM' ); vrmName = fileBase( vrm.name ); }
		let faceBytes, faceGlbUrl = null, expression = null, photoRead = null;
		if ( image ) {

			let read = photoCache && photoCache.image === image ? photoCache.read : null;
			if ( ! read ) { say( 'Reading the face on this device…' ); read = await ( await autorig ).faceGLBFromImage( image ); photoCache = { image, read }; }
			const { glb, blendshapes, hairMask, facialHair: facialHairRead, hair: hairRead } = read;
			photoRead = { facialHair: facialHairRead, hairColor: hairRead ? hairRead.color : null };
			showHairMask( image, hairMask );
			faceBytes = glb; expression = blendshapes;
			faceGlbUrl = makeUrl( new Blob( [ glb ], { type: 'model/gltf-binary' } ) );
			const f = $( 'faceGlbLink' ); f.href = faceGlbUrl; f.download = 'face-model-blendshapes.glb'; f.hidden = false;

		} else faceBytes = await readBytes( face, 'face GLB' );

		const opts = { names };
		if ( bald ) opts.bald = true;
		if ( shape ) opts.shape = { strength: shape.strength };
		if ( hairShape ) opts.hairShape = { strength: hairShape.strength, hug: hairShape.hug };
		if ( hairStyle ) opts.hairStyle = hairStyle;
		if ( look && ( look.skin || look.hair || look.iris || look.brow ) ) {

			// decode the VRM's skin / hair textures here, on device, and pass each one's mean color to the bind
			const textureMeans = {};
			for ( const t of lookTexturesOf( vrmBytes ) ) if ( look[ t.role ] ) textureMeans[ t.index ] = await meanOpaqueRGB( t.bytes, t.mime );
			opts.look = { skin: !! look.skin, hair: !! look.hair, iris: !! look.iris, brow: !! look.brow, strength: look.strength, textureMeans };

		}
		// facial hair: painted into the face SKIN texture (a texture edit, no geometry), only when the photo shows some
		if ( facialHair && photoRead && photoRead.facialHair ) {

			const faceTex = lookTexturesOf( vrmBytes ).find( t => /Face_00_SKIN/.test( t.name ) );
			if ( faceTex ) {

				const img = await decodeRGBA( faceTex.bytes, faceTex.mime );
				const painted = paintFacialHair( img.data, img.width, img.height, photoRead.facialHair, photoRead.hairColor );
				const f = photoRead.facialHair;
				opts.textures = [ { materialIndex: faceTex.index, png: await encodePNG( painted, img.width, img.height ), label: `facial hair painted on the face texture (mustache ${ f.mustache }, chin ${ f.chin }, jaw ${ f.jaw })` } ];

			}

		}
		const { bytes, bind, report } = bindVRM( vrmBytes, faceBytes, opts );

		const blob = new Blob( [ bytes ], { type: 'model/gltf-binary' } );
		const filename = `${ vrmName }.bound.vrm`;
		const url = makeUrl( blob );
		const a = $( 'download' ); a.href = url; a.download = filename; a.hidden = false; a.textContent = `Download ${ filename } (${ ( bytes.length / 1048576 ).toFixed( 1 ) } MB)`;

		render( report );
		const risky = bind.source.nameResolution === 'convention' || bind.source.nameResolution === 'unresolved';
		$( 'resolutionWarn' ).hidden = ! risky;
		if ( risky ) $( 'resolutionWarn' ).textContent = 'Check the mapping: ' + bind.warnings.join( ' ' );
		showPreview( vrmBytes, bytes, bind, expression );
		window.__webcli_result = { ok: true, nameResolution: report.nameResolution, warnings: report.warnings, filename, size: bytes.length, blobUrl: url, faceGlbBlobUrl: faceGlbUrl, faceGlb: image ? faceBytes : null, expression, bytes, bind, report, scope: SCOPE };
		say( `Bound ${ report.mapped } of ${ report.sourceMorphs } face morphs${ risky ? ' (names ASSUMED, see the warning below)' : '' }. ${ SCOPE }.`, risky ? 'err' : 'ok' );
		if ( params.has( 'run' ) && params.get( 'download' ) !== '0' ) a.click();
		return window.__webcli_result;

	} catch ( e ) {

		window.__webcli_result = { ok: false, code: e.code || 'ERROR', error: e.message };
		say( e.message, 'err' );
		return window.__webcli_result;

	}

}

// plain-language lines for the hair plan (ratios of 1 mean unchanged)
function describeHair( a ) {

	const x = v => v === null || v === undefined ? null : '×' + Number( v ).toFixed( 2 );
	const row = arr => arr && arr.some( v => v !== null ) ? arr.map( v => x( v ) ?? 'n/a' ).join(' / ') : null;
	const lines = [];
	if ( a.mode === 'silhouette' ) {

		const r = row( a.sides.right ), l = row( a.sides.left ), c = row( a.crown );
		if ( r ) lines.push( `right side reach (below ears / ear level / crown): ${ r }` );
		if ( l ) lines.push( `left side reach (below ears / ear level / crown): ${ l }` );
		if ( c ) lines.push( `crown height (left / middle / right): ${ c }` );
		if ( a.length.right || a.length.left ) lines.push( `length (right / left): ${ x( a.length.right ) ?? 'n/a' } / ${ x( a.length.left ) ?? 'n/a' }` );
		if ( a.swept ) lines.push( `swept-up cut, because the photo's hair is shorter than the VRM's (in eye-to-chin heights): the hair below the ears is lifted ${ a.swept.bottomE }, the top ${ a.swept.topE }, the fringe ${ a.swept.fringeE }; the ear line stays` );
		if ( a.fringeShiftE && a.fringeShiftE.some( v => v !== null && Math.abs( v ) > 0.005 ) ) lines.push( `fringe edge shift (left / middle / right, in eye-to-chin heights): ${ a.fringeShiftE.join( ' / ' ) }` );

	} else {

		for ( const [ k, v ] of Object.entries( a ) ) if ( k !== 'mode' && v !== null && v !== undefined ) lines.push( `${ k }: ${ typeof v === 'number' ? ( k === 'fringeShiftE' ? v : x( v ) ) : v }` );

	}
	return lines.length ? lines : [ 'no change' ];

}

function render( report ) {

	const list = ( items, fmt ) => items.length ? `<ul>${ items.map( i => `<li>${ fmt( i ) }</li>` ).join( '' ) }</ul>` : '<p class="muted">none</p>';
	$( 'report' ).innerHTML = `
		<h2>Result</h2>
		<p><strong>${ report.mapped }</strong> of ${ report.sourceMorphs } face morphs mapped <span class="muted">(names from ${ esc( report.nameResolution ) })</span>.</p>
		<h3>Skipped: face morph with no VRM target</h3>${ list( report.unmapped, u => `#${ esc( u.source ) } ${ esc( u.name ?? '(unnamed)' ) }: ${ esc( u.reason ) }` ) }
		<h3>Not driven: VRM ARKit shapes the face GLB has no morph for</h3>${ list( report.undriven, n => esc( n ) ) }
		${ report.warnings.length ? `<h3>Warnings</h3>${ list( report.warnings, w => esc( w ) ) }` : '' }
		${ report.shape ? `<h3>Face shape <span class="muted">(approximate; the face's base positions moved by up to ${ report.shape.maxMoveMm } mm)</span></h3>` : '' }
		${ report.hairRemoved ? `<h3>Hair removed <span class="muted">(${ report.hairRemoved.primitives } hair pieces left out of the VRM; nothing else changed)</span></h3>` : '' }
		${ report.textures && report.textures.length ? `<h3>Texture edit <span class="muted">(approximate; a painted copy of the face texture, no geometry)</span></h3>${ list( report.textures, l => esc( l ) ) }` : '' }
		${ report.hairStyle && ( report.hairStyle.texture !== 'straight' || report.hairStyle.cut !== 'photo' ) ? `<h3>Hair style <span class="muted">(approximate; each lock of the VRM's own hair cards is re-laid, nothing is added)</span></h3>${ list( [ `cut: ${ report.hairStyle.cut }`, `texture: ${ report.hairStyle.texture } (${ report.hairStyle.textureSource })`, ...( report.hairStyle.cards ? [ `${ report.hairStyle.cards } hair locks re-laid` ] : [] ) ], l => esc( l ) ) }` : '' }
		${ report.hairShape ? `<h3>Hair shape <span class="muted">(approximate; the existing hairstyle scaled and shifted to the photo's hair silhouette, by up to ${ report.hairShape.maxMoveMm } mm)</span></h3>${ list( describeHair( report.hairShape.applied ), l => esc( l ) ) }` : '' }
		${ report.look ? `<h3>Look transfer <span class="muted">(approximate; material tint only)</span></h3>${ list( report.look.applied, a => `${ esc( a.role ) }: ${ esc( a.material ) } → rgb(${ a.target.map( esc ).join( ', ' ) })${ a.reached ? '' : ' (not fully reachable)' }` ) }` : '' }`;

}

function showNetwork() {

	const log = window.__facebind_net || [];
	const blobs = log.filter( r => /^blob:|^data:/.test( r.url || '' ) ).length;
	const lines = log.filter( r => ! /^blob:|^data:/.test( r.url || '' ) ).map( r => `${ r.blocked ? 'BLOCKED ' : '' }${ r.method || '' } ${ r.url || r.kind }`.trim() );
	if ( blobs ) lines.push( `${ blobs } read(s) of in-memory data (blob:), never leaves this page` );
	$( 'net' ).textContent = lines.length ? lines.join( '\n' ) : '(no requests)';

}

// Shade the hair the segmenter found on a small copy of the photo, so you can see what the hair shape is based on.
async function showHairMask( image, hair ) {

	const canvas = $( 'maskCanvas' );
	if ( ! hair ) { canvas.hidden = true; $( 'maskNote' ).hidden = true; return; }
	try {

		const bmp = await createImageBitmap( image, { imageOrientation: 'from-image' } );
		const scale = Math.min( 1, 220 / Math.max( hair.width, hair.height ) );
		canvas.width = Math.max( 1, Math.round( hair.width * scale ) ); canvas.height = Math.max( 1, Math.round( hair.height * scale ) );
		const ctx = canvas.getContext( '2d' );
		ctx.drawImage( bmp, 0, 0, canvas.width, canvas.height );
		const over = document.createElement( 'canvas' ); over.width = hair.width; over.height = hair.height;
		const oc = over.getContext( '2d' ), img = oc.createImageData( hair.width, hair.height );
		for ( let i = 0; i < hair.data.length; i ++ ) if ( hair.data[ i ] === hair.hairValue ) { img.data[ i * 4 ] = 255; img.data[ i * 4 + 1 ] = 60; img.data[ i * 4 + 2 ] = 120; img.data[ i * 4 + 3 ] = 140; }
		oc.putImageData( img, 0, 0 );
		ctx.drawImage( over, 0, 0, canvas.width, canvas.height );
		canvas.hidden = false; $( 'maskNote' ).hidden = false;
		bmp.close();

	} catch ( e ) { canvas.hidden = true; $( 'maskNote' ).hidden = true; }

}

// 3D preview (three.js, on device); loaded on first use
let preview = null;
let currentExpression = null;
const topShapes = scores => Object.entries( scores ).filter( ( [ , v ] ) => v > 0.1 ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 5 ).map( ( [ n, v ] ) => `${ n } ${ v.toFixed( 2 ) }` );

async function showPreview( base, bound, bind, expression ) {

	try {

		$( 'previewBox' ).hidden = false;
		if ( ! preview ) preview = ( await previewModule ).createPreview( $( 'preview3d' ) );
		currentExpression = expression;
		await preview.show( { base, bound, bind, expression } );
		const has = !! expression;
		$( 'expr_photo' ).disabled = ! has;
		$( has ? 'expr_photo' : 'expr_manual' ).checked = true;
		for ( const id of [ 'jawOpen', 'smile', 'blink', 'browsUp' ] ) $( 'x_' + id ).value = 0;
		updateExpressionNote();

	} catch ( e ) {

		$( 'previewNote' ).textContent = 'The preview is unavailable here (' + e.message + '). The download is not affected.';

	}

}

function updateExpressionNote() {

	if ( ! preview ) return;
	const { mapped, extra } = preview.info, mode = preview.expressionMode;
	const top = currentExpression ? topShapes( currentExpression ) : [];
	$( 'previewNote' ).textContent = 'Flat preview (no MToon shading). Drag to rotate, scroll to zoom. ' + ( mode === 'photo'
		? `Expression read from your photo: ${ top.length ? top.join( ', ' ) : 'neutral' }. ${ mapped } shapes go through the bind map${ extra ? `, ${ extra } more ARKit shapes the VRM has are applied by name` : '' }.`
		: mode === 'manual' ? 'Expression: the sliders.' : 'Expression: neutral.' );

}

let vrmFile = null, faceFile = null, imageFile = null;
const ready = () => !! ( imageFile || faceFile );
const lookOptions = () => ( { skin: $( 'lookSkin' ).checked, hair: $( 'lookHair' ).checked, iris: $( 'lookIris' ).checked, brow: $( 'lookBrow' ).checked, strength: Number( $( 'lookStrength' ).value ) / 100 } );
const shapeOptions = () => $( 'shapeOn' ).checked ? { strength: Number( $( 'shapeStrength' ).value ) / 100 } : null;
const hairShapeOptions = () => $( 'hairShapeOn' ).checked ? { strength: Number( $( 'shapeStrength' ).value ) / 100, hug: Number( $( 'hairHug' ).value ) / 100 } : null;
const hairStyleOptions = () => ( { cut: $( 'hairCut' ).value, texture: $( 'hairTexture' ).value } );
const go = () => run( { vrm: vrmFile || $( 'vrmUrl' ).value.trim() || $( 'base' ).value, image: imageFile, face: imageFile ? null : faceFile, look: lookOptions(), shape: shapeOptions(), hairShape: hairShapeOptions(), hairStyle: hairStyleOptions(), facialHair: $( 'facialHairOn' ).checked, bald: $( 'baldOn' ).checked } ).then( showNetwork );

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

for ( const id of [ 'jawOpen', 'smile', 'blink', 'browsUp' ] ) $( 'x_' + id ).addEventListener( 'input', e => { if ( ! preview ) return; $( 'expr_manual' ).checked = true; preview.setExpression( id, Number( e.target.value ) / 100 ); updateExpressionNote(); } );
for ( const m of [ 'flat', 'lit' ] ) $( 'shade_' + m ).addEventListener( 'change', e => { if ( e.target.checked && preview ) preview.setShading( m ); } );
for ( const m of [ 'photo', 'neutral', 'manual' ] ) $( 'expr_' + m ).addEventListener( 'change', e => { if ( e.target.checked && preview ) { preview.setExpressionMode( m ); updateExpressionNote(); } } );
// bald re-binds (the photo is not read again), so the preview and the download are the same bytes
$( 'baldOn' ).addEventListener( 'change', () => { if ( ready() && window.__webcli_result && window.__webcli_result.ok ) go(); } );
for ( const v of [ 'bound', 'base' ] ) $( 'view_' + v ).addEventListener( 'change', e => e.target.checked && preview && preview.setView( v ) );
$( 'xReset' ).addEventListener( 'click', () => { for ( const id of [ 'jawOpen', 'smile', 'blink', 'browsUp' ] ) $( 'x_' + id ).value = 0; if ( preview ) { preview.resetExpressions(); $( 'expr_neutral' ).checked = true; updateExpressionNote(); } } );

$( 'lookStrength' ).addEventListener( 'input', e => { $( 'lookStrengthValue' ).textContent = e.target.value + '%'; } );
$( 'shapeStrength' ).addEventListener( 'input', e => { $( 'shapeStrengthValue' ).textContent = e.target.value + '%'; } );

// load the on-device face model now, so the photo step also works with the network off afterwards
const model = $( 'model' );
const preload = async () => { model.textContent = 'loading…'; try { const a = await autorig; await Promise.all( [ a.loadLandmarker(), a.loadHairSegmenter() ] ); model.textContent = 'ready (runs on this device)'; return true; } catch ( e ) { model.textContent = 'unavailable: ' + e.message; return false; } };
const preloaded = preload();

window.__facebind = { run, preview: () => preview, preload: () => preloaded, network: () => window.__facebind_net };
window.__webcli_result = null;
