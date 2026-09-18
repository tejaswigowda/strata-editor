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

## Cinematic reveal: filling the frame

The card is a plane, `DEFAULT_WIDTH = 1.8` × `DEFAULT_HEIGHT = 3.2` world units (a 9:16-ish portrait). Its point isn't to sit visible-but-small in a corner of a shot — for an end-card beat, the camera should arrive at a distance where the card **fills the frame edge-to-edge**, with nothing else visible. Two things make that land well:

**1. Compute the fill distance from the card's real size, not a guess.** For a camera with vertical FOV `fov` and aspect `a`, the horizontal FOV is `2·atan(tan(fov/2)·a)`. Solve for the distance `d` where the card's world-space width exactly spans that horizontal FOV:

```js
const cardWidth = 1.8 * scale;                    // world units, after $S('#callcard').scale(scale)
const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect);
const fillDistance = (cardWidth / 2) / Math.tan(hFov / 2);
```

Land a little *closer* than the exact solution (e.g. `fillDistance * 0.85`) — an exact edge-to-edge fit reads as "almost full frame" once encoding/scaling softens the edges; slightly overfilling (bleeding a little off-frame) reads as **fully** filling it.

**2. A cinematic reveal is a push-in along one axis, not a teleport.** Choreograph it as a `Group` of `.animate()` legs on the camera that all share the same direction vector — the direction the camera was already facing when it turns to notice the card — just at decreasing distance from the card:

```js
const dir = lookAtTarget.clone().sub(cameraPos).normalize();   // the camera's existing forward axis
const posAtDistance = (d) => cardPos.clone().add(dir.clone().multiplyScalar(d));

$S('#camera').at(T).animate({ to: { position: posAtDistance(13).toArray() }, lookAt: cardPos.toArray() }, 2500, 'ease-in-out');
$S('#camera').at(T + 2.5).animate({ to: { position: posAtDistance(fillDistance).toArray() }, lookAt: cardPos.toArray() }, 3000, 'ease-in');
$S('#callcard').at(T + 0.3).fadeIn(2.2);
```

Keep **FOV constant** across the legs — animating FOV and distance together is a dolly-zoom (vertigo effect), which reads as a mistake here, not a choice.

**3. The rotation-vs-approach-side gotcha.** The card's un-rotated `PlaneGeometry` faces world `+Z`. If you set `rotation.y = Math.PI` (a common pattern for "place it behind the camera, then rotate so it faces back"), that only shows the printed side correctly if your camera ends up on the plane's **new** facing side — i.e. at a *lower* world Z than the card, if the card sits at a *higher* Z than where you're placing the camera. Concretely: `rotation.y` should be `0` if your final camera position has a **higher** value along the card's original facing axis than the card itself, and `Math.PI` if **lower**. Getting this backwards doesn't hide the card — a `DoubleSide` material still renders it, just mirrored and upside-down (the back face, not simply "facing away"). If the reveal looks flipped, this is almost always why — check which side of the card's un-rotated normal your final camera position actually lands on, don't just copy the `Math.PI` default.

---



**Next:** [Animation](ANIMATION.md) · [← Back to README](../README.md)
