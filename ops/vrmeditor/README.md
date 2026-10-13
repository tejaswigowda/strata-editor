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
  and an **Apply to the facebind preview** button sends the edited VRM back the same way. The page checks `origin` and `source` on both ends and never uses a `*` target.
- In embed mode the "Select VRM" button is hidden (the VRM always comes from the page) and the layout follows the webCLI tools: dark cards, two columns (the viewer, then the controls and tabs) and one column under 820 px.
- **Free accessories** (Add Accessory tab): 11 accessories (round, square and sun glasses, cap, top hat, cat and bunny ears, headband, crown, halo, bow tie) built in code from three.js primitives (`src/module/FreeAccessories.ts`) and exported to GLB when clicked, then handled like an uploaded accessory (attach to the head or neck bone, gizmo, merge into the VRM). Nothing is downloaded and there is no third-party asset or license: they are CC0 with this repository. A color picker sets the color. VRM 0.x files face -Z, so they are turned 180 degrees about Y on placement.
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
