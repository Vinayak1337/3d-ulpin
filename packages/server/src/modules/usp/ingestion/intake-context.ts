import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DocumentOriginalSchema, RasterOriginalSchema, PointOriginalSchema, LargeOriginalEvidenceSchema,
  IFCOriginalSchema, DXFOriginalSchema, KMLOriginalSchema, CityGMLOriginalSchema, CityJSONOriginalSchema,
  GltfOriginalSchema, ObjOriginalSchema, GeoParquetOriginalSchema } from '@ulpin/contracts/usp';
import { AppError, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding, assertIngestionBinding, type IngestionBinding } from './events';

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
  FROM sources WHERE case_id=$1 AND id=ANY($2::uuid[])`;

/** MF1. Every listed source checked in one read, in the order given, so the first refusal is the one it was. */
export async function assertIntakeSourcesTx(client: PoolClient, caseId: string, binding: IngestionBinding,
  sourceIds: string[]) {
  if (!sourceIds.length) return;
  const rows: IntakeSourceRow[] = (await client.query(sourceAuthoritySelect, [caseId, sourceIds])).rows;
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId) ?? notFound('Retained source not found in this case.');
    assertIntakeSource(source, binding);
  }
}

export function intakeSourcePin(source: IntakeSourceRow, binding: IngestionBinding) {
  return fingerprint({ id: source.id, caseId: source.case_id, revision: source.revision, hash: source.sha256,
    bytes: Number(source.bytes), key: source.object_key, profile: source.profile, access: binding.access });
}
