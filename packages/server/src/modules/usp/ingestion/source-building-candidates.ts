import type { PoolClient } from 'pg';
import {
  BuildingCandidateRefSchema, BuildingPlanCandidateReceiptSchema, BuildingPlanCandidateRequestSchema,
  type BuildingPlanCandidateRequest, type NormalizedBuilding, type PhysicalFeature, type RegistryBody,
} from '@ulpin/contracts';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { canonicalBuilding } from '../../registry/canonical-building';
import { localOperatorSubject } from '../principal';
import { sourceBuildingOriginalAccessTx } from './source-building-review';

type Candidate = NormalizedBuilding['candidates'][number];
type Citation = NonNullable<Candidate['citations']>[number];
type Receipt = ReturnType<typeof BuildingPlanCandidateReceiptSchema.parse>;
type Stored = { digest: string; receipt: Receipt };
type Body = RegistryBody & { canonicalCandidates?: Candidate[]; candidateCommands?: Stored[] };
type RecordRow = { id: string; site_id: string; revision: number; body: Body };
export type BuildingMetadataRecord = { id: string; site_id: string; revision: number; body: RegistryBody };

/** Original page citations share docling_tesseract.py's MAX_SOURCE_PAGES (eight-page OCR source bound). */
export const BUILDING_CANDIDATE_MAX_PAGES = 8;

/** Explicit selection changes only the association; plan-local polygons never become placed registry spaces. */
export function attachCandidateLevel(building: NormalizedBuilding, candidate: Candidate,
  levelId: string, reason: string, actor: string, time: string): Candidate {
  assertCandidateUndecided(candidate);
  if (!building.levels.some(level => level.levelId === levelId && level.label.state === 'reviewed')) {
    throw new AppError(422, 'CANDIDATE_LEVEL', 'Choose an existing reviewed level of this building.');
  }
  return { ...candidate, levelId, review: { outcome: 'accepted', reason, actor, time }, state: 'reviewed',
    limitations: [...(candidate.limitations ?? []), 'Level association reviewed; local geometry remains unplaced'] };
}

function assertCandidateUndecided(candidate: Candidate): void {
  if (candidate.review) {
    throw new AppError(409, 'CANDIDATE_DECIDED', 'This candidate already has a review decision.');
  }
}

/** Reject only the retained source candidate, preserving its unplaced geometry and citations. */
export function rejectCandidate(candidate: Candidate, reason: string, actor: string, time: string): Candidate {
  assertCandidateUndecided(candidate);
  return { ...candidate, state: 'reviewed', levelId: null, review: { outcome: 'rejected', reason, actor, time } };
}

/** Every citation a retained room carries: its own, and that of the size its sheet states beside it. */
export function roomCandidateCitations(candidate: Candidate): Citation[] {
  const stated = candidate.statedSize ? [candidate.statedSize.citation] : [];
  return [...(candidate.citations ?? []), ...stated];
}

async function verifyCandidateSources(client: PoolClient, record: RecordRow, candidates: Candidate[]): Promise<void> {
  for (const candidate of candidates) {
    for (const citation of roomCandidateCitations(candidate)) {
      const source = await sourceBuildingOriginalAccessTx(client, record.site_id, citation.sourceId);
      if (source.sha256 !== citation.sourceSha256 || citation.locator.kind !== 'region'
        || citation.locator.unit !== 'pt' || citation.locator.page > BUILDING_CANDIDATE_MAX_PAGES) {
        throw new AppError(422, 'CANDIDATE_CITATION', 'Retain the exact original page and PDF-point bbox.');
      }
    }
    if (!candidate.coordinateFrame?.startsWith('plan-local:') || candidate.levelId !== null) {
      throw new AppError(422, 'CANDIDATE_FRAME',
        'Room candidates require an unplaced plan-local frame and unknown level.');
    }
  }
}

/** Reuse immutable registry/physical histories for geometry-free officer metadata, preserving package lineage. */
export async function appendBuildingMetadataRevisionTx(client: PoolClient, record: BuildingMetadataRecord,
  patch: Record<string, unknown>): Promise<void> {
  const row = (await client.query('SELECT * FROM physical_features WHERE id=$1 FOR UPDATE', [record.id])).rows[0];
  if (!row) notFound();
  const lineage = (await client.query(
    'SELECT package_id FROM physical_feature_revisions WHERE feature_id=$1 AND revision=$2', [row.id, row.revision],
  )).rows[0] ?? notFound('The previous physical revision lineage is unavailable.');
  const site = (await client.query('UPDATE registry_sites SET revision=revision+1 WHERE id=$1 RETURNING revision',
    [record.site_id])).rows[0];
  const area = (await client.query('UPDATE map_areas SET revision=revision+1 WHERE id=$1 RETURNING revision',
    [row.area_id])).rows[0];
  const body = { ...record.body, ...patch, revision: record.revision + 1 };
  await client.query('UPDATE registry_records SET revision=$2,body=$3 WHERE id=$1', [record.id, body.revision, body]);
  await client.query('INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,$2,$3,$4)',
    [record.id, body.revision, body, site.revision]);
  const feature = { ...row.body as PhysicalFeature, revision: row.revision + 1 };
  await client.query('UPDATE physical_features SET revision=$2,body=$3 WHERE id=$1', [
    row.id, feature.revision, feature,
  ]);
  await client.query(
    'INSERT INTO physical_feature_revisions(feature_id,revision,body,package_id,area_revision) VALUES($1,$2,$3,$4,$5)',
    [row.id, feature.revision, feature, lineage.package_id, area.revision],
  );
}

function nextCandidates(building: NormalizedBuilding, input: BuildingPlanCandidateRequest,
  candidates: Candidate[], actor: string, time: string): Candidate[] {
  if (input.action === 'retain_rooms') {
    const ids = [...candidates, ...input.candidates].map(candidate => candidate.candidateId);
    if (new Set(ids).size !== ids.length || ids.length > 64) {
      throw new AppError(422, 'CANDIDATE_LIMIT', 'Retain each candidate once within the 64-room bound.');
    }
    return [...candidates, ...input.candidates];
  }
  const selected = candidates.find(candidate => candidate.candidateId === input.candidateId) ?? notFound();
  const updated = input.action === 'reject'
    ? rejectCandidate(selected, input.reason, actor, time)
    : attachCandidateLevel(building, selected, input.levelId, input.reason, actor, time);
  return candidates.map(candidate => candidate.candidateId === updated.candidateId ? updated : candidate);
}

/** Keep case → physical admission lock → area → site → record lock ordering shared across metadata commands. */
export async function lockBuildingMetadataTx(client: PoolClient, buildingId: string): Promise<BuildingMetadataRecord> {
  await client.query('SELECT id FROM cases WHERE site_id=(SELECT site_id FROM registry_records WHERE id=$1)'
    + ' ORDER BY id FOR SHARE', [buildingId]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  await client.query('SELECT id FROM map_areas WHERE id=(SELECT area_id FROM physical_features WHERE id=$1)'
    + ' FOR UPDATE', [buildingId]);
  await client.query('SELECT id FROM registry_sites WHERE id=(SELECT site_id FROM registry_records WHERE id=$1)'
    + ' FOR UPDATE', [buildingId]);
  return (await client.query(
    'SELECT * FROM registry_records WHERE id=$1 AND kind=\'building\' AND revision>0 FOR UPDATE', [buildingId],
  )).rows[0] ?? notFound();
}

async function commandTx(client: PoolClient, buildingId: string,
  input: BuildingPlanCandidateRequest, actor: string): Promise<Receipt> {
  const record: RecordRow = await lockBuildingMetadataTx(client, buildingId);
  const digest = fingerprint({ input, actor });
  const prior = record.body.candidateCommands?.find(entry => entry.receipt.requestKey === input.requestKey);
  if (prior) {
    if (prior.digest !== digest) conflict('This candidate command key names different inputs.');
    return BuildingPlanCandidateReceiptSchema.parse(prior.receipt);
  }
  if ((record.body.candidateCommands?.length ?? 0) >= 20) {
    throw new AppError(422, 'CANDIDATE_COMMAND_LIMIT', 'At most twenty retained candidate commands per building.');
  }
  const building = await canonicalBuilding(buildingId);
  if (building.revisionId !== input.expectedCanonicalRevision) conflict('Refresh the current canonical building.');
  if (input.action === 'retain_rooms') await verifyCandidateSources(client, record, input.candidates);
  const current = BuildingCandidateRefSchema.array().parse(record.body.canonicalCandidates ?? []);
  const time = new Date().toISOString();
  const candidates = nextCandidates(building, input, current, actor, time);
  const receipt = BuildingPlanCandidateReceiptSchema.parse({ buildingId, requestKey: input.requestKey,
    recordRevision: record.revision + 1, candidateIds: input.action === 'retain_rooms'
      ? input.candidates.map(candidate => candidate.candidateId) : [input.candidateId], actor, time,
    derivativeSha256: input.action === 'retain_rooms' ? input.derivativeSha256 : null });
  await appendBuildingMetadataRevisionTx(client, record, { canonicalCandidates: candidates,
    candidateCommands: [...(record.body.candidateCommands ?? []), { digest, receipt }] });
  return receipt;
}

export async function retainBuildingCandidates(buildingId: string, raw: unknown): Promise<Receipt> {
  const input = BuildingPlanCandidateRequestSchema.parse(raw);
  const actor = localOperatorSubject();
  return transaction(client => commandTx(client, buildingId, input, actor));
}
