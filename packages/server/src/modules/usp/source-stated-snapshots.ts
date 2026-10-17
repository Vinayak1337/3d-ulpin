import type { PoolClient } from 'pg';
import { SourceStatedRecordSchema } from '@ulpin/contracts';
import type { TargetPin } from '@ulpin/contracts/usp';
import { AppError } from '../../infrastructure/errors';
import { sourceBuildingOriginalAccessTx } from './ingestion/source-building-review';

type Row = { id: string; site_id: string; kind: string; revision: number; body: any };
type Pin = { sourceId: string; sourceRevision: number; sourceSha256: string };
type Selection = { kind: 'site' } | { kind: 'targets'; pins: readonly TargetPin[] };
const unavailable = () => new AppError(409, 'SOURCE_SPACE_SNAPSHOT',
  'The exact source-stated original is unavailable.');

/** Explicit source-space target selection only; ordinary site/document/conversion snapshots stay gated. */
export async function sourceStatedSnapshotPinsTx(
  client: PoolClient, siteId: string, records: Row[], selection: Selection,
): Promise<Map<string, Pin>> {
  if (selection.kind !== 'targets' || !selection.pins.length) return new Map();
  const targets = selection.pins.map(pin => records.find(row => pin.ref.namespace === 'registry_record'
    && row.id === pin.ref.id && Number(row.revision) === pin.revision));
  if (targets.some(row => !row || row.kind !== 'space' || !row.body?.sourceOnly)) return new Map();
  const buildingIds = new Set<string>();
  for (const target of targets) {
    buildingIds.add(sourceTargetBuilding(siteId, records, target!));
  }
  const rows = (await client.query(`SELECT pin.value AS pin FROM import_packages p
    JOIN physical_features f ON p.body->'features' @> jsonb_build_array(jsonb_build_object('id',f.id::text))
    CROSS JOIN LATERAL jsonb_array_elements(p.body->'documentPins') pin
    WHERE f.record_id=ANY($1::uuid[]) AND f.revision>0 AND p.body->>'geometryFree'='true'`,
  [[...buildingIds]])).rows;
  const pins = new Map<string, Pin>();
  for (const row of rows) {
    const prior = pins.get(row.pin.sourceId);
    if (prior && (prior.sourceRevision !== row.pin.sourceRevision
      || prior.sourceSha256 !== row.pin.sourceSha256)) throw unavailable();
    pins.set(row.pin.sourceId, row.pin);
  }
  if (!pins.size) throw unavailable();
  return pins;
}

function sourceTargetBuilding(siteId: string, records: Row[], target: Row): string {
  const space = SourceStatedRecordSchema.parse(target.body);
  const floorRow = records.find(row => row.id === space.sourceOnly.parentId && row.revision > 0);
  const floor = SourceStatedRecordSchema.parse(floorRow?.body);
  const building = records.find(row => row.id === space.sourceOnly.buildingId && row.revision > 0);
  if (target.site_id !== siteId || floorRow?.site_id !== siteId || building?.site_id !== siteId
    || space.id !== target.id || space.siteId !== siteId || floor.id !== floorRow.id || floor.siteId !== siteId
    || floor.kind !== 'floor' || floor.sourceOnly.buildingId !== building.id || building.kind !== 'building'
    || building.body.classification !== 'test_only' || building.body.synthetic !== false
    || building.body.placement !== 'unknown' || building.body.footprint?.length !== 0
    || building.body.geometry || building.body.rights?.length !== 0) throw unavailable();
  return building.id;
}

export async function captureSourceStatedOriginalTx(client: PoolClient, siteId: string, source: any, pin: Pin) {
  if (source.id !== pin.sourceId || source.revision !== pin.sourceRevision || source.sha256 !== pin.sourceSha256) {
    throw unavailable();
  }
  const access = await sourceBuildingOriginalAccessTx(client, siteId, source.id);
  assertSameOriginal(source, access);
  return { ...source, inspection: { ...source.inspection, referenceParts: [] },
    sourceStatedOriginal: { version: 'source-stated-space/1', siteId } };
}

function assertSameOriginal(source: any, current: any) {
  for (const field of ['id', 'case_id', 'revision', 'sha256', 'object_key']) {
    if (source[field] !== current[field]) throw unavailable();
  }
  if (Number(source.bytes) !== Number(current.bytes)) throw unavailable();
}

/** Captured original-only authority is private and never grants extraction, conversion or analytic eligibility. */
export async function sourceStatedOriginalAuthorityTx(client: PoolClient, siteId: string,
  source: any): Promise<boolean> {
  if (source.sourceStatedOriginal?.version !== 'source-stated-space/1'
    || source.sourceStatedOriginal.siteId !== siteId) throw unavailable();
  await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE', [source.case_id]);
  const current = await sourceBuildingOriginalAccessTx(client, siteId, source.id);
  assertSameOriginal(source, current);
  return true;
}
