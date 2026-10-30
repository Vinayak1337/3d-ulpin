import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CITYGML_LIMITS, CITYJSON_LIMITS, DXF_LIMITS, GLTF_LIMITS, LargeOriginalEvidenceSchema, OBJ_LIMITS,
  type CityGMLResult, type CityJSONResult, type DXFResult, type GltfResult, type IntakeCard, type ObjResult,
} from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import type { IngestionBinding } from './events';
import { intakeSourceTx, type IntakeSourceRow } from './intake-context';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { dxfSourceTx, insertDXFJobTx } from './dxf';
import { citygmlSourceTx, insertCityGMLJobTx } from './citygml';
import { cityjsonSourceTx, insertCityJSONJobTx } from './cityjson';
import { gltfSourceTx, insertGltfJobTx } from './gltf';
import { insertObjJobTx, objSourceTx } from './obj';

/** The native reader a batch card goes to; NR4: one glTF reader takes both GLB and .gltf cards. */
type NativeReaderFormat = 'dxf' | 'citygml' | 'cityjson' | 'gltf' | 'obj';
type NativeSummary = DXFResult['summary'] | CityGMLResult['summary'] | CityJSONResult['summary']
  | GltfResult['summary'] | ObjResult['summary'];
type Reader = {
  label: string;
  cardFormats: string[];
  originalBytes: number;
  limits: { jobsPerSource: number; active: number };
  queue: (client: PoolClient, source: IntakeSourceRow, jobId: string) => Promise<string>;
};

const readers: Record<NativeReaderFormat, Reader> = {
  dxf: {
    label: 'DXF', cardFormats: ['dxf'], originalBytes: DXF_LIMITS.originalBytes, limits: DXF_LIMITS,
    queue: async (client, source, jobId) =>
      insertDXFJobTx(client, await dxfSourceTx(client, source.case_id, source.id), jobId),
  },
  citygml: {
    label: 'CityGML', cardFormats: ['citygml'], originalBytes: CITYGML_LIMITS.originalBytes, limits: CITYGML_LIMITS,
    queue: async (client, source, jobId) =>
      insertCityGMLJobTx(client, await citygmlSourceTx(client, source.case_id, source.id), jobId),
  },
  cityjson: {
    label: 'CityJSON', cardFormats: ['cityjson'], originalBytes: CITYJSON_LIMITS.originalBytes, limits: CITYJSON_LIMITS,
    queue: async (client, source, jobId) =>
      insertCityJSONJobTx(client, await cityjsonSourceTx(client, source.case_id, source.id), jobId),
  },
  gltf: {
    label: 'glTF', cardFormats: ['glb', 'gltf'], originalBytes: GLTF_LIMITS.originalBytes, limits: GLTF_LIMITS,
    queue: async (client, source, jobId) =>
      insertGltfJobTx(client, await gltfSourceTx(client, source.case_id, source.id), jobId),
  },
  obj: {
    label: 'OBJ', cardFormats: ['obj'], originalBytes: OBJ_LIMITS.originalBytes, limits: OBJ_LIMITS,
    queue: async (client, source, jobId) =>
      insertObjJobTx(client, await objSourceTx(client, source.case_id, source.id), jobId),
  },
};

/** The reader that takes a probed card format, or null when no native reader does. */
function nativeReaderOf(cardFormat?: string): NativeReaderFormat | null {
  const found = Object.entries(readers).find(([, reader]) => reader.cardFormats.includes(cardFormat ?? ''));
  return found ? found[0] as NativeReaderFormat : null;
}

/** Both bounded native receipts and /uploads originals keep their existing source authority. */
export function batchNativeReader(source: IntakeSourceRow, card?: IntakeCard): boolean {
  const format = nativeReaderOf(card?.format);
  return format !== null && [`${format}-native-v1`, 'large-original-v1'].includes(source.profile);
}

/** Same admission as IFC3: a valid private upload receipt plus its probed root card, not a filename. */
export async function assertBatchNativeSourceTx(client: PoolClient, source: IntakeSourceRow,
  binding: IngestionBinding, format: NativeReaderFormat) {
  const reader = readers[format];
  const code = format.toUpperCase();
  const receipt = LargeOriginalEvidenceSchema.safeParse(source.inspection?.largeOriginal);
  const card = (await client.query(`SELECT card FROM usp_intake_items
    WHERE source_id=$1 AND parent_item_id IS NULL`, [source.id])).rows[0]?.card;
  if (!receipt.success || receipt.data.operatorSubject !== binding.subject || nativeReaderOf(card?.format) !== format) {
    throw new AppError(403, `${code}_DENIED`,
      `This retained ${reader.label} is unavailable to the current local context.`);
  }
  if (receipt.data.verifiedSha256 !== source.sha256 || receipt.data.verifiedBytes !== Number(source.bytes)
    || source.object_key !== `large-originals/${source.id}/${source.sha256}`) {
    throw new AppError(422, `${code}_SOURCE_INTEGRITY`,
      `The ${reader.label} receipt differs from its canonical source.`);
  }
  if (Number(source.bytes) > reader.originalBytes) {
    throw new AppError(413, `${code}_ORIGINAL_SIZE`,
      `The ${reader.label} reader takes an original of at most ${mib(reader.originalBytes)} MiB.`);
  }
}

/** An item/source revision always replays the same reader job. */
export function intakeNativeReaderJobId(itemId: string, source: IntakeSourceRow, format: NativeReaderFormat): string {
  return stableUuid(`intake-native-reader/1:${format}:${itemId}:${source.id}:${source.revision}:${source.sha256}`);
}

const mib = (bytes: number) => bytes / 1024 ** 2;

function aboveLimitWords(reader: Reader, bytes: number): string {
  return `This ${reader.label} has ${mib(bytes).toFixed(1)} MiB, above the ${mib(reader.originalBytes)} MiB limit `
    + `of the ${reader.label} reader, so it is not read. The original is kept with its SHA-256.`;
}

/** Queue through the native reader's own source pins and insert; no package, target or geometry is created. */
export async function queueIntakeNativeReaderTx(client: PoolClient, source: IntakeSourceRow,
  card: IntakeCard): Promise<string | null> {
  const format = nativeReaderOf(card.format);
  if (!batchNativeReader(source, card) || !format) return null;
  const reader = readers[format];
  const item = (await client.query(`SELECT item_id,case_id,plan_ref FROM usp_intake_items
    WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE`, [source.id])).rows[0];
  if (!item) return null;
  const jobId = intakeNativeReaderJobId(item.item_id, source, format);
  if (item.plan_ref?.nativeReaderJobId === jobId) return jobId;
  if (item.plan_ref) return null;
  if (Number(source.bytes) > reader.originalBytes) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'not_understood', planRef: null, recordsSeen: 0,
      limitReason: aboveLimitWords(reader, Number(source.bytes)),
    });
    return null;
  }
  const queued = (await client.query('SELECT id FROM jobs WHERE id=$1 AND operation=$2',
    [jobId, `${format}-native`])).rows[0];
  if (!queued) await reader.queue(client, source, jobId);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, {
    state: 'reading', placement: 'undecided', planRef: { nativeReaderJobId: jobId },
    recordsSeen: 0, limitReason: null,
  });
  return jobId;
}

const evidenceWords = ' The reading is kept as evidence and is not on the map yet; '
  + 'no record or card target is created.';

function dxfWords(summary: DXFResult['summary']): string {
  const units = summary.units;
  const unitWords = units.state === 'declared'
    ? `declared (${units.name ?? 'name unknown'}, code ${units.code ?? 'unknown'})`
    : units.state;
  return `The DXF reading states ${summary.recordCount} records and ${summary.projectedEntityCount} projected `
    + `entities; they are candidates. Drawing units: ${unitWords}. `
    + `${summary.unsupportedFindingCount} unsupported findings. This summary states no coordinate reference system.`;
}

function citygmlWords(summary: CityGMLResult['summary']): string {
  const findings = summary.findingCodes.length ? ` Findings: ${summary.findingCodes.join(', ')}.` : '';
  return `The CityGML reading is ${summary.status}. It states ${summary.buildingAndPartCount} building/part entries `
    + `and ${summary.elementCount} elements; they are candidates. ${summary.unsupportedElementCount} unsupported `
    + `elements and ${summary.unresolvedReferenceCount} unresolved references.${findings} `
    + 'This summary states no coordinate reference system.';
}

function cityjsonWords(summary: CityJSONResult['summary']): string {
  const state = summary.referenceSystemState;
  const crs = state === 'declared' ? 'declared (the summary gives no code)'
    : `${state}, so its building outlines stay unplaced`;
  const status = summary.status === 'supported' ? 'supported' : 'partial: some geometry is unsupported';
  return `The CityJSON reading is ${status}. It states ${summary.objectCount} objects, `
    + `${summary.supportedGeometryCount} supported geometries and ${summary.unsupportedGeometryCount} unsupported `
    + `geometries; they are candidates. Coordinate reference system: ${crs}. Global placement is not qualified.`;
}

const meshStatus = (status: 'inspected_local' | 'inspected_partial') =>
  status === 'inspected_local' ? 'complete' : 'partial';
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

type GltfSummary = GltfResult['summary'];
type ObjSummary = ObjResult['summary'];
// Keyed by the contract's own value types, so a value added there fails here until it has words. The readers
// state none of these today: each contract value is 'unknown', and its words say only that the file does not state it.
const gltfPlacementWords: Record<GltfSummary['globalPlacement'], string> = { unknown: 'not stated' };
const objAxesWords: Record<ObjSummary['axes'], string> = { unknown: 'not stated' };
const objUnitsWords: Record<ObjSummary['units'], string> = { unknown: 'not stated' };
const objCrsWords: Record<ObjSummary['crs'], string> = { unknown: 'not stated, so the model stays unplaced' };

const refusalWords: Record<string, string> = {
  EXTERNAL_URI_NOT_PLAIN_NAME: 'not a plain file name beside the glTF',
  COMPANION_AMBIGUOUS: 'several kept files have this name',
  COMPANION_SHORTER_THAN_BYTE_LENGTH: 'the file is shorter than the buffer it must hold',
  BYTE_BUDGET: 'the glTF and its files would pass the 16 MiB reading limit',
  COMPANION_ACCESS: 'the file belongs to another access context',
};
const cut = (name: string) => JSON.stringify(name.length > 40 ? `${name.slice(0, 37)}...` : name);
/** At most four names, each cut to 40 characters, so the item line stays inside its 2,000-character bound. */
function names(shown: string[], total: number): string {
  if (!total || !shown.length) return '';
  const more = total - Math.min(shown.length, 4);
  return ` (${shown.slice(0, 4).join(', ')}${more > 0 ? ` and ${more} more` : ''})`;
}

/** GB1: which companion files were joined by name, which are still missing, and which were refused and why. */
function companionWords(summary: GltfSummary): string {
  if (!summary.companions) return `companion files named but not supplied: ${summary.missingCompanionCount}`;
  const of = (state: string) => summary.companions!.filter(companion => companion.state === state);
  const joined = of('joined').map(companion => cut(companion.name));
  const missing = of('missing').map(companion => cut(companion.name));
  const refused = of('refused').map(companion =>
    `${cut(companion.name)}: ${refusalWords[companion.reason ?? ''] ?? 'refused'}`);
  const joinedCount = summary.joinedCompanionCount ?? joined.length;
  const refusedCount = summary.refusedCompanionCount ?? refused.length;
  return `companion files joined: ${joinedCount}${names(joined, joinedCount)}; `
    + `still missing: ${summary.missingCompanionCount}${names(missing, summary.missingCompanionCount)}`
    + (refusedCount ? `; refused: ${refusedCount}${names(refused, refusedCount)}` : '');
}

/** A glTF has no coordinate reference system field: its positions are local to the model. */
function gltfWords(summary: GltfSummary): string {
  return `The glTF reading is ${meshStatus(summary.status)}. It states ${counted(summary.nodeCount, 'node')} and `
    + `${counted(summary.primitiveCount, 'mesh primitive')}; they are candidates. `
    + `Positions read: ${summary.projectedPositions}; ${companionWords(summary)}; `
    + `unsupported primitives: ${summary.unsupportedPrimitiveCount}. `
    + `Placement on the earth: ${gltfPlacementWords[summary.globalPlacement]}. `
    + 'A glTF states no coordinate reference system, so the model stays unplaced.';
}

function objWords(summary: ObjSummary): string {
  return `The OBJ reading is ${meshStatus(summary.status)}. It states ${summary.vertexCount} vertices and `
    + `${counted(summary.polygonCount, 'polygon')}; they are candidates. Unsupported statements: `
    + `${summary.unsupportedStatementCount}; companion declarations not supplied: `
    + `${summary.missingCompanionDeclarationCount}. `
    + `Axes: ${objAxesWords[summary.axes]}; units: ${objUnitsWords[summary.units]}; `
    + `coordinate reference system: ${objCrsWords[summary.crs]}.`;
}

function summaryWords(summary: NativeSummary): string {
  if ('dxfVersion' in summary) return dxfWords(summary);
  if (summary.schemaVersion === 'ulpin-native-citygml/1') return citygmlWords(summary);
  if (summary.schemaVersion === 'gltf-local-inspection/1') return gltfWords(summary);
  if (summary.schemaVersion === 'obj-source-context/1') return objWords(summary);
  return cityjsonWords(summary);
}

/** Only summary literals: no layer/building/surface total or CRS code inferred from an artifact. */
export function intakeNativeReadWords(summary: NativeSummary): string {
  return summaryWords(summary) + evidenceWords;
}

function recordsSeen(summary: NativeSummary): number {
  if ('dxfVersion' in summary) return summary.recordCount;
  if (summary.schemaVersion === 'ulpin-native-citygml/1') return summary.elementCount;
  if (summary.schemaVersion === 'gltf-local-inspection/1') return summary.nodeCount;
  if (summary.schemaVersion === 'obj-source-context/1') return summary.polygonCount;
  return summary.objectCount;
}

export type IntakeNativeReaderEnd =
  | { format: 'dxf'; summary: DXFResult['summary'] }
  | { format: 'citygml'; summary: CityGMLResult['summary'] }
  | { format: 'cityjson'; summary: CityJSONResult['summary'] }
  | { format: 'gltf'; summary: GltfResult['summary'] }
  | { format: 'obj'; summary: ObjResult['summary'] }
  | { format: NativeReaderFormat; status: 'failed' | 'stale'; code: string };

function stoppedWords(end: Extract<IntakeNativeReaderEnd, { status: string }>): string {
  if (end.format === 'dxf' && end.status === 'failed') {
    let limit: string | undefined;
    if (end.code === 'DXF_ENTITY_LIMIT') {
      limit = `${DXF_LIMITS.entities.toLocaleString('en-IN')} entities including children`;
    }
    if (end.code === 'DXF_OUTPUT_LIMIT') {
      limit = `${DXF_LIMITS.pages} pages of ${mib(DXF_LIMITS.pageBytes)} MiB `
        + `or a ${mib(DXF_LIMITS.artifactBytes)} MiB head`;
    }
    if (limit) return `The DXF reading exceeds its limit of ${limit}, so it is not read. `
      + 'The original is kept with its SHA-256.';
  }
  const why = end.status === 'stale' ? 'went out of date: the file, the case or the reader changed' : 'stopped';
  return `The ${readers[end.format].label} reading ${why} (${end.code}), so it is not read. `
    + 'The original is kept with its SHA-256.';
}

/**
 * CityJSON with a declared system and accepted CityGML readings take the ground-outline derivative job.
 * CityGML inventory overflow also takes it: Python reads outlines directly from the unchanged original.
 * The CityGML summary has no system field: its converter checks each geometry's literal/envelope declaration.
 * Only placed outlines take the GeoJSON map path; the officer still confirms every card.
 */
export function outlinesConverted(end: IntakeNativeReaderEnd): boolean {
  if (!('summary' in end)) {
    return end.format === 'citygml' && end.status === 'failed' && end.code === 'CITYGML_OUTPUT_LIMIT';
  }
  if (end.format === 'citygml') return true;
  return end.format === 'cityjson' && end.summary.referenceSystemState === 'declared';
}

type NativeReaderItem = {
  item_id: string; source_id: string; card: IntakeCard; plan_ref: Record<string, unknown> | null;
};

/** Re-pin only the unchanged original; the reader still constructs and enforces every current pin. */
async function queueRepinnedReaderTx(client: PoolClient, caseId: string, jobId: string,
  item: NativeReaderItem, format: NativeReaderFormat): Promise<string | null> {
  const { source } = await intakeSourceTx(client, caseId, item.source_id);
  const pinned = (await client.query(`SELECT payload FROM jobs
    WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation=$4`,
  [jobId, caseId, source.id, `${format}-native`])).rows[0]?.payload;
  if (!pinned || pinned.sourceId !== source.id || pinned.sourceFamilyId !== source.family_id
    || pinned.sourceRevision !== source.revision || pinned.sourceSha256 !== source.sha256) return null;
  // The table uses insert functions, so apply the reader's normal admission limits before inserting a retry.
  const counts = (await client.query(`SELECT count(*) FILTER (WHERE source_id=$2)::int history,
    count(*) FILTER (WHERE status IN ('queued','running'))::int active FROM jobs WHERE operation=$1`,
  [`${format}-native`, source.id])).rows[0];
  const reader = readers[format];
  if (counts.history >= reader.limits.jobsPerSource || counts.active >= reader.limits.active) return null;
  return reader.queue(client, source, randomUUID());
}

/** A refused retry must not roll back the worker's terminal bookkeeping or spend another re-pin. */
async function repinIntakeNativeReaderTx(client: PoolClient, caseId: string, jobId: string,
  item: NativeReaderItem, format: NativeReaderFormat): Promise<boolean> {
  const repins = item.plan_ref?.nativeReaderRepins ?? 0;
  if (typeof repins !== 'number' || !Number.isInteger(repins) || repins < 0 || repins >= 2) return false;
  await client.query('SAVEPOINT intake_native_repin');
  try {
    const nextJobId = await queueRepinnedReaderTx(client, caseId, jobId, item, format);
    if (!nextJobId) return false;
    await writeIntakeDraftTx(client, caseId, item.item_id, {
      state: 'reading', placement: 'undecided', recordsSeen: 0, limitReason: null,
      planRef: { ...item.plan_ref, nativeReaderJobId: nextJobId, nativeReaderRepins: repins + 1 },
    });
    return true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await client.query('ROLLBACK TO SAVEPOINT intake_native_repin');
    return false;
  } finally {
    await client.query('RELEASE SAVEPOINT intake_native_repin');
  }
}

/** Called inside the native worker's terminal transaction, after its accepted-attempt fences. */
export async function settleIntakeNativeReaderTx(client: PoolClient, caseId: string, jobId: string,
  end: IntakeNativeReaderEnd) {
  const item = (await client.query<Omit<NativeReaderItem, 'plan_ref'>>(
    `SELECT item_id,source_id,card FROM usp_intake_items
    WHERE case_id=$1 AND parent_item_id IS NULL AND plan_ref->>'nativeReaderJobId'=$2 AND format=ANY($3)
    FOR UPDATE`, [caseId, jobId, readers[end.format].cardFormats])).rows[0];
  if (!item) return;
  if (outlinesConverted(end)) {
    const { queueNativeDerivativeTx } = await import('./intake-native-derivative');
    const { source } = await intakeSourceTx(client, caseId, item.source_id);
    await queueNativeDerivativeTx(client, source, item.card);
    return;
  }
  const { planRef } = await readIntakeDraftTx(client, caseId, item.item_id);
  if ('status' in end && end.status === 'stale'
    && await repinIntakeNativeReaderTx(client, caseId, jobId, { ...item, plan_ref: planRef }, end.format)) return;
  const read = 'summary' in end;
  await writeIntakeDraftTx(client, caseId, item.item_id, {
    state: 'read', placement: read ? 'undecided' : 'not_understood',
    planRef: { ...planRef, nativeReaderJobId: jobId }, recordsSeen: read ? recordsSeen(end.summary) : 0,
    limitReason: read ? intakeNativeReadWords(end.summary) : stoppedWords(end),
  });
}
