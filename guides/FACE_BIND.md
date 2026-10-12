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
- (optional) the base **POSITION** data of the face (its shape) and of the hair (its volume, height, length and fringe);
- (optional) material colors (skin, hair, iris, brow) and their MToon shade colors.

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
between the **bound** VRM and the **base** to compare, and drag to rotate.

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
   names on `primitive.extras.targetNames`, which are used when present. If the file has only index names and
   exactly 42 morphs, the standard 42-morph order (the sample's) is assumed and the bind is flagged
   `convention` with a warning. Any other index-only file is `unresolved`: nothing is mapped. You can pass
   `names` to override.
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
| **Hair shape** | from the hair mask, in the same head units: crown height, width at ear level, length below the ears, and where the fringe ends on the forehead | a smooth warp of the VRM's existing hair vertices: volume (×0.85–1.2), crown height (×0.8–1.25), length (×0.6–1.6), fringe edge (up to ±0.35 E), each move capped at 4 cm. Measurements the photo crops (top, sides, bottom of the frame) are skipped and listed as warnings |
| **Skin tone** | average of five patches of the face | skin materials (face and body share one tint) |
| **Hair color** | the hair segmenter's mask, trimmed of shadows and highlights | hair materials. Skipped if little hair is found |
| **Eye color** | a disc inside each iris | iris material |
| **Brow color** | the darker half of the brow polygons | brow material |

Notes:

- Each color is applied as a material tint **against the material's own texture mean** (decoded on device), so the
  rendered color moves toward the photo's. A tint can only darken, so a color lighter than the texture is as close
  as it gets, and the report says so (`reached: false`).
- The MToon shade color is scaled by the same ratio so the shadowed side follows.
- The hairstyle itself is **scaled and shifted, not replaced**. A different cut (curls, braids, a bob instead of an undercut) needs a different hair mesh, which is a separate rig step. A photo that crops the head can only give partial hair measurements, and a bald or shaved head (little hair found) leaves the hair unchanged.
- Hair vertices keep their bone weights, so the hair still follows the head and the spring bones; the new shape is the new rest pose.
- Strength is 0–1 for shape and for color (default 70%).
- **Not used: the photo's texture itself.** The face GLB carries a UV-mapped crop of the photo. Painting it onto the
  VRM's face texture would put a photographic face under the anime eyes, brows and mouth (which are separate meshes),
  so it would not help; the useful parts of that texture (skin, iris and brow color) are taken as colors instead.
- Depth from a single photo is a rough estimate; a turned head (> 25°) skips profile depth.
- Re-binding an already reshaped VRM measures it again and moves it further: bind from the base.

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
