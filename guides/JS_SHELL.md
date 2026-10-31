# JS Shell (the primary interface)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [Animation](ANIMATION.md) · [Scene intelligence](SCENE_INTELLIGENCE.md) · [AI guide](AI_GUIDE.md)

The shell is the **SHELL tab** in the right sidebar (toggle with **View, JS Shell**). It is the primary editing surface. Type JavaScript directly to edit manually. Optionally use the AI input row to generate code.

**The AI is optional and nothing is downloaded until you ask for it.** Everything on this page works by typing JavaScript, with no model loaded. The first time you open the tab, a hint line says so; the JS input's placeholder reads "Type JavaScript, no AI needed (try help)". **Load AI** is the only thing that downloads: the default on-device model is about **1.8 GB** (the exact size of the selected model is shown in the hint, in the button's tooltip, and in a confirmation before the first download; the browser keeps it afterwards, so a model you have already loaded does not ask again). Choosing a cloud / Ollama API model downloads nothing.

**`help()`** prints the main commands, grouped. **`help('shader')`**, `help('mtoon')`, `help('toon')`, `help('unshader')`, `help('shaders')` and `help('fresnel')` (any shader id) print one command's signature, return value and parameter table. That text is generated from the shader registry, so it cannot drift from the code ([SHADERS.md](SHADERS.md)).

| Key / Input | Action |
|-------------|--------|
| `Enter` | Execute |
| `Shift+Enter` | New line |
| `Up` / `Down` | Command history |
| `Tab` | Accept the highlighted completion (on an empty line: the first starter) |
| `Esc` | Close the completion list |
| AI input + `Enter` | (Optional) Generate and run code |
| AI input `? question` | (Optional) Ask about the scene. Plain-text answer, no code |

## Completion (no AI, no network)

The input completes as you type, from what is actually there rather than from a fixed word list. `Tab` or `Enter` accepts the highlighted item, `Up`/`Down` move, `Esc` closes. The code is [`shellComplete.js`](../docs/editor/js/shellComplete.js) (pure functions, tested in node by [`shellComplete.test.mjs`](../docs/editor/js/__tests__/shellComplete.test.mjs)); [`Shell.js`](../docs/editor/js/Shell.js) draws it.

| Where the cursor is | What is offered |
|---|---|
| **An empty line** | *Starters*, in groups: for the **selected object**, commands that suit it (`SEG.describe('#Mesh')` for a textured mesh, `SEG.preview('#Group')` for a segmented one, then `recolor`, `scale`, `spin`, `isolate`, its `children()`); **In this scene**, the classes the author wrote on objects (or the top-level names), most used first; **Recent**, your last distinct one-line commands; **Explore**: `listSelectors()`, `lint()`, `help`. An empty scene is offered a light and a box instead. Nothing is selected until you press `Tab` (the first starter) or arrow down. A starter with a gap (`recolor('')`) puts the caret inside the quotes and goes on to offer the values |
| **A word** | Fuzzy matches across every global the shell really has (read from its scope, so a new one needs no second list): a prefix first, then **initials** (`mt` finds `moveTo`, `apc` finds `Avocado_Pit_Cavity`), then a substring, then letters in order. Words you type often in your own history rank first among equals. Accepting a function adds `(` and shows its signature |
| **After `name.`** | The members of the real object, read from it without calling any getter: `SEG.` (with signatures), `Math.`, `THREE.`, `editor.`, `editor.scene.` and so on, with each method's parameters and each property's type |
| **After `$S(...).`** | The chainable methods, fuzzy, with signatures |
| **Inside a call** | The **signature** of the call you are in, pinned at the top of the list (`SEG.split(selector, { group, classes, source: {…}, parts: […] })`, `scale(factor, axis?)`), whichever argument you are on |
| **Inside a selector string** (`$S('`, `isolate('`, `SEG.describe('`, …) | The scene's own selectors: classes, ids, types, **and the names of its objects** (`#Duck_Beak`), with how many each reaches |
| **Inside a string with fixed values** | The values: colours for `recolor('`, `x`/`y`/`z` for `spin('`, light kinds for `addLight('`, move kinds for `cameraMove('` |
| **After an operator** (`=`, `+`, …) | Nothing, so the list is not noise |

## Code Editor Integration (Monaco)

AI-generated code is displayed in **Monaco Editor** code blocks with live syntax highlighting and auto-height (max 40vh). Each code block includes:

- **Monaco Editor**: auto-height based on content, word-wrapped, no line numbers, full JavaScript syntax highlighting
- **Run button** (top-right): executes only the edited code in the Monaco editor
- **Auto-disposal**: editor is disposed immediately after execution, removing it from the output
- **Edit capability**: modify the generated code before running

**Execution flow:** AI generates code → code block with Monaco editor appears → edit if needed → click Run → code executes with full access to shell scope → editor is disposed

**Important:** Only the code visible in the Monaco editor is executed. Any text outside the editor is display-only. The execution binding and scope remain identical to manual shell input.

### Command history and copy (works with or without AI)

In the JS Shell, every executed command has a **copy icon (⎘)** in the top-right corner:

- **Click the icon:** Copies the command to clipboard and auto-populates the shell input
- **Checkmark (✓):** Visual feedback that the copy succeeded
- **Focus shift:** After successful copy, focus automatically moves to the shell input so you can press arrow keys to navigate history or immediately execute

This simplifies re-running complex commands and debugging, whether you're editing manually or reviewing AI-generated code.

## Core globals

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

## Part editing and addressing

```js
listSelectors()                     // the real addressable parts in this scene, with counts
$S('.rims').recolor('#111')         // chainable op set ($S, op, ops). Aliases: Pick, pick
$S('.chair').scale(0.5)             // "Chair 1", "Chair 2", … all share .chair
op({type:'scale', selector:'.cab', factor:1.5})
relabel('wheel')  tagClass('wheel')  untagClass(node,'rims')  verifyImport()
```

The full selector reference (grammar, the `$S()` query/traversal API, class & id authoring, lasso, and guards) lives in [LANGUAGE.md](LANGUAGE.md).

## Object lookup

```js
findObject('green cube')   // best match by NAME + material name + color + geometry type
findAll('box')             // every matching object
findOfType('Mesh')         // first object of a three.js type
findNear(mesh, radius)     // objects within radius world-units
```

`findObject` is word-scored. It resolves descriptive queries even when the name is unhelpful. `findObject('red sphere')` matches an unnamed red `SphereGeometry` mesh via material color and geometry type. It also indexes material names and decodes glTF `_0XX_` escapes, so `findObject('tail light')` finds a part whose material is `Tail_032Light`.

## Cutting a mesh into named parts (`SEG`)

```js
SEG.describe('#Duck_mesh')             // one line per UV island: triangles, size, centre across the mesh, main colours (on a scene: per component, in the world frame)
SEG.source(rawUrl, { licence, attribution }).then( s => { window.src = s } )   // fetch the original file and hash it: the pinned source block a plan needs
SEG.split('#Duck_mesh', { group, classes, source: window.src, parts: [ { island: 0, name, classes }, { island: [6, 8], name, classes },
                          { island: 2, subdivide: 4, palette: [ { name, classes, color: [r,g,b] }, … ] } ] })
SEG.components('#room')  /  SEG.attach('#room', anchors, opts)   // a scene: the pieces, and where the unnamed ones would go; SEG.split takes anchors: […]
SEG.byMaterial('#mesh', { group, source })   // a mesh with several materials: one part per material
SEG.replay('#mesh', record)                  // cut again from the plan the asset recorded
SEG.wouldRefuse('#mesh', plan?)              // null, or { reason, detail, seg_version }: would SEG refuse this? changes nothing
SEG.preview('#Duck')  /  SEG.restore()       // a flat colour per part, to check the cut, and back
subtitles()  /  setSubtitles([{ id, start, end, text }])  /  importSrt(text)  /  exportSrt()   // the scene's cues; an import keeps the ids of the cues it is an edit of
setCueId('cue-y0quet1', 'intro-question')  /  nameCues()   // a cue's id is its name in captions.vtt and in a player link (&cue=<id>): guides/CAPTIONS.md
asRecord()  /  checkRecord()  /  recordView()   // keep the scene as a dataset record: saved without camera, controls, renderer settings or history; what CI would say
asRecord(true, { packaging: 'plan', parents: true })   // plan: save the labels and the plan, regenerate the geometry from the hashed source on open; parents: keep them (off by default)
recordStatus()                               // per segmented group: ready (from cache or network), or unavailable and why
exportGLB({ acknowledged: true })            // a source with no licence, or a proprietary one, is refused until you say you know; the file carries the licence in asset.copyright
```

A one-piece textured model becomes named, classed meshes in one group (one undo step); every island must go to exactly one part, and the asset keeps the plan, the report it was made from, and the source (the exact file, pinned to a commit and hashed), licence and modifications (`source` is required), and a verification block that starts `seeded`. Cuts skinned meshes too (every part keeps the original skeleton and its clips; `subdivide` is refused on them), and refuses several materials (use `SEG.byMaterial`) and morph targets. The Shell has no top-level `await`; a promise (like `SEG.source`'s) shows its result when it settles. Full reference, limits and examples in [MESH_SEGMENT.md](MESH_SEGMENT.md).

## Spatial helpers (world-space, via `Box3`)

```js
getSize(obj)               // {x,y,z} bounding box dimensions (geometry x scale)
getTopY(obj)               // world Y of the top face
getCenter(obj)             // world-space bounding box centre
placeOnTop(child, target)  // sets child.position.y to rest on top of target
lineFromPoints(pts, color) // a Line through pts. Hides the BufferGeometry plumbing
```

## Scene intelligence (descriptive part resolution)

```js
findByDescription('the right arm of the red person')  // node (or null)
describeObject(obj)        // {region, shape, color, sizeRank, pair, ...}
listCandidates('the two wheels at the back')          // ranked candidates
resolvePartAI('the flat panel on top')                // async: rule match + LLM disambiguation
```

Details in [SCENE_INTELLIGENCE.md](SCENE_INTELLIGENCE.md).

## Modeling ops (undoable, AI-callable)

```js
booleanUnion(a, b, keepInputs=false)      booleanSubtract(a, b, keepInputs=false)
booleanIntersect(a, b, keepInputs=false)  // three-bvh-csg
mirrorMesh(mesh, axis='x')                arrayDuplicate(mesh, count, dx, dy, dz)
subdivide(mesh, iterations=1)             listOps()   // print registered op schema
```

## Scene & UI-to-shell parity

Everything doable in the panels is callable from the shell. Graph mutations go through Commands
(undoable); scene-environment changes dispatch the **same signals** the Scene panel does, so the
shell and the UI stay in lock-step.

```js
// ── Lights (AddObjectCommand; returns a chainable $S set) ──
addLight('directional', { color:'#fff', intensity:1, position:[5,10,7.5] })
addLight('point', { intensity:2, distance:20, decay:2, position:[0,3,0] })
addLight('spot',  { angle:Math.PI/6, penumbra:0.3 })   // angle in RADIANS
addLight('ambient', { intensity:0.4 })
addLight('hemisphere', { color:'#bde', groundColor:'#334', intensity:0.6 })

// ── Scene environment (mirrors the Scene panel) ──
setBackground('#101014')                 // solid colour background
setFog('Fog', '#cccccc', 1, 100)         // linear fog (near, far)
setFog('FogExp2', '#cccccc', 0, 0, 0.02) // exponential fog (density)
clearFog()
setEnvironment('Default')                // 'Default' | 'Equirectangular' | 'None'

// ── Group / ungroup (Edit-menu twins, undoable) ──
groupSelection()                         // group the current selection
groupSelection('.wheel', 'wheels')       // or group everything a selector matches
ungroupSelection()                       // ungroup the selected group

// ── Isolate / solo (undoable visibility batch) ──
isolate('.engine')                       // show only the engine subtree
soloClass('wheel')                       // shorthand for isolate('.wheel')
showAll()                                // undo an isolate

// ── History + exporters (File-menu twins) ──
undo()  redo()  clearScene()
exportGLB()  exportGLTF()  exportOBJ()  exportSTL()  exportPLY()   // selection, else whole scene; the file is named after the selection, the scene's file, or what is in it (Duck_Beak.glb, duck.glb), not scene.glb
```

### Parity table: UI action → shell call

| UI action | Shell / `$S` | Undoable |
|---|---|---|
| Move / rotate / scale gizmo | `$S(sel).move/rotate/scale`, `.moveTo/.rotateTo/.scaleTo`, `.position/.rotation/.scale/.quaternion` (`.move` keeps objects at y ≥ 0; `.moveTo` places exactly, including below zero; `.scale` multiplies, `.scaleTo` sets) | ✓ |
| Inspector: material colour | `$S(sel).recolor(color)` / `.emissive(color)` | ✓ |
| Inspector: metalness / roughness / emissive intensity / flat shading / side | `$S(sel).metalness/.roughness/.emissiveIntensity/.flatShading/.doubleSided` | ✓ |
| Inspector: opacity / visibility / wireframe | `$S(sel).setOpacity/.setVisible/.show/.hide/.wireframe` | ✓ |
| Inspector: cast / receive shadow, frustum culled, render order | `$S(sel).castShadow/.receiveShadow/.frustumCulled/.renderOrder` | ✓ |
| Inspector (light): intensity / colour / distance / angle / penumbra / decay / ground colour | `$S(sel).intensity/.lightColor/.distance/.angle/.penumbra/.decay/.groundColor` | ✓ |
| Inspector (camera): fov / near / far | `$S('camera').fov/.near/.far` | ✓ |
| Add light | `addLight(type, opts)` | ✓ |
| Properties: Shader tab (any shader on any object, incl. MToon) | `shader(target, id, params)` / `mtoon(target, spec)` / `toon(target, spec)` / `unshader(target)` / `shaders()`; all return `{ id, params, meshes, materials }`, take nested or flat MToon specs, and are explained by `help('shader')` (see [SHADERS.md](SHADERS.md)) | ✓ |
| Animations tab / viewport: camera keys (add, drag a handle or aim, fov, time, delete, smooth, simplify, copy as command) | `$S('#cam').keys/.keyAt/.keyFromView/.moveKey/.deleteKey/.smooth/.simplify/.simplifyPreview/.setKeys/.asCommand/.selectKey` (see [CAMERA_PATHS.md](CAMERA_PATHS.md)) | ✓ |
| Camera tools: Simplify all cameras | `simplifyCameras({ preset: 'normal', keepBeats: true })`, one undo step; add `dryRun: true` to preview (see [CAMERA_PATHS.md](CAMERA_PATHS.md#simplifying-dense-moves)) | ✓ |
| Scene: background / fog / environment | `setBackground` / `setFog` / `clearFog` / `setEnvironment` | signal (as UI) |
| Edit: group / ungroup | `groupSelection` / `ungroupSelection` | ✓ |
| Outliner: hide others / show | `isolate` / `soloClass` / `showAll` | ✓ |
| Add / delete object | `AddObjectCommand` / `$S(sel).delete()` / `duplicate` | ✓ |
| Class / id / label authoring | `$S(sel).addClass/.removeClass/.toggleClass/.editID`, `relabel` / `tagClass` | ✓ |
| Modeling (boolean, mirror, array, subdivide) | `booleanUnion/…`, `mirrorMesh`, `arrayDuplicate`, `subdivide` | ✓ |
| Edit Mode (extrude, inset, bevel, weld, UV) | `enterEditMode()` + `extrude/inset/bevel/weld/planarUV/boxUV` | ✓ |
| Undo / redo / clear | `undo()` / `redo()` / `clearScene()` | none |
| Export (GLB/GLTF/OBJ/STL/PLY) | `exportGLB/exportGLTF/exportOBJ/exportSTL/exportPLY` | n/a |

## Edit Mode ops

Enter with the **Edit** toolbar button or `enterEditMode()`. `Tab` or `Esc` toggles/exits. Keys: `1/2/3` for vertex/edge/face, `A` for select all/none. With a sub-object selected, drag the transform gizmo to move it (translate/rotate/scale). The mesh itself stays put.

```js
enterEditMode()  exitEditMode()
extrude(distance=1)  inset(amount=0.2)  bevel(amount=0.1)
deleteFaces()  weld(threshold=0.01)
planarUV(axis='y')  boxUV()
selectFaces(...ids)  selectVertices(...ids)  selectEdges(...ids)
```

The mesh-editing layer is documented in depth in
[MESH_EDITING_QUICK_START.md](MESH_EDITING_QUICK_START.md),
[MESH_EDITING_GUIDE.md](MESH_EDITING_GUIDE.md), and
[MESH_EDITING_TECHNICAL.md](MESH_EDITING_TECHNICAL.md).

## Agentic grounding tools

```js
findAPI('set material color')   // retrieve the REAL signatures for an intent
whatsVisible()                  // GPU color-pick: visible objects ranked by screen area
whatsAt(400, 300)               // GPU color-pick: object under a viewport pixel
```

## Codegen and Q&A

```js
showJS(obj?)   objectToJS(obj)   sceneToJS()   sceneEqual(a, b)   summarize()
askScene('which object is tallest?')      // plain-text answer
makeCheckerTex(512, 0x222, 0xccc, 16)     makeGridTex(512, 0x0f8, 12)   makeTexture(fn, size)
```

## Third-party APIs (console)

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
- **Move.** With a selection, drag the transform gizmo (translate/rotate/scale) to move those vertices, parked at the selection centroid. The mesh transform is untouched, so only the sub-object moves; the drop bakes one undoable `SetGeometryCommand`.
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

**Next:** [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md) · [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
