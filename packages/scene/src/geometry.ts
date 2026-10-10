import { BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2 } from 'three';
import type { Bounds2D, FootprintInput, MultiPolygon, Ring } from './types';

type Polygons = { polygons: MultiPolygon };

/** Minimum thickness for a footprint with no known height, so it stays visible and pickable. */
export const FLAT_THICKNESS_M = 0.05;

export function hasKnownHeight(input: FootprintInput): boolean {
  return input.heightM !== null && Number.isFinite(input.heightM) && input.heightM > 0 && input.heightState !== 'unknown' && input.heightState !== 'unresolved';
}

/** How a building is drawn at rest: a candidate stays a ghost; unknown or estimated heights are hatched. */
export type BuildingLook = 'candidate' | 'hatch' | 'solid';

export function buildingLook(input: FootprintInput): BuildingLook {
  if (input.candidate) return 'candidate';
  return !hasKnownHeight(input) || input.heightState === 'estimated' ? 'hatch' : 'solid';
}

/** Drops the closing vertex and orients rings for three.js shapes. */
function ringPoints(ring: Ring): Vector2[] {
  const points = ring.map(([x, y]) => new Vector2(x, y));
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && first.equals(last)) points.pop();
  return points;
}

export function shapesFor(polygons: MultiPolygon): Shape[] {
  return polygons.flatMap((polygon) => {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 4) return [];
    const shape = new Shape(ringPoints(outer));
    for (const hole of holes) if (hole.length >= 4) shape.holes.push(new Path(ringPoints(hole)));
    return [shape];
  });
}

/**
 * Geometry in scene axes: x = east, y = up, z = −north (three.js is right-handed, y-up).
 * Extruded to the known height; flat (FLAT_THICKNESS_M) when the height is unknown.
 */
export function footprintGeometry(input: FootprintInput): BufferGeometry {
  return prismGeometry(input.polygons, input.baseM ?? 0, hasKnownHeight(input) ? input.heightM! : FLAT_THICKNESS_M);
}

/** A prism from `base` up by `depth` metres, in scene axes. */
export function prismGeometry(polygons: MultiPolygon, base: number, depth: number): BufferGeometry {
  const shapes = shapesFor(polygons);
  const geometry = shapes.length
    ? new ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 })
    : new ShapeGeometry([]);
  // Shape space is (east, north); extrusion runs along +z. Rotate so north → −z and height → +y.
  geometry.rotateX(-Math.PI / 2);
  if (base) geometry.translate(0, base, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function boundsOf(inputs: Polygons[]): Bounds2D | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const input of inputs) for (const polygon of input.polygons) for (const [x, y] of polygon[0] ?? []) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
