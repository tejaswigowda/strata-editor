#!/usr/bin/env node
// verify-records.mjs — the checks a records repository runs in CI, and the bot-side steps that keep a record's verification block derived, not typed.
//
//   node scripts/verify-records.mjs [--offline] <record.json> …
//       Validates every record (a pinned and hashed source, a verification block, no camera / controls / renderer settings / history, a recorded packaging
//       choice) and, unless --offline, RE-FETCHES every source and checks its size and sha256. Exits 1 on any problem, and says which record and why.
//       This is the only thing that will ever tell you that an upstream asset changed.
//
//   node scripts/verify-records.mjs --review <base.json> <head.json> --by @name
//       For a pull request that reviews a record: the head must append exactly one review to the base's, earlier ones untouched, by the PR's author, and that
//       review must be the one the label diff amounts to (a confirmation appends too, so agreement is a visible diff).
//
//   node scripts/verify-records.mjs --append-review <base.json> <head.json> --by @name --method anchored|blind [--at 2026-11-02T18:04:00Z]
//       The bot step, run at merge: derives the review from the diff (action and changed from the labels, never typed) and appends it to head.json in place.
//       `--at` is the merge time; it defaults to now.
//
//   node scripts/verify-records.mjs --hash <url>
//       Fetches a file and prints { url, sha256, bytes }: what a record's source needs.
//
//   node scripts/verify-records.mjs --migrate <record.json> --sources <sources.json> [--out <file>]
//       Brings a legacy record to the schema, offline. sources.json maps the legacy source url to { url, sha256, bytes } (the pinned one). Writes --out, or in place.
//
// The schema itself is docs/editor/js/export/records.js; see guides/MESH_SEGMENT.md ("The record as a dataset entry").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const R = await import( pathToFileURL( path.join( here, '..', 'docs', 'editor', 'js', 'export', 'records.js' ) ).href );

const argv = process.argv.slice( 2 );
const flag = ( name ) => { const i = argv.indexOf( name ); return i < 0 ? undefined : argv[ i + 1 ]; };
const has = name => argv.includes( name );
const positional = () => { const out = []; for ( let i = 0; i < argv.length; i ++ ) { if ( argv[ i ].startsWith( '--' ) ) { if ( [ '--by', '--method', '--at', '--out', '--sources', '--hash' ].includes( argv[ i ] ) ) i ++; continue; } out.push( argv[ i ] ); } return out; };
const read = file => JSON.parse( fs.readFileSync( file, 'utf8' ) );
const write = ( file, json ) => fs.writeFileSync( file, JSON.stringify( json ) );          // compact, as the editor saves: parse and stringify give the same bytes, so only real changes diff

async function fetchBytes( url ) {

	let last;
	for ( let attempt = 0; attempt < 3; attempt ++ ) {

		try {

			const res = await fetch( url );
			if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
			return new Uint8Array( await res.arrayBuffer() );

		} catch ( e ) { last = e; await new Promise( r => setTimeout( r, 500 * ( attempt + 1 ) ) ); }

	}
	throw last;

}

const fail = ( msg ) => { console.error( msg ); process.exit( 1 ); };

async function main() {

	if ( has( '--hash' ) ) {

		const url = flag( '--hash' ), bytes = await fetchBytes( url );
		console.log( JSON.stringify( { url, sha256: await R.sha256Hex( bytes ), bytes: bytes.byteLength }, null, 2 ) );
		return;

	}

	if ( has( '--migrate' ) ) {

		const file = flag( '--migrate' ), sources = read( flag( '--sources' ) || fail( '--migrate needs --sources <sources.json>' ) );
		const out = R.migrateRecord( read( file ), sources );
		const problems = R.validateRecordJson( out );
		if ( problems.length ) fail( 'migrated record is not valid:\n  ' + problems.join( '\n  ' ) );
		write( flag( '--out' ) || file, out );
		console.log( `migrated ${ file } → ${ flag( '--out' ) || file }` );
		return;

	}

	if ( has( '--review' ) || has( '--append-review' ) ) {

		const appendMode = has( '--append-review' ), [ baseFile, headFile ] = positional(), by = flag( '--by' );
		if ( ! baseFile || ! headFile || ! by ) fail( 'usage: --review <base.json> <head.json> --by @name' );
		const base = read( baseFile ), head = read( headFile );
		if ( appendMode ) {

			const review = R.deriveReview( base, head, { by, at: flag( '--at' ) || new Date().toISOString().replace( /\.\d+Z$/, 'Z' ), method: flag( '--method' ) } );
			const g = R.segmentationGroups( head )[ 0 ];
			g.userData.segmentation.verification = R.appendReview( g.userData.segmentation.verification, review );
			write( headFile, head );
			console.log( `appended: ${ review.action } by ${ review.by } (${ review.method }), ${ review.changed.length } label change(s); status ${ g.userData.segmentation.verification.status }` );
			return;

		}
		const problems = R.checkReviewPR( base, head, { by } );
		if ( problems.length ) fail( `✗ ${ headFile }:\n  ` + problems.join( '\n  ' ) );
		console.log( `✓ ${ headFile }: one review, by ${ by }, matching the diff` );
		return;

	}

	const files = positional();
	if ( ! files.length ) fail( 'usage: verify-records.mjs [--offline] <record.json> …   (see the header of this file)' );
	const offline = has( '--offline' ), cache = new Map();
	let bad = 0;
	for ( const file of files ) {

		let json;
		try { json = read( file ); } catch ( e ) { console.error( `✗ ${ file }: not JSON (${ e.message })` ); bad ++; continue; }
		const problems = R.validateRecordJson( json ), notes = [];
		if ( ! offline && ! problems.length ) {

			for ( const g of R.segmentationGroups( json ) ) {

				const s = g.userData.segmentation.source;
				if ( ! cache.has( s.url ) ) cache.set( s.url, await R.verifySource( s, fetchBytes ) );
				const v = cache.get( s.url );
				if ( ! v.ok ) problems.push( ...v.problems.map( p => `${ g.name }: ${ p }` ) );
				else if ( v.skipped ) notes.push( `${ g.name }: ${ v.skipped }` );

			}

		}
		if ( problems.length ) { bad ++; console.error( `✗ ${ file }\n  ` + problems.join( '\n  ' ) ); } else console.log( `✓ ${ file }${ offline ? ' (offline: sources not re-fetched)' : notes.length ? ' (' + notes.join( '; ' ) + ')' : ' (sources re-fetched: size and sha256 match)' }` );

	}
	if ( bad ) { console.error( `\n${ bad } of ${ files.length } record(s) failed` ); process.exit( 1 ); }

}

main().catch( e => fail( '✗ ' + e.message ) );
