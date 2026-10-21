// Regenerates the parameter tables in the guides from the shader registry, so the docs cannot drift.
//
//   node scripts/gen-shader-docs.mjs           rewrite the tables in place
//   node scripts/gen-shader-docs.mjs --check   change nothing; exit 1 when a guide is stale
//
// Each table sits between <!-- shader-docs:NAME:start --> and <!-- shader-docs:NAME:end -->.
// What is generated, and which guide carries which block, is in docs/editor/js/shaders/shaderDocs.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DOC_FILES, rewriteDocs } from '../docs/editor/js/shaders/shaderDocs.js';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const check = process.argv.includes( '--check' );
let stale = 0;

for ( const [ file, names ] of Object.entries( DOC_FILES ) ) {

	const path = join( root, file );
	const before = readFileSync( path, 'utf8' );
	const after = rewriteDocs( before, names );

	if ( after === before ) {

		console.log( `up to date  ${ file }` );
		continue;

	}

	stale ++;
	if ( check ) console.log( `STALE       ${ file } (run: node scripts/gen-shader-docs.mjs)` );
	else {

		writeFileSync( path, after );
		console.log( `rewrote     ${ file }` );

	}

}

process.exit( check && stale ? 1 : 0 );
