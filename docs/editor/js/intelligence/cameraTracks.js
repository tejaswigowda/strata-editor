// ── cameraTracks.js ───────────────────────────────────────────────────────────
// Camera tracks in a TimelineModel, with no editor, no three.js and no commands, so the node
// tests share the editor's logic: find a camera's track, the shot beats of the render Camera
// Sequence, and "simplify every camera" over a model. cameraMoveEdit.js wraps these in the
// editor's undo stack.

import { cameraKeys } from './splineTrack.js';
import * as move from './cameraMove.js';

/** Selectors a camera's track may be stored under, best first. */
export function cameraSelectors( camera ) {

	const out = [];
	if ( camera.userData && camera.userData.label ) out.push( '#' + camera.userData.label );
	if ( camera.name ) out.push( '#' + camera.name );
	out.push( camera.uuid );
	return out;

}

/** The camera's track in `timeline` (a TimelineModel), or null. */
export function findCameraTrack( timeline, camera ) {

	if ( ! timeline || ! camera ) return null;
	for ( const sel of cameraSelectors( camera ) ) {

		const t = timeline.tracks.find( t => t.target === sel );
		if ( t ) return t;

	}
	return null;

}

/**
 * The times a camera's shot starts and ends in the render Camera Sequence
 * (renderShots: [{ at, camera: uuid }]; a shot runs from its `at` to the next shot's `at`, or `end`).
 * Simplify keeps the keys nearest these so a cut lands on a key.
 */
export function shotBeats( shots, end, camera ) {

	const sorted = ( shots || [] ).slice().sort( ( a, b ) => a.at - b.at );
	const beats = [];
	sorted.forEach( ( s, i ) => {

		if ( s.camera !== camera.uuid ) return;
		beats.push( s.at );
		const next = sorted[ i + 1 ];
		if ( next ) beats.push( next.at ); else if ( end > s.at ) beats.push( end );

	} );
	return beats;

}

/** simplify options for one camera: with keepBeats on, its shot start/end times join `opts.beats`. */
export function optionsForCamera( shots, end, camera, opts ) {

	const o = move.simplifyOptions( opts );
	return o.keepBeats ? { ...o, beats: o.beats.concat( shotBeats( shots, end, camera ) ) } : o;

}

/** Cameras with a track of 4+ keys (fewer is already a handful). */
export function simplifiableIn( model, cameras ) {

	return cameras.filter( c => cameraKeys( ( findCameraTrack( model, c ) || { events: [] } ).events ).length >= 4 );

}

/**
 * Simplify every listed camera's track in `model`, in place (or only measure it with `dryRun`).
 * Returns { cameras, before, after, changed, report: [{ camera, before, after, worst }] }.
 */
export function simplifyAllInModel( model, cameras, shots, opts, { dryRun = false } = {} ) {

	const o = { preset: 'normal', keepBeats: true, ...( opts && typeof opts === 'object' ? opts : typeof opts === 'string' ? { preset: opts } : opts === undefined ? {} : { tolerance: opts } ) };
	const cams = simplifiableIn( model, cameras );
	const report = cams.map( camera => {

		const track = findCameraTrack( model, camera );
		const co = optionsForCamera( shots, model.duration, camera, o );
		const r = dryRun ? move.previewSimplify( track, co ) : move.simplifyTrack( track, co );
		return { camera: ( camera.userData && camera.userData.label ) || camera.name || camera.uuid, before: r.before, after: r.after, worst: r.worst };

	} );
	const sum = k => report.reduce( ( n, r ) => n + r[ k ], 0 );
	return { cameras: cams.length, before: sum( 'before' ), after: sum( 'after' ), changed: report.filter( r => r.after < r.before ).length, report };

}
