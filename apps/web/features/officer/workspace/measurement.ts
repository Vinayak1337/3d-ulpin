import type { Point2 } from "@ulpin/contracts";
import { transformPoint } from "@/lib/ui/geometry";
import type {
  Calibration,
  CanvasSource,
  Measurement,
  MeasureTool,
} from "./types";

export const distance = (a: Point2, b: Point2) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
function validateBoundary(points: Point2[]) {
  if (points.length < 3)
    throw new Error("Select at least three boundary points.");
  const cross = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: Point2, b: Point2, p: Point2) =>
    Math.abs(cross(a, b, p)) < 1e-9 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (distance(a, b) < 1e-9)
      throw new Error("Use distinct boundary corners.");
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw new Error(
          "Boundary edges cross. Trace one simple boundary without crossing edges.",
        );
    }
  }
}
export function polygonArea(points: Point2[]) {
  validateBoundary(points);
  return (
    Math.abs(
      points.reduce((sum, p, index) => {
        const next = points[(index + 1) % points.length];
        return sum + p[0] * next[1] - next[0] * p[1];
      }, 0),
    ) / 2
  );
}
export function perimeter(points: Point2[]) {
  validateBoundary(points);
  return points.reduce(
    (sum, p, index) => sum + distance(p, points[(index + 1) % points.length]),
    0,
  );
}
export function angle(points: Point2[]) {
  if (points.length !== 3)
    throw new Error("Select three points; the second is the corner.");
  const [a, centre, b] = points;
  const product = distance(a, centre) * distance(b, centre);
  if (product < 1e-10) throw new Error("The corner needs two distinct arms.");
  const cosine =
    ((a[0] - centre[0]) * (b[0] - centre[0]) +
      (a[1] - centre[1]) * (b[1] - centre[1])) /
    product;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}
export function makeCalibration(
  source: CanvasSource,
  page: number,
  points: Point2[],
  input: {
    metres?: number;
    world?: [Point2, Point2];
    frame?: string;
    reason: string;
  },
): Calibration {
  if (
    points.length !== 2 ||
    points.some((p) => !p.every(Number.isFinite)) ||
    distance(points[0], points[1]) < 0.01
  )
    throw new Error("Choose two different points on the original plan.");
  if (!input.reason.trim())
    throw new Error("Identify the dimension or control evidence.");
  if (!input.world && (!Number.isFinite(input.metres) || input.metres! <= 0))
    throw new Error("Enter a positive known distance in metres.");
  if (
    input.world &&
    (!input.frame?.trim() ||
      input.world.flat().some((n) => !Number.isFinite(n)) ||
      distance(...input.world) < 0.000001)
  )
    throw new Error(
      "Enter distinct control coordinates and their named metre frame.",
    );
  const world: [Point2, Point2] = input.world || [
    [0, 0],
    [input.metres!, 0],
  ];
  return {
    sourceId: source.id,
    sourceHash: source.hash,
    page,
    imagePoints: points as [Point2, Point2],
    worldPoints: world,
    metresPerUnit: distance(...world) / distance(points[0], points[1]),
    method: input.world ? "control_points" : "known_distance",
    frame: input.world ? input.frame?.trim() : undefined,
    reason: input.reason.trim(),
    savedAt: new Date().toISOString(),
  };
}
export function currentCalibration(
  source: CanvasSource | undefined,
  page: number,
  calibration: Calibration | undefined,
) {
  return source &&
    calibration &&
    calibration.sourceId === source.id &&
    calibration.sourceHash === source.hash &&
    calibration.page === page
    ? calibration
    : undefined;
}
export function metricPoints(
  source: CanvasSource,
  points: Point2[],
  calibration?: Calibration,
): Point2[] {
  if (source.kind === "geometry" && source.frame)
    return points.map(([x, y]) => [x, -y]);
  if (!calibration)
    throw new Error("Calibrate this page before measuring in metres.");
  return points.map((point) =>
    transformPoint(point, calibration.imagePoints, calibration.worldPoints),
  );
}
export function makeMeasurement(
  source: CanvasSource,
  page: number,
  tool: MeasureTool,
  points: Point2[],
  calibration?: Calibration,
): Measurement {
  if (tool === "pan" || tool === "height")
    throw new Error("Choose a measurement tool.");
  if (!points.length || points.some((p) => !p.every(Number.isFinite)))
    throw new Error("Select points on the source.");
  const metric =
    tool === "point" && !calibration && source.kind !== "geometry"
      ? points
      : metricPoints(source, points, calibration);
  let value: number | null = null;
  let unit: Measurement["unit"] = "point";
  if (tool === "distance") {
    if (metric.length !== 2) throw new Error("Select two end points.");
    value = distance(metric[0], metric[1]);
    unit = "m";
  }
  if (tool === "area") {
    value = polygonArea(metric);
    unit = "m²";
  }
  if (tool === "perimeter") {
    value = perimeter(metric);
    unit = "m";
  }
  if (tool === "angle") {
    value = angle(metric);
    unit = "°";
  }
  if (value !== null && (!Number.isFinite(value) || value <= 0))
    throw new Error(
      "The selected points do not define a positive measurement.",
    );
  return {
    id: crypto.randomUUID(),
    sourceId: source.id,
    sourceHash: source.hash,
    page,
    tool,
    points,
    value,
    unit,
    label:
      tool === "point"
        ? `Point ${metric[0].map((n) => n.toFixed(2)).join(", ")}${!calibration && source.kind !== "geometry" ? " px" : " m"}`
        : `${tool[0].toUpperCase()}${tool.slice(1)}`,
    reference:
      source.frame ||
      calibration?.frame ||
      (calibration ? "Local scale only" : "Original pixels"),
    calibration,
    noted: false,
    createdAt: new Date().toISOString(),
  };
}
