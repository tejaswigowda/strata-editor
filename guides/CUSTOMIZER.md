# Character customizer

A **customizer**, not a generator. It changes the look, wardrobe and expression of a character that is
*already rigged* — any rigged GLB (MetaHuman exports are a supported source, as are VRoid, Mixamo and
others). It does not author or generate a character, and it is deterministic: the same ops on the same
GLB give the same character.

Two surfaces, one op set:

| Surface | Where | Use |
|---|---|---|
| **Customize tab** (stateful) | `Sidebar.Customize.js` | a person picks colours, toggles hair, poses the face, attaches a prop; every change is one undoable command and is recorded on the character (`userData.customize`) |
| **`customize` stage** (headless) | `customize/customizeOps.js` | an agent or script hands over the same ops as JSON; `runCustomizeStage(scene, spec)` applies them |

## The rig-safety invariant

> Edits that do not change the **vertex set**, the **skin weights** or the **skeleton** preserve both
> rigs (body skeletal + face morph). Edits that change any of the three break them.

Everything in the customize op set is of the first kind. `customize/rigSafety.js` states the rule in code:

* the validator **refuses** the second kind (see below), with the reason and the rig step to use;
* `rigFingerprint(root)` hashes the vertex set, the skin weights, the morph deltas and the skeleton.
  `applyCustomize` takes it before and after and **rolls the whole run back** if it moved;
* the Customize tab shows the fingerprint and has a *Verify rig* button.

## Ops

| op | does | rig-safe because |
|---|---|---|
| `tint` | multiplies a colour into the existing material(s); texture kept | cloned materials only |
| `recolor` | flat colour on **existing** clothing (`flat:false` keeps the texture) | cloned materials only |
| `hide` / `show` | visibility of hair / beard / eyebrow cards, anything | a flag |
| `blendshape` | ARKit morph influences (`shapes`, or `preset`: neutral, smile, surprise, frown, blink) | *uses* the morph rig, does not alter it |
| `tag` | semantic classes (`.skin`, `.jacket`) | `userData` |
| `attachProp` | a **rigid** accessory (`sunglasses`, a primitive, or an outside object) parented to a bone | no skinning; follows the bone exactly |
| `frame` | adds / updates a camera framing a part | a camera |

Targets: `"part:skin"` (`hair`, `beard`, `brows`, `body`, `face`, `eyes`, `shirt`, `bottom`, `shoes`,
`clothing`, `cards`), `"name:/regex/i"`, or any Strata selector. `"optional": true` on an op skips it
(matched 0) when the character has no such part, so one spec serves characters with and without hair.

```json
{ "customize": [ { "character": "#morpheus", "ops": [
  { "op": "tint",       "target": "part:skin",     "color": "#8a5a3c", "roughness": 0.55 },
  { "op": "hide",       "target": "part:hair",     "optional": true },
  { "op": "recolor",    "target": "part:clothing", "color": "#080808" },
  { "op": "blendshape", "preset": "smile" },
  { "op": "attachProp", "prop": { "kind": "sunglasses" }, "bone": "head" },
  { "op": "tag",        "target": "part:skin",     "classes": ["skin"] }
] } ] }
```

A run is **atomic**: if any op fails the earlier ones are undone. Unknown parts, unknown blendshape names
and malformed arguments are errors, never silent no-ops.

## What the validator refuses (rig-unsafe)

`validateCustomize` / `applyCustomize` return `RIG_UNSAFE` for these; they are a separate human / rig step:

* **geometry / topology** — `geometry`, `remesh`, `decimate`, `simplify`, `subdivide`, `sculpt`, `flatten…`:
  invalidate per-vertex morph deltas and skin weights;
* **skeleton** — `renameBone`, `removeBone`, `rebind`, `restPose`, `retarget`: break the BVH retarget mapping;
* **weights** — `smoothWeights`, `paintWeights`, …;
* **mesh swap** — `swapBody`, `replaceMesh`;
* **bare deformable clothing** — `addGarment`, `addJacket`, `attachProp` with `kind:"jacket"` or `skinned:true`.

## Props and clothing

* **Rigid accessories** (sunglasses, hats, props) — **parent to a bone**. No skinning, deform-free, rig-safe:
  `attachProp`. They are placed in the character's own mesh space, so the result is the same whatever pose,
  scale or position the character has, and they ride the bone exactly like a weight-1 skin vertex.
* **Deformable added clothing** (jacket, coat, dress) — a new garment **must be skinned to the body skeleton**,
  or it z-fights, clips and stays static under animation. That is an explicit **rig step**, not a customize op:
  `rigSteps.skinGarmentToBody(garment, root)` (the tab's *Skin selected garment to body*). Each vertex copies
  the nearest skin vertex's weights, the weights are smoothed, and the vertex is placed so it renders where it
  was modelled. A garment tagged `userData.garment` (or `.garment`) that is *not* skinned is **flagged** by
  `auditRig` and by every customize run — flagged, not shipped.
* Stopgaps when skinning is not done — `rigSteps.depthBiasStopgap(body)` pushes the body back in depth so a
  near-static shot does not z-fight. It does not make the garment follow the body.
* Default guidance: the plain, **recolored** wardrobe is both the cheapest and the rig-safe one. Prefer recolor
  over added geometry.

`presets/morpheus.js` is a **rig step**, not a customize op: it flattens the belly, rebuilds trousers and shoes,
re-weights the outfit and deletes hidden body triangles. Run it before baking, then re-bake.

## Verifying

```bash
node docs/editor/js/customize/__tests__/customize.test.mjs                 # unit tests, synthetic rig
RIG_GLB=path/to/rigged.glb node docs/editor/js/customize/__tests__/realRig.integration.mjs   # a real GLB with a baked clip
```

The integration test loads a real GLB, applies the full spec, checks the rig fingerprint is unchanged and the
look is reproducible, checks the bone-attached sunglasses keep their distance to the head through the whole
clip, and compares an added garment skinned vs unskinned across the clip.
