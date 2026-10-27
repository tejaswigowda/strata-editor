// Run: node docs/editor/js/ai/__tests__/ollamaOrigin.test.mjs
// A hosted page cannot reach a local Ollama until its origin is in OLLAMA_ORIGINS; the error must say so instead of 'Failed to fetch'.
import assert from 'node:assert';
globalThis.location = { hostname: 'strataeditor.dev', origin: 'https://strataeditor.dev' };
const m = await import('../clientAPI.js');
assert.ok(m.isLocalOllama('http://localhost:11434/v1') && m.isLocalOllama('http://127.0.0.1:11434/v1') && !m.isLocalOllama('http://localhost:8080/v1') && !m.isLocalOllama('https://api.openai.com/v1'));
const e = m.requestFailure({ baseUrl: 'http://localhost:11434/v1' }, new Error('Failed to fetch'));
assert.match(e.message, /OLLAMA_ORIGINS="https:\/\/strataeditor\.dev"/); assert.match(e.message, /launchctl setenv/); assert.match(e.message, /systemctl edit ollama.*Environment="OLLAMA_ORIGINS=https:\/\/strataeditor\.dev"/);
assert.match(m.requestFailure({ baseUrl: 'https://api.openai.com/v1' }, new Error('Failed to fetch')).message, /CORS or network/);
// a 403 from Ollama on the model list explains the cause; a failed fetch does too
globalThis.fetch = async () => ({ status: 403, ok: false });
await assert.rejects(m.fetchProviderModels({ provider: 'ollama', wire: 'openai', baseUrl: 'http://localhost:11434/v1' }), /OLLAMA_ORIGINS/);
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
await assert.rejects(m.fetchProviderModels({ provider: 'ollama', wire: 'openai', baseUrl: 'http://localhost:11434/v1' }), /Ollama refused this page/);
await assert.rejects(m.fetchProviderModels({ provider: 'openai', wire: 'openai', baseUrl: 'https://api.openai.com/v1' }), /Failed to fetch/);
// from localhost it is not blamed on OLLAMA_ORIGINS: the server or its tunnel is simply not answering
globalThis.location = { hostname: 'localhost', origin: 'http://localhost:5503' };
await assert.rejects(m.fetchProviderModels({ provider: 'ollama', wire: 'openai', baseUrl: 'http://localhost:11434/v1' }), /nothing answered.*SSH tunnel/);
console.log('ok');
