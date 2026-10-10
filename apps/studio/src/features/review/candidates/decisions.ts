import type { GetResponse, Schemas } from '@ulpin/api-client';

type BuildingCanonical = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;

export type FootprintDraftBody = Schemas['POST_spatial_ml_items_itemId_footprint_drafts_Request_application_json'];
export type AttachLevelBody = Extract<
  Schemas['POST_buildings_buildingId_candidates_Request_application_json'],
  { action: 'attach_level' }
>;

/** The API refuses reasons shorter than this. */
export const MIN_REASON_LENGTH = 3;
export const NO_REVIEWED_LEVELS = 'No reviewed levels yet — a level schedule is needed first';
export const REJECTION_NEEDS_ACCEPTANCE = 'The review command records a rejection only together with at least one '
  + 'accepted candidate from the same image. Accept one candidate of this image to record both.';

export interface StagedDecision {
  candidateId: string;
  /** The model inference (one retained image) the candidate came from; one command records one image. */
  itemId: string;
  outcome: 'accepted' | 'rejected';
  reason: string;
}

export type DecisionPlan = { ok: true; body: FootprintDraftBody } | { ok: false; reason: string };

export function reasonError(reason: string): string | null {
  if (reason.trim().length >= MIN_REASON_LENGTH) return null;
  return `Give a reason of at least ${MIN_REASON_LENGTH} characters.`;
}

function subjectOf(candidateId: string): string {
  return `Roofprint ${candidateId.slice(0, 8)}`;
}

/** The command takes one reason for the accepted candidates, so each accepted reason is kept once, in order. */
function acceptedReason(accepted: readonly StagedDecision[]): string {
  return [...new Set(accepted.map((decision) => decision.reason.trim()))].join('; ');
}

/**
 * The footprint-draft command for the decisions staged on one image. The API needs at least one accepted
 * candidate; a rejection alone is refused here instead of being sent.
 */
export function footprintDecisionPlan(input: {
  requestKey: string;
  packageRevision: number;
  areaRevision: number;
  decisions: readonly StagedDecision[];
}): DecisionPlan {
  const accepted = input.decisions.filter((decision) => decision.outcome === 'accepted');
  const rejected = input.decisions.filter((decision) => decision.outcome === 'rejected');
  if (!accepted.length) return { ok: false, reason: REJECTION_NEEDS_ACCEPTANCE };
  return {
    ok: true,
    body: {
      requestKey: input.requestKey,
      expectedRevision: input.packageRevision,
      expectedAreaRevision: input.areaRevision,
      georeference: 'source_geotiff',
      selections: accepted.map((decision) => ({
        componentId: decision.candidateId,
        subject: subjectOf(decision.candidateId),
      })),
      rejected: rejected.map((decision) => ({ componentId: decision.candidateId, reason: decision.reason.trim() })),
      reason: acceptedReason(accepted),
    },
  };
}

export interface LevelChoice {
  id: string;
  label: string;
}

export interface LevelChoices {
  options: LevelChoice[];
  /** Why the picker is disabled; null when at least one reviewed level exists. */
  disabledReason: string | null;
}

/** Only the building's existing reviewed levels can take a room; a literal floor title never creates one. */
export function levelChoices(levels: BuildingCanonical['levels']): LevelChoices {
  const options = levels.flatMap((level) => (
    level.label.state === 'reviewed' && level.label.value ? [{ id: level.levelId, label: level.label.value }] : []
  ));
  return { options, disabledReason: options.length ? null : NO_REVIEWED_LEVELS };
}

export function attachLevelBody(input: {
  requestKey: string;
  canonicalRevision: string;
  candidateId: string;
  levelId: string;
  reason: string;
}): AttachLevelBody {
  return {
    action: 'attach_level',
    requestKey: input.requestKey,
    expectedCanonicalRevision: input.canonicalRevision,
    candidateId: input.candidateId,
    levelId: input.levelId,
    reason: input.reason.trim(),
  };
}
