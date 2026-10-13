# Face bind

Starts from **a photo of a face** and binds it to a **base VRM**, on device. The page reads the face with an
on-device face model, makes a face-blendshape GLB from it (the
[face-to-blendshape-3d](https://github.com/tejaswigowda/face-to-blendshape-3d) autorigger), and gives the VRM a
weight map that says "face morph *i* drives this VRM expression morph", so a face performance (facerig /
mocap / the `driveFace` shell global) animates the VRM's expressions.

- **Inputs:** a base VRM and a photo (or, to skip the photo step, an existing face-blendshape GLB: a standalone
  face mesh, N morph targets, PBR materials, no skeleton). Nothing else.
- **Output:** the base VRM with an `extensions.STRATA_face_bind` block added. Download +
  `window.__webcli_result`.
- **Base VRMs:** the page defaults to the bundled VRoid **male** base, with **female** one click away (`?vrm=female`).
  They are the unmodified [hinzka](https://github.com/hinzka/52blendshapes-for-VRoid-face) models, in
  [`docs/facebind/base/`](../docs/facebind/base/README.md); your own VRM (URL or file) overrides them.
- **Page:** [`docs/facebind/`](../docs/facebind/index.html) (`/facebind/` on the site), with a 3D preview.
- **Privacy audit:** [FACE_BIND_PRIVACY.md](FACE_BIND_PRIVACY.md).
- **Code:** [`docs/editor/js/facebind/`](../docs/editor/js/facebind/bind.js).

## What it is and is not

**Expression binding first, a photo-informed look second, never a likeness guarantee.** The core is the weight
map. On top, optionally, the face shape and some colors are nudged toward the photo ("Matching the photo", below).
An anime base will still look like an anime character; this gets closer, it does not get identical.

**Rig-safe.** The skeleton, skin weights, morph deltas, textures, hair and body are carried through byte for
byte, and the face GLB's mesh is never grafted on. The only changes to the VRM are:

- the bind block and `extensionsUsed`;
- (optional) the base **POSITION**, **NORMAL** and **TANGENT** (if present) data of the face's and the hair's own vertices (shape, volume, height, length, fringe);
- (optional) material colors (skin, hair, iris, brow) and their MToon shade colors;
- (optional) one appended PNG for the face skin texture (painted facial hair), see below;
- (optional) **bald**: the hair is left out of the scene (see [Bald](#bald-no-hair)).

**The outfit is never touched.** Only the face and the hair change. The clothing materials (tops, bottoms, shoes), their colors, textures and meshes are
identical in the output, and a test checks it. The skin tone is also applied to the body's skin material, so the neck and hands match the face; that is skin, not clothing.

The normals of a warped vertex are not recomputed from the triangles (that would flatten the artist's hard edges and seams, which are split vertices). Each one is carried through the warp with the inverse transpose of the warp's Jacobian, so seams stay and the shading follows the new surface; vertices the warp does not move keep their exact normals, and the morph targets' normal deltas are relative and left alone.

`bindVRM` audits this before it writes: the JSON diff may only touch those paths and the moved POSITION accessors'
min/max, and every byte of the binary chunk outside the face's and the hair's own vertices must be identical (the body
vertices that share an accessor with the back hair included), or it refuses
(`RIG_UNSAFE`). Because the morph targets are deltas, every existing blendshape keeps working on the reshaped
face, and bodyrig still bakes the body unchanged.

## From a photo

```
photo (local File) -> MediaPipe Face Landmarker (on device, CPU) -> face-blendshape GLB (in memory) -> bind
```

- The landmarker is **vendored** in [`docs/facebind/vendor/mediapipe/`](../docs/facebind/vendor/mediapipe/README.md)
  (`@mediapipe/tasks-vision` 0.10.35 JS + SIMD wasm, and `face_landmarker.task`, all Apache-2.0, with SHA-256s).
  The original tool loads these from jsDelivr and Google Cloud Storage; here nothing is fetched from a CDN. The
  files are static, same-origin, and loaded once when the page opens (the model status line says when it is ready).
- The autorigger is vendored unmodified in [`docs/facebind/autorig/`](../docs/facebind/autorig/README.md); the glue is
  `faceFromImage.js`. The generated face GLB is kept in memory and offered as a local download.
- The photo needs a clear, front-facing face. No face found → `NO_FACE_DETECTED`.
- The photo is never a URL: `?image=` is ignored, and a string passed as `image` is rejected (`IMAGE_MUST_BE_LOCAL`).

## Zero egress

The photo, the face GLB made from it and everything derived from them (landmarks, hair mask, measurements,
colors, the reshaped VRM) are identity data. They are processed in this page and never sent anywhere. The full
audit (data inventory, every network request, threat model, findings and how to verify it yourself) is in
**[FACE_BIND_PRIVACY.md](FACE_BIND_PRIVACY.md)**. In short:

- **Local inputs only.** The photo and face GLB are a chosen or dropped file, or bytes handed to
  `window.__facebind.run`. A URL for either is rejected (`IMAGE_MUST_BE_LOCAL` / `FACE_MUST_BE_LOCAL`), and
  `?image=` / `?face=` are ignored, in the headless/agent path too.
- **No network code touches them.** The bind, face, hair, reshape, preview and autorigger modules contain no
  `fetch`, XHR, WebSocket, beacon, storage, `postMessage` or computed dynamic import. `page.test.mjs` scans every
  file and fails the build if one appears.
- **No workers.** The models run on the main thread, so the request log is complete; workers are refused by the guard and by `worker-src 'none'`.
- **Real headers.** `ops/cloudflare/` has the response headers (CSP, Referrer-Policy, nosniff) for Cloudflare; they are prepared but not live, because the site is served directly by GitHub Pages today.
- **GET only, same origin.** The page's Content-Security-Policy allows scripts only from this origin (plus the hash
  of its one import map), and [`egressGuard.js`](../docs/facebind/egressGuard.js) refuses everything except GET
  without a body to this origin, in-memory `blob:` data, or the one base-VRM URL you typed. Every request is logged
  and shown under "Network audit".
- **No CDN, no cloud model.** MediaPipe (JS, wasm, face model, hair model) is vendored with SHA-256s and runs
  on the CPU. Nothing is fetched from a third party at run time.
- **Works offline.** The models load when the page opens, so the photo, bind and preview steps run with the network
  off (use your own VRM file, or one already loaded: the bundled bases are fetched at bind time).
- **Nothing is stored.** No `localStorage`, IndexedDB, cache or service worker. Object URLs are revoked when you run
  again.

What this does not cover: a compromised host that serves you different code, browser extensions, files you
download and then share, and the Strata editor's own features (Git, optional AI) once you open the bound VRM there.
Details in the audit.

Packaging: in a browser the CSP and the sandbox enforce the network limits and you can confirm them in the network
panel. A desktop (Electron) shell has no such sandbox, so there it is policy plus the audit log, not the same claim.

## Preview

After a bind, the page shows a 3D preview (three.js, drawn on this device from the bytes in the page). Switch
between the **bound** VRM and the **base** to compare, and drag to rotate. **Shading** has a flat mode (the VRM's own
unlit materials) and a toon-lit mode that shades from the vertex normals, so you can see that the reshaped face and hair
shade smoothly (it is a stand-in for MToon, which needs the editor's WebGPU renderer, and reads the same normals).

**Expression.** From a photo, the preview starts with the **expression in the photo**: MediaPipe's 52 face
blendshape scores for the photo (jaw open, smile, squint, brow raise, gaze and so on) are mapped to ARKit names and
applied to the VRM. The 42 shapes the face GLB has go **through the bind map**, and the other ARKit shapes the VRM
has but the face GLB does not (for example `mouthPress*` and `mouthRoll*`) are applied by name, so the preview is as
close to the photo's expression as the VRM allows. The note under the preview lists the strongest shapes. Switch to
**Neutral**, or to **Sliders** (jaw open, smile, blink, brows up) to pose it yourself; moving a slider switches to
Sliders. With a face GLB instead of a photo there is no expression to read, so it starts on Sliders.

The scores are a model's estimate from one image, so small or noisy values are normal for a neutral photo. The
expression is also in `window.__webcli_result.expression` (name to 0..1) for agents.

The preview is flat (the VRM's unlit materials, no MToon shading). It reads the in-memory VRM through
`GLTFLoader.parse`; its textures are `blob:` URLs of in-memory data, which is why the CSP's `connect-src` includes
`blob:`.

Note: the vendored autorigger writes the photo's expression into the face GLB's morph weights by array position
rather than by name (its 52-name order differs from its 42 morph order), so those weights are not the photo's
expression. The page does not use them; it uses the named scores directly.

## The binding

1. **Names.** The autorigger's morphs are named by bare index on the mesh. The sample also carries semantic ARKit
   names on `primitive.extras.targetNames`, which are used when present (`nameResolution: "primitive.extras.targetNames"`).
   If a file has **the autorigger's own structure** (a `faceMesh` node with its `faceWidth` / `faceHeight` /
   `aspectRatio` extras, 478 vertices, a three.js export, mesh-level names exactly `0` to `41`) but no semantic names,
   the standard 42-morph order is assumed and the bind is flagged **`convention`**. That flag is loud on purpose: the
   warning is in the `STRATA_face_bind` block (`warnings`), in `window.__webcli_result.warnings`, in a banner on the page,
   and in the result of `applyFaceWeights` / `driveFace`, and a facerig or mocap consumer must show it. **Any other
   index-only file, even with 42 morphs, is `unresolved`: nothing is mapped** (a different tool's order would map to
   plausible but wrong expressions). Pass `names` to bind it.
2. **Map.** Face morph → ARKit name → the VRM's morph target of the same name (the VRoid/hinzka bases have all 52).
   Weight 1.
3. **Gaps are logged, never synthesised.**
   - `unmapped`: a face morph with no VRM target (skipped).
   - `undriven`: ARKit shapes the VRM has but the face GLB has no morph for. For the 42-morph sample these are the
     10 `mouthDimple*`, `mouthPress*`, `mouthRoll*`, `mouthShrug*`, `mouthStretch*` shapes (42 vs the full 52).

The block, on the VRM's root `extensions`:

```json
"STRATA_face_bind": {
  "version": 1,
  "scope": "expression-bound; optional photo-informed face proportions and colors are approximate; not a likeness guarantee",
  "source": { "morphCount": 42, "nameResolution": "primitive.extras.targetNames", "names": ["eyeBlinkLeft", "…"] },
  "map": [ { "source": 0, "name": "eyeBlinkLeft", "targets": [ { "mesh": 0, "morph": 13, "name": "eyeBlinkLeft" } ], "weight": 1 } ],
  "unmapped": [], "undriven": ["mouthDimpleLeft", "…"]
}
```

The block holds only generic morph names and counts: nothing from the person's mesh, texture, measurements or colors. (The reshaped geometry and tinted colors of the bound VRM are derived from the photo, though; see the privacy audit.)

## Driving it

Strata keeps the block on the loaded scene (`scene.userData.faceBind`). In the JS Shell:

```js
const V = scene.children.find(o => o.name.endsWith('.vrm'));
driveFace(V, [0.2, 0, 0, /* … one weight per face morph … */ ]);   // by source index
driveFace(V, { jawOpen: 0.7, mouthSmileLeft: 1, mouthSmileRight: 1 }); // or by name / index
```

`driveFace` sets morph influences only (clamped 0–1) and returns `{ applied, skipped }`. A facerig/mocap
integration reads the same block from the file and writes the weights itself.

## Matching the photo (optional, approximate)

All measured on device from the photo's 478 landmarks (and the vendored hair segmenter), embedded in the face
GLB's node extras, and read back by the bind. Head roll and yaw are removed first.

| What | Measured from the photo | Applied to the VRM |
|---|---|---|
| **Face shape** | eye spacing, eye width and openness, mouth width, jaw width, nose-tip / lip / chin depth (all as ratios of head width, so photo size drops out) | a smooth local warp of the face's base positions (`FaceRefine.js`); eyes, mouth, jaw and the nose / lips / chin profile. Limited (jaw ≤ ±12%, eyes ±25–30%, depth clamped to human ranges) and faded out before the head outline, so hair, ears and neck still meet the face |
| **Hair shape** | the **silhouette of the hair mask** in head units: how far the hair reaches out on the image-right and image-left at each height (18 bands), how high it reaches over each sideways band (12 columns), and where its lower edge sits over the forehead per column (the fringe), plus a scalar summary | a smooth warp of the VRM's existing hair vertices toward that silhouette: each side's reach (ratio 0.94 to 1.2 per height: the hair sits only a centimeter or two outside the skull, which does not move, so it cannot shrink much), crown height per column (0.92 to 1.25), length below the ears per side (0.6 to 1.6), and the fringe edge per column (up to 0.35 E), each move capped at 13 cm. Hair longer than the photo's is **pulled up** and a lower fringe is **lifted**, smoothly and without folding (see below). The same silhouette is measured on the VRM's hair mesh, so the warp is the difference between the two. Bands the photo crops, bands with only a few hair pixels, and hair not connected to the head (a collar the segmenter called hair) are skipped, and a measurement fades back to "no change" away from where it was taken. Without a profile the scalar summary is used |
| **Skin tone** | average of five patches of the face | the face skin material, tinted toward the photo; then **every other skin material (the body, hands, neck) is tinted to render exactly the color the face renders**, whatever its own texture is, so the whole body has the face's tone. A tint can only darken, so a body texture darker than the face stays as close as it gets (reported as not reached) |
| **Hair color** | the hair segmenter's mask, trimmed of shadows and highlights | hair materials. Skipped if little hair is found |
| **Eye color** | a disc inside each iris | iris material |
| **Brow color** | the darker half of the brow polygons | brow material |
| **Facial hair** | how much darker the area above the lip, the chin and the jaws are than the cheeks of the same face (three amounts, 0 to 1) | **dots painted into the face SKIN texture**, see [Facial hair](#facial-hair-painted-on-the-face-texture). Nothing is painted for a clean-shaven face |

### The swept-up cut (how the length and fringe are moved)

When the photo's hair is shorter than the VRM's (or its hairline is higher), the VRM's hair gets the same smooth vertical field as a hand-made
"swept-up" restyle of this VRoid male base. It is a field on the VRM's own hair vertices and nothing is folded or deleted. It was measured
vertex by vertex from that restyle (the stock hair against the restyled hair, same mesh, same 8,650 vertices) and it reproduces the restyled
hair within about 9 mm RMS in height (doing nothing is 44 mm off). In units of E (the eye-to-chin height, about 10 cm on the base):

- **Pinch at the ear line.** The hair at the ear line (v about 0.16 above the eye line) stays where it is. Above and below it the lift grows as
  `1 - exp(-((v - 0.16) / 0.55)^2)`: about **0.44 E at the bottom** (the sides and back come out shorter and the ears show) and about **0.44 E at the top**
  (a taller crown). A photo with shorter hair uses more of it: the bottom lift is `min(0.55, how much shorter)` (0.55 is the most that cannot fold the strands), and the top lift is capped at 0.44 and scaled by how tall the photo's crown is next to the VRM's (full at 1.0, none at 0.7 or lower), so a photo with a low crown gets less hair, not a taller head.
- **Fringe.** The front is lifted more: about **1.15 E at its lower edge** (v about -0.25), falling off over 0.8 E upward and 0.35 E downward,
  plus a small lift (0.15 E) that the front keeps up to the crown, strongest at the middle of the forehead and weaker toward the sideburns (1.0 at
  the middle, 0.8 at 0.27 head widths, 0.3 at 0.53). The lifted fringe also moves **back toward the head by 20 percent of its lift**, to follow the
  head's surface.
- **Back-hair layer.** The layer of hair under the strands (the `HairBack` material) follows the same pinch, but its top is lifted only 0.44 times as much and it has no
  fringe lift, so it stays low and shows as a band between the lifted fringe and the forehead, as in the restyle.
- The top spreads sideways by 8 percent. The photo's crown measurement is not allowed to shrink the crown while this lift is used.
- The amounts come from the photo (`hairShape.applied.swept` in the report, and the page lists them): no swept-up lift when the photo's hair is as long
  as the VRM's. Strength scales all of it (the page now defaults to 100 percent, which is what the restyle used; 70 percent gives 70 percent of every lift).
- Folding strands onto a line and cutting hair back where the mask shows skin, an earlier approach, left bald patches and gaps and is gone.
- Limits: the field was measured on one restyle of one base (the male; the female base has different hair, so the fit is approximate there), it was hand-made, so it
  is a look to copy and not something a photo measurement can derive, and the largest move is capped at 13 cm.

### Proportional hair (short cuts)

The hair follows the photo's proportions, so a short cut gives a short cut: the side and crown scale limits go down to 0.7 (they were 0.94 and 0.92, which left a short-haired photo with a
helmet of VRM hair), hair that ends above the ear line in the photo takes the shortest length the plan allows, the crown is not lifted for a photo whose crown is low, and the scalp step also pulls
hair that the reshape pushed into the head back out to a 4 mm shell. The texture estimate is not trusted on short hair (it mostly reads cut hairs and scalp), so it falls back to straight unless you pick a texture.
Check: `~/Downloads/test.png` (a short-sided cut) now binds to a compact cap with the forehead and ears clear, where before it was a full curly mop.

### Scalp hug (so it does not look like a wig)

The swept-up lift raises the crown by about 4.5 cm, which leaves the hair floating about 5 cm off the skull (median, measured on the male base)
and reads as a wig. After the lift, hair that has come away from the skull is pulled back toward it:

- **The skull** is estimated from the VRM itself: the face mesh covers only the front of the head, but the hair covers all of it, so the innermost points of
  the hair and the face together trace the scalp. It is a smoothed height field of the smallest radius in every direction from a point inside the head
  (`scalp.js`).
- **The pull.** Each hair vertex remembers how far it was from the skull before the lift (its own thickness). Afterwards, only `1 - hug` of the extra distance is left:
  the vertex is moved along the line from the center of the head so that it sits at its old thickness plus `(1 - hug)` of what the lift added. Hair that is not floating
  is not moved. The pull fades in from the ear line (none below it, full from the brow up), because the hair below hangs free past the ears and the neck.
- **Amount.** `hairShape.hug` (the page's "Scalp hug" slider, default 80%): 0 keeps the full lift, 1 puts the crown back at the stock distance. On the
  male base the crown hair's distance from the scalp is 5 mm stock, 48 mm lifted without the hug, 14 mm at 80 percent and 5 mm at 100 percent.
- The back-hair layer under the strands is held 20 percent closer than the strands, so the layers do not cross.
- Limits: the skull is an estimate from the hair itself, so it cannot be more accurate than the stock hair's fit; a strong pull compresses the cards toward the head, which
  can show as banding in the toon-lit preview; and the hug cannot add hair where the lift left the scalp uncovered.

### Bald (no hair)

The preview has a **Bald** checkbox. It binds the VRM again without its hair (the photo is not read again, about 2 seconds), so **the preview and the download are the
same file**; unchecking it puts the hair back. `bindVRM(..., { bald: true })` and `window.__facebind.run({ ..., bald: true })` do the same.

How: every node whose mesh is all hair loses its `mesh` and `skin`, and a hair primitive that shares a mesh with other parts (the VRoid back hair sits on the body mesh)
is dropped from that mesh's primitive list. No byte of the binary chunk changes (the unused hair data stays in the file), no bone is touched, so the skeleton, the spring bones,
the body and the clothing are exactly as before. The VRoid face mesh is the whole head, so the scalp is already there under the hair. The audit allows exactly
these paths (`/nodes/N/mesh|skin|weights` for the hair nodes and `/meshes/M/primitives` for mixed meshes) and nothing else. Hair shape, style, cut and the hair tint are skipped with a
warning when bald, and the report lists `hairRemoved`. Facial hair painted on the face texture stays.

### Hair style

Two independent choices on the page (and `opts.hairStyle = { cut, texture }` in `bindVRM`):

| Choice | Values | What it does |
|---|---|---|
| **Cut** | `photo` (default), `keep`, `crop`, `bob`, `long`, `afro` | `photo` fits the silhouette to the photo's hair as above. `keep` leaves the VRM's cut. The presets replace the photo's silhouette with a reference one (a short crop, a bob, long hair, a rounded afro) and allow larger changes than the photo fit (length down to 0.1 or up to 2.8 times, volume up to 1.6 times for the afro). |
| **Texture** | `auto` (default), `straight`, `wavy`, `curly`, `coily` | Re-lays each lock of the VRM's hair. `auto` uses an estimate from the photo; an afro cut implies `coily` unless you pick one. |

How the texture works: the VRM's hair is made of ribbon "cards" (one per lock, 103 on the VRoid bases). Each card is
found as a connected piece of mesh, its root is pinned to the scalp, and the rest of it is bent along a helix around
the lock's own direction, with each lock's ribbon made 20 to 40 percent wider (so re-laid locks keep overlapping and the scalp does not show), a little shrinkage and a radial puff away from the middle of the skull (more for tighter textures). The helix phase varies smoothly over the scalp, so neighboring locks curl together and keep covering each other (random phases opened gaps). Nothing is added: the same
vertices move, bone weights and UVs are untouched, normals are carried through the same bend and the warp, and the byte
audit still passes (only the hair's own POSITION and NORMAL bytes change). It is deterministic (the phase of each lock
is a hash of its first vertex id).

Limits, stated plainly:

- **It re-lays the VRM's own hair; it does not generate a haircut.** It cannot add a braid, bun, ponytail, bangs the mesh
  does not have, or hair where the mesh has none. A cut preset is a silhouette target applied to the existing mesh, so a
  `long` cut stretches the VRM's hair rather than growing new locks.
- The texture estimate (`hairTexture` in the face GLB extras) comes from how ordered the strand directions inside the
  hair mask are, plus how ragged the outline is. It is **uncalibrated** (tested on one photo of straight hair), and dark or
  low-contrast hair is reported as `unknown`, which binds as straight. Choose the texture by hand when it matters.
- Curl and coil displacement is small and bounded (helix radius 5, 8 or 11 mm). Tight textures can leave a pinhole where the locks meet at the crown; the scalp does not show elsewhere in the views checked (front, back, below, above).
- All of it is on-device geometry math on the bytes already in the page; it adds no network request and no new data
  leaves the device.

### Facial hair (painted on the face texture)

A mustache, beard or stubble is not geometry on a VRoid base, it is texture. When the photo's lower face is clearly darker than its cheeks
(zones above the lip, on the chin and along the jaws; each gives an amount from 0 to 1) the page decodes the base's face SKIN texture on
the device, paints dark dots into the mustache, chin and jaw areas, and passes the PNG to the bind as a texture edit. The dots thin out toward the
edge of each zone and keep the lips and mouth line clear; the VRoid face texture has the same layout on every base, so the zones are fixed
texture coordinates. The dots use a darker version of the photo's hair color and a hash of the pixel position, so the same inputs paint the
same texture. Turn it off with the "Facial hair" checkbox (`facialHair: false` for agents).

It is an estimate: a shadow or a dark lip corner can read as hair, light stubble on dark skin can read as none, and a clean-shaven face
in dim light may paint a little. It only paints where the lower face is darker than the cheeks.

### Texture edits and the rig audit

A texture edit swaps the image behind one material's base-color texture. The new PNG is **appended to the end of the binary chunk** and
the image points at it, so no existing byte moves (the old image stays in the file, unused, about 0.4 MB for the face texture). The audit allows exactly
this: `images[i].bufferView` and `mimeType` for the replaced images, the new bufferView entries and the buffer length. Everything else, including
every byte of the old binary chunk outside the face and hair vertex data, must be identical or the bind refuses to write (`RIG_UNSAFE`).
`opts.textures = [ { materialIndex, png, label } ]` in `bindVRM`; the PNG must start with the PNG signature (`BAD_TEXTURE` otherwise).

### What was and was not taken from the hand-made restyle

A hand-made restyle of a VRoid base (the reference scene, a male base matched to a photo by a person in the editor) used these techniques.
The tool now copies the ones that stay rig-safe and automatic:

| Technique in the reference | In the tool |
|---|---|
| Hair lifted at the top and bottom with the ear line pinned, front lifted more, back-hair layer lifted less (no folding) | yes: [swept-up cut](#the-swept-up-cut-how-the-length-and-fringe-are-moved) |
| Hair, skin, iris and brow colors from the photo | yes (material tints) |
| Eye openness and mouth width nudged a few millimeters to a centimeter | yes (face shape warp) |
| Mustache and beard painted into the face texture | yes ([facial hair](#facial-hair-painted-on-the-face-texture)) |
| A shirt recolored to the photo's, a collar mesh added to it, trousers recolored black, the body texture cut for them, clothes cut | **no**: facebind changes the face and hair only and never the outfit (no garment color, texture or geometry) |
| Transparent texels of the back hair texture turned black | no effect worth the extra edit; it was a side effect of re-saving the texture through a canvas |

### The neck stays attached

The bottom of the VRoid face mesh is an open tube that sits on the neck of the body mesh, and the body never moves. A warp that moved the jaw, the chin or the
mouth corners there (a wider jaw, a chin pushed forward) pulled the tube away from the neck and opened a gap under the jaw, through which the inside of the mouth
showed. The face warp is therefore **faded to zero toward the neck**: the lowest 0.3 eye-to-chin heights above the rim of the face mesh (about 3.5 cm) do not move at all, and the warp
comes in smoothly over the next 0.45 (`NECK_PIN`, `NECK_FADE` in `reshape.js`). The normals follow the same field. The cost: the chin tip and the jaw angle sit just
above that zone, so a jaw widening or a chin pushed forward is a little weaker at their lower edge. A test checks that the neck zone moves less than 0.5 mm.

Notes:

- **Morph-delta fidelity.** The morph targets are deltas tuned to the original base, and they are not rescaled. A reshape
  near the clamps (jaw ±12%, eyes ±25–30%) therefore slightly distorts expression travel: a widened jaw still opens by the
  original `jawOpen` delta. The clamps bound the effect and no geometry change is needed to ship it. If a reshaped
  expression ever reads wrong in practice, scale each morph's delta by the local warp ratio (a later, optional step).
- Each color is applied as a material tint **against the material's own texture mean** (decoded on device), so the
  rendered color moves toward the photo's. A tint can only darken, so a color lighter than the texture is as close
  as it gets, and the report says so (`reached: false`).
- The MToon shade color is scaled by the same ratio so the shadowed side follows.
- The page shades the hair the segmenter found on a small copy of your photo, so you can see what the hair shape is based on (it is drawn in the page and goes nowhere).
- The hairstyle is the VRM's **own hair mesh**: it is scaled, shifted and, optionally, re-laid (see [Hair style](#hair-style)). Braids, buns, ponytails and any hair the mesh does not have are not possible. A photo that crops the head can only give partial hair measurements, and a bald or shaved head (little hair found) leaves the hair unchanged.
- Hair vertices keep their bone weights, so the hair still follows the head and the spring bones; the new shape is the new rest pose.
- Strength is 0–1 for shape and for color (default 100% for the page, 70% for `bindVRM`).
- **Not used: the photo's texture itself.** The face GLB carries a UV-mapped crop of the photo. Painting it onto the
  VRM's face texture would put a photographic face under the anime eyes, brows and mouth (which are separate meshes),
  so it would not help; the useful parts of that texture (skin, iris and brow color) are taken as colors instead, and facial hair is painted
  in as dots (see above).
- Depth from a single photo is a rough estimate; a turned head (> 25°) skips profile depth.
- Re-binding an already reshaped VRM measures it again and moves it further: bind from the base.

## Editing the bound VRM (VRM editor tools)

The preview has an **Edit** button. It opens an overlay with [VRMEditorTools](https://github.com/cecil-tools/VRMEditorTools) (MIT), a static build in `docs/facebind/editor/`, with the
bound VRM already loaded: texture and color changes, materials, meta, spring bones, screenshots, VRM 0.x / 1.0 export. Inside it, **Apply to the facebind preview** brings the edited VRM back: it replaces the
bound VRM in the preview, in the download and in `window.__webcli_result` (`edited: true`). Close or Escape leaves the overlay without applying.

- **Zero egress is kept.** The build is not the upstream site: analytics, share widgets, Firebase, Stripe and sample files are removed, and a strict CSP allows only this origin and in-memory data
  (a test checks the policy and scans the bundle). The VRM goes in and out by `postMessage` between the page and the iframe, with the origin and the window checked at both ends; it is never put in a URL.
- **What the audit covers.** The editor re-exports the VRM with its own writer, so after Apply the file is the editor's output; the face-and-hair byte audit applies to the bind, not to editor edits.
- **Binding again starts over** from the base VRM and discards the edits.
- How it was built, what was patched and how to rebuild: `ops/vrmeditor/README.md`.

## Skin tint without a photo

With a face GLB instead of a photo, only the skin tone applies (the GLB has a skin-color hint, but no measurements
and no hair, eye or brow colors). It is approximate, a material change only, and off by default. 

## The page and agents

```
/facebind/?vrm=male|female|<url>&run=1[&download=0]   auto-runs once a photo (or face GLB) is chosen from local disk
window.__facebind.run({ vrm, image, shape, look })  shape / hairShape: { strength } | omitted;  look: { skin, hair, iris, brow, strength } | omitted;  vrm: 'male' (default) | 'female' | URL | File | bytes;  image: File | Blob (never a URL)
window.__facebind.run({ vrm, face, tint })   face: an existing face GLB, File | bytes (never a URL), skips the photo step
window.__facebind.preload()                  resolves when the on-device face model is loaded
window.__webcli_result                       { ok, filename, size, bytes, blobUrl, faceGlbBlobUrl, bind, report }  or { ok:false, code, error }
```

Deterministic: the same inputs and options give the same bytes (the browser and Node produce identical output for
the sample).

## Verifying

```bash
node docs/editor/js/face/__tests__/faceRefine.test.mjs      # face warp
node docs/editor/js/facebind/__tests__/facebind.test.mjs    # bind, reshape, hair, look, rig audit (real VRM if present)
node docs/editor/js/facebind/__tests__/page.test.mjs        # CSP, import-map hash, no network code, guard, escaping, vendored hashes
```

The first two run synthetic checks plus, if present, the real VRoid male and the sample face GLB: 42 of 42 mapped,
only the face and hair vertices change, everything else byte-identical, byte-stable output. The third is the static
privacy audit. The browser checks (a photo run with every request aborted, offline binding, the preview, importing the
bound VRM into Strata) are listed in [FACE_BIND_PRIVACY.md](FACE_BIND_PRIVACY.md#verify-it-yourself).
