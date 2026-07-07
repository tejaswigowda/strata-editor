// ── validate.js ───────────────────────────────────────────────────────────────
// Static lint of generated code against the API index (Technique 2), run BEFORE
// execution. Targets the exact observed hallucinations:
//   • invented classes        (new Tree3D(), new FBXLoader(), new WaterMaterial())
//   • wrong command arity      (AddObjectCommand with 3 args — position ignored)
//   • bad material option keys (metal:1 instead of metalness:1)
//
// HIGH-CONFIDENCE only: we never block legitimate code. Each issue is a precise,
// actionable string fed back to the model for correction.

import { ALLOWED_CLASSES, COMMAND_ARITY, MATERIAL_KEYS, SCOPE_FUNCTIONS, buildIndex } from './apiIndex.js';

// JS keywords that can be followed by "(" but are not function calls.
const JS_KEYWORDS = new Set( [
	'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
	'do', 'else', 'instanceof', 'void', 'delete', 'yield', 'in', 'of', 'new', 'case',
	'throw', 'with', 'super', 'async',
] );

// Bare JS built-in globals that may be called without a receiver.
const JS_GLOBALS = new Set( [
	'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
	'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'BigInt', 'Error',
	'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
	'console', 'structuredClone', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
] );

// Replace comment bodies with spaces (string/template-literal aware) so prose
// inside `// …` and `/* … */` can't be mistaken for code. Keeps offsets stable
// by emitting an equal run of spaces (newlines preserved) — used by the
// call-expression scan so a comment like `// Stem (a cylinder)` isn't read as a
// call to `Stem(`. Single/double-quoted string CONTENTS are blanked too, so a
// CSS/canvas color string like `'rgba(255,0,0,1)'` isn't read as a call to
// `rgba(`. Template literals are left intact (their `${ … }` holds real code).
function stripComments( code ) {

	let out = '';
	const n = code.length;
	let i = 0;

	while ( i < n ) {

		const ch = code[ i ];

		if ( ch === '"' || ch === "'" ) {

			const q = ch; out += ch; i ++;
			while ( i < n && code[ i ] !== q ) {

				if ( code[ i ] === '\\' && i + 1 < n ) { out += '  '; i += 2; continue; }
				out += ' '; i ++;

			}
			if ( i < n ) { out += code[ i ]; i ++; }
			continue;

		}
		if ( ch === '`' ) {

			const q = ch; out += ch; i ++;
			while ( i < n && code[ i ] !== q ) {

				out += code[ i ];
				if ( code[ i ] === '\\' && i + 1 < n ) { i ++; out += code[ i ]; }
				i ++;

			}
			if ( i < n ) { out += code[ i ]; i ++; }
			continue;

		}
		if ( ch === '/' && code[ i + 1 ] === '/' ) {

			while ( i < n && code[ i ] !== '\n' ) { out += ' '; i ++; }
			continue;

		}
		if ( ch === '/' && code[ i + 1 ] === '*' ) {

			i += 2; out += '  ';
			while ( i < n && ! ( code[ i ] === '*' && code[ i + 1 ] === '/' ) ) { out += code[ i ] === '\n' ? '\n' : ' '; i ++; }
			if ( i < n ) { out += '  '; i += 2; }
			continue;

		}
		out += ch; i ++;

	}
	return out;

}

// Collect identifiers DECLARED within a snippet (function names, var bindings,
// function/arrow parameters) so calls to them aren't mistaken for undefined.
function declaredNames( code ) {

	const declared = new Set();
	const addParams = list => {

		for ( const p of String( list ).split( ',' ) ) {

			const id = p.trim().replace( /[=:].*$/, '' ).replace( /^\.\.\./, '' ).trim();
			if ( /^[A-Za-z_$][\w$]*$/.test( id ) ) declared.add( id );

		}

	};

	for ( const m of code.matchAll( /function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g ) ) {

		if ( m[ 1 ] ) declared.add( m[ 1 ] );
		addParams( m[ 2 ] );

	}
	for ( const m of code.matchAll( /(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g ) ) {

		if ( m[ 1 ] !== undefined ) addParams( m[ 1 ] ); else if ( m[ 2 ] ) declared.add( m[ 2 ] );

	}
	for ( const m of code.matchAll( /(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g ) ) declared.add( m[ 1 ] );

	return declared;

}

// Find const/let names declared TWICE IN THE SAME BLOCK SCOPE (a SyntaxError:
// "Identifier 'x' has already been declared"). Tracks brace scopes so sibling
// blocks / loop bodies that legitimately reuse a name are NOT flagged. Skips
// strings and comments so their braces/keywords don't perturb the scope stack.
function duplicateConsts( code ) {

	const dups = new Set();
	const stack = [ new Set() ];
	const n = code.length;
	let i = 0;

	while ( i < n ) {

		const ch = code[ i ];

		if ( ch === '"' || ch === "'" || ch === '`' ) {

			const q = ch; i ++;
			while ( i < n && code[ i ] !== q ) { if ( code[ i ] === '\\' ) i ++; i ++; }
			i ++; continue;

		}
		if ( ch === '/' && code[ i + 1 ] === '/' ) { while ( i < n && code[ i ] !== '\n' ) i ++; continue; }
		if ( ch === '/' && code[ i + 1 ] === '*' ) { i += 2; while ( i < n && ! ( code[ i ] === '*' && code[ i + 1 ] === '/' ) ) i ++; i += 2; continue; }
		if ( ch === '{' ) { stack.push( new Set() ); i ++; continue; }
		if ( ch === '}' ) { if ( stack.length > 1 ) stack.pop(); i ++; continue; }

		// `for (…)` header declarations (`for (let i …)`) are loop-scoped, not part
		// of the enclosing block — sibling for-loops legitimately reuse `let i`. Skip
		// the whole balanced header so its const/let aren't registered as block dups.
		if ( ch === 'f' && /^for\b/.test( code.slice( i, i + 4 ) ) && ! ( code[ i - 1 ] && /[\w$]/.test( code[ i - 1 ] ) ) ) {

			let j = i + 3;
			while ( j < n && /\s/.test( code[ j ] ) ) j ++;
			if ( code[ j ] === '(' ) {

				let depth = 0;
				while ( j < n ) {

					const c = code[ j ];
					if ( c === '"' || c === "'" || c === '`' ) { const q = c; j ++; while ( j < n && code[ j ] !== q ) { if ( code[ j ] === '\\' ) j ++; j ++; } j ++; continue; }
					if ( c === '/' && code[ j + 1 ] === '/' ) { while ( j < n && code[ j ] !== '\n' ) j ++; continue; }
					if ( c === '/' && code[ j + 1 ] === '*' ) { j += 2; while ( j < n && ! ( code[ j ] === '*' && code[ j + 1 ] === '/' ) ) j ++; j += 2; continue; }
					if ( c === '(' ) depth ++;
					else if ( c === ')' ) { depth --; if ( depth === 0 ) { j ++; break; } }
					j ++;

				}
				i = j; continue;

			}

		}

		if ( ch === 'c' || ch === 'l' ) {

			const prev = code[ i - 1 ];
			if ( ! ( prev && /[\w$]/.test( prev ) ) ) {

				const m = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec( code.slice( i, i + 64 ) );
				if ( m ) {

					const name = m[ 1 ];
					const cur = stack[ stack.length - 1 ];
					if ( cur.has( name ) ) dups.add( name ); else cur.add( name );
					i += m[ 0 ].length; continue;

				}

			}

		}

		i ++;

	}
	return [ ...dups ];

}

// THREE-ish suffixes/patterns that make an unknown `new X()` a likely halluc.
const SUSPECT = /(?:Geometry|Material|Light|Loader|Camera|Helper|Texture|Controls)$|\d/;

// Split an argument list on TOP-LEVEL commas (ignore commas inside (), [], {}).
function topLevelArgs( argStr ) {

	const s = argStr.trim();
	if ( ! s ) return [];
	const args = [];
	let depth = 0, start = 0;

	for ( let i = 0; i < s.length; i ++ ) {

		const ch = s[ i ];
		if ( ch === '(' || ch === '[' || ch === '{' ) depth ++;
		else if ( ch === ')' || ch === ']' || ch === '}' ) depth --;
		else if ( ch === ',' && depth === 0 ) { args.push( s.slice( start, i ) ); start = i + 1; }

	}
	args.push( s.slice( start ) );
	return args.map( a => a.trim() ).filter( a => a.length );

}

// Find the matching ')' for the '(' at index `open`.
function matchParen( code, open ) {

	let depth = 0;
	for ( let i = open; i < code.length; i ++ ) {

		const ch = code[ i ];
		if ( ch === '(' ) depth ++;
		else if ( ch === ')' ) { depth --; if ( depth === 0 ) return i; }

	}
	return - 1;

}

/**
 * @param {string} code
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function validateCode( code ) {

	if ( ! ALLOWED_CLASSES.size ) buildIndex();
	const issues = [];

	// 0. Direct scene mutation bypasses the undo stack — always forbidden.
	if ( /\bscene\s*\.\s*(?:add|remove)\s*\(/.test( code ) ) {

		issues.push( 'scene.add()/scene.remove() bypasses the undo stack — use editor.execute(new AddObjectCommand(editor, obj)) / new RemoveObjectCommand(editor, obj) instead.' );

	}

	// 0b. Renderer-"clear" hallucination — "clear/empty/reset the scene" must REMOVE
	//     objects, not touch the render buffer. The small model reaches for
	//     Cache.clear / CanvasRenderer / WebGLRenderer.clear / setClearColor, which
	//     don't exist in scope and don't empty the scene.
	if ( /\b(?:CanvasRenderer|WebGLRenderer)\b|\bCache\s*\.\s*clear|setClearColor/.test( code ) ) {

		issues.push( "To clear/empty the scene, REMOVE its objects — do NOT call renderer/Cache clear methods (not in scope): scene.children.filter(o=>o.type!=='Camera').forEach(o=>editor.execute(new RemoveObjectCommand(editor,o)));" );

	}

	// 0c. Selector validation: catch $S() calls with spaces in selectors (e.g., ".tree bark")
	//     which are invalid combinations. Spaces in CSS mean descendant selector, but model
	//     often generates them by combining separate selectors from the list.
	const selectorMatch = /\$S\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/g;
	let sm;
	while ( ( sm = selectorMatch.exec( code ) ) !== null ) {

		const selector = sm[ 1 ];
		// Check for spaces that aren't part of a valid compound selector like ".a.b"
		// If there's a space after . or # (like ".foo bar" or "#id name"), it's likely a mistake
		if ( /[.#]\s+[.#a-zA-Z]|[.#]\s+\w+\s+[.#]/.test( selector ) || /\s{2,}/.test( selector ) ) {

			issues.push( `Selector "${ selector }" contains invalid spaces. Selectors must use exact names from the ADDRESSABLE PARTS list. Did you mean to combine selectors with &&? E.g., use ".class1.class2" (no space) or separate into different $S() calls.` );

		}

	}

	// 1. Every `new X(` constructor
	const ctor = /new\s+([A-Za-z_$][\w$]*)\s*\(/g;
	let m;
	while ( ( m = ctor.exec( code ) ) !== null ) {

		const name = m[ 1 ];
		const open = m.index + m[ 0 ].length - 1;
		const close = matchParen( code, open );
		const args = close > open ? topLevelArgs( code.slice( open + 1, close ) ) : [];

		// 1a. Unknown class that looks like a THREE API → hallucination
		if ( ! ALLOWED_CLASSES.has( name ) && SUSPECT.test( name ) ) {

			issues.push( `Unknown class "${ name }" — not a supported class. Use only documented globals.` );

		}

		// 1b. Command arity
		const arity = COMMAND_ARITY[ name ];
		if ( arity !== undefined && args.length !== arity ) {

			const sig = name === 'AddObjectCommand' || name === 'RemoveObjectCommand'
				? `${ name }(editor, object)`
				: `${ name } expects ${ arity } args`;
			issues.push( `${ name } called with ${ args.length } args but takes ${ arity }: ${ sig }. Set position/rotation on the object BEFORE adding — these commands have no transform argument.` );

		}

	}

	// 1c. .add() on a Material/Geometry variable (B1) — the g.add() class of bug.
	//     Collect vars assigned to `new *Material(` / `new *Geometry(`, then flag any
	//     `<thatVar>.add(` call. Only Group/Object3D/Mesh have .add().
	const nonAddable = new Set();
	const declRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g;
	let d;
	while ( ( d = declRe.exec( code ) ) !== null ) {

		if ( /(?:Material|Geometry)$/.test( d[ 2 ] ) ) nonAddable.add( d[ 1 ] );

	}
	const addRe = /([A-Za-z_$][\w$]*)\s*\.\s*add\s*\(/g;
	let a;
	while ( ( a = addRe.exec( code ) ) !== null ) {

		if ( nonAddable.has( a[ 1 ] ) ) {

			issues.push( `"${ a[ 1 ] }" is a Material/Geometry — it has no .add(). To group objects: const group=new Group(); group.add(mesh); then editor.execute(new AddObjectCommand(editor, group)).` );

		}

	}

	// 1d. Constructed-but-never-added Mesh/Group (B2) — the dropped-paddle bug.
	//     A Mesh/Group that is never passed to AddObjectCommand AND never added to a
	//     group (.add(name)) is silently lost. Flag it (only when the program is
	//     building a scene, i.e. it uses AddObjectCommand at all).
	if ( /\bAddObjectCommand\b/.test( code ) ) {

		const objRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Mesh|Group)\s*\(/g;
		let o;
		while ( ( o = objRe.exec( code ) ) !== null ) {

			const name = o[ 1 ];
			const esc = name.replace( /[$]/g, '\\$&' );
			const addedToScene = new RegExp( 'AddObjectCommand\\s*\\([^)]*\\b' + esc + '\\b' ).test( code );
			const addedToGroup = new RegExp( '\\.\\s*add\\s*\\(\\s*' + esc + '\\b' ).test( code );
			if ( ! addedToScene && ! addedToGroup ) {

				issues.push( `"${ name }" is created but never added — pass it to editor.execute(new AddObjectCommand(editor, ${ name })) or add it to a group with group.add(${ name }).` );

			}

		}

	}

	// 1e. Undefined function call (B3) — the backWall() bug. Flag a bare call to a
	//     name that is not a JS keyword/global, not a known scope helper/class, and
	//     not declared in the snippet. Method calls (preceded by ".") and `new X(`
	//     constructors are excluded. Comments are stripped first so prose like
	//     `// Stem (a cylinder)` isn't read as a call to an undefined Stem().
	const noComments = stripComments( code );
	const declared = declaredNames( noComments );
	const reportedUndef = new Set();
	const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
	let cm;
	while ( ( cm = callRe.exec( noComments ) ) !== null ) {

		const name = cm[ 1 ];
		if ( reportedUndef.has( name ) ) continue;
		if ( JS_KEYWORDS.has( name ) ) continue;
		if ( /\bnew\s+$/.test( noComments.slice( 0, cm.index ) ) ) continue; // constructor
		if ( declared.has( name ) || SCOPE_FUNCTIONS.has( name ) || JS_GLOBALS.has( name )
			|| ALLOWED_CLASSES.has( name ) ) continue;

		reportedUndef.add( name );
		issues.push( `"${ name }" is not a defined function or class. Do NOT call helpers you haven't defined — inline the geometry: new Mesh(new <Geometry>(...), material).` );

	}

	// 1f. Defines a function but never runs it (B4) — the clear-scene bug. If the
	//     snippet declares named functions, runs no IIFE, and never invokes any of
	//     them, nothing executes.
	const declFns = [ ...code.matchAll( /function\s+([A-Za-z_$][\w$]*)\s*\(/g ) ].map( x => x[ 1 ] );
	if ( declFns.length ) {

		const hasIIFE = /\}\s*\)\s*\(/.test( code ); // ...})(  — function expr immediately called
		const invoked = declFns.some( n => {

			const esc = n.replace( /[$]/g, '\\$&' );
			// `name(` that is NOT the declaration `function name(`
			return new RegExp( '(?<!function\\s)(?<![.\\w$])' + esc + '\\s*\\(' ).test( code );

		} );
		if ( ! hasIIFE && ! invoked ) {

			issues.push( 'Code defines a function but never runs it. Wrap the body in an IIFE: (function(){ ... })();  so it executes immediately.' );

		}

	}

	// 1g. Duplicate const/let in the same scope (B7) — the kitchen bug. This is a
	//     SyntaxError; catch it pre-execution so the retry fixes it (with the loop
	//     instruction) instead of amputating the scene to make it run.
	const dups = duplicateConsts( code );
	if ( dups.length ) {

		issues.push( `"${ dups[ 0 ] }" is declared more than once in the same scope (SyntaxError). For repeated objects use a for-loop with INDEXED names (const item=…; item.name=\`Cabinet \${i+1}\`) or give each a UNIQUE name — never redeclare the same const.` );

	}

	// 1h. position/rotation/scale .set() arity + below-ground Y (the monopoly and
	//     air-hockey/traffic bugs). Vector3/Euler.set is (x, y, z): a 2-arg call —
	//     e.g. position.set(4.5, -4+i) meaning an X-Z spot — lands the 2nd value in
	//     Y and leaves Z stale (often NaN), so tiles sink below the floor AND stack
	//     at one point. A pure NEGATIVE Y literal also buries the object below the
	//     ground plane (the prompt forbids y<0). Scanned on the comment/string-
	//     stripped source so prose and color strings can't trip it.
	const setRe = /\.\s*(position|rotation|scale)\s*\.\s*set\s*\(/g;
	let st;
	while ( ( st = setRe.exec( noComments ) ) !== null ) {

		const prop = st[ 1 ];
		const open = setRe.lastIndex - 1;
		const close = matchParen( noComments, open );
		if ( close < 0 ) continue;
		const setArgs = topLevelArgs( noComments.slice( open + 1, close ) );

		if ( setArgs.length === 2 ) {

			issues.push( `.${ prop }.set() called with 2 args — Vector3.set is (x, y, z). The 2nd value lands in Y (not Z) and Z stays unset (NaN), burying objects below the floor and stacking them at one spot. For an X-Z placement pass an explicit Y: .${ prop }.set(x, y, z).` );

		} else if ( prop === 'position' && setArgs.length >= 2 && /^-\s*\d*\.?\d+$/.test( setArgs[ 1 ] ) ) {

			issues.push( `.position.set( …, ${ setArgs[ 1 ] }, … ) puts the object below the ground plane (negative Y). Nothing sits below y=0 — set Y to HALF the object's height so it rests on the floor.` );

		}

	}

	// 1h-bis. Direct `obj.position.y = <negative literal>` — same below-ground bug.
	const negY = /\.\s*position\s*\.\s*y\s*=\s*-\s*\d*\.?\d+/g;
	let ny;
	while ( ( ny = negY.exec( noComments ) ) !== null ) {

		issues.push( `${ ny[ 0 ].replace( /\s+/g, '' ).replace( /^\./, '' ) } puts the object below the ground plane. Use a Y >= 0 (half the object's height) so it rests on y=0.` );

	}

	// 2. Material option keys
	const matCall = /new\s+Mesh\w*Material\s*\(\s*\{/g;
	while ( ( m = matCall.exec( code ) ) !== null ) {

		const braceOpen = m.index + m[ 0 ].length - 1;
		// find matching brace
		let depth = 0, end = - 1;
		for ( let i = braceOpen; i < code.length; i ++ ) {

			const ch = code[ i ];
			if ( ch === '{' ) depth ++;
			else if ( ch === '}' ) { depth --; if ( depth === 0 ) { end = i; break; } }

		}
		if ( end < 0 ) continue;

		const body = code.slice( braceOpen + 1, end );
		const keyRe = /(^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:/g;
		let k;
		while ( ( k = keyRe.exec( body ) ) !== null ) {

			const key = k[ 2 ];
			if ( ! MATERIAL_KEYS.has( key ) ) {

				const hint = key === 'metal' ? ' (did you mean "metalness"?)' : '';
				issues.push( `Invalid material property "${ key }"${ hint } — it is ignored by three.js.` );

			}

		}

	}

	return { ok: issues.length === 0, issues };

}
