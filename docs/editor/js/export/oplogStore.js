// The browser side of the operation log (oplog.js): where it is kept between page loads, and who the tab says is driving.
//
// The log is kept in localStorage under its own key, apart from the scene and from the autosave: an attribution record that travels inside the scene file
// cannot be withheld from a reader later (guides/ATTRIBUTION.md). It survives a reload, which matters because the history does not: an agent-driven session is
// exactly the kind that reloads the page under it. The actor lives in sessionStorage, so a tab that said it is an agent still says so after a reload.

import { OpLog } from './oplog.js';

export const OPLOG_KEY = 'strata/oplog';
export const ACTOR_KEY = 'strata/actor';
const MAX_BYTES = 8e6;
const SAVE_DELAY = 1000;

export function openOpLog( { storage = globalThis.localStorage, session = globalThis.sessionStorage, win = globalThis } = {} ) {

	let log = null, gap = false;
	try {

		const raw = storage && storage.getItem( OPLOG_KEY );
		if ( raw && raw.length <= MAX_BYTES ) log = OpLog.fromJSON( JSON.parse( raw ) );
		else if ( raw ) gap = true;

	} catch ( e ) { gap = true; }
	if ( ! log ) log = new OpLog();
	if ( gap ) log.note( 'gap', { why: 'the stored log could not be continued (too large or unreadable); this is a new log' } );
	try { const a = session && session.getItem( ACTOR_KEY ); if ( a ) log.setActor( JSON.parse( a ) ); } catch ( e ) { /* an unreadable actor is the default one */ }

	log.persisted = null;
	let timer = null;
	const save = () => {

		clearTimeout( timer ); timer = null;
		try { storage.setItem( OPLOG_KEY, JSON.stringify( log.toJSON() ) ); log.persisted = true; } catch ( e ) { log.persisted = false; }

	};
	log.listeners.push( () => { if ( timer === null ) timer = setTimeout( save, SAVE_DELAY ); } );
	log.save = save;
	if ( win && win.addEventListener ) win.addEventListener( 'beforeunload', save );
	return log;

}

/** Remember the actor for this tab (sessionStorage), and tell the log. */
export function declareActor( log, actor, session = globalThis.sessionStorage ) {

	const a = log.setActor( actor );
	try { session && session.setItem( ACTOR_KEY, JSON.stringify( { id: a.id, kind: a.kind } ) ); } catch ( e ) { /* the log still knows */ }
	return a;

}
