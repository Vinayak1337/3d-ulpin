import { describe, expect, it } from 'vitest';
import { presetFor } from './camera';

// A 20 m square as a geometric test shape, not a record.
const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

describe('camera presets', () => {
  it('computes each preset from the bounds of what is shown', () => {
    const pose = presetFor('building', bounds, 5, 15, 32);
    expect(pose.target).toEqual([10, 5, -10]);
    expect(pose.position[1]).toBeGreaterThan(5);
  });
  it('frames a level closer than its building', () => {
    const level = presetFor('level', bounds, 3, 3, 32);
    const building = presetFor('building', bounds, 3, 30, 32);
    const d = (p: typeof level) => Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
    expect(d(level)).toBeLessThan(d(building));
  });
  it('views underground from the street side', () => {
    const pose = presetFor('underground', bounds, 0, 10, 32);
    const [x, y, z] = pose.position;
    expect(y).toBeLessThan(Math.hypot(x - 10, z + 10));
  });
});
