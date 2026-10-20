import { totalmem } from 'node:os';

/** G22. The lanes of docs/next-steps/INGESTION-ARCHITECTURE.md section 8; an operation no row names is `other`. */
export type DispatchLane = 'probe' | 'vector' | 'table' | 'document' | 'raster' | 'point' | 'model3d' | 'link' | 'gpu'
  | 'teacher' | 'other';
type Cost = { lane: DispatchLane; mib: number };

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

/** Every operation the dispatcher tick can see, its lane, and its own worst-case MiB where one is known. */
export const DISPATCH_OPERATIONS: Readonly<Record<string, { lane: DispatchLane; mib?: number }>> = Object.freeze({
  inspect: { lane: 'probe' },
  // docs/evidence/gf1/g16/result.json memoryProof: peakRssMiB 414.9 for 500,000 features in 5000 parts.
  'streaming-vector': { lane: 'vector', mib: 415 },
  // docs/evidence/gf1/lp3a/parts-result.json: peakRssKiB 435,232 cutting the 43 MB NYC GeoJSON into 487 parts.
  'intake-large': { lane: 'vector', mib: 426 },
  'streamed-profile': { lane: 'vector' },
  'projected-vector': { lane: 'vector' },
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
  build: { lane: 'model3d' },
  'ifc-native': { lane: 'model3d' },
  'dxf-native': { lane: 'model3d' },
  'citygml-native': { lane: 'model3d' },
  'obj-native': { lane: 'model3d' },
  'gltf-native': { lane: 'model3d' },
  'cityjson-native': { lane: 'model3d' },
  'cityjson-validation': { lane: 'model3d' },
  'intake-evidence': { lane: 'link' },
  'intake-run': { lane: 'link' },
  'spatial-inference': { lane: 'gpu' },
  'dataset-spatial-inference': { lane: 'gpu' },
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

export function dispatchCost(operation: string): Cost {
  const row = Object.hasOwn(DISPATCH_OPERATIONS, operation) ? DISPATCH_OPERATIONS[operation] : undefined;
  const lane = row?.lane ?? 'other';
  return { lane, mib: row?.mib ?? DISPATCH_LANES[lane].mib };
}

/** The stated budget, or half of this machine's memory, in MiB. */
export function dispatchMemoryBudgetMiB(stated: number | undefined): number {
  return stated ?? Math.floor(totalmem() / 2 / 1024 ** 2);
}

/** The jobs this process runs, each holding its lane slot and its stated memory until its own finally releases it. */
export class DispatchReservations {
  private readonly held = new Map<string, Cost>();

  /**
   * Reserves only when the job's lane is under its concurrency and its memory fits what is unreserved; a job larger
   * than the whole budget fits when nothing else runs. A refused job holds nothing, and a job already held is not
   * started twice.
   */
  admit(jobId: string, operation: string, budgetMiB: number): boolean {
    if (this.held.has(jobId)) return false;
    const cost = dispatchCost(operation);
    let reserved = 0;
    let inLane = 0;
    for (const held of this.held.values()) {
      reserved += held.mib;
      if (held.lane === cost.lane) inLane++;
    }
    if (inLane >= DISPATCH_LANES[cost.lane].concurrency) return false;
    if (this.held.size > 0 && reserved + cost.mib > budgetMiB) return false;
    this.held.set(jobId, cost);
    return true;
  }

  release(jobId: string): void {
    this.held.delete(jobId);
  }
}
