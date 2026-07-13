# Roadmap

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Architecture](ARCHITECTURE.md) · [The eval matrix (thesis evidence)](../README.md#the-eval-matrix-the-editing-gate)

```
DONE
  Editor fork, static hosting, no build. JS Shell (sidebar tab). WebLLM streaming
  One execution surface. Qwen2.5-Coder + constrained few-shot prompt
  Scene summariser with world-size, material names, glTF name decode, texture color
  Object lookup, spatial helpers, Scene Q&A
  Organic geometry + PBR + procedural textures
  Modeling M1 (boolean CSG), M2 (mirror / array / subdivide)
  Edit Mode M3-M5 (half-edge EditableMesh, selection, extrude/inset/bevel/delete/weld), M8 (UV)
  Parametric recipe codegen (non-destructive history)
  Scene intelligence: descriptors + symmetry + texture color + findByDescription
  Git: settings / load / commit, auto-load, AI diff commit messages, merge-conflict viewport
  Agentic-loop hardening: error translation, lint classes, intent-preserving retries
  Local three.js API RAG, 16384-token window, Stop-AI button
  Generation eval harness (evalAI, 4-axis, overfit canaries), two-tier routing
  Universal timeline: scene-wide absolute clock (objects + camera), selector-addressed tracks,
    .then/.with/.at sequential sugar compiling to absolute times, versioned in scene JSON + glTF export.
    AI authors events via deterministic recipes. Supersedes the legacy per-clip editor
  Selector-based editing: CSS-subset selector engine + auto-classes, op-JSON (op/ops/$S),
    host guards, command-backed animation recipes, op vocab + live selectors fed to the model
  Verify-edit primitives: relabel / tagClass / untagClass (command-backed), Import + Verify panel
  Eval matrix RUN: 5 tasks x {0.5B / 1.5B / 3B / 7B (q4f32_1), Haiku, Opus} x {bare, scaffolded},
    resolved-correct-node scoring. Result: 1.5B is the viable floor (73% scaffolded overall);
    0.5B under-capacity (excluded); selector-resolution is the confirmed hard task (Opus caps 77%).
    Scaffolding helps at every scale, dramatically at the frontier (Haiku +52, Opus +45; small +7-13).
    The zero-training claim holds; production ships 1.5B+ only
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
  $S / 3DOM extracted as a standalone library ("jQuery for 3D"): docs/packages/3dom/
    Runtime-free core (selectors + autoLabel + descriptors + op-chaining + op-JSON + guards),
    three.js as a PEER dependency, its own undo. The editor-coupling is cut by a Host abstraction:
    ops call host command-factories, never a concrete command class. DefaultHost = library-internal
    commands + own undo stack (standalone path); StrataHost maps factories -> real Strata commands +
    editor.execute + signals, so Strata is now a CONSUMER (docs/editor/js/intelligence/StrataHost.js
    + strata3dom.js). @strata-editor/3dom, MIT; ESM + global builds (three external); node smoke tests
    pass; bare.html browser proof; LANGUAGE standardized as versioned SPEC.md v0.1 (selector grammar,
    op vocabulary, op-JSON contract, autoLabel rules, Host contract). Verified in the live editor:
    autoLabel + $S('.red').recolor() flow through editor.execute with native undo/redo

NEXT (the next lever)
  Host-side selector resolution: pick-don't-compose, clarify-on-ambiguity, don't-over-enumerate.
    Attack the confirmed hard task — selector-resolution caps 77% even at the Opus ceiling and
    scaffolding adds nothing on small models, so move resolution OFF the model and into the host
  Fold the timeline sugar→absolute representation into the standalone library (still editor-side)

THEN
  Show/hide lifecycle: .show() / .hide() should TRIGGER entrance/exit animations (backend wiring)
  Import + Verify UX: in-viewport part highlight, lazy label-on-first-reference
  Renderer-agnostic export PIPELINE: label-through-extras survival + Blender / UE / any-renderer handoff
    (glTF export + animations already work; auto-classes don't yet serialize, path untested end-to-end)
  Distributed WebGL render to 2D video (the iteration render pipeline)
  BVH import (skeletal motion as imported data) + blendshape / facemesh performance
  Capture-pipeline integration: body mocap + face record to Strata (sovereign capture -> author -> render)
  Sovereignty dashboard: live green / orange / red disclosure of outbound paths
  Scene-wide timeline: add CAPTURED PERFORMANCE to the axis (objects + camera already ship on one clock)
  Optional vision layer (precise nouns, OCR). Separate spec, needs a model
  Packaging: one PWA, with an optional Electron desktop wrapper
```

---

**Next:** [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
