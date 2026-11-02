// An in-memory GitHub, enough of the git data API for releases.js: refs (heads, tags, matching-refs), blobs, trees (base_tree, deletions, <sha>:<path> reads),
// commits, fast-forward-only branch moves, 422 on creating a tag that exists, PUT contents. Behaviour follows the documented API; the real one is exercised by
// the end-to-end run recorded in guides/PUBLISH.md.
import { createHash } from 'node:crypto';

const sha = s => createHash( 'sha1' ).update( s ).digest( 'hex' );
const err = ( status, message ) => Object.assign( new Error( `GitHub ${ status }: ${ message }` ), { status } );

export function fakeGithub( { repos = {} } = {} ) {

	// repos: { 'owner/name': { empty?: true } }
	const state = {};
	const calls = [];
	const R = full => {

		if ( ! state[ full ] ) {

			if ( ! repos[ full ] ) throw err( 404, 'Not Found' );
			state[ full ] = { blobs: {}, trees: {}, commits: {}, refs: {}, empty: !! repos[ full ].empty };
			if ( ! state[ full ].empty ) seed( state[ full ], repos[ full ].files || { 'README.md': 'hello' } );

		}
		return state[ full ];

	};

	function putTree( r, entries ) {

		const sorted = [ ...entries ].sort( ( a, b ) => ( a.path < b.path ? -1 : 1 ) );
		const id = sha( 'tree:' + JSON.stringify( sorted ) );
		r.trees[ id ] = sorted;
		return id;

	}
	function seed( r, files ) {

		const entries = Object.entries( files ).map( ( [ path, text ] ) => ( { path, type: 'blob', mode: '100644', sha: putBlob( r, Buffer.from( text ).toString( 'base64' ) ) } ) );
		const tree = buildTree( r, entries );
		const c = sha( 'commit:seed' + Math.random() );
		r.commits[ c ] = { sha: c, tree: { sha: tree }, parents: [], message: 'seed' };
		r.refs[ 'refs/heads/main' ] = c;

	}
	function putBlob( r, b64 ) { const id = sha( 'blob:' + b64 ); r.blobs[ id ] = b64; return id; }

	// nested trees from flat paths
	function buildTree( r, flat ) {

		const root = { files: [], dirs: {} };
		for ( const e of flat ) {

			const parts = e.path.split( '/' );
			let node = root;
			for ( const d of parts.slice( 0, - 1 ) ) node = node.dirs[ d ] = node.dirs[ d ] || { files: [], dirs: {} };
			node.files.push( { ...e, path: parts[ parts.length - 1 ] } );

		}
		const make = n => putTree( r, [ ...n.files.map( f => ( { path: f.path, mode: f.mode, type: 'blob', sha: f.sha } ) ), ...Object.entries( n.dirs ).map( ( [ d, c ] ) => ( { path: d, mode: '040000', type: 'tree', sha: make( c ) } ) ) ] );
		return make( root );

	}
	function flatten( r, treeSha, prefix = '' ) {

		const out = [];
		for ( const e of r.trees[ treeSha ] ) {

			if ( e.type === 'tree' ) out.push( ...flatten( r, e.sha, prefix + e.path + '/' ) );
			else out.push( { ...e, path: prefix + e.path } );

		}
		return out;

	}
	const subtree = ( r, treeSha, path ) => {

		let t = treeSha;
		for ( const seg of path.split( '/' ).filter( Boolean ) ) {

			const e = ( r.trees[ t ] || [] ).find( x => x.path === seg && x.type === 'tree' );
			if ( ! e ) return null;
			t = e.sha;

		}
		return t;

	};

	async function handle( method, path, body ) {

		calls.push( { method, path, body } );
		const [ pathname, query ] = path.split( '?' );
		const m = /^\/repos\/([^/]+\/[^/]+)\/(.*)$/.exec( pathname );
		if ( ! m ) throw err( 404, 'Not Found' );
		const r = R( m[ 1 ] ), rest = decodeURIComponent( m[ 2 ] );

		let x;
		if ( ( x = /^git\/matching-refs\/(.*)$/.exec( rest ) ) && method === 'GET' ) {

			return Object.entries( r.refs ).filter( ( [ k ] ) => k.startsWith( 'refs/' + x[ 1 ] ) ).map( ( [ ref, s ] ) => ( { ref, object: { type: 'commit', sha: s } } ) );

		}
		if ( ( x = /^git\/ref\/(.*)$/.exec( rest ) ) && method === 'GET' ) {

			if ( r.empty ) throw err( 409, 'Git Repository is empty.' );
			const s = r.refs[ 'refs/' + x[ 1 ] ];
			if ( ! s ) throw err( 404, 'Not Found' );
			return { ref: 'refs/' + x[ 1 ], object: { type: 'commit', sha: s } };

		}
		if ( ( x = /^git\/commits\/([0-9a-f]+)$/.exec( rest ) ) && method === 'GET' ) {

			if ( ! r.commits[ x[ 1 ] ] ) throw err( 404, 'Not Found' );
			return r.commits[ x[ 1 ] ];

		}
		if ( ( x = /^git\/trees\/([^:]+)(?::(.*))?$/.exec( rest ) ) && method === 'GET' ) {

			let t = x[ 1 ];
			if ( x[ 2 ] ) t = subtree( r, t, x[ 2 ] );
			if ( ! t || ! r.trees[ t ] ) throw err( 404, 'Not Found' );
			return { sha: t, tree: query && /recursive=1/.test( query ) ? flatten( r, t ) : r.trees[ t ], truncated: false };

		}
		if ( rest === 'git/blobs' && method === 'POST' ) return { sha: putBlob( r, body.content ) };
		if ( rest === 'git/trees' && method === 'POST' ) {

			const base = body.base_tree ? flatten( r, body.base_tree ) : [];
			const map = new Map( base.map( e => [ e.path, e ] ) );
			for ( const it of body.tree ) { if ( it.sha === null ) map.delete( it.path ); else map.set( it.path, { path: it.path, mode: it.mode, type: 'blob', sha: it.sha } ); }
			return { sha: buildTree( r, [ ...map.values() ] ) };

		}
		if ( rest === 'git/commits' && method === 'POST' ) {

			const c = sha( 'commit:' + JSON.stringify( body ) + r.commits.length + Math.random() );
			r.commits[ c ] = { sha: c, tree: { sha: body.tree }, parents: body.parents.map( p => ( { sha: p } ) ), message: body.message };
			return { sha: c };

		}
		if ( rest === 'git/refs' && method === 'POST' ) {

			if ( r.refs[ body.ref ] ) throw err( 422, 'Reference already exists' );
			if ( ! r.commits[ body.sha ] ) throw err( 422, 'Object does not exist' );
			r.refs[ body.ref ] = body.sha;
			return { ref: body.ref, object: { sha: body.sha } };

		}
		if ( ( x = /^git\/refs\/(.*)$/.exec( rest ) ) && method === 'PATCH' ) {

			const ref = 'refs/' + x[ 1 ];
			if ( ref.startsWith( 'refs/tags/' ) && ! body.force ) { /* real GitHub allows it; releases.js must simply never ask */ }
			const cur = r.refs[ ref ];
			if ( ! cur ) throw err( 422, 'Reference does not exist' );
			// fast-forward only unless forced
			let c = body.sha, ok = c === cur || !! body.force;
			for ( let i = 0; ! ok && c && i < 1000; i ++ ) { const p = r.commits[ c ] && r.commits[ c ].parents[ 0 ]; c = p && p.sha; if ( c === cur ) ok = true; }
			if ( ! ok ) throw err( 422, 'Update is not a fast forward' );
			r.refs[ ref ] = body.sha;
			return { ref, object: { sha: body.sha } };

		}
		if ( ( x = /^contents\/(.*)$/.exec( rest ) ) && method === 'PUT' ) {

			if ( r.empty ) { r.empty = false; r.refs = {}; seed( r, {} ); }
			const blob = putBlob( r, body.content );
			const head = r.refs[ 'refs/heads/' + ( body.branch || 'main' ) ];
			const files = flatten( r, r.commits[ head ].tree.sha ).filter( e => e.path !== x[ 1 ] );
			files.push( { path: x[ 1 ], mode: '100644', type: 'blob', sha: blob } );
			const tree = buildTree( r, files );
			const c = sha( 'commit:contents' + Math.random() );
			r.commits[ c ] = { sha: c, tree: { sha: tree }, parents: [ { sha: head } ], message: body.message };
			r.refs[ 'refs/heads/' + ( body.branch || 'main' ) ] = c;
			return { commit: { sha: c } };

		}
		throw err( 404, `fake github: ${ method } ${ path } not implemented` );

	}

	return {
		api: { get: p => handle( 'GET', p ), send: ( m, p, b ) => handle( m, p, b ) },
		calls, state,
		/** the files at a ref, as { path: Buffer } */
		files( full, ref ) {

			const r = R( full ), c = r.refs[ ref ];
			return Object.fromEntries( flatten( r, r.commits[ c ].tree.sha ).map( e => [ e.path, Buffer.from( r.blobs[ e.sha ], 'base64' ) ] ) );

		},
		refs: full => ( { ...R( full ).refs } ),
		/** simulate somebody else pushing to the branch between plan and commit */
		pushElsewhere( full, branch = 'main' ) {

			const r = R( full ), head = r.refs[ 'refs/heads/' + branch ];
			const tree = r.commits[ head ].tree.sha;
			const c = sha( 'commit:other' + Math.random() );
			r.commits[ c ] = { sha: c, tree: { sha: tree }, parents: [ { sha: head } ], message: 'someone else' };
			r.refs[ 'refs/heads/' + branch ] = c;
			return c;

		},
		/** simulate somebody creating the tag between plan and commit */
		createTagElsewhere( full, tag ) { const r = R( full ); r.refs[ 'refs/tags/' + tag ] = r.refs[ 'refs/heads/main' ]; },
	};

}
