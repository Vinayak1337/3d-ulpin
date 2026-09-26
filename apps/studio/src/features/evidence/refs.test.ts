import { describe, expect, it } from 'vitest';
import { parseLocator, resolvePointer } from './refs';

describe('evidence locators', () => {
  it('reads row locators and JSON pointers', () => {
    expect(parseLocator({ locator: 'file.csv row 12' })).toMatchObject({ kind: 'row', row: 12 });
    expect(parseLocator({ jsonPointer: '/features/3/properties/height_roof' })).toMatchObject({ kind: 'pointer', text: 'feature 4 · height_roof' });
    expect(parseLocator({ locator: 'file.csv floor_id 7' })).toMatchObject({ kind: 'text' });
  });
  it('resolves RFC 6901 pointers', () => {
    const doc = { features: [{ properties: { 'a/b': 1 } }] };
    expect(resolvePointer(doc, '/features/0/properties/a~1b')).toBe(1);
    expect(resolvePointer(doc, '/features/9')).toBeUndefined();
  });
});
