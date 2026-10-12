// Egress guard for the face-bind page. Loaded first, as a classic script, before any module.
// The face GLB is identity data: it is only ever read from a local File / handle, and the page may
// only make plain GET requests (the base VRM, static assets). This wrapper refuses everything else
// and records every request in window.__facebind_net so the guarantee can be audited:
//   · fetch: GET only, no body, URL ≤ 2048 chars
//   · XMLHttpRequest: GET only, no body
//   · navigator.sendBeacon, WebSocket, EventSource, RTCPeerConnection, WebTransport: blocked
// This is a guard + audit log on top of the page's Content-Security-Policy; it is not a substitute
// for checking the browser's network panel.
( function () {

	const log = window.__facebind_net = [];
	const refuse = ( kind, detail ) => { log.push( { kind, blocked: true, ...detail } ); return new Error( `face-bind egress guard: ${ kind } is not allowed` ); };

	const realFetch = window.fetch.bind( window );
	window.fetch = function ( input, init ) {

		const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
		const method = ( ( init && init.method ) || ( req && req.method ) || 'GET' ).toUpperCase();
		const hasBody = ( init && init.body != null ) || ( req && req.body != null );
		const url = String( req ? req.url : input );
		if ( method !== 'GET' || hasBody || url.length > 2048 ) return Promise.reject( refuse( 'fetch ' + method, { method, url: url.slice( 0, 200 ) } ) );
		log.push( { kind: 'fetch', method, url, blocked: false } );
		return realFetch( input, init );

	};

	const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function ( method, url ) {

		if ( String( method ).toUpperCase() !== 'GET' ) throw refuse( 'XMLHttpRequest ' + method, { method, url: String( url ).slice( 0, 200 ) } );
		log.push( { kind: 'xhr', method: 'GET', url: String( url ), blocked: false } );
		return xhrOpen.apply( this, arguments );

	};
	XMLHttpRequest.prototype.send = function ( body ) {

		if ( body != null ) throw refuse( 'XMLHttpRequest body', {} );
		return xhrSend.call( this );

	};

	if ( navigator.sendBeacon ) navigator.sendBeacon = function () { refuse( 'sendBeacon', {} ); return false; };
	for ( const name of [ 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport' ] ) {

		if ( name in window ) window[ name ] = function () { throw refuse( name, {} ); };

	}

} )();
