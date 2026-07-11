# Architecture

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md) · [Git versioning](GIT_VERSIONING.md) · [Roadmap](ROADMAP.md)

## Scene representation

Two-form, lossless, git-diffable.

| # | Direction | Implementation |
|---|-----------|----------------|
| 1 | JS to Scene | Shell `execute()` |
| 2 | Scene to JSON | `scene.toJSON()` |
| 3 | JSON to Scene | `ObjectLoader.parse()` |
| 4 | Scene to JS | `codegen.js`: `objectToJS()` / `sceneToJS()` (recipe-aware) |

**Round-trip test (in-shell):**
```js
var snap = editor.scene.toJSON();
var js = sceneToJS();          // generate, paste js.code, run, then:
sceneEqual(snap, editor.scene.toJSON())   // { equal:true, differences:[] }
```

These round-trip guarantees are what make the [git diffs](GIT_VERSIONING.md) meaningful.

## Module map

```
server.js              Static file server + API proxy (dev mode)
  /api/models          List WebLLM + external models (Ollama, OpenAI, Claude)
  /api/chat            Proxy requests to external LLMs
  /api/health          Check service availability

docs/editor/js/
  AIEngine.js          WebLLM wrapper: init() (16384-window override+fallback), stream(), complete(), interrupt()
  AIPrompt.js          SYSTEM_PROMPT, buildSystemPrompt(), SCENE_QA_PROMPT, model registry, few-shot examples
  AIUtils.js           extractCode() (fenced-only), buildMessages() (injects EDIT OPS + live selectors when parts exist)
  Shell.js             REPL UI + single execute() surface; Stop-AI; evalAI(); evalEditMatrix(); verify/relabel/tag wiring
  ai/
    apiIndex.js        local RAG: curated command/op signatures + full three.js API (tern typedefs); op-surface allow-list
    threejsApi.js      AUTO-GENERATED three.js API index (scripts/genThreeApi.cjs)
    validate.js        static lint (hallucination / arity / undefined-call / dup-const / shared-material)
    agentLoop.js       generate->validate->execute->observe->fix; error translation; intent-preserving retries
    eval.js            generation eval set + 4-axis rubric + overfit canaries + routing heuristic (legacy)
    editEval.js        synthetic edit fixtures + per-axis scorers (resolved-correct-node, graceful-fail)
    editMatrix.js      the 5-task eval matrix: parser + per-task scorers + bare/scaffolded + matrix print
  Animation.js         Animations sidebar tab: keyframe authoring + AI recipe target
  Menubar.Git.js       Git settings/load/commit, auto-load, raw fetch, diff messages
  SceneDiff.js         semantic scene diff (added/removed/modified)
  MergeViewport.js     split-screen conflict review + resolution
  scene/
    summarize.js       sceneContextString(), spatial helpers, glTF name decode, material labels
    serialize.js  codegen.js  geometryParams.js  materialProps.js  sceneEqual.js
  mesh/
    EditableMesh.js        half-edge structure, from/to BufferGeometry
    Selection.js           vertex/edge/face selection sets
    EditModeController.js   enter/exit, overlay, picking, recipe recording
    ops/
      index.js  boolean.js  mirror.js  array.js  subdivide.js
      extrude.js  inset.js  bevel.js  delete.js  weld.js  uv.js
  intelligence/
    descriptors.js     geometry/color descriptors (texture pixel sampling)
    symmetry.js        left/right symmetry-pair detection
    colorName.js       HSV-bin to human color name
    resolver.js        rule match + LLM disambiguation
    sceneIndex.js      findByDescription / describeObject / listCandidates + controller
    classDerive.js     descriptors to CSS-like auto-classes; label-as-class match
    selectorEngine.js  CSS-subset parser + deterministic matcher over the scene graph
    editOps.js         structured edit ops (recolor/scale/move) to guarded commands
    opPrimitive.js     op-JSON contract + op()/ops()/$S dispatcher; subset-sanity guard
    animationRecipes.js spin/bounce/pulse to winding-safe keyframe clips (command-backed)
    vocabInjection.js  current-scene selectors + op schema for the model prompt
  import/
    pipeline.js        import stages: normalize, descriptors, classes, diagnose, label, verify hook
    labelPass.js       Stage-4 LLM labeling (confidence + low-confidence flags)
    verifyModel.js     verify grouping: symmetry-base families, low-confidence-first ordering (pure)
    VerifyPanel.js     the Import + Verify UX panel (thin DOM)
  commands/
    AddAnimationClipCommand.js  register an AnimationClip on the undo stack (recipe ops)
    SetLabelCommand.js          undoable label edit (userData.label)
    SetClassCommand.js          undoable class add/remove (userData.customClasses)
```

The mesh-editing subsystem has its own deep-dive docs:
[MESH_EDITING_GUIDE.md](MESH_EDITING_GUIDE.md),
[MESH_EDITING_TECHNICAL.md](MESH_EDITING_TECHNICAL.md), and
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

---

**Next:** [Roadmap](ROADMAP.md) · [The language](LANGUAGE.md) · [← Back to README](../README.md)
