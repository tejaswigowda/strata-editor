// ── genThreeApi.cjs ─────────────────────────────────────────────────────────────
// One-time / on-demand generator: flattens the tern three.js typedef tree
// (docs/editor/js/libs/tern-threejs/threejs.js) into a compact, retrievable API
// index for the RAG (apiIndex.js). Emits docs/editor/js/ai/threejsApi.js.
//
// Run:  node scripts/genThreeApi.cjs
//
// Output chunk shape: { name, kind, sig, use }
//   kind = 'three-class' | 'three-method' | 'three-prop'
// These feed RETRIEVAL ONLY — they are NOT added to the validation allow-list
// (that stays tied to the classes actually exposed as shell globals).

const fs = require( 'fs' );
const vm = require( 'vm' );
const path = require( 'path' );

const ROOT = path.resolve( __dirname, '..' );
const TERN = path.join( ROOT, 'docs/editor/js/libs/tern-threejs/threejs.js' );
const OUT  = path.join( ROOT, 'docs/editor/js/ai/threejsApi.js' );

// ── 1. Capture the tern `defs` by stubbing the tern plugin host ──────────────────
function loadDefs() {

	const src = fs.readFileSync( TERN, 'utf8' );
	let captured = null;
	const sandbox = {
		tern: { registerPlugin: ( _name, fn ) => { captured = fn( {}, {} ); } },
		define: undefined, exports: undefined, module: undefined,
	};
	vm.createContext( sandbox );
	vm.runInContext( src, sandbox );
	if ( ! captured || ! captured.defs || ! captured.defs.THREE ) {

		throw new Error( 'could not capture THREE defs from tern file' );

	}
	return captured.defs.THREE;

}

// ── 2. Formatting helpers ────────────────────────────────────────────────────────

// "+THREE.Vector3" → "Vector3", "[+THREE.Face3]" → "Face3[]", "todo" → "*"
function cleanType( t ) {

	if ( ! t ) return '*';
	let s = String( t ).trim();
	const arr = /^\[(.*)\]$/.exec( s );
	if ( arr ) return cleanType( arr[ 1 ] ) + '[]';
	s = s.replace( /^\+/, '' ).replace( /THREE\./g, '' );
	if ( s === 'todo' || s === '?' ) return '*';
	return s;

}

// Parse a tern "fn(a: T, b: U) -> R" type into { params, ret }.
function parseFn( type ) {

	const m = /^fn\((.*)\)(?:\s*->\s*(.+))?$/s.exec( String( type ).trim() );
	if ( ! m ) return null;
	const inside = m[ 1 ].trim();
	const ret = m[ 2 ] ? cleanType( m[ 2 ] ) : '';

	// Split params on top-level commas (types may contain "+THREE.X", no nested parens here).
	const params = [];
	if ( inside ) {

		let depth = 0, start = 0;
		for ( let i = 0; i < inside.length; i ++ ) {

			const c = inside[ i ];
			if ( c === '(' || c === '[' || c === '<' ) depth ++;
			else if ( c === ')' || c === ']' || c === '>' ) depth --;
			else if ( c === ',' && depth === 0 ) { params.push( inside.slice( start, i ) ); start = i + 1; }

		}
		params.push( inside.slice( start ) );

	}
	const fmt = params.map( p => {

		const idx = p.indexOf( ':' );
		if ( idx === - 1 ) return p.trim();
		return p.slice( 0, idx ).trim() + ': ' + cleanType( p.slice( idx + 1 ) );

	} ).filter( Boolean );

	return { params: fmt.join( ', ' ), ret };

}

// Strip tern/HTML doc noise → short single line.
function cleanDoc( doc, max = 140 ) {

	if ( ! doc ) return '';
	let s = String( doc );
	s = s.replace( /\[(?:page|link|name):([^\]]*)\]/g, ( _m, inner ) => inner.split( /\s+/ ).pop() ); // [page:Vector3 v] → v
	s = s.replace( /<[^>]+>/g, ' ' );                 // HTML tags
	s = s.replace( /&[a-z]+;/g, ' ' );                // entities
	s = s.replace( /\s+/g, ' ' ).trim();
	if ( s.toLowerCase() === 'todo' ) return '';
	if ( s.length > max ) s = s.slice( 0, max - 1 ).trimEnd() + '…';
	return s;

}

// ── 3. Walk classes → chunks ─────────────────────────────────────────────────────

function build() {

	const THREE = loadDefs();
	const chunks = [];

	for ( const className of Object.keys( THREE ) ) {

		if ( className.startsWith( '!' ) ) continue;
		const def = THREE[ className ];
		if ( ! def || typeof def !== 'object' ) continue;

		// Class / constructor chunk
		const ctorDoc = cleanDoc( def[ '!doc' ] );
		const ctorType = def[ '!type' ];
		if ( ctorType && /^fn\(/.test( ctorType ) ) {

			const fn = parseFn( ctorType );
			const sig = `new ${ className }(${ fn ? fn.params : '' })`;
			chunks.push( { name: className, kind: 'three-class', sig, use: ctorDoc } );

		} else if ( ctorDoc ) {

			// Namespace / enum / constant grouping
			chunks.push( { name: className, kind: 'three-class', sig: className, use: ctorDoc } );

		}

		// Prototype members
		const proto = def.prototype;
		if ( proto && typeof proto === 'object' ) {

			for ( const member of Object.keys( proto ) ) {

				if ( member.startsWith( '!' ) ) continue;
				const mdef = proto[ member ];
				if ( ! mdef || typeof mdef !== 'object' ) continue;

				const mdoc = cleanDoc( mdef[ '!doc' ] );
				const mtype = mdef[ '!type' ];

				if ( mtype && /^fn\(/.test( mtype ) ) {

					const fn = parseFn( mtype );
					const ret = fn && fn.ret ? ' -> ' + fn.ret : '';
					chunks.push( {
						name: `${ className }.${ member }`,
						kind: 'three-method',
						sig: `${ className }.${ member }(${ fn ? fn.params : '' })${ ret }`,
						use: mdoc,
					} );

				} else {

					const ty = cleanType( mtype );
					chunks.push( {
						name: `${ className }.${ member }`,
						kind: 'three-prop',
						sig: `${ className }.${ member }: ${ ty }`,
						use: mdoc,
					} );

				}

			}

		}

	}

	return chunks;

}

// ── 4. Emit ──────────────────────────────────────────────────────────────────────

function main() {

	const chunks = build();
	const header =
`// ── threejsApi.js ───────────────────────────────────────────────────────────────
// AUTO-GENERATED from libs/tern-threejs/threejs.js — DO NOT EDIT BY HAND.
// Regenerate:  node scripts/genThreeApi.cjs
//
// Flattened, retrievable three.js API signatures + docs for the RAG (apiIndex.js).
// RETRIEVAL ONLY — not part of the validation allow-list.
// ${ chunks.length } chunks.

export const THREEJS_API = `;

	const body = JSON.stringify( chunks, null, 0 );
	fs.writeFileSync( OUT, header + body + ';\n' );
	console.log( `wrote ${ chunks.length } chunks → ${ path.relative( ROOT, OUT ) } (${ ( body.length / 1024 ).toFixed( 0 ) } KB)` );

}

main();
