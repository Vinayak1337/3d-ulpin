import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { EvidencePointer, IntakeTargetArtefacts, PropertyCardVerification,
  RequestContext, SnapshotScope, TargetPin } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockCaseEnqueueTx } from '../../cases/source-case-lock';
import { commitPackage, getPackage, reviewPackage } from '../../areas/areas';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, heartbeatUspJobAttempt,
  recordUspJobFailure, type UspJobAttempt } from '../jobs';
import { generatePropertyCard, readPropertyCard } from '../packets/card-service';
import { verifyPropertyCard } from '../packets/card-verification';
import { confirmPacketPlan, createPacketPlan, executePacketPlan } from '../packets/plan-service';
import { localOperatorSubject, localRequestContext } from '../principal';
import { captureRegistrySnapshotTx, resolveRegistryTarget } from '../snapshots';
import { intakeCaseTx } from './intake-context';
import { partStageTimer, type PartTiming } from './proved-area-part';
import { queueIntakeLargePackageTx } from './intake-large';
import { CARRIED, pendingEvidenceTx, writeEvidenceCitations,
  type PendingEvidence } from './intake-evidence-citations';
import { evidenceCitationBindings } from '../packets/plan-citation-authority';
import { ingestionBinding } from './events';
import { isCardsOnly, packageDifference, readConfirmationRow,
  type IntakeConfirmationRow } from './intake-confirmations';
import { IntakeRunInputSchema, intakeRunKey, intakeRunSubject, nextIntakeRunJob, queueIntakeRunTx,
  type IntakeRunInput } from './intake-run';
import { advanceIntakeTargetTx, holdPackageTargetsTx, prepareIntakeTargetsTx, recordPackageTargetsTx,
  stopIntakeTargetTx, type IntakeTargetRow } from './intake-targets';

/** The product's own commands, in the order CA0 sent them; injectable so a check can count or refuse one. */
export const intakeRunSteps = {
  package: getPackage,
  review: reviewPackage, commit: commitPackage, snapshot: captureRegistrySnapshotTx, resolve: resolveRegistryTarget,
  createPlan: createPacketPlan, confirmPlan: confirmPacketPlan, executePlan: executePacketPlan,
  card: generatePropertyCard, readCard: readPropertyCard, verify: verifyPropertyCard,
  citeEvidence: writeEvidenceCitations,
};
export type IntakeRunSteps = typeof intakeRunSteps;
type Run = { input: IntakeRunInput; attempt: UspJobAttempt; steps: IntakeRunSteps };
/** The officer's confirmation a building is carried under: its id keys every step, its sentence is the reason. */
type Order = { confirmationId: string; reason: string; expiresAt: Date };
type Carry = Run & { ctx: RequestContext; order: Order; target: IntakeTargetRow };
const identityNotApplicable = 'not_applicable: codes are for recorded spaces only';
const retryDelay = "interval '2 seconds'";
const leaseLostCode = 'INTAKE_RUN_LEASE_LOST';

function refuse(code: string, message: string): never {
  throw new AppError(409, code, message);
}

/** A refusal is the product saying no; anything else is the infrastructure, which the authority retries. */
export function intakeRunRefusal(error: unknown): { code: string; message: string } | null {
  if (error instanceof ZodError) return { code: 'INTAKE_RUN_INPUT', message: error.issues[0]?.message ?? 'Invalid.' };
  if (error instanceof AppError && error.status < 500 && error.status !== 408) {
    return { code: error.code, message: error.message };
  }
  return null;
}

/** The authority no longer holding this attempt is the infrastructure, never the product saying no. */
function leaseLost(error: unknown): unknown {
  if (!(error instanceof AppError) || error.status !== 409) return error;
  return new AppError(503, leaseLostCode, 'This run lost its lease; a later attempt continues it.');
}

async function pinned<T>(run: Run, work: (client: PoolClient) => Promise<T>, repeatable = false): Promise<T> {
  return transaction(async client => {
    if (repeatable) await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockCaseEnqueueTx(client, run.input.caseId);
    await intakeCaseTx(client, run.input.caseId);
    assertRunBinding(run.input);
    await assertUspJobAttemptTx(client, run.attempt).catch(error => { throw leaseLost(error); });
    return work(client);
  });
}

/** One package can take seconds, so a run of many renews the lease after each instead of outliving it. */
async function renew(run: Run) {
  await heartbeatUspJobAttempt(run.attempt).catch(error => { throw leaseLost(error); });
}

function reviewed(pkg: ImportPackage): boolean {
  return Boolean(pkg.sourceWorkspace) || pkg.state === 'COMMITTED' || pkg.review?.packageRevision === pkg.revision;
}

/** One elapsed-stage line per review, with technical pins only, never source values or refusal messages. */
async function prepare(run: Run, packageId: string) {
  const stages: Record<string, number> = {}, started = performance.now();
  let outcome = 'failed';
  try {
    outcome = await preparePackage(run, packageId, (stage, ms) => { stages[`${stage}Ms`] = ms; });
  } finally {
    console.info(JSON.stringify({ event: 'intake_run_prepare', jobId: run.input.jobId, packageId,
      outcome, totalMs: performance.now() - started, ...stages }));
  }
}

/** Review a drafted package once, then decide each of its targets; a refused review holds them with its words. */
async function preparePackage(run: Run, packageId: string, timing: PartTiming) {
  const mark = partStageTimer(timing);
  let pkg = await run.steps.package(packageId);
  mark('packageRead');
  try {
    if (!reviewed(pkg)) await run.steps.review(pkg.id, pkg.revision,
      (stage, ms) => timing(`review${stage[0].toUpperCase()}${stage.slice(1)}`, ms));
    mark('review');
    pkg = await run.steps.package(packageId);
    mark('packageReload');
  } catch (error) {
    const refusal = intakeRunRefusal(error);
    if (!refusal) throw error;
    mark('refusal');
    await pinned(run, async client => {
      mark('pinWaitFence');
      await holdPackageTargetsTx(client, run.input.caseId, packageId, refusal.code, refusal.message);
      mark('holdTargets');
      await queueIntakeLargePackageTx(client, packageId);
      mark('foldWake');
    });
    mark('commitRelease');
    return 'refused';
  }
  // A finished review lets a large file waiting at eight unreviewed packages draft its next cut.
  await pinned(run, async client => {
    mark('pinWaitFence');
    await prepareIntakeTargetsTx(client, pkg);
    mark('targets');
    await queueIntakeLargePackageTx(client, packageId);
    mark('foldWake');
  });
  mark('commitRelease');
  return 'prepared';
}

function assertRunBinding(input: IntakeRunInput) {
  const binding = ingestionBinding(input.caseId);
  if (input.subject !== binding.subject || input.accessSha256 !== binding.access) {
    throw new AppError(403, 'INGESTION_ACCESS_CHANGED', 'The configured local access context changed.');
  }
}

function assertOperator(confirmation: IntakeConfirmationRow, caseId: string) {
  if (confirmation.case_id !== caseId) refuse('INTAKE_CONFIRMATION_SCOPE', 'The confirmation is in another case.');
  if (confirmation.expires_at.getTime() <= Date.now()) {
    refuse('INTAKE_CONFIRMATION_EXPIRED', 'This confirmation has expired; confirm again.');
  }
  if (confirmation.subject !== localOperatorSubject()) {
    throw new AppError(403, 'INTAKE_RUN_OPERATOR', 'Only the officer who confirmed can run this confirmation.');
  }
}

async function queueListedTx(client: PoolClient, confirmation: IntakeConfirmationRow) {
  const rows = (await client.query(`SELECT target_id,readiness FROM usp_intake_targets WHERE confirmation_id=$1
    AND readiness IN ('confirmed','recorded') ORDER BY target_id`, [confirmation.confirmation_id])).rows;
  for (const row of rows) {
    if (row.readiness === 'confirmed') {
      await stopIntakeTargetTx(client, row.target_id, confirmation.confirmation_id, 'INTAKE_TARGET_NOT_RECORDED',
        'The package was recorded without a record for this building.');
    } else {
      await queueIntakeRunTx(client, confirmation.case_id,
        { phase: 'target', confirmationId: confirmation.confirmation_id, targetId: row.target_id });
    }
  }
}

async function commitOne(run: Run, confirmation: IntakeConfirmationRow,
  named: IntakeConfirmationRow['packages'][number]) {
  const pkg = await run.steps.package(named.packageId);
  if (pkg.state === 'COMMITTED' && pkg.revision !== named.revision + 1) {
    refuse('INTAKE_PACKAGE_MOVED', 'The recorded package revision changed after confirmation.');
  }
  if (pkg.state !== 'COMMITTED') {
    const difference = packageDifference(named, pkg);
    if (difference) refuse('INTAKE_PACKAGE_MOVED', difference);
    await run.steps.commit(pkg.id, pkg.revision, confirmation.acknowledgement);
  }
  await pinned(run, client => recordPackageTargetsTx(client, confirmation.case_id, pkg.id));
}

async function stopPackage(run: Run, confirmation: IntakeConfirmationRow, packageId: string,
  refusal: { code: string; message: string }) {
  await pinned(run, async client => {
    const rows = (await client.query(`SELECT target_id FROM usp_intake_targets
      WHERE confirmation_id=$1 AND package_id=$2 AND readiness='confirmed'`,
    [confirmation.confirmation_id, packageId])).rows;
    for (const row of rows) await stopIntakeTargetTx(client, row.target_id,
      confirmation.confirmation_id, refusal.code, refusal.message);
  });
}

/** A refused package stops its targets only; other named packages still commit and queue their listed targets.
 * A lost lease stops nothing: a later attempt skips the packages already committed and goes on from the next. */
async function commit(run: Run, confirmationId: string) {
  const confirmation = await readConfirmationRow(confirmationId);
  assertOperator(confirmation, run.input.caseId);
  if (isCardsOnly(confirmation)) return cardInOrder(run, confirmation);
  let refused: unknown;
  for (const named of confirmation.packages) {
    try {
      await commitOne(run, confirmation, named);
    } catch (error) {
      const refusal = intakeRunRefusal(error);
      if (!refusal) throw error;
      await stopPackage(run, confirmation, named.packageId, refusal);
      refused ??= error;
    }
    await renew(run);
  }
  await pinned(run, client => queueListedTx(client, confirmation));
  if (refused) throw refused;
}

async function step(carry: Carry, stage: number, reason: string, artefacts: Partial<IntakeTargetArtefacts>,
  client?: PoolClient) {
  const change = { stage, readiness: artefacts.verification ? 'carded' as const : 'recorded' as const,
    reason, artefacts };
  if (client) await advanceIntakeTargetTx(client, carry.target.target_id, change);
  else await pinned(carry, tx => advanceIntakeTargetTx(tx, carry.target.target_id, change));
  Object.assign(carry.target.artefacts, artefacts);
  Object.assign(carry.target, { stage, readiness: change.readiness });
}

/** The cited revision once evidence citations are written, else the recorded one. */
function recordPin(target: IntakeTargetRow): TargetPin {
  const record = target.artefacts.evidence?.record ?? target.artefacts.record
    ?? refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
  return { ref: { namespace: 'registry_record', id: record.id }, revision: record.revision };
}

/** D3: before its snapshot, a building's stored evidence confirmations are written as citations on its record, so
 * the snapshot pins the cited revision. A building no confirmation names goes on exactly as before. */
async function evidence(carry: Carry) {
  if (carry.target.artefacts.snapshot) return;
  const { target_id: targetId, case_id: caseId, artefacts } = carry.target;
  const record = artefacts.record ?? refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
  const written = await carry.steps.citeEvidence(work => pinned(carry, work), { targetId, caseId, record });
  if (written) Object.assign(carry.target.artefacts, { evidence: written });
}

/** Keep capture repeatable, but publish its pointer/event under a fresh fence and read-committed view.
 * Surface events can advance the case stream during capture; writing that stream in the old view raises 40001.
 * A crash between transactions may retain an unlinked immutable snapshot; no target or event points to it. */
async function snapshot(carry: Carry) {
  const pin = recordPin(carry.target);
  const manifest = await pinned(carry, async client => {
    const site = (await client.query('SELECT site_id FROM registry_records WHERE id=$1', [pin.ref.id])).rows[0];
    if (!site) refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
    return carry.steps.snapshot(client, carry.ctx, site.site_id, { kind: 'targets', pins: [pin] });
  }, true);
  await step(carry, 5, 'Its record is pinned in a snapshot.',
    { snapshot: { id: manifest.id, digest: manifest.digest } });
}

async function snapshotScope(carry: Carry): Promise<SnapshotScope> {
  const row = (await query('SELECT body FROM usp_snapshots WHERE id=$1',
    [carry.target.artefacts.snapshot!.id])).rows[0];
  return row?.body.scope ?? refuse('INTAKE_SNAPSHOT_MISSING', 'The pinned snapshot is no longer stored.');
}

function key(carry: Carry, name: string): string {
  return intakeRunKey(carry.order.confirmationId, carry.target.target_id, name);
}

/** An exact citation is usable only when it is unique; a run never chooses among several matches. */
export function intakeTargetCitation<T extends { legacyLocator?: string }>(evidence: readonly T[], locator: string): T {
  const matches = evidence.filter(entry => entry.legacyLocator === locator);
  if (matches.length !== 1) {
    refuse('INTAKE_TARGET_CITATION', matches.length
      ? `Several citations name ${locator}; the officer must resolve the conflict.`
      : `The record does not cite ${locator}.`);
  }
  return matches[0];
}

/** The record's confirmed evidence citations as plan pointers, read from the captured body of the pinned revision. */
async function evidencePointers(carry: Carry, scope: SnapshotScope, pin: TargetPin): Promise<EvidencePointer[]> {
  if (!carry.target.artefacts.evidence) return [];
  const row = (await query(`SELECT body FROM usp_snapshot_bodies WHERE manifest_id=$1 AND namespace='registry_record'
    AND object_id=$2 AND revision=$3`, [scope.manifestId, pin.ref.id, pin.revision])).rows[0];
  return evidenceCitationBindings(row?.body.body).map(cited => ({
    sourceRevision: { ref: { namespace: 'source_revision', id: cited.sourceId }, revision: cited.sourceRevision },
    assetRevision: null, partRevision: null, locator: { kind: 'verbatim', locator: cited.locator },
    legacyLocator: cited.locator, purpose: 'record', origin: 'direct', target: pin.ref }));
}

/** The record's own citation of this feature, then each confirmed evidence citation, with the confirmation's
 * sentence as their reason. */
async function plan(carry: Carry) {
  const scope = await snapshotScope(carry);
  const pin = recordPin(carry.target);
  const resolved = await carry.steps.resolve(carry.ctx, scope, pin);
  if (resolved.state !== 'available') refuse('INTAKE_TARGET_UNAVAILABLE', 'The pinned record cannot be read.');
  const pointers = [intakeTargetCitation(resolved.data.evidence, carry.target.locator),
    ...await evidencePointers(carry, scope, pin)];
  const created = await carry.steps.createPlan(carry.ctx, { input: { target: pin, scope, purpose: 'record_evidence',
    format: 'csv', recipe: 'pack0-exact-text-csv/1', expiresAt: carry.order.expiresAt.toISOString(),
    entries: pointers.map(pointer => ({ pointer, required: true, inclusionReason: carry.order.reason,
      review: { kind: 'direct' as const, reviewed: true } })) },
  guard: { mode: 'create', requestKey: key(carry, 'plan') } });
  if (created.entries.length !== pointers.length || created.entries.some(entry => entry.state !== 'included')) {
    refuse('INTAKE_PLAN_OMITTED', 'The plan left out a citation.');
  }
  await step(carry, 7, 'Its evidence plan names its own citation.',
    { plan: { id: created.planId, version: created.version, sha256: created.planSha256 } });
}

async function confirmPlan(carry: Carry) {
  const planned = carry.target.artefacts.plan!;
  const confirmed = await carry.steps.confirmPlan(carry.ctx, { planId: planned.id, version: planned.version,
    planSha256: planned.sha256, reviewed: true, guard: { mode: 'update', requestKey: key(carry, 'confirm'),
      expectedVersion: planned.version, expectedManifestId: carry.target.artefacts.snapshot!.id } });
  await step(carry, 7, 'Its evidence plan is confirmed under the officer\'s confirmation.',
    { planConfirmation: { id: confirmed.confirmationId } });
}

async function execute(carry: Carry) {
  const planned = carry.target.artefacts.plan!;
  const executed = await carry.steps.executePlan(carry.ctx, { planId: planned.id, version: planned.version,
    confirmationId: carry.target.artefacts.planConfirmation!.id,
    guard: { mode: 'create', requestKey: key(carry, 'execute') } });
  await step(carry, 7, 'Its evidence packet is written.', { packet: { id: executed.packet.packetId } });
}

async function card(carry: Carry) {
  const planned = carry.target.artefacts.plan!;
  const generated = await carry.steps.card(carry.ctx, { planId: planned.id, planVersion: planned.version,
    cardId: null, expiresAt: carry.order.expiresAt.toISOString(),
    guard: { mode: 'create', requestKey: key(carry, 'card') } });
  await step(carry, 8, 'Its property card is made; it is verified next.',
    { card: { id: generated.cardId, revision: generated.revision } });
}

/** Verify the exact card revision named by the persisted resolver link, not a parallel constructed URL. */
export function intakeCardVerificationPin(url: string, expected: { id: string; revision: number }) {
  const link = new URL(url);
  const match = /^\/api\/v1\/usp\/property-cards\/([a-f0-9-]{36})\/revisions\/([1-9]\d*)$/.exec(link.pathname);
  if (link.protocol !== 'http:' || link.hostname !== '127.0.0.1' || !match
    || match[1] !== expected.id || Number(match[2]) !== expected.revision) {
    refuse('INTAKE_CARD_LINK', 'The stored verification link does not name this exact card revision.');
  }
  return { cardId: match[1], revision: Number(match[2]) };
}

export function assertIntakeCardVerified(report: PropertyCardVerification) {
  if (report.snapshot.state !== 'same_revision') {
    refuse('USP_STALE_TARGET', 'The card target changed after it was pinned; the officer must choose its revision.');
  }
  if (report.result !== 'consistent' || report.lifecycle.expired !== false
    || report.lifecycle.revocation || report.lifecycle.superseded) {
    refuse('INTAKE_CARD_UNVERIFIED', 'The card did not verify as consistent, current and unrevoked.');
  }
}

async function verify(carry: Carry) {
  const made = carry.target.artefacts.card!;
  const { card: stored } = await carry.steps.readCard(carry.ctx, { cardId: made.id, revision: made.revision });
  const linked = intakeCardVerificationPin(stored.resolverUrl, made);
  const { report } = await carry.steps.verify(carry.ctx, linked);
  assertIntakeCardVerified(report);
  await step(carry, 8, `Carded: card ${made.id} revision ${made.revision} verified consistent.`,
    { verification: 'consistent' });
}

const carrySteps: [keyof IntakeTargetArtefacts, (carry: Carry) => Promise<void>][] = [
  ['evidence', evidence], ['snapshot', snapshot],
  ['identity', carry => step(carry, 6, 'Identity is not applicable to a building.',
    { identity: identityNotApplicable })],
  ['plan', plan], ['planConfirmation', confirmPlan], ['packet', execute], ['card', card], ['verification', verify],
];

async function listedTarget(confirmation: IntakeConfirmationRow, targetId: string): Promise<IntakeTargetRow> {
  if (!confirmation.targets.includes(targetId)) {
    refuse('INTAKE_TARGET_NOT_LISTED', 'This building is not on the confirmation\'s list.');
  }
  const row = (await query('SELECT * FROM usp_intake_targets WHERE target_id=$1 AND confirmation_id=$2',
    [targetId, confirmation.confirmation_id])).rows[0] as IntakeTargetRow | undefined;
  return row ?? refuse('INTAKE_TARGET_NOT_LISTED', 'This building is not on the confirmation\'s list.');
}

/** Carry one listed target from its record to a verified card, skipping every step whose artefact is stored. */
async function carryTarget(run: Run, confirmationId: string, targetId: string) {
  const confirmation = await readConfirmationRow(confirmationId);
  const target = await listedTarget(confirmation, targetId);
  assertOperator(confirmation, run.input.caseId);
  await carryListed(run, confirmation, target);
}

async function carryListed(run: Run, confirmation: IntakeConfirmationRow, target: IntakeTargetRow) {
  if (target.readiness !== 'carded') {
    if (target.readiness !== 'recorded') refuse('INTAKE_TARGET_NOT_RECORDED', `This building is ${target.readiness}.`);
    const named = confirmation.packages.find(value => value.packageId === target.package_id);
    const pkg = await run.steps.package(target.package_id);
    if (!named || pkg.state !== 'COMMITTED' || pkg.revision !== named.revision + 1) {
      refuse('INTAKE_PACKAGE_MOVED', 'The recorded package revision changed after confirmation.');
    }
    await carryOn({ ...run, ctx: localRequestContext(run.input.jobId), target, order: {
      confirmationId: confirmation.confirmation_id, reason: confirmation.reason,
      expiresAt: confirmation.expires_at } });
  }
  await lateEvidence(run, target);
}

async function carryOn(carry: Carry) {
  for (const [artefact, send] of carrySteps) if (!carry.target.artefacts[artefact]) await send(carry);
}

/** The sentence a building carried again for late evidence states as its reason. */
export function lateEvidenceReason(confirmationId: string, at: Date): string {
  return `Confirmed by the officer in evidence confirmation ${confirmationId} on ${at.toISOString().slice(0, 10)}.`;
}

type LateConfirmation = Pick<PendingEvidence, 'confirmation_id' | 'case_id' | 'subject' | 'expires_at' | 'created_at'>;
/** A late carry runs under the evidence confirmation, which must be this case's, current and the operator's. */
function lateOrder(run: Run, late: LateConfirmation): Order {
  if (late.case_id !== run.input.caseId) refuse('INTAKE_CONFIRMATION_SCOPE', 'The confirmation is in another case.');
  if (new Date(late.expires_at).getTime() <= Date.now()) {
    refuse('INTAKE_EVIDENCE_STALE', 'The evidence confirmation expired; the officer confirms again.');
  }
  if (late.subject !== localOperatorSubject()) {
    throw new AppError(403, 'INTAKE_RUN_OPERATOR', 'Only the officer who confirmed can run this confirmation.');
  }
  return { confirmationId: late.confirmation_id, expiresAt: new Date(late.expires_at),
    reason: lateEvidenceReason(late.confirmation_id, new Date(late.created_at)) };
}

/** D5: the citations are written as a new record revision; what the card was made from is made again from it. */
async function rewrite(carry: Carry) {
  const { target_id: targetId, case_id: caseId, artefacts } = carry.target;
  const record = artefacts.evidence?.record ?? artefacts.record
    ?? refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
  const written = await carry.steps.citeEvidence(work => pinned(carry, work),
    { targetId, caseId, record, written: artefacts.evidence });
  if (!written) return;
  for (const name of CARRIED) delete artefacts[name];
  Object.assign(artefacts, { evidence: written });
  Object.assign(carry.target, { stage: 4, readiness: 'recorded' });
}

/** D5: evidence confirmed after a building's snapshot. A carded building with such a confirmation is written again
 * and carried from a new snapshot to a new card under the earliest one; its earlier card stays stored as it was.
 * Repeated until none is left, so a confirmation stored while the building was carried is never left behind. */
async function lateEvidence(run: Run, target: IntakeTargetRow) {
  const pending = () => pinned(run, client => pendingEvidenceTx(client,
    { caseId: target.case_id, targetId: target.target_id }));
  for (let [late] = await pending(); late && target.readiness === 'carded'; [late] = await pending()) {
    const carry: Carry = { ...run, ctx: localRequestContext(run.input.jobId), target, order: lateOrder(run, late) };
    await rewrite(carry);
    await carryOn(carry);
  }
}

/** D5: an evidence confirmation's own job. A carded building is carried again; one this job left part-way, its
 * citations written, is carried on. Any other building is left to its own carry, which ends with the same check. */
async function lateTarget(run: Run, confirmationId: string, targetId: string) {
  const target = (await query('SELECT * FROM usp_intake_targets WHERE target_id=$1 AND case_id=$2',
    [targetId, run.input.caseId])).rows[0] as IntakeTargetRow | undefined;
  if (target?.readiness === 'recorded' && target.artefacts.evidence?.confirmationIds.includes(confirmationId)) {
    const late = (await query(`SELECT confirmation_id,case_id,subject,expires_at,created_at
      FROM usp_intake_evidence_confirmations WHERE confirmation_id=$1`, [confirmationId])).rows[0] as LateConfirmation;
    await carryOn({ ...run, ctx: localRequestContext(run.input.jobId), target, order: lateOrder(run, late) });
  }
  if (target?.readiness === 'carded') await lateEvidence(run, target);
}

/** A cards-only confirmation records nothing: one run carries its targets in the order listed, renewing the lease
 * after each. A refusal stops that building only; a later attempt skips what is carded or stopped. */
async function cardInOrder(run: Run, confirmation: IntakeConfirmationRow) {
  let refused: unknown;
  for (const targetId of confirmation.targets) {
    const target = await listedTarget(confirmation, targetId);
    if (target.readiness === 'stopped') continue;
    try {
      await carryListed(run, confirmation, target);
    } catch (error) {
      const refusal = intakeRunRefusal(error);
      if (!refusal) throw error;
      await pinned(run, client => stopIntakeTargetTx(client, targetId, confirmation.confirmation_id,
        refusal.code, refusal.message));
      refused ??= error;
    }
    await renew(run);
  }
  if (refused) throw refused;
}

async function stopTx(client: PoolClient, input: IntakeRunInput, code: string, message: string) {
  if (input.phase === 'target') {
    await stopIntakeTargetTx(client, input.targetId, input.confirmationId, code, message);
    return;
  }
  if (input.phase === 'evidence') {
    // A carded building keeps its card; one refused after its new revision was written stops in these words.
    const row = (await client.query('SELECT confirmation_id FROM usp_intake_targets WHERE target_id=$1',
      [input.targetId])).rows[0];
    if (row?.confirmation_id) await stopIntakeTargetTx(client, input.targetId, row.confirmation_id, code, message);
    return;
  }
  if (input.phase !== 'commit') return;
  const rows = (await client.query(`SELECT target_id FROM usp_intake_targets WHERE confirmation_id=$1
    AND readiness='confirmed'`, [input.confirmationId])).rows;
  for (const row of rows) await stopIntakeTargetTx(client, row.target_id, input.confirmationId, code, message);
}

async function finishJobTx(client: PoolClient, jobId: string, code: string) {
  await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1", [jobId]);
  await client.query("UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1", [jobId, code]);
}

/** A refusal stops what it names and ends the job; an infrastructure fault fences the attempt for a later one.
 * A lost lease is no longer this attempt's to fence: the authority's next claim follows its expiry. */
async function fail(run: Run, error: unknown) {
  if (error instanceof AppError && error.code === leaseLostCode) return;
  const refusal = intakeRunRefusal(error);
  await transaction(async client => {
    await intakeCaseTx(client, run.input.caseId);
    await assertUspJobAttemptTx(client, run.attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [run.input.jobId, run.attempt.number]);
    if (refusal) {
      await stopTx(client, run.input, refusal.code, refusal.message);
      await finishJobTx(client, run.input.jobId, refusal.code);
    } else {
      await client.query(`UPDATE jobs SET error='INTAKE_RUN_RETRY',next_attempt_at=now()+${retryDelay} WHERE id=$1`,
        [run.input.jobId]);
    }
  });
}

async function unclaimed(input: IntakeRunInput, error: unknown) {
  const refusal = intakeRunRefusal(error);
  if (!refusal) throw error;
  await transaction(async client => {
    await intakeCaseTx(client, input.caseId);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    await stopTx(client, input, refusal.code, refusal.message);
    await finishJobTx(client, input.jobId, refusal.code);
  });
}

async function complete(run: Run) {
  const result = { phase: run.input.phase, subject: intakeRunSubject(run.input) };
  await acceptUspJobAttempt(run.attempt,
    { assetId: `intake-run:${result.subject}`, version: 1, sha256: fingerprint(result) },
    async (_client, job) => {
      if (fingerprint(job.payload) !== fingerprint(run.input)) conflict('The intake run completion changed.');
    }, client => intakeCaseTx(client, run.input.caseId).then(() => {}));
}

async function advance(run: Run) {
  const { input } = run;
  assertRunBinding(input);
  if (input.phase === 'prepare') await prepare(run, input.packageId);
  else if (input.phase === 'commit') await commit(run, input.confirmationId);
  else if (input.phase === 'evidence') await lateTarget(run, input.confirmationId, input.targetId);
  else await carryTarget(run, input.confirmationId, input.targetId);
}

/** The existing job authority owns claims, fencing, attempts and completion; this sends only what was confirmed. */
export async function runIntakeRunJob(jobId: string, steps: IntakeRunSteps = intakeRunSteps) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-run'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeRunInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-run:${randomUUID()}`,
      client => intakeCaseTx(client, input.caseId).then(() => {}));
  } catch (error) {
    await unclaimed(input, error);
    return;
  }
  const run = { input, attempt, steps };
  try {
    await advance(run);
    await complete(run);
  } catch (error) {
    if (!(error instanceof AppError && error.code === leaseLostCode)) {
      await recordUspJobFailure(run.attempt, 'INTAKE_RUN_RETRY', error);
    }
    await fail(run, error);
    throw error;
  }
}

/** Keep the dispatcher's one lane/memory reservation across at most three ready jobs, then yield.
 * Each successor is selected afresh (priority, due time and lease) and claims its own fenced attempt.
 * The injectable scheduler is internal only; no request can choose it or bypass admission. */
export async function runNextIntakeRunJob(steps: IntakeRunSteps = intakeRunSteps,
  scheduler = { next: nextIntakeRunJob, run: runIntakeRunJob }) {
  for (let sent = 0; sent < 3; sent++) {
    const jobId = await scheduler.next();
    if (!jobId) return;
    await scheduler.run(jobId, steps);
  }
}
