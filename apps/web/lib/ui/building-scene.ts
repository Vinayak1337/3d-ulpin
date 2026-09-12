import earcut from "earcut";
import type { ComputedUnit, ModelSnapshot, Point2 } from "@ulpin/contracts";

/** Display geometry only. Nothing in this module is written back to a model. */
export type Point3 = [number, number, number];
export interface SceneMesh {
  ownerId: string;
  material: string;
  color: string;
  alpha: number;
  positions: number[];
  normals: number[];
  indices: number[];
}
export interface ExteriorEdge {
  ownerId: string;
  a: Point2;
  b: Point2;
  outward: Point2;
  length: number;
}
export interface BuildingScene {
  meshes: SceneMesh[];
  edges: ExteriorEdge[];
  entrance: ExteriorEdge | null;
  cameraHeading: number;
  lightDirection: Point3;
  grade: number;
}

const TOLERANCE = 1e-5;
const COLORS = {
  plaster: "#dedbd3",
  slab: "#ece8df",
  roof: "#aaa89f",
  frame: "#393c3a",
  glass: "#687b80",
  glassLight: "#9caba9",
  reveal: "#b7b5aa",
  entrance: "#8c8170",
  metal: "#525951",
  basement: "#a6aaa4",
  paving: "#d6d2c7",
  site: "#e3e0d7",
  soil: "#898b74",
  foliage: "#78856b",
  foliageLight: "#929b80",
  trunk: "#827568",
  contact: "#5e6158",
} as const;

type Material = keyof typeof COLORS;

const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const signedArea = (ring: Point2[]) => ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) / 2;

export function inferBuildingGrade(units: ComputedUnit[]): number {
  const occupied = units.filter(unit => unit.kind !== "basement");
  return occupied.length ? Math.min(...occupied.map(unit => unit.lower)) : units.length ? Math.max(...units.map(unit => unit.upper)) : 0;
}

export function pointInFootprint(point: Point2, ring: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function splitParameters(a: Point2, b: Point2, units: ComputedUnit[]): number[] {
  const vector = subtract(b, a);
  const lengthSquared = vector[0] ** 2 + vector[1] ** 2;
  const parameters = [0, 1];
  for (const unit of units) for (let i = 0; i < unit.footprint.length; i++) {
    const c = unit.footprint[i], d = unit.footprint[(i + 1) % unit.footprint.length];
    const other = subtract(d, c), start = subtract(c, a);
    const denominator = cross(vector, other);
    if (Math.abs(denominator) > TOLERANCE) {
      const t = cross(start, other) / denominator, u = cross(start, vector) / denominator;
      if (t > TOLERANCE && t < 1 - TOLERANCE && u >= -TOLERANCE && u <= 1 + TOLERANCE) parameters.push(t);
    } else if (Math.abs(cross(start, vector)) < TOLERANCE) {
      for (const p of [c, d]) {
        const relative = subtract(p, a);
        const t = (relative[0] * vector[0] + relative[1] * vector[1]) / lengthSquared;
        if (t > TOLERANCE && t < 1 - TOLERANCE) parameters.push(t);
      }
    }
  }
  return parameters.sort((x, y) => x - y).filter((t, i, list) => i === 0 || t - list[i - 1] > TOLERANCE);
}

/** Shared or partially shared walls never receive exterior windows. */
export function exteriorEdges(units: ComputedUnit[]): ExteriorEdge[] {
  const edges: ExteriorEdge[] = [];
  const grade = inferBuildingGrade(units);
  const aboveGrade = units.filter(unit => unit.upper > grade && unit.kind !== "basement");
  for (const unit of aboveGrade) {
    const orientation = signedArea(unit.footprint) >= 0 ? 1 : -1;
    const middleZ = (Math.max(grade, unit.lower) + unit.upper) / 2;
    const neighbors = aboveGrade.filter(other => other.id !== unit.id && other.lower < middleZ - TOLERANCE && other.upper > middleZ + TOLERANCE);
    for (let i = 0; i < unit.footprint.length; i++) {
      const a = unit.footprint[i], b = unit.footprint[(i + 1) % unit.footprint.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < TOLERANCE) continue;
      const outward: Point2 = [orientation * dy / length, -orientation * dx / length];
      const parameters = splitParameters(a, b, aboveGrade);
      for (let p = 0; p < parameters.length - 1; p++) {
        const start = parameters[p], end = parameters[p + 1], middle = (start + end) / 2;
        const sample: Point2 = [a[0] + dx * middle + outward[0] * 0.002, a[1] + dy * middle + outward[1] * 0.002];
        if (neighbors.some(other => pointInFootprint(sample, other.footprint))) continue;
        edges.push({ ownerId: unit.id, a: [a[0] + dx * start, a[1] + dy * start], b: [a[0] + dx * end, a[1] + dy * end], outward, length: length * (end - start) });
      }
    }
  }
  return edges;
}

class MeshBuilder {
  mesh: SceneMesh;
  constructor(ownerId: string, material: string, color: string, alpha = 1) {
    this.mesh = { ownerId, material, color, alpha, positions: [], normals: [], indices: [] };
  }

  face(points: Point3[], normal?: Point3) {
    const u = points[1].map((p, i) => p - points[0][i]);
    const v = points[2].map((p, i) => p - points[0][i]);
    const crossProduct: Point3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...crossProduct);
    if (length < 1e-12) return;
    const n = normal || crossProduct.map(value => value / length) as Point3;
    const first = this.mesh.positions.length / 3;
    for (const point of points) {
      this.mesh.positions.push(...point);
      this.mesh.normals.push(...n);
    }
    const reverse = crossProduct.reduce((sum, value, i) => sum + value * n[i], 0) < 0;
    for (let i = 1; i < points.length - 1; i++) this.mesh.indices.push(first, first + (reverse ? i + 1 : i), first + (reverse ? i : i + 1));
  }

  prism(ring: Point2[], lower: number, upper: number, exterior?: ExteriorEdge[]) {
    if (ring.length < 3 || upper <= lower) return;
    const triangulation = earcut(ring.flat());
    for (let i = 0; i < triangulation.length; i += 3) {
      const triangle = triangulation.slice(i, i + 3).map(index => ring[index]);
      this.face(triangle.map(([x, y]) => [x, y, upper]), [0, 0, 1]);
      this.face(triangle.map(([x, y]) => [x, y, lower]), [0, 0, -1]);
    }
    if (exterior) {
      for (const edge of exterior) this.face([[...edge.a, lower], [...edge.b, lower], [...edge.b, upper], [...edge.a, upper]], [...edge.outward, 0]);
      return;
    }
    const orientation = signedArea(ring) >= 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < TOLERANCE) continue;
      this.face([[...a, lower], [...b, lower], [...b, upper], [...a, upper]], [orientation * (b[1] - a[1]) / length, -orientation * (b[0] - a[0]) / length, 0]);
    }
  }
}

export function createPrismMesh(ring: Point2[], lower: number, upper: number, color: string, ownerId: string, alpha = 1): SceneMesh {
  const builder = new MeshBuilder(ownerId, "volume", color, alpha);
  builder.prism(ring, lower, upper);
  return builder.mesh;
}

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function along(edge: ExteriorEdge, distance: number, depth: number): Point2 {
  return [edge.a[0] + (edge.b[0] - edge.a[0]) * distance / edge.length + edge.outward[0] * depth, edge.a[1] + (edge.b[1] - edge.a[1]) * distance / edge.length + edge.outward[1] * depth];
}

function edgeRectangle(edge: ExteriorEdge, start: number, end: number, inner: number, outer: number): Point2[] {
  return [along(edge, start, inner), along(edge, end, inner), along(edge, end, outer), along(edge, start, outer)];
}

export function buildBuildingScene(model: ModelSnapshot, visibleUnits: ComputedUnit[], offsets: Map<string, number>, revealBasement: boolean): BuildingScene {
  // Work relative to the supplied ground-storey datum, then translate only the
  // illustrative output back. This keeps an offset benchmark (e.g. +100 m)
  // from creating a floating building while preserving every source elevation.
  const datum = inferBuildingGrade(model.units);
  if (Math.abs(datum) > TOLERANCE) {
    const localModel = { ...model, units: model.units.map(unit => ({ ...unit, lower: unit.lower - datum, upper: unit.upper - datum })) };
    const visibleIds = new Set(visibleUnits.map(unit => unit.id));
    const scene = buildBuildingScene(localModel, localModel.units.filter(unit => visibleIds.has(unit.id)), offsets, revealBasement);
    for (const mesh of scene.meshes) for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] += datum;
    scene.grade += datum;
    return scene;
  }
  const meshes = new Map<string, MeshBuilder>();
  const batch = (owner: string, material: Material, alpha = 1) => {
    const key = `${material}:${owner}`;
    if (!meshes.has(key)) meshes.set(key, new MeshBuilder(owner, material, COLORS[material], alpha));
    return meshes.get(key)!;
  };
  const edges = exteriorEdges(model.units);
  const byId = new Map(model.units.map(unit => [unit.id, unit]));
  const groundUnits = model.units.filter(unit => unit.kind !== "basement" && unit.lower >= -TOLERANCE && unit.lower < 0.3 && unit.upper > 1.8);
  const groundIds = new Set(groundUnits.map(unit => unit.id));
  const entryCandidates = edges.filter(edge => groundIds.has(edge.ownerId) && edge.length >= 1.6);
  // Shared circulation is the preferred address. A local negative-Y frontage is
  // an illustrative presentation choice, never a claim about geographic north.
  const entrance = entryCandidates.sort((a, b) => {
    const score = (edge: ExteriorEdge) => (byId.get(edge.ownerId)?.kind === "common" ? 12 : 0) - edge.outward[1] * 5 + Math.min(edge.length, 5) * 0.12;
    return score(b) - score(a);
  })[0] || null;
  const front = entrance?.outward || [0, -1];
  const tangent: Point2 = entrance ? [(entrance.b[0] - entrance.a[0]) / entrance.length, (entrance.b[1] - entrance.a[1]) / entrance.length] : [1, 0];
  const cameraDirection = [front[0] + tangent[0] * 0.72, front[1] + tangent[1] * 0.72];
  const cameraHeading = Math.atan2(-cameraDirection[0], -cameraDirection[1]);
  const lightDirection: Point3 = [-front[0] * 0.75 + tangent[0] * 0.55, -front[1] * 0.75 + tangent[1] * 0.55, -1.65];
  const bar = (edge: ExteriorEdge, start: number, end: number, inner: number, outer: number, lower: number, upper: number, material: Material) => batch(edge.ownerId, material).prism(edgeRectangle(edge, start, end, inner, outer), lower, upper);

  for (const unit of visibleUnits) {
    const offset = offsets.get(unit.id) || 0;
    if (unit.kind === "basement" || unit.upper <= 0) {
      if (revealBasement) {
        batch(unit.id, "basement").prism(unit.footprint, unit.lower + offset, unit.upper + offset);
        batch(unit.id, "slab").prism(unit.footprint, unit.lower + offset, unit.lower + offset + 0.14);
      }
      continue;
    }
    const lower = Math.max(0, unit.lower) + offset, upper = unit.upper + offset;
    const unitEdges = edges.filter(edge => edge.ownerId === unit.id);
    // Interior party walls are analytical boundaries, not façade surfaces.
    // Omitting them in the assembled building also avoids their coplanar
    // shadow seams; an individually isolated space keeps its closed shell.
    const exteriorShell = visibleUnits.length > 1 ? unitEdges : undefined;
    batch(unit.id, "plaster").prism(unit.footprint, lower, upper, exteriorShell);
    batch(unit.id, "slab").prism(unit.footprint, upper - 0.15, upper + 0.045, exteriorShell);
    // Align illustrative window rows to other spaces on the same named floor.
    const sameFloor = model.units.filter(other => other.kind !== "basement" && other.levelLabel === unit.levelLabel && Math.abs(other.lower - unit.lower) < 0.6);
    const rowBase = Math.max(unit.lower, ...sameFloor.map(other => other.lower)) + offset;
    const height = upper - rowBase;
    let roofEmitted = false;
    for (const edge of unitEdges) {
      bar(edge, 0, edge.length, -0.03, 0.085, upper - 0.17, upper + 0.035, "slab");
      const middle = along(edge, edge.length / 2, -0.025);
      const coveredAbove = model.units.some(other => other.id !== unit.id && other.upper > unit.upper + 0.15 && pointInFootprint(middle, other.footprint));
      if (!coveredAbove) {
        if (!roofEmitted) {
          batch(unit.id, "roof").prism(unit.footprint, upper + 0.09, upper + 0.11, exteriorShell);
          roofEmitted = true;
        }
        bar(edge, -0.04, edge.length + 0.04, -0.15, 0.04, upper + 0.035, upper + 0.34, "plaster");
        bar(edge, -0.065, edge.length + 0.065, -0.18, 0.07, upper + 0.34, upper + 0.39, "slab");
      }
      if (height < 1.6 || edge.length < 1.45) continue;
      const count = Math.max(1, Math.floor(edge.length / 2.15));
      const spacing = edge.length / count;
      const width = Math.min(unit.kind === "common" ? 1.0 : 1.38, spacing - 0.62);
      const sill = rowBase + Math.min(0.85, height * 0.28);
      const lintel = Math.min(upper - 0.49, sill + (unit.kind === "common" ? 1.65 : 1.48));
      for (let i = 0; i < count; i++) {
        const center = spacing * (i + 0.5);
        const isEntry = entrance?.ownerId === unit.id && entrance.a[0] === edge.a[0] && entrance.a[1] === edge.a[1] && entrance.b[0] === edge.b[0] && entrance.b[1] === edge.b[1];
        if (isEntry && Math.abs(center - edge.length / 2) < 1.0) continue;
        const start = center - width / 2, end = center + width / 2, frame = 0.065;
        // Glass sits behind projecting frame/reveal geometry. Materials are
        // accumulated per unit, not instantiated once per window.
        bar(edge, start - 0.07, end + 0.07, 0.004, 0.045, sill - 0.06, lintel + 0.06, "reveal");
        bar(edge, start, end, 0.047, 0.057, sill, lintel, "glass");
        bar(edge, start + frame, end - frame, 0.058, 0.062, lintel - 0.36, lintel - frame, "glassLight");
        bar(edge, start, start + frame, 0.02, 0.115, sill, lintel, "frame");
        bar(edge, end - frame, end, 0.02, 0.115, sill, lintel, "frame");
        bar(edge, start, end, 0.02, 0.115, lintel - frame, lintel, "frame");
        bar(edge, start, end, 0.02, 0.115, sill, sill + frame, "frame");
        if (width > 0.95) bar(edge, center - 0.022, center + 0.022, 0.06, 0.1, sill + frame, lintel - frame, "frame");
        bar(edge, start - 0.09, end + 0.09, -0.02, 0.22, sill - 0.11, sill - 0.025, "slab");
      }
    }
  }

  const above = model.units.filter(unit => unit.kind !== "basement" && unit.upper > 0);
  const points = (above.length ? above : model.units).flatMap(unit => unit.footprint);
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const margin = Math.max(2.6, Math.min(4.5, Math.max(maxX - minX, maxY - minY) * 0.3));
  const site = [minX - margin, minY - margin, maxX + margin, maxY + margin];
  const ground = batch("context:site", "site");
  const grade = -0.055;
  if (revealBasement) {
    const bottom = Math.min(-0.5, ...model.units.map(unit => unit.lower + (offsets.get(unit.id) || 0))) - 0.15;
    ground.prism(rectangle(site[0], site[1], site[2], site[3]), bottom - 0.28, bottom);
    const cutLeft = minX - 0.55, cutRight = maxX + 0.55, cutBack = maxY + 0.55;
    ground.prism(rectangle(site[0], site[1], cutLeft, site[3]), bottom, grade);
    ground.prism(rectangle(cutRight, site[1], site[2], site[3]), bottom, grade);
    ground.prism(rectangle(cutLeft, cutBack, cutRight, site[3]), bottom, grade);
  } else {
    ground.prism(rectangle(...site as [number, number, number, number]), grade - 0.26, grade);
    batch("context:paving", "paving").prism(rectangle(minX - 0.8, minY - 0.8, maxX + 0.8, maxY + 0.8), grade, -0.025);
    for (const unit of groundUnits) {
      const unitEdges = edges.filter(edge => edge.ownerId === unit.id);
      for (const edge of unitEdges) {
        batch("context:contact", "contact", 0.09).prism(edgeRectangle(edge, -0.015, edge.length + 0.015, 0, 0.18), -0.021, -0.018);
      }
    }
  }

  if (entrance && visibleUnits.some(unit => unit.id === entrance.ownerId)) {
    const base = (offsets.get(entrance.ownerId) || 0);
    const center = entrance.length / 2, doorWidth = Math.min(1.35, entrance.length - 0.4);
    const start = center - doorWidth / 2, end = center + doorWidth / 2;
    bar(entrance, start - 0.1, end + 0.1, 0.008, 0.12, base, base + 2.23, "frame");
    bar(entrance, start + 0.025, end - 0.025, 0.12, 0.13, base + 0.08, base + 2.14, "entrance");
    bar(entrance, start + 0.12, end - 0.12, 0.131, 0.142, base + 0.58, base + 1.99, "glass");
    bar(entrance, center - 0.03, center + 0.03, 0.143, 0.2, base + 0.07, base + 2.15, "frame");
    bar(entrance, center + 0.09, center + 0.13, 0.2, 0.24, base + 0.9, base + 1.22, "slab");
    bar(entrance, start - 0.45, end + 0.45, -0.06, 1.3, base + 2.3, base + 2.43, "metal");
    bar(entrance, start - 0.45, end + 0.45, 0.03, 1.35, base + 2.43, base + 2.48, "slab");
    if (!revealBasement && Math.abs(base) < 0.01) {
      batch("context:entrance-step", "slab").prism(edgeRectangle(entrance, start - 0.6, end + 0.6, 0.05, 1.65), -0.02, 0.09);
      batch("context:walkway", "paving").prism(edgeRectangle(entrance, center - 0.95, center + 0.95, 1.45, margin - 0.18), grade, -0.015);
      bar(entrance, end + 0.29, end + 0.36, 1.16, 1.23, 0.09, 2.31, "metal");
    }
  }

  // A restrained pair of planted pockets supplies an illustrative scale cue.
  // Their positions follow the building's bounds and remain outside its spaces.
  if (!revealBasement) {
    const trees: Point2[] = [[minX - 1.7, maxY - 1.3], [maxX + 1.6, minY + 0.8]];
    for (const [index, center] of trees.entries()) {
      if (above.some(unit => pointInFootprint(center, unit.footprint))) continue;
      const owner = `context:planting-${index}`;
      batch(owner, "paving").prism(rectangle(center[0] - 0.75, center[1] - 0.75, center[0] + 0.75, center[1] + 0.75), grade, 0.06);
      batch(owner, "soil").prism(rectangle(center[0] - 0.61, center[1] - 0.61, center[0] + 0.61, center[1] + 0.61), 0.06, 0.08);
      const trunk: Point2[] = Array.from({ length: 8 }, (_, i) => [center[0] + Math.cos(i * Math.PI / 4) * 0.075, center[1] + Math.sin(i * Math.PI / 4) * 0.075]);
      batch(owner, "trunk").prism(trunk, 0.08, 1.5);
      const foliage = batch(owner, index === 0 ? "foliage" : "foliageLight");
      const crown = (row: number, column: number): Point3 => {
        const latitude = -Math.PI / 2 + row * Math.PI / 5, longitude = column * Math.PI / 4;
        return [center[0] + Math.cos(latitude) * Math.cos(longitude) * 0.79, center[1] + Math.cos(latitude) * Math.sin(longitude) * 0.79, 2.0 + Math.sin(latitude) * 1.04];
      };
      for (let row = 0; row < 5; row++) for (let column = 0; column < 8; column++) {
        const a = crown(row, column), b = crown(row, column + 1), c = crown(row + 1, column + 1), d = crown(row + 1, column);
        if (row === 0) foliage.face([a, c, d]);
        else if (row === 4) foliage.face([a, b, c]);
        else foliage.face([a, b, c, d]);
      }
    }
  }
  return { meshes: [...meshes.values()].map(builder => builder.mesh).filter(mesh => mesh.indices.length > 0), edges, entrance, cameraHeading, lightDirection, grade };
}
