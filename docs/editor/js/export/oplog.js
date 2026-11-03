// The operation log: who drove each operation, and what it wrote. A pure module (no THREE, no DOM), so it is testable in node and the attribution
// engine (attribution.js) and the tools read the same shape.
//
// The editor already has ONE history shared by the gui, the Shell and any agent. What it did not keep is who issued each entry. This records that, beside
// the history and never inside the scene: an attribution record that ships in the scene file cannot be hidden from a reader later (guides/ATTRIBUTION.md).
//
//   driver   'gui' | 'shell' | 'agent'      what drove the operation
//   channel  'gui' | 'shell'                where it entered the editor (observed, not declared)
//   actor    { id, kind: 'user' | 'agent' } who is behind the channel. DECLARED by whoever drives (editor.setActor), not authenticated: an agent that never
//                                           says it is one is logged as the user. A driver is 'agent' when the actor is an agent, whatever the channel,
//                                           because an agent typing into the Shell is still the agent.
//
// What an operation wrote is a list of [object uuid, property, value]: the properties attribution is measured over. A command this module does not know is
// kept as an `opaque` write, so the coverage figure says how much of the log it could not read.

export const OPLOG_SCHEMA = 'strata-oplog/1';
export const STATE_SCHEMA = 'strata-state/1';
export const DRIVERS = Object.freeze( [ 'gui', 'shell', 'agent' ] );
export const ACTOR_KINDS = Object.freeze( [ 'user', 'agent' ] );
export const DEFAULT_ACTOR = Object.freeze( { id: 'user', kind: 'user' } );
export const SCENE = 'scene';   // the "object" that scene-wide properties (the timeline, subtitles) belong to

export const round = n => Math.round( n * 1e5 ) / 1e5;
const vec = v => ( v ? [ round( v.x ), round( v.y ), round( v.z ) ] : null );

/** A short stable hash of a JSON-able value (FNV-1a, 32 bit): enough to tell two values apart in a log, not a security hash. */
export function fnv( value ) {

	const s = typeof value === 'string' ? value : JSON.stringify( value );
	let h = 0x811c9dc5;
	for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 0x01000193 ) >>> 0; }
	return h.toString( 16 ).padStart( 8, '0' );

}

// ── reading an Object3D (duck-typed: the editor's, or a plain object in a test) ────────────────────────

export function classesOf( o ) {

	const c = o && o.userData && o.userData.customClasses;
	if ( ! c ) return [];
	const list = c instanceof Set ? [ ...c ] : Array.isArray( c ) ? c : typeof c[ Symbol.iterator ] === 'function' && typeof c !== 'string' ? [ ...c ] : typeof c === 'object' ? Object.values( c ) : [];
	return [ ...new Set( list.map( String ).filter( Boolean ) ) ].sort();

}

export function trianglesOf( o ) {

	const g = o && o.isMesh && o.geometry;
	if ( ! g ) return 0;
	if ( g.index && typeof g.index.count === 'number' ) return Math.floor( g.index.count / 3 );
	return g.attributes && g.attributes.position ? Math.floor( g.attributes.position.count / 3 ) : 0;

}

const materialOf = o => ( o.material ? [].concat( o.material ).map( m => m && m.uuid ).filter( Boolean ).join( '+' ) || null : null );

/** Every node of a subtree, the root first. */
export function subtree( root ) {

	const out = [];
	if ( root && typeof root.traverse === 'function' ) root.traverse( n => out.push( n ) );
	else if ( root ) out.push( root );
	return out;

}

/** The properties attribution is measured over, as they stand on one node now. */
export function propsOf( o ) {

	return {
		name: o.name || '',
		label: o.userData && o.userData.label != null ? String( o.userData.label ) : null,
		classes: classesOf( o ),
		parent: o.parent ? o.parent.uuid : null,
		position: vec( o.position ),
		rotation: o.rotation ? [ round( o.rotation.x ), round( o.rotation.y ), round( o.rotation.z ) ] : null,
		scale: vec( o.scale ),
		visible: o.visible !== false,
		material: materialOf( o )
	};

}

/** The state the attribution is compared with, as a separate artifact: per object its properties and its triangles, and the timeline's events. */
export function snapshotState( scene, { timeline = null, source = null } = {} ) {

	const objects = {};
	let triangles = 0;
	for ( const o of subtree( scene ) ) {

		if ( o === scene ) continue;
		const p = propsOf( o );
		p.tri = trianglesOf( o );
		p.type = o.type || 'Object3D';
		triangles += p.tri;
		objects[ o.uuid ] = p;

	}
	const events = {};
	if ( timeline && Array.isArray( timeline.tracks ) ) for ( const t of timeline.tracks ) for ( const e of t.events || [] ) events[ t.target + '#' + e.id ] = { hash: eventHash( e ), dur: e.dur || 0 };
	return { schema: STATE_SCHEMA, objects, timeline: events, counts: { objects: Object.keys( objects ).length, triangles, events: Object.keys( events ).length }, source };

}

const eventHash = e => fnv( { at: e.at, op: e.op, args: e.args, dur: e.dur } );

// ── witnessing direct changes ─────────────────────────────────────────────────────────────────────────────────
// Shell code can change the scene without issuing a command (o.name = 'Tram', scene.add(o)), and such a change is in no history. The Shell is the one
// execution surface, so around each Shell line the editor compares the properties attribution is measured over, before and after, and records what changed and
// was not explained by a command as a *witnessed* write: attributed to whoever was driving the Shell line, but never undoable, since the history never held it.

/** The properties of every object as a Map uuid → { ...propsOf, tri }, cheap enough to take around every Shell line. */
export function flatState( scene ) {

	const m = new Map();
	for ( const o of subtree( scene ) ) { if ( o === scene ) continue; const p = propsOf( o ); p.tri = trianglesOf( o ); m.set( o.uuid, p ); }
	return m;

}

const sameValue = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );

/** What differs between two flatState() maps, as writes: [[uuid, prop, value]] and the objects touched. */
export function diffState( before, after ) {

	const writes = [], touched = new Map();
	for ( const [ uuid, now ] of after ) {

		const was = before.get( uuid );
		const mark = () => touched.set( uuid, now.tri || 0 );
		if ( ! was ) {

			mark(); writes.push( [ uuid, 'exists', true ], [ uuid, 'name', now.name ], [ uuid, 'parent', now.parent ] );
			for ( const k of [ 'position', 'rotation', 'scale', 'visible' ] ) if ( ! isDefault( k, now[ k ] ) ) writes.push( [ uuid, k, now[ k ] ] );
			if ( now.label != null ) writes.push( [ uuid, 'label', now.label ] );
			if ( now.material ) writes.push( [ uuid, 'material', now.material ] );
			for ( const c of now.classes ) writes.push( [ uuid, 'class:' + c, true ] );
			continue;

		}
		for ( const k of [ 'name', 'parent', 'position', 'rotation', 'scale', 'visible', 'label', 'material' ] ) if ( ! sameValue( was[ k ], now[ k ] ) && ( now[ k ] != null || k === 'parent' ) ) { mark(); writes.push( [ uuid, k, now[ k ] ] ); }
		for ( const c of now.classes ) if ( ! was.classes.includes( c ) ) { mark(); writes.push( [ uuid, 'class:' + c, true ] ); }
		for ( const c of was.classes ) if ( ! now.classes.includes( c ) ) { mark(); writes.push( [ uuid, 'class:' + c, false ] ); }

	}
	for ( const [ uuid, was ] of before ) if ( ! after.has( uuid ) ) { touched.set( uuid, was.tri || 0 ); writes.push( [ uuid, 'exists', false ] ); }
	return { writes, touched };

}

// ── what a command wrote ───────────────────────────────────────────────────────────────────────────────

const OBJECT_PROP = { name: 'name', visible: 'visible', castShadow: 'castShadow', receiveShadow: 'receiveShadow' };
const plain = v => ( v == null || [ 'string', 'number', 'boolean' ].includes( typeof v ) ? v : fnv( JSON.stringify( v ) ) );

function writeSubtree( root, out, { creating = true } = {} ) {

	for ( const n of subtree( root ) ) {

		touch( out, n );
		const p = propsOf( n );
		if ( creating ) out.writes.push( [ n.uuid, 'exists', true ] );
		out.writes.push( [ n.uuid, 'name', p.name ], [ n.uuid, 'parent', p.parent ] );
		// a default transform is not a decision: record these only where the object arrives with something other than the default
		if ( ! isDefault( 'position', p.position ) ) out.writes.push( [ n.uuid, 'position', p.position ] );
		if ( ! isDefault( 'rotation', p.rotation ) ) out.writes.push( [ n.uuid, 'rotation', p.rotation ] );
		if ( ! isDefault( 'scale', p.scale ) ) out.writes.push( [ n.uuid, 'scale', p.scale ] );
		if ( ! p.visible ) out.writes.push( [ n.uuid, 'visible', false ] );
		if ( p.label != null ) out.writes.push( [ n.uuid, 'label', p.label ] );
		if ( p.material ) out.writes.push( [ n.uuid, 'material', p.material ] );
		for ( const c of p.classes ) out.writes.push( [ n.uuid, 'class:' + c, true ] );

	}

}

const DEFAULTS = { position: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], scale: [ 1, 1, 1 ] };
/** Whether a property holds the value every new object starts with. */
export const isDefault = ( prop, value ) => ( prop === 'visible' ? value === true : prop in DEFAULTS ? JSON.stringify( value ) === JSON.stringify( DEFAULTS[ prop ] ) : false );

function touch( out, n ) {

	if ( ! out.tri.has( n.uuid ) ) out.tri.set( n.uuid, trianglesOf( n ) );

}

function walk( cmd, out ) {

	if ( ! cmd ) return;
	const o = cmd.object;
	switch ( cmd.type ) {

		case 'MultiCmdsCommand': for ( const c of cmd.cmdArray || [] ) walk( c, out ); return;
		case 'AddObjectCommand': writeSubtree( o, out ); return;
		case 'RemoveObjectCommand': for ( const n of subtree( o ) ) { touch( out, n ); out.writes.push( [ n.uuid, 'exists', false ] ); } return;
		case 'MoveObjectCommand': for ( const n of subtree( o ) ) touch( out, n ); out.writes.push( [ o.uuid, 'parent', cmd.newParent ? cmd.newParent.uuid : null ] ); return;
		case 'GroupObjectsCommand': {

			if ( cmd.group ) writeSubtree( cmd.group, out );
			for ( const c of cmd.objects || [] ) { touch( out, c ); out.writes.push( [ c.uuid, 'parent', c.parent ? c.parent.uuid : null ] ); }
			return;

		}
		case 'UngroupObjectsCommand': {

			for ( const c of cmd.objects || [] ) { touch( out, c ); out.writes.push( [ c.uuid, 'parent', c.parent ? c.parent.uuid : null ] ); }
			return;

		}
		case 'SetClassCommand': touch( out, o ); out.writes.push( [ o.uuid, 'class:' + cmd.className, cmd.add === true ] ); return;
		case 'SetLabelCommand': touch( out, o ); out.writes.push( [ o.uuid, 'label', cmd.newLabel ] ); return;
		case 'SetPositionCommand': touch( out, o ); out.writes.push( [ o.uuid, 'position', vec( cmd.newPosition ) ] ); return;
		case 'SetRotationCommand': touch( out, o ); out.writes.push( [ o.uuid, 'rotation', cmd.newRotation ? [ round( cmd.newRotation.x ), round( cmd.newRotation.y ), round( cmd.newRotation.z ) ] : null ] ); return;
		case 'SetScaleCommand': touch( out, o ); out.writes.push( [ o.uuid, 'scale', vec( cmd.newScale ) ] ); return;
		case 'SetValueCommand': touch( out, o ); out.writes.push( [ o.uuid, OBJECT_PROP[ cmd.attributeName ] || 'attr:' + cmd.attributeName, plain( cmd.newValue ) ] ); return;
		case 'SetMaterialCommand': touch( out, o ); out.writes.push( [ o.uuid, 'material', cmd.newMaterial && cmd.newMaterial.uuid ? cmd.newMaterial.uuid : materialOf( o ) ] ); return;
		case 'SetGeometryCommand': case 'SetGeometryValueCommand': touch( out, o ); out.writes.push( [ o.uuid, 'geometry', fnv( [ cmd.type, cmd.attributeName, plain( cmd.newValue ) ] ) ] ); return;
		case 'SetTimelineCommand': timelineWrites( cmd, out ); return;
		case 'AddAnimationClipCommand': out.writes.push( [ SCENE, 'clip:' + ( cmd.clip && cmd.clip.name ), fnv( cmd.clip && cmd.clip.name ) ] ); out.seconds += cmd.clip && cmd.clip.duration > 0 ? cmd.clip.duration : 0; return;
		case 'SetSubtitlesCommand': out.writes.push( [ SCENE, 'subtitles', fnv( cmd.next || cmd.newSubtitles || cmd.type ) ] ); return;
		default:

			if ( /^SetMaterial/.test( cmd.type || '' ) && o ) { touch( out, o ); out.writes.push( [ o.uuid, 'material.' + ( cmd.attributeName || cmd.type ), plain( cmd.newValue ) ] ); return; }
			out.opaque.push( cmd.type || 'unknown' );
			if ( o && o.uuid ) touch( out, o );

	}

}

function timelineWrites( cmd, out ) {

	const index = json => { const m = new Map(); for ( const t of ( json && json.tracks ) || [] ) for ( const e of t.events || [] ) m.set( t.target + '#' + e.id, e ); return m; };
	const before = index( cmd.prevJSON ), after = index( cmd.nextJSON );
	for ( const [ k, e ] of after ) {

		const was = before.get( k );
		if ( was && eventHash( was ) === eventHash( e ) ) continue;
		out.writes.push( [ SCENE, 'timeline:' + k, eventHash( e ) ] );
		out.seconds += Math.max( e.dur || 0, was ? was.dur || 0 : 0 );

	}
	for ( const [ k, e ] of before ) if ( ! after.has( k ) ) { out.writes.push( [ SCENE, 'timeline:' + k, null ] ); out.seconds += e.dur || 0; }

}

/** What a command (or a MultiCmds of them) wrote and how much it touched: { writes, objects, triangles, seconds, opaque }. Call after the command has executed. */
export function describeCommand( cmd ) {

	const out = { writes: [], tri: new Map(), seconds: 0, opaque: [] };
	walk( cmd, out );
	let triangles = 0;
	for ( const t of out.tri.values() ) triangles += t;
	return { writes: out.writes, objects: out.tri.size, triangles, seconds: round( out.seconds ), opaque: out.opaque };

}

// ── the log ─────────────────────────────────────────────────────────────────────────────────────────────────

export class OpLog {

	/** @param {{ now?: () => number, session?: object, ops?: object[] }} opts */
	constructor( { now = Date.now, session = null, ops = [], cidCounter = 0 } = {} ) {

		this.now = now;
		this.session = session || { id: Math.random().toString( 36 ).slice( 2 ) + now().toString( 36 ), started: new Date( now() ).toISOString() };
		this.ops = ops;
		this.seq = ops.length ? ops[ ops.length - 1 ].seq : 0;
		this.cidCounter = Math.max( cidCounter, ...ops.map( o => o.cid || 0 ), 0 );
		this.execSeq = Math.max( 0, ...ops.map( o => o.exec || 0 ) );
		this.actor = { ...DEFAULT_ACTOR, declared: false };
		this.stack = [];
		this.origin = null;
		this.listeners = [];

	}

	/** Say who is driving. Self-reported: nothing here can check it. */
	setActor( actor ) {

		if ( ! actor || typeof actor.id !== 'string' || ! ACTOR_KINDS.includes( actor.kind ) ) throw new Error( 'setActor: { id: string, kind: "user" | "agent" } is required' );
		this.actor = { id: actor.id, kind: actor.kind, declared: true };
		return this.actor;

	}

	/** Mark code as running in a channel (the Shell) until exit(token): what the editor can observe, as opposed to who is behind it. */
	enter( ctx ) {

		const token = { ...ctx };
		this.stack.push( token );
		return token;

	}

	exit( token ) {

		const i = this.stack.lastIndexOf( token );
		if ( i >= 0 ) this.stack.splice( i, 1 );

	}

	/** Run fn in a context; a promise result keeps the context until it settles (an await in Shell code is still the Shell's). */
	within( ctx, fn ) {

		const token = this.enter( ctx );
		let result;
		try { result = fn(); } catch ( e ) { this.exit( token ); throw e; }
		if ( result && typeof result.then === 'function' ) { const done = () => this.exit( token ); result.then( done, done ); } else this.exit( token );
		return result;

	}

	/** Run fn with an origin: the operations it records came from a file rather than from a decision (an import's names are the file's). */
	withOrigin( origin, fn ) {

		const previous = this.origin;
		this.origin = origin;
		try { return fn(); } finally { this.origin = previous; }

	}

	who() {

		// the nearest context that says something about each of channel, actor and exec: an agent context can enclose a Shell execution
		let channel = null, actorCtx = null, exec = null;
		for ( let i = this.stack.length - 1; i >= 0; i -- ) { const c = this.stack[ i ]; channel = channel || c.channel || null; actorCtx = actorCtx || c.actor || null; exec = exec || c.exec || null; }
		const actor = actorCtx || this.actor;
		channel = channel || 'gui';
		return { driver: actor.kind === 'agent' ? 'agent' : channel, channel, actor: { id: actor.id, kind: actor.kind }, declared: ! ! ( actorCtx || this.actor.declared ), ...( exec ? { exec } : {} ) };

	}

	/** One Shell execution: a numbered line of code, so the operations it made can be read as one pass. Changes it makes with no command are witnessed (see diffState). */
	runShell( src, fn ) {

		const exec = ++ this.execSeq;
		this.note( 'exec', { exec, src: String( src ).replace( /\s+/g, ' ' ).slice( 0, 160 ) } );
		const before = this.witness ? this.witness() : null, startSeq = this.seq;
		const token = this.enter( { channel: 'shell', exec } );
		const finish = () => { try { if ( before ) this.recordWitnessed( before, startSeq ); } finally { this.exit( token ); } };
		let result;
		try { result = fn(); } catch ( e ) { finish(); throw e; }
		if ( result && typeof result.then === 'function' ) result.then( finish, finish ); else finish();
		return result;

	}

	/** Record what changed since `before` that no operation recorded since `startSeq` explains. Never undoable: the history never held it. */
	recordWitnessed( before, startSeq ) {

		const { writes, touched } = diffState( before, this.witness() );
		if ( ! writes.length ) return null;
		const explained = new Set();
		for ( const op of this.ops ) if ( op.seq > startSeq && op.verb === 'do' && op.w ) for ( const [ u, p ] of op.w ) explained.add( u + '\u0000' + p );
		const w = writes.filter( ( [ u, p ] ) => ! explained.has( u + '\u0000' + p ) );
		if ( ! w.length ) return null;
		const objects = new Set( w.map( x => x[ 0 ] ) );
		let triangles = 0; for ( const u of objects ) triangles += touched.get( u ) || 0;
		return this.push( { cid: ++ this.cidCounter, verb: 'do', op: 'ShellMutation', label: 'changed by Shell code, with no command', ...this.who(), witnessed: true, touched: { objects: objects.size, triangles, seconds: 0 }, w } );

	}

	push( rec ) {

		const op = { seq: ++ this.seq, ...rec, t: new Date( this.now() ).toISOString() };
		this.ops.push( op );
		for ( const fn of this.listeners ) { try { fn( op ); } catch ( e ) { /* a listener must never break logging */ } }
		return op;

	}

	/** After a command has executed: one op, with what it wrote. `merge` when History folded it into the previous entry (a slider drag). */
	recordExecute( cmd, { merge = false } = {} ) {

		const d = describeCommand( cmd );
		let cid = cmd.__opcid;
		if ( ! cid ) cid = cmd.__opcid = ++ this.cidCounter;
		return this.push( {
			cid, verb: 'do', op: cmd.type || 'Command', label: cmd.name || '', ...this.who(), ...( this.origin ? { origin: this.origin } : {} ), ...( merge ? { merge: true } : {} ),
			touched: { objects: d.objects, triangles: d.triangles, seconds: d.seconds, ...( d.opaque.length ? { opaque: d.opaque } : {} ) }, w: d.writes
		} );

	}

	/** An undo or a redo: it carries the id of the entry it acted on, so the engine can tell which operations are live. */
	recordHistory( verb, cmd ) {

		return this.push( { cid: cmd && cmd.__opcid || null, verb, op: cmd && cmd.type || 'Command', label: cmd && cmd.name || '', ...this.who(), ...( cmd && cmd.__opcid ? {} : { unmatched: true } ) } );

	}

	/** A marker, not an edit: 'reset' (File, New: everything before is gone), 'barrier' (the undo history was cleared: what came before stays in the scene but can no longer be undone) or 'load' (a scene was opened; what it holds was not written in this log). */
	note( kind, data = {} ) {

		return this.push( { verb: kind, ...this.who(), ...data } );

	}

	toJSON() {

		return { schema: OPLOG_SCHEMA, session: this.session, ops: this.ops };

	}

	static fromJSON( json, opts = {} ) {

		if ( ! json || json.schema !== OPLOG_SCHEMA ) throw new Error( 'not a ' + OPLOG_SCHEMA + ' log' );
		return new OpLog( { ...opts, session: json.session, ops: json.ops.slice() } );

	}

}

/** Every operation must say who drove it (gate A1): what is missing from a log. */
export function validateOpLog( json ) {

	const problems = [];
	if ( ! json || json.schema !== OPLOG_SCHEMA ) return [ 'schema is not ' + OPLOG_SCHEMA ];
	let last = 0;
	for ( const op of json.ops || [] ) {

		const at = 'op ' + op.seq;
		if ( ! ( op.seq > last ) ) problems.push( at + ': seq is not increasing' );
		last = op.seq;
		if ( ! DRIVERS.includes( op.driver ) ) problems.push( at + ': driver is ' + JSON.stringify( op.driver ) );
		if ( ! op.actor || typeof op.actor.id !== 'string' || ! ACTOR_KINDS.includes( op.actor.kind ) ) problems.push( at + ': no actor' );
		if ( ! op.t || Number.isNaN( Date.parse( op.t ) ) ) problems.push( at + ': no time' );
		if ( op.verb === 'do' && ! Array.isArray( op.w ) ) problems.push( at + ': a "do" with no writes' );

	}
	return problems;

}
