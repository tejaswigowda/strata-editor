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
| **Landmarks, hair mask, expression scores** | MediaPipe (wasm, CPU) memory, then plain JS arrays | No |
| **Measurements and colors** (face proportions, hair shape, skin, hair, iris and brow color) | JS objects, then the face GLB's node `extras` | No |
| **Face GLB** | In memory, optional local download. **Contains the photo crop as its texture**, a 478-point face mesh, the photo's expression as morph weights, and the measurements above | Only if you download it and share it |
| **Bound VRM** | In memory, local download. Contains the base VRM, the bind block (generic morph names and counts only) and, if you left them on, **reshaped face and hair geometry and tinted colors derived from the photo** | Only if you download it and share it |
| **Preview** | Decoded copies of the base and bound VRM in GPU/CPU memory | No |
| **`window.__webcli_result`** | Holds the result bytes, the face GLB bytes and the report (with the measurements) so an agent can read them | No, but any script in the page can read it |

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
| **Content-Security-Policy** (`<meta>`) | `default-src 'none'`; `script-src 'self' 'wasm-unsafe-eval'` plus the hash of the one inline import map; `connect-src 'self' blob: https://raw.githubusercontent.com`; `img-src blob: data:`; `form-action 'none'`; `base-uri 'none'` |
| **`no-referrer`** | The page sends no referrer with its requests |
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
| **A compromised or malicious host serving different code** | **No.** The same host delivers the page, the CSP and the guard, so it can change all three. Mitigate by running a local copy (`node server.js`), pinning a reviewed commit, or self-hosting |
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

Residual, accepted: the compromised-host case (needs a local copy or a pinned build), extensions, and sharing
downloads. Optional hardening if you need it: remove `raw.githubusercontent.com` from `connect-src` and use only
bundled bases or local files; self-host with the headers `Content-Security-Policy` and `Referrer-Policy` set by the
server (a header cannot be changed by the page, unlike a `<meta>`).

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
7. **Strata.** Open the bound VRM in the editor: the bind block is kept (`scene.userData.faceBind`) and `driveFace`
   works. Remember that the editor is outside this audit.
