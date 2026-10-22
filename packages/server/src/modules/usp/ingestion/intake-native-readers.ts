import type { PoolClient } from 'pg';
import {
  CITYGML_LIMITS, CITYJSON_LIMITS, DXF_LIMITS, LargeOriginalEvidenceSchema,
  type CityGMLResult, type CityJSONResult, type DXFResult, type IntakeCard,
} from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import type { IngestionBinding } from './events';
import type { IntakeSourceRow } from './intake-context';
import { writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { dxfSourceTx, insertDXFJobTx } from './dxf';
import { citygmlSourceTx, insertCityGMLJobTx } from './citygml';
import { cityjsonSourceTx, insertCityJSONJobTx } from './cityjson';

type NativeReaderFormat = 'dxf' | 'citygml' | 'cityjson';
type NativeSummary = DXFResult['summary'] | CityGMLResult['summary'] | CityJSONResult['summary'];
type Reader = {
  label: string;
  originalBytes: number;
  queue: (client: PoolClient, source: IntakeSourceRow, jobId: string) => Promise<string>;
};

const readers: Record<NativeReaderFormat, Reader> = {
  dxf: {
    label: 'DXF', originalBytes: DXF_LIMITS.originalBytes,
    queue: async (client, source, jobId) =>
      insertDXFJobTx(client, await dxfSourceTx(client, source.case_id, source.id), jobId),
  },
  citygml: {
    label: 'CityGML', originalBytes: CITYGML_LIMITS.originalBytes,
    queue: async (client, source, jobId) =>
      insertCityGMLJobTx(client, await citygmlSourceTx(client, source.case_id, source.id), jobId),
  },
  cityjson: {
    label: 'CityJSON', originalBytes: CITYJSON_LIMITS.originalBytes,
    queue: async (client, source, jobId) =>
      insertCityJSONJobTx(client, await cityjsonSourceTx(client, source.case_id, source.id), jobId),
  },
};

function nativeFormat(format?: string): format is NativeReaderFormat {
  return format === 'dxf' || format === 'citygml' || format === 'cityjson';
}

/** Both bounded native receipts and /uploads originals keep their existing source authority. */
export function batchNativeReader(source: IntakeSourceRow, card?: IntakeCard): boolean {
  return nativeFormat(card?.format)
    && [ `${card.format}-native-v1`, 'large-original-v1' ].includes(source.profile);
}

/** Same admission as IFC3: a valid private upload receipt plus its probed root card, not a filename. */
export async function assertBatchNativeSourceTx(client: PoolClient, source: IntakeSourceRow,
  binding: IngestionBinding, format: NativeReaderFormat) {
  const reader = readers[format];
  const code = format.toUpperCase();
  const receipt = LargeOriginalEvidenceSchema.safeParse(source.inspection?.largeOriginal);
  const card = (await client.query(`SELECT card FROM usp_intake_items
    WHERE source_id=$1 AND parent_item_id IS NULL`, [source.id])).rows[0]?.card;
  if (!receipt.success || receipt.data.operatorSubject !== binding.subject || card?.format !== format) {
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
  if (!batchNativeReader(source, card) || !nativeFormat(card.format)) return null;
  const reader = readers[card.format];
  const item = (await client.query(`SELECT item_id,case_id,plan_ref FROM usp_intake_items
    WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE`, [source.id])).rows[0];
  if (!item) return null;
  const jobId = intakeNativeReaderJobId(item.item_id, source, card.format);
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
    [jobId, `${card.format}-native`])).rows[0];
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
  const crs = summary.referenceSystemState === 'declared'
    ? 'declared (the summary gives no code)' : summary.referenceSystemState;
  return `The CityJSON reading is ${summary.status}. It states ${summary.objectCount} objects, `
    + `${summary.supportedGeometryCount} supported geometries and ${summary.unsupportedGeometryCount} unsupported `
    + `geometries; they are candidates. Coordinate reference system: ${crs}. Global placement is not qualified.`;
}

/** Only summary literals: no layer/building/surface total or CRS code inferred from an artifact. */
export function intakeNativeReadWords(summary: NativeSummary): string {
  if (summary.schemaVersion === 'dxf-native-inspection/1') return dxfWords(summary) + evidenceWords;
  if (summary.schemaVersion === 'ulpin-native-citygml/1') return citygmlWords(summary) + evidenceWords;
  return cityjsonWords(summary) + evidenceWords;
}

function recordsSeen(summary: NativeSummary): number {
  if (summary.schemaVersion === 'dxf-native-inspection/1') return summary.recordCount;
  if (summary.schemaVersion === 'ulpin-native-citygml/1') return summary.elementCount;
  return summary.objectCount;
}

export type IntakeNativeReaderEnd =
  | { format: 'dxf'; summary: DXFResult['summary'] }
  | { format: 'citygml'; summary: CityGMLResult['summary'] }
  | { format: 'cityjson'; summary: CityJSONResult['summary'] }
  | { format: NativeReaderFormat; status: 'failed' | 'stale'; code: string };

function stoppedWords(end: Extract<IntakeNativeReaderEnd, { status: string }>): string {
  const why = end.status === 'stale' ? 'went out of date: the file, the case or the reader changed' : 'stopped';
  return `The ${readers[end.format].label} reading ${why} (${end.code}), so it is not read. `
    + 'The original is kept with its SHA-256.';
}

/** Called inside the native worker's terminal transaction, after its accepted-attempt fences. */
export async function settleIntakeNativeReaderTx(client: PoolClient, caseId: string, jobId: string,
  end: IntakeNativeReaderEnd) {
  const item = (await client.query(`SELECT item_id FROM usp_intake_items
    WHERE case_id=$1 AND parent_item_id IS NULL AND plan_ref->>'nativeReaderJobId'=$2 AND format=$3 FOR UPDATE`,
  [caseId, jobId, end.format])).rows[0];
  if (!item) return;
  const read = 'summary' in end;
  await writeIntakeDraftTx(client, caseId, item.item_id, {
    state: 'read', placement: read ? 'undecided' : 'not_understood',
    planRef: { nativeReaderJobId: jobId }, recordsSeen: read ? recordsSeen(end.summary) : 0,
    limitReason: read ? intakeNativeReadWords(end.summary) : stoppedWords(end),
  });
}
