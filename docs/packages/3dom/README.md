# @tejaswigowda/3dom

**jQuery for 3D.** Address and edit *any* three.js scene with CSS-like selectors,
deterministic auto-labelling, and undoable ops — in one line:

```js
$S('.wheel').recolor('#111').scale(1.2);
$S.undo();
```

No editor. No framework. No build step required. Just three.js (a **peer**
dependency) and this.

- **Selectors** — query the scene graph like the DOM: `mesh`, `.red`, `#Body`,
  `.wheel:visible`, `light, camera`.
- **Auto-labelling** — derive stable classes from geometry, colour, material and
  name so `.red`, `.box`, `.wheel` *just work* on scenes you didn't author.
- **Undoable ops** — every mutation goes through a **Host**. Out of the box you
  get a built-in undo/redo stack; drop in your app's command system to reuse it.
- **Tiny** — ~24 kB minified, three stays external.

---

## Install

Straight from a CDN — no build, no publish step. jsDelivr serves the repo's
`dist/` directly from GitHub. `three` is a **peer**, so the page brings its own via
the same import map. Copy this into your page's `<head>`:

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/build/three.module.js",
  "@tejaswigowda/3dom": "https://cdn.jsdelivr.net/gh/tejaswigowda/threejs.editor.enhanced@02e7854aee6a391ec455004317eeb4de108e6aed/docs/packages/3dom/dist/3dom.esm.min.js"
} }
</script>
<script type="module">
  import { createS, autoLabel } from '@tejaswigowda/3dom';
  // autoLabel(scene); const $S = createS(scene);
</script>
```

Pin to a commit (as above) or a tag (`@v0.1.0`) for an immutable, long-cached URL.
`@main` also works but is mutable and cached for up to a week. The Statically CDN
uses the same path shape:

```
jsDelivr (GitHub):   https://cdn.jsdelivr.net/gh/tejaswigowda/threejs.editor.enhanced@02e7854aee6a391ec455004317eeb4de108e6aed/docs/packages/3dom/dist/3dom.esm.min.js
Statically (GitHub): https://cdn.statically.io/gh/tejaswigowda/threejs.editor.enhanced/02e7854aee6a391ec455004317eeb4de108e6aed/docs/packages/3dom/dist/3dom.esm.min.js
```

> **Strata itself consumes the library this exact way** — the editor's import map
> in `docs/index.html` maps `@tejaswigowda/3dom` to the pinned jsDelivr URL, and
> `docs/editor/js/intelligence/strata3dom.js` imports it by bare specifier.

---

## 60-second example (a bare three.js page)

```js
import * as THREE from 'three';
import { createS, autoLabel } from '@tejaswigowda/3dom';

const scene = new THREE.Scene();
// ... add your meshes ...

autoLabel( scene );            // derive .red / .box / .wheel / … classes
const $S = createS( scene );   // bind $, with its own undo history

$S('.wheel').recolor('#ff3b3b').scale(1.2);
$S('mesh').rotate('y', 30);
$S('.roof').setVisible(false);

$S.undo();   // built-in, reversible
$S.redo();
```

Open [`examples/bare.html`](examples/bare.html) for a full, self-contained page
(no editor, no bundler) that does load → `autoLabel` → `$S('.wheel').recolor()`
with the library's own undo.

---

## The selector set

| Selector          | Matches                                          |
| ----------------- | ------------------------------------------------ |
| `mesh` `light` …  | by object type (`mesh` `group` `light` `camera` `sprite` `line` `points` `bone` `object3d`) |
| `.red` `.wheel`   | by class (author-set or auto-labelled)           |
| `#Body`           | by id — `userData.label`, falling back to `.name`|
| `.a.b`            | compound (AND)                                   |
| `A B`             | descendant combinator                            |
| `A > B`           | child combinator                                 |
| `*`               | everything                                       |
| `:selected`       | host app's live selection (editor-bound)         |

See [`SPEC.md`](SPEC.md) for the full grammar, auto-label rules and op contract.

---

## The chain

Read (non-mutating): `.nodes` `.length` `.count` `.exists` `.names` `.first`
`.last` `.classes()` `.each(fn)` `.toArray()`
Traverse (new set): `.not(sel)` `.parent()` `.children()` `.filter(pred)`
Mutate (returns `this`, undoable): `.recolor()` `.scale()` `.move()` `.rotate()`
`.delete()` `.duplicate()` `.setMaterial()` `.setOpacity()` `.setVisible()`
`.wireframe()` `.castShadow()` `.receiveShadow()` `.renderOrder()` `.metalness()`
`.roughness()`
Label: `.addClass()` `.removeClass()` `.editID(name)`
JSON ops: `.op(json)` `.ops([...])`

---

## Bring your own undo (host apps)

The ops layer never imports a command class — it calls **Host** factories. Pass a
scene and you get `DefaultHost` (built-in undo). Pass a Host and your app owns
history, notifications and execution:

```js
const $S = createS({
  scene,
  execute: ( cmd ) => editor.execute( cmd ),   // your command bus
  undo:    () => editor.undo(),
  redo:    () => editor.redo(),
  notify:  ( kind ) => signals[ kind ]?.dispatch(),
  // command factories → your real commands
  setMaterialColor: ( obj, hex ) => new SetMaterialColorCommand( editor, obj, hex ),
  // ...
});
```

This is exactly how the Strata editor consumes 3DOM: the library is the model,
Strata is a host.

---

## Licence

MIT © Tejaswi Gowda. three.js is a peer dependency under its own licence.
