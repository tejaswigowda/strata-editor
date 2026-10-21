// ── WorkStore.js ─────────────────────────────────────────────────────────────
// IndexedDB home of the unsaved-work autosaves, separate from the stock editor
// Storage.js (one anonymous slot) so it can be keyed by scene source:
//   work     — the live autosave per source key (one record each)
//   recover  — unsaved work that a load / another tab was about to overwrite, kept
//              until the user explicitly recovers or discards it (id = key|hash)
// Falls back to an in-memory map when IndexedDB is unavailable (private modes), so
// the guard still works within the session.

const DB_NAME = 'strata-work';
const DB_VERSION = 1;

function memoryStore() {

	const stores = { work: new Map(), recover: new Map() };

	return {

		get: ( store, key ) => Promise.resolve( stores[ store ].get( key ) ),
		put: ( store, key, value ) => { stores[ store ].set( key, value ); return Promise.resolve(); },
		remove: ( store, key ) => { stores[ store ].delete( key ); return Promise.resolve(); },
		all: ( store ) => Promise.resolve( [ ...stores[ store ].values() ] )

	};

}

function idbStore() {

	let opening = null;

	function open() {

		if ( opening === null ) {

			opening = new Promise( ( resolve, reject ) => {

				const request = window.indexedDB.open( DB_NAME, DB_VERSION );
				request.onupgradeneeded = () => {

					const db = request.result;
					if ( ! db.objectStoreNames.contains( 'work' ) ) db.createObjectStore( 'work' );
					if ( ! db.objectStoreNames.contains( 'recover' ) ) db.createObjectStore( 'recover' );

				};
				request.onsuccess = () => resolve( request.result );
				request.onerror = () => reject( request.error );

			} );

		}

		return opening;

	}

	// Resolves once the transaction has committed, so "saved" really means saved.
	function run( store, mode, op ) {

		return open().then( db => new Promise( ( resolve, reject ) => {

			const tx = db.transaction( [ store ], mode );
			const request = op( tx.objectStore( store ) );
			tx.oncomplete = () => resolve( request.result );
			tx.onerror = tx.onabort = () => reject( tx.error );

		} ) );

	}

	return {

		get: ( store, key ) => run( store, 'readonly', os => os.get( key ) ),
		put: ( store, key, value ) => run( store, 'readwrite', os => os.put( value, key ) ),
		remove: ( store, key ) => run( store, 'readwrite', os => os.delete( key ) ),
		all: ( store ) => run( store, 'readonly', os => os.getAll() )

	};

}

export function WorkStore() {

	const backend = typeof window !== 'undefined' && window.indexedDB ? idbStore() : memoryStore();

	return {

		getWork: ( key ) => backend.get( 'work', key ),
		putWork: ( key, record ) => backend.put( 'work', key, record ),
		removeWork: ( key ) => backend.remove( 'work', key ),
		allWork: () => backend.all( 'work' ),

		putRecover: ( record ) => backend.put( 'recover', record.key + '|' + record.hash, record ),
		removeRecover: ( record ) => backend.remove( 'recover', record.key + '|' + record.hash ),

		/** Held unsaved work, newest first; for one source key, or every key when omitted. */
		async listRecover( key ) {

			const all = await backend.all( 'recover' );
			return all.filter( r => key === undefined || r.key === key ).sort( ( a, b ) => b.savedAt - a.savedAt );

		}

	};

}
