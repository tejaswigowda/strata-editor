#!/usr/bin/env node
// site-check: is the site the same before and after a routing change? (guides/CDN_INDEPENDENCE.md, gate G1)
//
//   node tools/site-check.mjs snapshot [--origin https://strataeditor.dev] [--url <extra>]... [--out ops/site-check/before.json]
//   node tools/site-check.mjs compare  <before.json> <after.json>        exit 1 when anything the visitor would notice differs
//
// A snapshot fetches the core pages, every URL in the live sitemap, the editor's entry scripts and a few static assets, and records for each: status, content type,
// byte length and SHA-256 of the body. `--url` adds more (the STOA explorer is not served from this origin, so it is passed in). A proxy that rewrites HTML
// (injecting an analytics beacon, minifying, obfuscating addresses) changes a hash and shows up here; the one thing that is expected to differ is the `via` field,
// which records whether Cloudflare answered, and it is reported, not failed.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const CORE = [ '/', '/about/', '/about/tutorials/', '/player/', '/player/player.js', '/player/resolve.js', '/editor/js/Editor.js', '/editor/js/export/releases.js', '/build/three.core.js', '/favicon.svg', '/robots.txt', '/sitemap.xml' ];

const sha = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );

/** One URL's record. Never throws: a network failure is a record with status 0 and the reason. */
export async function probe( url, { fetchImpl = fetch, timeoutMs = 30000 } = {} ) {

	try {

		const res = await fetchImpl( url, { redirect: 'manual', signal: AbortSignal.timeout( timeoutMs ) } );
		const bytes = new Uint8Array( await res.arrayBuffer() );
		const h = res.headers;
		const via = h.get( 'cf-ray' ) ? 'cloudflare' : ( /github/i.test( h.get( 'server' ) || '' ) ? 'github-pages' : ( h.get( 'server' ) || 'unknown' ) );
		return { url, status: res.status, type: ( h.get( 'content-type' ) || '' ).split( ';' )[ 0 ], bytes: bytes.length, sha256: sha( bytes ), via, location: h.get( 'location' ) || null };

	} catch ( e ) { return { url, status: 0, type: '', bytes: 0, sha256: '', via: 'none', error: String( e && e.message || e ) }; }

}

export async function sitemapUrls( origin, fetchImpl = fetch ) {

	try {

		const res = await fetchImpl( origin + '/sitemap.xml' );
		if ( ! res.ok ) return [];
		return [ ...( await res.text() ).matchAll( /<loc>([^<]+)<\/loc>/g ) ].map( m => m[ 1 ].trim() );

	} catch ( e ) { return []; }

}

export async function snapshot( { origin, extra = [], fetchImpl = fetch, concurrency = 8 } ) {

	const urls = [ ...new Set( [ ...CORE.map( p => origin + p ), ...await sitemapUrls( origin, fetchImpl ), ...extra ] ) ];
	const records = new Array( urls.length );
	let next = 0;
	await Promise.all( Array.from( { length: Math.min( concurrency, urls.length ) }, async () => {

		while ( next < urls.length ) { const i = next ++; records[ i ] = await probe( urls[ i ], { fetchImpl } ); }

	} ) );
	return { origin, taken_at: new Date().toISOString(), records };

}

/**
 * What a visitor would notice between two snapshots. `changed`: status, content type or body differ. `lost`: in `before` and not in `after`.
 * `via` differences are informational (they say which edge answered). ok = no `changed`, no `lost`, and no URL that answered before and fails now.
 */
export function compareSnapshots( before, after ) {

	const was = new Map( before.records.map( r => [ r.url, r ] ) ), now = new Map( after.records.map( r => [ r.url, r ] ) );
	const changed = [], lost = [], same = [], added = [];
	for ( const [ url, a ] of was ) {

		const b = now.get( url );
		if ( ! b ) { lost.push( url ); continue; }
		const why = [];
		if ( a.status !== b.status ) why.push( `status ${ a.status } -> ${ b.status }` );
		if ( a.type !== b.type ) why.push( `type ${ a.type } -> ${ b.type }` );
		if ( a.sha256 !== b.sha256 ) why.push( `body differs (${ a.bytes } -> ${ b.bytes } bytes)` );
		if ( why.length ) changed.push( { url, why } ); else same.push( url );

	}
	for ( const url of now.keys() ) if ( ! was.has( url ) ) added.push( url );
	const via = [ ...new Set( after.records.map( r => r.via ) ) ].sort();
	return { ok: changed.length === 0 && lost.length === 0, changed, lost, added, same: same.length, total: was.size, via };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const [ cmd, ...rest ] = process.argv.slice( 2 );
	const opt = ( name, d = null ) => { const i = rest.indexOf( name ); return i >= 0 ? rest[ i + 1 ] : d; };
	if ( cmd === 'snapshot' ) {

		const origin = opt( '--origin', 'https://strataeditor.dev' ).replace( /\/+$/, '' );
		const extra = rest.flatMap( ( a, i ) => a === '--url' ? [ rest[ i + 1 ] ] : [] );
		const snap = await snapshot( { origin, extra } );
		const out = opt( '--out' );
		if ( out ) { await mkdir( path.dirname( out ), { recursive: true } ); await writeFile( out, JSON.stringify( snap, null, 1 ) + '\n' ); }
		const bad = snap.records.filter( r => r.status === 0 || r.status >= 400 );
		console.log( `${ snap.records.length } URLs from ${ origin }, answered by ${ [ ...new Set( snap.records.map( r => r.via ) ) ].join( ', ' ) }; ${ bad.length } not 2xx/3xx${ out ? '; written to ' + out : '' }` );
		for ( const r of bad ) console.log( `  ${ r.status || 'FAILED' } ${ r.url }${ r.error ? ' (' + r.error + ')' : '' }` );

	} else if ( cmd === 'compare' && rest.length >= 2 ) {

		const [ a, b ] = await Promise.all( rest.slice( 0, 2 ).map( async f => JSON.parse( await readFile( f, 'utf8' ) ) ) );
		const r = compareSnapshots( a, b );
		console.log( `${ r.same } of ${ r.total } URLs identical (answered by: ${ r.via.join( ', ' ) })` );
		for ( const c of r.changed ) console.log( `  CHANGED ${ c.url }: ${ c.why.join( '; ' ) }` );
		for ( const u of r.lost ) console.log( `  LOST ${ u }` );
		for ( const u of r.added ) console.log( `  new ${ u }` );
		console.log( r.ok ? 'G1: unaffected.' : 'G1: AFFECTED. Do not leave this routing in place.' );
		process.exit( r.ok ? 0 : 1 );

	} else {

		console.error( 'usage: site-check.mjs snapshot [--origin URL] [--url URL]... [--out FILE] | compare BEFORE AFTER' );
		process.exit( 2 );

	}

}
