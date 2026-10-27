# Publishing a render

After a finished **offline** render, the Render tab's **Publish** step produces a set that a site can play, describes it in `render.json`, and commits all of it to a git repo in one commit.

```
renders/<scene>/render.json
renders/<scene>/poster.jpg
renders/<scene>/captions.vtt          (always written when the scene has subtitles, even if they are also burned in)
renders/<scene>/master.m3u8
renders/<scene>/1080p60/init.mp4  seg00001.m4s …  index.m3u8      (and 720p60, 480p60)
renders/<scene>/audio/init.mp4    seg00001.m4s …  index.m3u8      (once, shared by every rung)
renders/<scene>/narration.wav         (only when dub.webcli.app made the narration)
renders/<scene>/<scene>.mp4           (only when you add the single-file MP4: video copied, AAC audio, soft captions)
```

`<scene>` is the scene file's basename and the path is editable; the branch is the scene's, or a separate `renders` branch (created from the scene's branch if it does not exist), and the repo is the scene's or any other (a media repo).

## What it does, step by step

1. **Render** (offline): every frame at timeline time `n / fps` into one H.264 master (see `TIME_SOURCES.md`). The scene's canonical hash is taken when the render starts.
2. **Ladder** (`export/ladder.js`): the master is decoded once with WebCodecs; each frame is scaled into every rung and encoded at that rung's bitrate (1080p about 3.5 Mbps, 720p 1.8, 480p 0.9), a keyframe every two seconds. A rung is never larger than the master. Every frame's timestamp is checked against `n * 1e6 / fps`.
3. **Segments** (`export/fmp4.js`): fragmented MP4, one shared `init.mp4` per rung, `seg00001.m4s`… cut at the first keyframe at or after 6 s, `index.m3u8` per rung, `master.m3u8` over all of them. Timestamps are exact: timescale `fps * 1000`, 1000 ticks per frame.
4. **Poster**: the decoded frame at 15% of the film, JPEG.
5. **Captions**: the scene's subtitle cues as WebVTT. Burning subtitles into the picture is an *additional* option and never skips this file; the panel warns that burned-in text will appear twice.
5a. **Narration** (`export/audio.js`): the scene names a WAV (`setRenderAudio('audio/x.wav')` in the Shell, stored in `scene.userData.renderAudio`), read from the repo at the synced commit, or chosen by hand in the panel. It is decoded to 48 kHz stereo and encoded once with WebCodecs `AudioEncoder` (AAC-LC, ~128 kbps) into an fMP4 audio rendition, referenced by every video rung through an HLS audio group (`#EXT-X-MEDIA:TYPE=AUDIO`), and `mp4a.40.2` is added to every `CODECS` string. AAC frames are 1024 samples, so a 6 s video segment is 281.25 frames: each audio segment starts at the first whole AAC frame at or after the video segment's start, with no padding, so nothing drifts. The encoder's priming delay (2112 samples in Chrome here) is measured at publish time by encoding a noise burst and cross-correlating, then removed from the front of the input. The publish stops with a clear message if the browser has no AAC encoder.

   The narration need not be made by hand: **Dub the subtitles** opens `dub.webcli.app`, which speaks the scene's cues and returns the WAV. After Prepare, **Add a single-file MP4** has `ffmpeg.webcli.app` copy the master's video, encode the narration to AAC and add the captions as a soft track. Both are optional, run in a popup in the same browser, and are described in [HANDOFF.md](./HANDOFF.md) (protocol, ops, and how to run Strata locally so the popups can answer).
6. **render.json** (`export/renderJson.js`), validated against `docs/schemas/render.schema.json`.
7. **Review**, then **commit**: file tree with sizes, size warnings, staleness. Nothing is uploaded before the Commit button. The commit is one tree, one commit and one ref move: blobs are uploaded first, so a failure part-way leaves nothing on the branch.

## Playing a published render

`docs/player/` is a small static player: open `/player/#<address>`, where the address is the jsDelivr URL of the render's folder (or of any file in it, or its GitHub page), e.g. `/player/#https://cdn.jsdelivr.net/gh/tejaswigowda/test1@main/renders/projectile/`. It reads `render.json` for the title, poster, captions and facts and plays `master.m3u8`: natively in Safari, through the vendored hls.js (Apache-2.0, `docs/player/hls.min.js`) elsewhere, with a quality choice. A branch address (`@main`) shows a warning, because jsDelivr may serve an older render for hours; use `@<sha>` to pin one. Test: `node docs/player/__tests__/resolve.test.mjs`.

## Why the segmenter is in Strata, not ffmpeg.webcli.app

The work order named a hand-off of the encoded master to `ffmpeg.webcli.app`. Neither repository has a protocol for it, and re-encoding three rungs of 1080p60 in ffmpeg.wasm would be very slow. Strata already holds a WebCodecs encoder and a tested MP4 writer, so it writes the segments itself. No FFmpeg code is bundled or called, so the licence line is unaffected. Raw frames never leave the page either way.

## `render.json`

Four fields must not lie:

| Field | Rule |
|---|---|
| `render.mode` | `offline` or `realtime`. The publish step only offers offline renders; the writer and validator accept `realtime` (a wall-clock capture, variable frame rate) so a later path can say so. |
| `render.deterministic` | **Derived, never typed.** True only for `mode: offline` with the time-source audit passed (`TIME_SOURCE_AUDIT`, its residuals stated in `TIME_SOURCES.md`). It is **temporal** determinism: frame `n` shows `n / fps` and the duration is exact. It is not a claim about pixels; GPUs differ in the last bit. |
| `scene.hash` | `sha256:` of the canonical scene (below). |
| `render.frames` / `duration_s` | `frames == round(duration_s * fps)` for an offline render; the validator refuses anything else. |

`render.renderer` and `device` say what drew the frames. The export draws with a dedicated `WebGLRenderer` (`WebGLRenderer` / `webgl2`), not the live WebGPU view. On ten matched frames of `projectile` on a real GPU the two paths differ by a mean 0.91/255 (1.8 % of pixels by more than 16 levels): no visible difference, but the difference exists, and the Render tab says "Preview draws with WebGPU; export draws with WebGL2" (`TIME_SOURCES.md` has the method and numbers).

**`deterministic` is currently `false` on every render.** The time-source audit passes, but the empirical test does not: two renders of one scene were not byte-identical (the crossfade frames, the end card and the hardware encoder differ between runs, see `TIME_SOURCES.md`). `render.json` therefore carries `render.not_deterministic_because` with the reasons, `render.encoder` (`software` or `hardware`), and `time_source_audit.residuals_accepted`, each accepted residual with why it is safe. Flip `REPEAT_RENDER.verified` in `export/renderJson.js` only after a repeat-render test passes.

`scene.commit` is the commit the Git tab last synced the scene to. **A publish without one is blocked** ("Sync the scene first"): a render that cannot name the commit it came from is not published. If the scene is unchanged since the render, the current synced commit is used; if it was changed afterwards, the commit recorded when the render started is used, provided the scene was clean then. `outputs.renditions[].max_segment_bytes` is the real size of the largest segment.

## The canonical scene hash (`export/canonical.js`)

Not the bytes of the file. The hash covers the project settings, the scene graph (objects, geometries, materials, textures), scripts and background/environment, serialized with sorted keys and no whitespace, numbers by the scene save's own rule (times 4 decimals, positions 4, quaternions and matrices 5), geometry buffers untouched. Left out: the editor camera and controls, the undo history, the metadata stamp, and the compiled timeline clip (a cache rebuilt with a new uuid at every load; the timeline model it comes from *is* hashed). Imported clips are content and count.

Saving twice with no edit, and a save → load → save round trip, give the same hash; a real edit changes it. That is the same precondition as reviewable diffs.

## Size, and git

- A segment at 20 MB or more (jsDelivr's cap) and a file at 100 MB or more (GitHub's hard limit) **block** the publish; drop a rung or lower its bitrate.
- The panel always shows the total and what git does with binaries (**git keeps every version of a binary forever**: publishing six times stores six full copies), louder over 100 MB, and offers a separate `renders` branch (squashable without touching scene history) or a separate media repo.
- For a deterministic render it also says what makes this tolerable: the render is a build artifact, regenerable from the scene and `render.json`, so old renders can be pruned. Strata never deletes them.

## Checks

```
node docs/editor/js/export/__tests__/publish.test.mjs     # segments (decoded by a real ffmpeg when installed), hash, render.json, ladder, VTT, size gates
node docs/editor/js/export/__tests__/audio.test.mjs       # AAC packaging, segment alignment, real-ffmpeg decode
node docs/editor/js/export/__tests__/export.test.mjs
```

| Gate | How it was verified |
|---|---|
| R1 identical scene, identical hash | unit tests, and in the editor: two saves, and save → load → save twice, same hash; an edit changes it |
| R2 segments < 20 MB, files < 100 MB, warning | unit tests of the gates and the warning text; the panel showed the warning in the browser run |
| R3 `frames == round(duration_s * fps)` | validator; a real 4 s render gave 120 frames at 30 fps |
| R4 `deterministic` only for offline + audit | derived in code; unit-tested for realtime and a failed audit |
| R5 plays | `ffprobe` and `ffmpeg` decode every rung and the master with no warnings (30/1, every frame); **hls.js plays `master.m3u8` in Chrome**. **Safari's native HLS was not tested** (no Safari here). |
| R6 schema | `validateRenderJson` and a test that the schema file lists the same fields; **`lyceum.json`'s own schema was not available**, so this is checked against the work order's §2, not against the site |
| R7 one commit | in the editor, against a fake GitHub: one tree, one commit, one ref move holding every file |

The Render/Publish fixes work order added these:

| Gate | How it was verified |
|---|---|
| F1 audio group, `mp4a.40.2` everywhere, sync | unit tests (`audio.test.mjs`, including a real ffmpeg decode of the packaged AAC); real publishes decode with zero warnings; cross-correlation +0.0 ms at start, middle and end. **By-ear check not done.** |
| F2 1080p60, three rungs, `frames == round(duration_s × 60)` | Render tab defaults to 1920×1080 at 60 fps; a harness run of `projectile` produced 4842 frames at 60/1, 80.7 s, rungs 1080p60/720p60/480p60 (ffprobe counts 4842 frames in each). The user's own 1080p60 publish is still to do. |
| F3 byte-identical repeat renders | **failed**, so `deterministic: false` is enforced |
| F4 `scene.commit` or blocked | the Publish step blocks; a run against a synced scene recorded the commit |
| F5 renderer comparison | run and recorded in `TIME_SOURCES.md`, stated in the UI |
| F6 Safari native HLS | **not tested** |
| F7 production-scale publish | harness run, software encoder, headless Chrome on a loaded laptop: 77 s render, 226 s to prepare the 3-rung ladder and audio, JS heap 72 → 87 MB while rendering and 47 MB after, 14 segments per rung and in the audio rendition, 68 files, 58 MB, largest segment 2.6 MB (1080p), one commit. |
| F8 `captions.vtt` always written | in code and unit tests |
| F9 validated against `lyceum.json` | **blocked**: the schema does not exist here |

Player check: with the render served as if from jsDelivr, `/player/` plays the 1080p60 set with its audio in Chrome through hls.js (four quality choices, decoded audio bytes, no errors).

## Not covered

- Only full-range, flat (not 360°) offline renders are published. A realtime Preview capture is variable-rate and is not segmented.
- A scene with no narration (no `renderAudio`, nothing dubbed, no WAV chosen) publishes a silent set (no audio group), and the panel says so.
- The dub and ffmpeg hand-offs need the updated tools deployed and a Strata page that is not cross-origin isolated; see [HANDOFF.md](./HANDOFF.md). They were tested against both tools served locally, not the deployed sites.
- **A browser that encodes AAC but cannot decode it cannot publish narration.** The VS Code / Electron browser is one: `AudioEncoder` and `AudioDecoder` both report support, and the decoder then fails at the first packet. The encoder's start-up delay is measured by decoding a test burst, so Prepare runs a real encode/decode round trip first (`canDecodeAac`) and stops with that reason instead of guessing the delay. Publish from desktop Chrome, Edge or Safari.
- **Safari's native HLS has not been tested**, nor has an audio group in it. Test on a Mac and an iPhone before launch.
- **Audio/video sync was measured, not listened to**: the decoded HLS audio was cross-correlated against the source WAV at the start, middle and end (+0.0 ms each). Listen to the last cue too.
- `lyceum.json`'s schema was not available; `render.json` is validated against the work order, not the consumer.
- Publishing happens in the browser with the token from the Git tab; no hosting service other than a git repo.
- Nothing prunes old renders.
