// ── WorkGuard.js ─────────────────────────────────────────────────────────────
// Never lose unsaved work. Watches the working scene, autosaves it (debounced) to
// IndexedDB keyed by where it came from, tracks "dirty" = differs from the last
// loaded-or-committed snapshot, and makes every path that replaces the scene hold
// the unsaved work for recovery instead of overwriting it. Pure logic lives in
// workState.js; storage in WorkStore.js; the chip / prompts in Menubar.Work.js.
//
// Callers that replace the scene from a source (git load, URL-hash preload):
//   await editor.work.holdForLoad();  … editor.clear(); fromJSON …  await editor.work.loaded();
//   (editor.work.abortLoad() if the load fails after holdForLoad)
// Callers that save: editor.work.markClean().

import { hashWork, createDirtyTracker, decideRecovery, wouldClobberUnsaved, sourceKey, sourceLabel, describeChanges, sourceFile } from './workState.js';
import { WorkStore } from './WorkStore.js';

const DEBOUNCE_MS = 1000;

const CHANGE_SIGNALS = [
	'geometryChanged', 'objectAdded', 'objectChanged', 'objectRemoved', 'materialChanged',
	'sceneBackgroundChanged', 'sceneEnvironmentChanged', 'sceneFogChanged', 'sceneGraphChanged',
	'scriptChanged', 'historyChanged', 'timelineChanged', 'animationsChanged', 'subtitlesChanged'
];

const newLineage = () => Math.random().toString( 36 ).slice( 2 ) + Date.now().toString( 36 );

export function WorkGuard( editor, { getSource = () => null } = {} ) {

	const store = new WorkStore();
	const tracker = createDirtyTracker();
	const listeners = { change: [], offer: [] };

	let lineage = newLineage();
	let booting = true; // until the startup restore / load has finished
	let loading = false; // a load holds the scene: ignore the churn it causes
	let timer = null;
	let pending = false; // an edit signal arrived that has not been hashed yet
	let lastEditAt = Date.now();
	let lastSavedAt = null;
	let restoredRecord = null;
	let writes = Promise.resolve();

	const key = () => sourceKey( getSource() );
	const emit = ( type, payload ) => listeners[ type ].forEach( fn => fn( payload ) );
	const status = () => ( { dirty: tracker.isDirty(), savedAt: lastSavedAt, key: key() } );

	function snapshot() {

		const json = editor.toJSON();
		return { json, hash: hashWork( json ) };

	}

	function write( json, hash ) {

		const k = key();
		const dirty = hash !== tracker.baseline;
		const record = { key: k, savedAt: dirty ? lastEditAt : Date.now(), hash, baseHash: tracker.baseline, lineage, state: json };

		editor.signals.savingStarted.dispatch();

		writes = writes.then( async () => {

			// Another tab's / session's unsaved work in this slot must not be silently replaced.
			const existing = await store.getWork( k );
			if ( wouldClobberUnsaved( existing, lineage, hash ) ) await store.putRecover( existing );

			await store.putWork( k, record );
			lastSavedAt = Date.now();

		} ).catch( e => console.warn( 'WorkGuard: autosave failed —', e ) ).then( () => {

			editor.signals.savingFinished.dispatch();
			emit( 'change', status() );

		} );

		return writes;

	}

	// Hash the working scene now, and autosave it (unless the autosave setting is off).
	function flush() {

		clearTimeout( timer );
		pending = false;
		if ( booting || loading ) return writes;

		const { json, hash } = snapshot();
		const result = tracker.observe( hash );

		if ( editor.config.getKey( 'autosave' ) === false ) {

			if ( result.changed ) emit( 'change', status() );
			return writes;

		}

		return write( json, hash );

	}

	function onEdit() {

		if ( booting || loading ) return;

		pending = true;
		lastEditAt = Date.now();
		clearTimeout( timer );
		timer = setTimeout( flush, DEBOUNCE_MS );

	}

	// Entries still waiting for a yes/no, newest first, minus any identical to what is on screen.
	async function waitingEntries( extra ) {

		const { hash } = snapshot();
		const entries = await store.listRecover( key() );
		if ( extra ) entries.push( extra );

		const seen = new Set();
		const out = [];

		for ( const entry of entries.sort( ( a, b ) => b.savedAt - a.savedAt ) ) {

			const id = entry.key + '|' + entry.hash;
			if ( seen.has( id ) ) continue;
			seen.add( id );

			if ( entry.hash === hash ) {

				await store.removeRecover( entry ); // already exactly what is loaded — nothing to recover

			} else {

				out.push( entry );

			}

		}

		return out;

	}

	async function offerWaiting( extra ) {

		const entries = await waitingEntries( extra );
		if ( entries.length === 0 ) return;

		const entry = entries[ 0 ];
		let changes = [];

		try {

			changes = describeChanges( snapshot().json, entry.state );

		} catch ( e ) {

			console.warn( 'WorkGuard: could not describe the saved changes —', e );

		}

		emit( 'offer', { entry, label: entry.key === key() ? '' : sourceLabel( entry.key ), file: sourceFile( entry.key ), changes, more: entries.length - 1, entries } );

	}

	const guard = {

		isDirty() {

			if ( pending ) flush();
			return tracker.isDirty();

		},

		status,
		flush,

		/** Something may have changed without a signal (shell code): re-hash after the debounce. */
		touch: onEdit,

		onChange( fn ) { listeners.change.push( fn ); },
		onOffer( fn ) { listeners.offer.push( fn ); },

		start() {

			for ( const name of CHANGE_SIGNALS ) if ( editor.signals[ name ] ) editor.signals[ name ].add( onEdit );

			window.addEventListener( 'beforeunload', function ( event ) {

				if ( loading || booting || ! guard.isDirty() ) return;

				event.preventDefault();
				event.returnValue = '';

			} );

			document.addEventListener( 'visibilitychange', function () {

				if ( document.visibilityState === 'hidden' && pending ) flush();

			} );

		},

		// Startup, no source loaded from the URL: hand back the autosave for the current source.
		async restoreForBoot( legacyState ) {

			try {

				const record = await store.getWork( key() );

				if ( record && record.state ) {

					restoredRecord = record;
					lineage = record.lineage || lineage;
					lastEditAt = record.savedAt;
					return record.state;

				}

				// First run after this feature shipped: adopt the old single-slot autosave once.
				if ( legacyState !== undefined && ( await store.allWork() ).length === 0 ) return legacyState;

			} catch ( e ) {

				console.warn( 'WorkGuard: could not read the autosave —', e );

			}

			return undefined;

		},

		// The autosaved scene is on screen: dirty stays dirty relative to its ORIGINAL baseline.
		restored() {

			const { hash } = snapshot();
			const record = restoredRecord;
			restoredRecord = null;

			if ( record && record.hash !== record.baseHash ) tracker.restore( record.baseHash, hash );
			else tracker.setBaseline( hash );

		},

		async bootDone() {

			if ( tracker.baseline === null ) tracker.setBaseline( snapshot().hash );
			booting = false;
			emit( 'change', status() );
			await offerWaiting();

		},

		// Before a load replaces the scene: if it holds unsaved work, put it in the recover
		// store first. Returns the held entry (or null).
		async holdForLoad() {

			clearTimeout( timer );
			pending = false;

			let held = null;
			const { json, hash } = snapshot();
			tracker.observe( hash );

			if ( tracker.isDirty() ) {

				held = { key: key(), savedAt: lastEditAt, hash, baseHash: tracker.baseline, lineage, state: json };
				await store.putRecover( held );

			}

			loading = true;
			return held;

		},

		abortLoad() {

			loading = false;
			if ( pending ) onEdit();

		},

		// The loaded scene is now the clean baseline; offer back any unsaved work waiting for it.
		async loaded( held ) {

			const { json, hash } = snapshot();
			tracker.setBaseline( hash );
			lineage = newLineage();
			lastEditAt = Date.now();
			booting = false;
			loading = false;
			pending = false;

			try {

				// Hold any unsaved autosave of this source before the fresh load replaces it
				// (write() would stash a different lineage's anyway; this makes it explicit).
				const existing = await store.getWork( key() );
				if ( decideRecovery( existing, hash ).action === 'prompt' ) await store.putRecover( existing );

				await write( json, hash );
				await offerWaiting( held || undefined );

			} catch ( e ) {

				console.warn( 'WorkGuard: could not check for unsaved work —', e );

			}

		},

		// Save / commit / File → New: whatever is on screen is now the clean snapshot.
		async markClean( { fresh = false } = {} ) {

			clearTimeout( timer );
			pending = false;

			const { json, hash } = snapshot();
			tracker.setBaseline( hash );
			if ( fresh ) lineage = newLineage();
			booting = false;

			return write( json, hash );

		},

		async recover( entry ) {

			loading = true;

			try {

				editor.clear();
				await editor.fromJSON( entry.state );

			} finally {

				loading = false;

			}

			lineage = newLineage();
			lastEditAt = entry.savedAt;
			pending = false;

			const { json, hash } = snapshot();
			tracker.observe( hash ); // baseline stays the loaded scene, so the recovered edits read as unsaved

			await write( json, hash ); // the work is back in the live autosave before the held copy goes
			await store.removeRecover( entry );
			await offerWaiting();

		},

		async discard( entry ) {

			await store.removeRecover( entry );
			await offerWaiting();

		},

		/** Drop every saved copy that is waiting for a yes/no (the prompt's "Discard all"). */
		async discardAll( entries ) {

			for ( const entry of entries ) await store.removeRecover( entry );
			await offerWaiting();

		}

	};

	return guard;

}
