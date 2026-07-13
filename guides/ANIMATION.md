# Animation: the universal timeline

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [JS Shell](JS_SHELL.md) · [AI guide](AI_GUIDE.md)

The **Animations** tab is the **scene-wide universal Timeline**: one absolute clock (`editor.timeline`) for the whole scene, not a bag of per-object clips. It is the single source of truth for authoring, retiming, and playback. (The legacy per-clip editor is superseded and no longer mounted.)

- **One clock, many tracks.** Each track targets a scene entity **by selector string** (objects, and addressables that live outside the graph like the **camera**). Every animation is an **absolute-time event** `{ at, op, args, dur }`. `at` is absolute time on the scene clock, not relative to the previous event.
- **The timeline UI** shows one row per track, event **blocks** at their absolute `at` (block width = `dur`), and a single **playhead** across all tracks. Play / pause / scrub drive the one clock; drag a block to retime, drag its right edge to resize. A code panel shows the compiled `$S().then()` sugar so sugar and absolute timeline stay in sync.
- **Versioned and exportable.** The timeline is the representation that gets **versioned** (in the scene JSON, git-diffable) and **exported** to glTF keyframes. Compilation to a `THREE.AnimationClip` (which drives both playback and export) is a separate, injectable step, so the representation stays portable and node-testable.
- Every edit goes through `SetTimelineCommand` (undoable); the one scene-wide clip recompiles live.

## AI-authored animation

The AI authors animation from natural language: "make the box bounce", "spin the wheel 360 over 2 seconds", "fade it out". The **primary path is deterministic recipes** (`spin`, `bounce`, `pulse`, `fade`, `orbit`, `shake`). The host expands them into winding-safe tracks on the universal timeline, command-backed. The model never writes keyframe math. It emits ops, and each anim op becomes an absolute-time event (the "op-JSON of time"). Ops are recorded by **selector string** (resolved at compile time), so scene-wide addressables like the camera still record even when the live set is empty.

**Entrance animations** (objects appear with style):

```js
$S('.box').fadeIn(1)                    // fade in from transparent (default 1s)
$S('.wheel').zoomIn(1.5, 1)             // scale from zero to full size (scale, duration)
$S('.car').slideInLeft(2, 1.2)          // slide in from left (distance, duration)
$S('.object').slideInUp(1, 0.8)         // slide in from below
$S('.object').slideInDown(1, 0.8)       // slide in from above
$S('.object').slideInRight(1, 0.8)      // slide in from right
$S('.cube').bounceIn(1.2)               // scale in with bounce effect
$S('.card').flipInX(0.8)                // rotate in around X-axis
$S('.card').flipInY(0.8)                // rotate in around Y-axis
$S('.plane').rotateIn(90, 0.8)          // rotate in place (angle in degrees)
```

**Exit animations** (objects disappear with style):

```js
$S('.box').fadeOut(1)                   // fade out to transparent
$S('.building').zoomOut(0.3, 1)         // scale down to zero
$S('.object').slideOutLeft(1, 0.8)      // slide out to left
$S('.object').slideOutUp(1, 0.8)        // slide out upward
$S('.object').slideOutDown(1, 0.8)      // slide out downward
$S('.object').slideOutRight(1, 0.8)     // slide out to right
$S('.object').bounceOut(1.2)            // scale out with bounce
$S('.card').flipOutX(0.8)               // rotate out around X-axis
$S('.card').flipOutY(0.8)               // rotate out around Y-axis
$S('.plane').rotateOut(90, 0.8)         // rotate out of place
```

**Attention seekers** (grab focus on visible objects):

```js
$S('.light').flash(4, 1)                // rapidly toggle opacity (cycles, duration)
$S('.object').rubberBand(1.3, 0.8)      // stretchy scale oscillation
$S('.object').jello(0.05, 0.9)          // wobbly elastic deformation
$S('.heart').heartBeat(1.1, 1.3)        // pulse like a heartbeat
$S('.character').tada(1, 1.15, 1.5)     // spin + scale celebration (rotations, scale, duration)
$S('.object').wobble(15, 1)             // gentle side-to-side sway (angle in degrees)
```

**Original recipes:**

```js
$S('.wheel').spin('y', 1, 2)            // recipe: 1 turn on Y over 2s, winding-safe
$S('.object').bounce(1.5)               // bounce up and down
$S('.object').pulse(1.2, 1)             // scale up/down (scale, duration)
$S('.object').fade(0, 1, 1)             // opacity transition (from, to, duration)
$S('.planet').orbit({center:[0,0,0]}, 3, 4)  // orbit around a point
$S('.object').shake(0.2, 1)             // jittery motion (intensity, duration)
```

All animations are **winding-safe** (rotations sub-divide to prevent antipodal flips), **command-backed** (undoable), and support **chaining** with other ops:

```js
$S('.box').fadeIn(1).spin('y', 1, 2)    // chain entrance + spin
$S('.wheel').slideInUp(1, 0.8).bounce(1)  // enter then pulse
```

**Sequential authoring sugar (`.then` / `.with` / `.at`)** compiles to the absolute `at` values on the scene clock, the same sugar→representation relationship `$S()` has with op-JSON. A bare following op stays **parallel** (same start time) until `.then()` advances the cursor:

```js
$S('.door').slideInLeft(1, 1).then().rotateTo(0, 90, 0)  // slide, THEN rotate (sequential)
$S('.wheel').spin('y', 1, 2).with().pulse(1.2, 2)        // spin AND pulse together (parallel)
$S('.ball').at(3).bounce(1)                              // place the event at t=3s absolute
```

Because events carry absolute times on one clock, the whole scene (objects and camera) animates on a single axis you can version and export.

The agent authors timeline events only. Runtime `requestAnimationFrame` loops remain out of scope. Skeletal motion (BVH) and captured performance are on the roadmap as imported data, not generation.

## Animation lifecycle management

When an object with attached animations is deleted, the cascade delete system automatically cleans up its animations to prevent orphaned clips:

- **Single-object clips** (only reference the deleted object) are removed entirely from the scene
- **Multi-object clips** (reference multiple objects) are preserved if other objects remain
- **Undo/Redo** fully restores animations when an object deletion is undone
- **Playing animations** stop gracefully if their object is deleted mid-playback

This ensures animation integrity and prevents memory leaks when managing complex animated scenes.

---

**Next:** [The language](LANGUAGE.md) · [JS Shell](JS_SHELL.md) · [AI guide](AI_GUIDE.md) · [← Back to README](../README.md)
