import { describe, expect, it } from 'vitest';
import { buildingCount, indexView } from './indexView';

describe('indexView', () => {
  it('opens on Buildings when the requests read is not served, and on Requests when it is', () => {
    expect(indexView(null, null)).toBe('buildings');
    expect(indexView(null, [])).toBe('requests');
  });

  it('opens on Requests while the requests read has not answered', () => {
    expect(indexView(null, undefined)).toBe('requests');
  });

  it('keeps the tab the address names, served or not; an unknown name is no name', () => {
    expect(indexView('requests', null)).toBe('requests');
    expect(indexView('buildings', [])).toBe('buildings');
    expect(indexView('other', null)).toBe('buildings');
  });
});

describe('buildingCount', () => {
  it('says one building in the singular and every other count in the plural', () => {
    expect(buildingCount(1)).toBe('1 building');
    expect(buildingCount(0)).toBe('0 buildings');
    expect(buildingCount(62)).toBe('62 buildings');
  });
});
