import type { PoolClient } from 'pg';
import { z } from 'zod';
import { IntakeLargeRetrySchema, IntakeLargeRetryResultSchema, STREAMING_VECTOR_LIMITS as limits,
  type IntakeCard } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { registerUspJobInputTx } from '../jobs';
import { intakeCaseTx, intakeSourcePin, intakeSourceTx } from './intake-context';
import { readIntakeDraftTx, unfinishedIntakePackagesTx, writeIntakeLargeTx,
  type IntakeLargeState } from './intake-ledger';
import { stableUuid } from './intake-run';
import { isRetainedMapOriginal } from './retained-map-original';

export const INTAKE_LARGE_LAYOUT_QUESTION = 'No approved layout matches this file. '
  + 'An officer states what each feature is and which field identifies it.';
const nothing = '; nothing was prepared from it.';
const terminalSentences: Readonly<Record<string, string>> = {
  GEOJSON_JSON: 'This file contains text that is not complete valid JSON',
  GEOJSON_CONTAINER: 'This file does not contain one complete GeoJSON feature collection in the required order',
  GEOJSON_SEQUENCE: 'This file has an incomplete sequence of GeoJSON records',
  GEOJSON_METADATA: 'This file has ambiguous collection metadata',
  GEOJSON_METADATA_BUDGET: 'This file has more collection metadata than can be read for now',
  GEOJSON_NESTING_BUDGET: 'This file nests its values more deeply than can be read for now',
  GEOJSON_UNIT_BUDGET: 'A value in this file is larger than can be read in one piece',
  STREAMING_CHUNK_BUDGET: 'A part of this file is larger than can be read for now',
  STREAMING_EMPTY_SOURCE: 'This file contains no complete features',
  STREAMING_REPLAY_MISMATCH: 'A resumed reading did not match the retained file',
  STREAMING_FEATURE_INDEX: 'The records read from this file are not in a complete unbroken order',
  STREAMING_SOURCE_INTEGRITY: "The retained bytes do not match this file's receipt",
  SOURCE_INTEGRITY: "The stored bytes do not match this file's receipt",
  STREAMING_CHUNK_INTEGRITY: 'A retained part does not match its receipt',
  STORAGE_TIMEOUT: 'Reading the retained file did not finish in time',
  STREAMING_CONTEXT_STALE: "This file's retained source or private access changed while it was read",
  STREAMING_ATTEMPTS_EXHAUSTED: 'Reading this file could not finish after the allowed retries',
  STREAMING_SOURCE_CRS:
    'This file is not in longitude and latitude, the only coordinates large files are read in for now',
  STREAMING_WORKER_ERROR: 'Reading this file could not finish',
  STREAMED_PROFILE_BODY_BUDGET: 'The field inventory of this file is larger than can be kept for now',
  STREAMED_PROFILE_PATH_BUDGET: 'This file has more field paths than can be inventoried for now',
  STREAMED_PROFILE_GEOMETRY_BUDGET: 'This file has more kinds of geometry than can be inventoried for now',
  STREAMED_PROFILE_QUARANTINE_BUDGET: 'The rejected-record inventory of this file is larger than can be kept for now',
  STREAMED_PROFILE_COUNTS: 'The field inventory does not account for every record read',
  STREAMED_PROFILE_INTEGRITY: 'The retained field inventory does not match this file',
  STREAMED_PROFILE_CONTEXT_STALE: "This file's source or private access changed while its fields were inventoried",
  STREAMED_PROFILE_ATTEMPTS: 'The fields of this file could not be inventoried after the allowed retries',
  STREAMED_PROFILE_SOURCE_WAIT: 'The field inventory could not finish waiting for this file to be read',
  STREAMED_PROFILE_WORKER_ERROR: 'The fields of this file could not be inventoried',
  RAW_STREAM_FAILED: 'Reading this file did not finish',
  MAPPING_CHUNK_BUDGET: 'An interpreted part of this file is larger than can be kept for now',
  MAPPING_CONTEXT_STALE: "This file's source, approved layout or private access changed while it was interpreted",
  MAPPING_ATTEMPTS_EXHAUSTED: 'This file could not be interpreted after the allowed retries',
  MAPPING_SOURCE_WAIT: 'Interpreting this file could not finish waiting for its records',
  MAPPING_WORKER_ERROR: 'This file could not be interpreted with its approved layout',
  STREAMED_MAPPING_GEOMETRY: "This file's geometry does not meet its approved polygon layout",
  STREAMED_MAPPING_PATH: 'A field named by the layout is not in this file',
  STREAMED_MAPPING_FIELD: 'A field name in this file is longer than the layout can use',
  STREAMED_MAPPING_OPERATION: 'The layout asks for a field operation this reader cannot apply',
  STREAMED_MAPPING_COVERAGE: 'A field required by the layout is not complete text in every accepted record',
  STREAMED_MAPPING_PROVENANCE: 'This file has no retained issuing portal for its layout evidence',
  STREAMED_MAPPING_SEMANTICS: "The layout's field evidence does not match this file's issuing portal",
};

/** No internal code, hash or exception text becomes the officer's explanation. */
export function intakeLargeFailureReason(code: string, bytes: number, declaredCrs: string | null = null): string {
  if (code === 'STREAMING_SOURCE_BUDGET') {
    const size = Number((bytes / 1024 ** 2).toFixed(3));
    const ceiling = limits.sourceBytes / 1024 ** 2;
    return `This file is ${size} MiB. A map file is read in parts up to ${ceiling} MiB for now`
      + nothing;
  }
  if (code === 'STREAMING_INDEX') {
    return `This file has more than ${limits.chunks * limits.chunkFeatures} features, `
      + 'the most a map file may have for now' + nothing;
  }
  if (code === 'STREAMING_SOURCE_CRS' && declaredCrs !== null) {
    return `This file declares the coordinate system ${declaredCrs}. `
      + 'Large files are read in longitude and latitude only for now' + nothing;
  }
  const sentence = Object.hasOwn(terminalSentences, code) ? terminalSentences[code]
    : 'This file could not be read and interpreted completely';
  return sentence + nothing;
}

export type IntakeLargePhase = 'start' | 'read' | 'question' | 'layout' | 'map' | 'draft' | 'end' | 'failure';
type ReaderRow = {
  state: string; issue_code: string | null; next_publish_index: number;
  records: number; sealed_chunks: number | null; unknown_remainder: boolean;
};
type ProfileRow = { state: string; issue_code: string | null; sealed_generation: number | null };
type MappingRow = ReaderRow;
export type IntakeLargeRows = {
  reader: ReaderRow | null;
  profile: ProfileRow | null;
  mapping: MappingRow | null;
  receiptVerified: boolean;
  recipeState: string | null;
  publishedPackages: number;
  foldComplete: boolean;
};
const finished = (state: string) => ['completed', 'completed_with_rejections'].includes(state);
const failed = (state: string) => ['failed', 'stale'].includes(state);

/** Classification uses stored closure, never an elapsed time or an in-memory cursor. */
export function intakeLargePhase(rows: IntakeLargeRows): IntakeLargePhase {
  if ([rows.reader, rows.profile, rows.mapping].some(row => row && failed(row.state))) return 'failure';
  if (!rows.reader) return 'start';
  if (!finished(rows.reader.state) || rows.reader.unknown_remainder || !rows.receiptVerified
    || rows.reader.sealed_chunks === null || rows.reader.next_publish_index !== rows.reader.sealed_chunks
    || rows.profile?.state !== 'sealed' || rows.profile.sealed_generation !== rows.reader.sealed_chunks) return 'read';
  if (!rows.recipeState) return 'question';
  if (rows.recipeState !== 'approved') return 'layout';
  if (!rows.mapping || !finished(rows.mapping.state) || rows.mapping.unknown_remainder
    || rows.mapping.sealed_chunks !== rows.reader.sealed_chunks
    || rows.mapping.next_publish_index !== rows.mapping.sealed_chunks
    || rows.mapping.records !== rows.reader.records) return 'map';
  return rows.foldComplete ? 'end' : 'draft';
}

/** The meanings change with the pipeline phase, but never with how many attempts ran. */
export function intakeLargeNumbers(phase: IntakeLargePhase, rows: IntakeLargeRows) {
  const recordsSeen = rows.reader?.records ?? 0;
  if (phase === 'map' || phase === 'failure' && rows.mapping !== null) return {
    partsPlanned: rows.reader?.sealed_chunks ?? null,
    partsDone: rows.mapping?.next_publish_index ?? 0, recordsSeen,
  };
  if (phase === 'draft' || phase === 'end') return {
    partsPlanned: phase === 'end' && rows.publishedPackages > 0 ? rows.publishedPackages : null,
    partsDone: rows.publishedPackages, recordsSeen,
  };
  return { partsPlanned: null, partsDone: rows.reader?.next_publish_index ?? 0, recordsSeen };
}

export type IntakeLargeCounts = {
  recordsRead: number; accepted: number; packages: number;
  readerRejected: number; duplicates: number; oversized: number;
};

/** All counts come from sealed reader/mapping rows and published part counts, not displayed sample records. */
export function intakeLargeHoldsReason(counts: IntakeLargeCounts): string | null {
  if (!counts.readerRejected && !counts.duplicates && !counts.oversized
    && counts.accepted === counts.recordsRead) return null;
  const sentences = [`${counts.recordsRead} records read; ${counts.accepted} in ${counts.packages} packages.`];
  if (counts.readerRejected) sentences.push(`${counts.readerRejected} not accepted by the reader.`);
  if (counts.duplicates) sentences.push(`${counts.duplicates} share an identifier with another record and are held.`);
  if (counts.oversized) sentences.push(`${counts.oversized} are larger than a package can hold and are held.`);
  return sentences.join(' ');
}

export const INTAKE_LARGE_STOPPED = 'Preparing this file stopped after repeated errors; '
  + 'the steps already done are kept. Nothing more was prepared from it.';
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeLargeInputSchema = z.strictObject({
  version: z.literal('intake-large/1'), jobId: uuid, itemId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, sourcePin: hash, stateKey: hash, subject: z.string().min(1).max(256), accessSha256: hash,
});
export type IntakeLargeInput = z.infer<typeof IntakeLargeInputSchema>;

/** One stable request per item and step, so a replayed step sends exactly the same enqueue again. */
export function intakeLargeRequestKey(itemId: string, step: 'reader' | 'profile' | 'mapping', revision = 0) {
  return stableUuid(`intake-large/1:${itemId}:${step}:${revision}`);
}

type Stored<T> = (T & { job_id: string }) | null;
export type IntakeLargeStore = {
  reader: Stored<ReaderRow & { quarantined: number }>;
  profile: Stored<ProfileRow>;
  recipe: { id: string; revision: number; state: string } | null;
  mapping: Stored<MappingRow>;
  parts: number;
  unreviewed: number;
};
export type IntakeLargeItem = {
  item_id: string; case_id: string; state: string; placement: string; card: IntakeCard | null;
  plan_ref: Record<string, unknown> | null;
};
export type IntakeLargeSource = {
  id: string; revision: number; bytes: string | number; profile: string; sha256: string; object_key: string;
  inspection: Record<string, any> | null;
};
const stepTables = {
  'streaming-vector': `SELECT job_id,state,issue_code,next_publish_index,records,quarantined,sealed_chunks,
    unknown_remainder FROM usp_streaming_vector_imports`,
  'streamed-profile': 'SELECT job_id,state,issue_code,sealed_generation FROM usp_streamed_profile_imports',
  'chunk-mapping': `SELECT job_id,state,issue_code,next_publish_index,records,sealed_chunks,unknown_remainder
    FROM usp_chunk_mapping_imports`,
} as const;

async function stepRowTx(client: PoolClient, caseId: string, kind: keyof typeof stepTables, requestKey: string) {
  return (await client.query(`${stepTables[kind]} WHERE job_id=(SELECT (result->>'jobId')::uuid
    FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind=$3)`,
  [caseId, `${kind}:${requestKey}`, kind])).rows[0] ?? null;
}

/** Only stored rows: the reader, profile and mapping named by the item's own request keys, its layout and parts. */
async function largeStoreTx(client: PoolClient, item: IntakeLargeItem, sourceId: string): Promise<IntakeLargeStore> {
  const reader = await stepRowTx(client, item.case_id, 'streaming-vector',
    intakeLargeRequestKey(item.item_id, 'reader'));
  const profile = await stepRowTx(client, item.case_id, 'streamed-profile',
    intakeLargeRequestKey(item.item_id, 'profile'));
  const recipe = (await client.query('SELECT id,revision,state FROM usp_mapping_recipes WHERE source_id=$1',
    [sourceId])).rows[0] ?? null;
  const mapping = recipe?.state === 'approved' ? await stepRowTx(client, item.case_id, 'chunk-mapping',
    intakeLargeRequestKey(item.item_id, 'mapping', recipe.revision)) : null;
  const parts = Number((await client.query('SELECT count(*)::int n FROM usp_intake_parts WHERE item_id=$1',
    [item.item_id])).rows[0].n);
  const unreviewed = await unfinishedIntakePackagesTx(client, item.item_id);
  return { reader, profile, recipe, mapping, parts, unreviewed };
}

function keyInputs(store: IntakeLargeStore) {
  const { reader, profile, recipe, mapping } = store;
  return { version: 'intake-large/1',
    reader: reader && [reader.job_id, reader.state, reader.sealed_chunks, reader.unknown_remainder],
    profile: profile && [profile.job_id, profile.state, profile.sealed_generation],
    recipe: recipe && [recipe.id, recipe.revision, recipe.state],
    mapping: mapping && [mapping.job_id, mapping.state, mapping.sealed_chunks, mapping.unknown_remainder],
    parts: store.parts };
}

/** Cuts of one drafting step compare this, so a review finishing between two cuts does not stop the fold. */
export function intakeLargeCutKey(store: IntakeLargeStore): string {
  return fingerprint(keyInputs(store));
}

/** Reads only stored rows; null for a source that is not a batch item holding a large GeoJSON within the ceiling. */
export async function largeStateKey(client: PoolClient, sourceId: string) {
  const item: IntakeLargeItem | undefined = (await client.query(`SELECT item_id,case_id,state,placement,card,plan_ref
    FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL`, [sourceId])).rows[0];
  const source: IntakeLargeSource | undefined = item && (await client.query(
    'SELECT id,revision,bytes,profile,sha256,object_key,inspection FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!item || !source || source.profile !== 'large-original-v1' || item.card?.format !== 'geojson'
    || Number(source.bytes) > limits.sourceBytes) return null;
  const store = await largeStoreTx(client, item, sourceId);
  const retries = await intakeLargeRetriesTx(client, item);
  // Zero retries leaves the key as it was, so stored step jobs keep their ids.
  return { item, source, store, key: fingerprint({ ...keyInputs(store), unreviewed: store.unreviewed,
    ...(retries ? { retries } : {}) }) };
}

async function intakeLargeRetriesTx(client: PoolClient, item: IntakeLargeItem): Promise<number> {
  return Number((await client.query(`SELECT count(*)::int n FROM operations
    WHERE case_id=$1 AND kind='intake-large-retry' AND result->>'itemId'=$2`,
  [item.case_id, item.item_id])).rows[0].n);
}

/** A stopped item stays at rest for every wake-up; only an officer's retry request moves it again. */
export function intakeLargeAtRest(item: { state: string; placement: string }): boolean {
  return item.state === 'read' && item.placement === 'on_map' || item.placement === 'not_understood';
}

/** The one wake-up. The key is read in the caller's transaction, so a state change cannot lose its job,
 * and an unchanged state names a job that exists already, whatever its status. */
export async function queueIntakeLargeTx(client: PoolClient, sourceId: string): Promise<string | null> {
  const state = await largeStateKey(client, sourceId);
  if (!state || intakeLargeAtRest(state.item)) return null;
  const jobId = stableUuid(`intake-large/1:${sourceId}:${state.key}`);
  const prior = (await client.query("SELECT id FROM jobs WHERE id=$1 AND operation='intake-large'", [jobId])).rows[0];
  if (prior) return prior.id;
  // A changed or withdrawn source ends its readers stale; the wake-up must not undo their terminal transaction.
  const context = await intakeSourceTx(client, state.item.case_id, sourceId).catch(error => {
    if (error instanceof AppError && error.status < 500) return null;
    throw error;
  });
  if (!context) return null;
  const { current, binding, source } = context;
  const input = IntakeLargeInputSchema.parse({ version: 'intake-large/1', jobId, itemId: state.item.item_id,
    caseId: state.item.case_id, caseRevision: current.revision, sourceId, sourceRevision: source.revision,
    sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, binding), stateKey: state.key,
    subject: binding.subject, accessSha256: binding.access });
  const digest = fingerprint(input);
  const inserted = (await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,
    payload) VALUES($1,$2,$3,'intake-large',$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
  [jobId, input.caseId, sourceId, input.caseRevision, digest, input])).rowCount;
  if (inserted) await registerUspJobInputTx(client, jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, sourceId, digest);
  return jobId;
}

const retryRefusals = {
  INTAKE_RETRY_NOT_LARGE: 'Only a large map file prepared in steps can be tried again.',
  INTAKE_RETRY_NOT_STOPPED: 'This file has not stopped, so there is nothing to try again.',
  INTAKE_RETRY_FILE: 'This file stopped because of what it contains. Trying again would stop the same way; '
    + 'the file itself must change.',
} as const;
const refuseRetry = (code: keyof typeof retryRefusals): never => {
  throw new AppError(409, code, retryRefusals[code]);
};

/** An officer's retry of a file stopped after repeated step errors. It is stored, so the state key names a new
 * step job; the same request answers the same result and a different body under its key is refused. */
export async function retryIntakeLargeItem(caseValue: string, itemValue: string, raw: unknown) {
  const caseId = uuid.parse(caseValue), itemId = uuid.parse(itemValue);
  const request = IntakeLargeRetrySchema.parse(raw);
  return transaction(async client => {
    await lockSourceCaseDestinationTx(client, caseId);
    const scope = await intakeCaseTx(client, caseId, true);
    const key = `retry:${request.requestKey}`;
    const digest = fingerprint({ request, itemId, access: scope.binding.access });
    const prior = (await client.query(`SELECT payload_hash,result FROM operations
      WHERE case_id=$1 AND operation_key=$2 AND kind='intake-large-retry'`, [caseId, key])).rows[0];
    if (prior && prior.payload_hash !== digest) conflict('This retry request key names a different request.');
    if (prior) return IntakeLargeRetryResultSchema.parse(prior.result);
    const row = (await client.query('SELECT source_id FROM usp_intake_items WHERE case_id=$1 AND item_id=$2',
      [caseId, itemId])).rows[0] ?? notFound('Intake item not found in this case.');
    if (row.source_id) await intakeSourceTx(client, caseId, row.source_id);
    const state = row.source_id ? await largeStateKey(client, row.source_id) : null;
    if (!state) return refuseRetry('INTAKE_RETRY_NOT_LARGE');
    const current = await readIntakeDraftTx(client, caseId, itemId);
    const rows = intakeLargeRows(state.store, state.source), phase = intakeLargePhase(rows);
    if (current.placement !== 'not_understood') refuseRetry('INTAKE_RETRY_NOT_STOPPED');
    if (current.limitReason !== INTAKE_LARGE_STOPPED || phase === 'failure') refuseRetry('INTAKE_RETRY_FILE');
    const retry = await intakeLargeRetriesTx(client, state.item) + 1;
    // Stored before the wake-up: its count is part of the key that names the new step job.
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'intake-large-retry',$3,$4)`, [caseId, key, digest, { itemId, retry }]);
    await writeIntakeLargeTx(client, caseId, itemId, intakeLargeProjection(phase, rows, state.store,
      { bytes: Number(state.source.bytes), declaredCrs: state.item.card?.crs.code ?? null }));
    const jobId = await queueIntakeLargeTx(client, row.source_id) ?? conflict('This file cannot be queued again.');
    const result = IntakeLargeRetryResultSchema.parse({ itemId, retry, jobId });
    await client.query(`UPDATE operations SET result=$3 WHERE case_id=$1 AND operation_key=$2
      AND kind='intake-large-retry'`, [caseId, key, result]);
    return result;
  });
}

/** A finished review wakes the large file its package was cut from; other packages name no part row. */
export async function queueIntakeLargePackageTx(client: PoolClient, packageId: string) {
  const row = (await client.query(`SELECT i.source_id FROM usp_intake_parts part
    JOIN usp_intake_items i ON i.item_id=part.item_id WHERE part.result_ref->>'packageId'=$1 LIMIT 1`,
  [packageId])).rows[0];
  return row ? queueIntakeLargeTx(client, row.source_id) : null;
}

export function intakeLargeRows(store: IntakeLargeStore, source: IntakeLargeSource): IntakeLargeRows {
  const receipt = source.inspection?.streamedMapReceipt;
  return { reader: store.reader, profile: store.profile, mapping: store.mapping,
    receiptVerified: Boolean(store.reader) && isRetainedMapOriginal(source)
      && receipt?.rawJobId === store.reader?.job_id,
    recipeState: store.recipe?.state ?? null, publishedPackages: store.parts, foldComplete: false };
}

export function intakeLargePlan(recipe: IntakeLargeStore['recipe']) {
  return recipe ? { recipeId: recipe.id, recipeRevision: recipe.revision, recipeState: recipe.state,
    origin: 'officer', packageId: null } : null;
}

/** What the row says in each state of the stored rows; only the drafting step writes the end. */
export function intakeLargeProjection(phase: IntakeLargePhase, rows: IntakeLargeRows, store: IntakeLargeStore,
  failure: { bytes: number; declaredCrs: string | null }): IntakeLargeState {
  const numbers = intakeLargeNumbers(phase, rows), planRef = intakeLargePlan(store.recipe);
  if (phase === 'failure') {
    const code = [rows.reader, rows.profile, rows.mapping].find(row => row && failed(row.state))?.issue_code;
    return { state: 'failed_part', placement: 'not_understood', planRef, ...numbers,
      limitReason: intakeLargeFailureReason(code ?? 'STREAMING_WORKER_ERROR', failure.bytes, failure.declaredCrs) };
  }
  if (phase === 'question') return { state: 'probed', placement: 'needs_answer', planRef: null, ...numbers,
    limitReason: INTAKE_LARGE_LAYOUT_QUESTION };
  if (phase === 'layout' || phase === 'map' && !rows.mapping) return { state: 'planned', placement: 'undecided',
    planRef, ...numbers, limitReason: null };
  return { state: 'reading', placement: store.parts ? 'on_map' : 'undecided',
    planRef: phase === 'start' || phase === 'read' ? null : planRef, ...numbers, limitReason: null };
}

/** After the last cut; a file with no cut rests not understood with the same counts. */
export function intakeLargeEnd(counts: IntakeLargeCounts, planRef: IntakeLargeState['planRef']): IntakeLargeState {
  const limitReason = intakeLargeHoldsReason(counts);
  if (!counts.packages) return { state: 'read', placement: 'not_understood', planRef,
    recordsSeen: counts.recordsRead, partsPlanned: null, partsDone: 0, limitReason };
  return { state: 'read', placement: 'on_map', planRef, recordsSeen: counts.recordsRead,
    partsPlanned: counts.packages, partsDone: counts.packages, limitReason };
}
