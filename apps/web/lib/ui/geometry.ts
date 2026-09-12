import type { Point2, UnitSpec } from "@ulpin/contracts";

export function boundsOf(rings: Point2[][]) {
  const points = rings.flat();
  if (!points.length)
    return { minX: -2, minY: -2, maxX: 30, maxY: 16, width: 32, height: 18 };
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}
export const number = (n: number | null | undefined, digits = 2) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(n);
export function unitColor(unit: UnitSpec) {
  if (unit.kind === "basement") return "#989ca9";
  if (unit.kind === "common") return "#dfbd83";
  const palette = [
    "#86b5ac",
    "#a3babd",
    "#bbccae",
    "#c0cba8",
    "#94afb5",
    "#c5b7aa",
  ];
  const hash = [...unit.alias].reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[hash % palette.length];
}
export function transformPoint(
  point: Point2,
  image: [Point2, Point2],
  world: [Point2, Point2],
): Point2 {
  const ix = image[1][0] - image[0][0];
  const iy = -(image[1][1] - image[0][1]);
  const wx = world[1][0] - world[0][0];
  const wy = world[1][1] - world[0][1];
  const denominator = ix * ix + iy * iy;
  if (denominator < 0.001)
    throw new Error("Choose two different points on the plan.");
  if (wx * wx + wy * wy < 0.000001)
    throw new Error("Control points must have different local coordinates.");
  const a = (wx * ix + wy * iy) / denominator;
  const b = (wy * ix - wx * iy) / denominator;
  const dx = point[0] - image[0][0];
  const dy = -(point[1] - image[0][1]);
  return [world[0][0] + a * dx - b * dy, world[0][1] + b * dx + a * dy];
}
