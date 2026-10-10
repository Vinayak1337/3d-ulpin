import { describe, expect, it } from 'vitest';
import type { BuildingDetailInput, FootprintInput } from '@ulpin/scene';
import { geometryGaps, hasGeometry } from './sceneGeometry';

const SQUARE = [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]] as FootprintInput['polygons'];
const footprint = (id: string): FootprintInput => ({ id, polygons: SQUARE, heightM: null, heightState: 'unknown' });
const level = (spaces: BuildingDetailInput['levels'][number]['spaces']) => (
  { id: 'l1', order: 2, lowerM: null, upperM: null, spaces }
);
const detail = (spaces: BuildingDetailInput['levels'][number]['spaces']): BuildingDetailInput => (
  { buildingId: 'b', levels: [level(spaces)] }
);
const SPACE = { id: 's1', polygons: SQUARE, lowerM: null, upperM: null, fill: { hatch: false } };

describe('hasGeometry', () => {
  it('finds a building that has a footprint among the drawn ones', () => {
    expect(hasGeometry('b', { footprints: [footprint('b')], detail: null })).toBe(true);
  });

  it('finds nothing with no footprint and no detail, or with levels that outline no space', () => {
    expect(hasGeometry('b', { footprints: [], detail: null })).toBe(false);
    expect(hasGeometry('b', { footprints: [], detail: detail([]) })).toBe(false);
  });

  it('finds a building whose footprint is absent but whose detail outlines a space', () => {
    expect(hasGeometry('b', { footprints: [], detail: detail([SPACE]) })).toBe(true);
  });

  it('does not count the footprint of another building of the area', () => {
    expect(hasGeometry('b', { footprints: [footprint('neighbour')], detail: detail([]) })).toBe(false);
  });
});

describe('geometryGaps', () => {
  it('keeps the gap lines about geometry and placement as the record returned them, in its order', () => {
    const gaps = [
      'Geometry-free building: footprint, placement, elevation and spatial analysis are not assessed.',
      'Current sanction/as-built status and source-to-unit association remain unqualified.',
      'Footprint or geographic placement unavailable; no replacement geometry.',
      'Level schedule review does not create registry spaces, rights, parcel links or surveyed elevations.',
    ];
    expect(geometryGaps(gaps)).toEqual([gaps[0], gaps[2]]);
    expect(geometryGaps([])).toEqual([]);
  });
});
