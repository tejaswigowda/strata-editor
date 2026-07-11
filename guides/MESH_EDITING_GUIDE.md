# Mesh Editing Implementation Guide

This document describes the mesh editing layer that has been implemented according to the Handover Spec.

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
- `extrude(distance=1)` — Extrude selected faces along their normal
- `inset(amount=0.2)` — Inset faces toward their center
- `bevel(amount=0.1)` — Chamfer face edges
- `deleteFaces()` — Delete selected faces
- `weld(threshold=0.01)` — Merge nearby vertices
- `planarUV(axis='y')` — Project UVs onto a plane
- `boxUV()` — Box/cubic UV projection

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
- `selectTopFaces(count=1)` — Select N faces with highest Y coordinate
- `selectFacingUp(threshold=0.1)` — Select faces whose normal points mostly upward
- `selectBoundaryEdges()` — Select edges on the mesh boundary (open edges)
- `selectFaces(...ids)` — Select specific face IDs
- `selectVertices(...ids)` — Select specific vertex IDs
- `selectEdges(...ids)` — Select specific edge IDs
- `clearSelection()` — Clear all selections

## Keyboard Shortcuts (in Edit Mode)

| Key | Action |
|-----|--------|
| **Tab** | Toggle edit mode on/off |
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

### Current Scope (M1-M6)
✓ Boolean operations  
✓ Mirror, array, subdivide  
✓ Extrude, inset, bevel, delete, weld  
✓ Planar and box UV projection  
✓ Selection by criteria  

### Not Yet Implemented (M7-M8)
- glTF/OBJ import with edit history
- Loop cut (edge-based subdivision)
- Proportional/soft-select editing
- Snapping (grid, vertex, edge, face)
- Numeric entry for precise transforms
- Advanced UV unwrapping (angle-based)
- Sculpting or physics simulation

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
⟳ error — retrying…
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

---

**For support**: See the eval results in Shell.js for working examples of every operation in context.
