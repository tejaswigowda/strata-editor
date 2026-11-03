// Attribution by survival: whose decisions are present in the finished work. A pure engine over an operation log (oplog.js) and a final-state snapshot.
//
//   1. Replay the log's undo and redo to find which operations are live. An undone or overwritten operation contributes nothing.
//   2. For every property of the final state (a name, a class, a parent, a transform, a timeline event) take the chain of live operations that wrote it.
//      The last writer owns it; the first writer originated it. The category comes from both, not from the last alone.
//   3. Compare what the log says the value is with what the final state says it is. A property the log cannot account for is `unlogged` (something changed
//      it outside the history, a direct assignment in the Shell for instance) and is never credited to anyone.
//   4. Weight by consequence, not by count: each object's triangles are shared equally among its properties, so the figures add to the model's triangles; a
//      timeline event weighs its seconds. The unweighted counts are reported beside, and the weighted ones are the headline.
//
// The output is data: a per-object, per-property map, plus the per-operation survival table the summary is made from.

import { OPLOG_SCHEMA, STATE_SCHEMA, SCENE, DRIVERS, validateOpLog, round, isDefault } from './oplog.js';

export const ATTRIBUTION_SCHEMA = 'strata-attribution/1';
export const CATEGORIES = Object.freeze( [ 'agent-authored', 'human-authored', 'agent-originated-human-refined', 'human-originated-agent-refined', 'source', 'baseline', 'unlogged' ] );
export const HEADLINE = 'triangles';

const isAgent = op => op.driver === 'agent';
const who = op => ( { seq: op.seq, cid: op.cid, op: op.op, driver: op.driver, actor: op.actor.id, ...( op.exec ? { exec: op.exec } : {} ), t: op.t } );
const same = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );

/** Which history entries are live at the end of the log, and why each of the others is not. */
export function liveEntries( ops ) {

	let active = [], redo = [];
	const committed = new Set(), fate = new Map(), undoneBy = [], anomalies = [];
	for ( const op of ops ) {

		if ( op.verb === 'do' ) {

			if ( op.witnessed ) { committed.add( op.cid ); continue; }   // seen, not issued: the history never held it, so it cannot be undone
			if ( op.merge && active.includes( op.cid ) ) continue;
			for ( const c of redo ) fate.set( c, 'discarded' );
			redo = [];
			active.push( op.cid );
			fate.delete( op.cid );

		} else if ( op.verb === 'undo' ) {

			const i = op.cid == null ? - 1 : active.lastIndexOf( op.cid );
			if ( i < 0 ) { anomalies.push( { seq: op.seq, what: 'undo of an entry that is not live', cid: op.cid } ); continue; }
			active.splice( i, 1 );
			redo.push( op.cid );
			fate.set( op.cid, 'undone' );
			undoneBy.push( { cid: op.cid, by: op.driver, actor: op.actor.id, seq: op.seq } );

		} else if ( op.verb === 'redo' ) {

			const i = op.cid == null ? - 1 : redo.lastIndexOf( op.cid );
			if ( i < 0 ) { anomalies.push( { seq: op.seq, what: 'redo of an entry that was not undone', cid: op.cid } ); continue; }
			redo.splice( i, 1 );
			active.push( op.cid );
			fate.delete( op.cid );

		} else if ( op.verb === 'barrier' ) {

			// the history was cleared: what is in the scene stays, and can no longer be undone
			for ( const c of active ) committed.add( c );
			for ( const c of redo ) fate.set( c, 'discarded' );
			active = []; redo = [];

		} else if ( op.verb === 'reset' ) {

			for ( const c of [ ...active, ...redo, ...committed ] ) fate.set( c, 'reset' );
			committed.clear(); active = []; redo = [];

		}

	}
	return { live: new Set( [ ...committed, ...active ] ), fate, undoneBy, anomalies };

}

/** The final value a property should have, from the state snapshot: `undefined` when the object (or the property) is not there. */
function finalProps( obj, written = () => false ) {

	// the decision-bearing core is always there; a transform, visibility or material counts once it is non-default or something wrote it
	const p = { exists: true, name: obj.name, parent: obj.parent };
	for ( const k of [ 'position', 'rotation', 'scale', 'visible' ] ) if ( ! isDefault( k, obj[ k ] ) || written( k ) ) p[ k ] = obj[ k ];
	if ( obj.label != null ) p.label = obj.label;
	if ( obj.material != null && written( 'material' ) ) p.material = obj.material;
	for ( const c of obj.classes || [] ) p[ 'class:' + c ] = true;
	return p;

}

/** The category from where a property started and where it ended up. `interleaved` when the hands alternated more than once. */
export function categoryOf( chain ) {

	const hand = chain.filter( c => ! ( c.origin && c.origin.kind === 'import' ) );
	if ( ! chain.length ) return { category: 'baseline', interleaved: false };
	if ( ! hand.length ) return { category: 'source', interleaved: false };
	const first = isAgent( hand[ 0 ] ), last = isAgent( hand[ hand.length - 1 ] );
	let changes = 0;
	for ( let i = 1; i < hand.length; i ++ ) if ( isAgent( hand[ i ] ) !== isAgent( hand[ i - 1 ] ) ) changes ++;
	const category = first && last ? 'agent-authored' : ! first && ! last ? 'human-authored' : first ? 'agent-originated-human-refined' : 'human-originated-agent-refined';
	return { category, interleaved: changes > 1 };

}

const blank = () => ( { properties: 0, objects: 0, triangles: 0, seconds: 0 } );

/**
 * Attribute a finished piece of work. `log` is an oplog.js log (JSON), `state` a snapshotState() result. Returns { schema, map, ops, execs, summary, ... }.
 */
export function attribute( log, state ) {

	const problems = validateOpLog( log );
	if ( problems.length ) throw new Error( 'the operation log is not usable: ' + problems.slice( 0, 3 ).join( '; ' ) + ( problems.length > 3 ? ' (and ' + ( problems.length - 3 ) + ' more)' : '' ) );
	if ( ! state || state.schema !== STATE_SCHEMA ) throw new Error( 'the state is not a ' + STATE_SCHEMA + ' snapshot' );

	const { live, fate, undoneBy, anomalies } = liveEntries( log.ops );
	const doOps = log.ops.filter( o => o.verb === 'do' );

	// 1. the chain of live writers of every (object, property)
	const chains = new Map();
	for ( const op of doOps ) {

		if ( ! live.has( op.cid ) ) continue;
		for ( const [ uuid, prop, value ] of op.w ) {

			const key = uuid + '\u0000' + prop;
			if ( ! chains.has( key ) ) chains.set( key, [] );
			const chain = chains.get( key );
			const w = { ...who( op ), origin: op.origin, value };
			if ( chain.length && chain[ chain.length - 1 ].cid === op.cid ) chain[ chain.length - 1 ] = w; else chain.push( w );

		}

	}

	// 2. every property of the final state
	const map = {}, discrepancies = [], finalKeys = new Set();
	const tally = Object.fromEntries( CATEGORIES.map( c => [ c, blank() ] ) );
	let totalTriangles = 0, totalObjects = 0, totalSeconds = 0, totalProps = 0;
	const add = ( category, weight ) => { const t = tally[ category ]; t.properties ++; t.triangles += weight.triangles; t.objects += weight.objects; t.seconds += weight.seconds; };

	const place = ( uuid, name, prop, finalValue, weight, checkable = true ) => {

		const key = uuid + '\u0000' + prop; finalKeys.add( key );
		const chain = chains.get( key ) || [];
		let category, interleaved = false, unlogged = false;
		if ( chain.length && checkable && ! same( chain[ chain.length - 1 ].value, finalValue ) ) { category = 'unlogged'; unlogged = true; }
		else ( { category, interleaved } = categoryOf( chain ) );
		const entry = { category, ...( chain.length ? { originating: chain[ 0 ], last: chain[ chain.length - 1 ], writes: chain.length } : {} ), ...( interleaved ? { interleaved } : {} ), ...( unlogged ? { logged_value: chain[ chain.length - 1 ].value, final_value: finalValue } : {} ) };
		if ( ! map[ uuid ] ) map[ uuid ] = { name, props: {} };
		map[ uuid ].props[ prop ] = entry;
		return { category, weight };

	};

	for ( const [ uuid, obj ] of Object.entries( state.objects ) ) {

		const props = finalProps( obj, k => chains.has( uuid + '\u0000' + k ) );
		// properties only a chain can speak for (geometry, material.color, attr:*): present when the last live write is not a removal
		const extra = [];
		for ( const key of chains.keys() ) { const [ u, p ] = key.split( '\u0000' ); if ( u === uuid && ! ( p in props ) && ! p.startsWith( 'class:' ) ) extra.push( p ); }
		const names = [ ...Object.keys( props ), ...extra ];
		const share = { triangles: obj.tri / names.length, objects: 1 / names.length, seconds: 0 };
		for ( const p of names ) {

			const placed = place( uuid, obj.name, p, props[ p ], share, p in props );
			add( placed.category, share );
			totalProps ++;

		}
		totalTriangles += obj.tri; totalObjects ++;
		// a class the log says is there and the state says is not (and the other way is already a mismatch above)
		for ( const key of chains.keys() ) {

			const [ u, p ] = key.split( '\u0000' );
			if ( u !== uuid || ! p.startsWith( 'class:' ) || ( p in props ) ) continue;
			const chain = chains.get( key );
			if ( chain[ chain.length - 1 ].value === true ) discrepancies.push( { o: uuid, name: obj.name, prop: p, what: 'logged as set, absent at the end: removed outside the log' } );

		}

	}
	for ( const [ k, ev ] of Object.entries( state.timeline || {} ) ) {

		const share = { triangles: 0, objects: 0, seconds: ev.dur || 0 };
		const placed = place( SCENE, SCENE, 'timeline:' + k, ev.hash, share );
		add( placed.category, share );
		totalSeconds += share.seconds; totalProps ++;

	}
	for ( const [ key, chain ] of chains ) {

		const [ u, p ] = key.split( '\u0000' );
		if ( p === 'exists' && chain[ chain.length - 1 ].value === true && u !== SCENE && ! state.objects[ u ] ) discrepancies.push( { o: u, prop: 'exists', what: 'logged as present, absent at the end: removed outside the log' } );

	}

	// 3. per operation: what survived of what it wrote
	const survives = ( op, [ uuid, prop, value ] ) => {

		if ( ! live.has( op.cid ) ) return 'dead';
		const chain = chains.get( uuid + '\u0000' + prop );
		const last = chain && chain[ chain.length - 1 ];
		if ( ! last || last.cid !== op.cid ) return 'overwritten';
		if ( uuid === SCENE ) return prop.startsWith( 'timeline:' ) ? ( value === null ? ( state.timeline[ prop.slice( 9 ) ] ? 'overwritten' : 'survived' ) : ( state.timeline[ prop.slice( 9 ) ] && state.timeline[ prop.slice( 9 ) ].hash === value ? 'survived' : 'overwritten' ) ) : 'survived';
		const obj = state.objects[ uuid ];
		if ( ! obj ) return 'gone';
		const fp = finalProps( obj, () => true );
		if ( prop.startsWith( 'class:' ) ) return ( value === true ) === ( prop in fp ) ? 'survived' : 'overwritten';
		if ( prop === 'exists' ) return value === true ? 'survived' : 'gone';
		if ( ! ( prop in fp ) ) return 'survived';
		return same( fp[ prop ], value ) ? 'survived' : 'overwritten';

	};
	const ops = [], execs = new Map(), naive = { agent: 0, human: 0 }, naiveWrites = { agent: 0, human: 0 };
	for ( const op of doOps ) {

		const row = { ...who( op ), label: op.label, ...( op.witnessed ? { witnessed: true } : {} ), fate: live.has( op.cid ) ? 'live' : fate.get( op.cid ) || 'dead', touched: op.touched, writes: op.w.length, survived: 0, overwritten: 0, dead: 0, gone: 0 };
		const kinds = {};
		for ( const w of op.w ) { const fate = survives( op, w ); row[ fate ] ++; const k = w[ 1 ]; ( kinds[ k ] = kinds[ k ] || {} )[ fate ] = ( kinds[ k ][ fate ] || 0 ) + 1; }
		if ( ! op.merge ) { naive[ isAgent( op ) ? 'agent' : 'human' ] ++; naiveWrites[ isAgent( op ) ? 'agent' : 'human' ] += op.w.length; }
		ops.push( row );
		if ( op.exec ) {

			if ( ! execs.has( op.exec ) ) execs.set( op.exec, { exec: op.exec, driver: op.driver, actor: op.actor.id, ops: 0, writes: 0, survived: 0, overwritten: 0, dead: 0, gone: 0, props: {} } );
			const e = execs.get( op.exec ); e.ops ++; e.writes += row.writes;
			for ( const [ k, f ] of Object.entries( kinds ) ) { const t = ( e.props[ k ] = e.props[ k ] || {} ); for ( const [ fate, n ] of Object.entries( f ) ) t[ fate ] = ( t[ fate ] || 0 ) + n; }
			for ( const k of [ 'survived', 'overwritten', 'dead', 'gone' ] ) e[ k ] += row[ k ];

		}

	}
	const execSrc = {}; for ( const o of log.ops ) if ( o.verb === 'exec' ) execSrc[ o.exec ] = o.src;
	const execRows = [ ...execs.values() ].map( e => ( { ...e, src: execSrc[ e.exec ] } ) );

	// 4. the summary: unweighted, weighted, and how much of the log could be read
	const share = ( n, d ) => ( d ? round( n / d ) : null );
	const summary = { categories: {}, totals: { properties: totalProps, objects: totalObjects, triangles: totalTriangles, seconds: round( totalSeconds ) } };
	for ( const c of CATEGORIES ) {

		const t = tally[ c ];
		summary.categories[ c ] = {
			properties: t.properties, properties_share: share( t.properties, totalProps ),
			objects: round( t.objects ), objects_share: share( t.objects, totalObjects ),
			triangles: round( t.triangles ), triangles_share: share( t.triangles, totalTriangles ),
			seconds: round( t.seconds ), seconds_share: share( t.seconds, totalSeconds )
		};

	}
	const decided = [ 'agent-authored', 'human-authored', 'agent-originated-human-refined', 'human-originated-agent-refined' ];
	const sum = ( key ) => decided.reduce( ( s, c ) => s + tally[ c ][ key ], 0 );
	summary.headline = {
		weight: HEADLINE,
		of: 'triangles, each object\'s triangles shared equally among its properties; the categories add to the model',
		shares: Object.fromEntries( CATEGORIES.map( c => [ c, summary.categories[ c ].triangles_share ] ) ),
		of_authored_only: Object.fromEntries( decided.map( c => [ c, share( tally[ c ].triangles, sum( 'triangles' ) ) ] ) )
	};
	summary.unweighted = Object.fromEntries( CATEGORIES.map( c => [ c, summary.categories[ c ].properties_share ] ) );
	const opsTotal = doOps.length, opaque = doOps.filter( o => o.touched && o.touched.opaque ).length;
	const byDriver = Object.fromEntries( DRIVERS.map( d => [ d, doOps.filter( o => o.driver === d && ! o.merge ).length ] ) );
	summary.naive = { operations: naive, writes: naiveWrites, by_driver: byDriver, note: 'counts every operation including the undone and the overwritten' };
	summary.witnessed = { operations: doOps.filter( o => o.witnessed ).length, writes: doOps.filter( o => o.witnessed ).reduce( ( n, o ) => n + o.w.length, 0 ), note: 'changes Shell code made with no command; attributed to whoever drove the line, never undoable' };
	summary.coverage = {
		operations: opsTotal, live: ops.filter( r => r.fate === 'live' ).length, undone: ops.filter( r => r.fate === 'undone' ).length, discarded: ops.filter( r => r.fate === 'discarded' ).length, reset: ops.filter( r => r.fate === 'reset' ).length,
		opaque_operations: opaque, opaque_share: share( opaque, opsTotal ),
		unlogged_properties: tally.unlogged.properties, unlogged_share: share( tally.unlogged.properties, totalProps ), baseline_properties: tally.baseline.properties,
		discrepancies: discrepancies.length, anomalies: anomalies.length
	};
	summary.undone_by = { human: undoneBy.filter( u => u.by !== 'agent' ).length, agent: undoneBy.filter( u => u.by === 'agent' ).length, of_agent_operations_by_human: undoneBy.filter( u => u.by !== 'agent' && ops.find( r => r.cid === u.cid && r.driver === 'agent' ) ).length };
	summary.actors = [ ...new Set( log.ops.map( o => o.actor.id + ' (' + o.actor.kind + ( o.declared === false ? ', undeclared' : '' ) + ')' ) ) ];
	summary.drivers_seen = [ ...new Set( log.ops.map( o => o.driver ) ) ];
	summary.degenerate = ! summary.drivers_seen.some( d => d !== 'agent' ) ? 'every operation in this log was driven by an agent: a human taking over was never exercised, so the answer is 100% agent by construction' : null;

	return { schema: ATTRIBUTION_SCHEMA, log_schema: OPLOG_SCHEMA, session: log.session, summary, map, ops, execs: execRows, discrepancies, anomalies };

}
