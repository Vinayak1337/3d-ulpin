import { describe, expect, it } from 'vitest';
import type { NormalizedArea } from '@ulpin/contracts';
import { canonicalFootprints } from './canonicalScene';

const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const value = (state: string, v: unknown) => ({
  value: v,
  state,
  citations: [],
  method: 'source_literal',
  revisionId: 'r1',
});

function summary(buildingId: string, footprintState: string) {
  const footprint = footprintState === 'unknown' ? null : [[ring]];
  return {
    buildingId,
    revisionId: 'r1',
    recordState: 'candidate',
    name: value('source_supported', buildingId),
    footprint: value(footprintState, footprint),
    heightM: value('source_supported', 8),
    heightState: 'source_supported',
  };
}

const area = {
  schemaVersion: 'normalized-building/1',
  revisionId: 'a1',
  frame: { areaId: 'area-1' },
  buildings: [summary('b1', 'candidate'), summary('b2', 'reviewed'), summary('b3', 'unknown')],
  baseFeatures: [],
  overlays: [],
  tilesets: [],
  gaps: [],
} as unknown as NormalizedArea;

describe('canonicalFootprints', () => {
  const { footprints, undrawn } = canonicalFootprints(area);
  it('marks only the candidate footprint as a candidate', () => {
    expect(footprints.map((f) => [f.id, f.candidate])).toEqual([['b1', true], ['b2', false]]);
  });
  it('counts a building without a footprint instead of inventing one', () => {
    expect(undrawn).toBe(1);
  });
});
