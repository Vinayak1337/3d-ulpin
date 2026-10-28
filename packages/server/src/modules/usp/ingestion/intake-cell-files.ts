import { createHash } from 'node:crypto';
import { CELL_DERIVATIVE_RULE, CellDerivativeLineageSchema, LARGE_ORIGINAL_LIMITS, type CellFeatureRange,
  type CellDerivativeLineage, type SourceProfile, type StreamedProfileGeneration,
  type MappingPlan, type StreamedMappingPlan } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { featureCell, featureExtent, measurableCrs, type SourceCrs } from './intake-package-extent';
import type { CellFileRef } from './intake-ledger';
import { stableUuid } from './intake-run';
import { fingerprint } from '../../cases/domain';
import { byteParts, fenced, receiveLargeLayer, type ZipLayerDependencies } from './intake-zip-layers';

type CellProfile = Pick<SourceProfile, 'version' | 'crs' | 'geometryTypes' | 'paths'>
  | Pick<StreamedProfileGeneration, 'version' | 'reference' | 'geometryTypes' | 'paths'>;

/** Compare every child path, not just recipe fields; a byte subset may observe fewer paths and types. */
export function cellProfileContains(child: CellProfile, parent: CellProfile): boolean {
  const crs = (profile: CellProfile) => profile.version === 'manual-geojson/1'
    ? { value: profile.crs.value, unit: profile.crs.unit }
    : { value: profile.reference.sourceCrs, unit: profile.reference.unit };
  const system = crs(parent);
  return Boolean(system.value && system.unit) && fingerprint(crs(child)) === fingerprint(system)
    && child.geometryTypes.every(type => parent.geometryTypes.includes(type))
    && child.paths.every(path => parent.paths.some(current => current.path === path.path
      && path.types.every(type => current.types.includes(type))));
}

/** File/workspace/profile pins differ; only an exact derivative may reuse these layout decisions. */
export function cellLayout(plan: MappingPlan | StreamedMappingPlan) {
  const height = plan.version === 'manual-geojson/1' && plan.heightField
    ? { heightField: plan.heightField, heightUnit: plan.heightUnit, heightMeaning: plan.heightMeaning } : {};
  return { operations: plan.operations, ...(plan.kind === undefined ? {} : { kind: plan.kind }), ...height };
}

export type CellFile = { key: string; ranges: CellFeatureRange[] };
type RangeRead = (start: number, end: number) => Promise<Buffer>;
type Parent = { id: string; revision: number; sha256: string; name: string; case_id: string; itemId: string };
/** CN1: `children` names each retained cell's own case, source and item, so the parent's line can link them. */
export type CellFileResult = {
  files: number; features: number; held: number; heldCells: number; cap: number;
  byteHeld?: number; largeCells?: number; children: CellFileRef[];
};
export type CellFileDependencies = Pick<ZipLayerDependencies, 'transaction' | 'large' | 'register'> & {
  read: RangeRead;
  createCase: (input: { requestKey: string; name: string }) => Promise<{ caseId: string }>;
  putSidecar: (ref: CellDerivativeLineage['members'], chunks: AsyncIterable<Uint8Array>) => Promise<void>;
  beat: () => Promise<void>;
};

/** Only the fold's AREA_BOUND features enter here. Keep ranges, never parsed geometries or original bytes. */
export class CellFileCollector {
  readonly cells = new Map<string, CellFile>();
  readonly heldCells = new Set<string>();
  heldFeatures = 0;
  private readonly crs: SourceCrs | null;

  constructor(metadata: Record<string, unknown>, readonly cap: number = CELL_DERIVATIVE_RULE.cells) {
    this.crs = measurableCrs(metadata);
  }

  add(feature: Record<string, unknown>, range: CellFeatureRange) {
    const extent = this.crs && featureExtent(feature, this.crs);
    if (!extent) conflict('An outside-area feature has no measurable declared system.');
    const { key } = featureCell(extent, range.featureIndex);
    let cell = this.cells.get(key);
    if (!cell && this.cells.size >= this.cap) {
      this.heldCells.add(key);
      this.heldFeatures++;
      return;
    }
    if (!cell) {
      cell = { key, ranges: [] };
      this.cells.set(key, cell);
    }
    cell.ranges.push(range);
  }
}

/** Coalesce ordered original spans into at most 1 MiB reads and verify each exact feature, not its JSON value. */
export async function* readRawFeatureRanges(ranges: readonly CellFeatureRange[], read: RangeRead) {
  for (let first = 0; first < ranges.length;) {
    const start = ranges[first].byteStart;
    let last = first;
    while (last + 1 < ranges.length && ranges[last + 1].byteEnd - start <= 1024 * 1024) last++;
    const bytes = await read(start, ranges[last].byteEnd);
    for (let index = first; index <= last; index++) {
      const range = ranges[index];
      const raw = bytes.subarray(range.byteStart - start, range.byteEnd - start);
      if (raw.length !== range.byteEnd - range.byteStart
        || createHash('sha256').update(raw).digest('hex') !== range.rawSha256) {
        throw new AppError(422, 'CELL_FEATURE_INTEGRITY', 'The original feature differs from its sealed byte range.');
      }
      yield { range, bytes: raw };
    }
    first = last + 1;
  }
}

function collectionStart(metadata: Record<string, unknown>) {
  const envelope: Record<string, unknown> = { type: 'FeatureCollection' };
  if (Object.hasOwn(metadata, 'crs')) envelope.crs = metadata.crs;
  return Buffer.from(`${JSON.stringify(envelope).slice(0, -1)},"features":[`);
}

function cellBytes(cell: CellFile, metadata: Record<string, unknown>) {
  const raw = cell.ranges.reduce((sum, range) => sum + range.byteEnd - range.byteStart, 0);
  return collectionStart(metadata).length + raw + cell.ranges.length - 1 + 2;
}

/** Only the FeatureCollection envelope is new; every Feature is copied byte for byte, with no added member. */
export async function* cellFileChunks(cell: CellFile, metadata: Record<string, unknown>, read: RangeRead) {
  yield collectionStart(metadata);
  let first = true;
  for await (const item of readRawFeatureRanges(cell.ranges, read)) {
    if (!first) yield Buffer.from(',');
    yield item.bytes;
    first = false;
  }
  yield Buffer.from(']}');
}

async function* memberChunks(cell: CellFile) {
  for (const range of cell.ranges) yield Buffer.from(`${JSON.stringify(range)}\n`);
}

async function measure(chunks: AsyncIterable<Uint8Array>) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

function cellName(parent: Parent, key: string) {
  const stem = parent.name.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '');
  const suffix = ` - cell ${key}.geojson`;
  return `${stem.slice(0, 150 - suffix.length)}${suffix}`;
}

async function lineageFor(parent: Parent, cell: CellFile) {
  const measured = await measure(memberChunks(cell));
  // The existing immutable stream writer accepts this private content-addressed key shape only.
  const sidecarId = stableUuid(`cell-feature-ranges/1:${parent.id}:${parent.revision}:${cell.key}`);
  return CellDerivativeLineageSchema.parse({ version: 'cell-derivative/1', parentSourceId: parent.id,
    parentSourceRevision: parent.revision, parentSha256: parent.sha256, parentItemId: parent.itemId,
    parentName: parent.name, cellKey: cell.key, rule: CELL_DERIVATIVE_RULE, features: cell.ranges.length,
    members: { ...measured, format: 'cell-feature-ranges-jsonl/1',
      key: `large-originals/${sidecarId}/${measured.sha256}` } });
}

/** Serialize the lineage lookup and receipt, including a producer whose earlier job lease expired during I/O.
 * No case/source row is held here: the existing receipt takes its own locks and writes lineage atomically. */
async function keepCell(parent: Parent, cell: CellFile, caseId: string, name: string,
  metadata: Record<string, unknown>, dependencies: CellFileDependencies) {
  const lineage = await lineageFor(parent, cell);
  return dependencies.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`cell-derivative/1:${parent.id}:${parent.revision}:${cell.key}`]);
    const prior = (await client.query(`SELECT id FROM sources WHERE case_id=$1
      AND inspection->'cellDerivative' @> $2::jsonb ORDER BY created_at,id LIMIT 1`,
    [caseId, lineage])).rows[0];
    if (prior) return prior.id as string;
    const read = async (start: number, end: number) => {
      await dependencies.beat();
      return dependencies.read(start, end);
    };
    const file = { name, ...await measure(cellFileChunks(cell, metadata, read)) };
    await dependencies.putSidecar(lineage.members, memberChunks(cell));
    await dependencies.beat();
    return fenced(caseId, dependencies, revision => receiveLargeLayer(caseId, { revision }, file,
      byteParts(cellFileChunks(cell, metadata, read)), dependencies, lineage));
  });
}

/** A stable source-case request and lineage lookup make a replay reuse both the case and its retained child. */
export async function retainCellFiles(parent: Parent, collector: CellFileCollector,
  metadata: Record<string, unknown>, dependencies: CellFileDependencies): Promise<CellFileResult> {
  let features = 0, files = 0, byteHeld = 0, largeCells = 0;
  const children: CellFileRef[] = [];
  for (const cell of collector.cells.values()) {
    if (cellBytes(cell, metadata) > LARGE_ORIGINAL_LIMITS.maxOriginalBytes) {
      byteHeld += cell.ranges.length;
      largeCells++;
      continue;
    }
    await dependencies.beat();
    const name = cellName(parent, cell.key);
    const key = stableUuid(`cell-derivative/1:${parent.id}:${parent.revision}:${parent.sha256}:${cell.key}`);
    const { caseId } = await dependencies.createCase({ requestKey: key, name });
    const sourceId = await keepCell(parent, cell, caseId, name, metadata, dependencies);
    await dependencies.beat();
    const registered = await dependencies.register(caseId, { sourceId, requestKey: key });
    // The enrolment's own item, as its batch lists it; one per cell, at most the collector's cap.
    const itemId = (registered as { itemId?: unknown } | null)?.itemId;
    if (typeof itemId !== 'string') conflict('The cell file was enrolled without its batch item.');
    children.push({ cellKey: cell.key, caseId, itemId, sourceId });
    features += cell.ranges.length;
    files++;
  }
  return { files, features, held: collector.heldFeatures + byteHeld,
    heldCells: collector.heldCells.size, cap: collector.cap, ...(largeCells ? { byteHeld, largeCells } : {}),
    children };
}

export function cellFileWords(placed: number, result: CellFileResult) {
  const words = [`${placed} features placed in this file's own area as candidates.`,
    `${result.features} features went to ${result.files} cell files, each its own item in its own batch case.`];
  const capped = result.held - (result.byteHeld ?? 0);
  if (capped) words.push(`${capped} features in ${result.heldCells} additional cells are still held: `
    + `the cell-file limit is ${result.cap}; no bytes were discarded.`);
  if (result.byteHeld) words.push(`${result.byteHeld} features in ${result.largeCells} cells are still held: `
    + `each cell file must fit the ${LARGE_ORIGINAL_LIMITS.maxOriginalBytes / 1024 ** 2} MiB derived-original `
    + 'receipt limit; the original is unchanged.');
  words.push('Every card still needs officer confirmation.');
  return words.join(' ');
}
