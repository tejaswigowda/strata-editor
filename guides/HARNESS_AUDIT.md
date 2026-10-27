# Harness audit: `evalEditMatrix` (pre-sweep)

**Date:** 2026-10-27
**Scope:** audit only. No code was changed. Related: `PAPER_A_RERUN_SHEET.md`.

**Evidence:** reading `docs/editor/js/Shell.js`, `docs/editor/js/ai/editMatrix.js`, `docs/editor/js/ai/clientAPI.js` and `server.js`, plus one observation run. The loaded engine was pointed at a stub server that records each request body and replies with an empty op list, so no model was involved. That gave 5 runs and 134 captured requests (bare, scaffolded, constrained, host-resolved, then bare again). Prompts were tokenized with the Qwen2.5-Coder tokenizer and cross-checked against Ollama's own `usage.prompt_tokens` (11,486 both ways for the longest prompt).

> **Follow-up:** the capture work order that addressed findings 1, 2, 3 and 5 is described in [EVAL_CAPTURE.md](./EVAL_CAPTURE.md). Finding 4 (the proxy dropping `temperature`) is deliberately not fixed there; run Ollama cells on the `/v1` client provider instead.

## Blocking findings

1. **No run is keyed and no repeat survives.** A second run of one cell overwrites it in the matrix. Rows are appended with nothing to tell repeats apart.
2. **Raw emissions and prompts are not captured.** `raw` is post-processed text; prompts are not stored.
3. **Nothing leaves the page.** Rows live in a JS array in the Shell closure; the Shell output panel is the only other record.
4. **The proxy path drops `temperature`.** On the dev-server `ollama:` route, decoding options are never forwarded to Ollama.
5. **`num_ctx` is never set, and nothing checks for truncation.** Harmless on the server measured here; on an older default it would silently cut every generation prompt.

## Signature

```js
async function evalEditMatrix( condition = 'scaffolded', opts = {} )   // Shell.js, module-private
```

- **Options:** only `opts.debug === true` is honoured (per-case console lines).
- **REPL wrapper:** the Shell exposes `evalEditMatrix: function ( condition ) { return evalEditMatrix( condition ); }`, which drops `opts`. `{debug:true}` is unreachable from the shell.
- **Conditions:** `bare`, `scaffolded`, `constrained`, `reason-constrained`, `host-resolved`. There is no validation: any other string, including a typo, runs as scaffolded (`injectParts = condition !== 'bare'`).
- **Model:** `aiEngine.modelId`, the tag only. The same tag on two servers or quantizations collides.
- **Guard:** `_matrixRunning` refuses a second concurrent run.

## A: repeat index and seed

| | Answer |
|---|---|
| **A1** | See the signature above. No repeat or seed argument. |
| **A2** | No run id, timestamp or repeat index anywhere. A row is `{model, condition, task, id, score, raw, parsed, resolvedNodeSet, expectedNodeSet, scoreNodeSet}`. |
| **A3** | **Scores are silently overwritten; rows are un-keyed.** `recordRun` writes `cells['task\|model\|condition']`, so the second run replaces the first. Rows append (observed: 88, 176, 264, 352, 440) with no field separating repeats except array position. |
| **A4** | Fixture order is fixed and `editMatrix.js` has no `Math.random`, `Date` or shuffle. The only source of nondeterminism is sampling: `temperature: 0` is requested on every path, but see section C. |
| **A5** | No seed anywhere. `top_p`, `top_k` and `seed` are never sent. |

## B: raw emissions

| | Answer |
|---|---|
| **B1** | **No.** `row.raw` is `code`, not the model's text. `bare` and `scaffolded`: `extractCode(raw)`, so prose is discarded. `constrained`: the raw JSON. `host-resolved`: the remapped JSON (selectors rewritten, `resolvedBy` added); in the multi-op case a JSON the host assembled from N model calls, so no model text survives. Labeling: the label after first-line and quote stripping. |
| **B2** | **No.** The prompt as sent is not stored. |
| **B3** | Per row, keyed by `(task, id)`. 22 generation prompts yield 66 rows, plus 13 multi-op and 9 labeling rows: the 88. A run makes **31 model calls**; `host-resolved` makes 41 (multi-op requests are segmented into 10 extra calls). A per-fixture join is possible if the rows are downloaded. |
| **B4** | **In-memory only:** `_matrixRows` plus the Shell output panel. `saveEvalRows()` downloads **all** accumulated rows, every model and condition together, as `eval-matrix-rows.jsonl` (fixed filename). No localStorage, IndexedDB or file write. |
| **B5** | **Not distinguished.** A generation exception, an empty reply and a wrong answer all give `parsed: []` and `score: false`; the exception text goes only to the status line. |
| **B6** | **Yes, at op level.** Each row's `parsed[]` carries op, selector, args, `resolvedNodes`, `resolvedBy` and `opResolvedBy`. The host-skip counters (`_hostSkip`, `_hostTotal`) exist only as printed percentages. A host-resolved run has 32 generation calls, consistent with "31 of 32". |

## C: the model requests

### Client-side Ollama provider, `POST /v1/chat/completions` (measured)

```
model, messages: [system, user], temperature: 0, stream: false,
max_tokens: 7542 (generation) | 4096 (labeling),
response_format: { type: 'json_schema', json_schema: { name: 'ops', schema, strict: false } }   // 54 of 134 calls
```

- **Not sent:** `top_p`, `top_k`, `seed`, `repeat_penalty`, `frequency_penalty`, any `options`, `num_ctx`. The `/v1` endpoint has no way to set `num_ctx`.
- **`max_tokens`:** 7542 is `contextWindow - 650`, and `AIEngine.setExternalAPI` hard-codes `contextWindow = 8192` for every external model. Labeling asks for 12 tokens but the client floors it at 4096.

### Dev-server proxy, `ollama:` models, `POST /api/chat` (read from `server.js`)

```
{ model, messages, stream, format: schema? }
```

`temperature` and `max_tokens` are destructured and **not forwarded**. Sampling falls to Ollama's defaults or the modelfile's (`qwen3:8b` ships `temperature 0.6, top_k 20, top_p 0.95`).

### Other answers

- **`format`:** used as a JSON schema for `constrained`, `reason-constrained` and `host-resolved`, on both paths.
- **`OLLAMA_NUM_PARALLEL`:** not relied on; the harness is strictly sequential. The server's setting is not visible through the API.
- **Anthropic via the proxy:** `temperature` is sent (the eval passes 0), omitted only for `claude-opus-4-7`/`4-8`. `constrained` forces `tool_choice: tool`.
- **Anthropic via the client:** a change made in this repo on 2026-10-27 (uncommitted at the time of writing) omits `temperature` for Claude 5+, uses `tool_choice: auto` with a plain (non-strict) tool, and raises `max_tokens` to at least 16000. Before it, Claude 5 models answered 400, so no earlier client-path numbers exist for them.

## `num_ctx` against the longest prompt

| Condition | Generation prompts | Tokens: min / median / max |
|---|---|---|
| bare | 22 | 10,161 / 10,715 / 10,754 |
| scaffolded | 22 | 10,608 / 11,304 / 11,343 |
| constrained | 22 | 10,751 / 11,447 / 11,486 |
| host-resolved | 32 | 10,346 / 10,954 / 11,002 |

- **Every condition is large, `bare` included.** The system prompt is the same ~34.9k characters in all of them; only the user message differs (1,337 vs 3,148 characters). "Bare" means no parts injection, not a small prompt.
- **Server measured:** Ollama 0.40.6. A model loaded with no override reports `context_length` 32768. Prompt plus the 7,542-token output reserve is at most 19,028, so there is **no truncation risk on this server**.
- **Truncation is silent.** On the native API with an explicit `num_ctx`, the longest prompt was cut to 2,050 tokens at 4096 and 4,098 at 8192, with no error field. It fit whole at 16384 and 32768.
- **Open risk:** the harness never sets `num_ctx` and nothing asserts on it. A server whose default is 16k or lower would truncate all 98 generation prompts. To my knowledge older Ollama releases defaulted to 2048 or 4096. **The server and version that produced any published Ollama numbers is not recorded in the repo.** If it had a low default, those numbers came from truncated prompts.

## Changes (section 4 of the work order): none made

| # | Change | Can it alter results? |
|---|---|---|
| 1 | Capture raw emission and prompt per row | No: pure observation |
| 2 | One JSONL per run, named condition-model-repeat, no clobber | No |
| 3 | Explicit `num_ctx` with a prompt-length assertion | **Only if the server's default was below the prompt length.** `/v1` cannot carry `num_ctx`, so this means `/api/chat` or a server-side setting; switching endpoint could itself change sampling, so it needs re-verification. |
| 4 | Provenance per run (digest, quantization, Ollama version, decode options, scorer hash, commit) | No |

Recommendations only (outside the permitted changes):

- Reject unknown condition strings instead of running them as scaffolded.
- Forward `temperature`, `num_predict` and `seed` in the proxy.
- Record `usage.prompt_tokens` per row. `/v1` already returns it, and it exposes truncation.
- Record `quantization_level` per run. It is available from `/api/show`; the models checked here are Q4_K_M.

## Gates

| Gate | Status |
|---|---|
| **H1** | Answered, and failing: the matrix cell is overwritten and rows are un-keyed. |
| **H2** | Failing: no prompts, and `raw` is post-processed. |
| **H3** | Failing: no persistence outside the page. |
| **H4** | Reported: default 32768 against a max prompt of 11,486 tokens on this server; the risk on other servers is stated above. |
| **H5** | No changes made, so nothing to classify yet. |
| **H6** | Pending a decision on change 3. Decide before the sweep. |

## Method notes and limits

- **Prompts:** captured through a stub endpoint on `127.0.0.1`. Prompts are scene-dependent, so the numbers apply to the scene loaded in the editor at the time (`scene.json` from `test1`); the eval clears and rebuilds each fixture's own scene, so they should not vary with it, but this was not tested.
- **Real Ollama calls:** three single-token requests against `qwen2.5-coder:0.5b` on the shared server, to read the default context and to compare token counts.
- **Not verified:** which path (`/v1` client or `/api/chat` proxy) and which Ollama version produced the published numbers, and anything about WebLLM runs.
