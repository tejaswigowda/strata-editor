# Strata as a universal substrate

*One labeled artifact, many renders. The authoring layer for 3D that outlasts the engine.*

---

## The thesis in one line

**Strata authors a single, self-describing 3D artifact — a labeled GLB — and that
one artifact feeds every downstream: linear renderers (film) and interactive
runtimes (games), across desktop, mobile, and XR, by hand or with AI, versioned in
git.** Strata is the authoring substrate; the labeled GLB is the universal medium;
everything downstream is a *consumer* of it.

---

## The substrate: what makes the artifact universal

Strata's output is not "a 3D file." It is a **labeled** scene: geometry, materials,
cameras, and animation, plus a CSS-like addressable vocabulary (3DOM) baked into the
file's `userData`/`extras`. The labels are the load-bearing part — they make the
artifact *self-describing*, so any consumer (a renderer, a game runtime, an agent)
can address `#door`, `.enemy`, `#hero-camera` by name instead of by fragile object
path. Content is authored once; behavior and presentation attach to the labels
downstream.

The core addressing layer (3DOM, "jQuery for 3D") is a small, versioned, standalone
library. It does not grow to accommodate downstreams — game logic, physics, and
device-specific behavior live *outside* it as plain code. Keeping the core small is
what keeps the artifact durable.

---

## Performance is data too

The labeled artifact does not stop at geometry and static looks. A *performance* —
captured body motion, a face, where a character looks — is also addressable data on
the same universal timeline, edited by the same selector grammar, versioned in the same
git history. This is the principle applied to acting: **performance as editable data,
not a baked video.**

- **Captured motion is cut as an edit list, never re-baked.** A two-performer capture
  (170 s) is trimmed to a 53 s cut with a few hundred bytes of spans
  (`$M('sparring').splice([...], { blend })`). The capture is only ever read; clearing
  the list restores it. Performers captured in one metric frame are edited as a
  registered unit, and a hip-to-hip collision report checks the result. See
  [Animation](ANIMATION.md#motion-edit-lists--cut-captured-motion-as-data).
- **The face is two keyed channels, plus a seeded idle layer.** Expression (continuous
  morph weights with easing and duration per key; presets expand to explicit keys) and
  gaze (a named target that follows a moving character; eyes lead, head lags, with an
  anatomical clamp) sit on the character's track, with a deterministic blink / breath
  underlayer. The animator's face on stylized targets — not a face-capture substitute.
  See [The authored face](FACE_TRACK.md).
- **Looks are rig-safe ops.** The character customizer (tint, recolor, hide, blendshape
  poses, bone-attached props) never edits vertices, skin weights or the skeleton, and
  verifies that by fingerprint. See [Character customizer](CUSTOMIZER.md).

Two properties make this part of the substrate rather than a feature: it is
**deterministic** (same keys and seeds, same result, byte for byte, with no viewport —
so an agent can author a performance headlessly) and it is **one model** (shell and GUI
write the same events through one undo stack).

The saved scene stays small enough to be a durable artifact: it is written as compact
JSON (never pretty-printed), with animation floats quantized by a documented, lossy,
deterministic step. Measured on the 170 s capture: 349.9 MB pretty-printed → 107.0 MB
compact → 84.4 MB compact and quantized. See [Git integration](GIT_VERSIONING.md#how-a-scene-is-written).

---

## Two downstream families

| | **Linear (film)** | **Interactive (games)** |
|---|---|---|
| What it produces | rendered frames / video | a playable experience |
| Sovereign-web path | in-editor video render (mp4/webm, camera sequences, subtitles) | three.js + raycaster + cannon-es (optional) + 3DOM + agent-authored plain-JS logic |
| Engine-handoff path | Blender / Unreal (glTF or USD) | Unity / Unreal / PlayCanvas (import the GLB, use their runtime) |
| Where behavior lives | lighting & grade, authored per renderer | interaction logic, authored per modality |

The structure is symmetric: each family has a **sovereign, web-native path** (no
build, on-device, URL-addressable, zero marginal cost) and an **engine-handoff path**
(heavier, not sovereign, full production capability). Same artifact, four destinations.

---

## Across devices: why web-native is the differentiator

The web is the one runtime that already spans **desktop, mobile, and XR from a single
source** — three.js + WebXR runs in a desktop browser, a phone browser, and a headset
browser with no per-platform build. Native engines compile per target; the web does
not. So "one labeled artifact → many device renders" is real *because* it is
web-native.

The honest split, which mirrors the film boundary exactly:

- **Content is universal.** The labeled GLB is device-agnostic — geometry and labels
  don't change between a phone and a headset.
- **Interaction and look are not.** Input (mouse/keyboard vs touch vs controllers vs
  hand-tracking), UI, and control scheme adapt per device — and XR is often a
  different interaction *design*, not a responsive reflow. Lighting/grade is authored
  per renderer. This is authored work, not a free transform.
- **Addressability is the responsiveness mechanism.** The same labels that wire logic
  let a runtime cull, swap, or simplify per device tier (`$S('.detail').hide()` on
  mobile). One substrate, tier-adapted by selector.

---

## Honesty ledger (verified vs. expected)

The claim is only as good as this table stays accurate.

| Capability | Status |
|---|---|
| Author scene + universal timeline + git versioning | **Shipped** |
| CDN-resolved, URL-addressable / embeddable scenes | **Shipped** |
| On-device model sufficiency (1.5B), eval matrix | **Shipped** |
| Compact, deterministic scene save (no pretty-print; quantized animation floats) | **Shipped** — measured 349.9 → 84.4 MB on a 170 s capture; existing repo scenes not yet re-saved |
| Non-destructive motion editing (edit list, registered pairs, collision report; GUI + shell) | **Shipped** — verified on a real two-performer capture; glTF export of a cut is baked but *not yet round-tripped through Blender / Quick Look* |
| Authored face: expression + gaze keys, seeded idle layer (GUI + shell, one undo) | **Shipped** — stylized/VRoid-style targets; export bakes morph weights and eye/head rotation, *not yet round-tripped through Blender / Quick Look* |
| Authored face on characters warped by a photo bind (facebind) | **Known limit** — morph deltas are carried through the warp untouched; measured error up to ~13% of face height at bind strength 1 (see [The authored face](FACE_TRACK.md#facebind-gate-read-this-before-building-on-a-bound-character)) |
| Audio-derived visemes (speech) | **Logged, not built** — forced alignment is unspiked; a hypothesis, not a result |
| Loading very large chunked scenes on Android | **Open** — a client-side reassembly failure is reported and not reproduced or fixed; smaller files reduce the pressure but do not remove it |
| Film round-trip → **Blender 4.5** (cameras + object & camera animation, camera drives view) | **Verified** |
| Film round-trip → **Apple Quick Look** (USDZ; cameras + animation play) | **Verified** |
| Film → Unreal / Unity | **Expected** via FBX/USD — *not yet tested* |
| Games (web path): GLB + agent-wired plain-JS logic, Playwright-verified | **Architected** — *not yet demonstrated with a shipped, forkable game* |
| Cross-device responsive game (desktop/mobile) | **Conceptual** |
| XR (WebXR) | **Plausible & web-native** — real ceilings vs native XR; *not demonstrated* |

Nothing in the "expected/conceptual" rows is claimed as done. The linear half is
proven across two independent pipelines; the interactive half is designed and awaits
its first shipped demo. The performance-as-data rows are verified inside Strata (unit
tests plus the live editor), not yet through an external renderer, and the rows marked
known limit or open are stated as such on purpose.

---

## The durability covenants

"Outlasts the engine" is a promise that must be *kept*, not a property that comes free:

1. **Never break the loader.** The scene format stays backward-compatible, forever, so
   old URLs keep resolving. (Versioned per the Manifest spec.)
2. **Pin the runtime.** Games freeze their dependency versions (three.js, cannon-es,
   3DOM CDN build) in an importmap, so library churn can't rot an old game.
3. **Stable, self-hostable URL contract.** The `#repo=owner/repo&file=…` scheme is
   fixed and CDN-resolved (never the rate-limited GitHub API), so a link survives
   scale and can be re-hosted if any one host disappears.
4. **Sandbox executable content.** A game runs repo-hosted *code*, not just data, so it
   executes in an isolated origin/iframe — a shared game link must never reach the
   host's tokens or DOM.
5. **Never destroy the capture.** Performance edits (cuts, retimes, face and gaze keys)
   are data layered over the source; the captured clip is only read, and clearing the
   edits restores it. Lossy steps are named, documented and deterministic (the save-time
   quantization), and a seeded layer (idle blinks) renders the same on every run.

With these, the artifact survives game engines absolutely, and library/tool churn by
construction. The git source is the ultimate backstop: content is standard (GLB),
logic is plain JS, addressing is a small pinned library — nothing proprietary anywhere.

---

## Why it's a substrate, not a feature

A 3D-editor feature serves one domain. A substrate serves many with the same core. The
evidence that Strata is the latter is **cross-domain span**: the same labeled GLB
feeds film (linear) and games (interactive), and the author sits in both a film
context and the game school — the two departments a universal substrate would have to
serve. If one artifact, authored once, serves both across devices, that isolates the
load-bearing idea (a self-describing, addressable, versioned artifact + a small stable
core) from any single domain's machinery. That is what turns "a methodology" into "a
discovered principle."

---

## What it is not

- **Not an engine replacement.** It doesn't beat Unity/UE for AAA or large-team
  production; those are the engine-handoff path. It's the *authoring and content*
  layer upstream of them.
- **Not native-XR parity.** Web XR is uniquely universal and zero-install, with real
  performance ceilings against native at the high end.
- **Not a games IDE.** Authoring is the agent + VS Code + git; the "player" is a
  minimal run-and-fork surface, not a visual game editor.
- **Not "the GLB is the game."** The GLB is the level/content; a game is that content
  plus a thin, sandboxed runtime.
- **Not a face-capture substitute.** The authored face is hand-keyed expression and
  gaze for stylized characters; speech-driven mouth shapes are not built.

---

## One paragraph, for a pitch

*Strata is the authoring layer for 3D that outlasts the engine. You build a scene once
— addressable, versioned, human-readable — and it becomes a single labeled artifact
that renders as film (verified today in Blender and Quick Look) or plays as a game
(three.js on the web, or handed off to Unity/Unreal), across desktop, mobile, and XR,
from one source. The performance in it — captured motion, a face, where a character
looks — is editable data too: cut, retimed and keyed without ever modifying the capture.
Content is universal; lighting and interaction are authored per
target. It's sovereign, browser-native, git-versioned, and needs no build — the
content is a standard file, the logic is plain code, and nothing in the stack is
proprietary. The idea outlasts the engine because the work was never trapped in one.*
