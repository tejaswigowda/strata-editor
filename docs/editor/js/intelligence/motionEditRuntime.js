// ── motionEditRuntime.js ──────────────────────────────────────────────────────
// Editor-bound half of the motion edit list (the pure half is motionEdit.js).
//
// A performance GROUP lives on the timeline model (`model.groups`): its edit list
// is stored once, and every member is a `play` event with `args.group`. This module
//   * resolves a group's members to their captured clips,
//   * compiles the edit list to in-memory derived clips (cached; a compile product,
//     never serialized — the capture on scene.animations is only read),
//   * answers "what pose at global time t" for the sampler (timelineController),
//   * bakes tracks for glTF export, and
//   * runs the hip-to-hip collision report against the live scene.

import * as THREE from 'three';
import { nodesForTarget, clipsForNodes, importedClipsOf } from './clipDirectives.js';
import { buildEditedClips, edlDuration, edlTable, collisionReport, findRoot, MotionEditError } from './motionEdit.js';

const CACHE = '__motionEditCache';

function memberEdit( group, target ) {

	return ( group.members && group.members[ target ] ) || {};

}

/** Source clip a group member plays: the clip named on its play event, scoped to the target's subtree. */
export function memberClip( editor, model, group, target ) {

	const event = model.groupEvents( group.id ).find( e => model.tracks.some( t => t.target === target && t.events.includes( e ) ) );
	const name = event && event.args && event.args.name;
	const nodes = nodesForTarget( editor, target );
	if ( nodes.length === 0 ) throw new MotionEditError( `group "${ group.id }": selector "${ target }" matches nothing`, 'NO_TARGET' );

	const scoped = clipsForNodes( editor, nodes );
	const clip = scoped.find( c => c.name === name ) || importedClipsOf( editor ).find( c => c.name === name );
	if ( ! clip ) throw new MotionEditError( `group "${ group.id }": no clip "${ name }" on ${ target }`, 'NO_CLIP' );
	return clip;

}

// Resolving members runs selector queries; the sampler asks every frame, so memoize per model
// (any timeline edit or scene load swaps the model object).
const memberCache = new WeakMap();

export function groupMembers( editor, model, group ) {

	let perModel = memberCache.get( model );
	if ( ! perModel ) memberCache.set( model, perModel = new Map() );

	const clipsNow = ( editor.scene.animations || [] ).length;
	const hit = perModel.get( group.id );
	if ( hit && hit.group === group && hit.clipsNow === clipsNow ) return hit.members;

	const members = group.targets.map( target => ( { id: target, clip: memberClip( editor, model, group, target ), ...memberEdit( group, target ) } ) );
	perModel.set( group.id, { group, clipsNow, members } );
	return members;

}

/** Length of the shared clip domain: the shortest member capture. */
export function groupDomain( editor, model, group ) {

	return Math.min( ...groupMembers( editor, model, group ).map( m => m.clip.duration ) );

}

function cacheKey( group, members ) {

	return JSON.stringify( [ group.edl, group.members || {}, members.map( m => m.clip.uuid ) ] );

}

/** Derived clips for a group's edit list (Map target -> clip), recompiled only when the list or sources change. */
export function compiledGroup( editor, group ) {

	if ( ! group.edl ) return null;

	const model = editor.timeline;
	const members = groupMembers( editor, model, group );
	const key = cacheKey( group, members );

	const store = editor[ CACHE ] || ( editor[ CACHE ] = new Map() );
	const hit = store.get( group.id );
	if ( hit && hit.key === key ) return hit.clips;

	if ( hit ) for ( const c of hit.clips.values() ) editor.mixer.uncacheClip( c ); // drop the stale derived actions

	const clips = buildEditedClips( members, group.edl );
	store.set( group.id, { key, clips } );
	return clips;

}

/**
 * The pose source for an imported clip at global time `t`, when one of its play events
 * belongs to an edited group: { clip: derived, local } — otherwise null (use the capture).
 */
export function editedPlayback( editor, clip, events, t ) {

	const model = editor.timeline;
	if ( ! model || ! model.groups.length ) return null;

	const event = events.find( e => e.op === 'play' && e.args && e.args.group );
	if ( ! event ) return null;

	const group = model.group( event.args.group );
	if ( ! group || ! group.edl ) return null;

	const clips = compiledGroup( editor, group );
	const member = groupMembers( editor, model, group ).find( m => m.clip === clip );
	const derived = member && clips.get( member.id );
	if ( ! derived ) return null;

	return { clip: derived, local: Math.min( Math.max( 0, t - event.at ), derived.duration ) };

}

/** glTF export: the tracks an edited member actually plays, placed on the shared clock. Null = not edited. */
export function editedExportTracks( editor, clip, events ) {

	const model = editor.timeline;
	const event = model && events.find( e => e.op === 'play' && e.args && e.args.group );
	if ( ! event ) return null;

	const group = model.group( event.args.group );
	if ( ! group || ! group.edl ) return null;

	const member = groupMembers( editor, model, group ).find( m => m.clip === clip );
	const derived = member && compiledGroup( editor, group ).get( member.id );
	if ( ! derived ) return null;

	return derived.tracks.map( t => new t.constructor( t.name, Array.from( t.times, x => x + event.at ), Array.from( t.values ), t.getInterpolation() ) );

}

/**
 * Hip-to-hip floor distance over the group's (edited) timeline. World positions use each root's
 * parent matrix in the live scene, so character placement and scale are honoured.
 */
export function groupCollisionReport( editor, group, { floor, step } = {} ) {

	const model = editor.timeline;
	const members = groupMembers( editor, model, group );
	const edited = group.edl ? compiledGroup( editor, group ) : null;

	const rigs = members.map( m => {

		const clip = edited ? edited.get( m.id ) : m.clip;
		const root = findRoot( clip );
		if ( ! root ) throw new MotionEditError( `"${ m.id }" has no root position track to measure`, 'NO_ROOT' );

		const prefix = clip.tracks[ root.posIndex ].name.replace( /\.position$/, '' );
		const node = editor.scene.getObjectByProperty( 'uuid', prefix ) || THREE.PropertyBinding.findNode( editor.scene, prefix );
		let matrix = null;

		if ( node && node.parent ) {

			node.parent.updateWorldMatrix( true, false );
			matrix = node.parent.matrixWorld.clone();

		}

		return { id: m.id, clip, matrix };

	} );

	const report = collisionReport( rigs, {
		floor,
		step,
		at: group.at || 0,
		spans: group.edl ? edlTable( group.edl ) : [],
	} );

	report.group = group.id;
	report.edited = !! group.edl;
	if ( group.broken ) report.warning = 'registration is broken — the performers are no longer edited as a unit';
	return report;

}

/** Human-readable problems with the groups on a model (a member's edit list drifting, missing members). */
export function groupProblems( editor, model ) {

	const problems = [];

	for ( const g of model.groups ) {

		const events = model.groupEvents( g.id );

		if ( events.length !== g.targets.length ) problems.push( `group "${ g.id }": expected ${ g.targets.length } member events, found ${ events.length } — the pair is no longer edited as a unit` );

		const want = g.edl ? edlDuration( g.edl ) : null;
		if ( want !== null && events.some( e => Math.abs( e.dur - want ) > 1e-6 ) ) problems.push( `group "${ g.id }": a member's block length differs from its edit list (${ want.toFixed( 2 ) }s)` );
		if ( events.some( e => Math.abs( e.at - ( g.at || 0 ) ) > 1e-6 ) && ! g.broken ) problems.push( `group "${ g.id }": members start at different times — registration is lost (use breakRegistration() if intended)` );

	}

	return problems;

}
