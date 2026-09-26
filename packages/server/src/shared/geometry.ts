import type { Point2 } from "@ulpin/contracts";

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
