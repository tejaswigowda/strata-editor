---
slug: two-character-dance
title: One dance, two characters
status: published
description: "Two different sources — a Mixamo FBX and a MetaHuman GLB — map natively into Strata through bodyrig-webCLI: download The Boss from Mixamo and Bruce from metahuman-to-glb, bake the same dance onto both, then stage them on a blank white stage: Bruce leads, The Boss copies three seconds later, and an orbiting camera keeps their faces in frame."
image: asset:images/thumbs/two-character-dance.jpg
---

<div class="strata-tutorial-two-character-dance"></div>

# One dance, two characters

<img width="100%" src="https://strataeditor.dev/about/tutorials/screenshots/1dance.gif" alt="Two characters dancing on a white stage">

<p class="tagline">Two dancers on a blank white stage — a construct, if you like. <strong>Bruce</strong> starts a dance; <strong>The Boss</strong> picks it up three seconds later and copies it move for move, while a camera swings around so you see their faces for most of it. The characters are rigged and animated outside Strata with <a href="https://github.com/tejaswigowda/bodyrig-webCLI" rel="noopener noreferrer">bodyrig-webCLI</a> — it retargets one motion onto any skeleton and writes a single GLB with the animation baked in — then Strata stages and renders them. Open the <a href="https://strataeditor.dev/">editor</a>, open the <strong>Shell</strong> tab, and paste each block in order.</p>

<div class="note"><strong>Two different sources, one pipeline.</strong> The two dancers come from completely different places: <strong>The Boss</strong> is a Mixamo <code>.fbx</code> (a <code>mixamorig</code> skeleton in centimetres, T-pose), and <strong>Bruce</strong> is a MetaHuman <code>.glb</code> (a ~1,200-bone rig in metres, A-pose, with 51 face blendshapes). <a href="https://github.com/tejaswigowda/bodyrig-webCLI" rel="noopener noreferrer">bodyrig-webCLI</a> maps one motion file onto <em>both</em> skeletons and writes a plain GLB for each, so Strata imports them <strong>natively</strong> — through the ordinary <strong>Import</strong> dialog, with no plug-in, converter or per-character setup — and they arrive with the same clip name and length, ready for the same <code>$S()</code> timeline grammar.</div>

<div class="note"><strong>What you&#39;ll need.</strong> A free <a href="https://www.mixamo.com/" rel="noopener noreferrer">Mixamo</a> account (an Adobe ID) for The Boss, a browser for <a href="http://tejaswigowda.com/bodyrig-webCLI/" rel="noopener noreferrer">bodyrig-webCLI</a> (it runs entirely in the page — nothing is uploaded), and Bruce, a MetaHuman exported by <a href="https://github.com/creategamecharacters/metahuman-to-glb" rel="noopener noreferrer">creategamecharacters/metahuman-to-glb</a> (see <a href="https://strataeditor.dev/about/tutorials/make-your-own-metahuman.html">Make your own MetaHuman</a> for what that project is). The pieces are free, but the characters keep their own terms: Mixamo&#39;s characters belong to Adobe and are not meant to be re-hosted, so this tutorial never asks you to commit the Boss file anywhere public.</div>

<h2><span class="step">1</span> Download The Boss from Mixamo</h2>

<p class="lede">The Boss is a stock Mixamo character, so he comes with the standard <code>mixamorig</code> skeleton that bodyrig-webCLI already knows how to map.</p>

<ol class="steps">&#10;		<li>Go to <a href="https://www.mixamo.com/" rel="noopener noreferrer">mixamo.com</a> and sign in with your Adobe ID (free).</li>&#10;		<li>Open the <strong>Characters</strong> tab and pick <strong>The Boss</strong>.</li>&#10;		<li>Press <strong>Download</strong>. Choose format <strong>FBX Binary (.fbx)</strong> and pose <strong>T-pose</strong>, then download and save the file as <code>boss.fbx</code>.</li>&#10;	</ol>

Mixamo's menus change from time to time, so the labels above may read a little differently — what matters is the character as a rigged `.fbx` in a T-pose.

<div class="note"><strong>Want a different dance?</strong> You don&#39;t have to use Mixamo&#39;s motions. bodyrig-webCLI accepts BVH, FBX or GLB for the animation, and it ships a 33-second sample, <a href="http://tejaswigowda.com/bodyrig-webCLI/samples/mocap-33s.bvh" rel="noopener noreferrer">mocap-33s.bvh</a>, that this tutorial uses. If you&#39;d rather pick one from Mixamo, open its <strong>Animations</strong> tab, choose a dance, and download it as FBX with skin set to <strong>Without Skin</strong>; the tool reads animation-only FBX files too.</div>

<h2><span class="step">2</span> Get Bruce</h2>

<p class="lede">Bruce is already a GLB, hosted by the metahuman-to-glb demo. Save it from your browser or with <code>curl</code> (it is about 80 MB):</p>

```
curl -L -o bruce.glb https://creategamecharacters.github.io/metahuman-to-glb/5.7/characters/bruce/bruce.glb
```

<h2><span class="step">3</span> Bake the dance onto both with bodyrig-webCLI</h2>

<p class="lede">Open <a href="http://tejaswigowda.com/bodyrig-webCLI/" rel="noopener noreferrer">tejaswigowda.com/bodyrig-webCLI</a> (or clone <a href="https://github.com/tejaswigowda/bodyrig-webCLI" rel="noopener noreferrer">the repo</a> and run <code>npm start</code> for a local copy at <code>http://127.0.0.1:8010</code>). It is a static page: the badge in the header reads <em>100% local · zero egress</em>, and you can confirm in DevTools&#39; Network tab that your files never leave the machine.</p>

<ol class="steps">&#10;		<li>Drop <code>boss.fbx</code> on the <strong>Character</strong> zone, and <code>mocap-33s.bvh</code> on <strong>Animation tracks</strong>. Both appear as chips (the motion reports its joint count and duration).</li>&#10;		<li>The page bakes as soon as it has a character and a motion; the status bar ends with <em>Done: boss_mocap-33s.glb</em> and a live preview plays. To re-bake after changing an option, press <strong>Bake &amp; export GLB</strong>.</li>&#10;		<li>Press <strong>Download GLB</strong> to save <code>boss_mocap-33s.glb</code>.</li>&#10;		<li>Swap the character: click the <strong>×</strong> on its chip, drop <code>bruce.glb</code> instead (leave the same motion loaded), and download <code>bruce_mocap-33s.glb</code> the same way.</li>&#10;	</ol>

<figure>&#10;		<img src="https://strataeditor.dev/about/tutorials/screenshots/bodyrig-bruce.png" alt="bodyrig-webCLI with bruce.glb loaded as the character and mocap-33s as the animation track, the status bar reading Done: bruce_mocap-33s.glb, and Bruce dancing in the preview.">&#10;		<figcaption>bodyrig-webCLI after baking Bruce: character and motion chips on the left, the finished GLB playing in the preview on the right.</figcaption>&#10;	</figure>

Because both characters were baked from the same motion file, they are **two different sources mapped natively into Strata** by one tool: the animation clip in each GLB has the same name, `mocap-33s`, and the same 33.1-second length — which is exactly what lets The Boss copy Bruce later with a plain time offset.

<div class="note"><strong>It&#39;s a CLI in a page.</strong> Every control is just a command in the box under <em>Command</em>: after dropping the files, <code>bake --fps 30</code> is what the button runs. Useful flags are <code>--foot-lock</code> (pin planted feet with IK), <code>--loop</code> (close the cycle), <code>--in-place</code> and <code>--trim 2:20</code> (seconds). Run <code>help</code> to see them all. For a MetaHuman, leave <strong>Align reference pose</strong> ticked — it is what makes the A-pose Bruce and the T-pose Boss follow the same motion.</div>

<div class="note"><strong>Skip the dragging for Bruce.</strong> The tool also reads a deep link, so you can bake him straight from his URL: <code>http://tejaswigowda.com/bodyrig-webCLI/?character=&lt;bruce URL&gt;&amp;motion=&lt;motion URL&gt;&amp;run=bake</code> (URL-encode the two values). Add <code>--hide Outfits</code> to the command to leave the clothes out of the bake if you only want the bare body.</div>

The GLBs are [meshopt](https://github.com/zeux/meshoptimizer)-compressed to keep them small (Bruce comes out near 39 MB, down from about 80 MB). Strata's loader already includes the meshopt decoder, so nothing extra is needed; tick off **Meshopt compress** only if you plan to open the file in a tool that lacks it.

<h2><span class="step">4</span> Import both into Strata</h2>

<p class="lede">Use <strong>File → Import</strong> (or drag both files onto the editor window). A progress banner tracks each file while it is read and parsed. When the <strong>Import glTF</strong> dialog appears, leave the compression options off — Strata skips mesh simplification on skinned and morph-target meshes anyway, and rigged characters don&#39;t benefit from it — and press <strong>OK</strong>.</p>

Then check what arrived in the Shell:

<pre><code>scene.children.map(o =&gt; o.name);        // [&#39;bruce_mocap-33s.glb&#39;, &#39;boss_mocap-33s.glb&#39;]&#10;scene.animations.map(a =&gt; a.name);      // [&#39;mocap-33s&#39;, &#39;mocap-33s&#39;]</code></pre>

Give them short names to address them by, and measure each character so you know whether the scale is sane. Strata normalizes each import (it centres and grounds the model, and rescales a centimetre-unit Mixamo rig by ×0.01), so both should come in close to 2 m. Each shell command runs in its own scope, so look the characters up again in every block that needs them:

<pre><code>const bruce = scene.children.find(o =&gt; o.name.startsWith(&#39;bruce&#39;));&#10;const boss  = scene.children.find(o =&gt; o.name.startsWith(&#39;boss&#39;));&#10;relabel(bruce, &#39;bruce&#39;);               // Bruce becomes #bruce&#10;relabel(boss, &#39;boss&#39;);                 // The Boss becomes #boss&#10;&#10;const height = o =&gt; new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y;&#10;[height(bruce).toFixed(2), height(boss).toFixed(2)]   // about 2 m each</code></pre>

If one is off, scale his group so he stands about as tall as Bruce — one command, undoable:

<pre><code>const boss = scene.children.find(o =&gt; o.name.startsWith(&#39;boss&#39;));&#10;const k = 1.8 / new THREE.Box3().setFromObject(boss).getSize(new THREE.Vector3()).y;&#10;editor.execute(new SetScaleCommand(editor, boss, boss.scale.clone().multiplyScalar(k)));</code></pre>

<h2><span class="step">5</span> Stage the two dancers</h2>

<p class="lede">Both characters were baked at the origin, so they would dance inside each other. Slide The Boss 2.8 m to the side:</p>

<pre><code>const boss = scene.children.find(o =&gt; o.name.startsWith(&#39;boss&#39;));&#10;editor.execute(new SetPositionCommand(editor, boss, new THREE.Vector3(2.8, 0, 0)));</code></pre>

<h2><span class="step">6</span> Build a blank white stage</h2>

<p class="lede">The stage is a featureless white void: a white background that the floor fades into, light fog to soften the horizon, a glossy white floor for a faint reflection, and two lights.</p>

<pre><code>scene.background = new THREE.Color(0xffffff);&#10;scene.fog = new THREE.Fog(0xffffff, 14, 55);&#10;&#10;const floor = new Mesh(new PlaneGeometry(200, 200),&#10;  new MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.1 }));&#10;floor.rotation.x = -Math.PI / 2;&#10;floor.receiveShadow = true;&#10;floor.name = &#39;Floor&#39;;&#10;editor.execute(new AddObjectCommand(editor, floor));&#10;&#10;const sky = new THREE.HemisphereLight(0xffffff, 0xdddddd, 1.6);&#10;sky.name = &#39;Sky&#39;;&#10;editor.execute(new AddObjectCommand(editor, sky));&#10;&#10;const key = new DirectionalLight(0xffffff, 2.2);&#10;key.position.set(4, 8, 5);&#10;key.castShadow = true;&#10;key.name = &#39;Key&#39;;&#10;editor.execute(new AddObjectCommand(editor, key));</code></pre>

<div class="note"><strong>The environment setting.</strong> If the void looks grey rather than white, check the Scene tab: <em>Background</em> and <em>Environment</em> can override what you set in code (see <a href="https://strataeditor.dev/about/tutorials/build-a-scene.html">Build a night scene from scratch</a> for the same trap).</div>

<h2><span class="step">7</span> Play the dance: Bruce leads, The Boss follows</h2>

<p class="lede">Each imported clip is bound to its own character, so two clips can share a name without clashing — the selector decides whose clip plays. Put Bruce&#39;s on the Universal Timeline at 0 s and the Boss&#39;s at 3 s:</p>

<pre><code>$S(&#39;#bruce&#39;).at(0).play(&#39;mocap-33s&#39;);&#10;$S(&#39;#boss&#39;).at(3).play(&#39;mocap-33s&#39;);</code></pre>

Open the **Animations** tab and scrub: Bruce starts moving at once, The Boss begins three seconds in and repeats the same moves. The whole timeline is 36.1 seconds — the 33.1-second dance plus the Boss's 3-second head start.

<div class="note"><strong>Why bake the same motion twice?</strong> You could retarget live in the page, but a baked clip is plain keyframe data: it is versioned with the scene, selectable by <code>$S</code>, and rendered identically every time. Retargeting <em>per character</em> is the part that needs a tool; sequencing and staging is what Strata is for.</div>

<h2><span class="step">8</span> Add a camera that orbits the dancers</h2>

<p class="lede">A static shot from the wrong side shows the back of both heads for most of the song. First, find which way the dance faces: at the playhead around 10 s, orbit the viewport until you see their faces. For the sample motion they face about 150° away from +Z, toward −Z and slightly +X. Build a camera clip that stays on that side and drifts ±35° around it with a slow push-in, keyed every half second:</p>

<pre><code>const cam = new PerspectiveCamera(35, 16 / 9, 0.5, 60);   // tight near/far = more depth precision&#10;cam.name = &#39;Orbit Camera&#39;;&#10;editor.execute(new AddObjectCommand(editor, cam));&#10;relabel(cam, &#39;orbit-camera&#39;);&#10;&#10;// A camera helper that does the aiming for us. Object3D.lookAt points +Z at the&#10;// target; a camera looks down -Z, so use a camera, not a bare Object3D.&#10;const rig = new PerspectiveCamera();&#10;const center = new THREE.Vector3(1.7, 1.0, 0.7);     // between the two dancers&#10;const times = [], pos = [], quat = [];&#10;for (let t = 0; t &lt;= 33; t += 0.5) {&#10;  const az = THREE.MathUtils.degToRad(150 + 35 * Math.sin(2 * Math.PI * t / 33));&#10;  const r  = 8.5 - Math.sin(Math.PI * t / 33);        // push in, then ease out&#10;  rig.position.set(center.x + r * Math.sin(az), 1.45, center.z + r * Math.cos(az));&#10;  rig.lookAt(center);&#10;  times.push(t);&#10;  pos.push(...rig.position.toArray());&#10;  quat.push(...rig.quaternion.toArray());&#10;}&#10;&#10;addClip(scene, new THREE.AnimationClip(&#39;camera-orbit&#39;, 33, [&#10;  new THREE.VectorKeyframeTrack(cam.uuid + &#39;.position&#39;, times, pos),&#10;  new THREE.QuaternionKeyframeTrack(cam.uuid + &#39;.quaternion&#39;, times, quat),&#10;]));&#10;$S(&#39;#orbit-camera&#39;).at(0).play(&#39;camera-orbit&#39;);</code></pre>

Track names must be `<object uuid>.<property>`, which is why the clip is built from `cam.uuid`. If your dancers face another way, change the `150` (degrees from +Z) and check a few frames with `holdTimelineAt`:

<pre><code>const { holdTimelineAt } = await import(&#39;./editor/js/intelligence/timelineController.js&#39;);&#10;holdTimelineAt(editor, 16);            // jump the whole scene to t = 16 s&#10;editor.viewportCamera = cam;           // look through the new camera&#10;editor.signals.viewportCameraChanged.dispatch();</code></pre>

<div class="note"><strong>Flickering clothes (z-fighting).</strong> A garment that hugs the body sits almost exactly on the skin under it, and for some frames of the dance the two surfaces tie in the depth buffer, so patches of skin show through the cloth. Two fixes, both already in this tutorial: keep the camera&#39;s near/far range tight (<code>0.5</code>–<code>60</code> above, not <code>0.01</code>–<code>1000</code> — depth precision is spent mostly near the camera, and the ratio far/near is what matters), and push the layer underneath slightly back with a polygon offset. Bruce&#39;s outfit sits on his body mesh the same way, so if you see flicker on him, apply the same offset to his body mesh. The Boss&#39;s clothes are separate meshes (jacket, pants, shoes…), so list his meshes first, then offset whichever one is showing through:&#10;	<pre><code>const boss = scene.children.find(o =&gt; o.name.startsWith(&#39;boss&#39;));&#10;const names = [];&#10;boss.traverse(o =&gt; { if (o.isMesh) names.push(o.name); });&#10;names;                                          // pick the mesh that is poking through&#10;&#10;const mesh = boss.getObjectByName(names[0]);    // replace names[0] with that name&#10;mesh.material = mesh.material.clone();          // never edit a material that has already rendered&#10;Object.assign(mesh.material, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });</code></pre>&#10;	If a gap remains, raise the factor; if skin starts to poke <em>through</em> a layer that should be under it, you pushed the wrong one.</div>

<h2><span class="step">9</span> Render it</h2>

<ol class="steps">&#10;		<li>Open the <strong>Render</strong> tab. The <strong>Snapshot</strong> section saves the scene exactly as it is right now, with no grid or gizmos: hold the timeline at a moment you like (<code>holdTimelineAt(editor, 16)</code>), pick <strong>Orbit Camera</strong> and a size, and press <strong>Take Snapshot</strong>.</li>&#10;		<li>For the video, scroll to <strong>Video Render</strong>. With no Camera Sequence shots, the render uses the viewport camera, so add one shot at 0 s pointing at <strong>Orbit Camera</strong> (<em>+ Add Shot</em>, then choose the camera). Pick 1280 × 720 at 30 fps and press <strong>Render &amp; Export</strong>. The whole 36.1-second timeline renders; expect it to take about as long as the clip itself.</li>&#10;		<li>Keep the tab in the foreground while it renders — browsers throttle hidden tabs, which makes frames stall.</li>&#10;	</ol>

To keep the scene, set your repository and token in the **Git** tab and use **Commit Scene**. The characters and their baked clips are stored as binary asset files next to a small scene JSON, so the commit is large but not unmanageable (a few dozen megabytes for this scene).

<pre><code>// Sanity-check what you&#39;re about to commit&#10;$S(&#39;#bruce&#39;).count();                  // 1&#10;editor.timeline.toJSON().tracks.map(t =&gt; t.target);   // [&#39;#bruce&#39;, &#39;#boss&#39;, &#39;#orbit-camera&#39;]</code></pre>

<section class="credits" id="credits">&#10;		&#10;		<h2>Credits and licences</h2>&#10;		<h3>People</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/" rel="noopener noreferrer">Tejaswi Gowda</a> <span class="lic">(script)</span></li>&#10;		</ul>&#10;		<h3>Assets</h3>&#10;		<ul>&#10;			<li><a href="https://www.mixamo.com/" rel="noopener noreferrer">The Boss (Mixamo character, .fbx)</a>: Mixamo, Adobe <span class="lic">Licence: Adobe Mixamo terms (free with an Adobe ID).</span></li>&#10;			<li><a href="https://github.com/creategamecharacters/metahuman-to-glb" rel="noopener noreferrer">Bruce (MetaHuman sample .glb)</a>: creategamecharacters, metahuman-to-glb; MetaHuman by Epic Games <span class="lic">Licence: not stated for the character (the pipeline code is MIT); a MetaHuman is an Epic Games asset.</span></li>&#10;			<li><a href="http://tejaswigowda.com/bodyrig-webCLI/samples/mocap-33s.bvh" rel="noopener noreferrer">mocap-33s.bvh (bodyrig-webCLI sample motion)</a>: bodyrig-webCLI sample motion (the page does not say who captured it) <span class="lic">Licence: not stated (bodyrig-webCLI is GPL-3.0; the sample motion has no terms of its own).</span></li>&#10;		</ul>&#10;		<h3>Tools</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/bodyrig-webCLI/" rel="noopener noreferrer">bodyrig-webCLI</a> <span class="lic">(GPL-3.0)</span></li>&#10;			<li><a href="https://github.com/creategamecharacters/metahuman-to-glb" rel="noopener noreferrer">metahuman-to-glb</a> <span class="lic">(MIT)</span></li>&#10;			<li><a href="https://github.com/zeux/meshoptimizer" rel="noopener noreferrer">meshoptimizer</a> <span class="lic">(MIT)</span></li>&#10;			<li><a href="https://www.mixamo.com/" rel="noopener noreferrer">Mixamo</a> <span class="lic">(Adobe Mixamo terms (free with an Adobe ID))</span></li>&#10;		</ul>&#10;	</section>

<div class="tutorial-footer">&#10;		<a href="https://strataeditor.dev/about/tutorials/">← All tutorials</a> · <a href="https://github.com/tejaswigowda/bodyrig-webCLI">bodyrig-webCLI on GitHub</a> · <a href="https://www.mixamo.com/">Mixamo</a> · <a href="https://github.com/creategamecharacters/metahuman-to-glb">metahuman-to-glb on GitHub</a> · <a href="https://strataeditor.dev/about/">About</a>&#10;	</div>
