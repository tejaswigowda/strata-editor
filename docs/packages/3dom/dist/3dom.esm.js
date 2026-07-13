var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/three.js
import * as _three from "three";
var THREE = _three && _three.Scene ? _three : typeof globalThis !== "undefined" && globalThis.THREE || _three;
function setThree(instance) {
  if (instance) THREE = instance;
}
function getThree() {
  return THREE;
}

// src/host.js
function firstMaterial(obj, slot = 0) {
  if (!obj || !obj.material) return null;
  return Array.isArray(obj.material) ? obj.material[slot] : obj.material;
}
var defaultCommands = {
  setPosition(obj, vec) {
    const from = obj.position.clone();
    const to = vec.clone ? vec.clone() : new THREE.Vector3(vec.x, vec.y, vec.z);
    return { name: "setPosition", execute: () => obj.position.copy(to), undo: () => obj.position.copy(from) };
  },
  setRotation(obj, euler) {
    const from = obj.rotation.clone();
    const to = euler.clone ? euler.clone() : new THREE.Euler(euler.x, euler.y, euler.z, euler.order);
    return { name: "setRotation", execute: () => obj.rotation.copy(to), undo: () => obj.rotation.copy(from) };
  },
  setScale(obj, vec) {
    const from = obj.scale.clone();
    const to = vec.clone ? vec.clone() : new THREE.Vector3(vec.x, vec.y, vec.z);
    return { name: "setScale", execute: () => obj.scale.copy(to), undo: () => obj.scale.copy(from) };
  },
  setValue(obj, key, value) {
    const from = obj[key];
    return { name: "setValue:" + key, execute: () => {
      obj[key] = value;
    }, undo: () => {
      obj[key] = from;
    } };
  },
  setColor(obj, key, hex) {
    const target = obj[key];
    const from = target && target.getHex ? target.getHex() : null;
    return {
      name: "setColor:" + key,
      execute: () => {
        if (obj[key] && obj[key].setHex) obj[key].setHex(hex);
      },
      undo: () => {
        if (from !== null && obj[key] && obj[key].setHex) obj[key].setHex(from);
      }
    };
  },
  setMaterialColor(obj, key, hex, slot = 0) {
    const mat = firstMaterial(obj, slot);
    const from = mat && mat[key] && mat[key].getHex ? mat[key].getHex() : null;
    return {
      name: "setMaterialColor:" + key,
      execute: () => {
        if (mat && mat[key] && mat[key].setHex) {
          mat[key].setHex(hex);
          mat.needsUpdate = true;
        }
      },
      undo: () => {
        if (from !== null && mat && mat[key] && mat[key].setHex) {
          mat[key].setHex(from);
          mat.needsUpdate = true;
        }
      }
    };
  },
  setMaterialValue(obj, key, value, slot = 0) {
    const mat = firstMaterial(obj, slot);
    const from = mat ? mat[key] : void 0;
    return {
      name: "setMaterialValue:" + key,
      execute: () => {
        if (mat) {
          mat[key] = value;
          mat.needsUpdate = true;
        }
      },
      undo: () => {
        if (mat) {
          mat[key] = from;
          mat.needsUpdate = true;
        }
      }
    };
  },
  setMaterial(obj, material) {
    const from = obj.material;
    return { name: "setMaterial", execute: () => {
      obj.material = material;
    }, undo: () => {
      obj.material = from;
    } };
  },
  addObject(obj, parent) {
    return {
      name: "addObject",
      execute: () => {
        (parent || obj.parent).add(obj);
      },
      undo: () => {
        (parent || obj.parent).remove(obj);
      }
    };
  },
  removeObject(obj) {
    const parent = obj.parent;
    const index = parent ? parent.children.indexOf(obj) : -1;
    return {
      name: "removeObject",
      execute: () => {
        if (obj.parent) obj.parent.remove(obj);
      },
      undo: () => {
        if (!parent) return;
        parent.add(obj);
        if (index >= 0 && index < parent.children.length - 1) {
          parent.children.splice(parent.children.indexOf(obj), 1);
          parent.children.splice(index, 0, obj);
        }
      }
    };
  }
};
var DefaultHost = class {
  /**
   * @param {THREE.Object3D} scene  the root every selector resolves against
   * @param {object} [opts]
   * @param {(kind:string, payload?:any)=>void} [opts.onChange]  change callback
   * @param {number} [opts.historyLimit]  max undo entries (default 200)
   */
  constructor(scene, opts = {}) {
    if (!scene || !scene.traverse) throw new Error("3DOM: a THREE.Object3D scene root is required");
    this.scene = scene;
    this._undo = [];
    this._redo = [];
    this._limit = opts.historyLimit || 200;
    this._onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  }
  // change notification -------------------------------------------------------
  notify(kind, payload) {
    if (this._onChange) this._onChange(kind, payload);
  }
  onChange(fn) {
    this._onChange = fn;
    return this;
  }
  // command factories (delegate to the default command set) -------------------
  setPosition(...a) {
    return defaultCommands.setPosition(...a);
  }
  setRotation(...a) {
    return defaultCommands.setRotation(...a);
  }
  setScale(...a) {
    return defaultCommands.setScale(...a);
  }
  setValue(...a) {
    return defaultCommands.setValue(...a);
  }
  setColor(...a) {
    return defaultCommands.setColor(...a);
  }
  setMaterialColor(...a) {
    return defaultCommands.setMaterialColor(...a);
  }
  setMaterialValue(...a) {
    return defaultCommands.setMaterialValue(...a);
  }
  setMaterial(...a) {
    return defaultCommands.setMaterial(...a);
  }
  addObject(...a) {
    return defaultCommands.addObject(...a);
  }
  removeObject(...a) {
    return defaultCommands.removeObject(...a);
  }
  multi(commands) {
    const cmds = commands.filter(Boolean);
    return {
      name: "multi",
      execute: () => {
        for (const c of cmds) c.execute();
      },
      undo: () => {
        for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo();
      }
    };
  }
  // execution / history -------------------------------------------------------
  execute(command) {
    if (!command) return;
    command.execute();
    this._undo.push(command);
    if (this._undo.length > this._limit) this._undo.shift();
    this._redo.length = 0;
    this.notify("execute", command);
    return command;
  }
  undo() {
    const cmd = this._undo.pop();
    if (!cmd) return false;
    cmd.undo();
    this._redo.push(cmd);
    this.notify("undo", cmd);
    return true;
  }
  redo() {
    const cmd = this._redo.pop();
    if (!cmd) return false;
    cmd.execute();
    this._undo.push(cmd);
    this.notify("redo", cmd);
    return true;
  }
  clearHistory() {
    this._undo.length = 0;
    this._redo.length = 0;
  }
  get historyLength() {
    return this._undo.length;
  }
};
function resolveHost(sceneOrHost, opts = {}) {
  if (sceneOrHost && typeof sceneOrHost.execute === "function" && sceneOrHost.scene) {
    return sceneOrHost;
  }
  return new DefaultHost(sceneOrHost, opts);
}

// src/selectorEngine.js
var selectorEngine_exports = {};
__export(selectorEngine_exports, {
  hasNamedMatcher: () => hasNamedMatcher,
  isSelectionPseudo: () => isSelectionPseudo,
  isValid: () => isValid,
  match: () => match,
  parse: () => parse,
  query: () => query,
  setSelectionProvider: () => setSelectionProvider
});

// src/classDerive.js
function normalizeClassName(str) {
  return String(str).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function toClassSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  if (value && typeof value[Symbol.iterator] === "function") return new Set(value);
  if (value && typeof value === "object") return new Set(Object.values(value));
  return /* @__PURE__ */ new Set();
}
var AUTO_NAME_RE = /^(object|mesh|node|group|primitive|untitled|instance|empty|scene|geometry|buffergeometry|material|texture)[\s_\-.]*\d*$/i;
function nameStemClass(node) {
  if (!node) return "";
  const raw = node.name && String(node.name).trim();
  if (!raw || raw.length < 2) return "";
  if (AUTO_NAME_RE.test(raw)) return "";
  const stem = raw.replace(/[\s_.-]*\d+$/, "").trim() || raw;
  return normalizeClassName(stem);
}
function deriveClasses(node) {
  const classes = /* @__PURE__ */ new Set();
  if (!node) return classes;
  if (node.isMesh) classes.add("mesh");
  if (node.isLight) classes.add("light");
  if (node.isCamera) classes.add("camera");
  if (node.isGroup || !node.isMesh && node.children) classes.add("group");
  if (node.isPointLight) classes.add("point-light");
  if (node.isDirectionalLight) classes.add("directional-light");
  if (node.isSpotLight) classes.add("spot-light");
  if (node.isHemisphereLight) classes.add("hemisphere-light");
  if (node.isOrthographicCamera) classes.add("orthographic-camera");
  if (node.isPerspectiveCamera) classes.add("perspective-camera");
  if (node.isSkinnedMesh) classes.add("skinned-mesh");
  const nameCls = nameStemClass(node);
  if (nameCls) classes.add(nameCls);
  const d = node.userData.descriptors;
  if (!d) return classes;
  if (d.region) {
    const reg = d.region;
    if (reg.x) classes.add(reg.x);
    if (reg.y) classes.add(reg.y);
    if (reg.z) classes.add(reg.z);
  }
  if (d.shape) classes.add(d.shape);
  if (d.color && d.color.base) classes.add(d.color.base);
  if (d.materials && Array.isArray(d.materials)) {
    for (const matName of d.materials) {
      const cls = normalizeClassName(matName);
      if (cls) classes.add(cls);
    }
  }
  if (d.pair) {
    classes.add("paired");
    if (d.pair.side) classes.add("pair-" + d.pair.side);
  }
  if (d.orientation) classes.add(d.orientation);
  if (d.sizeRank) classes.add(d.sizeRank);
  return classes;
}
function deriveAllClasses(root) {
  if (!root) return;
  root.traverse((node) => {
    node.userData.classes = deriveClasses(node);
    if (node.userData.customClasses !== void 0) {
      node.userData.customClasses = Array.from(toClassSet(node.userData.customClasses));
    }
  });
}
function hasClass(node, cls) {
  if (!node || !cls) return false;
  if (!(node.userData.classes instanceof Set)) node.userData.classes = deriveClasses(node);
  if (node.userData.classes.has(cls)) return true;
  if (node.userData.customClasses && toClassSet(node.userData.customClasses).has(cls)) return true;
  if (node.userData.label && normalizeClassName(node.userData.label) === normalizeClassName(cls)) return true;
  return false;
}
function addClass(node, cls) {
  if (!node || !cls) return;
  const set = toClassSet(node.userData.customClasses);
  set.add(cls);
  node.userData.customClasses = Array.from(set);
}
function removeClass(node, cls) {
  if (!node || !cls) return;
  if (node.userData.customClasses === void 0) return;
  const set = toClassSet(node.userData.customClasses);
  set.delete(cls);
  node.userData.customClasses = Array.from(set);
}
function getAllClasses(node) {
  const all = new Set(deriveClasses(node));
  if (node.userData.customClasses) {
    for (const cls of toClassSet(node.userData.customClasses)) all.add(cls);
  }
  return all;
}

// src/selectorEngine.js
var KNOWN_TYPE_FLAGS = {
  mesh: (n) => n.isMesh,
  group: (n) => n.isGroup || !n.isMesh && n.children && n.children.length > 0,
  light: (n) => n.isLight,
  camera: (n) => n.isCamera,
  sprite: (n) => n.isSprite,
  line: (n) => n.isLine,
  points: (n) => n.isPoints,
  bone: (n) => n.isBone,
  object3d: () => true
};
function tokenize(selector) {
  const tokens = [];
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (/\s/.test(ch)) {
      while (i < selector.length && /\s/.test(selector[i])) i++;
      if (tokens.length > 0 && tokens[tokens.length - 1] !== " " && tokens[tokens.length - 1] !== ">") {
        tokens.push(" ");
      }
    } else if (ch === ">") {
      tokens.push(">");
      i++;
    } else if (ch === "#") {
      i++;
      let id = "";
      while (i < selector.length && /[a-zA-Z0-9_-]/.test(selector[i])) {
        id += selector[i];
        i++;
      }
      if (id) tokens.push({ type: "id", value: id });
    } else if (ch === ".") {
      i++;
      let cls = "";
      while (i < selector.length && /[a-zA-Z0-9_-]/.test(selector[i])) {
        cls += selector[i];
        i++;
      }
      if (cls) tokens.push({ type: "class", value: cls });
    } else if (ch === "*") {
      tokens.push({ type: "wildcard" });
      i++;
    } else if (/[a-zA-Z]/.test(ch)) {
      let type = "";
      while (i < selector.length && /[a-zA-Z0-9_-]/.test(selector[i])) {
        type += selector[i];
        i++;
      }
      if (type) tokens.push({ type: "type", value: type });
    } else {
      i++;
    }
  }
  return tokens;
}
function parseTokens(tokens) {
  const sequence = [];
  let current = { matchers: [] };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === " ") {
      if (current.matchers.length > 0) {
        sequence.push(current);
        sequence.push("descendant");
        current = { matchers: [] };
      }
    } else if (token === ">") {
      if (current.matchers.length > 0) {
        sequence.push(current);
        sequence.push("child");
        current = { matchers: [] };
      }
    } else if (token.type === "id") {
      current.matchers.push({ type: "id", value: token.value });
    } else if (token.type === "class") {
      current.matchers.push({ type: "class", value: token.value });
    } else if (token.type === "type") {
      current.matchers.push({ type: "type", value: token.value });
    } else if (token.type === "wildcard") {
      current.matchers.push({ type: "wildcard" });
    }
  }
  if (current.matchers.length > 0) sequence.push(current);
  return sequence;
}
function nodeMatches(node, matchers) {
  for (const m of matchers) {
    if (m.type === "id") {
      const target = normalizeClassName(m.value);
      const label = node.userData.label ? normalizeClassName(node.userData.label) : "";
      const name = node.name ? normalizeClassName(node.name) : "";
      if (target !== label && target !== name) return false;
    } else if (m.type === "class") {
      if (!hasClass(node, m.value)) return false;
    } else if (m.type === "type") {
      const type = m.value.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(KNOWN_TYPE_FLAGS, type)) {
        if (!KNOWN_TYPE_FLAGS[type](node)) return false;
      } else if ((node.type || "").toLowerCase() !== type) {
        return false;
      }
    } else if (m.type === "wildcard") {
      continue;
    }
  }
  return true;
}
function matchSequence(root, sequence) {
  const results = [];
  if (sequence.length === 1 && typeof sequence[0] === "object") {
    const matchers = sequence[0].matchers;
    root.traverse((node) => {
      if (node === root) return;
      if (nodeMatches(node, matchers)) results.push(node);
    });
    return results;
  }
  let candidates = [root];
  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    if (item === "descendant") {
      const nextMatchers = sequence[i + 1];
      if (!nextMatchers || typeof nextMatchers === "string") continue;
      const next = [];
      for (const candidate of candidates) {
        candidate.traverse((node) => {
          if (node === candidate) return;
          if (nodeMatches(node, nextMatchers.matchers)) next.push(node);
        });
      }
      candidates = next;
      i++;
    } else if (item === "child") {
      const nextMatchers = sequence[i + 1];
      if (!nextMatchers || typeof nextMatchers === "string") continue;
      const next = [];
      for (const candidate of candidates) {
        for (const child of candidate.children) {
          if (nodeMatches(child, nextMatchers.matchers)) next.push(child);
        }
      }
      candidates = next;
      i++;
    }
  }
  return candidates;
}
function parse(selector) {
  if (!selector || typeof selector !== "string") throw new Error("Invalid selector");
  const trimmed = selector.trim();
  if (!trimmed) throw new Error("Empty selector");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error("No valid tokens in selector");
  return parseTokens(tokens);
}
function match(root, ast) {
  if (!root || !ast) return [];
  return matchSequence(root, ast);
}
var SELECTION_PSEUDO = /^\s*:?(selected|lasso)\s*$/i;
var _selectionProvider = null;
function setSelectionProvider(fn) {
  _selectionProvider = typeof fn === "function" ? fn : null;
}
function isSelectionPseudo(selector) {
  return typeof selector === "string" && SELECTION_PSEUDO.test(selector);
}
function query(root, selector) {
  if (isSelectionPseudo(selector)) {
    return _selectionProvider ? _selectionProvider() || [] : [];
  }
  try {
    const ast = parse(selector);
    return match(root, ast);
  } catch (e) {
    console.warn("Selector error:", e.message);
    return [];
  }
}
function hasNamedMatcher(selector) {
  try {
    const seq = parse(selector);
    for (const item of seq) {
      if (typeof item === "string") continue;
      for (const m of item.matchers) {
        if (m.type === "id" || m.type === "class") return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
function isValid(selector) {
  if (isSelectionPseudo(selector)) return true;
  try {
    parse(selector);
    return true;
  } catch {
    return false;
  }
}

// src/ops.js
var ops_exports = {};
__export(ops_exports, {
  OP_SCHEMA: () => OP_SCHEMA,
  OP_SET: () => OP_SET,
  deleteOp: () => deleteOp,
  dispatchOp: () => dispatchOp,
  dispatchOps: () => dispatchOps,
  duplicateOp: () => duplicateOp,
  moveOp: () => moveOp,
  recolorOp: () => recolorOp,
  rotateOp: () => rotateOp,
  scaleOp: () => scaleOp,
  setMaterialOp: () => setMaterialOp,
  setMaterialPropOp: () => setMaterialPropOp,
  setObjectPropOp: () => setObjectPropOp,
  setOpacityOp: () => setOpacityOp,
  setVisibleOp: () => setVisibleOp,
  wireframeOp: () => wireframeOp
});
function clamp(val, min = -1e3, max = 1e3) {
  return Math.max(min, Math.min(max, val));
}
function query2(host, sel) {
  if (Array.isArray(sel)) return sel;
  return query(host.scene, sel);
}
function* expandToMeshes(node) {
  if (node.isMesh) {
    yield node;
  } else if (node.children) {
    for (const child of node.children) yield* expandToMeshes(child);
  }
}
function collectMeshes(nodes) {
  const meshes = [];
  for (const node of nodes) for (const m of expandToMeshes(node)) meshes.push(m);
  return meshes;
}
function hasTextureMap(mesh) {
  if (!mesh || !mesh.isMesh) return false;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return !!(mat && mat.map);
}
function isMaterialShared(material, scene) {
  if (!material) return false;
  let count = 0;
  scene.traverse((node) => {
    if (node.isMesh) {
      const mat = Array.isArray(node.material) ? node.material[0] : node.material;
      if (mat === material) count++;
    }
  });
  return count > 1;
}
function isMergedMeshNode(node) {
  if (!node) return false;
  let root = node;
  while (root.parent && root.parent.parent) root = root.parent;
  let meshCount = 0;
  root.traverse((n) => {
    if (n.isMesh) meshCount++;
  });
  return meshCount === 1 && root.userData.mergedMesh;
}
function run(host, cmds) {
  const list = cmds.filter(Boolean);
  if (list.length === 0) return 0;
  host.execute(list.length === 1 ? list[0] : host.multi(list));
  return list.length;
}
function noMatch(selector) {
  return { success: false, message: `No nodes matched "${selector}"`, count: 0 };
}
function recolorOp(host, selector, color) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  let hex;
  try {
    hex = new THREE.Color(color).getHex();
  } catch {
    return { success: false, message: `recolor: unrecognized color "${color}"`, count: 0 };
  }
  const warnings = [];
  const cmds = [];
  for (const node of collectMeshes(nodes)) {
    const isArrayMat = Array.isArray(node.material);
    const mat = isArrayMat ? node.material[0] : node.material;
    if (!mat) continue;
    if (hasTextureMap(node)) warnings.push(`"${node.name}" is textured \u2014 color TINTS, not replaces.`);
    if (!isArrayMat && isMaterialShared(mat, host.scene)) {
      const cloned = mat.clone();
      if (cloned.color) cloned.color.setHex(hex);
      cmds.push(host.setMaterial(node, cloned));
    } else {
      cmds.push(host.setMaterialColor(node, "color", hex));
    }
  }
  if (cmds.length === 0) return { success: false, message: "No recolorable meshes matched", count: 0 };
  const count = run(host, cmds);
  return { success: true, message: warnings.length ? warnings.join("; ") : null, count };
}
function scaleOp(host, selector, factor, axis = null) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const safe = clamp(factor, 0.1, 10);
  const cmds = [];
  for (const node of nodes) {
    const s = node.scale.clone();
    const a = axis ? String(axis).toLowerCase() : null;
    if (a && ["x", "y", "z"].includes(a)) s[a] *= safe;
    else s.multiplyScalar(safe);
    cmds.push(host.setScale(node, s));
  }
  return { success: true, count: run(host, cmds) };
}
function moveOp(host, selector, dx, dy, dz) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const off = { x: clamp(dx, -100, 100), y: clamp(dy, -100, 100), z: clamp(dz, -100, 100) };
  const cmds = [];
  let grounded = 0;
  for (const node of nodes) {
    const p = node.position.clone();
    p.x += off.x;
    p.y += off.y;
    p.z += off.z;
    if (p.y < 0) {
      p.y = 0;
      grounded++;
    }
    cmds.push(host.setPosition(node, p));
  }
  const count = run(host, cmds);
  return { success: true, message: grounded ? `${grounded} node(s) grounded (y\u22650)` : null, count };
}
function rotateOp(host, selector, axis, degrees) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const a = String(axis).toLowerCase();
  if (!["x", "y", "z"].includes(a)) return { success: false, message: `Invalid axis "${axis}"; use x, y, or z` };
  const rad = clamp(degrees, -360, 360) * Math.PI / 180;
  const cmds = [];
  for (const node of nodes) {
    const e = node.rotation.clone();
    e[a] += rad;
    cmds.push(host.setRotation(node, e));
  }
  return { success: true, count: run(host, cmds) };
}
function deleteOp(host, selector) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const cmds = [];
  const skipped = [];
  for (const node of nodes) {
    if (isMergedMeshNode(node)) {
      skipped.push(node.name || node.uuid.slice(0, 6));
      continue;
    }
    if (!node.parent) continue;
    cmds.push(host.removeObject(node));
  }
  const count = run(host, cmds);
  const msg = skipped.length ? `${skipped.length} node(s) skipped (merged mesh): ${skipped.join(", ")}` : null;
  return { success: count > 0, message: msg, skipped: skipped.length, count };
}
function duplicateOp(host, selector, dx = 0.5, dy = 0, dz = 0.5) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const off = { x: clamp(dx, -100, 100), y: clamp(dy, -100, 100), z: clamp(dz, -100, 100) };
  const cmds = [];
  const clones = [];
  for (const node of nodes) {
    const clone = node.clone();
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(clone.position);
    node.getWorldQuaternion(clone.quaternion);
    node.getWorldScale(clone.scale);
    clone.position.x += off.x;
    clone.position.y += off.y;
    clone.position.z += off.z;
    if (clone.name) clone.name += " (copy)";
    cmds.push(host.addObject(clone, host.scene));
    clones.push(clone);
  }
  const count = run(host, cmds);
  return { success: count > 0, count, clones };
}
function setMaterialOp(host, selector, materialProps) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  if (!materialProps || typeof materialProps !== "object") return { success: false, message: "materialProps must be an object" };
  if ("map" in materialProps && materialProps.map != null && !materialProps.map.isTexture) {
    return { success: false, message: "setMaterial: map must be a THREE.Texture" };
  }
  const cmds = [];
  for (const node of collectMeshes(nodes)) {
    cmds.push(host.setMaterial(node, new THREE.MeshStandardMaterial(materialProps)));
  }
  return { success: cmds.length > 0, count: run(host, cmds) };
}
function setOpacityOp(host, selector, value) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const v = clamp(parseFloat(value) || 1, 0, 1);
  const cmds = [];
  for (const node of collectMeshes(nodes)) {
    if (!node.material) continue;
    cmds.push(host.setMaterialValue(node, "transparent", true));
    cmds.push(host.setMaterialValue(node, "opacity", v));
  }
  return { success: cmds.length > 0, count: run(host, cmds) };
}
function setVisibleOp(host, selector, visible) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const cmds = nodes.map((node) => host.setValue(node, "visible", Boolean(visible)));
  return { success: true, count: run(host, cmds) };
}
function wireframeOp(host, selector, on = true) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const cmds = collectMeshes(nodes).map((node) => host.setMaterialValue(node, "wireframe", Boolean(on)));
  return { success: cmds.length > 0, count: run(host, cmds) };
}
function setObjectPropOp(host, selector, key, value) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const cmds = nodes.filter((n) => key in n).map((n) => host.setValue(n, key, value));
  return { success: cmds.length > 0, count: run(host, cmds) };
}
function setMaterialPropOp(host, selector, key, value) {
  const nodes = query2(host, selector);
  if (nodes.length === 0) return noMatch(selector);
  const cmds = collectMeshes(nodes).map((n) => host.setMaterialValue(n, key, value));
  return { success: cmds.length > 0, count: run(host, cmds) };
}
var OP_SET = [
  "recolor",
  "scale",
  "move",
  "rotate",
  "delete",
  "duplicate",
  "setMaterial",
  "setOpacity",
  "setVisible",
  "wireframe",
  "castShadow",
  "receiveShadow",
  "metalness",
  "roughness"
];
var OP_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: OP_SET },
    selector: { type: "string" },
    args: { type: "object" }
  },
  required: ["op", "selector"]
};
function dispatchOp(host, j) {
  if (!j || typeof j.op !== "string") return { success: false, message: "op must have a string .op" };
  const sel = j.selector;
  const a = j.args || {};
  switch (j.op) {
    case "recolor":
      return recolorOp(host, sel, a.color);
    case "scale":
      return scaleOp(host, sel, a.factor ?? a.value, a.axis ?? null);
    case "move":
      return moveOp(host, sel, a.x ?? a.dx ?? 0, a.y ?? a.dy ?? 0, a.z ?? a.dz ?? 0);
    case "rotate":
      return rotateOp(host, sel, a.axis, a.degrees ?? a.value);
    case "delete":
      return deleteOp(host, sel);
    case "duplicate":
      return duplicateOp(host, sel, a.x ?? a.dx, a.y ?? a.dy, a.z ?? a.dz);
    case "setMaterial":
      return setMaterialOp(host, sel, a.props ?? a);
    case "setOpacity":
      return setOpacityOp(host, sel, a.value ?? a.opacity);
    case "setVisible":
      return setVisibleOp(host, sel, a.value ?? a.visible);
    case "wireframe":
      return wireframeOp(host, sel, a.value ?? a.on ?? true);
    case "castShadow":
      return setObjectPropOp(host, sel, "castShadow", Boolean(a.value));
    case "receiveShadow":
      return setObjectPropOp(host, sel, "receiveShadow", Boolean(a.value));
    case "metalness":
      return setMaterialPropOp(host, sel, "metalness", a.value);
    case "roughness":
      return setMaterialPropOp(host, sel, "roughness", a.value);
    default:
      return { success: false, message: `Unknown op "${j.op}"` };
  }
}
function dispatchOps(host, list) {
  return (Array.isArray(list) ? list : [list]).map((j) => dispatchOp(host, j));
}

// src/chain.js
var ChainableSet = class _ChainableSet {
  /**
   * @param {object} host          the bound Host (scene + command factories)
   * @param {string|Array} target  a selector string, or an explicit node array
   */
  constructor(host, target) {
    this._host = host;
    this._target = target;
    this._nodes = Array.isArray(target) ? target.slice() : query(host.scene, target);
  }
  // ── Read layer (terminal values) ─────────────────────────────────────────
  get nodes() {
    return this._nodes.slice();
  }
  get length() {
    return this._nodes.length;
  }
  get count() {
    return this._nodes.length;
  }
  get exists() {
    return this._nodes.length > 0;
  }
  get names() {
    return this._nodes.map((n) => n.name || "");
  }
  get first() {
    return new _ChainableSet(this._host, this._nodes.slice(0, 1));
  }
  get last() {
    return new _ChainableSet(this._host, this._nodes.slice(-1));
  }
  classes() {
    const s = /* @__PURE__ */ new Set();
    for (const n of this._nodes) for (const c of getAllClasses(n)) s.add(c);
    return [...s];
  }
  each(fn) {
    this._nodes.forEach(fn);
    return this;
  }
  toArray() {
    return this._nodes.slice();
  }
  // ── Traversal (return new sets) ──────────────────────────────────────────
  not(selector) {
    const excluded = new Set(query(this._host.scene, selector));
    return new _ChainableSet(this._host, this._nodes.filter((n) => !excluded.has(n)));
  }
  parent() {
    const seen = /* @__PURE__ */ new Set();
    const parents = [];
    for (const n of this._nodes) if (n.parent && !seen.has(n.parent)) {
      seen.add(n.parent);
      parents.push(n.parent);
    }
    return new _ChainableSet(this._host, parents);
  }
  children() {
    const out = [];
    for (const n of this._nodes) for (const c of n.children) out.push(c);
    return new _ChainableSet(this._host, out);
  }
  filter(pred) {
    return new _ChainableSet(this._host, this._nodes.filter(pred));
  }
  // ── Internal: run an op-JSON, keep the chain ─────────────────────────────
  op(json) {
    dispatchOp(this._host, { ...json, selector: this._nodes });
    return this;
  }
  ops(list) {
    for (const j of list) this.op(j);
    return this;
  }
  // ── Mutating ops (chainable) ─────────────────────────────────────────────
  recolor(color) {
    recolorOp(this._host, this._nodes, color);
    return this;
  }
  scale(factor, axis = null) {
    scaleOp(this._host, this._nodes, factor, axis);
    return this;
  }
  move(x = 0, y = 0, z = 0) {
    moveOp(this._host, this._nodes, x, y, z);
    return this;
  }
  rotate(axis, degrees) {
    rotateOp(this._host, this._nodes, axis, degrees);
    return this;
  }
  delete() {
    deleteOp(this._host, this._nodes);
    return this;
  }
  duplicate(x, y, z) {
    duplicateOp(this._host, this._nodes, x, y, z);
    return this;
  }
  setMaterial(props) {
    setMaterialOp(this._host, this._nodes, props);
    return this;
  }
  setOpacity(v) {
    setOpacityOp(this._host, this._nodes, v);
    return this;
  }
  setVisible(v) {
    setVisibleOp(this._host, this._nodes, v);
    return this;
  }
  wireframe(on = true) {
    wireframeOp(this._host, this._nodes, on);
    return this;
  }
  // bulk property setters (three.js-named where they exist)
  castShadow(v = true) {
    setObjectPropOp(this._host, this._nodes, "castShadow", Boolean(v));
    return this;
  }
  receiveShadow(v = true) {
    setObjectPropOp(this._host, this._nodes, "receiveShadow", Boolean(v));
    return this;
  }
  renderOrder(v) {
    setObjectPropOp(this._host, this._nodes, "renderOrder", v);
    return this;
  }
  metalness(v) {
    setMaterialPropOp(this._host, this._nodes, "metalness", v);
    return this;
  }
  roughness(v) {
    setMaterialPropOp(this._host, this._nodes, "roughness", v);
    return this;
  }
  // ── Class / label mutation ───────────────────────────────────────────────
  addClass(cls) {
    for (const n of this._nodes) addClass(n, cls);
    this._host.notify("classChanged");
    return this;
  }
  removeClass(cls) {
    for (const n of this._nodes) removeClass(n, cls);
    this._host.notify("classChanged");
    return this;
  }
  editID(name) {
    for (const n of this._nodes) n.name = name;
    this._host.notify("nameChanged");
    return this;
  }
};

// src/colorName.js
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}
function rgbToColorName(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (s < 0.12) {
    if (v < 0.1) return { name: "black", base: "black" };
    if (v < 0.32) return { name: "dark gray", base: "gray" };
    if (v < 0.68) return { name: "gray", base: "gray" };
    if (v < 0.9) return { name: "light gray", base: "gray" };
    return { name: "white", base: "white" };
  }
  let base;
  if (h < 15 || h >= 345) base = "red";
  else if (h < 45) base = "orange";
  else if (h < 70) base = "yellow";
  else if (h < 100) base = "lime";
  else if (h < 160) base = "green";
  else if (h < 190) base = "teal";
  else if (h < 210) base = "cyan";
  else if (h < 255) base = "blue";
  else if (h < 290) base = "purple";
  else base = "magenta";
  if ((base === "orange" || base === "red") && v < 0.55 && s > 0.35) {
    return { name: "brown", base: "brown" };
  }
  if ((base === "red" || base === "magenta") && v > 0.8 && s < 0.55) {
    return { name: "pink", base: "pink" };
  }
  const qualifier = v < 0.42 ? "dark " : v > 0.88 && s < 0.55 ? "light " : "";
  return { name: qualifier + base, base };
}
function colorToName(color) {
  const { name, base } = rgbToColorName(color.r, color.g, color.b);
  return { name, base, hex: "#" + color.getHexString() };
}

// src/symmetry.js
var DEFAULT_TOL = 0.18;
function detectSymmetryPairs(parentInfo, sibs, tol = DEFAULT_TOL) {
  const cx = parentInfo.center[0];
  const pairs = /* @__PURE__ */ new Map();
  for (let i = 0; i < sibs.length; i++) {
    const a = sibs[i];
    if (pairs.has(a.node)) continue;
    const reflX = 2 * cx - a.center[0];
    let best = null;
    let bestErr = Infinity;
    for (let j = 0; j < sibs.length; j++) {
      if (i === j) continue;
      const b = sibs[j];
      if (pairs.has(b.node)) continue;
      const scale = Math.max(
        Math.max(...a.size),
        Math.max(...b.size),
        1e-4
      );
      const t = tol * scale;
      const dx = Math.abs(reflX - b.center[0]);
      const dy = Math.abs(a.center[1] - b.center[1]);
      const dz = Math.abs(a.center[2] - b.center[2]);
      if (dx > t || dy > t || dz > t) continue;
      const ds = Math.abs(a.size[0] - b.size[0]) + Math.abs(a.size[1] - b.size[1]) + Math.abs(a.size[2] - b.size[2]);
      if (ds > 3 * t) continue;
      const err = dx + dy + dz + ds;
      if (err < bestErr) {
        bestErr = err;
        best = b;
      }
    }
    if (best) {
      const aRight = a.center[0] >= cx;
      pairs.set(a.node, { mate: best.node, axis: "x", side: aRight ? "right" : "left" });
      pairs.set(best.node, { mate: a.node, axis: "x", side: aRight ? "left" : "right" });
    }
  }
  return pairs;
}

// src/descriptors.js
var SCHEMA = 1;
function decodeName(s) {
  if (!s) return s;
  return String(s).replace(/_(\d{3})_?/g, (m, n) => {
    const c = parseInt(n, 10);
    return c >= 32 && c <= 126 ? String.fromCharCode(c) : m;
  });
}
function materialNames(obj) {
  const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
  const names = [];
  for (const m of mats) {
    if (m && m.name) {
      const d = decodeName(m.name);
      if (d && !names.includes(d)) names.push(d);
    }
  }
  return names;
}
function geometryHash(geometry) {
  if (!geometry) return "none";
  const pos = geometry.attributes && geometry.attributes.position;
  if (!pos) return "empty";
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const r = geometry.boundingSphere ? Math.round(geometry.boundingSphere.radius * 1e3) : 0;
  return `${pos.count}:${r}`;
}
function worldBox(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const c = new THREE.Vector3(), s = new THREE.Vector3();
  box.getCenter(c);
  box.getSize(s);
  return { box, center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
}
function regionOf(centroid, parentInfo) {
  const out = {};
  const axes = ["x", "y", "z"];
  const lo = ["left", "bottom", "back"];
  const hi = ["right", "top", "front"];
  for (let i = 0; i < 3; i++) {
    const pc = parentInfo.center[i];
    const ps = parentInfo.size[i] || 1e-4;
    const t = (centroid[i] - (pc - ps / 2)) / ps;
    out[axes[i]] = t < 0.38 ? lo[i] : t > 0.62 ? hi[i] : "center";
  }
  return out;
}
function shapeOf(size) {
  const s = [...size].sort((a, b) => a - b);
  const [small, mid, large] = s;
  const eps = 1e-5;
  if (large < eps) return "blocky";
  const longRatio = large / (mid + eps);
  const flatRatio = small / (mid + eps);
  if (longRatio > 2.2 && flatRatio > 0.5) return "elongated";
  if (flatRatio < 0.18) return "flat";
  if (longRatio > 2.2) return "thin";
  return "blocky";
}
function orientationOf(size) {
  let li = 0;
  for (let i = 1; i < 3; i++) if (size[i] > size[li]) li = i;
  if (size[li] < 1e-5) return null;
  if (li === 1) return "vertical";
  return "horizontal";
}
function dominantTextureColor(map) {
  try {
    const img = map.image;
    if (!img || !(img.width || img.naturalWidth)) return null;
    const N = 16;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = N;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;
    const counts = /* @__PURE__ */ new Map();
    let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      rSum += r * a;
      gSum += g * a;
      bSum += b * a;
      wSum += a;
      const { base } = rgbToColorName(r, g, b);
      counts.set(base, (counts.get(base) || 0) + a);
    }
    if (wSum === 0) return null;
    let modeBase = null, modeCount = -1;
    for (const [k, v] of counts) if (v > modeCount) {
      modeCount = v;
      modeBase = k;
    }
    const ar = rSum / wSum, ag = gSum / wSum, ab = bSum / wSum;
    const named = rgbToColorName(ar, ag, ab);
    const hex = "#" + [ar, ag, ab].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
    return { name: named.name, base: modeBase || named.base, hex };
  } catch {
    return null;
  }
}
function colorOf(mesh) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat) return null;
  if (mat.map && mat.color && mat.color.r > 0.92 && mat.color.g > 0.92 && mat.color.b > 0.92) {
    const tex = dominantTextureColor(mat.map);
    if (tex) return tex;
  }
  if (mat.color) return colorToName(mat.color);
  if (mat.map) {
    const tex = dominantTextureColor(mat.map);
    if (tex) return tex;
  }
  return null;
}
function overlaps(a, b) {
  return a.box.min.x <= b.box.max.x && a.box.max.x >= b.box.min.x && a.box.min.y <= b.box.max.y && a.box.max.y >= b.box.min.y && a.box.min.z <= b.box.max.z && a.box.max.z >= b.box.min.z;
}
function groupColor(node) {
  const counts = /* @__PURE__ */ new Map();
  let sampleHex = null;
  node.traverse((c) => {
    if (!c.isMesh) return;
    const col = colorOf(c);
    if (!col) return;
    counts.set(col.base, (counts.get(col.base) || 0) + 1);
    if (!sampleHex) sampleHex = col.hex;
  });
  if (counts.size === 0) return null;
  let base = null, n = -1;
  for (const [k, v] of counts) if (v > n) {
    n = v;
    base = k;
  }
  return { name: base, base, hex: sampleHex };
}
function materialsOf(node) {
  if (node.isMesh) return materialNames(node);
  const out = [];
  node.traverse((c) => {
    if (!c.isMesh) return;
    for (const m of materialNames(c)) if (!out.includes(m)) out.push(m);
  });
  return out;
}
function indexSubtree(root, force = false) {
  if (!root) return;
  const nodes = [];
  root.traverse((n) => {
    if (n !== root || n.isMesh || n.isGroup || n.children.length) nodes.push(n);
  });
  const boxMap = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    const info = worldBox(n);
    if (info) boxMap.set(n, info);
  }
  const byParent = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    const p = n.parent;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(n);
  }
  for (const n of nodes) {
    const info = boxMap.get(n);
    if (!info) continue;
    const hash = n.isMesh ? geometryHash(n.geometry) : `grp:${n.children.length}`;
    const existing = n.userData.descriptors;
    if (!force && existing && existing.geomHash === hash && existing.v === SCHEMA) continue;
    const siblings = (byParent.get(n.parent) || []).filter((s) => s !== n && boxMap.has(s));
    const parentInfo = n.parent && boxMap.has(n.parent) ? boxMap.get(n.parent) : boxMap.get(root) || info;
    const region = regionOf(info.center, parentInfo);
    const vol = info.size[0] * info.size[1] * info.size[2];
    const sibVols = siblings.map((s) => {
      const si = boxMap.get(s);
      return si.size[0] * si.size[1] * si.size[2];
    });
    let sizeRank = "medium";
    if (sibVols.length) {
      const maxV = Math.max(vol, ...sibVols);
      const minV = Math.min(vol, ...sibVols);
      if (vol >= maxV - 1e-9) sizeRank = "largest";
      else if (vol <= minV + 1e-9) sizeRank = "smallest";
    }
    const adjacency = [];
    for (const s of siblings) {
      if (overlaps(info, boxMap.get(s))) adjacency.push(s.name || s.uuid.slice(0, 6));
    }
    const color = n.isMesh ? colorOf(n) : groupColor(n);
    n.userData.descriptors = {
      v: SCHEMA,
      geomHash: hash,
      bbox: {
        center: info.center.map(r4),
        size: info.size.map(r4)
      },
      region,
      shape: n.isMesh ? shapeOf(info.size) : "blocky",
      orientation: orientationOf(info.size),
      sizeRank,
      volume: r4(vol),
      role: n.isMesh ? "leaf" : "group",
      childCount: n.children.length,
      depth: depthOf(n, root),
      parentName: n.parent && n.parent !== root ? n.parent.name || n.parent.type : root.name || "root",
      adjacency,
      color: color || null,
      materials: materialsOf(n),
      pair: null
      // filled in symmetry pass
    };
  }
  for (const [parent, kids] of byParent) {
    if (!parent || !boxMap.has(parent)) {
      if (parent !== root && parent !== null) continue;
    }
    const parentInfo = boxMap.get(parent) || boxMap.get(root);
    if (!parentInfo) continue;
    const meshKids = kids.filter((k) => k.isMesh && boxMap.has(k)).map((k) => {
      const bi = boxMap.get(k);
      return { node: k, center: bi.center, size: bi.size };
    });
    if (meshKids.length < 2) continue;
    const pairs = detectSymmetryPairs(parentInfo, meshKids);
    for (const [node, info] of pairs) {
      if (node.userData.descriptors) {
        node.userData.descriptors.pair = {
          mateUuid: info.mate.uuid,
          mateName: info.mate.name || info.mate.uuid.slice(0, 6),
          axis: info.axis,
          side: info.side
        };
      }
    }
  }
}
function r4(v) {
  return Math.round(v * 1e4) / 1e4;
}
function depthOf(node, root) {
  let d = 0, p = node;
  while (p && p !== root) {
    p = p.parent;
    d++;
    if (d > 64) break;
  }
  return d;
}

// src/autolabel.js
function autoLabel(root, opts = {}) {
  if (!root || !root.traverse) throw new Error("3DOM.autoLabel: a THREE.Object3D is required");
  indexSubtree(root, opts.force === true);
  deriveAllClasses(root);
  return root;
}

// src/index.js
function createS(sceneOrHost, opts = {}) {
  const host = resolveHost(sceneOrHost, opts);
  const $S = (selector) => new ChainableSet(host, selector);
  $S.host = host;
  $S.scene = host.scene;
  $S.autoLabel = (o = {}) => {
    autoLabel(host.scene, o);
    host.notify("autoLabel");
    return $S;
  };
  $S.op = (json) => {
    dispatchOp(host, json);
    return $S;
  };
  $S.ops = (list) => {
    dispatchOps(host, list);
    return $S;
  };
  $S.undo = () => {
    host.undo();
    return $S;
  };
  $S.redo = () => {
    host.redo();
    return $S;
  };
  $S.query = (selector) => query(host.scene, selector);
  return $S;
}
var src_default = createS;
export {
  ChainableSet,
  DefaultHost,
  THREE,
  autoLabel,
  createS,
  src_default as default,
  defaultCommands,
  deriveAllClasses,
  getThree,
  indexSubtree,
  ops_exports as ops,
  resolveHost,
  selectorEngine_exports as selectorEngine,
  setThree
};
//# sourceMappingURL=3dom.esm.js.map
