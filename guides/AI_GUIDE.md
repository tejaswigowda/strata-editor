# Optional AI acceleration

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [JS Shell](JS_SHELL.md) · [Dev mode API](DEV_MODE_API.md) · [The eval matrix (thesis evidence)](../README.md#the-eval-matrix-the-editing-gate)

**The shell and language work perfectly well without AI.** This document covers the optional natural-language layer: the agentic loop, the scene context the model sees, how to configure models, and how the generation fallback is evaluated. The [eval matrix](../README.md#the-eval-matrix-the-editing-gate) (the evidence for the zero-training claim) lives in the README because it is the project thesis.

## The agentic loop

When you use AI (opt-in), every request runs a bounded, self-correcting loop. All on-device, no extra models. The language is the contract. The AI stays within bounds and emits selector-op JSON.

```
generate -> validate -> execute -> observe -> fix   (max 3 retries, every action on the undo stack)
```

1. **Retrieve real APIs.** A local index of the actual command, op, material, and geometry signatures (rebuilt at load) is searched by intent and injected before generation. The model sees the real `AddObjectCommand(editor, object)` and the real `metalness` key instead of guessing.
2. **Validate.** Generated code is statically linted against that index before running. It catches invented classes (`Tree3D`), wrong command arity, bad material keys (`metal:1`), undefined helper calls (`backWall()`), `.add()` on a Material or Geometry, duplicate-`const` redeclaration, `scene.add()` bypass, and constructed-but-never-added objects. Each is fed back as an actionable correction, the fix, not the raw symptom. Identical retries stop early. The selector ops (`$S`, `op`, `ops`, `listSelectors`) are on the allow-list.
3. **Execute** through the single shell surface (`editor.execute`, undo stack).
4. **Observe.** The scene is snapshotted before and after, then diffed (added, removed, moved, scaled, recolored). The loop reports the change. If a change was expected and nothing happened (usually a missed lookup), it feeds that back for one corrective retry.
5. **Bounded and reversible.** Retries are hard-capped. Every autonomous action is undoable. Ambiguous or destructive ops surface candidates rather than guess.

**Grounding without a vision model.** GPU color-picking renders each object in a unique ID color offscreen and reads pixels. That gives `whatsVisible()` (what is on screen, by area) and `whatsAt(x, y)` (what is under a point). Deterministic, reuses the existing renderer, no download. The **lasso** completes the set: `lasso([[x,y],…])` selects everything inside a screen region and returns a chainable `$S` set, and `$S(':lasso')` reads back whatever the interactive lasso tool last selected.

## AI scene context

When using AI, every request gets a compact JS-comment scene description. This is the format a code model reads most naturally:

```
// [selected] "Body" Mesh BoxGeometry(0.6,1.8,0.5) mat:"Red Paint" size(0.6,1.8,0.5) color:#cc2200(red) at(0,0.9,0) desc(blocky,red)
// "Object_12" Mesh size(0.1,0.3,0.1) mat:"Tail Light" color:#dd1100(red) at(0.8,0.4,-1) desc(right,elongated,red,pair-right)
// "Tree" Group(2 children) at(3,0,-2)
// Camera at(0,5,10) looking at(0,0,0)
```

Each line includes the object name (glTF `_0XX_` escapes decoded), material names, geometry plus key params, world-space size, texture-sampled color, transform (non-default only), hierarchy, and the `desc(...)` intelligence tag. When the scene has imported parts to edit, an EDIT OPS reference and this scene's real selectors are injected too. That block only appears when there are parts to edit, to save context. Large scenes fall back to a compact JSON summary.

## AI configuration

Select a model from the shell header and click **Load AI**. Weights download once and cache in browser storage.

### Browser-based models (WebLLM)

#### Production Mode (default): Validated models only

In production mode (standard `node server.js`), a curated list of **validated, production-ready** models is displayed:

| Label | Model ID | Size | Notes |
|-------|----------|------|-------|
| **Viable floor (recommended)** | `Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC` | ~1.9 GB | The validated zero-training floor: 73% scaffolded overall, ties the Opus ceiling on arg-extraction. Best for edit work |
| **Powerful code generation** | `Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC` | ~5.1 GB | Best at decomposition. Needs 8 GB+ VRAM |
| **Fast general-purpose** | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | ~1.1 GB | General-purpose / labeling. Below the edit floor, offered for general use, not the editing gate |

The Qwen coder models at **1.5B and up** passed the edit eval matrix (the 1.5B is the validated floor; see [the eval matrix](../README.md#the-eval-matrix-the-editing-gate)). The **0.5B is deliberately excluded** as under-capacity. The Llama-1B is offered for general-purpose and labeling use, not as an editing model. To customize the vetted models list, edit the `vettedModels` array in `docs/editor/js/Shell.js`.

#### Development Mode (DEV=1): Full model access for research

In development mode (`DEV=1 node server.js`), **all** available WebLLM models are shown with their full technical details (model ID, VRAM requirement, quantization info). This allows testing and experimentation with a broader range of models during development.

### External API models (Development mode only)

Enable with `DEV=1 node server.js` to optionally integrate Ollama, OpenAI, and Anthropic Claude. These are development/research tools, not production-validated:

| Provider | Setup | Notes |
|----------|-------|-------|
| **Ollama** | `ollama serve` in another terminal | Local. No API key needed |
| **OpenAI** | `export OPENAI_API_KEY="sk-..."` | Cloud. Strong for raw-code fallback |
| **Anthropic** | `export ANTHROPIC_API_KEY="sk-ant-..."` | Cloud. Strong for complex decomposition |

External models appear in the dropdown below the WebLLM models. On load the engine requests a **16384-token** context window (overriding the 4096 default). 8192 proved too tight: a labeled ~30-part asset's system prompt + injected selector block + scene summary already reaches ~8.4k tokens, so a small on-device model would overflow before emitting a single op. 16384 clears the headroom (Qwen2.5-Coder natively supports 32k). It falls back to 4096 if the compiled model rejects the larger window.

Full server-side details in [DEV_MODE_API.md](DEV_MODE_API.md).

### Cost tracking (optional, when using external APIs)

When using external API models (OpenAI, Anthropic), every AI request displays a **cost chip** showing usage statistics and estimated costs:

- **Green chip (local models):** Shows request count and token usage. No cost (runs locally on your device).
- **Red chip (external APIs):** Shows request count, token usage, and estimated USD cost.

Click the cost chip to see detailed information:
- Model name
- Prompt and completion tokens
- Estimated cost (with "(est)" for external APIs)
- Billing disclaimer for cloud providers

**Cost accumulation:** Costs are tracked cumulatively across all requests in the session. Refresh the page to reset the counter.

### Client-side API models (no server)

The dropdown also supports calling a provider **directly from the browser**, with no `server.js` proxy. This is useful on static hosting such as GitHub Pages. It coexists with Dev Mode. Use whichever you prefer.

Click **⚙ API** in the shell header to open a 3-step wizard:

1. **Choose provider.** OpenAI, Anthropic (Claude), Ollama (local), or a custom OpenAI-compatible endpoint. Adjust the base URL and set an optional label.
2. **API key.** Paste the key. It is optional for local Ollama.
3. **Choose model.** The list is fetched live from the provider's `/models` endpoint. You only pick model IDs the key can actually use. A `Custom…` option lets you type an ID if fetching is unavailable.

Saved providers appear under a `─── Client APIs (browser) ───` separator in the model dropdown; select one and click **Load AI**.

**Trade-off (less sovereign):** keys are stored in `localStorage`, readable by same-origin scripts, like the git token. Requests leave the device straight to the provider. On-device WebLLM remains the default. Providers must allow browser CORS. OpenAI and Ollama do. Anthropic requires the `anthropic-dangerous-direct-browser-access` header, sent automatically.

## The generation eval (legacy axis): `evalAI()`

`evalAI()` is the older generation-scaffolding eval. It runs a standing prompt set through the agentic loop and prints a 4-axis pass/fail table (struct, spatial, semantic, distinct). It tests the generation task, which is now scaffolding, not the headline. It still tells a useful story about the generation fallback and the model-independent validation layer. It is not the editing eval. For that, see [the eval matrix](../README.md#the-eval-matrix-the-editing-gate).

**Monaco editor in eval output:** When code is generated during `evalAI()`, it also appears in Monaco editors with the same Run/dispose behavior, ensuring consistent evaluation workflow across all shell execution paths.

## Dev Mode: optional external APIs (for research and development)

Dev mode enables optional integration with Ollama, OpenAI, and Anthropic Claude for research and development. **The editor works perfectly well without it.** The shell and language are fully sovereign by default (browser-only). Developers can opt into more powerful cloud models for testing when needed.

### Setup (optional)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
DEV=1 node server.js

# Optional: start Ollama in another terminal
ollama serve
```

The server exposes `/api/models` (list), `/api/health` (check), and `/api/chat` (proxy). API keys stay server-side only. They are never sent to the browser or logged. Requests are validated. Responses are sanitized. API responses are not cached. Full details in [DEV_MODE_API.md](DEV_MODE_API.md).

All code execution still goes through the same command pattern (undoable).

---

**Next:** [The eval matrix (thesis evidence)](../README.md#the-eval-matrix-the-editing-gate) · [The language](LANGUAGE.md) · [← Back to README](../README.md)
