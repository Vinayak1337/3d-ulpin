import type { QueryClient } from '@tanstack/react-query';
import type { IntakeItem, IntakeManifest } from './batch-model';
import { intakeKey, readIntakeItem, rereadQuery } from './batch-queries';

type ReadItem = (caseId: string, itemId: string) => Promise<IntakeItem>;

/**
 * TR1. A change that names one intake item the tray holds reads that item alone and puts it in its place in the
 * cached manifest; the reads of the batch's sections are asked again as before. Every other change re-reads the
 * whole manifest by ZP2's rule: a change without an item, an item the cache does not hold (a new one), an item
 * whose place in the list would move, and any failed read.
 *
 * Changes to one item in the same turn share one read. A change during that item's read asks for one more read
 * after it. Item reads wait for a manifest read in flight, whose answer began before the change.
 *
 * SL1. Changes that ask for the manifest in the same turn share one manifest read: the consumers of one case (the
 * tray and the map) each pass the same notification on in one turn, and a read asked in that turn answers all of
 * them. A change in a later turn, while that read is in flight, still asks for one more read after it.
 */
export class IntakeItemRefresh {
  private readonly key: string[];
  private readonly named = new Set<string>();
  private readonly reading = new Set<string>();
  private readonly again = new Set<string>();
  private wholeAsked = false;

  constructor(private readonly client: QueryClient, private readonly caseId: string,
    private readonly read: ReadItem = readIntakeItem) {
    this.key = intakeKey(caseId);
  }

  changed(itemId?: string) {
    if (!itemId || !this.held(itemId)) {
      this.whole();
      return;
    }
    if (this.reading.has(itemId)) {
      this.again.add(itemId);
      return;
    }
    const idle = !this.named.size;
    this.named.add(itemId);
    if (idle) queueMicrotask(() => void this.flush());
  }

  /** The manifest and every read under it, by ZP2's rule: at most one read in flight, and one more after it. */
  private whole() {
    if (this.wholeAsked) return;
    this.wholeAsked = true;
    queueMicrotask(() => { this.wholeAsked = false; });
    rereadQuery(this.client, this.key);
  }

  private held(itemId: string) {
    return Boolean(this.manifest()?.items.some((item) => item.itemId === itemId));
  }

  private manifest() {
    return this.client.getQueryData<IntakeManifest>(this.key);
  }

  private async flush() {
    while (this.fetching()) await this.settled();
    const itemIds = [...this.named];
    this.named.clear();
    rereadQuery(this.client, this.key, (query) => query.queryKey.length > this.key.length);
    for (const itemId of itemIds) void this.readOne(itemId);
  }

  private fetching() {
    return this.client.isFetching({ queryKey: this.key, exact: true }) > 0;
  }

  /** The next cache change after which the manifest read in flight has ended; none is started or cancelled. */
  private settled() {
    return new Promise<void>((resolve) => {
      const stop = this.client.getQueryCache().subscribe(() => {
        if (this.fetching()) return;
        stop();
        resolve();
      });
    });
  }

  private async readOne(itemId: string) {
    this.reading.add(itemId);
    try {
      this.merge(await this.read(this.caseId, itemId));
    } catch {
      this.whole();
    } finally {
      this.reading.delete(itemId);
      if (this.again.delete(itemId)) this.changed(itemId);
    }
  }

  /** An item a later manifest read left out (a member taken out) is not put back: the manifest decides the list. */
  private merge(next: IntakeItem) {
    const manifest = this.manifest();
    const held = manifest?.items.find((item) => item.itemId === next.itemId);
    if (!manifest || !held) return;
    if (!samePlace(held, next)) {
      this.whole();
      return;
    }
    const items = manifest.items.map((item) => item.itemId === next.itemId ? next : item);
    this.client.setQueryData<IntakeManifest>(this.key, { ...manifest, items });
  }
}

const shared = new WeakMap<QueryClient, Map<string, IntakeItemRefresh>>();

/**
 * SL1. The one refresh of a batch on this client: the tray and the map route a change to the same object, so its
 * coalescing covers both and one change is read once. An entry lives as long as its client.
 */
export function itemRefreshFor(client: QueryClient, caseId: string): IntakeItemRefresh {
  let batches = shared.get(client);
  if (!batches) shared.set(client, batches = new Map());
  let refresh = batches.get(caseId);
  if (!refresh) batches.set(caseId, refresh = new IntakeItemRefresh(client, caseId));
  return refresh;
}

/** The manifest orders by wave and name, and lists a member by its source; a change to either re-reads the list. */
function samePlace(held: IntakeItem, next: IntakeItem) {
  return held.wave === next.wave && held.name === next.name && held.sourceId === next.sourceId
    && held.parentItemId === next.parentItemId;
}
