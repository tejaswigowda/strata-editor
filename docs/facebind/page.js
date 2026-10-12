import { bindVRM, skinTextureOf, SCOPE } from '../editor/js/facebind/bind.js';

// ── pure transform: (base VRM = url | local file, face GLB = LOCAL file only) -> bound VRM ──
// window.__facebind.run({ vrm, face, tint })  -> window.__webcli_result
// ?vrm=<url>&run=1   auto-runs as soon as a face GLB is supplied from local disk.
// The face GLB is never a URL: a `face=` parameter is refused, and a string passed as `face` is rejected.

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

async function run( { vrm, face, tint = false, names } ) {

	try {

		if ( typeof face === 'string' || ( face && face.href ) ) {

			throw Object.assign( new Error( 'The face GLB must be a local file or bytes, never a URL (it is identity data and must not be fetched or sent anywhere).' ), { code: 'FACE_MUST_BE_LOCAL' } );

		}
		if ( ! face ) throw Object.assign( new Error( 'Choose the face-blendshape GLB from local disk.' ), { code: 'NO_FACE' } );
		if ( ! vrm ) throw Object.assign( new Error( 'Give a base VRM (a URL, or choose a file).' ), { code: 'NO_VRM' } );

		say( 'Binding on this device…' );
		let vrmBytes, vrmName;
		if ( typeof vrm === 'string' ) {

			const res = await fetch( vrm ); // GET, audited by egressGuard.js
			if ( ! res.ok ) throw Object.assign( new Error( `Could not GET the base VRM (${ res.status }).` ), { code: 'VRM_FETCH' } );
			vrmBytes = new Uint8Array( await res.arrayBuffer() ); vrmName = fileBase( new URL( vrm, location.href ).pathname );

		} else { vrmBytes = await readBytes( vrm, 'base VRM' ); vrmName = fileBase( vrm.name ); }
		const faceBytes = await readBytes( face, 'face GLB' );

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
		window.__webcli_result = { ok: true, filename, size: bytes.length, blobUrl: url, bytes, bind, report, scope: SCOPE };
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

let vrmFile = null, faceFile = null;
const ready = () => ( vrmFile || $( 'vrmUrl' ).value.trim() ) && faceFile;
const go = () => run( { vrm: vrmFile || $( 'vrmUrl' ).value.trim(), face: faceFile, tint: $( 'tint' ).checked } ).then( showNetwork );

$( 'vrmFile' ).addEventListener( 'change', e => { vrmFile = e.target.files[ 0 ] || null; } );
$( 'faceFile' ).addEventListener( 'change', e => { faceFile = e.target.files[ 0 ] || null; if ( params.has( 'run' ) && ready() ) go(); } );
$( 'bind' ).addEventListener( 'click', () => ready() ? go() : say( 'Choose the base VRM and the face GLB first.', 'err' ) );

document.addEventListener( 'dragover', e => e.preventDefault() );
document.addEventListener( 'drop', e => {

	e.preventDefault();
	for ( const f of e.dataTransfer.files ) if ( /\.vrm$/i.test( f.name ) ) { vrmFile = f; $( 'vrmName' ).textContent = f.name; } else if ( /\.glb$/i.test( f.name ) ) { faceFile = f; $( 'faceName' ).textContent = f.name; }
	if ( params.has( 'run' ) && ready() ) go();

} );

if ( params.has( 'vrm' ) ) $( 'vrmUrl' ).value = params.get( 'vrm' );
if ( params.has( 'face' ) ) say( 'Ignoring ?face=: the face GLB is local-only and is never loaded from a URL.', 'err' );

window.__facebind = { run, network: () => window.__facebind_net };
window.__webcli_result = null;
