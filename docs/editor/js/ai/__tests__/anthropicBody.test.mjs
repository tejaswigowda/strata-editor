// Run: node docs/editor/js/ai/__tests__/anthropicBody.test.mjs
// Claude 5 models answer 400 to temperature and to a forced tool_choice (Anthropic's migration guide); older ones accept both.
import assert from 'node:assert';
import { isModernClaude, anthropicBody, makeClientEngine, PROVIDER_PRESETS } from '../clientAPI.js';

for ( const id of [ 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-6-0' ] ) assert.ok( isModernClaude( id ), id );
for ( const id of [ 'claude-sonnet-4-0', 'claude-opus-4-1', 'claude-3-5-sonnet-latest', 'claude-3-haiku-20240307', '', undefined, 'gpt-4o' ] ) assert.ok( ! isModernClaude( id ), String( id ) );
assert.ok( PROVIDER_PRESETS.anthropic.models.every( isModernClaude ) && isModernClaude( PROVIDER_PRESETS.anthropic.modelHint ), 'the presets name current models' );

const chat = [ { role: 'user', content: 'hi' } ];
const schema = { type: 'object', properties: { ops: { type: 'array' } } };

const old = anthropicBody( 'claude-sonnet-4-0', { system: 'S', chat, opts: { schema, temperature: 0.2 } } );
assert.strictEqual( old.temperature, 0.2 );
assert.deepStrictEqual( old.tool_choice, { type: 'tool', name: 'emit_ops' } );
assert.strictEqual( old.max_tokens, 4096 );
assert.strictEqual( old.system, 'S' );

const modern = anthropicBody( 'claude-sonnet-5-5', { system: 'S', chat, opts: { schema, temperature: 0.2 } } );
assert.ok( ! ( 'temperature' in modern ), 'no temperature' );
assert.deepStrictEqual( modern.tool_choice, { type: 'auto' } );
assert.strictEqual( modern.tools[ 0 ].strict, true );
assert.match( modern.system, /^S\n\nAnswer by calling the emit_ops tool/ );
assert.strictEqual( modern.max_tokens, 16000, 'room for thinking plus the answer' );

const plain = anthropicBody( 'claude-opus-5-5', { system: '', chat, opts: {}, wantStream: true } );
assert.ok( ! plain.tools && ! plain.tool_choice && ! plain.system && plain.stream === true );

// end to end against a fake API: an unknown model id that refuses temperature is retried once without it
const calls = [];
globalThis.fetch = async ( url, init ) => {

	const body = JSON.parse( init.body );
	calls.push( body );
	if ( 'temperature' in body ) return new Response( JSON.stringify( { type: 'error', error: { type: 'invalid_request_error', message: '`temperature` is not supported for this model' } } ), { status: 400, headers: { 'content-type': 'application/json' } } );
	return new Response( JSON.stringify( { content: [ { type: 'thinking', thinking: '...' }, { type: 'text', text: 'pong' } ], usage: { input_tokens: 3, output_tokens: 1 } } ), { status: 200, headers: { 'content-type': 'application/json' } } );

};
const eng = makeClientEngine( { provider: 'anthropic', wire: 'anthropic', model: 'claude-mystery-4-9', baseUrl: 'https://api.anthropic.com/v1', apiKey: '  sk-ant-x \n' } );
const r = await eng.stream( [ { role: 'user', content: 'ping' } ], {} );
assert.strictEqual( r.text, 'pong', 'thinking blocks are skipped, text is returned' );
assert.deepStrictEqual( calls.map( c => 'temperature' in c ), [ true, false ] );

// a modern model never sends it in the first place
calls.length = 0;
await makeClientEngine( { provider: 'anthropic', wire: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' } ).stream( [ { role: 'user', content: 'ping' } ], {} );
assert.strictEqual( calls.length, 1 );
assert.ok( ! ( 'temperature' in calls[ 0 ] ) );

// a real error is still reported, with Anthropic's message
globalThis.fetch = async () => new Response( JSON.stringify( { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } ), { status: 401, headers: { 'content-type': 'application/json' } } );
await assert.rejects( makeClientEngine( { provider: 'anthropic', wire: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'bad' } ).stream( [ { role: 'user', content: 'x' } ], {} ), /HTTP 401.*invalid x-api-key/ );
console.log( 'ok' );
