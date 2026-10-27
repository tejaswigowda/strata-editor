// handoff.js: use a webcli.app tool (dub, ffmpeg) as a service from Strata.
//
// The tool opens in a popup that Strata opens itself; files travel by postMessage between the two windows, in this browser, and nothing is
// uploaded. The protocol is the one in guides/HANDOFF.md. The popup has to be opened from a click, so call openTool() synchronously inside the
// click handler, then await job() on the result.

export const PROTOCOL = 1;

export const TOOLS = {
	dub: { url: 'https://dub.webcli.app/', origin: 'https://dub.webcli.app', name: 'dub.webcli.app' },
	ffmpeg: { url: 'https://ffmpeg.webcli.app/', origin: 'https://ffmpeg.webcli.app', name: 'ffmpeg.webcli.app' },
};

/** For local testing: ?dubUrl=http://localhost:5500/ and ?ffmpegUrl=... override where the tools are served from. */
export function toolFor( key, search = typeof location !== 'undefined' ? location.search : '' ) {

	const base = TOOLS[ key ];
	const override = new URLSearchParams( search ).get( key + 'Url' );
	if ( ! override ) return base;
	const u = new URL( override );
	if ( ! /^(localhost|127\.0\.0\.1)$/.test( u.hostname ) ) throw new Error( `${ key }Url may only point at localhost.` );
	return { ...base, url: u.href, origin: u.origin };

}

/**
 * Open the tool's popup. Call inside a click handler. Returns { win, job } where job() sends one job and resolves with { files, meta }.
 * options.open is for tests; options.pollMs is how often 'hello' is repeated until the tool answers.
 */
export function openTool( tool, { open = ( ...a ) => window.open( ...a ), pollMs = 400, readyTimeoutMs = 60000, listen = window } = {} ) {

	if ( typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ) {

		throw new Error( `This page is cross-origin isolated (Cross-Origin-Opener-Policy: same-origin), and the browser then cuts every link to a window on another site, so ${ tool.name } cannot answer. The hosted editor is not isolated; when serving Strata yourself, start it with STRATA_NO_ISOLATION=1.` );

	}
	const win = open( tool.url, 'webcli-' + tool.name, 'popup=yes,width=560,height=760' );
	if ( ! win ) throw new Error( `The browser blocked the ${ tool.name } window. Allow pop-ups for this site and press the button again.` );

	let ready = null;
	let seq = 0;
	let closed = false;
	const listeners = new Set();
	const send = ( msg, transfer = [] ) => win.postMessage( { webcli: PROTOCOL, ...msg }, tool.origin, transfer );

	const onMessage = ( e ) => {

		if ( e.source !== win || e.origin !== tool.origin ) return;
		const m = e.data;
		if ( ! m || m.webcli !== PROTOCOL ) return;
		if ( m.type === 'ready' && ! ready ) ready = m;
		for ( const l of listeners ) l( m );

	};
	listen.addEventListener( 'message', onMessage );

	const finish = () => {

		closed = true;
		listen.removeEventListener( 'message', onMessage );
		clearInterval( poll );

	};

	const waiting = new Set();   // rejecters of everything pending, so a closed window rejects them all
	const poll = setInterval( () => {

		if ( win.closed && ! closed ) { finish(); for ( const rej of waiting ) rej( new Error( `The ${ tool.name } window was closed before it finished.` ) ); return; }
		if ( ! ready ) { try { send( { type: 'hello' } ); } catch ( e ) { /* window not ready yet */ } }

	}, pollMs );

	const whenReady = () => new Promise( ( resolve, reject ) => {

		if ( ready ) return resolve( ready );
		const timer = setTimeout( () => { listeners.delete( l ); waiting.delete( reject ); reject( new Error( `${ tool.name } did not answer. If it opened, it may be an old version without the Strata hand-off.` ) ); }, readyTimeoutMs );
		const l = ( m ) => { if ( m.type === 'ready' ) { clearTimeout( timer ); listeners.delete( l ); waiting.delete( reject ); resolve( m ); } };
		listeners.add( l );
		waiting.add( reject );

	} );

	/** files: { name: ArrayBuffer | Uint8Array }. The buffers are transferred (detached here). */
	async function job( { op, args = {}, files = {}, onProgress = null, signal = null } ) {

		const hello = await whenReady();
		if ( ! hello.ops.includes( op ) ) throw new Error( `${ tool.name } (version ${ hello.version }) does not offer '${ op }'; it offers: ${ hello.ops.join( ', ' ) }. Update the tool.` );
		const id = `j${ Date.now().toString( 36 ) }${ ++ seq }`;
		const buffers = {};
		const transfer = [];
		for ( const [ name, data ] of Object.entries( files ) ) {

			const buf = data instanceof ArrayBuffer ? data : data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength );
			buffers[ name ] = buf;
			transfer.push( buf );

		}
		return new Promise( ( resolve, reject ) => {

			const l = ( m ) => {

				if ( m.id !== id ) return;
				if ( m.type === 'progress' ) { if ( onProgress ) onProgress( m.fraction, m.text ); return; }
				listeners.delete( l ); waiting.delete( reject );
				if ( m.type === 'result' ) {

					const out = {};
					for ( const [ name, buf ] of Object.entries( m.files || {} ) ) out[ name ] = new Uint8Array( buf );
					resolve( { files: out, meta: m.meta || {} } );

				} else reject( new Error( m.message || 'The tool reported an error.' ) );

			};
			listeners.add( l );
			waiting.add( reject );
			if ( signal ) signal.addEventListener( 'abort', () => { try { send( { type: 'cancel', id } ); } catch ( e ) { /* gone */ } } );
			send( { type: 'job', id, op, args, files: buffers }, transfer );

		} );

	}

	return { win, job, close() { finish(); try { win.close(); } catch ( e ) { /* ignore */ } } };

}
