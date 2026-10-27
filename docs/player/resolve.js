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
	s = s.replace( /[?#].*$/, '' );

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

export function formatDuration( seconds ) {

	const s = Math.round( seconds );
	return `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }`;

}
