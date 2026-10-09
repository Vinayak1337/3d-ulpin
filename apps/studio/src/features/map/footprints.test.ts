import { describe, expect, it } from 'vitest';
import context from '../../local/data/nyc-bronx-context.json';
import type { AreaContext } from '../../api/queries';
import { toFootprints, undrawnNote } from './footprints';

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
