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
SEG.describe('#Mesh', k = 3, { grain })  // text: one line per island, largest first; per component on a scene; per material on a mesh with several
SEG.data('#Mesh', k = 3, { grain })       // the same, as objects: { island, triangles, size, at, uv, colours } or { component, islands, triangles, size, centre, at, colours }
SEG.components('#Mesh')                   // a scene: islands that touch in space, measured in the world frame (see "A scene" below)
SEG.attach('#Mesh', anchors, opts)        // a scene: where every unnamed component would go, and what is too far; nothing is cut
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
  source: { url: 'https://raw.githubusercontent.com/KhronosGroupArchives/glTF-Sample-Models/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/2.0/Avocado/glTF-Binary/Avocado.glb',
            sha256: '85ae91e60ed519f53a7e2096508837fedd446dcc450f8e05678b7a204679bd12', bytes: 8328156,
            licence: 'CC0 1.0 Universal', attribution: 'Microsoft (Khronos glTF Sample Models: Avocado)' },       // or: SEG.source(rawUrl, { licence, attribution }).then( s => … )
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

* **`source` is required, and it is the file, pinned and hashed**: `{ url, sha256, bytes, licence, attribution }` (plus `page` and `commit`, which SEG derives from a GitHub `url`, and an optional `modifications`: a string or a list, appended to what SEG writes). `url` must be an address something can fetch: for GitHub, `https://raw.githubusercontent.com/<owner>/<repo>/<40-hex commit>/<path>`. A `github.com/…/blob/…` link is a web page and a branch name (`main`) is a ref that moves, so both are refused with the address to use instead. `sha256` and `bytes` are the hash and size of the original file, and `SEG.source(url, { licence, attribution })` computes them. A segmentation is a derivative work, so no segmented asset is made without them. SEG cannot check that the licence and credit are right; they are your statement. The hash and size, though, can be checked by anyone, and CI does it (see [The record as a dataset entry](#the-record-as-a-dataset-entry)).
* **Every island must go to exactly one part.** A leftover island, an island used twice, or one that does not exist is an error, and nothing is changed. (A part may also be given by `component`, the islands that touch in space; and a scene plan gives `anchors` and lets the host place the rest: see [A scene](#a-scene-components-anchors-and-the-checks).)
* **Names** must be ones an author chose (not `Mesh`, `Group`, `Object3D`, …), unique, and not already in the scene; **every part needs at least one class**. These are the rules of the [labelling gate](SHORTS_TEMPLATE.md), so a scene built this way can go straight on to `requireLabels(true)`.
* **`subdivide: n`** first splits each triangle of the island into 4ⁿ smaller ones (the same surface, the same texture), because a flat patch is made of a few large triangles, far larger than the rings painted on it; then each small triangle goes to the palette colour **nearest** the texture colour at its centre. A cut that follows paint is as ragged as the paint. Cost: the island's triangles are multiplied by 4ⁿ.
* The new meshes **share the original material**, so the model looks exactly as it did. The original mesh and the empty wrapper nodes an importer leaves round it (a node named after the file, a root node) are removed in the same step. The group sits where the mesh was in the world. The group's `userData.segmentation` is the record described below.

## What the asset records

The cut is verifiable by anyone holding the file (triangles are conserved, parts do not overlap). The *naming* is only as good as what it was made from, so the asset keeps that. On the group, `userData.segmentation` (in a scene file, and in a `.glb` as the node's `extras`):

| Field | |
|---|---|
| `from`, `seg_version`, `method` | the source mesh's name; the version of SEG (`1.5.0`); `islands` or `material` (a scene cut is `islands` with `grain: 'components'`: see "A scene") |
| `source` | `{ url, page, commit, sha256, bytes, licence, attribution }`: the exact file the model came from, from the plan's `source` (the old flat `source_url`, `source_licence` and `attribution` are gone: a second copy is a second source of truth) |
| `modifications` | written by SEG: the cut, any subdivision (`138 to 2208 triangles`), that the material and texture are unchanged; plus the plan's own `modifications` |
| `plan` | the plan **as given**, verbatim (islands, `subdivide`, palette colours, names, classes, source). For `byMaterial` without `parts`, the plan as resolved from the material names |
| `describe` | the report the decision was made from: `{ k, islands: [...] }` (sizes, centres, texture position, colours) or `{ materials: [...] }` |
| `parts` | `{ name: triangles }` |
| `parents` | `{ name: [parent triangle, …] }`: for **every output triangle** of a part, in the part's order, the number of the **input** triangle (as numbered in the mesh SEG was given) it was cut from. Exact provenance, so a cut can be compared with another partition of the same mesh without matching anything by position. A part that was not divided is the identity; an island divided by colour carries each parent `4^subdivide` times, and the children of one parent can land in different parts (the paint boundary crosses it). Cutting never loses surface, so every input triangle appears in total `4^n` times over all parts together (once, when undivided: the parents of an undivided cut are a permutation of the input triangles, split across the parts); SEG checks this and refuses to cut if it fails (`parentProblems`). Since 1.5.0 (a saved record leaves them out unless asked: see below) |
| `signals` | recorded and not acted on: `source_units` (islands or materials), `part_count`, `largest_part_area_share`, `compound_names` (e.g. `Duck_Body_And_Head`). Candidates for a future refusal rule; nothing is refused on them yet |
| `verification` | `{ status: 'seeded', reviews: [] }`: nobody has looked yet. Reviews are appended; see [The record as a dataset entry](#the-record-as-a-dataset-entry) |

**Per-part descriptors.** Each part gets `userData.descriptors` when it is made. For a textured mesh with UVs, `descriptors.color` is the colour of the texture **under that part**: the median of points spread over its own surface by area, read through its own UVs, with `clusters: [{ rgb, hex, share }]` (`source: 'uv-footprint'`). The material's own colour, which is the same for every part that shares an atlas, is kept as `descriptors.materialColor`. (`descriptors` schema 2; the same rule applies to any textured mesh the editor indexes, not only segmented ones.) On the duck the beak is `#ff7e00`, the eyes `#000000`, the highlights `#ffffff`, the body `#ffd800`; on the avocado the skin, pit, cavity and flesh are `#47791c`, `#af6f2e`, `#f8d24d`, `#bfe36e`.

**The record is enough to do it again.** `SEG.replay('#Mesh', record)` (a record, or a group that has one) first checks the mesh against `record.describe` (same number of islands or materials, the same triangle counts, sizes, and colours within a few counts) and refuses, before changing anything, if it differs, saying how. It then runs the recorded plan and refuses if any part's triangle count differs from `record.parts`, or (when the record has them) if the parent triangles differ from `record.parents`. Tested: the committed `duck.json`'s record, replayed on a fresh import of `Duck.glb`, gives all ten parts with the recorded counts. Replay needs the scene to hold the original mesh and no part of the same names, and the texture to decode to the same pixels (the same on one browser; another may move a colour by a count or two, which the check allows).

What a record cannot do: prove that the licence or attribution is right; say that the names are correct, only what they were made from.

Records made before 1.1.0 (the first release) kept only `from` and `parts`, with no plan, no evidence and no version; their `descriptors.color` was the material's colour. Re-cut them. Records made by 1.1.0 and 1.2.0 have a flat, floating `source_url` with no hash or commit and no `verification`: they are *legacy*, CI refuses them, and `scripts/verify-records.mjs --migrate` brings them up to date offline without touching the cut. A legacy record can still be replayed, given the pinned source: `SEG.replay('#Mesh', record, { source })`.

## The record as a dataset entry

A scene with a segmented asset can be kept as an entry in a dataset. The schema below is what keeps an entry honest at a hundred assets and at a million, and each rule is cheap now and a rewrite of every record later. The schema is one module, [`export/records.js`](../docs/editor/js/export/records.js), used by the editor and by CI alike; the CI script is [`scripts/verify-records.mjs`](../scripts/verify-records.mjs) and its workflow template is [`ops/records/verify-records.yml`](../ops/records/verify-records.yml).

### The source is the file, pinned and hashed

```json
"source": {
  "url":    "https://raw.githubusercontent.com/KhronosGroupArchives/glTF-Sample-Models/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/2.0/Duck/glTF-Binary/Duck.glb",
  "page":   "https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/2.0/Duck/glTF-Binary/Duck.glb",
  "commit": "d7a3cc8e51d7c573771ae77a57f16b0662a905c6",
  "sha256": "65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5",
  "bytes":  120484,
  "licence": "SCEA Shared Source License 1.0",
  "attribution": "Copyright 2006 Sony Computer Entertainment Inc."
}
```

A `blob/` URL is a page for humans; nothing can fetch it. A `main` URL moves: if the file changes, the record points at different geometry, the plan may not reproduce, and nothing announces it. So `url` is the raw file at a commit, and `sha256` and `bytes` identify it exactly. The hash also survives link rot: a record whose link has died is re-attached to a re-hosted copy and *verified to be the same mesh*, where without it a dead link orphans the annotation for good. `commit` and `page` are derived from a GitHub `url`, not typed. For a host that has no commits (a model page, a CDN), `sha256` and `bytes` are still required; `commit` is optional. A model behind a login (Sketchfab, for example) cannot be fetched at all: say so with `fetchable: false`, give the page as `url`, and the hash and size of the file you downloaded are what identify it; CI then reports "not re-fetchable" for it instead of failing on the page or skipping it without a word. CI re-fetches every other source on every PR that touches a record, and weekly, and fails on a size or hash mismatch: it is the only thing that will ever say that an upstream asset changed.

### Verification: who looked, and whether they changed anything

```json
"verification": { "status": "seeded", "reviews": [] }
```

Each review appends one entry, and nothing else changes it:

```json
{ "by": "@alice", "at": "2026-11-02T18:04:00Z", "action": "confirmed", "method": "anchored", "changed": [] }
```

`status` follows the reviews (no reviews: `seeded`; any correction: `corrected`; otherwise `reviewed`) and cannot be set to say otherwise. Three rules make the number mean something:

1. **A confirmation produces a diff.** Appending to `reviews` is what makes agreement visible. Without it the only recorded signal is disagreement, and silence means both "fine" and "unexamined", which is exactly the distinction a rate is computed from.
2. **The fields are derived, not typed.** `action` and `changed` come from whether and how the labels (each part's name and classes, by uuid) actually changed, `by` from the pull request's author, `at` from when the tool ran. `scripts/verify-records.mjs --append-review base head --by @name --method anchored` derives the entry and appends it; `--review base head --by @name` is the CI check: the head must append exactly one review to the base's, earlier ones untouched, by the PR's author, and it must be the one its diff amounts to. A hand-typed `confirmed` over changed labels is refused; so is a reviewer who is not the author.
3. **`method` is required, and it is `anchored` or `blind`.** The editor shows the existing labels, so a review through it is *anchored*: it measures agreement with the seed, not accuracy. A blind review, with the labels hidden, is what calibrates the anchored rate. Mark which is which when it is written, or they cannot be separated later.

`changed` entries are `{ uuid, part, field: 'name' | 'classes' | 'added' | 'removed', from, to }`. The review UI itself is not here: this is the schema it writes into.

### Presentation stays out of the record

Mark the scene as a record and the editor saves it without the camera, the controls, the renderer settings or the undo history, which are how the last person looked at it, not what it says:

```js
asRecord()           // the scene is a record; asRecord(false) lifts it
checkRecord()        // what CI would say about this scene: ✓ a valid record, or each problem
recordView()         // set the view a record opens with, deliberately (recordView(false) goes back to the derived one)
```

On open, a record's camera is *derived* from the scene's bounding box (`framing()` in `records.js`): the same side, the same field of view, the distance that fits the bounding sphere, so the same view every time. An authored view is a named field, `userData.record.view = { position, target }`, set on purpose with `recordView()`, never the editor's last camera position. Lights are saved as they are: they are byte-identical across records, so they never diff.

**A record is saved in canonical form** (`canonicalForm()`), because removing the camera was not enough to make "open, orbit, save" change nothing. Measured in the editor, two other things moved: three.js gives every image a new uuid each time it loads (so image ids are renumbered `image-0`, `image-1`, … by position), and an object's matrix is taken apart into position, rotation and scale on load and recomposed, which moves its last digits (1e-10). Rounding matrix elements cannot fix that (a rounded rotation is no longer exactly a rotation, so the next load moves it again), so the transform is rounded in its own terms: position and scale to 9 significant digits, the rotation as a quaternion at a fixed point of "normalise, then round to 9 decimals", and the matrix is composed from those. No transform changes by more than a few parts in 10⁹ (the committed duck's largest change was 3.5·10⁻¹²). On a real record in the editor, open → orbit → save gave a byte-identical file, and so did eight further open / orbit / save round trips; 100,000 random transforms reloaded four times each had zero byte differences. CI refuses a record that is not in canonical form.

One thing to know about storage: the editor saves compact one-line JSON, so a git diff of a record shows one changed line, however small the change. The records are *stable*, so the change is real and small, but it is not *readable* in a diff. Pretty-printing records on save (a stable indent, one value per line for the parts and the verification block) would fix that, and is not done here.

### How the geometry travels is a recorded choice

`userData.record.packaging` is `pack` (the cut geometry is saved with the record: it opens with no network and no regeneration, and it redistributes the source's geometry, so the source's licence obligations attach to the pack as well as to the plan) or `plan` (only the source and the plan are saved, and the cut is regenerated from the hashed source: about 18 KB against about 900 KB for the duck; it distributes instructions rather than geometry). The record is sufficient to regenerate the cut, since the source, the plan and `seg_version` reproduce it exactly, so a pack is a cache. Both are implemented (SEG 1.6.0). `pack` is a defensible default for a small seed set, but it is a choice that is written down, not a consequence of how Strata saves.

**A `plan` record.** `asRecord(true, { packaging: 'plan' })` saves each part of a segmented group as an empty group (its uuid, name, place, classes and descriptors) and drops the geometry, materials, textures and images only those parts used. The Duck's record is 18 KB (the packed one is about 900 KB, measured). Parts keep no material or texture edits (the source's are not in the file), and a skinned mesh is refused (`asRecord` says so): its skeleton, weights and clips are the source's, so a record of one has to be a `pack`.

**Opening a `plan` record** regenerates the geometry, and never loses the record:

1. fetch `source.url` (pinned to a commit), or take the bytes from the cache: IndexedDB `strata-source-cache`, keyed by `source.sha256`, so a hit is the right bytes by construction (they are hashed again on the way out, and a damaged entry is dropped);
2. check `source.bytes` and `source.sha256` **before anything is imported**: a file that does not hash to the record's expectation is a different file, and the cut would not reproduce;
3. import it and run `SEG.replay`, which refuses, with its own message, if the mesh is not the one the record describes;
4. put the record's uuids, userData and transforms back on what the replay made, so that open then save changes nothing, and clear the undo history (opening is not an edit).

If the source cannot be had (a dead link, offline, a hash mismatch, a replay that refuses) the record still opens with its labels, classes, descriptors and plan, the parts stay empty groups, and the reason is the group's status: `recordStatus()` in the Shell lists it (`{ state: 'ready' | 'unavailable', from: 'cache' | 'network', code: 'unreachable' | 'hash' | 'size' | 'not-fetchable', message }`), `editor.signals.recordStatusChanged` fires, and the import log says why. An unavailable record saves byte-for-byte as it was opened.

**Parents are optional in a saved record.** `parents` is one integer per output triangle (about 26 KB for a three-part Lantern, 88 KB for 147 parts) and buries a one-line name change in a diff. `asRecord()` leaves them out, and `asRecord(true, { parents: true })` keeps them for the scoring path. Replay checks them when the record has them, and always checks the per-part triangle counts.

**The licence goes out with the geometry.** Exporting a GLB or glTF from a scene that holds a record writes `source.licence`, `source.attribution` and `modifications` into the file: `asset.copyright` (one line per source: the credit, the licence, the source) and `asset.extras.strata_source` (url, commit, sha256, licence, attribution, modifications, `seg_version`). It is a copy of what the record says. When a source's licence is `null` or proprietary (SuzanneMorphSparse states none; BrainStem is under a Poser Pro EULA) the export asks first (a dialog in the GUI; the Shell's `exportGLB()` / `exportGLTF()` refuse until called as `exportGLB({ acknowledged: true })`). A missing licence is not a grant, and the file still carries exactly what the record says. `validateSource` still requires a non-empty `licence` string, so a record whose source has none cannot be written by `SEG.split` today; the export-time check is for records that arrive with `null`.

**Asking before cutting.** `SEG.wouldRefuse('#Mesh', plan?)` returns `null`, or `{ reason, detail, seg_version }`, and changes nothing. With no plan it asks only whether the node can be cut at all; with a plan it runs the same checks as `SEG.split` (`plan.method: 'material'` for `SEG.byMaterial`). `reason` is a code to switch on (`no-selection`, `not-a-mesh`, `skinned-no-skeleton`, `skinned-subdivide`, `morph-targets`, `multi-material`, `bad-source`, `plan-coverage`, `plan-names`, `no-colour-evidence`, `name-in-use`, `unattached`, …; anything else is `plan-invalid`) and `detail` is SEG's own message. A tool that triages meshes asks this instead of copying the rules: skinned is fine unless the plan divides it by colour with `subdivide`, and the answer stays right across versions because it is the same code.

Verified in the editor (headless Chrome against the dev server, the Duck from the pinned Khronos commit): a plan record opens, fetches, hash-verifies and replays to ten parts with the same triangle counts as the packed record; a second open fetches nothing; a wrong hash is refused before import and the labels stay; a 404 leaves the record open with `unavailable` / `unreachable`; open, orbit, save is byte-identical; the exported GLB and glTF carry the notice (and the container is valid: header length, 4-byte JSON chunk, BIN chunk untouched); the null-licence export is refused until acknowledged; `SEG.wouldRefuse` on the Fox returns `null`, `skinned-subdivide` and `plan-coverage` as it should, and adds no undo step. Not checked: the other 99 Khronos samples, a source behind a licence gate (`fetchable: false` is handled but untried), the Avocado (8 MB) from a cold cache, or a browser other than Chrome.

### Checking and migrating

```
node scripts/verify-records.mjs record.json …                 validate, and re-fetch every source and check its size and sha256  (--offline: validate only)
node scripts/verify-records.mjs --review base.json head.json --by @name      a review PR must append exactly its derived review
node scripts/verify-records.mjs --append-review base.json head.json --by @name --method anchored|blind [--at <UTC time>]
node scripts/verify-records.mjs --hash <url>                  print { url, sha256, bytes } for a file
node scripts/verify-records.mjs --migrate record.json --sources sources.json [--out file]    legacy record → this schema, offline
```

The two records made before this schema, `duck.json` and `avocado.json`, were migrated on local copies: the cut, the names, the geometry, the materials and the plan's parts are untouched (checked by comparison), only the source (pinned and hashed), the verification block, the packaging marker and the removed presentation changed, and the migrated files pass `verify-records.mjs` with the sources re-fetched.

## A mesh with several materials

Some formats (OBJ with a material library) give one mesh several materials. That is the best case: the author of the model assigned each triangle to a material, exact evidence with no seam artefacts. `SEG.describe` lists the materials; `SEG.byMaterial('#Mesh', plan)` cuts one part per material.

```js
SEG.byMaterial('#Crate', { group: 'Crate_Parts', source })        // parts named from the materials ("Face Top" -> Crate_Face_Top)
SEG.byMaterial('#Crate', { group: 'Crate_Parts', source, parts: [ { material: 0, name: 'Crate_Lid', classes: ['lid'] }, … ] })   // or name them yourself
```

Every material with triangles must go to a part, the mesh's groups must cover every triangle, and each part keeps its material; the geometry is unchanged. The group is placed where the mesh was, in its parent's frame (under a real parent, not under an importer's wrapper). A part can then be cut further with `SEG.split` if it is textured. (The glTF importer already makes one mesh per material, so glTF models arrive cut this way.) Checked on a six-material crate on a shelf: six parts, same world position, undo restores it, replay matches.

## A scene: components, anchors, and the checks

An object (an avocado, a duck) has a handful of islands and each one is a part. A **scene** (a furnished room, a street) is one mesh, one atlas and hundreds of islands: the room used as the worked example has **538 islands in 12,151 triangles**, most of them a few triangles of trim or a prop's label, and no island is "the bed". Cutting island to part would give 538 meaningless names. SEG 1.2.0 does the steps that need no judgment and leaves the one that does:

| Step | Who |
|---|---|
| Join the islands that touch in space into **components**; measure them in the **world** frame | `SEG.components`, and `SEG.describe` / `SEG.data` on a scene |
| **Name the anchors**: the components you can justify naming, and what each name rests on | you, or a model shown the component report |
| Place every other component on the nearest anchor, by distance to its triangles, unless it is too far | `SEG.attach`, and `SEG.split` with `anchors` |
| Check the cut against the evidence; report what looks wrong | `SEG.split` (the assertions) |
| Record the plan, the parameters, the distances and what fired | the record (below) |

### Islands or components: which grain

**An island is what the texture artist separated; a component is what the modeller joined.** Islands are welded on position and UV, so a texture seam splits one physical object into several islands. A component welds on **position only** (to 4 decimals, mesh units) and joins every pair of islands that share a vertex. Every island lies in exactly one component, so a plan may list islands or components.

The host chooses the grain for `SEG.describe` and `SEG.data`: **components when there are at most three for every four islands** (`SCENE.grain_ratio`) *and more than one*, islands otherwise. If the components are far fewer than the islands, the mesh was unwrapped in pieces and the island is the wrong unit; if they are about as many, nothing joined and the island is a fine unit; if everything welds into a single component (a skinned animal, a character) there is nothing for the scene grain to say and the islands are the only grain (SEG 1.4.0; before it, such a mesh reported one component). The room has 538 islands and 282 components. A caller can say which: `SEG.describe('#Mesh', 3, { grain: 'islands' })`, or `{ grain: 'components' }`. The report says which it is, and the grain the plan was written against is recorded (`grain`).

**The report's shape is part of the decision.** An object report leads with the island's texture position and ends with colours; a scene report leads with triangles, **size and position in the world**, and puts colour last, because in a room it is size and position that tell a wall from a prop, and the texture is often one dark atlas. This is chosen by the host from the grain, not left to the caller; the caller can override the grain and so the shape.

```
component 21: 118 triangles (4 islands: 36,84,123,251), size 5.694,0.471,7.736, centre 1.660,5.691,0.475, at 0.67,0.96,0.55, colours rgb(197,240,225) 59%  rgb(55,80,71) 21%  rgb(132,170,156) 20%
component 29: 75 triangles (11 islands: 122,186,245,246,247,248,…), size 9.193,1.007,7.028, centre 0.355,0.522,0.769, at 0.54,0.09,0.59, colours rgb(14,18,14) 42%  rgb(28,36,27) 40%  rgb(48,61,48) 18%
(538 islands joined into 282 components where they touch in space; world frame, y up. …)
```

Components are numbered largest first (ties by the lowest island), so the numbers are the same every run.

### The world frame

Component `size`, `centre` and `at` are measured after the node's world matrix is applied. An importer often rotates a Z-up model upright, and then "up" in the mesh is not `y`: on the room, the ceiling is at `at.z` 0.04 and the floor at 0.91 **in the mesh frame**, and 0.96 and 0.09 on `y` **in the world frame**. Every number looks fine either way, and the mesh-frame one is wrong for anyone asking what is high. (The descriptor writer, `descriptors.js`, already measures with `Box3.setFromObject`, which is world.) The *island* report, `SEG.describe` on an object, still uses the mesh frame, as documented above; the record says which frame a scene's numbers are in (`attach.parameters.frame`).

### Anchors and attachment

```js
SEG.components('#Mesh')              // the component report as objects: component, islands, triangles, size, centre, at, colours
SEG.attach('#Mesh', anchors, { maxDistance, tie })   // where everything would go; nothing is cut
SEG.split('#Mesh', { group, source, anchors, attach: { maxDistance, tie } })     // cut: the model writes anchors and names, the host places the rest
```

An anchor is `{ name, classes, component: n | [n, …], basis }`. The components it names are its own and are never moved. `basis` says what the name rests on: any of `position`, `size`, `colour`, or `shape` (all you can honestly say is what the form looks like: `Dark_Console_Unit`, not `Fridge`). It is optional, it is recorded, and `signals.names_by_basis` counts `evidence` (any of position, size, colour), `shape` and `unstated`. Parts that are not anchors can be given as `{ component, name, classes }`; with anchors they must be given by component, not by island.

`SEG.attach` returns `{ parts, unattached, tie_broken, parameters, per_part }`. The rules, which are fixed and recorded:

1. **Distance is to triangles, not to vertices.** A floor is a few huge triangles, and its vertices are metres from anything standing on it. Each unnamed component is sampled at the centres of up to `attach_samples` (6) triangles per island, and its distance to an anchor is the shortest from a sample to any triangle of the anchor, in world units.
2. **Ties go to the smaller thing.** The nearest anchor wins, except that every anchor within `tie` (`attach_tie`, 0.05 world units) of the nearest is tied with it, and **the one with the smaller bounding box wins**: a prop beats the structure it stands against. The components the rule gave to an anchor that was not the nearest are listed in `tie_broken`. `tie` is absolute, in world units, so it should be changed with the scene's scale.
3. **Beyond `maxDistance`, nothing is attached.** There is always a nearest anchor, so without a limit a lamp standing alone across the room would join the nearest wall, and a component that is really an object of its own would be absorbed silently. `maxDistance` defaults to `attach_max_fraction` (0.1) of the scene's bounding-box diagonal (1.448 on the 14.48 room) and the value used is recorded with whether it was the default. A component beyond it is returned in `unattached` with its nearest anchor and the distance, and **`SEG.split` refuses**, changing nothing, until every one is named as an anchor of its own, or described like `Dark_Console_Unit`, or the limit is raised on purpose.

`SEG.split` accepts `anchors` and `parts` together only if the parts are given by component and share no component with an anchor.

### The checks

After the cut the host checks it against the evidence it was made from, and says what looks wrong. **It never corrects anything**, and it does not stop the cut (one undo step): the right response to a failed check is to undo and cut again from a revised plan, and that decision belongs to whoever wrote the plan. Each check names the assertion, the part and the numbers, in the return value (`⚠ oversize: Wall_Front_Right_Column: …`) and in `signals.assertions`; the thresholds (`ASSERTIONS` in [`meshSegment.js`](../docs/editor/js/intelligence/meshSegment.js)) are in `signals.assertion_parameters`.

| Assertion | Fires when |
|---|---|
| `oversize` | a part's box spans at least 60% of the scene on **every** axis while it carries less than 25% of the surface: trim, or several objects, swallowed |
| `engulfing` | a part's box contains at least half of the other parts' centres while it carries less than 10% of the surface |
| `absorbed` | a part assembled from at least 8 components whose main colour holds at least 85% of its texture footprint (needs a texture) |
| `orphan sink` | one part received at least half of the components that were attached, out of at least 10 (only with anchors) |

A part that **declares itself spread out** (a class of `trim`, `frame`, `cable`, `pipe`, `wire`, `rail`, `network`, `edge` or `outline`) is exempt from `oversize` and `engulfing`: that is how the fix for the first room cut is written, as one part named `Doorway_Frame_And_Trim` with class `trim`. Fewer than four parts are not judged. Two deliberate differences from "named as a prop": a part is judged by what it declares, not by a list of prop names, and `oversize` needs the box to fill the scene on all three axes, because a floor or a wall is flat and cannot.

On the room, the first plan fires `oversize` on `Wall_Front_Right_Column` (it spans 70%, 92% and 99% of the room on x, y, z with 14% of the surface: it had swallowed the room-wide trim) and `orphan sink` on `Plant_Cluster` (169 of the 261 attached components). The corrected plan, with the trim declared, fires only the sink: the plant cluster really is the room's catch-all, and the check says so.

### What the scene record adds

In `userData.segmentation`, besides everything in the table above:

| Field | |
|---|---|
| `grain` | `components` (or absent for an island or material cut) |
| `describe` | `{ grain: 'components', k, components: [...] }`: the report the anchors were chosen from |
| `plan` | verbatim: the anchors, names, classes, `basis`, `attach` and source |
| `attach.parameters` | `max_distance`, `max_distance_default`, `tie`, `samples_per_island`, `weld_digits`, `scene_diagonal`, `frame: 'world'` |
| `attach.per_part` | per part: `anchor_components`, `attached_components`, `components`, and the `median`, `p90` and `max` attachment distance |
| `attach.tie_broken`, `attach.unattached` | the components the tie-break decided; the ones left over (empty when the cut was made) |
| `signals` | `island_count`, `component_count`, `anchor_count`, `components_per_part` (a part of 168 components is a different claim from one of 1), `names_by_basis`, `assertions`, `assertion_parameters` |

`SEG.replay('#Mesh', record)` recomputes the components and the attachment from the recorded plan and parameters, and refuses, before changing anything, if the mesh's components differ from the recorded report (a different triangle count, or different islands in a component). Run on a fresh import of the room, it gave the same 14 parts, triangle for triangle, and the same attachment record.

**Known weaknesses, seen on the room.** Thin parts that run through the scene attach to whatever is nearest at their samples, which is why the first cut failed (declare trim as its own part). Things that rest on a surface take that surface's name by distance, so a clutter of small items inherits the name of what is beneath it. Colour is weak evidence on a dark atlas; position and size did most of the work. The thresholds were set on one room and one failure. The names are a reading of the evidence, not a measurement; the record says what they rest on, not that they are right. The method names objects, not their sub-parts (the cat is one part). And anchors are still chosen by a person or a model: no step here recognises anything.

Meshes that are already one mesh per material (glTF importers do this) are better served by [`SEG.byMaterial`](#a-mesh-with-several-materials) first, and then this method inside the largest one. In the room, `Object_4` (the textured one) was cut this way; `Object_5` and `Object_6` were left whole. The tutorial is [Cut a scene into named parts](../docs/about/tutorials/segment-a-scene.html).

## A skinned mesh: the skeleton stays

SEG 1.4.0 cuts skinned meshes (an animated character or animal), which earlier versions refused. A skinned mesh is bound to a skeleton and its animation clips move the *bones*, so a cut must not touch either. Each part is made as a `SkinnedMesh` bound to the **same skeleton** with the original bind matrix and bind mode, and the `skinIndex` and `skinWeight` of every vertex are copied unchanged (the cut already gives each part its own vertices, carrying every attribute). The clips target bones by name, so they drive every part.

```js
SEG.split('#fox', { group: 'Fox_Parts', source: window.src, parts: [ { island: 0, name: 'Fox_Body_And_Head_Left', classes: ['body', 'head', 'left'] }, … ] })
```

- **The rig stays in the scene.** The importer's wrapper holds the bones as well as the mesh, so `SEG` does not remove it (it removes only wrappers that hold nothing else). Give the wrapper and its bones a class (`scene.getObjectByName('Fox.glb').traverse(o => tagClass(o, 'rig'))`) and `requireLabels(true)` passes; the new group goes under the scene, in the same world position.
- **`subdivide` is refused** on a skinned mesh (`SEG.split: a skinned mesh cannot be divided by colour with subdivide (…)`). A vertex halfway along an edge of a triangle has no bone index of its own, and averaging indices picks the wrong bone. A `palette` with `subdivide: 0` is allowed: it sorts whole triangles by their colour and creates no vertices.
- **Weights are not read.** `SEG` uses islands and colours. A fox's head and body are one island with the same colours, so the name is a compound (`Fox_Body_And_Head_Left`) exactly like the duck's, even though the skeleton separates them (in the left part, 100 of 339 vertices have `b_Head_05` as their strongest bone, and they are the front ones). Cutting by bone weight would be a new kind of evidence and is not done.
- **The report is the object report, in the mesh frame.** A skinned animal is one welded surface, so its islands join into one component; `SEG.describe` reports islands when the components come to one (`grainOf` returns `islands` for fewer than two components), because a one-line scene report says nothing.
- **The record says so**: `modifications` gains a line that the parts are bound to the original skeleton, and the replay needs the same skinned mesh.

Checked on `Fox.glb` (see the table below): nine parts, 576 triangles, the original and the cut posed with the `Run` clip at 0.37 s give the same world-space position for all 1,728 skinned vertices (to a millimetre), undo and redo round-trip, the scene saved to JSON and opened again has nine skinned meshes on one skeleton with all three clips and an identical record. The Shell's `exportGLB()` writes the nine skinned meshes with 24 joints each but **no animations** (it passes none, for any scene); the Export tab's GLB path was not run on the fox. The clips were driven by a script, not from the Animations tab.

## What it refuses, and what it cannot do

| | |
|---|---|
| **Refuses** (with a message that says why) | a node that is not a mesh; a skinned mesh with no skeleton, or one **divided by colour with `subdivide`** (see [skinned meshes](#a-skinned-mesh-the-skeleton-stays)); a mesh with **morph targets**; a colour cut on a mesh with no UVs or no base-colour texture; a plan with no `source`, a default or repeated name, a part with no class, an island left over or used twice. `SEG.split` on a mesh with several materials is sent to `SEG.byMaterial`. |
| **Cannot decide for you** | what an island *is*. A toy duck's body is one island but its wing is two; a model whose islands are not parts gives meaningless names if cut island to part. Look at `SEG.describe` and merge islands (`island: [..]`); for a scene with hundreds of islands see [components, anchors and the checks](#a-scene-components-anchors-and-the-checks). |
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

The tutorials: [**Cut any textured mesh into named parts**](../docs/about/tutorials/segment-any-mesh.html) (the general case, with an avocado, a toy duck and an animated fox), [**Cut a scene into named parts**](../docs/about/tutorials/segment-a-scene.html) (a furnished room: components, anchors and the checks) and [Cut an avocado into named parts, building the tool by hand](../docs/about/tutorials/segment-a-mesh.html) (the tool written out step by step).

## Sample models used

| Model | Source | Licence | Scene |
|---|---|---|---|
| Avocado | [Khronos glTF Sample Models](https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Avocado/glTF-Binary/Avocado.glb), Microsoft | CC0 1.0 | `avocado.json` in `tejaswigowda/test1` |
| Fox | [Khronos glTF Sample Models](https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Fox/glTF-Binary/Fox.glb): low poly fox by PixelMannen, rigging and animation by [@tomkranis](https://sketchfab.com/models/371dea88d7e04a76af5763f2a36866bc), glTF conversion by @AsoboStudio and @scurest | Model [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); rigging and animation [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (attribution required: it goes in `source.attribution`) | `fox.json` in `tejaswigowda/test1` (plan, pinned source `d97044e7…94771f7`, 162,852 bytes), with `licenses/fox-NOTICE.md` beside it (the CC BY 4.0 credit and the modifications) and the same licence, credit and modifications in the scene's own record |
| Duck | [Khronos glTF Sample Models](https://github.com/KhronosGroupArchives/glTF-Sample-Models/blob/main/2.0/Duck/glTF-Binary/Duck.glb), © 2006 Sony Computer Entertainment Inc. | SCEA Shared Source License 1.0 (derivatives may be redistributed with the licence and notices and the modifications identified; as-is, no warranty) | `duck.json` in `tejaswigowda/test1`, with `licenses/SCEA-Shared-Source-License-1.0.txt` and `licenses/duck-NOTICE.md` beside it, and the same licence, credit and modifications in the scene's own record |
| Cyberpunk micro-apartments (the scene example) | [Sketchfab](https://sketchfab.com/3d-models/cyberpunk-micro-apartments-fd8011e2af0e43288f5445600197ea77), Mikita_Hubanau | CC Attribution-NonCommercial | none: not redistributed, and its segmentation is not committed |

## Tests

```
node docs/editor/js/intelligence/__tests__/meshSegment.test.mjs    # islands, colours, the plan's refusals, subdivision by colour, carved arrays, the source requirement,
                                                                    # the record (plan verbatim, modifications, signals), the replay round trip (G4), the cut by material,
                                                                    # the colour under a part (not the whole atlas);
                                                                    # a scene, on a synthetic Z-up room of boxes: components (H1), attachment and the tie-break (H2),
                                                                    # the world frame (H3), each assertion and the re-created bad plan (H4), the limit (H5),
                                                                    # the scene record and its replay (H6);
                                                                    # a skinned mesh: bone indices and weights survive the cut, subdivide is refused, one component reports islands
ROOM_GLB=/path/to/cyberpunk_micro-apartments.glb \
node docs/editor/js/intelligence/__tests__/meshSegmentRoom.test.mjs  # the same gates on the real room, from the .glb alone (skipped without the file)
```

Verified in a real browser on both models (SEG 1.1.0), importing the `.glb` and pasting the tutorial's blocks: the parts add up (avocado 483 + 158 + 41 × 256 = 11,137; duck 2,532 + 882 + 160 + 160 + 112 + 90 + 276 × 16 = 8,352), the scenes pass `lint()` and `requireLabels(true)`, they load again from the committed files, and one `Undo` restores the importer's original (`Avocado.glb` > `Avocado`).

The scene calls (SEG 1.2.0) were verified on the room in a fresh editor: `SEG.describe` reports 282 components in the world frame, a cut from 14 named anchors gives 12,151 triangles in 14 parts with the record above, and `SEG.replay` after an undo reproduces the same parts and attachment. The avocado and duck tutorials were not re-run on 1.2.0 in a browser; their island reports are unchanged by design (the island report and the island plan are as before, and on an object the grain is `islands` unless components are at most three for every four islands, which was not checked on the duck).
