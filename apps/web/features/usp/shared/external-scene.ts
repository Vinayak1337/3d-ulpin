import earcut from 'earcut';

type Vec3 = [number, number, number];
type Vec2 = [number, number];
export type ExternalRoofScene = {
  schemaVersion: 'usp-external-roof/1';
  sourceBuildingId: string;
  partIds: string[];
  referenceSystem: string;
  frame: { kind: 'local_engineering_display'; origin: Vec3; unit: 'm'; verticalDatum: 'NAP'; globalPlacement: 'unqualified' };
  vertices: Vec3[];
  faces: Array<{ partId: string; sourceFaceIndex: number; semanticIndex: number | null; surfaceType: string | null; indices: number[]; rings: number[][]; triangles: number[]; normal: Vec3 }>;
  bounds: { minimum: Vec3; maximum: Vec3 };
  lod: '2.2';
  interiors: 'unavailable';
  analyticalVolume: 'unsupported';
};

const CRS = 'https://www.opengis.net/def/crs/EPSG/0/7415';
const EPS = 1e-8;
function fail(message: string): never { throw new Error(`External roof: ${message}`); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must contain ${min}–${max} entries`);
  return value;
}
function vector(value: unknown, label: string): Vec3 {
  const result = array(value, label, 3, 3);
  if (!result.every((n) => typeof n === 'number' && Number.isFinite(n))) fail(`${label} must contain finite coordinates`);
  return result as Vec3;
}
function boundedJson(value: unknown): void {
  // Bound even ignored attributes/LoDs. This accepts parsed JSON, never arbitrary class instances.
  let remaining = 150_000;
  const visit = (item: unknown, depth: number): void => {
    if (--remaining < 0 || depth > 24) fail('input exceeds JSON complexity limit');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string' && item.length <= 32_768) return;
    if (!item || typeof item !== 'object') fail('input must be finite plain JSON');
    if (Object.getPrototypeOf(item) !== Object.prototype && !Array.isArray(item)) fail('input must be plain JSON');
    if (Array.isArray(item)) {
      if (item.length > 20_000) fail('input array exceeds limit');
      for (const child of item) visit(child, depth + 1);
    } else {
      const keys = Object.keys(item);
      if (keys.length > 4096) fail('input object exceeds limit');
      for (const key of keys) {
        if (key.length > 1024) fail('input key exceeds limit');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) fail('input must not contain accessors');
        visit(descriptor.value, depth + 1);
      }
    }
  };
  visit(value, 0);
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  if (length < EPS) fail('degenerate face plane');
  return v.map((n) => n / length) as Vec3;
}
const turn = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = (ring: Vec2[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return Math.abs(turn(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
  return ((turn(a, b, c) > 0) !== (turn(a, b, d) > 0)) && ((turn(c, d, a) > 0) !== (turn(c, d, b) > 0));
}
function inside(point: Vec2, ring: Vec2[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(a, b, point)) return false;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function triangulate(rings: number[][], vertices: Vec3[], tolerance: number, spend: () => void) {
  const base = vertices[rings[0][0]];
  // Newell's area-weighted normal uses the complete ring; a collinear first triple is valid.
  const normalSum: Vec3 = [0, 0, 0];
  rings[0].forEach((index, i) => {
    const contribution = cross(sub(vertices[index], base), sub(vertices[rings[0][(i + 1) % rings[0].length]], base));
    for (let axis = 0; axis < 3; axis++) normalSum[axis] += contribution[axis];
  });
  const normal = unit(normalSum);
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const leastAligned = axes.reduce((best, candidate) => Math.abs(dot(candidate, normal)) < Math.abs(dot(best, normal)) ? candidate : best);
  const u = unit(cross(leastAligned, normal)), v = cross(normal, u);
  const projected = rings.map((ring) => ring.map((index): Vec2 => {
    const relative = sub(vertices[index], base);
    if (Math.abs(dot(relative, normal)) > tolerance) fail('nonplanar face exceeds scale-derived tolerance (maximum 2 mm)');
    return [dot(relative, u), dot(relative, v)];
  }));
  projected.forEach((ring) => {
    if (Math.abs(area(ring)) < EPS) fail('degenerate ring');
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], previous = ring[(i + ring.length - 1) % ring.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS) fail('ring contains a zero-length edge');
      if (Math.abs(turn(previous, a, b)) <= EPS && (a[0] - previous[0]) * (b[0] - a[0]) + (a[1] - previous[1]) * (b[1] - a[1]) < 0) fail('ring contains a reversing edge');
      for (let j = i + 1; j < ring.length; j++) {
        if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
        spend();
        if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) fail('self-intersecting or touching ring');
      }
    }
  });
  for (let i = 0; i < projected.length; i++) {
    for (let j = i + 1; j < projected.length; j++) {
      const a = projected[i], b = projected[j];
      for (let p = 0; p < a.length; p++) for (let q = 0; q < b.length; q++) {
        spend();
        if (intersects(a[p], a[(p + 1) % a.length], b[q], b[(q + 1) % b.length])) fail('intersecting or touching face rings');
      }
      if (i === 0 && !inside(b[0], a)) fail('hole lies outside outer ring');
      if (i > 0 && (inside(a[0], b) || inside(b[0], a))) fail('nested or overlapping holes are unsupported');
    }
  }
  const indices = rings.flat();
  const holeOffsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < rings.length; i++) { if (i > 0) holeOffsets.push(offset); offset += rings[i].length; }
  const points = projected.flat();
  const flatTriangles = earcut(points.flat(), holeOffsets, 2);
  const expectedArea = Math.abs(area(projected[0])) - projected.slice(1).reduce((sum, ring) => sum + Math.abs(area(ring)), 0);
  let covered = 0;
  const triangles: number[] = [];
  for (let i = 0; i < flatTriangles.length; i += 3) {
    const a = flatTriangles[i], b = flatTriangles[i + 1], c = flatTriangles[i + 2];
    const signed = turn(points[a], points[b], points[c]);
    if (Math.abs(signed) <= EPS) fail('triangulation produced a degenerate triangle');
    covered += Math.abs(signed) / 2;
    // Keep the source outer ring's normal even when the triangulator reverses winding.
    triangles.push(indices[a], indices[signed > 0 ? b : c], indices[signed > 0 ? c : b]);
  }
  if (expectedArea <= EPS || Math.abs(covered - expectedArea) > Math.max(EPS, expectedArea * 1e-8)) fail('triangulation does not cover the hole-excluded face');
  return { indices, triangles, normal };
}

/** Bounded display decoder. It does not certify solids, interiors, quantities or global placement. */
export function decodeCityJsonRoof(input: unknown, expectedBuildingId: string): ExternalRoofScene {
  boundedJson(input);
  if (!expectedBuildingId || expectedBuildingId.length > 256) fail('expected building identity is invalid');
  const envelope = object(input, 'response'), metadata = object(envelope.metadata, 'metadata'), feature = object(envelope.feature, 'feature');
  if (metadata.type !== 'CityJSON' || metadata.version !== '2.0' || feature.type !== 'CityJSONFeature') fail('requires CityJSON 2.0 metadata and CityJSONFeature');
  if (envelope.id !== expectedBuildingId || feature.id !== expectedBuildingId) fail('source building identity mismatch');
  if ('transform' in feature) fail('feature transform is ambiguous; transform must occur only in metadata');
  if (object(metadata.metadata, 'nested metadata').referenceSystem !== CRS) fail('unsupported reference system; requires EPSG:7415');
  const transform = object(metadata.transform, 'transform');
  const scale = vector(transform.scale, 'transform scale'), translate = vector(transform.translate, 'transform translate');
  if (scale.some((n) => n <= 0 || n > 1) || translate.some((n) => Math.abs(n) > 10_000_000)) fail('transform is outside supported metric limits');
  const tolerance = Math.min(0.002, Math.max(EPS, Math.hypot(...scale) + 1e-9));
  const decoded = array(feature.vertices, 'vertices', 3, 20_000).map((value, index): Vec3 => {
    const encoded = vector(value, `vertex ${index}`);
    if (encoded.some((n) => !Number.isSafeInteger(n))) fail(`vertex ${index} must contain encoded integers`);
    const result = encoded.map((n, axis) => n * scale[axis] + translate[axis]) as Vec3;
    if (result.some((n) => !Number.isFinite(n) || Math.abs(n) > 10_000_000)) fail(`vertex ${index} exceeds coordinate bounds`);
    return result;
  });
  const objects = object(feature.CityObjects, 'CityObjects');
  const building = object(objects[expectedBuildingId], 'building');
  if (building.type !== 'Building' || ('parents' in building && array(building.parents, 'building parents', 0, 0).length)) fail('invalid building hierarchy');
  const partIds = array(building.children, 'building children', 1, 32).map((id) => {
    if (typeof id !== 'string' || !id || id.length > 256 || id === expectedBuildingId) fail('invalid part identity');
    return id;
  });
  if (new Set(partIds).size !== partIds.length || Object.keys(objects).length !== partIds.length + 1) fail('mixed, duplicate or unlinked source identities');
  const pending: Array<{ partId: string; sourceFaceIndex: number; semanticIndex: number | null; surfaceType: string | null; rings: number[][] }> = [];
  const used = new Set<number>();
  let ringVertexCount = 0;
  for (const partId of partIds) {
    const part = object(objects[partId], `part ${partId}`);
    const parents = array(part.parents, 'part parents', 1, 1);
    if (part.type !== 'BuildingPart' || parents[0] !== expectedBuildingId || ('children' in part && array(part.children, 'part children', 0, 0).length)) fail('part hierarchy does not match building');
    const geometries = array(part.geometry, 'part geometry', 1, 16).map((value) => object(value, 'geometry'));
    const matches = geometries.filter((geometry) => geometry.lod === '2.2');
    if (matches.length !== 1 || matches[0].type !== 'Solid') fail('each part requires exactly one LoD 2.2 Solid');
    const geometry = matches[0];
    const shell = array(array(geometry.boundaries, 'solid shells', 1, 1)[0], 'shell faces', 1, 2048);
    let surfaces: Record<string, unknown>[] = [], values: unknown[] | null = null;
    if (geometry.semantics !== undefined) {
      const semantics = object(geometry.semantics, 'semantics');
      surfaces = array(semantics.surfaces, 'semantic surfaces', 1, 2048).map((value) => object(value, 'semantic surface'));
      if (surfaces.some((surface) => typeof surface.type !== 'string' || !surface.type || surface.type.length > 128)) fail('invalid semantic surface type');
      values = array(array(semantics.values, 'semantic shells', 1, 1)[0], 'semantic face values', shell.length, shell.length);
    }
    shell.forEach((face, faceIndex) => {
      if (pending.length >= 2048) fail('face limit exceeded');
      const rings = array(face, 'face rings', 1, 16).map((ring) => {
        const indices = array(ring, 'ring vertices', 3, 512).map((index) => {
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= decoded.length) fail('invalid vertex index');
          used.add(index);
          return index;
        });
        ringVertexCount += indices.length;
        if (ringVertexCount > 32_000) fail('ring vertex budget exceeded');
        if (new Set(indices).size !== indices.length) fail('ring repeats a vertex index');
        return indices;
      });
      const semantic = values?.[faceIndex] ?? null;
      if (semantic !== null && (typeof semantic !== 'number' || !Number.isInteger(semantic) || semantic < 0 || semantic >= surfaces.length)) fail('invalid semantic surface index');
      pending.push({ partId, sourceFaceIndex: faceIndex, semanticIndex: semantic as number | null, rings,
        surfaceType: semantic === null ? null : surfaces[semantic as number].type as string });
    });
  }
  const minimum: Vec3 = [Infinity, Infinity, Infinity], maximum: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const index of used) for (let axis = 0; axis < 3; axis++) {
    minimum[axis] = Math.min(minimum[axis], decoded[index][axis]);
    maximum[axis] = Math.max(maximum[axis], decoded[index][axis]);
  }
  if (maximum.some((n, axis) => n - minimum[axis] > 10_000)) fail('building exceeds supported local extent');
  const origin: Vec3 = [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, minimum[2]];
  const vertices = decoded.map((vertex) => sub(vertex, origin));
  let comparisons = 0;
  const spend = () => { if (++comparisons > 2_000_000) fail('topology comparison budget exceeded'); };
  const faces = pending.map((face) => ({ ...face, ...triangulate(face.rings, vertices, tolerance, spend) }));
  return {
    schemaVersion: 'usp-external-roof/1', sourceBuildingId: expectedBuildingId, partIds, referenceSystem: CRS,
    frame: { kind: 'local_engineering_display', origin, unit: 'm', verticalDatum: 'NAP', globalPlacement: 'unqualified' },
    vertices, faces, bounds: { minimum: sub(minimum, origin), maximum: sub(maximum, origin) }, lod: '2.2',
    interiors: 'unavailable', analyticalVolume: 'unsupported',
  };
}
