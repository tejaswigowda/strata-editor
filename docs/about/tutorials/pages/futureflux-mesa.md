---
slug: futureflux-mesa
title: "FutureFlux: From a Mesa heat map to a tree-shade proposal"
status: published
description: Follow a bilingual Mesa surface-heat tour and use a Playwright harness to test clarification, suggestions, and scene edits.
---

Follow the 48-second Mesa heat tour in Strata, then use a separate Playwright harness to rehearse how a resident’s suggestion becomes a validated scene edit.

## 1. Follow the heat tour in Strata

1. Open the [Mesa project](https://strataeditor.dev/#repo=tejaswigowda/test1&file=flux.json&branch=main). A locally edited copy may differ from the repository revision. Don’t replace a scene with unsaved edits.
2. Enable the timeline checkbox that follows the Render camera sequence. Select **as render** in the viewport to see the render materials and shadows.
3. Open **Render → Subtitles** to review the timed cues, or choose **Import .srt** to load a track. The bilingual format uses English on the first line and Spanish on the second. For a player with a language selector, attach separate English and Spanish SRT files.

### Tour checkpoints

- **0 s — Mesa:** The city boundary and study-area locator establish the setting. The camera gradually moves toward Encanto.
- **12 s — Encanto:** 137.3 °F / 58.5 °C. This is Mesa’s registered neighborhood #301, not Phoenix’s Encanto district.
- **16–21 s — To Alta Mesa:** 1.48 miles straight-line between sample centers, not a travel distance.
- **21 s — Alta Mesa:** 120.4 °F / 49.1 °C. Green is the cool end of the palette.
- **25–30 s — To Red Mountain:** 2.56 miles straight-line between sample centers.
- **30 s — Red Mountain:** 124.7 °F / 51.5 °C. This is the design site, not the hottest sample.
- **36–48 s — Walkway:** Compare the existing walkway to the proposal. The added-tree count climbs from 0 to 3 at 38 s, 8 at 41 s, and 18 at 44 s.

### Explain what the trees change

Pause at 36 s and again at 45 s. Compare the same stretch of pavement from the walkway camera. Added canopies block direct sunlight over more of the pavement, so shaded surfaces absorb less solar energy and can stay cooler than pavement in full sun.

**Keep observation and proposal separate.** The temperatures come from equal-sized samples in a single Landsat overpass on July 29, 2025. They describe land-surface temperature, not air temperature or whole-neighborhood averages. The green shade-benefit indicator marks a design stage; it is not a new thermometer reading. The proposal does not change the Landsat layer or predict a temperature drop. Keep the City of Mesa GIS, OpenStreetMap (ODbL), and USGS Landsat credits distinct.

### Export with subtitles

In **Render → Video**, keep **Skip First** set to **None** so the cue times line up. Select **Also export a matching .srt file** for a sidecar, or **Hard-burn subtitles into video** if the bilingual text should be permanent. For switchable tracks, leave hard-burn off and attach language files in your player. A 48-second subtitle track leaves Strata’s default two-second render tail uncaptioned. You can export without publishing.

## 2. Playwright harness: Distributed decision-making and suggestions

Here, **distributed** means different participants and components have different responsibilities. A resident defines the need. A model suggests an operation. The scene host determines what can be executed. The editor records the edit. The current rehearsal is single-operator browser automation, not multiplayer editing, voting, or community approval.

- **Resident or facilitator:** State the need and clarify the location in your own words.
- **Dub and Whisper:** Dub makes synthetic speech for this rehearsal. Whisper transcribes the actual WAV; Playwright forwards that transcript, not the original script.
- **Strata model:** Suggest a structured operation from a closed vocabulary, or refuse. It does not write geometry.
- **FutureFlux host:** Enumerate visible tagged candidates, check operation and target, and either return a named refusal or apply an undoable edit.
- **Playwright:** Drive browser surfaces, wait for real results, assert the refusal and the later edit, and save a numbered report. It does not make the decision.

### Run the English rehearsal

Use the [FutureFlux demo folder](https://github.com/tejaswigowda/test1/tree/2e3481b3e47eda46f8bcb6e2287ae8e6a6c9c39b/demo), not the Strata Editor repository. Run these commands from that folder. The runner loads its own `scene.json` into an isolated `demo/.browser/` profile; don’t point it at your working scene or normal profile.

```
npm ci
npm test
npx playwright install chromium
npm run rehearse
```

For installed Chrome, use `FLUX_BROWSER_CHANNEL=chrome npm run rehearse`. First use needs network access for the hosted apps and model downloads. Rehearsal writes evidence, not video footage.

1. Ask **“What if we shaded this walkway?”** With the community-center walkway and park loop both visible, the host returns `ambiguous-path`, highlights both, and asks which one. Nothing is added. The English runner holds the refusal visibly for at least 3.5 seconds.
2. Clarify **“The one by the community center.”** On success the validated `shade.add` adds one proposal to `center-walk`.
3. Read the newest `takes/*-english.json`. Check the actual transcript, refusal, resolved path, and edit journal. The older fixture rehearses a canopy; the 48-second tour uses trees. The fixture does not exercise the Landsat layer.

If it fails, check the transcript before looking at candidate selection and refusal reason. Don’t silently fix a transcript or substitute a successful model response. Spanish SRT playback and Spanish speech recognition are separate checks. Earlier Spanish speech attempts did not reliably resolve the landmark and were refused without an edit. No OBS footage or Spanish end-to-end pass is claimed.

### Workshop extension: Suggest → Review → Apply

The existing rehearsal applies a valid clarified operation automatically. The following human review step is a **proposed extension**, not a feature already available in Strata.

1. **Suggest:** Collect options against the same scene revision, such as shading the center walkway first or comparing it with the park loop. Show the landmark, proposed change, rationale, and limits of the evidence. Preview separately; don’t change the shared baseline.
2. **Review:** Compare suggestions side by side. Clarify locations and discuss coverage, access, and maintenance. Record the facilitator’s reason and any unresolved objections rather than picking a winner automatically.
3. **Apply:** A designated facilitator approves one proposal. Recheck the target and scene revision before applying one undoable command. If the scene changed, require reconfirmation.

Use two isolated Playwright browser contexts for resident and reviewer roles against a disposable test project. Connect them through the prototype’s shared suggestion store: isolated contexts don’t share local editor state. Pin a scene fixture and compare affected objects before and after each step.

- **Ambiguous:** Show both candidates and request clarification; no geometry changed.
- **Awaiting review:** The reviewer sees the target and rationale; the shared scene stays unchanged.
- **Rejected:** Record the reason; no edit occurs.
- **Approved:** Apply one edit to the approved path; repeated approval doesn’t duplicate it; Undo restores the prior state.
- **Stale:** A changed scene revision blocks the proposal until reconfirmed.
- **Transcription or model failure:** Show a named failure; no fallback edit.

Use fixed transcripts or model outputs for fast approval-state tests and label them as fixtures. Keep a separate live rehearsal for actual speech and inference. Log suggestion ID, scene revision, candidate IDs, decision, and resulting edit ID. Use synthetic or consented speech and keep personal information out of shared reports.
