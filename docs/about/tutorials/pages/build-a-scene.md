---
slug: build-a-scene
title: Build a night scene from scratch
status: published
description: Reusable helper functions, a noise-displaced ground, a grouped structure, night lighting (and the Environment setting that silently undoes it), a moving object, and a static hero camera — the full from-scratch workflow.
image: asset:images/thumbs/build-a-scene.jpg
---

<div class="strata-tutorial-build-a-scene"></div>

# Build a night scene from scratch

<div class="wc-embed" title="Build a night scene from scratch: interactive example"><a href="https://strataeditor.dev/#repo=tejaswigowda/test1&amp;file=bus-stop.json&amp;present=true">Open embed</a></div>

<p class="tagline">No importing assets, no AI — just the JS Shell, a handful of reusable helper functions, and the Universal Timeline. This walks through the same workflow used to build &quot;Last Stop,&quot; a procedural night bus-stop scene: helpers → environment → a structure → night lighting → a moving object → a static hero camera → render. Open the <a href="https://strataeditor.dev/">editor</a>, open the <strong>Shell</strong> tab, and paste each block in order.</p>

<figure>&#10;		<img src="https://strataeditor.dev/about/tutorials/screenshots/scene-waiting.png" alt="A procedurally-built night bus-stop scene in the Strata viewport: a lit shelter, a glowing lamp, a road stretching into the dark, and a small robot figure waiting on a bench.">&#10;		<figcaption>Where this tutorial ends up (minus the full detail — see the note at the bottom for the complete scene).</figcaption>&#10;	</figure>

<div class="note"><strong>Why the Shell, not clicking.</strong> Every edit below is a real, undoable, git-diffable command (<code>editor.execute(...)</code> under the hood). Procedural scenes especially benefit from this — a road, a fence, a field of rocks are all &quot;the same shape N times with varied params,&quot; which is a loop, not N clicks.</div>

<h2><span class="step">1</span> Write reusable helpers first</h2>

<p class="lede">Almost everything you build is one of a few shapes: a box, a rounded box, a rod between two points. Write these once at the top of your session and every later step gets shorter:</p>

<pre><code>function mat(color, opts = {}) {&#10;  return new MeshStandardMaterial({ color, roughness: 0.7, ...opts });&#10;}&#10;function mesh(geometry, material, x = 0, y = 0, z = 0, parent = null) {&#10;  const m = new Mesh(geometry, material);&#10;  m.position.set(x, y, z);&#10;  m.castShadow = m.receiveShadow = true;&#10;  if (parent) parent.add(m);&#10;  else editor.execute(new AddObjectCommand(editor, m));&#10;  return m;&#10;}&#10;function box(w, h, d, material, x, y, z, parent) {&#10;  return mesh(new BoxGeometry(w, h, d), material, x, y, z, parent);&#10;}&#10;function rod(a, b, radius, material, parent) {&#10;  const dir = new Vector3().subVectors(b, a);&#10;  const seg = mesh(new CylinderGeometry(radius, radius, 1, 8), material, 0, 0, 0, parent);&#10;  seg.position.copy(a).add(b).multiplyScalar(0.5);&#10;  seg.scale.y = dir.length();&#10;  seg.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());&#10;  return seg;&#10;}</code></pre>

Every later helper (rounded boxes, canvas textures for signs, procedural rock fields) is the same idea: a small function you write once, then call in a loop.

<h2><span class="step">2</span> Ground, sky, and fog</h2>

<p class="lede">A ground plane with a bit of noise reads far better than a flat color. Displace vertices in a loop, and use <code>FogExp2</code> so distant geometry fades out instead of hard-clipping at the far plane:</p>

<pre><code>const groundGeo = new PlaneGeometry(60, 60, 40, 40);&#10;const pos = groundGeo.attributes.position;&#10;for (let i = 0; i &lt; pos.count; i++) {&#10;  const x = pos.getX(i), y = pos.getY(i);&#10;  pos.setZ(i, Math.sin(x * 0.15) * Math.cos(y * 0.15) * 0.4);&#10;}&#10;groundGeo.computeVertexNormals();&#10;const ground = mesh(groundGeo, mat(0x8e7154));&#10;ground.rotation.x = -Math.PI / 2;&#10;ground.name = &#39;Ground&#39;;&#10;&#10;scene.fog = new FogExp2(0x0a0e18, 0.02);</code></pre>

<h2><span class="step">3</span> A structure, built as a group</h2>

<p class="lede">Group related parts under one named <code>Group</code> so the Outliner stays readable and you can move/animate the whole thing as one object. A simple shelter — four posts and a roof slab — demonstrates the pattern everything bigger (a bus, a fence, a robot) also follows:</p>

<pre><code>const shelter = new Group();&#10;shelter.name = &#39;Shelter&#39;;&#10;editor.execute(new AddObjectCommand(editor, shelter));&#10;&#10;const post = mat(0x526765, { metalness: 0.5, roughness: 0.65 });&#10;for (const x of [-1.5, 1.5]) for (const z of [-1, 1]) {&#10;  box(0.12, 2.4, 0.12, post, x, 1.2, z, shelter);&#10;}&#10;box(3.4, 0.15, 2.6, mat(0x815840), 0, 2.5, 0, shelter);</code></pre>

<div class="note"><strong>Why <code>parent</code> instead of always <code>AddObjectCommand</code>.</strong> The top-level group gets one undo-tracked <code>AddObjectCommand</code>; its children are just <code>parent.add(...)</code> since they&#39;re not independently addressable objects in the scene graph — the same pattern the built-in helpers use for a bus with 80+ parts, so undo/redo stays one step instead of eighty.</div>

<h2><span class="step">4</span> Light it for night</h2>

<p class="lede">A dim <code>HemisphereLight</code> for ambient sky/ground fill, a low-intensity <code>DirectionalLight</code> standing in for moonlight, and one warm <code>PointLight</code> as the actual subject of the shot — the thing a viewer&#39;s eye goes to:</p>

<pre><code>const hemi = new THREE.HemisphereLight(0x0a1428, 0x161208, 0.1);&#10;hemi.name = &#39;Hemisphere&#39;;&#10;editor.execute(new AddObjectCommand(editor, hemi));&#10;&#10;const moon = new DirectionalLight(0xaac4ff, 0.16);&#10;moon.position.set(-40, 90, -30);&#10;moon.name = &#39;Moonlight&#39;;&#10;editor.execute(new AddObjectCommand(editor, moon));&#10;&#10;const lamp = new PointLight(0xffc37e, 2.4, 12, 2);&#10;lamp.position.set(0, 2.6, 0);&#10;lamp.castShadow = true;&#10;lamp.name = &#39;Lamp&#39;;&#10;editor.execute(new AddObjectCommand(editor, lamp));</code></pre>

<div class="note"><strong>The mistake that undoes all of this.</strong> Strata&#39;s <strong>Scene</strong> tab has an <strong>Environment</strong> dropdown defaulted to <em>Default</em> — a bright, generic image-based-lighting environment map. It lights every <code>MeshStandardMaterial</code> in the scene independently of every light object above, and at its default intensity it will wash out a night scene no matter how dim you make your lights. Set it to <strong>None</strong> (or <code>editor.signals.sceneEnvironmentChanged.dispatch(&#39;None&#39;)</code> from the Shell) before judging your lighting — this single setting was the difference between a bright &quot;dusk&quot; look and a real night look while building the reference scene.</div>

A couple of intensity numbers are easy to get wrong the first time too: if a light is going to flicker or pulse later via a per-frame script, its _authored_ intensity should be the steady-state value the flicker oscillates around — not whatever placeholder you happened to construct it with. A `PointLight(color, 47, ...)` that a script immediately overwrites to `2.4 * flicker` every frame should be authored at `2.4`, since Strata's timeline bakes keyframes rather than running a per-frame callback.

<figure>&#10;		<img src="https://strataeditor.dev/about/tutorials/screenshots/shell-example.png" alt="The Strata Shell tab with a code block being entered, showing live autocomplete suggestions for editor, THREE, scene, camera, and the built-in Command classes.">&#10;		<figcaption>Pasting a block into the Shell — autocomplete lists everything in scope (<code>editor</code>, <code>THREE</code>, <code>scene</code>, the Command classes, and every bare geometry constructor).</figcaption>&#10;	</figure>

<h2><span class="step">5</span> Animate something along the timeline</h2>

<p class="lede">Give the shelter (or any object) a moving companion — a lit box standing in for a vehicle works fine to demonstrate the grammar. <code>$S(selector).at(seconds).animate(...)</code> places one keyframe event; chain more calls to build a multi-leg move:</p>

<pre><code>const rig = box(1, 1, 3, mat(0x365854, { metalness: 0.3 }), 0, 0.5, -30);&#10;rig.name = &#39;Rig&#39;;&#10;&#10;$S(&#39;#Rig&#39;).at(0).animate({ to: { positionZ: -8 } }, 8000, &#39;linear&#39;);&#10;$S(&#39;#Rig&#39;).at(8).animate({ to: { positionZ: -8 } }, 1000); // a short hold&#10;$S(&#39;#Rig&#39;).at(9).animate({ to: { positionZ: 20 } }, 4000, &#39;ease-in&#39;);</code></pre>

Scrub the **Animations** tab's timeline to preview — `$S(...).at(t)` events are absolute seconds on one shared clock for the whole scene, so a camera, a light's intensity, and this rig can all be choreographed against the same numbers. See [the animation guide](https://strataeditor.dev/guides/ANIMATION.md) for the full grammar (fades, lookAt, per-axis targets, class-based batch selectors).

<figure>&#10;		<img src="https://strataeditor.dev/about/tutorials/screenshots/scene-arrival.png" alt="The same night scene viewed from a default orbit camera, showing the shelter, a partially visible vehicle, and the lamp&#39;s warm glow on the ground.">&#10;		<figcaption>Mid-timeline: the lamp&#39;s warm pool of light is doing most of the compositional work in a dark scene.</figcaption>&#10;	</figure>

<h2><span class="step">6</span> Cut in a static hero camera</h2>

<p class="lede">Your main camera can stay wherever you like — animated, or just parked at a default angle. For one moment worth a dedicated, hand-framed shot (say, the rig&#39;s closest pass to the lamp), add a <em>second</em>, non-animated camera and schedule it in the <strong>Render</strong> tab&#39;s Camera Sequence rather than re-keyframing the main one:</p>

<pre><code>const heroCam = new PerspectiveCamera(38, 16 / 9, 0.1, 500);&#10;heroCam.name = &#39;HeroCam&#39;;&#10;heroCam.position.set(4, 1.6, -4);&#10;heroCam.lookAt(0, 1, 0);&#10;editor.execute(new AddObjectCommand(editor, heroCam));&#10;&#10;editor.scene.userData.renderShots = [&#10;  { id: &#39;shot-intro&#39;,  at: 0, camera: editor.camera.uuid, transition: &#39;cut&#39;,  transitionDur: 0.5 },&#10;  { id: &#39;shot-hero&#39;,   at: 8, camera: heroCam.uuid,       transition: &#39;fade&#39;, transitionDur: 0.8 },&#10;  { id: &#39;shot-return&#39;, at: 12, camera: editor.camera.uuid, transition: &#39;fade&#39;, transitionDur: 0.8 },&#10;];&#10;editor.signals.sceneGraphChanged.dispatch();</code></pre>

A shot runs from its `at` until the next shot's `at` (or the timeline's end) — with zero shots, the render always falls back to the single camera picked at the top of the Render tab, so this is purely additive. Preview any camera by temporarily pointing the viewport at it:

<pre><code>editor.viewportCamera = heroCam;&#10;editor.signals.viewportCameraChanged.dispatch();</code></pre>

<div class="note"><strong>Keep it out of the way.</strong> A static camera parked directly in a moving object&#39;s path gets driven through mid-shot. Offset it to the side or elevate it so the subject passes near the lens, not through it, for the whole window it&#39;s active.</div>

<figure>&#10;		<img src="https://strataeditor.dev/about/tutorials/screenshots/render-sequence.png" alt="The Strata Render tab showing a three-shot Camera Sequence lane: an initial cut to the main camera, a fade to HeadlightHeroCam, and a fade back to the main camera.">&#10;		<figcaption>The Render tab&#39;s Camera Sequence lane after adding a hero-camera cut-in — see <a href="https://strataeditor.dev/about/tutorials/render-camera-sequence.html">the dedicated tutorial</a> for more on this feature.</figcaption>&#10;	</figure>

<h2><span class="step">7</span> Render it</h2>

<ol class="steps">&#10;		<li>Open the <strong>Render</strong> tab, pick a resolution and FPS.</li>&#10;		<li>The <strong>Camera Sequence</strong> lane shows your shots as colored blocks — click one to retarget its camera or nudge its timing without touching the Shell again.</li>&#10;		<li>Click <strong>Render &amp; Export</strong> — rendering is real-time, so a 20s timeline takes about 20s.</li>&#10;	</ol>

<div class="note"><strong>This tutorial is a distillation, not the full scene.</strong> The actual &quot;Last Stop&quot; reference this is based on has ~500 objects: a noise-displaced road with painted stripes, a fence with sagging wire (<code>CatmullRomCurve3</code> + <code>TubeGeometry</code>), a field of procedurally-scattered rocks and cacti, an articulated robot figure (cylinders connected end-to-end via quaternion alignment, same idea as the <code>rod()</code> helper above), a bus with real glass materials and working headlight beams, and a full multi-shot camera choreography over a 45-second timeline. Every one of those is the same handful of patterns from this tutorial — a helper function, a loop, a named <code>Group</code>, a <code>$S(...).at(t).animate(...)</code> call — just repeated and combined more times.</div>

<section class="credits" id="credits">&#10;		&#10;		<h2>Credits and licences</h2>&#10;		<h3>People</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/">Tejaswi Gowda</a> <span class="lic">(script, scene)</span></li>&#10;		</ul>&#10;		<h3>Assets</h3>&#10;		<p>None used.</p>&#10;		<h3>Tools</h3>&#10;		<p>None used.</p>&#10;	</section>

<div class="tutorial-footer">&#10;		<a href="https://strataeditor.dev/about/tutorials/">← All tutorials</a> · <a href="https://strataeditor.dev/about/">About</a>&#10;	</div>
