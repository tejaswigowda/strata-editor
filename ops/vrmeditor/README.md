# VRM editor tools (embedded in facebind)

`docs/facebind/editor/` is a static build of [cecil-tools/VRMEditorTools](https://github.com/cecil-tools/VRMEditorTools) (MIT, license shipped as
`LICENSE-VRMEditorTools.txt`): view a VRM, replace and recolor textures, edit materials, meta and spring bones, take screenshots, export VRM 0.x or 1.0.
The facebind preview has an **Edit** button that opens it in an overlay (an iframe) with the bound VRM loaded.

## What was changed (`facebind-embed.patch`, pinned to commit `e9975cf`)

Zero egress is the point of facebind, so the build is not the upstream site:

- No Google Analytics, no Twitter widget, no Firebase, no Stripe or Donate page, no sample VRMs, no external links in the nav.
- A strict `<meta>` CSP: `default-src 'none'`, scripts from this origin only (plus `wasm-unsafe-eval`), connections to this origin and `blob:` / `data:` only,
  no remote styles, fonts or images, `form-action 'none'`. `page.test.mjs` checks the policy and scans the bundle for analytics, Stripe and Firebase hosts.
- `?embed=1`: the editor does not load any VRM by itself. The facebind page sends the bound VRM with `postMessage` (same origin, and only from the framing window),
  and the page's **Done** button posts `facebind-apply`; the editor bakes everything (accessories included) and sends the edited VRM back the same way (`facebind-edited-vrm`, or `facebind-apply-failed`). In embed mode the editor has no Apply button, and its download button reads **Download VRM** (it bakes before it saves). The page checks `origin` and `source` on both ends and never uses a `*` target.
- In embed mode the "Select VRM" button is hidden (the VRM always comes from the page) and the layout follows the webCLI tools: dark cards, two columns (the viewer, then the controls and tabs) and one column under 820 px.
- **Free accessories** (Add Accessory tab): 11 accessories (round, square and sun glasses, cap, top hat, cat and bunny ears, headband, crown, halo, bow tie) built in code from three.js primitives (`src/module/FreeAccessories.ts`) and exported to GLB when clicked, then handled like an uploaded accessory (attach to the head or neck bone, gizmo). Accessories are merged into the VRM on every export and Apply, as a wrapper node that carries the preview's transform; a moved accessory is updated in place, never duplicated. Nothing is downloaded and there is no third-party asset or license: they are CC0 with this repository. A color picker sets the color. VRM 0.x files face -Z, so they are turned 180 degrees about Y on placement.
- **Outfit tab** (`src/module/OutfitTools.ts`, `TabOutfit.vue`): create, read, update, hide/restore and delete for the garments of the loaded VRM (materials named `*_CLOTH`: tops, bottoms, shoes, one-pieces).
  List them with their kind and mesh count; recolor (color factor plus the MToon shade color); give one a generated pattern, a pattern on a whole kind, or your own image; hide and restore (kept in memory until you export, so a hidden garment is not in the file); delete for good; apply one of 12 built-in outfits (school, formal, casual denim, sporty, sailor, camo, punk, tropical, safari, preppy, winter, night out). 18 patterns are painted on a canvas in code (stripes, pinstripe, plaid, tartan, gingham, checker, dots, denim, camo, houndstooth, herringbone, argyle, floral, stars, leopard, waves), so nothing is downloaded and there is no third-party asset. A pattern is added as a new image and texture for that one garment only, so garments that shared a texture are not affected. Delete removes the primitives and renames the material, so every index stays valid; the garment's data stays in the binary chunk, unused.
  The Add Accessory tab also got outfit pieces (scarf, necktie, backpack, belt, cape).
- Hash routing and relative paths so it works under any path; the About page stays (it is text).
- `regeneratorRuntime` is declared before the bundle loads (`build.sh` adds a tiny script), so the polyfill never falls back to `Function(...)` and the CSP needs no `unsafe-eval`.

## Rebuild

`ops/vrmeditor/build.sh` clones the pinned commit, applies the patch, builds (`npm ci`, Vue CLI) and copies `dist/` into `docs/facebind/editor/`.
It needs git, node and npm; the result is static files only, nothing is fetched at run time. To move to a newer upstream commit, change `PIN`, re-apply the edits on it and regenerate the patch.

## What facebind does with the result

Apply replaces the bound VRM in the preview, in the download link and in `window.__webcli_result` (`edited: true`). The editor re-exports the VRM through its own writer,
so the file is the editor's output, not the byte-audited facebind output: the rig-safety audit (face and hair bytes only) applies to the bind, not to what you change in the editor.
Editing and re-binding are separate: **binding again starts from the base VRM and discards the edits.**

## Headers

`ops/cloudflare/facebind-headers.json` has an override for `/strata-editor/facebind/editor/` (its `<meta>` CSP plus `frame-ancestors 'self'`). The facebind page CSP allows `frame-src 'self'`.
Status as before: prepared, not live.
