# Publishing a render

After a finished **offline** render, the Render tab's **Publish** step produces a set that a site can play, describes it in `render.json`, and commits all of it to a git repo in one commit.

```
renders/<scene>/render.json
renders/<scene>/poster.jpg
renders/<scene>/captions.vtt          (none when the subtitles are burned into the picture)
renders/<scene>/master.m3u8
renders/<scene>/1080p60/init.mp4  seg00001.m4s …  index.m3u8      (and 720p60, 480p60)
```

`<scene>` is the scene file's basename and the path is editable; the branch is the scene's, or a separate `renders` branch (created from the scene's branch if it does not exist), and the repo is the scene's or any other (a media repo).

## What it does, step by step

1. **Render** (offline): every frame at timeline time `n / fps` into one H.264 master (see `TIME_SOURCES.md`). The scene's canonical hash is taken when the render starts.
2. **Ladder** (`export/ladder.js`): the master is decoded once with WebCodecs; each frame is scaled into every rung and encoded at that rung's bitrate (1080p about 3.5 Mbps, 720p 1.8, 480p 0.9), a keyframe every two seconds. A rung is never larger than the master. Every frame's timestamp is checked against `n * 1e6 / fps`.
3. **Segments** (`export/fmp4.js`): fragmented MP4, one shared `init.mp4` per rung, `seg00001.m4s`… cut at the first keyframe at or after 6 s, `index.m3u8` per rung, `master.m3u8` over all of them. Timestamps are exact: timescale `fps * 1000`, 1000 ticks per frame.
4. **Poster**: the decoded frame at 15% of the film, JPEG.
5. **Captions**: the scene's subtitle cues as WebVTT.
6. **render.json** (`export/renderJson.js`), validated against `docs/schemas/render.schema.json`.
7. **Review**, then **commit**: file tree with sizes, size warnings, staleness. Nothing is uploaded before the Commit button. The commit is one tree, one commit and one ref move: blobs are uploaded first, so a failure part-way leaves nothing on the branch.

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

`render.renderer` and `device` say what drew the frames. The export draws with a dedicated `WebGLRenderer` (`WebGLRenderer` / `webgl2`), not the live WebGPU view.

`scene.commit` is the commit the Git tab last synced the scene to (null if there is none; the panel warns). `outputs.renditions[].max_segment_bytes` is the real size of the largest segment.

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

## Not covered

- Only full-range, flat (not 360°) offline renders are published. A realtime Preview capture is variable-rate and is not segmented.
- The offline render has no audio track yet (`TIME_SOURCES.md`), so neither do the segments.
- Publishing happens in the browser with the token from the Git tab; no hosting service other than a git repo.
- Nothing prunes old renders.
