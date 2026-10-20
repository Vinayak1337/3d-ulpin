import { totalmem } from 'node:os';

/** G22. The lanes of docs/next-steps/INGESTION-ARCHITECTURE.md section 8; an operation no row names is `other`. */
export type DispatchLane = 'probe' | 'vector' | 'table' | 'document' | 'raster' | 'point' | 'model3d' | 'link' | 'gpu'
  | 'teacher' | 'other';
type Cost = { lane: DispatchLane; mib: number };
type OperationRow = { lane: DispatchLane; mib?: number; processor?: true };

/**
 * Each lane's concurrency in one dispatcher process, and the worst-case memory in MiB of a job whose operation states
 * none. A number without a cited source is the lane's conservative default, not a measurement.
 */
export const DISPATCH_LANES: Readonly<Record<DispatchLane, { concurrency: number; mib: number }>> = Object.freeze({
  // Header reads only: INTAKE_PROBE_LIMITS (64 KiB head and tail, 1 MiB directory); the processor inspects 16 MiB.
  probe: { concurrency: 8, mib: 64 },
  vector: { concurrency: 2, mib: 512 },
  table: { concurrency: 2, mib: 256 },
  // docs/evidence/usp/whole-page-ocr-runtime.json: the source OCR worker's peakJobPrivateBytes 975,704,064.
  document: { concurrency: 2, mib: 931 },
  // RASTER_WINDOW_LIMITS.active is 2.
  raster: { concurrency: 2, mib: 1024 },
  // POINT_BATCH_LIMITS.active is 2.
  point: { concurrency: 2, mib: 512 },
  // IFC_LIMITS.active is 2.
  model3d: { concurrency: 2, mib: 512 },
  link: { concurrency: 2, mib: 256 },
  // One GPU. docs/evidence/gf-ai/building/b4-pytorch-resource-20261010/result.json: the roof model's peak working
  // set 1,017,249,792 bytes.
  gpu: { concurrency: 1, mib: 970 },
  teacher: { concurrency: 2, mib: 128 },
  other: { concurrency: 2, mib: 512 },
});

/**
 * Every operation the dispatcher tick can see, its lane, its own worst-case MiB where one is known, and whether the
 * tick hands it to the processor (as it does any operation not named here) rather than running it in this process.
 */
export const DISPATCH_OPERATIONS: Readonly<Record<string, OperationRow>> = Object.freeze({
  inspect: { lane: 'probe', processor: true },
  // docs/evidence/gf1/g16/result.json memoryProof: peakRssMiB 414.9 for 500,000 features in 5000 parts.
  'streaming-vector': { lane: 'vector', mib: 415 },
  // docs/evidence/gf1/lp3a/parts-result.json: peakRssKiB 435,232 cutting the 43 MB NYC GeoJSON into 487 parts.
  'intake-large': { lane: 'vector', mib: 426 },
  'streamed-profile': { lane: 'vector' },
  'projected-vector': { lane: 'vector', processor: true },
  'kml-native': { lane: 'vector' },
  'geoparquet-native': { lane: 'vector' },
  'private-mvt': { lane: 'vector' },
  // A GeoPackage or zipped shapefile converted into GeoJSON layers.
  'intake-native-derivative': { lane: 'vector' },
  // Table windows; a streamed GeoJSON's chunks are mapped by the same job.
  'chunk-mapping': { lane: 'table' },
  'document-extraction': { lane: 'document' },
  'packet-pdf': { lane: 'document' },
  // INTAKE_PAGE_IMAGE_LIMITS.inputPixels 250,000,000 decoded at 4 bytes a pixel.
  'intake-page-image': { lane: 'document', mib: 954 },
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

export function dispatchCost(operation: string): Cost {
  const row = Object.hasOwn(DISPATCH_OPERATIONS, operation) ? DISPATCH_OPERATIONS[operation] : undefined;
  const lane = row?.lane ?? 'other';
  return { lane, mib: row?.mib ?? DISPATCH_LANES[lane].mib };
}

/** The stated budget, or half of this machine's memory, in MiB. */
export function dispatchMemoryBudgetMiB(stated: number | undefined): number {
  return stated ?? Math.floor(totalmem() / 2 / 1024 ** 2);
}

/** How long a job refused for memory waits before no newer job outside the probe lane may start ahead of it. */
export const DISPATCH_HEAD_OF_LINE_MS = 120_000;

/** A job as the tick reads it: any operation, created at a database time. */
export type DispatchJob = { id: string; operation: string; created_at: Date | string };
const createdAt = (job: DispatchJob) => new Date(job.created_at).getTime();

/**
 * The jobs this process runs, each holding its lane slot and its stated memory until its own finally releases it,
 * and the jobs refused for memory, each with the time of its first refusal.
 */
export class DispatchReservations {
  private readonly held = new Map<string, Cost>();
  private readonly refused = new Map<string, { since: number; created: number }>();

  /**
   * Reserves only when the job's lane is under its concurrency and its memory fits what is unreserved, counting this
   * process's jobs and the processor's jobs `elsewhere`; a job larger than the whole budget fits when nothing else is
   * held. A refused job holds nothing, a job already held is not started twice, and a job outside the probe lane
   * waits behind an older job refused for memory more than DISPATCH_HEAD_OF_LINE_MS ago.
   */
  admit(job: DispatchJob, budgetMiB: number, elsewhere: readonly DispatchJob[], now: number): boolean {
    if (this.held.has(job.id)) return false;
    const cost = dispatchCost(job.operation);
    if (cost.lane !== 'probe' && this.behindRefused(job, now)) return false;
    const outside = elsewhere.filter(other => other.id !== job.id && !this.held.has(other.id));
    const holding = [...this.held.values(), ...outside.map(other => dispatchCost(other.operation))];
    if (holding.filter(other => other.lane === cost.lane).length >= DISPATCH_LANES[cost.lane].concurrency) return false;
    if (holding.length > 0 && holding.reduce((sum, other) => sum + other.mib, 0) + cost.mib > budgetMiB) {
      if (!this.refused.has(job.id)) this.refused.set(job.id, { since: now, created: createdAt(job) });
      return false;
    }
    this.refused.delete(job.id);
    this.held.set(job.id, cost);
    return true;
  }

  release(jobId: string): void {
    this.held.delete(jobId);
  }

  refusedJobIds(): string[] {
    return [...this.refused.keys()];
  }

  /** Forgets every refused job that is no longer waiting, so a finished or cancelled job blocks nothing. */
  keepRefused(waiting: Iterable<string>): void {
    const still = new Set(waiting);
    for (const jobId of this.refused.keys()) if (!still.has(jobId)) this.refused.delete(jobId);
  }

  private behindRefused(job: DispatchJob, now: number): boolean {
    const created = createdAt(job);
    return [...this.refused].some(([jobId, refusal]) => jobId !== job.id
      && now - refusal.since > DISPATCH_HEAD_OF_LINE_MS && created > refusal.created);
  }
}
