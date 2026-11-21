---
slug: futureflux-mesa
title: "FutureFlux: From a Mesa heat map to a tree-shade proposal"
status: published
description: "Build a Mesa heat tour in Strata: compare Landsat samples, stage tree shade, make VRM walkers in Look, customize their outfits, and retarget a BVH walk cycle."
---

<div class="strata-tutorial-gis-walkway-shade"></div>
<h1>FutureFlux: From a Mesa heat map to a tree-shade proposal</h1>
<p class="tagline">Build a two-minute heat tour in Strata, from Landsat observations to a tree-shade proposal with animated walkers and independently selectable English and Spanish narration and subtitles.</p>

[All tutorials](https://strataeditor.dev/about/tutorials/) · [Build the base GIS scene by hand](https://strataeditor.dev/about/tutorials/gis-walkway-shade.html) · [Planner guide and shade results](./futureflux-mesa-planner.html)

Build a three-site heat tour and a tree-shade proposal for Red Mountain Multigenerational Center in Mesa, Arizona. Start with mapped geometry, keep satellite observations separate from the design, and check each step before moving on. Dub is optional if you export without narration.

<h3 id="watch-the-extended-cut">Watch in English or Español</h3>

<<<<<<< HEAD
This pinned film and scene predate the solar analysis below. Their lighting, narration about pavement shade, and green overlay are illustrative, not analysis results.

<div class="wc-embed" title="FutureFlux Mesa extended cut"><a href="https://strataeditor.dev/player/#https://cdn.jsdelivr.net/gh/tejaswigowda/renders@a39dd46a938551486bfd3b8193ce197d717b22f5/futureflux-mesa-extended/" rel="noopener noreferrer">Open the extended cut in Strata’s video player</a></div>
=======
**One film, two narration tracks.** In the player below, use **Audio** in the upper-right corner to switch between **English** and **Español**. Use the video’s **subtitles** control to choose either language or turn subtitles off. You can listen in Spanish while reading English, or the other way around.
>>>>>>> a0f4026ded68b6f56f84206e354a9e7aea6132b1

<div class="wc-embed" title="FutureFlux Mesa extended cut"><a href="https://strataeditor.dev/player/#https://cdn.jsdelivr.net/gh/tejaswigowda/renders@2f59f7f40d5e42977a842e13421157faa3f1a9d0/flux/" rel="noopener noreferrer">Open the extended cut in Strata’s video player</a></div>

2:01.5, 1080p at 30 fps. The narration uses synthetic voices, and its qualitative shade descriptions are not measured cooling results. [Download the earlier combined-narration MP4](https://github.com/tejaswigowda/renders/releases/download/futureflux-mesa-extended-v1/futureflux-mesa-extended.mp4) · [Download the source SRT](https://github.com/tejaswigowda/renders/releases/download/futureflux-mesa-extended-v1/futureflux-mesa.narration-retimed.en-es.srt).

### Explore the interactive scene

<div class="wc-embed allow-popups" title="Interactive FutureFlux Mesa scene"><a href="https://strataeditor.dev/#repo=tejaswigowda/test1&amp;file=flux.json&amp;commit=4612f3d48b78f314eb810d5af468ea3cfa143708&amp;play=false&amp;present=true" rel="noopener noreferrer">Open the pinned scene in Strata</a></div>

The live call card is not available inside the embedded scene. Watch it in the film above or open the pinned scene in Strata to see it there.

**Before starting:** Save unrelated work and use a separate Strata project. The [original Mesa scene](https://strataeditor.dev/#repo=tejaswigowda/test1&file=flux.json&commit=2e3481b3e47eda46f8bcb6e2287ae8e6a6c9c39b&play=false) is the older rehearsal fixture, not the finished film. Use the linked base tutorial for complete Shell blocks that construct the original mapped site from an empty scene.

## 1. Build the site from Mesa GIS

Start with the [City of Mesa REST catalogue](https://gis.mesaaz.gov/mesaaz/rest/services?f=pjson). Use ParkFinder layer 19 path records 30121 (community center) and 30046 (park loop), and CommunityMaps layer 6 building footprint 53258. Keep those IDs on the scene groups so you can trace the meshes back to the source records.

Project WGS84 records to local meters with origin `[-111.667328704, 33.431791272]`: x east, y up, z south. Turn each centerline into flat path sections and extrude the mapped footprint vertically. The 3.3 m paths and 6 m shell are assumptions, not surveyed dimensions. Keep OpenStreetMap service roads, parking, and sports fields in a separate context group so they do not replace the Mesa features.

**Human check:** Orbit the scene. The center walkway should sit south of the footprint, the park path should curve north of it, and the roof should sit about 6 m above ground. Hide the OSM group: both paths and the building should stay in place.

## 2. Add the comparison neighborhoods and heat overlays

Use Mesa’s municipal boundary for the opening and registered neighborhood records for Encanto (#301) and Alta Mesa (#6). Encanto here is in Mesa, not Phoenix. Put the boundary, title, study-area locator, and credit under a single opening group so they can fade together.

Use the July 29, 2025 Landsat 9 Collection 2 Level-2 scene `LC09_L2SP_037037_20250729_02_T1`. Read ST_B10 with QA_PIXEL; drop invalid, cloud, shadow, and snow pixels before taking the mean. Use equal 17 × 17 native product-grid windows. Convert valid digital numbers to Celsius with `DN * 0.00341802 + 149 - 273.15`. Project the cell corners into the scene’s local coordinates and draw the cells as a separate flat layer.

Use one shared 40–60 °C palette (green → yellow → red). Keep the source cells unchanged, and round only the displayed sample means: **Encanto 58.5 °C**, **Alta Mesa 49.1 °C**, **Red Mountain 51.5 °C**. These are surface temperatures from one overpass, not air temperatures or averages for entire neighborhoods.

**Human check:** Toggle each heat group and compare its edges with mapped context. Identical temperatures must get identical colors. At Alta Mesa, orbit at a shallow angle and make sure water does not flicker against the ground. The water-only depth fix should not affect the heat layer.

<figure><img src="./screenshots/futureflux-city.webp" alt="Mesa city boundary with the study area marked" width="1600" height="900"><figcaption>The opening uses Mesa’s municipal boundary to locate the study area before the camera moves toward Encanto.</figcaption></figure>

## 3. Lay out the route and measure it

Order the route **Encanto → Alta Mesa → Red Mountain**. Draw a red double-headed arrow between each pair of sample centers. Compute horizontal distance in local meters with `Math.hypot(b.x - a.x, b.z - a.z)` and divide by `1609.344` for miles. Place the text where it will be readable during the camera pullbacks.

**Human check:** Look for **1.48 miles** between Encanto and Alta Mesa and **2.56 miles** between Alta Mesa and Red Mountain. Both should say straight-line distance, not imply a walkable route. Red Mountain is the design site, not the hottest observation.

<figure><img src="./screenshots/futureflux-route.webp" alt="Three heat samples connected by red distance arrows on the Mesa map" width="1600" height="900"><figcaption>The comparison view uses one temperature palette across Encanto, Alta Mesa, and Red Mountain. The arrows show straight-line distances.</figcaption></figure>

## 4. Finish the center and stage the trees

Keep the original footprint and 6 m shell. Use repeating albedo, normal, and roughness maps on the stucco and mineral roof. The finished scene uses six embedded 256 × 256 procedural maps and separate glazing, frames, sills, coping, and base trim. These additions provide visual detail; they are illustrative, not survey records.

Use two shared mesquite variants (`tree4` and `tree5`) for the eight baseline trees and eighteen proposed trees. Simplify the shared meshes rather than each instance; in this pass the tree geometry in the saved scene dropped from 51.3 MB to 24.5 MB. Use dark olive-green leaves and warm brown bark, and preserve each tree’s dimensions, position, and contact with the ground. Stage the proposed trees as cumulative groups of 3, 8, and 18.

**Human check:** Reload a saved copy. Trees should not change size, sink into the ground, or appear before their reveal. At eye level the material maps should still load and the façade should not change the mapped footprint.

## 5. Make the shade visible without changing the observation

For a dated observation, use **derived sun** by default. Bind the directional key and the acquisition time label to the same `gisLayer.date` on the thermal layer. Strata computes the geometric sun locally with NOAA GML equations; store UTC, and format the display in `America/Phoenix`. The capture hour is the relevant light for evaluating the design at the capture hour. Use explicitly labelled **illustrative lighting** only when there is no data instant.

On a copy of the Mesa scene, import `./js/scene/futureFluxSun.js` relative to the editor root (`/editor/`) and call `configureFutureFluxSun(editor.scene)`. This disables the old illustrative directional fill and cooling graphics. Scrub past the last planting reveal, then call `analyzeFutureFluxShade(editor.scene, instants, 0.4)` with UTC instants for a day or for different dates at the same local hour. Inspect the results separately from the thermal legend. The solver samples the actual walkway slabs and checks for direct-sun occlusion by the modeled trees; it does not fetch irradiance. Revisit irradiance only before making claims about absorbed solar energy, mean radiant temperature, or cooling.

**Human check:** At the acquisition instant the key is about 65.12° up and 121.15° clockwise from north. A vertical post should cast a WNW shadow about 0.464 times its height. Check the [planner results](./futureflux-mesa-planner.html#shade), rather than assuming more trees must improve shade at this hour.

<figure><img src="./screenshots/futureflux-before.webp" alt="Red Mountain walkway and center before the proposed trees appear" width="1600" height="900"><figcaption>37 s · An earlier preview of the walkway before proposed planting.</figcaption></figure>
<figure><img src="./screenshots/futureflux-shade.webp" alt="Same Red Mountain walkway with proposed mesquites along the left side" width="1600" height="900"><figcaption>45 s · An earlier preview after all 18 proposed mesquites appear. These two stills predate the final walkers and walkway border.</figcaption></figure>

## 6. Animate and check the three shots

In **Render → Video → Camera Sequence**, use a city opening camera, a comparison camera, and an eye-level walkway camera. Animate the city camera down toward Encanto while fading the city group. Match the first two cameras’ position, aim, and field of view at the handoff so the viewport does not jump even when it is not compositing the export fade.

- **0:00–0:20:** Open over Mesa, then fade to the matched comparison camera at 0:14.5 and push in on Encanto.
- **0:20–1:18:** Start the site close-ups at 0:20 (Encanto), 0:43 (Alta Mesa), and 1:05.5 (Red Mountain). Keep the site labels readable while both languages are spoken; pull back between sites to show the distance arrows.
- **1:18–1:49.5:** Glide forward at eye level. Reveal three proposed trees at 1:26.5, eight total at 1:33, and eighteen at 1:40.

**Human check:** Enable the timeline’s follow-camera checkbox and use **as render**. Scrub backward and forward across the first handoff and all three planting beats. The opening should restore on rewind, the camera should not snap at the switch, and the planting counts should agree with the indicator.

## 7. Import, customize, and animate the walkers

1. Make **Maya**, **Alex**, and **Jordan** in [Look (look.webcli.app)](https://look.webcli.app/). Start with a bundled base VRM or open your own, customize the character in Look, then export a `.vrm` for each walker. Import those three files into Strata, name the root groups, and place the walkers on the slabs at human scale. Remove the old placeholders only after checking that no timeline track targets them.
2. In **Customize → Wardrobe**, select each avatar by name and use **Recolor** on the existing top and bottom. Maya wears rust and navy, Alex sage and brown, and Jordan blue and charcoal. Recolor the existing garments instead of adding new meshes that would need skin weights.
3. Parse `walk-cycle.bvh` with Three.js `BVHLoader`. This file has 42 samples at about 24 fps. Map the source joints to the VRoid `J_Bip_` bones: `Hips` to `C_Hips`, `Ab` to `C_Spine`, `LeftShoulder` to `L_UpperArm`, and `LeftHip`, `LeftKnee`, and `LeftAnkle` to `L_UpperLeg`, `L_LowerLeg`, and `L_Foot`, with equivalent right-side mappings. Include spine, collar, head, elbow, and wrist rotation. In this scene the BVH faces +Z while the avatars face local −Z, so convert the rotations with a half-turn about Y. Do not copy the BVH’s joint offsets or its raw hip height over the VRM rest skeleton.
4. Scale the source’s forward travel using each avatar’s leg length and direct it along the path. Offset the loop phases so their feet do not land together. Sample the shoe meshes when baking to calibrate root height to the pavement, then save the 19 bone-rotation tracks and two root-transform tracks per avatar. The extended cut retimes those clips to the walkway dolly, from **1:18.25 to 1:49.5**. The motion was retargeted directly in Strata, not generated in Look or the Customize tab.

The imported meshes initially repeated unreferenced vertices across material groups. Compact each indexed group without changing the geometry it draws, then store in-range facial morph deltas with normalized 16-bit integers. The subsequent optimization reduced character geometry in the saved scene from 64.7 MB to 41.5 MB without removing expressions, textures, or rigs.

<figure><img src="./screenshots/futureflux-final-walkway.jpg" alt="Three walkers in rust, blue, and sage on the Red Mountain walkway" width="960" height="540"><figcaption>1:36 · Maya, Alex, and Jordan walk along the recolored slabs beside the illustrative cooling overlay.</figcaption></figure>

**Human check:** Scrub several parts of the final shot and rewind. Check for moving knees, opposed arm swing, feet close to the pavement, distinct strides, and no walkers leaving the path. Reopen a copy and check that all three imported clips still target the correct bones.

## 8. Add bilingual subtitles, the call card, and export

Open **Render → Subtitles** and import timed SRT cues. The bilingual format uses English first and Spanish second. The three historical samples are **137.3 °F, 120.4 °F, and 124.7 °F** in English and **58,5 °C, 49,1 °C, and 51,5 °C** in Spanish. Close by explaining that the proposed trees provide shade, not a measured temperature drop.

After the final cue, keep the same walkway camera and crane up to a tight, directly overhead view. Lay Strata’s transparent call card flat on the roof like painted lettering, without a dark backing. Hold the top-down shot from **1:55.5** through the authored end at **1:59.5**. The two-second render tail brings the export to **2:01.5**. The editor loads the call card live; the offline render bakes it into the film.

In **Render → Video**, leave **Skip First** at **None**. The extended export uses **1080p at 30 fps (3,645 frames)**. Split the source SRT into two languages without changing the cue times. Make one WAV per language, check that each line fits its cue, and upload the English WAV and the Spanish WAV under **Narration audio**, with `es` as the alternate language. Add each SRT separately in the publish panel. Leave the rooftop shot free of cues so viewers have time to scan the QR code.

**Human check:** Save and reopen a copy. Confirm the three camera beats, embedded textures, tree stages, and caption units. Read the map legend and credits at output size before exporting.

### Sources and credits

- [City of Mesa Open Data Terms](https://data.mesaaz.gov/stories/s/Terms-of-Use-page/2dcd-j2nx/) — Sections 3(e)–(f) permit redistribution of open-licensed data with City attribution. The [prior layer audit](https://github.com/tejaswigowda/test1/blob/5c50a8374659ce1f4c6d3ce48f74e1a35260e88e/demo/PROVENANCE.md) found no additional restriction on the paths and footprint. **Needs clarification for the full package:** confirm coverage for the boundary and neighborhood layers with Mesa Enterprise GIS before a new redistribution.
- [Whisper WebCLI source and licence](https://github.com/tejaswigowda/whisper-webCLI) — GPL-3.0.
- [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) — separately attributed context under ODbL.
- [USGS Landsat 9 Collection 2 Level-2](https://doi.org/10.5066/P9OGBGM6) — historical land-surface-temperature observations; not a cooling model.

<section class="credits" id="credits"><h2>Credits and licences</h2><h3>People</h3><ul><li><a href="https://tejaswigowda.com/">Tejaswi Gowda</a> <span class="lic">(script, scene)</span></li></ul><h3>Assets</h3><ul><li><a href="https://data.mesaaz.gov/stories/s/Terms-of-Use-page/2dcd-j2nx/">City of Mesa GIS</a>: City of Mesa GIS paths, Enterprise GIS building footprint, city boundary, and neighborhood records. <span class="lic">Licence: City of Mesa Data Terms of Use License Agreement; see dataset-specific notices.</span></li><li><a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>: © OpenStreetMap contributors; separately attributed context. <span class="lic">Licence: Open Database License (ODbL).</span></li><li><a href="https://doi.org/10.5066/P9OGBGM6">USGS Landsat 9 Collection 2 Level-2</a>: Historical land-surface-temperature observations; not a cooling model. <span class="lic">Licence: USGS public domain.</span></li></ul><h3>Tools</h3><ul><li><a href="https://threejs.org/">Three.js</a> <span class="lic">(MIT)</span></li><li><a href="https://playwright.dev/">Playwright</a> <span class="lic">(Apache-2.0)</span></li><li><a href="https://dub.webcli.app/">dub.webcli.app</a> <span class="lic">(GPL-3.0)</span></li><li><a href="https://whisper.webcli.app/">whisper.webcli.app</a> <span class="lic">(GPL-3.0)</span></li><li><a href="https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct">Qwen2.5-Coder-1.5B-Instruct</a> <span class="lic">(Apache-2.0)</span></li></ul></section>

## 9. Optional: Playwright harness for distributed decision-making and suggestions

Here, **distributed** means different participants and components have different responsibilities. In a future session a resident would define the need; in this rehearsal no resident participated. A fixed script and synthetic speech stand in for that role. The current rehearsal is single-operator browser automation, not multiplayer editing, voting, or community approval.

- **Resident role (simulated):** The fixed script supplies the request and clarification; Dub speaks both lines.
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
