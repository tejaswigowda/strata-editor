# Mesh Editing Implementation - Technical Summary

## Overview

This document provides a technical breakdown of the mesh editing layer implementation, including architecture, data structures, and design decisions.

## Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────┐
│  AI System (WebLLM)                            │
│  - Reads system prompt with operation schemas  │
│  - Generates JavaScript code                   │
│  - Calls operation functions from Shell scope  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Shell.js Scope                                │
│  - Global functions (extrude, inset, etc.)    │
│  - Editor interface (enterEditMode, etc.)     │
│  - Utility functions (selectTopFaces, etc.)   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  EditModeController                            │
│  - Manages edit mode lifecycle                │
│  - Handles undo/redo via Commands             │
│  - Visual overlay + keyboard input            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  EditableMesh ↔ BufferGeometry Sync            │
│  - Half-edge topology                         │
│  - Lossless bidirectional conversion          │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  THREE.js Scene                                │
│  - Rendered meshes with geometry               │
└──────────────────────────────────────────────────┘
```

### Operation Registry Pattern

Every mesh operation is registered in a central registry (`editor.ops._ops Map`):

```javascript
registerOp('extrude', {
  fn: (em, params) => {
    // Implementation
  },
  description: 'Extrude selected faces along their normal',
  params: [
    { name: 'distance', type: 'number', default: 1 }
  ],
  example: 'extrude(2)'
});
```

**Key Functions:**
- `registerOp(name, descriptor)` - Register an operation
- `getOp(name)` - Retrieve by name
- `listOps()` - Get all registered operations
- `serializeForAI()` - Format for system prompt injection

**Usage Points:**
1. AI reads available operations from serialized registry
2. AI generates code calling operation functions
3. Shell scope functions delegate to registered implementation
4. Commands wrap mutations for undo/redo

## Data Structures

### EditableMesh

**Purpose:** Topology-aware mesh representation using half-edge data structure

**Structure:**
```javascript
EditableMesh {
  vertices: [{ x, y, z, id }, ...]
  halfEdges: [{ id, vertex, next, prev, twin, face }, ...]
  faces: [{ id, halfEdge }, ...]
}
```

**Key Methods:**
- `fromBufferGeometry(geom)` - Import from THREE.BufferGeometry
- `toBufferGeometry()` - Export to THREE.BufferGeometry
- `addVertex(x, y, z)` - Create vertex
- `addFace(v0id, v1id, v2id, ...)` - Create n-gon
- `removeFace(faceId)` - Delete face
- `compact()` - Remove gaps from deleted elements
- `faceVertices(faceId)` - Get ordered vertex list
- `faceNormal(faceId)` - Compute normal
- `faceCenter(faceId)` - Compute centroid
- `edges()` - Get all edges as pairs

**Invariants:**
- Every half-edge has exactly one twin (or -1 for boundary)
- Twin edges point in opposite directions
- All edges bound exactly one face
- Vertices are shared, but half-edges are not

### Selection

**Purpose:** Track sub-object selection (vertex/edge/face mode)

**Structure:**
```javascript
Selection {
  mode: 'vertex' | 'edge' | 'face'
  ids: Set<id>  // IDs of selected elements in current mode
}
```

**Key Methods:**
- `setMode(mode)` - Switch selection mode
- `toggle(id)` - Flip selection state
- `add(id)`, `remove(id)` - Explicit add/remove
- `selectAll(em)` - Select all in mode
- `clear()` - Clear selection

### EditModeController

**Purpose:** Manage edit mode state, visual feedback, input handling

**Structure:**
```javascript
EditModeController {
  active: boolean
  mesh: THREE.Mesh
  em: EditableMesh  // Half-edge representation
  selection: Selection
  overlay: THREE.Group  // Visual feedback
  raycaster: THREE.Raycaster
  mouse: THREE.Vector2
}
```

**Key Methods:**
- `enter(mesh)` - Enter edit mode on a mesh
- `exit()` - Exit and bake changes back
- `setMode(mode)` - Switch selection mode
- `runOp(fn, opName, params)` - Execute undoable operation
- `updateOverlay()` - Refresh visual representation
- `onMouseMove(event)` - Handle picking
- `onKeyDown(event)` - Handle keyboard shortcuts

**Lifecycle:**
1. `enter()` creates EditableMesh from geometry
2. `enter()` builds visual overlay (edges, vertices, faces)
3. Operations modify EditableMesh directly
4. Each op wraps mutation in SetGeometryCommand
5. `updateOverlay()` refreshes visuals after each op
6. `exit()` converts EditableMesh back to BufferGeometry
7. `exit()` emits SetGeometryCommand for undo support

### Operations

**Base Pattern:** Each operation file exports a function and calls `registerOp()`

**Example (extrude.js):**
```javascript
function extrude(em, { distance = 1 } = {}) {
  // Get selected face IDs from context
  // For each selected face:
  //   1. Duplicate vertices at original positions
  //   2. Move original vertices along face normal
  //   3. Create side triangles connecting old to new
  // Return modified EditableMesh
}

registerOp('extrude', {
  fn: extrude,
  description: 'Extrude selected faces along their normal',
  params: [{ name: 'distance', type: 'number', default: 1 }],
  example: 'extrude(2)'
});
```

**Operation Categories:**

| Category | Files | Purpose |
|----------|-------|---------|
| **M1** | boolean.js | Boolean CSG (union, subtract, intersect) |
| **M2** | mirror.js, array.js, subdivide.js | Transform operations |
| **M5** | extrude.js, inset.js, bevel.js, delete.js, weld.js | Core mesh editing |
| **M8** | uv.js | UV mapping |

## Integration Points

### Shell.js (Primary Integration)

**Lines 550-660:** Operation function definitions
- All operations expose via same function names
- Functions delegate to EditModeController or operation registry
- Selection helpers (selectTopFaces, etc.) directly manipulate Selection

**Line 683-704:** execute() function
- Uses Function() constructor with scope binding
- Evaluates AI-generated code in sandbox with all globals available
- Catches errors and provides validator feedback for retry

**Line 778, 868:** AI system prompt generation
- Calls `buildSystemPrompt(opsSchema())` instead of static SYSTEM_PROMPT
- Injects serialized operation registry into GLOBALS section
- AI receives current available operations on every generation

### AIPrompt.js (System Prompt)

**Lines 15-217:** SYSTEM_PROMPT (static template)
- 217 lines of rules and context
- Includes placeholder for operation schemas (line marked with "EditMode:")

**Lines 220+:** buildSystemPrompt(opsSchema)
- Takes serialized registry as parameter
- Inserts operation descriptions into GLOBALS section
- Returns complete, ready-to-use system prompt

**Format:**
```
GLOBALS:
  editor: THREE.js Editor
  extrude(distance: number = 1) — Extrude selected faces along their normal
  inset(amount: number = 0.2) — Inset selected faces toward their center
  ...
```

### Commands

All operations use existing command infrastructure:

**SetGeometryCommand** (primary)
- Stores before/after geometry
- Supports undo (restore old geometry)
- Supports redo (restore new geometry)

**AddObjectCommand, RemoveObjectCommand**
- Used by boolean ops to manage object creation/destruction

**MultiCmdsCommand**
- Wraps multiple commands (e.g., array operation)

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| extrude | O(n) | n = selected faces |
| inset | O(n) | Border computation linear in boundary length |
| bevel | O(n) | Inset + slope calculation |
| delete | O(n) | Mark faces as null |
| weld | O(v log v) | Union-Find with path compression |
| compact | O(v + e) | Graph traversal + remapping |
| toBufferGeometry | O(v + f) | Extract vertices and triangles |
| fromBufferGeometry | O(f) | Build half-edge structure |

### Space Complexity

- **EditableMesh:** O(v + e) where v = vertices, e = half-edges
- **Selection:** O(selected elements)
- **Undo stack:** O(geometry size) per command

### Practical Limits

- **Small meshes** (<5k verts): Real-time editing, visual feedback on every operation
- **Medium meshes** (5k-50k): Edit mode works, slight delays on complex operations
- **Large meshes** (>50k): Edit mode functional but laggy; recommend simplification first

**Optimization Opportunities:**
- Use three-mesh-bvh BVH for faster picking on dense meshes
- Cache face normals/centers instead of recomputing
- Batch visual updates (defer overlay refresh until end of batch)
- Implement operation history replay (recreate geometry from recipe vs. storing full geometry)

## Error Handling

### Validation Loop

```
AI generates code
  ↓
Validator checks syntax + calls available functions
  ↓
If error: AI receives error message + retry
  ↓
If success: Code executes in Shell scope
  ↓
If runtime error: Caught, reported, AI can retry
```

### Common Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| Syntax error | AI generated invalid JS | Validator reports → AI retries |
| Undefined function | AI called non-existent op | Validator catches → AI retries with registered ops |
| Type mismatch | Wrong param type | Runtime error caught → AI adjusts types |
| Edit mode not active | Tried op without entering edit mode | Runtime error → AI calls enterEditMode() first |
| No selection | Tried op on empty selection | No-op or soft error → AI selects elements first |

## Testing Strategy

### Unit Tests (TODO)

```javascript
// EditableMesh
test('fromBufferGeometry creates valid half-edge structure')
test('toBufferGeometry recovers original geometry')
test('compact removes gaps without changing topology')

// Selection
test('toggle flips selection state')
test('selectAll selects all vertices/edges/faces')

// Operations
test('extrude increases face count by 5x')
test('inset preserves face count')
test('weld reduces vertex count')

// EditModeController
test('enter creates overlay matching mesh')
test('exit emits SetGeometryCommand')
test('keyboard shortcuts work correctly')
```

### Integration Tests (TODO)

```javascript
// Full workflow
test('enterEditMode → extrude → exitEditMode → undo → redo')
test('AI requests execute successfully through Shell')
test('Operation registry is injected into system prompt')
```

### Manual Tests (Quick Verification)

```javascript
// Copy into REPL:
const box = new Mesh(new BoxGeometry(2,2,2), new MeshStandardMaterial());
editor.execute(new AddObjectCommand(editor, box));
enterEditMode(box);
selectTopFaces(1);
extrude(2);
exitEditMode();
// Verify: Box should have a raised top face
// Verify undo with Ctrl+Z: Top should return to original
```

## API Stability

### Stable (unlikely to change)

- `enterEditMode()`, `exitEditMode()` - Part of public interface
- `extrude()`, `inset()`, `bevel()` - Core operations, well-established
- `selectFaces()`, `selectVertices()`, `selectEdges()` - Fundamental selections

### Experimental (may change)

- `selectTopFaces()`, `selectFacingUp()` - New M6 criteria, may evolve
- Recipe format - Not yet serialized to disk, format TBD
- Operation registry format - Internal, subject to refactoring

### Under Review (future)

- M7 import/export - Planned but not implemented
- M8 texture/UV - Planned, only basic ops exist
- Loop cut, proportional select, snapping - Future enhancements

## Known Limitations

1. **Topology preservation:** Editing doesn't preserve vertex attributes (except UVs)
2. **Non-manifold meshes:** Editing assumes closed meshes; open surfaces have edge-case bugs
3. **Large geometry:** Raycasting slow on dense meshes without BVH acceleration
4. **Boolean robustness:** three-bvh-csg may fail on coplanar intersections
5. **UV preservation:** Current UV ops are simple projections; complex unwraps not supported

## Future Enhancements

### M7 (Import/Export)

- GLTFLoader integration to import .glb/.gltf
- OBJLoader for .obj import
- Recipe-based export (JSON with operation history)
- Automatic EditableMesh creation on first edit

### M8 (Texture/UV)

- Material property setters for AI
- Texture assignment helpers
- Smart UV unwrapping (angle-based seams)
- Baking (normal maps, ambient occlusion)

### Polish

- Soft-select (falloff toward neighbors)
- Proportional editing (op scales with distance)
- Numeric entry (precise transform values)
- Constraint snapping (grid, vertex, edge, face)
- Mirror modifier (non-destructive)
- Array modifier (non-destructive)

## Debugging

### Enable Verbose Logging

```javascript
// In Shell.js, add:
editor.ops.DEBUG = true;
editor.editModeController.DEBUG = true;
```

### Inspect Edit Mode State

```javascript
console.log({
  active: editor.editModeController.active,
  mode: editor.editModeController.selection.mode,
  selected: editor.editModeController.selection.count,
  mesh: editor.editModeController.mesh.name,
  verts: editor.editModeController.em.vertices.length,
  faces: editor.editModeController.em.faces.filter(f => f).length
});
```

### Inspect Operation Registry

```javascript
editor.ops.listOps().forEach(op => console.log(op.name, '—', op.description));
```

### Inspect Selection

```javascript
const sel = editor.editModeController.selection;
console.log('Mode:', sel.mode, 'Count:', sel.count, 'IDs:', Array.from(sel.ids));
```

---

**Last Updated:** 2024  
**Status:** M1-M6 Complete, M7-M8 Not Implemented
