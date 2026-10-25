import { ApiError, type GetResponse } from '@ulpin/api-client';
import type { IntakeItem } from '../surface/parts';

type PreviewPath = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/read-preview';
export type PreviewPage = GetResponse<PreviewPath>;
export type PreviewFeature = PreviewPage['features'][number];

/**
 * The route sends at most 2,000 outlines a page; the map keeps at most `outlines` of one file and then says so, and
 * reads the route again every `pollMs` while the file is read.
 */
export const PREVIEW_LIMITS = Object.freeze({ page: 2000, outlines: 20_000, pollMs: 2000 });
const FOLLOWED = new Set(['probed', 'planned', 'reading']);
const FORMATS = new Set(['geojson', 'geojson-seq']);
const POLYGONS = new Set(['Polygon', 'MultiPolygon']);

/** A top-level large GeoJSON still being read, none of whose packages has reached the map. */
export function isPreviewItem(item: IntakeItem): boolean {
  return item.family === 'vector' && FORMATS.has(item.format ?? '') && item.parentItemId === null
    && item.sourceId !== null && item.streamedProfileJobId !== null && FOLLOWED.has(item.state)
    && item.placement !== 'on_map';
}

/** One file's preview as drawn: polygons only, since the scene draws no points or lines. */
export interface PreviewFile {
  itemId: string;
  name: string;
  basis: PreviewPage['crsBasis'] | null;
  features: PreviewFeature[];
  line: string;
}

export interface PreviewIo {
  page(item: IntakeItem, after: number, signal: AbortSignal): Promise<PreviewPage>;
}

interface Follow {
  item: IntakeItem;
  after: number;
  basis: PreviewPage['crsBasis'] | null;
  features: PreviewFeature[];
  notDrawn: number;
  words: string | null;
  failure: string | null;
  capped: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const count = (n: number) => n.toLocaleString('en-IN');

/** The route's own words, then what this map leaves out of them. */
function previewLine(follow: Follow): string {
  const out = follow.words ? [follow.words] : [];
  if (follow.capped) out.push(`First ${count(PREVIEW_LIMITS.outlines)} outlines shown.`);
  if (follow.notDrawn) out.push(`Points and lines not drawn: ${count(follow.notDrawn)}.`);
  if (follow.failure) out.push(follow.failure);
  return out.join(' ');
}

/** A refusal that reading on will not change; a missing first part or a server fault is asked again. */
function settledRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status !== 404 && error.status < 500;
}

/**
 * The outlines read so far of each large GeoJSON of the area's batches, display only. Each file is paged from
 * `after=-1` by the route's `next`, read again every poll while the route says `reading`, and stops when reading ends
 * or the cap is reached. A new `crsBasis` replaces the file's preview, read again from its first outline. A file
 * whose first package reaches the map, that leaves the batch, or that the route reports read and sealed, is removed.
 */
export class ReadPreviews {
  private readonly follows = new Map<string, Follow>();
  private readonly controller = new AbortController();

  constructor(private readonly io: PreviewIo, private readonly publish: (files: PreviewFile[]) => void) {}

  sync(items: readonly IntakeItem[]): void {
    const live = new Map(items.filter(isPreviewItem).map((item) => [item.itemId, item]));
    for (const id of [...this.follows.keys()]) if (!live.has(id)) this.drop(id);
    for (const item of live.values()) {
      const known = this.follows.get(item.itemId);
      if (known) { known.item = item; continue; }
      const follow: Follow = { item, after: -1, basis: null, features: [], notDrawn: 0, words: null, failure: null,
        capped: false };
      this.follows.set(item.itemId, follow);
      void this.read(follow);
    }
    this.emit();
  }

  dispose(): void {
    this.controller.abort();
    for (const id of [...this.follows.keys()]) this.drop(id);
  }

  private drop(itemId: string): void {
    clearTimeout(this.follows.get(itemId)?.timer);
    this.follows.delete(itemId);
  }

  private async read(follow: Follow): Promise<void> {
    const { signal } = this.controller;
    let page: PreviewPage;
    try {
      page = await this.io.page(follow.item, follow.after, signal);
    } catch (error) {
      if (signal.aborted || this.follows.get(follow.item.itemId) !== follow) return;
      if (error instanceof ApiError && error.status === 404) follow.failure = null;
      else follow.failure = `The preview could not be read: ${error instanceof Error ? error.message : String(error)}`;
      this.emit();
      if (!settledRefusal(error)) this.again(follow, PREVIEW_LIMITS.pollMs);
      return;
    }
    if (signal.aborted || this.follows.get(follow.item.itemId) !== follow) return;
    this.take(follow, page);
  }

  private take(follow: Follow, page: PreviewPage): void {
    if (page.crsBasis === 'sealed' && !page.reading) {
      this.drop(follow.item.itemId);
      return this.emit();
    }
    if (follow.basis !== null && page.crsBasis !== follow.basis) {
      Object.assign(follow, { after: -1, basis: page.crsBasis, features: [], notDrawn: 0, capped: false });
      return this.again(follow, 0);
    }
    Object.assign(follow, { basis: page.crsBasis, words: page.words, failure: null });
    for (const feature of page.features) {
      if (!POLYGONS.has(feature.geometry.type)) follow.notDrawn++;
      else if (follow.features.length < PREVIEW_LIMITS.outlines) follow.features.push(feature);
      else follow.capped = true;
    }
    follow.after = page.next ?? follow.after;
    this.emit();
    if (page.reading && !follow.capped) {
      this.again(follow, page.features.length >= PREVIEW_LIMITS.page ? 0 : PREVIEW_LIMITS.pollMs);
    }
  }

  private again(follow: Follow, delayMs: number): void {
    follow.timer = setTimeout(() => void this.read(follow), delayMs);
  }

  /** A file is shown once the route has answered it or failed; a file with no read part yet shows nothing. */
  private emit(): void {
    const shown = [...this.follows.values()].filter((follow) => follow.words || follow.failure);
    this.publish(shown.map((follow) => ({ itemId: follow.item.itemId, name: follow.item.name, basis: follow.basis,
      features: [...follow.features], line: previewLine(follow) })));
  }
}
