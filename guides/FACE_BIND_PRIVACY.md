# Face bind: privacy audit (zero egress)

Audit of `/facebind/` (the page, `docs/facebind/`, and the code under `docs/editor/js/facebind/` and
`docs/editor/js/face/`). Last audited 2026-10-11.

**The claim.** A photo of a face, the face GLB made from it, and everything derived from them stay on the device.
The page makes no request that carries them, and the whole photo to bound-VRM path works with the network off once
the page has loaded.

**What the claim is not.** It is not a promise about a compromised host, a hostile browser or extension, or what you
do with the files you download. Those are listed under [Threat model](#threat-model).

## 1. Data inventory

| Data | Where it exists | Leaves the page? |
|---|---|---|
| **Photo** (File) | Read with `createImageBitmap`, drawn on canvases (a 1024 px face crop, a downscaled copy for the hair model and color sampling), shown in the `<img>` preview through an in-page object URL | No |
| **Landmarks, hair mask (also shaded on a small canvas copy of the photo), expression scores** | MediaPipe (wasm, CPU) memory, then plain JS arrays. The expression scores also drive the preview and are in `window.__webcli_result.expression` | No |
| **Measurements and colors** (face proportions, hair shape, hair texture estimate, facial hair amounts, shirt color, skin, hair, iris and brow color) | JS objects, then the face GLB's node `extras` | No |
| **Face GLB** | In memory, optional local download. **Contains the photo crop as its texture**, a 478-point face mesh, the photo's expression as morph weights, and the measurements above | Only if you download it and share it |
| **Bound VRM** | In memory, local download. Contains the base VRM, the bind block (generic morph names and counts only) and, if you left them on, **reshaped face and hair geometry (including a re-laid hair texture, if chosen or estimated), tinted color and, if the photo had facial hair, a face texture with dots painted into its derived from the photo** | Only if you download it and share it |
| **Preview** | Decoded copies of the base and bound VRM in GPU/CPU memory, posed with the photo's expression | No |
| **`window.__webcli_result`** | Holds the result bytes, the face GLB bytes, the photo's expression scores and the report (with the measurements) so an agent can read them | No, but any script in the page can read it |

Things worth knowing:

- The face GLB is the most sensitive artifact: it embeds a crop of the photo.
- The bound VRM has no photo pixels or landmarks, but its geometry and colors are derived from the face. Treat it as
  personal data if the face is a real person's, and do not commit it to a public repository unless you mean to.
- The bind block (`STRATA_face_bind`) carries only morph names, the morph count and how the names were resolved. It
  deliberately carries no hash, measurement or color from the photo.

## 2. Every network request

Measured in a real browser run (photo, hair, face and color matching on, preview open). All requests below are `GET`.

| Request | Destination | Carries identity data? |
|---|---|---|
| `vision_bundle.mjs`, `vision_wasm_internal.js/.wasm` | this origin, `/facebind/vendor/mediapipe/` | No |
| `face_landmarker.task`, `hair_segmenter.tflite` | this origin | No |
| three.js, `GLTFLoader`, `OrbitControls`, the page's own modules | this origin | No |
| Base VRM (`base/VRoid_V110_*.vrm`) | this origin, or the one URL you typed | No (a URL you chose) |
| Textures of the preview models | `blob:` URLs of in-memory data (never a network request) | n/a |

**Which thread.** Every request above originates on the **main thread**. The face landmarker and the hair segmenter
run as CPU/SIMD wasm on the main thread; no `Worker`, `SharedWorker` or service worker is created anywhere (checked
by instrumenting the constructors through a full photo run with the preview open: none were constructed). That is why
"every request is logged" is true: `egressGuard.js` wraps the page's `fetch` and XHR, which is the only place a request
can start. Workers are also refused three ways in case a future change adds one, so the claim cannot quietly stop
being true: the guard replaces `Worker`, `SharedWorker` and `serviceWorker.register` with functions that throw and log,
the CSP has `worker-src 'none'`, and the static scan fails on any `Worker`, `SharedWorker`, `Worklet`, `serviceWorker`
or `importScripts` in the code.

Nothing else was requested. With every request aborted (Playwright `route('**/*', abort)`) after the page loaded and a
local VRM file chosen, a full photo run completed with **zero** attempted requests.

What the host that serves the page can see: your IP address and user agent, the time, and which static files you
fetched. The models load when the page opens whether or not you use a photo, so the host cannot tell that you did.
It learns which bundled base (male or female) you bound, and the URL if you typed one.

## 3. Controls

| Layer | What it does |
|---|---|
| **No network code** | The bind, face, hair, reshape, preview and autorigger modules have no `fetch`, XHR, WebSocket, beacon, storage, `postMessage`, `BroadcastChannel` or computed dynamic import. `page.test.mjs` scans every file |
| **Local-only inputs** | A URL for the photo or face GLB is rejected (`IMAGE_MUST_BE_LOCAL`, `FACE_MUST_BE_LOCAL`); `?image=` and `?face=` are ignored |
| **Content-Security-Policy** (`<meta>`, always) | `default-src 'none'`; `script-src 'self' 'wasm-unsafe-eval'` plus the hash of the one inline import map; `connect-src 'self' blob: https://raw.githubusercontent.com`; `img-src blob: data:`; `worker-src 'none'`; `form-action 'none'`; `base-uri 'none'` |
| **`worker-src 'none'`** and the worker stubs | No worker of any kind can start (see the thread note in section 2), so no network call can happen where the guard cannot see it |
| **Response headers (Cloudflare) + `<meta>` fallback** | The same policy as the `<meta>`, plus `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy`, set as real headers at Cloudflare. They cover the initial document and cannot be stripped by the page. The values live in `ops/cloudflare/facebind-headers.json` (a test keeps them equal to the `<meta>`). **Status: prepared, not live.** The site is served by GitHub Pages, which cannot set headers, and when this was audited it was not behind Cloudflare (`server: GitHub.com`, no `cf-ray`); see `ops/cloudflare/README.md`. Until then only the `<meta>` applies |
| **`no-referrer`** | `<meta name="referrer">` always; the header too once Cloudflare serves it |
| **Egress guard** (`egressGuard.js`, loaded first) | `fetch` and XHR allowed only for `GET` without a body, a URL up to 2048 characters, and a destination that is this origin, `blob:`, `data:`, or the exact base-VRM URL you typed (registered just before it is fetched). Blocks everything else, plus `sendBeacon`, `WebSocket`, `EventSource`, WebRTC, `WebTransport` and `window.open`. Logs every request |
| **Vendored, hashed models** | MediaPipe JS, wasm and both models are served from this origin; their SHA-256s are in `vendor/mediapipe/README.md` and checked by a test |
| **CPU inference** | No GPU delegate, so no driver-specific paths and the results are reproducible |
| **No persistence** | No `localStorage`, IndexedDB, Cache API or service worker. Object URLs of the previous run are revoked when you run again |
| **Escaped output** | Everything from a file that reaches the page (morph names, material names) goes through `esc()`, so a hostile GLB cannot inject markup. The CSP would also block inline script and remote loads |

## 4. Threat model

| Threat | Covered? |
|---|---|
| **A bug or dependency in this code sending identity data out** | Yes. No network code in the modules, the CSP, the guard's destination allow-list and the request log. A request to anywhere but this origin, `blob:` or the VRM URL you typed is blocked |
| **A third-party library calling home** (MediaPipe, three.js) | Yes. All are vendored and same-origin; the CSP and guard block other destinations; the measured log shows no other request |
| **A crafted base VRM or face GLB (injection)** | Yes. File-derived text is escaped; there is no inline script; `eval` is not allowed (only `wasm-unsafe-eval`) |
| **A compromised or malicious host serving different code** | **No.** The same host delivers the page, the CSP and the guard, so it can change all three. Real headers via Cloudflare do not change this (a compromised host or Cloudflare account can serve different code and headers). Mitigate by running a local copy (`node server.js`), pinning a reviewed commit, or self-hosting |
| **Browser extensions, devtools, OS-level capture, screenshots** | No (out of scope) |
| **You sharing a downloaded file** | No. The face GLB (photo crop) and the bound VRM (derived geometry and colors) are yours to protect |
| **The Strata editor, after you open the bound VRM there** | No. The editor has its own features (Git commits with a token, optional external AI). The zero-egress claim covers `/facebind/` only. Do not commit a bound VRM of a real person to a public repo |

## 5. Findings from this audit and what was done

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | The guard allowed any cross-origin `GET` up to 2048 characters. A bug could have put data in a URL (a query string) | Medium | Destination allow-list: this origin, `blob:`, `data:`, or the exact URL you typed. Tested statically and in the browser |
| 2 | The CSP `connect-src` permits `raw.githubusercontent.com` for typed VRM URLs, even when unused | Low | Kept (a `<meta>` CSP cannot be dynamic) but the guard now blocks it unless that exact URL was typed |
| 3 | The report was built with `innerHTML` from file-derived strings (morph and material names). A crafted GLB could inject markup; the CSP already blocked script and remote loads | Low | All such strings are escaped; a test checks that `innerHTML` is used once and the fields are escaped |
| 4 | The page sent a default referrer | Low | `<meta name="referrer" content="no-referrer">` |
| 5 | Object URLs for the face GLB and bound VRM were never revoked, so identity-derived bytes lingered in the tab | Low | Revoked at the start of every run |
| 6 | The static "no network code" test covered four files | Medium | It now scans every non-test file in `facebind/`, `face/`, `autorig/` and `preview.js` (and `page.js` for its single `fetch`) |
| 7 | The preview needs `GLTFLoader` to read `blob:` textures, which needs `blob:` in `connect-src` | Info | Added `blob:`. A `blob:` URL is in-memory data, not a network destination; the guard allows it explicitly |
| 8 | The face GLB embeds the photo crop and the photo's expression; this was not documented | Info | Documented here and in the guide |
| 9 | The bound VRM's reshaped geometry and colors are derived from the face; this was not documented | Info | Documented here and in the guide. The bind block itself holds only generic morph names |

| 10 | A worker would be outside the guard: the guard only wraps page `fetch` / XHR, so a worker's network calls would not be logged (the CSP `connect-src` would still block cross-origin ones) | Medium | Verified there is **no worker** in a full run. Added the guard stubs, `worker-src 'none'`, and the static scan, so "every request is logged" holds and cannot regress |
| 11 | The `<meta>` CSP is weaker than a header (it cannot set `frame-ancestors`, and it is part of the document the host serves). GitHub Pages cannot set headers | Medium | Header values, a Worker, a Transform Rule recipe and a checker script are in `ops/cloudflare/`, with a test that keeps them equal to the `<meta>`. **Not yet live**: the site is not behind Cloudflare today. The `<meta>` stays as the fallback |
| 12 | An index-only 42-morph file in a different order would have been mapped as the autorigger's, silently giving plausible but wrong expressions | Medium (correctness) | The assumed order now needs the autorigger's own structure (`faceMesh` node with its extras, 478 vertices, three.js export, indices `0`..`41`); anything else is `unresolved` and maps nothing. A `convention` bind carries a warning in the bind block, the result, the page and `applyFaceWeights` |
| 13 | Recomputing normals after the warp could have widened what changes in the file | Info | Normals (and tangents, if any) of the same warped vertices only are changed, under the same byte audit. No new data and no new network path |

Residual, accepted: the compromised-host case (needs a local copy or a pinned build), extensions, and sharing
downloads. Optional hardening if you need it: remove `raw.githubusercontent.com` from `connect-src` and use only
bundled bases or local files; serve the page with real headers (`ops/cloudflare/`, once the domain is proxied by
Cloudflare) so the policy does not depend on the `<meta>`.

## 6. Verify it yourself

1. **Static checks.** `node docs/editor/js/facebind/__tests__/page.test.mjs` (CSP, import-map hash, no remote URLs, no
   network or storage APIs in the code, guard rules, escaping, vendored hashes).
2. **Network panel.** Open the page with devtools Network open (disable cache). Load it, run a photo. You should see
   only same-origin GETs and `blob:` reads. The page's own "Network audit" box shows the same list.
3. **Offline.** After the page has loaded (the model status says "ready"), turn the network off, choose a local VRM
   file and a photo, and press Bind. It completes.
4. **Abort everything.** In Playwright: after load, `await page.route('**/*', r => r.abort())`, set the inputs, click
   Bind. `blocked` stays empty and the result is `ok`.
5. **Guard.** In the console: `fetch('https://example.com/x')` and `fetch('/', { method: 'POST', body: 'x' })` are
   refused, and show as `BLOCKED` in `window.__facebind_net`.
6. **Same output.** Run the same inputs twice: the bound VRM has the same SHA-256 (it is deterministic).
7. **Headers (once Cloudflare serves them).** `scripts/check-facebind-headers.sh` (or `curl -I
   https://tejaswigowda.com/strata-editor/facebind/`) must show `Content-Security-Policy`, `Referrer-Policy` and
   `X-Content-Type-Options`; the script fails if they are missing or differ from `ops/cloudflare/facebind-headers.json`.
8. **No workers.** In the console: `new Worker('x.js')` throws `face-bind egress guard: Worker is not allowed`.
9. **Strata.** Open the bound VRM in the editor: the bind block is kept (`scene.userData.faceBind`) and `driveFace`
   works. Remember that the editor is outside this audit.
