import { statfs } from 'node:fs/promises';
import { tmpdir, totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { TABULAR_STREAM_LIMITS } from '@ulpin/contracts/usp';

/** G22. The lanes of docs/next-steps/INGESTION-ARCHITECTURE.md section 8; an operation no row names is `other`. */
export type DispatchLane = 'probe' | 'stream' | 'vector' | 'table' | 'document' | 'raster' | 'point' | 'model3d'
  | 'link' | 'gpu' | 'teacher' | 'other';
type Cost = { lane: DispatchLane; mib: number };
type Hold = Cost & { operation: string; scratchMiB: number; inProcess: boolean; itemId?: string };
type LaneRow = { concurrency: number; mib: number; scratchMiB: number };
/** `workbook` names the table pin: workbooks and CSV reading detection use scratch; pinned CSV reads do not. */
type OperationRow = { lane: DispatchLane; mib?: number; scratchMiB?: number; workbook?: 'request' | 'tabular';
  processor?: true };

/** XW1/CSV2 (tabular-stream.ts scratchFolder): workbook reads and CSV reading detection copy the original,
 * keeping its size and 1 GiB more free; the largest is TABULAR_STREAM_LIMITS.bytes, 7 GiB. */
const WORKBOOK_SCRATCH_MIB = TABULAR_STREAM_LIMITS.bytes / 1024 ** 2 + 1024;

/**
 * Each lane's concurrency in one dispatcher process, and the worst-case memory and scratch in MiB of a job whose
 * operation states none. A number without a cited source is the lane's conservative default, not a measurement.
 * Scratch is what a job writes under dispatchScratchBudgetMiB's root; a lane whose jobs write none there is 0.
 */
export const DISPATCH_LANES: Readonly<Record<DispatchLane, LaneRow>> = Object.freeze({
  // Header reads only: INTAKE_PROBE_LIMITS (64 KiB head and tail, 1 MiB directory); the processor inspects 16 MiB.
  probe: { concurrency: 8, mib: 64, scratchMiB: 0 },
  // Two files' raw readers and profiles; raw readers never wait for their profiles to consume published parts.
  stream: { concurrency: 4, mib: 512, scratchMiB: 0 },
  // Six intake-large steps reserve 6 * 426 = 2556 MiB (default vector jobs: 3072 MiB).
  // A 4096 MiB heap leaves 3072 MiB for jobs; mixed workloads may admit fewer under the same guards.
  vector: { concurrency: 6, mib: 512, scratchMiB: 0 },
  // A table-profile read whose size its payload does not name.
  table: { concurrency: 2, mib: 256, scratchMiB: WORKBOOK_SCRATCH_MIB },
  // docs/evidence/usp/whole-page-ocr-runtime.json: the source OCR worker's peakJobPrivateBytes 975,704,064.
  document: { concurrency: 2, mib: 931, scratchMiB: 0 },
  // RASTER_WINDOW_LIMITS.active is 2.
  raster: { concurrency: 2, mib: 1024, scratchMiB: 0 },
  // POINT_BATCH_LIMITS.active is 2.
  point: { concurrency: 2, mib: 512, scratchMiB: 0 },
  // IFC_LIMITS.active is 2.
  model3d: { concurrency: 2, mib: 512, scratchMiB: 0 },
  link: { concurrency: 2, mib: 256, scratchMiB: 0 },
  // One GPU. docs/evidence/gf-ai/building/b4-pytorch-resource-20261010/result.json: the roof model's peak working
  // set 1,017,249,792 bytes.
  gpu: { concurrency: 1, mib: 970, scratchMiB: 0 },
  teacher: { concurrency: 2, mib: 128, scratchMiB: 0 },
  other: { concurrency: 2, mib: 512, scratchMiB: 0 },
});

/** One connection per lane slot, plus the dispatcher's tick and heartbeat connections. */
export function dispatchPoolSize(): number {
  return Object.values(DISPATCH_LANES).reduce((sum, lane) => sum + lane.concurrency, 2);
}

/**
 * Every operation the dispatcher tick can see, its lane, its own worst-case MiB where one is known, and whether the
 * tick hands it to the processor (as it does any operation not named here) rather than running it in this process.
 */
export const DISPATCH_OPERATIONS: Readonly<Record<string, OperationRow>> = Object.freeze({
  inspect: { lane: 'probe', processor: true },
  // docs/evidence/gf1/g16/result.json memoryProof: peakRssMiB 414.9 for 500,000 features in 5000 parts. A tabular
  // read pins its table under `tabular`.
  'streaming-vector': { lane: 'stream', mib: 415, workbook: 'tabular' },
  // docs/evidence/gf1/lp3a/parts-result.json: peakRssKiB 435,232 cutting the 43 MB NYC GeoJSON into 487 parts.
  'intake-large': { lane: 'vector', mib: 426 },
  'streamed-profile': { lane: 'stream' },
  'projected-vector': { lane: 'vector', processor: true },
  'kml-native': { lane: 'vector' },
  'geoparquet-native': { lane: 'vector' },
  'private-mvt': { lane: 'vector' },
  // A GeoPackage or zipped shapefile converted into GeoJSON layers.
  'intake-native-derivative': { lane: 'vector' },
  // Table windows; a streamed GeoJSON's chunks are mapped by the same job. It reads stored windows, never a file.
  'chunk-mapping': { lane: 'table', scratchMiB: 0 },
  // TP1/XW1/CSV2: table profiling copies CSV bytes for reading detection or a workbook for sheet windows.
  // Its payload pins the table under `request`; old jobs without a size reserve the largest original.
  'table-profile': { lane: 'table', workbook: 'request' },
  // TC1: a kept table's rows written as GeoJSON, read twice in windows; only a workbook read copies to scratch.
  'intake-table-geojson': { lane: 'table', workbook: 'tabular' },
  // document-ocr.ts copies the PDF, at most DOCUMENT_LIMITS.originalBytes 16 MiB, into the scratch root beside the
  // 128 KiB result and 64 KiB receipt it reads back.
  'document-extraction': { lane: 'document', scratchMiB: 17 },
  'packet-pdf': { lane: 'document' },
  // INTAKE_PAGE_IMAGE_LIMITS.inputPixels 250,000,000 decoded at 4 bytes a pixel.
  'intake-page-image': { lane: 'document', mib: 954 },
  'intake-plan': { lane: 'document', mib: 2048 },
  'raster-window': { lane: 'raster' },
  'point-batch': { lane: 'point' },
  build: { lane: 'model3d', processor: true },
  'ifc-native': { lane: 'model3d' },
  'dxf-native': { lane: 'model3d' },
  'citygml-native': { lane: 'model3d' },
  'obj-native': { lane: 'model3d' },
  'gltf-native': { lane: 'model3d' },
  'cityjson-native': { lane: 'model3d' },
  'cityjson-validation': { lane: 'model3d' },
  'intake-evidence': { lane: 'link' },
  'intake-run': { lane: 'link' },
  'spatial-inference': { lane: 'gpu', processor: true },
  'dataset-spatial-inference': { lane: 'gpu', processor: true },
  // The draft's slow path is the gateway teacher's proposal.
  'intake-draft': { lane: 'teacher' },
  'intake-zip-layers': { lane: 'other' },
  'large-original-storage': { lane: 'other' },
});

/** The operation and lane columns the tick's SQL joins, so the lanes are named in one place. */
export function dispatchLaneParameters(): [string[], DispatchLane[]] {
  const rows = Object.entries(DISPATCH_OPERATIONS);
  return [rows.map(([operation]) => operation), rows.map(([, row]) => row.lane)];
}

/** The operations this process runs itself; every other one runs in the processor once it is sent. */
export function dispatchInProcessOperations(): string[] {
  return Object.entries(DISPATCH_OPERATIONS).filter(([, row]) => !row.processor).map(([operation]) => operation);
}

const operationRow = (operation: string) =>
  Object.hasOwn(DISPATCH_OPERATIONS, operation) ? DISPATCH_OPERATIONS[operation] : undefined;

export function dispatchCost(operation: string): Cost {
  const row = operationRow(operation);
  const lane = row?.lane ?? 'other';
  return { lane, mib: row?.mib ?? DISPATCH_LANES[lane].mib };
}

type TablePinned = { sourceBytes?: unknown }
  & Partial<Record<'request' | 'tabular', { selection?: { format?: unknown } }>>;
/** Pinned CSV windows read in place; table profiling and workbooks reserve the original size plus 1 GiB.
 * Missing sizes use the largest original. Undefined when the payload pins no table at `at`. */
function workbookScratchMiB(payload: unknown, at: 'request' | 'tabular'): number | undefined {
  const pinned = payload as TablePinned | null | undefined, pin = pinned?.[at];
  if (!pin) return undefined;
  if (pin.selection?.format === 'csv' && at === 'tabular') return 0;
  const bytes = pinned?.sourceBytes;
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0
    ? Math.ceil(bytes / 1024 ** 2) + 1024 : WORKBOOK_SCRATCH_MIB;
}

/** A job's worst-case MiB under the scratch root: none for a job the processor runs in its container, as it runs any
 * operation no row names; a table read's from its payload; else its row's number or its lane's default. */
export function dispatchScratchMiB({ operation, payload }: DispatchJob): number {
  const row = operationRow(operation);
  if (!row || row.processor) return 0;
  const workbook = row.workbook ? workbookScratchMiB(payload, row.workbook) : undefined;
  return workbook ?? row.scratchMiB ?? DISPATCH_LANES[row.lane].scratchMiB;
}

/** The stated budget, or half of this machine's memory, in MiB. */
export function dispatchMemoryBudgetMiB(stated: number | undefined): number {
  return stated ?? Math.floor(totalmem() / 2 / 1024 ** 2);
}

/** Leave 1 GiB for the API, shared state and allocation overhead outside job reservations. */
export const DISPATCH_HEAP_RESERVE_MIB = 1024;

/** This process's Node heap limit, in MiB, less the reserve for non-job work. */
export function dispatchHeapBudgetMiB(limitMiB = getHeapStatistics().heap_size_limit / 1024 ** 2): number {
  return limitMiB - DISPATCH_HEAP_RESERVE_MIB;
}

/** The free space the scratch budget always leaves on the scratch root. */
export const DISPATCH_SCRATCH_FLOOR_MIB = 2048;
type ReadDisk = (path: string) => Promise<{ bavail: number; bsize: number }>;

/**
 * The scratch root's free MiB less DISPATCH_SCRATCH_FLOOR_MIB, read once a tick. The root is the private scratch the
 * local readers write to (ULPIN_DOCUMENT_OCR_SCRATCH), else the system temp folder. A failed read logs one line and
 * leaves scratch unlimited for that tick, so it never blocks all work.
 */
export async function dispatchScratchBudgetMiB(readDisk: ReadDisk = statfs): Promise<number> {
  try {
    const disk = await readDisk(process.env.ULPIN_DOCUMENT_OCR_SCRATCH || tmpdir());
    return Math.floor(disk.bavail * disk.bsize / 1024 ** 2) - DISPATCH_SCRATCH_FLOOR_MIB;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.warn(`The dispatcher could not read the scratch root's free space (${typeof code === 'string' ? code
      : 'unknown'}); scratch is not limited this tick.`);
    return Infinity;
  }
}

/** How long a job refused for memory or scratch waits before no newer job outside the probe lane may start ahead. */
export const DISPATCH_HEAD_OF_LINE_MS = 120_000;

/** A job as the tick reads it: any operation, created at a database time, with its payload where the tick has it. */
export type DispatchJob = { id: string; operation: string; created_at: Date | string; payload?: unknown };
const createdAt = (job: DispatchJob) => new Date(job.created_at).getTime();
/** State-key handoffs of one item must not occupy multiple vector slots. */
function largeItemId(job: DispatchJob): string | undefined {
  const itemId = (job.payload as { itemId?: unknown } | null)?.itemId;
  return job.operation === 'intake-large' && typeof itemId === 'string' ? itemId : undefined;
}

const dispatchHold = (job: DispatchJob): Hold => {
  const row = operationRow(job.operation);
  return { ...dispatchCost(job.operation), operation: job.operation, scratchMiB: dispatchScratchMiB(job),
    inProcess: row !== undefined && !row.processor, itemId: largeItemId(job) };
};

/** Memory fits what is unreserved, or nothing is held. Scratch fits what is unreserved, or the job writes none, or no
 * held job writes any, so a job larger than the whole scratch budget runs alone among the jobs that write scratch. */
function fits(holding: readonly Hold[], cost: Hold, budgetMiB: number, scratchBudgetMiB: number): boolean {
  const sum = (key: 'mib' | 'scratchMiB') => holding.reduce((total, other) => total + other[key], 0);
  if (holding.length > 0 && sum('mib') + cost.mib > budgetMiB) return false;
  const scratch = sum('scratchMiB');
  return cost.scratchMiB === 0 || scratch === 0 || scratch + cost.scratchMiB <= scratchBudgetMiB;
}

/**
 * The jobs this process runs, each holding its lane slot and its stated memory and scratch until its own finally
 * releases it, and the jobs refused for memory or scratch, each with the time of its first refusal.
 */
export class DispatchReservations {
  private readonly held = new Map<string, Hold>();
  private readonly refused = new Map<string, { since: number; created: number }>();
  private selectable: Set<string> | undefined;

  constructor(private readonly onRelease: () => void = () => {}) {}

  /** Full lanes cannot consume the ready window; processor state reads still bypass this filter. */
  unavailableLanes(elsewhere: readonly DispatchJob[]): DispatchLane[] {
    const outside = elsewhere.filter(job => !this.held.has(job.id)).map(dispatchHold);
    const holding = [...this.held.values(), ...outside];
    return (Object.keys(DISPATCH_LANES) as DispatchLane[]).filter(lane =>
      holding.filter(hold => hold.lane === lane).length >= DISPATCH_LANES[lane].concurrency);
  }

  /** Busy items leave the ready window before LIMIT, not just at admission. */
  unavailableLargeItems(): string[] {
    return [...this.held.values()].flatMap(hold => hold.itemId ? [hold.itemId] : []);
  }

  /**
   * Reserves only when the job's lane is under its concurrency and its memory and scratch fit what is unreserved
   * (see `fits`), counting this process's jobs and the processor's jobs `elsewhere`; a job larger than the whole
   * budget fits when nothing else is held. In-process jobs also fit this process's own in-process holds under its
   * heap budget, or run alone among them. A refused job holds nothing, a job already held is not started twice, and
   * a job outside the probe lane waits behind an older job refused more than DISPATCH_HEAD_OF_LINE_MS ago.
   */
  admit(job: DispatchJob, budgetMiB: number, elsewhere: readonly DispatchJob[], now: number,
    scratchBudgetMiB = Infinity, heapBudgetMiB = Infinity): boolean {
    if (this.held.has(job.id)) return false;
    const cost = dispatchHold(job);
    if (cost.lane !== 'probe' && this.behindRefused(job, now)) return false;
    const outside = elsewhere.filter(other => other.id !== job.id && !this.held.has(other.id));
    const holding = [...this.held.values(), ...outside.map(dispatchHold)];
    if (cost.itemId && holding.some(other => other.itemId === cost.itemId)) return false;
    if (holding.filter(other => other.lane === cost.lane).length >= DISPATCH_LANES[cost.lane].concurrency) return false;
    const inProcess = [...this.held.values()].filter(hold => hold.inProcess);
    const heapFits = !cost.inProcess || inProcess.length === 0
      || inProcess.reduce((total, hold) => total + hold.mib, 0) + cost.mib <= heapBudgetMiB;
    if (!fits(holding, cost, budgetMiB, scratchBudgetMiB) || !heapFits) {
      if (!this.refused.has(job.id)) this.refused.set(job.id, { since: now, created: createdAt(job) });
      return false;
    }
    this.refused.delete(job.id);
    this.held.set(job.id, cost);
    return true;
  }

  release(jobId: string): void {
    if (this.held.delete(jobId)) this.onRelease();
  }

  /** In-flight jobs cannot consume the bounded ready window while their worker still owns them. */
  heldJobIds(): string[] {
    return [...this.held.keys()];
  }

  /** Parallel readers stay selectable; lane, memory, heap and scratch admission still bound their starts. */
  unavailableOperations(): string[] {
    const parallel = ['document-extraction', 'private-mvt', 'streaming-vector', 'streamed-profile',
      'chunk-mapping', 'intake-large', 'intake-run'];
    const singletons = dispatchInProcessOperations().filter(operation => !parallel.includes(operation));
    return [...new Set([...this.held.values()].map(hold => hold.operation))]
      .filter(operation => singletons.includes(operation));
  }

  refusedJobIds(): string[] {
    return [...this.refused.keys()];
  }

  /** Forget finished/cancelled jobs. Only selected refusals may block this cycle; temporarily ineligible jobs
   * (busy item/lane, live lease or retry delay) retain their age without stranding selectable work. */
  keepRefused(waiting: Iterable<string>, selectable?: Iterable<string>): void {
    const still = new Set(waiting);
    for (const jobId of this.refused.keys()) if (!still.has(jobId)) this.refused.delete(jobId);
    this.selectable = selectable === undefined ? undefined : new Set(selectable);
  }

  private behindRefused(job: DispatchJob, now: number): boolean {
    const created = createdAt(job);
    return [...this.refused].some(([jobId, refusal]) => jobId !== job.id
      && (this.selectable === undefined || this.selectable.has(jobId))
      && now - refusal.since > DISPATCH_HEAD_OF_LINE_MS && created > refusal.created);
  }
}
