import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { utmForward } from '../overlays';
import type { IntakeItem } from '../surface/parts';
import { PREVIEW_LIMITS, ReadPreviews, type PreviewFeature, type PreviewFile, type PreviewPage } from './readPreview';
import { PreviewKey } from './PreviewKey';
import { previewKeyLines, previewOutlines } from './useReadPreview';

// The first outlines of the real NYC building footprints (test_only), as the route sends them: geometry only.
const nyc = (JSON.parse(readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson', 'utf8'))
  .features as { geometry: PreviewFeature['geometry'] }[]).slice(0, 3).map(({ geometry }) => geometry);
const outline = (featureIndex: number, geometry = nyc[featureIndex % nyc.length]!) => ({ featureIndex, geometry });
// The area frame is placed at the file's own first vertex, in its WGS 84 UTM zone (New York is zone 18 north).
const [lon0, lat0] = (nyc[0]!.coordinates as number[][][][])[0]![0]![0]!;
const reference = { analysisCrs: 'EPSG:32618', origin: utmForward(lon0!, lat0!, 18) };

const SAID = 'Preview of the outlines read so far; not a record, not reviewed, not placed. ';
const READING = 'Packages follow when the whole file is read and checked.';
const UNSUPPORTED = 'The preview needs a stated, supported CRS; the file’s coordinate system is unsupported or '
  + 'unread. ';

const item = (tray: Partial<IntakeItem> = {}) => ({ itemId: 'i-1', caseId: 'c-1', sourceId: 's-1', parentItemId: null,
  name: 'buildings-original.geojson', family: 'vector', format: 'geojson', state: 'reading', placement: 'undecided',
  streamedProfileJobId: 'p-1', ...tray }) as unknown as IntakeItem;

function page(reading: boolean, crsBasis: PreviewPage['crsBasis'], features: PreviewPage['features'],
  next: number | null, words = SAID + READING): PreviewPage {
  return { itemId: 'i-1', sourceId: 's-1', sourceRevision: 1, sourceSha256: 'a'.repeat(64), rawJobId: 'r-1',
    chunksRead: 1, reading, crsBasis, features, next, words };
}

/** Answers each read with the next page in turn; records the `after` of every read. */
function follow(pages: PreviewPage[]) {
  const afters: number[] = [];
  const published: PreviewFile[][] = [];
  const io = { page: vi.fn(async (_item: IntakeItem, after: number) => {
    afters.push(after);
    return pages.shift() ?? page(false, 'stated', [], null);
  }) };
  const previews = new ReadPreviews(io, (files) => published.push(files));
  return { previews, afters, published, last: () => published[published.length - 1] ?? [] };
}

// A read answered at the end of a step may ask again at once; fake timers run a zero delay after 1 ms.
const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(1);
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('pages with after=next while reading, then stops when reading ends', async () => {
  const run = follow([
    page(true, 'rfc7946_no_crs_read_yet', [outline(0), outline(1)], 1),
    page(true, 'rfc7946_no_crs_read_yet', [outline(2)], 2),
    page(false, 'rfc7946_no_crs_read_yet', [], 2),
  ]);
  run.previews.sync([item()]);
  await settle();
  await settle(PREVIEW_LIMITS.pollMs);
  await settle(PREVIEW_LIMITS.pollMs);
  await settle(PREVIEW_LIMITS.pollMs * 10);
  expect(run.afters).toEqual([-1, 1, 2]);
  const drawn = previewOutlines(run.last(), reference);
  expect(drawn.map((input) => input.id)).toEqual(['i-1:0', 'i-1:1', 'i-1:2']);
  const [x, y] = utmForward(lon0!, lat0!, 18);
  expect(drawn[0]!.polygons[0]![0]![0]).toEqual([x - reference.origin[0], y - reference.origin[1]]);
  expect(drawn.map((input) => input.polygons.flat(2).length))
    .toEqual(nyc.map((geometry) => (geometry.coordinates as number[][][][]).flat(2).length));
});

it('replaces the drawn set when the basis changes, read again from the first outline', async () => {
  const run = follow([
    page(true, 'rfc7946_no_crs_read_yet', [outline(0)], 0),
    page(true, 'stated', [outline(1)], 1),
    page(true, 'stated', [outline(1), outline(2)], 2),
  ]);
  run.previews.sync([item()]);
  await settle();
  expect(previewOutlines(run.last(), reference).map((input) => input.id)).toEqual(['i-1:0']);
  await settle(PREVIEW_LIMITS.pollMs);
  expect(run.afters).toEqual([-1, 0, -1]);
  expect(run.last()[0]!.basis).toBe('stated');
  expect(previewOutlines(run.last(), reference).map((input) => input.id)).toEqual(['i-1:1', 'i-1:2']);
  run.previews.dispose();
});

it('draws nothing on an unsupported basis and shows the route\'s words', async () => {
  const run = follow([page(true, 'unsupported', [], null, SAID + UNSUPPORTED + READING)]);
  run.previews.sync([item()]);
  await settle();
  expect(previewOutlines(run.last(), reference)).toEqual([]);
  const markup = renderToStaticMarkup(createElement(PreviewKey, { lines: previewKeyLines(run.last(), true) }));
  expect(markup).toContain('not a record, not reviewed, not placed.');
  expect(markup).toContain('unsupported or unread');
  run.previews.dispose();
});

it('removes the preview when the first package reaches the map, or the read is sealed', async () => {
  const run = follow([page(true, 'stated', [outline(0)], 0)]);
  run.previews.sync([item()]);
  await settle();
  expect(previewOutlines(run.last(), reference)).toHaveLength(1);
  run.previews.sync([item({ placement: 'on_map' })]);
  expect(run.last()).toEqual([]);
  await settle(PREVIEW_LIMITS.pollMs * 5);
  expect(run.afters).toEqual([-1]);

  const sealed = follow([page(true, 'stated', [outline(0)], 0), page(false, 'sealed', [outline(1)], 1)]);
  sealed.previews.sync([item()]);
  await settle();
  await settle(PREVIEW_LIMITS.pollMs);
  expect(sealed.last()).toEqual([]);
});

it('keeps polygons only, at most the stated cap, and says what it leaves out', async () => {
  const full = (from: number) => Array.from({ length: PREVIEW_LIMITS.page }, (_, n) => outline(from + n));
  const pages: PreviewPage[] = Array.from({ length: PREVIEW_LIMITS.outlines / PREVIEW_LIMITS.page + 1 },
    (_, n) => page(true, 'stated', full(n * PREVIEW_LIMITS.page), (n + 1) * PREVIEW_LIMITS.page - 1));
  const coordinates: [number, number] = [lon0!, lat0!];
  const point = { featureIndex: 99_999, geometry: { type: 'Point' as const, coordinates } };
  pages[0]!.features.push(point);
  const asked = pages.length;
  const run = follow(pages);
  run.previews.sync([item()]);
  await settle();
  await settle(PREVIEW_LIMITS.pollMs * 20);
  expect(run.afters).toHaveLength(asked);
  expect(run.last()[0]!.features).toHaveLength(PREVIEW_LIMITS.outlines);
  expect(run.last()[0]!.line).toContain('First 20,000 outlines shown.');
  expect(run.last()[0]!.line).toContain('Points and lines not drawn: 1.');
  expect(previewKeyLines(run.last(), false)[0]!.line).toContain('no WGS 84 UTM zone');
  expect(previewOutlines(run.last(), { analysisCrs: 'EPSG:4326', origin: [0, 0] })).toEqual([]);
});
