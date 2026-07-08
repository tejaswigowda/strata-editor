# Strata: A CSS-like interface for editing and versioning 3D scenes

<img src='docs/demo.gif'/>

**Address parts by selector, edit by op, version with git. Drive it by hand or in natural language. Sovereign, browser-native, no build.**

Strata puts a small, familiar interface over a 3D scene: address parts with CSS-like selectors, change them with a closed set of command-backed ops, and version the result with git. The interface is deterministic and works entirely **by hand, without any AI**.

Because that interface is small, a stock on-device model can map natural language onto it. No task-specific training is needed. AI is the natural-language layer over the interface, not the foundation. It debuts most vividly at **animation**: "make it bounce" becomes a real keyframe clip. Generation (blocking out a scene from a prompt) is kept as **scaffolding**, not the headline.

> **The thesis (short).** 3D editing decomposes into a deterministic shell plus **5 fuzzy tasks** (op-selection, selector-resolution, argument-extraction, labeling, multi-op). So a stock on-device model suffices, with no task-specific training.

**Sovereign by default.** Nothing leaves the device except by your explicit action (git sync, `fetchAPI`). Inference is local. Scene state stays on-device.

---

## Quick start

```bash
npx serve docs       # local dev. Or point GitHub Pages at docs/
```

Requires **Chrome 113+** (WebGPU). Verify at [webgpureport.org](https://webgpureport.org).

**With external AI models (Ollama, OpenAI, Claude):**

```bash
# Terminal 1: start the server with dev mode enabled
export ANTHROPIC_API_KEY="sk-ant-..."  # or OPENAI_API_KEY
DEV=1 node server.js

# Terminal 2: open http://127.0.0.1:5500 in Chrome
# External models now appear in the model dropdown
```

---

## The thesis: deterministic shell, small fuzzy core

3D editing splits into a deterministic shell and a small fuzzy core. The shell is host code: selector matching, command execution, undo, versioning, normalization, guards. The fuzzy core is **5 tasks** a small model handles.

**The 5 fuzzy tasks (the entire model surface):**

1. **Op-type selection.** Request verb to op. "make it bigger" to `scale`.
2. **Selector resolution.** Request noun to selector. "the front wheels" to `.wheel.front`.
3. **Argument extraction.** Modifiers to args. "black" to `#111`, "slowly" to `dur:4`.
4. **Labeling (on import).** Descriptors plus material names to human labels. `{round, low, paired, mat:"Rims"}` to "wheel".
5. **Multi-op decomposition.** One request to N ops. "wheels black and body red" to 2 ops.

Everything else is deterministic. If a feature seems to need the model to reason more, the fix is to decompose it, not to expand the model's job.

**CSS-via-JS.** The model maps language to op-JSON. The shape of that op-JSON is CSS thinking: a selector, an op (the property), a value, plus chained transforms. It is emitted as JS/JSON and executed on the one surface. Strata borrows CSS's selecting-and-value grammar. It does not borrow the cascade or specificity.

```
Author and label the scene   ->  the "HTML" (structure: parts, labels, hierarchy)
Style and animate by selector ->  the "CSS"  (recolor, scale, spin by selector)
Behavior and runtime          ->  handed off to engines (out of scope)
```

---

## Features

Strata is the structure and design layer for 3D. You author and label the scene (the "HTML"), then style and animate it by selector (the "CSS"). Behavior and runtime are handed off to engines.

| | |
|---|---|
| **Selector-based editing** | Address imported parts by CSS-like selector (`$S('.wheel.front')`). Edit them with a closed set of command-backed, guarded ops (`recolor`, `scale`, `spin`). Resolution is deterministic. The model only translates language to a selector. |
| **Scene intelligence** | Resolve descriptive part references on imported GLBs with meaningless node names. Geometry, color, and symmetry descriptors become auto-classes. No vision model. |
| **Git versioning** | Auto-load on open, commit, and a split-screen merge-conflict viewport. The AI writes diff-aware commit messages. Scenes are diffable JSON. |
| **One execution surface** | **All** code (manual, AI-generated, eval fixtures) runs through a single `execute()` binding. Monaco editors present AI-generated code with live syntax highlighting; the Run button executes only the edited code. Same undo stack, same error handling, no second path. The editor is disposed immediately after execution. |
| **Everything reversible** | Every mutation goes through `editor.execute(new Command())`. Selectors, ops, labels, and class edits are all undoable. |
| **Verify UX (on import)** | After labeling, a panel surfaces the semantic guesses. Symmetric parts collapse to one decision ("Wheel x4"). Low-confidence guesses come first. |
| **Sovereign by default** | On-device inference via WebGPU (WebLLM / MLC). Nothing leaves the device except your explicit git sync or `fetchAPI` call. |
| **Agentic loop** | AI requests run a bounded generate, validate, execute, observe, fix loop. The model checks its output against the real API and the resulting scene change, then self-corrects. |
| **No API hallucination** | Real command, op, material, and geometry signatures are indexed locally. They are injected before generation and linted after. |
| **Model-free grounding** | GPU color-picking answers "what is visible" and "what is under this point" from the renderer. No vision model. |
| **Keyframe animation** | An Animations tab to author clips by hand. The AI authors clips too, via deterministic recipes (`spin`, `bounce`, `pulse`). |
| **Modeling ops** | Boolean CSG, mirror, array, subdivision. Undoable and AI-callable. The manual-editing layer. |
| **Edit Mode** | Half-edge mesh editing: vertex, edge, and face selection, extrude, inset, bevel, delete, weld, UV projection. |
| **No build step** | Serve `docs/` as-is. Plain ES modules, importmap, no bundler. |
| **Generation (scaffolding)** | The model can block out structure from a prompt. This is the weaker, ceded task. It is kept as scaffolding, not the headline. |

---

## Where Strata sits

Strata is the **authoring layer upstream of the ecosystem**. It is the place you *iterate*, not the place you ship. You build and edit fast: AI plus WebGL, no render wait, every step versioned. Then you **hand off** the result to any renderer or engine.

- **Author here.** Structure (scene graph) + design (selectors / ops, labels, keyframe clips), versioned in git.
- **Hand off via glTF + labels.** Export to any renderer (Blender / Unreal / WebGPU → media) or any engine (three.js / Unity / Unreal → runtime), where **behavior attaches to the labels**.
- Renderer- and engine-agnostic by design: Strata owns authoring; the downstream owns runtime and final pixels.

**Handoff status (honest).** glTF export with animations works today (`Sidebar, Export, GLB/GLTF`). Full label-through-`extras` survival and the broader renderer-agnostic pipeline are **partial / roadmap**: string `userData.label`s ride along on the default `userData → extras` path, but auto-classes (stored as Sets) do not yet serialize, and the handoff is not yet tested end-to-end.

**Three invariants (why Strata stays the authoring layer):** no runtime · no interaction · no render-wait-during-iteration. The moment a task needs one of those, it belongs downstream.

**Who it's for.** People who use engines and renderers but find them *in the way* during fast iteration. Strata is the authoring layer that comes **before** the handoff.

---

## Selector-based editing

A CSS-like selector layer over the scene graph, plus a closed set of structured edit ops. This is the preferred way to edit imported parts. `$S(selector)` returns a chainable set. Its methods are 3D ops. Each compiles to `editor.execute(new Command())`. Every op is undoable, versioned, and guarded. `$S` also answers to the aliases `Pick` and `pick`. They are the same function.

```js
listSelectors()                     // the REAL addressable parts in THIS scene, with counts:
                                    //   .rims(x4)  .grille  #dump-bed  .red(x3)  .front
$S('.rims').recolor('#111')         // recolor 4 wheels. Command-backed, guarded
$S('.wheel.front').spin('y', 1, 2)  // compound selector + animation op (winding-safe clip)
$S('#dump-bed').scale(1.2)          // edit a single labelled part by id
op({ type:'recolor', selector:'.rims', color:'red' })   // explicit op-JSON (same thing)
ops([ {}, {} ])                     // several ops in one undoable batch (multi-op)
```

**Selector grammar.** Deterministic match, no model at match time: `#id` (semantic label), `.class`, `type` (`mesh`/`group`/`light`), `.a.b` (compound AND), `A B` (descendant), `A > B` (child), `*`. Classes auto-derive on import from descriptors. Facts like `.front .left .red .elongated .pair-left`, plus material names (`Rims` to `.rims`). The optional labeling pass adds semantic `#labels` and `.classes` (`wheel`, `dump-bed`).

**Names become classes too.** A meaningful object name yields a stem class, so "Chair 1", "Chair 2", and "Chair 3" all get `.chair`. Plural requests then resolve cleanly (`$S('.chair').scale(0.5)`). The trailing index also stays addressable by id (`#chair-2`). Auto-generated names like `Object_12` are skipped so the vocabulary stays clean.

**Closed op set.** The human sugar; each is also an op-JSON `type`:

```js
recolor(color)  scale(factor, axis?)  move(dx,dy,dz)  rotate(axis, deg)
delete()  duplicate(dx,dy,dz)  setMaterial({})  retexture(tex)
spin(axis?,turns?,dur?)  bounce()  pulse()  fade()  orbit()  shake()   // keyframe clips

// ── Entrance animations (appear with style) ──
fadeIn(dur?)  zoomIn(scale?, dur?)
slideInUp(dist?, dur?)  slideInDown(dist?, dur?)  slideInLeft(dist?, dur?)  slideInRight(dist?, dur?)
bounceIn(dur?)  flipInX(dur?)  flipInY(dur?)  rotateIn(angle?, dur?)

// ── Exit animations (disappear with style) ──
fadeOut(dur?)  zoomOut(scale?, dur?)
slideOutUp(dist?, dur?)  slideOutDown(dist?, dur?)  slideOutLeft(dist?, dur?)  slideOutRight(dist?, dur?)
bounceOut(dur?)  flipOutX(dur?)  flipOutY(dur?)  rotateOut(angle?, dur?)

// ── Attention seekers (grab focus) ──
flash(times?, dur?)  rubberBand(scale?, dur?)  jello(intensity?, dur?)
heartBeat(scale?, dur?)  tada(rotations?, scale?, dur?)  wobble(angle?, dur?)

op({ type:'raw', selector, code })   // escape hatch: raw JS as one op (loop-protected)
```

**Host-enforced guards.** The model expresses intent. The host enforces correctness. Clone-on-write for shared materials (no bleed). Texture-tint warning (`recolor` on a textured part tints; use `setMaterial` for solid). Merged-mesh graceful fail. Ground and clamp. A "subset named but all changed" flag: a part selector that resolves to every mesh is surfaced as a likely wrong resolution, never a silent pass.

**Curating labels and classes.** Edit the addressable vocabulary directly. All command-backed (undoable) and reflected in the next AI request:

```js
relabel('wheel')           // rename the selected part's label. Now #wheel
tagClass('wheel')          // add a semantic class. Now .wheel
untagClass(node, 'rims')   // remove a class
verifyImport()             // open the Import + Verify panel (also opens automatically after import)
```

---

## Scene intelligence

Resolves natural-language part references against imported GLBs whose nodes are named `Object_12, Object_44`. It uses only deterministic math, the existing renderer, and the already-loaded code LLM. No new model download.

**Per-node descriptors** (`userData.descriptors`, derived on import):
- **Region.** left/right/top/bottom/front/back within the parent bounding box.
- **Shape.** elongated / flat / blocky / thin (from sorted bbox dims: limb vs panel vs block).
- **Symmetry pairs.** Reflect a sibling's centroid across the parent plane. Matches tag left/right. This is the high-value primitive for arms, legs, and wheels.
- **Color.** Sampled from the texture (16x16 offscreen render, dominant HSV bin, color name). `baseColorFactor` is usually white on real GLBs. Pure pixel math, reuses the renderer.
- Size rank, orientation, adjacency, hierarchy role.

**Resolution is cheap-first.** A deterministic rule match (free, offline) handles most queries. Ambiguous ones build a compact descriptor table and ask the loaded LLM to disambiguate. Never silently wrong: it returns confidence and ranked candidates, and detects single merged-mesh GLBs (no per-part nodes) and says so.

The AI scene context is enriched with compact `desc(region,shape,color,pair)` tags. The code-gen model maps "right arm of the red person" to a node by reasoning, with zero extra inference.

```js
findByDescription('the right arm of the red person')  // node (or null)
describeObject(obj)        // {region, shape, color, sizeRank, pair, ...}
listCandidates('the two wheels at the back')          // ranked candidates
resolvePartAI('the flat panel on top')                // async: rule match + LLM disambiguation
```

---

## Git integration (versioning)

Open the **Git** menu to configure a repository and sync scenes. All calls use `fetch()` directly. No Octokit.

| Action | Behaviour |
|--------|-----------|
| **Settings** | Repo URL, branch, scene-file path, access token (see below). |
| **Load Scene** | Clears the scene and loads the repo's scene file. |
| **Compare with Remote** | Opens the merge-conflict viewport (below). |
| **Commit Scene** | The AI writes a diff-aware message (added/removed/modified vs last commit). Editable before commit. |
| **Auto-load on open** | If a repo is configured, the scene loads from GitHub on page open (after local autosave, so GitHub wins). **File, New** suppresses this once. |

Content is fetched with the GitHub raw media type. It handles files over 1 MB and decodes UTF-8 natively. It is cache-busted so a fresh commit is not served stale.

### Merge-conflict viewport

`Git, Compare with Remote` diffs your scene against the repo's. It opens a split-screen review: left is local, right is remote, one shared orbit camera. Objects are tinted green (added), red (removed), orange (modified). A per-conflict list lets you choose local, remote, or both per object (or **Accept All**). **AI Suggest** proposes resolutions. **Apply Merge** rebuilds the scene from your choices.

> **Token storage and scope.** The access token lives in `localStorage` (`git-settings`). Same-origin scripts can read it, so treat it like a password. Prefer a fine-grained, repo-specific PAT (Settings, Developer settings, Fine-grained tokens) scoped to the one repo with **Contents: Read and write** only. A classic `repo`-scope token grants write access to every repository in your account. Avoid it here.

---

## Keyframe animation

The **Animations** tab is a full keyframe editor layered on `THREE.AnimationMixer`.

- **+ Clip** creates a clip. **Key** records a keyframe for the selected object at the playhead on the enabled channels (**P** position, **R** rotation/quaternion, **S** scale). **Del Key** and **Clip** remove them. **Auto** records a key whenever the selected object is transformed.
- Play, Pause, Stop, and a draggable playhead. Click a keyframe to scrub, drag it to retime, double-click a clip to rename. **Snap** quantises key times to an FPS grid.
- Clips are stored on `object.animations` (track name `<uuid>.<property>`) and serialise with the scene.

### AI-authored clips

The AI authors clips from natural language: "make the box bounce", "spin the wheel 360 over 2 seconds", "fade it out". The **primary path is deterministic recipes** (`spin`, `bounce`, `pulse`, `fade`, `orbit`, `shake`). The host expands them into winding-safe keyframe tracks, command-backed. The model never writes keyframe math.

Recipes register through `AddAnimationClipCommand` (undoable). The lower-level `addClip(object, clip)` helper also exists for hand-built tracks. It validates clips by shape (tracks plus duration), not by an `isAnimationClip` flag, because three.js omits that flag.

**Entrance animations** (objects appear with style):

```js
$S('.box').fadeIn(1)                    // fade in from transparent (default 1s)
$S('.wheel').zoomIn(1.5, 1)             // scale from zero to full size (scale, duration)
$S('.car').slideInLeft(2, 1.2)          // slide in from left (distance, duration)
$S('.object').slideInUp(1, 0.8)         // slide in from below
$S('.object').slideInDown(1, 0.8)       // slide in from above
$S('.object').slideInRight(1, 0.8)      // slide in from right
$S('.cube').bounceIn(1.2)               // scale in with bounce effect
$S('.card').flipInX(0.8)                // rotate in around X-axis
$S('.card').flipInY(0.8)                // rotate in around Y-axis
$S('.plane').rotateIn(90, 0.8)          // rotate in place (angle in degrees)
```

**Exit animations** (objects disappear with style):

```js
$S('.box').fadeOut(1)                   // fade out to transparent
$S('.building').zoomOut(0.3, 1)         // scale down to zero
$S('.object').slideOutLeft(1, 0.8)      // slide out to left
$S('.object').slideOutUp(1, 0.8)        // slide out upward
$S('.object').slideOutDown(1, 0.8)      // slide out downward
$S('.object').slideOutRight(1, 0.8)     // slide out to right
$S('.object').bounceOut(1.2)            // scale out with bounce
$S('.card').flipOutX(0.8)               // rotate out around X-axis
$S('.card').flipOutY(0.8)               // rotate out around Y-axis
$S('.plane').rotateOut(90, 0.8)         // rotate out of place
```

**Attention seekers** (grab focus on visible objects):

```js
$S('.light').flash(4, 1)                // rapidly toggle opacity (cycles, duration)
$S('.object').rubberBand(1.3, 0.8)      // stretchy scale oscillation
$S('.object').jello(0.05, 0.9)          // wobbly elastic deformation
$S('.heart').heartBeat(1.1, 1.3)        // pulse like a heartbeat
$S('.character').tada(1, 1.15, 1.5)     // spin + scale celebration (rotations, scale, duration)
$S('.object').wobble(15, 1)             // gentle side-to-side sway (angle in degrees)
```

**Original recipes:**

```js
$S('.wheel').spin('y', 1, 2)            // recipe: 1 turn on Y over 2s, winding-safe
$S('.object').bounce(1.5)               // bounce up and down
$S('.object').pulse(1.2, 1)             // scale up/down (scale, duration)
$S('.object').fade(0, 1, 1)             // opacity transition (from, to, duration)
$S('.planet').orbit({center:[0,0,0]}, 3, 4)  // orbit around a point
$S('.object').shake(0.2, 1)             // jittery motion (intensity, duration)
```

All animations are **winding-safe** (rotations sub-divide to prevent antipodal flips), **command-backed** (undoable), and support **chaining** with other ops:

```js
$S('.box').fadeIn(1).spin('y', 1, 2)    // chain entrance + spin
$S('.wheel').slideInUp(1, 0.8).bounce(1)  // enter then pulse
```

The agent authors clips only. Runtime `requestAnimationFrame` loops remain out of scope. Skeletal motion (BVH) and captured performance are on the roadmap as imported data, not generation.

---

## Reliable AI assist (the agentic loop)

Every AI request runs a bounded, self-correcting loop. All on-device, no extra models:

```
generate -> validate -> execute -> observe -> fix   (max 3 retries, every action on the undo stack)
```

1. **Retrieve real APIs.** A local index of the actual command, op, material, and geometry signatures (rebuilt at load) is searched by intent and injected before generation. The model sees the real `AddObjectCommand(editor, object)` and the real `metalness` key instead of guessing.
2. **Validate.** Generated code is statically linted against that index before running. It catches invented classes (`Tree3D`), wrong command arity, bad material keys (`metal:1`), undefined helper calls (`backWall()`), `.add()` on a Material or Geometry, duplicate-`const` redeclaration, `scene.add()` bypass, and constructed-but-never-added objects. Each is fed back as an actionable correction, the fix, not the raw symptom. Identical retries stop early. The selector ops (`$S`, `op`, `ops`, `listSelectors`) are on the allow-list.
3. **Execute** through the single shell surface (`editor.execute`, undo stack).
4. **Observe.** The scene is snapshotted before and after, then diffed (added, removed, moved, scaled, recolored). The loop reports the change. If a change was expected and nothing happened (usually a missed lookup), it feeds that back for one corrective retry.
5. **Bounded and reversible.** Retries are hard-capped. Every autonomous action is undoable. Ambiguous or destructive ops surface candidates rather than guess.

**Grounding without a vision model.** GPU color-picking renders each object in a unique ID color offscreen and reads pixels. That gives `whatsVisible()` (what is on screen, by area) and `whatsAt(x, y)` (what is under a point). Deterministic, reuses the existing renderer, no download.

---

## AI scene context

Every request gets a compact JS-comment scene description. This is the format a code model reads most naturally:

```
// [selected] "Body" Mesh BoxGeometry(0.6,1.8,0.5) mat:"Red Paint" size(0.6,1.8,0.5) color:#cc2200(red) at(0,0.9,0) desc(blocky,red)
// "Object_12" Mesh size(0.1,0.3,0.1) mat:"Tail Light" color:#dd1100(red) at(0.8,0.4,-1) desc(right,elongated,red,pair-right)
// "Tree" Group(2 children) at(3,0,-2)
// Camera at(0,5,10) looking at(0,0,0)
```

Each line includes the object name (glTF `_0XX_` escapes decoded), material names, geometry plus key params, world-space size, texture-sampled color, transform (non-default only), hierarchy, and the `desc(...)` intelligence tag. When the scene has imported parts to edit, an EDIT OPS reference and this scene's real selectors are injected too. That block only appears when there are parts to edit, to save context. Large scenes fall back to a compact JSON summary.

---

## JS Shell

The shell is the **SHELL tab** in the right sidebar (toggle with **View, JS Shell**). Type JavaScript directly or use the AI input row.

| Key / Input | Action |
|-------------|--------|
| `Enter` | Execute |
| `Shift+Enter` | New line |
| `Up` / `Down` | Command history |
| AI input + `Enter` | Generate and run code |
| AI input `? question` | Ask about the scene. Plain-text answer, no code |

### Code Editor Integration (Monaco)

AI-generated code is displayed in **Monaco Editor** code blocks with live syntax highlighting and auto-height (max 40vh). Each code block includes:

- **Monaco Editor** — auto-height based on content, word-wrapped, no line numbers, full JavaScript syntax highlighting
- **Run button** (top-right) — executes only the edited code in the Monaco editor
- **Auto-disposal** — editor is disposed immediately after execution, removing it from the output
- **Edit capability** — modify the generated code before running

**Execution flow:** AI generates code → code block with Monaco editor appears → edit if needed → click Run → code executes with full access to shell scope → editor is disposed

**Important:** Only the code visible in the Monaco editor is executed. Any text outside the editor is display-only. The execution binding and scope remain identical to manual shell input.

### Core globals

```js
editor THREE scene camera renderer

// Commands (all go through the undo stack)
AddObjectCommand RemoveObjectCommand
SetPositionCommand SetRotationCommand SetScaleCommand
SetMaterialColorCommand SetMaterialCommand SetValueCommand

// Primitives + organic geometry (no THREE. prefix)
BoxGeometry SphereGeometry CylinderGeometry ConeGeometry PlaneGeometry
TorusGeometry TorusKnotGeometry CircleGeometry CapsuleGeometry
LatheGeometry TubeGeometry ExtrudeGeometry ShapeGeometry Shape CatmullRomCurve3

// Materials (incl. PBR)
MeshStandardMaterial MeshPhysicalMaterial MeshBasicMaterial
MeshPhongMaterial MeshLambertMaterial LineBasicMaterial

Mesh Group Line Points
DirectionalLight PointLight AmbientLight SpotLight
Color Vector3 Vector2 Euler Quaternion

// Keyframe animation
AnimationClip VectorKeyframeTrack QuaternionKeyframeTrack
NumberKeyframeTrack ColorKeyframeTrack
addClip(object, clip)   // register a clip on object (or scene). Shows in Animations tab, playable
```

### Part editing and addressing

```js
listSelectors()                     // the real addressable parts in this scene, with counts
$S('.rims').recolor('#111')         // chainable op set ($S, op, ops). Aliases: Pick, pick
$S('.chair').scale(0.5)             // "Chair 1", "Chair 2", … all share .chair
op({type:'scale', selector:'.cab', factor:1.5})
relabel('wheel')  tagClass('wheel')  untagClass(node,'rims')  verifyImport()
```

### Object lookup

```js
findObject('green cube')   // best match by NAME + material name + color + geometry type
findAll('box')             // every matching object
findOfType('Mesh')         // first object of a three.js type
findNear(mesh, radius)     // objects within radius world-units
```

`findObject` is word-scored. It resolves descriptive queries even when the name is unhelpful. `findObject('red sphere')` matches an unnamed red `SphereGeometry` mesh via material color and geometry type. It also indexes material names and decodes glTF `_0XX_` escapes, so `findObject('tail light')` finds a part whose material is `Tail_032Light`.

### Spatial helpers (world-space, via `Box3`)

```js
getSize(obj)               // {x,y,z} bounding box dimensions (geometry x scale)
getTopY(obj)               // world Y of the top face
getCenter(obj)             // world-space bounding box centre
placeOnTop(child, target)  // sets child.position.y to rest on top of target
lineFromPoints(pts, color) // a Line through pts. Hides the BufferGeometry plumbing
```

### Scene intelligence (descriptive part resolution)

```js
findByDescription('the right arm of the red person')  // node (or null)
describeObject(obj)        // {region, shape, color, sizeRank, pair, ...}
listCandidates('the two wheels at the back')          // ranked candidates
resolvePartAI('the flat panel on top')                // async: rule match + LLM disambiguation
```

### Modeling ops (undoable, AI-callable)

```js
booleanUnion(a, b, keepInputs=false)      booleanSubtract(a, b, keepInputs=false)
booleanIntersect(a, b, keepInputs=false)  // three-bvh-csg
mirrorMesh(mesh, axis='x')                arrayDuplicate(mesh, count, dx, dy, dz)
subdivide(mesh, iterations=1)             listOps()   // print registered op schema
```

### Edit Mode ops

Enter with the **Edit** toolbar button or `enterEditMode()`. `Tab` or `Esc` toggles/exits. Keys: `1/2/3` for vertex/edge/face, `A` for select all/none. With a sub-object selected, drag the transform gizmo to move it (translate/rotate/scale) — the mesh itself stays put.

```js
enterEditMode()  exitEditMode()
extrude(distance=1)  inset(amount=0.2)  bevel(amount=0.1)
deleteFaces()  weld(threshold=0.01)
planarUV(axis='y')  boxUV()
selectFaces(...ids)  selectVertices(...ids)  selectEdges(...ids)
```

### Agentic grounding tools

```js
findAPI('set material color')   // retrieve the REAL signatures for an intent
whatsVisible()                  // GPU color-pick: visible objects ranked by screen area
whatsAt(400, 300)               // GPU color-pick: object under a viewport pixel
```

### Codegen and Q&A

```js
showJS(obj?)   objectToJS(obj)   sceneToJS()   sceneEqual(a, b)   summarize()
askScene('which object is tallest?')      // plain-text answer
makeCheckerTex(512, 0x222, 0xccc, 16)     makeGridTex(512, 0x0f8, 12)   makeTexture(fn, size)
```

### Third-party APIs (console)

`fetchAPI(url, options?)` calls any HTTP API and returns the parsed body (JSON to object, otherwise text). A plain-object `body` is auto-JSON-encoded. Await it from the shell:

```js
// GET, then build a scene from live data
const items = await fetchAPI('https://api.example.com/products');
items.forEach((it, i) => {
  const m = new Mesh(new BoxGeometry(1,1,1), new MeshStandardMaterial({ color: it.color }));
  m.name = it.name; m.position.set(i * 1.5, 0.5, 0);
  editor.execute(new AddObjectCommand(editor, m));
});
```

> **Sovereignty note.** `fetchAPI` is one of two helpers that leave the device (git sync is the other). The request hits the network and the target must allow CORS. Everything else (inference, scene state, intelligence) stays on-device. Keep API keys in a variable you control. Do not hard-code secrets into saved scenes, since they would be committed via git.

---

## Modeling and Edit Mode (the manual layer)

These are the manual-editing tools, secondary to selector editing.

A topology-aware half-edge mesh editor is layered on top of `BufferGeometry`.

- **Enter.** Select a Mesh, then the **Edit** toolbar button (or `enterEditMode()`). The mesh is converted to a half-edge `EditableMesh`. A colored overlay shows vertices, edges, and selected faces.
- **Select.** Click in the viewport in vertex, edge, or face mode (`1`/`2`/`3`). Face picks a triangle. Vertex picks the nearest corner. Edge picks the nearest edge.
- **Move.** With a selection, drag the transform gizmo (translate/rotate/scale) to move those vertices — parked at the selection centroid. The mesh transform is untouched, so only the sub-object moves; the drop bakes one undoable `SetGeometryCommand`.
- **Operate.** `extrude`, `inset`, `bevel`, `deleteFaces`, `weld`, `planarUV`, `boxUV`. Each op emits a `SetGeometryCommand` (undoable).
- **Exit.** `Tab` or `Esc` bakes the half-edge structure back to `BufferGeometry`. The round-trip is lossless for supported geometry.

### Parametric recipe (non-destructive history)

When you edit a primitive, the mesh records a recipe in `userData.recipe`:

```js
[ { op:'primitive', type:'BoxGeometry', args:[1,1,1] },
  { op:'extrude', params:{distance:2}, selection:{mode:'face', ids:[3]} },
  { op:'bevel',   params:{amount:0.1} } ]
```

`objectToJS()` replays the recipe instead of dumping raw vertices:

```js
var mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat);
enterEditMode(mesh); selectFaces(3); extrude(2); bevel(0.1); exitEditMode();
```

Readable, replayable, and git-diffable ("added: bevel" vs "400 floats changed"). Boolean and mirror results carry a provenance recipe comment. Truly non-reconstructable geometry falls back to a flagged JSON load (`result.lossy`).

---

## AI models, tiers, and eval

Select a model from the shell header and click **Load AI**. Weights download once and cache in browser storage.

### Browser-based models (WebLLM)

| Label | Model ID | Size | Notes |
|-------|----------|------|-------|
| **Default** | `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` | ~1 GB | Fast. Best for structural and edit work |
| **Power** | `Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC` | ~4.5 GB | Best at decomposition. Needs 8 GB+ VRAM |
| **Lite** | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | ~900 MB | Weak. Integrated GPUs only |

### External API models (Dev Mode)

Enable with `DEV=1 node server.js` to add current Ollama, OpenAI, and Claude models.

| Provider | Setup | Notes |
|----------|-------|-------|
| **Ollama** | `ollama serve` in another terminal | Local. No API key needed |
| **OpenAI** | `export OPENAI_API_KEY="sk-..."` | Cloud. Strong for raw-code fallback |
| **Anthropic** | `export ANTHROPIC_API_KEY="sk-ant-..."` | Cloud. Strong for complex decomposition |

External models appear in the dropdown below the WebLLM models. On load the engine requests a **16384-token** context window (overriding the 4096 default). 8192 proved too tight: a labeled ~30-part asset's system prompt + injected selector block + scene summary already reaches ~8.4k tokens, so a small on-device model would overflow before emitting a single op. 16384 clears the headroom (Qwen2.5-Coder natively supports 32k). It falls back to 4096 if the compiled model rejects the larger window.

### Client-side API models (no server)

The dropdown also supports calling a provider **directly from the browser**, with no `server.js` proxy. This is useful on static hosting such as GitHub Pages. It coexists with Dev Mode. Use whichever you prefer.

Click **⚙ API** in the shell header to open a 3-step wizard:

1. **Choose provider.** OpenAI, Anthropic (Claude), Ollama (local), or a custom OpenAI-compatible endpoint. Adjust the base URL and set an optional label.
2. **API key.** Paste the key. It is optional for local Ollama.
3. **Choose model.** The list is fetched live from the provider's `/models` endpoint. You only pick model IDs the key can actually use. A `Custom…` option lets you type an ID if fetching is unavailable.

Saved providers appear under a `─── Client APIs (browser) ───` separator in the model dropdown; select one and click **Load AI**.

**Trade-off (less sovereign):** keys are stored in `localStorage`, readable by same-origin scripts, like the git token. Requests leave the device straight to the provider. On-device WebLLM remains the default. Providers must allow browser CORS. OpenAI and Ollama do. Anthropic requires the `anthropic-dangerous-direct-browser-access` header, sent automatically.

### The eval matrix (the editing gate, NOT yet run)

This is the most important honesty note in this README. **The 5 fuzzy tasks are implemented but not yet measured.**

The validation for the editing pivot is an eval matrix: per-task, per-model-size, per-scaffolding condition, plus a cloud-model ceiling. The harness exists. Run it with:

```js
await evalEditMatrix('scaffolded')   // then 'bare'. Load each model size, add Haiku for the ceiling
```

`evalEditMatrix` scores each of the 5 tasks independently from one generated edit. Selector resolution is scored as resolved-correct-node: the right nodes changed, and only those. The harness uses synthetic assets and is non-destructive (it snapshots and restores your scene).

**Execution flow with Monaco editors:**

When `evalEditMatrix` generates edit code:
1. AI generates op-JSON (e.g., `$S('.wheels').recolor('#000')`)
2. Code appears in a **Monaco editor block** with a Run button
3. Running executes **only the code in the editor** through the standard `execute()` binding
4. Scene state is captured before and after to measure correctness
5. Editor is disposed after execution

**The full matrix run is the gate that has not yet been completed.** It is what confirms the zero-training claim and sets the model size to ship. Until it runs, treat the 5 tasks as built, not validated. The current "scaffolded" condition means selector injection is on. Constrained decoding is not yet wired.

**Live spot-checks (not the matrix).** Two manual runs of "make the leaves red" on a labeled tree GLB confirm the op-path steering end to end: both Claude Haiku 4.5 (cloud) and the **1.5B on-device model** emit the op surface (`$S('.leaves').recolor('#ff0000')`) with the correct narrow selector, not raw three.js and not the whole asset. The 1.5B occasionally wraps the op in a function it forgets to invoke (a format slip our few-shots' IIFE style invites), which the observe-and-retry loop catches. These are anecdotes that motivate the harness, not a substitute for it.

### The generation eval (legacy axis): `evalAI()`

`evalAI()` is the older generation-scaffolding eval. It runs a standing prompt set through the agentic loop and prints a 4-axis pass/fail table (struct, spatial, semantic, distinct). It tests the generation task, which is now scaffolding, not the headline. It still tells a useful story about the generation fallback and the model-independent validation layer. It is not the editing eval.

**Monaco editor in eval output:** When code is generated during `evalAI()`, it also appears in Monaco editors with the same Run/dispose behavior, ensuring consistent evaluation workflow across all shell execution paths.

---

## Dev Mode: external APIs

Dev mode enables optional integration with Ollama, OpenAI, and Anthropic Claude. The editor stays sovereign by default (browser-only). Developers can opt into more powerful models when needed.

### Setup

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

---

## Architecture

```
server.js              Static file server + API proxy (dev mode)
  /api/models          List WebLLM + external models (Ollama, OpenAI, Claude)
  /api/chat            Proxy requests to external LLMs
  /api/health          Check service availability

docs/editor/js/
  AIEngine.js          WebLLM wrapper: init() (8192-window override+fallback), stream(), complete(), interrupt()
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

---

## Design principles

These state the thesis. They come first conceptually.

- **Deterministic shell, small fuzzy core.** The shell is host code: selector matching, command execution, undo, versioning, normalization, guards. The model handles 5 fuzzy tasks: op-type selection, selector resolution, argument extraction, labeling, multi-op decomposition. Everything else is deterministic. If a feature seems to need more model reasoning, decompose it.
- **Model expresses intent. Host enforces correctness.** The model emits a selector plus an op. Guards (clone-on-write, texture-tint, merged-mesh, ground/clamp, subset-sanity) and arg-normalization ("black" to `#111`) are host-side. The model never has to remember them.
- **Resolution is deterministic.** Selectors match over verified labels and auto-classes. The model only translates fuzzy language to a selector. Once labeled, resolution needs no model.
- **One execution surface.** AI and human code run through the same `execute()` binding.
- **Sovereign by default.** Inference is on-device. Nothing leaves except by explicit user action (git, `fetchAPI`).
- **No new model.** Scene intelligence uses deterministic math, the renderer, and the already-loaded code LLM only.
- **No build step.** Plain ES modules. No bundler.
- **Everything reversible.** All mutations go through `editor.execute(new Command())`.
- **Validate by shape, not by flag.** three.js objects are checked by shape (tracks plus duration), never by an `isX` flag it may omit.
- **Never silently wrong.** Lossy codegen, ambiguous resolution, and merged-mesh GLBs are flagged, not guessed. Implemented is not the same as validated, and this README says which is which.

---

## Prior art

Selector-over-scene-graph exists (three-query-selector, scene.querySelectorAll, Unity-Scene-Query). NL grounding over 3D scene graphs exists (Cypher-for-3DSG, BBQ, FreeQ-Graph). Strata's synthesis is the new part: descriptor-derived classes, user-verified labels, selectors as the editing and versioning substrate, sovereign and zero-training. This is positioned as an extension, not an invention.

---

## Roadmap

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
  Local three.js API RAG, 8192-token window, Stop-AI button
  Generation eval harness (evalAI, 4-axis, overfit canaries), two-tier routing
  Keyframe animation: tab authoring + AI clip authoring
  Selector-based editing: CSS-subset selector engine + auto-classes, op-JSON (op/ops/$S),
    host guards, command-backed animation recipes, op vocab + live selectors fed to the model
  Verify-edit primitives: relabel / tagClass / untagClass (command-backed), Import + Verify panel
  Eval matrix HARNESS: 5 tasks x model x {bare, scaffolded}, resolved-correct-node scoring
  glTF / GLB / USDZ / OBJ export (GLTFExporter + optimized animations)
  Name-stem auto-classes: "Chair 1"/"Chair 2" share .chair so plural selectors resolve
  Selector picker is $S (aliases Pick, pick); the old $$ name was removed

NEXT (the gate)
  Run the eval matrix across model sizes + a Haiku ceiling. Make the size decision.
    This confirms the zero-training claim. It is the publication evidence

THEN
  Constrained decoding (JSON-schema-restricted output) as a scaffolding lever for small models
  Import + Verify UX: in-viewport part highlight, lazy label-on-first-reference
  Renderer-agnostic export PIPELINE: label-through-extras survival + Blender / UE / any-renderer handoff
    (glTF export + animations already work; auto-classes don't yet serialize, path untested end-to-end)
  Distributed WebGL render to 2D video (the iteration render pipeline)
  BVH import (skeletal motion as imported data) + blendshape / facemesh performance
  Capture-pipeline integration: body mocap + face record to Strata (sovereign capture -> author -> render)
  Sovereignty dashboard: live green / orange / red disclosure of outbound paths
  Scene-wide timeline: objects + camera + captured performance on one axis
  Optional vision layer (precise nouns, OCR). Separate spec, needs a model
  Packaging: one PWA, with an optional Electron desktop wrapper
```
