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

## Limits

* Handles edit position and aim point. Field of view and timing are edited in the key panel, or by dragging the block in the timeline.
* The aim point is a point in space. To follow a moving subject, keep the named `lookAt` (for example `#maya`) on the key instead.
* Keys that are not `animate` events with a position (for example a lone `fov` change) are not drawn.
