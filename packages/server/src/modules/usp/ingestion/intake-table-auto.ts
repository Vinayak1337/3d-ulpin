import { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { assertIntakeDraftTx, intakeDraftKey, type IntakeDraftInput } from './intake-draft';
import { ManualIngestionService } from './service';
import { StreamingVectorService } from './streaming-vector';
import { ChunkMappingService } from './chunk-mapping';

/** These commands already own their durable admission. Inspect their receipts before replaying with a newer case. */
async function admission(input: IntakeDraftInput, kind: 'streaming-vector' | 'chunk-mapping') {
  return transaction(async client => {
    await assertIntakeDraftTx(client, input);
    const requestKey = intakeDraftKey(input.itemId, 0, `table-${kind}`);
    const prior = (await client.query(`SELECT result FROM operations WHERE case_id=$1
      AND operation_key=$2 AND kind=$3`, [input.caseId, `${kind}:${requestKey}`, kind])).rows[0];
    const current = (await client.query('SELECT revision FROM cases WHERE id=$1', [input.caseId])).rows[0];
    return { jobId: prior?.result.jobId as string | undefined, request: { requestKey,
      expectedCaseRevision: current.revision, expectedSourceRevision: input.sourceRevision,
      sourceSha256: input.sourceSha256 } };
  });
}

/** Waiting for another reader or an admission slot consumes no attempt and holds no dispatcher slot or lease. */
async function wait(input: IntakeDraftInput): Promise<false> {
  await transaction(async client => {
    await assertIntakeDraftTx(client, input);
    await client.query(`UPDATE jobs SET next_attempt_at=now()+interval '2 seconds'
      WHERE id=$1 AND status='queued'`, [input.jobId]);
  });
  return false;
}

/** Only queues proposals. The existing mapping job retains its teacher policy and officer-review boundary. */
async function prepare(input: IntakeDraftInput): Promise<boolean> {
  const manual = new ManualIngestionService();
  const alreadyRead = await transaction(async client => {
    const { source } = await assertIntakeDraftTx(client, input);
    return source.inspection?.manualProfile?.version === 'manual-tabular/1';
  });
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
  const raw = await admission(input, 'streaming-vector');
  const rawJobId = raw.jobId ?? (await new StreamingVectorService().enqueue(input.caseId, input.sourceId, {
    ...raw.request, framing: 'tabular', tabular: profile.tabular,
  })).jobId;
  const mapping = await admission(input, 'chunk-mapping');
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
      || ['STREAMING_CAPACITY', 'MAPPING_CAPACITY'].includes(error.code))) return wait(input);
    throw error;
  }
}
