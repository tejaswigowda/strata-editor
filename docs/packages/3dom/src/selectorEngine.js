// ── selectorEngine.js ───────────────────────────────────────────────────────────
// Parse and match CSS-like selectors over Three.js scene graphs.
// Selectors are deterministic — no model at match time, only at parse.
//
// Grammar (CSS subset):
//   #id              matches node with userData.label === id (falls back to node.name)
//   .class           matches any node with class
//   type             matches three.js type (mesh, group, light, camera, etc.)
//   .a.b             compound selector (AND) — has .a AND .b
//   A B              descendant combinator
//   A > B            child combinator
//   *                wildcard (all nodes in scope)
//
// Usage:
//   const ast = selectorEngine.parse( '.wheel.front' );
//   const matched = selectorEngine.match( root, ast );

import { hasClass, normalizeClassName } from './classDerive.js';

// Bare three.js type tokens we recognize via is* flags (validated by shape, not
// instanceof — house rule). Any other bare token is matched against node.type
// EXACTLY; an unknown token (e.g. "wheel" written without a dot) therefore
// matches NOTHING rather than silently matching every node.
const KNOWN_TYPE_FLAGS = {
	mesh: n => n.isMesh,
	group: n => n.isGroup || ( ! n.isMesh && n.children && n.children.length > 0 ),
	light: n => n.isLight,
	camera: n => n.isCamera,
	sprite: n => n.isSprite,
	line: n => n.isLine,
	points: n => n.isPoints,
	bone: n => n.isBone,
	object3d: () => true,
};

// ── Tokenizer ───────────────────────────────────────────────────────────────────

function tokenize( selector ) {

	const tokens = [];
	let i = 0;

	while ( i < selector.length ) {

		const ch = selector[ i ];

		// Whitespace (descendant combinator)
		if ( /\s/.test( ch ) ) {

			while ( i < selector.length && /\s/.test( selector[ i ] ) ) i ++;
			if ( tokens.length > 0 && tokens[ tokens.length - 1 ] !== ' ' && tokens[ tokens.length - 1 ] !== '>' ) {

				tokens.push( ' ' );

			}

		} else if ( ch === '>' ) {

			// Child combinator
			tokens.push( '>' );
			i ++;

		} else if ( ch === '#' ) {

			// ID selector
			i ++;
			let id = '';
			while ( i < selector.length && /[a-zA-Z0-9_-]/.test( selector[ i ] ) ) {

				id += selector[ i ];
				i ++;

			}
			if ( id ) tokens.push( { type: 'id', value: id } );

		} else if ( ch === '.' ) {

			// Class selector
			i ++;
			let cls = '';
			while ( i < selector.length && /[a-zA-Z0-9_-]/.test( selector[ i ] ) ) {

				cls += selector[ i ];
				i ++;

			}
			if ( cls ) tokens.push( { type: 'class', value: cls } );

		} else if ( ch === '*' ) {

			// Wildcard
			tokens.push( { type: 'wildcard' } );
			i ++;

		} else if ( /[a-zA-Z]/.test( ch ) ) {

			// Type selector
			let type = '';
			while ( i < selector.length && /[a-zA-Z0-9_-]/.test( selector[ i ] ) ) {

				type += selector[ i ];
				i ++;

			}
			if ( type ) tokens.push( { type: 'type', value: type } );

		} else {

			// Unknown character — skip
			i ++;

		}

	}

	return tokens;

}

// ── Parser ──────────────────────────────────────────────────────────────────────

function parseTokens( tokens ) {

	// Build a sequence of matchers, separated by combinators (>, or whitespace descendant).
	// Example: [.wheel, ' ', .front] → [compound(.wheel), descendant, compound(.front)]

	const sequence = [];
	let current = { matchers: [] };

	for ( let i = 0; i < tokens.length; i ++ ) {

		const token = tokens[ i ];

		if ( token === ' ' ) {

			if ( current.matchers.length > 0 ) {

				sequence.push( current );
				sequence.push( 'descendant' );
				current = { matchers: [] };

			}

		} else if ( token === '>' ) {

			if ( current.matchers.length > 0 ) {

				sequence.push( current );
				sequence.push( 'child' );
				current = { matchers: [] };

			}

		} else if ( token.type === 'id' ) {

			current.matchers.push( { type: 'id', value: token.value } );

		} else if ( token.type === 'class' ) {

			current.matchers.push( { type: 'class', value: token.value } );

		} else if ( token.type === 'type' ) {

			current.matchers.push( { type: 'type', value: token.value } );

		} else if ( token.type === 'wildcard' ) {

			current.matchers.push( { type: 'wildcard' } );

		}

	}

	if ( current.matchers.length > 0 ) sequence.push( current );

	return sequence;

}

// ── Matcher ─────────────────────────────────────────────────────────────────────

function nodeMatches( node, matchers ) {

	// All matchers must match (AND logic)
	for ( const m of matchers ) {

		if ( m.type === 'id' ) {

			// Match the semantic label first, then fall back to the object's name,
			// all normalized so "#dump-bed" reconciles with a stored label "Dump
			// Bed" and "#chair" reconciles with an object named "Chair".
			const target = normalizeClassName( m.value );
			const label = node.userData.label ? normalizeClassName( node.userData.label ) : '';
			const name = node.name ? normalizeClassName( node.name ) : '';
			if ( target !== label && target !== name ) return false;

		} else if ( m.type === 'class' ) {

			if ( ! hasClass( node, m.value ) ) return false;

		} else if ( m.type === 'type' ) {

			const type = m.value.toLowerCase();
			if ( Object.prototype.hasOwnProperty.call( KNOWN_TYPE_FLAGS, type ) ) {

				if ( ! KNOWN_TYPE_FLAGS[ type ]( node ) ) return false;

			} else if ( ( node.type || '' ).toLowerCase() !== type ) {

				// Unknown bare type → must equal three.js .type exactly, else NO
				// match. Prevents a stray bare word silently matching everything.
				return false;

			}

		} else if ( m.type === 'wildcard' ) {

			// Matches; fall through so any other matchers in the compound still apply.
			continue;

		}

	}

	return true;

}

function matchSequence( root, sequence ) {

	const results = [];

	// Single simple selector (no combinators)
	if ( sequence.length === 1 && typeof sequence[ 0 ] === 'object' ) {

		const matchers = sequence[ 0 ].matchers;
		root.traverse( node => {

			if ( node === root ) return; // Skip root itself unless explicitly matched
			if ( nodeMatches( node, matchers ) ) results.push( node );

		} );

		return results;

	}

	// Complex sequence with combinators
	// Parse as: selector combinator selector combinator selector ...
	// For now, simple left-to-right evaluation (not fully CSS; no specificity).

	let candidates = [ root ];

	for ( let i = 0; i < sequence.length; i ++ ) {

		const item = sequence[ i ];

		if ( item === 'descendant' ) {

			const nextMatchers = sequence[ i + 1 ];
			if ( ! nextMatchers || typeof nextMatchers === 'string' ) continue;

			const next = [];
			for ( const candidate of candidates ) {

				candidate.traverse( node => {

					if ( node === candidate ) return;
					if ( nodeMatches( node, nextMatchers.matchers ) ) next.push( node );

				} );

			}

			candidates = next;
			i ++; // Skip the selector we just processed

		} else if ( item === 'child' ) {

			const nextMatchers = sequence[ i + 1 ];
			if ( ! nextMatchers || typeof nextMatchers === 'string' ) continue;

			const next = [];
			for ( const candidate of candidates ) {

				for ( const child of candidate.children ) {

					if ( nodeMatches( child, nextMatchers.matchers ) ) next.push( child );

				}

			}

			candidates = next;
			i ++; // Skip the selector we just processed

		}

	}

	return candidates;

}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Parse a selector string into an AST.
 * @param {string} selector  e.g. ".wheel.front", "#dump-bed", ".mesh .wheel > .rim"
 * @returns {Array}  parsed AST (internal format)
 * @throws if selector syntax is invalid
 */
export function parse( selector ) {

	if ( ! selector || typeof selector !== 'string' ) throw new Error( 'Invalid selector' );

	const trimmed = selector.trim();
	if ( ! trimmed ) throw new Error( 'Empty selector' );

	const tokens = tokenize( trimmed );
	if ( tokens.length === 0 ) throw new Error( 'No valid tokens in selector' );

	return parseTokens( tokens );

}

/**
 * Match selector AST against a scene graph.
 * @param {THREE.Object3D} root  scene or subtree root
 * @param {Array} ast  from parse()
 * @returns {Array<THREE.Object3D>}  matched nodes (in traversal order)
 */
export function match( root, ast ) {

	if ( ! root || ! ast ) return [];

	return matchSequence( root, ast );

}

// ── Selection pseudo-selectors (:selected / :lasso) ───────────────────────────
// `:selected` (and its alias `:lasso`) resolve to the editor's LIVE selection —
// whatever the interactive click / lasso tools last produced — rather than to a
// scene-graph query. Selection lives on the editor, not the scene, so the host
// registers a provider. Making these first-class here (not just in ChainableSet)
// means EVERY consumer — op() dispatch, validateOpJSON, subset sanity checks —
// resolves them uniformly, so `$S(':selected').recolor('#000')` works end-to-end.
const SELECTION_PSEUDO = /^\s*:?(selected|lasso)\s*$/i;

let _selectionProvider = null;

/** Register how `:selected` / `:lasso` resolve (host supplies live selection). */
export function setSelectionProvider( fn ) {

	_selectionProvider = typeof fn === 'function' ? fn : null;

}

/** True when the selector is a selection pseudo (`:selected` / `:lasso`). */
export function isSelectionPseudo( selector ) {

	return typeof selector === 'string' && SELECTION_PSEUDO.test( selector );

}

/**
 * Convenience: parse and match in one call.
 * @param {THREE.Object3D} root
 * @param {string} selector
 * @returns {Array<THREE.Object3D>}
 */
export function query( root, selector ) {

	// Selection pseudo resolves to the live editor selection, not a graph query.
	if ( isSelectionPseudo( selector ) ) {

		return _selectionProvider ? ( _selectionProvider() || [] ) : [];

	}

	try {

		const ast = parse( selector );
		return match( root, ast );

	} catch ( e ) {

		console.warn( 'Selector error:', e.message );
		return [];

	}

}

/**
 * True if the selector names a specific SUBSET (contains an id or class matcher),
 * as opposed to a deliberately-broad selector ("*" or a bare type like "mesh").
 * Used by the op dispatcher's "subset named but all changed" guard.
 * @param {string} selector
 * @returns {boolean}
 */
export function hasNamedMatcher( selector ) {

	try {

		const seq = parse( selector );
		for ( const item of seq ) {

			if ( typeof item === 'string' ) continue; // combinator
			for ( const m of item.matchers ) {

				if ( m.type === 'id' || m.type === 'class' ) return true;

			}

		}
		return false;

	} catch {

		return false;

	}

}

/**
 * Validate a selector without matching.
 * @param {string} selector
 * @returns {boolean}
 */
export function isValid( selector ) {

	if ( isSelectionPseudo( selector ) ) return true;

	try {

		parse( selector );
		return true;

	} catch {

		return false;

	}

}
