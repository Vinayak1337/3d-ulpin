import { describe, expect, it } from 'vitest';
import context from '../../local/data/nyc-bronx-context.json';
import type { AreaContext } from '../../api/queries';
import { toFootprints } from './footprints';

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
