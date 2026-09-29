import * as THREE from 'three';

/**
 * The reel's 3D world: official NYC footprints (ZCTA 10013) as a white-model city.
 * One scene, two looks: `theme` 0 is the night plan (dark ground, mint lines), 1 is the Studio map
 * (light ground, grey massing, forest highlights). Data x = east (m), y = north (m); three: x = east, z = -north.
 */
const signedArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const ccw = (r) => (signedArea(r) < 0 ? [...r].reverse() : r);
const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
const col = (c) => new THREE.Color(c);

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
function prism(ring, y0, y1, ox = 0, oy = 0) {
  const r = ccw(ring).map(([x, y]) => [x - ox, y - oy]);
  const pos = [], nor = [];
  const push = (x, y, z, n) => { pos.push(x, y, z); nor.push(...n); };
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
    const n = [ey / l, 0, ex / l];
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
attribute float aTop; attribute float aH; attribute float aOrder; attribute float aChunk; attribute float aBid;
uniform float uReveal, uFlat, uSel, uHideSel, uHideUn, uOrdMix, uSink;
varying vec3 vN; varying float vY; varying float vGlow; varying float vHide; varying float vBid; varying float vSunk;
void main() {
  float ord = mix(aOrder, aChunk, uOrdMix);
  float grow = smoothstep(ord, ord + 0.025, uReveal);
  float other = abs(aBid - uSel) < 0.5 ? 0.0 : 1.0;
  float h = max(aH * grow * uFlat * (1.0 - uSink * other * 0.985), 0.0);
  vec3 p = vec3(position.x, aTop * h, position.z);
  vY = p.y; vSunk = uSink * other;
  vGlow = step(ord, uReveal) * (1.0 - smoothstep(0.0, 0.08, uReveal - ord));
  vHide = ((uHideUn > 0.5 && grow < 0.002) ? 1.0 : 0.0) + ((uHideSel > 0.5 && abs(aBid - uSel) < 0.5) ? 1.0 : 0.0);
  vBid = aBid; vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const BUILD_FS = /* glsl */`
uniform float uGhost, uHi1, uHi2, uTheme;
varying float vSunk;
uniform vec3 uWallD, uWallL, uRoofD, uRoofL, uGlow, uHiCol, uFogColor; uniform float uFogNear, uFogFar;
varying vec3 vN; varying float vY; varying float vGlow; varying float vHide; varying float vBid;
void main() {
  if (vHide > 0.5) discard;
  vec3 L1 = normalize(vec3(0.55, 0.8, 0.35)); vec3 L2 = normalize(vec3(-0.6, 0.35, -0.5));
  float d = max(dot(vN, L1), 0.0) * mix(0.55, 0.42, uTheme) + max(dot(vN, L2), 0.0) * 0.2 + mix(0.42, 0.6, uTheme);
  float rnd = fract(sin(vBid * 12.9898) * 43758.5453);
  float roof = step(0.5, vN.y);
  vec3 wall = mix(uWallD, uWallL * (0.93 + 0.12 * rnd) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), step(0.72, rnd)), uTheme), rf = mix(uRoofD, uRoofL, uTheme);
  vec3 c = mix(wall * mix(0.86, 1.04, smoothstep(0.0, 90.0, vY)), rf, roof) * d;
  c *= mix(mix(0.6, 0.78, uTheme), 1.0, max(smoothstep(0.0, 9.0, vY), roof * uTheme));       // contact shadow
  float floorLine = step(0.92, fract(vY / 3.4)) * (1.0 - roof) * mix(0.05, 0.035, uTheme);
  c -= floorLine;
  c = mix(c, uGlow * (0.75 + 0.35 * d), vGlow * 0.9);
  float hi = (abs(vBid - uHi1) < 0.5 ? 1.0 : 0.0) + (abs(vBid - uHi2) < 0.5 ? 1.0 : 0.0);
  c = mix(c, uHiCol * (1.05 + 0.4 * d) * mix(1.0, 1.25, roof), min(hi, 1.0) * 0.92);
  c = mix(c, uFogColor * 0.955, vSunk * 0.6);
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  c = mix(c, uFogColor, smoothstep(uFogNear, uFogFar, depth));
  float a = mix(1.0, 0.1, uGhost * (1.0 - min(hi, 1.0)));
  gl_FragColor = vec4(c, a);
}`;
const EDGE_VS = /* glsl */`
attribute float aTop; attribute float aH; attribute float aOrder; attribute float aChunk; attribute float aBid;
uniform float uReveal, uFlat, uSel, uHideSel, uHideUn, uOrdMix, uDraw, uSink;
varying float vGlow; varying float vHide; varying float vDepth; varying float vDraw;
void main() {
  float ord = mix(aOrder, aChunk, uOrdMix);
  float grow = smoothstep(ord, ord + 0.025, uReveal);
  float other = abs(aBid - uSel) < 0.5 ? 0.0 : 1.0;
  float h = aH * grow * uFlat * (1.0 - uSink * other * 0.985);
  vec3 p = vec3(position.x, aTop * h + 0.06, position.z);
  vGlow = step(ord, uReveal) * (1.0 - smoothstep(0.0, 0.08, uReveal - ord));
  vDraw = smoothstep(aOrder, aOrder + 0.04, uDraw);
  vHide = ((uHideUn > 0.5 && grow < 0.002) ? 1.0 : 0.0) + ((uHideSel > 0.5 && abs(aBid - uSel) < 0.5) ? 1.0 : 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const EDGE_FS = /* glsl */`
uniform float uEdge, uGhost, uTheme; uniform vec3 uEdgeD, uEdgeL, uGlow; uniform float uFogNear, uFogFar;
varying float vGlow; varying float vHide; varying float vDepth; varying float vDraw;
void main() {
  if (vHide > 0.5 || vDraw < 0.01) discard;
  float f = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
  vec3 c = mix(mix(uEdgeD, uEdgeL, uTheme), uGlow, vGlow);
  gl_FragColor = vec4(c, (uEdge * mix(1.0, 0.35, uGhost) + vGlow * 0.7) * f * vDraw);
}`;

// Studio map palette (packages/ui tokens) and the night plan.
const PAL = {
  sky: ['#0b1f1a', '#eef3f2'], fog: ['#0b1f1a', '#eef3f2'],
  plane: ['#0d241e', '#e9eeec'], sidewalk: ['#12302a', '#f2f5f4'], road: ['#173a32', '#dce2e2'], park: ['#1c4a37', '#d4e5d8'], water: ['#15394a', '#cfe1ec'], grid: ['#1f4a3f', '#d6dedb'],
};

export class World {
  constructor(canvas, data, scale = 1) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(1920, 1080, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1920 / 1080, 1, 12000);
    this.scene.background = col(PAL.sky[1]);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(300, 500, 200); this.scene.add(sun);
    this.data = data;
    this.buildings = data.buildings;
    this.uni = {
      uReveal: { value: 1.1 }, uHideUn: { value: 0 }, uFlat: { value: 1 }, uSel: { value: -1 }, uHideSel: { value: 0 }, uGhost: { value: 0 }, uHi1: { value: -1 }, uHi2: { value: -1 },
      uOrdMix: { value: 0 }, uDraw: { value: 2 }, uTheme: { value: 1 }, uSink: { value: 0 },
      uWallD: { value: col('#1b3d35') }, uWallL: { value: col('#cdd5d3') }, uRoofD: { value: col('#2a5a4e') }, uRoofL: { value: col('#f5f7f6') },
      uGlow: { value: col('#1baf7a') }, uHiCol: { value: col('#2f7a63') },
      uFogColor: { value: col(PAL.fog[1]) }, uFogNear: { value: 1200 }, uFogFar: { value: 3400 },
      uEdge: { value: 0.3 }, uEdgeD: { value: col('#7fd8b4') }, uEdgeL: { value: col('#8f9e9a') },
    };
    this.hero = data.buildings.findIndex((b) => b.bin === '1002735');
    const [hx, hy] = centroid(data.buildings[this.hero].r);
    this.origin = [hx, hy];
    this.#ground();
    this.#city();
    this.#heroGroup();
    this.#underground();
    this.setTheme(1);
  }

  #city() {
    const [ox, oy] = this.origin;
    const n = this.buildings.length;
    // distance order from the hero (for rising waves)
    const dist = this.buildings.map((b, i) => { const [x, y] = centroid(b.r); return [Math.hypot(x - ox, y - oy), i]; }).sort((a, b) => a[0] - b[0]);
    const order = new Float32Array(n); dist.forEach(([, i], rank) => { order[i] = rank / n; });
    // chunk order: 24 spatial chunks of the file, published in order (each chunk's buildings together)
    const NC = 24; const cols = 6, rows = 4;
    const cen = this.buildings.map((b) => centroid(b.r));
    const xs = cen.map((c) => c[0]).sort((a, b) => a - b), ys = cen.map((c) => c[1]).sort((a, b) => a - b);
    const qx = (k) => xs[Math.floor((k / cols) * (n - 1))], qy = (k) => ys[Math.floor((k / rows) * (n - 1))];
    const chunk = cen.map(([x, y]) => { let cx = 0, cy = 0; while (cx < cols - 1 && x > qx(cx + 1)) cx++; while (cy < rows - 1 && y > qy(cy + 1)) cy++; return (rows - 1 - cy) * cols + (cy % 2 ? cols - 1 - cx : cx); });
    const within = new Map(); const aChunk = new Float32Array(n); this.chunkOf = chunk; this.nChunks = NC;
    const counts = new Array(NC).fill(0); chunk.forEach((c) => counts[c]++); this.chunkCounts = counts;
    this.buildings.forEach((b, i) => { const c = chunk[i]; const k = within.get(c) ?? 0; within.set(c, k + 1); aChunk[i] = (c + 0.85 * (k / Math.max(1, counts[c]))) / NC; });
    const pos = [], nor = [], top = [], H = [], ord = [], chk = [], bid = [];
    const first = new Map(); this.buildings.forEach((b, i) => { if (!first.has(b.bin)) first.set(b.bin, i); });
    const epos = [], etop = [], eH = [], eord = [], echk = [], ebid = [];
    this.buildings.forEach((b, i) => {
      const r = ccw(b.r).map(([x, y]) => [x - ox, y - oy]);
      const add = (x, z, t, nn) => { pos.push(x, t, z); nor.push(...nn); top.push(t); H.push(b.h); ord.push(order[i]); chk.push(aChunk[i]); bid.push(first.get(b.bin)); };
      for (let k = 0; k < r.length; k++) {
        const a = r[k], c = r[(k + 1) % r.length];
        const ex = c[0] - a[0], ey = c[1] - a[1], l = Math.hypot(ex, ey) || 1; const nn = [ey / l, 0, ex / l];
        add(a[0], -a[1], 0, nn); add(c[0], -c[1], 0, nn); add(c[0], -c[1], 1, nn);
        add(a[0], -a[1], 0, nn); add(c[0], -c[1], 1, nn); add(a[0], -a[1], 1, nn);
        for (const [x, y, t] of [[a[0], a[1], 1], [c[0], c[1], 1], [a[0], a[1], 0], [c[0], c[1], 0]]) { epos.push(x, t, -y); etop.push(t); eH.push(b.h); eord.push(order[i]); echk.push(aChunk[i]); ebid.push(first.get(b.bin)); }
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
    g.setAttribute('aChunk', new THREE.Float32BufferAttribute(chk, 1));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(bid, 1));
    this.cityMat = new THREE.ShaderMaterial({ vertexShader: BUILD_VS, fragmentShader: BUILD_FS, uniforms: this.uni, transparent: true });
    this.cityMesh = new THREE.Mesh(g, this.cityMat); this.cityMesh.frustumCulled = false;
    this.scene.add(this.cityMesh);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
    eg.setAttribute('aTop', new THREE.Float32BufferAttribute(etop, 1));
    eg.setAttribute('aH', new THREE.Float32BufferAttribute(eH, 1));
    eg.setAttribute('aOrder', new THREE.Float32BufferAttribute(eord, 1));
    eg.setAttribute('aChunk', new THREE.Float32BufferAttribute(echk, 1));
    eg.setAttribute('aBid', new THREE.Float32BufferAttribute(ebid, 1));
    this.edgeMat = new THREE.ShaderMaterial({ vertexShader: EDGE_VS, fragmentShader: EDGE_FS, uniforms: this.uni, transparent: true, depthWrite: false });
    this.edges = new THREE.LineSegments(eg, this.edgeMat); this.edges.frustumCulled = false;
    this.scene.add(this.edges);
  }

  #ground() {
    const [ox, oy] = this.origin;
    this.groundMats = [];
    const reg = (m, pal, base) => { m.userData = { base, pal: pal.map(col) }; this.groundMats.push(m); return m; };
    const layer = (items, pal, y) => {
      const shapes = items.map(({ r, holes }) => {
        const s = new THREE.Shape(ccw(r).map(([x, yy]) => new THREE.Vector2(x - ox, yy - oy)));
        for (const hh of holes ?? []) s.holes.push(new THREE.Path(hh.map(([x, yy]) => new THREE.Vector2(x - ox, yy - oy))));
        return s;
      });
      const g = new THREE.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2);
      const m = reg(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }), pal, 1);
      const mesh = new THREE.Mesh(g, m); mesh.position.y = y; mesh.renderOrder = -1; this.scene.add(mesh); return mesh;
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), reg(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }), PAL.plane, 1));
    plane.renderOrder = -2; this.scene.add(plane);
    layer(this.data.sidewalk, PAL.sidewalk, 0.01);
    layer(this.data.roadbed, PAL.road, 0.02);
    layer(this.data.parks, PAL.park, 0.03);
    layer(this.data.hydrography, PAL.water, 0.04);
    const grid = new THREE.GridHelper(6000, 120, 0xffffff, 0xffffff); grid.position.y = -0.05; grid.material.transparent = true;
    reg(grid.material, PAL.grid, 0.45); this.scene.add(grid);
  }

  #heroGroup() {
    const b = this.buildings[this.hero]; const [ox, oy] = this.origin;
    this.heroRing = ccw(b.r);
    this.heroH = b.h;
    const n = 14; const fh = b.h / n; this.floorH = fh; this.nFloors = n;
    const g = new THREE.Group(); this.heroG = g; g.visible = false; this.scene.add(g);
    this.floors = [];
    const [cx, cy] = centroid(this.heroRing);
    let best = 0, dir = [1, 0];
    for (let i = 0; i < this.heroRing.length; i++) { const a = this.heroRing[i], c = this.heroRing[(i + 1) % this.heroRing.length]; const l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > best) { best = l; dir = [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; } }
    this.axis = dir;
    const nx = dir[0], ny = dir[1]; const cproj = nx * cx + ny * cy;
    const flatRing = clipHalf(this.heroRing, nx, ny, cproj);
    const otherRing = clipHalf(this.heroRing, -nx, -ny, -cproj);
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshStandardMaterial({ color: '#f4f7f6', roughness: 0.9, metalness: 0, transparent: true, opacity: 1 });
      const slab = new THREE.Mesh(prism(this.heroRing, i * fh + 0.12, (i + 1) * fh - 0.12, ox, oy), m);
      const e = new THREE.LineSegments(prismEdges(this.heroRing, i * fh + 0.12, (i + 1) * fh - 0.12, ox, oy), new THREE.LineBasicMaterial({ color: '#235347', transparent: true, opacity: 0.6 }));
      const fg = new THREE.Group(); fg.add(slab, e); g.add(fg);
      this.floors.push({ g: fg, slab, edge: e, mat: m });
    }
    this.flatFloor = 9;
    const flatMat = new THREE.MeshStandardMaterial({ color: '#235347', emissive: '#235347', emissiveIntensity: 0.35, roughness: 0.6, transparent: true, opacity: 0 });
    this.flat = new THREE.Mesh(prism(flatRing, this.flatFloor * fh + 0.05, (this.flatFloor + 1) * fh - 0.05, ox, oy), flatMat);
    this.flatEdge = new THREE.LineSegments(prismEdges(flatRing, this.flatFloor * fh + 0.05, (this.flatFloor + 1) * fh - 0.05, ox, oy), new THREE.LineBasicMaterial({ color: '#d6f478', transparent: true, opacity: 0 }));
    this.flatG = new THREE.Group(); this.flatG.add(this.flat, this.flatEdge);
    this.floors[this.flatFloor].g.add(this.flatG);
    this.flatCenter = centroid(flatRing).map((v, i) => v - this.origin[i]);
    this.otherCenter = centroid(otherRing).map((v, i) => v - this.origin[i]);
    const redMat = new THREE.MeshStandardMaterial({ color: '#d03b3b', emissive: '#b42318', emissiveIntensity: 0.4, transparent: true, opacity: 0, depthWrite: false });
    this.extra = new THREE.Mesh(prism(this.heroRing, b.h + 0.1, b.h + fh, ox, oy), redMat);
    this.extraEdge = new THREE.LineSegments(prismEdges(this.heroRing, b.h + 0.1, b.h + fh, ox, oy), new THREE.LineBasicMaterial({ color: '#b42318', transparent: true, opacity: 0 }));
    g.add(this.extra, this.extraEdge);
    const q = clipHalf(flatRing, -dir[1], dir[0], -dir[1] * cx + dir[0] * cy);
    const ovMat = new THREE.MeshStandardMaterial({ color: '#d03b3b', emissive: '#b42318', emissiveIntensity: 0.6, transparent: true, opacity: 0, depthWrite: false });
    this.overlap = new THREE.Mesh(prism(q, 0, fh * 0.9, ox, oy), ovMat);
    this.overlapEdge = new THREE.LineSegments(prismEdges(q, 0, fh * 0.9, ox, oy), new THREE.LineBasicMaterial({ color: '#b42318', transparent: true, opacity: 0 }));
    this.overlapCenter = centroid(q).map((v, i) => v - this.origin[i]);
    for (const m of [this.overlap, this.overlapEdge]) m.position.y = 6 * fh - fh * 0.75;
    this.floors[6].g.add(this.overlap, this.overlapEdge);
  }

  #underground() {
    const g = new THREE.Group(); this.under = g; g.visible = false; this.scene.add(g);
    const [ax, ay] = this.axis; const nx = -ay, ny = ax;
    const line = (off, along, depth, len, across = false) => {
      const d = across ? [nx, ny] : [ax, ay], o = across ? [ax, ay] : [nx, ny];
      const p0 = [o[0] * off + d[0] * (along - len / 2), o[1] * off + d[1] * (along - len / 2)];
      const p1 = [o[0] * off + d[0] * (along + len / 2), o[1] * off + d[1] * (along + len / 2)];
      return new THREE.LineCurve3(new THREE.Vector3(p0[0], -depth, -p0[1]), new THREE.Vector3(p1[0], -depth, -p1[1]));
    };
    this.pipes = [];
    const pipe = (curve, r, color) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, transparent: true, opacity: 0 });
      const geo = new THREE.TubeGeometry(curve, 60, r, 20, false);
      const mesh = new THREE.Mesh(geo, m); g.add(mesh); this.pipes.push({ m, geo, n: geo.index.count }); return mesh;
    };
    // Studio utility colours
    pipe(line(-26, 0, 2.4, 520), 0.9, '#1f6fd1');   // water main
    pipe(line(-30, 0, 1.6, 520), 0.4, '#f2c200');   // gas
    pipe(line(27, 0, 3.6, 520), 1.2, '#2e8b3a');    // sewer
    pipe(line(24, 0, 1.2, 520), 0.3, '#f28c00');    // telecom
    pipe(line(-8, 40, 2.8, 300, true), 0.7, '#1f6fd1');
    const tm = new THREE.MeshStandardMaterial({ color: '#b8c3c6', roughness: 0.9, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this.tunnelMat = tm;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(line(70, 0, 19, 700, true), 1, 5.5, 40, false), tm));
    this.soil = new THREE.Mesh(new THREE.BoxGeometry(170, 30, 170), new THREE.MeshBasicMaterial({ color: '#d9c9aa', transparent: true, opacity: 0, depthWrite: false }));
    this.soil.position.y = -15.2; g.add(this.soil);
    this.soilEdge = new THREE.LineSegments(new THREE.EdgesGeometry(this.soil.geometry), new THREE.LineBasicMaterial({ color: '#b89f78', transparent: true, opacity: 0 }));
    this.soilEdge.position.copy(this.soil.position); g.add(this.soilEdge);
    this.trenchMat = new THREE.MeshBasicMaterial({ color: '#d03b3b', transparent: true, opacity: 0, depthWrite: false });
    this.trench = new THREE.Mesh(new THREE.BoxGeometry(1, 3.2, 2.4), this.trenchMat); g.add(this.trench);
    this.trenchEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 3.2, 2.4)), new THREE.LineBasicMaterial({ color: '#b42318', transparent: true, opacity: 0 })); g.add(this.trenchEdge);
  }

  /** Grow pipe i to fraction p along its length. */
  setPipe(i, p, opacity) { const q = this.pipes[i]; q.geo.setDrawRange(0, Math.floor((q.n / 3) * Math.min(1, p)) * 3); q.m.opacity = opacity; }

  setTrench(len, opacity) {
    const [ax, ay] = this.axis; const nx = -ay, ny = ax;
    const cx = nx * -20 + ax * 10, cy = ny * -20 + ay * 10;
    const ang = Math.atan2(ay, ax);
    for (const m of [this.trench, this.trenchEdge]) {
      m.scale.set(Math.max(len, 0.01), 1, 1); m.rotation.y = ang;
      m.position.set(cx + ax * len / 2, -1.6, -(cy + ay * len / 2));
    }
    this.trenchMat.opacity = 0.5 * opacity; this.trenchEdge.material.opacity = opacity;
    this.trenchEnd = [cx + ax * len, cy + ay * len];
  }

  /** 0 = night plan, 1 = Studio map. */
  setTheme(k) {
    this.uni.uTheme.value = k;
    const bg = col(PAL.sky[0]).lerp(col(PAL.sky[1]), k);
    this.scene.background = bg; this.uni.uFogColor.value.copy(bg);
    for (const m of this.groundMats) m.color.copy(m.userData.pal[0]).lerp(m.userData.pal[1], k);
  }
  setGround(alpha) { for (const m of this.groundMats) m.opacity = m.userData.base * alpha; }

  camera_(pos, target, fov = 34, shift = 0) {
    this.camera.position.set(...pos); this.camera.fov = fov;
    if (shift) this.camera.setViewOffset(1920, 1080, -shift, 0, 1920, 1080); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix(); this.camera.lookAt(...target); this.camera.updateMatrixWorld(true);
  }
  project(x, y, north) {
    const v = new THREE.Vector3(x, y, -north).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * 1920, (1 - v.y) / 2 * 1080];
  }
  centerOf(i) { const [x, y] = centroid(this.buildings[i].r); return [x - this.origin[0], y - this.origin[1]]; }
  render() { this.renderer.render(this.scene, this.camera); }
}
