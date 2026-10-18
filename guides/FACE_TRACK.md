# The authored face: expression + gaze as timeline data

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Animation (the universal timeline)](ANIMATION.md) · [Character customizer](CUSTOMIZER.md) · [Camera paths](CAMERA_PATHS.md) · [Face bind](FACE_BIND.md)

A character's face is two **keyed channels on the universal timeline**, addressed like a camera move:
**expression** (continuous morph weights) and **gaze** (where the eyes and head aim), plus a seeded
**idle layer** under them. They live on the same track as the character's body clip, so a face is
authored, versioned, diffable and agent-drivable like everything else.

This is **the animator's face**, not a face-mocap substitute. Hand-keyed faces are how animation worked
for a century; on a stylized (VRoid / MToon) target, broad held readable expressions and a well-aimed
eyeline are very likely the better choice, and photoreal capture on a toon face tends to read as uncanny or
as noise. The honest scope is stylized targets.

## The grammar

```js
// Expression — continuous values, interpolated, with easing and duration per key
$S('#f1').face.keyAt(2.0, { shapes: { jawOpen: 0.4, browInnerUp: 0.2 }, duration: 400, easing: 'ease-out' })
$S('#f1').face.applyPreset('smile', 5, { duration: 600 })   // expands to explicit per-shape keys
$S('#f1').face.keys()           // [{ index, time, duration, easing, shapes, hold, label }]
$S('#f1').face.moveKey(0, { time: 2.5, shapes: { jawOpen: 0.6 } })
$S('#f1').face.deleteKey(0)

// Gaze — a selector FOLLOWS the moving character; a point holds; 'away' is an averted look
$S('#f1').gaze(3, '#f2')                                    // eyes + (by weight) head follow f2
$S('#f1').gaze(8, 'away', { duration: 250, head: 0.2 })     // a glance
$S('#f1').gaze(9, [0, 1.5, 2])                              // hold a point
$S('#f1').gazeKeys(); $S('#f1').moveGaze(i, spec); $S('#f1').deleteGaze(i)

// Idle — seeded blink, breath, gaze micro-noise; an underlayer, never keys
$S('#f1').face.idle({ seed: 7 })        // on; idle(false) off; { blink, breath, gazeNoise, blinkInterval } to tune

$S('#f1').face.asCommand()              // the commands that rebuild this face exactly
```

* A key **arrives** at its time: `keyAt(t, { duration })` means "be there at `t`, having moved for `duration`
  ms". Duration is milliseconds at the surface (like `.animate()`), seconds in the model.
* **Continuous.** A key only names the shapes it sets; every other shape keeps its value. Easing is a CSS
  timing function, so a slow fall (`ease-in-out`, 2000 ms) and a hard snap (`duration: 0`) are the same two
  keys with different timing. Timing is the craft.
* **Presets expand, they don't hide.** `applyPreset('surprise', t)` writes the explicit per-shape values
  (plus a 0 for every shape the track already drives, so it *replaces* the last expression). The file never
  stores a preset name; the keys are the truth and are editable. `neutral` is just "clear what is driven".
* `hold: true` marks a **held beat**: from the key's arrival to the next key's start the face is stationary and
  the idle layer stays out of it.
* Indices and labels (`face 3/9 · 2.40s`) match between the GUI and the shell.

## Gaze

`.gaze(t, target, { duration, easing, head })` works like the camera's named `lookAt`: a `'#name'` target
**follows** the character as it moves, a point holds.

* **Eyes and head are separate, with a weight.** `head: 0` is a glance (eyes only); higher is a turn. The
  default (`0.35`) lets the head take that share of the aim.
* **Eyes lead, the head lags.** On a retarget the head starts `0.1 s` after the eyes and takes `40%` longer to
  arrive. (While following a *continuously moving* target between keys, the head tracks the instantaneous aim at
  its weight; the lag is a property of retargets.)
* **Anatomical clamp.** Eyes stop at about ±30° yaw, +20° / −25° pitch; anything past that is handed to the
  head, so a target behind the character becomes a head turn and never doll eyes. The head is limited to ±70° yaw.
* `'away'` is a fixed averted look (35° to the character's left, 10° down) for a deliberate look-off.
* The aim is computed in the head's **bind-pose frame** (from the skin's inverse bind matrices), so it does not
  depend on the pose the body clip is in, and it is layered **on top of** the body clip's head pose (never
  accumulated): remove the gaze and the head is exactly the clip's again.
* Eyes use the eye bones (`J_Adj_L/R_FaceEye`, `FACIAL_L/R_Eye`, …) and the head bone; a rig with neither gets
  morph-only expression.

Measured on the sparring capture (two fighters 0.8–2.5 m apart, one cut): the eyes sit within ~1° of the other
fighter's head wherever it is inside the anatomical range, and the sampler costs ~0.6 ms per frame.

## The idle layer

Fully keyed faces read as corpses; real faces are never still. `face.idle()` adds, per character:

* a **blink** generator (random within a human interval, `[2, 6]` s by default),
* a faint **breath** (a tiny `jawOpen` swell),
* low-amplitude **gaze micro-noise** (about 0.7°).

It is **seeded**: the same scene renders the same blinks on every run and every machine (a mulberry32 stream
keyed on the seed and the character's selector; the blink sequence does not depend on how far ahead anything
asked first). It is an **underlayer**: it is never baked into the keys, so clearing it changes nothing
authored. It stays out of a held beat.

## Layering and precedence

Lowest to highest: **procedural idle → authored expression → derived visemes**.

A higher layer **suppresses** the lower ones on the shapes it drives; elsewhere the layers add (clamped to 0..1):
authored `jawOpen` owns the mouth while the idle blink still fires on the eyes. `faceTrack.composeShapes` is the
rule in one place and is tested.

* **A baked body clip that carries morph tracks.** The clip wins against idle on the shapes it animates
  (idle leaves them alone); the authored layer is the higher layer and wins against the clip. The clips in
  `sparring.json` have no morph tracks today, so nothing conflicts, but the rule is stated and tested.
* **Visemes are logged, not built.** The slot exists in `composeShapes` and is always empty. See below.
* The customizer's one-shot `blendshape` op is the *base* the layers add to; the face layer hands any shape it
  stops driving back exactly as it found it.

## One model, GUI and shell

Both surfaces read and write the same events through one `SetTimelineCommand` path (`faceEdit.editFaceTrack`):

* **Customize tab → Expression / Face performance.** *Key at playhead* (with a duration and an easing) makes the
  preset *Apply* and the slider drags write **keys** instead of a one-shot edit; *Gaze at* keys a gaze at the
  playhead; *Idle layer* toggles the seeded layer. The key list (with delete) and the `asCommand()` text redraw
  on every change, from either surface.
* **Animations tab.** Face and gaze keys are blocks on the character's row (a key arrives at the block's right
  edge), and the code panel shows and re-accepts them (`.at(t).face({ shapes, easing, duration, hold })`,
  `.gaze({ target, head, duration })`, `$S('#f1').face.idle({ seed })`).
* One undo stack for all of it, and every explicit op is headless — an agent can author a performance with no
  viewport; the same keys give the same face, byte for byte.

## Export

Morph weights survive the bake and glTF export like the body rig: `faceRuntime.faceExportTracks` bakes the
layers' morph weights per mesh and — where there is gaze or micro-noise — the eye and head rotations, by running the
**real sampler** at 30 fps, so the file matches the viewport. A baked head track supersedes the body clip's head
track of the same name.

## facebind gate (read this before building on a bound character)

Morph targets are **deltas against the base**, and facebind carries them through the warp untouched. That is exact
only where the warp is rigid. `facebind/__tests__/morphDeltas.test.mjs` runs the check this work order asks for:
every one of the 52 ARKit shapes at weight 1, on the unwarped base and on the warped character, comparing the
carried delta with the warp applied to the morphed face (the product's own `measureFace` / `planFaceRefine` /
`warpPoint`, on the two bundled base VRMs):

| Bind strength | Largest warp | Worst shape (max error) | Worst rms over 52 shapes | Gate (2% of face height, 10% rms) |
|---|---|---|---|---|
| 0 (unwarped) | 0 mm | 0.00% of the face height | 0.0% of the delta | **pass** (exact) |
| 0.5 | ~7.7 mm (7–8% of the face height) | ~6.5% (brows) | 16–20% | **fail** |
| 1 | ~15.5 mm (14–16%) | ~12.9% (brows) | 31–39% | **fail** |

**The gate fails for characters warped by a photo bind.** The distortion tracks the warp's strain: brow and eye
shapes are the worst (a brow-raise or blink on an eye the warp scaled 20% is 20% too small or too large), mouth
shapes less so. On an **unwarped** VRoid base, and on any character that was not facebind'd, deltas are exact and the
face channel is safe to use. This is a **facebind fix, not a timeline fix**: the right repair is to carry each
delta through the warp (`d' = W(v + d) − W(v) + d`, normals likewise) inside `reshapeVRM`, which changes morph
accessor bytes and so has to relax `assertRigSafe` / `assertBinOnlyChanged` deliberately. It is not papered over
here, and it is not done here. Until it is, treat authored expressions on strongly warped characters as approximate
(prefer a lower bind strength), and re-run `node docs/editor/js/facebind/__tests__/morphDeltas.test.mjs --strict`
after any facebind change (it exits non-zero while the gate fails).

## Logged, not built: the viseme channel

**Audio-derived visemes (speech) are not built.** Neither current film has dialogue. The idea is to derive viseme
keys, on the same track type, from the audio already recorded — forced phoneme alignment — which would remove the
head-worn camera from the rig for dialogue films too. That is a **hypothesis, not a result**: forced alignment
needs a model and a pronunciation dictionary, it is not a zero-dependency transform, and whether it is viable in
the browser / on device is unverified. When "The Usual" becomes the active short, **spike it first and report
honestly** before assuming it is solved because it is well established elsewhere. The only thing here for it is the
empty `viseme` layer slot above `authored` in `composeShapes`.

## Guardrails

* A preset is never stored; the keys are. Preset-swapping is not the expression model.
* The idle layer is seeded and sits under the authored keys; it is never baked into them.
* Morph weights and bone **rotation poses** only: no vertex, skin-weight or skeleton edit (the customizer's rig
  fingerprint is unaffected).
* No viseme / lip-sync channel until the spike has been done.
* Do not frame this as a cheaper substitute for face mocap.

**Code:** [`faceTrack.js`](../docs/editor/js/intelligence/faceTrack.js) (pure: keys, easing, gaze, idle, layering) ·
[`faceRuntime.js`](../docs/editor/js/intelligence/faceRuntime.js) (sampler, export bake) ·
[`faceEdit.js`](../docs/editor/js/intelligence/faceEdit.js) (undoable edits, `$S` facade). Tests:
`intelligence/__tests__/faceTrack.test.mjs`, `faceRuntime.test.mjs`, `facebind/__tests__/morphDeltas.test.mjs`.
