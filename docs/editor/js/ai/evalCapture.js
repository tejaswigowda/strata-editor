// ── ai/evalCapture.js ─────────────────────────────────────────────────────────
// Data capture for the eval harness (guides/HARNESS_AUDIT.md, work order "Eval harness: data capture").
//
// EVERYTHING HERE IS BEHAVIOUR-NEUTRAL: nothing in this file changes what is sent to a model, or what the
// harness does with the answer. It writes down what happened. The one thing it can do to a run is ABORT it
// (a prompt that would not fit the context window), and an aborted run is flagged, never silently degraded.
//
// Two record streams, one flat store, every record carrying its run_id:
//   call  one per model invocation: the prompt as sent, the raw response, usage, timing, error
//   row   one per fixture x task, joined to its calls by call_ids
//   run / run_end   provenance at the start, and how the run finished (append-only, so a crash leaves a run with no run_end)

import { isModernClaude } from './clientAPI.js';

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Thrown to stop a run that can no longer be trusted. runEditMatrix lets it through instead of scoring it as a wrong answer. */
export class EvalAbort extends Error {

	constructor( message, detail = {} ) { super( message ); this.name = 'EvalAbort'; this.evalFatal = true; this.detail = detail; }

}

const isTimeout = e => !! e && ( e.name === 'TimeoutError' || /\btime(d)? ?out\b/i.test( String( e.message || e ) ) );

/**
 * Why a row failed, so "emitted nothing" is never confused with "answered wrongly" (the distinction the paper is about).
 *   null         the row passed
 *   timeout      the call timed out
 *   exception    the call threw (network, HTTP error, engine error)
 *   empty        the model returned no text at all
 *   parse_error  it returned text, but no operation could be read from it
 *   wrong        operations were read, and the answer is wrong
 * @param {{ score:boolean, task?:string, exception?:any, rawTexts?:string[], emittedCount?:number }} r
 */
export function classifyFailure( { score, task = '', exception = null, rawTexts = [], emittedCount = 0 } ) {

	if ( score ) return null;
	if ( exception ) return isTimeout( exception ) ? 'timeout' : 'exception';
	if ( ! rawTexts.some( t => String( t == null ? '' : t ).trim() ) ) return 'empty';
	if ( task !== 'labeling' && emittedCount === 0 ) return 'parse_error';
	return 'wrong';

}

/** The call path, for provenance: which wire format and route the request took. */
export function pathFor( { kind, provider, wire, baseUrl, modelId } = {} ) {

	if ( kind === 'client' ) return wire === 'anthropic' ? 'anthropic-client' : '/v1/chat/completions';
	if ( kind === 'server' ) {

		if ( String( modelId ).startsWith( 'ollama:' ) ) return 'ollama-proxy';
		if ( String( modelId ).startsWith( 'claude-' ) ) return 'anthropic-proxy';
		return 'openai-proxy';

	}
	return kind === 'webllm' ? 'webllm' : 'unknown';

}

/** max_tokens as the adapter really sends it (the clients floor and raise what the harness asks for). */
export function effectiveMaxTokens( path, model, requested ) {

	const r = Number.isFinite( requested ) ? requested : 0;
	if ( path === 'anthropic-client' ) return Math.max( r, isModernClaude( model ) ? 16000 : 4096 );
	if ( path === 'webllm' ) return r || 600;
	return Math.max( r, 4096 );

}

/** Does the request really carry the temperature the harness asks for? The dev-server Ollama proxy drops it; Claude 5 refuses it. */
export function temperatureForwarded( path, model ) {

	if ( path === 'ollama-proxy' ) return false;
	if ( path === 'anthropic-client' ) return ! isModernClaude( model );
	return true;

}

/** null when the prompt plus the output budget fits; otherwise the reason. */
export function promptFitsProblem( { promptTokens, maxTokens, contextLength } ) {

	if ( ! Number.isFinite( promptTokens ) || ! Number.isFinite( contextLength ) || ! contextLength ) return null;
	const need = promptTokens + ( maxTokens || 0 );
	if ( need <= contextLength ) return null;
	return `prompt ${ promptTokens } tokens + max_tokens ${ maxTokens } = ${ need }, over the context length ${ contextLength }`;

}

export function makeRunId( now = new Date(), rand = Math.random ) {

	const t = now.toISOString().replace( /[-:]/g, '' ).replace( /\.\d+Z$/, 'Z' );
	return `${ t }-${ Math.floor( rand() * 0x100000000 ).toString( 36 ).padStart( 6, '0' ).slice( 0, 6 ) }`;

}

export async function sha256Hex( text ) {

	const d = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( text ) );
	return Array.from( new Uint8Array( d ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

/** One record per line. */
export function toJsonl( records ) {

	return records.map( r => JSON.stringify( r ) ).join( '\n' ) + ( records.length ? '\n' : '' );

}

/** The repeat for a new run of (model, condition, path[, digest]): the lowest number not yet used, or the explicit one if it is free. */
export function chooseRepeat( records, { model_tag, condition, path, model_digest = null }, explicit = null ) {

	const taken = new Set( records.filter( r => r.kind === 'run' && r.model_tag === model_tag && r.condition === condition && r.path === path && ( r.model_digest || null ) === model_digest ).map( r => r.repeat ) );
	if ( explicit !== null && explicit !== undefined ) {

		if ( ! Number.isInteger( explicit ) || explicit < 1 ) throw new Error( `repeat must be a whole number from 1 (got ${ explicit }).` );
		if ( taken.has( explicit ) ) throw new Error( `repeat ${ explicit } of ${ model_tag } / ${ condition } / ${ path } already exists in the eval store. Leave repeat out to take the next free number.` );
		return explicit;

	}
	let n = 1;
	while ( taken.has( n ) ) n ++;
	return n;

}

/** provenance.json: one object per run, from its run record and its run_end record. A run with no run_end is reported as incomplete. */
export function mergeProvenance( records ) {

	const ends = new Map( records.filter( r => r.kind === 'run_end' ).map( r => [ r.run_id, r ] ) );
	return records.filter( r => r.kind === 'run' ).map( r => {

		const { kind, ...run } = r;
		const end = ends.get( r.run_id );
		const { kind: _k, run_id: _id, ...rest } = end || {};
		return { ...run, ...( end ? rest : { status: 'incomplete', finished: null } ) };

	} );

}

// ── the store ────────────────────────────────────────────────────────────────

/** In-memory store with the same interface as the IndexedDB one (tests, and a fallback that says so). */
export function createMemoryStore() {

	const rows = [];
	return { kind: 'memory', append: async r => { rows.push( structuredClone( r ) ); }, all: async () => rows.slice(), close() {} };

}

/** IndexedDB store: append-only, flat, indexed by run_id. A reload loses nothing. */
export function createIdbStore( name = 'strata-eval', idb = globalThis.indexedDB ) {

	if ( ! idb ) throw new Error( 'IndexedDB is not available in this browser, so eval data cannot be persisted. Use a normal browser window (not a private window).' );
	const opened = new Promise( ( resolve, reject ) => {

		const req = idb.open( name, 1 );
		req.onupgradeneeded = () => { const s = req.result.createObjectStore( 'records', { keyPath: 'seq', autoIncrement: true } ); s.createIndex( 'run_id', 'run_id' ); };
		req.onsuccess = () => resolve( req.result );
		req.onerror = () => reject( req.error || new Error( 'could not open the eval store' ) );

	} );
	const tx = async ( mode, fn ) => {

		const db = await opened;
		return new Promise( ( resolve, reject ) => {

			const t = db.transaction( 'records', mode );
			const out = fn( t.objectStore( 'records' ) );
			t.oncomplete = () => resolve( out && out.result !== undefined ? out.result : undefined );
			t.onerror = () => reject( t.error || new Error( 'eval store write failed' ) );
			t.onabort = () => reject( t.error || new Error( 'eval store write aborted' ) );

		} );

	};
	return {
		kind: 'indexeddb',
		append: r => tx( 'readwrite', s => s.add( r ) ),
		all: () => tx( 'readonly', s => s.getAll() ).then( rows => rows.map( ( { seq, ...r } ) => r ) ),
		close: async () => ( await opened ).close(),
	};

}

// ── what the server says about the model ─────────────────────────────────────

const originOf = baseUrl => { try { return new URL( baseUrl ).origin; } catch { return null; } };

/** The context length Ollama is ACTUALLY running the model with (/api/ps), not the model's trained length (/api/show). Needs the model loaded. */
export async function readOllamaEffectiveContext( baseUrl, modelTag, fetchFn = globalThis.fetch ) {

	const o = originOf( baseUrl );
	if ( ! o ) return null;
	try {

		const j = await ( await fetchFn( o + '/api/ps' ) ).json();
		const m = ( j.models || [] ).find( x => x.name === modelTag || x.model === modelTag );
		return m && Number.isFinite( m.context_length ) ? m.context_length : null;

	} catch { return null; }

}

/** Version, digest, quantization and trained context, read once per run. Anything unreadable is null and listed in `errors`. */
export async function readOllamaProvenance( baseUrl, modelTag, fetchFn = globalThis.fetch ) {

	const o = originOf( baseUrl );
	const out = { ollama_version: null, model_digest: null, quantization_level: null, parameter_size: null, trained_context: null, errors: [] };
	if ( ! o ) { out.errors.push( 'no base URL' ); return out; }
	const get = async ( path, init ) => { const r = await fetchFn( o + path, init ); if ( ! r.ok ) throw new Error( `${ path } answered ${ r.status }` ); return r.json(); };
	try { out.ollama_version = ( await get( '/api/version' ) ).version || null; } catch ( e ) { out.errors.push( String( e.message || e ) ); }
	try {

		const tags = await get( '/api/tags' );
		const m = ( tags.models || [] ).find( x => x.name === modelTag || x.model === modelTag );
		if ( m ) { out.model_digest = m.digest ? 'sha256:' + m.digest : null; out.quantization_level = m.details && m.details.quantization_level || null; out.parameter_size = m.details && m.details.parameter_size || null; }
		else out.errors.push( `${ modelTag } is not in /api/tags` );

	} catch ( e ) { out.errors.push( String( e.message || e ) ); }
	try {

		const show = await get( '/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { model: modelTag } ) } );
		const k = Object.keys( show.model_info || {} ).find( x => x.endsWith( '.context_length' ) );
		out.trained_context = k ? show.model_info[ k ] : null;
		if ( ! out.quantization_level ) out.quantization_level = show.details && show.details.quantization_level || null;

	} catch ( e ) { out.errors.push( String( e.message || e ) ); }
	return out;

}

// ── the recorder ─────────────────────────────────────────────────────────────

/**
 * Wraps the model calls of ONE run. Records each call, assigns call ids, checks the prompt against the context length, and persists
 * records through a queue so a failing store stops the run instead of losing data silently.
 *
 * @param {{ store, run: { run_id, condition, model_tag, path, repeat },
 *           context: { value:number|null, source:string, refresh?:()=>Promise<number|null> },
 *           perf?: { now:()=>number } }} o
 */
export function createRecorder( { store, run, context, perf = globalThis.performance } ) {

	let nextCallId = 1;
	let queue = Promise.resolve();
	let persistError = null;
	let maxPromptTokens = null;
	let refreshed = false;
	let calls = 0;

	const persist = rec => {

		queue = queue.then( () => store.append( rec ) ).catch( e => { persistError = persistError || e; } );
		return queue;

	};
	const failIfBroken = () => { if ( persistError ) throw new EvalAbort( `The eval store failed (${ persistError.message || persistError }), so this run is not being recorded. Run stopped.`, { persist: true } ); };

	async function call( { purpose, messages, opts = {}, invoke, ids = null } ) {

		failIfBroken();
		const id = nextCallId ++;
		calls ++;
		if ( ids ) ids.push( id );
		const system = messages.filter( m => m.role === 'system' ).map( m => m.content ).join( '\n\n' );
		const user = messages.filter( m => m.role !== 'system' ).map( m => m.content ).join( '\n\n' );
		const requested = opts.maxTokens ?? null;
		const rec = {
			kind: 'call', run_id: run.run_id, call_id: id, condition: run.condition, model: run.model_tag, repeat: run.repeat, purpose,
			request: {
				path: run.path, temperature: opts.temperature ?? null, max_tokens: requested, max_tokens_effective: effectiveMaxTokens( run.path, run.model_tag, requested ),
				response_format: opts.schema ? 'json_schema' : null,
			},
			prompt_system: system, prompt_user: user, message_roles: messages.map( m => m.role ),
			raw_response: null, usage: null, latency_ms: null, error: null,
		};
		const t0 = perf.now();
		let result;
		try {

			result = await invoke();

		} catch ( e ) {

			rec.latency_ms = Math.round( perf.now() - t0 );
			rec.error = { name: e && e.name || 'Error', message: String( e && e.message || e ) };
			await persist( rec );
			throw e;

		}
		rec.latency_ms = Math.round( perf.now() - t0 );
		rec.raw_response = typeof result === 'string' ? result : ( result && result.text != null ? String( result.text ) : '' );
		rec.usage = result && typeof result === 'object' && result.usage ? { prompt_tokens: result.usage.prompt_tokens ?? null, completion_tokens: result.usage.completion_tokens ?? null } : null;
		await persist( rec );

		// the context check: aborts the run, loudly, if the prompt could not have fitted
		const pt = rec.usage && rec.usage.prompt_tokens;
		if ( Number.isFinite( pt ) ) maxPromptTokens = Math.max( maxPromptTokens ?? 0, pt );
		if ( context.value == null && context.refresh && ! refreshed ) { refreshed = true; const v = await context.refresh(); if ( v ) { context.value = v; context.source = context.source || 'server'; } }
		const problem = promptFitsProblem( { promptTokens: pt, maxTokens: rec.request.max_tokens_effective, contextLength: context.value } );
		if ( problem ) throw new EvalAbort( `Context overflow on call ${ id } (${ purpose }): ${ problem }. The server would truncate the prompt without an error, so this run is invalid and has been stopped.`, { call_id: id, promptTokens: pt, contextLength: context.value } );
		return result;

	}

	return {
		call,
		/** Rows join to calls by id: pass the ids that were made while producing this row. */
		row: rec => persist( { kind: 'row', run_id: run.run_id, repeat: run.repeat, model: run.model_tag, condition: run.condition, ...rec } ),
		persist,
		/** All queued writes done; throws if any failed. */
		async flush() { await queue; failIfBroken(); },
		get calls() { return calls; },
		get maxPromptTokens() { return maxPromptTokens; },
		get contextLength() { return context.value; },
		get contextSource() { return context.source; },
		peekCallId: () => nextCallId - 1,
	};

}
