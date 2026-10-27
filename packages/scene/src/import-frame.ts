import { Box3 } from 'three';

/**
 * A footprint stays readable while the framed span is at most this many typical footprints wide: a 20 m building
 * then covers about a dozen pixels of a desktop map, where at a city-wide fit it shrinks below two.
 */
export const READABLE_SPAN = 80;

/**
 * The part of an import the area view frames: the whole set when its typical footprint stays readable at that
 * span, otherwise the features inside the densest readable-sized window. Reads drawn plan bounds only.
 */
export function readablePlanBox(boxes: readonly Box3[]): Box3 {
  const whole = new Box3();
  for (const box of boxes) whole.union(box);
  if (!boxes.length) return whole;
  const span = READABLE_SPAN * typicalSize(boxes);
  if (Math.max(whole.max.x - whole.min.x, whole.max.z - whole.min.z) <= span) return whole;
  return densestWindow(boxes, span);
}

/** The median plan size (the longer side) of the footprints. */
function typicalSize(boxes: readonly Box3[]): number {
  const sizes = boxes.map((box) => Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).sort((a, b) => a - b);
  return Math.max(sizes[Math.floor(sizes.length / 2)]!, 1);
}

const BLOCK = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;

/**
 * Counts footprint centres on a grid of half-window cells and keeps the two-by-two block of cells (one window)
 * holding the most; the first such block wins a tie, so the same input frames the same place.
 */
function densestWindow(boxes: readonly Box3[], span: number): Box3 {
  const cell = span / 2;
  const cells = boxes.map((box) => [
    Math.floor((box.min.x + box.max.x) / 2 / cell), Math.floor((box.min.z + box.max.z) / 2 / cell),
  ] as const);
  const counts = new Map<string, number>();
  for (const [i, j] of cells) counts.set(`${i},${j}`, (counts.get(`${i},${j}`) ?? 0) + 1);
  let best = { i: 0, j: 0, count: -1 };
  for (const [i, j] of cells) {
    for (const [di, dj] of BLOCK) {
      const start = { i: i - di, j: j - dj };
      let count = 0;
      for (const [bi, bj] of BLOCK) count += counts.get(`${start.i + bi},${start.j + bj}`) ?? 0;
      if (count > best.count) best = { ...start, count };
    }
  }
  const window = new Box3();
  boxes.forEach((box, index) => {
    const [i, j] = cells[index]!;
    if (i - best.i >= 0 && i - best.i <= 1 && j - best.j >= 0 && j - best.j <= 1) window.union(box);
  });
  return window;
}
