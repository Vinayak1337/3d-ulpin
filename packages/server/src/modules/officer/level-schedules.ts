import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  LevelScheduleContentSchema, LevelScheduleProposalSchema, LevelScheduleReceiptSchema, LevelScheduleRequestSchema,
  type LevelSchedule, type LevelScheduleContent, type LevelScheduleReceipt, type LevelScheduleRequest,
  type NormalizedBuilding, type RegistryBody,
} from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { fingerprint } from '../cases/domain';
import { canonicalBuilding, collectCanonicalCitationPins } from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';
import { sourceBuildingOriginalAccessTx } from '../usp/ingestion/source-building-review';
import {
  appendBuildingMetadataRevisionTx, lockBuildingMetadataTx,
} from '../usp/ingestion/source-building-candidates';
import { assessSchedulePrisms } from '../registry/canonical-level-schedule';

type Proposal = ReturnType<typeof LevelScheduleProposalSchema.parse>;
type Stored = { digest: string; receipt: LevelScheduleReceipt };
type ScheduleBody = RegistryBody & { levelScheduleProposals?: Proposal[];
  canonicalLevelSchedules?: LevelSchedule[]; levelScheduleCommands?: Stored[] };

/** A derived interval requires a cited starting base and every intervening stated height. */
export function resolveScheduleHeights(raw: LevelScheduleContent): LevelScheduleContent {
  const content = LevelScheduleContentSchema.parse(raw);
  let cursor = content.statedBase?.valueM ?? null;
  let reference = content.statedBase?.verticalReference ?? null;
  const levels = [...content.levels].sort((left, right) => left.order - right.order).map(row => {
    if (row.heightSource === 'unknown') {
      cursor = null;
      return row;
    }
    if (row.heightSource === 'stated') {
      cursor = row.upperM;
      reference = row.verticalReference;
      return row;
    }
    if (cursor === null || !reference || !row.statedHeightM || row.verticalReference !== reference) {
      throw new AppError(422, 'LEVEL_HEIGHT_BASIS',
        'Derived heights require a stated base and contiguous cited heights.');
    }
    const upper = cursor + row.statedHeightM;
    if ((row.lowerM !== null && row.lowerM !== cursor) || (row.upperM !== null && row.upperM !== upper)) {
      throw new AppError(422, 'LEVEL_HEIGHT_BASIS', 'Derived limits must match the retained stated base and heights.');
    }
    const derived = { ...row, lowerM: cursor, upperM: upper };
    cursor = upper;
    return derived;
  });
  return { ...content, levels };
}

export function reviewedLevelSchedule(building: NormalizedBuilding, proposal: Proposal,
  reason: string, actor: string, at: string, revision: number): LevelSchedule {
  if (proposal.buildingId !== building.buildingId) {
    throw new AppError(422, 'LEVEL_SCHEDULE_BUILDING', 'Review a proposal of this building only.');
  }
  const content = resolveScheduleHeights(proposal.content);
  const levelIds = new Set(content.levels.map(level => level.levelId));
  if (building.candidates.some(candidate => candidate.levelId && !levelIds.has(candidate.levelId))) {
    throw new AppError(422, 'LEVEL_SCHEDULE_ASSOCIATION',
      'Retain the identities of explicitly associated levels; do not orphan prior room reviews.');
  }
  return { ...content, buildingId: building.buildingId,
    proposalId: proposal.proposalId, revision, decision: { actor, reason, at }, prisms: {} };
}

function contentCitations(content: LevelScheduleContent) {
  return [...content.levels.flatMap(row => row.citations), ...(content.statedBase?.citations ?? []),
    ...(content.alternatives ?? []).flatMap(alternative => [
      ...alternative.citations, ...alternative.levels.flatMap(row => row.citations),
    ])];
}

async function verifyScheduleSources(client: PoolClient, siteId: string,
  building: NormalizedBuilding, content: LevelScheduleContent): Promise<void> {
  const retained = collectCanonicalCitationPins(building);
  for (const citation of contentCitations(content)) {
    const source = await sourceBuildingOriginalAccessTx(client, siteId, citation.sourceId);
    if (source.sha256 !== citation.sourceSha256 || retained.get(citation.sourceId) !== citation.sourceSha256
      || !['page', 'region'].includes(citation.locator.kind)
      || ('page' in citation.locator && citation.locator.page > 8)) {
      throw new AppError(422, 'LEVEL_SCHEDULE_CITATION', 'Use a retained original page citation of this building.');
    }
  }
}

async function receiptFor(client: PoolClient, body: ScheduleBody, building: NormalizedBuilding,
  input: LevelScheduleRequest, siteId: string, revision: number): Promise<LevelScheduleReceipt> {
  const actor = localOperatorSubject();
  const at = new Date().toISOString();
  if (input.action === 'propose') {
    const content = resolveScheduleHeights(input.content);
    await verifyScheduleSources(client, siteId, building, content);
    const proposal = LevelScheduleProposalSchema.parse({ proposalId: randomUUID(), buildingId: building.buildingId,
      recordRevision: revision, state: 'candidate', content, actor, at });
    return { requestKey: input.requestKey, buildingId: building.buildingId, recordRevision: revision,
      action: 'propose', proposal, schedule: null };
  }
  const proposal = body.levelScheduleProposals?.find(entry => entry.proposalId === input.proposalId) ?? notFound();
  if (body.canonicalLevelSchedules?.some(schedule => schedule.proposalId === proposal.proposalId)) {
    conflict('This proposal was already reviewed; propose an explicit new schedule revision.');
  }
  await verifyScheduleSources(client, siteId, building, proposal.content);
  const schedule = reviewedLevelSchedule(building, proposal, input.reason, actor, at, revision);
  schedule.prisms = await assessSchedulePrisms(building, schedule);
  return { requestKey: input.requestKey, buildingId: building.buildingId, recordRevision: revision,
    action: 'review', proposal, schedule };
}

async function scheduleCommandTx(client: PoolClient, buildingId: string,
  input: LevelScheduleRequest): Promise<LevelScheduleReceipt> {
  const record = await lockBuildingMetadataTx(client, buildingId);
  const body = record.body as ScheduleBody;
  const digest = fingerprint({ input, actor: localOperatorSubject() });
  const previous = body.levelScheduleCommands?.find(command => command.receipt.requestKey === input.requestKey);
  if (previous) {
    if (previous.digest !== digest) conflict('This schedule request key names different inputs.');
    return LevelScheduleReceiptSchema.parse(previous.receipt);
  }
  if ((body.levelScheduleCommands?.length ?? 0) >= 40) {
    throw new AppError(422, 'LEVEL_SCHEDULE_LIMIT', 'At most forty schedule commands per building.');
  }
  const building = await canonicalBuilding(buildingId);
  if (building.revisionId !== input.expectedCanonicalRevision) conflict('Refresh the current canonical building.');
  const receipt = LevelScheduleReceiptSchema.parse(await receiptFor(
    client, body, building, input, record.site_id, record.revision + 1,
  ));
  const patch: Record<string, unknown> = { levelScheduleCommands: [
    ...(body.levelScheduleCommands ?? []), { digest, receipt },
  ] };
  if (receipt.action === 'propose') {
    patch.levelScheduleProposals = [...(body.levelScheduleProposals ?? []), receipt.proposal];
  }
  if (receipt.schedule) patch.canonicalLevelSchedules = [...(body.canonicalLevelSchedules ?? []), receipt.schedule];
  await appendBuildingMetadataRevisionTx(client, record, patch);
  return receipt;
}

export async function commandLevelSchedule(buildingId: string, raw: unknown): Promise<LevelScheduleReceipt> {
  const input = LevelScheduleRequestSchema.parse(raw);
  return transaction(client => scheduleCommandTx(client, buildingId, input));
}
