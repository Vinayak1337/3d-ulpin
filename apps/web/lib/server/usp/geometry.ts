import type { PoolClient } from 'pg';
import {
  DataSufficiencyVerdictSchema, UspGeometryMetadataSchema, UspGeometryProjectionSchema,
  type TargetPin, type UspGeometryMetadata, type UspGeometryProjection,
} from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { AppError } from '../errors';
import { canonical } from '../domain';

export const USP_ANALYTICAL_ROLES = Object.freeze({
  FIND: 'ulpin_usp_find', READY: 'ulpin_usp_ready', PACK: 'ulpin_usp_pack', export: 'ulpin_usp_export',
});
export type UspAnalyticalPurpose = keyof typeof USP_ANALYTICAL_ROLES;
const pinKey = (pin: TargetPin) => `${pin.ref.namespace}:${pin.ref.id}@${pin.revision}`;

/** SQL capability scope ends with the transaction; no role state leaks into the pooled connection. */
export async function withUspAnalyticalReader<T>(purpose: UspAnalyticalPurpose, read: (client: PoolClient) => Promise<T>) {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return withUspAnalyticalReaderTx(client, purpose, read);
  });
}
export async function withUspAnalyticalReaderTx<T>(client: PoolClient, purpose: UspAnalyticalPurpose,
  read: (client: PoolClient) => Promise<T>) {
  const role = USP_ANALYTICAL_ROLES[purpose];
  if (!role) throw new AppError(403, 'USP_ANALYTICAL_PURPOSE', 'An analytical purpose is required.');
  const previous = (await client.query("SELECT current_setting('role') AS role")).rows[0].role;
  await client.query("SELECT set_config('role',$1,true)", [role]);
  try { return await read(client); }
  finally { await client.query("SELECT set_config('role',$1,true)", [previous]).catch(() => {}); }
}

/** Every analytical consumer uses this one SQL predicate, including legacy adapters. */
export async function qualifiedGeometryPins(purpose: UspAnalyticalPurpose, pins: readonly TargetPin[], client?: PoolClient) {
  if (pins.length > 10000) throw new AppError(413, 'USP_GEOMETRY_SCOPE', 'Select a smaller analytical scope.');
  if (!pins.length) return new Set<string>();
  const read = async (reader: PoolClient) => (await reader.query(
    `SELECT v.namespace,v.id,v.revision FROM usp_analytic_geometry v
     JOIN jsonb_to_recordset($1::jsonb) p(namespace text,id text,revision integer)
       ON p.namespace=v.namespace AND p.id=v.id::text AND p.revision=v.revision`,
    [JSON.stringify(pins.map(pin => ({ namespace: pin.ref.namespace, id: pin.ref.id, revision: pin.revision })))],
  )).rows;
  const rows = client ? await withUspAnalyticalReaderTx(client, purpose, read) : await withUspAnalyticalReader(purpose, read);
  return new Set(rows.map(row => `${row.namespace}:${row.id}@${row.revision}`));
}
export async function requireQualifiedGeometry(purpose: UspAnalyticalPurpose, pins: readonly TargetPin[], client?: PoolClient) {
  const qualified = await qualifiedGeometryPins(purpose, pins, client);
  if (pins.some(pin => !qualified.has(pinKey(pin)))) {
    throw new AppError(422, 'USP_GEOMETRY_NOT_QUALIFIED',
      'Spatial analysis is not assessed: exact geometry, source and reference qualification is unavailable. Original records remain inspectable.');
  }
}
export function geometryPin(namespace: 'registry_record' | 'area_feature', value: { id: string; revision: number }): TargetPin {
  return { ref: { namespace, id: value.id }, revision: value.revision };
}
export function isQualifiedPin(qualified: ReadonlySet<string>, pin: TargetPin) { return qualified.has(pinKey(pin)); }

export function geometryProjection(target: TargetPin, metadata: unknown, qualificationRevision: number | null,
  eligible: boolean): UspGeometryProjection {
  const parsed = UspGeometryMetadataSchema.safeParse(metadata);
  const qualified = eligible && qualificationRevision !== null && parsed.success && parsed.data.analyticEligible;
  const effectiveMetadata = parsed.success ? (parsed.data.analyticEligible && !qualified
    ? { ...parsed.data, analyticEligible: false,
      qualification: { state: 'unqualified', reasons: ['current_qualification_unavailable'] } }
    : parsed.data) : null;
  return UspGeometryProjectionSchema.parse({ target,
    metadata: effectiveMetadata, qualificationRevision,
    sufficiency: DataSufficiencyVerdictSchema.parse({ task: 'spatial_analysis',
      requirements: ['canonical_revision', 'source_integrity', 'geometry_qualification'],
      outcome: qualified ? 'sufficient' : 'insufficient_for_spatial_reconstruction',
      missing: qualified ? [] : ['source_integrity', 'geometry_qualification'],
    }),
  });
}

/** Called by a future qualified processor in its existing same-client command transaction.
 * SQL requires the accepted qualify_geometry receipt; no label or client request can create eligibility. */
export async function recordGeometryQualificationTx(client: PoolClient, target: TargetPin,
  revision: number, metadata: UspGeometryMetadata) {
  const value = UspGeometryMetadataSchema.parse(metadata);
  if (value.geometryClass === 'illustrative') throw new AppError(422, 'USP_DISPLAY_ONLY', 'Illustrative geometry belongs only in the display store.');
  const table = target.ref.namespace === 'registry_record' ? 'registry_records'
    : target.ref.namespace === 'area_feature' ? 'physical_features' : null;
  if (!table || target.revision < 1) throw new AppError(422, 'USP_GEOMETRY_TARGET', 'Choose an existing canonical geometry revision.');
  const row = (await client.query(`SELECT encode(sha256(convert_to(body::text,'UTF8')),'hex') AS hash
    FROM ${table} WHERE id=$1 AND revision=$2 FOR SHARE`, [target.ref.id, target.revision])).rows[0];
  if (!row) throw new AppError(409, 'USP_GEOMETRY_STALE', 'The canonical geometry revision changed.');
  await client.query(`INSERT INTO usp_geometry_qualifications(namespace,record_id,record_revision,revision,target_body_sha256,body)
    VALUES($1,$2,$3,$4,$5,$6)`, [target.ref.namespace,target.ref.id,target.revision,revision,row.hash,value]);
}

/** Caller payloads cannot reuse a qualified ID/revision while changing the geometry or its inputs. */
export function sameCanonicalGeometryPayload(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  const stripEnvelope = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id','siteId','identifier','revision'].includes(key)));
  return canonical(stripEnvelope(expected)) === canonical(stripEnvelope(actual));
}
export async function qualifiedGeometryRecordPins(purpose: UspAnalyticalPurpose,
  namespace: 'registry_record' | 'area_feature', records: readonly { id: string; revision: number }[], client?: PoolClient) {
  if (records.length > 10000) throw new AppError(413,'USP_GEOMETRY_SCOPE','Select a smaller analytical scope.');
  if (!records.length) return new Set<string>();
  const read=async (reader:PoolClient)=>(await reader.query(`SELECT id,revision,body FROM usp_analytic_geometry
    WHERE namespace=$1 AND id=ANY($2::uuid[])`,[namespace,records.map(record=>record.id)])).rows;
  const rows=client?await withUspAnalyticalReaderTx(client,purpose,read):await withUspAnalyticalReader(purpose,read);
  return new Set(records.filter(record=>{
    const row=rows.find(row=>row.id===record.id && row.revision===record.revision);
    return row && sameCanonicalGeometryPayload(row.body,record as Record<string,unknown>);
  }).map(record=>pinKey(geometryPin(namespace,record))));
}
export async function requireQualifiedGeometryRecords(purpose: UspAnalyticalPurpose,
  namespace: 'registry_record' | 'area_feature', records: readonly { id: string; revision: number }[], client?: PoolClient) {
  const qualified=await qualifiedGeometryRecordPins(purpose,namespace,records,client);
  if(records.some(record=>!qualified.has(pinKey(geometryPin(namespace,record)))))
    throw new AppError(422,'USP_GEOMETRY_PAYLOAD_UNQUALIFIED','Spatial analysis is not assessed: changed or unqualified geometry requires its own canonical qualification.');
}
