// Run: node docs/editor/js/ai/__tests__/evalCapture.test.mjs
// The eval harness's data capture (work order "Eval harness: data capture"): failure kinds, run identity, no clobbering, the store, the recorder
// that wraps each model call, the context-length abort, provenance, and runEditMatrix's use of all of it.
import assert from 'node:assert';
import {
	classifyFailure, chooseRepeat, mergeProvenance, createMemoryStore, createRecorder, EvalAbort, effectiveMaxTokens, temperatureForwarded, pathFor,
	promptFitsProblem, makeRunId, toJsonl, readOllamaProvenance, readOllamaEffectiveContext,
} from '../evalCapture.js';
import { validateCondition, EVAL_CONDITIONS, newMatrix, recordRun, formatMatrix, cellRepeats, runEditMatrix } from '../editMatrix.js';

let pass = 0, fail = 0;
async function test( name, fn ) { try { await fn(); console.log( '  \u2713 ' + name ); pass ++; } catch ( e ) { console.error( '  \u2717 ' + name + '\n    ' + ( e && e.stack || e ) ); fail ++; } }

// ── C4: five failure kinds ───────────────────────────────────────────────────

await test( 'failure_kind tells apart wrong, empty, parse_error, exception and timeout', () => {

	assert.strictEqual( classifyFailure( { score: true, rawTexts: [ 'x' ], emittedCount: 1 } ), null );
	assert.strictEqual( classifyFailure( { score: false, rawTexts: [ 'x' ], emittedCount: 1 } ), 'wrong' );
	assert.strictEqual( classifyFailure( { score: false, rawTexts: [ '' ], emittedCount: 0 } ), 'empty' );
	assert.strictEqual( classifyFailure( { score: false, rawTexts: [ '   \n' ] } ), 'empty' );
	assert.strictEqual( classifyFailure( { score: false, rawTexts: [] } ), 'empty', 'no reply at all is empty' );
	assert.strictEqual( classifyFailure( { score: false, rawTexts: [ 'sorry, I cannot' ], emittedCount: 0 } ), 'parse_error' );
	assert.strictEqual( classifyFailure( { score: false, exception: new Error( 'HTTP 500' ), rawTexts: [] } ), 'exception' );
	assert.strictEqual( classifyFailure( { score: false, exception: Object.assign( new Error( 'x' ), { name: 'TimeoutError' } ) } ), 'timeout' );
	assert.strictEqual( classifyFailure( { score: false, exception: new Error( 'request timed out after 30s' ) } ), 'timeout' );
	// a label has no ops to parse: text that is simply wrong is wrong, not a parse error
	assert.strictEqual( classifyFailure( { score: false, task: 'labeling', rawTexts: [ 'wheel' ], emittedCount: 0 } ), 'wrong' );
	assert.strictEqual( classifyFailure( { score: false, task: 'labeling', rawTexts: [ '' ] } ), 'empty' );

} );

// ── C8: conditions ───────────────────────────────────────────────────────────

await test( 'an unknown condition throws instead of running as scaffolded', () => {

	for ( const c of EVAL_CONDITIONS ) assert.strictEqual( validateCondition( c ), c );
	for ( const bad of [ 'host_resolved', 'Scaffolded', 'baree', '', undefined, null, 'scaffolded ' ] ) assert.throws( () => validateCondition( bad ), /Unknown eval condition.*bare, scaffolded, constrained, reason-constrained, host-resolved/ );

} );

// ── C1: repeats never overwrite ──────────────────────────────────────────────

await test( 'two runs of one cell are both kept, as repeats 1 and 2, in the matrix', () => {

	const m = newMatrix();
	recordRun( m, { model: 'q', condition: 'bare', taskScores: { 'op-selection': { passed: 5, total: 10 } }, repeat: 1 } );
	recordRun( m, { model: 'q', condition: 'bare', taskScores: { 'op-selection': { passed: 7, total: 10 } }, repeat: 2 } );
	assert.deepStrictEqual( cellRepeats( m, 'op-selection', 'q', 'bare' ).map( c => [ c.repeat, c.pct ] ), [ [ 1, 50 ], [ 2, 70 ] ] );
	assert.deepStrictEqual( Object.keys( m.cells ).sort(), [ 'op-selection|q|bare|1', 'op-selection|q|bare|2' ] );
	assert.match( formatMatrix( m ), /op-selection\s+q\s+60%×2/, 'the table shows the mean and how many repeats' );
	const one = newMatrix();
	recordRun( one, { model: 'q', condition: 'bare', taskScores: { 'op-selection': { passed: 5, total: 10 } } } );
	assert.match( formatMatrix( one ), /op-selection\s+q\s+50%\s/, 'a single repeat prints as before' );

} );

await test( 'repeat is the next free number for (model, condition, path, digest); an explicit one that exists is refused', () => {

	const run = ( o ) => ( { kind: 'run', model_tag: 'q', condition: 'bare', path: '/v1/chat/completions', model_digest: 'sha256:a', ...o } );
	const records = [ run( { repeat: 1 } ), run( { repeat: 2 } ), run( { condition: 'scaffolded', repeat: 1 } ), run( { model_digest: 'sha256:b', repeat: 1 } ), { kind: 'call', run_id: 'x' } ];
	const key = { model_tag: 'q', condition: 'bare', path: '/v1/chat/completions', model_digest: 'sha256:a' };
	assert.strictEqual( chooseRepeat( records, key ), 3 );
	assert.strictEqual( chooseRepeat( records, { ...key, condition: 'constrained' } ), 1 );
	assert.strictEqual( chooseRepeat( records, { ...key, model_digest: 'sha256:c' } ), 1, 'a different digest is a different model' );
	assert.strictEqual( chooseRepeat( records, key, 7 ), 7 );
	assert.throws( () => chooseRepeat( records, key, 2 ), /repeat 2 .* already exists/ );
	assert.throws( () => chooseRepeat( records, key, 0 ), /whole number from 1/ );

} );

// ── store, recorder ──────────────────────────────────────────────────────────

const fakePerf = () => { let t = 0; return { now: () => ( t += 25 ) }; };
const RUN = { run_id: 'R1', condition: 'host-resolved', model_tag: 'qwen2.5-coder:1.5b', path: '/v1/chat/completions', repeat: 1 };
const MSGS = [ { role: 'system', content: 'SYS' }, { role: 'user', content: 'make the wheels red' } ];

await test( 'C2: a call records the prompt as sent, the raw response, usage, timing and the request settings; the result passes through untouched', async () => {

	const store = createMemoryStore();
	const rec = createRecorder( { store, run: RUN, context: { value: 32768, source: 'server' }, perf: fakePerf() } );
	const response = { text: '{"ops":[]}', usage: { prompt_tokens: 11486, completion_tokens: 312 } };
	const ids = [];
	const result = await rec.call( { purpose: 'generation', messages: MSGS, opts: { maxTokens: 7542, temperature: 0, schema: {} }, ids, invoke: async () => response } );
	assert.strictEqual( result, response, 'the very same object comes back' );
	await rec.flush();
	const [ c ] = await store.all();
	assert.deepStrictEqual( ids, [ 1 ] );
	assert.deepStrictEqual( { kind: c.kind, call_id: c.call_id, purpose: c.purpose, condition: c.condition, model: c.model, repeat: c.repeat }, { kind: 'call', call_id: 1, purpose: 'generation', condition: 'host-resolved', model: 'qwen2.5-coder:1.5b', repeat: 1 } );
	assert.deepStrictEqual( [ c.prompt_system, c.prompt_user, c.raw_response ], [ 'SYS', 'make the wheels red', '{"ops":[]}' ] );
	assert.deepStrictEqual( c.usage, { prompt_tokens: 11486, completion_tokens: 312 } );
	assert.deepStrictEqual( c.request, { path: '/v1/chat/completions', temperature: 0, max_tokens: 7542, max_tokens_effective: 7542, response_format: 'json_schema' } );
	assert.strictEqual( c.latency_ms, 25 );
	assert.strictEqual( c.error, null );
	assert.strictEqual( rec.maxPromptTokens, 11486 );

} );

await test( 'a string response is recorded too, and a failing call is recorded with its error and rethrown unchanged', async () => {

	const store = createMemoryStore();
	const rec = createRecorder( { store, run: RUN, context: { value: null }, perf: fakePerf() } );
	assert.strictEqual( await rec.call( { purpose: 'labeling', messages: MSGS, opts: { maxTokens: 12, temperature: 0 }, invoke: async () => 'wheel' } ), 'wheel' );
	const boom = new Error( 'HTTP 503' );
	await assert.rejects( rec.call( { purpose: 'generation', messages: MSGS, opts: {}, invoke: async () => { throw boom; } } ), e => e === boom );
	await rec.flush();
	const [ a, b ] = await store.all();
	assert.deepStrictEqual( [ a.raw_response, a.usage, a.request.max_tokens, a.request.max_tokens_effective ], [ 'wheel', null, 12, 4096 ], 'the 12 asked for becomes the 4096 the client sends' );
	assert.deepStrictEqual( [ b.call_id, b.raw_response, b.error ], [ 2, null, { name: 'Error', message: 'HTTP 503' } ] );

} );

await test( 'C3: rows carry call_ids; a multi-op row can reference several calls', async () => {

	const store = createMemoryStore();
	const rec = createRecorder( { store, run: RUN, context: { value: null }, perf: fakePerf() } );
	const ids = [];
	for ( let i = 0; i < 3; i ++ ) await rec.call( { purpose: 'generation', messages: MSGS, opts: {}, ids, invoke: async () => 'x' } );
	await rec.row( { task: 'multi-op', id: 'm1', score: true, call_ids: ids, failure_kind: null } );
	const all = await store.all();
	const row = all.find( r => r.kind === 'row' );
	assert.deepStrictEqual( row.call_ids, [ 1, 2, 3 ] );
	assert.deepStrictEqual( [ row.run_id, row.repeat, row.model, row.condition ], [ 'R1', 1, 'qwen2.5-coder:1.5b', 'host-resolved' ] );
	for ( const id of row.call_ids ) assert.ok( all.some( r => r.kind === 'call' && r.call_id === id ), 'every referenced call exists' );

} );

// ── C7: the context check ────────────────────────────────────────────────────

await test( 'promptFitsProblem: prompt + max_tokens against the context length', () => {

	assert.strictEqual( promptFitsProblem( { promptTokens: 11486, maxTokens: 7542, contextLength: 32768 } ), null, 'the measured headroom: 19,028 of 32,768' );
	assert.strictEqual( promptFitsProblem( { promptTokens: 25226, maxTokens: 7542, contextLength: 32768 } ), null, 'exactly full still fits' );
	assert.match( promptFitsProblem( { promptTokens: 25227, maxTokens: 7542, contextLength: 32768 } ), /over the context length 32768/ );
	assert.strictEqual( promptFitsProblem( { promptTokens: 99999, maxTokens: 7542, contextLength: null } ), null, 'unknown context: nothing to assert against' );
	assert.strictEqual( promptFitsProblem( { promptTokens: undefined, maxTokens: 7542, contextLength: 4096 } ), null );

} );

await test( 'a forced overflow aborts the run with a loud error, after recording the offending call', async () => {

	const store = createMemoryStore();
	const rec = createRecorder( { store, run: RUN, context: { value: 4096, source: 'manual' }, perf: fakePerf() } );
	const err = await rec.call( { purpose: 'generation', messages: MSGS, opts: { maxTokens: 7542 }, invoke: async () => ( { text: 'x', usage: { prompt_tokens: 2050, completion_tokens: 1 } } ) } ).catch( e => e );
	assert.ok( err instanceof EvalAbort && err.evalFatal === true );
	assert.match( err.message, /Context overflow on call 1 \(generation\).*2050 tokens \+ max_tokens 7542.*truncate the prompt without an error.*invalid and has been stopped/ );
	assert.strictEqual( ( await store.all() ).length, 1, 'the call that overflowed is in the store' );

} );

await test( 'the context length is read from the server after the first call when it was not known, and then enforced', async () => {

	const store = createMemoryStore();
	let reads = 0;
	const context = { value: null, source: null, refresh: async () => { reads ++; return 8192; } };
	const rec = createRecorder( { store, run: RUN, context, perf: fakePerf() } );
	const big = { text: 'x', usage: { prompt_tokens: 11486, completion_tokens: 1 } };
	await assert.rejects( rec.call( { purpose: 'generation', messages: MSGS, opts: { maxTokens: 7542 }, invoke: async () => big } ), /Context overflow/ );
	assert.strictEqual( reads, 1 );
	assert.strictEqual( rec.contextLength, 8192 );
	assert.strictEqual( effectiveMaxTokens( '/v1/chat/completions', 'm', 7542 ), 7542 );

} );

await test( 'a store that fails stops the run on the next call instead of losing data silently', async () => {

	const bad = { kind: 'broken', append: async () => { throw new Error( 'quota exceeded' ); }, all: async () => [] };
	const rec = createRecorder( { store: bad, run: RUN, context: { value: null }, perf: fakePerf() } );
	await rec.call( { purpose: 'generation', messages: MSGS, opts: {}, invoke: async () => 'x' } );
	await assert.rejects( rec.flush(), /eval store failed \(quota exceeded\)/ );
	await assert.rejects( rec.call( { purpose: 'generation', messages: MSGS, opts: {}, invoke: async () => 'x' } ), e => e.evalFatal === true );

} );

// ── paths, decode settings ───────────────────────────────────────────────────

await test( 'path names, effective max_tokens and whether the temperature reaches the model', () => {

	assert.strictEqual( pathFor( { kind: 'client', wire: 'openai' } ), '/v1/chat/completions' );
	assert.strictEqual( pathFor( { kind: 'client', wire: 'anthropic' } ), 'anthropic-client' );
	assert.strictEqual( pathFor( { kind: 'server', modelId: 'ollama:qwen3:8b' } ), 'ollama-proxy' );
	assert.strictEqual( pathFor( { kind: 'server', modelId: 'claude-haiku-4-5' } ), 'anthropic-proxy' );
	assert.strictEqual( pathFor( { kind: 'webllm' } ), 'webllm' );
	assert.strictEqual( effectiveMaxTokens( 'anthropic-client', 'claude-sonnet-5-5', 7542 ), 16000, 'Claude 5 needs room for thinking' );
	assert.strictEqual( effectiveMaxTokens( 'anthropic-client', 'claude-sonnet-4-0', 7542 ), 7542 );
	assert.strictEqual( effectiveMaxTokens( '/v1/chat/completions', 'm', 12 ), 4096 );
	assert.strictEqual( temperatureForwarded( '/v1/chat/completions', 'm' ), true );
	assert.strictEqual( temperatureForwarded( 'ollama-proxy', 'm' ), false, 'the dev-server proxy drops it (audit finding 4)' );
	assert.strictEqual( temperatureForwarded( 'anthropic-client', 'claude-opus-5-5' ), false );
	assert.strictEqual( temperatureForwarded( 'anthropic-client', 'claude-sonnet-4-0' ), true );

} );

// ── C6: provenance ───────────────────────────────────────────────────────────

await test( 'provenance is read from the server: version, digest, quantization, trained and effective context', async () => {

	const answers = {
		'/api/version': { version: '0.40.6' },
		'/api/tags': { models: [ { name: 'qwen2.5-coder:1.5b', digest: 'abc123', details: { quantization_level: 'Q4_K_M', parameter_size: '1.5B' } } ] },
		'/api/show': { model_info: { 'qwen2.pretrain.context_length': 32768, 'general.architecture': 'qwen2' }, details: { quantization_level: 'Q4_K_M' } },
		'/api/ps': { models: [ { name: 'qwen2.5-coder:1.5b', context_length: 32768 } ] },
	};
	const seen = [];
	const fetchFn = async ( url, init ) => { const p = new URL( url ).pathname; seen.push( p + ( init && init.method ? ' ' + init.method : '' ) ); return { ok: p in answers, status: p in answers ? 200 : 404, json: async () => answers[ p ] }; };
	const p = await readOllamaProvenance( 'http://localhost:11434/v1', 'qwen2.5-coder:1.5b', fetchFn );
	assert.deepStrictEqual( [ p.ollama_version, p.model_digest, p.quantization_level, p.parameter_size, p.trained_context, p.errors ], [ '0.40.6', 'sha256:abc123', 'Q4_K_M', '1.5B', 32768, [] ] );
	assert.strictEqual( await readOllamaEffectiveContext( 'http://localhost:11434/v1', 'qwen2.5-coder:1.5b', fetchFn ), 32768 );
	assert.ok( seen.includes( '/api/show POST' ), 'one POST, for /api/show; the rest are GETs' );
	const missing = await readOllamaProvenance( 'http://localhost:11434/v1', 'nope:1b', fetchFn );
	assert.strictEqual( missing.model_digest, null );
	assert.ok( missing.errors.some( e => /nope:1b is not in \/api\/tags/.test( e ) ), 'what could not be read is said, not guessed' );
	assert.strictEqual( await readOllamaEffectiveContext( 'http://localhost:11434/v1', 'nope:1b', fetchFn ), null );
	const down = await readOllamaProvenance( 'http://localhost:11434/v1', 'x', async () => { throw new Error( 'refused' ); } );
	assert.deepStrictEqual( [ down.model_digest, down.ollama_version ], [ null, null ] );

} );

await test( 'provenance.json merges each run with its end record; a run with no end is reported incomplete', () => {

	const recs = [
		{ kind: 'run', run_id: 'A', model_tag: 'q', condition: 'bare', repeat: 1, sut_commit: 'abc' },
		{ kind: 'call', run_id: 'A', call_id: 1 },
		{ kind: 'run_end', run_id: 'A', finished: 'T', status: 'complete', calls: 31, rows: 88, max_prompt_tokens_observed: 11486 },
		{ kind: 'run', run_id: 'B', model_tag: 'q', condition: 'bare', repeat: 2 },
	];
	const [ a, b ] = mergeProvenance( recs );
	assert.deepStrictEqual( [ a.status, a.calls, a.rows, a.max_prompt_tokens_observed, a.sut_commit, a.kind ], [ 'complete', 31, 88, 11486, 'abc', undefined ] );
	assert.deepStrictEqual( [ b.status, b.finished ], [ 'incomplete', null ] );
	assert.strictEqual( toJsonl( recs ).split( '\n' ).length, recs.length + 1 );
	assert.match( makeRunId( new Date( '2026-10-27T19:00:00.123Z' ), () => 0.5 ), /^20261027T190000Z-[0-9a-z]{6}$/ );

} );

// ── runEditMatrix: failure kinds, call ids, aborts ───────────────────────────

function fakeDeps( over = {} ) {

	const rows = [];
	let last = { callIds: [], rawTexts: [], exception: null };
	return {
		rows,
		deps: {
			clearScene() {}, runSetup() {}, resolveSelector: () => new Set(), colorBase: 0, normalizeColor: () => 0,
			onProgress() {}, onRow: r => rows.push( r ), callInfo: () => last,
			labelOnce: async () => { last = { callIds: [ 900 ], rawTexts: [ '' ], exception: null }; return ''; },
			runOnce: async () => { last = { callIds: [ 1 ], rawTexts: [ 'I would paint them red' ], exception: null }; return { code: 'no ops here' }; },
			...over,
		},
		set: v => { last = v; },
	};

}

await test( 'rows from runEditMatrix carry call_ids and a failure_kind; parse errors, exceptions and empty replies are told apart', async () => {

	const f = fakeDeps();
	let n = 0;
	f.deps.runOnce = async () => {

		n ++;
		if ( n % 3 === 0 ) { f.set( { callIds: [ n ], rawTexts: [], exception: new Error( 'HTTP 500' ) } ); throw new Error( 'HTTP 500' ); }
		if ( n % 3 === 1 ) { f.set( { callIds: [ n ], rawTexts: [ '' ], exception: null } ); return { code: '' }; }
		f.set( { callIds: [ n ], rawTexts: [ 'sure, here you go' ], exception: null } );
		return { code: 'just prose' };

	};
	const tally = await runEditMatrix( f.deps );
	const gen = f.rows.filter( r => r.task !== 'labeling' );
	assert.ok( gen.length >= 66 );
	assert.deepStrictEqual( [ ...new Set( gen.filter( r => ! r.score ).map( r => r.failure_kind ) ) ].sort(), [ 'empty', 'exception', 'parse_error' ] );
	assert.ok( gen.every( r => Array.isArray( r.call_ids ) && r.call_ids.length === 1 ), 'every row names its call' );
	assert.ok( gen.filter( r => r.score ).every( r => r.failure_kind === null ) );
	const labels = f.rows.filter( r => r.task === 'labeling' );
	assert.strictEqual( labels.length, 9 );
	assert.ok( labels.every( r => r.failure_kind === 'empty' && r.call_ids[ 0 ] === 900 ), 'an empty label is empty, and joined to its call' );
	assert.strictEqual( tally.labeling.total, 9 );

} );

await test( 'a labelling exception that labelOnce swallowed is still an exception, not an empty label', async () => {

	const f = fakeDeps();
	f.deps.labelOnce = async () => { f.set( { callIds: [ 5 ], rawTexts: [], exception: new Error( 'ECONNRESET' ) } ); return ''; };
	await runEditMatrix( f.deps );
	assert.ok( f.rows.filter( r => r.task === 'labeling' ).every( r => r.failure_kind === 'exception' ) );

} );

await test( 'an EvalAbort stops runEditMatrix; an ordinary error is still scored as a failed case and the run goes on', async () => {

	const f = fakeDeps();
	let n = 0;
	f.deps.runOnce = async () => { n ++; if ( n === 4 ) throw new EvalAbort( 'Context overflow on call 4' ); return { code: '' }; };
	await assert.rejects( runEditMatrix( f.deps ), /Context overflow on call 4/ );
	assert.ok( f.rows.length > 0 && f.rows.length < 88, 'it stopped part-way' );
	const g = fakeDeps();
	let m = 0;
	g.deps.runOnce = async () => { m ++; if ( m === 4 ) throw new Error( 'one bad call' ); return { code: '' }; };
	await runEditMatrix( g.deps );
	assert.ok( g.rows.some( r => r.failure_kind === 'exception' ) && g.rows.filter( r => r.task === 'labeling' ).length === 9, 'the run finished' );
	const h = fakeDeps();
	h.deps.labelOnce = async () => { throw new EvalAbort( 'overflow while labelling' ); };
	await assert.rejects( runEditMatrix( h.deps ), /overflow while labelling/ );

} );

await test( 'without a callInfo hook (old callers) rows still carry an empty call_ids and a failure_kind', async () => {

	const f = fakeDeps(); delete f.deps.callInfo;
	await runEditMatrix( f.deps );
	assert.ok( f.rows.every( r => Array.isArray( r.call_ids ) && 'failure_kind' in r ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
