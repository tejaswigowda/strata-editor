// ── clipControl.js ────────────────────────────────────────────────────────────
// Authoring side of imported-clip control: `$S(sel).at(t).play(clip, opts)` and
// pause / stop / seek. Every call becomes an ordinary timeline event recorded
// through SetTimelineCommand — the same execute()/undo/serialization path as
// `.animate()` — and is validated up front (unknown selector or clip throws a
// named error instead of silently doing nothing). Shared by the chainable
// `$S` verbs, the op() dispatcher and the AI op executor so all three behave
// identically.

import * as selectorEngine from './selectorEngine.js';
import { TimelineModel } from './timeline.js';
import { resolveClip, clipRoot } from './clipDirectives.js';
import { normalizeClassName } from './classDerive.js';
import { SetTimelineCommand } from '../commands/SetTimelineCommand.js';
import { SetLabelCommand } from '../commands/SetLabelCommand.js';
import { MultiCmdsCommand } from '../commands/MultiCmdsCommand.js';

const PLAY_OPTS = [ 'at', 'loop', 'speed', 'fade', 'weight', 'clampWhenFinished', 'duration' ];

function num( v, what ) {

	const n = Number( v );
	if ( ! Number.isFinite( n ) ) throw new Error( `${ what } must be a number (got ${ JSON.stringify( v ) })` );
	return n;

}

/** Surface opts -> stored event args. `fade`/`duration` are milliseconds at the surface (like .animate()), seconds in the model. */
function playArgs( clipName, opts ) {

	const args = { name: clipName };

	for ( const key of Object.keys( opts ) ) {

		if ( ! PLAY_OPTS.includes( key ) ) {

			throw new Error( `play(): unknown option "${ key }" — valid: ${ PLAY_OPTS.filter( k => k !== 'duration' ).join( ', ' ) }` );

		}

	}

	if ( opts.loop !== undefined ) args.loop = !! opts.loop;
	if ( opts.clampWhenFinished !== undefined ) args.clampWhenFinished = !! opts.clampWhenFinished;

	if ( opts.speed !== undefined ) {

		const speed = num( opts.speed, 'speed' );
		if ( speed === 0 ) throw new Error( 'play(): speed cannot be 0 — use .pause() to hold a clip' );
		args.speed = speed;

	}

	if ( opts.weight !== undefined ) {

		const weight = num( opts.weight, 'weight' );
		if ( weight < 0 ) throw new Error( 'play(): weight must be >= 0' );
		args.weight = weight;

	}

	if ( opts.fade !== undefined ) {

		const fade = num( opts.fade, 'fade' );
		if ( fade < 0 ) throw new Error( 'play(): fade must be >= 0 (milliseconds)' );
		args.fade = fade / 1000;

	}

	return args;

}

/**
 * Record one clip directive on the timeline.
 *
 * @param {Editor} editor
 * @param {object} p
 * @param {string} p.selector  the $S selector the directive is addressed to
 * @param {Array}  p.nodes     nodes that selector resolves to
 * @param {'play'|'pause'|'stop'|'seek'} p.op
 * @param {string} [p.clip]    clip name; omitted -> the target's first clip
 * @param {number} p.at        absolute start time (seconds on the shared clock)
 * @param {object} [p.opts]    play options { loop, speed, fade, weight, clampWhenFinished, duration }
 * @param {number} [p.time]    seek target (clip-local seconds)
 * @returns {{ success:true, at:number, dur:number, op:string, clip:string }}
 */
/**
 * Validate a directive and build its stored form ({ args, dur }) without
 * recording it — shared by recordClipDirective and the Animations-tab code
 * panel (which rebuilds the model from edited text).
 */
export function buildClipEvent( editor, { selector, nodes, op, clip: clipName, opts = {}, time } ) {

	const clip = resolveClip( editor, selector, nodes, clipName, op );

	let args, dur = 0;

	if ( op === 'play' ) {

		args = playArgs( clip.name, opts );
		dur = opts.duration !== undefined
			? Math.max( 0, num( opts.duration, 'duration' ) ) / 1000
			: clip.duration / Math.abs( args.speed || 1 );

	} else if ( op === 'seek' ) {

		const t = num( time, 'seek time' );
		if ( t < 0 || t > clip.duration ) {

			throw new Error( `seek(): ${ t }s is outside clip "${ clip.name }" (0–${ clip.duration.toFixed( 2 ) }s)` );

		}

		args = { name: clip.name, time: t };

	} else {

		args = { name: clip.name };

	}

	return { clip, args, dur };

}

export function recordClipDirective( editor, { selector, nodes, op, clip: clipName, at, opts = {}, time } ) {

	const { clip, args, dur } = buildClipEvent( editor, { selector, nodes, op, clip: clipName, opts, time } );

	const start = Math.max( 0, num( at, 'at' ) );

	const model = TimelineModel.fromJSON( editor.timeline ? editor.timeline.toJSON() : null );
	model.addEvent( selector, { at: start, op, args, dur } );
	editor.execute( new SetTimelineCommand( editor, model.toJSON(), `Timeline: ${ op } ${ clip.name }` ) );

	return { success: true, at: start, dur, op, clip: clip.name };

}

/**
 * Make imported clip roots addressable. Each clip's natural root (the lowest
 * common ancestor of the nodes it animates) gets a stable id from the clip name
 * (`mocap`, `Key`, `grp_eyeLeft`, …) so `$S('#mocap').play('mocap')` resolves like
 * any other node. One undoable batch; existing labels and ids that already
 * match are left alone, and a taken id gets a numeric suffix.
 */
export function labelClipRoots( editor, clips ) {

	const cmds = [];
	const used = new Set();

	for ( const clip of clips ) {

		if ( ! ( clip.duration > 0 ) ) continue;

		const root = clipRoot( editor, clip );
		if ( ! root || root === editor.scene || ( root.userData && root.userData.label ) ) continue;

		const base = normalizeClassName( String( clip.name || '' ).split( '|' )[ 0 ] );
		if ( ! base || normalizeClassName( root.name || '' ) === base ) continue;

		let id = base;
		let n = 2;
		while ( used.has( id ) || selectorEngine.query( editor.scene, '#' + id ).length > 0 ) id = `${ base }-${ n ++ }`;

		used.add( id );
		cmds.push( new SetLabelCommand( editor, root, id ) );

	}

	if ( cmds.length ) editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );

}

/**
 * op-JSON entry point (free op() dispatcher + AI executor). Same arg names the
 * model fills: clip, at, loop, speed, weight, fade, clampWhenFinished, time.
 * Returns { success, message? } instead of throwing, like every other op().
 */
export function clipControlOp( editor, { type, selector, ...rest } ) {

	try {

		const nodes = selectorEngine.query( editor.scene, selector );
		const opts = {};
		for ( const key of PLAY_OPTS ) if ( key !== 'at' && rest[ key ] !== undefined ) opts[ key ] = rest[ key ];

		const r = recordClipDirective( editor, {
			selector,
			nodes,
			op: type,
			clip: rest.clip ?? rest.name,
			at: rest.at ?? 0,
			opts: type === 'play' ? opts : {},
			time: rest.time,
		} );

		return { success: true, count: nodes.length, at: r.at, message: `${ type } "${ r.clip }" @ ${ r.at }s` };

	} catch ( e ) {

		return { success: false, message: e.message };

	}

}
