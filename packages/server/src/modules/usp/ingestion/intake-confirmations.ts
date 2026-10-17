import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import { IntakeConfirmSchema, IntakeConfirmationSchema, type IntakeConfirm,
  type IntakeConfirmation } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { appendCaseIngestionTx } from './events';
import { intakeCaseTx } from './intake-context';
import { queueIntakeRunTx } from './intake-run';
import { intakeTargetView, type IntakeTargetRow } from './intake-targets';

/** The most the packet plan and card policy admit (plan-service.ts:51-53, card-service.ts:196-198). */
export const INTAKE_CONFIRMATION_VALIDITY_MS = 24 * 60 * 60 * 1000;
export type IntakeConfirmationRow = {
  confirmation_id: string; case_id: string; request_key: string; input_sha256: string; subject: string;
  acknowledgement: string; packages: IntakeConfirm['packages']; targets: string[]; reason: string;
  expires_at: Date; created_at: Date;
};
const uuid = z.string().uuid();

/** The one sentence every later step states as its reason; never a made-up justification. */
export function intakeConfirmationReason(confirmationId: string, at: Date, cardsOnly = false): string {
  const day = at.toISOString().slice(0, 10);
  return `Confirmed by the officer in intake confirmation ${confirmationId} on ${day}`
    + (cardsOnly ? ' to card buildings already recorded.' : '.');
}

/** A cards-only confirmation stores the pins of the packages it cards, so its stated reason is what marks it. */
export function isCardsOnly(row: Pick<IntakeConfirmationRow, 'confirmation_id' | 'created_at' | 'reason'>) {
  return row.reason === intakeConfirmationReason(row.confirmation_id, row.created_at, true);
}

function stale(message: string): never {
  throw new AppError(409, 'INTAKE_CONFIRMATION_STALE', message);
}

/** The first way a named package differs from what the officer saw, or null. */
export function packageDifference(named: IntakeConfirm['packages'][number], pkg: ImportPackage | undefined) {
  if (!pkg) return `Package ${named.packageId} is not a drafted item of this case.`;
  if (pkg.state === 'COMMITTED') return `Package ${named.packageId} is already recorded.`;
  if (pkg.revision !== named.revision) {
    return `Package ${named.packageId} is at revision ${pkg.revision}, not ${named.revision}.`;
  }
  if (!pkg.review || pkg.review.packageRevision !== pkg.revision) {
    return `Package ${named.packageId} has no review of its current revision.`;
  }
  if (pkg.review.inputFingerprint !== named.reviewFingerprint) {
    return `Package ${named.packageId} has another review fingerprint.`;
  }
  return null;
}

async function assertPackagesTx(client: PoolClient, caseId: string, input: IntakeConfirm) {
  for (const named of input.packages) {
    const row = (await client.query(`SELECT p.body FROM import_packages p WHERE p.id=$1 AND EXISTS (
      SELECT 1 FROM usp_intake_items i WHERE (i.plan_ref->>'packageId'=p.id::text
        OR EXISTS (SELECT 1 FROM usp_intake_parts part WHERE part.item_id=i.item_id
          AND part.state='published' AND part.result_ref->>'packageId'=p.id::text))
        AND i.case_id=$2) FOR UPDATE OF p`,
    [named.packageId, caseId])).rows[0];
    const difference = packageDifference(named, row?.body);
    if (difference) stale(difference);
  }
}

/** Why a building cannot be named by a cards-only confirmation, or null. */
export function cardTargetDifference(targetId: string, row: { readiness: string; confirmation_id: string | null;
  pin: IntakeConfirm['packages'][number] | null } | undefined) {
  if (!row) return `Target ${targetId} is not in this case.`;
  if (!row.pin) return `Target ${targetId} belongs to a package no confirmation of this case has recorded.`;
  if (row.readiness !== 'recorded') {
    return `Target ${targetId} is ${row.readiness}; only a recorded building with no card can be named.`;
  }
  if (row.confirmation_id) return `Target ${targetId} is already listed in confirmation ${row.confirmation_id}.`;
  return null;
}

/** A cards-only confirmation names recorded buildings with no card, of packages this case already recorded;
 * it returns each package as the confirmation that recorded it named it, in the order of the targets. */
async function assertCardTargetsTx(client: PoolClient, caseId: string, input: IntakeConfirm) {
  const rows = (await client.query(`SELECT t.target_id,t.readiness,t.confirmation_id,(SELECT named FROM
      usp_intake_confirmations c CROSS JOIN LATERAL jsonb_array_elements(c.packages) AS named
      WHERE c.case_id=$1 AND named->>'packageId'=t.package_id::text AND p.body->>'state'='COMMITTED'
      AND (named->>'revision')::int+1=(p.body->>'revision')::int ORDER BY c.created_at LIMIT 1) AS pin
    FROM usp_intake_targets t LEFT JOIN import_packages p ON p.id=t.package_id
    WHERE t.case_id=$1 AND t.target_id=ANY($2::uuid[]) ORDER BY t.target_id FOR UPDATE OF t`,
  [caseId, input.targets])).rows;
  const pins = new Map<string, IntakeConfirm['packages'][number]>();
  for (const targetId of input.targets) {
    const row = rows.find(value => value.target_id === targetId);
    const difference = cardTargetDifference(targetId, row);
    if (difference) stale(difference);
    pins.set(row.pin.packageId, row.pin);
  }
  return [...pins.values()];
}

/** The packages the confirmation stores: those named, or for a cards-only one, the pins of its targets. */
async function assertTargetsTx(client: PoolClient, caseId: string, input: IntakeConfirm) {
  if (!input.packages.length) return assertCardTargetsTx(client, caseId, input);
  const rows = (await client.query(`SELECT target_id,package_id,readiness FROM usp_intake_targets
    WHERE case_id=$1 AND target_id=ANY($2::uuid[]) ORDER BY target_id FOR UPDATE`, [caseId, input.targets])).rows;
  const packages = new Set(input.packages.map(named => named.packageId));
  for (const targetId of input.targets) {
    const row = rows.find(value => value.target_id === targetId);
    if (!row) stale(`Target ${targetId} is not in this case.`);
    if (!packages.has(row.package_id)) {
      stale(`Target ${targetId} belongs to a package this confirmation does not name.`);
    }
    if (row.readiness !== 'ready') stale(`Target ${targetId} is ${row.readiness}, not ready.`);
  }
  return input.packages;
}

async function storeTx(client: PoolClient, caseId: string, input: IntakeConfirm,
  packages: IntakeConfirm['packages'], subject: string, digest: string) {
  const confirmationId = randomUUID();
  const createdAt = new Date();
  const cardsOnly = !input.packages.length;
  await client.query(`INSERT INTO usp_intake_confirmations(confirmation_id,case_id,request_key,input_sha256,subject,
    acknowledgement,packages,targets,reason,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [confirmationId, caseId, input.requestKey, digest, subject, input.acknowledgement, JSON.stringify(packages),
    input.targets, intakeConfirmationReason(confirmationId, createdAt, cardsOnly),
    new Date(createdAt.getTime() + INTAKE_CONFIRMATION_VALIDITY_MS), createdAt]);
  const [readiness, reason] = cardsOnly ? ['recorded', 'Listed for a card; it is carded in the order listed.']
    : ['confirmed', 'Confirmed; it is recorded with its package, then carded in turn.'];
  const rows = (await client.query(`UPDATE usp_intake_targets SET readiness=$3,confirmation_id=$1,reason=$4,
    updated_at=now() WHERE target_id=ANY($2::uuid[]) RETURNING target_id,readiness,stage`,
  [confirmationId, input.targets, readiness, reason])).rows;
  for (const row of rows) await appendCaseIngestionTx(client, caseId,
    { kind: 'intake.target', targetId: row.target_id, readiness: row.readiness, stage: row.stage });
  await queueIntakeRunTx(client, caseId, { phase: 'commit', confirmationId });
  return confirmationId;
}

/** One transaction: everything named must still be as the officer saw it, or nothing is stored. */
export async function confirmIntake(caseIdValue: string, raw: unknown): Promise<IntakeConfirmation> {
  const caseId = uuid.parse(caseIdValue);
  const input = IntakeConfirmSchema.parse(raw);
  const subject = localOperatorSubject();
  const digest = fingerprint({ input, subject });
  const confirmationId = await transaction(async client => {
    await intakeCaseTx(client, caseId, true);
    const prior = (await client.query(`SELECT confirmation_id,input_sha256 FROM usp_intake_confirmations
      WHERE case_id=$1 AND request_key=$2`, [caseId, input.requestKey])).rows[0];
    if (prior && prior.input_sha256 !== digest) {
      throw new AppError(409, 'INTAKE_CONFIRMATION_KEY', 'This request key was used with a different confirmation.');
    }
    if (prior) return prior.confirmation_id as string;
    await assertPackagesTx(client, caseId, input);
    return storeTx(client, caseId, input, await assertTargetsTx(client, caseId, input), subject, digest);
  });
  return readIntakeConfirmation(caseId, confirmationId);
}

export async function readConfirmationRow(confirmationId: string, client?: PoolClient,
  lock = false): Promise<IntakeConfirmationRow> {
  const sql = `SELECT * FROM usp_intake_confirmations WHERE confirmation_id=$1${lock ? ' FOR UPDATE' : ''}`;
  const rows = client ? (await client.query(sql, [confirmationId])).rows : (await query(sql, [confirmationId])).rows;
  return rows[0] ?? notFound('Intake confirmation not found.');
}

async function countsTx(client: PoolClient, row: IntakeConfirmationRow) {
  return (await client.query(`SELECT
    count(*) FILTER (WHERE artefacts ? 'record')::int AS recorded,
    count(*) FILTER (WHERE confirmation_id=$2 AND readiness='carded')::int AS carded,
    count(*) FILTER (WHERE confirmation_id=$2 AND readiness='stopped')::int AS stopped
    FROM usp_intake_targets WHERE package_id=ANY($1::uuid[])`,
  [row.packages.map(named => named.packageId), row.confirmation_id])).rows[0];
}

async function findingCountsTx(client: PoolClient, row: IntakeConfirmationRow) {
  const result = (await client.query(`WITH reviewed AS (
      SELECT p.body FROM import_packages p JOIN unnest($1::uuid[],$2::text[]) AS named(id,fingerprint)
      ON p.id=named.id AND p.body->'review'->>'inputFingerprint'=named.fingerprint
    ), findings AS (
      SELECT finding->>'code' AS code,count(*)::int AS count FROM reviewed
      CROSS JOIN LATERAL jsonb_array_elements(body->'review'->'findings') AS finding GROUP BY finding->>'code'
    ) SELECT (SELECT count(*)::int FROM reviewed) AS reviewed_count,
      COALESCE((SELECT jsonb_object_agg(code,count) FROM findings),'{}'::jsonb) AS counts`,
  [row.packages.map(named => named.packageId), row.packages.map(named => named.reviewFingerprint)])).rows[0];
  return result.reviewed_count === row.packages.length ? result.counts : null;
}

/** The record, each listed target's stage, readiness, codes and artefacts, and the counts. */
export async function readIntakeConfirmation(caseIdValue: string, confirmationIdValue: string) {
  const caseId = uuid.parse(caseIdValue);
  const confirmationId = uuid.parse(confirmationIdValue);
  return transaction(async client => {
    await intakeCaseTx(client, caseId);
    const row = await readConfirmationRow(confirmationId, client);
    if (row.case_id !== caseId) notFound('Intake confirmation not found.');
    const targets = (await client.query(`SELECT * FROM usp_intake_targets WHERE confirmation_id=$1
      ORDER BY array_position($2::uuid[],target_id)`, [confirmationId, row.targets])).rows as IntakeTargetRow[];
    return IntakeConfirmationSchema.parse({ confirmationId, caseId, requestKey: row.request_key,
      subject: row.subject, acknowledgement: row.acknowledgement, packages: row.packages, targets: row.targets,
      reason: row.reason, expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString(),
      progress: targets.map(intakeTargetView), counts: await countsTx(client, row),
      findingCounts: await findingCountsTx(client, row) });
  });
}

async function resumeTx(client: PoolClient, row: IntakeConfirmationRow) {
  const stopped = (await client.query(`UPDATE usp_intake_targets SET readiness=CASE WHEN artefacts ? 'record'
      THEN 'recorded' ELSE 'confirmed' END,blocked_by='{}',reason='Retried; it continues from its stopped step.',
    updated_at=now() WHERE confirmation_id=$1 AND readiness='stopped'
    RETURNING target_id,readiness,stage`, [row.confirmation_id])).rows;
  for (const target of stopped) {
    await appendCaseIngestionTx(client, row.case_id,
      { kind: 'intake.target', targetId: target.target_id, readiness: target.readiness, stage: target.stage });
    if (target.readiness === 'recorded') {
      await queueIntakeRunTx(client, row.case_id,
        { phase: 'target', confirmationId: row.confirmation_id, targetId: target.target_id });
    }
  }
  if (stopped.some(target => target.readiness === 'confirmed')) {
    await queueIntakeRunTx(client, row.case_id, { phase: 'commit', confirmationId: row.confirmation_id });
  }
  return stopped.length;
}

/** Re-enqueue the stopped targets with the same keys; nothing done is repeated. */
export async function retryIntakeConfirmation(caseIdValue: string, confirmationIdValue: string) {
  const caseId = uuid.parse(caseIdValue);
  const confirmationId = uuid.parse(confirmationIdValue);
  await transaction(async client => {
    await intakeCaseTx(client, caseId, true);
    const row = await readConfirmationRow(confirmationId, client, true);
    if (row.case_id !== caseId) notFound('Intake confirmation not found.');
    if (row.subject !== localOperatorSubject()) {
      throw new AppError(403, 'INTAKE_RUN_OPERATOR', 'Only the officer who confirmed can retry this run.');
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw new AppError(409, 'INTAKE_CONFIRMATION_EXPIRED', 'This confirmation has expired; confirm again.');
    }
    await resumeTx(client, row);
  });
  return readIntakeConfirmation(caseId, confirmationId);
}
