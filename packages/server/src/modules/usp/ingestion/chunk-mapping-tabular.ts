import type { PoolClient } from 'pg';
import { ChunkMappingPayloadSchema, STREAMING_VECTOR_LIMITS, TABULAR_LIMITS, TabularRawRowSchema,
  type ChunkMappingInput, type ChunkMappingPayload, type StreamingVectorPayload, type TableMappedCell,
  type TabularMappingPlan, type TabularPin, type TabularSourceProfile } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { localRequestContext } from '../principal';
import { assertUspJobAttemptTx, type UspJobAttempt } from '../jobs';
import { appendCaseIngestionTx } from './events';
import { assertChunkMappingInputTx } from './chunk-mapping';
import { TabularChunkMapper, mappingQuestions, type TabularChunkDraft } from './chunk-mapping-agent';
import { tabularLearningPaths, activeTabularLearner, learnApprovedTabularTx } from './chunk-mapping-learning';
import { manualTeacherPlan, mappingContextFromColumnProfile, proposeMappingWithTeacher,
  type TeacherDataPolicy } from './mapping-teacher';
import { caseOriginalTeacherGate } from './adaptive-mapping-service';
import { executeMappingPlanV2, MappingPlanValidationError } from './mapping-executor';
import { readTableWindowTx, type StoredWindow } from './table-windows';
import { unavailableColumns } from './tabular-stream';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';

type Stored = { payload: ChunkMappingPayload; bytes: number; hash: string; key: string };
type Store = (payload: ChunkMappingPayload) => Promise<Stored>;
type TableMeaningsState = 'ready' | 'unavailable' | { failed: string };

/** Called under the mapping job's case/source locks and fence; never replaces newer work or officer placement. */
export async function settleTableMeaningsTx(client: PoolClient, input: ChunkMappingInput,
  meanings: TableMeaningsState) {
  if (!input.tabular || input.route !== 'proposal_only') return;
  const item = (await client.query(`SELECT i.item_id FROM usp_intake_items i JOIN sources s ON s.id=i.source_id
    WHERE i.case_id=$1 AND i.source_id=$2 AND i.parent_item_id IS NULL AND i.family='table'
    AND s.revision=$3 AND s.sha256=$4 AND s.inspection->'manualProfile'->'tabular'=$5::jsonb
    AND NOT EXISTS (SELECT 1 FROM usp_mapping_recipes r WHERE r.source_id=s.id
      AND r.state IN ('approved','executed'))
    AND NOT EXISTS (SELECT 1 FROM jobs newer WHERE newer.source_id=s.id AND newer.operation='chunk-mapping'
      AND newer.payload->'tabular' IS NOT NULL
      AND newer.created_at>(SELECT created_at FROM jobs WHERE id=$6)) FOR UPDATE OF i`,
  [input.caseId, input.sourceId, input.sourceRevision, input.sourceSha256, JSON.stringify(input.tabular),
    input.jobId])).rows[0];
  if (!item) return;
  const current = await readIntakeDraftTx(client, input.caseId, item.item_id);
  if (!['reading', 'read'].includes(current.state) || current.planRef
    || !['undecided', 'needs_answer'].includes(current.placement)) return;
  // A completed job without another answer must not erase a proposal already published by its first chunk.
  if (typeof meanings === 'string' && current.placement === 'needs_answer') return;
  let words = 'The table is read. Its field meanings are ready for your review; '
    + 'nothing is recorded until you confirm it.';
  const manual = 'Open the table to state the meanings yourself; nothing is recorded until you confirm it.';
  if (meanings === 'unavailable')
    words = `The table is read. No proposer is available for its field meanings. ${manual}`;
  if (typeof meanings === 'object')
    words = `The table is read, but proposing its field meanings failed (${meanings.failed}). ${manual}`;
  await writeIntakeDraftTx(client, input.caseId, item.item_id, { ...current, state: 'read',
    placement: 'needs_answer', limitReason: words });
}

/** Slot, watermark and SSE metric enter the existing transaction together under the current attempt fence. */
export async function publishTabularMappingTx(
  client: PoolClient, input: ChunkMappingInput, attempt: UspJobAttempt, stored: Stored,
  firstIndex: number, rawHash: string, windowed = false,
) {
  await assertChunkMappingInputTx(client, input);
  await assertUspJobAttemptTx(client, attempt);
  const state = (await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if (!state || state.state !== 'running' || state.next_publish_index !== stored.payload.chunkIndex ||
      state.records !== firstIndex) conflict('The tabular mapping watermark changed.');
  // G13: a streamed table's proposal is drawn from its first window, which stands in for the raw slot.
  const raw = (await client.query(windowed
    ? 'SELECT window_sha256 AS result_sha256,true AS published FROM usp_table_windows WHERE job_id=$1 ' +
      'AND source_revision=$2 AND window_index=$3 FOR SHARE'
    : 'SELECT result_sha256,published FROM usp_streaming_vector_slots ' +
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
  if (stored.payload.chunkIndex === 0) await settleTableMeaningsTx(client, input,
    mapping.fieldSources.some(field => field.source !== 'unanswered') ? 'ready' : 'unavailable');
}

/** Native unavailable cells remain unknown, regardless of a mechanically executable proposed operation. */
export function markUnavailableCells(draft: TabularChunkDraft, items: ReturnType<typeof TabularRawRowSchema.parse>[]) {
  const unresolved = new Set(mappingQuestions(draft.proposal, { headers: items[0].headers })
    .map(question => question.sourceField));
  for (const [index, row] of draft.dryRun.rows.entries()) {
    for (const [column, cell] of row.fields.entries()) {
      if (items[index].cells[column].state !== 'unknown') continue;
      cell.state = 'unknown';
      cell.value = null;
      delete cell.literal;
      cell.issueCode = 'TABULAR_CELL_UNAVAILABLE';
      unresolved.add(cell.sourceField);
      if (!draft.questions.some(question => question.sourceField === cell.sourceField)) {
        draft.questions.push({ sourceField: cell.sourceField, header: items[index].headers[column],
          reason: cell.issueCode, candidates: [] });
      }
    }
  }
  draft.metrics.needsInput = unresolved.size;
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

/** Case originals send only the permitted column profile, never even masked sample cell values. */
export function tabularTeacherPolicy(pin: TabularPin, teacher = proposeMappingWithTeacher) {
  const dataPolicy: TeacherDataPolicy = { dataClass: 'public', split: 'development' };
  if ('admission' in pin) {
    return { dataPolicy: { ...dataPolicy, split: 'unlabelled' as const },
      teacher: async (profile: Parameters<typeof teacher>[0], options: Parameters<typeof teacher>[1]) => {
        const gate = caseOriginalTeacherGate(pin.admission);
        if (!gate.allowed) {
          const refused = manualTeacherPlan(profile, gate.code);
          refused.plan.fields = refused.plan.fields.map(field => ({ ...field, rationale: gate.words }));
          return refused;
        }
        const masked = { ...profile, sampleShortfall: true,
          columns: profile.columns.map(column => ({ ...column, maskedSamples: [] })) };
        return teacher(masked, options);
      } };
  }
  return { dataPolicy };
}

export async function acceptTabularDataSlot(
  input: ChunkMappingInput, attempt: UspJobAttempt, raw: StreamingVectorPayload, rawHash: string,
  mapper: TabularChunkMapper, store: Store, windowed = false,
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
    context: localRequestContext('tabular-mapping'), ...tabularTeacherPolicy(input.tabular!),
    memoryPath: tabularLearningPaths().memory,
    learnerModelPath: context.model, authorize: async () => transaction(async client => {
      await assertChunkMappingInputTx(client, input);
      await assertUspJobAttemptTx(client, attempt);
    }), invocationKey: `${input.jobId}-${raw.chunkIndex}`,
    ...(input.route === 'approved_recipe' && approved?.version === 'manual-tabular/1'
      ? { approvedPlan: approved.mapping } : {}),
  });
  markUnavailableCells(draft, items);
  mapper.deduplicateQuestions(draft);
  const payload = tabularPayload(input, raw, rawHash, draft, items);
  const stored = await store(payload);
  await transaction(client => publishTabularMappingTx(client, input, attempt, stored,
    raw.records[0].featureIndex, rawHash, windowed));
}

type WindowOutcome = { status: 'mapped'; rows: { record: number; cells: TableMappedCell[] }[] }
  | { status: 'failed'; issueCode: string; issue: string };

/** G13: the approved recipe applied to one stored window, every record in order. A window that cannot be mapped
 * keeps its reason; it is reported and counted, never skipped. */
export function mapTableWindow(plan: TabularMappingPlan, profile: TabularSourceProfile, window: StoredWindow,
  sourceId: string): WindowOutcome {
  const failed = (issueCode: string, issue: string): WindowOutcome =>
    ({ status: 'failed', issueCode, issue: issue.slice(0, 500) });
  if (window.rows.some(row => row.cells.length !== profile.headers.length)) {
    return failed('TABLE_WINDOW_LAYOUT', `Window ${window.index} differs from the table's header layout.`);
  }
  try {
    const context = mappingContextFromColumnProfile(profile.profile, profile.tabular.selection);
    // XW1: a marked workbook cell is unknown, as the whole read leaves it; its stored result is never mapped.
    const unavailable = window.rows.map(row => new Set([...unavailableColumns(row)].map(column =>
      `${column + 1}|${profile.headers[column]}`)));
    const rows = window.rows.map((row, offset) => Object.fromEntries(profile.headers.map((header, index) =>
      [`${index + 1}|${header}`, unavailable[offset]!.has(`${index + 1}|${header}`) ? undefined
        : row.cells[index] ?? undefined])));
    const result = executeMappingPlanV2(plan.mapping, rows,
      { ...context, sourceRef: `source:${sourceId}`, rowOffset: window.firstRecord });
    return { status: 'mapped', rows: result.rows.map((row, offset) => ({ record: window.rows[offset]!.record,
      cells: row.fields.map(cell => unavailable[offset]!.has(cell.sourceField)
        ? { value: null, state: 'unknown' as const, sourceField: cell.sourceField, target: cell.target,
          issueCode: 'TABULAR_CELL_UNAVAILABLE' }
        : { value: cell.value, state: cell.state, sourceField: cell.sourceField,
          target: cell.target, ...(cell.unit ? { unit: cell.unit } : {}),
          ...(cell.issueCode ? { issueCode: cell.issueCode } : {}) }) })) };
  } catch (error) {
    if (error instanceof MappingPlanValidationError) {
      return failed('MAPPING_PLAN_INVALID', 'The approved recipe failed canonical verification on this window.');
    }
    if (error instanceof AppError && error.status < 500) return failed(error.code, error.message);
    throw error;
  }
}

/** One window's mapping, its watermark and its event enter one transaction under the current attempt fence. */
export async function publishTableWindowTx(client: PoolClient, input: ChunkMappingInput, attempt: UspJobAttempt,
  window: StoredWindow, outcome: WindowOutcome) {
  const state = (await client.query('SELECT * FROM usp_chunk_mapping_imports WHERE job_id=$1 FOR UPDATE',
    [input.jobId])).rows[0];
  if (!state || state.state !== 'running' || state.next_publish_index !== window.index ||
      state.records !== window.firstRecord) conflict('The table mapping watermark changed.');
  const raw = (await client.query('SELECT window_sha256 FROM usp_table_windows WHERE job_id=$1 ' +
    'AND window_index=$2 FOR SHARE', [input.rawJobId, window.index])).rows[0];
  if (raw?.window_sha256 !== window.sha256) conflict('The raw table window changed.');
  const records = window.rows.length, mapped = outcome.status === 'mapped';
  const body = mapped ? JSON.stringify(outcome.rows) : null;
  const hash = sha256(JSON.stringify({ jobId: input.jobId, window: window.index, sha256: window.sha256,
    status: outcome.status, body, issueCode: mapped ? null : outcome.issueCode }));
  await client.query(`INSERT INTO usp_table_window_mappings(job_id,raw_job_id,window_index,window_sha256,
    first_record,records,status,rows,issue_code,issue,result_sha256,attempt,fence)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [input.jobId, input.rawJobId, window.index, window.sha256, window.firstRecord, records, outcome.status, body,
    mapped ? null : outcome.issueCode, mapped ? null : outcome.issue, hash, attempt.number, attempt.fence]);
  // As for a small table, a mapped record is a draft to review (unresolved); a failed window's records are set aside.
  await client.query(`UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1,
    records=records+$2,unresolved=unresolved+$3,quarantined=quarantined+$4,updated_at=now() WHERE job_id=$1`,
  [input.jobId, records, mapped ? records : 0, mapped ? 0 : records]);
  await appendCaseIngestionTx(client, input.caseId, { kind: 'chunk-mapping.window', sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, jobId: input.jobId, rawJobId: input.rawJobId, window: window.index,
    status: outcome.status, records, issueCode: mapped ? null : outcome.issueCode }, input.subject);
}

/** The approved recipe on one window: read and checked under the fence, mapped outside it, then published.
 * Returns false while the raw job has not yet written that window. */
export async function acceptTableWindow(input: ChunkMappingInput, attempt: UspJobAttempt, index: number) {
  const prepared = await transaction(async client => {
    const { approved } = await assertChunkMappingInputTx(client, input);
    await assertUspJobAttemptTx(client, attempt);
    if (input.route !== 'approved_recipe' || approved?.receipt.plan.version !== 'manual-tabular/1' ||
        approved.profile.version !== 'manual-tabular/1') conflict('An approved table recipe is required.');
    const window = await readTableWindowTx(client, input.rawJobId, index);
    return window && { window, plan: approved.receipt.plan, profile: approved.profile };
  });
  if (!prepared) return false;
  const outcome = mapTableWindow(prepared.plan, prepared.profile, prepared.window, input.sourceId);
  await transaction(async client => {
    await assertChunkMappingInputTx(client, input);
    await assertUspJobAttemptTx(client, attempt);
    await publishTableWindowTx(client, input, attempt, prepared.window, outcome);
  });
  return true;
}

/** Before a recipe exists, the first records of window 0 are mapped once as the proposal the officer reviews.
 * Returns false while the raw job has not yet written window 0. */
export async function proposeFromTableWindow(input: ChunkMappingInput, attempt: UspJobAttempt,
  mapper: TabularChunkMapper, store: Store) {
  const read = await transaction(async client => {
    const { profile } = await assertChunkMappingInputTx(client, input);
    await assertUspJobAttemptTx(client, attempt);
    if (profile?.version !== 'manual-tabular/1') conflict('The table profile is not current.');
    const window = await readTableWindowTx(client, input.rawJobId, 0);
    return window && { window, headers: profile.headers };
  });
  if (!read) return false;
  const { window, headers } = read;
  const take = Math.max(1, Math.min(TABULAR_LIMITS.chunkRows, Math.floor(TABULAR_LIMITS.columns / headers.length)));
  const raw = { version: STREAMING_VECTOR_LIMITS.version, jobId: input.rawJobId, sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, chunkIndex: 0,
    records: window.rows.slice(0, take).map(row => ({ featureIndex: row.record, byteStart: row.byteStart,
      byteEnd: row.byteEnd, rawSha256: row.sha256, disposition: 'accepted' as const, issueCode: null,
      feature: { headers, sheet: input.tabular!.selection.sheet, sourceRow: row.sourceRow,
        cells: row.cells.map((cell, column) => unavailableColumns(row).has(column) ? { state: 'unknown' as const }
          : cell === null ? { state: 'absent' as const } : { state: 'literal' as const, value: cell }) } })) } as
      unknown as StreamingVectorPayload;
  await acceptTabularDataSlot(input, attempt, raw, window.sha256, mapper, store, true);
  return true;
}
