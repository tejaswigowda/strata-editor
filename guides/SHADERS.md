# Shaders on any object

Put any shader on any mesh or group: MToon (the VRM anime toon) on a prop or a whole glTF, a stock material
type, a TSL preset, or your own material. It is one undo step, and it works the same from the **Shader** tab in
the Properties panel and from the JS shell.

The editor renders with WebGPU, so a "shader" here is a material: a stock three.js material, the MToon node
material, a TSL (node) preset, or a material you build.

## The Shader tab

Select an object (any object with a mesh under it) and open **Shader** next to Material in the Properties panel.

| Control | What it does |
|---|---|
| Target | The selected object and how many meshes it holds. |
| Wearing | The shader each mesh currently has (`mtoon`, `standard`, `fresnel`, ...). |
| Shader | The list, grouped: Toon, Surface, Stylized, Effects, Debug. |
| Override values | MToon only. Off keeps a model's own MToon values (a VRM's shade color, rim, outline); on applies the parameters below. |
| Parameters | Color, number and choice rows for the chosen shader. |
| Apply to | Selected and children, Selected only, or Whole scene. |
| Keep outline meshes | On (default): meshes named `outline`, or whose material is a back-face `outline`, are left alone. |
| Apply / Revert | Apply as one undo step; Revert restores the materials the meshes had before. |

## Shell

```js
shaders()                                   // the registry: ids, groups, parameters, defaults
help('shader')                              // the verbs and parameters below, printed from the registry
shader('Chair', 'fresnel', { color: '#ff3399' })
shader($S('.prop'), 'standard', { roughness: 0.2, metalness: 1 })
mtoon('LittlestTokyo.glb', { toony: 0.9, outline: { width: 0 } })   // nested ...
mtoon('LittlestTokyo.glb', { toony: 0.9, outlineWidth: 0 })         // ... or flat: the same call
shader(mesh, 'phong', {}, { scope: 'self' })      // just that mesh, not its children
shader(group, m => new THREE.MeshBasicMaterial({ color: 0xff00ff }))   // a function
shader(group, myMaterial)                         // a material you built (shared by every mesh)
unshader('Chair')                                 // back to the original materials
```

* **target**: an object, an array, a `$S()` set, or a string. A string is tried as an object name first
  (`'LittlestTokyo.glb'` is not a selector), then as a selector. Every verb takes the same targets
  (`toon()` too).
* **shader**: an id from `shaders()` (aliases: `toon`/`vrm`/`anime` = `mtoon`, `unlit` = `basic`, `rim` =
  `fresnel`, `holo` = `hologram`, `wire` = `wireframe`), a `THREE.Material`, or a function
  `(sourceMaterial) => Material`, called once per source material. An unknown id throws with a "did you mean".
* **params**: validated against the shader's schema, before anything changes. Unknown keys throw (with a
  "did you mean" and the legal spellings), wrong types and bad colors throw, numbers are clamped to their
  range. A material or function takes no params.
* **opts**: `{ scope: 'self', skipOutlines: true, filter(mesh) }`.
* **MToon's spec has one shape wherever you give it.** `mtoon(target, spec)` is `shader(target, 'mtoon', spec)`
  and `toon(target, spec)` is the same call (plus `{ look: 'native' }` to revert); the Shader tab and the
  `look` spec (see [TOON_LOOK.md](TOON_LOOK.md)) validate through the same function. The spec can be nested
  (`{ shade, rim: { color }, outline: { width } }`), flat (`rimColor`, `outlineWidth`) or a mix of both; it is
  normalised to the flat form in one place. A setting given twice with different values is refused.
* **Return value**: every verb that changes materials returns `{ id, params, meshes, materials }`: the shader
  id, the params as applied (flat, clamped; for `mtoon` only what you gave), how many meshes and how many
  distinct materials. `unshader()` and `toon(t, { look: 'native' })` return `{ id: 'original', params: {},
  meshes, materials }` with `meshes` = how many were restored. `shaders()` returns the registry array.
* **Errors** always start with the shader id or verb and say what to give instead, e.g.
  `mtoon: unknown param "outlin" — did you mean "outline"? Legal: flat: shade, shift, … ; nested: rim:{ … }, outline:{ … }`.
  A failed call changes nothing.
* **help**: `help()` lists the main commands, `help('shader')`, `help('mtoon')`, `help('toon')`,
  `help('unshader')`, `help('shaders')` or `help('fresnel')` (any shader id or alias) print the signature and the
  parameter table, generated from the registry.

### MToon parameters

<!-- shader-docs:mtoon:start -->
| Flat | Nested | Type | Range | Default | Meaning |
|---|---|---|---|---|---|
| `shade` |  | color | `#rrggbb` | `'#8a7fb0'` | Shade color |
| `shift` |  | number | `-1 to 1` | `0` | Shading shift |
| `toony` |  | number | `0 to 1` | `0.9` | Toonyness |
| `rimColor` | `rim.color` | color | `#rrggbb` | `'#ffffff'` | Rim color |
| `rimPower` | `rim.power` | number | `0.1 to 20` | `5` | Rim power |
| `rimLift` | `rim.lift` | number | `0 to 1` | `0` | Rim lift |
| `rimMix` | `rim.mix` | number | `0 to 1` | `0` | Rim lighting mix |
| `outlineWidth` | `outline.width` | number | `0 to 0.05` | `0.002` | Outline width |
| `outlineColor` | `outline.color` | color | `#rrggbb` | `'#1a0f14'` | Outline color |
| `outlineMode` | `outline.mode` | choice | `world · screen · none` | `'world'` | Outline mode |
| `outlineMix` | `outline.mix` | number | `0 to 1` | `1` | Outline lighting mix |

Flat and nested spellings (and mixes) mean the same thing; give a setting once. `bands: 2` is `toony: 1`.
Numbers outside the range are clamped, unknown keys are refused with a suggestion.
<!-- shader-docs:mtoon:end -->

## Built-in shaders

<!-- shader-docs:builtin:start -->
| Id | Group | Aliases | What it is | Parameters |
|---|---|---|---|---|
| `mtoon` | Toon | `toon`, `vrm`, `anime` | Light-responsive banded toon with rim light and inverted-hull outlines, the VRM MToon model. | `shade` (default '#8a7fb0'), `shift` (-1 to 1, default 0), `toony` (0 to 1, default 0.9), `rimColor` (default '#ffffff'), `rimPower` (0.1 to 20, default 5), `rimLift` (0 to 1, default 0), `rimMix` (0 to 1, default 0), `outlineWidth` (0 to 0.05, default 0.002), `outlineColor` (default '#1a0f14'), `outlineMode` (world/screen/none, default 'world'), `outlineMix` (0 to 1, default 1) |
| `toon-basic` | Toon | `three-toon`, `cel` | The stock MeshToonMaterial: a plain stepped ramp, no outline. | none |
| `standard` | Surface | `pbr` | Physically based metal / roughness. | `roughness` (0 to 1, default 0.8), `metalness` (0 to 1, default 0) |
| `physical` | Surface |  | Standard plus clearcoat. | `roughness` (0 to 1, default 0.5), `metalness` (0 to 1, default 0), `clearcoat` (0 to 1, default 1) |
| `lambert` | Surface |  | Cheap diffuse-only lighting. | none |
| `phong` | Surface |  | Classic specular highlight. | `shininess` (0 to 200, default 30), `specular` (default '#111111') |
| `basic` | Surface | `unlit`, `flat` | Ignores lights; shows the color and texture as they are. | none |
| `gradient` | Stylized |  | A two-color blend along one world axis, multiplied into the original texture. | `colorA` (default '#ff7a59'), `colorB` (default '#3b2a7a'), `axis` (x/y/z, default 'y'), `from` (-1000 to 1000, default 0), `to` (-1000 to 1000, default 1) |
| `fresnel` | Effects | `rim` | Keeps the original lit look and adds a glowing edge that brightens at grazing angles. | `color` (default '#4fd2ff'), `power` (0.1 to 10, default 3), `intensity` (0 to 10, default 1.5) |
| `hologram` | Effects | `holo` | Translucent additive scan lines with a fresnel edge. | `color` (default '#44ddff'), `speed` (-10 to 10, default 1), `lines` (1 to 400, default 60), `opacity` (0 to 1, default 0.7) |
| `normal` | Debug | `normals` | Shows the surface normal as color. | none |
| `wireframe` | Debug | `wire` | Unlit wireframe. | `color` (default '#00ff88') |
<!-- shader-docs:builtin:end -->

Colors and maps carry over from the source material where the new type has them. Colors are `'#rrggbb'`,
`'#rgb'` or a `0xrrggbb` number.

## Behavior to know

* **Shared materials stay shared.** A glTF with 71 meshes and 15 materials ends with about 15, not 71, and
  the draw calls stay cheap.
* **Baked outline meshes are skipped** (`skipOutlines`), so a model that already draws its own outline pass
  does not get a doubled one. Pass `{ outline: { width: 0 } }` to `mtoon` to stop MToon adding its own as well.
* **MToon is lit.** A scene with no light gets a key and a sky light, once; undo removes them with the shader.
* **Switching shaders** removes MToon's outline passes before the new material goes on.
* **Undo / redo** restore the materials, MToon's extra draw groups, and any lights it added.
* **The Render tab (video and snapshots) draws with WebGL**, which cannot run node materials. While rendering, MToon is swapped for a stepped `MeshToonMaterial` with the same color, maps and transparency (outline passes are left out), and other node shaders for the material they replaced. The scene gets its real materials back afterwards, so the viewport is unchanged. Rendered toon shading is therefore close to, not identical to, the viewport's MToon.
* **Browsers without WebGPU (most Android phones) fall back to the classic WebGL renderer**, which cannot compile node materials, so the viewport draws MToon through the same stand-ins, swapped in around each frame and cached. Before this, loading a scene with MToon on such a browser failed with `Cannot read properties of undefined (reading 'replace')`. The scene itself keeps its real MToon materials, so saving is unaffected.
* **Revert** restores the original material of each mesh. After a reload, the original of a stock-type shader
  (`standard`, `phong`, ...) is not stored, so Revert only reaches TSL / MToon shaders there.

## Saving and loading

* Stock material types (`standard`, `physical`, `lambert`, `phong`, `basic`, `toon-basic`, `normal`,
  `wireframe`) serialize as themselves.
* Node materials (`mtoon`, `fresnel`, `hologram`, `gradient`, or a node material of your own) serialize as a
  `MeshStandardMaterial` twin with the settings in `userData`. The editor rebuilds the real material when it
  loads the scene, so a saved or committed scene round-trips. A tool that does not know Strata sees plain
  lit PBR.
* **A function shader is never stored and never re-run on load.** Scenes can come from a GitHub repo, and
  re-running stored code would be arbitrary code execution. A function-made material comes back as its
  twin; re-apply the function from the shell if you want it live again.

## Adding a shader

Add a definition to `SHADERS` in `docs/editor/js/shaders/shaderSpec.js` (id, label, group, `persist`, params),
then a builder in `ShaderLibrary.js`: a stock type goes in `NATIVE`, a TSL preset in `TSL` (`(sourceMaterial,
params) => NodeMaterial`). The Shader tab, `shaders()`, `help()`, validation and save / load pick it up from
there. Then run `node scripts/gen-shader-docs.mjs` to refresh the tables in this guide.

## Verifying

`node docs/editor/js/shaders/__tests__/shaderSpec.test.mjs` covers the registry and the one normaliser
(nested / flat / mixed, typos, ranges). `node docs/editor/js/shaders/__tests__/shaderDocs.test.mjs` fails when
the tables above, or the `help()` text, are out of date with the registry; `node scripts/gen-shader-docs.mjs
--check` does the same from the command line. The material side is checked in the editor: apply each shader to
a sphere, undo and redo, then reload the page and confirm the node shaders come back.

---

**Next:** [Toon look](TOON_LOOK.md) · [← Back to README](../README.md)
