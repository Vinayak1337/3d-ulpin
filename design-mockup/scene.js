import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888';
const FW = 24, FD = 16;
const FLOORS = [];
FLOORS.push({ id: 'B2', y0: -6.6, y1: -3.3, below: true, est: true });
FLOORS.push({ id: 'B1', y0: -3.3, y1: 0, below: true });
FLOORS.push({ id: 'G', y0: 0.4, y1: 3.4, stilt: true });
for (let i = 1; i <= 8; i++) FLOORS.push({ id: 'F' + i, y0: 0.4 + 3 * i, y1: 3.4 + 3 * i });
FLOORS.push({ id: 'Roof', y0: 27.4, y1: 28.4, roof: true });
const FL = Object.fromEntries(FLOORS.map(f => [f.id, f]));
const UNITS = [
  [-12, -4, 1.2, 8, '01', 'ex'], [-4, 4, 1.2, 8, '02', 'ex'], [4, 12, 1.2, 8, '03', 'ex'],
  [-12, -4, -8, -1.2, '04', 'ex'], [-4, 4, -8, -1.2, '05', 'ex'], [4, 12, -8, -1.2, '06', 'ex'],
  [-12, -9, -1.2, 1.2, 'Stair S1', 'sh'], [-9, -7, -1.2, 1.2, 'Lift L1', 'sh'], [-7, 12, -1.2, 1.2, 'Corridor', 'sh']
];
const CONTEXT = [
  [-20, 58, 18, 14, 15], [5, 56, 14, 16, 24], [25, 60, 12, 12, 9], [-24, 90, 20, 16, 30], [6, 88, 16, 12, 12], [24, 92, 10, 14, 18],
  [62, -2, 18, 22, 21], [66, 58, 16, 14, 12], [64, 92, 20, 14, 27], [90, 20, 14, 18, 9], [92, -30, 16, 14, 15], [62, -44, 18, 16, 33],
  [-22, -36, 16, 14, 18], [4, -38, 18, 14, 12], [24, -34, 12, 12, 24], [-18, -72, 20, 18, 9], [10, -74, 16, 16, 21],
  [-64, -6, 18, 20, 12], [-62, -44, 16, 14, 27], [-90, -40, 14, 14, 15], [-66, 22, 14, 12, 9]
];
const ease = t => 1 - Math.pow(1 - t, 3);

function hatchTex(base, line, dense) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = line; g.lineWidth = dense ? 5 : 3;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rectLoop(x0, x1, z0, z1, y) { return [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0]; }
function lines(arr, mat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return new THREE.LineSegments(g, mat); }
function boxAt(x0, x1, y0, y1, z0, z1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return m;
}
function withEdges(mesh, mat) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), mat); mesh.add(e); mesh.userData.edges = e; return mesh; }

class ULSceneImpl {
  init(host, { onPick } = {}) {
    this.host = host; this.onPick = onPick || (() => {});
    this.state = { mode: 'area', sel: 'bldg', floor: 'F7', unit: null, view: '3D', render: 'Model' };
    this.importN = null;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(r.domElement); r.domElement.style.display = 'block';
    this.labelLayer = document.createElement('div');
    Object.assign(this.labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    host.appendChild(this.labelLayer);
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    this.camera.position.set(95, 80, 120);
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.target.set(0, 6, 0); c.enableDamping = true; c.dampingFactor = 0.08; c.maxPolarAngle = Math.PI * 0.62; c.minDistance = 8; c.maxDistance = 420;
    c.addEventListener('start', () => { this.tween = null; });
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xcfd6d4, 1.25); s.add(this.hemi);
    const d = this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    d.position.set(-90, 140, 100); d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
    Object.assign(d.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 420 }); d.shadow.bias = -0.0005; d.shadow.normalBias = 0.4;
    s.add(d);
    this.makeMaterials(); this.build(); this.labelsInit();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    let down = null;
    r.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    r.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) this.pick(e); down = null; });
    r.domElement.addEventListener('pointermove', e => this.hover(e));
    this.clock = performance.now();
    this.last = 0;
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); }; loop();
    setInterval(() => { if (performance.now() - this.last > 120) this.frame(); }, 60);
    this.apply(true);
    return this;
  }
  makeMaterials() {
    const M = this.M = {};
    const std = o => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
    const basic = o => new THREE.MeshBasicMaterial(o);
    const line = o => new THREE.LineBasicMaterial(o);
    M.ground = std({ transparent: true }); M.road = std({}); M.pub = std({}); M.water = std({ roughness: 0.4 });
    M.bldg = std({}); M.sel = std({}); M.ghost = basic({ transparent: true, opacity: 0.1, depthWrite: false });
    M.halo = basic({ side: THREE.BackSide }); M.edge = line({}); M.ghostEdge = line({ transparent: true, opacity: 0.5 });
    M.unitEdge = line({ transparent: true, opacity: 0.9 }); M.inkEdge = line({});
    M.ex = std({}); M.sh = std({}); M.pubR = std({});
    M.hatch = std({}); M.crit = basic({});
    M.pipe = std({ roughness: 0.35, metalness: 0.1 }); M.corr = std({ transparent: true, opacity: 0.42, depthWrite: false });
    M.soil = basic({ transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }); M.soilEdge = line({ transparent: true, opacity: 0.6 });
    M.col = basic({ transparent: true, opacity: 0.14, depthWrite: false }); M.colEdge = line({});
    M.dash = new THREE.LineDashedMaterial({ dashSize: 0.8, gapSize: 0.5 }); M.unk = basic({ transparent: true, opacity: 0.7, depthWrite: false });
    M.parcel = line({ transparent: true, opacity: 0.7 }); M.ctxEdge = line({ transparent: true });
    this.ctxMats = []; this.ctxEdges = [];
  }
  colours() {
    const M = this.M, C = n => new THREE.Color(cssv(n));
    const ground = C('--map-ground');
    this.scene.background = ground; this.scene.fog = new THREE.Fog(ground, 260, 620);
    M.ground.color = ground; M.road.color = C('--map-road'); M.pub.color = C('--map-public-land'); M.water.color = C('--map-water');
    M.bldg.color = C('--map-building'); M.sel.color = C('--primary'); M.ghost.color = C('--map-building-edge');
    M.halo.color = C('--map-halo'); M.edge.color = C('--map-building-edge'); M.ghostEdge.color = C('--map-building-edge');
    M.unitEdge.color = C('--map-halo'); M.inkEdge.color = C('--ink');
    M.ex.color = C('--rights-exclusive'); M.sh.color = C('--rights-shared'); M.pubR.color = C('--rights-public');
    M.hatch.map?.dispose(); M.hatch.map = hatchTex(cssv('--map-building'), cssv('--map-building-edge')); M.hatch.needsUpdate = true;
    M.crit.map?.dispose(); M.crit.map = hatchTex(cssv('--mark-critical'), cssv('--map-halo'), true); M.crit.needsUpdate = true;
    M.pipe.color = C('--utility-water'); M.corr.color = C('--rights-public');
    M.soil.color = C('--soil-top'); M.soilEdge.color = C('--soil-deep');
    M.col.color = C('--primary'); M.colEdge.color = C('--primary'); M.dash.color = C('--primary');
    M.unk.map?.dispose(); M.unk.map = hatchTex(cssv('--readiness-unknown'), cssv('--map-halo')); M.unk.map.repeat.set(6, 1); M.unk.needsUpdate = true;
    if (this.layers?.ortho) M.ground.color = new THREE.Color('#ffffff');
    this.aiItems?.forEach(a => a.m.color = C('--primary'));
    M.parcel.color = C('--map-parcel-line'); M.ctxEdge.color = C('--map-building-edge');
    this.cG = C('--map-ground'); this.cB = C('--map-building'); this.cG.lerp(this.cB, 0.35); this.ctxEdges.forEach(m => m.color = C('--map-building-edge'));
    const dark = document.documentElement.dataset.theme === 'dark';
    this.hemi.intensity = dark ? 1.1 : 1.6; this.sun.intensity = dark ? 1.0 : 1.35;
    this.hemi.groundColor = dark ? new THREE.Color('#0e1719') : new THREE.Color('#cfd6d4');
  }
  build() {
    const s = this.scene, M = this.M;
    const g = this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.ground);
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g);
    const flat = (x0, x1, z0, z1, y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; s.add(m); return m; };
    this.flats = [
      flat(-400, 400, 24, 36, 0.02, M.road), flat(-40, 40, -17, -11, 0.02, M.road),
      flat(-45, -35, -400, 400, 0.021, M.road), flat(35, 45, -400, 400, 0.021, M.road),
      flat(-33, -19, -4, 20, 0.02, M.pub), flat(78, 128, -100, -60, 0.02, M.pub), flat(-150, -60, 40, 120, 0.019, M.pub)
    ];
    const lake = new THREE.Mesh(new THREE.CircleGeometry(30, 64), M.water);
    lake.rotation.x = -Math.PI / 2; lake.scale.set(1.3, 0.85, 1); lake.position.set(-104, 0.03, 80); lake.receiveShadow = true; s.add(lake); this.flats.push(lake);
    const pl = [...rectLoop(-18, 18, -10.5, 23, 0.06)];
    CONTEXT.forEach(([x, z, w, d]) => pl.push(...rectLoop(x - w / 2 - 4, x + w / 2 + 4, z - d / 2 - 4, z + d / 2 + 4, 0.06)));
    this.parcels = lines(pl, M.parcel); s.add(this.parcels);
    this.ctx = CONTEXT.map(([x, z, w, d, h], i) => {
      const mat = M.bldg.clone(); this.ctxMats.push(mat);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
      const arr = []; const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
      for (let y = 3; y <= h + 0.01; y += 3) arr.push(...rectLoop(x0, x1, z0, z1, y - h / 2));
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([a, b]) => arr.push(a, -h / 2, b, a, h / 2, b));
      const em = M.ctxEdge.clone(); this.ctxEdges.push(em); m.add(lines(arr, em)); m.userData = { em, cur: 1, target: 1 };
      s.add(m); return m;
    });
    const R = this.res = new THREE.Group(); s.add(R); this.storeys = {};
    FLOORS.forEach(f => {
      if (f.below) return;
      const grp = new THREE.Group(); grp.userData.floor = f.id; const parts = [];
      if (f.stilt) {
        parts.push(boxAt(-12, 12, 3.1, 3.4, -8, 8, M.bldg));
        for (const x of [-11.6, -4, 4, 11.6]) for (const z of [-7.6, 7.6]) parts.push(boxAt(x - 0.35, x + 0.35, 0, 3.1, z - 0.35, z + 0.35, M.bldg));
      } else if (f.roof) {
        [[-12, 12, -8, -7.7], [-12, 12, 7.7, 8], [-12, -11.7, -8, 8], [11.7, 12, -8, 8]].forEach(([a, b, c, d]) => parts.push(boxAt(a, b, 27.4, 28.4, c, d, M.bldg)));
      } else parts.push(boxAt(-12, 12, f.y0, f.y1 - 0.02, -8, 8, M.bldg));
      parts.forEach(p => { withEdges(p, M.edge); p.castShadow = p.receiveShadow = true; p.userData.pick = 'bldg'; grp.add(p); });
      grp.userData.parts = parts; this.storeys[f.id] = grp; R.add(grp);
    });
    this.basements = {};
    FLOORS.filter(f => f.below).forEach(f => { const b = withEdges(boxAt(-14, 14, f.y0, f.y1 - 0.05, -10, 10, f.est ? M.hatch : M.bldg), M.edge); b.userData.pick = 'bldg'; b.userData.floor = f.id; this.basements[f.id] = b; R.add(b); });
    this.halo = boxAt(-12.5, 12.5, -0.1, 28.9, -8.5, 8.5, M.halo); this.halo.renderOrder = -1; R.add(this.halo);
    const roof = this.rooftop = new THREE.Group();
    roof.add(withEdges(boxAt(-12, -0.2, 27.4, 30.4, -5, 5, M.crit), M.inkEdge));
    roof.add(withEdges(boxAt(4, 7, 27.4, 30.4, -3, 0, M.bldg), M.edge));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 24), M.bldg); tank.position.set(9, 28.4, 3); roof.add(tank);
    roof.visible = false; R.add(roof);
    this.unitHalo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.halo); this.unitHalo.visible = false; R.add(this.unitHalo);
    this.unitGroups = {};
    const F = this.findings = new THREE.Group(); s.add(F);
    const f101 = withEdges(boxAt(-12, -4, 3.4, 6.5, 1.2, 8, M.ghost), M.inkEdge);
    const x201 = -4 - 32 / 6.8;
    const f201 = withEdges(boxAt(x201, x201 + 8, 6.3, 9.4, 1.2, 8, M.ghost), M.inkEdge);
    const ov = boxAt(x201, -4, 6.3, 6.5, 1.2, 8, M.crit);
    F.add(f101, f201, ov); F.visible = false; this.ovPos = new THREE.Vector3((x201 - 4) / 2, 6.5, 4.6);
    const U = this.ug = new THREE.Group(); s.add(U);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(90, 20, 70), M.soil); soil.position.set(0, -10, 0); U.add(soil);
    U.add(new THREE.LineSegments(new THREE.EdgesGeometry(soil.geometry), M.soilEdge)).position.set(0, -10, 0);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 90, 24), M.pipe); pipe.rotation.z = Math.PI / 2; pipe.position.set(0, -1.05, -14); pipe.castShadow = true; U.add(pipe);
    const corr = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 90, 48), M.corr); corr.rotation.z = Math.PI / 2; corr.position.set(0, -16.4, -14); U.add(corr);
    const col = withEdges(boxAt(-6, 6, -20, 0, -15, -13, M.col), M.colEdge); U.add(col);
    U.add(boxAt(-6, 6, -3.0, -1.2, -15, -13, M.unk));
    const tl = lines(rectLoop(-6, 6, -15, -13, 0.08), M.dash); tl.computeLineDistances(); U.add(tl);
    const ruler = []; for (let d = 0; d <= 20; d += 5) ruler.push(-7.2, -d, -15, -6, -d, -15); ruler.push(-6.6, 0, -15, -6.6, -20, -15);
    U.add(lines(ruler, M.colEdge)); U.visible = false;
    const AI = this.ai = new THREE.Group(); AI.visible = false; s.add(AI);
    this.aiItems = CONTEXT.slice(0, 4).map(([x, z, w, d]) => { const m = new THREE.LineDashedMaterial({ dashSize: 1.4, gapSize: 0.9 }); const l = lines(rectLoop(x - w / 2 - 1, x + w / 2 + 1, z - d / 2 - 1, z + d / 2 + 1, 0.14), m); l.computeLineDistances(); AI.add(l); return { l, m, x, z, d }; });
    this.colours();
  }
  buildUnits(fid) {
    if (this.unitGroups[fid]) return this.unitGroups[fid];
    const f = FL[fid], M = this.M, grp = new THREE.Group(); grp.visible = false;
    const top = f.roof ? f.y0 + 1 : f.y1 - 0.25, bot = f.y0 + 0.05;
    let list;
    const n = fid.startsWith('F') ? fid.slice(1) : null;
    if (n) list = UNITS.map(([x0, x1, z0, z1, id, k]) => ({ x0, x1, z0, z1, k, id: k === 'ex' ? 'Flat ' + n + id : id }));
    else list = [{ x0: f.below ? -14 : -12, x1: f.below ? 14 : 12, z0: f.below ? -10 : -8, z1: f.below ? 10 : 8, k: 'sh', id: fid === 'G' ? 'Stilt parking' : fid === 'Roof' ? 'Roof terrace' : 'Parking ' + fid }];
    list.forEach(u => {
      const m = withEdges(boxAt(u.x0 + 0.08, u.x1 - 0.08, bot, top, u.z0 + 0.08, u.z1 - 0.08, f.est ? M.hatch : M[u.k]), M.unitEdge);
      m.castShadow = m.receiveShadow = true; m.userData = { ...m.userData, pick: 'unit', unit: u.id, floor: fid, kind: u.k, box: u, y: [bot, top] };
      grp.add(m);
    });
    grp.userData.units = grp.children; this.res.add(grp); this.unitGroups[fid] = grp; return grp;
  }
  labelsInit() {
    this.labels = [];
    const add = (id, pos, text, kind, when) => {
      const el = document.createElement('div'); el.textContent = text;
      const base = { position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap', font: '500 11px/16px var(--font-sans)', padding: '2px 7px', borderRadius: '4px', background: 'var(--surface)', color: 'var(--ink)', boxShadow: 'var(--shadow-floating)', transition: 'opacity 200ms cubic-bezier(.23,1,.32,1)', willChange: 'transform' };
      if (kind === 'code') Object.assign(base, { font: '500 10px/14px var(--font-mono)', color: 'var(--ink-soft)' });
      if (kind === 'sel') Object.assign(base, { background: 'var(--primary)', color: 'var(--on-primary)', fontWeight: 600 });
      if (kind === 'crit') Object.assign(base, { background: 'var(--danger)', color: 'var(--surface)', fontWeight: 600 });
      if (kind === 'tick') Object.assign(base, { background: 'transparent', boxShadow: 'none', font: '500 10px/12px var(--font-mono)', color: 'var(--ink-muted)', padding: 0 });
      if (kind === 'unit') Object.assign(base, { background: 'transparent', boxShadow: 'none', color: '#fff', font: '600 11px/14px var(--font-sans)', textShadow: '0 1px 2px #0006' });
      Object.assign(el.style, base); this.labelLayer.appendChild(el);
      const L = { id, pos, el, when, kind }; this.labels.push(L); return L;
    };
    this.addLabel = add;
    add('bldg', new THREE.Vector3(0, 31, 0), 'Lake View Residence', 'sel', st => (st.mode === 'area' || st.mode === 'building') && st.sel === 'bldg' && this.importN == null);
    add('parcel', new THREE.Vector3(0, 0.3, 17), 'MH2507A1B3C4D5', 'code', st => st.mode === 'area' && this.importN == null);
    add('pipe', new THREE.Vector3(18, -1.05, -14), 'Water main DN300 · B · tolerance not stated', null, st => st.mode === 'underground');
    add('corr', new THREE.Vector3(-34, -14.2, -14), 'Metro corridor · Test fixture', null, st => st.mode === 'underground');
    add('b1', new THREE.Vector3(-14, -1.2, 10), 'B1', null, st => st.mode === 'underground');
    add('b2', new THREE.Vector3(-14, -5.6, 10), 'B2 · 205.8 est.', null, st => st.mode === 'underground');
    add('nosurvey', new THREE.Vector3(-6, -1.6, -13), 'No survey', null, st => st.mode === 'underground');
    [0, 5, 10, 15, 20].forEach(d => add('d' + d, new THREE.Vector3(-8.2, -d + 0.5, -15), d + ' m', 'tick', st => st.mode === 'underground'));
    add('roofdev', new THREE.Vector3(-6, 31.2, 0), '118 m² · 239.8 to 242.8 m', 'crit', st => st.mode === 'deviation').side = 'R';
    add('ov', this.ovPos, '6.4 m³ overlap', 'crit', st => st.mode === 'findings');
    add('trench', new THREE.Vector3(0, 0.6, -12.6), 'Trench · 12 m', 'sel', st => st.mode === 'underground');
    this.aiItems.forEach((a, i) => add('ai' + i, new THREE.Vector3(a.x, 0.4, a.z + a.d / 2 + 1), 'AI candidate ' + (i + 1), null, () => this.layers?.ai && this.layers.aiState?.[i] !== 'rejected'));
    add('f101', new THREE.Vector3(-12.5, 4.4, 8.4), 'Flat 101', null, st => st.mode === 'findings');
    add('f201', new THREE.Vector3(5.5, 7.4, 8.4), 'Flat 201', null, st => st.mode === 'findings');
    this.unitLabels = [];
  }
  setUnitLabels(fid) {
    this.unitLabels.forEach(L => { L.el.remove(); this.labels.splice(this.labels.indexOf(L), 1); });
    this.unitLabels = [];
    if (!fid) return;
    const grp = this.buildUnits(fid);
    grp.children.forEach(m => {
      const { box, y, unit, kind } = m.userData;
      const small = kind === 'sh' && unit !== 'Corridor' && fid.startsWith('F');
      const L = this.addLabel('u' + unit, new THREE.Vector3((box.x0 + box.x1) / 2, y[1] + 0.2, (box.z0 + box.z1) / 2), small ? unit.split(' ')[1] : unit, 'unit', st => st.mode === 'floor');
      L.unit = unit; this.unitLabels.push(L);
    });
  }
  mount(host) {
    if (!host || host === this.host) return;
    this.host = host; host.appendChild(this.renderer.domElement); host.appendChild(this.labelLayer);
    this.ro.disconnect(); this.ro.observe(host); this.resize(); this.frame();
  }
  setCamera(p, t) { this.tween = null; this.flyTo({ p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) }, true); this.camKey = '__custom'; this.camLock = true; }
  snapshot() { const sp = this.split; this.split = false; this.frame(); const u = this.renderer.domElement.toDataURL('image/jpeg', 0.9); this.split = sp; return u; }
  set(partial) { const prev = this.state; this.state = { ...prev, ...partial }; this.apply(false, prev); }
  setLoading(b) { if (this.loading === b) return; this.loading = b; this.apply(false, this.state); }
  setLayers(L) {
    this.layers = { ...(this.layers || {}), ...L }; const Ly = this.layers, M = this.M;
    this.ai.visible = !!Ly.ai;
    this.aiItems.forEach((a, i) => { const s = Ly.aiState?.[i]; a.l.visible = s !== 'rejected'; a.m.dashSize = s === 'accepted' ? 100 : 1.4; a.m.gapSize = s === 'accepted' ? 0.001 : 0.9; const lb = this.labels.find(x => x.id === 'ai' + i); if (lb) lb.el.textContent = s === 'accepted' ? 'Accepted' : 'AI candidate ' + (i + 1); });
    if (Ly.ortho && !this.orthoTex) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#a9ad97'; g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 900; k++) { g.fillStyle = ['#9ea38a', '#b7b8a2', '#8f9780', '#c2bfad'][k % 4]; g.globalAlpha = 0.35; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 9, 0, 7); g.fill(); }
      const t = this.orthoTex = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.colorSpace = THREE.SRGBColorSpace;
    }
    M.ground.map = Ly.ortho ? this.orthoTex : null; M.ground.needsUpdate = true; this.colours(); this.frame();
  }
  setImport(n) { this.importN = n; this.apply(false, this.state); }
  refreshTheme() { if (this.scene) { this.colours(); this.apply(false, this.state); } }
  apply(first, prev = {}) {
    const st = this.state, M = this.M;
    const fade = st.sel || st.mode !== 'area';
    this.res.visible = !this.loading;
    this.ctx.forEach((m, i) => { m.visible = !this.loading && (this.importN == null || i < this.importN) && !(st.mode === 'underground' && m.position.z < -17 && Math.abs(m.position.x) < 50); m.userData.target = fade ? 0.35 : 1; if (this.importN != null && i === this.importN - 1 && m.userData.fresh !== this.importN) { m.userData.fresh = this.importN; m.userData.grow = 0.02; } });
    const fIdx = FLOORS.findIndex(f => f.id === st.floor);
    Object.entries(this.storeys).forEach(([id, grp]) => {
      const i = FLOORS.findIndex(f => f.id === id);
      let mat = M.bldg, edge = M.edge, vis = true;
      if (st.mode === 'area' || st.mode === 'building') mat = st.sel === 'bldg' ? M.sel : M.bldg;
      if (st.mode === 'floor') { if (i > fIdx) { mat = M.ghost; edge = M.ghostEdge; } else if (i === fIdx) vis = false; }
      if (st.mode === 'findings' || st.mode === 'underground') { mat = M.ghost; edge = M.ghostEdge; }
      grp.visible = vis;
      grp.userData.parts.forEach(p => { p.material = mat; p.userData.edges.material = edge; p.castShadow = mat !== M.ghost; });
    });
    const below = st.mode === 'underground' || (st.mode === 'floor' && FL[st.floor]?.below);
    Object.entries(this.basements).forEach(([id, b]) => { b.visible = below && !(st.mode === 'floor' && id === st.floor); if (st.mode === 'floor' && FLOORS.findIndex(f => f.id === id) > fIdx) b.material = M.ghost; else b.material = FL[id].est ? M.hatch : M.bldg; });
    M.ground.opacity = below ? 0.35 : 1; M.ground.depthWrite = !below;
    this.flats.forEach(f => { f.material.transparent = below; f.material.opacity = below ? 0.35 : 1; f.material.depthWrite = !below; });
    this.ug.visible = st.mode === 'underground';
    this.findings.visible = st.mode === 'findings';
    Object.values(this.unitGroups).forEach(g => g.visible = false);
    if (st.mode === 'floor') {
      const g = this.buildUnits(st.floor); g.visible = true;
      g.children.forEach(m => { const selU = st.unit === m.userData.unit; m.material = selU ? M.sel : (FL[st.floor].est ? M.hatch : M[m.userData.kind]); });
    }
    if (st.mode !== 'floor' || prev.floor !== st.floor || prev.mode !== 'floor' || first) this.setUnitLabels(st.mode === 'floor' ? st.floor : null);
    this.halo.visible = st.sel === 'bldg' && (st.mode === 'area' || st.mode === 'building');
    this.split = st.mode === 'deviation';
    const uh = this.unitHalo; uh.visible = false;
    if (st.mode === 'floor' && st.unit) {
      const m = this.unitGroups[st.floor]?.children.find(c => c.userData.unit === st.unit);
      if (m) { const { box, y } = m.userData; uh.scale.set(box.x1 - box.x0 + 0.5, y[1] - y[0] + 0.5, box.z1 - box.z0 + 0.5); uh.position.set((box.x0 + box.x1) / 2, (y[0] + y[1]) / 2, (box.z0 + box.z1) / 2); uh.visible = true; }
    }
    this.unitLabels.forEach(L => { L.el.style.background = L.unit === st.unit ? 'var(--primary)' : 'transparent'; L.el.style.color = L.unit === st.unit ? 'var(--on-primary)' : '#fff'; L.el.style.textShadow = L.unit === st.unit ? 'none' : '0 1px 2px #0006'; });
    const vol = st.render === 'Volumes' || st.mode === 'findings';
    this.sun.castShadow = !vol; const dk = document.documentElement.dataset.theme === 'dark'; this.hemi.intensity = (dk ? 1.1 : 1.6) * (vol ? 1.25 : 1); this.sun.intensity = vol ? 0.7 : (dk ? 1.0 : 1.35);
    const key = st.mode + '|' + (st.mode === 'floor' ? st.floor : '') + '|' + st.view;
    if (!this.camLock && (first || key !== this.camKey)) { this.camKey = key; this.flyTo(this.preset(st), first); }
    this.frame(); clearTimeout(this.kick); this.kick = setTimeout(() => { this.tween && (this.tween.start = -1e9); this.ctx.forEach(m => { m.userData.cur = m.userData.target; m.userData.grow = 1; }); this.frame(); }, 700);
  }
  preset(st) {
    let p, t;
    if (st.mode === 'building') { p = [52, 40, 62]; t = [0, 12, 0]; }
    else if (st.mode === 'floor') { const f = FL[st.floor]; const y = (f.y0 + f.y1) / 2; p = [24, y + 30, 36]; t = [0, y - 1, 0]; }
    else if (st.mode === 'underground') { p = [48, 20, -60]; t = [0, -8, -8]; }
    else if (st.mode === 'deviation') { p = [60, 46, 78]; t = [0, 15, 0]; }
    else if (st.mode === 'findings') { p = [-28, 15, 30]; t = [-6, 6.4, 4]; }
    else { p = [112, 92, 138]; t = [0, 4, 4]; }
    if (st.view === '2D') { const d = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]); p = [t[0], t[1] + d, t[2] + 0.01]; }
    return { p: new THREE.Vector3(...p), t: new THREE.Vector3(...t) };
  }
  flyTo({ p, t }, instant) {
    if (instant) { this.camera.position.copy(p); this.controls.target.copy(t); return; }
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p, t, start: performance.now(), dur: 600 };
  }
  ray(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.camera);
    const objs = []; this.res.traverseVisible(o => { if (o.isMesh && o.userData.pick) objs.push(o); });
    const hit = rc.intersectObjects(objs, false).find(h => h.object.material !== this.M.ghost);
    return hit?.object;
  }
  hover(e) { const o = this.ray(e); this.renderer.domElement.style.cursor = o ? 'pointer' : 'grab'; }
  pick(e) {
    const o = this.ray(e);
    if (!o) return this.onPick({ type: 'none' });
    if (o.userData.pick === 'unit') return this.onPick({ type: 'unit', unit: o.userData.unit, floor: o.userData.floor, kind: o.userData.kind });
    return this.onPick({ type: 'bldg', floor: o.parent?.userData.floor || o.userData.floor });
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  frame() {
    const now = this.last = performance.now();
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.start) / this.tween.dur), e = ease(k);
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p, e); this.controls.target.lerpVectors(this.tween.t0, this.tween.t, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    this.ctx.forEach(m => { const u = m.userData; u.cur += (u.target - u.cur) * 0.12; m.material.color.copy(this.cG).lerp(this.cB, u.cur); u.em.opacity = 0.25 + 0.75 * u.cur; if (this.importN != null) { m.scale.y = Math.max(0.001, Math.min(1, u.grow = (u.grow ?? 1) + (1 - (u.grow ?? 1)) * 0.14)); m.position.y = m.geometry.parameters.height * m.scale.y / 2; } });
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3(), r = this.renderer;
    if (!w || !h) return;
    const cv = r.domElement; if (cv.clientWidth !== w || cv.clientHeight !== h) r.setSize(w, h);
    const pw = this.split ? Math.floor(w / 2) : w;
    if (Math.abs(this.camera.aspect - pw / h) > 1e-3) { this.camera.aspect = pw / h; this.camera.updateProjectionMatrix(); }
    if (this.split) {
      r.setScissorTest(true);
      this.rooftop.visible = false; r.setViewport(0, 0, pw, h); r.setScissor(0, 0, pw, h); r.render(this.scene, this.camera);
      this.rooftop.visible = true; r.setViewport(pw, 0, w - pw, h); r.setScissor(pw, 0, w - pw, h); r.render(this.scene, this.camera);
      r.setScissorTest(false); r.setViewport(0, 0, w, h);
    } else { this.rooftop.visible = false; r.render(this.scene, this.camera); }
    this.labels.forEach(L => {
      const on = !this.loading && L.when(this.state) && (!this.split || L.side);
      v.copy(L.pos).project(this.camera);
      const vis = on && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      L.el.style.opacity = vis ? 1 : 0;
      if (vis) L.el.style.transform = `translate(${((v.x + 1) / 2 * pw + (L.side === 'R' && this.split ? pw : 0)).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-110%)`;
    });
  }
}
window.ULSceneClass = ULSceneImpl;
window.ULScene = new ULSceneImpl();
window.dispatchEvent(new Event('ulscene-ready'));
