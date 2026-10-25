import type { PlacedCorners } from '../../map/surface/las';
import { isSurfaceItem, RANKED, SHADED, SURFACE_LIMITS, type IntakeItem, type PartDisplay, type PartPage,
  type SurfaceIo } from '../../map/surface/parts';

export const DISPLAY_ONLY = 'Display only, not on the map.';

type XY = readonly [number, number];
/** A part's corners in the source's own coordinates and units, as its display read states them. */
type SourceCorners = readonly [XY, XY, XY, XY];

/** One part not placed: its corners in the file's own frame, with its picture or points once they decode. */
export interface PreviewPart {
  partIndex: number;
  corners: SourceCorners;
  image?: HTMLCanvasElement;
  points?: { positions: Float32Array; colors: Float32Array };
}

export interface PreviewView {
  /** Not-placed parts in part order; a part whose content was not read keeps no picture and no points. */
  parts: PreviewPart[];
  /** The not-placed words as the display reads state them, with how many parts each holds. */
  reasons: string[];
  /** Everything else said about the read: placed parts, refusals, failed reads, shading and the cap. */
  notes: string[];
}

/** A kept surface the map does not draw: an item already on the map has no preview. */
export function opensPreview(item: IntakeItem): boolean {
  return isSurfaceItem(item) && item.placement !== 'on_map';
}

const words = (error: unknown) => (error instanceof Error && error.message ? error.message : 'It could not be read.');

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** Distinct words with how many parts each holds: "3 parts: words". */
function grouped(reasons: Map<number, string>): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${count(n, 'part')}: ${reason}`);
}

/**
 * The parts of one kept surface that its display reads say are not placed, read for a preview in the file's own
 * frame. Its parts are paged, then each published part's display read is asked in part order, at most four in
 * flight and at most 256 for the file, the map's own bounds. A placed part is only counted (the map draws it); a
 * part not placed has its artifact read by its existing route and decoded off the main thread. Nothing is placed,
 * converted, measured or written back.
 */
export class SurfacePreviewReader {
  private readonly controller = new AbortController();
  private readonly queue: number[] = [];
  private inFlight = 0;
  /** Every index up to this one is published or quarantined, so paging starts after it. */
  private settled = -1;
  private readonly published = new Set<number>();
  private readonly quarantined = new Set<number>();
  private readonly asked = new Set<number>();
  private readonly placed = new Set<number>();
  private readonly parts = new Map<number, PreviewPart>();
  private readonly notPlaced = new Map<number, string>();
  private readonly refused = new Map<number, string>();
  private readonly failed = new Map<number, string>();
  private readonly said = new Set<string>();
  private listFailure: string | null = null;
  private paging = false;
  private again = false;
  private item: IntakeItem | null = null;

  constructor(private readonly io: SurfaceIo, private readonly publish: (view: PreviewView) => void) {}

  /** The batch reported the item: a new count of read parts or a new state pages it again. */
  sync(item: IntakeItem): void {
    const known = this.item;
    this.item = item;
    if (known && known.partsDone === item.partsDone && known.state === item.state) return;
    void this.page();
  }

  dispose(): void {
    this.controller.abort();
    this.queue.length = 0;
  }

  private async page(): Promise<void> {
    if (this.paging) { this.again = true; return; }
    this.paging = true;
    const { signal } = this.controller;
    try {
      for (let after: number | null = this.settled; after !== null && !signal.aborted;) {
        const page = await this.io.page(this.item!, after, signal);
        for (const part of page.parts) this.note(part);
        after = this.asked.size >= SURFACE_LIMITS.drawnPerItem ? null : page.next;
      }
      this.listFailure = null;
    } catch (error) {
      if (signal.aborted) return;
      this.listFailure = `Its parts could not be listed: ${words(error)}`;
    } finally {
      this.paging = false;
    }
    this.ask();
    if (this.again) { this.again = false; void this.page(); }
  }

  private note(part: PartPage['parts'][number]): void {
    if (part.state === 'quarantined') this.quarantined.add(part.partIndex);
    if (part.state === 'published') this.published.add(part.partIndex);
    while (this.published.has(this.settled + 1) || this.quarantined.has(this.settled + 1)) this.settled++;
  }

  /** Queues the display read of each read part not yet asked, in part order, up to the per-file cap. */
  private ask(): void {
    const waiting = [...this.published].filter((index) => !this.asked.has(index)).sort((a, b) => a - b);
    for (const partIndex of waiting) {
      if (this.asked.size >= SURFACE_LIMITS.drawnPerItem) break;
      this.asked.add(partIndex);
      this.queue.push(partIndex);
    }
    this.emit();
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < SURFACE_LIMITS.displayReads && this.queue.length) {
      const partIndex = this.queue.shift()!;
      this.inFlight++;
      void this.read(partIndex).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  /** One part: its display read, then, when it is not placed, its artifact decoded off the main thread. */
  private async read(partIndex: number): Promise<void> {
    const { signal } = this.controller;
    try {
      const display = await this.io.display(this.item!, partIndex, signal);
      this.failed.delete(partIndex);
      if (display.placement.state !== 'not_placed') {
        this.placed.add(partIndex);
        return;
      }
      this.notPlaced.set(partIndex, display.placement.words);
      const part: PreviewPart = { partIndex, corners: display.sourceCorners as unknown as SourceCorners };
      this.parts.set(partIndex, part);
      await this.dress(part, display);
    } catch (error) {
      if (signal.aborted) return;
      this.asked.delete(partIndex);
      this.failed.set(partIndex, words(error));
    } finally {
      if (!signal.aborted) this.emit();
    }
  }

  /** The part's picture, or its points between its source corners; content not read leaves words. */
  private async dress(part: PreviewPart, display: PartDisplay): Promise<void> {
    const { signal } = this.controller;
    try {
      const bytes = await this.io.artifact(display, signal);
      const reply = display.artifact.mediaType === 'image/tiff'
        ? await this.io.decode({ kind: 'raster', bytes }, signal)
        : await this.io.decode(this.pointsRequest(bytes, display), signal);
      if ('refusal' in reply) this.refused.set(part.partIndex, reply.refusal);
      else if (reply.kind === 'points') {
        part.points = { positions: reply.positions, colors: reply.colors };
        this.said.add(RANKED);
      } else {
        part.image = this.io.canvas(reply.picture);
        if (reply.picture.shading === 'own_range') this.said.add(SHADED);
        if (reply.picture.note) this.said.add(reply.picture.note);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      this.refused.set(part.partIndex, `its content could not be read: ${words(error)}`);
    }
  }

  /** The batch's records placed between its source corners: the points stay in the file's own coordinates. */
  private pointsRequest(bytes: ArrayBuffer, display: PartDisplay) {
    if (display.read.operation !== 'point-batch' || !display.read.batch)
      throw new Error('The point display read does not state its exact batch count.');
    const corners = display.sourceCorners as unknown as PlacedCorners;
    return { kind: 'points' as const, bytes, corners, recordLength: display.artifact.bytes / display.read.batch.count };
  }

  private emit(): void {
    const notes: string[] = [];
    if (this.placed.size) notes.push(`${count(this.placed.size, 'part is', 'parts are')} placed and drawn on the map.`);
    const over = this.published.size - SURFACE_LIMITS.drawnPerItem;
    if (over > 0) notes.push(`Only the first ${SURFACE_LIMITS.drawnPerItem} read parts are shown here; `
      + `${count(over, 'later part is', 'later parts are')} not.`);
    for (const line of grouped(this.refused)) notes.push(`Not drawn: ${line}`);
    for (const line of grouped(this.failed)) notes.push(`Not read: ${line}`);
    if (this.quarantined.size) notes.push(`${count(this.quarantined.size, 'part')} could not be read by the reader.`);
    if (this.listFailure) notes.push(this.listFailure);
    notes.push(...this.said);
    // Each view keeps its parts as they are now: a picture decoded later is never drawn into an earlier view.
    const parts = [...this.parts.values()].sort((a, b) => a.partIndex - b.partIndex).map((part) => ({ ...part }));
    this.publish({ parts, reasons: grouped(this.notPlaced), notes });
  }
}
