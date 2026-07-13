# `$S()` Chainable Methods API

`$S()` is a **selector-based chainable set** for editing 3D objects in the scene by CSS-like selectors. All methods return the set for chaining.

---

## **Selector Usage**
```javascript
const $S = makeQuery(editor);  // Initialize with editor

$S('.wheel.front')             // Compound selector (AND) — has .wheel AND .front
$S('#dump-bed')                // ID selector (by label or name)
$S('.object')                  // Single class
$S('mesh')                     // Type selector (mesh, group, light, camera, etc.)
$S('.a .b')                    // Descendant combinator
$S('.a > .b')                  // Child combinator
$S('*')                        // Wildcard — all nodes
```

---


## **Chainable Methods**

### **Edit Operations** (immediate, command-backed, undoable)
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.recolor(color)` | `color: string` | Change material color (e.g., `'#FF0000'`) |
| `.scale(factor, axis)` | `factor: number`, `axis?: 'x'\|'y'\|'z'` | Scale uniformly or on specific axis |
| `.move(dx, dy, dz)` | `dx, dy, dz: number` | Translate position (default: 0) |
| `.rotate(axis, degrees)` | `axis: 'x'\|'y'\|'z'`, `degrees: number` | Rotate around axis (default: 'y', 90°) |
| `.delete()` | none | Remove from scene |
| `.duplicate(dx, dy, dz)` | `dx, dy, dz: number` | Clone and offset (default: 0) |
| `.retexture(texture)` | `texture: string` | Apply texture by name |
| `.setMaterial(props)` | `props: object` | Set material properties |

---

### **Looping Animations** (infinite, duration-controlled)
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.spin(axis, turns, duration)` | `axis: 'x'\|'y'\|'z'`, `turns: number`, `duration: number` | Continuous rotation (default: 'y', 1 turn, 2s) |
| `.bounce(height, duration)` | `height: number`, `duration: number` | Up/down bounce loop (default: 0.5, 1s) |
| `.pulse(scale, duration)` | `scale: number`, `duration: number` | Scale pulse loop (default: 1.2x, 1s) |
| `.fade(from, to, duration)` | `from, to: number (0-1)`, `duration: number` | Fade loop (default: 1→0, 1s) |
| `.orbit(center, radius, duration)` | `center: [x,y,z]`, `radius: number`, `duration: number` | Orbital motion (default: [0,0,0], radius 2, 4s) |
| `.shake(intensity, duration)` | `intensity: number`, `duration: number` | Positional jitter (default: 0.1, 1s) |

---

### **Entrance Animations** (play once on show)
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.fadeIn(duration)` | `duration: number` | Fade in from transparent (default: 1s) |
| `.zoomIn(scale, duration)` | `scale: number`, `duration: number` | Scale from zero to full (default: 1.5x, 1s) |
| `.slideInUp(distance, duration)` | `distance, duration: number` | Slide in from below (default: 1, 0.8s) |
| `.slideInDown(distance, duration)` | `distance, duration: number` | Slide in from above (default: 1, 0.8s) |
| `.slideInLeft(distance, duration)` | `distance, duration: number` | Slide in from left (default: 1, 0.8s) |
| `.slideInRight(distance, duration)` | `distance, duration: number` | Slide in from right (default: 1, 0.8s) |
| `.slideInForward(distance, duration)` | `distance, duration: number` | Slide in from back (Z-axis, default: 2, 0.8s) |
| `.slideInBack(distance, duration)` | `distance, duration: number` | Slide in from front (Z-axis, default: 2, 0.8s) |
| `.bounceIn(duration)` | `duration: number` | Scale in with bounce (default: 1.2s) |
| `.flipInX(duration)` | `duration: number` | Rotate in around X-axis (default: 0.8s) |
| `.flipInY(duration)` | `duration: number` | Rotate in around Y-axis (default: 0.8s) |
| `.flipInZ(duration)` | `duration: number` | **3D** rotate in around Z-axis (default: 0.8s) |
| `.rotateIn(angle, duration)` | `angle: number`, `duration: number` | Rotate in place (default: 90°, 0.8s) |

---

### **Exit Animations** (play once on hide)
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.fadeOut(duration)` | `duration: number` | Fade out to transparent (default: 1s) |
| `.zoomOut(scale, duration)` | `scale: number`, `duration: number` | Scale to zero (default: 0.3x, 1s) |
| `.slideOutUp(distance, duration)` | `distance, duration: number` | Slide out upward (default: 1, 0.8s) |
| `.slideOutDown(distance, duration)` | `distance, duration: number` | Slide out downward (default: 1, 0.8s) |
| `.slideOutLeft(distance, duration)` | `distance, duration: number` | Slide out left (default: 1, 0.8s) |
| `.slideOutRight(distance, duration)` | `distance, duration: number` | Slide out right (default: 1, 0.8s) |
| `.slideOutForward(distance, duration)` | `distance, duration: number` | Slide out backward (Z-axis, default: 2, 0.8s) |
| `.slideOutBack(distance, duration)` | `distance, duration: number` | Slide out forward (Z-axis, default: 2, 0.8s) |
| `.bounceOut(duration)` | `duration: number` | Scale out with bounce (default: 1.2s) |
| `.flipOutX(duration)` | `duration: number` | Rotate out around X-axis (default: 0.8s) |
| `.flipOutY(duration)` | `duration: number` | Rotate out around Y-axis (default: 0.8s) |
| `.flipOutZ(duration)` | `duration: number` | **3D** rotate out around Z-axis (default: 0.8s) |
| `.rotateOut(angle, duration)` | `angle: number`, `duration: number` | Rotate out of place (default: 90°, 0.8s) |

---

### **Attention Seekers** (emphasize without moving off-screen)
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.flash(times, duration)` | `times: number`, `duration: number` | Visibility flicker (default: 3x, 1s) |
| `.rubberBand(scale, duration)` | `scale: number`, `duration: number` | Elastic stretch effect (default: 1.3x, 0.8s) |
| `.jello(intensity, duration)` | `intensity: number`, `duration: number` | Skew/squash effect (default: 0.05, 0.9s) |
| `.heartBeat(scale, duration)` | `scale: number`, `duration: number` | Pulse emphasis (default: 1.1x, 1.3s) |
| `.tada(rotations, scale, duration)` | `rotations, scale: number`, `duration: number` | Spin + scale combo (default: 1, 1.1x, 1s) |
| `.wobble(angle, duration)` | `angle: number`, `duration: number` | Sway side-to-side (default: 15°, 1s) |

---

### **Utility Methods**
| Method | Parameters | Description |
|--------|-----------|-------------|
| `.raw(code)` | `code: string` | Execute raw operation JSON (advanced) |
| `.filter(selector)` | `selector: string` | Narrow set by additional selector (returns new set) |
| `.each(fn)` | `fn: (node) => void` | Iterate over nodes read-only (chainable) |
| `.result()` | none | Get last operation's result object |

---

### **Live Transform Accessors** (read + command-backed write)
`.position` `.rotation` `.scale` `.quaternion` are property accessors returning a live handle over the set's first node in **local** space. Reads are live; writes route through the undo/command surface and apply to every node in the set.

| Accessor | Read | Write (undoable) |
|----------|------|------------------|
| `.position` | `$S('#box').position.x` | `$S('#box').position.x = 4` → `SetPositionCommand` |
| `.rotation` | `$S('#box').rotation.y` (radians) | `$S('#box').rotation.y = Math.PI` → `SetRotationCommand` |
| `.scale` | `$S('#box').scale.x` | `$S('#box').scale.set(2,2,2)` → `SetScaleCommand` |
| `.quaternion` | `$S('#box').quaternion.w` | `$S('#box').quaternion.w = 1` → converts to Euler → `SetRotationCommand` |

Handles also support `.set(...)`, `.copy(v)`, `.toArray()`, `.clone()`. Back-compat call forms remain: `.scale(factor, axis)` (relative scale) and `.position()` / `.rotation()` / `.scale()` (world-space read-only snapshot).

---

## **Examples**

```javascript
// Single operations
$S('.wheel').recolor('#111');
$S('#dump-bed').scale(1.2);
$S('.object').move(0, 1, 0);

// Chained operations
$S('.car')
  .scale(0.8)
  .recolor('#FF0000')
  .spin('y', 2, 3);

// Animations
$S('.box').slideInLeft(2, 1.5);
$S('.box').slideInUp(1, 0.8);
$S('.wheel').spin('z', 5, 2);     // Looping
$S('.card').flipInX(0.8);
$S('.tada').tada(2, 1.2, 1);

// Chained animations
$S('.object')
  .fadeIn(1)
  .then...() // operations queue

// Filtering
$S('.wheel')
  .filter('.front')
  .recolor('#00FF00');

// Iteration
$S('.mesh').each(node => console.log(node.name));
```

---

## **Key Properties**

- **Chainable**: Every method returns `this` (the set), allowing method chaining
- **Command-backed**: All ops support undo/redo via `editor.execute()`
- **Deterministic**: Selectors resolve the same way every time
- **Guarded**: Empty matches log warnings but don't crash
- **Scoped**: Works on currently selected objects or full scene
