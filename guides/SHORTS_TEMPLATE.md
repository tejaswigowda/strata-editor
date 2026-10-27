# Shorts: the standard

Every short in the series (Pythagoras, (a + b)³, Hardy–Weinberg, surface area to volume, projectile, piston) meets this standard, and every new one starts from it. It has two halves: the scene file is **addressable**, and the tutorial states its **contract**.

## 1. Addressable: every object named and classed

Strata's first property is that every object has a name *an author chose*. An unnamed object cannot be reached by `$S('#id')`, targeted by an AI edit, named in a camera script or cited in a tutorial step; an object with a name but no class cannot be reached by `$S('.class')`, which is the operation the selector language exists for.

The rule, enforced in the editor (`docs/editor/js/intelligence/sceneLint.js`):

| Object | Violation |
|---|---|
| name | empty, `?`, or a default (`Mesh`, `Object3D`, `Group`, `Box`, `Mesh_3`, …) |
| name | the same name as another object (ids ignore case) |
| class | no author class in `userData.customClasses` |

Exempt: the scene root, and engine helpers whose name starts with `__` (the dark shadow behind each text label, edge outlines).

### The gate

- **`make(name, geometry|null, material, { classes, parent, position, rotation, scale })`** is the labelled way to create an object in the Shell. The name is required, not a default and unique in the scene, and at least one class is required; it throws otherwise. `geometry === null` makes a group.
- **`lint()`** returns the objects that are not addressable, as text; empty when all are.
- **`requireLabels(true)`** marks the scene (`scene.userData.requireLabels`). From then on `commitSceneToRepo()` refuses to upload the scene while `lint()` would report anything, with one error that counts and lists the violations. It throws immediately if the scene already has violations. Scenes that have not opted in (imported glTF, motion capture) are never blocked.

End every short's build with the class block and `requireLabels(true)`.

### Decorative parts: merge, or name them in the loop

Fifty-one anonymous grid lines buy nothing and break the property. Pick one per case:

- **merge** parts that are never addressed one by one into a single mesh with one name; or
- **name them where they are made**, with one template string in the loop: `` `gridX${i}` ``, `` `crankWeb${side}` ``, `` `trail45_${k}` ``.

Do not name objects in a later pass from their type or position: a name assigned afterwards from what the object *is* is inferred, not authored. (The four earliest shorts were retrofitted that way once, in a block at the end of their tutorials, because their builds predate the gate; a new short must not need it.)

### The class block

One table at the end of the build: the names a row covers, and the classes it gives. An object can match several rows; anything left without a class is listed and the block stops. See `13-classes.js` in the piston tutorial.

```js
const rules = [
  [/^(Room|Floor)$/, ['environment']], [/Light$/, ['light']],
  [/^crankWeb/, ['web']], [/^(ext|gap|imark)/, ['leverage']],
  [/^cam/, ['camera']], [/^callcard$/, ['card']]
];
```

## 2. The contract: one note in the tutorial

Every short's tutorial carries one `<div class="note" id="film-contract">`, with these four statements in this order:

1. **Units**: what a length is (scene units and the constants, tiles, unit-cube widths), and whether a number is a property of the object or of the ruler.
2. **Assumptions**: what the film takes for granted (ideal projectile, rigid links, random mating, integer triples), and what it does *not* claim.
3. **Render**: whether a video render was run for the page, plainly ("no video render was run for this page", or when and how the committed video was made).
4. **Addressable**: that every object is named and classed and the scene is marked with `requireLabels`.

And the copy follows the film, not the intent: a demonstration of three cases is not a proof of the general theorem; "the scene file" or "the staged scene" is not "the finished scene" when a script animates it.

## 3. Checks

```
node docs/editor/js/intelligence/__tests__/sceneLint.test.mjs   # the gate's rules
node scripts/check-shorts.mjs                                    # the contract and the wording, every short
node scripts/tutorial-policy.cjs lint
node scripts/check-doc-links.mjs
```

`check-shorts.mjs` fails a page that has no contract, has its four statements out of order, does not say whether the render was run, or calls its film a proof (the (a + b)³ page, which really is a dissection proof, is the one listed exception).
