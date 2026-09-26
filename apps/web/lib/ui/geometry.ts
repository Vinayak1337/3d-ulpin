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
export { transformPoint } from "@ulpin/server/shared/geometry";
