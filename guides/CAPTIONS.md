# Captions: addressable, self-describing, and a coverage workflow that is idempotent

**These captions are not transcriptions.** `captions.vtt` is a projection of the scene's cue list (`scene.userData.renderSubtitles`), the same object that drove the narration's timing, so the two cannot drift against each other: they are two renderings of one thing, not a measurement of one against the other.

That changes what "missing captions" means. **A missing caption file is usually an export that has not been run, not a transcription job.** Only a render whose scene has no cue list needs ASR, and then the track says so (`source: "asr"`), because a cue-derived timing is exact and an ASR one is approximate. Mixing the two silently is the same class of error as mixing seeded and verified records.

## A cue has an id, and the id is the caption's address

Every cue carries an **authored, stable id** (`intro-question`, not `7`). It is written as the WebVTT cue identifier on the line before the timing:

```
intro-question
00:00:00.800 --> 00:00:04.200
Why do these three molecules have different shapes?
```

So a caption is addressable the way a scene object is: a player can seek to it, a stated claim can be tied to the moment it is made, and a link can name a cue instead of a timestamp: `/player/#<address>&cue=intro-question`.

**An id never depends on position.** A positional number renumbers the moment someone inserts a cue, and every link made before that edit silently points at the wrong line. Ids are stored with the cues in the scene, so inserting a cue changes no other id, and saving does not renumber (`SetSubtitlesCommand` gives a cue that arrives with only words and times the id of the cue it is an edit of). Importing an `.srt` (which has no ids) keeps the id of any cue with the same words and times, then the same words, then the same times.

Authoring an id: the **id** field under each cue in the Render tab's Subtitles tab; in the Shell `setCueId('cue-y0quet1', 'intro-question')`, `setSubtitles([{ id, start, end, text }])`, and `nameCues()` (readable ids, from the first words, for cues that still have an auto-made `cue-xxxxxx` one: **do it before you share links, not after**). An id is letters, digits and `. _ ~ -`, starting with a letter or digit, at most 64, and unique. A cue with no id, an invalid one or a duplicate stops the publish with the cue named; nothing renumbers it.

## The file says where it came from

```
WEBVTT

NOTE
scene           tejaswigowda/test1@fdb3a56 a+b-cubed.json
cues            sha256:005c470c…
structure       sha256:5a7c9e72…
source          cues
language        en
ids             authored
exporter        strata-export/1.2.0
```

A caption file that travels away from its render (uploaded to a platform, sent to a translator) still says what it was generated from and against. Nothing in the block varies between exports (no date, no counter), so the same cues give the same bytes. `cues` is the sha256 of the id, times and words of every cue, `structure` of the ids and times only.

## render.json records every track

`outputs.caption_tracks` (an empty list when there are none; `outputs.captions` stays, as the first track's path, for anything that reads it as a path):

```json
{ "path": "captions.vtt", "language": "en", "source": "cues", "cues_sha256": "sha256:…", "structure_sha256": "sha256:…",
  "cue_count": 10, "addressable": true, "hls": "subs/en/index.m3u8" }
```

`source` is `cues` (exact), `asr` (inferred; also `asr: { model, version }`, and `addressable: false`: an id here would be positional, so there are none) or `manual` (written or edited by a person). A consumer translating or indexing the corpus needs to know whether a timing is exact or inferred, and so does anyone quoting a line.

## The coverage workflow: `tools/captions.mjs`

```
node tools/captions.mjs --check                  # report only, no writes; exit 1 if any render is stale or missing
node tools/captions.mjs --fill                   # generate missing and stale, from cues only; writes nothing when everything matches
node tools/captions.mjs --fill --asr             # additionally transcribe renders whose scene has no cue list
node tools/captions.mjs --add-track es es.json --render a+b-cubed
options: --root <checkout of the renders repo>  --only <render>  --json  --dry-run  --replace
```

**"Only add what is missing" is not enough, because a caption can be present and stale**: the cue list changed after the file was written, and no presence check sees that. So there are three states, decided by hashing what the file **contains** against the scene's cues **now** (the NOTE is read for provenance, not trusted for the verdict):

| state | condition | `--fill` |
|---|---|---|
| **present** | the file is there, its cues are the scene's, and render.json, `master.m3u8` and the subtitle playlist describe it | skips |
| **stale** | the file is there and the cues changed since, or it was edited by hand after export, or it has no provenance, or what describes it is out of date | regenerates |
| **missing** | no file | generates |

A fill is idempotent by construction: it writes a file only if its bytes would change. Run twice, the second run writes nothing (it says so).

Exit codes: `0` everything present, `1` something stale or missing (after a `--fill`: something a fill cannot do), `2` a render could not be judged (its scene file is not in the checkout) or a usage error.

- **`--replace`** also lets the scene's cues replace a track that is `asr` or `manual`. Without it those are left alone, because a hand edit or an inferred track is never silently promoted or discarded; `--check` notes when the scene now has the cues to make an exact one.
- **ASR is a marked fallback** (`--asr`): Whisper (`whisper` from `pip install openai-whisper`, or whisper.cpp's `whisper-cli`, or `--asr-cmd "yourtool {input} {outdir}"`) on the audio of the published set; the result is `source: "asr"`, with the model and its version, and no ids. **Where the scene still exists, author the cues instead**: an ASR pass produces a caption, authoring cues produces a caption *and* a scene that can be re-rendered, re-timed and translated.
- **Translation falls out of this.** One render, N caption tracks, the same cue ids throughout. `--add-track es es.json` takes `{ "<id>": "<words>" }` (or a `.vtt` with the ids), refuses a dropped or invented id, and writes `captions.es.vtt` with the scene's own timings. A translation is stale when a cue is dropped, added or re-timed, or when the *words* of the cues have changed since it was translated (`translated_from` is the hash of the cues it was made from); a fill cannot translate, so it leaves it and says so.
- **HLS.** Each track also gets a one-segment subtitle playlist (`subs/<lang>/index.m3u8`) and an `EXT-X-MEDIA TYPE=SUBTITLES` entry in `master.m3u8`, with `SUBTITLES="subs"` on every variant. The player shows them through hls.js (and a `<track>` for a render without the group).

In CI, in the repository that holds the renders:

```yaml
- uses: actions/checkout@v4
- uses: actions/checkout@v4
  with: { repository: tejaswigowda/threejs.editor.enhanced, path: strata }
- run: node strata/tools/captions.mjs --check
```

Tests: `node tools/__tests__/captions.test.mjs`, `node docs/editor/js/export/__tests__/captions.test.mjs`.

## What was and was not checked

Checked: on the two published renders (`a+b-cubed`, `projectile`), `--check` reported both **stale** (no provenance, positional ids), one `--fill` repaired both, a second wrote nothing; the editor's own publish of `a+b-cubed` produced the same `cues_sha256` as the tool computes from the scene file, and the tool judges an editor-published set `present`; hls.js shows the subtitle group (English, and a Spanish track with identical ids and timings), keeps every cue id, and `&cue=cue-dqo5863` seeks to 10 s; `ffmpeg` reads the file (ids and NOTE) as a `mov_text` track; real Whisper (`tiny.en`) on the narration of `a+b-cubed` wrote an `asr` track (its cue times are 0–5 s, 5–10 s; the scene's exact ones are 0.8–5.1 s, 5.4–9.7 s: that is the difference between the two sources).

Not checked: **Safari's native HLS** with the subtitle group (hls.js only); the `.vtt` file input of `--add-track` against a translation tool's real output (a hand-made `.json` was used); ASR other than `tiny.en` on one English narration.
