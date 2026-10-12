# Face refine

`refineFace(vrm, opts?)` nudges the face of a VRoid-style VRM toward the proportions and skin tone of a
real-face reference. It is a Shell global; the code is in
[`docs/editor/js/face/`](../docs/editor/js/face/FaceRefine.js).

```js
const R = scene.children.find(o => o.name.endsWith('.vrm'));
const r = refineFace(R);                          // strength 0.5
r.measured;                                       // the VRM's current proportions, in reference units
r.revert();                                       // put everything back
refineFace(R, { strength: 0.8 });                 // closer to the reference
refineFace(R, { materials: false });              // shape only, keep the skin tint
```

## What it changes

| Feature | How |
|---|---|
| Eyes | spacing and size scaled toward the reference (whites, irises, highlights, lashes and eyelines move together) |
| Mouth | width scaled about the midline |
| Profile | nose tip, lips and chin pulled toward the reference depth, relative to the eye plane |
| Skin | face and body `_SKIN` materials retinted so the rendered cheek/forehead moves toward the reference photo's skin tone (one tint, so the neck has no seam) |

`strength` is 0–1 (default 0.5): 0 changes nothing, 1 matches the reference.

## What it does not change

- **Morph targets.** The VRM presets (`Fcl_*`) and the 52 ARKit shapes are deltas on the base positions
  and are left exactly as they are, so every existing blendshape and any influences you have set keep working.
- **Outline.** The warp is local (eye regions, mouth, midline) and falls to zero before the head outline,
  so hair, ears and neck still meet the face. Brows are left in place.
- **Skeleton and skin weights.**

## The reference

[`faceReference.js`](../docs/editor/js/face/faceReference.js) holds the numbers, measured on a 478-landmark
MediaPipe face mesh (`face-model-blendshapes.glb`) after removing its head yaw. Everything is normalised
by the face's own width (`W`) and chin-to-eye-line height (`E`), so it does not depend on model scale.
Only the GLB's base shape and its photo's skin colour are used; its 42 morph targets are not read. Pass your
own `reference` object in `opts` to refine toward a different face.

## Notes

- Calling it again measures the already-refined face and moves it further. `revert()` first, or keep the
  strength low.
- The geometry edit is on the loaded objects. Commit the scene to keep it.
- It looks for VRoid material names (`…_EyeIris_…`, `…_EyeWhite_…`, `…_FaceMouth_…`, `…_Face_00_SKIN`).
  Other VRMs with those names work; others throw "no VRoid-style face meshes found".

## Verifying

```bash
node docs/editor/js/face/__tests__/faceRefine.test.mjs   # pure checks on a synthetic face
```

The live mesh is checked in the browser: import a VRoid VRM, run `refineFace(R)`, then set
`mouthSmileLeft`, `jawOpen` etc. and confirm the shapes still deform the refined face.
