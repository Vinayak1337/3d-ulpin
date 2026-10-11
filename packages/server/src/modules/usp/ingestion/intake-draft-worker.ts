import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MappingPlanSchema, type MappingPlan, type MappingReceipt,
  type SourceProfile } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { claimUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt, type UspJobAttempt } from '../jobs';
import { getPackage } from '../../areas/areas';
import { intakeDestination, intakeCaseArea } from './intake-destination';
export { intakeDestination } from './intake-destination';
import { ManualIngestionService } from './service';
import { AdaptiveMappingService } from './adaptive-mapping-service';
import { compileMapping } from './registry';
import { IntakeDraftInputSchema, assertIntakeDraftTx, intakeDraftKey, queueIntakeDraftTx,
  type IntakeDraftInput } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx, type IntakeDraftState } from './intake-ledger';
import { createIntakeTargetsTx } from './intake-targets';

const manual = new ManualIngestionService();
const adaptive = new AdaptiveMappingService();
type Origin = 'memory' | 'teacher' | 'officer';
type Proposal = { plan: MappingPlan; origin: Origin };
const noLayout = 'No approved layout matches this file. An officer states what each feature is and which field identifies it.';
const otherSite = "Use an area of this batch's site or place the file in a separate intake batch.";

function memoryPlan(profile: SourceProfile, remembered: MappingReceipt | null): MappingPlan | null {
  if (!remembered || !['approved', 'executed'].includes(remembered.state)
    || remembered.approval?.subject !== localOperatorSubject()
    || remembered.plan.source.schemaFingerprint !== profile.source.schemaFingerprint) return null;
  const parsed = MappingPlanSchema.safeParse({ version: profile.version, mode: 'manual_mapping',
    source: profile.source, caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint, operations: remembered.plan.operations,
    ...(remembered.plan.kind === undefined ? {} : { kind: remembered.plan.kind }),
    ...(remembered.plan.heightField === undefined ? {} : { heightField: remembered.plan.heightField,
      heightUnit: remembered.plan.heightUnit, heightMeaning: remembered.plan.heightMeaning }) });
  if (!parsed.success) return null;
  try {
    compileMapping(parsed.data, profile);
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError && error.status === 422) return null;
    throw error;
  }
}

/** Reuse operations, never approval. The existing adaptive service owns every gateway policy/refusal. */
export async function proposeIntakeLayout(profile: SourceProfile, remembered: MappingReceipt | null,
  requestKey: string, teacher = () => adaptive.propose(profile.caseId, profile.source.sourceId, {
    requestKey, source: profile.source, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint,
  })): Promise<Proposal | null> {
  const plan = memoryPlan(profile, remembered);
  if (plan) return { plan, origin: 'memory' };
  const response = await teacher();
  if (response.status !== 'proposed' || !response.plan) return null;
  return { plan: response.plan, origin: 'teacher' };
}

async function pinned<T>(input: IntakeDraftInput, attempt: UspJobAttempt,
  work: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async client => {
    await assertIntakeDraftTx(client, input);
    await assertUspJobAttemptTx(client, attempt);
    return work(client);
  });
}

async function recipe(input: IntakeDraftInput, attempt: UspJobAttempt): Promise<MappingReceipt | null> {
  return pinned(input, attempt, async client => (await client.query(
    'SELECT body FROM usp_mapping_recipes WHERE source_id=$1', [input.sourceId])).rows[0]?.body ?? null);
}

async function preparedProposal(input: IntakeDraftInput, attempt: UspJobAttempt, profile: SourceProfile) {
  const key = `intake-draft-plan:${input.jobId}`;
  const previous = await pinned(input, attempt, async client => (await client.query(
    "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='intake-draft'",
    [input.caseId, key])).rows[0]?.result as Proposal | undefined);
  if (previous) return previous;
  const remembered = await pinned(input, attempt, async client => (await client.query(`SELECT body
    FROM usp_mapping_recipes WHERE state IN ('approved','executed') AND body->'approval'->>'subject'=$1
    AND body->'plan'->'source'->>'schemaFingerprint'=$2 ORDER BY body->'approval'->>'at' DESC,id DESC LIMIT 1`,
  [input.subject, profile.source.schemaFingerprint])).rows[0]?.body ?? null);
  const proposal = await proposeIntakeLayout(profile, remembered, intakeDraftKey(input.itemId, 0, 'propose'));
  if (!proposal) return null;
  await pinned(input, attempt, async client => {
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'intake-draft',$3,$4) ON CONFLICT DO NOTHING`,
    [input.caseId, key, fingerprint(input), proposal]);
  });
  return proposal;
}

/** The refusals an officer answers: the file belongs elsewhere, or the area cannot hold it. */
export function officerQuestion(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  if (error.code === 'AREA_SOURCE_DENIED') return otherSite;
  if (error.code === 'AREA_PROCESSING' && error.status === 422) return error.message.slice(0, 2000);
  return null;
}

async function proposeRecipe(input: IntakeDraftInput, attempt: UspJobAttempt): Promise<MappingReceipt | null> {
  const profile = await manual.inspect(input.caseId, input.sourceId);
  const proposal = await preparedProposal(input, attempt, profile);
  if (!proposal) return null;
  const { source } = await pinned(input, attempt, client => assertIntakeDraftTx(client, input));
  const gis = source.inspection?.gis;
  if (!gis?.suggestedTitle || !gis?.suggestedNamespace) return null;
  const existing = await recipe(input, attempt);
  if (existing) return existing;
  try {
    return await manual.author(input.caseId, input.sourceId, {
      requestKey: intakeDraftKey(input.itemId, 0, 'author'), expectedRecipeRevision: 0, plan: proposal.plan,
      destination: intakeDestination(gis, await intakeCaseArea(input.caseId, (sql, values) =>
        pinned(input, attempt, async client => (await client.query(sql, values)).rows[0]))),
    }) as MappingReceipt;
  } catch (error) {
    // An officer may author/approve while the permitted proposal call is in flight.
    if (!(error instanceof AppError) || error.code !== 'STALE_REVISION') throw error;
    const winner = await recipe(input, attempt);
    if (!winner) throw error;
    return winner;
  }
}

async function origin(input: IntakeDraftInput, attempt: UspJobAttempt, receipt: MappingReceipt): Promise<Origin> {
  return pinned(input, attempt, async client => {
    const authored = (await client.query(`SELECT result FROM operations WHERE case_id=$1
      AND operation_key=$2 AND kind='manual-mapping'`,
    [input.caseId, `manual-author:${intakeDraftKey(input.itemId, 0, 'author')}`])).rows[0]?.result;
    if (authored?.id !== receipt.id || authored.planHash !== receipt.planHash) return 'officer';
    const state = await readIntakeDraftTx(client, input.caseId, input.itemId);
    if (state.planRef?.origin === 'memory' || state.planRef?.origin === 'teacher') return state.planRef.origin;
    const row = (await client.query(
      "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='intake-draft'",
      [input.caseId, `intake-draft-plan:${input.jobId}`])).rows[0];
    return row?.result?.origin ?? 'officer';
  });
}

async function transition(input: IntakeDraftInput, attempt: UspJobAttempt, receipt: MappingReceipt | null,
  state: IntakeDraftState['state'], packageId?: string) {
  const from = receipt ? await origin(input, attempt, receipt) : null;
  const pkg = packageId ? await getPackage(packageId) : null;
  if (pkg && !pkg.sourceRevisionIds.includes(input.sourceId)) conflict('The draft package cites a different source.');
  await pinned(input, attempt, async client => {
    await writeIntakeDraftTx(client, input.caseId, input.itemId, {
      state, placement: pkg ? 'on_map' : receipt ? 'undecided' : 'needs_answer',
      planRef: receipt ? { recipeId: receipt.id, recipeRevision: receipt.revision, recipeState: receipt.state,
        origin: from, ...(pkg ? { packageId: pkg.id } : {}) } : null,
      recordsSeen: pkg?.features.length ?? 0, limitReason: receipt ? null : noLayout,
    });
    if (state === 'read' && pkg) await createIntakeTargetsTx(client, input.caseId, input.itemId, pkg, input.sourceId);
  });
}

async function advance(input: IntakeDraftInput, attempt: UspJobAttempt) {
  let current = await recipe(input, attempt);
  if (!current) current = await proposeRecipe(input, attempt);
  if (!current) {
    await transition(input, attempt, null, 'probed');
    return;
  }
  if (current.state === 'executed') {
    await transition(input, attempt, current, 'read', current.execution!.packageId);
    return;
  }
  await transition(input, attempt, current, 'planned');
  if (current.state === 'proposed') return;
  if (current.approval?.subject !== input.subject || localOperatorSubject() !== input.subject)
    throw new AppError(403, 'SOURCE_OPERATOR', 'Execution requires the approving local operator.');
  await transition(input, attempt, current, 'reading');
  current = await manual.decide(input.caseId, current.id, {
    requestKey: intakeDraftKey(input.itemId, current.revision, 'execute'), expectedRecipeRevision: current.revision,
  }, 'execute') as MappingReceipt;
  await transition(input, attempt, current, 'read', current.execution!.packageId);
}

async function complete(input: IntakeDraftInput, attempt: UspJobAttempt) {
  const result = await pinned(input, attempt, client => readIntakeDraftTx(client, input.caseId, input.itemId));
  await acceptUspJobAttempt(attempt,
    { assetId: `intake-draft:${input.itemId}`, version: 1, sha256: fingerprint(result) },
    async (client, job, asset) => {
      const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
      if (fingerprint(job.payload) !== fingerprint(input) || asset.sha256 !== fingerprint(current))
        conflict('The intake draft completion changed.');
      await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
        VALUES($1,$2,'intake-draft',$3,$4) ON CONFLICT DO NOTHING`,
      [input.caseId, `intake-draft-result:${input.jobId}`, fingerprint(input), current]);
    }, client => assertIntakeDraftTx(client, input).then(() => {}), async client => {
      const { source } = await assertIntakeDraftTx(client, input);
      const latest = (await client.query('SELECT state FROM usp_mapping_recipes WHERE source_id=$1',
        [input.sourceId])).rows[0];
      if (latest?.state === 'approved' && result.state !== 'read') await queueIntakeDraftTx(client, source);
    });
}

async function fail(input: IntakeDraftInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'INTAKE_DRAFT_FAILED';
  const question = officerQuestion(error);
  await transaction(async client => {
    // Source changes must terminate the job without rewriting the item or any recipe.
    const { lockSourceCaseDestinationTx } = await import('../../cases/source-case-lock');
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    if (question) {
      const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
      await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'planned',
        placement: 'needs_answer', limitReason: question,
      });
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
  });
}

async function unclaimedFailure(input: IntakeDraftInput, error: unknown) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, error.code === 'STALE_REVISION' ? 'stale' : 'failed', error.code]);
  });
}

/** Existing dispatcher and fenced authority own scheduling and durable recovery. */
export async function runIntakeDraftJob(jobId: string) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-draft'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeDraftInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-draft:${randomUUID()}`,
      client => assertIntakeDraftTx(client, input).then(() => {}));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    await advance(input, attempt);
    await complete(input, attempt);
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  }
}
