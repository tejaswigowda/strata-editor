# 3DOM / `$S` Specification — v0.1

Status: **Draft, stable surface.** The v0.x line may add ops and selectors but
will not remove or repurpose the ones below without a major-version bump.

3DOM ("three-D Object Model") is a runtime-free model for **addressing** and
**editing** a three.js scene graph. `$S` is its jQuery-style binding. The model
knows nothing about any editor: every mutation is routed through a **Host**.

---

## 1. Scope & principles

- **Deterministic.** Selectors and auto-labelling are pure functions of the
  scene graph at call time. No heuristics that vary between runs.
- **three.js is the only hard dependency**, and it is a *peer* — the host page
  supplies it. Everything else is internal abstractions.
- **Facts, not guesses.** Auto-labelling emits classes only for things it can
  measure (type, colour, region, shape, symmetry, size rank, material name,
  name stem). It never invents semantics.
- **All edits are undoable** through the Host.

---

## 2. Binding: `createS`

```js
const $S = createS( sceneOrHost, opts );
```

- `sceneOrHost` — a `THREE.Object3D` root, or a **Host** (§6).
- `opts` — when a bare scene is given: `{ onChange?, historyLimit? }` for the
  built-in `DefaultHost`.
- Returns a callable `$S(selector) → ChainableSet`, with attached helpers:
  `.host` `.scene` `.autoLabel(opts?)` `.op(json)` `.ops(list)` `.undo()`
  `.redo()` `.query(selector)`.

`selector` is either a **selector string** (§3) or an **array of nodes**.

---

## 3. Selector grammar

A CSS subset, matched against the scene graph:

| Form        | Meaning                                                            |
| ----------- | ----------------------------------------------------------------- |
| `type`      | object type via `is*` flags: `mesh` `group` `light` `camera` `sprite` `line` `points` `bone` `object3d`. An unknown bare token matches **nothing** (not everything). |
| `.class`    | node has this class (author-set on `userData.classes`, or auto-labelled). |
| `#id`       | `userData.label === id`, falling back to `node.name === id`.       |
| `.a.b`      | compound — has class `a` AND class `b`.                            |
| `A B`       | descendant combinator.                                            |
| `A > B`     | child combinator.                                                 |
| `*`         | every node in scope.                                              |
| `:selected` / `:lasso` | resolves to the **host app's live selection**, not a graph query. On a bare `DefaultHost` this is empty. |

No union (`,`), attribute or state pseudos in v0.1.

Class names are normalised: lower-cased, spaces → `-`, non-`[a-z0-9-]` stripped.

---

## 4. Auto-labelling: `autoLabel(root, opts?)`

Two phases, both idempotent:

1. `indexSubtree(root, force)` — compute per-node **descriptors** into
   `userData.descriptors` (+ a geometry hash for symmetry pairing). Skips nodes
   already indexed for the same geometry unless `opts.force === true`.
2. `deriveAllClasses(root)` — write `userData.classes` from type + descriptors +
   name stem.

Class sources (all deterministic):

- **Type:** `mesh` `light` `camera` `group`, plus concrete light/camera/mesh
  subtypes (`point-light`, `perspective-camera`, `skinned-mesh`, …).
- **Name stem:** `"Chair 1"`,`"Chair 2"` → `.chair` (trailing index dropped).
  Auto-generated names (`Object_12`, `mesh_0`, …) are ignored.
- **Colour:** base colour name → `.red` `.blue` …
- **Region** (relative to parent bounds): `.left/.right/.center`,
  `.top/.bottom`, `.front/.back`.
- **Shape:** `.elongated` `.flat` `.blocky` `.thin`.
- **Symmetry:** `.paired`, `.pair-left`/`.pair-right`.
- **Orientation:** `.vertical` `.horizontal`.
- **Size rank:** `.largest` `.medium` `.smallest`.
- **Material name:** decoded material name → class.

`role` (`leaf`/`group`) is computed but deliberately **not** emitted as a class.

---

## 5. Op set

Ops are the closed set of undoable mutations. Chain methods and op-JSON both
route here; every op resolves its selector, builds Host commands, and executes
them as one undoable step (a `multi` when more than one command results).

| Op            | Chain method                    | Guard / clamp                                   |
| ------------- | ------------------------------- | ----------------------------------------------- |
| `recolor`     | `.recolor(color)`               | clone-on-write for **shared** materials; textured materials warned, not silently overwritten. |
| `scale`       | `.scale(factor, axis?)`         | factor clamped to `[0.1, 10]`.                  |
| `move`        | `.move(x, y, z)`                | per-axis delta clamped `±100`; `y` grounded ≥ 0.|
| `rotate`      | `.rotate(axis, degrees)`        | degrees clamped `±360`.                          |
| `delete`      | `.delete()`                     | skips merged-mesh sub-nodes and detached nodes. |
| `duplicate`   | `.duplicate(x?, y?, z?)`        | bakes world transform, applies offset.          |
| `setMaterial` | `.setMaterial(props)`           | builds a `MeshStandardMaterial` from props.     |
| `setOpacity`  | `.setOpacity(v)`                | sets `transparent` as needed.                    |
| `setVisible`  | `.setVisible(v)`                | —                                               |
| `wireframe`   | `.wireframe(on?)`               | —                                               |
| `castShadow`  | `.castShadow(v?)`               | object prop.                                     |
| `receiveShadow`| `.receiveShadow(v?)`           | object prop.                                     |
| `metalness`   | `.metalness(v)`                 | material prop.                                   |
| `roughness`   | `.roughness(v)`                 | material prop.                                   |

`OP_SET` exports the canonical op-name list.

### Op-JSON contract

```json
{ "op": "recolor", "selector": ".wheel", "args": { "color": "#111" } }
```

- `op` — required, one of `OP_SET`.
- `selector` — required; a selector string **or** an array of nodes.
- `args` — op-specific. Common aliases are accepted (`factor`/`value`,
  `x`/`dx`, `degrees`/`value`, `on`/`value`). See `OP_SCHEMA`.

`dispatchOp(host, json)` runs one; `dispatchOps(host, list)` runs many in order
and returns per-op results `{ success, message? }`.

---

## 6. Host contract

The Host is the **only** injection seam between the model and a runtime. The ops
layer never imports a concrete command class — it calls Host **factories**.

A Host is any object providing:

```ts
interface Host {
  scene: THREE.Object3D;
  execute( command ): void;      // apply + record for undo
  undo(): void;
  redo(): void;
  multi( commands[] ): command;  // group into one undoable step
  notify( kind: string, payload? ): void;
  // command factories — each returns { name, execute(), undo() }
  setPosition, setRotation, setScale, setValue,
  setColor, setMaterialColor, setMaterialValue, setMaterial,
  addObject, removeObject
}
```

- **`DefaultHost`** (built-in) implements all of this over plain `Object3D`s with
  its own bounded undo/redo stack and an `onChange` callback. This is what you
  get when you pass a bare scene.
- A **host app** (e.g. Strata) passes its own object mapping the factories to its
  real commands and `execute`/`undo`/`redo`/`notify` onto its command bus and
  signals, so 3DOM edits participate in the app's history and UI updates.

`resolveHost(x, opts)` returns `x` unchanged if it already looks like a Host
(has `.execute` and `.scene`), else wraps it in a `DefaultHost`.

---

## 7. three.js peer resolution

The library imports `three` as a bare specifier. Consumers provide it via
bundler resolution, an import map, or a global. `setThree(instance)` /
`getThree()` allow overriding the resolved instance (ES-module live binding, so
importers see the update).

---

## 8. Versioning

- **v0.1** — this document. Selector grammar (§3), auto-label sources (§4), op
  set (§5), op-JSON contract (§5), and Host contract (§6) are the stable surface.
- Additions (new ops, new selector forms) land as minor versions. Removals or
  behavioural changes to the above require a major bump.

MIT © Tejaswi Gowda.
