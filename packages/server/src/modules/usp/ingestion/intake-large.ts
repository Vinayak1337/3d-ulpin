import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { GisSetAside } from '@ulpin/contracts';
import { IntakeLargeRetrySchema, IntakeLargeRetryResultSchema, STREAMING_VECTOR_LIMITS as limits, stoppedReason,
  type IntakeCard, type IntakeItemSchema, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { AREA_PROCESSOR_OPERATION } from '../../areas/areas';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { registerUspJobInputTx } from '../jobs';
import { intakeCaseTx, intakeSourcePin, intakeSourceTx } from './intake-context';
import { readIntakeDraftTx, unfinishedIntakePackagesTx, writeIntakeLargeTx,
  type IntakeLargeState } from './intake-ledger';
import { AREA_NORMALIZER_EXTENT } from './intake-package-extent';
import { INTAKE_UNFINISHED_PACKAGE_LIMIT } from './intake-part-draft';
import { stableUuid } from './intake-run';
import { setAsideWords } from './registry';
import { isRetainedMapOriginal } from './retained-map-original';
import { intakeGeojsonFraming } from './geojson-framing';
import { streamingReaderSha } from './streaming-vector';
import { chunkMappingConverterSha } from './chunk-mapping';
import { PrefixLayoutFailureSchema, prefixSealCheckKey, type PrefixLayoutFailure } from './streamed-mapping';

export const INTAKE_LARGE_LAYOUT_QUESTION = 'No approved layout matches this file. '
  + 'An officer states what each feature is and which field identifies it.';
const nothing = '; nothing was prepared from it.';
const terminalSentences: Readonly<Record<string, string>> = {
  GEOJSON_JSON: 'This file contains text that is not complete valid JSON',
  GEOJSON_CONTAINER: 'This file does not contain one complete GeoJSON feature collection in the required order',
  GEOJSON_COLLECTION_TYPE: 'This file is missing a root type of FeatureCollection or declares a different root type',
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
  STREAMING_SOURCE_CRS: 'The coordinate system this file declares could not be resolved',
  STREAMING_WORKER_ERROR: 'Reading this file could not finish',
  AREA_PROCESSOR_OPERATION: 'The map processor in use cannot do a step this file needs. It must be updated '
    + 'before this file can be read',
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
  STREAMED_MAPPING_GEOMETRY: 'This file has geometry that the kind stated in its approved layout does not take',
  STREAMED_MAPPING_PATH: 'A field named by the layout is not in this file',
  STREAMED_MAPPING_FIELD: 'A field name in this file is longer than the layout can use',
  STREAMED_MAPPING_OPERATION: 'The layout asks for a field operation this reader cannot apply',
  STREAMED_MAPPING_COVERAGE:
    'A field required by the layout is not complete text or a whole number in every accepted record',
  STREAMED_MAPPING_PROVENANCE: 'This file has no retained issuing portal for its layout evidence',
  STREAMED_MAPPING_SEMANTICS: "The layout's field evidence does not match this file's issuing portal",
};

/** No internal code, hash or exception text becomes the officer's explanation. A declaration the coordinate
 * system resolution refuses is explained in that resolution's own words, which quote the declaration as written. */
export function intakeLargeFailureReason(code: string, bytes: number, crsWords: string | null = null): string {
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
  if (code === 'STREAMING_SOURCE_CRS' && crsWords !== null) return crsWords.replace(/\.$/, '') + nothing;
  const sentence = Object.hasOwn(terminalSentences, code) ? terminalSentences[code]
    : 'This file could not be read and interpreted completely';
  return sentence + nothing;
}

const partSentences: Readonly<Record<string, string>> = {
  PART_INTEGER_IDENTIFIER: 'The identifier field holds a value written with a decimal point. '
    + 'This file must write whole-number identifiers as digits only',
  GIS_ALL_GEOMETRIES_REJECTED: 'No feature in a part of this file has an outline that can be read',
};

/** A part the file itself refuses rests the row at once: the same bytes cannot pass on another attempt. The geo
 * service answers its refusal of the part's own content with 422 and its words; a 5xx or a timeout is a fault.
 * A processor image without the operation is no fault that clears on a retry either. */
export function intakeLargePartRefusal(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  const nothing = '; nothing more was prepared from it.';
  if (error.code === AREA_PROCESSOR_OPERATION) return terminalSentences[error.code] + nothing;
  if (Object.hasOwn(partSentences, error.code)) return partSentences[error.code] + nothing;
  if (error.code !== 'AREA_PROCESSING' || error.status !== 422) return null;
  return `A part of this file could not be read as a map: ${error.message.replace(/\.$/, '')}${nothing}`;
}

export type IntakeLargePhase = 'start' | 'read' | 'question' | 'layout' | 'map' | 'draft' | 'end'
  | 'failure' | 'compare';
type ReaderRow = {
  state: string; issue_code: string | null; next_publish_index: number;
  records: number; sealed_chunks: number | null; unknown_remainder: boolean; lines_beyond_limit?: number;
};
type ProfileRow = { state: string; issue_code: string | null; sealed_generation: number | null;
  layout_profile?: z.infer<typeof IntakeItemSchema>['layoutProfile'] };
type MappingRow = ReaderRow;
export type IntakeLargeRows = {
  reader: ReaderRow | null;
  profile: ProfileRow | null;
  mapping: MappingRow | null;
  receiptVerified: boolean;
  recipeState: string | null;
  prefixRecipe?: boolean;
  prefixCheck?: 'matched' | 'changed';
  publishedPackages: number;
  foldComplete: boolean;
};
const finished = (state: string) => ['completed', 'completed_with_rejections'].includes(state);
const failed = (state: string) => ['failed', 'stale'].includes(state);

/** Classification uses stored closure, never an elapsed time or an in-memory cursor. */
export function intakeLargePhase(rows: IntakeLargeRows): IntakeLargePhase {
  if ([rows.reader, rows.profile, rows.mapping].some(row => row && failed(row.state))) return 'failure';
  if (!rows.reader) return 'start';
  if (rows.prefixCheck === 'changed') return 'question';
  const openPrefix = !finished(rows.reader.state) && rows.reader.unknown_remainder
    && rows.profile?.layout_profile?.coverage === 'provisional';
  if (openPrefix && !rows.recipeState) return 'question';
  if (openPrefix && rows.prefixRecipe && rows.recipeState !== 'approved') return 'layout';
  const prefixApproved = rows.prefixRecipe && rows.recipeState === 'approved';
  if (openPrefix && prefixApproved) return 'map';
  if (!finished(rows.reader.state) || rows.reader.unknown_remainder || !rows.receiptVerified
    || rows.reader.sealed_chunks === null || rows.reader.next_publish_index !== rows.reader.sealed_chunks
    || rows.profile?.state !== 'sealed' || rows.profile.sealed_generation !== rows.reader.sealed_chunks) return 'read';
  if (!rows.recipeState || rows.prefixRecipe && rows.recipeState !== 'approved') return 'question';
  if (rows.recipeState !== 'approved') return 'layout';
  if (rows.mapping && ['queued', 'running'].includes(rows.mapping.state)
    && rows.prefixCheck === 'matched' && rows.mapping.next_publish_index > 0) return 'draft';
  if (rows.mapping && !finished(rows.mapping.state) && rows.mapping.state !== 'needs_input'
    && rows.prefixCheck !== 'matched') return 'compare';
  if (!rows.mapping || !(finished(rows.mapping.state) || prefixApproved && rows.mapping.state === 'needs_input')
    || rows.mapping.unknown_remainder
    || rows.mapping.sealed_chunks !== rows.reader.sealed_chunks
    || rows.mapping.next_publish_index !== rows.mapping.sealed_chunks
    || rows.mapping.records !== rows.reader.records) return 'map';
  if (prefixApproved && rows.prefixCheck !== 'matched') return 'compare';
  return rows.foldComplete ? 'end' : 'draft';
}

/** The meanings change with the pipeline phase, but never with how many attempts ran. */
export function intakeLargeNumbers(phase: IntakeLargePhase, rows: IntakeLargeRows) {
  const recordsSeen = rows.reader?.records ?? 0;
  if (phase === 'map' || phase === 'failure' && rows.mapping !== null) return {
    partsPlanned: rows.reader?.sealed_chunks ?? null,
    partsDone: rows.mapping?.next_publish_index ?? 0, recordsSeen,
  };
  if (phase === 'compare' || phase === 'draft' || phase === 'end') return {
    partsPlanned: phase === 'end' && rows.publishedPackages > 0 ? rows.publishedPackages : null,
    partsDone: rows.publishedPackages, recordsSeen,
  };
  return { partsPlanned: null, partsDone: rows.reader?.next_publish_index ?? 0, recordsSeen };
}

/** `wide` features span more than any one map area; `outside` ones lie beyond the area the batch places into;
 * `unmeasured` ones have a position that could not be measured, so they are neither wide nor outside. */
export type IntakeLargeCounts = {
  recordsRead: number; accepted: number; packages: number; linesBeyondLimit?: number;
  readerRejected: number; duplicates: number; oversized: number; setAside?: GisSetAside;
  /** At most five retained set-aside sequence positions, in read order. */
  readerRejectedPositions?: NonNullable<StreamingVectorRecord['sequencePosition']>[];
  wide?: number; outside?: number; unmeasured?: number;
};
const AREA_KM = AREA_NORMALIZER_EXTENT.metres / 1000;

/** All counts come from sealed reader/mapping rows, published part counts and the reader's own geometry summary,
 * not displayed sample records. */
export function intakeLargeHoldsReason(counts: IntakeLargeCounts): string | null {
  if (!counts.readerRejected && !counts.duplicates && !counts.oversized && !counts.wide && !counts.outside
    && !counts.unmeasured && counts.accepted === counts.recordsRead) return null;
  const sentences = [`${counts.recordsRead} records read; ${counts.accepted} in ${counts.packages} packages.`];
  if (counts.readerRejected) {
    const positions = counts.readerRejectedPositions?.slice(0, 5) ?? [];
    let where = '';
    if (positions.length) {
      const numbers = positions.map(position => position.number);
      const listed = numbers.length === 1 ? String(numbers[0])
        : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
      const kind = positions[0].kind === 'line' ? 'line' : 'record';
      const first = counts.readerRejected > positions.length ? 'first at ' : '';
      where = ` (${first}${kind}${numbers.length > 1 ? 's' : ''} ${listed})`;
    }
    sentences.push(`${counts.readerRejected} not accepted by the reader${where}.`);
  }
  if (counts.duplicates) sentences.push(`${counts.duplicates} share an identifier with another record and are held.`);
  if (counts.oversized) sentences.push(`${counts.oversized} are larger than a package can hold and are held.`);
  if (counts.wide) sentences.push(`${counts.wide} are wider than one map area (${AREA_KM} km or `
    + `${AREA_NORMALIZER_EXTENT.degrees} degree across) and are held.`);
  if (counts.outside) sentences.push(`${counts.outside} lie outside the ${AREA_KM} km map area this batch places `
    + 'features in and are held.');
  if (counts.unmeasured) sentences.push(`${counts.unmeasured} have a position that could not be measured and are `
    + 'held.');
  const setAside = setAsideWords(counts.setAside);
  if (setAside) sentences.push(setAside);
  return sentences.join(' ');
}

// One sentence: the batch page and the work queue match it to offer Try again.
export const INTAKE_LARGE_STOPPED = stoppedReason;
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeLargeInputSchema = z.strictObject({
  version: z.literal('intake-large/1'), jobId: uuid, itemId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, sourcePin: hash, stateKey: hash, subject: z.string().min(1).max(256), accessSha256: hash,
  mappedThrough: z.number().int().nonnegative().max(limits.chunks).optional(),
});
export type IntakeLargeInput = z.infer<typeof IntakeLargeInputSchema>;

/** Generation zero keeps existing receipts; a reread never overwrites a prior enqueue's authority. */
export function intakeLargeRequestKey(itemId: string, step: 'reader' | 'profile' | 'mapping', revision = 0,
  readGeneration = 0) {
  const suffix = readGeneration ? `:read:${readGeneration}` : '';
  return stableUuid(`intake-large/1:${itemId}:${step}:${revision}${suffix}`);
}

export async function intakeReadGenerationTx(client: PoolClient, caseId: string, itemId: string): Promise<number> {
  return Number((await client.query(`SELECT COALESCE(max((result->>'readGeneration')::int),0)::int generation
    FROM operations WHERE case_id=$1 AND kind='intake-large-retry' AND result->>'itemId'=$2`,
  [caseId, itemId])).rows[0].generation);
}

type Stored<T> = (T & { job_id: string }) | null;
export type IntakeLargeStore = {
  readGeneration?: number;
  reader: Stored<ReaderRow & { quarantined: number }>;
  profile: Stored<ProfileRow>;
  recipe: { id: string; revision: number; state: string; plan_version?: string; plan_hash?: string } | null;
  prefixCheck?: 'matched' | 'changed';
  prefixFailure?: PrefixLayoutFailure;
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
    unknown_remainder,lines_beyond_limit FROM usp_streaming_vector_imports`,
  'streamed-profile': `SELECT job_id,state,issue_code,sealed_generation,
    (SELECT jsonb_build_object('generation',g.generation,'generationHash',g.body->>'generationHash',
      'coverage',g.body->>'coverage','recordsSeen',g.body->'recordsSeen','accepted',g.body->'accepted')
    FROM usp_streamed_profile_generations g WHERE g.job_id=p.job_id
      AND (g.generation=p.sealed_generation OR p.sealed_generation IS NULL AND (g.body->>'accepted')::int>0)
    ORDER BY g.generation LIMIT 1) layout_profile FROM usp_streamed_profile_imports p`,
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
  const readGeneration = await intakeReadGenerationTx(client, item.case_id, item.item_id);
  const reader = await stepRowTx(client, item.case_id, 'streaming-vector',
    intakeLargeRequestKey(item.item_id, 'reader', 0, readGeneration));
  const profile = await stepRowTx(client, item.case_id, 'streamed-profile',
    intakeLargeRequestKey(item.item_id, 'profile', 0, readGeneration));
  const recipe = (await client.query(`SELECT id,revision,state,body->'plan'->>'version' plan_version,
    body->>'planHash' plan_hash FROM usp_mapping_recipes r WHERE source_id=$1
    AND ($2::int=0 OR (body->'plan'->>'rawJobId'=$3 AND body->'plan'->>'profileJobId'=$4
      AND EXISTS (SELECT 1 FROM usp_streamed_profile_generations g WHERE g.job_id=$4::uuid
        AND g.generation=(r.body->'plan'->>'profileGeneration')::int
        AND g.body->>'generationHash'=r.body->'plan'->>'profileHash')))`,
    [sourceId, readGeneration, reader?.job_id ?? null, profile?.job_id ?? null])).rows[0] ?? null;
  const mapping = recipe?.state === 'approved' ? await stepRowTx(client, item.case_id, 'chunk-mapping',
    intakeLargeRequestKey(item.item_id, 'mapping', recipe.revision, readGeneration)) : null;
  const parts = Number((await client.query(`SELECT count(*)::int n FROM usp_intake_parts WHERE item_id=$1
    AND ($2::int=0 OR locator->>'mappingJobId'=$3)`,
  [item.item_id, readGeneration, mapping?.job_id ?? null])).rows[0].n);
  const unreviewed = await unfinishedIntakePackagesTx(client, item.item_id);
  return { ...(readGeneration ? { readGeneration } : {}), reader, profile, recipe, mapping, parts, unreviewed };
}

function keyInputs(store: IntakeLargeStore) {
  const { reader, profile, recipe, mapping } = store;
  return { version: 'intake-large/1', ...(store.readGeneration ? { readGeneration: store.readGeneration } : {}),
    reader: reader && [reader.job_id, reader.state, reader.sealed_chunks, reader.unknown_remainder],
    profile: profile && [profile.job_id, profile.state, profile.sealed_generation,
      ...(profile.layout_profile ? [profile.layout_profile.generationHash] : [])],
    recipe: recipe && [recipe.id, recipe.revision, recipe.state],
    mapping: mapping && [mapping.job_id, mapping.state, mapping.sealed_chunks, mapping.unknown_remainder],
    parts: store.parts, ...(store.prefixCheck ? { prefixCheck: store.prefixCheck } : {}) };
}

function wakeKey(store: IntakeLargeStore, retries: number, unreviewed = store.unreviewed): string {
  const published = store.mapping && !finished(store.mapping.state) ? store.mapping.next_publish_index : 0;
  return fingerprint({ ...keyInputs(store), unreviewed, ...(retries ? { retries } : {}),
    ...(published ? { mappedThrough: published } : {}) });
}

/** Only the publication watermark may advance since enqueue; every other wake-key fence still matches. */
export function intakeLargeStepCurrent(state: { key: string; store: IntakeLargeStore; retries: number },
  input: Pick<IntakeLargeInput, 'stateKey' | 'mappedThrough'>): boolean {
  if (state.key === input.stateKey) return true;
  const mapping = state.store.mapping, through = input.mappedThrough ?? 0;
  if (!mapping || through > mapping.next_publish_index) return false;
  return wakeKey({ ...state.store, mapping: { ...mapping, next_publish_index: through } }, state.retries)
    === input.stateKey;
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
  if (!item || !source || source.profile !== 'large-original-v1' || item.card?.family !== 'vector'
    || !intakeGeojsonFraming(item.card) || Number(source.bytes) > limits.sourceBytes) return null;
  const store = await largeStoreTx(client, item, sourceId);
  const check = source.inspection?.intakePrefixSealCheck;
  if (store.recipe && store.mapping && store.profile?.layout_profile
    && typeof check?.changed === 'boolean' && check.key === prefixSealCheckKey(store.recipe.plan_hash!,
      store.profile.layout_profile.generationHash, store.mapping.job_id)) {
    store.prefixCheck = check.changed ? 'changed' : 'matched';
    const failure = PrefixLayoutFailureSchema.safeParse(check.failure);
    if (check.changed && failure.success) store.prefixFailure = failure.data;
  }
  const retries = await intakeLargeRetriesTx(client, item);
  // Zero retries leaves the key as it was, so stored step jobs keep their ids.
  return { item, source, store, retries, key: wakeKey(store, retries) };
}

async function intakeLargeRetriesTx(client: PoolClient, item: IntakeLargeItem): Promise<number> {
  return Number((await client.query(`SELECT count(*)::int n FROM operations
    WHERE case_id=$1 AND kind='intake-large-retry' AND result->>'itemId'=$2`,
  [item.case_id, item.item_id])).rows[0].n);
}

/** A stopped item stays at rest for every wake-up; only an officer's retry request moves it again. */
export function intakeLargeAtRest(item: { state: string; placement: string }): boolean {
  return ['read', 'read_to_limit'].includes(item.state) && item.placement === 'on_map'
    || item.placement === 'not_understood';
}

/** The one wake-up. The key is read in the caller's transaction, so a state change cannot lose its job,
 * and an unchanged state names a job that exists already, whatever its status.
 * Caller takes at least case KEY SHARE before its first write, so the job's FK cannot wait behind its own id. */
export async function queueIntakeLargeTx(client: PoolClient, sourceId: string,
  afterReview = false): Promise<string | null> {
  const state = await largeStateKey(client, sourceId);
  if (!state || intakeLargeAtRest(state.item)) return null;
  if (afterReview) {
    if (state.store.unreviewed >= INTAKE_UNFINISHED_PACKAGE_LIMIT) return null;
    const pressureKey = wakeKey(state.store, state.retries, INTAKE_UNFINISHED_PACKAGE_LIMIT);
    const pressureJob = stableUuid(`intake-large/1:${sourceId}:${pressureKey}`);
    const paused = (await client.query("SELECT id FROM jobs WHERE id=$1 AND operation='intake-large'",
      [pressureJob])).rows[0];
    if (!paused) return null;
  }
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
    subject: binding.subject, accessSha256: binding.access,
    ...(state.store.mapping && !finished(state.store.mapping.state)
      ? { mappedThrough: state.store.mapping.next_publish_index } : {}) });
  const digest = fingerprint(input);
  const inserted = (await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,
    payload) VALUES($1,$2,$3,'intake-large',$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
  [jobId, input.caseId, sourceId, input.caseRevision, digest, input])).rowCount;
  if (inserted) await registerUspJobInputTx(client, jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, sourceId, digest);
  return jobId;
}

/** The reader's state key holds no counts, so no step runs while it publishes parts. Its slot transaction writes
 * the row's stored reading counts instead; every other state stays the step's to write. */
export async function writeIntakeLargeReadTx(client: PoolClient, sourceId: string): Promise<void> {
  const state = await largeStateKey(client, sourceId);
  if (!state || intakeLargeAtRest(state.item)) return;
  const rows = intakeLargeRows(state.store, state.source);
  if (intakeLargePhase(rows) !== 'read') return;
  await writeIntakeLargeTx(client, state.item.case_id, state.item.item_id, intakeLargeProjection('read', rows,
    state.store, intakeLargeFailureContext(state.store, state.source)));
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

/** Compare deployed code only; source, private access and byte integrity still use their existing authorities. */
async function readCodeChangedTx(client: PoolClient, store: IntakeLargeStore): Promise<boolean> {
  const ids = [store.reader?.job_id, store.mapping?.job_id].filter(Boolean);
  if (!ids.length) return false;
  const jobs = (await client.query('SELECT operation,payload FROM jobs WHERE id=ANY($1::uuid[])', [ids])).rows;
  return jobs.some(job => job.payload.readerSha256 !== streamingReaderSha()
    || job.operation === 'chunk-mapping' && job.payload.converterSha256 !== chunkMappingConverterSha());
}

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
    if (prior) {
      const { readGeneration: _generation, ...result } = prior.result;
      return IntakeLargeRetryResultSchema.parse(result);
    }
    const row = (await client.query('SELECT source_id FROM usp_intake_items WHERE case_id=$1 AND item_id=$2',
      [caseId, itemId])).rows[0] ?? notFound('Intake item not found in this case.');
    if (row.source_id) await intakeSourceTx(client, caseId, row.source_id);
    let state = row.source_id ? await largeStateKey(client, row.source_id) : null;
    if (!state) return refuseRetry('INTAKE_RETRY_NOT_LARGE');
    const current = await readIntakeDraftTx(client, caseId, itemId);
    if (current.placement !== 'not_understood') refuseRetry('INTAKE_RETRY_NOT_STOPPED');
    const reread = current.limitReason === INTAKE_LARGE_STOPPED && await readCodeChangedTx(client, state.store);
    if (current.limitReason !== INTAKE_LARGE_STOPPED
      || !reread && intakeLargePhase(intakeLargeRows(state.store, state.source)) === 'failure')
      refuseRetry('INTAKE_RETRY_FILE');
    const retry = await intakeLargeRetriesTx(client, state.item) + 1;
    const readGeneration = (state.store.readGeneration ?? 0) + Number(reread);
    // The receipt selects a new generation before any wake-up; ordinary retries keep the active one.
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'intake-large-retry',$3,$4)`, [caseId, key, digest, { itemId, retry, readGeneration }]);
    state = await largeStateKey(client, row.source_id) ?? conflict('The large intake item changed.');
    const rows = intakeLargeRows(state.store, state.source), phase = intakeLargePhase(rows);
    await writeIntakeLargeTx(client, caseId, itemId, intakeLargeProjection(phase, rows, state.store,
      intakeLargeFailureContext(state.store, state.source)));
    const jobId = await queueIntakeLargeTx(client, row.source_id) ?? conflict('This file cannot be queued again.');
    const result = IntakeLargeRetryResultSchema.parse({ itemId, retry, jobId });
    await client.query(`UPDATE operations SET result=$3 WHERE case_id=$1 AND operation_key=$2
      AND kind='intake-large-retry'`, [caseId, key, { ...result, readGeneration }]);
    return result;
  });
}

/** Reviews wake a paused fold, not every intermediate cut. Its eight-unreviewed job is the durable witness;
 * completion always queues the final key. Several reviews may commit before their enqueue transactions, so
 * test for that witness, not an exact seven-unreviewed count. An obsolete witness job also completes forward. */
export async function queueIntakeLargePackageTx(client: PoolClient, packageId: string) {
  const row = (await client.query(`SELECT i.source_id FROM usp_intake_parts part
    JOIN usp_intake_items i ON i.item_id=part.item_id WHERE part.result_ref->>'packageId'=$1 LIMIT 1`,
  [packageId])).rows[0];
  return row ? queueIntakeLargeTx(client, row.source_id, true) : null;
}

export function intakeLargeRows(store: IntakeLargeStore, source: IntakeLargeSource): IntakeLargeRows {
  const receipt = source.inspection?.streamedMapReceipt;
  return { reader: store.reader, profile: store.profile, mapping: store.mapping,
    receiptVerified: Boolean(store.reader) && isRetainedMapOriginal(source)
      && receipt?.rawJobId === store.reader?.job_id,
    recipeState: store.recipe?.state ?? null, prefixRecipe: store.recipe?.plan_version === 'streamed-prefix-mapping/1',
    prefixCheck: store.prefixCheck, publishedPackages: store.parts, foldComplete: false };
}

export function intakeLargePlan(recipe: IntakeLargeStore['recipe']) {
  return recipe ? { recipeId: recipe.id, recipeRevision: recipe.revision, recipeState: recipe.state,
    origin: 'officer', packageId: null } : null;
}

type IntakeLargeFailure = { bytes: number; crsWords: string | null };

/** The file's size, and the words the reader kept when this reader job refused the file's declared system. */
export function intakeLargeFailureContext(store: IntakeLargeStore, source: IntakeLargeSource): IntakeLargeFailure {
  const refusal = source.inspection?.streamedMapRefusal;
  const kept = Boolean(store.reader) && refusal?.rawJobId === store.reader?.job_id
    && typeof refusal?.words === 'string';
  return { bytes: Number(source.bytes), crsWords: kept ? refusal.words : null };
}

/** Drafting pauses at the unfinished-package limit; the row says so instead of reading on. The words are made
 * at call time: the limit's module imports this one. */
function waitingWords(store: IntakeLargeStore): string | null {
  if (store.unreviewed < INTAKE_UNFINISHED_PACKAGE_LIMIT) return null;
  return `${INTAKE_UNFINISHED_PACKAGE_LIMIT} packages of this file wait for review. `
    + 'The rest of the file is cut into packages as these are reviewed.';
}

function prefixChangedWords(failure: PrefixLayoutFailure | undefined): string {
  const next = 'Nothing was drafted. State the layout again for the complete file.';
  if (!failure) return 'A field used by the first-part layout changed or could not be read as stated. ' + next;
  const field = failure.geometryType ? `Geometry type ${failure.geometryType}` : `Field ${failure.sourcePath}`;
  return `${field} at record ${failure.recordOrdinal} does not fit the first-part layout. ${next}`;
}

/** What the row says in each state of the stored rows; only the drafting step writes the end. */
export function intakeLargeProjection(phase: IntakeLargePhase, rows: IntakeLargeRows, store: IntakeLargeStore,
  failure: IntakeLargeFailure): IntakeLargeState {
  const numbers = intakeLargeNumbers(phase, rows), planRef = intakeLargePlan(store.recipe);
  if (phase === 'failure') {
    const code = [rows.reader, rows.profile, rows.mapping].find(row => row && failed(row.state))?.issue_code;
    return { state: 'failed_part', placement: 'not_understood', planRef, ...numbers,
      limitReason: intakeLargeFailureReason(code ?? 'STREAMING_WORKER_ERROR', failure.bytes, failure.crsWords) };
  }
  if (phase === 'question') return { state: 'probed', placement: 'needs_answer',
    planRef: store.profile?.layout_profile ? { layoutProfile: store.profile.layout_profile } : null, ...numbers,
    limitReason: rows.prefixCheck === 'changed'
      ? prefixChangedWords(store.prefixFailure) : INTAKE_LARGE_LAYOUT_QUESTION };
  if (phase === 'layout' || phase === 'map' && !rows.mapping) return { state: 'planned', placement: 'undecided',
    planRef, ...numbers, limitReason: null };
  const prefixWords = phase === 'map' && rows.prefixRecipe
    ? 'The layout is being applied while the file is read. Packages wait for the complete file to be checked.' : null;
  return { state: phase === 'compare' || phase === 'draft' ? 'preparing' : 'reading',
    placement: store.parts ? 'on_map' : 'undecided',
    planRef: phase === 'start' || phase === 'read' ? null : planRef, ...numbers,
    limitReason: phase === 'draft' ? waitingWords(store) : prefixWords };
}

/** After the last cut; a file with no cut rests not understood with the same counts. */
export function intakeLargeEnd(counts: IntakeLargeCounts, planRef: IntakeLargeState['planRef']): IntakeLargeState {
  const beyond = counts.linesBeyondLimit ?? 0;
  const state = beyond > 0 ? 'read_to_limit' : 'read';
  const ceiling = beyond > 0 ? `${counts.recordsRead.toLocaleString('en-US')} of `
    + `${(counts.recordsRead + beyond).toLocaleString('en-US')} features read; the rest is kept, not read.` : null;
  const limitReason = [ceiling, intakeLargeHoldsReason(counts)].filter(Boolean).join(' ') || null;
  if (!counts.packages) return { state, placement: 'not_understood', planRef,
    recordsSeen: counts.recordsRead, partsPlanned: null, partsDone: 0, limitReason };
  return { state, placement: 'on_map', planRef, recordsSeen: counts.recordsRead,
    partsPlanned: counts.packages, partsDone: counts.packages, limitReason };
}
