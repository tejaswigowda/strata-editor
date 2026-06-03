# three.js editor — Sovereign AI-Native

A fork of the [three.js editor](https://threejs.org/editor/) with an in-browser local LLM that builds and edits 3D scenes via natural language, executes its output through the editor's existing JS shell (command pattern → undo stack), and versions scenes through git.

**No server. No API keys. No data leaves the device.**

---

## Features

- **No build** — serve the `docs/` folder as-is
- **Sovereign AI** — 100% on-device inference via WebGPU (WebLLM / MLC). Prompts and scenes are never transmitted
- **JS Shell** — interactive JavaScript REPL (Blender-style), available under **View → JS Shell**
- **AI → Shell bridge** — AI-generated code runs through the same `execute()` binding as human-typed code: same undo stack, same scope, same error handling
- **Scene context injection** — every AI request receives a compact JSON snapshot of the current scene (~1–2 KB)
- **Error-feedback retry** — if the generated code throws, the error is automatically sent back to the model for one self-correction pass
- **Token streaming** — AI output streams live into the shell as it is generated
- **Click-to-copy** — click any shell output line to copy it

---

## Quick start

```bash
npx serve docs       # local dev
# or: point GitHub Pages at the docs/ folder
```

Requires **Chrome 113+** (WebGPU). Verify at [webgpureport.org](https://webgpureport.org).

---

## AI models

Select a model from the shell header and click **Load AI**. Weights are downloaded once and cached in browser storage automatically.

| Label | Model ID | Size | Notes |
|-------|----------|------|-------|
| **Default** | `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` | ~1 GB | Recommended for most GPUs |
| **Power** | `Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC` | ~4.5 GB | Best quality, needs ≥8 GB VRAM |
| **Lite** | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | ~900 MB | Weak / integrated GPUs only |

---

## JS Shell

Open with **View → JS Shell**.

| Key | Action |
|-----|--------|
| `Enter` | Execute |
| `Shift+Enter` | New line |
| `↑` / `↓` | Command history |
| `Backspace` | Delete (works normally) |

### Globals in scope

| Name | Type | Description |
|------|------|-------------|
| `editor` | Editor | Editor instance |
| `THREE` | Object | three.js library |
| `scene` | THREE.Scene | Active scene |
| `camera` | THREE.Camera | Active camera |
| `renderer` | THREE.WebGLRenderer | Renderer |
| `AddObjectCommand` | Command | Add object to undo stack |
| `RemoveObjectCommand` | Command | Remove object via undo stack |
| `SetPositionCommand` | Command | Move object via undo stack |
| `SetRotationCommand` | Command | Rotate object via undo stack |
| `SetScaleCommand` | Command | Scale object via undo stack |
| `BoxGeometry`, `SphereGeometry`, … | Constructor | All documented primitives, no `THREE.` prefix needed |

### Shell examples

```js
// Add a red box
var m = new Mesh(new BoxGeometry(1,1,1), new MeshStandardMaterial({color:0xff2222}));
editor.execute(new AddObjectCommand(editor, m));

// Move selected object
editor.execute(new SetPositionCommand(editor, editor.selected, new THREE.Vector3(0,5,0)));

// Inspect scene
scene.children.map(c => c.name)
```

---

## Architecture

```
docs/editor/js/
  AIEngine.js   — WebLLM wrapper: init(), stream(), complete()
  AIPanel.js    — (planned) sidebar panel UI
  AIPrompt.js   — SYSTEM_PROMPT + few-shot examples + model registry
  AIUtils.js    — summarizeScene(), extractCode(), buildMessages()
  Shell.js      — REPL UI + single execute() surface wiring AI and human input
```

### Design principles

- **One execution surface.** AI-generated code and human-typed code run through the same `execute()` / `new Function(…)` binding. No second path.
- **Sovereignty is the product.** Inference is 100% on-device. This claim must stay ironclad.
- **No build step.** Plain ES-module JS files. No bundler, no transpiler.
- **Open system prompt.** The prompt is public and readable in the client. The moat is integration, not prompt secrecy.

---

## Roadmap

```
✅ Editor fork, static hosting, no build
✅ JS Shell (human REPL: editor / THREE / scene / camera / renderer)
✅ WebLLM streaming (on-device, weights cached in browser)
✅ AI → shell bridge (one execution surface)
✅ Qwen2.5-Coder models + constrained prompt + few-shot examples
✅ Scene summariser + injection into every AI request
✅ Error-feedback retry loop (one auto-correction pass)
⬜ Git integration (Octokit.js in-browser, AI-generated commit messages)
⬜ Merge-conflict viewport (dual-render conflicting object states)
```

---

## Structure

```
docs/
  index.html          ← entry point
  editor/             ← editor app (HTML, CSS, JS)
    js/
      AIEngine.js     ← WebLLM wrapper
      AIPrompt.js     ← system prompt + model registry
      AIUtils.js      ← scene summariser, code extractor
      Shell.js        ← REPL + AI bridge
  build/              ← three.js module builds
  examples/jsm/       ← three.js addons
```

