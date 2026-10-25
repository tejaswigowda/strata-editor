// Circuit1 — the three-property check (addressable / enumerable / total). Run in the Shell AFTER build.js.
// It tests the scene Strata produced, not Strata: a pass does not establish totality in general.
(async () => {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  // snapshots compare at 1e-9: undo recomposes a loaded matrix from Euler angles (~1e-15 noise)
  const snap = () => { const t = JSON.stringify(editor.scene.toJSON(), (k, v) => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h + ':' + t.length; };
  const nodes = []; editor.scene.traverse(o => { if (o !== editor.scene) nodes.push(o); });
  const res = { addressable: {}, enumerable: {}, total: { cases: [] } };

  // 1. ADDRESSABLE: every object resolves by its own name through $S('#name'), to exactly itself.
  const bad = [];
  for (const o of nodes) { const set = $S('#' + o.userData.label).nodes || []; if (set.length !== 1 || set[0] !== o) bad.push(o.name + ' -> ' + set.length); }
  res.addressable = { checked: nodes.length, failures: bad.length, sample: bad.slice(0, 5), pass: bad.length === 0 };

  // 2. ENUMERABLE: the full object set is listable from the scene alone (by type, no external index).
  const byType = { mesh: $S('mesh').count(), group: $S('group').count(), light: $S('light').count() };
  const sceneType = { mesh: nodes.filter(o => o.isMesh).length, group: nodes.filter(o => o.isGroup).length, light: nodes.filter(o => o.isLight).length };
  const listed = new Set([...$S('mesh').names(), ...$S('group').names(), ...$S('light').names()]);
  const missing = nodes.filter(o => !listed.has(o.name)).map(o => o.name);
  res.enumerable = { byType, sceneType, listedNames: listed.size, missingFromList: missing.length, pass: missing.length === 0 && byType.mesh === sceneType.mesh && byType.group === sceneType.group && byType.light === sceneType.light };

  // 3. TOTAL: each sampled op either applies to EVERY node it matched, or fails cleanly (scene unchanged). Never partial.
  const base = snap();
  const probe = {                                  // how to tell an op reached a node
    move: (o, b) => !o.position.equals(b.position), scale: (o, b) => !o.scale.equals(b.scale), rotate: (o, b) => !o.quaternion.equals(b.quaternion),
    setVisible: (o, b) => o.visible !== b.visible, recolor: (o) => true, delete: (o) => !o.parent, duplicate: () => true, setOpacity: () => true,
  };
  const cases = [
    ['.item-box', { type: 'move', dx: 1, dy: 0, dz: 0 }], ['.tree', { type: 'scale', factor: 1.5 }], ['.checkpoint', { type: 'rotate', axis: 'y', degrees: 15 }],
    ['.crowd', { type: 'setVisible', visible: false }], ['.road', { type: 'recolor', color: '#ff0000' }], ['.tree', { type: 'delete' }],
    ['.boost-pad', { type: 'duplicate', dx: 0, dy: 0, dz: 3 }], ['.item-box-part', { type: 'setOpacity', value: 0.5 }], ['#ItemBox07', { type: 'move', dx: 0, dy: 2, dz: 0 }],
    ['.spawn-point', { type: 'move', dx: 0, dy: 0, dz: -1 }], ['.landmark', { type: 'scale', factor: 0.5 }], ['mesh.curb', { type: 'recolor', color: '#00ff00' }],
    // hostile cases: nothing matches / wrong arguments
    ['.item-box', { type: 'move', dx: 2 }],                                  // plausible partial call: omitted axes default to 0
    ['.tree', { type: 'scale', factor: 'big' }], ['.checkpoint', { type: 'rotate', axis: 'y', degrees: 'quarter' }], ['.boost-pad', { type: 'duplicate', dx: 'x', dy: 0, dz: 0 }],
    ['.tree', { type: 'scale' }],                                            // required argument missing
    ['#NoSuchThing', { type: 'move', dx: 1, dy: 0, dz: 0 }], ['.no-such-class', { type: 'delete' }], ['.item-box', { type: 'move', dx: 'far', dy: null, dz: undefined }], ['', { type: 'scale', factor: 2 }],
  ];
  // undo ONLY what this case added (never the build's own commands); equal snapshot afterwards = the op was fully undoable
  const restore = (u0) => { let g = 0; while (editor.history.undos.length > u0 && g++ < 60) editor.undo(); return snap() === base; };
  for (const [selector, opJSON] of cases) {
    if (snap() !== base) { res.total.cases.push({ selector, op: opJSON.type, outcome: 'BASELINE LOST BEFORE CASE' }); continue; }
    const before = new Map(); let set = [];
    try { set = $S(selector).nodes || []; } catch (e) { set = []; }
    set.forEach(o => before.set(o, { position: o.position.clone(), scale: o.scale.clone(), quaternion: o.quaternion.clone(), visible: o.visible, mat: o.material && !Array.isArray(o.material) ? { opacity: o.material.opacity, transparent: o.material.transparent, color: o.material.color && o.material.color.getHex() } : null }));
    let threw = null; const u0 = editor.history.undos.length;
    try { op({ ...opJSON, selector }); } catch (e) { threw = String(e.message || e).slice(0, 80); }
    const changed = snap() !== base;
    const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    const corrupt = set.filter(o => o.parent && !(finite(o.position) && finite(o.scale) && Number.isFinite(o.rotation.x + o.rotation.y + o.rotation.z))).length;
    const reached = set.filter(o => (probe[opJSON.type] || (() => true))(o, before.get(o))).length;
    let outcome;
    if (corrupt) outcome = 'CORRUPT (' + corrupt + ' nodes left non-finite)';
    else if (threw) outcome = changed ? 'PARTIAL (threw after a change)' : 'rejected-clean';
    else if (!changed) outcome = set.length === 0 ? 'no-op (empty set)' : 'rejected-clean';
    else outcome = reached === set.length ? 'applied-all' : 'PARTIAL (' + reached + '/' + set.length + ')';
    const undone = restore(u0);                  // undo alone
    let manual = false;
    if (!undone) {                               // the op wasn't (fully) undoable: put the nodes back by hand so later cases start clean
      set.forEach(o => { const b = before.get(o); if (!o.parent) return; o.visible = b.visible; o.position.copy(b.position); o.scale.copy(b.scale); o.quaternion.copy(b.quaternion); if (b.mat) { o.material.opacity = b.mat.opacity; o.material.transparent = b.mat.transparent; o.material.color.setHex(b.mat.color); } });
      manual = snap() === base;
    }
    res.total.cases.push({ selector, op: opJSON.type, matched: set.length, outcome, undoable: undone, baselineRecovered: undone || manual, threw });
  }
  const failures = res.total.cases.filter(c => /^(PARTIAL|CORRUPT|BASELINE)/.test(c.outcome));
  res.total.notUndoable = res.total.cases.filter(c => c.undoable === false).map(c => c.op + ' ' + c.selector);
  res.total.pass = failures.length === 0; res.total.failures = failures.length;
  res.pass = res.addressable.pass && res.enumerable.pass && res.total.pass;
  window.__c1verify = res;
  return { pass: res.pass, addressable: res.addressable.pass, enumerable: res.enumerable.pass, total: res.total.pass };
})()
