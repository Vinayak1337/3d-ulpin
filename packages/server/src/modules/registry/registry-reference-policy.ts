import type { PoolClient } from 'pg';
import { AppError } from '../../infrastructure/errors';
import { assertIntakeSource, type IntakeSourceRow } from '../usp/ingestion/intake-context';
import type { IngestionBinding } from '../usp/ingestion/events';
import { isRetainedMapOriginal } from '../usp/ingestion/retained-map-original';
import { NativeRecordReferenceSchema } from '@ulpin/contracts';

/** A kept table is citable only after this operator accepted a row at its exact original pins.
 * Confirmation expiry fences new citation writes, not reads of evidence already recorded. */
export async function permitsConfirmedRetainedTableSourceTx(client: PoolClient, source: IntakeSourceRow,
  binding: IngestionBinding): Promise<boolean> {
  if (source.profile !== 'large-original-v1' || source.status !== 'needs_input') return false;
  assertIntakeSource(source, binding);
  if (source.object_key !== `large-originals/${source.id}/${source.sha256}`
    || !source.inspection?.largeOriginal?.objectEtag) {
    throw new AppError(422, 'INTAKE_SOURCE_INTEGRITY', 'The retained original key differs from its byte receipt.');
  }
  const sourcePin = { sourceId: source.id, sourceRevision: source.revision, sourceSha256: source.sha256 };
  const included = [{ ...sourcePin, bytes: Number(source.bytes) }];
  const decisions = [{ decision: 'accept', evidence: { kind: 'table_row', caseId: source.case_id, ...sourcePin } }];
  return (await client.query(`SELECT 1 FROM usp_intake_evidence_confirmations
    WHERE case_id=$1 AND subject=$2 AND additions='citations' AND pins->'included' @> $3::jsonb
    AND pins->'additions'->'decisions' @> $4::jsonb LIMIT 1`,
  [source.case_id, binding.subject, JSON.stringify(included), JSON.stringify(decisions)])).rows.length > 0;
}

/** Native reference documents may evidence a manually reviewed party/use claim,
 * never coordinates or verified levels. The caller also checks site membership
 * and existence of the exact retained document part. */
export function permitsReferenceRightSource(source: {
  status?: string;
  profile?: string;
  inspection?: { status?: string; partCount?: number } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "right" && source.status === "inspected" &&
    ["text-reference-v2", "pdf-reference-v2", "docx-reference-v2"].includes(source.profile || "") &&
    source.inspection?.status === "reference_only" &&
    Number.isInteger(source.inspection.partCount) && Number(source.inspection.partCount) > 0;
}

/** A reviewed record may cite a native text/CSV part without claiming geometry or rights. */
export function permitsReferenceRecordSource(source: {
  status?: string;
  profile?: string;
  inspection?: { status?: string; partCount?: number } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "record" && source.status === "inspected" &&
    ["text-reference-v2", "csv-reference-v2"].includes(source.profile || "") &&
    source.inspection?.status === "reference_only" &&
    Number.isInteger(source.inspection.partCount) && (source.inspection.partCount ?? 0) > 0;
}

/** Native citation eligibility is narrower than record admission: older observations remain non-citable. */
export function permitsDecodedFeatureCitation(source: Parameters<typeof permitsFeatureRecordSource>[0],
  reference: unknown): boolean {
  const parsed = NativeRecordReferenceSchema.safeParse(reference);
  return parsed.success && permitsFeatureRecordSource(source, 'record')
    && source.profile === `${parsed.data.format}-area-v2`;
}

/** Record-only map receipt admission; the caller separately proves its committed, same-site observation. */
export function permitsFeatureRecordSource(source: {
  status?: string;
  profile?: string;
  sha256?: string;
  inspection?: { status?: string; manualProfile?: unknown; gis?: unknown } | null;
}, purpose: "record" | "geometry" | "right"): boolean {
  return purpose === "record" && (isRetainedMapOriginal(source) || source.status === "inspected" &&
    source.inspection?.status === "interpreted" &&
    ["geojson-area-v2", "arcgis-area-v2", "gpkg-area-v2", "shapefile_zip-area-v2"].includes(source.profile || ""));
}
