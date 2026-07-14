# The Strata language: selector-based editing

> Part of the [Strata documentation](../README.md#documentation). See also:
> [JS Shell](JS_SHELL.md) · [Animation](ANIMATION.md) · [Scene intelligence](SCENE_INTELLIGENCE.md) · [AI guide](AI_GUIDE.md)

> The runtime-free core of this language is also published as a standalone library,
> [**`$S` / 3DOM**](https://github.com/tejaswigowda/3dom) ("jQuery for 3D"), with a versioned
> [SPEC.md](https://github.com/tejaswigowda/3dom/blob/main/SPEC.md), the standalone repo
> [github.com/tejaswigowda/3dom](https://github.com/tejaswigowda/3dom), and an
> interactive [live demo](http://tejaswigowda.com/3dom/examples/bare.html).
> It runs over any three.js scene with three as a
> peer dependency; Strata consumes it through a host adapter, so the surface below is the
> editor-integrated view of the same grammar and op set.

A CSS-like selector layer over the scene graph, plus a closed set of structured edit ops. This is the preferred way to edit imported parts. `$S(selector)` returns a chainable set. Its methods are 3D ops. Each compiles to `editor.execute(new Command())`. Every op is undoable, versioned, and guarded. `$S` also answers to the aliases `Pick` and `pick`. They are the same function.

```js
listSelectors()                     // the REAL addressable parts in THIS scene, with counts:
                                    //   .rims(x4)  .grille  #dump-bed  .red(x3)  .front
$S('.rims').recolor('#111')         // recolor 4 wheels. Command-backed, guarded
$S('.wheel.front').spin('y', 1, 2)  // compound selector + animation op (winding-safe clip)
$S('#dump-bed').scale(1.2)          // edit a single labelled part by id
op({ type:'recolor', selector:'.rims', color:'red' })   // explicit op-JSON (same thing)
ops([ {}, {} ])                     // several ops in one undoable batch (multi-op)
```

## Selector grammar

Deterministic match, no model at match time: `#id` (semantic label), `.class`, `type` (`mesh`/`group`/`light`), `.a.b` (compound AND), `A B` (descendant), `A > B` (child), `*`, plus the live-selection pseudo-selectors `:selected` / `:lasso`. Classes auto-derive on import from descriptors. Facts like `.front .left .red .elongated .pair-left`, plus material names (`Rims` to `.rims`). The optional labeling pass adds semantic `#labels` and `.classes` (`wheel`, `dump-bed`).

**Name normalization.** Class and id names are **normalized** on both sides of every match: lowercased, spaces→hyphens, non-alphanumerics stripped, by a single `normalizeClassName`. So a stored label `Front Wheel`, an auto-derived class `.front-wheel`, and a hand-typed `#front-wheel` all reconcile to the same token; authoring (`addClass`, `editID`) and matching never disagree.

**Names become classes too.** A meaningful object name yields a stem class, so "Chair 1", "Chair 2", and "Chair 3" all get `.chair`. Plural requests then resolve cleanly (`$S('.chair').scale(0.5)`). The trailing index also stays addressable by id (`#chair-2`). Auto-generated names like `Object_12` are skipped so the vocabulary stays clean.

## Closed op set

The human sugar; each is also an op-JSON `type`:

```js
// ── Write ops (mutations) ──
recolor(color)  scale(factor, axis?)  move(dx,dy,dz)  rotate(axis, deg)
delete()  duplicate(dx,dy,dz)  setMaterial({})  retexture(tex)

// ── Bulk property setters (jQuery `.css()` mechanic: one value → whole set, one undo) ──
castShadow(b)  receiveShadow(b)  frustumCulled(b)  renderOrder(n)                       // object / render
metalness(v)  roughness(v)  emissive(color)  emissiveIntensity(v)  flatShading(b)  doubleSided(b)  // material (clone-on-write)
intensity(v)  lightColor(color)  groundColor(color)  distance(v)  angle(rad)  penumbra(v)  decay(v)  // lights
fov(deg)  near(v)  far(v)                                                               // camera

spin(axis?,turns?,dur?)  bounce()  pulse()  fade()  orbit()  shake()   // keyframe clips

// ── Entrance animations (appear with style) ──
fadeIn(dur?)  zoomIn(scale?, dur?)
slideInUp(dist?, dur?)  slideInDown(dist?, dur?)  slideInLeft(dist?, dur?)  slideInRight(dist?, dur?)
bounceIn(dur?)  flipInX(dur?)  flipInY(dur?)  rotateIn(angle?, dur?)

// ── Exit animations (disappear with style) ──
fadeOut(dur?)  zoomOut(scale?, dur?)
slideOutUp(dist?, dur?)  slideOutDown(dist?, dur?)  slideOutLeft(dist?, dur?)  slideOutRight(dist?, dur?)
bounceOut(dur?)  flipOutX(dur?)  flipOutY(dur?)  rotateOut(angle?, dur?)

// ── Attention seekers (grab focus) ──
flash(times?, dur?)  rubberBand(scale?, dur?)  jello(intensity?, dur?)
heartBeat(scale?, dur?)  tada(rotations?, scale?, dur?)  wobble(angle?, dur?)

op({ type:'raw', selector, code })   // escape hatch: raw JS as one op (loop-protected)
```

The animation ops are documented in full in [ANIMATION.md](ANIMATION.md).

## `$S()` API: Query and traversal

The selector language has **read operations** for querying the scene and **traversal methods** for graph navigation, complementing the **write operations** (mutations) documented above.

### Query / Inspection (read-only)
```js
// ── Essential cardinality checks ──
.count()                        // how many nodes matched? → essential feedback
.exists() / .isEmpty()          // did selector match anything? (boolean check before mutation)

// ── Node introspection ──
.names() / .ids()               // get resolved node names or UUIDs (what am I about to edit?)
.id()                           // semantic id(s) → #id / userData.label (string for one, array for many)
.classes(node)                  // what classes does this node have? (introspection)
.isClass('front')               // jQuery-style: true if ANY matched node has the class
.bounds() / .size()             // bounding box dimensions (needed for spatial reasoning)
```

### Semantic class & id authoring (jQuery-style, undoable)

Tag the addressable vocabulary straight from the fluent set. Classes (`.foo`) and ids (`#foo`)
drive selector resolution **and** the injected ADDRESSABLE PARTS list, so tagging here makes the
set addressable next time. Every mutation is command-backed and batches into a single undo;
names normalize (`"Front Wheel"` ↔ `.front-wheel`) so hand-typed and auto-derived tokens always
reconcile.

```js
$S(':selected').addClass('hero')       // add a class to every node in the set
$S('.hero').removeClass('hero')        // remove it from every node
$S('.wheel').toggleClass('spare')      // per-node toggle (pass true/false to force a state)
$S('#redcube').editID('champion')      // rename the semantic id → now addressable as #champion
$S(':selected').id()                   // read id(s): string for one node, array for many
$S('.wheel').isClass('front')          // jQuery-style: true if ANY matched node has the class
```

### Lasso & live selection (interactive ↔ shell)

The **Lasso** toolbar tool (freehand-drag a region in the viewport) and the shell are the
same selection surface. What you draw by hand is addressable in code, and code can perform a
lasso itself: one screen-space algorithm behind both. `:lasso` and `:selected` are **first-class
pseudo-selectors** resolved through the *entire* op pipeline (not just the `$S()` constructor),
so every op works on them (`.scale`, `.move`, `.addClass`, `.delete`), not only `.recolor`.

```js
$S(':lasso')                    // the CURRENT viewport selection, i.e. whatever the
                                //   mouse lasso (or click-select) last produced.
$S(':selected')                 // alias of the above (both bare `lasso`/`selected` work too)
$S(':lasso').recolor('#f00')    // recolor exactly what you lassoed on screen

// Programmatic lasso: pass a polygon of viewport pixels ([[x,y],…] or [{x,y},…]).
// It applies the selection AND returns a chainable $S set, so ops chain directly:
lasso([[20,20],[400,20],[400,300],[20,300]]).scale(1.2).recolor('#0af')
```

The lasso is **resolution-independent** and selects *every* mesh whose projected centre or
bounding-box corner falls inside the outline, including objects occluded behind others
(unlike ray-casting). An indeterminate progress bar shows while you drag. See
[LASSO_TOOL_GUIDE.md](LASSO_TOOL_GUIDE.md) for the full interactive-tool walkthrough.

### Value getters (read-only, before write)
```js
.position(node)  .rotation(node)  .scale(node)     // current WORLD transforms (call form)
.color(node)                                        // sampled material color (hex string)
.material(node)                                     // current material props {type, color, metalness, roughness, opacity, ...}
.opacity(node)                                      // current transparency (0–1)
.visible(node)                                      // visibility state (boolean)
```

### Live transform accessors (read + command-backed write)
`.position` `.rotation` `.scale` `.quaternion` are property accessors that return a
**live handle** over the set's first node in **LOCAL** space (three.js-native, mirroring
`mesh.position`). Reading a component is live; **writing routes through the command
surface** (undoable, refreshes viewport + inspector) and applies to *every* node in the
set, batched into one undo step.
```js
$S('#box').position            // live handle (read .x/.y/.z, .toArray(), .clone())
$S('#box').position.x          // → current local x
$S('#box').position.x = 4      // → SetPositionCommand (undoable)
$S('#box').scale.set(2, 2, 2)  // → SetScaleCommand (undoable)
$S('#box').rotation.y = Math.PI // rotation is radians (native THREE.Euler)
$S('#box').quaternion.w = 1    // writes convert to Euler → SetRotationCommand

// Back-compat call forms still work:
$S('.wheel').scale(1.5)        // relative-scale op (flagship)
$S('#box').position()          // world-space THREE.Vector3 (read-only snapshot)
```


### Traversal (graph navigation)
```js
// ── Existing ──
.filter(selector)               // narrow selection
.each(fn)                        // iterate (read-only)

// ── New traversal methods ──
.not(selector)                  // exclude ("all wheels except front")
.first() / .last()              // pick one from a set (returns new ChainableSet)
.eq(n) / .at(n)                 // nth match (zero-indexed, returns new ChainableSet)
.parent() / .children()         // graph traversal (returns new ChainableSet)
.closest(selector)              // walk up to nearest ancestor matching selector
.add(selector)                  // union: combine two selections into one
```

### Appearance ops (mutations)
```js
.setOpacity(value)              // set transparency (0–1, distinct from fade animation)
.setVisible(bool)               // set visibility
.show() / .hide()               // shortcuts for setVisible(true) / setVisible(false)
  // LIFECYCLE: show() / hide() trigger entrance/exit animations if attached
.wireframe(bool)                // toggle wireframe render mode
```

### Bulk property setters (one value → whole set, one undo)

The jQuery `.css('color','red')` mechanic: a single value fanned out over **every** matched
node as **one undoable batch** (never N undo entries). Built on one primitive, `bulkApply`,
so every setter below is an instance, not a special case. Method names match the three.js
property they set (`.castShadow`, `.metalness`, `.fov`), so the name you know is the name you
call. Material setters **clone-on-write**: a bulk change over a shared material clones per node
first, so it never bleeds onto parts you didn't select. Each also exists as an op-JSON `type`
(AI-emittable) and carries the same guards as the rest of the language.

```js
// ── Object / render flags (apply to meshes; castShadow also to lights) ──
$S('*').castShadow(true).receiveShadow(true)   // whole scene casts + receives shadows
$S('.glass').renderOrder(1)                     // fix transparency sort order
$S('#decal').frustumCulled(false)               // never cull this one

// ── Material (PBR): clone-on-write, so shared materials don't bleed ──
$S('.metal').metalness(1).roughness(0.2)        // chainable
$S('.lava').emissive('#ff4400').emissiveIntensity(2)
$S('.leaf').flatShading(true).doubleSided(true)

// ── Lights ──
$S('type(light)').intensity(2)
$S('#sun').lightColor('#fff2cc')                // light.color (recolor targets materials)
$S('#hemi').groundColor('#334')                 // hemisphere ground tint
$S('#lamp').distance(20).decay(2)               // point/spot falloff
$S('#spot').angle(Math.PI/6).penumbra(0.3)      // spot cone (angle in RADIANS)

// ── Camera (the viewport camera answers to `camera` / `#camera`) ──
$S('camera').fov(50).near(0.1).far(500)         // reprojects automatically

// ── Raw primitive for power users: any Command, fanned out, one undo ──
$S('*').bulkSet(n => new SetValueCommand(editor, n, 'renderOrder', 1), n => n.isMesh)
```

### Transform ops: relative vs absolute (standardized pair)
```js
// ── Relative (incremental change) ──
.move(dx, dy, dz)               // relative offset (existing)
.rotate(axis, degrees)          // relative rotation (existing, now clarified as relative)
.scale(factor, axis?)           // relative scale (existing, now clarified as relative)

// ── Absolute (set to target value) ──
.moveTo(x, y, z)                // set absolute world position
.rotateTo(x, y, z)              // set absolute rotation (Euler in degrees)
.scaleTo(factor)                // set absolute uniform scale
.reset()                         // restore original transform
.lookAt(target)                 // orient toward a point or object
```

**Standardization note:** The relative-vs-absolute distinction is now explicit:
- **.move / .rotate / .scale** = relative (incremental change)
- **.moveTo / .rotateTo / .scaleTo** = absolute (set to target value)

This regularity is essential for a proper read/write language. Both humans and models can now reason about transform operations unambiguously.

## Host-enforced guards

The model expresses intent. The host enforces correctness. Clone-on-write for shared materials (no bleed). Texture-tint warning (`recolor` on a textured part tints; use `setMaterial` for solid). Merged-mesh graceful fail. Ground and clamp. A "subset named but all changed" flag: a part selector that resolves to every mesh is surfaced as a likely wrong resolution, never a silent pass.

## Curating labels and classes

Edit the addressable vocabulary directly. All command-backed (undoable) and reflected in the next AI request:

```js
relabel('wheel')           // rename the selected part's label. Now #wheel
tagClass('wheel')          // add a semantic class. Now .wheel
untagClass(node, 'rims')   // remove a class
verifyImport()             // open the Import + Verify panel (also opens automatically after import)
```

The same edits are available **set-wide** on the fluent `$S` surface: one undoable batch across
every matched node: `$S(sel).addClass('wheel')`, `.removeClass('rims')`, `.toggleClass('spare')`,
and `.editID('wheel')` (the id/`#label` writer). Read them back with `.id()` and `.isClass()`.

---

**Next:** [Animation (the universal timeline)](ANIMATION.md) · [Scene intelligence](SCENE_INTELLIGENCE.md) · [JS Shell](JS_SHELL.md) · [← Back to README](../README.md)
