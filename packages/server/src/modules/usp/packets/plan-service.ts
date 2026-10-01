import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RequestContext } from '@ulpin/contracts/usp';
import { UspCreatePacketPlanSchema, UspRevisePacketPlanSchema, UspReadPacketPlanSchema,
  UspConfirmPacketPlanSchema, UspExecutePacketPlanSchema, UspPacketPlanSchema,
  UspPacketPlanConfirmationSchema, UspPacketPlanExecutionSchema, UspPacketPlanViewSchema,
  type PacketPlan, type PacketPlanInput } from '../../../../../contracts/src/usp/packets';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { readObject, putOriginal } from '../../../infrastructure/storage';
import { canonical, fingerprint } from '../../cases/domain';
import { assertLocalUsp } from '../snapshots';
import { lockDeclarationSiteTx } from '../declarations/authority';
import { requestReceiptTx } from '../commands';
import { appendUspOutboxTx } from '../outbox';
import { preparePacket0Artifact, registerPacket0Tx } from '../packet0';
import { assessPlanTx, assertAssessment, authorizePlanTx } from './plan-authority';
import { prepareSharedAuthority, SharedAuthorityNeeded, type SharedAuthority } from './plan-shared';

/** Test I/O transport is explicit and never accepted from HTTP input. */
export type PacketPlanIo = { read: typeof readObject; put: typeof putOriginal };
const storage: PacketPlanIo = { read: readObject, put: putOriginal };
async function withPlanAuthority<T>(ctx: RequestContext, action: (client: PoolClient, shared?: SharedAuthority) => Promise<T>) {
  try { return await transaction(client => action(client)); }
  catch (error) {
    if (!(error instanceof SharedAuthorityNeeded)) throw error;
    const shared = await prepareSharedAuthority(ctx, error.input);
    return transaction(client => action(client, shared));
  }
}
function validatePlan(raw: unknown) {
  const plan = UspPacketPlanSchema.parse(raw), { planSha256, ...body } = plan;
  if (fingerprint(body) !== planSha256) conflict('The immutable plan failed its integrity check.');
  for (const entry of plan.entries) {
    const { entrySha256, ...body } = entry;
    if (fingerprint(body) !== entrySha256) conflict('The immutable entry failed its integrity check.');
  }
  return plan;
}
function validateConfirmation(plan: PacketPlan, raw: unknown) {
  const confirmation = UspPacketPlanConfirmationSchema.parse(raw);
  if (confirmation.planId !== plan.planId || confirmation.version !== plan.version || confirmation.planSha256 !== plan.planSha256
    || canonical(confirmation.reviewer) !== canonical(plan.creator)) conflict('The confirmation does not match its immutable plan.');
  return confirmation;
}
function validateExecution(plan: PacketPlan, raw: unknown) {
  const execution = UspPacketPlanExecutionSchema.parse(raw), packet = execution.packet;
  const included = plan.entries.filter(e => e.state === 'included').map(e => e.selection.pointer);
  const omissions = plan.entries.filter(e => e.state === 'omitted_optional').map(e => ({ entrySha256: e.entrySha256, reasonCode: e.reasonCode! }));
  if (execution.planId !== plan.planId || execution.version !== plan.version
    || canonical(packet.target) !== canonical(plan.input.target) || canonical(packet.scope) !== canonical(plan.input.scope)
    || packet.format !== plan.input.format || packet.status !== 'complete' || packet.unavailable.length
    || canonical(packet.included) !== canonical(included) || canonical(execution.omissions) !== canonical(omissions))
    conflict('The execution does not match its immutable selection.');
  return execution;
}
async function loadTx(client: PoolClient, planId: string, version: number) {
  const row = (await client.query('SELECT body FROM usp_packet_plans WHERE id=$1 AND version=$2', [planId, version])).rows[0]
    ?? notFound('The exact packet plan version is unavailable.');
  const plan = validatePlan(row.body);
  if (plan.planId !== planId || plan.version !== version) conflict('The stored plan version changed.');
  return plan;
}
async function locksTx(client: PoolClient, siteId: string, planId?: string) {
  await lockDeclarationSiteTx(client, siteId);
  if (planId) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`packet-plan:${planId}`]);
}
async function liveTx(client: PoolClient, expiresAt: string) {
  if (!(await client.query('SELECT clock_timestamp() < $1::timestamptz AS live', [expiresAt])).rows[0]?.live)
    conflict('The unexecuted packet plan expired.');
}
async function headTx(client: PoolClient, plan: PacketPlan) {
  const row = (await client.query('SELECT max(version) AS version FROM usp_packet_plans WHERE id=$1', [plan.planId])).rows[0];
  if (Number(row?.version) !== plan.version) conflict('A newer immutable plan version exists.');
}
async function saveReceiptTx(client: PoolClient, ctx: RequestContext, siteId: string,
  operation: string, requestKey: string, hash: string, body: object) {
  await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), ctx.principal.subject, siteId, operation, requestKey, hash, body]);
}
async function planVersionTx(client: PoolClient, ctx: RequestContext, input: PacketPlanInput,
  planId: string, version: number, io: PacketPlanIo, shared?: SharedAuthority) {
  const expiry = Date.parse(input.expiresAt) - Date.now();
  if (expiry <= 0 || expiry > 24 * 60 * 60 * 1000)
    throw new AppError(422, 'PACKET_PLAN_EXPIRY', 'Use an expiry within the next 24 hours.');
  const assessment = await assessPlanTx(client, ctx, input, io.read, shared);
  const body = { planId, version, previousVersion: version === 1 ? null : version - 1, input,
    creator: ctx.principal, accessViewId: ctx.accessViewId, policyVersion: ctx.policyVersion,
    targetBodySha256: assessment.targetBodySha256, targetLabel: assessment.targetLabel,
    entries: assessment.entries, requiredContext: assessment.requiredContext, createdAt: new Date().toISOString() };
  const plan = UspPacketPlanSchema.parse({ ...body, planSha256: fingerprint(body) });
  await authorizePlanTx(client, ctx, plan);
  await liveTx(client, input.expiresAt);
  await client.query(`INSERT INTO usp_packet_plans(id,version,site_id,manifest_id,subject,body)
    VALUES($1,$2,$3,$4,$5,$6)`, [planId, version, input.scope.scopeId, input.scope.manifestId, ctx.principal.subject, plan]);
  return plan;
}
export async function createPacketPlan(ctx: RequestContext, raw: unknown, io: PacketPlanIo = storage) {
  assertLocalUsp(ctx);
  const command = UspCreatePacketPlanSchema.parse(raw), hash = fingerprint(command), operation = 'packet_plan_create';
  return withPlanAuthority(ctx, async (client, shared) => {
    await locksTx(client, command.input.scope.scopeId);
    const replay = await requestReceiptTx(client, ctx, command.input.scope.scopeId, operation, command.guard.requestKey, hash);
    if (replay) { const plan = validatePlan(replay); await authorizePlanTx(client, ctx, plan); return plan; }
    const plan = await planVersionTx(client, ctx, command.input, randomUUID(), 1, io, shared);
    await saveReceiptTx(client, ctx, command.input.scope.scopeId, operation, command.guard.requestKey, hash, plan);
    await appendUspOutboxTx(client, `packet-plan:${plan.planId}`, { type: 'packet.plan.created', scope: plan.input.scope,
      planId: plan.planId, version: plan.version, planSha256: plan.planSha256, correlationId: ctx.requestId });
    return plan;
  });
}
export async function revisePacketPlan(ctx: RequestContext, raw: unknown, io: PacketPlanIo = storage) {
  assertLocalUsp(ctx);
  const command = UspRevisePacketPlanSchema.parse(raw), hash = fingerprint(command), operation = 'packet_plan_revise';
  return withPlanAuthority(ctx, async (client, shared) => {
    const old = await loadTx(client, command.planId, command.guard.expectedVersion);
    if (!equalTarget(old, command.input) || old.input.scope.scopeId !== command.input.scope.scopeId)
      throw new AppError(422, 'PACKET_PLAN_RETARGET', 'Create a separate plan for another exact target.');
    await locksTx(client, old.input.scope.scopeId, old.planId);
    const replay = await requestReceiptTx(client, ctx, old.input.scope.scopeId, operation, command.guard.requestKey, hash);
    if (replay) { const plan = validatePlan(replay); await authorizePlanTx(client, ctx, plan); return plan; }
    await authorizePlanTx(client, ctx, old);
    if (command.guard.expectedManifestId !== old.input.scope.manifestId) conflict('The revision guard names another snapshot.');
    await headTx(client, old);
    const plan = await planVersionTx(client, ctx, command.input, old.planId, old.version + 1, io, shared);
    await saveReceiptTx(client, ctx, old.input.scope.scopeId, operation, command.guard.requestKey, hash, plan);
    await appendUspOutboxTx(client, `packet-plan:${plan.planId}`, { type: 'packet.plan.revised', scope: plan.input.scope,
      planId: plan.planId, version: plan.version, planSha256: plan.planSha256, correlationId: ctx.requestId });
    return plan;
  });
}
function equalTarget(plan: PacketPlan, input: PacketPlanInput) { return canonical(plan.input.target) === canonical(input.target); }
export async function readPacketPlan(ctx: RequestContext, raw: unknown) {
  assertLocalUsp(ctx);
  const command = UspReadPacketPlanSchema.parse(raw);
  return transaction(async client => {
    const plan = await loadTx(client, command.planId, command.version);
    await authorizePlanTx(client, ctx, plan);
    const confirmationBody = (await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',
      [plan.planId, plan.version])).rows[0]?.body ?? null;
    const executionBody = (await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2',
      [plan.planId, plan.version])).rows[0]?.body ?? null;
    await authorizePlanTx(client, ctx, plan);
    const confirmation = confirmationBody ? validateConfirmation(plan, confirmationBody) : null;
    const execution = executionBody ? validateExecution(plan, executionBody) : null;
    if (execution && execution.confirmationId !== confirmation?.confirmationId) conflict('The execution confirmation is unavailable.');
    return UspPacketPlanViewSchema.parse({ plan, confirmation, execution });
  });
}
export async function confirmPacketPlan(ctx: RequestContext, raw: unknown, io: PacketPlanIo = storage) {
  assertLocalUsp(ctx);
  const command = UspConfirmPacketPlanSchema.parse(raw), hash = fingerprint(command), operation = 'packet_plan_confirm';
  return withPlanAuthority(ctx, async (client, shared) => {
    const plan = await loadTx(client, command.planId, command.version);
    await locksTx(client, plan.input.scope.scopeId, plan.planId);
    const replay = await requestReceiptTx(client, ctx, plan.input.scope.scopeId, operation, command.guard.requestKey, hash);
    await authorizePlanTx(client, ctx, plan);
    if (replay) return validateConfirmation(plan, replay);
    if (command.guard.expectedVersion !== plan.version || command.guard.expectedManifestId !== plan.input.scope.manifestId
      || command.planSha256 !== plan.planSha256) conflict('Review the exact immutable plan version and snapshot.');
    await headTx(client, plan);
    const existing = (await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',
      [plan.planId, plan.version])).rows[0];
    if (existing) conflict('This exact version is already confirmed; reuse its confirmation request.');
    const assessment = await assessPlanTx(client, ctx, plan.input, io.read, shared);
    assertAssessment(plan, assessment);
    if (plan.requiredContext !== 'available' || !assessment.lines.length)
      throw new AppError(422, 'PACKET_PLAN_BLOCKED', 'Review required unavailable context and include at least one supported exact part.');
    await liveTx(client, plan.input.expiresAt);
    const confirmation = UspPacketPlanConfirmationSchema.parse({ confirmationId: randomUUID(), planId: plan.planId,
      version: plan.version, planSha256: plan.planSha256, reviewer: ctx.principal, reviewed: true, confirmedAt: new Date().toISOString() });
    await client.query(`INSERT INTO usp_packet_plan_confirmations(id,plan_id,version,subject,body) VALUES($1,$2,$3,$4,$5)`,
      [confirmation.confirmationId, plan.planId, plan.version, ctx.principal.subject, confirmation]);
    await saveReceiptTx(client, ctx, plan.input.scope.scopeId, operation, command.guard.requestKey, hash, confirmation);
    await appendUspOutboxTx(client, `packet-plan:${plan.planId}`, { type: 'packet.plan.confirmed', scope: plan.input.scope,
      planId: plan.planId, version: plan.version, confirmationId: confirmation.confirmationId, correlationId: ctx.requestId });
    return confirmation;
  });
}
export async function executePacketPlan(ctx: RequestContext, raw: unknown, io: PacketPlanIo = storage) {
  assertLocalUsp(ctx);
  const command = UspExecutePacketPlanSchema.parse(raw), hash = fingerprint(command), operation = 'packet_plan_execute';
  return withPlanAuthority(ctx, async (client, shared) => {
    const plan = await loadTx(client, command.planId, command.version);
    await locksTx(client, plan.input.scope.scopeId, plan.planId);
    const replay = await requestReceiptTx(client, ctx, plan.input.scope.scopeId, operation, command.guard.requestKey, hash);
    await authorizePlanTx(client, ctx, plan);
    if (replay) return validateExecution(plan, replay);
    const accepted = (await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2',
      [plan.planId, plan.version])).rows[0];
    if (accepted) {
      conflict('This version already executed; reuse its original execution request key.');
    }
    await headTx(client, plan);
    const row = (await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',
      [plan.planId, plan.version])).rows[0] ?? notFound('Confirm this exact version before execution.');
    const confirmation = validateConfirmation(plan, row.body);
    if (confirmation.confirmationId !== command.confirmationId || confirmation.planSha256 !== plan.planSha256)
      conflict('The confirmation does not cover this exact plan.');
    await liveTx(client, plan.input.expiresAt);
    const assessment = await assessPlanTx(client, ctx, plan.input, io.read, shared); assertAssessment(plan, assessment);
    if (plan.requiredContext !== 'available' || !assessment.lines.length)
      throw new AppError(422, 'PACKET_PLAN_BLOCKED', 'Required context is unavailable.');
    const artifact = await preparePacket0Artifact({ id: plan.input.target.ref.id, label: plan.targetLabel },
      assessment.lines, plan.input.format, io.put);
    // Recheck after object I/O before any publication. The same client/locks protect all records and links.
    const final = await assessPlanTx(client, ctx, plan.input, io.read, shared); assertAssessment(plan, final);
    await authorizePlanTx(client, ctx, plan); await liveTx(client, plan.input.expiresAt);
    const packet = await registerPacket0Tx(client, ctx, { scope: plan.input.scope, target: plan.input.target,
      evidence: final.lines.map(l => l.pointer), format: plan.input.format, guard: command.guard }, final.lines, artifact, hash);
    const result = UspPacketPlanExecutionSchema.parse({ planId: plan.planId, version: plan.version,
      confirmationId: confirmation.confirmationId, packet, omissions: plan.entries.filter(e => e.state === 'omitted_optional')
        .map(e => ({ entrySha256: e.entrySha256, reasonCode: e.reasonCode! })) });
    await client.query(`INSERT INTO usp_packet_plan_executions(plan_id,version,confirmation_id,packet_id,body) VALUES($1,$2,$3,$4,$5)`,
      [plan.planId, plan.version, confirmation.confirmationId, packet.packetId, result]);
    await saveReceiptTx(client, ctx, plan.input.scope.scopeId, operation, command.guard.requestKey, hash, result);
    await appendUspOutboxTx(client, `packet-plan:${plan.planId}`, { type: 'packet.plan.executed', scope: plan.input.scope,
      planId: plan.planId, version: plan.version, packetId: packet.packetId, artifactSha256: packet.artifact.sha256, correlationId: ctx.requestId });
    return result;
  });
}
