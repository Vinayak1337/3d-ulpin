import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DocumentOriginalSchema, RasterOriginalSchema, PointOriginalSchema, LargeOriginalEvidenceSchema,
  IFCOriginalSchema, DXFOriginalSchema, KMLOriginalSchema, CityGMLOriginalSchema, CityJSONOriginalSchema,
  GltfOriginalSchema, ObjOriginalSchema, GeoParquetOriginalSchema } from '@ulpin/contracts/usp';
import { AppError, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding, assertIngestionBinding, type IngestionBinding } from './events';
import type { CellFileRef, OpenCellBatch } from './intake-ledger';

export type IntakeSourceRow = {
  id: string; case_id: string; family_id: string; revision: number; name: string; profile: string;
  bytes: string | number; sha256: string; object_key: string; status: string; inspection: Record<string, any> | null;
};

const originalSchemas: Record<string, z.ZodType> = {
  documentOriginal: DocumentOriginalSchema, rasterOriginal: RasterOriginalSchema, pointOriginal: PointOriginalSchema,
  largeOriginal: LargeOriginalEvidenceSchema, ifcOriginal: IFCOriginalSchema, dxfOriginal: DXFOriginalSchema,
  kmlOriginal: KMLOriginalSchema, citygmlOriginal: CityGMLOriginalSchema, cityjsonOriginal: CityJSONOriginalSchema,
  gltfOriginal: GltfOriginalSchema, objOriginal: ObjOriginalSchema, geoparquetOriginal: GeoParquetOriginalSchema,
};

export async function intakeCaseTx(client: PoolClient, caseId: string, lock = false) {
  const binding = ingestionBinding(caseId);
  const current = (await client.query(`SELECT id,revision,archived FROM cases WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [caseId])).rows[0] ?? notFound('Source case not found.');
  if (current.archived) throw new AppError(403, 'INGESTION_CASE_ARCHIVED', 'The source case is archived.');
  assertIngestionBinding(binding);
  return { current, binding };
}

/** Keep the original receipt's operator/access binding; the ledger does not grant new byte access. */
export function assertIntakeSource(source: IntakeSourceRow, binding: IngestionBinding) {
  const inspection = source.inspection ?? {};
  const originals = Object.entries(inspection).filter(([key]) => /Original$/.test(key));
  const protectedProfile = /-native-v1$/.test(source.profile)
    || ['large-original-v1', 'document-original-v1', 'geotiff-raster-v1', 'laz-point-v1'].includes(source.profile);
  if (protectedProfile && !originals.length) {
    throw new AppError(403, 'INTAKE_SOURCE_DENIED', 'The original receipt authority is missing.');
  }
  for (const [key, original] of originals) {
    const schema = originalSchemas[key];
    if (!schema || !schema.safeParse(original).success) {
      throw new AppError(403, 'INTAKE_SOURCE_DENIED', 'The original receipt authority is invalid or unsupported.');
    }
    const subject = original?.subject ?? original?.operatorSubject;
    if (subject !== binding.subject || original?.accessSha256 && original.accessSha256 !== binding.access) {
      throw new AppError(403, 'INTAKE_SOURCE_DENIED', 'The retained original belongs to another access context.');
    }
    const hash = original?.sha256 ?? original?.verifiedSha256;
    const size = original?.bytes ?? original?.verifiedBytes;
    if (hash !== source.sha256 || Number(size) !== Number(source.bytes)) {
      throw new AppError(422, 'INTAKE_SOURCE_INTEGRITY', 'The original receipt differs from its canonical source.');
    }
  }
  const manual = ['geojson-manual-v1', 'tabular-manual-v1'].includes(source.profile);
  if ((manual || inspection.actor !== undefined) && inspection.actor !== binding.subject) {
    throw new AppError(403, 'INTAKE_SOURCE_DENIED', 'The source belongs to another local context.');
  }
  if (!z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).safeParse(Number(source.bytes)).success
    || !/^[a-f0-9]{64}$/.test(source.sha256) || !source.object_key) {
    throw new AppError(422, 'INTAKE_SOURCE_INTEGRITY', 'The retained source has invalid byte/hash metadata.');
  }
}

export async function intakeSourceTx(client: PoolClient, caseId: string, sourceId: string) {
  const scope = await intakeCaseTx(client, caseId);
  const source: IntakeSourceRow = (await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2',
    [caseId, sourceId])).rows[0] ?? notFound('Retained source not found in this case.');
  assertIntakeSource(source, scope.binding);
  return { ...scope, source };
}

/** Only the receipt keys the authority check reads (`*Original` and `actor`); other inspection facts stay unread. */
const sourceAuthoritySelect = `SELECT id,case_id,family_id,revision,name,profile,bytes,sha256,object_key,status,
  CASE WHEN jsonb_typeof(inspection)='object' THEN (SELECT jsonb_object_agg(entry.key,entry.value)
    FROM jsonb_each(inspection) entry WHERE entry.key LIKE '%Original' OR entry.key='actor')
  ELSE inspection END inspection
  FROM sources`;

/** MF1. Every listed source checked in one read, in the order given, so the first refusal is the one it was. */
export async function assertIntakeSourcesTx(client: PoolClient, caseId: string, binding: IngestionBinding,
  sourceIds: string[]) {
  if (!sourceIds.length) return;
  const rows: IntakeSourceRow[] = (await client.query(
    `${sourceAuthoritySelect} WHERE case_id=$1 AND id=ANY($2::uuid[])`, [caseId, sourceIds])).rows;
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId) ?? notFound('Retained source not found in this case.');
    assertIntakeSource(source, binding);
  }
}

/**
 * CN1. Which of a wide file's cell batches this officer may already open, and each one's current item state.
 * Each child is checked as its own batch read checks it: its case exists and is not archived, and its source's
 * receipt belongs to this officer's access context for that case. Two reads for any number of children; a child
 * that fails any check is left out, so the caller shows only its cell key. Nothing here grants access.
 */
export async function openCellBatchesTx(client: PoolClient, refs: readonly CellFileRef[]) {
  const open = new Map<string, OpenCellBatch>();
  if (!refs.length) return open;
  const items = new Map((await client.query(`SELECT i.item_id,i.case_id,i.source_id,i.state,i.placement,c.archived
    FROM usp_intake_items i JOIN cases c ON c.id=i.case_id
    WHERE i.item_id=ANY($1::uuid[]) AND i.parent_item_id IS NULL`, [refs.map(ref => ref.itemId)])).rows
    .map(row => [row.item_id as string, row]));
  const sources = new Map((await client.query(`${sourceAuthoritySelect} WHERE id=ANY($1::uuid[])`,
    [refs.map(ref => ref.sourceId)])).rows.map((row: IntakeSourceRow) => [row.id, row]));
  for (const ref of refs) {
    const item = items.get(ref.itemId), source = sources.get(ref.sourceId);
    if (!item || item.archived || item.case_id !== ref.caseId || item.source_id !== ref.sourceId
      || source?.case_id !== ref.caseId) continue;
    try {
      const binding = ingestionBinding(ref.caseId);
      assertIntakeSource(source, binding);
      assertIngestionBinding(binding);
    } catch (error) {
      if (error instanceof AppError && error.status < 500) continue;
      throw error;
    }
    open.set(ref.itemId, { state: item.state, placement: item.placement });
  }
  return open;
}

export function intakeSourcePin(source: IntakeSourceRow, binding: IngestionBinding) {
  return fingerprint({ id: source.id, caseId: source.case_id, revision: source.revision, hash: source.sha256,
    bytes: Number(source.bytes), key: source.object_key, profile: source.profile, access: binding.access });
}
