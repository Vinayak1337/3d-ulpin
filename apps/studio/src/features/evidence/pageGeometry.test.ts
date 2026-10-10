import { describe, expect, it } from 'vitest';
import { placeWords, regionOutline, type PageFrame } from './pageGeometry';

const frame: PageFrame = { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 2586, height: 1694 };
const points = { x: 206.88, y: 254.25, width: 1034.4, height: 305.1, unit: 'pt' } as const;

describe('region outline', () => {
  it('draws points in the returned page frame, unchanged', () => {
    const outline = regionOutline(points, frame);
    expect(outline).toMatchObject({ drawn: true, box: { x: 206.88, y: 254.25, width: 1034.4, height: 305.1 } });
    expect(outline.note).toContain('the citation names the unit, not the frame');
  });

  it('scales normalized fractions to the frame and draws nothing for pixels', () => {
    const outline = regionOutline({ x: 0.5, y: 0.25, width: 0.25, height: 0.5, unit: 'normalized' }, frame);
    expect(outline).toMatchObject({ drawn: true, box: { x: 1293, y: 423.5, width: 646.5, height: 847 } });
    const pixels = regionOutline({ ...points, unit: 'pixel' }, frame);
    expect(pixels.drawn).toBe(false);
  });

  it('does not draw a region that falls outside the frame', () => {
    expect(regionOutline({ ...points, x: 2500 }, frame).drawn).toBe(false);
    expect(regionOutline({ x: 0.9, y: 0, width: 0.2, height: 0.5, unit: 'normalized' }, frame).drawn).toBe(false);
  });
});

describe('place in words', () => {
  it('writes the page and the record’s own numbers', () => {
    expect(placeWords({ kind: 'region', page: 1, region: points, text: 'p.1' }))
      .toBe('Page 1 · region at x 206.88, y 254.25 · 1034.4 wide × 305.1 high · unit pt');
    expect(placeWords({ kind: 'page', page: 3, text: 'p.3' })).toBe('Page 3');
    expect(placeWords({ kind: 'text', text: 'row 4' })).toBeNull();
  });
});
