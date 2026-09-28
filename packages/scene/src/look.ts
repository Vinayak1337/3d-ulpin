import {
  BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh,
  Matrix4, MeshStandardMaterial, Object3D, SRGBColorSpace, ShapeGeometry, type Material, type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shapesFor } from './geometry';
import type { MultiPolygon, Ring } from './types';

/**
 * Enhanced view: deterministic, illustrative scene dressing over the recorded envelopes. Nothing here
 * changes a footprint, a height or a pick: tints come from the record ID and its recorded height, windows
 * and roofs are drawn by the shader on the recorded walls, sidewalk pads follow the recorded footprints and
 * trees are scattered only inside recorded public land. Plain view turns all of it off.
 */
export type SceneLook = 'enhanced' | 'plain';

/** Shared uniforms: one switch flips every enhanced material without recompiling. */
export interface LookUniforms {
  uLook: { value: number };
}

export function lookUniforms(): LookUniforms {
  return { uLook: { value: 1 } };
}

/**
 * Facade families, chosen per building from its ID (tall buildings lean to glass): masonry (brick,
 * brownstone, limestone, stucco), concrete, and glass. Muted so a dense area stays calm.
 */
const MASONRY = ['#b98a74', '#a97a66', '#c29a82', '#9c7a66', '#e6dccb', '#dccfb8', '#e9e2d4', '#d3c6b0', '#efe8dc', '#cdbfa9'];
const CONCRETE = ['#dcdad5', '#cfd0cd', '#e5e2da', '#d6d2c9', '#c8c9c6'];
const GLASS = ['#bccbd3', '#aebfc9', '#c9d3d8', '#b3c2c6'];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

/**
 * The illustrative facade of a building: a seed in [0, 1) whose range picks the family (masonry below 0.5,
 * concrete to 0.78, glass above) and varies its windows and roof, and the matching tint.
 */
export function facadeStyle(id: string, heightM: number | null): { seed: number; color: Color } {
  const h = hash(id);
  let seed = (h % 10007) / 10007;
  // Towers are mostly glass or concrete; low buildings mostly masonry.
  if (heightM !== null && heightM > 45 && ((h >>> 12) % 10) < 7) seed = 0.62 + seed * 0.38;
  else if (heightM !== null && heightM < 25 && ((h >>> 12) % 10) < 6) seed = seed * 0.5;
  const pick = (list: string[]) => list[(h >>> 4) % list.length]!;
  const color = new Color(seed < 0.5 ? pick(MASONRY) : seed < 0.78 ? pick(CONCRETE) : pick(GLASS));
  const jitter = 0.97 + (((h >>> 8) % 100) / 100) * 0.06;
  return { seed, color: color.multiplyScalar(jitter) };
}

/** Facade tint of a building (see facadeStyle). */
export function facadeTint(id: string, heightM: number | null): Color {
  return facadeStyle(id, heightM).color;
}

/** Per-vertex colour and facade seed so one shared material can draw every building differently. */
export function paintGeometry(geometry: BufferGeometry, color: Color, seed = 0): void {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { values[i * 3] = color.r; values[i * 3 + 1] = color.g; values[i * 3 + 2] = color.b; }
  geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(new Float32Array(count).fill(seed), 1));
}

interface FacadeOptions {
  /** Draw window bays and floor bands on walls. */
  windows: boolean;
  /** Use the per-building vertex tint (materials shared by the area's massing). */
  tint: boolean;
  /** Keep thematic vertex colours when illustrative facade details are disabled. */
  alwaysTint?: boolean;
  /** Glass colour of the windows. */
  glass?: string;
  /** Hover: lift the whole facade towards this colour. */
  lift?: string;
}

const NOISE_GLSL = `
float ulHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ulNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ulHash(i), ulHash(i + vec2(1.0, 0.0)), u.x), mix(ulHash(i + vec2(0.0, 1.0)), ulHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/**
 * Adds the enhanced facade to a standard material. Per building (from its seed): masonry with framed
 * punched windows, concrete with ribbon windows, or glass curtain wall; a storefront band at street level;
 * a roof tone. Storey spacing (3.2 m) is illustrative, never the recorded slabs. Details fade with
 * distance so dense areas stay calm.
 */
export function enhanceFacade(material: MeshStandardMaterial, uniforms: LookUniforms, options: FacadeOptions): void {
  if (options.tint) material.vertexColors = true;
  const glass = new Color(options.glass ?? '#6f8594');
  const lift = new Color(options.lift ?? '#000000');
  material.customProgramCacheKey = () => `facade2-${options.windows}-${options.tint}-${options.alwaysTint ?? false}-${Boolean(options.lift)}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLook = uniforms.uLook;
    shader.uniforms.uGlass = { value: glass };
    shader.uniforms.uLift = { value: lift };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSeed = aSeed;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLook;\nuniform vec3 uGlass;\nuniform vec3 uLift;\nvarying float vSeed;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, ${options.alwaysTint ? '1.0' : 'uLook'});
#endif
{
  vec3 n = normalize(vWNormal);
  float roof = step(0.6, n.y);
  float wall = 1.0 - step(0.6, abs(n.y));
  float seed = vSeed;
  float masonry = step(seed, 0.5), glassy = step(0.78, seed), concrete = (1.0 - masonry) * (1.0 - glassy);
  // Roof: light concrete, grey membrane or dark gravel, with a faint mottle.
  float rt = fract(seed * 7.13);
  vec3 roofTone = rt < 0.45 ? vec3(0.84, 0.85, 0.85) : rt < 0.8 ? vec3(0.72, 0.73, 0.74) : vec3(0.58, 0.58, 0.56);
  roofTone *= 0.96 + 0.08 * ulNoise(vWPos.xz * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, roofTone, roof * uLook * ${options.tint ? '0.8' : '0.0'});
  // Soft occlusion where walls meet the ground.
  float occl = mix(0.72, 1.0, smoothstep(0.0, 6.0, vWPos.y));
  diffuseColor.rgb *= mix(1.0, occl, wall * uLook);
  ${options.windows ? `
  vec2 t = normalize(vec2(-n.z, n.x) + 1e-5);
  float along = dot(vWPos.xz, t);
  // Window module per family: masonry 3.0 m bays, concrete 1.8 m ribbons, glass 1.5 m mullions.
  float bay = masonry > 0.5 ? 2.8 + fract(seed * 13.7) * 0.8 : concrete > 0.5 ? 1.8 : 1.5;
  float storey = 3.2 + fract(seed * 5.3) * 0.5;
  float u = along / bay;
  float v = (vWPos.y - 4.2) / storey;
  vec2 fw = fwidth(vec2(u, v));
  float fade = 1.0 - smoothstep(0.1, 0.32, max(fw.x, fw.y));
  float fu = fract(u), fv = fract(v);
  float aa = max(fw.x, 0.015), ab = max(fw.y, 0.015);
  float halfW = masonry > 0.5 ? 0.2 + fract(seed * 3.1) * 0.08 : concrete > 0.5 ? 0.44 : 0.47;
  float top = masonry > 0.5 ? 0.82 : concrete > 0.5 ? 0.78 : 0.95;
  float bot = masonry > 0.5 ? 0.3 : concrete > 0.5 ? 0.38 : 0.05;
  float boxU = smoothstep(0.5 - halfW - aa, 0.5 - halfW + aa, fu) * (1.0 - smoothstep(0.5 + halfW - aa, 0.5 + halfW + aa, fu));
  float boxV = smoothstep(bot - ab, bot + ab, fv) * (1.0 - smoothstep(top - ab, top + ab, fv));
  float win = boxU * boxV;
  // Masonry windows get a light stone frame (sill and lintel).
  float frameU = smoothstep(0.5 - halfW - 0.06 - aa, 0.5 - halfW - 0.06 + aa, fu) * (1.0 - smoothstep(0.5 + halfW + 0.06 - aa, 0.5 + halfW + 0.06 + aa, fu));
  float frameV = smoothstep(bot - 0.06 - ab, bot - 0.06 + ab, fv) * (1.0 - smoothstep(top + 0.05 - ab, top + 0.05 + ab, fv));
  float frame = frameU * frameV * (1.0 - win) * masonry;
  float upper = step(4.2, vWPos.y);
  float k = fade * wall * upper * uLook;
  // Glass: darker low, catching more sky higher up; a slight variation per pane.
  float sky = smoothstep(0.0, 60.0, vWPos.y);
  vec3 pane = mix(uGlass * 0.8, min(uGlass * 1.35, vec3(1.0)), 0.35 * sky + 0.3 * ulHash(floor(vec2(u, v))));
  diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * 1.12, vec3(1.0)), frame * k * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, pane, win * k * (glassy > 0.5 ? 0.85 : 0.7));
  // Floor slabs on glass towers; storey band on concrete.
  float slab = 1.0 - smoothstep(0.0, ab * 2.5, fv) * (1.0 - smoothstep(1.0 - ab * 2.5, 1.0, fv));
  diffuseColor.rgb *= 1.0 - slab * k * (glassy > 0.5 ? 0.25 : 0.06);
  // Street level: a storefront of large panes under a sign band (below 4.2 m) on buildings over 6 m.
  float ground = (1.0 - upper) * step(0.35, vWPos.y) * wall * uLook;
  float su = fract(along / 1.6);
  float shop = smoothstep(0.08, 0.12, su) * (1.0 - smoothstep(0.88, 0.92, su)) * (1.0 - smoothstep(3.2, 3.3, vWPos.y));
  float sign = smoothstep(3.3, 3.4, vWPos.y) * (1.0 - step(4.2, vWPos.y));
  float gFade = 1.0 - smoothstep(0.1, 0.32, fwidth(along / 1.6));
  diffuseColor.rgb = mix(diffuseColor.rgb, uGlass * 0.55, shop * ground * gFade * 0.85);
  diffuseColor.rgb *= 1.0 - sign * ground * 0.18;
  // Far away: a hint of glass so walls keep texture.
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, uGlass, glassy > 0.5 ? 0.35 : 0.1), (1.0 - fade) * wall * upper * uLook);
  ` : ''}
  ${options.lift ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uLift, 0.42);' : ''}
}
`);
  };
  material.needsUpdate = true;
}

/**
 * Surface texture for flat layers (enhanced view): a fine grain on paving and asphalt, a mottle on grass,
 * gentle ripples on water. Colours stay the layer's own.
 */
export function enhanceSurface(material: MeshStandardMaterial, uniforms: LookUniforms, kind: 'paving' | 'grass' | 'water'): void {
  material.customProgramCacheKey = () => `surface-${kind}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLook = uniforms.uLook;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const body = kind === 'grass'
      ? 'float g = ulNoise(vWPos.xz * 0.35) * 0.6 + ulNoise(vWPos.xz * 1.7) * 0.4; diffuseColor.rgb *= mix(1.0, 0.86 + 0.24 * g, uLook);'
      : kind === 'water'
        ? 'float w = ulNoise(vec2(vWPos.x * 0.18 + vWPos.z * 0.05, vWPos.z * 0.9)) * 0.7 + ulNoise(vWPos.xz * 0.6) * 0.3; diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.86, min(diffuseColor.rgb * 1.18, vec3(1.0)), w), uLook);'
        : 'float s = ulNoise(vWPos.xz * 2.3); diffuseColor.rgb *= mix(1.0, 0.95 + 0.08 * s, uLook);';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLook;\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{ ${body} }`);
  };
  material.needsUpdate = true;
}

/** Vertical sky gradient for the background (screen space). */
export function skyTexture(top: string, horizon: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, horizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Offsets a closed ring outwards by `d` metres (mitred, limited at sharp corners). */
export function offsetRing(ring: Ring, d: number): Ring {
  const pts = ring.slice();
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
  const n = pts.length;
  if (n < 3) return ring;
  let area = 0;
  for (let i = 0; i < n; i++) { const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % n]!; area += ax * by - bx * ay; }
  const sign = area > 0 ? 1 : -1; // counter-clockwise: outward normal is to the right
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n]!, [cx, cy] = pts[i]!, [nx, ny] = pts[(i + 1) % n]!;
    let e1x = cx - px, e1y = cy - py, e2x = nx - cx, e2y = ny - cy;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    const n1x = e1y * sign, n1y = -e1x * sign, n2x = e2y * sign, n2y = -e2x * sign;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const cos = mx * n1x + my * n1y;
    const k = Math.min(d / Math.max(cos, 0.35), d * 2.5);
    out.push([cx + mx * k, cy + my * k]);
  }
  out.push(out[0]!);
  return out;
}

/** One merged, flat geometry of sidewalk pads around the given footprints (scene axes, at `y`). */
export function padGeometry(footprints: MultiPolygon[], distance: number, y: number): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const polygons of footprints) {
    const grown: MultiPolygon = polygons.map((polygon) => [offsetRing(polygon[0] ?? [], distance)]).filter((p) => p[0]!.length >= 4);
    const shapes = shapesFor(grown);
    if (!shapes.length) continue;
    const g = new ShapeGeometry(shapes);
    g.deleteAttribute('uv');
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function inPolygons(x: number, y: number, polygons: MultiPolygon): boolean {
  return polygons.some(([outer, ...holes]) => outer && pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h)));
}

/** A tiny deterministic generator for the tree scatter. */
function rng(seed: number) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/**
 * Illustrative trees inside recorded public land (parks, green strips), kept clear of building
 * footprints. Deterministic per land parcel ID; about one tree per 60 m².
 */
export function treeMeshes(lands: { id: string; polygons: MultiPolygon }[], avoid: MultiPolygon[], crown: Material, trunk: Material): Object3D[] {
  const points: [number, number, number][] = [];
  const avoidBoxes = avoid.map((polygons) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const polygon of polygons) for (const [x, y] of polygon[0] ?? []) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { polygons, minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2 };
  });
  for (const land of lands) {
    const random = rng(hash(land.id));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const polygon of land.polygons) for (const [x, y] of polygon[0] ?? []) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (!Number.isFinite(minX)) continue;
    const step = 7.5;
    for (let x = minX + step / 2; x < maxX; x += step) {
      for (let y = minY + step / 2; y < maxY; y += step) {
        const px = x + (random() - 0.5) * step * 0.8, py = y + (random() - 0.5) * step * 0.8;
        if (random() < 0.12 || !inPolygons(px, py, land.polygons)) continue;
        if (avoidBoxes.some((b) => px > b.minX && px < b.maxX && py > b.minY && py < b.maxY && inPolygons(px, py, b.polygons))) continue;
        points.push([px, py, 0.75 + random() * 0.6]);
        if (points.length > 6000) break;
      }
    }
  }
  if (!points.length) return [];
  const crownGeometry = mergeGeometries([
    new IcosahedronGeometry(2.2, 1).translate(0, 4.6, 0),
    new ConeGeometry(1.6, 2.2, 7).translate(0, 6.4, 0),
  ].map((g) => g.toNonIndexed()), false);
  const trunkGeometry = new CylinderGeometry(0.18, 0.26, 2.8, 6).translate(0, 1.4, 0);
  const crowns = new InstancedMesh(crownGeometry, crown, points.length);
  const trunks = new InstancedMesh(trunkGeometry, trunk, points.length);
  const m = new Matrix4();
  const tint = new Color();
  const shades = [new Color('#7fa36a'), new Color('#6b945b'), new Color('#8db274'), new Color('#5f8a54')];
  points.forEach(([x, y, s], i) => {
    m.makeScale(s, s, s).setPosition(x, 0, -y);
    crowns.setMatrixAt(i, m);
    trunks.setMatrixAt(i, m);
    crowns.setColorAt(i, tint.copy(shades[i % shades.length]!));
  });
  for (const mesh of [crowns, trunks]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.raycast = () => {}; }
  return [crowns, trunks];
}

/**
 * Dashed centre line of a straight road: only where the road polygon nearly fills its oriented bounding
 * box and is long and narrow, so curved or irregular roads never get an invented line. Scene-axis segments.
 */
export function laneDashes(polygons: MultiPolygon, y: number): number[] {
  const out: number[] = [];
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    const n = ring.length - 1;
    if (n < 4) continue;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += ring[i]![0]; cy += ring[i]![1]; }
    cx /= n; cy /= n;
    // Principal axis from the vertex covariance.
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const dx = ring[i]![0] - cx, dy = ring[i]![1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = ring[i]![0] - cx, dy = ring[i]![1] - cy;
      const u = dx * ux + dy * uy, v = -dx * uy + dy * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const length = maxU - minU, width = maxV - minV;
    let area = 0;
    for (let i = 0; i < n; i++) { const [ax, ay] = ring[i]!, [bx, by] = ring[i + 1]!; area += ax * by - bx * ay; }
    area = Math.abs(area) / 2;
    if (width < 5 || length < width * 3 || area < length * width * 0.9) continue;
    const mid = (minV + maxV) / 2;
    const ox = cx - uy * mid, oy = cy + ux * mid;
    for (let u = minU + 3; u + 3 < maxU - 3; u += 6) {
      const ax = ox + ux * u, ay = oy + uy * u, bx = ox + ux * (u + 3), by = oy + uy * (u + 3);
      out.push(ax, y, -ay, bx, y, -by);
    }
  }
  return out;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a / 2;
}

/**
 * A point inside the feature's largest polygon for its name label, and the polygon's size (square root of
 * its area, metres) so labels can be hidden when the feature is too small on screen.
 */
export function labelPoint(polygons: MultiPolygon): { x: number; y: number; sizeM: number } | null {
  let best: MultiPolygon[number] | null = null, bestArea = 0;
  for (const polygon of polygons) { const a = Math.abs(ringArea(polygon[0] ?? [])); if (a > bestArea) { bestArea = a; best = polygon; } }
  const outer = best?.[0];
  if (!best || !outer || outer.length < 4) return null;
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0; i < outer.length - 1; i++) {
    const [x0, y0] = outer[i]!, [x1, y1] = outer[i + 1]!;
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f; cy += (y0 + y1) * f; a2 += f;
  }
  if (a2) { cx /= 3 * a2; cy /= 3 * a2; }
  const sizeM = Math.sqrt(bestArea);
  if (inPolygons(cx, cy, [best])) return { x: cx, y: cy, sizeM };
  // Centroid outside (an L or a ring): the middle of the widest inside span on the centroid's row.
  const xs: number[] = [];
  for (const ring of best) for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]!, [x1, y1] = ring[i + 1]!;
    if ((y0 > cy) !== (y1 > cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
  }
  xs.sort((p, q) => p - q);
  let bx = outer[0]![0], by = outer[0]![1], width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1]! - xs[i]! > width && inPolygons((xs[i]! + xs[i + 1]!) / 2, cy, [best])) { width = xs[i + 1]! - xs[i]!; bx = (xs[i]! + xs[i + 1]!) / 2; by = cy; }
  return width > 0 ? { x: bx, y: by, sizeM } : null;
}
