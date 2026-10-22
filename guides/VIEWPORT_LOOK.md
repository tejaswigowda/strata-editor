# Viewport look, frame guides and small UI polish

> Part of the [Strata documentation](../README.md#documentation). See also: [Toon look](TOON_LOOK.md) · [Roadmap and status](ROADMAP.md) · [Animation](ANIMATION.md)

Everything here is **viewport-only** and **off by default** (except the empty-state hints, the play-bar shot chip and saved panel sizes). None of it is saved in the scene, and none of it changes what the Render tab exports.

## Frame and Look buttons

Two small buttons sit at the bottom right of the viewport, left of the shading select. Each opens a popover (Escape closes it and returns focus to the button; every control has an `aria-label` and is keyboard operable). Settings are kept in `localStorage` under `strata/viewLook`.

### Frame (letterbox + safe guides)

* **Aspect**: Off, 16:9, 2.39:1, 1.85:1, 4:3, 1:1, 9:16, or **Match render**. Bars (letterbox or pillarbox) cover the viewport outside the chosen frame.
* **Match render** follows the Render tab's *Resolution* select (for example 1080 x 1080 gives 1:1) and updates live when you change it. With no Render tab size it falls back to 16:9. The 360 resolution is not used.
* **Title / action safe guides** draw dashed rectangles at 90 % (title) and 93 % (action) of the frame, plus a centre cross. With the frame Off they apply to the whole viewport.
* It is a DOM overlay with `pointer-events: none`, so picking, orbiting and gizmos are unaffected. It does **not** crop the viewport render or the exports; the Render tab still renders its full chosen resolution.

### Look (vignette, grain, glow, outlines)

* **Vignette**: a radial darkening (CSS gradient), intensity slider.
* **Film grain**: a tiny tiled noise texture, nudged a few times a second (static with `prefers-reduced-motion`), blended with `overlay`.
* **Glow**: the viewport has no bloom pass, and a real bloom would need a full-resolution post chain, so this is an **approximation**: the frame is copied into a 1/16-size canvas (about 30 fps at most) and stretched back over the viewport with a `screen` blend. The result is a soft diffusion glow, not a thresholded HDR bloom. It reads the on-screen canvas, so it also works with "as render" shading.
* **Hide toon outlines**: today MToon / toon outline passes (materials flagged `isOutline`, extra draw groups) are **always drawn** in the viewport, in "solid" shading as well as "as render", so there is nothing to switch on. The toggle goes the other way: it hides the outline passes in the viewport for a cleaner view while editing. The materials are only set `visible = false` for the duration of the draw and put back straight after (the WebGL stand-ins follow). "As render" shading ignores the toggle so that it still matches the export.
* **Apply in present mode**: unticked by default (see below). **Reset** returns every setting, including the frame, to its default.

### When the overlays do not draw

* **While the Render tab renders** a video or still (the viewport is paused with `pauseViewportRendering`) the overlay is hidden and the outline hide is not applied; it returns when rendering finishes. The Render tab draws through its own offscreen renderer, so exported frames never contain any of this.
* **In present mode** (`present=true`) nothing draws unless *Apply in present mode* is ticked. Decision: the look is a personal viewing preference stored in this browser, not part of the scene, so a shared link shows the scene the way every other viewer sees it unless you opt in.

## Play bar

While the timeline plays, the play bar replaces the menu bar (the Strata logo stays at the left and the buttons start after 88 px).

* **Shot chip** next to the clock: the camera at the playhead from the Render tab's camera sequence (`scene.userData.renderShots`, the last shot whose start is at or before the playhead, as the renderer picks it). With no shots, or a deleted shot camera, it shows the active / followed viewport camera, for example "Edit Camera".
* **Auto-fade**: about 3 seconds into playback, while the pointer is away from the bar, the bar dims to a low-opacity strip. Moving the pointer over the top strip, hovering or focusing the bar, or pausing restores it.

## Empty states

Short hints with a copyable example command, shown only while there is nothing yet and dismissible with the x (remembered in `localStorage` as `strata/hint/<id>`):

* **Scene outliner**, empty scene: drop a file, or add a box from the Shell.
* **Render tab**, no shots: what a shot is, and a command that adds a camera.
* **Shell tab** already had a first-run line (JavaScript works without the AI); it now ends with two clickable examples (`help`, `listSelectors()`) that go away after the first command.

## Theme

Settings > **Theme**: Auto, Light or Dark, applied immediately and remembered (`strata/theme`).

* **Auto is the existing behaviour**: Strata's stylesheet has always been dark-only, so Auto looks exactly as before. It does not follow the operating system.
* **Dark** pins that look. **Light** sets `html[data-theme="light"]` and restyles the chrome (menu bar, sidebar, tabs, buttons, inputs, outliner, dialogs, the popovers above).
* Limits: the Shell terminal, the timeline strip, Monaco code editors and some inline-styled panels intentionally stay dark in Light, and the viewport clear colour still follows the OS colour scheme.

## Saved panel sizes

Dragging the sidebar divider stores the sidebar width (right or left dock) and the bottom-dock height (`sidebar-width`, `sidebar-height`); both are restored on load. Restored values are clamped (width at least 335 px and leaving 240 px for the viewport; height at least 150 px and leaving 80 px above), and re-clamped when the browser window is resized, without overwriting the saved value, so enlarging the window brings the saved size back. The same clamp applies while dragging.

## Where the code is

`ViewLookLogic.js` (pure logic: presets, settings, gating, outline swap), `ViewLook.js` (buttons, popovers, overlay), `ShotAt.js`, `PanelSizes.js`, `Theme.js`, `EmptyHint.js`; hooks in `Viewport.js`, `PlayBar.js`, `Sidebar.Render.js` (publishes `editor.renderOutput`), `Sidebar.Scene.js`, `Shell.js`, `Sidebar.Settings.js`, `Editor.js`, `Resizer.js`, `Menubar.Status.js`. Node tests: `docs/editor/js/__tests__/viewLook.test.mjs` and `lookAndFeel.test.mjs`.
