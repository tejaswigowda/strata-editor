// ── faceEdit.js ───────────────────────────────────────────────────────────────
// Editor-side half of face + gaze editing: apply an edit from faceTrack.js to a character's track
// as ONE undoable SetTimelineCommand. The shell (`$S('#f1').face…`, `.gaze(…)`), the Customize tab
// and the Animations tab all go through editFaceTrack, so a key means the same thing wherever it is
// authored, edits redraw every surface live, and there is one undo stack. Nothing here needs a
// viewport — an agent can author a whole performance headless.

import { TimelineModel } from './timeline.js';
import { SetTimelineCommand } from '../commands/SetTimelineCommand.js';
import { nodesForTarget } from './clipDirectives.js';
import { rigOf } from './faceRuntime.js';
import * as F from './faceTrack.js';

/**
 * Apply `fn( track, model )` to the track for `selector` on a private deep copy, then execute the result
 * as ONE SetTimelineCommand. Creates the track if the character has none; drops it again if it ends up
 * empty. If `fn` throws, nothing is executed. Returns whatever `fn` returns.
 */
export function editFaceTrack( editor, selector, name, fn ) {

	const json = editor.timeline ? JSON.parse( JSON.stringify( editor.timeline.toJSON() ) ) : { duration: 0, tracks: [] };
	const model = TimelineModel.fromJSON( json );
	const track = model.track( selector, true );

	const result = fn( track, model );

	if ( ! track.events.length ) model.tracks.splice( model.tracks.indexOf( track ), 1 );

	model.recomputeDuration();
	editor.execute( new SetTimelineCommand( editor, model.toJSON(), name ) );
	return result;

}

/** The character a selector addresses and its face rig, or throws a named error. */
function characterOf( editor, selector, verb ) {

	const nodes = nodesForTarget( editor, selector );
	if ( nodes.length === 0 ) throw new F.FaceError( `${ verb }: selector "${ selector }" matches nothing`, 'NO_TARGET' );
	return { node: nodes[ 0 ], rig: rigOf( nodes[ 0 ] ) };

}

function checkShapesExist( editor, selector, shapes, verb ) {

	const { rig } = characterOf( editor, selector, verb );
	if ( rig.meshes.length === 0 ) throw new F.FaceError( `${ verb }: ${ selector } has no mesh with morph targets — nothing to animate`, 'NO_MORPHS' );

	const bad = Object.keys( shapes ).filter( s => ! rig.shapes.has( s ) );

	if ( bad.length ) {

		const arkit = [ ...rig.shapes ].filter( s => /^[a-z]/.test( s ) ).slice( 0, 8 ).join( ', ' );
		throw new F.FaceError( `${ verb }: no morph target ${ bad.map( b => `"${ b }"` ).join( ', ' ) } on ${ selector } (e.g. ${ arkit })`, 'NO_SHAPE' );

	}

}

function checkTargetResolves( editor, target, verb ) {

	if ( typeof target !== 'string' || target === 'away' ) return;
	if ( nodesForTarget( editor, target ).length === 0 ) throw new F.FaceError( `${ verb }: gaze target "${ target }" matches nothing`, 'NO_TARGET' );

}

/**
 * `$S('#f1').face` — the character's expression channel. Every method that changes something returns
 * the channel (chainable) and is one undo step.
 */
export class FaceChannel {

	constructor( editor, selector ) {

		this.editor = editor;
		this.selector = selector;

	}

	_track() {

		return this.editor.timeline ? this.editor.timeline.track( this.selector ) : null;

	}

	/** The keys: [{ index, id, time, duration, easing, shapes, hold, label }] — the Customize / timeline list. */
	keys() {

		return F.keyList( this._track(), F.FACE_OP );

	}

	/** Every shape name this character can be keyed on. */
	shapes() {

		return [ ...characterOf( this.editor, this.selector, 'shapes' ).rig.shapes ].sort();

	}

	/**
	 * Key `shapes` to arrive at `t` seconds: { shapes: { jawOpen: 0.4 }, easing, duration (ms), hold }.
	 * A key arriving at the same time is merged. Headless.
	 */
	keyAt( t, spec = {} ) {

		if ( spec.shapes ) checkShapesExist( this.editor, this.selector, spec.shapes, 'face.keyAt' );
		editFaceTrack( this.editor, this.selector, `Face: key at ${ t }s`, track => F.upsertKey( track, F.FACE_OP, { ...spec, time: t } ) );
		return this;

	}

	/** Change key i: { time, duration, easing, shapes (replaces), hold }. */
	moveKey( i, spec ) {

		if ( spec && spec.shapes ) checkShapesExist( this.editor, this.selector, spec.shapes, 'face.moveKey' );
		editFaceTrack( this.editor, this.selector, `Move face key ${ i }`, track => F.moveKey( track, F.FACE_OP, i, spec || {} ) );
		return this;

	}

	deleteKey( i ) {

		editFaceTrack( this.editor, this.selector, `Delete face key ${ i }`, track => F.deleteKey( track, F.FACE_OP, i ) );
		return this;

	}

	/**
	 * A preset as EXPLICIT per-shape keys at t — the preset is a convenience, the keys are the truth and
	 * stay editable. neutral clears every shape the track already drives.
	 */
	applyPreset( name, t, opts = {} ) {

		const { rig } = characterOf( this.editor, this.selector, 'applyPreset' );
		const shapes = Object.fromEntries( Object.entries( F.expandPreset( name, F.drivenShapes( this._track() ) ) ).filter( ( [ s ] ) => rig.shapes.has( s ) ) );
		if ( Object.keys( shapes ).length === 0 ) return this; // neutral with nothing driven: already at rest
		editFaceTrack( this.editor, this.selector, `Face: ${ name } at ${ t }s`, track => F.upsertKey( track, F.FACE_OP, { ...opts, shapes, time: t } ) );
		return this;

	}

	/**
	 * The procedural idle layer (blink, breath, gaze micro-noise): seeded, deterministic, an UNDERLAYER —
	 * it is never baked into the keys. idle() / idle(true) enables it, idle(false) removes it (authored
	 * keys are untouched either way), idle({ seed, blink, breath, gazeNoise, blinkInterval }) tunes it.
	 */
	idle( opts ) {

		const idle = F.normalizeIdle( opts );

		editFaceTrack( this.editor, this.selector, idle ? 'Face: idle on' : 'Face: idle off', ( track, model ) => {

			if ( idle ) model.faces[ this.selector ] = { ...( model.faces[ this.selector ] || {} ), idle };
			else delete model.faces[ this.selector ];

		} );

		return this;

	}

	/** The idle layer's current settings, or null. */
	idleConfig() {

		const cfg = this.editor.timeline && this.editor.timeline.face( this.selector );
		return cfg && cfg.idle ? { ...cfg.idle } : null;

	}

	/** The command that rebuilds this character's face + gaze keys (and idle layer) exactly. */
	asCommand() {

		const lines = [];
		const cmd = F.toCommand( this._track(), this.selector );
		if ( cmd ) lines.push( cmd );

		const idle = this.idleConfig();

		if ( idle ) lines.push( F.idleCommand( this.selector, idle ) );

		return lines.join( '\n' );

	}

}

/** The gaze verbs on a character — shared by ChainableSet so `$S('#f1').gaze(…)` and the GUI agree. */
export const gazeVerbs = {

	gazeKeys( editor, selector ) {

		return F.keyList( editor.timeline ? editor.timeline.track( selector ) : null, F.GAZE_OP );

	},

	/**
	 * Look at `target` — a selector ('#f2': follows that character as it moves), a point [x,y,z] (holds),
	 * or 'away' — arriving at t seconds. { duration (ms), easing, head: 0..1 } — head 0 is a glance (eyes only),
	 * higher is a turn. A key arriving at the same time is replaced.
	 */
	gazeAt( editor, selector, t, target, opts = {} ) {

		characterOf( editor, selector, 'gaze' );
		checkTargetResolves( editor, target, 'gaze' );
		editFaceTrack( editor, selector, `Gaze: ${ typeof target === 'string' ? target : 'point' } at ${ t }s`, track => F.upsertKey( track, F.GAZE_OP, { ...opts, target, time: t } ) );

	},

	moveGaze( editor, selector, i, spec ) {

		if ( spec && spec.target !== undefined ) checkTargetResolves( editor, spec.target, 'moveGaze' );
		editFaceTrack( editor, selector, `Move gaze key ${ i }`, track => F.moveKey( track, F.GAZE_OP, i, spec || {} ) );

	},

	deleteGaze( editor, selector, i ) {

		editFaceTrack( editor, selector, `Delete gaze key ${ i }`, track => F.deleteKey( track, F.GAZE_OP, i ) );

	},

};
