import { describe, expect, it } from 'vitest';
import type { NormalizedArea } from '@ulpin/contracts/canonical-scene';
import { canonicalFootprints, undrawnBuildings } from './canonicalScene';

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
  it('lists a building without a footprint instead of inventing one', () => {
    expect(undrawn).toEqual([{ id: 'b3', name: 'b3', state: 'candidate' }]);
  });
});

describe('undrawnBuildings', () => {
  const unnamed = { ...summary('b4', 'unknown'), name: value('unknown', null) };
  const allAbsent = { ...area, buildings: [summary('b3', 'unknown'), unnamed] } as unknown as NormalizedArea;
  it('names each building by its recorded name, or by its id when the record has none', () => {
    expect(undrawnBuildings(allAbsent, []).map((b) => b.name)).toEqual(['b3', 'b4']);
  });
  it('lists nothing when every building is drawn', () => {
    const drawn = canonicalFootprints(area).footprints;
    const onlyDrawn = { ...area, buildings: area.buildings.slice(0, 2) } as NormalizedArea;
    expect(undrawnBuildings(onlyDrawn, drawn)).toEqual([]);
  });
});
