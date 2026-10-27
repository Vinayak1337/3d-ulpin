import type { PoolClient } from 'pg';
import type { TabularPin } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { fingerprint } from '../../cases/domain';
import { USP_JOB_LIMITS } from '../jobs';
import { AppError } from '../../../infrastructure/errors';
import { assertIntakeDraftTx, intakeDraftKey, type IntakeDraftInput } from './intake-draft';
import { ManualIngestionService } from './service';
import { StreamingVectorService, streamingReaderSha } from './streaming-vector';
import { ChunkMappingService } from './chunk-mapping';

/** Superseded work ends only its job, never the newer reading, placement or recipe. Case locks come first. */
async function currentTx(client: PoolClient, input: IntakeDraftInput) {
  const context = await assertIntakeDraftTx(client, input);
  const { item, source } = context;
  const selection = source.inspection?.manualProfile?.tabular?.selection;
  if (!item.plan_ref && item.placement === 'undecided' && ['probed', 'reading'].includes(item.state)
    && (!selection || Object.entries(input.tableSelection ?? {}).every(([key, value]) =>
      fingerprint({ value: selection[key] }) === fingerprint({ value })))) return context;
  await supersededTx(client, input);
  return null;
}

async function supersededTx(client: PoolClient, input: IntakeDraftInput) {
  const stopped = await client.query(`UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1
    AND status IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now()) RETURNING id`, [input.jobId, 'stale', 'TABLE_DRAFT_SUPERSEDED']);
  if (stopped.rowCount) await client.query(
    "UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1", [input.jobId]);
}

/** Reuse exact receipts, including old unversioned keys, but never an obsolete raw reader or reading. */
async function admission(input: IntakeDraftInput, kind: 'streaming-vector' | 'chunk-mapping',
  tabular: TabularPin, readerSha256: string, rawJobId?: string) {
  return transaction(async client => {
    const context = await currentTx(client, input);
    if (!context) return null;
    if (fingerprint(context.source.inspection?.manualProfile?.tabular ?? null) !== fingerprint(tabular))
      throw new AppError(409, 'STALE_REVISION', 'The table reading changed during admission.');
    const current = (await client.query(`SELECT c.revision,r.revision AS recipe_revision,r.state AS recipe_state
      FROM cases c LEFT JOIN usp_mapping_recipes r ON r.source_id=$2 WHERE c.id=$1`,
    [input.caseId, input.sourceId])).rows[0];
    if (current.recipe_revision > input.recipeRevision && ['approved', 'executed'].includes(current.recipe_state)) {
      await supersededTx(client, input);
      return null;
    }
    const legacy = intakeDraftKey(input.itemId, 0, `table-${kind}`);
    const pins = fingerprint({ readerSha256, tabular, sourcePin: input.sourcePin, rawJobId });
    const requestKey = intakeDraftKey(input.itemId, 0, `table-${kind}:${pins}`);
    const receipts = (await client.query(`SELECT o.result,j.payload FROM operations o
      LEFT JOIN jobs j ON j.id::text=o.result->>'jobId' WHERE o.case_id=$1
      AND o.operation_key=ANY($2::text[]) AND o.kind=$3`,
    [input.caseId, [`${kind}:${requestKey}`, `${kind}:${legacy}`], kind])).rows;
    const prior = receipts.find(row => row.payload?.readerSha256 === readerSha256
      && fingerprint(row.payload.tabular) === fingerprint(tabular)
      && (!rawJobId || row.payload.rawJobId === rawJobId));
    return { jobId: prior?.result.jobId as string | undefined, request: { requestKey,
      expectedCaseRevision: current.revision, expectedSourceRevision: input.sourceRevision,
      sourceSha256: input.sourceSha256 } };
  });
}

/** No lease or dispatcher slot is held. Only a revision refusal spends the durable preclaim retry bound: a capacity
 * wait ends when a slot frees, never on a capacity refusal (S1.3a). */
async function wait(input: IntakeDraftInput, cause = 'TABLE_READ_PENDING'): Promise<false> {
  await transaction(async client => {
    if (!await currentTx(client, input)) return;
    const retry = cause === 'STALE_REVISION';
    const job = (await client.query(`UPDATE jobs SET next_attempt_at=now()+interval '2 seconds',error=$2,
      attempts=attempts+CASE WHEN $3::boolean THEN 1 ELSE 0 END
      WHERE id=$1 AND status IN ('queued','running') AND NOT EXISTS (
        SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now())
      RETURNING attempts`, [input.jobId, cause, retry])).rows[0];
    if (retry && job?.attempts >= USP_JOB_LIMITS.maxAttempts)
      throw new AppError(422, `TABLE_ADMISSION_${cause}_EXHAUSTED`,
        `Table admission stopped after ${USP_JOB_LIMITS.maxAttempts} tries: ${cause}. The original is kept.`);
  });
  return false;
}

/** Only queues proposals. The existing mapping job retains its teacher policy and officer-review boundary. */
async function prepare(input: IntakeDraftInput): Promise<boolean> {
  const manual = new ManualIngestionService();
  const alreadyRead = await transaction(async client => {
    const context = await currentTx(client, input);
    return context ? context.source.inspection?.manualProfile?.version === 'manual-tabular/1' : null;
  });
  if (alreadyRead === null) return false;
  const answer = alreadyRead ? await manual.inspectAny(input.caseId, input.sourceId)
    : await manual.tableFromOriginal(input.caseId, input.sourceId, {
      requestKey: intakeDraftKey(input.itemId, 0, 'table-read'), expectedWorkspaceRevision: input.caseRevision,
      selection: input.tableSelection,
    }, input);
  if (answer.version === 'table-profile/1' && ['queued', 'running'].includes(answer.status)) return wait(input);
  if (answer.version === 'table-profile/1' && answer.status !== 'succeeded')
    throw new AppError(422, answer.issueCode ?? 'TABLE_READ_STOPPED', answer.message ?? 'Reading the table stopped.');
  const profile = answer.version === 'table-profile/1'
    ? await manual.inspectAny(input.caseId, input.sourceId) : answer;
  if (profile.version !== 'manual-tabular/1')
    throw new AppError(422, 'TABLE_PROFILE_REQUIRED', 'The original has no table reading.');
  const readerSha256 = streamingReaderSha();
  const raw = await admission(input, 'streaming-vector', profile.tabular, readerSha256);
  if (!raw) return false;
  const rawJobId = raw.jobId ?? (await new StreamingVectorService().enqueue(input.caseId, input.sourceId, {
    ...raw.request, framing: 'tabular', tabular: profile.tabular,
  })).jobId;
  const mapping = await admission(input, 'chunk-mapping', profile.tabular, readerSha256, rawJobId);
  if (!mapping) return false;
  if (!mapping.jobId) await new ChunkMappingService().enqueue(input.caseId, input.sourceId, {
    ...mapping.request, rawJobId, tabular: profile.tabular,
  });
  return true;
}

/** Short, replayable command admission precedes the draft job's fenced publication, as extraction waits do. */
export async function prepareIntakeTable(input: IntakeDraftInput): Promise<boolean> {
  try {
    return await prepare(input);
  } catch (error) {
    // A concurrent batch arrival can change admission's revision; reassert exact source/access pins before waiting.
    if (error instanceof AppError && (error.code === 'STALE_REVISION'
      || ['STREAMING_CAPACITY', 'MAPPING_CAPACITY'].includes(error.code))) return wait(input, error.code);
    throw error;
  }
}
