# Toon look (anime render mode)

> Part of the [Strata documentation](../README.md#documentation). See also: [Character customizer](CUSTOMIZER.md) · [JS Shell](JS_SHELL.md) · [Animation](ANIMATION.md)

A VRM character can render as **light-responsive banded toon**: two hard tones (lit / shade), a rim
term, and outlines, driven by the scene's lights. Under two coloured neon lights the face splits into two
hard-edged zones in those colours. It is the *Strata* look, rendered by the WebGPU renderer. Blender, Unreal
and Unity have their own toon pipelines, and nothing here claims the look transfers to them through glTF.

## Why this exists

A VRoid export marks every material `KHR_materials_unlit`. Stock glTF loading turns that into
`MeshBasicMaterial`: **unlit, so it ignores every light**, and the file's `VRM/MToon` block (shade colour,
shading shift / toony, rim, outline) is read by nothing. Props the customizer added were
`MeshStandardMaterial`, so the character was unlit and its props were lit.

## What it does now

* **VRM import honours MToon.** A VRM 0.x file is converted to the MToon 1.0 form (`VRMMaterialsV0CompatPlugin`)
  and each material becomes an `MToonNodeMaterial` (WebGPU / TSL) with the file's own shade colour,
  shading shift and toony, rim, and outline width + colour. Outlines are MToon's own inverted-hull pass.
  Other glTFs are untouched.
* **Scene lights drive it.** Directional, point and spot lights all contribute to the lit / shade
  decision, so coloured lights rake the character in hard bands.
* **One shading model per frame.** `look` also converts the character's other materials and every prop the
  customizer attaches, so props band and rim under the same lights.
* **Material-only, so rig-safe.** Nothing touches a vertex, skin weight, skeleton or morph target. The one
  structural change is extra *draw groups* for the outline pass, which is not part of the rig fingerprint.
  bodyrig / facerig are unaffected.

## The `look` spec

```jsonc
{ "look": "toon",                       // "native" reverts
  "shade":   "#241a44",                 // shade-band colour (MToon "shade colour")
  "bands":   2,                         // two hard tones; same as toony 1
  "toony":   1,                         // 0 smooth ramp … 1 hard edge
  "shift":   0.0,                       // where the lit/shade edge falls, -1 … 1
  "rim":     { "color": "#ffffff", "power": 3, "lift": 0, "mix": 0 },
  "outline": { "width": 0.0025, "color": "#10061a", "mode": "world", "mix": 1 } }
```

Every field is optional. A field you leave out keeps the value in the VRM file; a non-VRM character gets
defaults derived from its base colour. `rim.mix` 0 makes the rim glow regardless of light, 1 makes it lit by
the lights. `outline.width` 0 turns outlines off. A spec with `bands` other than 2 is **refused**: MToon is a
two-tone model.

Three ways in, all the same spec and the same code path:

* **Customize op** (the headless `customize` stage / agent): `{ "op": "look", "mode": "toon", … }`. It is
  undoable, runs under the rig-invariant check, and re-applying it gives the same result.
* **Shell:** `toon(character)`, `toon(character, { bands: 2, shade: '#241a44', rim: { color: '#fff' } })`,
  `toon(character, { look: 'native' })`, and `toonMaterial(0x8b6a3e)` for a standalone mesh.
* **Module:** `applyToonLook(root, spec)` in `editor/js/toon/ToonLook.js`.

`look: "toon"` plus a fixed spec on a fixed scene gives the same materials and the same fingerprint, so a
render is reproducible from the scene spec alone.

```jsonc
{ "customize": [ { "character": "#hero", "ops": [
    { "op": "look", "mode": "toon", "bands": 2, "shade": "#0d0a1c",
      "rim": { "color": "#ffffff", "power": 3, "mix": 0 },
      "outline": { "width": 0.0025, "color": "#10061a" } },
    { "op": "attachProp", "prop": { "kind": "box", "size": 0.08, "name": "satchel" }, "bone": "head" }
] } ] }
```

## Route decision: three-vrm MToon (B1)

`@pixiv/three-vrm` v3.5.5 ships `MToonNodeMaterial`, an MToon implementation built on three.js's node / TSL
system, and it targets `WebGPURenderer`, so no custom shader was needed and no WebGL fallback is shipped.
The file's VRM version is 0.x (UniVRM 0.79, `_MToonVersion` 37), so the compat plugin that rewrites it to
MToon 1.0 is part of the load path. Only the **materials** packages are vendored
(`examples/jsm/libs/three-vrm/`, MIT); the humanoid, spring-bone and expression runtime is deliberately
not loaded.

## Neon scene

Neon is a few coloured lights plus emissive sign geometry; the toon material takes those lights (and its
emissive channel stays live). Bloom on the emissive geometry and tonemapping are scene settings, not part of
this material, and are **not implemented here**.

## Persistence

A node material is not a serialisable three.js type, so each toon material serialises as a
`MeshStandardMaterial` twin (same textures) carrying the MToon parameters in `userData.toon`. Strata rebuilds
the MToon material when it loads the scene (`restoreLooks`), so a saved or committed scene round-trips. A
tool that doesn't know Strata sees plain lit PBR.

## Limits

* **Not shared with other renderers.** The look lives in Strata's WebGPU path.
* **`native` on a VRM is the lit-PBR twin**, not the original unlit `MeshBasicMaterial`. Reloading the file
  gives the unlit original back.
* MToon extras not wired to the spec: matcap, UV animation, and per-pixel shading-shift texture are read
  from the file and rendered, but have no override fields.
* Bloom, grain and the neon sign geometry are scene content, not part of this change.

## Verifying

`node docs/editor/js/toon/__tests__/toonSpec.test.mjs` covers the spec. The renderer-side checks are done in
the editor: import a VRM, add two coloured point lights, call `toon(character)` and look at the face.
To prove the file's parameters are honoured, edit `_ShadeColor`, `_OutlineWidth`, `_OutlineColor` or
`_RimColor` of a material in the `.vrm` and re-import: the render changes.

---

**Next:** [Character customizer](CUSTOMIZER.md) · [← Back to README](../README.md)
