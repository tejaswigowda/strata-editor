# Face bind

Binds a **face-blendshape GLB** to a **base VRM**, on device. The VRM comes out with a weight map that
says "face morph *i* drives this VRM expression morph", so a face performance (facerig / mocap / the
`driveFace` shell global) animates the VRM's expressions.

- **Inputs:** a base VRM and a face-blendshape GLB (autorigger output: a standalone face mesh,
  N morph targets, PBR materials, no skeleton). Nothing else.
- **Output:** the base VRM with an `extensions.STRATA_face_bind` block added. Download +
  `window.__webcli_result`.
- **Base VRMs:** the page defaults to the bundled VRoid **male** base, with **female** one click away (`?vrm=female`).
  They are the unmodified [hinzka](https://github.com/hinzka/52blendshapes-for-VRoid-face) models, in
  [`docs/facebind/base/`](../docs/facebind/base/README.md); your own VRM (URL or file) overrides them.
- **Page:** [`docs/facebind/`](../docs/facebind/index.html) (`/facebind/` on the site).
- **Code:** [`docs/editor/js/facebind/`](../docs/editor/js/facebind/bind.js).

## What it is and is not

**Expression-bound, not a likeness.** It makes the VRM's expressions drivable from the face source. It does
not reshape the VRM into the person's face: the face shape is geometry, which this never edits.

**Rig-safe.** The VRM's meshes, skeleton, skin weights, morph deltas and BIN chunk are carried through byte
for byte. The face GLB's mesh is never grafted on. The only changes to the VRM are the bind block,
`extensionsUsed`, and (optionally) skin material colours. `assertRigSafe` diffs the JSON before and after and
refuses to write anything else, so a bound VRM still bakes with bodyrig unchanged.

## Zero egress

The face GLB is identity data.

- It is a **local input only**: a chosen/dropped file, or bytes handed to `window.__facebind.run`. A URL for the
  face is rejected (`FACE_MUST_BE_LOCAL`), and a `?face=` parameter is ignored — in the headless/agent path too.
  The orchestrator supplies it from local disk.
- Only the face GLB's **JSON metadata** is read: morph count, morph names, a skin-colour hint. Its vertices,
  morph deltas and texture are never read.
- The bind modules (`glb.js`, `faceSource.js`, `bind.js`, `runtime.js`) contain no `fetch`, XHR, WebSocket, beacon,
  storage or dynamic import; a test enforces this.
- The page makes **GET requests only** (the base VRM — by default the bundled one, from the same origin). Its Content-Security-Policy limits `connect-src` to the page's
  own origin and `raw.githubusercontent.com` (edit the `<meta>` to add your VRM host), and
  [`egressGuard.js`](../docs/facebind/egressGuard.js) refuses any non-GET fetch/XHR, any request body, beacons,
  WebSockets and WebRTC, logging every request to `window.__facebind_net` (shown under "Network audit").
- Binding works with the network **off** after the page has loaded.
- No stock or cloud model is used. Nothing here runs inference.

Packaging: in a browser this is enforced by the CSP and the sandbox, and you can confirm it in the network panel.
A desktop (Electron) shell has no such sandbox, so there it is policy plus the audit log — not the same claim.

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
  "scope": "expression-bound; not a likeness; face shape unchanged",
  "source": { "morphCount": 42, "nameResolution": "primitive.extras.targetNames", "names": ["eyeBlinkLeft", "…"] },
  "map": [ { "source": 0, "name": "eyeBlinkLeft", "targets": [ { "mesh": 0, "morph": 13, "name": "eyeBlinkLeft" } ], "weight": 1 } ],
  "unmapped": [], "undriven": ["mouthDimpleLeft", "…"]
}
```

The block holds only generic morph names and counts — nothing from the person's mesh or texture.

## Driving it

Strata keeps the block on the loaded scene (`scene.userData.faceBind`). In the JS Shell:

```js
const V = scene.children.find(o => o.name.endsWith('.vrm'));
driveFace(V, [0.2, 0, 0, /* … one weight per face morph … */ ]);   // by source index
driveFace(V, { jawOpen: 0.7, mouthSmileLeft: 1, mouthSmileRight: 1 }); // or by name / index
```

`driveFace` sets morph influences only (clamped 0–1) and returns `{ applied, skipped }`. A facerig/mocap
integration reads the same block from the file and writes the weights itself.

## Optional skin tint

`tint` (checkbox, or `{ tint: true }`) moves the VRM's `_SKIN` materials halfway toward the face GLB's
skin-colour hint. It is approximate, a material change only, and off by default. MToon rendering is a separate look
layer (`toon()`); binding does not touch it.

## The page and agents

```
/facebind/?vrm=male|female|<url>&run=1[&download=0]   auto-runs once a face GLB is chosen from local disk
window.__facebind.run({ vrm, face, tint })  vrm: 'male' (default) | 'female' | URL | File | bytes;  face: File | bytes (never a URL)
window.__webcli_result                       { ok, filename, size, bytes, blobUrl, bind, report }  or { ok:false, code, error }
```

Deterministic: the same inputs and options give the same bytes (the browser and Node produce identical output for
the sample).

## Verifying

```bash
node docs/editor/js/facebind/__tests__/facebind.test.mjs
```

Runs synthetic checks plus, if present, the real VRoid male and the sample face GLB: 42 of 42 mapped, BIN chunk
and rig JSON identical, byte-stable. In the browser: bind with the network disabled (it completes, zero requests),
import the bound VRM into Strata (the bind block is kept, `driveFace` moves the morphs, skeleton and skin weights
match the base).
