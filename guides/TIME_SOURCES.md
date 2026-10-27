# Time sources, and what the offline renderer promises

Strata's Render tab has two modes that name their guarantee:

- Render (offline): every frame is drawn and captured, takes as long as it takes, exact timeline.
- Preview (realtime): plays at what this machine manages, may drop frames, not reproducible.

This page is the audit behind the first one: what its clock is, what could still leak wall-clock time into a render, and what is and is not promised.

## The decision (gate E0)

The words below are the Render tab's own copy (`docs/editor/js/export/frames.js`, `DETERMINISM_COPY`); a test fails if this page and the UI drift apart.

> Frame n always shows timeline time n / fps, so duration and frame count are exact, and two renders of one timeline match to the frame on any machine.
>
> On the same device, repeat renders draw pixel-identical frames; the encoded file is byte-identical too with the software encoder, but not always with a hardware one.
>
> Across different GPUs and drivers, pixels may differ in the last bit; that is not promised.

Three claims, kept apart:

| Claim | Status | Meaning |
|---|---|---|
| Temporal determinism | **promised** | frame `n` shows timeline time `n / fps`; duration and frame count are exact, whatever the machine or resolution |
| Pixel determinism, same device | **promised for the drawn frames**; for the file, only with the software encoder | repeat renders draw the same pixels; a hardware H.264 encoder may write different bytes for the same frames |
| Pixel determinism, across devices | **not promised** | GPU rasterisation differs in the last bit between GPUs and drivers |

One correction to the work order that prompted this: the export does **not** draw with WebGPU. It renders offscreen with a dedicated `WebGLRenderer` (`Sidebar.Render.js`), because the live WebGPU viewport must not share GPU resources with it. The cross-device caveat is the same (GPUs differ), but the end-of-frame fence is WebGL's `gl.finish()`, not `device.queue.onSubmittedWorkDone()`.

## The clock

```
for n in startFrame .. endFrame:
    outT  = n / fps                        # the only time source
    holdTimelineAt(editor, skip + outT)    # absolute: sets each action's time, then mixer.update(0)
    render through the shot's camera(s); gl.finish()      # the fence
    VideoFrame(canvas, { timestamp: round(n * 1e6 / fps) }) -> VideoEncoder
```

- No `requestAnimationFrame`, no wall clock, no sleeping to a schedule in the loop. A slow machine takes longer and writes the same frames.
- `holdTimelineAt` is absolute, not a delta, so nothing accumulates.
- The loop hands the thread back with a `MessageChannel` message, not a timer, so a background tab's timer throttling cannot slow or skew it.
- The encoder is fed through a bounded queue and drained by its own `dequeue` event, not a timeout.
- `export/Mp4Muxer.js` writes the file: one `stts` entry (count = frames, delta = 1000 on a timescale of `fps * 1000`), so `r_frame_rate` is exactly `fps/1`. It refuses a dropped, repeated or reordered frame instead of writing it, and writes no creation time, so the same chunks give the same bytes.
- A frame range `[start, end]` (inclusive, 0-based) renders just those frames; the file's first frame is PTS 0 and its name carries the range.

## What the audit found

Hits were found by grepping `docs/editor/js` (excluding `libs/` and tests) for `Date.now`, `performance.now`, `new Date`, `Clock`, `getDelta`, `getElapsedTime`, `Math.random`, `requestAnimationFrame`, `setInterval`, and for time uniforms in the shader and toon code (none). Each is either on the export path or not; those that are got fixed, routed or excluded.

### On the export path

| Where | Hit | Disposition |
|---|---|---|
| `intelligence/animationRecipes.js` `shakeRecipe` | unseeded `Math.random()` for the jitter, evaluated when the clip is built, and the timeline rebuilds its clips on every load | **Fixed.** The jitter is a hash of (object uuid, step): the same object always shakes the same way. Test: `shakeDeterministic.test.mjs` |
| `Sidebar.Render.js`, Preview loop | `performance.now()` drives the timeline | **Excluded by contract.** This is Preview (realtime), which says it is not reproducible |
| `Sidebar.Render.js`, offline loop | `performance.now()` | **Display only.** It measures speed for the ETA and the next estimate; it never feeds a frame time |
| `Timeline.js` playback tick | wall-clock playhead while playing | **Mostly resolved.** Starting any render pauses playback first (`timelinePauseRequested`); left running, the tick would sample the scene in the middle of the frame loop. **Residual:** a render started *while playback was running* still differed from one started when idle, by a few hundred scattered pixels per frame (measured on frames 2150-2250; the camera and material state I could read were identical, and merely seeking around the timeline did not cause it). Cause not found. Stop playback before a render you need to be reproducible |
| `Viewport.js` animate loop | `timer.getDelta()` into `mixer.update` | **Resolved.** The live viewport's loop is stopped for the duration of a render (`pauseViewportRendering`), and the timeline's actions are held, not running |
| `ViewLook.js` glow | `performance.now()` throttle | **Excluded.** DOM overlay, skipped while exporting, never in the captured canvas |
| `intelligence/faceTrack.js` idle layer | procedural motion | **Already deterministic.** Seeded (`mulberry32`, `idle({ seed })`), sampled at `t` |
| `intelligence/textChange.js:190` | `requestAnimationFrame` to dispose a slot's geometry | **Checked, no effect on output.** Replacing it with an immediate dispose changed nothing in the measured results; left as is because the live WebGPU viewport needs the delay |
| `Callcard.js` + `Sidebar.Render.js` | the end card is re-fetched and re-rasterised (`html2canvas`) at the start of every render | **Excluded, by design.** The card is a living page, so frames that show it are not reproducible between page lifetimes: the baked texture itself differed between the first render after a load and later ones (see below) |
| Shell scripts | user code can run its own `setInterval` / `requestAnimationFrame` | **Residual.** Anything that moves the scene by wall clock is outside the render clock. `opPrimitive.js` rejects raw loops in recorded ops and the AI prompt forbids them; a hand-written Shell loop is not caught. Scene motion must live in the timeline |
| CSS animations / transitions | overlaid DOM | **Not in the output.** Frames are drawn to canvases; the progress overlay is DOM and is never drawn into them. Burned captions are drawn with the 2D canvas from the cue times |

### Not on the export path (ids, UI, logging)

`intelligence/timeline.js` event ids (`Date.now`), `subtitles.js` cue ids and `Sidebar.Render.js` shot ids (`Math.random`), `faceTrack.js` key ids, `Timeline.js` key ids: identifiers only. `renderFileName.js` (`new Date()`): the date token in the file name, not the content. `Menubar.Git.js`, `WorkGuard.js`, `workState.js`, `History.js`, `Storage.js`, `Config.js`: network cache-busting, recovery timestamps, undo grouping, log lines. `Shell.js`, `Sidebar.js`, `Timeline.js` (UI), `Animation.js`, `MergeViewport.js`, `GeometryOptimizer.js`, `Menubar.Render.js` (path-traced still): UI refresh, import yielding, still images. `ai/*`, `AIPrompt.js`: identifiers and prompt text.

**Unresolved**: three stated residuals, none hidden: Shell wall-clock loops (not caught), the live end card (excluded), and rendering while playback is running (cause not found).

## Two real bugs the gates found

The simple test scene passed every gate on the first try. The real 98-second scene (`area-volume.json`, text, fades, a camera sequence, an end card) did not, and found two bugs that were not about the clock:

1. **A material's opacity could be silently ignored.** three.js bakes `transparent === false` into the shader program (`#define OPAQUE`: alpha forced to 1) and picks the program again only when `material.version` changes. The sampler flipped `transparent` when a fade started without telling three.js, so a material first drawn opaque (the black edge lines of a cube that later fades to glass) ignored its opacity for the rest of the render. What a render drew therefore depended on when each material was first drawn: a full render and a render of part of it disagreed, and the *full* one was the wrong one. Every flip made while sampling now goes through `intelligence/materialFlags.js` `setTransparent`, which sets `needsUpdate` on a real change. Test: `transparentFlip.test.mjs`.
2. **The sampler keeps state between samples** (what each text label last showed, its shadow and fade slots), so the first pass over a freshly loaded scene left it slightly different from every later pass: frames 48 to 595 of that scene differed, by a few pixels, between the first render after a load and the next. An offline render now **settles** first: it samples every frame once, in order, with no drawing (on the 6,031-frame scene the settle, the GPU warm-up and the end-card bake together took about 10 s before the first frame was drawn), so every render starts from the same state, whatever came before it and whatever range it covers.

## Measured results

Real scene, `area-volume.json` (98.52 s timeline, 4 cameras, text, fades, end card), on the machine that wrote this page (Apple GPU, Chrome, hardware H.264).

| Gate | Result |
|---|---|
| E3 `r_frame_rate = 60/1` | `60/1` at 720p and 1080p |
| E4 `nb_frames == round(duration × 60)` | 6031 frames, 100.516667 s, `round(100.516667 × 60) = 6031` |
| E5 no non-monotonic DTS warnings | 0 warnings from `ffmpeg -c copy -f null -` on every output |
| E6 same timeline at 720p and 1080p, same duration | **100.516667 s and 100.516667 s**, 6031 frames each (the bug: 127.055083 s against 128.709933 s) |
| E2 range render equals the same frames of a full render | See below |

E2 compares the drawn frame (a hash of the composited canvas, before encoding), not the encoded file: an H.264 encoder cannot reproduce a frame's bytes when it starts from a different place in the stream.

- **Simple scene** (a cube, a shadow, a shake): frames 40-80 and 0-5 identical to a full render; repeat renders identical; a render with an artificially slow, jittery frame handler identical.
- **Real scene**, ranges against a full render: 0-120 (text fade-in), 1768-1790 (camera cross-fade), 2150-2250 (text change), 3180-3260 (glass fade starts), 3440-3540 (glass held, then divide), 4000-4100 (cuts), 5000-5100 (membrane fold): **identical**.
- **Real scene, end card**: frames 5762 onward (the card, 269 frames) are identical between renders made after the first one, but not identical to the first render after the page loaded. The baked card texture itself differs (hash `2151371530` against `1656990056`), so this is the live card, not the renderer. Excluded from the gate, as listed above.
- Two full renders after the first: identical across all 6,031 frames, card included.
- A range render started while playback was running: **not identical** to a full render (101 of 101 frames differed on 2150-2250); see the playback row above. This is the one gate case that does not pass.
- With the software encoder, two renders (full and range) gave byte-identical files. With the hardware encoder, they did not (the decoded frames matched on later runs, the bytes did not), which is why the same-device claim for the file is limited to the software encoder.

## Not done, and logged

- **Hold-frame skipping.** 82% of the frames in the 1080p render that prompted this are legitimate holds; an offline renderer could detect unchanged scene state and re-emit rather than re-render. A large speedup on this content, and an optimisation of a path that now has correct timestamps. Next.
- Accumulation motion blur, supersampling, arbitrary output fps, 4K: unlocked by this, not needed yet.
- **Audio.** The offline file is video-only. The realtime path adds a silent audio track so `ffmpeg -map 0:a` works downstream; the offline path does not yet. Mux a track in `Mp4Muxer` if a downstream tool needs one.
- **Cross-origin muxing.** The work order proposed handing encoded chunks to `ffmpeg.webcli.app`. There was no hand-off protocol in either repository, so the muxer lives in Strata (`export/Mp4Muxer.js`), and so does the publish step's fMP4/HLS segmenter (`export/fmp4.js`, `guides/PUBLISH.md`): no FFmpeg code is bundled and none is called. The hand-off remains an option if the receiving side is ever built.
- **Publish metadata.** `render.json` records `rendered_at` from the wall clock. It is metadata only; no frame time, timestamp or segment boundary reads it, and nothing in the file's bytes depends on it except `render.json` itself. `render.deterministic` is true only for an offline render, and it is the *temporal* claim of this page: it does not mention pixels, and it comes with the three residuals above (the file lists how many).
- The old Preview path logs a WebGPU `Destroyed texture "PointShadowDepthTexture"` validation error when a scene with a point-light shadow is rendered. It is not new, and it appears on the Preview path too.
