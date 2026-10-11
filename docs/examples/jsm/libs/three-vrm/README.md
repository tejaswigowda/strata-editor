# three-vrm (MToon) — vendored

Minified ES-module builds of three of the `@pixiv/three-vrm` packages, **v3.5.5**, vendored so the
editor stays local-first (no CDN fetch). MIT licensed — see `LICENSE`.

| File | Package | Used for |
|---|---|---|
| `three-vrm-materials-mtoon.module.min.js` | `@pixiv/three-vrm-materials-mtoon` | `MToonMaterialLoaderPlugin` (reads `VRMC_materials_mtoon`, generates the inverted-hull outline) |
| `three-vrm-materials-mtoon-nodes.module.min.js` | `@pixiv/three-vrm-materials-mtoon/nodes` | `MToonNodeMaterial` — the **WebGPU / TSL** MToon shader |
| `three-vrm-materials-v0compat.module.min.js` | `@pixiv/three-vrm-materials-v0compat` | `VRMMaterialsV0CompatPlugin` — converts VRM 0.x `materialProperties` to the MToon 1.0 form |

Only the **materials** packages are vendored. The humanoid / spring-bone / expression runtime
(`@pixiv/three-vrm`) is deliberately not loaded: the toon look is a material-only change and must not
touch geometry, skin weights, skeleton or morph targets. The import map entries live in `docs/index.html`
(note the `three/tsl` entry the node material needs). Used by `docs/editor/js/toon/ToonLook.js`.

**Local patch (one token, twice):** in `three-vrm-materials-mtoon-nodes.module.min.js` the two imports of
the deprecated TSL alias `transformedNormalView` read `normalView` instead (same node, current name),
which silences a deprecation warning that fired once per material compile on this three.js revision.
Re-apply it when upgrading the vendored build.
