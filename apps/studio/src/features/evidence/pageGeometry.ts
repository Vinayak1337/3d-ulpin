import type { GetResponse } from '@ulpin/api-client';
import type { Locator, PageRegion } from './refs';

export type PagesResponse = GetResponse<'/api/v1/sources/{sourceId}/pages'>;
export type PageFrame = PagesResponse['pages'][number]['frame'];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a cited region is drawn, in the page frame's own points, or the reason it is not drawn. */
export type RegionOutline = { drawn: true; box: Box; note: string } | { drawn: false; note: string };

const PIXEL_NOTE = 'The citation gives this region in pixels without naming the image they belong to, ' +
  'so it is not drawn.';

function fitsInside(box: Box, width: number, height: number): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
}

function frameWords(frame: PageFrame): string {
  return `${frame.width} × ${frame.height} pt`;
}

function normalizedOutline(region: Box, frame: PageFrame): RegionOutline {
  if (!fitsInside(region, 1, 1)) {
    return { drawn: false, note: 'The normalized region lies outside the page, so it is not drawn.' };
  }
  const box = {
    x: region.x * frame.width,
    y: region.y * frame.height,
    width: region.width * frame.width,
    height: region.height * frame.height,
  };
  const note = `Drawn from the region’s fractions of the displayed page (${frameWords(frame)}).`;
  return { drawn: true, box, note };
}

function pointsOutline(region: Box, frame: PageFrame): RegionOutline {
  if (!fitsInside(region, frame.width, frame.height)) {
    const note = `The region does not fit inside the page frame the server returned (${frameWords(frame)}), `;
    return { drawn: false, note: `${note}so it is not drawn.` };
  }
  const note = `Drawn as points in the page frame the server returned for this page (${frameWords(frame)}, ` +
    'from the top-left corner); the citation names the unit, not the frame.';
  return { drawn: true, box: region, note };
}

/**
 * Places a region on the page only when its unit says how. Normalized fractions scale to the page frame the
 * server returned; points are read in that frame; pixels name no image, so they are never drawn.
 */
export function regionOutline(region: PageRegion, frame: PageFrame): RegionOutline {
  if (region.unit === 'pixel') return { drawn: false, note: PIXEL_NOTE };
  if (region.unit === 'normalized') return normalizedOutline(region, frame);
  return pointsOutline(region, frame);
}

/** The page and region of a locator in words, with the record's own numbers. Null for locators that name no page. */
export function placeWords(locator: Locator): string | null {
  if (locator.kind === 'page') return `Page ${locator.page}`;
  if (locator.kind !== 'region') return null;
  const { x, y, width, height, unit } = locator.region;
  return `Page ${locator.page} · region at x ${x}, y ${y} · ${width} wide × ${height} high · unit ${unit}`;
}
