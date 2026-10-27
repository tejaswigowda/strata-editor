# Eval data capture

What the eval harness writes down about a run. **Nothing here changes what a model is sent**: it records, and it can stop a run that has become invalid. Background: `HARNESS_AUDIT.md`.

## Using it

```
setEvalMeta({ sut_commit: '<git sha of this build>' })     // once; remembered, recorded with every run
evalEditMatrix('host-resolved')                             // repeat = next free number for this model/condition/path
evalEditMatrix('host-resolved', { repeat: 3 })              // explicit; refused if that repeat already exists
evalEditMatrix('bare', { contextLength: 32768 })            // for a server that cannot report its context (see below)
listEvalRuns()                                              // one line per run
exportEvalData()                                            // downloads eval-data-<time>.jsonl and provenance-<time>.json
```

- An unknown condition, a missing `sut_commit`, or a repeat that exists **refuses to run** and says so in the Shell panel (not only the console).
- `{ debug: true }`, `{ repeat }`, `{ contextLength }`, `{ sutCommit }` and `{ allowUnknownSut: true }` are the options; the REPL wrapper now forwards them.
- Data lives in **IndexedDB** (`strata-eval`) **of the browser profile and origin the run was made in**. `localhost:5503` and `strataeditor.dev` have separate stores. Export from the same place you ran.
- `saveEvalRows()` still works, with the new fields added; it is no longer the record of truth.

## Records

One flat store, every record carrying `run_id`. A run is append-only: a `run` record at the start, calls and rows as they happen, a `run_end` record at the end. A run with no `run_end` crashed and is reported `incomplete`.

- **`call`**, one per model invocation (31 per run; `host-resolved` 41): `purpose`, the request settings (`path`, `temperature`, `max_tokens`, `max_tokens_effective`, `response_format`), `prompt_system`, `prompt_user`, `raw_response`, `usage`, `latency_ms`, `error`.
- **`row`**, one per fixture x task (88 per run): the existing fields, plus `call_ids` (the join; a multi-op `host-resolved` row references several) and `failure_kind`.
- **`failure_kind`**: `null` (passed), `wrong`, `empty` (no text back), `parse_error` (text, but no operation readable), `exception`, `timeout`.
- **`run`** (provenance): condition, model tag, path, repeat, `origin` (the page origin whose IndexedDB holds the run; runs made before this field existed lack it), digest, quantization, parameter size, Ollama version, trained context, decode settings, `sut_commit`, `scorer_sha256` (of `editMatrix.js` as served, which holds the fixtures and scorers).
- **`run_end`**: status (`complete`, `aborted`, `failed`), reason, call and row counts, `max_prompt_tokens_observed`, the effective context length and where it came from, and the `host-resolved` counters as numbers.

`path` is one of `/v1/chat/completions`, `anthropic-client`, `ollama-proxy`, `anthropic-proxy`, `openai-proxy`, `webllm`. `decode.temperature_forwarded` says whether the requested temperature actually reaches the model: it is `false` on `ollama-proxy` (the dev-server proxy drops it) and for Claude 5 on `anthropic-client`.

## The context check

After each call, `prompt_tokens + max_tokens_effective` is compared with the context length. If it does not fit, the run **aborts**: Ollama truncates an over-long prompt without an error, so the run is invalid. The aborted run stays in the store, marked `aborted`, and the Shell says "Do not use this run". It never counts toward the matrix.

- The context length is the one the server is **running** the model with: read from `/api/ps` after the first call (the model must be loaded). Not `/api/show`, which gives the model's *trained* length (recorded separately as `trained_context`).
- For a path that cannot report it, pass `{ contextLength }`; it is recorded as `source: 'manual'`. With neither, nothing is asserted, and `run_end.server_context.context_length` is `null`.
- The check runs **after** the call, so the overflowing call has already been made and is in the store.
- Labeling calls come through `aiEngine.complete`, which drops usage, so they record `usage: null` and are not checked (their prompts are under 120 tokens).

## Repeats

`repeat` is the lowest unused number for `(model tag, condition, path, digest)`. An aborted or failed run **keeps its number**, so repeat numbers are unique and may have gaps; analysis should use `status: complete`. The matrix cell is keyed `task|model|condition|repeat`; the printed table shows the mean and the count (`60%×2`).

## Tests

```
node docs/editor/js/ai/__tests__/evalCapture.test.mjs     # failure kinds, repeats, store, recorder, context abort, provenance, runEditMatrix
node docs/editor/js/ai/__tests__/editMatrix.test.mjs       # unchanged scorers and fixtures
```

Verified in a real browser against a stub endpoint: the four conditions produced **134 requests, every body byte-identical to the capture made before this change** (the behaviour-neutral claim); a second `bare` run became repeat 2 and both survived a page reload; a forced overflow aborted on call 1 and was recorded; a typo and a missing `sut_commit` were refused; the export produced one JSONL (739 records) and a `provenance.json` of 7 runs. One real `bare` run on `qwen2.5-coder:0.5b` read the digest, `Q4_K_M`, version 0.40.6, trained context 32768 and effective context 32768 (from `/api/ps`) from the server, with real prompt tokens of about 10.7k on every generation call.

## Not done on purpose

The proxy's dropped `temperature`, `num_ctx`, `seed`, `top_p` and `top_k` are unchanged: setting them would change what a model sees. Run Ollama cells on the `/v1` client provider and read `path` in the provenance. The `contextWindow = 8192` constant for external models is unchanged.
