import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query } from '../../../infrastructure/db';
import { notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { registerUspJobInputTx } from '../jobs';
import { ingestionBinding } from './events';

const uuid = z.string().uuid();
const common = {
  version: z.literal('intake-run/1'), jobId: uuid, caseId: uuid, caseRevision: z.number().int().nonnegative(),
  subject: z.string().min(1).max(256), accessSha256: z.string().regex(/^[a-f0-9]{64}$/),
};
/** Preparation reviews a draft; a confirmation commits its packages; a target is carried to its card. */
export const IntakeRunInputSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...common, phase: z.literal('prepare'), packageId: uuid }),
  z.strictObject({ ...common, phase: z.literal('commit'), confirmationId: uuid }),
  z.strictObject({ ...common, phase: z.literal('target'), confirmationId: uuid, targetId: uuid }),
]);
export type IntakeRunInput = z.infer<typeof IntakeRunInputSchema>;
type Order = { phase: 'prepare'; packageId: string } | { phase: 'commit'; confirmationId: string }
  | { phase: 'target'; confirmationId: string; targetId: string };

/** The one thing a run job acts on; it is the job's registered input manifest. */
export function intakeRunSubject(input: Order): string {
  if (input.phase === 'prepare') return input.packageId;
  if (input.phase === 'commit') return input.confirmationId;
  return input.targetId;
}

/** A UUID-shaped digest of a name, the same form as the draft keys. */
export function stableUuid(name: string): string {
  const bytes = createHash('sha256').update(name).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const value = bytes.subarray(0, 16).toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-`
    + `${value.slice(16, 20)}-${value.slice(20)}`;
}

/** One stable request key per confirmation, target and step, so a retry sends the same command again. */
export function intakeRunKey(confirmationId: string, targetId: string, step: string): string {
  return stableUuid(`intake-run/1:${confirmationId}:${targetId}:${step}`);
}

async function activeJobTx(client: PoolClient, order: Order): Promise<string | null> {
  const row = (await client.query(`SELECT id FROM jobs WHERE operation='intake-run' AND status IN ('queued','running')
    AND payload->>'phase'=$1 AND COALESCE(payload->>'targetId',payload->>'confirmationId',payload->>'packageId')=$2
    LIMIT 1`, [order.phase, intakeRunSubject(order)])).rows[0];
  return row?.id ?? null;
}

/** Enrols one run job under the existing job authority, unless the same order is already waiting. */
export async function queueIntakeRunTx(client: PoolClient, caseId: string, order: Order,
  sourceId: string | null = null): Promise<string> {
  const active = await activeJobTx(client, order);
  if (active) return active;
  const revision = (await client.query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0]?.revision;
  if (revision === undefined) notFound('Source case not found.');
  const binding = ingestionBinding(caseId);
  const input = IntakeRunInputSchema.parse({ version: 'intake-run/1', jobId: randomUUID(), caseId,
    caseRevision: revision, subject: binding.subject, accessSha256: binding.access, ...order });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-run',$4,$5,$6)`, [input.jobId, caseId, sourceId, revision, digest, input]);
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: caseId, version: revision + 1 }, intakeRunSubject(input), digest);
  return input.jobId;
}

/** The dispatcher has no priority, so the run orders its own jobs: a target opened first, then by age. */
export async function nextIntakeRunJob(): Promise<string | null> {
  const row = (await query(`SELECT j.id FROM jobs j
    LEFT JOIN usp_intake_targets t ON j.payload->>'phase'='target' AND t.target_id::text=j.payload->>'targetId'
    WHERE j.operation='intake-run' AND j.status IN ('queued','running') AND j.next_attempt_at<=now()
    AND NOT EXISTS (SELECT 1 FROM usp_job_attempts a WHERE a.job_id=j.id AND a.state='active' AND a.lease_until>now())
    ORDER BY t.priority_at DESC NULLS LAST, j.created_at, j.id LIMIT 1`)).rows[0];
  return row?.id ?? null;
}
