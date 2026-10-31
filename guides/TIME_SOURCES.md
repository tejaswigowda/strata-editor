# Time sources, and what the offline renderer promises

Strata's Render tab has two modes that name their guarantee:

- Render (offline): every frame is drawn and captured, takes as long as it takes, exact timeline.
- Preview (realtime): plays at what this machine manages, may drop frames, not reproducible.

This page is the audit behind the first one: what its clock is, what could still leak wall-clock time into a render, and what is and is not promised.

## The decision (gate E0)

The words below are the Render tab's own copy (`docs/editor/js/export/frames.js`, `DETERMINISM_COPY`: `temporal`, `frames`, `bytes`, `crossDevice`, and the two mode lines above); a test fails if this page and the UI drift apart.

> Frame n always shows timeline time n / fps, so duration and frame count are exact.
>
> Frames: frame n depends on n / fps and the pinned inputs and on nothing else, and that is checked, not assumed. Verify redraws the frames in a shuffled order and each must match the sequential render; render.json says frames: true only after every frame passed, and publishes the sha256 of every frame so anyone can check.
>
> Bytes: the encoded file repeats byte for byte only with the software encoder (and the same browser build). A hardware encoder is faster and its bytes are not promised; that is a property of the encoder and does not change the frames.
>
> Across different GPUs and drivers, pixels may differ in the last bit; that is not promised.

Four claims, kept apart (this used to be one boolean, `deterministic`, with four reasons under it, which made a fixable bug and an encoder choice look the same):

| Claim | Status | Meaning |
|---|---|---|
| Exact time | **promised** | frame `n` shows timeline time `n / fps`; duration and frame count are exact, whatever the machine or resolution |
| `determinism.frames` | **earned per render** | frame `n` is a pure function of `n / fps` and the pinned inputs. `true` only after the shuffled-order test (below) passed on every frame, with every frame hashed. A subset check is evidence, not a claim |
| `determinism.bytes` | **earned per render** | the file repeats byte for byte: `frames` is true **and** the software encoder wrote it. The hardware encoder is a *choice* with a recorded consequence: its bytes are not promised, the frames are unaffected |
| Pixels across devices | **not promised** | GPU rasterisation differs in the last bit between GPUs and drivers |

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
| `Callcard.js` + `Sidebar.Render.js` | the end card is re-fetched and re-rasterised (`html2canvas`) at the start of every render | **Pinned.** It is baked once, at the start, and every frame is composited from that image. The image is recorded as an input: `endcard.png` in the publish set with its own sha256, the page it came from, and what the page said (its version stamp), in `render.json` `inputs.end_card`. A later render that differs says why. (The baked texture itself differed between the first render after a page load and the next, so the card cannot be assumed to rasterise the same twice; that is why it is hashed, not trusted.) A scene whose card could not be recorded (a failed refresh, or more than one card) is `frames: false` with that reason |
| Shell scripts | user code can run its own `setInterval` / `requestAnimationFrame` | **Confirmed absent from the animated quantities.** No animated quantity of a scene reads a Shell timer: a hand-written timer lives in the page, not in the scene file, and the grep above finds no animated quantity that reads any clock. A timer in the page can still change the scene while a render runs; it is user code outside the scene, and a render from a freshly loaded scene cannot contain one. `opPrimitive.js` rejects raw loops in recorded ops and the AI prompt forbids them |
| `intelligence/textChange.js` label state | a text label's `transparent` flag was set for a fade and never put back; before the first `change()` the label kept whatever string an earlier sample left; in the invisible half of a fade it kept the previous sample's string | **Fixed, found by the shuffled-order test.** A label that had ever faded was drawn through the transparent pass for the rest of the session, so the same time drew differently on a fresh scene and a scrubbed one (25 frames of `area-volume` in the first run). The flags now go back to what the author had (recorded once, before this file first touches the material), before the first change the authored text is restored, and in the invisible half of a fade the node shows the previous string. Test: `textChangeState.test.mjs` (every sampling order gives the same label at every time) |
| `Sidebar.Render.js` 2D canvas | an offline render reads every frame back to hash it, and a browser moves a 2D canvas from the GPU to the CPU after enough readbacks, at a frame it chooses; a crossfade (`globalAlpha`) rounds differently in the two | **Fixed.** The output canvas is created with `willReadFrequently`, so every frame is blended the same way. Without this, 4 frames inside the crossfades of `a+b-cubed` (241, 831, 1119, 1130) differed between a clean-state pass and the sequential render. It also explains the earlier "crossfade frames depend on render history" finding: that measurement hashed frames by the same readback |
| CSS animations / transitions | overlaid DOM | **Not in the output.** Frames are drawn to canvases; the progress overlay is DOM and is never drawn into them. Burned captions are drawn with the 2D canvas from the cue times |

### Not on the export path (ids, UI, logging)

`intelligence/timeline.js` event ids (`Date.now`), `subtitles.js` cue ids and `Sidebar.Render.js` shot ids (`Math.random`), `faceTrack.js` key ids, `Timeline.js` key ids: identifiers only. `renderFileName.js` (`new Date()`): the date token in the file name, not the content. `Menubar.Git.js`, `WorkGuard.js`, `workState.js`, `History.js`, `Storage.js`, `Config.js`: network cache-busting, recovery timestamps, undo grouping, log lines. `Shell.js`, `Sidebar.js`, `Timeline.js` (UI), `Animation.js`, `MergeViewport.js`, `GeometryOptimizer.js`, `Menubar.Render.js` (path-traced still): UI refresh, import yielding, still images. `ai/*`, `AIPrompt.js`: identifiers and prompt text.

**Unresolved**: one stated residual, none hidden: rendering while playback is running (cause not found). The Shell wall-clock loops are confirmed not to feed any animated quantity, and the end card is a pinned input (above); both used to be listed here.

## What the audit confirmed, and what is still live

The audit used to leave three residuals, two of them carried as standing exceptions. A standing exception lets a leak hide behind it, so each is now either confirmed absent or a pinned input, and `render.json` (`time_source_audit`, from `TIME_SOURCE_AUDIT` in `export/renderJson.js`) lists what was **confirmed** and what is **live when present**:

| Item | Status | How |
|---|---|---|
| No animated quantity reads a wall clock | **confirmed** | The grep in "What the audit found": every hit is an id, UI, the Preview loop, or a measurement for the ETA. `shakeRecipe`'s jitter was the one animated quantity that did, and is a hash of (object, key) now |
| No animated quantity integrates a delta | **confirmed** | Every one is set from an absolute time: `holdTimelineAt` sets each action's time and calls `mixer.update(0)`; the crossfade weight is `smoothstep((t - cut) / duration)`, computed from the frame's own time. The only `getDelta` is the live viewport's loop, which is stopped for the duration of a render |
| No animated quantity reads a previous frame's value | **confirmed by test, after fixing three** | The shuffled-order test below. It found three history dependences in label state and one in the output canvas (rows above), all fixed |
| Shell wall-clock loops | **confirmed absent** from the animated quantities | A timer in the page is not in the scene file and no animated quantity reads it |
| The end card | **a pinned input** | Baked once, recorded with its own sha256 (`inputs.end_card`) |
| Playback running when a render starts | **live when present** | Differed by a few hundred pixels per frame, cause not found. The Render tab records whether playback was running when the render began (`editor.timelinePlaying`); if it was, `determinism.frames` is `false` with the reason. Not re-measured with the shuffled-order test |

## The shuffled-order test (gate D2)

"Render twice and compare" is a weak test: a sequential render can reproduce the same leaked state both times and look deterministic while being wrong. The test that catches a leak is the definition itself: **frame n depends on n / fps and nothing else**, so frames drawn in an order no sequential render uses must be identical to the sequential ones.

What the Render tab does when **Verify** is set (`Sidebar.Render.js`; the pure parts, the order and the verdict, are in `export/frameHashes.js` with tests):

1. The scene is left exactly as it was loaded. **Before** the settle pass has visited a single frame (the state a history-dependent quantity cannot hide in), the frames to check (every frame, or every 17th) are drawn in a seeded shuffle in which no frame is next to its sequential neighbour. Each is reached by absolute seek and hashed (sha256 of the raw RGB, before encoding).
2. The render then runs sequentially as usual (settle, warm-up, encode), hashing every frame.
3. Each shuffled hash must equal the sequential one. The verdict is recorded in `render.json` (`determinism.verification`: frames checked, `complete`, `passed`, and the numbers of any frames that differ) and the frames that differ are named, as ranges, in the console and in the reasons. `determinism.frames` is `true` only for a **complete** pass (every frame).

Every render also publishes `frame-hashes.txt` (one `<n> <sha256>` line per frame) and its root hash (`outputs.frame_hashes`), so two renders are compared by diffing two lists, and the frames-versus-bytes question answers itself: identical hashes with different file bytes is the encoder.

**In CI.** `node scripts/verify-frames.mjs --scene '#repo=owner/name@<sha>&file=scene.json'` runs the same check headless against a served editor and exits 1 if any frame depends on more than `n / fps` (every 17th frame by default, a draft check; `--every all` before a claim is published; `--out result.json` writes the frame hashes, so two runs can be diffed with `diffHashes` in `export/frameHashes.js`). It needs `playwright-core` and Chrome, and uses software GL, so it runs without a GPU.

**The test can fail.** With a deliberately history-dependent crossfade weight injected (a weight blended with the previous frame's), the test failed on exactly frames 240-254, the 15 frames of the crossfade at 10 s at 24 fps, and nowhere else. (The injection was a temporary experiment and is not in the code.)

**What it found.** Run on four real scenes, 640 × 360 at 24 fps, software GL, headless Chrome:

| Scene | What it has | First run (current code at the time) | After the fixes |
|---|---|---|---|
| `a+b-cubed` | 5 shots, 4 crossfades, end card | 1229 of 1229 with the settle pass first; **4 differed (241, 831, 1119, 1130) once the test ran from a clean state, all inside crossfades** | **1229 of 1229** |
| `area-volume` | text changes and fades, 4 cameras, end card | **25 of 2412 differed** with the settle pass removed (36, 68, 74, 88, 98-99, 101, 105, 128, ...); 2 after the label fix (955, 1822: the canvas mode switch) | **2412 of 2412** |
| `projectile` | 3 crossfades, text, end card | not run before the fixes | **1937 of 1937** |
| `hardy-weinberg` | text, fades, end card | not run before the fixes | **2798 of 2798** |

The settle pass had been **hiding** the first of these: with it, `area-volume` passed; without it, 25 frames did not. The cause was not the sampler's cache but a flag: `material.transparent` on the `readout` label and its shadow (the probe: the same timeline time, a fresh scene against a scrubbed one, and a diff of every object's visibility, transform, opacity, `transparent`, `depthWrite` and geometry size; the only difference was that flag). It is fixed in `textChange.js`, along with two siblings the miniature test found (the authored string before the first change, and the previous string on the invisible half of a fade). The settle pass is still run, as a cheap warm-up, but nothing now depends on it: the test runs before it.

The crossfade mismatches were the other finding, and they explain the old measurement. A crossfade composites two shots with `globalAlpha` on a 2D canvas, and an offline render reads every frame back to hash it. After enough readbacks a browser moves a 2D canvas from GPU to CPU rasterisation, at a frame it chooses, and the two round a blend differently. Which crossfade frames were drawn after the switch decided their pixels: sporadic, and apparently "dependent on render history". The earlier repeat-render test hashed frames by the same readback, so it measured its own side effect. The output canvas is now created with `willReadFrequently` (CPU from the start), and the same frames then pass.

**Byte determinism (gate D6).** With the software encoder, two renders of `a+b-cubed` frames 0-300 (the first crossfade included) in separate browser processes gave the **same MP4**: 1,290,091 bytes, sha256 `878fc88b4ea0281ecfd44a7bc08a67054d3b1dfa685b431eb3522d78f0a221fe`, and the same frame-hash root. The hardware encoder was not exercised here (headless Chrome has no hardware encoder), so what is said of it rests on the earlier measurement: the same frames, different bytes on each run. `render.encoder` records which was used, the browser build, and a hash of its exact settings; the bytes are promised only for the same browser build.

**Not done.** The scenes are four tutorial shorts (text, fades, crossfades, an end card, procedural geometry); a scene with a skinned character, face morphs from a baked clip, imported animation clips or camera splines was not run through the test, so the claim for such a scene is whatever its own Verify run says. The settle pass was not removed. Real-GPU rendering was not run (software GL only): the claim is per device, and Verify is how a device earns it.

## Preview and export (gate F5)

The live view draws with `WebGPURenderer`; the export draws with a dedicated `WebGLRenderer` (WebGL2). Ten matched frames of `projectile.json` (3, 9, 15, 24, 30, 38, 49, 55, 67, 75 s) through the shot camera, WebGPU viewport on a real GPU (Chrome, Apple Metal) against the 1280 × 720 export frame, both scaled to 640 × 360: mean absolute difference **0.91** levels in 255 (0.62 to 1.89), mean signed difference **-0.3, -0.3, -0.4** (the preview a fraction darker), **1.8%** of pixels differ by more than 16 levels (edges, text anti-aliasing, the distant grid). No visible difference in colour, tone mapping or shadows on this scene. Two cautions: it is one scene, and the first comparison I ran showed a difference of 35 levels: that was the player's Play overlay dimming the viewport, which is in the viewport's pixels until it is dismissed. The Render tab now says which renderer draws which (`RENDERER_COPY`). The command: `node scripts/compare-render.mjs <url> --times … --real-gpu` (its Take Snapshot step timed out in the headless run, so the numbers above came from capturing the export's own frames).

## Two real bugs the gates found

The simple test scene passed every gate on the first try. The real 98-second scene (`area-volume.json`, text, fades, a camera sequence, an end card) did not, and found two bugs that were not about the clock:

1. **A material's opacity could be silently ignored.** three.js bakes `transparent === false` into the shader program (`#define OPAQUE`: alpha forced to 1) and picks the program again only when `material.version` changes. The sampler flipped `transparent` when a fade started without telling three.js, so a material first drawn opaque (the black edge lines of a cube that later fades to glass) ignored its opacity for the rest of the render. What a render drew therefore depended on when each material was first drawn: a full render and a render of part of it disagreed, and the *full* one was the wrong one. Every flip made while sampling now goes through `intelligence/materialFlags.js` `setTransparent`, which sets `needsUpdate` on a real change. Test: `transparentFlip.test.mjs`.
2. **The sampler keeps state between samples** (what each text label last showed, its shadow and fade slots), so the first pass over a freshly loaded scene left it slightly different from every later pass: frames 48 to 595 of that scene differed, by a few pixels, between the first render after a load and the next. An offline render now **settles** first: it samples every frame once, in order, with no drawing (on the 6,031-frame scene the settle, the GPU warm-up and the end-card bake together took about 10 s before the first frame was drawn), so every render starts from the same state, whatever came before it and whatever range it covers. **Later finding:** this treated a symptom. The shuffled-order test, run from the unsettled state, found what the settle was washing out (a label's `transparent` flag and two other label states, now fixed in `textChange.js`), and the settle pass is now only a warm-up: nothing depends on it, and the test runs before it.

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
- **Real scene, end card**: frames 5762 onward (the card, 269 frames) are identical between renders made after the first one, but not identical to the first render after the page loaded. The baked card texture itself differs (hash `2151371530` against `1656990056`), so this is the live card, not the renderer. That was the finding that made the card a pinned input (baked once, hashed, recorded: `inputs.end_card`).
- Two full renders after the first: identical across all 6,031 frames, card included.
- A range render started while playback was running: **not identical** to a full render (101 of 101 frames differed on 2150-2250); see the playback row above. This is the one gate case that does not pass.
- With the software encoder, two renders (full and range) gave byte-identical files. With the hardware encoder, they did not (the decoded frames matched on later runs, the bytes did not), which is why the same-device claim for the file is limited to the software encoder.

## Not done, and logged

- **Hold-frame skipping.** 82% of the frames in the 1080p render that prompted this are legitimate holds; an offline renderer could detect unchanged scene state and re-emit rather than re-render. A large speedup on this content, and an optimisation of a path that now has correct timestamps. Next.
- Accumulation motion blur, supersampling, arbitrary output fps, 4K: unlocked by this, not needed yet.
- **Audio.** The offline master file is video-only. A published set carries the scene's narration as a separate AAC audio rendition (`guides/PUBLISH.md`); the downloaded master does not include it.
- **Cross-origin muxing.** The work order proposed handing encoded chunks to `ffmpeg.webcli.app`. There was no hand-off protocol in either repository, so the muxer lives in Strata (`export/Mp4Muxer.js`), and so does the publish step's fMP4/HLS segmenter (`export/fmp4.js`, `guides/PUBLISH.md`): no FFmpeg code is bundled and none is called. The hand-off remains an option if the receiving side is ever built.
- **Publish metadata.** `render.json` records `rendered_at` from the wall clock. It is metadata only; no frame time, timestamp or segment boundary reads it, and nothing in the file's bytes depends on it except `render.json` itself. `render.determinism.frames` is earned per render (a complete, passed shuffled-order test) and `render.determinism.bytes` needs the software encoder as well; neither says anything about pixels across GPUs. The residual still live is playback running when a render starts.
- The old Preview path logs a WebGPU `Destroyed texture "PointShadowDepthTexture"` validation error when a scene with a point-light shadow is rendered. It is not new, and it appears on the Preview path too.
