---
slug: render-camera-sequence
title: Add a static hero camera to a render sequence
status: published
description: A focused deep-dive on just the Render tab's Camera Sequence feature — add a fixed, non-animated camera and cut it in to showcase one moment your main animated camera doesn't frame well.
image: asset:images/thumbs/render-camera-sequence.jpg
---

<div class="strata-tutorial-render-camera-sequence"></div>

# Add a static hero camera to a render sequence

[All tutorials](https://strataeditor.dev/about/tutorials/)

<p class="tagline">Your main camera is animated for the whole timeline — but sometimes one moment (an explosion, a headlight beam, a reveal) deserves its own fixed, carefully-framed shot cut into the middle of the video. This tutorial adds a second, <em>non-animated</em> camera and schedules it in the <strong>Render</strong> tab&#39;s Camera Sequence. Open the <a href="https://strataeditor.dev/">editor</a>, load a scene with an existing timeline, open the <strong>Shell</strong> tab, and paste each block in order.</p>

<div class="note"><strong>Why a second camera, not more keyframes.</strong> The Camera Sequence is a completely separate mechanism from animating <code>camera</code> itself: it&#39;s a list of <em>shots</em>, each naming a camera object and a start time, persisted on <code>scene.userData.renderShots</code>. A shot&#39;s camera does not need any keyframes at all — it can simply sit wherever you put it for the whole time it&#39;s on screen. That&#39;s the point: a hero shot is often better hand-framed once than animated.</div>

<h2><span class="step">1</span> Find a moment worth a dedicated shot</h2>

<p class="lede">Scrub the timeline to the moment you want to showcase and look at what your main camera shows there. Use <code>holdTimelineAt</code> to jump straight to a timestamp without pressing play:</p>

<pre><code>const { holdTimelineAt } = await import(&#39;./editor/js/intelligence/timelineController.js&#39;);&#10;holdTimelineAt(editor, 24); // seconds into the Universal Timeline</code></pre>

If the main camera's framing doesn't do that moment justice — too far, wrong angle, an object in the way — that's exactly the case for a second, purpose-built camera.

<h2><span class="step">2</span> Add the new camera</h2>

<p class="lede">A plain <code>THREE.PerspectiveCamera</code>, added like any other object. Give it a name — you&#39;ll use it to select the camera again later. <strong>Don&#39;t add any keyframes to it</strong>; point it once and leave it:</p>

<pre><code>const heroCam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 500);&#10;heroCam.name = &#39;HeadlightHeroCam&#39;;&#10;heroCam.position.set(-4.15, 3.2, 14);&#10;heroCam.lookAt(-4.15, 1.0, -40);&#10;editor.execute(new AddObjectCommand(editor, heroCam));</code></pre>

Jump back to your target moment and check the framing from the new camera before wiring it into anything — swap the viewport over to it temporarily:

<pre><code>editor.viewportCamera = heroCam;&#10;editor.signals.viewportCameraChanged.dispatch();&#10;holdTimelineAt(editor, 24);</code></pre>

Nudge `heroCam.position` / re-run `.lookAt(...)` and re-dispatch `objectChanged` until it reads well across the _whole_ span you'll use it for — not just one instant. A bus or character can move a long way in a few seconds; check both ends of the window:

<pre><code>heroCam.position.set(-4.15, 3.2, 14);&#10;heroCam.lookAt(-4.15, 1.0, -40);&#10;editor.signals.objectChanged.dispatch(heroCam);</code></pre>

<div class="note"><strong>Keep it clear of anything that moves.</strong> A static camera parked directly in a moving object&#39;s path will get run over mid-shot. Offset it to the side, or elevate it, so the subject passes near — not through — the lens for the shot&#39;s entire duration.</div>

<h2><span class="step">3</span> Cut it into the Camera Sequence</h2>

<p class="lede">The sequence is a plain array on <code>scene.userData.renderShots</code>: <code>{ id, at, camera: uuid, transition, transitionDur }</code>. A shot runs from its <code>at</code> until the next shot&#39;s <code>at</code> (or the timeline&#39;s end). Build a three-shot sequence — main camera, then the hero shot, then back to the main camera:</p>

<pre><code>const shots = [&#10;  { id: &#39;shot-intro&#39;,     at: 0,  camera: editor.camera.uuid, transition: &#39;cut&#39;,  transitionDur: 0.5 },&#10;  { id: &#39;shot-headlight&#39;, at: 20, camera: heroCam.uuid,       transition: &#39;fade&#39;, transitionDur: 0.8 },&#10;  { id: &#39;shot-return&#39;,    at: 29, camera: editor.camera.uuid, transition: &#39;fade&#39;, transitionDur: 0.8 },&#10;];&#10;editor.scene.userData = editor.scene.userData || {};&#10;editor.scene.userData.renderShots = shots;&#10;editor.signals.sceneGraphChanged.dispatch(); // refreshes the Render tab&#39;s sequencer UI</code></pre>

Switch the viewport back to your main camera when you're done previewing:

<pre><code>editor.viewportCamera = editor.camera;&#10;editor.signals.viewportCameraChanged.dispatch();</code></pre>

<h2><span class="step">4</span> Check it in the Render tab</h2>

<ol class="steps">&#10;		<li>Open the <strong>Render</strong> tab. The <strong>Camera Sequence</strong> lane now shows three colored blocks — one per shot, labeled with the camera name and its cut/fade transition.</li>&#10;		<li>Click a block to select it; the detail row below lets you retarget its camera, nudge its start time, or change <code>cut</code>/<code>fade</code> and the fade duration — all without touching the Shell again.</li>&#10;		<li>With <strong>zero</strong> shots, the render always falls back to the single camera picked in the <strong>Camera</strong> dropdown at the top — the sequence is opt-in, never required.</li>&#10;	</ol>

<h2><span class="step">5</span> Render it</h2>

<p class="lede">Pick a resolution/FPS and click <strong>Render &amp; Export</strong>. The sequence plays back exactly as scheduled: your main camera&#39;s own animation runs during its shots, then the render cuts (or fades) to the static hero camera at <code>20s</code>, holds its fixed framing for nine seconds, then cuts back.</p>

<div class="note"><strong>Real example this tutorial is based on.</strong> A bus&#39;s headlight beams were nearly invisible from the main animated camera&#39;s angle at that distance. Rather than re-choreograph the whole approach, one static camera placed dead-center on the road — elevated above the bus&#39;s roofline, looking straight down the lane the headlights travel — was cut in for just the arrival. The beams read as two clean glowing cones converging on the lens, then the sequence handed back to the main camera for the stop and boarding. See <a href="https://strataeditor.dev/guides/ANIMATION.md">the animation guide</a> for the full <code>$S(...)</code> grammar this tutorial&#39;s main camera would otherwise use.</div>

<section class="credits" id="credits">&#10;		&#10;		<h2>Credits and licences</h2>&#10;		<h3>People</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/" rel="noopener noreferrer">Tejaswi Gowda</a> <span class="lic">(script)</span></li>&#10;		</ul>&#10;		<h3>Assets</h3>&#10;		<p>None used.</p>&#10;		<h3>Tools</h3>&#10;		<p>None used.</p>&#10;	</section>

<div class="tutorial-footer">&#10;		<a href="https://strataeditor.dev/about/tutorials/">← All tutorials</a> · <a href="https://strataeditor.dev/about/">About</a>&#10;	</div>
