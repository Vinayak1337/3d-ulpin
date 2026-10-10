import type { PoolClient } from 'pg';
import {
  SourceSpaceRequestSchema, SourceSpaceReceiptSchema, type SourceSpaceRequest, type SourceSpaceReceipt,
  type NormalizedBuilding, type SourceSpaceEvidence, type RegistryBody,
} from '@ulpin/contracts';
import { DocumentPagesSchema } from '../../../../contracts/src/document-pages';
import { transaction } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import { fingerprint } from '../cases/domain';
import { canonicalBuilding } from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';
import { DocumentPagesService } from '../usp/ingestion/document-pages';
import { sourceBuildingOriginalAccessTx } from '../usp/ingestion/source-building-review';
import { sourceFloorTx, sourceSpaceTx } from '../usp/ingestion/source-building-children';
import { appendBuildingMetadataRevisionTx, lockBuildingMetadataTx,
  type BuildingMetadataRecord } from '../usp/ingestion/source-building-candidates';

type Stored = { digest: string; receipt: SourceSpaceReceipt };
type Body = RegistryBody & { sourceSpaceCommands?: Stored[]; placement?: string; classification?: string };
type Dependencies = { transaction: typeof transaction; building: typeof canonicalBuilding;
  original: typeof sourceBuildingOriginalAccessTx; pages: DocumentPagesService['pages'] };
const defaults: Dependencies = { transaction, building: canonicalBuilding, original: sourceBuildingOriginalAccessTx,
  pages: (id, pin) => new DocumentPagesService().pages(id, pin) };

function assertSourceBuilding(record: BuildingMetadataRecord | undefined): asserts record is BuildingMetadataRecord {
  const body = record?.body as Body | undefined;
  if (!record || !body || body.kind !== 'building' || record.revision < 1 || body.footprint.length
    || body.geometry || body.rights.length || body.synthetic || body.placement !== 'unknown'
    || body.classification !== 'test_only') {
    throw new AppError(422, 'SOURCE_SPACE_BUILDING', 'Choose a recorded source-only building in its retained site.');
  }
}

async function evidenceTx(client: PoolClient, record: BuildingMetadataRecord,
  evidence: SourceSpaceEvidence, deps: Dependencies) {
  const pin = (await client.query(`SELECT pin FROM import_packages p,
    jsonb_array_elements(p.body->'documentPins') pin WHERE p.area_id IN
    (SELECT area_id FROM physical_features WHERE id=$1) AND p.body->'features' @> $2::jsonb
    AND pin->>'sourceId'=$3 LIMIT 1`,
  [record.id, JSON.stringify([{ id: record.id }]), evidence.sourceId])).rows[0]?.pin;
  if (!pin || pin.sourceRevision !== evidence.sourceRevision) {
    throw new AppError(422, 'SOURCE_SPACE_EVIDENCE', 'Cite a pinned retained original of this building.');
  }
  const source = await deps.original(client, record.site_id, evidence.sourceId);
  if (Number(source.revision) !== evidence.sourceRevision || source.sha256 !== pin.sourceSha256) {
    throw new AppError(409, 'SOURCE_SPACE_EVIDENCE', 'The retained original revision changed.');
  }
  return { ...evidence, sourceSha256: source.sha256 };
}

function priorReceipt(record: BuildingMetadataRecord, input: SourceSpaceRequest, digest: string) {
  const commands = (record.body as Body).sourceSpaceCommands ?? [];
  const prior = commands.find(command => command.receipt.requestKey === input.requestKey);
  if (prior && prior.digest !== digest) {
    throw new AppError(409, 'SOURCE_SPACE_KEY', 'This request key names different source-space inputs.');
  }
  if (prior) return SourceSpaceReceiptSchema.parse(prior.receipt);
  if (commands.length >= 100) {
    throw new AppError(422, 'SOURCE_SPACE_LIMIT', 'At most one hundred decisions per building.');
  }
  return null;
}

async function inspectEvidence(evidence: Awaited<ReturnType<typeof evidenceTx>>, deps: Dependencies) {
  const pages = DocumentPagesSchema.parse(await deps.pages(evidence.sourceId, {
    revision: String(evidence.sourceRevision),
    sha256: evidence.sourceSha256, offset: String(evidence.page - 1), limit: '1' }));
  const page = pages.pages.find(row => row.page === evidence.page);
  const [x0, y0, x1, y1] = evidence.region;
  if (pages.sourceId !== evidence.sourceId || pages.sourceRevision !== evidence.sourceRevision
    || pages.sourceSha256 !== evidence.sourceSha256 || !page || evidence.page > pages.pageCount
    || pages.offset !== evidence.page - 1 || pages.pages.length !== 1
    || x0 < 0 || y0 < 0 || x1 > page.frame.width || y1 > page.frame.height) {
    throw new AppError(422, 'SOURCE_SPACE_REGION', 'Use an existing page and a region inside its original page box.');
  }
}

/** A literal caption may link only to an exact row of an already reviewed schedule. */
export function sourceScheduleLevel(building: NormalizedBuilding, label: string): string | null {
  const levels = building.levelSchedule?.state === 'reviewed' ? building.levelSchedule.levels : [];
  const matches = levels.filter(level => level.labelLiteral === label);
  if (matches.length > 1) throw new AppError(409, 'SOURCE_SPACE_LEVEL', 'The reviewed caption is ambiguous.');
  return matches[0]?.levelId ?? null;
}

async function saveDecisionTx(client: PoolClient, record: BuildingMetadataRecord, building: NormalizedBuilding,
  input: SourceSpaceRequest, evidence: Awaited<ReturnType<typeof evidenceTx>>[], digest: string, actor: string) {
  const decision = { actor, reason: input.reason, time: new Date().toISOString() };
  const { floor, created } = await sourceFloorTx(client, record, input, evidence[0],
    sourceScheduleLevel(building, input.level.label), decision);
  const space = await sourceSpaceTx(client, record, floor, evidence[1], decision);
  const receipt = SourceSpaceReceiptSchema.parse({ buildingId: record.id, requestKey: input.requestKey,
    recordRevision: record.revision + 1, floorId: floor.id, spaceId: space.id, floorCreated: created,
    floorRevision: floor.revision, spaceRevision: 1, scheduleLevelId: floor.sourceOnly.scheduleLevelId,
    actor, time: decision.time });
  await appendBuildingMetadataRevisionTx(client, record, { sourceSpaceCommands: [
    ...((record.body as Body).sourceSpaceCommands ?? []), { digest, receipt },
  ] });
  return receipt;
}

/** One officer decision; page inspection is outside SQL locks, authority is rechecked under recording locks. */
export async function commandSourceSpace(buildingId: string, raw: unknown,
  deps: Dependencies = defaults): Promise<SourceSpaceReceipt> {
  const input = SourceSpaceRequestSchema.parse(raw);
  const actor = localOperatorSubject();
  const digest = fingerprint({ input, actor });
  const before = await deps.transaction(async client => {
    const record = (await client.query('SELECT * FROM registry_records WHERE id=$1', [buildingId])).rows[0];
    assertSourceBuilding(record);
    const evidence = await Promise.all([input.level.evidence, input.space.evidence]
      .map(value => evidenceTx(client, record, value, deps)));
    return { evidence, prior: priorReceipt(record, input, digest) };
  }, undefined, 'repeatable_read_only');
  if (before.prior) return before.prior;
  for (const evidence of before.evidence) await inspectEvidence(evidence, deps);
  return deps.transaction(async client => {
    await client.query(`SELECT id FROM cases WHERE id IN
      (SELECT case_id FROM sources WHERE id=ANY($1::uuid[])) ORDER BY id FOR SHARE`,
    [[...new Set([input.level.evidence.sourceId, input.space.evidence.sourceId])]]);
    const record = await lockBuildingMetadataTx(client, buildingId);
    assertSourceBuilding(record);
    const evidence = await Promise.all([input.level.evidence, input.space.evidence]
      .map(value => evidenceTx(client, record, value, deps)));
    if (fingerprint(evidence) !== fingerprint(before.evidence)) {
      throw new AppError(409, 'SOURCE_SPACE_EVIDENCE', 'The inspected original changed before recording.');
    }
    const prior = priorReceipt(record, input, digest);
    if (prior) return prior;
    const building = await deps.building(buildingId);
    if (building.revisionId !== input.expectedCanonicalRevision) {
      throw new AppError(409, 'SOURCE_SPACE_STALE', 'Refresh the current canonical building before recording.');
    }
    return saveDecisionTx(client, record, building, input, evidence, digest, actor);
  });
}
