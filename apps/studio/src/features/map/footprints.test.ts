import { describe, expect, it } from 'vitest';
import context from '../../local/data/nyc-bronx-context.json';
import type { AreaContext } from '../../api/queries';
import { drawnCountNote, polygonsOf, toBase, toFootprints, undrawnNote } from './footprints';

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

describe('drawnCountNote', () => {
  const at = (id: string, revision: number) => ({ id, revision }) as never;
  it('counts the recorded features the map draws and those it does not', () => {
    expect(drawnCountNote([at('a', 1), at('b', 1), at('c', 2)], new Set(['a', 'c'])))
      .toBe('2 of 3 recorded features are drawn.');
  });
  it('says when all are drawn, grouping thousands, and leaves out proposals not yet recorded', () => {
    const ids = Array.from({ length: 2148 }, (_, index) => `f${index}`);
    expect(drawnCountNote([...ids.map((id) => at(id, 1)), at('p', 0)], new Set(ids)))
      .toBe('All 2,148 recorded features are drawn.');
  });
  it('is silent when nothing is recorded', () => {
    expect(drawnCountNote([at('p', 0)], new Set())).toBeNull();
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

describe('scene inputs retained by feature object', () => {
  const features = (context as unknown as AreaContext).features;

  it('returns the same footprint and base input for the same feature', () => {
    const first = toFootprints(features);
    const second = toFootprints([...features]);
    expect(second[0]).toBe(first[0]);
    const base = toBase(features);
    expect(toBase([...features])[0]).toBe(base[0]);
  });

  it('keeps the base array identity when a part only appends building features', () => {
    const ground = features.filter((feature) => feature.kind !== 'building');
    const buildings = features.filter((feature) => feature.kind === 'building');
    const base = toBase(ground);
    expect(toBase([...ground, ...buildings], base)).toBe(base);
  });

  it('does not cache by id: a replacement feature gets a replacement input', () => {
    const source = features.find((feature) => feature.kind === 'building')!;
    const first = toFootprints([source])[0];
    const replacement = { ...source, height: { ...source.height, value: null, state: 'unknown' as const } };
    const second = toFootprints([replacement])[0];
    expect(second).not.toBe(first);
    expect(second!.heightM).toBeNull();
  });
});

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
