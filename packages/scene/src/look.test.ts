import { describe, expect, it } from 'vitest';
import { facadeTint, laneDashes, offsetRing } from './look';

describe('enhanced view dressing', () => {
  it('offsets a footprint outwards whichever way its ring winds', () => {
    const ccw: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    for (const ring of [ccw, [...ccw].reverse()]) {
      const out = offsetRing(ring, 2);
      const xs = out.map(([x]) => x), ys = out.map(([, y]) => y);
      expect(Math.min(...xs)).toBeCloseTo(-2); expect(Math.max(...xs)).toBeCloseTo(12);
      expect(Math.min(...ys)).toBeCloseTo(-2); expect(Math.max(...ys)).toBeCloseTo(12);
    }
  });

  it('draws a centre line only on long, straight, rectangular roads', () => {
    const straight = [[[[0, 0], [100, 0], [100, 8], [0, 8], [0, 0]]]] as [number, number][][][];
    const dashes = laneDashes(straight, 0.05);
    expect(dashes.length).toBeGreaterThan(0);
    for (let i = 2; i < dashes.length; i += 3) expect(-dashes[i]!).toBeCloseTo(4); // on the centre line (north = −z)
    const lShape = [[[[0, 0], [100, 0], [100, 8], [8, 8], [8, 100], [0, 100], [0, 0]]]] as [number, number][][][];
    expect(laneDashes(lShape, 0.05)).toEqual([]);
    const square = [[[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]] as [number, number][][][];
    expect(laneDashes(square, 0.05)).toEqual([]);
  });

  it('gives a building the same tint every time', () => {
    expect(facadeTint('b-1', 12).getHex()).toBe(facadeTint('b-1', 12).getHex());
  });
});
