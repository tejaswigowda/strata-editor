# Editing camera moves by hand

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Animation](ANIMATION.md) · [Call card](CALLCARD.md)

A shot camera's motion is a track of **keys** on the [universal timeline](ANIMATION.md). Each key is an `animate` event that *arrives* at its time with a position, an optional aim point (`lookAt`, a `[x,y,z]` point) and a field of view. You can author and adjust them in the viewport, not just by typing numbers.

## Workflow

1. Select a shot camera (outliner, or the viewport's camera dropdown). Open the **Animations** tab: the key panel shows camera tools.
2. Put the viewport on **Edit Camera**, orbit to frame the shot, move the playhead to the time you want, and press **+ Key from view**. The key takes the viewport's position, where it is looking (the orbit center), and its field of view.
3. In the Edit Camera view the camera's path is drawn: a cyan line, a dot every second, a white handle per key. Click a handle to select it (green, with a label such as `key 8/20 · 6.00s`), and drag with the gizmo to move it. A magenta diamond is the key's **aim point**; drag it to change where the camera looks. Each drag is one undoable step.
4. **Delete** (or **Delete key**) removes the selected key, never the camera. At least one key is always kept.
5. Tick **Smooth path** to play the camera as one curve through its keys. Leave it off for straight legs between keys.
6. **Simplify** replaces a dense run of keys (for example a camera that was baked at 0.1 s steps) with a few that follow the same path, and turns smooth path on.

The path overlay shows only in the Edit Camera view and hides with the viewport's hide-cameras button (or View > Camera Helpers).

## Smooth path

With **Smooth path** on, the track stores `spline: true` and the compiler plays one cubic curve through the key positions, aim points and fields of view. Speed is continuous through every key and the camera eases to rest at the first and last, so a key's **time** shapes the speed and its **position** shapes the route. Per-leg easing is ignored. A named aim target such as `#maya` is carried from key to key rather than curved.

The curve is computed in `intelligence/splineTrack.js` (pure, with tests in `intelligence/__tests__/splineTrack.test.mjs`) and baked to ordinary 0.1 s `animate` legs when the timeline compiles, so playback, rendering and glTF export need no special handling.

## From the JS shell

Everything above is also a shell verb on the same track. `$S('#cam07')` selects the camera, and each verb acts on the first shot camera in the set. The viewport and the shell read and write **one keyed track** in the scene timeline, so a shell edit redraws the path overlay, the key panel and the timeline block at once, and a drag in the viewport shows up in the next `keys()` or `asCommand()`.

| Verb | What it does | GUI twin |
|---|---|---|
| `.keys()` | The key list: `{ index, time, pos, lookAt, fov, label, selected }` | the handles and their labels |
| `.keyAt(t, { pos, lookAt, fov })` | Add a key at `t` seconds, or merge into the key already there. Anything you leave out is taken from the path at `t`. Needs no viewport. | + Key from view |
| `.keyFromView(t?)` | Capture the Edit Camera pose at `t` (default: the playhead). Needs the viewport on the Edit Camera, and throws otherwise. | + Key from view |
| `.moveKey(i, { pos, lookAt, fov, time })` | Change a key. `lookAt: null` or `fov: null` clears it. | drag a handle or aim diamond, key panel |
| `.deleteKey(i)` | Remove a key. Throws on the last one. | Delete |
| `.smooth(true \| false)` | Smooth path on or off | Smooth path |
| `.simplify(tolerance?)` | Collapse a dense run of keys to a few, smooth on | Simplify |
| `.setKeys([{ t, pos, lookAt?, fov? }], { smooth })` | Replace the whole move in one step | |
| `.asCommand()` | The `setKeys(...)` command that rebuilds this move exactly | Copy as command |
| `.selectKey(i, 'key' \| 'look')` | Select a handle (or its aim point) as if clicked | click a handle |

* **Indices.** `keys()[i]` is the handle labelled `key i+1/N` in the viewport, so shell indices start at 0 and the label counts from 1. Each key's `label` is exactly the text the viewport shows. Keys are ordered by arrival time, and a key keeps its identity (and its selection) when `moveKey` gives it a new time.
* **One undo.** Every verb is one `SetTimelineCommand`, the same entry a handle drag makes, so shell and viewport edits interleave on one undo stack. A verb that throws (bad index, last key, two keys at one time) changes nothing and adds no entry.
* **Round trip.** `.asCommand()` returns text such as `$S('#cam07').setKeys([ { t: 0.001, pos: [0.36, 0.19, 0.03], lookAt: [0.5, 0.1, 0.2], fov: 30 }, ... ], { smooth: true })`. Running it on any camera, from any state, gives the same keys.
* **Headless.** `keyAt`, `moveKey`, `deleteKey`, `smooth`, `simplify`, `setKeys` and `asCommand` need no viewport, so a script or an agent can author a whole shot's camera move with them. The same commands always give the same track, the same baked 0.1 s legs and the same glTF export. Only `keyFromView` reads the Edit Camera.
* **Retiming.** Changing a key's `time` moves the legs on either side of it with it, so the motion between neighbours is what the keys say. Holds and legs you did not touch stay as they were.

```js
const cam = $S('#cam07-ots-maya');
cam.keyAt(0,  { pos: [0.36, 0.19, 0.03], lookAt: '#maya', fov: 30 })
   .keyAt(6,  { pos: [0.40, 0.19, 0.05], lookAt: '#maya', fov: 28 })
   .smooth(true);
cam.moveKey(1, { fov: 26 });
cam.asCommand();   // copy this to keep or share the move
```

## In the code panel

The Animations tab's code panel shows a camera with 12 or more keys (a baked move, say a key every 0.1 s) as **one `setKeys` statement, one key per line**, under a comment line, rather than a `.at(..).animate(..)` line per key. It is exactly the command `.asCommand()` returns, so you can edit a key's `t`, `pos`, `lookAt` or `fov` in place, and **Save** rebuilds the track from it (`smooth` restores Smooth path). The timeline and the code stay linked per key: select a key (its block, or its handle in the viewport) and the panel highlights its line; put the caret on a key's line and that key is selected.

The panel collapses a track only when the statement reproduces the move: keys keep their pose, easing and arrival time exactly, and a leg's start may move by up to 1.5 ms (`setKeys` always starts a leg 1 ms after the previous key arrives). A track that would not round-trip, such as one with a per-key easing or a non-key event on it, keeps its `.at(..)` chain. The logic is in `intelligence/cameraKeysCode.js`, tested in `intelligence/__tests__/cameraKeysCode.test.mjs` (including the save round trip).

Dense tracks are also easier to handle on the timeline: **ctrl / cmd + wheel** zooms the time axis until each key is its own block (blocks are never drawn thinner than 10 px, and drag to retime snaps to the playhead and to other events), and **shift-click** selects a run of keys along the track to move or delete them together, as one undo step. See [Animation](ANIMATION.md).

## Limits

* Handles edit position and aim point. Field of view and timing are edited in the key panel, by dragging the block in the timeline, or with `moveKey` from the shell.
* The aim point is a point in space. A named `lookAt` such as `#maya` is kept on the key as written and resolved to the subject's world position **when the timeline compiles**, so it aims at a static subject for the whole shot. It does not follow a subject that the timeline itself moves; for that, sample the subject's path into point `lookAt` keys.
* Keys that are not `animate` events with a position (for example a lone `fov` change) are not drawn.
