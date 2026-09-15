import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";
export type ViewBox = [number, number, number, number];
export function geometryPoints(geometry: AreaGeometry): number[][] {
  const walk = (value: unknown): number[][] =>
    !Array.isArray(value)
      ? []
      : typeof value[0] === "number"
        ? [value as number[]]
        : value.flatMap(walk);
  return geometry.type === "GeometryCollection"
    ? geometry.geometries.flatMap(geometryPoints)
    : walk(geometry.coordinates);
}
export function geometryPath(geometry: AreaGeometry): string {
  const ring = (points: number[][], close = true) =>
    points.map(([x, y], i) => `${i ? "L" : "M"}${x},${-y}`).join(" ") +
    (close ? " Z" : "");
  switch (geometry.type) {
    case "GeometryCollection":
      return geometry.geometries.map(geometryPath).join(" ");
    case "Polygon":
      return geometry.coordinates.map((p) => ring(p)).join(" ");
    case "MultiPolygon":
      return geometry.coordinates
        .flatMap((p) => p.map((r) => ring(r)))
        .join(" ");
    case "LineString":
      return ring(geometry.coordinates, false);
    case "MultiLineString":
      return geometry.coordinates.map((p) => ring(p, false)).join(" ");
    default:
      return "";
  }
}
export function featureBounds(
  features: PhysicalFeature[],
  extent?: [number, number, number, number] | null,
): ViewBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, -y);
    maxY = Math.max(maxY, -y);
  };
  // A shared block may combine several bounded imports. Never pass all its vertices as function arguments.
  for (const feature of features)
    for (const [x, y] of geometryPoints(feature.geometry)) include(x, y);
  if (extent) {
    include(extent[0], extent[1]);
    include(extent[2], extent[3]);
  }
  if (minX === Infinity) return [0, 0, 100, 100];
  const width = Math.max(10, maxX - minX),
    height = Math.max(10, maxY - minY),
    pad = Math.max(width, height) * 0.12;
  return [minX - pad, minY - pad, width + pad * 2, height + pad * 2];
}
export function featureColor(feature: PhysicalFeature) {
  return feature.worldStatus === "synthetic"
    ? "#b6a9c1"
    : {
        building: "#b9cbbb",
        parcel: "#cfbb88",
        road: "#9eafb1",
        public_land: "#a8cfa8",
        utility: "#6596af",
      }[feature.kind];
}

export type GeometryPrimitive =
  | { kind: "polygon" | "line"; path: string }
  | { kind: "point"; point: number[] };
/** Preserve topology when rendering mixed-dimensional findings; contact lines never become filled areas. */
export function geometryPrimitives(
  geometry: AreaGeometry,
): GeometryPrimitive[] {
  switch (geometry.type) {
    case "GeometryCollection":
      return geometry.geometries.flatMap(geometryPrimitives);
    case "Point":
      return [{ kind: "point", point: geometry.coordinates }];
    case "MultiPoint":
      return geometry.coordinates.map((point) => ({ kind: "point", point }));
    case "LineString":
    case "MultiLineString":
      return [{ kind: "line", path: geometryPath(geometry) }];
    case "Polygon":
    case "MultiPolygon":
      return [{ kind: "polygon", path: geometryPath(geometry) }];
  }
}
