#!/usr/bin/env node
// Checks relative links and #anchors in README.md and guides/*.md.
// No dependencies. Exits 1 if any link is broken.
//   node scripts/check-doc-links.mjs
// External (http/https/mailto) links are not fetched. Links inside code
// fences and inline code are ignored. Anchors are checked for Markdown targets
// using GitHub's heading slug rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const files = [ path.join( root, 'README.md' ) ];
for ( const f of fs.readdirSync( path.join( root, 'guides' ) ).sort() ) {

	if ( f.endsWith( '.md' ) ) files.push( path.join( root, 'guides', f ) );

}

const cache = new Map();

function stripCode( text ) {

	return text
		.replace( /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, m => m.replace( /[^\n]/g, '' ) )
		.replace( /`[^`\n]*`/g, '' );

}

function slug( heading ) {

	return heading
		.replace( /!?\[([^\]]*)\]\([^)]*\)/g, '$1' )
		.replace( /<[^>]+>/g, '' )
		.replace( /[*_`~]/g, m => ( m === '_' ? '_' : '' ) )
		.trim()
		.toLowerCase()
		.replace( /[^\p{L}\p{N}\s_-]/gu, '' )
		.replace( /\s/g, '-' );

}

function anchorsOf( file ) {

	if ( cache.has( file ) ) return cache.get( file );
	const set = new Set();
	const seen = new Map();
	const text = stripCode( fs.readFileSync( file, 'utf8' ) );
	for ( const m of text.matchAll( /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm ) ) {

		const base = slug( m[ 1 ] );
		const n = seen.get( base ) ?? 0;
		seen.set( base, n + 1 );
		set.add( n === 0 ? base : `${base}-${n}` );

	}
	for ( const m of text.matchAll( /<a\s+[^>]*(?:id|name)=["']([^"']+)["']/g ) ) set.add( m[ 1 ] );
	cache.set( file, set );
	return set;

}

let broken = 0;
let checked = 0;

function report( file, line, target, why ) {

	broken ++;
	console.log( `${path.relative( root, file )}:${line}: ${target}  ->  ${why}` );

}

for ( const file of files ) {

	const text = stripCode( fs.readFileSync( file, 'utf8' ) );
	const lineOf = index => text.slice( 0, index ).split( '\n' ).length;
	const targets = [];

	// Inline links/images [text](target "title") and <a href>/<img src>
	for ( const m of text.matchAll( /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g ) ) targets.push( [ m[ 1 ], m.index ] );
	for ( const m of text.matchAll( /<(?:a|img)\s+[^>]*?(?:href|src)=["']([^"']+)["']/g ) ) targets.push( [ m[ 1 ], m.index ] );
	// Reference definitions: [label]: target
	for ( const m of text.matchAll( /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/gm ) ) targets.push( [ m[ 1 ], m.index ] );

	for ( const [ raw, index ] of targets ) {

		if ( /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test( raw ) ) continue;
		checked ++;
		const line = lineOf( index );
		const hash = raw.indexOf( '#' );
		const filePart = decodeURI( hash === - 1 ? raw : raw.slice( 0, hash ) );
		const anchor = hash === - 1 ? '' : decodeURIComponent( raw.slice( hash + 1 ) );
		const target = filePart === '' ? file : path.resolve( path.dirname( file ), filePart );

		if ( ! fs.existsSync( target ) ) {

			report( file, line, raw, 'file not found' );
			continue;

		}
		if ( anchor === '' || ! target.endsWith( '.md' ) ) continue;
		if ( ! anchorsOf( target ).has( anchor.toLowerCase() ) ) report( file, line, raw, 'anchor not found' );

	}

}

console.log( `${checked} relative links checked in ${files.length} files, ${broken} broken.` );
process.exit( broken ? 1 : 0 );
