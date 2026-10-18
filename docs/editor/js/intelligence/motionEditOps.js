// ── motionEditOps.js ──────────────────────────────────────────────────────────
// Authoring surface for motion edit lists — the shell's `$M`. Every call is one
// undoable SetTimelineCommand on the SAME model the Animations tab draws, so shell
// and GUI are two views of one edit list, share one undo stack, and an agent can
// author a cut with no viewport (nothing here touches a renderer).
//
//   $M.group('sparring', ['#f1', '#f2'])       register the performers as ONE editable unit
//   $M('sparring').splice([[1.6, 9], [14.6, 22.1]], { blend: 0.25 })
//   $M('sparring').play({ from: 1.6, to: 9 })  trim (the primitive)
//   $M('sparring').speed(0.5) / .retime(curve) / .hold(t, dur) / .rootOffset(v) / .rootYaw(deg)
//   $M('sparring').collision()                  hip-to-hip report over the edited timeline
//   $M('sparring').clear()                      drop the edit list — the full capture is back
//   $M('sparring').breakRegistration()          explicit, undoable; then .timeOffset(sel, dt) / .speedOf(sel, f)
//
// The capture is never modified; the edit list is a few hundred bytes of data.

import { TimelineModel } from './timeline.js';
import { SetTimelineCommand } from '../commands/SetTimelineCommand.js';
import { nodesForTarget, clipsForNodes } from './clipDirectives.js';
import * as M from './motionEdit.js';
import { groupMembers, groupDomain, groupCollisionReport, compiledGroup, groupProblems } from './motionEditRuntime.js';

const { MotionEditError } = M;
const ID = /^[A-Za-z][\w-]*$/;
const fail = ( m, code ) => { throw new MotionEditError( m, code ); };

const BREAK_WARNING = 'Registration broken. Per-performer timeOffset / speed are now allowed, and they desynchronise the pair: '
	+ 'the fighters can clip through each other, and the capture\'s shared metric frame no longer holds between them. '
	+ 'Spans, blend and root moves still apply to both. restoreRegistration() undoes this; so does Undo.';

function cloneModel( editor ) {

	return TimelineModel.fromJSON( editor.timeline ? editor.timeline.toJSON() : null );

}

function commit( editor, model, name ) {

	model.recomputeDuration();
	editor.execute( new SetTimelineCommand( editor, model.toJSON(), name ) );

}

/**
 * Point a group's edit list at `edl` (null = the full capture) and re-derive every member's
 * play event from it, on `model`. Members are always written together — that is what keeps
 * the pair registered. Used by the shell, the Animations-tab code panel and the GUI.
 */
export function setGroupEdl( editor, model, group, edl ) {

	group.edl = edl;
	const members = groupMembers( editor, model, group );
	const outDur = edl ? M.edlDuration( edl ) : null;

	for ( const m of members ) {

		const event = model.groupEvents( group.id ).find( e => model.tracks.some( t => t.target === m.id && t.events.includes( e ) ) );
		if ( ! event ) fail( `group "${ group.id }" lost the play event for ${ m.id }`, 'BROKEN_GROUP' );
		event.at = group.at || 0;
		event.dur = outDur !== null ? outDur : m.clip.duration;

	}

}

/** Declarative text of a group's cut — what the code panel shows and the shell re-accepts. */
export function cutCommand( group ) {

	const f = n => Math.round( n * 1e6 ) / 1e6;
	const lines = [];

	if ( group.edl ) {

		const spans = group.edl.spans.map( s => s.hold !== undefined ? `{ hold: ${ f( s.hold ) }, dur: ${ f( s.dur ) } }` : `{ from: ${ f( s.from ) }, to: ${ f( s.to ) }${ s.speed ? `, speed: ${ s.speed }` : '' } }` );
		const opts = [ `blend: ${ f( group.edl.blend ) }` ];
		if ( group.edl.rootOffset.some( v => v !== 0 ) ) opts.push( `rootOffset: [${ group.edl.rootOffset.map( f ).join( ', ' ) }]` );
		if ( group.edl.rootYaw ) opts.push( `rootYaw: ${ f( group.edl.rootYaw ) }` );
		lines.push( `$M('${ group.id }')${ group.at ? `.at(${ f( group.at ) })` : '' }.cut([ ${ spans.join( ', ' ) } ], { ${ opts.join( ', ' ) } });` );

	}

	if ( group.broken ) {

		const per = Object.entries( group.members || {} ).flatMap( ( [ t, v ] ) => [
			...( v.timeOffset ? [ `.timeOffset('${ t }', ${ f( v.timeOffset ) })` ] : [] ),
			...( v.speed && v.speed !== 1 ? [ `.speedOf('${ t }', ${ f( v.speed ) })` ] : [] ),
		] );
		lines.push( `$M('${ group.id }').breakRegistration()${ per.join( '' ) };` );

	}

	return lines.join( '\n' );

}

/** Group definition line (shown above the cut; informational in the code panel). */
export function groupCommand( group ) {

	return `$M.group('${ group.id }', [${ group.targets.map( t => `'${ t }'` ).join( ', ' ) }]);`;

}

class MotionGroup {

	constructor( editor, id ) {

		this.editor = editor;
		this.id = id;
		this.lastWarning = null;
		this._get(); // throws for an unknown group

	}

	_get( model = this.editor.timeline ) {

		const g = model && model.group( this.id );
		if ( ! g ) fail( `no performance group "${ this.id }" — create it with $M.group('${ this.id }', ['#a', '#b'])`, 'NO_GROUP' );
		return g;

	}

	/** One undoable edit of the shared edit list, applied to every member at once. */
	_edit( label, fn ) {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		const domain = groupDomain( this.editor, model, g );
		const base = g.edl || M.fullEdl( domain );

		setGroupEdl( this.editor, model, g, fn( base, domain, g ) );
		commit( this.editor, model, `Motion: ${ label } ${ this.id }` );
		return this;

	}

	// ── The op set (each a pure transform over the group's edit list) ────────

	/** .play({ from, to }) — trim to a span. The primitive: everything else composes from it. */
	play( clip, opts ) {

		if ( clip && typeof clip === 'object' ) { opts = clip; clip = undefined; }
		if ( ! opts || opts.from === undefined || opts.to === undefined ) fail( 'play(): needs { from, to } (clip-local seconds)' );

		if ( clip !== undefined ) {

			const model = this.editor.timeline;
			const names = groupMembers( this.editor, model, this._get() ).map( m => m.clip.name );
			if ( ! names.includes( clip ) ) fail( `play(): "${ clip }" is not one of the group's clips (${ names.join( ', ' ) })` );

		}

		return this.trim( opts.from, opts.to );

	}

	trim( from, to ) {

		return this._edit( 'trim', ( edl, dur ) => M.trim( edl, from, to, dur ) );

	}

	/** .splice([{from,to}, …], { blend }) — join non-adjacent spans. A blend is mandatory (default 0.25s). */
	splice( spans, opts = {} ) {

		return this._edit( 'splice', ( edl, dur ) => {

			let out = M.splice( edl, spans, { blend: opts.blend }, dur );
			if ( opts.rootOffset !== undefined ) out = M.rootOffset( out, opts.rootOffset, dur );
			if ( opts.rootYaw !== undefined ) out = M.rootYaw( out, opts.rootYaw, dur );
			return out;

		} );

	}

	/** .cut(spans, opts) — replace the whole edit list declaratively (what asCommand() emits). */
	cut( spans, opts = {} ) {

		return this._edit( 'cut', ( edl, dur ) => M.normalizeEdl( { spans, blend: opts.blend, rootOffset: opts.rootOffset, rootYaw: opts.rootYaw }, dur ) );

	}

	speed( f ) {

		return this._edit( 'speed', ( edl, dur ) => M.speed( edl, f, dur ) );

	}

	retime( curve ) {

		return this._edit( 'retime', ( edl, dur ) => M.retime( edl, curve, dur ) );

	}

	/** .hold(t, dur) — freeze the pose at cut-time t for dur seconds. */
	hold( t, dur ) {

		return this._edit( 'hold', ( edl, d ) => M.hold( edl, t, dur, d ) );

	}

	rootOffset( v ) {

		return this._edit( 'rootOffset', ( edl, dur ) => M.rootOffset( edl, v, dur ) );

	}

	rootYaw( deg ) {

		return this._edit( 'rootYaw', ( edl, dur ) => M.rootYaw( edl, deg, dur ) );

	}

	/** Start of the cut on the shared clock (what dragging the block does). Both performers move together. */
	at( t ) {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		if ( typeof t !== 'number' || ! Number.isFinite( t ) || t < 0 ) fail( 'at(): expected a time in seconds >= 0' );
		g.at = t;
		for ( const e of model.groupEvents( g.id ) ) e.at = t;
		commit( this.editor, model, `Motion: move ${ this.id }` );
		return this;

	}

	/** Drop the edit list: the full, untouched capture plays again. */
	clear() {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		g.members = {};
		g.broken = false;
		setGroupEdl( this.editor, model, g, null );
		commit( this.editor, model, `Motion: clear ${ this.id }` );
		return this;

	}

	// ── Registration ─────────────────────────────────────────────────────────

	breakRegistration() {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		if ( g.broken ) return this;

		g.broken = true;
		g.members = g.members || {};
		commit( this.editor, model, `Motion: break registration ${ this.id }` );

		this.lastWarning = BREAK_WARNING;
		if ( typeof console !== 'undefined' ) console.warn( BREAK_WARNING );
		return this;

	}

	restoreRegistration() {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		g.broken = false;
		g.members = {};
		setGroupEdl( this.editor, model, g, g.edl );
		commit( this.editor, model, `Motion: restore registration ${ this.id }` );
		this.lastWarning = null;
		return this;

	}

	_perMember( what, target, key, value ) {

		const model = cloneModel( this.editor );
		const g = this._get( model );

		if ( ! g.broken ) {

			fail( `${ what }() breaks registration: it shifts or retimes ONE performer against the other, so they can clip through each other `
				+ `and lose the shared capture frame. Call $M('${ this.id }').breakRegistration() first — it warns and is undoable.`, 'REGISTRATION' );

		}

		if ( ! g.targets.includes( target ) ) fail( `${ what }(): "${ target }" is not in group "${ this.id }" (${ g.targets.join( ', ' ) })` );

		g.members = g.members || {};
		g.members[ target ] = { ...( g.members[ target ] || {} ), [ key ]: value };
		const domain = groupDomain( this.editor, model, g );
		setGroupEdl( this.editor, model, g, g.edl || M.fullEdl( domain ) );
		commit( this.editor, model, `Motion: ${ what } ${ target } ${ this.id }` );
		return this;

	}

	/** Shift one performer's source against the other (seconds). Registration-destructive; needs breakRegistration(). */
	timeOffset( target, dt ) {

		if ( typeof dt !== 'number' || ! Number.isFinite( dt ) ) fail( 'timeOffset(): dt must be a number of seconds' );
		return this._perMember( 'timeOffset', target, 'timeOffset', dt );

	}

	/** Play one performer faster/slower than the other. Registration-destructive; needs breakRegistration(). */
	speedOf( target, f ) {

		if ( typeof f !== 'number' || ! ( f > 0 ) ) fail( 'speedOf(): factor must be a positive number' );
		return this._perMember( 'speedOf', target, 'speed', f );

	}

	// ── Reports ──────────────────────────────────────────────────────────────

	/** Hip-to-hip floor distance over the edited timeline; flags spans under the floor (default 0.6 m). */
	collision( opts = {} ) {

		return groupCollisionReport( this.editor, this._get(), opts );

	}

	/** The edit list (a copy), or null when the full capture plays. */
	edl() {

		const g = this._get();
		return g.edl ? JSON.parse( JSON.stringify( g.edl ) ) : null;

	}

	/** The cut laid out on its own clock: one row per span with its start/length. */
	table() {

		const g = this._get();
		return g.edl ? M.edlTable( g.edl ).map( r => ( { ...r, at: ( g.at || 0 ) + r.outStart } ) ) : [];

	}

	/** The command that reproduces this group's cut. Dragging a block in the timeline changes what this emits. */
	asCommand() {

		return cutCommand( this._get() );

	}

	/** Compiled (derived, in-memory) clips of the cut — for export or inspection. Never the authoring path. */
	bake() {

		const g = this._get();
		if ( ! g.edl ) fail( 'bake(): nothing is cut — the capture plays as-is' );
		return compiledGroup( this.editor, g );

	}

	/**
	 * Remap other tracks (e.g. cameras cut against the full capture) to the cut's timebase.
	 * An event survives when it lies wholly inside ONE kept span; everything else is dropped and reported.
	 */
	remapShots( selectors ) {

		const model = cloneModel( this.editor );
		const g = this._get( model );
		if ( ! g.edl ) fail( 'remapShots(): cut the group first' );

		const rows = M.edlTable( g.edl ).filter( r => ! r.hold );
		const report = { kept: 0, dropped: 0, droppedEvents: [] };

		for ( const t of model.tracks ) {

			if ( selectors && ! selectors.includes( t.target ) ) continue;
			if ( t.events.some( e => e.args && e.args.group === g.id ) ) continue;
			if ( g.targets.includes( t.target ) ) continue;

			t.events = t.events.filter( e => {

				const row = rows.find( r => e.at >= r.from - 1e-9 && e.at + e.dur <= r.to + 1e-9 );

				if ( ! row ) {

					report.dropped ++;
					report.droppedEvents.push( { target: t.target, op: e.op, at: e.at } );
					return false;

				}

				e.at = ( g.at || 0 ) + row.outStart + ( e.at - row.from ) / row.speed;
				e.dur = e.dur / row.speed;
				report.kept ++;
				return true;

			} );

		}

		model.tracks = model.tracks.filter( t => t.events.length > 0 );
		commit( this.editor, model, `Motion: remap shots ${ this.id }` );
		this.lastReport = report;
		return report;

	}

	toString() {

		return this.asCommand();

	}

}

/**
 * Register a performance group over clips that share a capture frame. Both (all) targets are then
 * edited together. Existing plain play directives on the targets fold into the group's events.
 */
export function defineGroup( editor, id, targets, opts = {} ) {

	if ( typeof id !== 'string' || ! ID.test( id ) ) fail( 'group(): id must look like a name, e.g. "sparring"' );
	if ( ! Array.isArray( targets ) || targets.length < 2 || ! targets.every( t => typeof t === 'string' && t ) ) fail( 'group(): needs at least two performer selectors, e.g. [\'#f1\', \'#f2\']' );
	if ( new Set( targets ).size !== targets.length ) fail( 'group(): a performer listed twice' );

	const model = cloneModel( editor );
	if ( model.group( id ) ) fail( `group "${ id }" already exists` );

	for ( const t of targets ) {

		const other = model.groups.find( g => g.targets.includes( t ) );
		if ( other ) fail( `${ t } is already in group "${ other.id }"` );

	}

	let at = opts.at;
	const picks = [];

	for ( const target of targets ) {

		const nodes = nodesForTarget( editor, target );
		if ( nodes.length === 0 ) fail( `group(): selector "${ target }" matches nothing`, 'NO_TARGET' );

		const avail = clipsForNodes( editor, nodes );
		const want = opts.clips && opts.clips[ target ];
		const clip = want ? avail.find( c => c.name === want ) : avail[ 0 ];
		if ( ! clip ) fail( `group(): no ${ want ? `clip "${ want }"` : 'clip' } on ${ target } — available: ${ avail.map( c => c.name ).join( ', ' ) || '(none)' }`, 'NO_CLIP' );

		const track = model.track( target );
		const old = track ? track.events.filter( e => e.op === 'play' && e.args.name === clip.name ) : [];

		for ( const e of old ) {

			if ( Object.keys( e.args ).some( k => k !== 'name' ) ) fail( `group(): ${ target } already has a customised play directive on "${ clip.name }" — remove it first so the group owns the timing`, 'HAS_DIRECTIVE' );

		}

		if ( at === undefined && old.length ) at = Math.min( ...old.map( e => e.at ) );
		picks.push( { target, clip, old } );

	}

	at = at === undefined ? 0 : at;
	const group = { id, targets: targets.slice(), at, edl: null, broken: false, members: {} };

	for ( const { target, clip, old } of picks ) {

		const track = model.track( target );
		if ( track ) track.events = track.events.filter( e => ! old.includes( e ) );
		model.addEvent( target, { at, op: 'play', args: { name: clip.name, group: id }, dur: clip.duration } );

	}

	model.groups.push( group );
	commit( editor, model, `Motion: group ${ id }` );
	return new MotionGroup( editor, id );

}

/** `$M` — bound to an editor. $M('id') -> group handle; $M.group(id, targets) creates one. */
export function makeMotion( editor ) {

	const $M = ( id ) => new MotionGroup( editor, id );

	$M.group = ( id, targets, opts ) => defineGroup( editor, id, targets, opts );
	$M.groups = () => ( editor.timeline ? editor.timeline.groups.map( g => g.id ) : [] );
	$M.problems = () => ( editor.timeline ? groupProblems( editor, editor.timeline ) : [] );

	return $M;

}

export { MotionGroup, BREAK_WARNING };
