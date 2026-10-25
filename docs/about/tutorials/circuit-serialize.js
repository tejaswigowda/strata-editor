// Serialises the current scene to a DETERMINISTIC editor-project JSON string: the same shape as
// editor.toJSON() with the fields that vary by session pinned (viewport camera uuid, project config,
// undo history). Run after build.js. Returns a Promise of the string; the caller hashes / writes it.
// The editor fills userData.descriptors asynchronously after a build, so wait until that count stops changing,
// otherwise the output depends on how soon this runs.
(async () => {
  const described = () => { let n = 0; editor.scene.traverse(o => { if (o.userData && o.userData.descriptors) n++; }); return n; };
  let last = -1, stable = 0;
  for (let i = 0; i < 120 && stable < 4; i++) { await new Promise(r => setTimeout(r, 500)); const n = described(); stable = n === last && n > 0 ? stable + 1 : 0; last = n; }
  const j = editor.toJSON();
  const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 4000);
  cam.name = 'Edit Camera'; cam.uuid = 'circuit1-edit-camera';
  cam.position.set(-30, 230, 270); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const out = {
    metadata: { generator: 'Circuit1 build.js', version: 1 },
    project: { shadows: true, shadowType: 1, toneMapping: 0, toneMappingExposure: 1 },
    camera: cam.toJSON(),
    controls: { center: [0, 0, 0] },
    scene: j.scene,
    animations: [],
    scripts: {},
    history: { undos: [], redos: [] },
    backgroundType: j.backgroundType,
    environmentType: j.environmentType,
  };
  return JSON.stringify(out);
})()
