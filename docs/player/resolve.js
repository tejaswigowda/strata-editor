// resolve.js — turns whatever was pasted into the player's address into the folder of a published render.
//   https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/            the folder
//   https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/master.m3u8  any file inside it
//   https://github.com/tejaswigowda/test1/tree/main/renders/projectile                  the GitHub page of the folder
//   gh/tejaswigowda/test1@main/renders/projectile                                       the jsDelivr path without the host
// Returns { base } (ends with "/"), or { error }.

const CDN = 'https://cdn.jsdelivr.net/';

export function resolveBase( input ) {

	let s = String( input || '' ).trim();
	try { s = decodeURIComponent( s ); } catch ( e ) { /* keep it as typed */ }
	if ( ! s ) return { error: 'Paste the jsDelivr address of a published render.' };
	s = s.replace( /[?#].*$/, '' ).replace( /&[a-z_]+=[^&]*/gi, '' );     // "&present=true" after the address is an option, not part of it

	const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)\/(.+)$/i.exec( s );
	if ( gh ) s = `${ CDN }gh/${ gh[ 1 ] }/${ gh[ 2 ] }@${ gh[ 3 ] }/${ gh[ 4 ] }`;
	else if ( /^gh\//.test( s ) ) s = CDN + s;
	else if ( /^cdn\.jsdelivr\.net\//.test( s ) ) s = 'https://' + s;

	if ( ! /^https?:\/\//i.test( s ) ) return { error: 'That is not an address I can play: use a jsDelivr URL (https://cdn.jsdelivr.net/gh/owner/repo@ref/renders/name/).' };
	s = s.replace( /\/(?:master\.m3u8|render\.json|poster\.jpg|captions\.vtt)$/i, '' ).replace( /\/+$/, '' );
	return { base: s + '/' };

}

/** True when the address follows a branch (…@main/…) rather than a commit, so a CDN may serve an older render for a while. */
export function followsBranch( base ) {

	const m = /@([^/]+)\//.exec( base );
	return !! m && ! /^[0-9a-f]{7,40}$/i.test( m[ 1 ] );

}

/**
 * Present mode: the video alone, filling the window, with no address bar, title, facts or footer. On when the page is embedded in a frame, or when the address
 * says present=true (as a query, ?present=true, or after the address in the hash, #<address>&present=true); present=false turns it off even in a frame.
 */
export function presentMode( { search = '', hash = '', framed = false } = {} ) {

	const value = ( text, sep ) => { const m = new RegExp( `(?:^|[${ sep }])present=([^&#]*)`, 'i' ).exec( text ); return m ? m[ 1 ].toLowerCase() : null; };
	const v = value( String( search ).replace( /^\?/, '' ), '&' ) ?? value( String( hash ).replace( /^#/, '' ), '&' );
	if ( v === 'false' || v === '0' ) return false;
	if ( v === 'true' || v === '1' || v === '' ) return true;
	return !! framed;

}

/** { owner, repo, ref } of a jsDelivr GitHub address, or null. */
export function parseGh( base ) {

	const m = /\/gh\/([^/@]+)\/([^/@]+)@([^/]+)\//.exec( base );
	return m ? { owner: m[ 1 ], repo: m[ 2 ], ref: m[ 3 ] } : null;

}

/** The same folder at an exact commit: …@main/… becomes …@<sha>/… A commit never changes, so a CDN cannot serve it stale. */
export function pinnedBase( base, sha ) {

	return base.replace( /(\/gh\/[^/@]+\/[^/@]+)@[^/]+\//, `$1@${ sha }/` );

}

/** What a failed playback says: which request failed and how, from hls.js's error data. `code` 0 means no HTTP answer at all (offline, blocked, or a CDN reset). */
export function describeFailure( data, master ) {

	const url = ( data.frag && data.frag.url ) || ( data.context && data.context.url ) || data.url || master;
	const code = data.response && data.response.code !== undefined ? data.response.code : null;
	const what = code === null ? 'no response' : code === 0 ? 'no HTTP answer (the network, a blocker or the CDN cut it off)' : 'HTTP ' + code;
	const file = String( url ).replace( /^.*\/renders\/[^/]+\//, '' );
	return `Playback failed (${ data.details }): ${ file } gave ${ what }.`;

}

export function formatDuration( seconds ) {

	const s = Math.round( seconds );
	return `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }`;

}
