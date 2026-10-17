import type { PhysicalFeature } from '@ulpin/contracts';
import type { PoolClient } from 'pg';
import { isExteriorOnly } from '../registry/exterior-only';
import { conflict } from '../../infrastructure/errors';

type RegistryRow = {
  id: string; site_id: string; kind: string; identifier: string; revision: number;
  body: Record<string, any>;
};
type CandidateRow = RegistryRow & { feature_id: string };

function nativeObservedBuilding(feature: PhysicalFeature) {
  return feature.kind === 'building' && feature.worldStatus === 'observed'
    && feature.representation === 'physical_exterior'
    && !Object.hasOwn(feature.properties, 'spatialExtraction')
    && feature.evidence.length > 0 && feature.evidence.every(entry =>
      typeof entry.sourceRevisionId === 'string' && entry.sourceRevisionId.trim().length > 0
      && typeof entry.featureId === 'string' && entry.featureId.trim().length > 0);
}

function emptyReservation(record: RegistryRow) {
  return record.revision === 0 && record.kind === 'building' && record.body.kind === 'building'
    && isExteriorOnly(record.body)
    && Array.isArray(record.body.rights) && record.body.rights.length === 0
    && Array.isArray(record.body.evidence) && record.body.evidence.length === 0;
}

async function recordExteriorTx(
  client: PoolClient, record: RegistryRow, feature: PhysicalFeature, siteRevision: number,
) {
  const body = {
    ...record.body, id: record.id, siteId: record.site_id, identifier: record.identifier, revision: 1,
    evidence: feature.evidence.map(entry => ({
      sourceId: entry.sourceRevisionId, locator: `feature ${entry.featureId}`,
    })),
  };
  await client.query('UPDATE registry_records SET revision=1,body=$2 WHERE id=$1', [record.id, body]);
  await client.query(
    'INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,1,$2,$3)',
    [record.id, body, siteRevision],
  );
}

/** Caller holds the recording gate and area lock; only the reserved body gains citations, never map geometry. */
export async function recordCommittedExteriorsTx(
  client: PoolClient, areaId: string, features: readonly PhysicalFeature[],
): Promise<number> {
  const eligible = new Map(features.filter(nativeObservedBuilding).map(feature => [feature.id, feature]));
  if (!eligible.size) return 0;
  const candidates = (await client.query<CandidateRow>(
    `SELECT p.id AS feature_id,r.id,r.site_id,r.kind,r.identifier,r.revision,r.body
     FROM physical_features p JOIN registry_records r ON r.id=p.record_id
     JOIN map_areas a ON a.id=p.area_id AND a.site_id=r.site_id
     WHERE p.area_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY r.id,p.id`,
    [areaId, [...eligible.keys()]],
  )).rows.filter(emptyReservation);
  if (!candidates.length) return 0;
  const byRecord = new Map(candidates.map(record => [record.id, eligible.get(record.feature_id)!]));
  if (byRecord.size !== candidates.length) conflict('Multiple observations share one reserved registry identity.');
  // Matches the document commit path: area first, then site, then registry records.
  const site = (await client.query<{ id: string; revision: number }>(
    'SELECT s.id,s.revision FROM registry_sites s JOIN map_areas a ON a.site_id=s.id WHERE a.id=$1 FOR UPDATE OF s',
    [areaId],
  )).rows[0];
  if (!site) conflict('The map area no longer has a registry site.');
  const records = (await client.query<RegistryRow>(
    'SELECT id,site_id,kind,identifier,revision,body FROM registry_records'
      + ' WHERE id=ANY($1::uuid[]) AND site_id=$2 ORDER BY id FOR UPDATE',
    [[...byRecord.keys()], site.id],
  )).rows.filter(emptyReservation);
  for (const record of records) await recordExteriorTx(client, record, byRecord.get(record.id)!, site.revision + 1);
  if (records.length) await client.query('UPDATE registry_sites SET revision=revision+1 WHERE id=$1', [site.id]);
  return records.length;
}
