import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RegistryBody, SourceBuildingImport, SourceBuildingPackage } from '@ulpin/contracts';
import { AppError, conflict } from '../../../infrastructure/errors';
import { sourceBuildingFeature, type DocumentPins } from './source-building-values';

type SourceFeature = SourceBuildingPackage['features'][number];
type RegistryRow = { id: string; site_id: string; identifier: string; revision: number; body: RegistryBody };

async function reserveIdentityTx(client: PoolClient, areaId: string, namespace: string, sourceKey: string) {
  const linked = await client.query(
    'SELECT feature_id FROM source_feature_links WHERE namespace=$1 AND source_key=$2', [namespace, sourceKey],
  );
  if (linked.rows.length) conflict('This source building already has an identity; use its existing correction route.');
  const site = (await client.query(
    'SELECT s.* FROM registry_sites s JOIN map_areas a ON a.site_id=s.id WHERE a.id=$1 FOR UPDATE OF s', [areaId],
  )).rows[0];
  const ordinal = Number((await client.query(
    "SELECT COALESCE(MAX(ordinal),0)+1 n FROM registry_records WHERE site_id=$1 AND kind='building'", [site.id],
  )).rows[0].n);
  return { id: randomUUID(), siteId: site.id, ordinal,
    identifier: `${site.identifier}:B${String(ordinal).padStart(3, '0')}` };
}

function sourceRecordBody(feature: SourceFeature) {
  return {
    alias: feature.sourceKey, name: feature.name, kind: 'building', footprint: [], links: [], rights: [],
    evidence: feature.evidence.map(entry => ({
      sourceId: entry.sourceRevisionId, locator: `page ${entry.page}: ${entry.jsonPointer}`,
    })),
    synthetic: false, representation: 'physical_exterior', placement: 'unknown', classification: 'test_only',
  };
}

export async function reserveSourceBuildingTx(
  client: PoolClient, areaId: string, input: SourceBuildingImport,
  building: SourceBuildingImport['buildings'][number], pins: DocumentPins,
): Promise<SourceFeature> {
  const identity = await reserveIdentityTx(client, areaId, input.namespace, building.sourceKey);
  const feature = sourceBuildingFeature(input, building, pins, areaId, identity.id, identity.identifier);
  await client.query(
    "INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,body) VALUES($1,$2,'building',$3,$4,$5)",
    [identity.id, identity.siteId, identity.ordinal, identity.identifier, sourceRecordBody(feature)],
  );
  await client.query(
    'INSERT INTO physical_features(id,area_id,record_id,identifier,body) VALUES($1,$2,$1,$3,$4)',
    [identity.id, areaId, identity.identifier, feature],
  );
  await client.query(
    'INSERT INTO source_feature_links(namespace,source_key,area_id,feature_id) VALUES($1,$2,$3,$4)',
    [input.namespace, building.sourceKey, areaId, identity.id],
  );
  return feature;
}

function assertEmptySourceRecord(stored: { revision: number }, record: RegistryRow, feature: SourceFeature) {
  if (!stored || stored.revision !== feature.revision || !record || record.revision !== feature.revision) {
    conflict('A source building identity changed; review a current correction.');
  }
  if (record.body.footprint.length || record.body.geometry || record.body.rights.length) {
    throw new AppError(422, 'SOURCE_BUILDING_GEOMETRY', 'Source-only recording cannot replace geometry or rights.');
  }
}

export async function recordSourceBuildingTx(
  client: PoolClient, pkg: SourceBuildingPackage, feature: SourceFeature,
  areaRevision: number, siteRevision: number,
): Promise<void> {
  const stored = (await client.query(
    'SELECT revision FROM physical_features WHERE id=$1 FOR UPDATE', [feature.id],
  )).rows[0];
  const record = (await client.query(
    'SELECT * FROM registry_records WHERE id=$1 FOR UPDATE', [feature.id],
  )).rows[0];
  assertEmptySourceRecord(stored, record, feature);
  feature.revision++;
  const body = { ...record.body, id: record.id, siteId: record.site_id,
    identifier: record.identifier, revision: feature.revision };
  await client.query('UPDATE registry_records SET revision=$2,body=$3 WHERE id=$1', [
    feature.id, feature.revision, body,
  ]);
  await client.query('INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,$2,$3,$4)', [
    feature.id, feature.revision, body, siteRevision,
  ]);
  await client.query('UPDATE physical_features SET revision=$2,body=$3 WHERE id=$1', [
    feature.id, feature.revision, feature,
  ]);
  await client.query(
    'INSERT INTO physical_feature_revisions(feature_id,revision,body,package_id,area_revision) VALUES($1,$2,$3,$4,$5)',
    [feature.id, feature.revision, feature, pkg.id, areaRevision],
  );
}
