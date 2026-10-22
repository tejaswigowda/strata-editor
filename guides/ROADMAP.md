# Roadmap and status

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Architecture](ARCHITECTURE.md) · [The eval matrix (thesis evidence)](../README.md#the-eval-matrix-the-editing-gate) · [Audit snapshot](AUDIT.md) · [Viewport look and frame guides](VIEWPORT_LOOK.md)

This is the **one place for "what exists / what is next"**. Last reviewed **2026-10-21**. Three rules keep it honest:

* **DONE** means built and in the tree. It does not mean validated; where a feature has a known limit it is repeated under [Known gaps](#known-gaps).
* **In progress this week** is work under way. None of it is done, and none of it should be described as shipped.
* The code-level, per-claim evidence lives in [AUDIT.md](AUDIT.md) (a dated snapshot, governing rule: implemented ≠ validated).

## DONE

```
DONE
  Editor fork, static hosting, no build. JS Shell (sidebar tab). WebLLM streaming
  One execution surface. Qwen2.5-Coder + constrained few-shot prompt
  Scene summariser with world-size, material names, glTF name decode, texture color
  Object lookup, spatial helpers, Scene Q&A
  Organic geometry + PBR + procedural textures
  Modeling M1 (boolean CSG), M2 (mirror / array / subdivide)
  Edit Mode M3-M5 (half-edge EditableMesh, selection, extrude/inset/bevel/delete/weld), M6 (AI selection
    criteria), M8-partial (planar / box UV), M9 (sculpt + soften). See MESH_EDITING_GUIDE.md
  Parametric recipe codegen (non-destructive history)
  Scene intelligence: descriptors + symmetry + texture color + findByDescription
  Git: settings / load / commit, auto-load, AI diff commit messages, merge-conflict viewport;
    reads through CDN edges, #repo=... share links, commit pin, >8 MiB buffers/images/scene chunked
  Agentic-loop hardening: error translation, lint classes, intent-preserving retries
  Local three.js API RAG, 16384-token window, Stop-AI button
  Generation eval harness (evalAI, 4-axis, overfit canaries), two-tier routing
  Universal timeline: scene-wide absolute clock (objects + camera), selector-addressed tracks,
    .then/.with/.at sequential sugar compiling to absolute times, versioned in scene JSON + glTF export.
    AI authors events via deterministic recipes. Supersedes the legacy per-clip editor
  Animation timeline UI + code panel (ANIMATION.md): one row per track, draggable/resizable event blocks,
    one playhead; the code panel shows the compiled $S().animate() sugar
  Keyframe editor in the Animations tab: selecting an animate block opens the KEY OPTIONS POPOVER
    (position / rotation / look-at / scale, camera tools for a shot camera, + Key @ playhead, Delete key),
    anchored beside the block and kept inside the window
  KEY <-> CODE SYNC: selecting a key scrolls + highlights its line in the code panel (without stealing
    focus, so playback is not paused); moving the caret onto a key's line selects that key
  Imported glTF/GLB clips (mocap) on the same clock and grammar: .at(t).play/pause/stop/seek, serialized
    in the scene JSON; clip cut / edit lists with a collision check (ANIMATION.md)
  Camera paths (CAMERA_PATHS.md): capture a key from the Edit Camera view, drag keys and aim points in
    the viewport, play the path as one smooth curve, simplify a dense baked move; the same edits are
    shell verbs (keyAt, moveKey, asCommand, ...) on the same track, one undo stack
  Shader system (SHADERS.md): any shader on any object or whole glTF: MToon, stock material types, TSL
    presets (fresnel rim, hologram, gradient), or your own material. Shader tab in the Properties panel +
    shell shader() / mtoon() / unshader() / shaders(); one undo step; shared materials stay shared;
    saved scenes round-trip
  Toon look (TOON_LOOK.md): light-responsive banded toon + rim + outlines for the WebGPU renderer,
    honouring a VRM's own MToon parameters (three-vrm MToonNodeMaterial); look spec, customize op,
    shell toon(); material-only, so rig-safe
  Viewport look + frame guides (VIEWPORT_LOOK.md): letterbox / safe-area overlay, vignette / film grain /
    soft glow, a hide-toon-outlines preview toggle, Auto / Light / Dark theme, saved panel sizes,
    first-run empty-state hints, play-bar shot chip + auto-fade; viewport-only, all off by default
  Character customizer (CUSTOMIZER.md): look / wardrobe / expression over one rig-safe op set
    (tint, recolor, hide, ARKit blendshapes, tags, bone-attached props), rig-safety fingerprint verified
  Authored face (FACE_TRACK.md): expression + gaze as keyed timeline channels, seeded idle layer
  Face refine (FACE_REFINE.md): shell refineFace(vrm), reversible, strength-controlled
  Face bind (FACE_BIND.md, FACE_BIND_PRIVACY.md): photo -> on-device face model (vendored MediaPipe) ->
    face-blendshape GLB bound to a base VRM's expression morphs, optional face-shape / colour / hair /
    facial-hair match; skeleton, weights and blendshapes untouched (byte-audited); zero egress.
    The page and the VRM editor were CUT OUT as zero-egress webCLI tools that follow the
    https://webcli.app URL-in / artifact-out contract:
      portrait-webCLI  https://github.com/tejaswigowda/portrait-webCLI  (facebind; embeds look's editor build)
      look-webCLI      https://github.com/tejaswigowda/look-webCLI      (the VRM editor)
    This tree still carries the facebind page (docs/facebind/) and the VRM-editor build recipe
    (ops/vrmeditor/); the node tests under docs/editor/js/facebind/ cover the code
  Video render (Render tab): timeline -> mp4/webm via any camera or a camera sequence with cut / crossfade
    transitions, subtitle track (burned or sidecar .srt), silent audio track
  Call card (CALLCARD.md), Present mode (&present=true)
  Selector-based editing: CSS-subset selector engine + auto-classes, op-JSON (op/ops/$S),
    host guards, command-backed animation recipes, op vocab + live selectors fed to the model
  Verify-edit primitives: relabel / tagClass / untagClass (command-backed), Import + Verify panel
  Eval matrix RUN: 5 tasks x {0.5B / 1.5B / 3B / 7B (q4f32_1), Haiku, Opus} x {bare, scaffolded},
    resolved-correct-node scoring. Result: 1.5B is the viable floor (73% scaffolded overall);
    0.5B under-capacity (excluded); selector-resolution is the confirmed hard task (Opus caps 77%).
    Scaffolding helps at every scale, dramatically at the frontier (Haiku +52, Opus +45; small +7-13).
    The zero-training claim holds; production ships 1.5B+ only
  Host-side selector + unambiguous op-type resolution (opResolve.js): Haiku and the 1.5B agree on 22/22
    fixtures for selector-resolution, op-selection and arg-extraction (see README eval matrix)
  glTF / GLB / USDZ / OBJ export (GLTFExporter + optimized animations)
  Name-stem auto-classes: "Chair 1"/"Chair 2" share .chair so plural selectors resolve
  Selector picker is $S (aliases Pick, pick); the old $$ name was removed
  $S() API: query and traversal layer (READ half of the language)
    Query methods: .count() / .exists() / .isEmpty() / .names() / .ids() / .classes() / .bounds() / .size()
    Value getters: .position() / .rotation() / .scale() / .color() / .material() / .opacity() / .visible()
    Live transform accessors: .position / .rotation / .scale / .quaternion (read component + command-backed write, local space)
    Traversal: .not() / .first() / .last() / .eq(n) / .parent() / .children() / .closest() / .add()
    Appearance: .setOpacity() / .setVisible() / .show() / .hide() / .wireframe()
    Transforms: .moveTo() / .rotateTo() / .scaleTo() / .reset() / .lookAt() (clarified relative vs absolute)
  Constrained decoding (JSON-schema-restricted output + reason-then-constrain)
    buildConstrainedOpsSchema() wraps ops array with no reasoning field
    buildReasonConstrainedOpsSchema() adds unconstrained reasoning field first (model reasons before committing to ops)
    All four code paths (WebLLM, Ollama, OpenAI, Anthropic) integrated
    26/26 tests passing: format-perfect output with mild reasoning cost
    Evaluated and working: small models emit valid op-JSON with better decomposition
  $S / 3DOM extracted as a standalone library ("jQuery for 3D"): github.com/tejaswigowda/3dom
    Runtime-free core (selectors + autoLabel + descriptors + op-chaining + op-JSON + guards),
    three.js as a PEER dependency, its own undo. The editor-coupling is cut by a Host abstraction:
    ops call host command-factories, never a concrete command class. DefaultHost = library-internal
    commands + own undo stack (standalone path); StrataHost maps factories -> real Strata commands +
    editor.execute + signals, so Strata is now a CONSUMER (docs/editor/js/intelligence/StrataHost.js
    + strata3dom.js). @tejaswigowda/3dom, MIT; ESM + global builds (three external); node smoke tests
    pass; bare.html browser proof; LANGUAGE standardized as versioned SPEC.md v0.1 (selector grammar,
    op vocabulary, op-JSON contract, autoLabel rules, Host contract). Verified in the live editor:
    autoLabel + $S('.red').recolor() flow through editor.execute with native undo/redo
```

## In progress this week (as of 2026-10-21) — NOT done

Under way in the working tree. None of this is shipped, so none of it is described as a feature elsewhere.

* **Never lose unsaved work.** Autosave, a dirty indicator and recover-on-load. (Git commit stays the explicit, versioned save; see [Git versioning](GIT_VERSIONING.md).)
* **"Preview as render" viewport mode** and a **render-vs-viewport comparison script**, so the gap between the viewport and what the Render tab produces is measured rather than eyeballed (see the stand-in gap under [Known gaps](#known-gaps)).
* **Timeline polish:** zoom / pan, snapping (and a snap grid), multi-select, collapsed baked camera tracks, render performance, track colours and icons, shot markers, previous / next key, an overview mini-map, a hover card and a collapsible toolbar.
* **Shell API normalisation:** shader parameters accepted nested and flat, `help()` generated from the schema, and generated shader docs ([JS Shell](JS_SHELL.md), [Shaders](SHADERS.md)).

## NEXT (the next lever)

```
NEXT
  Resolve the 2 residual multi-op segmentation-ambiguity fixtures (everything-red, wheels-and-rims).
    Alien-syntax ablation
  Fold the timeline sugar->absolute representation into the standalone library (still editor-side)
  Face bind: carry each morph delta through the warp (d' = W(v + d) - W(v) + d) inside reshapeVRM,
    so the morph-delta gate passes (see Known gaps)
```

## THEN

```
THEN
  Show/hide lifecycle: .show() / .hide() should TRIGGER entrance/exit animations (backend wiring)
  Import + Verify UX: in-viewport part highlight, lazy label-on-first-reference
  Renderer-agnostic export PIPELINE: label-through-extras survival + Blender / UE / any-renderer handoff
    (glTF export + animations already work; auto-classes don't yet serialize, path untested end-to-end)
  Distributed WebGL render to 2D video (the iteration render pipeline; the in-editor Render tab exists)
  BVH import (skeletal motion as imported data) + blendshape / facemesh performance
  Capture-pipeline integration: body mocap + face record to Strata (sovereign capture -> author -> render)
  Sovereignty dashboard: live green / orange / red disclosure of outbound paths
  Scene-wide timeline: add CAPTURED PERFORMANCE to the axis (objects + camera already ship on one clock;
    imported glTF clips already ride it, capture integration does not exist)
  Optional vision layer (precise nouns, OCR). Separate spec, needs a model
  Packaging: one PWA, with an optional Electron desktop wrapper
    (docs/editor/manifest.json + sw.js are offline-cache scaffolding, not an installable-PWA story)
  Mesh editing: import with edit history and automatic EditableMesh on first edit (M7), material / texture
    helpers and smart unwrapping (M8), loop cut, snapping, numeric entry (MESH_EDITING_GUIDE.md)
  MCP server over the op-JSON contract (none exists; opPrimitive.js only mentions it as a future consumer)
```

## Known gaps

Open items, stated plainly. Last re-checked **2026-10-21** unless noted.

| Gap | State | Where |
|---|---|---|
| **Face-bind morph-delta gate is OPEN.** Morph deltas are carried untransformed through the warp; the worst shape is ~6.3% of face height at bind strength 0.5 and ~12.5% at strength 1 (brows, blinks), rms up to ~19.5% / ~38.9% of the delta, against limits of 2% / 10%. | `node docs/editor/js/facebind/__tests__/morphDeltas.test.mjs` prints `GATE FAIL` ("4 of 6 cases FAIL"). It exits 0 by default and non-zero with `--strict`. Treat authored expressions on strongly warped characters as approximate (prefer a lower bind strength). The fix belongs in `reshapeVRM` and has to relax `assertRigSafe` / `assertBinOnlyChanged` deliberately. | [FACE_BIND.md](FACE_BIND.md#morph-deltas-and-the-warp-a-known-limit), [FACE_TRACK.md](FACE_TRACK.md#facebind-gate-read-this-before-building-on-a-bound-character) |
| **Render tab draws MToon through WebGL stand-ins.** WebGL cannot compile node materials, so while rendering MToon becomes a stepped `MeshToonMaterial` (same colour / maps / transparency, no outline passes) and other node shaders become the material they replaced. Rendered toon shading is close to, not identical to, the viewport. Browsers without WebGPU draw the viewport the same way. | Open; the in-progress "Preview as render" mode and comparison script are meant to measure it. | [SHADERS.md](SHADERS.md), [TOON_LOOK.md](TOON_LOOK.md) |
| **Eval matrix: ran, not exhaustive.** The 5-task matrix was run and recorded (README tables); the scaffolded table is the pre-decomposition baseline. Under host resolution op-selection and multi-op were not re-run at 0.5B. Labeling is the one model-bound task (Haiku 100% vs 1.5B 67%); two multi-op fixtures stay ambiguous; the alien-syntax ablation is not done. The harness is `evalEditMatrix(...)` (`bare`, `scaffolded`, `constrained`, `reason-constrained`, `host-resolved`). | Implemented **and** run; still not a validation of every model or request. | [AUDIT.md](AUDIT.md#a4-the-eval-the-honest-gap), [README](../README.md#the-eval-matrix-the-editing-gate) |
| **Labels and classes through glTF.** String labels ride `userData -> extras`; hand-added classes are persisted as an array (so they should too), but no test asserts survival and auto-derived classes are not serialized. Unreal Engine and Unity round-trips are untested. | Unverified end to end. | [AUDIT.md](AUDIT.md#a5-pipeline--handoff), [README](../README.md#where-strata-sits) |
| **`import-pipeline` node test aborts.** 24 pure checks pass, then the run stops with `ERR_MODULE_NOT_FOUND` for `three` (imported via `agentLoop.js` -> `SetMaterialCommand.js`; the bare `three` specifier exists only in the browser importmap). The op executors are verified in the browser, not in node. | Open (environment / test-harness gap, not a code claim). | `docs/editor/js/import/__tests__/import-pipeline.test.mjs` |
| **Mesh editing limits.** Best on manifold closed meshes; picking is slow above ~50k vertices (no BVH); boolean may fail on coplanar geometry; custom vertex attributes are not preserved in edit mode; each undo step stores full geometry. | Known limits. | [MESH_EDITING_GUIDE.md](MESH_EDITING_GUIDE.md#known-limitations-and-handover-notes) |
| **Facebind/VRM editor in this tree.** The zero-egress webCLI cuts are the packaged tools; this tree still holds the original page and editor build, whose guides ([FACE_BIND.md](FACE_BIND.md), [FACE_BIND_PRIVACY.md](FACE_BIND_PRIVACY.md)) describe that copy. | Not yet removed from this tree. | `docs/facebind/`, `ops/vrmeditor/` |

## POLICY (reception)

```
POLICY
  Named / protected IP -> private lane only. Public = original, archetype or public-domain,
    framed by capability (see TUTORIAL_POLICY.md). Tutorial generators go through scripts/tutorial-policy.cjs
```

---

**Next:** [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
