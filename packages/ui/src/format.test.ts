import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMeasure, formatRelative } from './format';
import { formatCount } from './components/FilterChip';

describe('format', () => {
  it('writes dates and IST times the design-system way', () => {
    expect(formatDate('2026-09-24T08:40:00Z')).toBe('24 Sep 2026');
    expect(formatDateTime('2026-09-24T08:40:00Z')).toBe('24 Sep 2026, 14:10');
  });
  it('never turns unknown into zero', () => {
    expect(formatMeasure(null, 'm²')).toBe('Unknown');
    expect(formatMeasure(0, 'm')).toBe('0.00 m');
    expect(formatMeasure(1234.567, 'm²', 1)).toBe('1,234.6 m²');
  });
  it('groups counts in the Indian system', () => {
    expect(formatCount(123456)).toBe('1,23,456');
  });
  it('uses relative time only within a week', () => {
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(formatRelative('2026-09-24T09:58:00Z', now)).toBe('2 min ago');
    expect(formatRelative('2026-09-10T09:58:00Z', now)).toBe('10 Sep 2026');
  });
});
