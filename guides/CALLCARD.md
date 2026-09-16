# The call card (`/about/callcard`)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Animation](ANIMATION.md) · [Architecture](ARCHITECTURE.md)

A single, living end-card component that every Strata short can embed at its end — update it once, every future render and every live view reflects the change.

## What it is

- **`/about`** — a static, human-readable landing page: what Strata is, why it exists, links to the editor, the repo, [3DOM](https://github.com/tejaswigowda/3dom), and this call card. No trackers, no build step, no third-party calls beyond the links you click.
- **`/about/callcard`** — the end-card itself: tagline, the Strata mark, a QR code to the editor, and a small version stamp in the corner. Also static, self-contained (the QR is a pre-baked local SVG, not a live generator or third-party API) — zero third-party network calls.

## Living vs. baked

- **Live / interactive views** always pull the *current* `/about/callcard` — visiting it directly, or viewing it live in the editor's viewport, shows whatever the page says right now.
- **Rendered mp4s bake the card as it was at render time**, frozen forever, stamped with the version shown on the card that day. A short rendered last month keeps last month's card and stamp even if the live card has since changed — that's correct, not a bug. The version stamp is what makes an old render honest about its own vintage.

## Adding it to a scene

Open **Stencils → Call card** (or drag it into the viewport) to insert an addressable plane object:

```js
$S('#callcard')                                  // it's just another node
$S('#camera').at(END).moveTo('#callcard', 2)     // pan/zoom to it at the short's end
```

The object stores only a **reference** — `userData.isCallcard` plus its plane size — never a copy of the card's HTML or pixels:

- **In the live scene**, the object loads `/about/callcard` in a hidden same-origin iframe and rasterizes it once per scene load (`docs/editor/js/Callcard.js`, `hydrateCallcard`). It's a real `CanvasTexture` on a real plane `Mesh`, so it renders through the normal pipeline — no special-case viewport code.
- **At render time**, the Render tab re-fetches and re-bakes the card fresh (`refreshCallcard`) right before recording starts, so the export always carries the *current* card. `scene/serialize.js` strips the baked texture out of `sceneToJSON()` before every autosave/git-commit, so the persisted scene JSON never grows a copy of the card's pixels — only the reference survives.

## Trust boundary

The embed URL always resolves to this same-origin `/about/callcard` route — it is not a free-form field pointed at an arbitrary third-party origin. An embedded HTML component runs in the render/live context, so only first-party (or explicitly trusted) components should ever be embeddable this way; don't repurpose this mechanism to bake arbitrary third-party pages into a render without adding an explicit trust/sandbox model first (same concern as the [git URL-hash preload](GIT_VERSIONING.md#shareable-links-url-hash-preload)'s anonymous-read trust boundary).

## Updating the card

Edit `docs/about/callcard/index.html` (and bump `docs/strata-version.js` if it's a real release). Nothing else needs to change — every future render and every live view picks it up automatically; nothing already rendered is affected.

---

**Next:** [Animation](ANIMATION.md) · [← Back to README](../README.md)
