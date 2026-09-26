import { describe, expect, it } from 'vitest';
import { presetFor } from './camera';

// A 20 m square as a geometric test shape, not a record.
const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

describe('camera presets', () => {
  it('computes each preset from the bounds of what is shown', () => {
    const pose = presetFor('building', bounds, 5, 15, '3d', 32);
    expect(pose.target).toEqual([10, 5, -10]);
    expect(pose.position[1]).toBeGreaterThan(5);
  });
  it('2D looks straight down on the same target', () => {
    const pose = presetFor('level', bounds, 3, 0, '2d', 32);
    expect(pose.position[0]).toBe(10);
    expect(pose.position[2]).toBeCloseTo(-10, 2);
    expect(pose.position[1]).toBeGreaterThan(3);
  });
  it('views underground from low on the street side', () => {
    const pose = presetFor('underground', bounds, 0, 10, '3d', 32);
    const [x, y, z] = pose.position;
    expect(y).toBeLessThan(Math.hypot(x - 10, z + 10));
  });
});
