# Mesh Editing Quick Start

## One-Minute Overview

This three.js editor now has a full mesh editing layer with AI integration.

### Supported Operations

**Boolean** (CSG): `union`, `subtract`, `intersect`  
**Transforms**: `mirror`, `array`, `subdivide`  
**Mesh Editing**: `extrude`, `inset`, `bevel`, `delete`, `weld`, `planarUV`, `boxUV`  
**Sculpting**: `sculpt` (proportional-falloff push/pull brush), `soften` (Laplacian smoothing)  
**Selection**: By ID or by criteria (top faces, facing up, boundary edges)  

### Quick Test (Copy & Paste into REPL)

```javascript
// 1. Create a box
const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
box.name = 'TestBox';
editor.execute(new AddObjectCommand(editor, box));

// 2. Enter edit mode
enterEditMode(box);

// 3. Edit it
selectTopFaces(1);      // Pick the top face
extrude(1);             // Push it up 1 unit
selectFacingUp(0.9);    // Select upward faces
bevel(0.15);            // Smooth their edges
planarUV('y');          // Unwrap UVs

// 4. Exit edit mode
exitEditMode();

// Done! Undo with Ctrl+Z
```

### Keyboard Shortcuts (in Edit Mode)

- **Tab** - Exit edit mode
- **1** - Vertex select mode
- **2** - Edge select mode  
- **3** - Face select mode
- **A** - Select all / none
- **Click** - Toggle select

### How AI Uses It

Ask in natural language:

```
? add a rounded hole in the top of the cube
? carve out 3 small spheres from the edges
? make it smoother and more organic
```

The AI will:
1. Parse your request
2. Generate code using available operations
3. Validate the code
4. Execute it with full undo support

### Full Operation List

| Category | Operations |
|----------|-----------|
| **Boolean** | `booleanUnion(a,b)`, `booleanSubtract(a,b)`, `booleanIntersect(a,b)` |
| **Transform** | `mirrorMesh(m, axis)`, `arrayDuplicate(m, count, dx, dy, dz)`, `subdivide(m, iters)` |
| **Edit Mode** | `enterEditMode(mesh)`, `exitEditMode()` |
| **Operations** | `extrude(d)`, `inset(t)`, `bevel(t)`, `deleteFaces()`, `weld(eps)`, `planarUV(axis)`, `boxUV()` |
| **Sculpting** | `sculpt(strength, radius, falloff)`, `soften(iterations, factor)` |
| **Selection** | `selectTopFaces(n)`, `selectFacingUp(threshold)`, `selectBoundaryEdges()`, `selectFaces(...ids)`, `selectVertices(...ids)`, `selectEdges(...ids)`, `clearSelection()` |
| **Utility** | `getSize(mesh)`, `getCenter(mesh)`, `getTopY(mesh)`, `placeOnTop(child, target)` |

### Examples

**Boolean Subtraction:**
```javascript
const box = new Mesh(new BoxGeometry(2, 2, 2), mat);
const cyl = new Mesh(new CylinderGeometry(0.4, 0.4, 3, 8), mat);
editor.execute(new AddObjectCommand(editor, box));
editor.execute(new AddObjectCommand(editor, cyl));
booleanSubtract(box, cyl, false);  // Carve hole, remove cyl
```

**Mesh Modification:**
```javascript
const m = findObject('MyMesh');
enterEditMode(m);
selectFacingUp(0.5);      // Top half
inset(0.2);               // Pull inward
extrude(0.5);             // Push outward
selectBoundaryEdges();    // Perimeter
weld(0.01);               // Clean up
exitEditMode();
```

**Procedural Generation:**
```javascript
const base = new Mesh(new BoxGeometry(1, 1, 1), mat);
base.name = 'Pillar';
editor.execute(new AddObjectCommand(editor, base));
subdivide(base, 2);       // Make denser
const pillar = arrayDuplicate(base, 4, 3, 0, 0);  // Row of 4
mirrorMesh(pillar, 'x');  // Mirror to other side
```

**Sculpting:**
```javascript
const ball = new Mesh(new SphereGeometry(0.5, 48, 32), mat);
ball.name = 'Sculptable';
editor.execute(new AddObjectCommand(editor, ball));
enterEditMode(ball);
selectVertices(0);        // pick a vertex near where you want a bump
sculpt(0.1, 0.2);         // push out, falls off smoothly over radius 0.2
sculpt(-0.06, 0.15);      // negative strength pushes in (e.g. a socket/dent)
clearSelection();
soften(1, 0.4);           // relax the whole mesh so bumps read as smooth, not faceted
exitEditMode();
```

### Debugging

If something fails:

```javascript
// Check selection
console.log(editor.editModeController.selection.count);

// Check available ops
console.log(editor.ops.listOps().map(op => op.name));

// Check edit mode state
console.log(editor.editModeController.active);
```

### Next Steps

See [MESH_EDITING_GUIDE.md](./MESH_EDITING_GUIDE.md) for complete documentation, architecture details, and advanced usage.
