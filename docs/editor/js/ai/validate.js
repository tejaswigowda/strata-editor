// ── validate.js ───────────────────────────────────────────────────────────────
// Static lint of generated code against the API index (Technique 2), run BEFORE
// execution. Targets the exact observed hallucinations:
//   • invented classes        (new Tree3D(), new FBXLoader(), new WaterMaterial())
//   • wrong command arity      (AddObjectCommand with 3 args — position ignored)
//   • bad material option keys (metal:1 instead of metalness:1)
//
// HIGH-CONFIDENCE only: we never block legitimate code. Each issue is a precise,
// actionable string fed back to the model for correction.

import { ALLOWED_CLASSES, COMMAND_ARITY, MATERIAL_KEYS, buildIndex } from './apiIndex.js';

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
