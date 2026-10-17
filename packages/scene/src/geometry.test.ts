import { describe, expect, it } from 'vitest';
import { FLAT_THICKNESS_M, boundsOf, buildingLook, footprintGeometry, hasKnownHeight } from './geometry';
import type { FootprintInput } from './types';

// A 10 m square: a geometric test shape, not a record.
const square: FootprintInput['polygons'] = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]];

describe('footprint geometry', () => {
  it('extrudes to the known height with north pointing to −z', () => {
    const geometry = footprintGeometry({ id: 'a', polygons: square, heightM: 12.5, heightState: 'source_supported' });
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(12.5);
    expect(box.min.z).toBeCloseTo(-10);
    expect(box.max.z).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(10);
  });
  it('never extrudes an unknown height to a guess', () => {
    const input: FootprintInput = { id: 'b', polygons: square, heightM: null, heightState: 'unknown' };
    expect(hasKnownHeight(input)).toBe(false);
    expect(footprintGeometry(input).boundingBox!.max.y).toBeCloseTo(FLAT_THICKNESS_M);
    expect(hasKnownHeight({ ...input, heightM: 9, heightState: 'unresolved' })).toBe(false);
  });
  it('draws a candidate as a ghost and hatches unknown or estimated heights', () => {
    const reviewed: FootprintInput = { id: 'a', polygons: square, heightM: 9, heightState: 'reviewed' };
    expect(buildingLook(reviewed)).toBe('solid');
    expect(buildingLook({ ...reviewed, candidate: true })).toBe('candidate');
    expect(buildingLook({ ...reviewed, heightState: 'estimated' })).toBe('hatch');
    expect(buildingLook({ ...reviewed, heightM: null, heightState: 'unknown' })).toBe('hatch');
    expect(buildingLook({ ...reviewed, candidate: true, heightM: null, heightState: 'unknown' })).toBe('candidate');
  });
  it('computes plan bounds from outer rings', () => {
    expect(boundsOf([{ polygons: square }])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(boundsOf([])).toBeNull();
  });
});
