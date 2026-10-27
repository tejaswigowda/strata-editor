# Hand-off to dub.webcli.app and ffmpeg.webcli.app

The Publish step uses two sibling tools as services instead of bundling their code:

| Tool | Job | Strata sends | Strata gets back |
|---|---|---|---|
| **dub.webcli.app** | subtitles to narration | `subtitles.srt` (the scene's cues) | `narration.wav`, timed to the cues, and dub's report |
| **ffmpeg.webcli.app** | one watchable file | `video.mp4` (the master), `audio.wav`, `captions.vtt` | `out.mp4`: video copied, AAC audio, soft caption track |

Nothing is uploaded. Strata opens the tool in a popup and the two windows pass files with `postMessage`, in the same browser. Crossing the origin boundary also keeps the licence line clean: FFmpeg and eSpeak are invoked across an origin, not bundled.

What stays in Strata: the HLS ladder, the segments, the **audio rendition inside the HLS set** (measured at +0.0 ms sync, byte-identical across runs), the poster, `render.json`. The MP4 is an extra file next to that set, not a replacement for it.

## In the Render tab

After a render, in **Publish**:

1. **Dub the subtitles** (Audio row; voice id beside it): the tool downloads the Kokoro model on first use (about 90 MB, then cached for that site), speaks the cues, and the WAV comes back. The row then says what made it. Prepare encodes that WAV into the HLS audio rendition, and the set gains `narration.wav`, so the audio can be traced to the tool, voice and model in `render.json` (`outputs.audio.source`).
2. **Prepare publish** as before.
3. **Add a single-file MP4**: pick which video it carries, then ffmpeg copies it (no re-encode), encodes the narration to AAC 128 kbps and adds the captions as a `mov_text` track the viewer can switch off. The set gains `<scene>.mp4` and `outputs.file` in `render.json`.

The video choice is each rung of the ladder (an fMP4 rung is just `init.mp4` + the segments joined, which ffmpeg reads directly) or the master. The default is the best one that keeps the MP4 under 20 MB, the most jsDelivr serves, else the smallest. The master is the encoder's own high bitrate (37 MB for 80 s of `projectile` at 720p30), the 720p rung 17 MB; `render.json` says which one the MP4 carries (`outputs.file.video`).

Both buttons must be pressed by hand: browsers block a popup that no click opened.

A dub with collisions or errors is not sent silently: the dub window asks whether to send it anyway, and Strata shows the problem in the Audio row.

## Running Strata yourself

A page served with `Cross-Origin-Opener-Policy: same-origin` (the dev server's default, for cross-origin isolation) has its link to any other site's window cut by the browser, so the tools can never answer. The hosted editor does not send that header. Locally, start the server with `STRATA_NO_ISOLATION=1`. Strata detects `crossOriginIsolated` and says this instead of timing out.

To test against tools served locally, add `?dubUrl=http://127.0.0.1:5601/&ffmpegUrl=http://127.0.0.1:5602/` to the editor URL (localhost only; any other host is refused).

## Protocol v1

Identical in both tools (`docs/handoff.js` in each repo) and in Strata's client (`docs/editor/js/export/handoff.js`). Every message is an object with `webcli: 1`.

```
tool   -> opener  { type: 'ready', tool, version, ops }                       on load, and again on every 'hello'
opener -> tool    { type: 'hello' }                                           repeated until 'ready' arrives
opener -> tool    { type: 'job', id, op, args, files: { name: ArrayBuffer } }
opener -> tool    { type: 'cancel', id }
tool   -> opener  { type: 'progress', id, fraction, text }
tool   -> opener  { type: 'result', id, files: { name: ArrayBuffer }, meta }
tool   -> opener  { type: 'error', id, message }
```

Rules the code enforces, each with a test:

- A tool answers **only `window.opener`**, only when the message's origin is `https://strataeditor.dev` or `http://localhost` / `http://127.0.0.1` (any port), and replies to that origin, never `*` (the one `ready` announcement carries no data).
- Strata accepts only messages whose `source` is the popup it opened and whose origin is the tool's.
- Buffers are transferred, not copied. The tool does one job at a time.
- A tool that is too old to offer the op is named in the error, with the ops it does offer.
- Closing the popup rejects the waiting job.

### Ops

| Tool | Op | Files in | Args | Files out | Meta |
|---|---|---|---|---|---|
| dub | `dub` | `subtitles.srt` | `voice`, `tier`, `device`, `name` (all optional; unknown values keep dub's defaults) | `narration.wav` | `report` (dub's own: `ok`, `collisions`, `duration_s`, `model`, `wav_sha256`, ...), `voice`, `tier`, `device` |
| ffmpeg | `mux` | `video.mp4`, and `audio.wav` and/or `captions.vtt` | `language` (3 letters, default `eng`), `audio_kbps` (32 to 320, default 128) | `out.mp4` | `command` (the exact ffmpeg arguments), `bytes` |

`mux` runs `ffmpeg -i video.mp4 [-i audio.wav] [-i captions.vtt] -map 0:v:0 [-map 1:a:0] [-map 2:s:0] -c:v copy -c:a aac -b:a 128k -ar 48000 -ac 2 -c:s mov_text -metadata:s:a:0 language=… -movflags +faststart out.mp4`, so the command in `render.json` is the whole recipe.

## Checks

```
node docs/editor/js/export/__tests__/handoff.test.mjs     # Strata's client against a fake popup
node --test test/handoff.test.mjs                         # in dub-webCLI and ffmpeg.wasm.editor: the popup side
```

Verified in real Chrome, driving the editor's own Render tab and Publish step with both tools served locally (and GitHub mocked): the render of `projectile` at 720p30, **Dub the subtitles** (148 s the first time, 79.05 s of audio, 12 cues, no collisions), Prepare, **Add a single-file MP4** (4 s), Commit: one commit of 54 files. The MP4 (720p rung, 18.3 MB) has `h264`, `aac` and `mov_text` streams, decodes with no warnings, and its audio and the HLS audio are each +0.0 ms from the narration WAV at the start, middle and end (cross-correlation). `render.json` carries `outputs.audio.source` (tool, voice, model, sha256) and `outputs.file`.

**Not tested:** the deployed `dub.webcli.app` and `ffmpeg.webcli.app` (this needs their next deploy), Safari, the dub window's "Send to Strata anyway" prompt (written, not exercised), and cancelling a job from Strata (closing the popup is the cancel).
