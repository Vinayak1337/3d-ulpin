import type { PoolClient } from 'pg';
import { z } from 'zod';
import { UspDisplayDerivativeSchema, type RequestContext, type SnapshotScope, type TargetPin,
  type UspDisplayDerivative } from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { AppError } from '../errors';
import { assertLocalUsp, readSnapshotBody } from './snapshots';

export async function displayInputsCurrentTx(client: PoolClient, scopeId: string, pins: UspDisplayDerivative['inputPins']) {
  const missing=(await client.query(`SELECT 1 FROM jsonb_array_elements($1::jsonb) p WHERE NOT CASE p#>>'{ref,namespace}'
    WHEN 'registry_record' THEN EXISTS(SELECT 1 FROM registry_records r LEFT JOIN usp_project_codes c ON c.record_id=r.id
      WHERE r.id::text=p#>>'{ref,id}' AND r.revision::text=p->>'revision' AND r.site_id=$2
        AND (c.status IS NULL OR c.status='assigned'))
    WHEN 'area_feature' THEN EXISTS(SELECT 1 FROM physical_features f JOIN map_areas a ON a.id=f.area_id
      WHERE f.id::text=p#>>'{ref,id}' AND f.revision::text=p->>'revision' AND a.site_id=$2)
    WHEN 'source_revision' THEN EXISTS(SELECT 1 FROM sources s JOIN cases c ON c.id=s.case_id
      WHERE s.id::text=p#>>'{ref,id}' AND s.revision::text=p->>'revision' AND c.site_id=$2
        AND NOT EXISTS(SELECT 1 FROM sources newer WHERE newer.case_id=s.case_id AND newer.family_id=s.family_id AND newer.revision>s.revision))
    WHEN 'map_area' THEN EXISTS(SELECT 1 FROM map_areas a WHERE a.id::text=p#>>'{ref,id}' AND a.revision::text=p->>'revision' AND a.site_id=$2)
    WHEN 'import_package' THEN EXISTS(SELECT 1 FROM import_packages i JOIN map_areas a ON a.id=i.area_id
      WHERE i.id::text=p#>>'{ref,id}' AND i.revision::text=p->>'revision' AND a.site_id=$2)
    ELSE false END LIMIT 1`,[JSON.stringify(pins),scopeId])).rowCount;
  return !missing;
}

/** This is the sole display-store read boundary. It returns metadata, not public object URLs. */
export async function readDisplayDerivativesForCompiler(ctx: RequestContext, scope: SnapshotScope, target: TargetPin) {
  assertLocalUsp(ctx);
  if (target.ref.namespace !== 'registry_record') throw new AppError(422, 'USP_DISPLAY_TARGET', 'Choose a canonical record.');
  const captured = await readSnapshotBody(ctx, scope, target);
  if (captured.projectIdentity?.status === 'retired' || captured.projectIdentity?.status === 'cancelled_error') return [];
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const current = (await client.query(`SELECT r.revision,c.status FROM registry_records r
      LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1 AND r.site_id=$2`,
    [target.ref.id, scope.scopeId])).rows[0];
    if (!current || current.status === 'retired' || current.status === 'cancelled_error') return [];
    await client.query('SET LOCAL ROLE ulpin_usp_display_compiler');
    const rows = (await client.query(`SELECT body FROM usp_display.derivatives
      WHERE record_id=$1 AND record_revision=$2 ORDER BY created_at DESC,id LIMIT 100`,
    [target.ref.id, target.revision])).rows;
    await client.query('SET LOCAL ROLE NONE');
    const result: UspDisplayDerivative[]=[];
    for (const row of rows) {
      const derivative=UspDisplayDerivativeSchema.parse(row.body);
      result.push({...derivative,stale:derivative.stale || Number(current.revision)!==target.revision
        || !await displayInputsCurrentTx(client,scope.scopeId,derivative.inputPins)});
    }
    return result;
  });
}

/** Accepted compiler output only, in the caller's existing command transaction; no geometry is generated here. */
export async function storeDisplayDerivativeTx(client: PoolClient, ctx: RequestContext,
  scope: SnapshotScope, raw: UspDisplayDerivative) {
  assertLocalUsp(ctx);
  const value = UspDisplayDerivativeSchema.parse(raw);
  z.uuid().parse(scope.scopeId);
  const row = (await client.query(`SELECT r.id,r.revision,c.status FROM registry_records r
    LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1 AND r.site_id=$2 FOR SHARE OF r`,
  [value.record.ref.id, scope.scopeId])).rows[0];
  if (!row || Number(row.revision) !== value.record.revision || row.status === 'retired' || row.status === 'cancelled_error') {
    throw new AppError(409, 'USP_DISPLAY_STALE', 'The display derivative no longer matches an active canonical revision.');
  }
  if (!await displayInputsCurrentTx(client,scope.scopeId,value.inputPins))
    throw new AppError(409,'USP_DISPLAY_INPUT_STALE','A contributing record, source or layer changed or is outside the authorized scope.');
  await client.query('INSERT INTO usp_display.derivatives(id,record_id,record_revision,body) VALUES($1,$2,$3,$4)',
    [value.id,value.record.ref.id,value.record.revision,value]);
  return value;
}
