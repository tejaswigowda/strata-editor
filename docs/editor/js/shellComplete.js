// shellComplete.js — what the Shell's autocomplete knows, as pure functions (no DOM), so it can be tested in node.
//
// The Shell used to show the first 24 words of a static list whenever the line was empty, and filtered by prefix after that. This module adds:
//   • fuzzy ranking (prefix, then word initials, then substring, then letters in order), boosted by what the user has typed before;
//   • member completion after `name.` for the real objects of the page (Math, THREE, editor, scene, …) by reading them, and for SEG;
//   • knowing where the cursor is in a call: the signature of the function, and the values its argument takes (colours, axes, light kinds, selectors);
//   • starters for an empty line, made from what is selected, what is in the scene and what was typed recently, instead of a word list.

// ── ranking ──────────────────────────────────────────────────────────────────────────────────────

/** Where the words of an identifier start: camelCase humps, `_`, `-`, `.` and digits. */
function wordStarts( w ) {

	const out = [ 0 ];
	for ( let i = 1; i < w.length; i ++ ) {

		const p = w[ i - 1 ], c = w[ i ];
		if ( /[_\-.\s#]/.test( p ) && /\w/.test( c ) ) out.push( i );
		else if ( /[a-z0-9]/.test( p ) && /[A-Z]/.test( c ) ) out.push( i );

	}
	return out;

}

/** A score for how well `query` matches `word`, or null. Higher is better. Prefix beats initials beats substring beats letters in order. */
export function fuzzyScore( query, word ) {

	if ( ! query ) return 0;
	const q = query.toLowerCase(), w = word.toLowerCase();
	let s = null;
	if ( word.startsWith( query ) ) s = 100;
	else if ( w.startsWith( q ) ) s = 90;
	else {

		// the query as the starts of words: "sc" → setScale, "mt" → moveTo, "pc" → Avocado_Pit_Cavity
		const starts = wordStarts( word );
		let qi = 0, last = - 1;
		for ( const st of starts ) { if ( qi < q.length && w[ st ] === q[ qi ] ) { qi ++; last = st; } }
		if ( qi === q.length && q.length >= 2 ) s = 70 - Math.min( 10, last / 4 );
		else {

			const at = w.indexOf( q );
			if ( at >= 0 ) s = 55 - Math.min( 20, at );
			else if ( q.length >= 3 ) {

				let j = 0, gaps = 0, prev = - 1;
				for ( let i = 0; i < w.length && j < q.length; i ++ ) if ( w[ i ] === q[ j ] ) { if ( prev >= 0 && i - prev > 1 ) gaps ++; prev = i; j ++; }
				if ( j === q.length ) s = Math.max( 5, 30 - gaps * 4 );

			}

		}

	}
	return s === null ? null : s - word.length * 0.01;

}

/** How much the user's own history favours a word: 0 to 6, by how often (and how recently) it was typed. `history` is the list of past commands, oldest first. */
export function historyBoosts( history ) {

	const boost = new Map(), n = history.length;
	history.forEach( ( line, i ) => {

		const recency = 0.5 + 0.5 * ( ( i + 1 ) / Math.max( 1, n ) );
		const words = [ ...String( line ).matchAll( /[A-Za-z_$][\w$]*/g ) ].map( m => m[ 0 ] );
		const selectors = [ ...String( line ).matchAll( /['"]([#.][\w-]+)/g ) ].map( m => m[ 1 ] );      // '.wing' and '#Duck' as typed in a selector
		for ( const w of [ ...words, ...selectors ] ) boost.set( w, ( boost.get( w ) || 0 ) + recency );

	} );
	for ( const [ k, v ] of boost ) boost.set( k, Math.min( 6, Math.log2( 1 + v ) * 2 ) );
	return boost;

}

/** Rank items ({ w, ... }) against a prefix. With no prefix the order is kept (the caller has already put the useful ones first). */
export function rankItems( prefix, items, { boosts = new Map(), limit = 24 } = {} ) {

	if ( ! prefix ) return items.slice( 0, limit );
	const out = [];
	for ( const item of items ) {

		const s = fuzzyScore( prefix, item.w );
		if ( s !== null ) out.push( { item, s: s + ( boosts.get( item.w ) || 0 ) + ( item.rank || 0 ) } );

	}
	out.sort( ( a, b ) => b.s - a.s || a.item.w.localeCompare( b.item.w ) );
	return out.slice( 0, limit ).map( x => x.item );

}

// ── where the cursor is ──────────────────────────────────────────────────────────────────────────

/**
 * The innermost call the cursor is inside, read from the text before it: { fn: 'SEG.split', name: 'split', argIndex, quote, text }.
 * `quote` is the open quote character when the cursor is inside a string argument, and `text` what is typed in it so far. Null when not inside a call.
 */
export function enclosingCall( before ) {

	const stack = [];          // open brackets: { ch, at, commas }
	let quote = null, strStart = 0;
	for ( let i = 0; i < before.length; i ++ ) {

		const c = before[ i ];
		if ( quote ) { if ( c === '\\' ) i ++; else if ( c === quote ) quote = null; continue; }
		if ( c === '"' || c === "'" || c === '`' ) { quote = c; strStart = i + 1; continue; }
		if ( c === '/' && before[ i + 1 ] === '/' ) { const nl = before.indexOf( '\n', i ); if ( nl < 0 ) return null; i = nl; continue; }
		if ( c === '(' || c === '[' || c === '{' ) stack.push( { ch: c, at: i, commas: 0 } );
		else if ( c === ')' || c === ']' || c === '}' ) stack.pop();
		else if ( c === ',' && stack.length ) stack[ stack.length - 1 ].commas ++;

	}
	for ( let k = stack.length - 1; k >= 0; k -- ) {

		if ( stack[ k ].ch !== '(' ) continue;
		const head = before.slice( 0, stack[ k ].at ).match( /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*$/ );
		if ( ! head ) return null;
		const fn = head[ 1 ].replace( /\s+/g, '' );
		// a bracket opened after this call's own parenthesis (an array or object argument) belongs to the argument, not to a new call
		const inner = stack.slice( k + 1 ).length > 0;
		return { fn, name: fn.split( '.' ).pop(), argIndex: stack[ k ].commas, quote: inner ? null : quote, text: inner || ! quote ? '' : before.slice( strStart ), nested: inner };

	}
	return null;

}

/** After `a.b.pre` (not after a `)`): { path: ['a', 'b'], prefix: 'pre' }, else null. */
export function memberContext( before ) {

	const m = before.match( /(^|[^\w$.)\]'"`])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([\w$]*)$/ );
	if ( ! m ) return null;
	return { path: m[ 2 ].split( '.' ), prefix: m[ 3 ] };

}

// ── the values arguments take ────────────────────────────────────────────────────────────────────

export const COLOR_NAMES = [ 'red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'navy', 'purple', 'magenta', 'pink', 'brown', 'white', 'black', 'gray', 'silver', 'gold', 'crimson', 'coral', 'salmon', 'khaki', 'olive', 'indigo', 'violet', 'tan', 'beige', 'maroon' ];
export const COLOR_ARGS = new Set( [ 'recolor', 'setColor', 'emissive', 'lightColor', 'groundColor', 'setBackground', 'setFog' ] );

/** Fixed choices for a string argument: `fn:argIndex` → values. */
export const ARG_ENUMS = {
	'rotate:0': [ 'x', 'y', 'z' ], 'spin:0': [ 'x', 'y', 'z' ], 'scale:1': [ 'x', 'y', 'z' ],
	'addLight:0': [ 'directional', 'point', 'spot', 'ambient', 'hemisphere' ],
	'cameraMove:0': [ 'push', 'pull', 'orbit', 'truck', 'crane', 'drift' ],
	'selectKey:1': [ 'key', 'look' ],
	'simplify:0': [ 'tight', 'normal', 'loose' ],
	'relabel:0': [], 'help:0': [ 'selectors', 'ops', 'shaders', 'animation', 'camera', 'seg' ]
};

/** Signatures the member lists and the call hints know besides the ones in the word lists. */
export const STATIC_MEMBERS = {
	SEG: [
		{ w: 'describe', h: "(selector, k = 3)  the islands (or materials) of a mesh: size, centre, colours", rank: 3 },
		{ w: 'split', h: "(selector, { group, classes, source: { url, licence, attribution }, parts: [ { island, name, classes } | { island, subdivide, palette } ] })", rank: 3 },
		{ w: 'byMaterial', h: "(selector, { group, source, parts? })  one part per material", rank: 2 },
		{ w: 'replay', h: "(selector, record)  cut again from a recorded plan", rank: 1 },
		{ w: 'preview', h: "(groupSelector)  a flat colour per part", rank: 2 },
		{ w: 'restore', h: "()  the textured materials back", rank: 2 },
		{ w: 'data', h: "(selector, k = 3)  the report as objects" }
	]
};

/** A signature for a call, from the tables the Shell already has: ({ word → hint }, name, fn) → '(…)' or null. */
export function signatureFor( call, hintOf ) {

	if ( ! call ) return null;
	const stat = STATIC_MEMBERS[ call.fn.split( '.' )[ 0 ] ];
	if ( stat && call.fn.includes( '.' ) ) { const m = stat.find( x => x.w === call.name ); if ( m ) return { name: call.fn, sig: m.h }; }
	const h = hintOf( call.name );
	return h ? { name: call.name, sig: h } : null;

}

/** Values for the string argument the cursor is in: [ { w, k, h } ] or []. `selectors` are the scene's own, already built by the Shell. */
export function argumentChoices( call, selectors ) {

	if ( ! call || ! call.quote ) return { kind: null, items: [] };
	if ( COLOR_ARGS.has( call.name ) && call.argIndex === 0 ) return { kind: 'color', items: COLOR_NAMES.map( w => ( { w, k: 'color' } ) ) };
	const en = ARG_ENUMS[ call.name + ':' + call.argIndex ];
	if ( en && en.length ) return { kind: 'enum', items: en.map( w => ( { w, k: 'value' } ) ) };
	return { kind: null, items: [] };

}

// ── members of real objects ──────────────────────────────────────────────────────────────────────

const SAFE_ROOTS = [ 'Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'console', 'Date', 'Promise', 'Map', 'Set', 'Reflect' ];

/** A function's parameter list as text, read from its source (`(a, b = 1)`), or `(n args)` when it is native. */
export function hintOf( fn ) {

	try {

		const src = Function.prototype.toString.call( fn );
		const m = src.match( /^[^(=]*?\(([^)]*)\)/ ) || src.match( /^\s*(?:async\s*)?([\w$]+)\s*=>/ );
		if ( /\[native code\]/.test( src ) ) return fn.length ? '(' + Array.from( { length: fn.length }, ( _, i ) => String.fromCharCode( 97 + i ) ).join( ', ' ) + ')' : '()';
		if ( m ) return '(' + m[ 1 ].replace( /\s+/g, ' ' ).trim().slice( 0, 60 ) + ')';

	} catch { /* a proxy or a revoked function */ }
	return '()';

}

/**
 * The members of the object a dotted path names, read without running any of the page's code: only data properties are followed (a getter is
 * never called). `roots` is { name: object } for the names the Shell gives (editor, scene, THREE, …). Returns [ { w, k, h } ] or null when the path
 * does not lead to an object. A function member is a method; anything else a property with its type.
 */
export function membersOf( path, roots, globalObject = globalThis ) {

	let obj;
	const [ head, ...rest ] = path;
	if ( STATIC_MEMBERS[ head ] && rest.length === 0 ) return STATIC_MEMBERS[ head ].map( m => ( { ...m, k: 'method' } ) );
	if ( Object.prototype.hasOwnProperty.call( roots, head ) ) obj = roots[ head ];
	else if ( SAFE_ROOTS.includes( head ) ) obj = globalObject[ head ];
	else return null;
	for ( const key of rest ) {

		if ( obj === null || obj === undefined || ( typeof obj !== 'object' && typeof obj !== 'function' ) ) return null;
		let d, o = obj;
		while ( o && ! ( d = Object.getOwnPropertyDescriptor( o, key ) ) ) o = Object.getPrototypeOf( o );
		if ( ! d || ! ( 'value' in d ) ) return null;                     // a getter: do not call it
		obj = d.value;

	}
	if ( obj === null || obj === undefined || ( typeof obj !== 'object' && typeof obj !== 'function' ) ) return null;

	const out = [], seen = new Set();
	for ( let o = obj; o && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf( o ) ) {

		const own = o === obj ? 0 : 1;
		for ( const name of Object.getOwnPropertyNames( o ) ) {

			if ( seen.has( name ) || name === 'constructor' || name.startsWith( '_' ) || /^(caller|callee|arguments|prototype|length|name)$/.test( name ) && typeof obj === 'function' ) continue;
			seen.add( name );
			const d = Object.getOwnPropertyDescriptor( o, name );
			if ( ! d ) continue;
			if ( 'value' in d ) {

				const v = d.value;
				if ( typeof v === 'function' ) out.push( { w: name, k: 'method', h: hintOf( v ), rank: ( /^is[A-Z]/.test( name ) ? - 2 : 0 ) - own } );
				else out.push( { w: name, k: 'prop', h: Array.isArray( v ) ? 'array ' + v.length : v !== null && typeof v === 'object' ? ( v.constructor && v.constructor.name ) || 'object' : typeof v, rank: ( /^is[A-Z]/.test( name ) ? - 2 : 0 ) - own } );

			} else out.push( { w: name, k: 'prop', h: 'getter', rank: - 1 - own } );

		}

	}
	return out;

}

// ── starters for an empty line ───────────────────────────────────────────────────────────────────

const quoteId = name => "'#" + String( name ).replace( /'/g, "\\'" ) + "'";

/**
 * What to offer on an empty line, best first, each with a group heading and the text to insert (`caret` is where the cursor goes in it).
 *   ctx: {
 *     selected: { name, type, isMesh, textured, hasRecord, childCount } | null,   the selected object
 *     classes: [ { selector, count } ],   the scene's own classes and ids, most useful first
 *     objectCount,                        objects in the scene (0 for an empty one)
 *     history: [ 'command', … ],          oldest first
 *   }
 */
export function buildStarters( ctx ) {

	const out = [];
	const add = ( group, w, h, extra = {} ) => out.push( { w, k: 'starter', group, h, ...extra } );
	const sel = ctx.selected;
	if ( sel && sel.name ) {

		const id = quoteId( sel.name ), g = 'Selected: ' + sel.name;
		if ( sel.hasRecord ) {

			add( g, `SEG.preview(${ id })`, 'each part a flat colour' );
			add( g, `$S(${ id }).nodes[0].userData.segmentation`, 'what it was cut from' );

		} else if ( sel.isMesh && sel.textured ) add( g, `SEG.describe(${ id })`, 'islands and colours: the evidence for cutting it into parts' );
		add( g, `$S(${ id }).recolor('')`, 'a colour name or #hex', { caret: `$S(${ id }).recolor('`.length } );
		add( g, `$S(${ id }).scale(1.5)`, 'make it bigger' );
		add( g, `$S(${ id }).spin('y', 1)`, 'turn it' );
		add( g, `isolate(${ id })`, 'show only this' );
		if ( sel.childCount > 0 ) add( g, `$S(${ id }).children()`, `its ${ sel.childCount } parts` );

	}
	if ( ctx.objectCount === 0 ) {

		add( 'The scene is empty', "addLight('directional')", 'a light to see by' );
		add( 'The scene is empty', 'editor.execute(new AddObjectCommand(editor, new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0x4488ff }))))', 'a blue box' );

	} else {

		for ( const c of ( ctx.classes || [] ).slice( 0, 6 ) ) {

			if ( c.selector.startsWith( '.' ) || c.selector.startsWith( '#' ) ) add( 'In this scene', `$S('${ c.selector }')`, c.count > 1 ? '×' + c.count : '1 object' );

		}

	}
	const seen = new Set();
	const recent = [];
	for ( let i = ctx.history.length - 1; i >= 0 && recent.length < 4; i -- ) {

		const line = String( ctx.history[ i ] ).trim();
		if ( ! line || line.includes( '\n' ) || line.length > 110 || seen.has( line ) || /^(help|history|clear)\b/.test( line ) ) continue;
		seen.add( line ); recent.push( line );

	}
	for ( const r of recent ) add( 'Recent', r, '' );
	add( 'Explore', 'listSelectors()', 'what can be addressed' );
	add( 'Explore', 'lint()', 'what is unnamed or unclassed' );
	add( 'Explore', 'help', 'everything the Shell offers' );
	return out;

}
