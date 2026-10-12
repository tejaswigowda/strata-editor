// Egress guard for the face-bind page. Loaded first, as a classic script, before any module.
//
// The photo and the face GLB are identity data: they are only ever read from a local File, and nothing
// derived from them may leave the device. This wrapper is a second line behind the page's
// Content-Security-Policy. It allows only these requests:
//   · fetch / XMLHttpRequest, method GET, no body, URL no longer than 2048 characters, AND the
//     destination is this page's own origin, a blob: or data: URL (in-memory data), or a URL the user
//     typed as the base VRM (registered with window.__facebind_allow right before it is fetched)
// and refuses everything else (POST/PUT, request bodies, other origins, navigator.sendBeacon,
// WebSocket, EventSource, WebRTC, WebTransport, window.open). Every request, allowed or blocked, is
// recorded in window.__facebind_net so the guarantee can be audited (it is shown in the page).
//
// What it is not: it cannot stop a browser extension or a compromised host from replacing this code.
// See guides/FACE_BIND_PRIVACY.md for the threat model.
( function () {

	const log = window.__facebind_net = [];
	const allowed = new Set();

	/** Register one exact URL (the base VRM the user typed) as an allowed cross-origin GET. */
	window.__facebind_allow = url => { allowed.add( new URL( url, location.href ).href ); };

	const refuse = ( kind, detail ) => { log.push( { kind, blocked: true, ...detail } ); return new Error( `face-bind egress guard: ${ kind } is not allowed` ); };

	const destinationOk = url => {

		let u;
		try { u = new URL( url, location.href ); } catch ( e ) { return false; }
		return u.origin === location.origin || u.protocol === 'blob:' || u.protocol === 'data:' || allowed.has( u.href );

	};

	const realFetch = window.fetch.bind( window );
	window.fetch = function ( input, init ) {

		const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
		const method = ( ( init && init.method ) || ( req && req.method ) || 'GET' ).toUpperCase();
		const hasBody = ( init && init.body != null ) || ( req && req.body != null );
		const url = String( req ? req.url : input );
		if ( method !== 'GET' || hasBody || url.length > 2048 || ! destinationOk( url ) ) return Promise.reject( refuse( 'fetch ' + method, { method, url: url.slice( 0, 200 ) } ) );
		log.push( { kind: 'fetch', method, url: url.slice( 0, 200 ), blocked: false } );
		return realFetch( input, init );

	};

	const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function ( method, url ) {

		if ( String( method ).toUpperCase() !== 'GET' || String( url ).length > 2048 || ! destinationOk( String( url ) ) ) throw refuse( 'XMLHttpRequest ' + method, { method, url: String( url ).slice( 0, 200 ) } );
		log.push( { kind: 'xhr', method: 'GET', url: String( url ).slice( 0, 200 ), blocked: false } );
		return xhrOpen.apply( this, arguments );

	};
	XMLHttpRequest.prototype.send = function ( body ) {

		if ( body != null ) throw refuse( 'XMLHttpRequest body', {} );
		return xhrSend.call( this );

	};

	if ( navigator.sendBeacon ) navigator.sendBeacon = function () { refuse( 'sendBeacon', {} ); return false; };
	window.open = function () { refuse( 'window.open', {} ); return null; };
	for ( const name of [ 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport' ] ) {

		if ( name in window ) window[ name ] = function () { throw refuse( name, {} ); };

	}

} )();
