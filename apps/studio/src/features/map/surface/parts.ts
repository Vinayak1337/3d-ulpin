import type { GetResponse } from '@ulpin/api-client';
import type { SurfacePartInput } from '@ulpin/scene';
import type { PlacedCorners } from './las';
import type { DecodeReply, DecodeRequest } from './decode';
import type { PartPicture } from './pixels';

type PartsPath = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts';
export type IntakeItem = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake'>['items'][number];
export type PartPage = GetResponse<PartsPath>;
export type PartDisplay = GetResponse<`${PartsPath}/{partIndex}/display`>;

/** At most this many parts of one file are drawn; at most this many display reads are in flight at once. */
export const SURFACE_LIMITS = Object.freeze({ drawnPerItem: 256, displayReads: 4 });
/** The tray states of an item whose parts are read; any other item has no parts to draw. */
const READ_STATES = new Set(['planned', 'reading', 'preparing', 'read', 'read_to_limit', 'failed_part']);
export const SHADED = 'Shaded by this part\'s own range; heights are not measured.';
export const RANKED = 'Coloured by height as written, not measured.';

/** A kept orthophoto, terrain raster or point cloud whose parts the batch reads. */
export function isSurfaceItem(item: IntakeItem): boolean {
  return (item.family === 'raster' || item.family === 'point_cloud') && item.sourceId !== null
    && READ_STATES.has(item.state);
}

/** The reads the layer makes, so tests can answer them. */
export interface SurfaceIo {
  page(item: IntakeItem, after: number, signal: AbortSignal): Promise<PartPage>;
  display(item: IntakeItem, partIndex: number, signal: AbortSignal): Promise<PartDisplay>;
  /** The part's artifact through its existing route, checked against the size and SHA-256 the display read states. */
  artifact(display: PartDisplay, signal: AbortSignal): Promise<ArrayBuffer>;
  /** Off the frame: in a worker in the browser. */
  decode(request: DecodeRequest, signal: AbortSignal): Promise<DecodeReply>;
  canvas(picture: PartPicture): HTMLCanvasElement;
}

/** One file's line in the layer list. */
export interface SurfaceLine {
  itemId: string;
  label: string;
  line: string;
}

interface ItemParts {
  item: IntakeItem;
  /** Every index up to this one is published or quarantined, so paging starts after it. */
  settled: number;
  published: Set<number>;
  quarantined: Set<number>;
  /** Parts whose display read is asked or answered: the first 256 read. */
  asked: Set<number>;
  drawn: Map<number, SurfacePartInput>;
  notPlaced: Map<number, string>;
  /** S9.4d. Parts placed in another area than the one shown: not drawn here. */
  elsewhere: Set<number>;
  outlineOnly: Map<number, string>;
  failed: Map<number, string>;
  notes: Set<string>;
  listFailure: string | null;
  paging: boolean;
  again: boolean;
}

const sceneCorners = ([nw, ne, se, sw]: PlacedCorners): SurfacePartInput['corners'] =>
  [[sw[0], sw[1]], [se[0], se[1]], [ne[0], ne[1]], [nw[0], nw[1]]];

const words = (error: unknown) => (error instanceof Error && error.message ? error.message : 'It could not be read.');

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** Distinct words with how many parts each holds: "3 parts: words". */
function grouped(reasons: Map<number, string>): string {
  const counts = new Map<string, number>();
  for (const reason of reasons.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${count(n, 'part')}: ${reason}`).join(' ');
}

/** The cap in words: which read parts are shown and how many later ones are not. */
function cappedWords(asked: Set<number>, published: number): string | null {
  const over = published - SURFACE_LIMITS.drawnPerItem;
  if (over <= 0) return null;
  const indices = [...asked].sort((a, b) => a - b);
  return `First ${SURFACE_LIMITS.drawnPerItem} parts shown (${indices[0]} to ${indices[indices.length - 1]}); `
    + `${count(over, 'later part')} not drawn.`;
}

/** The line in the layer list: what is drawn, what is not placed and why, in the placement's own words. */
export function surfaceLine(state: ItemParts): string {
  const { item, published, drawn, notPlaced, outlineOnly, failed } = state;
  const out: string[] = [];
  if (!published.size) out.push(item.limitReason ?? 'No part is read yet.');
  else out.push(`${count(drawn.size, 'part')} drawn and ${notPlaced.size.toLocaleString('en-IN')} not placed, `
    + `of ${count(published.size, 'read part')}.`);
  if (notPlaced.size) out.push(`Not placed: ${grouped(notPlaced)}`);
  const capped = cappedWords(state.asked, published.size);
  if (capped) out.push(capped);
  if (outlineOnly.size) out.push(`Outline only: ${grouped(outlineOnly)}`);
  if (failed.size) out.push(`Not read for the map: ${grouped(failed)}`);
  if (state.quarantined.size) out.push(`${count(state.quarantined.size, 'part')} could not be read.`);
  if (state.listFailure) out.push(state.listFailure);
  out.push(...state.notes);
  return out.join(' ');
}

/**
 * The parts of a batch's kept surfaces, read for the map: each file's parts a page at a time, then each published
 * part's display read, at most four in flight across files and at most 256 parts per file. A placed part is drawn
 * at its corners, with its picture or points when they decode; a part not placed is counted, never drawn. Nothing
 * is written back. A failed read is named on its file's line, is asked again at the next page, and leaves every
 * other part drawn. With an area named, only parts placed in that area are drawn, and a file whose parts are placed
 * in another area has no line here (S9.4d).
 */
export class SurfaceParts {
  private readonly items = new Map<string, ItemParts>();
  private readonly queue: { state: ItemParts; partIndex: number }[] = [];
  private inFlight = 0;
  private readonly controller = new AbortController();

  constructor(
    private readonly io: SurfaceIo,
    private readonly publish: (parts: SurfacePartInput[], lines: SurfaceLine[]) => void,
    private readonly areaId: string | null = null,
  ) {}

  /**
   * The batch reported its items: a new file, or one whose parts, state, placement or words moved, is paged again.
   * When its placement moved, or its words moved with no new part read, the area it is placed against may have
   * changed: the parts held as not placed are asked again, inside the same bounds as any read.
   */
  sync(items: readonly IntakeItem[]): void {
    const surface = items.filter(isSurfaceItem);
    const live = new Set(surface.map((item) => item.itemId));
    for (const id of [...this.items.keys()]) if (!live.has(id)) this.items.delete(id);
    for (const item of surface) {
      const known = this.items.get(item.itemId);
      const placedAgain = Boolean(known) && (known!.item.placement !== item.placement
        || (known!.item.limitReason !== item.limitReason && known!.item.partsDone === item.partsDone));
      if (known && !placedAgain && known.item.partsDone === item.partsDone && known.item.state === item.state)
        continue;
      const state = known ?? this.fresh(item);
      // Their words stay on the line until each is answered again.
      if (placedAgain) for (const partIndex of [...state.notPlaced.keys(), ...state.elsewhere])
        state.asked.delete(partIndex);
      state.item = item;
      this.items.set(item.itemId, state);
      void this.page(state);
    }
    this.emit();
  }

  dispose(): void {
    this.controller.abort();
    this.queue.length = 0;
  }

  private fresh(item: IntakeItem): ItemParts {
    return { item, settled: -1, published: new Set(), quarantined: new Set(), asked: new Set(), drawn: new Map(),
      notPlaced: new Map(), elsewhere: new Set(), outlineOnly: new Map(), failed: new Map(), notes: new Set(), listFailure: null,
      paging: false, again: false };
  }

  /** Pages the item's parts from the first one not yet settled; a sync during paging pages once more after. */
  private async page(state: ItemParts): Promise<void> {
    if (state.paging) { state.again = true; return; }
    state.paging = true;
    const { signal } = this.controller;
    try {
      for (let after: number | null = state.settled; after !== null && !signal.aborted;) {
        const page = await this.io.page(state.item, after, signal);
        for (const part of page.parts) this.note(state, part);
        after = page.next;
      }
      state.listFailure = null;
    } catch (error) {
      if (signal.aborted) return;
      state.listFailure = `Its parts could not be listed: ${words(error)}`;
    } finally {
      state.paging = false;
    }
    this.ask(state);
    if (state.again) { state.again = false; void this.page(state); }
  }

  private note(state: ItemParts, part: PartPage['parts'][number]): void {
    if (part.state === 'quarantined') state.quarantined.add(part.partIndex);
    if (part.state === 'published') state.published.add(part.partIndex);
    while (state.published.has(state.settled + 1) || state.quarantined.has(state.settled + 1)) state.settled++;
  }

  /** Queues the display read of each read part not yet asked, in part order, up to the per-file cap. */
  private ask(state: ItemParts): void {
    const waiting = [...state.published].filter((index) => !state.asked.has(index)).sort((a, b) => a - b);
    for (const partIndex of waiting) {
      if (state.asked.size >= SURFACE_LIMITS.drawnPerItem) break;
      state.asked.add(partIndex);
      this.queue.push({ state, partIndex });
    }
    this.emit();
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < SURFACE_LIMITS.displayReads && this.queue.length) {
      const next = this.queue.shift()!;
      this.inFlight++;
      void this.read(next.state, next.partIndex).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  /** One part: its display read, then its artifact decoded off the frame. */
  private async read(state: ItemParts, partIndex: number): Promise<void> {
    const { signal } = this.controller;
    try {
      const display = await this.io.display(state.item, partIndex, signal);
      state.failed.delete(partIndex);
      state.elsewhere.delete(partIndex);
      if (display.placement.state === 'not_placed') {
        state.notPlaced.set(partIndex, display.placement.words);
        return;
      }
      state.notPlaced.delete(partIndex);
      if (this.areaId && display.placement.areaId !== this.areaId) {
        state.elsewhere.add(partIndex);
        return;
      }
      const corners = display.placement.corners as unknown as PlacedCorners;
      const part: SurfacePartInput = { id: `${state.item.itemId}:${partIndex}`, corners: sceneCorners(corners),
        under: partIndex === 0 && (state.item.partsPlanned ?? state.published.size) > 1 };
      await this.dress(state, part, partIndex, display, corners);
      state.drawn.set(partIndex, part);
    } catch (error) {
      if (signal.aborted) return;
      state.asked.delete(partIndex);
      state.failed.set(partIndex, words(error));
    } finally {
      if (!signal.aborted) this.emit();
    }
  }

  /** The part's picture or points; content that is refused or not read leaves the outline drawn, with words. */
  private async dress(state: ItemParts, part: SurfacePartInput, partIndex: number, display: PartDisplay,
    corners: PlacedCorners): Promise<void> {
    const { signal } = this.controller;
    let reply: DecodeReply;
    try {
      const bytes = await this.io.artifact(display, signal);
      if (display.artifact.mediaType === 'image/tiff') {
        reply = await this.io.decode({ kind: 'raster', bytes, valueRange: display.valueRange }, signal);
      } else {
        if (display.read.operation !== 'point-batch' || !display.read.batch)
          throw new Error('The point display read does not state its exact batch count.');
        const recordLength = display.artifact.bytes / display.read.batch.count;
        reply = await this.io.decode({ kind: 'points', bytes, corners, recordLength,
          valueRange: display.valueRange }, signal);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      reply = { refusal: `its content could not be read: ${words(error)}` };
    }
    if ('refusal' in reply) state.outlineOnly.set(partIndex, reply.refusal);
    else if (reply.kind === 'points') {
      part.points = { positions: reply.positions, colors: reply.colors, sizeM: reply.sizeM };
      state.notes.add(RANKED);
    } else {
      part.image = this.io.canvas(reply.picture);
      if (reply.picture.shading === 'own_range') state.notes.add(SHADED);
      if (reply.picture.shading === 'item_range')
        state.notes.add('Shaded by one stated range for this file; heights are not measured.');
      if (reply.picture.note) state.notes.add(reply.picture.note);
    }
  }

  private emit(): void {
    const parts: SurfacePartInput[] = [], lines: SurfaceLine[] = [];
    for (const state of this.items.values()) {
      if (state.elsewhere.size && !state.drawn.size) continue;
      parts.push(...state.drawn.values());
      lines.push({ itemId: state.item.itemId, label: state.item.name, line: surfaceLine(state) });
    }
    this.publish(parts, lines);
  }
}
