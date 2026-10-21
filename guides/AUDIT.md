# Strata: Repo Audit (code, not README)

> **Point-in-time audit.** This is a dated snapshot, not the living status page: for what exists and what is
> next, read [ROADMAP.md](ROADMAP.md). The original audit was written against the code of its day; it was
> **re-checked on 2026-10-21** (today's date for this banner) and the rows that had drifted were updated in
> place. Rows marked *(changed 2026-10-21)* differ from the original audit.
>
> **What was re-verified on 2026-10-21:** every file / symbol named below still exists (checked by grep);
> the `$$` → `$S` rename; the guard code paths (`recolorOp` clone-on-write, texture-tint warning, merged-mesh
> check, scale / move clamps, `subsetSanityWarning`, `RAW_LOOP_GUARD`); the `addClip` duck-type guard
> (moved to `Shell.js` ~L1449); `spinRecipe` sub-division; the glTF export path; `customClasses` persistence;
> constrained decoding wiring; the matrix harness entry point (`evalEditMatrix`); and the node tests
> (re-run today, counts below).
> **Not re-verified today (still as originally audited):** anything that needs a browser (guards firing on a
> live scene, merge viewport, git dialogs, export round-trip into Blender / Quick Look), the
> `sceneToJS` → `sceneEqual` round-trip at runtime, and the model-quality numbers (those are in the
> [README](../README.md#the-eval-matrix-the-editing-gate), not re-run here).
>
> Source of truth for the README update. Every status below is verified against the
> current code in `docs/editor/js/`, not against the README or prior claims.
> Governing rule: **implemented ≠ validated.** The architecture is built. The validating eval matrix was
> built, **and has since been run** *(changed 2026-10-21; originally "not run")*; see A4 for what that does
> and does not establish.
>
> Legend: ✅ done · ⚠️ partial · ❌ missing · ❓ can't-verify

---

## A1: The 5 fuzzy tasks

| Task | Status | Evidence / note |
|---|---|---|
| op-type selection | ✅ | `vocabInjection.js` feeds `OP_SCHEMA.properties.op.enum` (from `editOps.js`) into the prompt; `opPrimitive.js` `validateOpJSON` rejects any type outside the closed set `OP_VOCABULARY`. Whether the model *picks well* is UNMEASURED (see A4). |
| selector resolution | ✅ | `selectorEngine.js` tokenizes + parses `#id`, `.class`, `type`, compound `.a.b` (AND), descendant `A B`, child `A > B`, `*`; deterministic `match/query`. `classDerive.js` auto-derives classes from descriptors (`deriveClasses`, `getAllClasses`, `customClasses`). Unknown bare token matches nothing (no silent match-all). |
| argument extraction + host-normalizer | ✅ | **Normalizer EXISTS** (work order asked to confirm): `editOps.js` `recolorOp` does `new window.THREE.Color(color).getHex()`, accepting `'black'`, `'red'`, `'#111'`, `0xff0000` and resolves to a numeric hex once; the inline comment explicitly calls this the "`black`→#111 scaffolding for the model." `colorName.js` is the *reverse* map (rgb→name) used by `classDerive` color classes. |
| labeling | ✅ (both) | Auto-classes: `classDerive.js` (deterministic). Semantic labeling PASS: `import/labelPass.js` (LLM → `userData.label` + confidence). **Verify/accept UX EXISTS** (work order guessed "not yet"): `import/verifyModel.js` (pure grouping: symmetry-base families, low-confidence-first) + `import/VerifyPanel.js` (DOM panel; "Wheel ×4" collapsed rows; "Apply" writes labels in one undoable batch). Wired as `verifyImport()`. |
| multi-op decomposition | ✅ infra / ⚠️ model | Infrastructure ✅: `opPrimitive.js` `ops(editor, opList)` executes an array as a batch; `editMatrix.js` task 5 (`scoreMultiOp`) scores under/over-split. *(changed 2026-10-21)* The model side is now **measured**: multi-op is 75% for the 1.5B scaffolded, 77% for both Haiku and 1.5B host-resolved, and 2 of 13 fixtures (`everything-red`, `wheels-and-rims`) stay genuinely ambiguous (README eval tables). Still open on the roadmap. |

---

## A2: op-JSON / interface layer

| Item | Status | Evidence / note |
|---|---|---|
| `opPrimitive.js` `op()`/`ops()`/`$S` dispatcher | ✅ | op-JSON → route to guarded edit op / animation recipe / raw → `editor.execute(Command)`. Command-backed, one surface. *(changed 2026-10-21: the picker was `$$` when first audited; `$$` was removed and it is `$S`, aliases `Pick` / `pick`.)* |
| `$S` named-method sugar (recolor/scale/spin/…) chainable | ✅ | `ChainableSet` with `recolor/scale/move/rotate/delete/duplicate/retexture/setMaterial` + anim `spin/bounce/pulse/fade/orbit/shake` + `filter/each/result`; each wraps `.op()` and returns the set. `makeQuery(editor)` binds the bare `$S(sel)` form. (`scale` is also a live transform handle: `.scale` read/write and `.scale(factor, axis)` relative-scale.) |
| `type:'raw'` escape hatch, loop-protected | ✅ | `executeRaw` runs `new Function('editor','nodes','THREE', code)`; `RAW_LOOP_GUARD` blocks `while(true)`, `for(;;)`, `requestAnimationFrame`. Unguarded by design, last resort. |
| Guard: clone-on-write (shared material) | ✅ | `editOps.js` `recolorOp` → `isMaterialShared` → `cloneMaterial` via `SetMaterialCommand` (reversible, no bleed). |
| Guard: texture-tint warning | ✅ | `hasTextureMap` pushes a "will TINT, not replace" warning. |
| Guard: merged-mesh graceful fail | ✅ | `isMergedMeshNode` + `sceneIndex.matchPartNodes` `method:'merged'`; editEval `SETUP_MERGED_BED` case. |
| Guard: ground / clamp | ✅ | `scaleOp` clamps factor 0.1–10; `moveOp` clamps ±100 and forces `y≥0` (grounded count reported). |
| Guard: subset-sanity ("subset named but all changed") | ✅ | `opPrimitive.js` `subsetSanityWarning`: a NAMED selector (`#id`/`.class`, via `hasNamedMatcher`) that resolves to EVERY mesh is flagged (`result.flagged`), never a silent success. Broad selectors (`*`, bare `mesh`) intentionally not flagged. This is the dumptruck fix. |
| Guards fire on a test case | ⚠️ | Pure eval scorers for these behaviours PASS under node (`import/__tests__/import-pipeline.test.mjs`: **re-run 2026-10-21: 24 pure checks pass** (originally 18) incl. no-collateral/graceful-fail, **then the run aborts** with `ERR_MODULE_NOT_FOUND: three`: the final `flagSubsetAllChanged` section imports `ai/agentLoop.js`, which pulls in `SetMaterialCommand.js` and the bare `three` specifier). The op *executors* in `editOps.js`/`opPrimitive.js` use the same bare specifier (browser importmap only), so they are verified by inspection + in-browser, not node-runnable. |

---

## A3: Known bug fixes

| Item | Status | Evidence / note |
|---|---|---|
| `addClip` guard duck-typed (NOT `isAnimationClip`) | ✅ | `Shell.js` ~L1449–1452 *(moved from L322–326 when first audited)*: `const isClip = clip && Array.isArray( clip.tracks ) && typeof clip.duration === 'number';` with the comment that `THREE.AnimationClip` has no `isAnimationClip` flag, so validate by SHAPE. No `isAnimationClip` check anywhere. |
| Other `isX` guards on three.js objects | ✅ | `isMesh`/`isLight`/`isCamera`/`isObject3D`/`isGroup`/`isSprite`/`isLine`/`isBone` are first-party three.js flags (reliable); house rule = duck-type only where three.js OMITS a flag (AnimationClip). `selectorEngine` type-matching uses these `is*` flags. No fragile guard found. |
| Winding-safe animation (spin/rotate) | ✅ | `animationRecipes.js` `spinRecipe`: `segments = ceil(|turns|*4)` → ≤90° quaternion sub-steps (NOT a single 0→2π antipodal pair). Not `NumberKeyframeTrack [0,π,2π]` but the winding-safe *equivalent* via sub-divided `QuaternionKeyframeTrack`. |

---

## A4: The eval (the honest gap)

| Item | Status | Evidence / note |
|---|---|---|
| Standing generation eval (`evalAI`) | ✅ (legacy) | `ai/eval.js` is the OLD 4-axis GENERATION harness: struct / spatial / semantic / distinct, with `EVAL_PROMPTS` + overfit canaries. Unchanged in purpose. |
| Per-task editing eval EXISTS? | ✅ harness / ✅ run *(changed 2026-10-21)* | **Work order assumed "likely NO". It EXISTS.** `ai/editEval.js` (synthetic assets + per-axis scorers: resolved-correct-node ★, structure-valid, spatially-grounded, didn't-break-other-parts, graceful-fail) AND `ai/editMatrix.js`, **the 5-task × model-size × condition + Haiku/Opus-ceiling matrix**: `parseEmittedOps`, `scoreOpType/scoreSelectorResolution/scoreArgExtraction/scoreMultiOp/scoreLabel`, `newMatrix/recordRun/formatMatrix`, `runEditMatrix`. Wired into `Shell.js` as `evalEditMatrix('bare'|'scaffolded'|'constrained'|'reason-constrained'|'host-resolved')` (originally only `'scaffolded'|'bare'`); `saveEvalRows()` downloads the per-case rows as JSONL. |
| Matrix RUN / results recorded | ⚠️ run, recorded in docs only *(changed 2026-10-21; was ❌ "THIS IS THE GAP")* | The matrix **has been run** across 0.5B / 1.5B / 3B / 7B plus Haiku / Opus ceilings and the results are recorded in the [README eval tables](../README.md#the-eval-matrix-the-editing-gate) and summarised in [ROADMAP.md](ROADMAP.md). The raw per-case rows are **not committed** (no `.jsonl` or results file in the repo), so the tables cannot be re-derived from the tree without re-running in a browser with each model. What it established: 1.5B is the viable floor; selector-resolution caps at 77% even at Opus until moved host-side; host-resolved Haiku vs 1.5B agree 22/22 on selector / op-selection / arg-extraction. **What it does not establish:** the op-selection and multi-op cells were not re-run at 0.5B under host resolution; the alien-syntax ablation is not done; labeling stays model-bound (Haiku 100% vs 1.5B 67%). Implemented **and** run is still not the same as validated for every model or request. |
| Eval-check trustworthiness | ✅ | Scorers are pure and node-unit-tested (`ai/__tests__/editMatrix.test.mjs`: **re-run 2026-10-21, 48 passed, 0 failed**; plus the 24 pure `import-pipeline` checks above). `validate.js` false-positive classes (co-location AABB+flatness, block-scope dup-const, `stripComments` for string color literals, `extractCode` unicode folding) documented + guarded. Selector resolution scored as resolved-correct-node (right nodes, none extra). |

---

## A5: Pipeline / handoff

| Item | Status | Evidence / note |
|---|---|---|
| glTF export + animations | ✅ | `Sidebar.Export.js` (GLB + GLTF buttons): `GLTFExporter.parse(scene, …, { binary, animations: optimizedAnimations })` via `combineAnimations(scene)` + `.optimize()`. USDZ + OBJ exporters also present. |
| Labels survive to `extras` | ⚠️ | `userData.label` is a plain string → GLTFExporter's default `userData`→`extras` serialization carries it. *(changed 2026-10-21)* Hand-added classes (`userData.customClasses`) are now normalised to a plain **Array** on load (`classDerive.js` `toClassSet` + the normalising pass), so unlike when first audited (a `Set` that JSON-serialized to `{}`) they should survive JSON / git / glTF; auto-derived classes are recomputed (`deriveClasses`) rather than serialized (the README says "auto-classes don't yet serialize"). Still no explicit label→extras mapping and **no test** asserts survival, so: unverified end-to-end. |
| Scale / Y-up export | ✅ | three.js and glTF are both Y-up, metre-scale; `GLTFExporter` preserves node transforms, so no conversion needed, scale exports faithfully. (Import normalization is separate: `import/normalize.js`.) |
| git integration (load/commit/auto-load/merge-viewport) | ✅ | `Menubar.Git.js`: `GitSettingsDialog`, `GitLoadDialog`, `GitCommitDialog` (AI diff-aware message), `autoLoadFromGit`, `openGitCompare`; `MergeViewport.js` split-screen + per-conflict resolution; `SceneDiff.js` semantic diff. Raw-media fetch, cache-bust, >1 MB handling. |
| scene-as-data round-trip (`sceneToJS`/`sceneEqual`) | ✅ | `scene/codegen.js` (`objectToJS`/`sceneToJS`, recipe-aware), `scene/sceneEqual.js`, `scene/serialize.js`; exposed in the Shell scope; round-trip test documented (`scene.toJSON()` → `sceneToJS()` → `sceneEqual`). Files present + wired (not exhaustively re-run at runtime here). |

---

## A6: Implemented vs Aspirational (roadmap, NOT built)

| Item | Status | Note |
|---|---|---|
| BVH import / skeletal animation | ❌ roadmap | No BVH loader / skeletal-motion authoring in `docs/editor/js/`. Roadmap "THEN". |
| facemesh / blendshape performance | ❌ roadmap | Live facemesh / blendshape *performance capture* is not present. *(note 2026-10-21)* Adjacent features exist: photo → face-blendshape GLB → bound VRM (facebind, with an open morph-delta gate, see [FACE_BIND.md](FACE_BIND.md)) and the authored face (expression + gaze keys on the timeline, [FACE_TRACK.md](FACE_TRACK.md)). |
| capture integration (Mesquite / face-record) | ❌ roadmap | Separate projects; NOT integrated into this repo. |
| distributed render / CLI renderer | ❌ roadmap | Not present. In-editor path-tracer viewport exists (`Viewport.Pathtracer.js`) but that is not distributed render. |
| sovereignty dashboard (green/orange/red) | ❌ roadmap | Not built. Sovereignty is enforced by the two-egress design (git, `fetchAPI`), not a live dashboard. |
| scene-wide timeline | ✅ built *(changed 2026-10-21; was ❌ roadmap)* | The universal timeline (`intelligence/timeline.js`, `Timeline.js`, `editor.timeline`) is a scene-wide absolute clock for objects **and** cameras, with node tests (e.g. `timeline.test.mjs` 13 passed, `cameraMove.test.mjs` 17, `timelineCodeMap.test.mjs` 5, re-run today). `Animation.js` is the legacy per-object editor. **Captured performance** on the axis is still roadmap (imported glTF clips ride the clock; no capture integration). See [ANIMATION.md](ANIMATION.md). |
| PWA / Electron packaging | ❌ roadmap | A `manifest.json` + `sw.js` exist in `docs/editor/` (service-worker/PWA scaffolding for offline caching), but there is NO installable-PWA/Electron packaging story shipped. Treat as roadmap. |
| MCP server | ❌ future | Not present. `opPrimitive.js` header *mentions* MCP tools as a future consumer of the op-JSON contract, but no server exists. |
| Constrained decoding (JSON-schema-restricted output) | ✅ built *(changed 2026-10-21; was ❌ roadmap)* | `editOps.js` `buildConstrainedOpsSchema()` / `buildReasonConstrainedOpsSchema()` (and a candidate-constrained variant) are imported in `Shell.js` and selected at the generation call site; the matrix conditions `constrained` and `reason-constrained` exercise them. The four-backend (WebLLM / Ollama / OpenAI / Anthropic) integration and the "26/26" figure are as recorded in [ROADMAP.md](ROADMAP.md); not re-verified in a browser today. |

---

## Summary: what the README must honour (as of 2026-10-21)

- The **interface** (selectors + ops + `$S` + guards + git + round-trip) is **built and works without AI**. This is the proven, durable part.
- The **5 fuzzy tasks** are all **implemented** (incl. the color normalizer and the import verify UX the work order thought were missing).
- The **editing eval matrix harness is built, wired and has been run** (`editEval.js` + `editMatrix.js` + `evalEditMatrix`); results are recorded in the README tables, not as committed raw rows. *(Originally: "NOT been run". That gap was closed.)* **Implemented ≠ validated** still governs: selector-resolution only reaches parity because it moved host-side, labeling stays model-bound, op-selection / multi-op were not re-run at 0.5B under host resolution, and the alien-syntax ablation is open.
- glTF **export + animations work**; **label→extras survival is only partial/unverified**; hand-added classes now persist as an Array, auto-derived classes are not serialized.
- BVH import, live facemesh performance, capture integration, distributed render, sovereignty dashboard, captured-performance on the timeline, PWA/Electron packaging and an MCP server are **roadmap, not built**. (Constrained decoding and the scene-wide timeline moved to built.) The README must never imply otherwise.
