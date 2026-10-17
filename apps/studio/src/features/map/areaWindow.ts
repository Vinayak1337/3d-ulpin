import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@ulpin/api-client';
import type { BaseFeatureInput, FootprintInput, MultiPolygon, SceneEngine } from '@ulpin/scene';
import {
  readAreaWindow, useAreaDisplaySummary, type AreaDisplaySummary, type AreaDisplayWindow, type AreaWindowFeature,
} from '../../api/queries';

/** At most this many features are drawn at once; beyond it the officer moves closer. */
export const WINDOW_BUDGET = 15_000;
/** The camera must be still this long before the view is read. */
export const WINDOW_SETTLE_MS = 300;
const PAGE_LIMIT = 4000;
/** Where the map would be, when the area's summary holds nothing to draw. */
export const WINDOW_EMPTY = 'This area has no buildings recorded or proposed to draw yet.';

export type Bounds = readonly [number, number, number, number];
type ReadPage = (bounds: Bounds, after: string | undefined, limit: number, signal: AbortSignal) =>
  Promise<AreaDisplayWindow>;

/** The area's display read refused because the area holds more features than one list may carry. */
export function isAreaLimit(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  return (error.body as { error?: { code?: unknown } } | null)?.error?.code === 'AREA_LIMIT';
}

/** The summary counts no feature, or has no extent to place one in: there is nothing to draw. */
export function windowEmpty(summary: AreaDisplaySummary | undefined): boolean {
  return summary !== undefined && (summary.featureCount === 0 || !summary.extent);
}

/** The ground the camera sees, clipped to the area's extent; null when the two do not meet. */
export function viewBounds(footprint: readonly (readonly [number, number])[], extent: Bounds): Bounds | null {
  const xs = footprint.map(([x]) => x), ys = footprint.map(([, y]) => y);
  const minX = Math.max(Math.min(...xs), extent[0]), minY = Math.max(Math.min(...ys), extent[1]);
  const maxX = Math.min(Math.max(...xs), extent[2]), maxY = Math.min(Math.max(...ys), extent[3]);
  return minX < maxX && minY < maxY ? [minX, minY, maxX, maxY] : null;
}

/** Window features as scene inputs: buildings extruded where a height is stated, flat otherwise; a proposal a ghost. */
export function windowScene(features: readonly AreaWindowFeature[]) {
  const footprints: FootprintInput[] = [], base: BaseFeatureInput[] = [];
  for (const { id, kind, heightM, heightState, displayState, ...outline } of features) {
    // The published schema widens each [x, y] pair to a number list; the server sends pairs.
    const polygons = outline.polygons as MultiPolygon;
    if (!polygons.length) continue;
    if (kind === 'building') {
      footprints.push({ id, polygons, heightM, heightState, candidate: displayState === 'unrecorded_proposal' });
    }
    else base.push({ id, kind, polygons });
  }
  return { footprints, base };
}

/** The one line that tells the officer what the map draws of the area, and how many of it wait for confirmation. */
export function windowLine(features: readonly AreaWindowFeature[], total: number): string {
  const noun = features.every((feature) => feature.kind === 'building') ? 'buildings' : 'features';
  const all = total.toLocaleString('en-IN');
  const proposed = features.filter((feature) => feature.displayState === 'unrecorded_proposal').length;
  const note = proposed ? ` (${proposed.toLocaleString('en-IN')} proposed, not yet confirmed)` : '';
  if (features.length >= total) return `${all} ${noun}${note}`;
  return `Showing ${features.length.toLocaleString('en-IN')} of ${all} ${noun}${note}; move closer to see the rest.`;
}

/**
 * Reads the features of the camera's view once the camera settles, page by page up to the drawn budget. A read
 * the camera has moved on from is aborted; the same view is not read twice.
 */
export class WindowReader {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private lastKey: string | null = null;

  constructor(
    private readonly view: () => Bounds | null,
    private readonly read: ReadPage,
    private readonly publish: (features: AreaWindowFeature[]) => void,
    private readonly fail: (error: unknown) => void,
    private readonly budget = WINDOW_BUDGET,
  ) {}

  /** The camera moved or a frame was drawn: read the view once nothing has moved for the settle time. */
  viewChanged(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.readView(), WINDOW_SETTLE_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.controller?.abort();
  }

  private async readView(): Promise<void> {
    const bounds = this.view();
    const key = bounds?.join() ?? '';
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    if (!bounds) return this.publish([]);
    const features: AreaWindowFeature[] = [];
    let after: string | undefined;
    try {
      do {
        const limit = Math.min(PAGE_LIMIT, this.budget - features.length);
        const page = await this.read(bounds, after, limit, controller.signal);
        if (controller.signal.aborted) return;
        features.push(...page.features);
        after = page.next ?? undefined;
        this.publish([...features]);
      } while (after && features.length < this.budget);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.lastKey = null;
      this.fail(error);
    }
  }
}

const NONE: AreaWindowFeature[] = [];

/** Frames the area's whole extent, then reads the view the camera settles on. */
export function showWindow(engine: Pick<SceneEngine, 'fitPlanBox'>, extent: Bounds, reader: WindowReader): void {
  engine.fitPlanBox(...extent);
  reader.viewChanged();
}

/**
 * Window mode for an area beyond the display limit: the map fits the area's extent and draws the features of the
 * camera's ground view; `empty` when the summary holds nothing to draw. `onView` is called on every rendered frame.
 */
export function useAreaWindow(areaId: string, engine: SceneEngine | null, active: boolean) {
  const summary = useAreaDisplaySummary(active ? areaId : undefined);
  const [features, setFeatures] = useState<AreaWindowFeature[]>(NONE);
  const [error, setError] = useState<unknown>(null);
  const empty = windowEmpty(summary.data);
  const extent = (empty ? null : summary.data?.extent ?? null) as Bounds | null;
  const extentKey = extent?.join();
  const reader = useMemo(() => {
    if (!engine || !extent) return null;
    return new WindowReader(
      () => viewBounds(engine.viewFootprint(), extent),
      (bounds, after, limit, signal) => readAreaWindow(areaId, bounds, after, limit, signal),
      (next) => { setError(null); setFeatures(next); },
      setError,
    );
    // The extent is compared by value: a summary read again with the same extent keeps the reader.
  }, [areaId, engine, extentKey]);
  useEffect(() => {
    if (!reader || !engine || !extent) return;
    showWindow(engine, extent, reader);
    return () => reader.dispose();
    // A new reader comes with every new engine or extent, so it alone starts the read.
  }, [reader]);
  const onView = useCallback(() => reader?.viewChanged(), [reader]);
  const scene = useMemo(() => windowScene(features), [features]);
  const total = summary.data?.featureCount;
  return {
    ...scene, features, onView, empty,
    error: (summary.error ?? error) as Error | null,
    line: total === undefined || !extent ? null : windowLine(features, total),
  };
}
