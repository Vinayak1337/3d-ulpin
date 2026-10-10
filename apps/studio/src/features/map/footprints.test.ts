import { describe, expect, it } from 'vitest';
import context from '../../local/data/nyc-bronx-context.json';
import type { AreaContext } from '../../api/queries';
import { polygonsOf, toBase, toFootprints, undrawnNote } from './footprints';

describe('toFootprints on the derived NYC OTI area', () => {
  const footprints = toFootprints((context as unknown as AreaContext).features);
  it('draws every source building once, keyed by its record ID', () => {
    expect(footprints).toHaveLength(62);
    expect(new Set(footprints.map((f) => f.id)).size).toBe(62);
  });
  it('carries source heights unchanged, never filling unknowns', () => {
    for (const f of footprints) {
      if (f.heightState === 'unknown') expect(f.heightM).toBeNull();
      else expect(f.heightM).toBeGreaterThan(0);
    }
  });
});

describe('undrawnNote', () => {
  const line = { kind: 'road', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } };
  const polygon = { kind: 'building', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  it('names the features that have no polygon, by kind', () => {
    const note = undrawnNote([line, line, polygon] as never);
    expect(note).toContain('2 road');
  });
  it('is silent when every feature is drawn', () => {
    expect(undrawnNote([polygon] as never)).toBeNull();
  });
});

// The shape of the live context response for a building installed without geometry; the values are test values.
const recorded: AreaContext['features'][number] = {
  id: 'building-1',
  kind: 'building',
  name: 'Test building',
  areaId: 'area-1',
  areaM2: null,
  height: { unit: 'm', state: 'unknown', value: null, meaning: 'unknown', reference: 'unknown' },
  evidence: [],
  geometry: null,
  revision: 1,
  placement: 'unknown',
  sourceKey: 'test-key',
  identifier: 'test-identifier',
  properties: {},
  worldStatus: 'planned',
  geometryRole: 'unknown',
  representation: 'physical_exterior',
  sourceGeometry: null,
  datasetNamespace: 'test-namespace',
  sourceRevisionId: 'revision-1',
  geographicGeometry: null,
};
const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

describe('features without recorded geometry', () => {
  const withGeometry = { ...recorded, id: 'building-2', geometry: square };
  it('gives scene inputs only to the buildings that have geometry', () => {
    expect(toFootprints([recorded, withGeometry]).map((f) => f.id)).toEqual(['building-2']);
  });
  it('yields nothing, and does not throw, when every feature has no geometry', () => {
    const road = { ...recorded, id: 'road-1', kind: 'road' as const };
    expect(toFootprints([recorded])).toEqual([]);
    expect(toBase([road])).toEqual([]);
    expect(polygonsOf(null)).toEqual([]);
  });
  it('leaves a building without geometry to its own list and counts a road without geometry', () => {
    const road = { ...recorded, id: 'road-1', kind: 'road' as const };
    expect(undrawnNote([recorded])).toBeNull();
    expect(undrawnNote([recorded, road])).toContain('1 road feature');
  });
});
