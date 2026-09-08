# Animation: the universal timeline

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [JS Shell](JS_SHELL.md) · [AI guide](AI_GUIDE.md)

The **Animations** tab is the **scene-wide universal Timeline**: one absolute clock (`editor.timeline`) for the whole scene, not a bag of per-object clips. It is the single source of truth for authoring, retiming, and playback. (The legacy per-clip editor is superseded and no longer mounted.)

- **One clock, many tracks.** Each track targets a scene entity **by selector string** (objects, and addressables that live outside the graph like the **camera**). Every animation is an **absolute-time event** `{ at, op, args, dur }`. `at` is absolute time on the scene clock, not relative to the previous event.
- **The timeline UI** shows one row per track, event **blocks** at their absolute `at` (block width = `dur`), and a single **playhead** across all tracks. Play / pause / scrub drive the one clock; drag a block to retime, drag its right edge to resize. A code panel shows the compiled `$S().animate()` sugar so sugar and absolute timeline stay in sync.
- **Versioned and exportable.** The timeline is the representation that gets **versioned** (in the scene JSON, git-diffable) and **exported** to glTF keyframes. Compilation to a `THREE.AnimationClip` (which drives both playback and export) is a separate, injectable step, so the representation stays portable and node-testable.
- Every edit goes through `SetTimelineCommand` (undoable); the one scene-wide clip recompiles live.

## `.animate()` — the ONE animation grammar

Animation is authored with **jQuery `.animate()` semantics over CSS 3D transform values** — the same dense-prior bet that made `$S` work, applied to time. Both are grammars the web already speaks, so humans and models author them fluently without invented syntax.

```js
$S('.cube').animate({ rotateY: 360, translateZ: 5 }, 2000, 'ease-in-out')
$S('camera').animate({ fov: 30 }, 1500, 'ease-out')
```

- **props** are CSS 3D transforms (relative deltas, per CSS convention): `translateX/Y/Z`, `translate3d:[x,y,z]`, `rotateX/Y/Z` (**degrees**, CSS convention), `rotate3d:[x,y,z,deg]`, `scale`/`scaleX/Y/Z`/`scale3d` (multipliers), `transformOrigin:[x,y,z]` (world pivot — rotation/scale orbit this point). For **absolute** targets use `to`: `animate({ to: { position:[x,y,z], rotation:[degX,degY,degZ], scale:2 } }, ms)`.
- **duration** is **milliseconds** (jQuery convention); it's stored as seconds on the clock.
- **easing** is a **CSS timing function**: `'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'` or `'cubic-bezier(0.4, 0, 0.2, 1)'`. The curve bakes into sampled keyframes at compile time, so easing survives to glTF (renderer-agnostic round-trip), not just Strata playback.

**SEQUENCE via the jQuery queue** — chained `.animate()` calls run one after another:

```js
$S('camera').animate({ translateX: 4 }, 2000).animate({ fov: 30 }, 3000)  // second after first
```

**PARALLEL via multi-prop in one call, or the `{queue:false}` idiom:**

```js
$S('.cube').animate({ rotateY: 360, scale: 2 }, 2000)                          // both together
$S('.cube').animate({rotateY:360}, 2000).animate({scale:2}, 2000, {queue:false}) // parallel
```

**ABSOLUTE placement via `.at(t)`** — the one timeline-specific extension over the jQuery prior (jQuery's queue is relative; a scene-wide timeline needs absolute placement):

```js
$S('.ball').at(3).animate({ translateY: 2 }, 1000)   // event begins at t=3s absolute
```

**Look-at** — the second and final extension: a rotation-AUTHORING affordance for aiming. The host resolves the target (a selector or a `[x,y,z]` point) to a world position at bake time and **bakes the aim to rotation keyframes** — the quaternion never surfaces in the authored code, the stored representation, or the export:

```js
$S('camera').animate({ lookAt: '#cubes' }, 2000)                    // aim at a target
$S('camera').animate({ rotateY: 360, transformOrigin: [0,0,0],
                       lookAt: '#cubes' }, 4000, 'ease-in-out')     // ORBIT: circle the pivot, subject stays framed
```

**The camera is not a seam.** It is an ordinary addressable element — `$S('camera').animate(...)` is the *same* grammar as any object; it merely has extra properties (`fov`, an aim). No camera-specific animation subsystem.

> **glTF note:** transform channels (translation/rotation/scale) export to glTF keyframes, with the authored easing baked into the sampled keyframe values. `fov` animates in Strata playback and in Render-tab video, but does NOT ride to glTF — core glTF animation cannot target `camera.yfov` (GLTFExporter drops the track with a console warning).

Each `.animate()` call compiles to absolute-time keyframe event(s) `{at, op:'animate', args, dur}` on the universal timeline — the sugar computes the `at` values; the stored, versioned, glTF-exported representation is unchanged.

> **Migration note:** `.then()`/`.with()` are removed. Chained `.animate()` calls already sequence (jQuery queue); parallel is multi-prop or `{queue:false}`. The old methods warn and no-op.

## AI-authored animation

The AI authors animation from natural language: "make the box bounce", "spin the wheel 360 over 2 seconds", "fade it out". The emit target is `.animate()` over CSS transforms (the dense prior), plus **named convenience recipes** (`spin`, `bounce`, `pulse`, `fade`, `orbit`, `shake`, and the entrance/exit/attention set below) that compile to the same absolute-time events. The host expands everything into winding-safe tracks on the universal timeline, command-backed. The model never writes keyframe math. Ops are recorded by **selector string** (resolved at compile time), so scene-wide addressables like the camera still record even when the live set is empty.

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

All animations are **winding-safe** (rotations sub-divide to prevent antipodal flips), **command-backed** (undoable), and **chain on the jQuery queue** — each call runs after the previous one ends:

```js
$S('.box').fadeIn(1).spin('y', 1, 2)       // fade in, THEN spin (queued)
$S('.ball').at(3).bounce(1)                // absolute placement at t=3s
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
