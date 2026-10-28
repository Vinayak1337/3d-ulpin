import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { SceneEngine } from '@ulpin/scene';
import { queryKeys, type AreaDisplaySummary, type AreaDisplayWindow, type AreaWindowFeature } from '../../api/queries';
import {
  WINDOW_EMPTY, WINDOW_SETTLE_MS, WindowReader, isAreaLimit, showWindow, useAreaWindow, viewBounds, windowEmpty,
  windowLine, windowScene, type Bounds,
} from './areaWindow';
import { WindowKey, WindowedArea, WindowedInspector } from './WindowedArea';

function feature(
  identifier: string, kind: AreaWindowFeature['kind'] = 'building', heightM: number | null = null,
  displayState: AreaWindowFeature['displayState'] = 'recorded',
) {
  return {
    id: `id-${identifier}`, identifier, kind, heightM, heightState: heightM === null ? 'unknown' : 'source_supported',
    polygons: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]], displayState,
  } as AreaWindowFeature;
}

describe('window mode', () => {
  it('turns on for an AREA_LIMIT answer and not otherwise', () => {
    const limit = { error: { code: 'AREA_LIMIT', message: 'Choose an area with at most 10,000 display features.' } };
    expect(isAreaLimit(new ApiError(422, '/api/v1/areas/a/context', limit))).toBe(true);
    const other = { error: { code: 'MEMBERSHIP_FRAME' } };
    expect(isAreaLimit(new ApiError(422, '/api/v1/areas/a/context', other))).toBe(false);
    expect(isAreaLimit(new ApiError(503, '/api/v1/areas/a/canonical', limit))).toBe(false);
    expect(isAreaLimit(new Error('AREA_LIMIT'))).toBe(false);
    expect(isAreaLimit(null)).toBe(false);
  });

  it('says the whole area when all of it is drawn, and what is in view of the area when the view is not cut', () => {
    const drawn = [feature('a'), feature('b')];
    expect(windowLine(drawn, 2, false)).toBe('2 buildings');
    expect(windowLine(drawn, 41_809, false)).toBe('2 buildings in view of 41,809');
    expect(windowLine([], 41_809, false)).toBe('0 buildings in view of 41,809');
    expect(windowLine([feature('a'), feature('r', 'road')], 2, false)).toBe('2 features');
  });

  it('says move closer only when the budget cut the view', () => {
    expect(windowLine([feature('a'), feature('b')], 41_809, true))
      .toBe('2 buildings in view. Move closer to see the rest.');
    expect(windowLine([feature('a'), feature('r', 'road')], 41_809, true))
      .toBe('2 features in view. Move closer to see the rest.');
  });

  it('says the view is still loading, with the count so far, until its reads end', () => {
    const drawn = [feature('a'), feature('b', 'building', null, 'unrecorded_proposal')];
    expect(windowLine([feature('a'), feature('b')], 41_809, false, true)).toBe('Loading buildings in view: 2 so far');
    expect(windowLine(drawn, 41_809, false, true))
      .toBe('Loading buildings in view: 2 so far (1 candidate)');
    expect(windowLine(drawn, 41_809, false, false))
      .toBe('2 buildings in view of 41,809 (1 candidate)');
  });

  it('extrudes a stated height, keeps an unstated one flat and draws other kinds as base', () => {
    const { footprints, base } = windowScene([feature('a', 'building', 12), feature('b'), feature('r', 'road')]);
    expect(footprints.map((input) => [input.id, input.heightM])).toEqual([['id-a', 12], ['id-b', null]]);
    expect(base.map((input) => [input.id, input.kind])).toEqual([['id-r', 'road']]);
  });

  // Shape-only window responses: these positions are structural placeholders, not records.
  it('passes a proposed road LineString of four positions without polygons unchanged', () => {
    const road = { ...feature('r', 'road', null, 'unrecorded_proposal'),
      polygons: [], lines: [[[0, 0], [1, 0], [1, 1], [2, 1]]] };
    const { footprints, base } = windowScene([road]);
    expect(footprints).toEqual([]);
    expect(base).toEqual([{ id: road.id, kind: 'road', polygons: [], lines: road.lines }]);
    expect(base[0]?.lines).toBe(road.lines);
  });

  it('passes a MultiPoint utility as pins without polygons unchanged', () => {
    const utility = { ...feature('u', 'utility'), polygons: [], pins: [[0, 0], [1, 1]] };
    const { footprints, base } = windowScene([utility]);
    expect(footprints).toEqual([]);
    expect(base).toEqual([{ id: utility.id, kind: 'utility', polygons: [], pins: utility.pins }]);
    expect(base[0]?.pins).toBe(utility.pins);
  });

  it('skips a building with only lines and any feature with no drawable geometry', () => {
    const building = { ...feature('b'), polygons: [], lines: [[[0, 0], [1, 1]]] };
    const empty = { ...feature('r', 'road'), polygons: [], lines: [], pins: [] };
    expect(windowScene([building, empty, { ...feature('u', 'utility'), polygons: [] }]))
      .toEqual({ footprints: [], base: [] });
  });

  it('keeps polygons, lines and pins together on one base input', () => {
    const road = { ...feature('r', 'road'), lines: [[[0, 0], [1, 1]]], pins: [[1, 1]] };
    const { base } = windowScene([road]);
    expect(base).toEqual([{ id: road.id, kind: 'road', polygons: road.polygons, lines: road.lines, pins: road.pins }]);
    expect(base[0]?.polygons).toBe(road.polygons);
  });

  it('says how many drawn features are candidates, in every case, and nothing when none are', () => {
    const drawn = [feature('a'), feature('b', 'building', null, 'unrecorded_proposal')];
    const note = '(1 candidate)';
    expect(windowLine(drawn, 2, false)).toBe(`2 buildings ${note}`);
    expect(windowLine(drawn, 41_809, false)).toBe(`2 buildings in view of 41,809 ${note}`);
    expect(windowLine(drawn, 41_809, true))
      .toBe(`2 buildings in view ${note}. Move closer to see the rest.`);
    expect(windowLine([feature('a'), feature('b')], 2, false)).toBe('2 buildings');
  });

  it('draws a proposal as a candidate and a recorded building as a record', () => {
    const { footprints } = windowScene([feature('a'), feature('b', 'building', 9, 'unrecorded_proposal')]);
    expect(footprints.map((input) => [input.id, input.candidate])).toEqual([['id-a', false], ['id-b', true]]);
  });

  it('clips the view to the area extent and gives no window outside it', () => {
    const view: [number, number][] = [[-50, -50], [50, -50], [60, 80], [-60, 80]];
    expect(viewBounds(view, [0, 0, 1000, 1000])).toEqual([0, 0, 60, 80]);
    expect(viewBounds(view, [500, 500, 1000, 1000])).toBeNull();
  });
});

// Shape-only summaries: the counts and boxes below are structural placeholders, not records.
const summary = (featureCount: number, extent: Bounds | null) =>
  ({ areaId: 'a', areaRevision: 0, featureCount, extent }) as AreaDisplaySummary;

/** The markup of a tree with the area list and, when given, the area's summary already read. */
function render(element: ReactElement, read?: AreaDisplaySummary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.areas, []);
  if (read) client.setQueryData(queryKeys.areaDisplaySummary('a'), read);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null, element)));
}

// The scale and north readout's box, by its module class.
const READOUT = /class="_readout_/;

function WindowProbe({ active }: { active: boolean }) {
  const { empty, line, error } = useAreaWindow('a', null, active);
  return `${empty} ${line} ${error}`;
}

describe('nothing to draw', () => {
  it('is said for no feature counted or no extent, and not for a summary not yet read', () => {
    expect(windowEmpty(undefined)).toBe(false);
    expect(windowEmpty(summary(0, [0, 0, 10, 10]))).toBe(true);
    expect(windowEmpty(summary(5, null))).toBe(true);
    expect(windowEmpty(summary(5, [0, 0, 10, 10]))).toBe(false);
  });

  it('puts one sentence where the map would be, with no banner, line or readout', () => {
    for (const read of [summary(0, null), summary(0, [0, 0, 10, 10]), summary(5, null)]) {
      const markup = render(createElement(WindowedArea, { areaId: 'a' }), read);
      expect(markup).toContain(WINDOW_EMPTY);
      expect(markup).not.toContain('could not be read');
      expect(markup).not.toContain('role="status"');
      expect(markup).not.toMatch(READOUT);
    }
    const drawable = render(createElement(WindowedArea, { areaId: 'a' }), summary(5, [0, 0, 10, 10]));
    expect(drawable).not.toContain(WINDOW_EMPTY);
    expect(drawable).toMatch(READOUT);
  });

  it('leaves an area under the limit as it was: no summary read, nothing said', () => {
    expect(render(createElement(WindowProbe, { active: false }), summary(0, null))).toBe('false null null');
    expect(render(createElement(WindowProbe, { active: true }), summary(0, null))).toBe('true null null');
  });
});

describe('the key', () => {
  it('names both styles in a disclosure the keyboard reaches, beside a drawn window', () => {
    const markup = render(createElement(WindowKey));
    expect(markup).toMatch(/<details[^>]*open=""[^>]*><summary>Key<\/summary>/);
    expect(markup).toContain('Recorded');
    expect(markup).toContain('Candidate');
    const drawable = render(createElement(WindowedArea, { areaId: 'a' }), summary(5, [0, 0, 10, 10]));
    expect(drawable).toContain('<summary>Key</summary>');
  });
});

describe('a picked footprint', () => {
  const inspector = (kind: AreaWindowFeature['kind']) =>
    render(createElement(WindowedInspector, { feature: feature('B-1', kind), areaName: 'Area', onClose() {} }));

  it('offers a building its register by id', () => {
    const markup = inspector('building');
    expect(markup).toContain('href="/studio/properties/id-B-1/register"');
    expect(markup).toContain('>Open register</a>');
    expect(markup).toContain('B-1');
  });

  const proposal = (caseId?: string) => render(createElement(WindowedInspector, {
    feature: { ...feature('B-2', 'building', null, 'unrecorded_proposal'), ...(caseId ? { caseId } : {}) },
    areaName: 'Area', onClose() {},
  }));

  it('links a proposal to the batch of its case, keeps its identifier and register; a record is no candidate', () => {
    const markup = proposal('c-1');
    expect(markup).toContain('Candidate');
    expect(markup).toMatch(/<a [^>]*href="\/studio\/work\/cases\/c-1\/intake"[^>]*>Open batch to confirm<\/a>/);
    expect(markup).toContain('B-2');
    expect(markup).toContain('>Open register</a>');
    const recorded = inspector('building');
    expect(recorded).not.toContain('Candidate');
    expect(recorded).not.toContain('/intake');
  });

  it('marks a proposal with no case a candidate and links no batch', () => {
    const markup = proposal();
    expect(markup).toContain('Candidate');
    expect(markup).not.toContain('/intake');
    expect(markup).not.toContain('Open batch');
  });

  it('offers no register for a feature that is not a building', () => {
    expect(inspector('road')).not.toContain('/register');
  });
});

describe('window reads', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const page = (features: AreaWindowFeature[], next: string | null) =>
    ({ areaId: 'a', areaRevision: 1, features, next }) as AreaDisplayWindow;

  it('reads once the camera settles and pages by next up to the budget', async () => {
    const read = vi.fn(async (_: Bounds, after: string | undefined, limit: number) =>
      after ? page([feature('c')].slice(0, limit), 'd') : page([feature('a'), feature('b')], 'b'));
    const published: [string[], boolean, boolean][] = [];
    const reader = new WindowReader(() => [0, 0, 10, 10], read,
      (features, cut, loading) => published.push([features.map((item) => item.identifier), cut, loading]),
      vi.fn(), 3);
    reader.viewChanged();
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS - 1);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read.mock.calls.map(([, after, limit]) => [after, limit])).toEqual([[undefined, 3], ['b', 1]]);
    expect(published).toEqual([[['a', 'b'], false, true], [['a', 'b', 'c'], true, false]]);
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('S3.16f: reads from a start cursor, wraps once and stops at the first feature it already read', async () => {
    const all = ['a', 'b', 'c', 'd', 'e'].map((id) => feature(id));
    const read = vi.fn(async (_: Bounds, after: string | undefined, limit: number) => {
      const rest = all.filter((item) => after === undefined || item.identifier > after).slice(0, 2);
      return page(rest.slice(0, limit), rest.length && rest.at(-1) !== all.at(-1) ? rest.at(-1)!.identifier : null);
    });
    const published: [string[], boolean, boolean][] = [];
    const reader = new WindowReader(() => [0, 0, 10, 10], read,
      (features, cut, loading) => published.push([features.map((item) => item.identifier), cut, loading]),
      vi.fn(), 10, 'c');
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(read.mock.calls.map(([, after]) => after)).toEqual(['c', undefined, 'b']);
    expect(published).toEqual([[['d', 'e'], false, true], [['d', 'e', 'a', 'b'], false, true],
      [['d', 'e', 'a', 'b', 'c'], false, false]]);
    reader.dispose();
  });

  it('does not cut a view that ends before the budget or at it, and is not loading after it', async () => {
    const read = vi.fn(async () => page([feature('a'), feature('b')], null));
    const states: [boolean, boolean][] = [];
    const reader = new WindowReader(() => [0, 0, 10, 10], read,
      (_, cut, loading) => states.push([cut, loading]), vi.fn(), 2);
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(states).toEqual([[false, false]]);
    reader.dispose();
  });

  it('fits the whole extent, never only centres on it, then reads the settled view', async () => {
    const engine = { fitPlanBox: vi.fn(), panTo: vi.fn() };
    const read = vi.fn(async () => page([], null));
    const reader = new WindowReader(() => [0, 0, 10, 10], read, vi.fn(), vi.fn());
    showWindow(engine as unknown as SceneEngine, [-2000, 500, 3000, 2500], reader);
    expect(engine.fitPlanBox).toHaveBeenCalledWith(-2000, 500, 3000, 2500);
    expect(engine.panTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(read).toHaveBeenCalledOnce();
    reader.dispose();
  });

  it('aborts a read the camera has moved on from and never publishes it', async () => {
    let view: Bounds = [0, 0, 10, 10];
    const signals: AbortSignal[] = [];
    const read = vi.fn((bounds: Bounds, _after: string | undefined, _limit: number, signal: AbortSignal) => {
      signals.push(signal);
      if (bounds[0] === 0) return new Promise<AreaDisplayWindow>(() => {});
      return Promise.resolve(page([feature('far')], null));
    });
    const published: string[][] = [];
    const reader = new WindowReader(() => view, read,
      (features) => published.push(features.map((item) => item.identifier)), vi.fn());
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    view = [500, 500, 600, 600];
    reader.viewChanged();
    await vi.advanceTimersByTimeAsync(WINDOW_SETTLE_MS);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(published).toEqual([['far']]);
    reader.dispose();
    expect(signals[1]?.aborted).toBe(true);
  });
});
