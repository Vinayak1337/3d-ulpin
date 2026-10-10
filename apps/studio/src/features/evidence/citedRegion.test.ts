import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import { PacketRegionRequestSchema } from '../../../../../packages/contracts/src/packet-region';
import r5d from '../../../../../docs/evidence/runtime/r5d/result.json';
import step0 from '../../../../../docs/evidence/gf5/ev1/step0.json';
import { citedPageOf, pageFailure } from './citedPage';
import { buildRegionRequest, citedPageState, citedWindow, regionImageFrame } from './citedRegion';
import type { RegionProvenance } from './citedRegion';
import type { PagesResponse } from './pageGeometry';
import type { Place } from './CitedPageViewer';

const listing = step0.viewer.listing as PagesResponse;
const pin = { revision: listing.sourceRevision, sha256: listing.sourceSha256 };
const page = citedPageOf(listing, 1, pin);
const caption: Place = { kind: 'region', page: 1, text: '2ND FLOOR PLAN',
  region: { x: 850, y: 875, width: 170, height: 35, unit: 'pt' } };
const label: Place = { kind: 'region', page: 1, text: 'UNIT-3B',
  region: { x: 596, y: 390, width: 48, height: 19, unit: 'pt' } };
const pageOnly: Place = { kind: 'page', page: 1, text: 'page:1' };

// Literal locators above are the real R5d inputs, not production sample content.
describe('private region body from the listing', () => {
  it.each([[caption, 0], [label, 1]] as const)('reproduces the R5d crop %s number for number', (place, index) => {
    const expected = { ...r5d.step3WhatWouldGiveItOne.requests[index]!.body, revision: listing.revision };
    const body = buildRegionRequest(page, place);
    expect(body).toEqual(expected);
    expect(PacketRegionRequestSchema.parse(body)).toMatchObject({ revision: listing.sourceRevision });
  });

  it('widens the caption by its own larger side on each edge', () => {
    const window = citedWindow(page, caption)!;
    expect(window).toMatchObject({ region: { x: 680, y: 705, width: 510, height: 375, unit: 'pt' } });
    expect(PacketRegionRequestSchema.safeParse(buildRegionRequest(page, window)).success).toBe(true);
  });

  it('clips a region at the page edge without moving its cited outline', () => {
    const edge: Place = { ...caption, region: { x: 0, y: 0, width: 170, height: 35, unit: 'pt' } };
    expect(citedWindow(page, edge)).toMatchObject({ region: { x: 0, y: 0, width: 340, height: 205 } });
    expect(edge.region).toEqual({ x: 0, y: 0, width: 170, height: 35, unit: 'pt' });
  });

  it('bounds the window by the route ceiling', () => {
    const large: Place = { ...caption, region: { x: 800, y: 600, width: 800, height: 700, unit: 'pt' } };
    const window = citedWindow(page, large)!;
    expect(window).toMatchObject({ region: { width: 2000, height: 1695 } });
    expect(PacketRegionRequestSchema.safeParse(buildRegionRequest(page, window)).success).toBe(true);
  });

  it('makes no request for a page-only citation or unlocated pixel region', () => {
    expect(buildRegionRequest(page, pageOnly)).toBeNull();
    expect(citedWindow(page, pageOnly)).toBeNull();
    expect(citedWindow(page, { ...caption, region: { ...caption.region, unit: 'pixel' } })).toBeNull();
  });

  it('uses normalized regions in the displayed page frame', () => {
    const normalized = { ...caption, region: { x: 850 / 2586, y: 875 / 1695,
      width: 170 / 2586, height: 35 / 1695, unit: 'normalized' as const } };
    const actual = citedWindow(page, normalized)!;
    if (actual.kind !== 'region') throw new Error('Expected a region.');
    expect(actual.region.x).toBeCloseTo(680);
    expect(actual.region.y).toBeCloseTo(705);
    expect(actual.region.width).toBeCloseTo(510);
    expect(actual.region.height).toBeCloseTo(375);
  });
});

describe('cited viewer branch and server placement', () => {
  it('keeps a whole page URL, chooses a region or page-only state when absent, and names a refusal', () => {
    expect(citedPageState({ ...page, url: '/raster' }, caption)).toBe('whole');
    expect(citedPageState(page, caption)).toBe('region');
    expect(citedPageState(page, pageOnly)).toBe('page-only');
    expect(citedPageState(page, caption, true)).toBe('refused');
    const error = new ApiError(429, '/region', { error: { code: 'PACKET_REGION_BUSY', message: 'Busy' } });
    expect(pageFailure(error)).toMatchObject({ code: 'PACKET_REGION_BUSY', message: 'Busy' });
  });

  it('places the real caption PNG using only its server transform and output dimensions', () => {
    const provenance = step0.live.captionAnswer.provenance as RegionProvenance;
    expect(regionImageFrame(provenance)).toEqual({ viewBox: '850 875 170 35',
      matrix: 'matrix(0.3333333333333333 0 0 0.3333333333333333 850 875)', width: 510, height: 105 });
  });
});
