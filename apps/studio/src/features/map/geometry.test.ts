import { describe, expect, it } from 'vitest';
import { ringsIntersect } from './geometry';

// Geometric test shapes, not records.
const square = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

describe('ringsIntersect', () => {
  it('finds overlap, containment and crossing strips', () => {
    expect(ringsIntersect(square(0, 0, 10), square(5, 5, 10))).toBe(true);
    expect(ringsIntersect(square(0, 0, 10), square(2, 2, 2))).toBe(true);
    const strip: [number, number][] = [[-20, 4], [20, 4], [20, 6], [-20, 6], [-20, 4]];
    expect(ringsIntersect(square(0, 0, 10), strip)).toBe(true);
  });
  it('says no when apart', () => {
    expect(ringsIntersect(square(0, 0, 10), square(20, 20, 5))).toBe(false);
  });
});
