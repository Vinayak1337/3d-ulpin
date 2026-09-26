import { describe, expect, it } from 'vitest';
import { normalizeProjectCode } from '@ulpin/contracts/usp';
import { buildingCode } from './codes';
import { lake } from './sources';

describe('buildingCode', () => {
  const ids = lake.context.features.filter((f) => f.kind === 'building').map((f) => f.id);
  it('gives every building a valid, stable P3 code', () => {
    for (const id of ids) {
      expect(normalizeProjectCode(buildingCode(id))).toBe(buildingCode(id));
      expect(buildingCode(id)).toBe(buildingCode(id));
    }
  });
  it('gives each building its own code', () => {
    expect(new Set(ids.map(buildingCode)).size).toBe(ids.length);
  });
});
