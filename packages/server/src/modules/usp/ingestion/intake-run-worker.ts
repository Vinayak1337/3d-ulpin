import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { IntakeTargetArtefacts, PropertyCardVerification,
  RequestContext, SnapshotScope, TargetPin } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { commitPackage, getPackage, reviewPackage } from '../../areas/areas';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, type UspJobAttempt } from '../jobs';
import { generatePropertyCard, readPropertyCard } from '../packets/card-service';
import { verifyPropertyCard } from '../packets/card-verification';
import { confirmPacketPlan, createPacketPlan, executePacketPlan } from '../packets/plan-service';
import { localOperatorSubject, localRequestContext } from '../principal';
import { captureRegistrySnapshotTx, resolveRegistryTarget } from '../snapshots';
import { intakeCaseTx } from './intake-context';
import { queueIntakeLargePackageTx } from './intake-large';
import { ingestionBinding } from './events';
import { packageDifference, readConfirmationRow, type IntakeConfirmationRow } from './intake-confirmations';
import { IntakeRunInputSchema, intakeRunKey, intakeRunSubject, nextIntakeRunJob, queueIntakeRunTx,
  type IntakeRunInput } from './intake-run';
import { advanceIntakeTargetTx, holdPackageTargetsTx, prepareIntakeTargetsTx, recordPackageTargetsTx,
  stopIntakeTargetTx, type IntakeTargetRow } from './intake-targets';

/** The product's own commands, in the order CA0 sent them; injectable so a check can count or refuse one. */
export const intakeRunSteps = {
  review: reviewPackage, commit: commitPackage, snapshot: captureRegistrySnapshotTx, resolve: resolveRegistryTarget,
  createPlan: createPacketPlan, confirmPlan: confirmPacketPlan, executePlan: executePacketPlan,
  card: generatePropertyCard, readCard: readPropertyCard, verify: verifyPropertyCard,
};
export type IntakeRunSteps = typeof intakeRunSteps;
type Run = { input: IntakeRunInput; attempt: UspJobAttempt; steps: IntakeRunSteps };
type Carry = Run & { ctx: RequestContext; confirmation: IntakeConfirmationRow; target: IntakeTargetRow };
const identityNotApplicable = 'not_applicable: codes are for recorded spaces only';
const retryDelay = "interval '2 seconds'";

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

async function pinned<T>(run: Run, work: (client: PoolClient) => Promise<T>, repeatable = false): Promise<T> {
  return transaction(async client => {
    if (repeatable) await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await intakeCaseTx(client, run.input.caseId);
    assertRunBinding(run.input);
    await assertUspJobAttemptTx(client, run.attempt);
    return work(client);
  });
}

function reviewed(pkg: ImportPackage): boolean {
  return Boolean(pkg.sourceWorkspace) || pkg.state === 'COMMITTED' || pkg.review?.packageRevision === pkg.revision;
}

/** Review a drafted package once, then decide each of its targets; a refused review holds them with its words. */
async function prepare(run: Run, packageId: string) {
  let pkg = await getPackage(packageId);
  try {
    if (!reviewed(pkg)) await run.steps.review(pkg.id, pkg.revision);
    pkg = await getPackage(packageId);
  } catch (error) {
    const refusal = intakeRunRefusal(error);
    if (!refusal) throw error;
    await pinned(run, async client => {
      await holdPackageTargetsTx(client, run.input.caseId, packageId, refusal.code, refusal.message);
      await queueIntakeLargePackageTx(client, packageId);
    });
    return;
  }
  // A finished review lets a large file waiting at eight unreviewed packages draft its next cut.
  await pinned(run, async client => {
    await prepareIntakeTargetsTx(client, pkg);
    await queueIntakeLargePackageTx(client, packageId);
  });
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
  const pkg = await getPackage(named.packageId);
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

/** A refused package stops its targets only; other named packages still commit and queue their listed targets. */
async function commit(run: Run, confirmationId: string) {
  const confirmation = await readConfirmationRow(confirmationId);
  assertOperator(confirmation, run.input.caseId);
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
}

function recordPin(target: IntakeTargetRow): TargetPin {
  const record = target.artefacts.record ?? refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
  return { ref: { namespace: 'registry_record', id: record.id }, revision: record.revision };
}

/** Captured in the same repeatable-read transaction that stores it, so a retry never captures twice. */
async function snapshot(carry: Carry) {
  const pin = recordPin(carry.target);
  await pinned(carry, async client => {
    const site = (await client.query('SELECT site_id FROM registry_records WHERE id=$1', [pin.ref.id])).rows[0];
    if (!site) refuse('INTAKE_TARGET_NOT_RECORDED', 'This building has no record.');
    const manifest = await carry.steps.snapshot(client, carry.ctx, site.site_id, { kind: 'targets', pins: [pin] });
    await step(carry, 5, 'Its record is pinned in a snapshot.',
      { snapshot: { id: manifest.id, digest: manifest.digest } }, client);
  }, true);
}

async function snapshotScope(carry: Carry): Promise<SnapshotScope> {
  const row = (await query('SELECT body FROM usp_snapshots WHERE id=$1',
    [carry.target.artefacts.snapshot!.id])).rows[0];
  return row?.body.scope ?? refuse('INTAKE_SNAPSHOT_MISSING', 'The pinned snapshot is no longer stored.');
}

function key(carry: Carry, name: string): string {
  return intakeRunKey(carry.confirmation.confirmation_id, carry.target.target_id, name);
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

/** One entry: the record's own citation of this feature, with the confirmation's sentence as its reason. */
async function plan(carry: Carry) {
  const scope = await snapshotScope(carry);
  const pin = recordPin(carry.target);
  const resolved = await carry.steps.resolve(carry.ctx, scope, pin);
  if (resolved.state !== 'available') refuse('INTAKE_TARGET_UNAVAILABLE', 'The pinned record cannot be read.');
  const pointer = intakeTargetCitation(resolved.data.evidence, carry.target.locator);
  const created = await carry.steps.createPlan(carry.ctx, { input: { target: pin, scope, purpose: 'record_evidence',
    format: 'csv', recipe: 'pack0-exact-text-csv/1', expiresAt: carry.confirmation.expires_at.toISOString(),
    entries: [{ pointer, required: true, inclusionReason: carry.confirmation.reason,
      review: { kind: 'direct', reviewed: true } }] }, guard: { mode: 'create', requestKey: key(carry, 'plan') } });
  if (created.entries[0]?.state !== 'included') refuse('INTAKE_PLAN_OMITTED', 'The plan left out the citation.');
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
    cardId: null, expiresAt: carry.confirmation.expires_at.toISOString(),
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
  ['snapshot', snapshot],
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
  if (target.readiness === 'carded') return;
  if (target.readiness !== 'recorded') refuse('INTAKE_TARGET_NOT_RECORDED', `This building is ${target.readiness}.`);
  const named = confirmation.packages.find(value => value.packageId === target.package_id);
  const pkg = await getPackage(target.package_id);
  if (!named || pkg.state !== 'COMMITTED' || pkg.revision !== named.revision + 1) {
    refuse('INTAKE_PACKAGE_MOVED', 'The recorded package revision changed after confirmation.');
  }
  const carry: Carry = { ...run, ctx: localRequestContext(run.input.jobId), confirmation, target };
  for (const [artefact, send] of carrySteps) if (!target.artefacts[artefact]) await send(carry);
}

async function stopTx(client: PoolClient, input: IntakeRunInput, code: string, message: string) {
  if (input.phase === 'target') {
    await stopIntakeTargetTx(client, input.targetId, input.confirmationId, code, message);
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

/** A refusal stops what it names and ends the job; an infrastructure fault fences the attempt for a later one. */
async function fail(run: Run, error: unknown) {
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
    await fail(run, error);
    throw error;
  }
}

/** The dispatcher entry: the run picks its own next job, a target opened first. */
export async function runNextIntakeRunJob(steps: IntakeRunSteps = intakeRunSteps) {
  const jobId = await nextIntakeRunJob();
  if (jobId) await runIntakeRunJob(jobId, steps);
}
