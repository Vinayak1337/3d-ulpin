import type { PoolClient } from 'pg';
import { ChunkMappingPayloadSchema, TabularRawRowSchema, type ChunkMappingInput,
  type ChunkMappingPayload, type StreamingVectorPayload } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localRequestContext } from '../principal';
import { assertUspJobAttemptTx, type UspJobAttempt } from '../jobs';
import { appendCaseIngestionTx } from './events';
import { assertChunkMappingInputTx } from './chunk-mapping';
import { TabularChunkMapper, type TabularChunkDraft } from './chunk-mapping-agent';
import { tabularLearningPaths, activeTabularLearner, learnApprovedTabularTx } from './chunk-mapping-learning';

type Stored = { payload: ChunkMappingPayload; bytes: number; hash: string; key: string };
type Store = (payload: ChunkMappingPayload) => Promise<Stored>;

/** Slot, watermark and SSE metric enter the existing transaction together under the current attempt fence. */
export async function publishTabularMappingTx(
  client: PoolClient, input: ChunkMappingInput, attempt: UspJobAttempt, stored: Stored,
  firstIndex: number, rawHash: string,
) {
  await assertChunkMappingInputTx(client, input);
  await assertUspJobAttemptTx(client, attempt);
  const state = (await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if (!state || state.state !== 'running' || state.next_publish_index !== stored.payload.chunkIndex ||
      state.records !== firstIndex) conflict('The tabular mapping watermark changed.');
  const raw = (await client.query('SELECT result_sha256,published FROM usp_streaming_vector_slots ' +
    'WHERE job_id=$1 AND source_revision=$2 AND chunk_index=$3 FOR SHARE',
  [input.rawJobId, input.sourceRevision, stored.payload.chunkIndex])).rows[0];
  if (!raw?.published || raw.result_sha256 !== rawHash) conflict('The raw tabular chunk changed.');
  const mapping = stored.payload.mapping!;
  await client.query(`INSERT INTO usp_chunk_mapping_slots(job_id,chunk_index,status,published,raw_result_sha256,
    schema_fingerprint,first_feature_index,last_feature_index,records,normalized,quarantined,unresolved,bytes,
    object_key,object_sha256,result_sha256,attempt,fence)
    VALUES($1,$2,'ready',true,$3,$4,$5,$6,$7,0,0,$7,$8,$9,$10,$10,$11,$12)`,
  [input.jobId, stored.payload.chunkIndex, rawHash, stored.payload.schemaFingerprint, firstIndex,
    firstIndex + mapping.rows.length - 1, mapping.rows.length, stored.bytes, stored.key, stored.hash,
    attempt.number, attempt.fence]);
  await client.query(`UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1,
    records=records+$2,unresolved=unresolved+$2,updated_at=now() WHERE job_id=$1`, [input.jobId, mapping.rows.length]);
  await appendCaseIngestionTx(client, input.caseId, mapping.metrics, input.subject);
}

/** Native unavailable cells remain unknown, regardless of a mechanically executable proposed operation. */
function markUnavailableCells(draft: TabularChunkDraft, items: ReturnType<typeof TabularRawRowSchema.parse>[]) {
  for (const [index, row] of draft.dryRun.rows.entries()) {
    for (const [column, cell] of row.fields.entries()) {
      if (items[index].cells[column].state !== 'unknown') continue;
      cell.state = 'unknown';
      cell.value = null;
      delete cell.literal;
      cell.issueCode = 'TABULAR_CELL_UNAVAILABLE';
      if (!draft.questions.some(question => question.sourceField === cell.sourceField)) {
        draft.questions.push({ sourceField: cell.sourceField, header: items[index].headers[column],
          reason: cell.issueCode, candidates: [] });
      }
    }
  }
}

function tabularPayload(input: ChunkMappingInput, raw: StreamingVectorPayload, rawHash: string,
  draft: TabularChunkDraft, items: ReturnType<typeof TabularRawRowSchema.parse>[]) {
  return ChunkMappingPayloadSchema.parse({ version: input.version, jobId: input.jobId,
    rawJobId: input.rawJobId, sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, chunkIndex: raw.chunkIndex, rawResultSha256: rawHash,
    schemaFingerprint: input.schemaFingerprint, recipeRevision: input.recipeRevision,
    converterSha256: input.converterSha256, tabular: input.tabular, records: [], mapping: {
      profile: draft.profile, plan: draft.proposal.plan, fieldSources: draft.proposal.fieldSources,
      questions: draft.questions, metrics: draft.metrics,
      rows: draft.dryRun.rows,
      sourceRows: items.map(item => item.sourceRow),
    } });
}

async function tabularRoutingContext(input: ChunkMappingInput, attempt: UspJobAttempt) {
  return transaction(async client => {
    const current = await assertChunkMappingInputTx(client, input);
    await assertUspJobAttemptTx(client, attempt);
    const model = await activeTabularLearner(client);
    if (current.approved?.receipt.plan.version === 'manual-tabular/1' && input.route === 'approved_recipe') {
      await learnApprovedTabularTx(client, current.approved.receipt, current.approved.profile, current.ctx.source);
      await assertUspJobAttemptTx(client, attempt);
    }
    return { ...current, model };
  });
}

export async function acceptTabularDataSlot(
  input: ChunkMappingInput, attempt: UspJobAttempt, raw: StreamingVectorPayload, rawHash: string,
  mapper: TabularChunkMapper, store: Store,
) {
  if (!raw.records.length || raw.records.some(record => record.disposition !== 'accepted')) {
    throw new AppError(422, 'MAPPING_TABULAR_RAW_REFUSED', 'The raw reader refused a complete tabular record.');
  }
  const context = await tabularRoutingContext(input, attempt);
  const items = raw.records.map(record => TabularRawRowSchema.parse(record.feature));
  const headers = items[0].headers;
  if (items.some(item => fingerprint(item.headers) !== fingerprint(headers) ||
      item.sheet !== input.tabular!.selection.sheet || item.cells.length !== headers.length)) {
    conflict('A tabular chunk differs from its pinned header layout.');
  }
  const approved = context.approved?.receipt.plan;
  const draft = await mapper.map({ jobId: input.jobId, chunkIndex: raw.chunkIndex, headers,
    rows: items.map(item => item.cells.map(cell => cell.state === 'literal' ? cell.value : undefined)),
    rowOffset: raw.records[0].featureIndex, selection: input.tabular!.selection,
    sourceRef: `source:${input.sourceId}?sheet=${input.tabular!.selection.sheet}` }, {
    context: localRequestContext('tabular-mapping'), dataPolicy: { dataClass: 'public', split: 'development' },
    memoryPath: tabularLearningPaths().memory,
    learnerModelPath: context.model, authorize: async () => transaction(async client => {
      await assertChunkMappingInputTx(client, input);
      await assertUspJobAttemptTx(client, attempt);
    }), invocationKey: `${input.jobId}-${raw.chunkIndex}`,
    ...(input.route === 'approved_recipe' && approved?.version === 'manual-tabular/1'
      ? { approvedPlan: approved.mapping } : {}),
  });
  markUnavailableCells(draft, items);
  const payload = tabularPayload(input, raw, rawHash, draft, items);
  const stored = await store(payload);
  await transaction(client => publishTabularMappingTx(client, input, attempt, stored,
    raw.records[0].featureIndex, rawHash));
}
