---
slug: author-a-face
title: "Authoring a face: gaze and idle"
status: published
parent: tutorials
---

# Authoring a face: gaze and idle

<p class="tagline">Two characters watch each other for 53 seconds. Most of the acting is <strong>where they look</strong> and <strong>not looking dead</strong> — both are timeline data you can edit.</p>

<div class="note"><strong>The idea.</strong> A face is two keyed channels on the same track as the body clip: <em>expression</em> (continuous morph weights with easing and duration per key) and <em>gaze</em> (where the eyes and head aim), with a seeded <em>idle</em> layer underneath. They are versioned, diffable and agent-drivable like everything else. This is the animator's face — hand-keyed, on a stylized character — not a face-capture substitute.</div>

<div class="note"><strong>What you'll need.</strong> A scene with two rigged characters that carry face morph targets (ARKit-style blendshapes, as on VRoid / VRM models) and eye and head bones, each with a body clip on the timeline — for example a cut made in <a href="edit-captured-motion.html">Editing captured motion as data</a>. Everything is pasted into the <strong>Shell</strong> tab; nothing needs the viewport.</div>

<h2><span class="step">1</span> Make them look at each other</h2>

<p class="lede">A gaze key whose target is a selector <strong>follows</strong> that character as it moves; a point holds. Start both fighters on each other:</p>

<pre><code>const A = $S('#a'), B = $S('#b');&#10;A.gaze(0, '#b', { duration: 0 });&#10;B.gaze(0, '#a', { duration: 0 });</code></pre>

Eyes and head are separate. The `head` weight (default 0.35) is the share of the aim the head takes — `0` is a glance, higher is a turn. When the target changes, the **eyes lead and the head lags**: it starts 0.1 s later and takes 40% longer to arrive. Past about ±30° the eyes stop at their anatomical limit and the head takes the rest, so a target behind a character becomes a head turn, never doll eyes.

<h2><span class="step">2</span> Look away between exchanges</h2>

<p class="lede">A glance away and back is two keys. <code>'away'</code> is a fixed averted look (35° to the character's left, 10° down):</p>

<pre><code>for (const t of [6.4, 14.2, 28, 34.4, 40.2, 44.1])&#10;  A.gaze(t, 'away', { duration: 250, head: 0.2 }).gaze(t + 0.9, '#b', { duration: 300 });&#10;for (const t of [6.9, 14.7, 28.6, 34.9, 40.6, 44.6])&#10;  B.gaze(t, 'away', { duration: 250, head: 0.2 }).gaze(t + 0.9, '#a', { duration: 300 });&#10;&#10;A.gazeKeys();      // [{ index, time, target, head, duration, easing, label }]</code></pre>

Measured on a real 52.9 s cut: wherever the other fighter is inside the eyes' range, the eyes sit within about 1° of that fighter's head, and sampling the whole face costs about 0.6 ms per frame.

<h2><span class="step">3</span> Don't look dead: the idle layer</h2>

<p class="lede">Fully keyed faces read as corpses; real faces are never still. The idle layer adds a blink, a faint breath and a little gaze micro-noise:</p>

<pre><code>A.face.idle({ seed: 11 });&#10;B.face.idle({ seed: 12 });</code></pre>

<ul>&#10;		<li><strong>Seeded.</strong> The same scene renders the same blinks on every run and every machine.</li>&#10;		<li><strong>An underlayer.</strong> It is never baked into the keys; <code>A.face.idle(false)</code> removes it and every authored key is untouched.</li>&#10;		<li><strong>It never fights an authored beat.</strong> An authored value owns a shape it drives; a <em>held</em> beat (<code>hold: true</code>) keeps blinks and noise out of it.</li>&#10;	</ul>

<h2><span class="step">4</span> Add an expression, with timing</h2>

<p class="lede">Keys are continuous values with easing and duration — a slow fall and a hard snap are the same two keys with different timing:</p>

<pre><code>A.face.keyAt(20, { shapes: { browInnerUp: 1, eyeWideLeft: 1, eyeWideRight: 1 }, duration: 0 });   // snap to alarm&#10;A.face.keyAt(24, { shapes: { browInnerUp: 0, eyeWideLeft: 0, eyeWideRight: 0 }, duration: 2000, easing: 'ease-in-out' });   // slow fall&#10;&#10;B.face.applyPreset('focus', 30, { duration: 500, hold: true });   // a held beat&#10;A.face.keys();       // the explicit per-shape keys — a preset is never stored, only its values</code></pre>

A **preset expands to explicit keys** you can then edit, move or delete (`moveKey(i, …)`, `deleteKey(i)`).

<h2><span class="step">5</span> The same keys in the GUI</h2>

<ol class="steps">&#10;		<li>Open the <strong>Customize</strong> tab. Under <em>Expression</em>, tick <strong>Key at playhead</strong> (set a duration and an easing): the preset <em>Apply</em> button and the sliders now write keys that arrive at the playhead.</li>&#10;		<li>Under <em>Face performance</em>, pick a target and <strong>Key at playhead</strong> to key a gaze; tick <strong>Idle layer</strong> and set a seed. The key list (with ×) and the command text update live, whichever surface made the change.</li>&#10;		<li>Open the <strong>Animations</strong> tab: face and gaze keys are blocks on the character's row (a key arrives at the block's right edge) and the code panel shows them — edit the text and save to change the same keys.</li>&#10;		<li><strong>Undo</strong> is one stack for all of it.</li>&#10;	</ol>

<h2><span class="step">6</span> Reproduce it exactly</h2>

<pre><code>console.log(A.face.asCommand());    // the commands that rebuild this face byte for byte&#10;console.log(B.face.asCommand());</code></pre>

Same keys, same face, every run — no viewport needed, so an agent can author a performance deterministically. Morph weights, and the eye and head rotations, are baked into a glTF export by running the real sampler, so the file matches what you saw.

<div class="note"><strong>Honest scope.</strong> This is for stylized targets and for the face you want to <em>author</em>. Speech (audio-derived mouth shapes) is not built. And if a character's face was reshaped to a photo by Face bind, its morph targets are carried through that reshape untouched, so authored expressions on a strongly reshaped face are approximate — see the <a href="../../../guides/FACE_TRACK.md">authored-face guide</a> for the measured numbers.</div>

<section class="credits" id="credits">&#10;		&#10;		<h2>Credits and licences</h2>&#10;		<h3>People</h3>&#10;		<ul>&#10;			<li><a href="https://tejaswigowda.com/">Tejaswi Gowda</a> <span class="lic">(script)</span></li>&#10;		</ul>&#10;		<h3>Assets</h3>&#10;		<p>None used.</p>&#10;		<h3>Tools</h3>&#10;		<p>None used.</p>&#10;	</section>
