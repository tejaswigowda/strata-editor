# Strata: Repo Audit (code, not README)

> Source of truth for the README update. Every status below is verified against the
> current code in `docs/editor/js/`, not against the README or prior claims.
> Governing rule: **implemented ≠ validated.** The architecture is built; the
> validating eval matrix has been built but **not run**.
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
| multi-op decomposition | ⚠️ | Infrastructure ✅: `opPrimitive.js` `ops(editor, opList)` executes an array as a batch; `editMatrix.js` task 5 (`scoreMultiOp`) scores under/over-split. Whether the *model* splits a compound request into the right N ops is IMPLEMENTED-but-UNMEASURED (that is exactly what the unrun matrix would measure). |

---

## A2: op-JSON / interface layer

| Item | Status | Evidence / note |
|---|---|---|
| `opPrimitive.js` `op()`/`ops()`/`$$` dispatcher | ✅ | op-JSON → route to guarded edit op / animation recipe / raw → `editor.execute(Command)`. Command-backed, one surface. |
| `$$` named-method sugar (recolor/scale/spin/…) chainable | ✅ | `ChainableSet` with `recolor/scale/move/rotate/delete/duplicate/retexture/setMaterial` + anim `spin/bounce/pulse/fade/orbit/shake` + `filter/each/result`; each wraps `.op()` and returns the set. `makeQuery(editor)` binds the bare `$$(sel)` form. |
| `type:'raw'` escape hatch, loop-protected | ✅ | `executeRaw` runs `new Function('editor','nodes','THREE', code)`; `RAW_LOOP_GUARD` blocks `while(true)`, `for(;;)`, `requestAnimationFrame`. Unguarded by design, last resort. |
| Guard: clone-on-write (shared material) | ✅ | `editOps.js` `recolorOp` → `isMaterialShared` → `cloneMaterial` via `SetMaterialCommand` (reversible, no bleed). |
| Guard: texture-tint warning | ✅ | `hasTextureMap` pushes a "will TINT, not replace" warning. |
| Guard: merged-mesh graceful fail | ✅ | `isMergedMeshNode` + `sceneIndex.matchPartNodes` `method:'merged'`; editEval `SETUP_MERGED_BED` case. |
| Guard: ground / clamp | ✅ | `scaleOp` clamps factor 0.1–10; `moveOp` clamps ±100 and forces `y≥0` (grounded count reported). |
| Guard: subset-sanity ("subset named but all changed") | ✅ | `opPrimitive.js` `subsetSanityWarning`: a NAMED selector (`#id`/`.class`, via `hasNamedMatcher`) that resolves to EVERY mesh is flagged (`result.flagged`), never a silent success. Broad selectors (`*`, bare `mesh`) intentionally not flagged. This is the dumptruck fix. |
| Guards fire on a test case | ⚠️ | Pure eval scorers for these behaviours PASS under node (`import/__tests__/import-pipeline.test.mjs`: 18 pure tests incl. no-collateral/graceful-fail). The op *executors* in `editOps.js`/`opPrimitive.js` import commands that use the bare `three` specifier (browser importmap only), so they are verified by inspection + in-browser, not node-runnable. |

---

## A3: Known bug fixes

| Item | Status | Evidence / note |
|---|---|---|
| `addClip` guard duck-typed (NOT `isAnimationClip`) | ✅ | `Shell.js` L322–326: `const isClip = clip && Array.isArray( clip.tracks ) && typeof clip.duration === 'number';` with the comment "three.js has no `isAnimationClip` flag, validate by SHAPE." No `isAnimationClip` check anywhere. |
| Other `isX` guards on three.js objects | ✅ | `isMesh`/`isLight`/`isCamera`/`isObject3D`/`isGroup`/`isSprite`/`isLine`/`isBone` are first-party three.js flags (reliable); house rule = duck-type only where three.js OMITS a flag (AnimationClip). `selectorEngine` type-matching uses these `is*` flags. No fragile guard found. |
| Winding-safe animation (spin/rotate) | ✅ | `animationRecipes.js` `spinRecipe`: `segments = ceil(|turns|*4)` → ≤90° quaternion sub-steps (NOT a single 0→2π antipodal pair). Not `NumberKeyframeTrack [0,π,2π]` but the winding-safe *equivalent* via sub-divided `QuaternionKeyframeTrack`. |

---

## A4: The eval (the honest gap)

| Item | Status | Evidence / note |
|---|---|---|
| Standing generation eval (`evalAI`) | ✅ (legacy) | `ai/eval.js` is the OLD 4-axis GENERATION harness: struct / spatial / semantic / distinct, with `EVAL_PROMPTS` + overfit canaries. Unchanged in purpose. |
| Per-task editing eval EXISTS? | ✅ harness / ❌ run | **Work order assumed "likely NO". It EXISTS.** `ai/editEval.js` (synthetic assets + per-axis scorers: resolved-correct-node ★, structure-valid, spatially-grounded, didn't-break-other-parts, graceful-fail) AND `ai/editMatrix.js`, **the 5-task × model-size × {bare,scaffolded} + Haiku-ceiling matrix**: `parseEmittedOps`, `scoreOpType/scoreSelectorResolution/scoreArgExtraction/scoreMultiOp/scoreLabel`, `newMatrix/recordRun/formatMatrix`, `runEditMatrix`. Wired into `Shell.js` as `evalEditMatrix('scaffolded'|'bare')`. |
| Matrix RUN / results recorded | ❌ | **THIS IS THE GAP.** No recorded matrix results exist anywhere in the repo (no results file, no committed table). The harness has never been run across model sizes + a ceiling. The 5 tasks are **implemented but UNMEASURED**. Running the matrix + recording the numbers is the next gate. |
| Eval-check trustworthiness | ✅ | Scorers are pure and node-unit-tested (18 pass). `validate.js` false-positive classes (co-location AABB+flatness, block-scope dup-const, `stripComments` for string color literals, `extractCode` unicode folding) documented + guarded. Selector resolution scored as resolved-correct-node (right nodes, none extra). |

---

## A5: Pipeline / handoff

| Item | Status | Evidence / note |
|---|---|---|
| glTF export + animations | ✅ | `Sidebar.Export.js` (GLB + GLTF buttons): `GLTFExporter.parse(scene, …, { binary, animations: optimizedAnimations })` via `combineAnimations(scene)` + `.optimize()`. USDZ + OBJ exporters also present. |
| Labels survive to `extras` | ⚠️ | `userData.label` is a plain string → GLTFExporter's default `userData`→`extras` serialization carries it. BUT auto-classes are stored as a **`Set`** (`userData.customClasses`), which JSON-serializes to `{}` and is effectively DROPPED. No explicit label→extras mapping and **no test** asserts survival. So: string labels survive by default behaviour; classes do NOT; unverified end-to-end. |
| Scale / Y-up export | ✅ | three.js and glTF are both Y-up, metre-scale; `GLTFExporter` preserves node transforms, so no conversion needed, scale exports faithfully. (Import normalization is separate: `import/normalize.js`.) |
| git integration (load/commit/auto-load/merge-viewport) | ✅ | `Menubar.Git.js`: `GitSettingsDialog`, `GitLoadDialog`, `GitCommitDialog` (AI diff-aware message), `autoLoadFromGit`, `openGitCompare`; `MergeViewport.js` split-screen + per-conflict resolution; `SceneDiff.js` semantic diff. Raw-media fetch, cache-bust, >1 MB handling. |
| scene-as-data round-trip (`sceneToJS`/`sceneEqual`) | ✅ | `scene/codegen.js` (`objectToJS`/`sceneToJS`, recipe-aware), `scene/sceneEqual.js`, `scene/serialize.js`; exposed in the Shell scope; round-trip test documented (`scene.toJSON()` → `sceneToJS()` → `sceneEqual`). Files present + wired (not exhaustively re-run at runtime here). |

---

## A6: Implemented vs Aspirational (roadmap, NOT built)

| Item | Status | Note |
|---|---|---|
| BVH import / skeletal animation | ❌ roadmap | No BVH loader / skeletal-motion authoring in `docs/editor/js/`. Roadmap "THEN". |
| facemesh / blendshape performance | ❌ roadmap | Not present. |
| capture integration (Mesquite / face-record) | ❌ roadmap | Separate projects; NOT integrated into this repo. |
| distributed render / CLI renderer | ❌ roadmap | Not present. In-editor path-tracer viewport exists (`Viewport.Pathtracer.js`) but that is not distributed render. |
| sovereignty dashboard (green/orange/red) | ❌ roadmap | Not built. Sovereignty is enforced by the two-egress design (git, `fetchAPI`), not a live dashboard. |
| scene-wide timeline | ❌ roadmap | Current animation is per-object keyframe (`Animation.js`), not a scene-wide/camera timeline. |
| PWA / Electron packaging | ❌ roadmap | A `manifest.json` + `sw.js` exist in `docs/editor/` (service-worker/PWA scaffolding for offline caching), but there is NO installable-PWA/Electron packaging story shipped. Treat as roadmap. |
| MCP server | ❌ future | Not present. `opPrimitive.js` header *mentions* MCP tools as a future consumer of the op-JSON contract, but no server exists. |
| Constrained decoding (JSON-schema-restricted output) | ❌ roadmap | Prompt-level vocab injection is on ("scaffolded"); grammar-constrained decoding is NOT wired. |

---

## Summary: what the README must honour

- The **interface** (selectors + ops + `$$` + guards + git + round-trip) is **built and works without AI**. This is the proven, durable part.
- The **5 fuzzy tasks** are all **implemented** (incl. the color normalizer and the import verify UX the work order thought were missing).
- The **editing eval matrix HARNESS is built and wired** (`editEval.js` + `editMatrix.js` + `evalEditMatrix`), but it has **NOT been run**; **no results are recorded**. The tasks are **implemented, not validated**. This is THE gap.
- glTF **export + animations work**; **label→extras survival is only partial/unverified**, and auto-classes (Set) do not serialize.
- All of BVH, facemesh, capture, distributed render, sovereignty dashboard, scene-wide timeline, PWA/Electron, MCP, and constrained decoding are **roadmap, not built**. The README must never imply otherwise.
