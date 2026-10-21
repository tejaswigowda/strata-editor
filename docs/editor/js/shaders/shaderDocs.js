// ── shaderDocs.js ─────────────────────────────────────────────────────────────
// Everything a person reads about the shader verbs, generated from the registry in shaderSpec.js
// so the docs cannot drift from the code. Pure (no DOM, no three.js): the shell's help(), the
// guide generator (scripts/gen-shader-docs.mjs) and the node tests all use it.
//
//   helpTopic( name )     lines for help('shader'), help('mtoon'), help('fresnel'), ... or null
//   helpIndex()           the main verbs, grouped (help() with no argument)
//   renderSection( name ) a markdown table for a <!-- shader-docs:name:start --> block
//   rewriteDocs( text, names )  that file's marked blocks, regenerated

import { SHADERS, SHADER_GROUPS, getShaderDef, aliasesOf, didYouMean, legalParamsText } from './shaderSpec.js';

/** What every applying verb returns. */
export const RESULT_SHAPE = '{ id, params, meshes, materials }';

const VERBS = {

	shader: {
		sig: 'shader( target, shader, params?, opts? )',
		returns: RESULT_SHAPE,
		desc: 'Give every mesh under target a shader, as one undo step.',
	},
	mtoon: {
		sig: 'mtoon( target, spec?, opts? )',
		returns: RESULT_SHAPE,
		desc: 'shader( target, \'mtoon\', spec ): the VRM anime toon with banded shading, rim light and outlines.',
	},
	toon: {
		sig: 'toon( target, spec?, opts? )',
		returns: RESULT_SHAPE,
		desc: 'The same as mtoon( target, spec ). spec may add look: \'native\' (or be the string \'native\') to revert, which acts like unshader( target ).',
	},
	toonMaterial: {
		sig: 'toonMaterial( color?, spec? )',
		returns: 'THREE.Material',
		desc: 'A standalone toon material for a new Mesh; spec is checked the same way as mtoon\'s.',
	},
	unshader: {
		sig: 'unshader( target, opts? )',
		returns: '{ id: \'original\', params: {}, meshes, materials }',
		desc: 'Back to the original materials, as one undo step. meshes is how many were restored.',
	},
	shaders: {
		sig: 'shaders()',
		returns: 'Array<{ id, label, group, persist, desc, params, nested? }>',
		desc: 'The registry: every shader with its parameters, ranges and defaults.',
	},

};

const TARGET = 'target  an object, an array, a $S() set, or a name / selector string (a name is tried first)';
const OPTS = 'opts    { scope: \'self\' (just that mesh, not its children), skipOutlines: true, filter( mesh ) }';
const RULES = 'Unknown keys throw (with a suggestion); wrong types throw; numbers are clamped to their range. Nothing changes if it throws.';

const num = n => String( Math.round( n * 10000 ) / 10000 );

function paramType( p ) {

	if ( p.type === 'number' ) return 'number';
	if ( p.type === 'select' ) return 'choice';
	return p.type;

}

function paramRange( p ) {

	if ( p.type === 'number' ) return `${ num( p.min ) } … ${ num( p.max ) }`;
	if ( p.type === 'select' ) return p.options.join( ' · ' );
	return p.type === 'color' ? '#rrggbb' : '';

}

const lit = v => ( typeof v === 'string' ? `'${ v }'` : String( v ) );

function nestedOf( def, key ) {

	for ( const [ g, keys ] of Object.entries( def.nested || {} ) ) for ( const [ nk, fk ] of Object.entries( keys ) ) if ( fk === key ) return `${ g }.${ nk }`;
	return '';

}

function paramLines( def ) {

	if ( ! def.params.length ) return [ '  (no parameters)' ];
	const rows = def.params.map( p => [ p.key, nestedOf( def, p.key ), paramType( p ), paramRange( p ), lit( p.default ), p.label ] );
	const w = i => Math.max( ...rows.map( r => r[ i ].length ) );
	const widths = [ 0, 1, 2, 3, 4 ].map( w );
	return rows.map( r => '  ' + r.slice( 0, 5 ).map( ( c, i ) => c.padEnd( widths[ i ] ) ).join( '  ' ) + '  ' + r[ 5 ] );

}

function exampleFor( def ) {

	const first = def.params[ 0 ];
	const bits = [];
	if ( first ) bits.push( `${ first.key }: ${ lit( first.default ) }` );
	const g = Object.entries( def.nested || {} )[ 0 ];
	if ( g ) bits.push( `${ g[ 0 ] }: { ${ Object.keys( g[ 1 ] )[ 0 ] }: ${ lit( def.params.find( p => p.key === Object.values( g[ 1 ] )[ 0 ] ).default ) } }` );
	return `shader( target, '${ def.id }'${ bits.length ? `, { ${ bits.join( ', ' ) } }` : '' } )`;

}

function shaderLines( def ) {

	const aliases = aliasesOf( def.id );
	const out = [
		`${ def.id }  —  ${ def.label } (${ def.group })${ aliases.length ? `  aliases: ${ aliases.join( ', ' ) }` : '' }`,
		`  ${ def.desc }`,
		'',
		'  params' + ( def.nested ? ' (flat key, nested spelling)' : '' ) + ':',
		...paramLines( def ),
	];
	if ( def.id === 'mtoon' ) out.push( '', '  also: bands: 2 (= toony 1), look: \'toon\'. Only the params you give are applied; a model\'s own MToon values survive.' );
	if ( def.nested ) out.push( '', '  ' + legalParamsText( def ) );
	out.push( '', '  e.g. ' + exampleFor( def ) );
	return out;

}

function verbLines( name ) {

	const v = VERBS[ name ];
	const out = [ `${ v.sig }  →  ${ v.returns }`, `  ${ v.desc }` ];
	if ( name === 'shader' ) {

		out.push(
			'', '  ' + TARGET,
			'  shader  an id or alias from shaders(), a THREE.Material (shared by every mesh), or (sourceMaterial) => Material',
			'  params  that shader\'s parameters; help( \'<id>\' ) lists them',
			'  ' + OPTS,
			'', '  ' + RULES,
			'', '  shaders:' );
		for ( const g of SHADER_GROUPS ) {

			const ids = SHADERS.filter( s => s.group === g ).map( s => s.id );
			if ( ids.length ) out.push( `    ${ g.padEnd( 8 ) } ${ ids.join( ', ' ) }` );

		}

	} else if ( name === 'mtoon' || name === 'toon' ) {

		out.push( '', '  ' + TARGET, '  ' + OPTS, '', '  ' + RULES, '', ...shaderLines( getShaderDef( 'mtoon' ) ).slice( 3 ) );

	} else if ( name === 'unshader' ) out.push( '', '  ' + TARGET, '  ' + OPTS.replace( 'skipOutlines: true, ', '' ) );

	return out;

}

/** Lines for help( name ), or null when the registry and verbs know nothing by that name. */
export function helpTopic( name ) {

	if ( typeof name !== 'string' ) return null;
	const key = name.trim();
	if ( VERBS[ key ] ) return verbLines( key );
	const def = getShaderDef( key );
	return def ? shaderLines( def ) : null;

}

/** Every name help() can explain. */
export function helpTopics() {

	return [ ...Object.keys( VERBS ), ...SHADERS.map( s => s.id ) ];

}

/** The message for a help( name ) that matched nothing. */
export function helpMissing( name ) {

	const near = typeof name === 'string' ? didYouMean( name, helpTopics() ) : null;
	return `help: no topic ${ JSON.stringify( name ) }${ near ? ` — did you mean "${ near }"?` : '.' } help() lists the main commands.`;

}

/** The main verbs, grouped (help() with no argument). Each line is one group. */
export function helpIndex() {

	return [
		'Strata shell — typing JavaScript works as-is; the AI helper is optional.  help( \'name\' ) explains one command.',
		'look & shaders:  shader( target, id, params )  mtoon( target, spec )  toon( target, spec )  unshader( target )  shaders()   — help( \'shader\' ), help( \'mtoon\' ), help( \'fresnel\' ) …',
	];

}

// ── Markdown (the guides) ─────────────────────────────────────────────────────

const cell = s => String( s ).replace( /\|/g, '\\|' );
const code = s => ( s === '' ? '' : '`' + s + '`' );

function mtoonTable() {

	const def = getShaderDef( 'mtoon' );
	const rows = def.params.map( p => `| ${ [ code( p.key ), code( nestedOf( def, p.key ) ), paramType( p ), p.type === 'color' ? '`#rrggbb`' : code( paramRange( p ).replace( / … /, ' to ' ) ), code( lit( p.default ) ), p.label ].map( cell ).join( ' | ' ) } |` );
	return [
		'| Flat | Nested | Type | Range | Default | Meaning |',
		'|---|---|---|---|---|---|',
		...rows,
		'',
		'Flat and nested spellings (and mixes) mean the same thing; give a setting once. `bands: 2` is `toony: 1`.',
		'Numbers outside the range are clamped, unknown keys are refused with a suggestion.',
	].join( '\n' );

}

function builtinTable() {

	const rows = [];
	for ( const g of SHADER_GROUPS ) {

		for ( const s of SHADERS.filter( x => x.group === g ) ) {

			const aliases = aliasesOf( s.id );
			const params = s.params.map( p => `\`${ p.key }\` ${ p.type === 'number' ? '(' + num( p.min ) + ' to ' + num( p.max ) + ', ' : '(' }${ p.type === 'select' ? p.options.join( '/' ) + ', ' : '' }default ${ lit( p.default ) })` ).join( ', ' );
			rows.push( `| \`${ s.id }\` | ${ g } | ${ aliases.map( code ).join( ', ' ) } | ${ cell( s.desc ) } | ${ params ? cell( params ) : 'none' } |` );

		}

	}
	return [ '| Id | Group | Aliases | What it is | Parameters |', '|---|---|---|---|---|', ...rows ].join( '\n' );

}

const SECTIONS = { builtin: builtinTable, mtoon: mtoonTable };

/** The markdown for the block named `name`. */
export function renderSection( name ) {

	if ( ! SECTIONS[ name ] ) throw new Error( `shader-docs: no section "${ name }"` );
	return SECTIONS[ name ]();

}

/** Which blocks each guide carries (paths from the repo root). */
export const DOC_FILES = {
	'guides/SHADERS.md': [ 'builtin', 'mtoon' ],
	'guides/TOON_LOOK.md': [ 'mtoon' ],
};

const marker = ( name, end ) => `<!-- shader-docs:${ name }:${ end ? 'end' : 'start' } -->`;

/** Regenerate the named blocks inside `text`. Throws when a block's markers are missing. */
export function rewriteDocs( text, names ) {

	let out = text;
	for ( const name of names ) {

		const a = out.indexOf( marker( name ) );
		const b = out.indexOf( marker( name, true ) );
		if ( a < 0 || b < a ) throw new Error( `shader-docs: the markers ${ marker( name ) } … ${ marker( name, true ) } are missing` );
		out = out.slice( 0, a + marker( name ).length ) + '\n' + renderSection( name ) + '\n' + out.slice( b );

	}
	return out;

}
