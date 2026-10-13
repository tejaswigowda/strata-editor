// Cloudflare Worker: real response headers for /strata-editor/facebind/ (GitHub Pages cannot set headers).
//
// The values come from facebind-headers.json, which page.test.mjs keeps identical to the page's <meta> CSP (plus
// frame-ancestors, which only works as a header). Everything under the path gets them, including the initial HTML
// document, which the <meta> policy cannot cover from the first byte and a script cannot strip.
//
// Deploy: see README.md in this folder. It only works when the domain is proxied by Cloudflare.

import config from './facebind-headers.json';

export default {

	async fetch( request ) {

		const response = await fetch( request ); // pass through to the origin (GitHub Pages)
		const { pathname } = new URL( request.url );
		const base = config.path.replace( /\/$/, '' );
		if ( pathname !== base && ! pathname.startsWith( config.path ) ) return response;

		// the most specific rule wins: the embedded editor has its own policy (it may be framed by the page)
		const rule = ( config.overrides || [] ).find( o => pathname.startsWith( o.path ) ) || config;
		const headers = new Headers( response.headers );
		for ( const [ name, value ] of Object.entries( rule.headers ) ) headers.set( name, value );
		return new Response( response.body, { status: response.status, statusText: response.statusText, headers } );

	},

};
