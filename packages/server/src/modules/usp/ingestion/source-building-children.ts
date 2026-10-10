import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SourceStatedRecordSchema, type SourceStatedRecord, type SourceSpaceRequest } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import type { BuildingMetadataRecord } from './source-building-candidates';

type Evidence = SourceStatedRecord['sourceOnly']['evidence'];
type Decision = SourceStatedRecord['sourceOnly']['decision'];

/** Exact original region binding, shared by identity review and canonical citations. */
export function sourceStatementLocator(evidence: Evidence): string {
  return `page ${evidence.page}; region pt [${evidence.region.join(',')}]; literal ${evidence.literal}`;
}

export function sourceChildBody(building: BuildingMetadataRecord, parent: { id: string; identifier: string },
  kind: 'floor' | 'space', identifier: string, evidence: Evidence, scheduleLevelId: string | null,
  decision: Decision): SourceStatedRecord {
  return SourceStatedRecordSchema.parse({ id: randomUUID(), siteId: building.site_id, identifier, revision: 1,
    alias: evidence.literal, name: evidence.literal, kind, footprint: [], rights: [], placement: 'unknown',
    classification: 'test_only', synthetic: false,
    links: [{ type: kind === 'floor' ? 'within' : 'floor', targetId: parent.id }],
    evidence: [{ sourceId: evidence.sourceId, locator: sourceStatementLocator(evidence) }],
    sourceOnly: { version: 'source-stated-space/1', buildingId: building.id, parentId: parent.id,
      scheduleLevelId, evidence, transcription: 'officer_entered', decision } });
}

async function reserveChildTx(client: PoolClient, building: BuildingMetadataRecord,
  parent: { id: string; identifier: string }, kind: 'floor' | 'space', evidence: Evidence,
  scheduleLevelId: string | null, decision: Decision): Promise<SourceStatedRecord> {
  const ordinal = Number((await client.query(`SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal
    FROM registry_records WHERE site_id=$1 AND kind=$2`, [building.site_id, kind])).rows[0].ordinal);
  const siblings = Number((await client.query(`SELECT count(*)::integer AS count FROM registry_records
    WHERE site_id=$1 AND kind=$2 AND body->'links' @> $3::jsonb`, [building.site_id, kind,
    JSON.stringify([{ targetId: parent.id, type: kind === 'floor' ? 'within' : 'floor' }])])).rows[0].count);
  const suffix = `${kind === 'floor' ? 'F' : 'S'}${String(siblings + 1).padStart(3, '0')}`;
  const body = sourceChildBody(building, parent, kind, `${parent.identifier}:${suffix}`,
    evidence, scheduleLevelId, decision);
  await client.query(`INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,revision,body)
    VALUES($1,$2,$3,$4,$5,1,$6)`, [body.id, building.site_id, kind, ordinal, body.identifier, body]);
  await client.query('INSERT INTO registry_links(record_id,target_id,kind) VALUES($1,$2,$3)',
    [body.id, parent.id, body.links[0].type]);
  const site = (await client.query('SELECT revision FROM registry_sites WHERE id=$1', [building.site_id])).rows[0];
  await client.query('INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,1,$2,$3)',
    [body.id, body, site.revision + 1]);
  return body;
}

export async function sourceFloorTx(client: PoolClient, building: BuildingMetadataRecord,
  input: SourceSpaceRequest, evidence: Evidence, scheduleLevelId: string | null, decision: Decision) {
  const existing = (await client.query(`SELECT body FROM registry_records WHERE site_id=$1 AND kind='floor'
    AND revision>0 AND body->'sourceOnly'->>'buildingId'=$2 AND body->>'name'=$3
    AND body->'sourceOnly'->'evidence'->>'sourceId'=$4 ORDER BY id FOR UPDATE`,
  [building.site_id, building.id, input.level.label, evidence.sourceId])).rows;
  if (existing.length > 1) throw new AppError(409, 'SOURCE_SPACE_FLOOR', 'The floor identity is ambiguous.');
  if (existing.length) {
    const floor = SourceStatedRecordSchema.parse(existing[0].body);
    if (floor.sourceOnly.evidence.sourceRevision !== evidence.sourceRevision
      || floor.sourceOnly.evidence.sourceSha256 !== evidence.sourceSha256) {
      throw new AppError(409, 'SOURCE_SPACE_EVIDENCE', 'The recorded floor original revision changed.');
    }
    return { floor, created: false };
  }
  const parent = { id: building.id, identifier: (building.body as { identifier?: string }).identifier! };
  if (!parent.identifier) throw new AppError(422, 'SOURCE_SPACE_BUILDING', 'The building identifier is unavailable.');
  const floor = await reserveChildTx(client, building, parent, 'floor', evidence, scheduleLevelId, decision);
  return { floor, created: true };
}

export async function sourceSpaceTx(client: PoolClient, building: BuildingMetadataRecord,
  floor: SourceStatedRecord, evidence: Evidence, decision: Decision) {
  if ((await client.query(`SELECT id FROM registry_records WHERE site_id=$1 AND kind='space' AND revision>0
    AND body->>'name'=$2 AND body->'links' @> $3::jsonb`, [building.site_id, evidence.literal,
    JSON.stringify([{ type: 'floor', targetId: floor.id }])])).rows.length) {
    throw new AppError(409, 'SOURCE_SPACE_DUPLICATE', 'This literal label is already recorded on this floor.');
  }
  return reserveChildTx(client, building, floor, 'space', evidence, floor.sourceOnly.scheduleLevelId, decision);
}
