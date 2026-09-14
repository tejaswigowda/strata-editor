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

## `.change()` — animatable text-content edit

`.change()` animates a text object's **content** (the string), not its transform — e.g. a counter or label that reads `3`, then `3×3`, then `9` as the scene plays. It is authored once and realized correctly in both **live playback/scrubbing** and **glTF export**, by two separate mechanisms behind the same call:

```js
$S('#label').at(0).change('3')
$S('#label').at(2).change('3×3')
$S('#label').at(3).change('9', { transition: 'fade', dur: 300 })   // cross-fade over 300ms
```

- **Content is a step function, not a tween.** There is no glyph-level morph between `'3×3'` and `'9'` — the value simply *is* the most-recently-keyed text at the sampled time. This applies uniformly whether you're playing forward, scrubbing backward, or jumping straight to a time — the content at time `t` is always determined by the last `change()` at or before `t`, never by replaying intermediate edits.
- **`transition: 'fade'`** cross-fades the OLD text's opacity down to 0 while the NEW text's opacity ramps up to 1, over `dur` milliseconds (jQuery-style ms at the authoring surface, stored as seconds on the timeline like every other duration). Omit `transition` (or use the default `'cut'`) for an instant swap.
- **Target must be a text mesh** — an object whose geometry was built from `TextGeometry` (i.e. `geometry.parameters.options.text` is a string). Targeting anything else does not silently apply to a transform instead: it's skipped and a console warning is emitted once per object.

### Why glTF needs special handling

glTF has no "animate the string on this node" channel — only TRS (translation/rotation/scale) and material properties can be keyframed. So `.change()` is **lowered** at export time rather than dropped:

- Each distinct text **state** (`'3'`, `'3×3'`, `'9'`, …) is **materialized** as its own child text mesh, added under the original label so it inherits the label's transform (and any `.animate()` tracks on that same label, for free).
- Visibility of each state over time is driven by a **scale-to-zero** keyframe track (scale collapses to `0` outside the state's interval, restores to the label's own scale inside it), **for every state, fade or not**. Scale is the one channel every glTF exporter/viewer honors, and glTF core has no boolean visibility channel — so this is what actually keeps the exported *content sequence* correct.
- **`transition: 'fade'` states additionally get a `material.opacity` keyframe track**, for any consumer that *does* support material-property animation. This project's own vendored `GLTFExporter` does **not** (only `scale`/`position`/`rotation`/morph-`weights` channels are recognized — see `PATH_PROPERTIES` in `GLTFExporter.js`); it drops the opacity track with a console warning and keeps going. Since the scale track is always present too, the export is still **correct** (the right text shows at the right time) — it just degrades a soft cross-fade to a hard cut. This degradation is disclosed via an export-time warning (see below), not silently swallowed.
- The **original label node becomes an inert transform-carrier**: its own geometry is cleared (so it renders nothing itself) but its uuid — and any transform-animation tracks that already target it — still apply, and its materialized children inherit that transform.
- **Node-growth trade-off:** a label with *N* distinct `change()` states exports as *N* extra nodes (one text mesh per state) plus one scale track per state (plus an opacity track per fade state). A counter that changes 50 times exports 50 extra nodes. This is disclosed here rather than hidden — budget for it in text-heavy scenes.
- **Never silently wrong:** export shows an alert listing every event that couldn't be lowered as authored — both hard failures (target isn't a text mesh / was deleted or renamed) and soft degradations (a `fade` that exported as a cut because this exporter can't animate material opacity).

`.change()` events are stored in the scene's timeline JSON exactly like any other event — `{ at, op:'change', args:{ text, transition }, dur }` on the target's track — so they version, diff, and undo the same way `.animate()` events do.

**Non-goals:** no glyph-level tweening (letters don't morph into each other), no new text-rendering system, and content is piecewise-constant, not interpolated — there is no "70% of the way from `3` to `9`".

## `.moveTo()` / `.moveToEach()` — object-referenced destination animation

Animate an object (or a **set** of objects) to the position of *another object*, referenced by selector — not a raw coordinate. Useful whenever a destination is more naturally "where that other thing is" than a magic-number triple, e.g. a dissection reveal where source cubes migrate onto the cells of a target square.

```js
$S('#cube-a').at(2).moveTo('#slot-a', 600)                              // → #slot-a's position, over 600ms

// pair a SET of sources to a SET of targets, positionally: source[i] → target[i]
$S('#3x3-square .cube').at(3).moveToEach('#5x5-square .cellGroupA', 800)   // 9 cubes  → 9 cells
$S('#4x4-square .cube').at(3).moveToEach('#5x5-square .cellGroupB', 800)   // 16 cubes → 16 cells
```

> **`.moveTo()` is overloaded.** `$S(sel).moveTo(x, y, z)` already existed as the *instant* "set absolute world position" edit — unrelated to the timeline. Calling it with a **string** first argument (`.moveTo('#target', ms)`) instead invokes this animated, timeline-recorded form. The two never collide in practice: a raw coordinate is always three numbers, a destination reference is always one selector string.

- **Destination is resolved at COMPILE time, not tracked live.** `moveTo`/`moveToEach` bake the target's *world position* into an ordinary absolute-position keyframe track the moment the timeline compiles — they do not follow the target during playback. This is a deliberate choice: the target is static authoring scaffolding ("go to where that is"), and baking makes the result a **plain, portable TRS translation track** — the same channel every glTF viewer already honors, no custom runtime dependency. (Playback-time following is a different verb, `follow()`, out of scope here.)
- **The reference is what's stored — the coordinate is a derived compile output.** The scene JSON stores `{ at, op:'moveTo'|'moveToEach', args:{ target: selector }, dur }`, just like any other timeline event. Move the target object and recompile (`syncTimeline`, which runs automatically) and the mover(s) re-resolve to the new position — no animation code to edit.
- **`moveToEach` pairs positionally**: source[i] ↔ target[i], in the same deterministic order `$S` yields each set. **A count mismatch warns (console), it never silently truncates, wraps, or drops.** Resolve a mismatch by subsetting your selectors so the counts match (e.g. split a 5×5 target square into a 9-cell `.cellGroupA` and a 16-cell `.cellGroupB` to match a 3×3 and a 4×4 source set).
- **Position only** — `moveTo`/`moveToEach` never touch rotation or scale; compose a separate `.animate()` (or another recipe) on the same object/track for those.
- **Composes normally**: an object can `moveTo` and `scale`/`fadeIn`/etc. at once (separate channels on the same clip); scrubbing is deterministic and reversible like any other baked keyframe track.

**glTF export:** because the destination is already baked to a standard position track at compile time, `moveTo`/`moveToEach` need **no export-time lowering at all** — the track rides through the normal combined-clip export path unchanged, and plays in any glTF viewer. The target scaffold object itself does **not** need to be exported: mark it **hidden** (`Visible` unchecked in the Object panel) and it — and its whole subtree — is skipped automatically (`GLTFExporter`'s `onlyVisible` default), leaving only the resolved coordinates baked into the movers.

**Recommended pattern — hidden target scaffold for tiling/dissection reveals:** author a target shape (e.g. a 5×5 square built from cell placeholders) purely as a destination reference, set it **not visible**, and `moveToEach` the source objects onto its cells. The destinations then live in the scene graph — authored visually, git-versioned, adjustable by just moving the scaffold — instead of as magic-number coordinates buried in animation code.

**Non-goals:** not playback-time following (see `follow()`, unbuilt); not path/spline control (motion follows the timeline's own interpolation/easing, straight or eased — no curved paths); not orientation matching (position only); not a collision solver (movers can pass through each other mid-flight — stage timing or pair sources to their nearest target, by hand, to avoid ugly crossings).

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
