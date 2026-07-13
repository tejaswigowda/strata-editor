# JS Shell (the primary interface)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [Animation](ANIMATION.md) · [Scene intelligence](SCENE_INTELLIGENCE.md) · [AI guide](AI_GUIDE.md)

The shell is the **SHELL tab** in the right sidebar (toggle with **View, JS Shell**). It is the primary editing surface. Type JavaScript directly to edit manually. Optionally use the AI input row to generate code.

| Key / Input | Action |
|-------------|--------|
| `Enter` | Execute |
| `Shift+Enter` | New line |
| `Up` / `Down` | Command history |
| AI input + `Enter` | (Optional) Generate and run code |
| AI input `? question` | (Optional) Ask about the scene. Plain-text answer, no code |

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
exportGLB()  exportGLTF()  exportOBJ()  exportSTL()  exportPLY()   // selection, else whole scene
```

### Parity table: UI action → shell call

| UI action | Shell / `$S` | Undoable |
|---|---|---|
| Move / rotate / scale gizmo | `$S(sel).move/rotate/scale`, `.moveTo/.rotateTo/.scaleTo`, `.position/.rotation/.scale/.quaternion` | ✓ |
| Inspector: material colour | `$S(sel).recolor(color)` / `.emissive(color)` | ✓ |
| Inspector: metalness / roughness / emissive intensity / flat shading / side | `$S(sel).metalness/.roughness/.emissiveIntensity/.flatShading/.doubleSided` | ✓ |
| Inspector: opacity / visibility / wireframe | `$S(sel).setOpacity/.setVisible/.show/.hide/.wireframe` | ✓ |
| Inspector: cast / receive shadow, frustum culled, render order | `$S(sel).castShadow/.receiveShadow/.frustumCulled/.renderOrder` | ✓ |
| Inspector (light): intensity / colour / distance / angle / penumbra / decay / ground colour | `$S(sel).intensity/.lightColor/.distance/.angle/.penumbra/.decay/.groundColor` | ✓ |
| Inspector (camera): fov / near / far | `$S('camera').fov/.near/.far` | ✓ |
| Add light | `addLight(type, opts)` | ✓ |
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
