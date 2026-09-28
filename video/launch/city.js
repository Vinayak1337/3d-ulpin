import * as THREE from 'three';

/**
 * The 3D world: official NYC footprints (ZCTA 10013) as a white-model city on dark ground,
 * with a hero building that can split into floors, a flat, checks and an underground section.
 * Data x = east (m), y = north (m); three: x = east, z = -north, y = up.
 */
const signedArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const ccw = (r) => (signedArea(r) < 0 ? [...r].reverse() : r);
const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };

function clipHalf(ring, nx, ny, c) { // keep points with nx*x+ny*y <= c
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** Prism geometry (walls + top + bottom) for a ring between y0 and y1, in local coords relative to origin. */
function prism(ring, y0, y1, ox = 0, oy = 0) {
  const r = ccw(ring).map(([x, y]) => [x - ox, y - oy]);
  const pos = [], nor = [];
  const push = (x, y, z, n) => { pos.push(x, y, z); nor.push(...n); };
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    const n = [ey / l, 0, ex / l]; // outward for CCW in (x, north) → three (x, -z)
    const A0 = [a[0], y0, -a[1]], B0 = [b[0], y0, -b[1]], A1 = [a[0], y1, -a[1]], B1 = [b[0], y1, -b[1]];
    for (const v of [A0, B0, B1, A0, B1, A1]) push(...v, n);
  }
  const tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [i, j, k] of tris) {
    for (const idx of [i, j, k]) push(r[idx][0], y1, -r[idx][1], [0, 1, 0]);
    for (const idx of [k, j, i]) push(r[idx][0], y0, -r[idx][1], [0, -1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function outline(ring, y, ox = 0, oy = 0) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; pts.push(a[0] - ox, y, -(a[1] - oy), b[0] - ox, y, -(b[1] - oy)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
}
function prismEdges(ring, y0, y1, ox = 0, oy = 0) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ax = a[0] - ox, az = -(a[1] - oy), bx = b[0] - ox, bz = -(b[1] - oy);
    pts.push(ax, y1, az, bx, y1, bz, ax, y0, az, bx, y0, bz, ax, y0, az, ax, y1, az);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
}

const BUILD_VS = /* glsl */`
attribute float aTop; attribute float aH; attribute float aOrder; attribute float aBid;
uniform float uReveal, uFlat, uSel, uHideSel, uHideUn;
varying vec3 vN; varying float vY; varying float vGlow; varying float vHide; varying float vBid; varying float vTop; varying float vWorldH;
void main() {
  float grow = smoothstep(aOrder, aOrder + 0.03, uReveal);
  float h = max(aH * grow * uFlat, 0.0);
  vec3 p = vec3(position.x, aTop * h, position.z);
  vY = p.y; vTop = aTop; vWorldH = h;
  vGlow = step(aOrder, uReveal) * (1.0 - smoothstep(0.0, 0.07, uReveal - aOrder));
  vHide = ((uHideUn > 0.5 && grow < 0.002) ? 1.0 : 0.0) + ((uHideSel > 0.5 && abs(aBid - uSel) < 0.5) ? 1.0 : 0.0);
  vBid = aBid; vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const BUILD_FS = /* glsl */`
uniform float uGhost, uHi1, uHi2, uTime, uWarm;
uniform vec3 uFogColor; uniform float uFogNear, uFogFar;
varying vec3 vN; varying float vY; varying float vGlow; varying float vHide; varying float vBid; varying float vTop; varying float vWorldH;
void main() {
  if (vHide > 0.5) discard;
  vec3 L1 = normalize(vec3(0.55, 0.8, 0.35)); vec3 L2 = normalize(vec3(-0.6, 0.35, -0.5));
  float d = max(dot(vN, L1), 0.0) * 0.62 + max(dot(vN, L2), 0.0) * 0.22 + 0.34;
  vec3 top = mix(vec3(0.86, 0.90, 0.89), vec3(0.96, 0.93, 0.88), uWarm);
  vec3 base = vec3(0.50, 0.58, 0.57);
  vec3 c = mix(base, top, smoothstep(0.0, 70.0, vY) * 0.6 + 0.4) * d;
  c *= mix(0.55, 1.0, smoothstep(0.0, 7.0, vY));            // contact shadow
  float floorLine = step(0.93, fract(vY / 3.4)) * step(0.5, 1.0 - abs(vN.y)) * 0.06;
  c -= floorLine;
  vec3 mint = vec3(0.26, 0.88, 0.63);
  c = mix(c, mint * (0.7 + 0.5 * d), vGlow * 0.85);
  float hi = (abs(vBid - uHi1) < 0.5 ? 1.0 : 0.0) + (abs(vBid - uHi2) < 0.5 ? 1.0 : 0.0);
  c = mix(c, mix(mint, vec3(1.0), 0.15) * (0.55 + 0.6 * d), hi * 0.75);
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  float f = smoothstep(uFogNear, uFogFar, depth);
  c = mix(c, uFogColor, f);
  float a = mix(1.0, 0.09, uGhost * (1.0 - hi));
  gl_FragColor = vec4(c, a);
}`;
const EDGE_VS = /* glsl */`
attribute float aTop; attribute float aH; attribute float aOrder; attribute float aBid;
uniform float uReveal, uFlat, uSel, uHideSel, uHideUn;
varying float vGlow; varying float vHide; varying float vDepth;
void main() {
  float grow = smoothstep(aOrder, aOrder + 0.03, uReveal);
  float h = aH * grow * uFlat;
  vec3 p = vec3(position.x, aTop * h + 0.05, position.z);
  vGlow = step(aOrder, uReveal) * (1.0 - smoothstep(0.0, 0.07, uReveal - aOrder));
  vHide = ((uHideUn > 0.5 && grow < 0.002) ? 1.0 : 0.0) + ((uHideSel > 0.5 && abs(aBid - uSel) < 0.5) ? 1.0 : 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const EDGE_FS = /* glsl */`
uniform float uEdge, uGhost; uniform vec3 uEdgeColor; uniform float uFogNear, uFogFar;
varying float vGlow; varying float vHide; varying float vDepth;
void main() {
  if (vHide > 0.5) discard;
  float f = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
  gl_FragColor = vec4(mix(uEdgeColor, vec3(0.6, 1.0, 0.85), vGlow), (uEdge * mix(1.0, 0.35, uGhost) + vGlow * 0.8) * f);
}`;

export class City {
  constructor(canvas, data) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1920, 1080, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1920 / 1080, 1, 12000);
    this.bg = new THREE.Color('#050d0b');
    this.scene.background = this.bg;
    this.scene.add(new THREE.HemisphereLight(0xeaf5f1, 0x1a2a26, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(300, 500, 200); this.scene.add(sun);
    this.data = data;
    this.buildings = data.buildings;
    this.uni = {
      uReveal: { value: 1 }, uHideUn: { value: 0 }, uFlat: { value: 1 }, uSel: { value: -1 }, uHideSel: { value: 0 }, uGhost: { value: 0 }, uHi1: { value: -1 }, uHi2: { value: -1 },
      uTime: { value: 0 }, uWarm: { value: 0 }, uFogColor: { value: new THREE.Color('#050d0b') }, uFogNear: { value: 900 }, uFogFar: { value: 2600 },
      uEdge: { value: 0.3 }, uEdgeColor: { value: new THREE.Color('#7fd8b4') },
    };
    this.hero = data.buildings.findIndex((b) => b.bin === '1002735');
    const [hx, hy] = centroid(data.buildings[this.hero].r);
    this.origin = [hx, hy]; // hero at the world origin
    this.#ground();
    this.#city();
    this.#heroGroup();
    this.#underground();
  }

  #order(from = [0, 0]) {
    const d = this.buildings.map((b, i) => { const [x, y] = centroid(b.r); return [Math.hypot(x - this.origin[0] - from[0], y - this.origin[1] - from[1]), i]; });
    d.sort((a, b) => a[0] - b[0]);
    const order = new Float32Array(this.buildings.length);
    d.forEach(([, i], rank) => { order[i] = rank / this.buildings.length; });
    return order;
  }

  #city() {
    const [ox, oy] = this.origin;
    const order = this.#order();
    this.orderOf = order;
    const pos = [], nor = [], top = [], H = [], ord = [], bid = [];
    const first = new Map(); this.buildings.forEach((b, i) => { if (!first.has(b.bin)) first.set(b.bin, i); });
    const epos = [], etop = [], eH = [], eord = [], ebid = [];
    this.buildings.forEach((b, i) => {
      const r = ccw(b.r).map(([x, y]) => [x - ox, y - oy]);
      const add = (x, z, t, n) => { pos.push(x, t, z); nor.push(...n); top.push(t); H.push(b.h); ord.push(order[i]); bid.push(first.get(b.bin)); };
      for (let k = 0; k < r.length; k++) {
        const a = r[k], c = r[(k + 1) % r.length];
        const ex = c[0] - a[0], ey = c[1] - a[1], l = Math.hypot(ex, ey) || 1; const n = [ey / l, 0, ex / l];
        add(a[0], -a[1], 0, n); add(c[0], -c[1], 0, n); add(c[0], -c[1], 1, n);
        add(a[0], -a[1], 0, n); add(c[0], -c[1], 1, n); add(a[0], -a[1], 1, n);
        for (const [x, y, t] of [[a[0], a[1], 1], [c[0], c[1], 1], [a[0], a[1], 0], [c[0], c[1], 0]]) { epos.push(x, t, -y); etop.push(t); eH.push(b.h); eord.push(order[i]); ebid.push(first.get(b.bin)); }
      }
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []); } catch { /* skip roof */ }
      for (const [p, q, s] of tris) for (const idx of [p, q, s]) add(r[idx][0], -r[idx][1], 1, [0, 1, 0]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
    g.setAttribute('aOrder', new THREE.Float32BufferAttribute(ord, 1));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(bid, 1));
    this.cityMat = new THREE.ShaderMaterial({ vertexShader: BUILD_VS, fragmentShader: BUILD_FS, uniforms: this.uni, transparent: true });
    this.cityMesh = new THREE.Mesh(g, this.cityMat); this.cityMesh.frustumCulled = false;
    this.scene.add(this.cityMesh);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
    eg.setAttribute('aTop', new THREE.Float32BufferAttribute(etop, 1));
    eg.setAttribute('aH', new THREE.Float32BufferAttribute(eH, 1));
    eg.setAttribute('aOrder', new THREE.Float32BufferAttribute(eord, 1));
    eg.setAttribute('aBid', new THREE.Float32BufferAttribute(ebid, 1));
    this.edgeMat = new THREE.ShaderMaterial({ vertexShader: EDGE_VS, fragmentShader: EDGE_FS, uniforms: this.uni, transparent: true, depthWrite: false });
    this.edges = new THREE.LineSegments(eg, this.edgeMat); this.edges.frustumCulled = false;
    this.scene.add(this.edges);
  }

  #ground() {
    const [ox, oy] = this.origin;
    this.groundMats = [];
    const layer = (items, color, y, opacity) => {
      const shapes = items.map(({ r, holes }) => {
        const s = new THREE.Shape(ccw(r).map(([x, yy]) => new THREE.Vector2(x - ox, yy - oy)));
        for (const hh of holes ?? []) s.holes.push(new THREE.Path(hh.map(([x, yy]) => new THREE.Vector2(x - ox, yy - oy))));
        return s;
      });
      const g = new THREE.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      m.userData.base = opacity; this.groundMats.push(m);
      const mesh = new THREE.Mesh(g, m); mesh.position.y = y; mesh.renderOrder = -1; this.scene.add(mesh); return mesh;
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0a1714', transparent: true, opacity: 1, depthWrite: false }));
    plane.material.userData.base = 1; this.groundMats.push(plane.material); plane.renderOrder = -2; this.scene.add(plane);
    this.plane = plane;
    layer(this.data.sidewalk, '#1a2d29', 0.01, 1);
    layer(this.data.roadbed, '#223833', 0.02, 1);
    layer(this.data.parks, '#1d5a3f', 0.03, 1);
    layer(this.data.hydrography, '#17405a', 0.04, 1);
    // A soft grid far out for scale.
    const grid = new THREE.GridHelper(6000, 120, 0x1b3a33, 0x10231f); grid.position.y = -0.05; grid.material.transparent = true; grid.material.opacity = 0.5; grid.material.userData.base = 0.5; this.groundMats.push(grid.material); this.scene.add(grid);
  }

  #heroGroup() {
    const b = this.buildings[this.hero]; const [ox, oy] = this.origin;
    this.heroRing = ccw(b.r);
    this.heroH = b.h;
    const n = 14; const fh = b.h / n; this.floorH = fh; this.nFloors = n;
    const g = new THREE.Group(); this.heroG = g; g.visible = false; this.scene.add(g);
    this.floors = [];
    const [cx, cy] = centroid(this.heroRing);
    // dominant axis of the footprint (longest edge) for flats, pipes and trench
    let best = 0, dir = [1, 0];
    for (let i = 0; i < this.heroRing.length; i++) { const a = this.heroRing[i], c = this.heroRing[(i + 1) % this.heroRing.length]; const l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > best) { best = l; dir = [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; } }
    this.axis = dir;
    const nx = dir[0], ny = dir[1]; const cproj = nx * cx + ny * cy;
    const flatRing = clipHalf(this.heroRing, nx, ny, cproj);
    const otherRing = clipHalf(this.heroRing, -nx, -ny, -cproj);
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshStandardMaterial({ color: '#dfe7e4', roughness: 0.85, metalness: 0, transparent: true, opacity: 1 });
      const slab = new THREE.Mesh(prism(this.heroRing, i * fh + 0.12, (i + 1) * fh - 0.12, ox, oy), m);
      const e = new THREE.LineSegments(prismEdges(this.heroRing, i * fh + 0.12, (i + 1) * fh - 0.12, ox, oy), new THREE.LineBasicMaterial({ color: '#7fd8b4', transparent: true, opacity: 0.55 }));
      const fg = new THREE.Group(); fg.add(slab, e); g.add(fg);
      this.floors.push({ g: fg, slab, edge: e, mat: m });
    }
    this.flatFloor = 9;
    const flatMat = new THREE.MeshStandardMaterial({ color: '#43e0a0', emissive: '#1a7a55', emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0 });
    this.flat = new THREE.Mesh(prism(flatRing, this.flatFloor * fh + 0.05, (this.flatFloor + 1) * fh - 0.05, ox, oy), flatMat);
    this.flatEdge = new THREE.LineSegments(prismEdges(flatRing, this.flatFloor * fh + 0.05, (this.flatFloor + 1) * fh - 0.05, ox, oy), new THREE.LineBasicMaterial({ color: '#b6ffe0', transparent: true, opacity: 0 }));
    this.floors[this.flatFloor].g.add(this.flat, this.flatEdge);
    this.flatCenter = centroid(flatRing).map((v, i) => v - this.origin[i]);
    this.otherCenter = centroid(otherRing).map((v, i) => v - this.origin[i]);
    // deviation: one extra observed storey
    const redMat = new THREE.MeshStandardMaterial({ color: '#ff5f57', emissive: '#7a1512', emissiveIntensity: 0.5, transparent: true, opacity: 0, depthWrite: false });
    this.extra = new THREE.Mesh(prism(this.heroRing, b.h + 0.1, b.h + fh, ox, oy), redMat);
    this.extraEdge = new THREE.LineSegments(prismEdges(this.heroRing, b.h + 0.1, b.h + fh, ox, oy), new THREE.LineBasicMaterial({ color: '#ff8a84', transparent: true, opacity: 0 }));
    g.add(this.extra, this.extraEdge);
    // overlap: a flat on floor k drawn into floor k+1
    const q = clipHalf(flatRing, -dir[1], dir[0], -dir[1] * cx + dir[0] * cy);
    const ovMat = new THREE.MeshStandardMaterial({ color: '#ff5f57', emissive: '#a01a14', emissiveIntensity: 0.8, transparent: true, opacity: 0, depthWrite: false });
    this.overlap = new THREE.Mesh(prism(q, 0, fh * 0.9, ox, oy), ovMat);
    this.overlapEdge = new THREE.LineSegments(prismEdges(q, 0, fh * 0.9, ox, oy), new THREE.LineBasicMaterial({ color: '#ffb3ae', transparent: true, opacity: 0 }));
    this.overlapCenter = centroid(q).map((v, i) => v - this.origin[i]);
    for (const m of [this.overlap, this.overlapEdge]) m.position.y = 6 * fh - fh * 0.75;
    this.floors[6].g.add(this.overlap, this.overlapEdge);
  }

  #underground() {
    const g = new THREE.Group(); this.under = g; g.visible = false; this.scene.add(g);
    const [ax, ay] = this.axis; const nx = -ay, ny = ax; // along / across the block
    const line = (off, along, depth, len, across = false) => {
      const d = across ? [nx, ny] : [ax, ay], o = across ? [ax, ay] : [nx, ny];
      const p0 = [o[0] * off + d[0] * (along - len / 2), o[1] * off + d[1] * (along - len / 2)];
      const p1 = [o[0] * off + d[0] * (along + len / 2), o[1] * off + d[1] * (along + len / 2)];
      return new THREE.LineCurve3(new THREE.Vector3(p0[0], -depth, -p0[1]), new THREE.Vector3(p1[0], -depth, -p1[1]));
    };
    this.pipes = [];
    const pipe = (curve, r, color) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, r, 20, false), m); g.add(mesh); this.pipes.push(m); return mesh;
    };
    pipe(line(-26, 0, 2.4, 520), 0.9, '#1f6fd1');   // water main
    pipe(line(-30, 0, 1.6, 520), 0.35, '#f2c200');  // gas
    pipe(line(27, 0, 3.6, 520), 1.2, '#2e8b3a');    // sewer
    pipe(line(24, 0, 1.2, 520), 0.25, '#f28c00');   // telecom
    pipe(line(-8, 40, 2.8, 300, true), 0.7, '#1f6fd1');
    // metro corridor
    const tm = new THREE.MeshStandardMaterial({ color: '#c9d3d0', roughness: 0.9, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this.tunnelMat = tm;
    const tunnel = new THREE.Mesh(new THREE.TubeGeometry(line(70, 0, 19, 700, true), 1, 5.5, 40, false), tm); g.add(tunnel);
    // soil section box
    this.soil = new THREE.Mesh(new THREE.BoxGeometry(160, 30, 160), new THREE.MeshBasicMaterial({ color: '#b89f78', transparent: true, opacity: 0, depthWrite: false }));
    this.soil.position.y = -15; g.add(this.soil);
    this.soilEdge = new THREE.LineSegments(new THREE.EdgesGeometry(this.soil.geometry), new THREE.LineBasicMaterial({ color: '#d9c9aa', transparent: true, opacity: 0 }));
    this.soilEdge.position.copy(this.soil.position); g.add(this.soilEdge);
    // trench
    this.trenchMat = new THREE.MeshBasicMaterial({ color: '#ff5f57', transparent: true, opacity: 0, depthWrite: false });
    this.trench = new THREE.Mesh(new THREE.BoxGeometry(1, 3.2, 2.4), this.trenchMat); g.add(this.trench);
    this.trenchEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 3.2, 2.4)), new THREE.LineBasicMaterial({ color: '#ffb3ae', transparent: true, opacity: 0 })); g.add(this.trenchEdge);
  }

  setTrench(len, opacity) {
    const [ax, ay] = this.axis; const nx = -ay, ny = ax;
    const cx = nx * -20 + ax * 10, cy = ny * -20 + ay * 10;
    const ang = Math.atan2(ay, ax);
    for (const m of [this.trench, this.trenchEdge]) {
      m.scale.set(Math.max(len, 0.01), 1, 1); m.rotation.y = ang;
      m.position.set(cx + ax * len / 2, -1.6, -(cy + ay * len / 2));
    }
    this.trenchMat.opacity = 0.45 * opacity; this.trenchEdge.material.opacity = opacity;
    this.trenchEnd = [cx + ax * len, cy + ay * len];
  }

  setGround(alpha) { for (const m of this.groundMats) m.opacity = m.userData.base * alpha; }

  camera_(pos, target, fov = 34) {
    this.camera.position.set(...pos); this.camera.fov = fov; this.camera.updateProjectionMatrix(); this.camera.lookAt(...target); this.camera.updateMatrixWorld(true);
  }

  /** World (x east, y up, z north) → screen px. Returns null when behind the camera. */
  project(x, y, north) {
    const v = new THREE.Vector3(x, y, -north).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * 1920, (1 - v.y) / 2 * 1080];
  }
  centerOf(i) { const [x, y] = centroid(this.buildings[i].r); return [x - this.origin[0], y - this.origin[1]]; }
  render() { this.renderer.render(this.scene, this.camera); }
}
