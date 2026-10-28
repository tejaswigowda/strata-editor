# Cutting a mesh into named parts (`SEG`)

> Part of the [Strata documentation](../README.md#documentation). See also: [JS Shell](JS_SHELL.md) · [The language](LANGUAGE.md) · [Shorts: the standard](SHORTS_TEMPLATE.md) · [Tutorial](../docs/about/tutorials/segment-any-mesh.html)

A model usually arrives as **one mesh with one material**, so nothing in the scene says "this is the seed" or "this is the left wing", and `$S('#seed')` has nothing to reach. `SEG` cuts such a mesh into separate meshes, each with a name and classes chosen by you, inside one group, in **one undo step**. It is a Shell global (`SEG`); the code is [`meshSegment.js`](../docs/editor/js/intelligence/meshSegment.js) (with the colour sampling in [`textureColour.js`](../docs/editor/js/intelligence/textureColour.js), which the descriptor writer also uses) and its pure core is tested by [`meshSegment.test.mjs`](../docs/editor/js/intelligence/__tests__/meshSegment.test.mjs).

**It does not recognise anything.** It reads the two kinds of evidence a textured mesh carries, reports them, and cuts exactly where *you* decide. The names come from the plan, written by a person or by an AI that has been shown the report.

## The two kinds of evidence

| Evidence | What it is | Where it works |
|---|---|---|
| **UV islands** | Connected pieces of surface that the texture artist laid out as separate patches of the texture. Vertices are welded on position **and** UV, so a hard edge (a different normal) does not split a piece, and a texture seam does. | Models whose parts were unwrapped separately: a seed, a beak, a wing. |
| **Painted colour** | Inside one island, a ring of orange and a ring of cream are different things, although the triangles are all alike. | A part that is only a region of a painted patch: the hollow round a seed, the white of an eye. |

## The calls

```js
SEG.describe('#Mesh', k = 3)    // text: one line per island, largest first (or per material, on a mesh with several)
SEG.data('#Mesh', k = 3)        // the same, as objects: { island, triangles, size, at, uv, colours }
SEG.split('#Mesh', plan)        // cut into named, classed meshes in one group (one undo step); plan.source is required
SEG.byMaterial('#Mesh', plan)   // a mesh with several materials: one part per material (exact evidence); same record
SEG.replay('#Mesh', record)     // cut again from a recorded plan; refuses if the mesh is not the one the record describes
SEG.preview('#Group')           // each part a flat colour, to check the cut;  SEG.restore() puts the materials back
```

`SEG.describe` prints, for each island: its triangle count, where it sits in the texture (`u`, `v`), its size in space (`x, y, z`), **`at`**, its centre as 0 to 1 across the whole mesh on x, y and z (which is how left is told from right, and front from back), and its main colours with their share (a small, deterministic k-means over colours sampled across each triangle, so the same mesh always gives the same report).

```
island 0: 483 triangles, texture u 0.01,0.67 v 0.01,0.76, size 0.043,0.063,0.022, at 0.50,0.50,0.61, colours rgb(54,102,10) 65%  rgb(85,139,38) 34%
island 1: 158 triangles, texture u 0.70,0.97 v 0.00,0.33, size 0.019,0.027,0.006, at 0.50,0.45,0.12, colours rgb(132,66,22) 48%  rgb(181,119,51) 41%
island 2: 41 triangles, texture u 0.54,0.98 v 0.35,1.00, size 0.042,0.061,0.000, at 0.49,0.50,0.22, colours rgb(220,221,107) 46%  rgb(52,107,2) 39%
```

Read it as evidence: island 0 is the biggest and dark green (the skin); island 1 is small and brown (the seed); island 2 has a thickness of 0.000, so it is flat, and four colours: the cut face.

## The plan

```js
SEG.split('#Avocado', {
  group: 'Avocado_Fruit', classes: ['fruit', 'avocado'],
  source: { url: 'https://github.com/.../Avocado.glb', licence: 'CC0 1.0 Universal', attribution: 'Microsoft (Khronos glTF Sample Models: Avocado)' },
  parts: [
    { island: 0, name: 'Avocado_Skin', classes: ['skin', 'peel'] },          // a whole island is one part
    { island: [6, 8], name: 'Duck_Tail_Left', classes: ['tail', 'left'] },   // a list of islands is one part
    { island: 2, subdivide: 4, palette: [                                     // an island divided by colour
      { name: 'Avocado_Pit_Cavity', classes: ['cavity'], color: [247, 212, 86] },
      { name: 'Avocado_Pit_Cavity', classes: ['cavity'], color: [245, 175, 70] },   // same name: one part, two colours
      { name: 'Avocado_Flesh',      classes: ['flesh'],  color: [203, 227, 119] } ] }
  ]
})
```

* **`source` is required**: `{ url, licence, attribution }`, the http(s) address of the original model, the licence its owner states for it, and the credit line (plus an optional `modifications`: a string or a list, appended to what SEG writes). A segmentation is a derivative work, so no segmented asset is made without them. SEG cannot check them; they are your statement.
* **Every island must go to exactly one part.** A leftover island, an island used twice, or one that does not exist is an error, and nothing is changed.
* **Names** must be ones an author chose (not `Mesh`, `Group`, `Object3D`, …), unique, and not already in the scene; **every part needs at least one class**. These are the rules of the [labelling gate](SHORTS_TEMPLATE.md), so a scene built this way can go straight on to `requireLabels(true)`.
* **`subdivide: n`** first splits each triangle of the island into 4ⁿ smaller ones (the same surface, the same texture), because a flat patch is made of a few large triangles, far larger than the rings painted on it; then each small triangle goes to the palette colour **nearest** the texture colour at its centre. A cut that follows paint is as ragged as the paint. Cost: the island's triangles are multiplied by 4ⁿ.
* The new meshes **share the original material**, so the model looks exactly as it did. The original mesh and the empty wrapper nodes an importer leaves round it (a node named after the file, a root node) are removed in the same step. The group sits where the mesh was in the world. The group's `userData.segmentation` is the record described below.

## What the asset records

The cut is verifiable by anyone holding the file (triangles are conserved, parts do not overlap). The *naming* is only as good as what it was made from, so the asset keeps that. On the group, `userData.segmentation` (in a scene file, and in a `.glb` as the node's `extras`):

| Field | |
|---|---|
| `from`, `seg_version`, `method` | the source mesh's name; the version of SEG (`1.1.0`); `islands` or `material` |
| `source_url`, `source_licence`, `attribution` | from the plan's `source` |
| `modifications` | written by SEG: the cut, any subdivision (`138 to 2208 triangles`), that the material and texture are unchanged; plus the plan's own `modifications` |
| `plan` | the plan **as given**, verbatim (islands, `subdivide`, palette colours, names, classes, source). For `byMaterial` without `parts`, the plan as resolved from the material names |
| `describe` | the report the decision was made from: `{ k, islands: [...] }` (sizes, centres, texture position, colours) or `{ materials: [...] }` |
| `parts` | `{ name: triangles }` |
| `signals` | recorded and not acted on: `source_units` (islands or materials), `part_count`, `largest_part_area_share`, `compound_names` (e.g. `Duck_Body_And_Head`). Candidates for a future refusal rule; nothing is refused on them yet |

**Per-part descriptors.** Each part gets `userData.descriptors` when it is made. For a textured mesh with UVs, `descriptors.color` is the colour of the texture **under that part**: the median of points spread over its own surface by area, read through its own UVs, with `clusters: [{ rgb, hex, share }]` (`source: 'uv-footprint'`). The material's own colour, which is the same for every part that shares an atlas, is kept as `descriptors.materialColor`. (`descriptors` schema 2; the same rule applies to any textured mesh the editor indexes, not only segmented ones.) On the duck the beak is `#ff7e00`, the eyes `#000000`, the highlights `#ffffff`, the body `#ffd800`; on the avocado the skin, pit, cavity and flesh are `#47791c`, `#af6f2e`, `#f8d24d`, `#bfe36e`.

**The record is enough to do it again.** `SEG.replay('#Mesh', record)` (a record, or a group that has one) first checks the mesh against `record.describe` (same number of islands or materials, the same triangle counts, sizes, and colours within a few counts) and refuses, before changing anything, if it differs, saying how. It then runs the recorded plan and refuses if any part's triangle count differs from `record.parts`. Tested: the committed `duck.json`'s record, replayed on a fresh import of `Duck.glb`, gives all ten parts with the recorded counts. Replay needs the scene to hold the original mesh and no part of the same names, and the texture to decode to the same pixels (the same on one browser; another may move a colour by a count or two, which the check allows).

What a record cannot do: prove that the licence or attribution is right; say that the names are correct, only what they were made from.

Records made before 1.1.0 (the first release) kept only `from` and `parts`, with no plan, no evidence and no version; their `descriptors.color` was the material's colour. Re-cut them.

## A mesh with several materials

Some formats (OBJ with a material library) give one mesh several materials. That is the best case: the author of the model assigned each triangle to a material, exact evidence with no seam artefacts. `SEG.describe` lists the materials; `SEG.byMaterial('#Mesh', plan)` cuts one part per material.

```js
SEG.byMaterial('#Crate', { group: 'Crate_Parts', source: { url, licence, attribution } })        // parts named from the materials ("Face Top" -> Crate_Face_Top)
SEG.byMaterial('#Crate', { group: 'Crate_Parts', source, parts: [ { material: 0, name: 'Crate_Lid', classes: ['lid'] }, … ] })   // or name them yourself
```

Every material with triangles must go to a part, the mesh's groups must cover every triangle, and each part keeps its material; the geometry is unchanged. The group is placed where the mesh was, in its parent's frame (under a real parent, not under an importer's wrapper). A part can then be cut further with `SEG.split` if it is textured. (The glTF importer already makes one mesh per material, so glTF models arrive cut this way.) Checked on a six-material crate on a shelf: six parts, same world position, undo restores it, replay matches.

## What it refuses, and what it cannot do

| | |
|---|---|
| **Refuses** (with a message that says why) | a node that is not a mesh; a **skinned** mesh (cutting would break its skeleton); a mesh with **morph targets**; a colour cut on a mesh with no UVs or no base-colour texture; a plan with no `source`, a default or repeated name, a part with no class, an island left over or used twice. `SEG.split` on a mesh with several materials is sent to `SEG.byMaterial`. |
| **Cannot decide for you** | what an island *is*. A toy duck's body is one island but its wing is two; a model whose islands are not parts gives meaningless names if cut island to part. Look at `SEG.describe` and merge islands (`island: [..]`). |
| **Cannot find** | a boundary no one painted: a part that shares an island **and** a colour with its neighbour; a mesh with only vertex colours or one flat colour (there is no evidence to read). |
| **Costs** | colour cuts multiply triangles by 4ⁿ. Normals are renormalised after subdividing; integer attributes are rounded. |

## Checking a cut

```js
SEG.preview('#Duck')        // every part its own flat colour (one undoable step); the return value lists the colours and names
isolate('#Duck_Beak')       // only one part (or isolate('.eye'), isolate('.left'))
showAll()
SEG.restore()               // the textured materials, back
```

Orbit while previewing: a cut that looks right from the front can be wrong behind. `Undo` walks back through all of it.

## Using the parts

```js
$S('#Duck_Beak').recolor('#e11')
$S('.wing')                          // both wings
$S('.eye.left')                      // the left eye only
$S('.left')                          // everything on the left: a wing, a tail, an eye
```

The tutorials: [**Cut any textured mesh into named parts**](../docs/about/tutorials/segment-any-mesh.html) (the general case, with an avocado and a toy duck) and [Cut an avocado into named parts, building the tool by hand](../docs/about/tutorials/segment-a-mesh.html) (the tool written out step by step).

## Sample models used

| Model | Source | Licence | Scene |
|---|---|---|---|
| Avocado | [Khronos glTF Sample Models](https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Avocado/glTF-Binary/Avocado.glb), Microsoft | CC0 1.0 | `avocado.json` in `tejaswigowda/test1` |
| Duck | [Khronos glTF Sample Models](https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Duck/glTF-Binary/Duck.glb), © 2006 Sony Computer Entertainment Inc. | SCEA Shared Source License 1.0 (derivatives may be redistributed with the licence and notices and the modifications identified; as-is, no warranty) | `duck.json` in `tejaswigowda/test1`, with `licenses/SCEA-Shared-Source-License-1.0.txt` and `licenses/duck-NOTICE.md` beside it, and the same licence, credit and modifications in the scene's own record |

## Tests

```
node docs/editor/js/intelligence/__tests__/meshSegment.test.mjs    # islands, colours, the plan's refusals, subdivision by colour, carved arrays, the source requirement,
                                                                    # the record (plan verbatim, modifications, signals), the replay round trip (G4), the cut by material,
                                                                    # the colour under a part (not the whole atlas)
```

Verified in a real browser on both models (SEG 1.1.0), importing the `.glb` and pasting the tutorial's blocks: the parts add up (avocado 483 + 158 + 41 × 256 = 11,137; duck 2,532 + 882 + 160 + 160 + 112 + 90 + 276 × 16 = 8,352), the scenes pass `lint()` and `requireLabels(true)`, they load again from the committed files, and one `Undo` restores the importer's original (`Avocado.glb` > `Avocado`).
