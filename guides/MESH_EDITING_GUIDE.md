# Mesh Editing Implementation Guide

> Part of the [Strata documentation](../README.md#documentation). Mesh editing set: [Quick start](MESH_EDITING_QUICK_START.md) · **Guide** (this page, incl. status and handover notes) · [Technical](MESH_EDITING_TECHNICAL.md) · [Roadmap](ROADMAP.md)

This document describes the mesh editing layer that has been implemented according to the Handover Spec. The milestone status, limits, troubleshooting and developer checklist that used to live in `IMPLEMENTATION_STATUS.md` are in [Status and handover notes](#status-and-handover-notes) at the end.

## Architecture Overview

The mesh editing system uses a **dual representation** pattern:

```
Editing Interface:
  ↓
EditableMesh (half-edge structure)  ← topology-aware representation
  ↓
ToBufferGeometry()  ← conversion on every edit
  ↓
THREE.BufferGeometry  ← render representation
  ↓
THREE.Mesh  ← in editor.scene
```

### Key Components

1. **EditableMesh** (`docs/editor/js/mesh/EditableMesh.js`)
   - Half-edge mesh structure with full topology
   - Methods: `fromBufferGeometry()`, `toBufferGeometry()`, `compact()`
   - Query methods: `faceVertices()`, `faceNormal()`, `faceCenter()`, `edges()`
   - Mutation methods: `addVertex()`, `addFace()`, `removeFace()`

2. **Selection** (`docs/editor/js/mesh/Selection.js`)
   - Vertex, edge, and face selection modes
   - Methods: `setMode()`, `toggle()`, `add()`, `remove()`, `selectAll()`, `clear()`
   - Property: `count` (number of selected elements)

3. **EditModeController** (`docs/editor/js/mesh/EditModeController.js`)
   - Manages enter/exit of edit mode
   - Handles keyboard shortcuts (Tab, 1/2/3, A)
   - Visual overlay for vertices, edges, faces
   - Raycasting for sub-object picking
   - Method: `runOp(fn, opName, params)` for undoable operations

4. **Operation Registry** (`docs/editor/js/mesh/ops/index.js`)
   - Central registry for all modeling operations
   - Each op has: name, description, params, example
   - Functions: `registerOp()`, `listOps()`, `serializeForAI()`

## Implemented Operations

### M1: Boolean Operations (via three-bvh-csg)
- `booleanUnion(meshA, meshB, keepInputs=true)`
- `booleanSubtract(meshA, meshB, keepInputs=true)`
- `booleanIntersect(meshA, meshB, keepInputs=true)`

**Usage in AI:**
```javascript
const prism = new Mesh(new BoxGeometry(1, 2, 1), mat);
const hole = new Mesh(new CylinderGeometry(0.3, 0.3, 3, 6), mat);
hole.position.set(0, 1, 0);
booleanSubtract(prism, hole, false);  // Subtract hole from prism, remove inputs
```

### M2: Transform Operations
- `mirrorMesh(mesh, axis='x')`
- `arrayDuplicate(mesh, count, offsetX=0, offsetY=0, offsetZ=0)`
- `subdivide(mesh, iterations=1)`

**Usage in AI:**
```javascript
const row = arrayDuplicate(box, 5, 1.5, 0, 0);  // 5 copies, spaced 1.5 units apart
mirrorMesh(box, 'x');  // Mirror across X axis
subdivide(mesh, 2);  // Subdivide twice (16x polygons)
```

### M3-M5: Mesh Editing Operations (in Edit Mode)

First, enter edit mode:
```javascript
enterEditMode();  // Edit editor.selected, or pass a mesh
// OR
enterEditMode(mesh);
```

Then use:
- `extrude(distance=1)`: Extrude selected faces along their normal
- `inset(amount=0.2)`: Inset faces toward their center
- `bevel(amount=0.1)`: Chamfer face edges
- `deleteFaces()`: Delete selected faces
- `weld(threshold=0.01)`: Merge nearby vertices
- `planarUV(axis='y')`: Project UVs onto a plane
- `boxUV()`: Box/cubic UV projection
- `soften(iterations=1, factor=0.5)`: Laplacian-smooth selected vertices (or the whole mesh if nothing is selected) toward their neighbor average
- `sculpt(strength=0.2, radius=0.5, falloff='smooth')`: Proportional-falloff brush — push/pull vertices near the selection (or whole mesh) along their smooth normals, fading out over `radius`

Exit edit mode:
```javascript
exitEditMode();  // Bakes geometry back to the mesh
// OR press Tab
```

**Full Edit Workflow Example:**
```javascript
// Create a box
const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
box.name = 'EditableBox';
editor.execute(new AddObjectCommand(editor, box));

// Enter edit mode and modify
enterEditMode(box);
selectTopFaces(1);  // Select topmost face
extrude(2);  // Extrude it upward
selectFacingUp(0.8);  // Select all upward-facing faces
bevel(0.2);  // Bevel their edges
planarUV('y');  // Unwrap UVs
exitEditMode();  // Done!
```

### M6: Selection Criteria (AI-Driven)
- `selectTopFaces(count=1)`: Select N faces with highest Y coordinate
- `selectFacingUp(threshold=0.1)`: Select faces whose normal points mostly upward
- `selectBoundaryEdges()`: Select edges on the mesh boundary (open edges)
- `selectFaces(...ids)`: Select specific face IDs
- `selectVertices(...ids)`: Select specific vertex IDs
- `selectEdges(...ids)`: Select specific edge IDs
- `clearSelection()`: Clear all selections

### M9: Sculpting (Proportional Editing)

`sculpt()` and `soften()` are the two primitives that make organic/freeform shaping
possible without hand-rolling vertex math in the shell (see
[MESH_EDITING_TECHNICAL.md](./MESH_EDITING_TECHNICAL.md#m9-sculpting-primitives)
for why this was needed and how it's implemented):

- **`sculpt(strength, radius, falloff)`** is a soft-select brush: it finds the
  centroid of the current selection (any mode — vertex/edge/face — or the
  whole mesh if nothing is selected) and pushes/pulls every vertex within
  `radius` of that point along its own smooth normal, weighted by distance so
  the effect fades to zero at the edge of the brush instead of cutting off
  sharply. Select a single vertex near the spot you want to shape, then call
  `sculpt()` — no need to select the whole affected region up front.
- **`soften(iterations, factor)`** is Laplacian smoothing: it repeatedly pulls
  each target vertex toward the average position of its neighbors. Use it
  after one or more `sculpt()` calls (or on hand-written vertex displacement)
  to relax steep bumps into smooth-reading curvature — this is what turns a
  faceted-looking blob into an actually smooth surface.

```javascript
enterEditMode(mesh);

// Push a bump up out of the mesh near a specific point
selectVertices(closestVertexIdTo(mesh, [0, 0.05, 0.5]));  // your own lookup helper
sculpt(0.09, 0.2, 'smooth');   // push out
sculpt(-0.05, 0.16);           // negative strength = push in (e.g. an eye socket)

clearSelection();
soften(1, 0.35);   // relax the whole mesh so bumps read as smooth curvature

exitEditMode();
```

## Keyboard Shortcuts (in Edit Mode)

| Key | Action |
|-----|--------|
| **Tab** / **Esc** | Exit edit mode (bakes the geometry back; enter with `enterEditMode()`) |
| **1** | Switch to vertex selection mode |
| **2** | Switch to edge selection mode |
| **3** | Switch to face selection mode |
| **A** | Select all / Deselect all |
| **Click** | Toggle selection of vertex/edge/face under cursor |

## AI Integration

The operation registry is automatically injected into the system prompt. The AI understands:

1. **All global functions** are available without prefixes
2. **Edit mode workflow:**
   - User says "make a rounded hole in the top"
   - AI generates:
     ```javascript
     (function(){
       enterEditMode();
       selectTopFaces(1);
       bevel(0.3);
       deleteFaces();
       exitEditMode();
     })();
     ```

3. **Geometric reasoning:**
   - "extrude the top face up by 3" → `extrude(3)` after `selectTopFaces(1)`
   - "smooth all edges" → `bevel(0.15)` on all faces
   - "add a ring of details around the sides" → `selectBoundaryEdges()` then operations

4. **No invention:** The AI only calls registered operations. If it tries to call an undefined function, the validator catches it and the model retries with a correct implementation.

## Data Persistence

When editing a mesh, a "recipe" is recorded in `mesh.userData.recipe`:

```javascript
mesh.userData.recipe = [
  { op: 'primitive', type: 'BoxGeometry', args: [1, 2, 1] },
  { op: 'extrude', params: { distance: 2 }, selection: { mode: 'face', ids: [12] } },
  { op: 'inset', params: { amount: 0.3 }, selection: { mode: 'face', ids: [14, 15, 16] } },
  // ...
]
```

Recipes can be:
- **Serialized** for storage
- **Replayed** on load (full procedural re-creation)
- **Edited** by updating params

## Performance Characteristics

- **Small meshes** (<10k vertices): Real-time edit mode with visual feedback
- **Medium meshes** (10k-100k): Edit mode works but may lag on large ops
- **Large meshes** (>100k): Use with caution; consider simplification first

Compact() on each operation ensures no memory leaks from deleted faces/vertices.

## Limitations & Future Work

### Current Scope (M1-M6, M9)
✓ Boolean operations  
✓ Mirror, array, subdivide  
✓ Extrude, inset, bevel, delete, weld  
✓ Planar and box UV projection  
✓ Selection by criteria  
✓ Sculpting (proportional soft-select brush + Laplacian smoothing)

### Not Yet Implemented (M7-M8+)
- glTF/OBJ import with edit history
- Loop cut (edge-based subdivision)
- Snapping (grid, vertex, edge, face)
- Numeric entry for precise transforms
- Advanced UV unwrapping (angle-based)
- Morph-target / blend-toward-reference-mesh sculpting
- Physics simulation

## Testing the Implementation

From the shell REPL:

```javascript
// Test M1 (Boolean)
const a = new Mesh(new BoxGeometry(1,1,1), new MeshStandardMaterial());
const b = new Mesh(new SphereGeometry(0.6, 16, 16), new MeshStandardMaterial());
a.name = 'Box'; b.name = 'Sphere';
editor.execute(new AddObjectCommand(editor, a));
editor.execute(new AddObjectCommand(editor, b));
booleanSubtract(a, b, false);  // Carve sphere from box

// Test M3-M5 (Edit Mode)
const mesh = new Mesh(new BoxGeometry(2,2,2), new MeshStandardMaterial());
mesh.name = 'Editable';
editor.execute(new AddObjectCommand(editor, mesh));
enterEditMode(mesh);
selectTopFaces(1);
extrude(2);
selectFacingUp(0.9);
bevel(0.2);
exitEditMode();

// Test M6 (Criteria)
enterEditMode();
selectFacingUp(0.5);  // Select upper-facing faces
inset(0.3);
selectBoundaryEdges();
weld(0.05);
exitEditMode();

// Test M9 (Sculpting)
const ball = new Mesh(new SphereGeometry(0.5, 48, 32), new MeshStandardMaterial());
ball.name = 'Sculptable';
editor.execute(new AddObjectCommand(editor, ball));
enterEditMode(ball);
selectVertices(0);       // any single vertex near where you want to push
sculpt(0.1, 0.2);        // push a smooth bump out around it
clearSelection();
soften(1, 0.4);          // relax the whole mesh so it reads as smooth curvature
exitEditMode();
```

## Error Handling

Operations are wrapped in undoable Commands. If an operation fails:
- The error is caught and reported
- The mesh state is rolled back (no corruption)
- The AI's retry loop provides corrected code

Example error recovery:
```
> bevel(-0.5)  ← Invalid (negative amount)
Error: bevel: amount must be >= 0
⟳ error: retrying…
> bevel(0.15)  ← AI corrects to positive value
✓ Faces beveled
```

## API Reference

### EditableMesh Methods
- `fromBufferGeometry(geom)` → EditableMesh
- `toBufferGeometry()` → THREE.BufferGeometry
- `compact()` → EditableMesh (deduplicated)
- `addVertex(x, y, z)` → vertex object
- `addFace(v0id, v1id, v2id, ...)` → face object
- `removeFace(faceId)` → void
- `faceVertices(faceId)` → [v0, v1, v2]
- `faceNormal(faceId)` → THREE.Vector3
- `faceCenter(faceId)` → THREE.Vector3
- `edges()` → [[heId, twinId], ...]

### EditModeController Methods
- `enter(mesh)` → void
- `exit()` → void
- `toggle(mesh)` → void
- `setMode(mode)` → void ('vertex' | 'edge' | 'face')
- `runOp(fn, opName, params)` → void
- `updateOverlay()` → void

### Selection Methods
- `setMode(mode)` → void
- `toggle(id)` → void
- `add(id)` → void
- `remove(id)` → void
- `has(id)` → boolean
- `clear()` → void
- `selectAll(editableMesh)` → void
- `get count()` → number
- `get ids()` → Set

## Status and handover notes

Folded in from the former `IMPLEMENTATION_STATUS.md` (every still-true fact kept; line-number references and untestable claims dropped). The roadmap-level view is in [ROADMAP.md](ROADMAP.md).

### Milestone status

| Milestone | State | What it covers |
|---|---|---|
| M1 Boolean (CSG) | Done | `booleanUnion` / `booleanSubtract` / `booleanIntersect` via three-bvh-csg (CDN-loaded through the importmap in `docs/index.html`); full undo/redo |
| M2 Transforms | Done | `mirrorMesh` (clone + axis flip + winding fix), `arrayDuplicate` (linear/grid with offsets), `subdivide` (linear midpoint, configurable iterations) |
| M3 Half-edge mesh | Done | `EditableMesh` with lossless `fromBufferGeometry` / `toBufferGeometry`, vertex sharing, half-edge pointers, `compact()` against leaks |
| M4 Selection | Done | Vertex / edge / face modes, raycast picking in the viewport, `1`/`2`/`3`/`A` keys, selection feeds every op |
| M5 Core ops | Done | `extrude`, `inset`, `bevel` (inset + slope), `deleteFaces`, `weld` (Union-Find, epsilon), `planarUV`, `boxUV` |
| M6 AI selection criteria | Done | `selectTopFaces(count)`, `selectFacingUp(threshold)`, `selectBoundaryEdges()`, by-ID helpers for every element type |
| M9 Sculpting | Done | `sculpt` (proportional-falloff brush), `soften` (Laplacian smoothing) |
| `EditModeController` | Done | enter → edit → exit lifecycle, colour-coded overlay, keyboard input, gizmo moves the selection, undo/redo integration, recipe recording into `userData.recipe` |
| Op registry + AI integration | Done | Central registry (`mesh/ops/index.js`) serialized by `serializeForAI()` into `buildSystemPrompt()`; the Shell scope exposes every op as a global, so the UI and the AI call the same functions |
| M7 Import/export | **Not implemented as an edit-mode feature** | General glTF / GLB / OBJ import and glTF / GLB / USDZ / OBJ export exist in the editor (`Loader.js`, `Sidebar.Export.js`); what is missing is import *with edit history*, recipe-based export, and automatic `EditableMesh` creation on first edit (planned helpers: `mesh/ops/import.js`, `mesh/ops/export.js`) |
| M8 Texture/UV | Partial | Only `planarUV` / `boxUV`. Missing: material property setters for the AI, texture assignment helpers, smart (angle-based) unwrapping, baking (planned: `mesh/ops/materials.js`) |

Nice-to-have, not built: soft-select beyond the sculpt brush, numeric constraint input, snapping (grid, vertex, edge, face), loop cut, non-destructive Mirror/Array modifiers, BVH acceleration for dense-mesh picking.

### Known limitations and handover notes

1. **Topology assumptions.** Works best on manifold, closed meshes; open surfaces and non-manifold meshes have edge cases.
2. **Large geometry.** Raycast picking is slow above ~50k vertices (no BVH yet).
3. **Boolean robustness.** three-bvh-csg may fail on coplanar or edge-touching geometry.
4. **UV preservation.** There is no automatic UV preservation while editing (basic projection only).
5. **Attribute preservation.** Custom vertex attributes (skin weights, vertex colours) are not preserved during editing; see also [Technical → Known Limitations](MESH_EDITING_TECHNICAL.md#known-limitations).
6. **Undo memory.** Each operation stores full geometry, which is memory-intensive for large meshes.

Rough performance guidance (handover estimates, not re-measured; the three mesh guides give slightly different thresholds): edit mode is real-time below ~10k vertices, works with slight lag at 10k–50k, and is functional but not interactive above ~50k.

| Mesh size | `extrude` (approx.) |
|---|---|
| 1k vertices | < 10 ms |
| 10k vertices | 20–50 ms |
| 50k vertices | 100–200 ms |
| 100k vertices | 300–500 ms |

Optimization ideas: `three-mesh-bvh` for picking; cache face normals/centers; recipe-based undo (store operations, not geometry); batch overlay updates for multi-op commands; lazy geometric queries.

### Troubleshooting

- **Edit mode not responding to the keyboard.** The viewport needs focus: click the 3D view first. `Tab` / `Esc` exit edit mode; enter with `enterEditMode()`.
- **Undo not working.** Ops should emit a `SetGeometryCommand` (see `EditModeController.runOp()`); check that the wrapper in the Shell scope goes through `editor.editModeController.runOp(...)`.
- **AI generates invalid code.** Check the operation registry is being serialized: the shell `listOps()` should print one line per op. Note the registry is only injected when the scene has no addressable parts.
- **Geometry corrupts on edit.** Likely an `EditableMesh` / `BufferGeometry` sync problem. Log before/after `toBufferGeometry()` in `EditModeController.exit()`.
- **Debug snippets.** See [Technical → Debugging](MESH_EDITING_TECHNICAL.md#debugging). Useful state: `editor.editModeController.active`, `.selection` (`mode`, `count`) and `.em` (`vertices`, `halfEdges`, `faces`).

### For developers

1. Operations live in `docs/editor/js/mesh/ops/`; follow the pattern in `extrude.js` and call `registerOp()` at the end of the file.
2. Add the function to the Shell scope in `Shell.js` (and to its autocomplete word list) so it is a global for hand-typed and AI code.
3. Make sure `serializeForAI()` includes it, so the AI sees it.
4. Mutations must go through `EditModeController.runOp()` (or an explicit Command) so they are undoable.
5. Architecture detail: [MESH_EDITING_TECHNICAL.md](MESH_EDITING_TECHNICAL.md).

### Files

```
docs/editor/js/mesh/
  EditableMesh.js          half-edge structure
  Selection.js             sub-object selection
  EditModeController.js    edit-mode lifecycle
  GeometryOptimizer.js, skinIndices.js, skinnedPerf.js   (skinned-mesh / optimizer helpers)
  ops/
    index.js               operation registry
    boolean.js mirror.js array.js subdivide.js   (M1, M2)
    extrude.js inset.js bevel.js delete.js weld.js   (M5)
    uv.js                  planarUV, boxUV
    sculpt.js soften.js    (M9)
docs/editor/js/AIPrompt.js   buildSystemPrompt()
docs/editor/js/Shell.js      imports every op and exposes it in the scope
```

Compatibility: no build step and no new dependencies (browser ES modules on the existing editor infrastructure); edit mode is optional and the rest of the editor does not depend on it.

---

**For support**: See the eval results in Shell.js for working examples of every operation in context.
