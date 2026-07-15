// ── selectorIndex.js ──────────────────────────────────────────────────────────
// HOST-SIDE SELECTOR RESOLUTION — the scaffolding that belongs ABOVE the 3DOM
// library (resolution is the host's job, see the "Host-Side Selector Resolution"
// work order). Two responsibilities, one source of truth:
//
//   Part 0 — buildSelectorIndex(root): ONE ranked+capped SELECTOR INDEX
//            ({ selector, count, kind, source, nodes }) built from the LIVE graph,
//            consumed by BOTH the shell autocomplete AND the AI candidate list so
//            the two never drift.
//
//   Part 2 — rankSelectorCandidates(editor, request): turn a natural-language part
//            reference into a NUMBERED, deterministically-ranked candidate list,
//            each candidate carrying the exact node set it resolves to. Reuses the
//            already-tuned descriptor matcher (resolver/sceneIndex) rather than
//            inventing new ranking — this is WIRING it into the AI path.
//
// The model then PICKS a candidate id (constrained to the enum) instead of
// COMPOSING a selector from scratch — an invalid selector becomes unemittable, and
// an unambiguous top candidate can be resolved host-side with NO model call for the
// selector slot at all (Part 5, cheap-first).
//
// PURE where it can be (no DOM, no THREE construction) so the ranking/validation is
// node-unit-testable; the scene traversal takes an `editor` and uses the real
// selectorEngine to guarantee every emitted selector round-trips to its node set.

import { parseQuery } from './resolver.js';
import { ensureIndexed, listCandidates, matchPartNodes } from './sceneIndex.js';
import * as selectorEngine from './selectorEngine.js';
import { getAllClasses, normalizeClassName } from './classDerive.js';

// ── Part 0: the shared SELECTOR INDEX ─────────────────────────────────────────
// Every addressable selector in the scene, each with the node set it resolves to,
// ranked by SPECIFICITY (id > class > type) then multiplicity, and capped. This is
// the single artifact both the autocomplete dropdown and the AI candidate injection
// read from — build it once per scene change, hand the same list to both.

const KIND_RANK = { id: 3, compound: 2.5, class: 2, type: 1 };

function normalizeLabelToId( label ) {

	return String( label )
		.toLowerCase()
		.replace( /\s+/g, '-' )
		.replace( /[^a-z0-9-]/g, '' );

}

// A single merged / non-separable mesh: its sub-parts are NOT individually
// addressable, so it must never be offered as a candidate (a "bed sheets" request
// on it should resolve to NOTHING and route to clarify, not recolor the whole mesh).
function isMergedNode( node ) {

	return !! ( node && node.userData && node.userData.partsSeparable === false );

}

/**
 * @param {THREE.Object3D} root  scene (or subtree) root
 * @param {{ cap?: number }} [opts]
 * @returns {Array<{ selector:string, count:number, kind:'id'|'class'|'type', source:string, nodes:string[] }>}
 */
export function buildSelectorIndex( root, opts = {} ) {

	if ( ! root ) return [];
	const cap = opts.cap != null ? opts.cap : 40;

	// Gather raw selector strings + their source kind from the live graph.
	const seen = new Map(); // selector → { kind, source }
	root.traverse( node => {

		if ( node === root ) return;
		if ( isMergedNode( node ) ) return; // non-separable mesh — not addressable as a part

		if ( node.userData && node.userData.label ) {

			const id = normalizeLabelToId( node.userData.label );
			if ( id ) seen.set( `#${ id }`, { kind: 'id', source: 'label' } );

		}

		for ( const cls of getAllClasses( node ) ) {

			if ( cls ) seen.set( `.${ cls }`, { kind: 'class', source: 'class' } );

		}

		if ( node.isMesh ) seen.set( 'mesh', { kind: 'type', source: 'type' } );
		if ( node.isLight ) seen.set( 'light', { kind: 'type', source: 'type' } );
		if ( node.isCamera ) seen.set( 'camera', { kind: 'type', source: 'type' } );
		if ( node.isGroup || ( ! node.isMesh && node.children && node.children.length ) ) {

			seen.set( 'group', { kind: 'type', source: 'type' } );

		}

	} );

	// Resolve each selector to its node set (authoritative multiplicity + proves the
	// selector round-trips through the real engine).
	const out = [];
	for ( const [ selector, meta ] of seen ) {

		const nodes = selectorEngine.query( root, selector ).map( n => n.name ).filter( Boolean );
		if ( nodes.length === 0 && meta.kind !== 'type' ) continue; // drop dead selectors
		out.push( { selector, count: nodes.length, kind: meta.kind, source: meta.source, nodes } );

	}

	// Rank: specificity first (an id names ONE thing → most useful), then rarer
	// selectors before common ones (a 4-wheel class before a 200-node "mesh").
	out.sort( ( a, b ) => {

		const kr = ( KIND_RANK[ b.kind ] || 0 ) - ( KIND_RANK[ a.kind ] || 0 );
		if ( kr ) return kr;
		if ( a.count !== b.count ) return a.count - b.count;
		return a.selector.localeCompare( b.selector );

	} );

	return out.slice( 0, cap );

}

// ── Part 2: request → ranked candidate list ───────────────────────────────────
// Deterministic ranking of the selectors that could satisfy a part reference. The
// signals (per the work order): lexical overlap with the request, specificity /
// modifier-count match, count sanity for plural-vs-singular, and the tuned
// descriptor matcher's own verdict. We do NOT reinvent scoring — we reuse
// matchPartNodes and lift its node-level result up to the selector level.
//
// CRITICAL for multi-part requests: rank per-NOUN, not against the whole prompt.
// A single global-ranked+capped list lets one noun's compound variants (.wheel,
// .wheel.front, .wheel.left, …) crowd out the other nouns a compound request names
// ("spin the wheels, paint the bed, remove the grille" → the list must contain the
// wheel, bed AND grille candidates, or the model can only pick wheels). So we run
// the matcher on EACH distinct part noun and guarantee its exact selector is offered.

const COLOR_W = [ 'red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'purple', 'magenta', 'pink', 'brown', 'gray', 'grey', 'black', 'white' ];
const REGION_W = [ 'front', 'back', 'rear', 'left', 'right', 'top', 'bottom', 'upper', 'lower', 'inner', 'outer', 'center', 'centre', 'middle' ];
const SIZE_W = [ 'large', 'largest', 'big', 'biggest', 'small', 'smallest', 'tiny', 'tiniest', 'medium', 'main', 'huge' ];
const SYM_W = [ 'paired', 'pair' ];

// Words that QUALIFY a part but don't NAME one (colors, sizes, regions, symmetry).
// Stripped before lexical part-matching so "red" can't match a descriptor class
// ".red", and a selector made ONLY of these can't stand alone as a candidate (it
// would catch a false lexical hit) — it may only refine a part class as a compound.
const MODIFIER_WORD = new Set( [ ...COLOR_W, ...REGION_W, ...SIZE_W, ...SYM_W, 'bright', 'dark', 'darker', 'darken', 'lighten' ] );

// Verbs / articles / quantifiers that carry no part identity.
const PART_STOP = new Set( [ 'the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'into', 'make', 'turn', 'set',
	'change', 'paint', 'recolor', 'recolour', 'color', 'colour', 'this', 'that', 'these', 'those', 'with', 'for',
	'all', 'every', 'both', 'each', 'two', 'three', 'four', 'part', 'parts', 'piece', 'pieces', 'whole', 'entire',
	'bigger', 'smaller', 'larger', 'lift', 'move', 'remove', 'delete', 'spin', 'scale', 'rotate', 'resize',
	'up', 'down', 'bit', 'slowly', 'quickly', 'it', 'its' ] );

const PLURAL_HINT = /\b(all|both|every|each|two|three|four|wheels|lights|windows|doors|panels|parts|rims|tires|tyres)\b/i;
const WHOLE_ASSET_HINT = /\b(whole|entire|everything)\b/i;

// Distinct part nouns the request names (modifiers + stopwords stripped, singularized).
function partNouns( q ) {

	const seen = new Set();
	const out = [];
	for ( const w of ( q.tokens || [] ) ) {

		if ( w.length < 3 || PART_STOP.has( w ) || MODIFIER_WORD.has( w ) ) continue;
		const s = ( w.endsWith( 's' ) && ! w.endsWith( 'ss' ) ) ? w.slice( 0, - 1 ) : w;
		if ( ! seen.has( s ) ) { seen.add( s ); out.push( s ); }

	}
	return out;

}

function selectorTokens( selector ) {

	// #dump-bed → [dump, bed]; .wheel.front → [wheel, front]; mesh → [mesh]
	return selector
		.replace( /[#.]/g, ' ' )
		.split( /[\s-]+/ )
		.map( s => s.toLowerCase().trim() )
		.filter( Boolean );

}

function setEq( a, b ) {

	if ( a.size !== b.size ) return false;
	for ( const x of a ) if ( ! b.has( x ) ) return false;
	return true;

}

// A selector whose only tokens are modifiers (".red", ".front", ".paired.left")
// names NO part — usable only as a compound refinement, never a standalone choice.
function isModifierOnly( selector ) {

	const toks = selectorTokens( selector );
	return toks.length > 0 && toks.every( t => MODIFIER_WORD.has( t ) );

}

// Drop modifier class tokens from a class chain (".grille.black" → ".grille"),
// leaving the part token(s). Returns null when there's nothing to strip or nothing
// would remain. Used to recover a resolvable part class when the model appended a
// spurious descriptor (a color/region the part doesn't actually carry).
function stripModifierClasses( selector ) {

	if ( ! selector || selector[ 0 ] !== '.' ) return null;
	const parts = selector.slice( 1 ).split( '.' ).filter( Boolean );
	const kept = parts.filter( p => ! MODIFIER_WORD.has( p ) );
	if ( kept.length === 0 || kept.length === parts.length ) return null;
	return '.' + kept.join( '.' );

}

// Synthesize compound candidates (.part.region) when the request names both a part
// noun and a spatial modifier — "the front wheels" → .wheel.front. Kept only when
// they round-trip to a non-empty PROPER subset (a compound selecting the same set
// as the bare class adds nothing).
function compoundCandidates( root, index ) {

	const classes = index.filter( e => e.kind === 'class' );
	const parts = classes.filter( e => ! isModifierOnly( e.selector ) );
	const mods = classes.filter( e => isModifierOnly( e.selector ) );
	const out = [];
	for ( const p of parts ) {

		for ( const m of mods ) {

			const selector = `${ p.selector }${ m.selector }`;
			const nodes = selectorEngine.query( root, selector ).map( n => n.name ).filter( Boolean );
			if ( nodes.length > 0 && nodes.length < p.count ) {

				out.push( { selector, count: nodes.length, kind: 'compound', source: 'compound', nodes } );

			}

		}

	}
	return out;

}

// The most specific selector that resolves to EXACTLY the given node-name set, drawn
// from the live pool (index + compounds). Falls back to deriving an #id/.class for a
// singleton. Returns null when the set can't be expressed as one selector (so we
// offer nothing rather than a bleeding approximation).
function selectorForNodeSet( root, pool, nameSet, nodes ) {

	let best = null;
	for ( const e of pool ) {

		if ( setEq( new Set( e.nodes ), nameSet ) ) {

			if ( ! best || ( KIND_RANK[ e.kind ] || 0 ) > ( KIND_RANK[ best.kind ] || 0 ) ) best = e;

		}

	}
	if ( best ) return best;

	if ( nameSet.size === 1 ) {

		const only = [ ...nameSet ][ 0 ];
		const node = nodes.find( n => n.name === only );
		if ( node ) {

			const sel = bestSelectorFor( root, node );
			if ( sel ) {

				const names = selectorEngine.query( root, sel ).map( n => n.name ).filter( Boolean );
				if ( setEq( new Set( names ), nameSet ) ) {

					return { selector: sel, count: names.length, kind: sel[ 0 ] === '#' ? 'id' : 'class', source: 'derived', nodes: names };

				}

			}

		}

	}
	return null;

}

/**
 * @param {object} editor
 * @param {string} text     the natural-language request / part reference
 * @param {{ cap?: number, escape?: boolean }} [opts]
 * @returns {{ candidates: Array, ambiguous: boolean, method: string, query: object }}
 *   candidate: { id, selector, label, count, nodes:Set<string>, score, reasons, kind, hard }
 */
export function rankSelectorCandidates( editor, text, opts = {} ) {

	const cap = opts.cap != null ? opts.cap : 10;
	ensureIndexed( editor );
	const root = editor.scene;
	const nodes = listNodes( editor );

	const q = parseQuery( text );
	const nouns = partNouns( q );
	const plural = PLURAL_HINT.test( text );

	const index = buildSelectorIndex( root, { cap: 80 } );
	const pool = index.concat( compoundCandidates( root, index ) );
	// Standalone candidates: drop pure-modifier classes (they only refine).
	const partPool = pool.filter( e => e.kind === 'id' || e.kind === 'type' || ! isModifierOnly( e.selector ) );

	const forcedKeys = new Set();
	const forced = [];
	const addForced = ( entry, score, reasons ) => {

		const key = [ ...entry.nodes ].sort().join( ',' );
		if ( forcedKeys.has( key ) ) return;
		forcedKeys.add( key );
		forced.push( { entry, score, reasons, nodeSet: new Set( entry.nodes ), hard: true } );

	};

	// ── Per-noun authoritative coverage ─────────────────────────────────────────
	// Resolve EACH distinct part noun with the tuned matcher and offer the exact
	// selector for its node set. Guarantees a compound request surfaces every part.
	for ( const noun of nouns ) {

		let mset = null;
		try {

			const mp = matchPartNodes( nodes, noun );
			if ( mp && mp.nodes && mp.nodes.length ) mset = new Set( mp.nodes.map( n => n.name ).filter( Boolean ) );

		} catch ( e ) { /* matcher best-effort */ }
		if ( ! mset || ! mset.size ) continue;

		// Region refinement: "front wheels" → the .wheel.front subset, not all wheels.
		let entry = selectorForNodeSet( root, pool, mset, nodes );
		if ( q.regions && q.regions.length && entry ) {

			for ( const [ , side ] of q.regions ) {

				const refined = `${ entry.selector }.${ side }`;
				const rn = selectorEngine.query( root, refined ).map( n => n.name ).filter( Boolean );
				if ( rn.length && rn.length < entry.count ) entry = { selector: refined, count: rn.length, kind: 'compound', source: 'refined', nodes: rn };

			}

		}
		if ( entry ) addForced( entry, 100, [ `noun:${ noun }` ] );

	}

	// Whole-asset root(s). Offered as a low-priority DEFAULT whenever no concrete
	// part noun resolved — so a target-less transform ("make it bigger", "rotate it")
	// resolves to the asset instead of returning None — and boosted to a lead choice
	// on explicit intent ("paint the whole truck"). Suppressed when concrete parts
	// already resolved (a part request must not surface the whole asset).
	const wholeHint = WHOLE_ASSET_HINT.test( text );
	if ( wholeHint || nouns.length === 0 ) {

		for ( const child of root.children ) {

			if ( child.isCamera ) continue;
			const sel = bestSelectorFor( root, child );
			if ( ! sel ) continue;
			const names = selectorEngine.query( root, sel ).map( n => n.name ).filter( Boolean );
			if ( names.length ) addForced( { selector: sel, count: names.length, kind: sel[ 0 ] === '#' ? 'id' : 'class', source: 'asset', nodes: names }, wholeHint ? 90 : 8, [ wholeHint ? 'whole-asset' : 'asset-default' ] );

		}

	}

	// Co-reference collapse: when two nouns resolved to NESTED sets ("the wheels and
	// rims" → {4} ⊂ {8}), the request means the tighter set — drop the superset so the
	// model can't pick the bleeding one as an exact candidate.
	const collapsed = forced.filter( f => ! forced.some( g =>
		g !== f && g.nodeSet.size < f.nodeSet.size && [ ...g.nodeSet ].every( x => f.nodeSet.has( x ) ) ) );
	forced.length = 0;
	forced.push( ...collapsed );

	// ── Global lexical fill (alternates) ─────────────────────────────────────────
	// Only NON-modifier part nouns count as overlap, so "red"/"front" never match a
	// descriptor class. Entries with zero part-noun overlap are not candidates.
	//
	// SLOT-PER-NOUN, NOT SLOT-PER-VARIANT: a distinct part noun already reserved its
	// one authoritative candidate (above). Unless the request explicitly names a
	// region, drop the sub-variants of an already-covered part (.wheel.front,
	// .wheel.left, … when the request just says "the wheels") — they let the model
	// over-select and crowd out other nouns.
	const forcedSets = forced.map( f => f.nodeSet );
	const hasRegion = !! ( q.regions && q.regions.length );
	const isVariantOfCovered = ( ns ) => forcedSets.some( fs => ns.size < fs.size && [ ...ns ].every( n => fs.has( n ) ) );

	const scored = [];
	for ( const entry of partPool ) {

		const nodeSet = new Set( entry.nodes );
		if ( ! hasRegion && isVariantOfCovered( nodeSet ) ) continue;

		const sTokens = selectorTokens( entry.selector );
		let overlap = 0;
		for ( const rt of nouns ) {

			if ( sTokens.some( st => st === rt || st.includes( rt ) || rt.includes( st ) ) ) overlap ++;

		}
		if ( overlap === 0 ) continue;

		let score = 5 * overlap;
		const reasons = [ `lex×${ overlap }` ];
		for ( const [ , side ] of ( q.regions || [] ) ) if ( sTokens.includes( side ) ) { score += 3; reasons.push( `mod:${ side }` ); }
		if ( plural && entry.count > 1 ) { score += 2; reasons.push( 'plural✓' ); }
		else if ( ! plural && entry.count === 1 ) { score += 1; reasons.push( 'singular✓' ); }
		else if ( plural && entry.count === 1 ) { score -= 1; reasons.push( 'plural✗' ); }
		score += ( KIND_RANK[ entry.kind ] || 0 ) * 0.1;
		scored.push( { entry, score, reasons, nodeSet, hard: false } );

	}
	scored.sort( ( a, b ) => b.score - a.score );

	// Descriptor fallback — if nothing matched at all, fold in ranked per-node
	// candidates so a purely descriptor-addressable part still surfaces.
	if ( forced.length === 0 && scored.length === 0 ) {

		try {

			for ( const r of listCandidates( editor, text ).slice( 0, cap ) ) {

				if ( isMergedNode( r.node ) ) continue; // never surface a merged mesh
				const sel = bestSelectorFor( root, r.node );
				if ( ! sel ) continue;
				const names = selectorEngine.query( root, sel ).map( n => n.name ).filter( Boolean );
				if ( ! names.length ) continue;
				scored.push( {
					entry: { selector: sel, count: names.length, kind: sel[ 0 ] === '#' ? 'id' : 'class', source: 'descriptor', nodes: names },
					score: r.score, reasons: r.reasons || [ 'descriptor' ], nodeSet: new Set( names ), hard: false,
				} );

			}

		} catch ( e ) { /* best-effort */ }

	}

	// Merge (forced first so they survive the cap), dedupe by resolved node set.
	const bySet = new Map();
	for ( const s of forced.concat( scored ) ) {

		const key = [ ...s.nodeSet ].sort().join( ',' );
		if ( ! bySet.has( key ) ) bySet.set( key, s );

	}

	const top = [ ...bySet.values() ].slice( 0, cap );
	const candidates = top.map( ( s, i ) => ( {
		id: `c${ i + 1 }`,
		selector: s.entry.selector,
		label: describeCandidate( s.entry ),
		count: s.entry.count,
		nodes: s.nodeSet,
		score: Math.round( s.score * 100 ) / 100,
		reasons: s.reasons,
		kind: s.entry.kind,
		hard: s.hard,
	} ) );

	// Ambiguity (Part 4): no matcher-backed leader AND the top-2 are close, or the
	// leader is weak. A hard (matcher-backed) leader is never ambiguous.
	const a = candidates[ 0 ];
	const b = candidates[ 1 ];
	const ambiguous = !! a && ! a.hard && ( ( !! b && ! b.hard && ( a.score - b.score ) < 2 ) || a.score < 5 );

	return { candidates, ambiguous, method: candidates.length ? ( candidates[ 0 ].hard ? 'matcher' : 'lexical' ) : 'none', query: q };

}

// Every non-camera node carrying descriptors — mirrors sceneIndex.indexedNodes
// (not exported there) so ranking can consult the tuned matcher.
function listNodes( editor ) {

	const out = [];
	editor.scene.traverse( n => {

		if ( n === editor.scene || n.isCamera ) return;
		if ( isMergedNode( n ) ) return; // non-separable mesh — keep out of the matcher pool
		if ( n.userData && n.userData.descriptors ) out.push( n );

	} );
	return out;

}

// Best single selector that resolves to a given node (prefer an #id from its label
// / name, else its rarest class).
function bestSelectorFor( root, node ) {

	if ( node.userData && node.userData.label ) {

		const id = normalizeLabelToId( node.userData.label );
		if ( id ) return `#${ id }`;

	}
	if ( node.name ) {

		const id = normalizeClassName( node.name );
		if ( id ) return `#${ id }`;

	}
	const classes = getAllClasses( node );
	if ( classes.length ) return `.${ classes[ 0 ] }`;
	return null;

}

function describeCandidate( entry ) {

	const n = entry.count;
	const noun = n === 1 ? 'node' : 'nodes';
	return `${ entry.selector }  → ${ n } ${ noun }`;

}

// ── Part 3: candidate injection (numbered list + escape) ──────────────────────
// Replaces the bulk ADDRESSABLE-PARTS vocab block with a compact, RANKED, capped
// candidate list. Always includes an ESCAPE candidate that routes to clarify (never
// to a free-form selector).

export const ESCAPE_ID = '__none__';

export function candidateIds( candidates ) {

	return candidates.map( c => c.id ).concat( ESCAPE_ID );

}

/**
 * @param {Array} candidates  from rankSelectorCandidates
 * @returns {string} numbered block for the LLM prompt
 */
export function buildCandidateInjection( candidates ) {

	if ( ! candidates || ! candidates.length ) {

		return `ADDRESSABLE PARTS: (none resolved) — use selector "${ ESCAPE_ID }" and ask the user which part.`;

	}
	const lines = candidates.map( c => `  [${ c.id }] ${ c.selector }  (${ c.count } node${ c.count === 1 ? '' : 's' })` );
	lines.push( `  [${ ESCAPE_ID }] none of these — ask the user which part` );
	return [
		'ADDRESSABLE PARTS — for each op, set "selector" to ONE id below (pick, don\'t invent):',
		...lines,
		'Choose the id whose node count matches the request (e.g. "the wheels" → the multi-node wheel entry, not a single wheel).',
	].join( '\n' );

}

// ── Part 1: validate-and-recover for a model-emitted selector ─────────────────
// The model SHOULD emit a candidate id (constrained). But free-form selectors
// (older paths, unconstrained models) are recovered rather than rejected outright:
//   exact id match → the candidate; exact selector match → same; set-equivalent
//   free-form → the matching candidate; normalizeClassName recovery → a class hit;
//   otherwise accept-but-flag (valid, resolves) or reject (retry-once upstream).

/**
 * @param {string} emitted  the selector string the model produced
 * @param {Array} candidates  from rankSelectorCandidates
 * @param {object} editor
 * @returns {{ selector:string|null, nodes:Set<string>, method:string, flagged?:boolean, candidate?:object }}
 */
export function resolveEmittedSelector( emitted, candidates, editor ) {

	const root = editor && editor.scene;
	const list = candidates || [];
	const raw = String( emitted == null ? '' : emitted ).trim();

	if ( ! raw ) return { selector: null, nodes: new Set(), method: 'none' };

	// Escape → clarify.
	if ( raw === ESCAPE_ID || /^none$/i.test( raw ) ) {

		return { selector: null, nodes: new Set(), method: 'escape' };

	}

	// No candidates → the host found NOTHING addressable (e.g. a merged mesh, or an
	// unknown part). A free-form guess must not stand in for a real resolution — route
	// to clarify so "correctly refused" never masquerades as a resolved edit.
	if ( list.length === 0 ) return { selector: null, nodes: new Set(), method: 'escape' };

	// 1) Exact candidate id.
	const byId = list.find( c => c.id === raw );
	if ( byId ) return { selector: byId.selector, nodes: new Set( byId.nodes ), method: 'candidate', candidate: byId };

	// 2) Exact candidate selector string.
	const bySel = list.find( c => c.selector === raw );
	if ( bySel ) return { selector: bySel.selector, nodes: new Set( bySel.nodes ), method: 'candidate', candidate: bySel };

	// The tightest offered candidate whose node set is a PROPER SUBSET of `names` —
	// i.e. the model's free-form selector BLED past the host's intended set (".rims"
	// caught 8 nodes, the ".rims.bottom" candidate is the intended 4; ".tail-light"
	// caught an extra, ".tail-light.red" is the 2). Host has final say → snap to it.
	const snapBleed = ( names ) => {

		let best = null;
		for ( const c of list ) {

			if ( ! c.nodes || c.nodes.size === 0 || c.nodes.size >= names.size ) continue;
			let subset = true;
			for ( const x of c.nodes ) if ( ! names.has( x ) ) { subset = false; break; }
			if ( subset && ( ! best || c.nodes.size > best.nodes.size ) ) best = c;

		}
		return best;

	};

	const resolveNames = ( sel ) => new Set(
		selectorEngine.query( root, sel ).filter( n => ! isMergedNode( n ) ).map( n => n.name ).filter( Boolean ),
	);

	// 3) Free-form selector: resolve via the real engine.
	if ( root && selectorEngine.isValid( raw ) ) {

		let names = resolveNames( raw );

		// A compound that resolved to nothing may carry a spurious modifier class the
		// model invented (".grille.black" when the grille has no ".black"). Retry with
		// the modifier tokens stripped so the part class still resolves.
		if ( names.size === 0 ) {

			const stripped = stripModifierClasses( raw );
			if ( stripped && selectorEngine.isValid( stripped ) ) names = resolveNames( stripped );

		}

		if ( names.size > 0 ) {

			// Set-equivalent to a candidate → treat as that candidate (a different spelling
			// of the same intent).
			const equiv = list.find( c => setEq( c.nodes, names ) );
			if ( equiv ) return { selector: equiv.selector, nodes: names, method: 'set-equiv', candidate: equiv };

			// Bled past an offered set → snap to the host's tightest intended candidate.
			const snapped = snapBleed( names );
			if ( snapped ) return { selector: snapped.selector, nodes: new Set( snapped.nodes ), method: 'snap', candidate: snapped };

			// Accept but flag: it resolves, but it wasn't an offered candidate. A
			// subset-guard upstream still catches "named a part but hit everything".
			return { selector: raw, nodes: names, method: 'freeform', flagged: true };

		}

	}

	// 4) normalizeClassName recovery — the model wrote a bare word; try it as a class.
	if ( root ) {

		const cls = normalizeClassName( raw.replace( /^[#.]/, '' ) );
		if ( cls ) {

			const sel = `.${ cls }`;
			const names = new Set( selectorEngine.query( root, sel ).map( n => n.name ).filter( Boolean ) );
			if ( names.size > 0 ) {

				const equiv = list.find( c => setEq( c.nodes, names ) );
				return equiv
					? { selector: equiv.selector, nodes: names, method: 'set-equiv', candidate: equiv }
					: { selector: sel, nodes: names, method: 'normalized', flagged: true };

			}

		}

	}

	return { selector: null, nodes: new Set(), method: 'reject' };

}

// ── Part 5: cheap-first host resolution ───────────────────────────────────────
// If the ranked top candidate is UNAMBIGUOUS (matcher-backed, or clearly ahead of
// #2), resolve it host-side with NO model call for the selector slot. Returns the
// candidate to use, or null when the model must choose / the user must clarify.

/**
 * @param {{ candidates:Array, ambiguous:boolean }} rank  from rankSelectorCandidates
 * @param {{ margin?: number }} [opts]
 * @returns {{ resolved: object|null, ambiguous: boolean, reason: string }}
 */
export function tryHostResolve( rank, opts = {} ) {

	const margin = opts.margin != null ? opts.margin : 3;
	const list = ( rank && rank.candidates ) || [];
	const a = list[ 0 ];
	const b = list[ 1 ];
	if ( ! a ) return { resolved: null, ambiguous: false, reason: 'no-candidates' };

	// Matcher-backed leader, or a clear score gap → resolve without the model.
	if ( a.hard && ( ! b || ! b.hard ) ) return { resolved: a, ambiguous: false, reason: 'matcher-backed' };
	if ( ! b ) return { resolved: a, ambiguous: false, reason: 'sole-candidate' };
	if ( a.score - b.score >= margin ) return { resolved: a, ambiguous: false, reason: 'clear-margin' };

	return { resolved: null, ambiguous: true, reason: 'ambiguous' };

}

// ── Part 4: ambiguity + session-scoped disambiguation memory ──────────────────
// The clarify path is deterministic: top-2 within margin, or the model chose the
// escape, or the leader is weak. The host asks the user ONCE and remembers the
// choice for the SESSION (keyed by the normalized request) — not a global model
// change.

export function normalizeRequest( text ) {

	return String( text || '' ).toLowerCase().replace( /[^a-z0-9 ]+/g, ' ' ).replace( /\s+/g, ' ' ).trim();

}

export function isAmbiguous( rank ) {

	return !! ( rank && rank.ambiguous );

}

/**
 * A tiny session-scoped store the host owns: request → chosen selector. Kept here
 * (not global model state) so a user's "by wheels I mean the front ones" holds for
 * the conversation and is forgotten after.
 */
export function makeDisambiguationMemory() {

	const map = new Map();
	return {
		get: ( text ) => map.get( normalizeRequest( text ) ) || null,
		remember: ( text, selector ) => { map.set( normalizeRequest( text ), selector ); },
		clear: () => map.clear(),
		get size() { return map.size; },
	};

}
