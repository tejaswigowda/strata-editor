// ═══════════════════════════════════════════════════════════════════════════════
// Circuit1 — an original racing circuit, authored end to end by this script.
//
// Paste into the Strata Shell (or run with the Shell's scope). Everything here is
// original: geometry is computed from the corner list below, colours are vertex
// colours, there are no textures and no external assets. Units are metres.
//
// Names and classes are given AT CREATION (see make()). There is no labelling pass.
// The DSL has no create-object operation, so make() is the one creation primitive;
// everything after creation goes through $S (see "DSL passes" at the end).
//
// Deterministic: all randomness comes from the seeded generators below; two runs
// produce byte-identical JSON.
// ═══════════════════════════════════════════════════════════════════════════════
(async () => {
  const SEED = 20241024;           // layout randomness (shrubs, crowd, containers)
  const UUID_SEED = 7777;          // uuid generation, so serialized output is stable
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rand = mulberry(SEED);
  const realRandom = Math.random;
  Math.random = mulberry(UUID_SEED);
  const t0 = performance.now();

  const stats = { created: 0, dsl: {}, dslCalls: 0 };
  const dsl = (selector, kind, ...args) => { stats.dsl[kind] = (stats.dsl[kind] || 0) + 1; stats.dslCalls++; return $S(selector)[kind](...args); };

  try {
    // ── 1. THE LAP: thirteen corners, authored. Right turn = positive (x east, z south). ──
    // sequence by corner:  L L R R R R L L L R R R R   → 8 right, 5 left
    const P = [[-58,-40],[36,-30],[84,-74],[146,-56],[164,6],[128,60],[72,24],[22,12],[-30,30],[-66,70],[-126,66],[-166,18],[-122,-72]];
    const ROAD_W = 14.5, VERGE_W = 7, CURB_W = 1.2, R_MAX = 70;
    const n = P.length;

    const unit = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l, l]; };
    const corners = P.map((p, i) => {
      const prev = P[(i + n - 1) % n], next = P[(i + 1) % n];
      const [d0x, d0z, l0] = unit(prev, p), [d1x, d1z, l1] = unit(p, next);
      const turn = Math.atan2(d0x * d1z - d0z * d1x, d0x * d1x + d0z * d1z);   // + = right
      const phi = Math.abs(turn), sgn = Math.sign(turn);
      const tanHalf = Math.tan(phi / 2);
      const r = Math.min(R_MAX, 0.45 * Math.min(l0, l1) / tanHalf), t = r * tanHalf;
      const A = [p[0] - d0x * t, p[1] - d0z * t], B = [p[0] + d1x * t, p[1] + d1z * t];
      const inN = sgn > 0 ? [-d0z, d0x] : [d0z, -d0x];
      return { i, p, d0: [d0x, d0z], d1: [d1x, d1z], phi, sgn, r, t, A, B, C: [A[0] + inN[0] * r, A[1] + inN[1] * r] };
    });
    const balance = { right: corners.filter(c => c.sgn > 0).length, left: corners.filter(c => c.sgn < 0).length };
    if (Math.min(...corners.map(c => c.r)) < ROAD_W / 2 + CURB_W + 2) throw new Error('corner radius too tight for the road width');

    // centreline samples: straight before each corner, then its arc. s = metres along the lap.
    const pts = [], runs = [];
    let s = 0;
    const push = (x, z, tx, tz) => { pts.push({ x, z, tx, tz, s }); };
    corners.forEach((c, i) => {
      const from = corners[(i + n - 1) % n].B, len = Math.hypot(c.A[0] - from[0], c.A[1] - from[1]);
      const steps = Math.max(1, Math.ceil(len / 12)), [dx, dz] = c.d0;
      runs.push({ corner: i, s0: s, len, dir: [dx, dz], from });
      for (let k = 0; k < steps; k++) { push(from[0] + dx * len * k / steps, from[1] + dz * len * k / steps, dx, dz); s += len / steps; }
      const arcLen = c.r * c.phi, asteps = Math.max(3, Math.ceil(arcLen / 3)), a0 = Math.atan2(c.A[1] - c.C[1], c.A[0] - c.C[0]);
      for (let k = 0; k < asteps; k++) {
        const u = k / asteps, a = a0 + c.sgn * c.phi * u, h = c.sgn * c.phi * u;
        push(c.C[0] + c.r * Math.cos(a), c.C[1] + c.r * Math.sin(a), c.d0[0] * Math.cos(h) - c.d0[1] * Math.sin(h), c.d0[0] * Math.sin(h) + c.d0[1] * Math.cos(h));
        s += arcLen / asteps;
      }
    });
    const LAP = s, N = pts.length;
    const frameAt = (sq) => {                      // position + tangent at distance sq along the lap
      sq = ((sq % LAP) + LAP) % LAP;
      let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].s <= sq) lo = m; else hi = m - 1; }
      const a = pts[lo], b = pts[(lo + 1) % N], sb = lo + 1 < N ? b.s : LAP, u = (sq - a.s) / Math.max(1e-6, sb - a.s);
      let tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tx, tz };
    };
    const distToLap = (x, z) => { let d = 1e9; for (let k = 0; k < N; k++) d = Math.min(d, Math.hypot(pts[k].x - x, pts[k].z - z)); return d; };

    // ── 2. TERRAIN HEIGHT: gentle rolling relief, flat toward the edges ──
    const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const H = (x, z) => (3.2 * Math.sin(x / 62 + 0.6) * Math.cos(z / 58) + 1.6 * Math.sin((x + z) / 37)) * (1 - smooth(70, 98, Math.abs(z)));

    // ── 3. GEOMETRY HELPERS ──
    const col = (hex) => new THREE.Color(hex);
    const withColor = (g, hex) => { const c = col(hex), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const merge = (list) => {                      // list of BufferGeometry (with a color attribute) → one indexed BufferGeometry
      const pos = [], nor = [], uv = [], clr = [], idx = []; let off = 0;
      for (const g of list) {
        const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
        for (let i = 0; i < p.count; i++) {
          pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(nn.getX(i), nn.getY(i), nn.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
          clr.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
        off += p.count;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3)); out.setIndex(idx);
      return out;
    };
    const box = (w, h, d, x, y, z, hex, ry = 0) => withColor(new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z), hex);
    const cyl = (rt, rb, h, seg, x, y, z, hex) => withColor(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), hex);
    const rightOf = (p) => [-p.tz, p.tx];

    // a strip along the lap between two lateral offsets (positive = right of travel); one quad per sample
    const ribbon = (o0, o1, dy, colorOf) => {
      const pos = [], uv = [], clr = [], idx = [];
      for (let k = 0; k < N; k++) {
        const p = pts[k], r = rightOf(p), c = col(colorOf ? colorOf(k) : '#ffffff');
        for (const o of [o0, o1]) { const x = p.x + r[0] * o, z = p.z + r[1] * o; pos.push(x, H(x, z) + dy, z); clr.push(c.r, c.g, c.b); }
        uv.push(0, p.s / 10, 1, p.s / 10);
      }
      for (let k = 0; k < N; k++) { const a = 2 * k, b = 2 * ((k + 1) % N); idx.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
      g.setIndex(idx); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
      return g;
    };

    // ── 4. MATERIALS: ten, shared, no textures. Names carry an M_ prefix: strata-play selectors also match material names, so a bare 'Trigger' or 'Sea' would collide with the class of the same name. ──
    const mat = (name, o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o }); m.name = name; return m; };
    const M = {
      Asphalt: mat('M_Asphalt', { color: 0x3a3d42, roughness: 0.95 }),
      Grass: mat('M_Grass', { color: 0x4f8a3c, roughness: 1 }),
      Paint: mat('M_Paint', { vertexColors: true, roughness: 0.8 }),
      Sea: mat('M_Sea', { color: 0x1d6f9e, roughness: 0.08, metalness: 0.2 }),
      Concrete: mat('M_Concrete', { color: 0x9a9a94, roughness: 0.95 }),
      Glass: mat('M_Glass', { color: 0x7fd6ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.35 }),
      PickupCore: mat('M_PickupCore', { color: 0xffb020, emissive: 0xff7a00, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.5 }),
      Boost: mat('M_Boost', { color: 0x19d3ff, emissive: 0x0a8fb8, emissiveIntensity: 0.8, roughness: 0.4 }),
      Trigger: mat('M_GateVolume', { color: 0xff3df2, transparent: true, opacity: 0.14, roughness: 1, side: THREE.DoubleSide, depthWrite: false }),
      Sun: new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
    };
    M.Sun.name = 'M_Sun';

    // ── 5. make(): THE creation primitive. id, classes and parent are given here, once. ──
    const make = (id, classes, geometry, material, parent, pos, ry) => {
      const o = geometry ? new THREE.Mesh(geometry, material) : new THREE.Group();
      o.name = id; o.userData.label = id; o.userData.customClasses = classes.split(' ');
      if (pos) o.position.set(pos[0], pos[1], pos[2]);
      if (ry) o.rotation.y = ry;
      if (parent) parent.add(o);
      stats.created++;
      return o;
    };
    const two = (v) => String(v).padStart(2, '0');
    const yawOf = (p) => Math.atan2(p.tx, p.tz);                      // local +z along the lap tangent
    const fwd = (o) => { o.userData.forward = '+z'; return o; };       // convention note carried to the export (extras.forward)

    // ── 6. SCENE ROOTS ──
    const circuit = make('Circuit1', 'course');
    const track = make('Track', 'surface', null, null, circuit);
    const trackside = make('Trackside', 'trackside', null, null, circuit);
    const environment = make('Environment', 'scenery', null, null, circuit);
    const gameplay = make('Gameplay', 'gameplay');                    // world-space, identity transform

    // ── 7. TRACK ──
    make('Road', 'surface road drivable', ribbon(-ROAD_W / 2, ROAD_W / 2, 0.03), M.Asphalt, track);

    const dashes = [];                                                // dashed centre line
    for (let sq = 0; sq < LAP; sq += 9) {
      const a = frameAt(sq), b = frameAt(sq + 3), r = rightOf(a);
      const q = [[-0.18, a], [0.18, a], [-0.18, b], [0.18, b]].map(([o, f]) => { const x = f.x + r[0] * o, z = f.z + r[1] * o; return [x, H(x, z) + 0.06, z]; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3)); g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) g.setIndex([0, 2, 1, 1, 2, 3]), g.computeVertexNormals();
      dashes.push(withColor(g, '#f4f1e6'));
    }
    make('RoadMarkings', 'surface road', merge(dashes), M.Paint, track);

    const verge = merge([ribbon(ROAD_W / 2, ROAD_W / 2 + VERGE_W, 0.0), ribbon(-ROAD_W / 2 - VERGE_W, -ROAD_W / 2, 0.0)].map(g => withColor(g, '#58a043')));
    make('Verge', 'surface grass offroad', verge, M.Paint, track);

    const runsStartOfArc = (c) => runs[c.i].s0 + runs[c.i].len;      // arc i starts where straight i ends
    const curbs = [];                                                 // red/white kerbs on the inside of every corner
    corners.forEach((c) => {
      if (c.phi < 0.3) return;
      const inside = c.sgn * (ROAD_W / 2);
      const s0 = runsStartOfArc(c), arc = c.r * c.phi, count = Math.max(2, Math.round(arc / 2.5));
      for (let k = 0; k < count; k++) {
        const a = frameAt(s0 + arc * k / count), b = frameAt(s0 + arc * (k + 1) / count), ra = rightOf(a), rb = rightOf(b);
        const o0 = inside, o1 = inside + c.sgn * CURB_W;
        const q = [[o0, a, ra], [o1, a, ra], [o0, b, rb], [o1, b, rb]].map(([o, f, r]) => { const x = f.x + r[0] * o, z = f.z + r[1] * o; return [x, H(x, z) + 0.07, z]; });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3)); g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals();
        if (g.attributes.normal.getY(0) < 0) g.setIndex([0, 2, 1, 1, 2, 3]), g.computeVertexNormals();
        curbs.push(withColor(g, k % 2 ? '#f2f2f2' : '#d62828'));
      }
    });
    make('Curbs', 'surface curb', merge(curbs), M.Paint, track);

    const startRun = runs[1], startS = startRun.s0 + startRun.len * 0.3;   // start line on the straight before corner 1
    {
      const f = frameAt(startS), checker = [];
      for (let row = 0; row < 2; row++) for (let c = 0; c < 14; c++) {
        const o = -ROAD_W / 2 + (c + 0.5) * (ROAD_W / 14), along = (row - 0.5) * 1.0, r = rightOf(f);
        const x = f.x + r[0] * o + f.tx * along, z = f.z + r[1] * o + f.tz * along;
        checker.push(withColor(new THREE.PlaneGeometry(ROAD_W / 14, 1.0).rotateX(-Math.PI / 2).rotateY(yawOf(f)).translate(x, H(x, z) + 0.09, z), (row + c) % 2 ? '#101010' : '#f5f5f5'));
      }
      make('StartLineStripe', 'surface road', merge(checker), M.Paint, track);
    }

    // terrain: a plane that follows the same height function
    {
      const g = new THREE.PlaneGeometry(400, 210, 40, 21).rotateX(-Math.PI / 2), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)) - 0.12);
      g.computeVertexNormals();
      make('Terrain', 'surface grass offroad', g, M.Grass, track);
    }

    // ── 8. ENVIRONMENT: a working harbour ──
    make('Sea', 'scenery water', new THREE.PlaneGeometry(900, 170).rotateX(-Math.PI / 2), M.Sea, environment, [0, -0.8, 190]);
    make('Quay', 'scenery', new THREE.BoxGeometry(400, 2, 14).translate(0, -0.2, 0), M.Concrete, environment, [0, 0, 98]);

    // container stacks: 4 colours x 3 heights, each geometry defined once and placed many times
    const boxColours = ['#c0392b', '#2471a3', '#d4a017', '#2e8b57'];
    const stackGeo = boxColours.map(hex => [1, 2, 3].map(h => merge(Array.from({ length: h }, (_, k) => box(12, 2.6, 2.4, 0, 1.3 + k * 2.6, 0, hex)))));
    let stack = 0;
    for (const zRow of [94.5, 100.5]) for (let x = -186; x <= 186; x += 13) {
      if (rand() < 0.25 || Math.abs(x + 60) < 12) continue;
      stack++; make('ContainerStack' + two(stack), 'trackside wall', stackGeo[Math.floor(rand() * 4)][Math.floor(rand() * 3)], M.Paint, trackside, [x, 0.8, zRow]);
    }

    {                                                                  // quay crane
      const parts = [box(2, 30, 2, -8, 15, -5, '#c27c0e'), box(2, 30, 2, 8, 15, -5, '#c27c0e'), box(2, 30, 2, -8, 15, 5, '#c27c0e'), box(2, 30, 2, 8, 15, 5, '#c27c0e'), box(20, 3, 14, 0, 30, 0, '#c27c0e'), box(4, 2.4, 60, 0, 33, 18, '#c27c0e')];
      make('QuayCrane', 'scenery landmark', merge(parts), M.Paint, environment, [-60, 0.8, 92]);
    }
    {                                                                  // lighthouse: banded tower, lantern, roof
      const bands = [0, 1, 2, 3].map(k => cyl(3.6 - k * 0.35, 3.95 - k * 0.35, 6, 12, 0, 3 + k * 6, 0, k % 2 ? '#f2f2f2' : '#c0392b'));
      const top = [cyl(2.6, 2.6, 3, 12, 0, 26.5, 0, '#e8e2b0'), withColor(new THREE.ConeGeometry(3.2, 3.2, 12).translate(0, 29.6, 0), '#2b2b2b')];
      make('Lighthouse', 'scenery landmark building', merge([...bands, ...top]), M.Paint, environment, [182, 0.8, 97]);
    }

    // grandstand + crowd, beside the start straight (local +x = left of travel, +z = along travel)
    {
      const f = frameAt(startS), left = [-rightOf(f)[0], -rightOf(f)[1]], gx = f.x + left[0] * 26, gz = f.z + left[1] * 26;
      const stand = make('Grandstand', 'trackside grandstand', null, null, trackside, [gx, H(gx, gz), gz], yawOf(f));
      const tiers = [], people = [], palette = ['#e63946', '#f1c40f', '#3498db', '#ecf0f1', '#2ecc71', '#9b59b6', '#ff8c42'];
      for (let k = 0; k < 4; k++) {
        const h = 1.1 * (k + 1);
        tiers.push(box(3.2, h + 5, 84, k * 3.2, (h - 5) / 2, 0, '#8e8e88'));
        for (let c = 0; c < 30; c++) people.push(box(0.6, 1.1, 0.5, k * 3.2 + 0.4, h + 0.55, -40 + c * 2.7 + (rand() - 0.5) * 0.6, palette[Math.floor(rand() * palette.length)]));
      }
      tiers.push(box(18, 0.5, 86, 5, 8.4, 0, '#d8d8d0'), ...[-40, -14, 14, 40].map(z => box(0.6, 8, 0.6, 14, 4.1, z, '#59636e')));
      make('GrandstandSeats', 'trackside grandstand', merge(tiers), M.Paint, stand);
      make('Crowd', 'crowd spectators', merge(people), M.Paint, stand);
    }

    {                                                                  // pit garage in the infield
      const parts = [box(40, 4.5, 10, 0, 0.0, 0, '#b9b9b2')];
      for (let d = 0; d < 6; d++) parts.push(box(4.6, 3.2, 0.4, -16.5 + d * 6.6, -0.4, 5.1, '#3b4a5a'));
      make('PitGarage', 'trackside building', merge(parts), M.Paint, trackside, [-5, H(-5, -12) + 0.5, -12]);
    }

    {                                                                  // start gantry
      const f = frameAt(startS), r = rightOf(f), half = ROAD_W / 2 + 2.2;
      const parts = [box(0.8, 9, 0.8, -half, 4.5, 0, '#59636e'), box(0.8, 9, 0.8, half, 4.5, 0, '#59636e'), box(2 * half, 2.2, 0.6, 0, 8.2, 0, '#f4c430'), box(2 * half - 3, 1.2, 0.7, 0, 8.2, 0, '#1d3557')];
      make('Gantry', 'signage billboard', merge(parts), M.Paint, trackside, [f.x, H(f.x, f.z), f.z], yawOf(f));
    }

    {                                                                  // flags along the start straight
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const f = frameAt(startS + (k - 3.5) * 9), r = rightOf(f), side = k % 2 ? 1 : -1, x = f.x + r[0] * side * (ROAD_W / 2 + 4), z = f.z + r[1] * side * (ROAD_W / 2 + 4);
        parts.push(box(0.15, 7, 0.15, x, H(x, z) + 3.5, z, '#cfcfcf'), box(0.08, 1.4, 2.2, x, H(x, z) + 6.2, z + 1.1, ['#e63946', '#f1c40f', '#3498db', '#2ecc71'][k % 4]));
      }
      make('Flags', 'trackside flag', merge(parts), M.Paint, trackside);
    }

    {                                                                  // direction boards before the six sharpest corners
      const arrow = (dir) => { const sh = new THREE.Shape(); sh.moveTo(-1, -0.2); sh.lineTo(0.2, -0.2); sh.lineTo(0.2, -0.7); sh.lineTo(1, 0); sh.lineTo(0.2, 0.7); sh.lineTo(0.2, 0.2); sh.lineTo(-1, 0.2); const g = new THREE.ShapeGeometry(sh); g.scale(dir, 1, 1).translate(0, 0, 0.18); if (dir < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); } return g; };
      const boards = { 1: merge([box(4, 2.4, 0.25, 0, 3.4, 0, '#f4c430'), box(0.2, 3, 0.2, -1.6, 1.5, 0, '#59636e'), box(0.2, 3, 0.2, 1.6, 1.5, 0, '#59636e'), withColor(arrow(1).translate(0, 3.4, 0), '#111111')]), '-1': merge([box(4, 2.4, 0.25, 0, 3.4, 0, '#f4c430'), box(0.2, 3, 0.2, -1.6, 1.5, 0, '#59636e'), box(0.2, 3, 0.2, 1.6, 1.5, 0, '#59636e'), withColor(arrow(-1).translate(0, 3.4, 0), '#111111')]) };
      corners.filter(c => c.phi > 0.8).slice(0, 6).forEach((c, k) => {
        const f = frameAt(runsStartOfArc(c) - 28), r = rightOf(f), o = ROAD_W / 2 + 3.5, x = f.x - r[0] * o, z = f.z - r[1] * o;
        make('DirectionBoard' + two(k + 1), 'signage direction-arrow', boards[c.sgn], M.Paint, trackside, [x, H(x, z), z], yawOf(f) + Math.PI);
      });
    }

    {                                                                  // tyre barriers outside the sharpest corners: one geometry, many stacks
      const tyre = merge([cyl(0.55, 0.55, 0.5, 8, 0, 0.25, 0, '#1a1a1c'), cyl(0.55, 0.55, 0.5, 8, 0, 0.75, 0, '#f2f2f2'), cyl(0.55, 0.55, 0.5, 8, 0, 1.25, 0, '#1a1a1c')]);
      let k = 0;
      corners.filter(c => c.phi > 0.8).forEach((c) => {
        const a0 = Math.atan2(c.A[1] - c.C[1], c.A[0] - c.C[0]), out = c.r + ROAD_W / 2 + 2.2;   // outside = away from the corner's centre
        for (let j = 0; j < 6; j++) {
          const a = a0 + c.sgn * c.phi * (0.2 + 0.12 * j), x = c.C[0] + Math.cos(a) * out, z = c.C[1] + Math.sin(a) * out;
          k++; make('TyreStack' + two(k), 'barrier wall', tyre, M.Paint, trackside, [x, H(x, z), z]);
        }
      });
    }

    {                                                                  // bollards along the quay edge
      const parts = []; for (let x = -190; x <= 190; x += 10) parts.push(cyl(0.35, 0.35, 1.0, 8, x, 1.3, 91.2, '#f4c430'));
      make('Bollards', 'trackside', merge(parts), M.Paint, trackside);
    }

    {                                                                  // shrubs, away from the lap and the built-up areas
      const shrub = [0, 1, 2].map(v => merge([cyl(0.25, 0.3, 1.6, 6, 0, 0.8, 0, '#6b4a2f'), withColor(new THREE.IcosahedronGeometry(1.6 + v * 0.3, 0).translate(0, 2.6 + v * 0.2, 0), ['#3f7d32', '#4f9a3c', '#2f6a2b'][v])]));
      let k = 0, tries = 0;
      while (k < 36 && tries++ < 4000) {
        const x = (rand() - 0.5) * 380, z = -100 + rand() * 178;
        if (distToLap(x, z) < 24 || (z > 84) || (Math.abs(x) < 42 && z < -50 && z > -80) || (Math.abs(x + 5) < 26 && Math.abs(z + 12) < 14)) continue;
        k++; make('Shrub' + two(k), 'scenery tree', shrub[Math.floor(rand() * 3)], M.Paint, environment, [x, H(x, z), z]);
      }
    }

    {                                                                  // distant hills (backdrop), sitting on the world's edge so the horizon closes
      const hill = withColor(new THREE.ConeGeometry(52, 30, 7).translate(0, 15, 0), '#6c8f5a');
      const spots = [];
      for (let x = -200; x <= 200; x += 50) spots.push([x + (rand() - 0.5) * 14, -112 - rand() * 10]);       // north edge
      for (const z of [-80, -30, 20, 70]) spots.push([-212 - rand() * 8, z], [212 + rand() * 8, z]);          // west and east edges
      spots.forEach(([x, z], k) => make('DistantHill' + two(k + 1), 'scenery backdrop mountain', hill, M.Paint, environment, [x, -3, z], k * 0.7));
    }
    make('Sun', 'effect sun', new THREE.SphereGeometry(16, 16, 12), M.Sun, environment, [-230, 130, -300]);

    // ── 9. GAMEPLAY: what a downstream engine wires. All in world space. ──
    const lanes = (count) => Array.from({ length: count }, (_, k) => (k - (count - 1) / 2) * 3.4);   // lateral offsets, 3.4 m apart
    const straights = runs.map((r, i) => ({ i, s0: r.s0, len: r.len - 0 })).filter(r => r.i !== 1).sort((a, b) => b.len - a.len);
    const rowRuns = straights.slice(1, 6).sort((a, b) => a.s0 - b.s0), boostRuns = [straights[0], straights[6], straights[7]];

    // item box: one definition (shell, core, question mark), placed N times
    const shellGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7), coreGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8).rotateY(Math.PI / 4);
    const markGeo = merge([withColor(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-0.28, 0.32, 0], [-0.2, 0.5, 0], [0, 0.58, 0], [0.22, 0.5, 0], [0.28, 0.3, 0], [0.12, 0.1, 0], [0, -0.05, 0], [0, -0.18, 0]].map(v => new THREE.Vector3(...v))), 12, 0.07, 5), '#ffffff'), withColor(new THREE.SphereGeometry(0.09, 5, 4).translate(0, -0.36, 0), '#ffffff')]);
    const itemBoxes = make('ItemBoxes', 'pickup-set', null, null, gameplay);
    const rowSizes = [3, 4, 4, 4, 3]; let boxNo = 0;
    rowRuns.forEach((run, row) => {
      const f = frameAt(run.s0 + run.len / 2), r = rightOf(f);
      lanes(rowSizes[row]).forEach((o) => {
        boxNo++; const id = 'ItemBox' + two(boxNo), x = f.x + r[0] * o, z = f.z + r[1] * o;
        const b = make(id, 'pickup item-box trigger', null, null, itemBoxes, [x, H(x, z) + 1.5, z], yawOf(f));
        make(id + 'Shell', 'item-box-part', shellGeo, M.Glass, b); make(id + 'Core', 'item-box-part', coreGeo, M.PickupCore, b); make(id + 'Question', 'item-box-part', markGeo, M.PickupCore, b, [0, 0, 0.9]);
      });
    });

    // boost pads: a cluster of three on the longest straight, a single on each of two more
    const padGeo = new THREE.BoxGeometry(2.6, 0.12, 5);
    const boostPads = make('BoostPads', 'pickup-set', null, null, gameplay);
    const padSpots = [[boostRuns[0], 0.34, -3.6], [boostRuns[0], 0.5, 0], [boostRuns[0], 0.66, 3.6], [boostRuns[1], 0.5, 0], [boostRuns[2], 0.5, 0]];
    padSpots.forEach(([run, u, o], k) => {
      const f = frameAt(run.s0 + run.len * u), r = rightOf(f), x = f.x + r[0] * o, z = f.z + r[1] * o;
      make('BoostPad' + two(k + 1), 'pickup boost-pad trigger', padGeo, M.Boost, boostPads, [x, H(x, z) + 0.12, z], yawOf(f));
    });

    // gates: a start line, seven checkpoints, eight grid spawn points
    const gate = new THREE.BoxGeometry(ROAD_W + 4, 5, 1.2);          // one gate definition, placed 8 times
    {
      const f = frameAt(startS); fwd(make('StartLine', 'trigger start-line', gate, M.Trigger, gameplay, [f.x, H(f.x, f.z) + 2.5, f.z], yawOf(f)));
      for (let k = 1; k <= 7; k++) { const c = frameAt(startS + LAP * k / 8); fwd(make('Checkpoint' + two(k), 'trigger checkpoint', gate, M.Trigger, gameplay, [c.x, H(c.x, c.z) + 2.5, c.z], yawOf(c))); }
      for (let k = 0; k < 8; k++) {
        const g = frameAt(startS - 9 - Math.floor(k / 2) * 7 - (k % 2) * 3.5), r = rightOf(g), o = (k % 2 ? 1 : -1) * 3.2, x = g.x + r[0] * o, z = g.z + r[1] * o;
        fwd(make('SpawnPoint' + two(k + 1), 'spawn-point', null, null, gameplay, [x, H(x, z) + 0.3, z], yawOf(g)));
      }
    }

    // racing line: empty nodes down the road centre in driving order, one per ~5 m (nodes, not a line primitive: every engine imports nodes).
    // Each node's local +z is the direction of travel, and the numeric suffix is the order. The last node is followed by the first.
    {
      const count = Math.round(LAP / 5), line = make('RacingLine', 'racing-line', null, null, gameplay);
      for (let k = 0; k < count; k++) {
        const f = frameAt(startS + LAP * k / count);
        fwd(make('RacingLine' + String(k + 1).padStart(3, '0'), 'racing-line-point', null, null, line, [f.x, H(f.x, f.z) + 0.03, f.z], yawOf(f)));
      }
      line.userData.closed = true; line.userData.order = 'ascending suffix = driving direction';
      stats.racingLinePoints = count;
    }
    // lights
    const sunlight = new THREE.DirectionalLight(0xfff1d6, 2.2); sunlight.name = 'Sunlight'; sunlight.userData.label = 'Sunlight'; sunlight.userData.customClasses = ['effect'];
    // glTF lights point down their node's -z, so the export needs a rotation, not just a position
    sunlight.position.set(-150, 220, -120); sunlight.lookAt(0, 0, 0); sunlight.castShadow = true; Object.assign(sunlight.shadow.camera, { left: -230, right: 230, top: 140, bottom: -140, near: 10, far: 600 }); sunlight.shadow.mapSize.set(2048, 2048); stats.created++;
    const sky = new THREE.HemisphereLight(0xbfe3ff, 0x6a7f4a, 0.9); sky.name = 'SkyLight'; sky.userData.label = 'SkyLight'; sky.userData.customClasses = ['effect']; stats.created++;
    environment.add(sunlight, sky);

    // ── 10. INTO THE SCENE: two roots, two commands ──
    editor.execute(new AddObjectCommand(editor, circuit));
    editor.execute(new AddObjectCommand(editor, gameplay));
    editor.scene.userData['strata:logic'] = 'outputs/track.js';       // exported as the glTF scene's extras; strata-play uses it instead of the basename default
    setBackground('#a9d4ee'); setFog('FogExp2', '#cfe3ee', 0, 0, 0.0014);

    // ── 11. DSL PASSES: everything after creation goes through $S ──
    dsl('.surface', 'receiveShadow', true);
    dsl('mesh.scenery', 'castShadow', true);
    dsl('mesh.trackside', 'castShadow', true);
    dsl('.item-box-part', 'castShadow', false);
    dsl('.trigger', 'castShadow', false);
    dsl('.trigger', 'receiveShadow', false);
    dsl('.crowd', 'frustumCulled', false);

    // camera: three-quarter aerial of the whole lap
    const cam = editor.camera; cam.position.set(-30, 230, 270); cam.fov = 42; cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
    editor.controls.center.set(0, 0, 0); editor.signals.cameraChanged.dispatch(cam);

    // ── 12. STATS (for the record) ──
    let tris = 0, roadTris = 0; const matSet = new Set(); const classCount = {}, ids = [];
    editor.scene.traverse((o) => {
      if (o === editor.scene) return;
      if (o.userData.label) ids.push(o.name);
      (o.userData.customClasses || []).forEach(c => { classCount[c] = (classCount[c] || 0) + 1; });
      if (o.isMesh) { const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += t; if (o.name === 'Road') roadTris = t; matSet.add(o.material.uuid); }
    });
    const roadY = pts.map(p => H(p.x, p.z)); const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    stats.layout = {
      corners: n, right: balance.right, left: balance.left, lapMetres: Math.round(LAP),
      extent: [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...zs) - Math.min(...zs))],
      reliefOverLongAxis: +((Math.max(...roadY) - Math.min(...roadY)) / (Math.max(...xs) - Math.min(...xs))).toFixed(4),
      laneOverLongAxis: +(ROAD_W / (Math.max(...xs) - Math.min(...xs))).toFixed(4),
      terrainOverTrack: [+(400 / (Math.max(...xs) - Math.min(...xs))).toFixed(2), +(210 / (Math.max(...zs) - Math.min(...zs))).toFixed(2)],
    };
    stats.totals = { triangles: Math.round(tris), roadTriangles: roadTris, materials: matSet.size, nodes: ids.length, distinctClasses: Object.keys(classCount).length };
    stats.classCount = classCount; stats.ids = ids;
    stats.buildMs = Math.round(performance.now() - t0);
    window.__c1stats = stats;
    return stats.totals;
  } finally {
    Math.random = realRandom;
  }
})()
