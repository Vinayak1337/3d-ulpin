import type { PoolClient } from 'pg';
import type { IntakeEvidenceConfirm, IntakeTargetArtefacts } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { amendConfirmedEvidenceTx, type ConfirmedEvidence } from '../../registry/registry-document-evidence';
import { commitRegistryReviewTx, createRegistryDraftTx, prepareRegistryReview } from '../../registry/registry';
import { EVIDENCE_RECEIPT_KIND, evidenceConfirmationIssue, evidenceReceiptKey, evidenceStateTx,
  unmatchedAcceptance } from './intake-evidence';
import { stableUuid } from './intake-run';
import { advanceIntakeTargetTx } from './intake-targets';

/**
 * AU4-B3 D1-D3: the citations an officer's stored evidence confirmations accept for one recorded building, written
 * as one new record revision through the registry correction, review and commit path. Every pin of each
 * confirmation is checked again before the draft and again in the commit transaction; the write receipt and the
 * building's `evidence` artefact are stored in that same transaction, so a replay writes nothing.
 */
export const evidenceCitationSteps = {
  draft: createRegistryDraftTx, amend: amendConfirmedEvidenceTx, review: prepareRegistryReview,
  commit: commitRegistryReviewTx,
};
export type EvidenceCitationSteps = typeof evidenceCitationSteps;
export type EvidenceWrite = NonNullable<IntakeTargetArtefacts['evidence']>;
type Transaction = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
/** The record is the revision the run holds: the cited one once a write is stored, else the recorded one. */
type Building = { targetId: string; caseId: string; record: { id: string; revision: number }; written?: EvidenceWrite };
type Pending = { confirmation_id: string; pins: IntakeEvidenceConfirm; acknowledgement: string; expires_at: Date };

/** Stored citation confirmations that accept a candidate for this building and hold no receipt for it yet. */
async function pendingTx(client: PoolClient, building: Building): Promise<Pending[]> {
  return (await client.query(`SELECT confirmation_id,pins,acknowledgement,expires_at
    FROM usp_intake_evidence_confirmations c WHERE c.case_id=$1 AND c.additions='citations'
    AND c.pins->'additions'->'decisions' @> $2::jsonb AND NOT EXISTS (SELECT 1 FROM operations o
      WHERE o.case_id=c.case_id AND o.kind=$3 AND o.operation_key=$3||':'||c.confirmation_id||':'||$4)
    ORDER BY c.created_at,c.confirmation_id`, [building.caseId,
    JSON.stringify([{ decision: 'accept', targetId: building.targetId }]), EVIDENCE_RECEIPT_KIND,
    building.targetId])).rows;
}

/** D2: a confirmation is written only while every pin it names still holds and it has not expired. */
async function recheckTx(client: PoolClient, caseId: string, pending: Pending) {
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    throw new AppError(409, 'INTAKE_EVIDENCE_STALE', 'The evidence confirmation expired; the officer confirms again.');
  }
  const state = await evidenceStateTx(client, caseId, pending.pins);
  const issue = evidenceConfirmationIssue(pending.pins, state);
  if (issue) throw new AppError(409, 'INTAKE_EVIDENCE_STALE', issue);
  const unmatched = unmatchedAcceptance(pending.pins, state);
  if (unmatched) throw new AppError(409, 'INTAKE_EVIDENCE_NOT_MATCHED', unmatched);
}

/** The accepted decisions for this building, each with the key its candidate was read by. */
async function acceptedTx(client: PoolClient, building: Building, pending: Pending): Promise<ConfirmedEvidence[]> {
  const decisions = pending.pins.additions.kind === 'citations' ? pending.pins.additions.decisions : [];
  const accepted = decisions.flatMap(decision => decision.decision === 'accept'
    && decision.targetId === building.targetId ? [decision] : []);
  const keys = new Map((await client.query(`SELECT candidate_id,candidate->'key' AS key
    FROM usp_intake_evidence_candidates WHERE case_id=$1 AND candidate_id=ANY($2::uuid[])`,
  [building.caseId, accepted.map(decision => decision.candidateId)])).rows.map(row => [row.candidate_id, row.key]));
  return accepted.map(decision => ({ key: keys.get(decision.candidateId), evidence: decision.evidence,
    confirmation: { confirmationId: pending.confirmation_id, candidateId: decision.candidateId,
      candidateSha256: decision.candidateSha256 } }));
}

/** A correction opened under this write's own request key, at the recorded revision the run pinned. */
async function openTx(client: PoolClient, building: Building, pending: Pending[], steps: EvidenceCitationSteps) {
  for (const row of pending) await recheckTx(client, building.caseId, row);
  const confirmed: ConfirmedEvidence[] = [];
  for (const row of pending) confirmed.push(...await acceptedTx(client, building, row));
  const site = (await client.query('SELECT site_id FROM registry_records WHERE id=$1', [building.record.id])).rows[0];
  const requestKey = stableUuid(`intake-evidence-citations/1:${building.targetId}:`
    + pending.map(row => row.confirmation_id).join(','));
  const draft = await steps.draft(client, site.site_id, building.record.id, undefined, requestKey);
  const own = (await client.query('SELECT request_key FROM registry_drafts WHERE id=$1', [draft.id])).rows[0];
  if (own?.request_key !== requestKey || draft.records[0]?.revision !== building.record.revision) {
    conflict('Another correction of this building is open, or its record moved; the officer resolves it first.');
  }
  const amended = await steps.amend(client, draft.id, confirmed);
  const { revision } = (await client.query('SELECT revision FROM registry_sites WHERE id=$1', [site.site_id])).rows[0];
  return { draftId: draft.id, draftRevision: amended.draftRevision, siteRevision: Number(revision),
    citations: amended.record.documentCitations!.map(pin => pin.id).sort() };
}

/** Write one building's pending evidence citations, or return null when no stored confirmation names it. */
export async function writeEvidenceCitations(tx: Transaction, building: Building,
  steps: EvidenceCitationSteps = evidenceCitationSteps): Promise<EvidenceWrite | null> {
  const opened = await tx(async client => {
    const pending = await pendingTx(client, building);
    return pending.length ? { pending, ...await openTx(client, building, pending, steps) } : null;
  });
  if (!opened) return null;
  const review = await steps.review(opened.draftId, opened.draftRevision, opened.siteRevision);
  return tx(async client => {
    for (const row of opened.pending) await recheckTx(client, building.caseId, row);
    await steps.commit(client, review.id, opened.pending[0].acknowledgement);
    const written: EvidenceWrite = { confirmationIds: [...building.written?.confirmationIds ?? [],
      ...opened.pending.map(row => row.confirmation_id)],
      record: { id: building.record.id, revision: building.record.revision + 1 } };
    for (const row of opened.pending) {
      await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
        VALUES($1,$2,$3,$4,$5)`, [building.caseId, evidenceReceiptKey(row.confirmation_id, building.targetId),
        EVIDENCE_RECEIPT_KIND, fingerprint({ citations: opened.citations, record: written.record }), written]);
    }
    await advanceIntakeTargetTx(client, building.targetId, { stage: 4, readiness: 'recorded',
      reason: 'Its record cites the evidence the officer confirmed by an exact key.',
      artefacts: { evidence: written } });
    return written;
  });
}
