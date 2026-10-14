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
shader('Chair', 'fresnel', { color: '#ff3399' })
shader($S('.prop'), 'standard', { roughness: 0.2, metalness: 1 })
mtoon('LittlestTokyo.glb', { outline: { width: 0 } })
shader(mesh, 'phong', {}, { scope: 'self' })      // just that mesh, not its children
shader(group, m => new THREE.MeshBasicMaterial({ color: 0xff00ff }))   // a function
shader(group, myMaterial)                         // a material you built (shared by every mesh)
unshader('Chair')                                 // back to the original materials
```

* **target**: an object, an array, a `$S()` set, or a string. A string is tried as an object name first
  (`'LittlestTokyo.glb'` is not a selector), then as a selector.
* **shader**: an id from `shaders()` (aliases: `toon`/`vrm`/`anime` = `mtoon`, `unlit` = `basic`, `rim` =
  `fresnel`, `holo` = `hologram`, `wire` = `wireframe`), a `THREE.Material`, or a function
  `(sourceMaterial) => Material`, called once per source material.
* **params**: validated against the shader's schema. Unknown keys, wrong types and bad colors throw before
  anything changes; numbers are clamped to their range.
* **opts**: `{ scope: 'self', skipOutlines: true, filter(mesh) }`.
* `mtoon(target, spec)` is `shader(target, 'mtoon', spec)`. `spec` can be the nested form `toon()` takes
  (`{ shade, rim: { color }, outline: { width } }`) or flat (`rimColor`, `outlineWidth`).
* The return value is `{ id, params, meshes, materials }`.

## Built-in shaders

| Id | Group | Notes |
|---|---|---|
| `mtoon` | Toon | VRM MToon: banded shade, shift / toony, rim light, inverted-hull outlines. Params: `shade`, `shift`, `toony`, `rimColor`, `rimPower`, `rimMix`, `outlineWidth`, `outlineColor`. Only the params you give are applied. |
| `toon-basic` | Toon | Stock stepped `MeshToonMaterial`. |
| `standard`, `physical` | Surface | `roughness`, `metalness` (`physical` adds `clearcoat`). |
| `lambert`, `phong`, `basic` | Surface | `phong`: `shininess`, `specular`. `basic` is unlit. |
| `gradient` | Stylized | Two colors along a world axis (`axis`, `from`, `to`), multiplied into the texture. |
| `fresnel` | Effects | Keeps the lit look and adds an edge glow (`color`, `power`, `intensity`). |
| `hologram` | Effects | Translucent additive scan lines (`color`, `speed`, `lines`, `opacity`). |
| `normal`, `wireframe` | Debug | |

Colors and maps carry over from the source material where the new type has them.

## Behavior to know

* **Shared materials stay shared.** A glTF with 71 meshes and 15 materials ends with about 15, not 71, and
  the draw calls stay cheap.
* **Baked outline meshes are skipped** (`skipOutlines`), so a model that already draws its own outline pass
  does not get a doubled one. Pass `{ outline: { width: 0 } }` to `mtoon` to stop MToon adding its own as well.
* **MToon is lit.** A scene with no light gets a key and a sky light, once; undo removes them with the shader.
* **Switching shaders** removes MToon's outline passes before the new material goes on.
* **Undo / redo** restore the materials, MToon's extra draw groups, and any lights it added.
* **The Render tab (video and snapshots) draws with WebGL**, which cannot run node materials. While rendering, MToon is swapped for a stepped `MeshToonMaterial` with the same color, maps and transparency (outline passes are left out), and other node shaders for the material they replaced. The scene gets its real materials back afterwards, so the viewport is unchanged. Rendered toon shading is therefore close to, not identical to, the viewport's MToon.
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
params) => NodeMaterial`). The Shader tab, `shaders()`, validation and save / load pick it up from there.

## Verifying

`node docs/editor/js/shaders/__tests__/shaderSpec.test.mjs` covers the registry and validation. The material
side is checked in the editor: apply each shader to a sphere, undo and redo, then reload the page and confirm
the node shaders come back.

---

**Next:** [Toon look](TOON_LOOK.md) · [← Back to README](../README.md)
