---
slug: sparring-from-mocap
title: A sparring match from a two-person motion capture
status: published
parent: tutorials
---

<h1>A sparring match from a two-person motion capture</h1>

<figure>&#10;		<img src="./screenshots/dojo-sparring.png" alt="Two fighters sparring on a tatami mat inside an open bamboo hut">&#10;		<figcaption>The starting scene, <a href="../../#repo=tejaswigowda/test1&amp;file=sparring.json&amp;branch=main"><code>sparring.json</code></a>, seen through <code>cam-wide</code> at 12 s.</figcaption>&#10;	</figure>

<p class="tagline">Two people sparred for <strong>170 seconds</strong> in front of an optical motion-capture system. Here you turn that take into a <strong>53-second match</strong>: register the pair, cut it as data, check every frame for collisions, move the camera shots onto the new timeline, and give both fighters somewhere to look.</p>

<div class="note credit"><strong>Credits.</strong> The motion in this tutorial was recorded with an <strong>OptiTrack</strong> optical motion-capture system in the course <strong>“Martial Arts and Motion Capture” (GAME 294)</strong> at Arizona State University, <strong>run by <a href="https://search.asu.edu/profile/1795222">Pavan Turaga</a></strong> and <strong>recorded by <a href="https://search.asu.edu/profile/215415">Assegid Kidane</a></strong>. The two performers' captured clips are used here as the source material for the editing techniques below; the cut, the cameras and the faces are authored in Strata.</div>

<div class="note"><strong>Where this picks up.</strong> The scene (two rigged VRoid characters carrying the two captured clips, a bamboo hut, a floor, lighting, four cameras and a 37-shot sequence) is built in <a href="martial-arts-dojo.html">the dojo tutorial</a>, Part 2 — start there if you want to build it. The finished, uncut scene is <a href="../../#repo=tejaswigowda/test1&amp;file=sparring.json&amp;branch=main"><code>sparring.json</code></a> in the <code>tejaswigowda/test1</code> repo; open it and paste each block below into the <strong>Shell</strong> tab. The fighters are labelled <code>#f1</code> and <code>#f2</code> and carry the clips <code>st1_1072026Skeleton</code> and <code>st2_1072026Skeleton</code>, 170.17 s each. Every block is one undoable step.</div>

<h2><span class="step">1</span> Register the pair</h2>

<p class="lede">The two clips were captured together, in <strong>one shared world frame</strong>: each fighter's root motion already says where they stand relative to the other at every moment. Move or retime one fighter alone and that relationship breaks and the bodies overlap. So the pair is registered as a single editable <strong>group</strong>, and every edit applies to both fighters at once.</p>

<pre><code>const sparring = $M.group('sparring', ['#f1', '#f2']);&#10;sparring.collision();     // baseline: the full 170 s capture</code></pre>

<p>The collision report measures the hip-to-hip distance on the floor over the timeline and flags anything under 0.6 m, a reasonable floor for non-contact sparring. For the full capture the closest the two ever get is <code>0.80 m</code>: this is <strong>non-contact</strong> sparring — a strike that should read as connecting has to be sold by the cut, not by the geometry.</p>

<h2><span class="step">2</span> Find the exchanges</h2>

<p class="lede">170 seconds is too long, and the middle of it is empty. Measuring where the two come close together, the exchanges are front-loaded — ten of them between 2.6 s and 43.2 s — then there is <em>nothing</em> from 43.2 s to 98.5 s, then they resume and thin out. Padding each cluster by −1.0 s before and +1.2 s after, and merging gaps under 0.4 s, gives eight spans:</p>

<table>&#10;		<tr><th>#</th><th>in</th><th>out</th><th>dur</th><th>closest</th></tr>&#10;		<tr><td>E01</td><td>1.60</td><td>9.00</td><td>7.40 s</td><td>0.94 m</td></tr>&#10;		<tr><td>E02</td><td>14.60</td><td>22.10</td><td>7.50 s</td><td>0.96 m</td></tr>&#10;		<tr><td>E03</td><td>30.80</td><td>44.40</td><td>13.60 s</td><td>0.80 m</td></tr>&#10;		<tr><td>E04</td><td>97.50</td><td>103.40</td><td>5.90 s</td><td>1.11 m</td></tr>&#10;		<tr><td>E05</td><td>104.80</td><td>110.80</td><td>6.00 s</td><td>0.93 m</td></tr>&#10;		<tr><td>E06</td><td>113.70</td><td>117.60</td><td>3.90 s</td><td>1.08 m</td></tr>&#10;		<tr><td>E07</td><td>134.70</td><td>140.60</td><td>5.90 s</td><td>1.10 m</td></tr>&#10;		<tr><td>E08</td><td>158.40</td><td>161.10</td><td>2.70 s</td><td>1.17 m</td></tr>&#10;	</table>

<p>That drops <strong>44.4 – 97.5 s (53.1 s)</strong> and keeps <strong>52.9 s</strong>, 31% of the source. Widen the handles if you want it longer, but don't pad back toward the lull. One fighter covers noticeably more floor than the other (91.5 m against 78.3 m): the more mobile fighter is characterisation you get for free, so favour it when you pick shots.</p>

<h2><span class="step">3</span> Cut it — as data</h2>

<p class="lede">A cut here is not a re-bake. It is an <strong>edit list</strong>: eight spans stored on the timeline, a few hundred bytes. The captured clips are only ever read.</p>

<pre><code>sparring.splice([&#10;  [1.6, 9.0], [14.6, 22.1], [30.8, 44.4], [97.5, 103.4],&#10;  [104.8, 110.8], [113.7, 117.6], [134.7, 140.6], [158.4, 161.1],&#10;].map(([from, to]) =&gt; ({ from, to })), { blend: 0.25 });&#10;&#10;sparring.asCommand();     // the declarative form of this cut&#10;sparring.table();         // each span with its start and length on the new clock</code></pre>

<p>The <strong>blend is mandatory</strong>. Over a 0.25 s window at every cut, each rotation is slerped from the outgoing pose to the incoming one, and the floor position is offset so the pair's centre continues from where it was — otherwise the bodies pop or teleport at every join. That offset is computed from the pair's centre and applied to <em>both</em> fighters, so how far apart they stand survives the cut.</p>

<div class="note"><strong>Why you can't edit one fighter alone.</strong> <code>$S('#f1').play('st1_1072026Skeleton', { from: 1, to: 5 })</code> is refused, because it would desynchronise the pair. Per-fighter timing (<code>timeOffset</code>, <code>speedOf</code>) needs an explicit <code>sparring.breakRegistration()</code>, which warns what you lose (they can clip through each other) and is undoable.</div>

<h2><span class="step">4</span> Check every frame</h2>

<p class="lede">No renderer will tell you the fighters now overlap. The collision report runs over the <em>edited</em> timeline:</p>

<pre><code>const report = sparring.collision();&#10;report.min;          // 0.741&#10;report.ok;           // true: no span under 0.6 m&#10;report.spans;        // the closest approach inside each span</code></pre>

<p>The cut's closest approach, <code>0.74 m</code>, is a little <em>closer</em> than the capture's own <code>0.80 m</code>, and it sits at the start of E07 (44.4 s on the new clock), inside the blend window. The blend interpolates both fighters' positions, so it can bring them nearer than either source span does; that is exactly the sort of thing this check exists to catch. If a span ever reports under 0.6 m, widen the blend or move the cut point.</p>

<h2><span class="step">5</span> Put the cameras on the new timeline</h2>

<p class="lede">The four cameras' keys, and the Render tab's 37-shot sequence, were cut against the 170 s source. <code>remapShots()</code> moves the camera keys: an event that lies wholly inside one kept span is moved to the cut's clock; anything else is dropped and reported.</p>

<pre><code>const r = sparring.remapShots();&#10;r.kept; r.dropped;                 // 396 kept, 964 dropped (the keys that straddle a cut or fall in the lull)&#10;editor.timeline.toJSON().duration; // 52.9</code></pre>

<p>The Camera Sequence in the Render tab is a separate list of <em>which camera is live when</em>. Move it onto the same clock: for each span, the shot that was live when the span began opens it, and any shot that began inside the span moves with it.</p>

<pre><code>(async () =&gt; {&#10;  const { edlTable } = await import('./intelligence/motionEdit.js');&#10;  const g = editor.timeline.group('sparring');&#10;  const spans = edlTable(g.edl).filter(r =&gt; !r.hold);&#10;  const shots = scene.userData.renderShots.slice().sort((a, b) =&gt; a.at - b.at);&#10;  const next = new Map();&#10;  for (const r of spans) {&#10;    const open = shots.filter(s =&gt; s.at &lt;= r.from).pop();               // the shot live as the span begins&#10;    if (open) next.set(+r.outStart.toFixed(3), { ...open, at: +r.outStart.toFixed(3) });&#10;    for (const s of shots) if (s.at &gt; r.from &amp;&amp; s.at &lt; r.to) {&#10;      const at = +(r.outStart + (s.at - r.from) / r.speed).toFixed(3);&#10;      next.set(at, { ...s, at });&#10;    }&#10;  }&#10;  scene.userData.renderShots = [...next.values()].sort((a, b) =&gt; a.at - b.at).map((s, i) =&gt; ({ ...s, id: 'shot-' + i }));&#10;})();</code></pre>

<p>The Shell does not print what an async block returns; check <code>scene.userData.renderShots.length</code> afterwards (37 shots become 18, the last at 50.2 s). This block assigns the list directly, so it is not on the undo stack; to go back, reload the scene or re-run the shot list from the dojo tutorial. Open the <strong>Render</strong> tab to see the sequence on the 52.9 s timeline.</p>

<h2><span class="step">6</span> Give them somewhere to look</h2>

<p class="lede">Two people watching each other for 53 seconds: most of the acting is <strong>where they look</strong>, and <strong>not looking dead</strong>. Both are timeline data. A gaze key whose target is a selector <em>follows</em> that fighter as they move; the eyes lead and the head lags, and past the eyes' range the head takes over, so there are no doll eyes.</p>

<pre><code>const A = $S('#f1'), B = $S('#f2');&#10;A.gaze(0, '#f2', { duration: 0 });&#10;B.gaze(0, '#f1', { duration: 0 });&#10;&#10;// a look away and back between exchanges (times on the cut's clock)&#10;for (const t of [6.4, 14.2, 28, 34.4, 40.2, 44.1])&#10;  A.gaze(t, 'away', { duration: 250, head: 0.2 }).gaze(t + 0.9, '#f2', { duration: 300 });&#10;for (const t of [6.9, 14.7, 28.6, 34.9, 40.6, 44.6])&#10;  B.gaze(t, 'away', { duration: 250, head: 0.2 }).gaze(t + 0.9, '#f1', { duration: 300 });</code></pre>

<p>Measured on this cut: wherever the other fighter is inside the eyes' range, the eyes sit within about 1° of their head, and sampling both faces costs about 0.6 ms per frame. Then add the idle layer:</p>

<pre><code>A.face.idle({ seed: 11 });     // a seeded blink, a faint breath, a little gaze micro-noise&#10;B.face.idle({ seed: 12 });</code></pre>

<p>The idle layer is <strong>seeded</strong> — the same scene renders the same blinks on every run — and it is an underlayer: it never becomes keys, <code>A.face.idle(false)</code> removes it, and the keys you authored are untouched. A held expression (<code>hold: true</code>) keeps blinks out of it. The same keys are in the <strong>Customize</strong> tab (<em>Face performance</em>) and the <strong>Animations</strong> tab's code panel; see <a href="author-a-face.html">Authoring a face</a> for expression keys and the details.</p>

<h2><span class="step">7</span> Dress them, and let the faces act</h2>

<p class="lede">Captured bodies carry no performance in their faces, and the two fighters arrive in unrelated clothes. Three passes fix that: <strong>costume</strong>, an <strong>expression arc</strong> that follows the exchanges, and <strong>light and camera</strong> to match. None of it touches a vertex, a skin weight or the skeleton, so the capture still drives both rigs exactly.</p>

<p><strong>Costume.</strong> One fighter becomes a black gi, the other a white gi, both barefoot, so they read apart from any camera:</p>

<pre><code>(async () =&gt; {&#10;  const { CustomizeCommand } = await import('./commands/CustomizeCommand.js');&#10;  const dress = (id, top, bottom, name) =&gt; editor.execute(new CustomizeCommand(editor, editor.scene.getObjectByName(id), [&#10;    { op: 'recolor', target: 'part:shirt',  color: top },&#10;    { op: 'recolor', target: 'part:bottom', color: bottom },&#10;    { op: 'hide',    target: 'part:shoes' },&#10;  ], name));&#10;  dress('f1', '#262833', '#1c1d26', 'f1: black gi, barefoot');&#10;  dress('f2', '#ece7dc', '#e2dccd', 'f2: white gi, barefoot');&#10;})();</code></pre>

<p><strong>An expression arc.</strong> Faces change over time, and every change is a key you can see and move in the <strong>Animations</strong> tab (and edit from <strong>Customize → Face performance</strong>). Three held looks carry the whole piece — <em>focus</em> at rest, <em>exert</em> for whoever is attacking, <em>alert</em> for whoever is defending — switched per exchange. Times are on the cut's clock, so each exchange starts where <code>sparring.table()</code> says it does:</p>

<pre><code>const A = $S('#f1'), B = $S('#f2');&#10;const base = { browInnerUp: 0, eyeWideLeft: 0, eyeWideRight: 0, mouthSmileLeft: 0, mouthSmileRight: 0, mouthFrownLeft: 0, mouthFrownRight: 0, jawOpen: 0 };&#10;const LOOK = {&#10;  focus: { ...base, browDownLeft: 0.2,  browDownRight: 0.2,  eyeSquintLeft: 0.12, eyeSquintRight: 0.12, mouthPressLeft: 0.18, mouthPressRight: 0.18 },&#10;  exert: { ...base, browDownLeft: 0.45, browDownRight: 0.45, eyeSquintLeft: 0.3,  eyeSquintRight: 0.3,  mouthPressLeft: 0.35, mouthPressRight: 0.35, mouthFrownLeft: 0.12, mouthFrownRight: 0.12, jawOpen: 0.04 },&#10;  alert: { ...base, browDownLeft: 0.05, browDownRight: 0.05, browInnerUp: 0.28, eyeWideLeft: 0.2, eyeWideRight: 0.2, mouthPressLeft: 0.15, mouthPressRight: 0.15 },&#10;};&#10;const look = (who, name, t, ms = 400) =&gt;&#10;  who.face.keyAt(t, { shapes: { ...LOOK.focus, ...LOOK[name] }, duration: ms, easing: 'ease-out', hold: true });&#10;&#10;A.face.keyAt(0, { shapes: LOOK.focus, duration: 0, hold: true });&#10;B.face.keyAt(0, { shapes: LOOK.focus, duration: 0, hold: true });&#10;&#10;// [start, length, who leads] for each span, on the cut's clock&#10;const rounds = [[0, 7.4, A], [7.4, 7.5, A], [14.9, 13.6, A], [28.5, 5.9, A], [34.4, 6.0, B], [40.4, 3.9, A], [44.3, 5.9, A], [50.2, 2.7, 'both']];&#10;for (const [t, len, lead] of rounds) {&#10;  const att = lead === 'both' ? [A, B] : [lead], def = lead === 'both' ? [] : [lead === A ? B : A];&#10;  att.forEach(f =&gt; look(f, 'exert', t + 0.2));&#10;  def.forEach(f =&gt; look(f, 'alert', t + 0.2));&#10;  [A, B].forEach(f =&gt; look(f, 'focus', t + len + 0.8, 600));      // settle between exchanges&#10;}&#10;// the closest approach (E03): the defender flinches, then recovers&#10;B.face.applyPreset('surprise', 20.5, { duration: 150 });&#10;look(B, 'alert', 22.7, 500);</code></pre>

<p>Presets expand to explicit per-shape keys, so a flinch like <code>surprise</code> is just more keys. The cut removes the long lull, so the quiet beat that follows it in the uncut capture is gone; to end on a bow, finish with a held smile once the last exchange lands: <code>A.face.applyPreset('smile', 52.1, { duration: 600, hold: true })</code> on both fighters, then <code>A.gaze(52.4, 'away', { duration: 400 })</code>. The step 6 gaze keys and idle layer sit underneath all of this unchanged.</p>

<div class="note"><strong>The committed scene.</strong> <code>sparring.json</code> in the repository carries this look on the <em>uncut</em> capture, so its expression keys are on the source clock (the eight spans start at 1.6, 14.6, 30.8, 97.5, 104.8, 113.7, 134.7 and 158.4 s). If you cut the scene as in step 3, use the cut-clock times above.</div>

<p><strong>Light and camera.</strong> Use the same pass as the dojo: sky fill 0.85 → 0.6, sun key → 3.1, cool rim → 1.2, fog density → 0.02 (the commands are in <a href="martial-arts-dojo.html">Build the dojo scene</a>, step 10), then bring the wide camera in. This keeps each wide shot's look direction and just moves the camera closer and lower:</p>

<pre><code>(async () =&gt; {&#10;  const { editCameraTrack } = await import('./intelligence/cameraMoveEdit.js');&#10;  const cam = editor.scene.getObjectByName('cam-wide');&#10;  editCameraTrack(editor, cam, 'Camera: tighten cam-wide', track =&gt; {&#10;    for (const ev of track.events) {&#10;      const p = ev.args.props;&#10;      if (ev.op !== 'animate' || !p?.to?.position) continue;&#10;      const L = p.lookAt, q = p.to.position;&#10;      p.to.position = [L[0] + (q[0] - L[0]) * 0.9, 1.7, L[2] + (q[2] - L[2]) * 0.9];   // 10% closer, eye-level-ish&#10;      p.lookAt = [L[0], 1.02, L[2]];&#10;      p.fov = 38;                                                                       // was 42&#10;    }&#10;  });&#10;})();</code></pre>

<p>Run it once (it is not idempotent), and then <strong>repeat the step 4 frame check</strong> — a tighter lens is exactly what pushes a fighter's hand or foot out of frame. On this capture, every wide-shot frame at 16:9 still holds both fighters' head, hips, hands and feet.</p>

<h2><span class="step">8</span> Render it and save</h2>

<ol class="steps">&#10;		<li>Press <strong>Play</strong> in the Animations tab: the timeline is 52.9 s, both fighters move, the cameras cut, and the eyes follow.</li>&#10;		<li>Open the <strong>Render</strong> tab and render the camera sequence to video. Keep the tab in the foreground while it renders — browsers throttle hidden tabs, which makes frames stall.</li>&#10;		<li>In the <strong>Git</strong> tab, set <strong>Scene file</strong> to a new name such as <code>sparring-cut.json</code> and press <strong>Commit Scene</strong>. The scene is saved compactly (one line, animation numbers quantized), and what is stored is the full capture plus the edit list, the camera keys and the face keys. <code>sparring.json</code> itself stays the uncut capture.</li>&#10;		<li>Undo, or <code>sparring.clear()</code>, brings back the full 170.17 s capture exactly — the clips were never modified.</li>&#10;	</ol>

<div class="note"><strong>Honest limits.</strong> A cut is built from what was captured: it can drop, join and re-time, but it cannot invent a contact that was never there. The shot-remap blocks drop camera keys that straddle a cut, so look through the result before you render. The eyes' gaze on a moving target is exact where the geometry allows it and is clamped to a believable range where it does not.</div>

<section class="credits" id="credits">&#10;		&#10;		<h2>Credits and licences</h2>&#10;		<h3>People</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/">Tejaswi Gowda</a> <span class="lic">(script)</span></li>&#10;			<li><a href="https://search.asu.edu/profile/1795222">Pavan Turaga</a> <span class="lic">(asset)</span></li>&#10;			<li><a href="https://search.asu.edu/profile/215415">Assegid Kidane</a> <span class="lic">(asset)</span></li>&#10;		</ul>&#10;		<h3>Assets</h3>&#10;		<ul>&#10;			<li><a href="https://search.asu.edu/profile/1795222">Sparring capture: clips st1_1072026Skeleton and st2_1072026Skeleton (170.17 s)</a>: Recorded with an OptiTrack system in &quot;Martial Arts and Motion Capture&quot; (GAME 294), Arizona State University; course run by Pavan Turaga, recorded by Assegid Kidane; the two performers are not named <span class="lic">Licence: not stated.</span></li>&#10;		</ul>&#10;		<h3>Tools</h3>&#10;		<p>None used.</p>&#10;	</section>
