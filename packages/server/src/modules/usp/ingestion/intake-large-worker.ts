import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { GisSetAsideSchema, type GisSetAside, type MapArea } from '@ulpin/contracts';
import { StreamedMappingReceiptSchema, StreamedMappingPlanSchema, StreamingVectorGeometrySummarySchema,
  type StreamedMappingPlan, type StreamedProfileGeneration, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange, putOriginalStream, verifyObjectStream } from '../../../infrastructure/storage';
import { createSourceCase } from '../../cases/source-cases';
import { fingerprint } from '../../cases/domain';
import { prepareProvedAreaImport } from '../../areas/areas';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, heartbeatUspJobAttempt,
  recordUspJobFailure, USP_JOB_LIMITS, type UspJobAttempt } from '../jobs';
import { ChunkMappingService } from './chunk-mapping';
import { caseScopedDestination, intakeCaseArea, intakeDestination, retiredFileAreaWords } from './intake-destination';
import { assertIntakeDraftTx } from './intake-draft';
import { intakeGeojsonFraming } from './geojson-framing';
import { INTAKE_LARGE_STOPPED, IntakeLargeInputSchema, intakeLargeAtRest, intakeLargeCutKey, intakeLargeEnd,
  intakeLargeFailureContext, intakeLargePartRefusal, intakeLargePhase, intakeLargePlan, intakeLargeProjection,
  intakeLargeRequestKey, intakeLargeRows, intakeLargeStepCurrent, largeStateKey, queueIntakeLargeTx,
  type IntakeLargeInput
} from './intake-large';
import { readIntakeDraftTx, withCellFiles, writeIntakeDraftTx, writeIntakeLargeTx,
  type IntakeLargeState } from './intake-ledger';
import { IntakePackageCutter, pairMappedFeatures, type HeldPartCode, type HeldPartFeature,
  type IntakePackageCut, type MappedPartFeature } from './intake-package-cuts';
import type { AreaFrame } from './intake-package-extent';
import { CellFileCollector, cellFileWords, cellReceiptWaitWords, cellLayout, readRawFeatureRanges, retainCellFiles,
  type CellFileResult } from './intake-cell-files';
import { LargeOriginalService } from './large-original';
import { IntakeService } from './intake-service';
import { draftIntakePartTx, readObservedIntakeCut, IntakeMappingCutPending,
  INTAKE_UNFINISHED_PACKAGE_LIMIT, type IntakePartHeld } from './intake-part-draft';
import { partStageTimer, readProvedAreaPart, type PartTiming, type ProvedAreaPartInput } from './proved-area-part';
import { setAsideGeometryTypes } from './registry';
import { loadProvisionalStreamedProfileTx, loadSealedStreamedProfileTx,
  StreamedProfileService } from './streamed-profile';
import { approveWithTx, carriedApprovalTx, cellParentLayoutTx } from './service';
import { compileStreamedMapping, loadPrefixSealTx, prefixLayoutMatchesSealed, prefixMappingFailure,
  prefixSealCheckKey, type PrefixLayoutFailure } from './streamed-mapping';
import { StreamingVectorService } from './streaming-vector';
import { readPinnedRawChunk } from './streamed-profile-worker';
import { candidateKeyHashes, normalizeMappedChunk, type KeyRow } from './chunk-mapping-normalizer';
import { assertConverterLayoutTx, nativeConverterPin, nativeConverterOperations } from './intake-native-derivative';

const reader = new StreamingVectorService();
const profiler = new StreamedProfileService();
const mapper = new ChunkMappingService();
const DRAFT_STEP_MS = 60000, RANGE_MS = 30000;
type State = NonNullable<Awaited<ReturnType<typeof largeStateKey>>>;
type Outcome = 'more' | 'pressure' | 'stale' | 'end' | 'receipt';
type Fold = {
  readerJobId: string; mappingJobId: string; chunks: number; firstChunk: number; after: number; parts: number;
  cutKey: string; held: IntakePartHeld; pending: HeldPartFeature[]; conflicts: Set<number>;
  metadata: Record<string, unknown>; frame: AreaFrame | null;
  part: Omit<ProvedAreaPartInput, 'cutIndex' | 'features'>; objectKey: string; sourceBytes: number;
  recordsRead: number; readerRejected: number; started: number; kind: string;
  chunkReadMs: number; chunkReads: number; complete: boolean; retryAt?: number;
};
const HELD_COUNT: Readonly<Record<HeldPartCode, keyof IntakePartHeld>> = {
  PART_FEATURE_VERTEX_BOUND: 'held', PART_FEATURE_INPUT_BOUND: 'held',
  PART_FEATURE_EXTENT_BOUND: 'heldWide', PART_FEATURE_AREA_BOUND: 'heldOutside',
  PART_FEATURE_POSITION_UNMEASURED: 'heldUnmeasured',
};

/** The bounded draft job's case and source lock, the attempt fence, then the stored rows.
 * Cuts take case UPDATE before their job fence; read-only follow-up scopes may use KEY SHARE. */
async function pinned<T>(input: IntakeLargeInput, attempt: UspJobAttempt | undefined,
  work: (client: PoolClient, state: State) => Promise<T>,
  lockCase: boolean | 'share' = true, timing?: PartTiming): Promise<T> {
  const mark = partStageTimer(timing);
  const result = await transaction(async client => {
    mark('transactionWaitBegin');
    await assertIntakeDraftTx(client, input, lockCase === true);
    // Profile loaders also take case SHARE; acquire it before the attempt, never upgrade behind a job lock.
    if (lockCase === 'share') await client.query('SELECT id FROM cases WHERE id=$1 FOR SHARE', [input.caseId]);
    if (attempt) await assertUspJobAttemptTx(client, attempt);
    mark('lockFence');
    const state = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
    mark('pinnedStateRead');
    const result = await work(client, state);
    mark('transactionWork');
    return result;
  });
  mark('commitRelease');
  return result;
}

/** Only a complete, matching accepted summary supplies kind counts; multipart members are never guessed. */
function acceptedKindCounts(rawSummary: unknown, rawJobId: string, accepted: number) {
  const parsed = StreamingVectorGeometrySummarySchema.safeParse(rawSummary);
  if (!parsed.success || parsed.data.rawJobId !== rawJobId) return null;
  const counts = parsed.data.counts;
  return Object.values(counts).reduce((total, count) => total + count, 0) === accepted ? counts : null;
}

/** The pins and lines an outline layout sets aside, as the reader counted them; none without that count. */
export function intakeLargeSetAside(kind: string, rawSummary: unknown, rawJobId: string,
  accepted: number): GisSetAside | undefined {
  const counts = acceptedKindCounts(rawSummary, rawJobId, accepted);
  const outline = GisSetAsideSchema.shape.kind.safeParse(kind);
  if (!counts || !outline.success) return undefined;
  const setAside = Object.fromEntries(setAsideGeometryTypes(kind, Object.keys(counts))
    .map(type => [type, counts[type as keyof typeof counts]]));
  return Object.keys(setAside).length ? { kind: outline.data, counts: setAside } : undefined;
}

export function intakeLargeGeometryProjection(projection: IntakeLargeState, rawSummary: unknown,
  rawJobId: string, accepted: number): IntakeLargeState {
  const counts = acceptedKindCounts(rawSummary, rawJobId, accepted);
  if (!counts) return projection;
  const nonFootprints = (['Point', 'MultiPoint', 'LineString', 'MultiLineString'] as const)
    .filter(kind => counts[kind] !== undefined)
    .map(kind => `${counts[kind]} ${kind} feature${counts[kind] === 1 ? '' : 's'}`);
  if (!nonFootprints.length) return projection;
  const words = `Read ${nonFootprints.join(' / ')}; they are not footprints.`;
  const readOnly = !counts.Polygon && !counts.MultiPolygon
    && projection.state === 'probed' && projection.placement === 'needs_answer';
  return { ...projection, state: readOnly ? 'read' : projection.state,
    limitReason: [words, projection.limitReason].filter(Boolean).join(' ') };
}

function geometryProjection(projection: IntakeLargeState, state: State): IntakeLargeState {
  const raw = state.store.reader;
  if (!raw || !intakeLargeRows(state.store, state.source).receiptVerified) return projection;
  return intakeLargeGeometryProjection(projection, state.source.inspection?.streamedGeometrySummary,
    raw.job_id, raw.records - raw.quarantined);
}

export async function publishTx(client: PoolClient,
  input: Pick<IntakeLargeInput, 'caseId' | 'itemId' | 'subject'>, state: State) {
  if (intakeLargeAtRest(state.item)) return;
  const rows = intakeLargeRows(state.store, state.source);
  let phase = intakeLargePhase(rows);
  // A cell's full inventory is needed for containment; do not ask while it is still being read.
  if (phase === 'question' && !state.store.recipe && state.store.profile?.state !== 'sealed'
    && (nativeConverterPin(state.source) || await cellParentLayoutTx(client, state.source, input.subject)))
    phase = 'read';
  const projection = intakeLargeProjection(phase, rows, state.store,
    intakeLargeFailureContext(state.store, state.source));
  if (projection.planRef?.recipeId
    && (state.source.inspection?.cellDerivative || state.source.inspection?.nativeDerivative))
    projection.planRef = await cellPlanTx(client, state) ?? projection.planRef;
  const closed = !['start', 'read', 'failure'].includes(phase);
  await writeIntakeLargeTx(client, input.caseId, input.itemId,
    closed ? geometryProjection(projection, state) : projection);
}

/** The child's own row names the parent press, without changing its parent's card or progress. */
export async function cellPlanTx(client: PoolClient,
  state: { store: Pick<State['store'], 'recipe'>; source: Pick<State['source'], 'inspection'> }) {
  const plan = intakeLargePlan(state.store.recipe);
  if (!plan || !(state.source.inspection?.cellDerivative || state.source.inspection?.nativeDerivative)) return plan;
  const body = (await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1',
    [state.store.recipe!.id])).rows[0]?.body;
  const receipt = StreamedMappingReceiptSchema.parse(body);
  if (receipt.plan.basis === 'converter_recorded') return { ...plan, origin: null };
  const press = await carriedApprovalTx(client, receipt);
  return press?.parentFile ? { ...plan, origin: 'parent_file', parentSourceId: press.sourceId } : plan;
}

/** Author only a first untouched cell proposal. A sealed inventory checks every column before carrying. */
async function prepareCellLayoutTx(client: PoolClient, input: IntakeLargeInput, state: State) {
  if (state.store.recipe || state.store.profile?.state !== 'sealed') return false;
  const parent = await cellParentLayoutTx(client, state.source, input.subject);
  if (!parent && !nativeConverterPin(state.source)) return false;
  const stored = (await client.query(`SELECT body FROM usp_streamed_profile_generations
    WHERE job_id=$1 AND generation=$2 AND sealed`,
  [state.store.profile.job_id, state.store.profile.sealed_generation])).rows[0]?.body;
  if (!stored) return false;
  const loaded = await loadSealedStreamedProfileTx(client, state.store.profile.job_id,
    stored.generation, stored.generationHash, state.store.reader!.job_id, input.caseId, input.sourceId);
  const pins = { ...input, caseRevision: loaded.input.caseRevision };
  if (nativeConverterPin(state.source))
    return recordConverterLayoutTx(client, pins, state.source, loaded.profile);
  return carryCellLayoutTx(client, pins, state.source, loaded.profile);
}

/** A converter's first sealed layout authorizes drafts only, never an officer answer or registry admission. */
export async function recordConverterLayoutTx(client: PoolClient,
  input: Pick<IntakeLargeInput, 'caseId' | 'sourceId' | 'caseRevision' | 'subject'>,
  source: State['source'], profile: StreamedProfileGeneration) {
  const converterPin = nativeConverterPin(source), operations = nativeConverterOperations(source);
  if (!converterPin || !operations || source.id !== profile.source.sourceId
    || source.revision !== profile.source.sourceRevision || source.sha256 !== profile.source.sourceSha256)
    return false;
  const plan = StreamedMappingPlanSchema.parse({ version: 'streamed-mapping/1', mode: 'streamed_mapping',
    scope: 'accepted_source_features', source: profile.source, caseId: input.caseId, caseRevision: input.caseRevision,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId, profileGeneration: profile.generation,
    profileHash: profile.generationHash, basis: 'converter_recorded', converterPin,
    kind: 'building', operations, semanticEvidence: [] });
  try {
    compileStreamedMapping(plan, profile);
    await assertConverterLayoutTx(client, plan, source);
  } catch (error) {
    if (error instanceof AppError && error.status === 422) return false;
    throw error;
  }
  const at = new Date().toISOString(), planHash = fingerprint(plan);
  const receipt = StreamedMappingReceiptSchema.parse({ id: randomUUID(), revision: 1, state: 'approved', plan,
    planHash, authoredBy: input.subject, authoredAt: at,
    approval: { subject: null, at, planHash, provenance: 'converter_recorded' } });
  await client.query(`INSERT INTO usp_mapping_recipes(id,case_id,source_id,revision,state,body)
    VALUES($1,$2,$3,1,'approved',$4)`, [receipt.id, input.caseId, input.sourceId, receipt]);
  await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,1,$2)',
    [receipt.id, receipt]);
  return true;
}

/** The validated child's first plan is the parent's decisions, pinned to the child's own sealed reader. */
export async function carryCellLayoutTx(client: PoolClient,
  input: Pick<IntakeLargeInput, 'caseId' | 'sourceId' | 'caseRevision' | 'subject'>,
  source: Pick<State['source'], 'inspection'>, profile: StreamedProfileGeneration) {
  if ((await client.query('SELECT 1 FROM usp_mapping_recipes WHERE source_id=$1', [input.sourceId])).rowCount)
    return false;
  const matched = await cellParentLayoutTx(client, source, input.subject, profile);
  if (!matched || 'heightField' in cellLayout(matched.receipt.plan)) return false;
  const plan = StreamedMappingPlanSchema.parse({ ...cellLayout(matched.receipt.plan),
    version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
    source: profile.source, caseId: input.caseId, caseRevision: input.caseRevision,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId, profileGeneration: profile.generation,
    profileHash: profile.generationHash, basis: 'officer_stated', semanticEvidence: [] });
  try { compileStreamedMapping(plan, profile); }
  catch (error) {
    if (error instanceof AppError && error.status === 422) return false;
    throw error;
  }
  const receipt = StreamedMappingReceiptSchema.parse({ id: randomUUID(), revision: 1, state: 'proposed', plan,
    planHash: fingerprint(plan), authoredBy: input.subject, authoredAt: new Date().toISOString(), approval: null });
  await client.query(`INSERT INTO usp_mapping_recipes(id,case_id,source_id,revision,state,body)
    VALUES($1,$2,$3,1,'proposed',$4)`, [receipt.id, input.caseId, input.sourceId, receipt]);
  await client.query('INSERT INTO usp_mapping_recipe_revisions(recipe_id,revision,body) VALUES($1,1,$2)',
    [receipt.id, receipt]);
  await approveWithTx(client, receipt, matched.press);
  return true;
}

/** Every step ends here: the row shows its stored state and the transaction queues the next state's job. */
async function complete(input: IntakeLargeInput, attempt: UspJobAttempt, publish: boolean, retryAt?: number) {
  await acceptUspJobAttempt(attempt, { assetId: `intake-large:${input.itemId}`, version: 1, sha256: input.stateKey },
    async (_client, job) => {
      if (fingerprint(job.payload) !== fingerprint(input)) conflict('The large intake step changed.');
    }, client => assertIntakeDraftTx(client, input).then(() => {}), async client => {
      const state = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
      if (publish) await publishTx(client, input, state);
      const next = await queueIntakeLargeTx(client, input.sourceId);
      if (retryAt && next) await client.query(`UPDATE jobs SET next_attempt_at=$2 WHERE id=$1 AND status='queued'`,
        [next, new Date(retryAt).toISOString()]);
    });
}

/** The enqueue pins the case revision it saw; a replayed enqueue of an unchanged request sends the same pins. */
async function caseRevision(input: IntakeLargeInput, attempt: UspJobAttempt | undefined): Promise<number> {
  return pinned(input, attempt, async client => Number((await client.query('SELECT revision FROM cases WHERE id=$1',
    [input.caseId])).rows[0].revision));
}

/** The reader and the profile through their own admission, with the item's stable request keys. */
async function startReaders(input: IntakeLargeInput, attempt: UspJobAttempt | undefined, state: State) {
  const pins = { expectedCaseRevision: await caseRevision(input, attempt),
    expectedSourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256 };
  const framing = state.item.card && intakeGeojsonFraming(state.item.card);
  if (!framing) conflict('The reading card does not name a supported GeoJSON framing.');
  const rawJobId = state.store.reader?.job_id ?? (await reader.enqueue(input.caseId, input.sourceId, {
    requestKey: intakeLargeRequestKey(input.itemId, 'reader', 0, state.store.readGeneration),
    framing, ...pins })).jobId;
  if (!state.store.profile) await profiler.enqueue(input.caseId, input.sourceId,
    { requestKey: intakeLargeRequestKey(input.itemId, 'profile', 0, state.store.readGeneration), rawJobId, ...pins });
}

/** The approved layout's own pins admit the part mapping; the row says approved before it runs. */
async function startMapping(input: IntakeLargeInput, attempt: UspJobAttempt | undefined, state: State) {
  const recipe = state.store.recipe!;
  const plan = await pinned(input, attempt, async (client, current) => {
    await publishTx(client, input, current);
    return (await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1', [recipe.id])).rows[0].body.plan;
  });
  await mapper.enqueue(input.caseId, input.sourceId, {
    requestKey: intakeLargeRequestKey(input.itemId, 'mapping', recipe.revision, state.store.readGeneration),
    rawJobId: plan.rawJobId,
    expectedCaseRevision: await caseRevision(input, attempt), expectedSourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, profileJobId: plan.profileJobId, profileGeneration: plan.profileGeneration,
    profileHash: plan.profileHash,
    ...(plan.version === 'streamed-prefix-mapping/1'
      ? { prefixAdmissionVersion: 'streamed-prefix-admission/1' } : {}) });
}

/** The GIS suggestion's rule for a retained original that has none: its file name and its bytes' namespace, scoped
 * to the case as the recipe path scopes it. The area's revision is left out so a replayed cut keeps its import
 * signature while earlier cuts move the area. */
async function largeDestination(input: IntakeLargeInput, name: string, area: MapArea | null)
  : Promise<ProvedAreaPartInput['destination']> {
  const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150) || 'GIS source';
  const destination = await caseScopedDestination(input.caseId,
    intakeDestination({ suggestedTitle: title, suggestedNamespace: `file:${input.sourceSha256}` }, area));
  return { namespace: destination.namespace, name: destination.name,
    ...(destination.kind === 'existing_area' ? { areaId: destination.areaId } : {}) };
}

/** The reference the map processor places this file's packages in: its destination area's, once that has one. */
async function destinationFrameTx(client: PoolClient, destination: ProvedAreaPartInput['destination'])
  : Promise<AreaFrame | null> {
  const [where, key] = destination.areaId ? ['id=$1', destination.areaId]
    : ['seed_key=$1', `${destination.namespace}:${destination.name}`];
  const reference = (await client.query(`SELECT reference FROM map_areas WHERE ${where}`, [key])).rows[0]?.reference;
  if (typeof reference?.analysisCrs !== 'string' || !Array.isArray(reference.origin)) return null;
  return { analysisCrs: reference.analysisCrs, origin: [Number(reference.origin[0]), Number(reference.origin[1])] };
}

/** Resume after the last stored cut: its end locator, the next index and the held counts through its end. */
async function foldContext(input: IntakeLargeInput, attempt: UspJobAttempt): Promise<Fold> {
  const destination = await largeDestination(input, await sourceName(input), await intakeCaseArea(input.caseId));
  return pinned(input, attempt, async (client, state) => {
    const { reader: raw, mapping, recipe } = state.store;
    await publishTx(client, input, state);
    const last = (await client.query(`SELECT locator,counts FROM usp_intake_parts WHERE item_id=$1
      AND locator->>'mappingJobId'=$2 ORDER BY part_index DESC LIMIT 1`, [input.itemId, mapping!.job_id])).rows[0];
    const nextIndex = (await client.query(`SELECT COALESCE(max(part_index)+1,0)::int n FROM usp_intake_parts
      WHERE item_id=$1`, [input.itemId])).rows[0].n;
    const after = last ? Number(last.locator.featureIndices.at(-1)) : -1;
    const first = (await client.query(`SELECT min(chunk_index)::int n FROM usp_streaming_vector_slots
      WHERE job_id=$1 AND published AND last_feature_index>$2`, [raw!.job_id, after])).rows[0].n;
    const conflicts = (await client.query(`SELECT first_feature_index,later_feature_index
      FROM usp_chunk_mapping_conflicts WHERE job_id=$1`, [mapping!.job_id])).rows
      .flatMap(row => [Number(row.first_feature_index), Number(row.later_feature_index)]);
    const layout = (await client.query(`SELECT body->>'planHash' hash,body->'plan'->>'kind' kind
      FROM usp_mapping_recipes WHERE id=$1`, [recipe!.id])).rows[0];
    const held = { held: Number(last?.counts.held ?? 0), heldWide: Number(last?.counts.heldWide ?? 0),
      heldOutside: Number(last?.counts.heldOutside ?? 0), heldUnmeasured: Number(last?.counts.heldUnmeasured ?? 0) };
    const checked = state.source.inspection?.intakePrefixSealCheck;
    const preflightConflicts: number[] = state.store.prefixCheck === 'matched' ? checked.conflicts ?? [] : [];
    const complete = !mapping!.unknown_remainder && mapping!.sealed_chunks === raw!.sealed_chunks
      && mapping!.next_publish_index === raw!.sealed_chunks && mapping!.records === raw!.records
      && ['completed', 'completed_with_rejections', 'needs_input'].includes(mapping!.state);
    return { readerJobId: raw!.job_id, mappingJobId: mapping!.job_id,
      chunks: Math.min(mapping!.next_publish_index, Number(raw!.sealed_chunks)), complete,
      firstChunk: first ?? Number(raw!.sealed_chunks), after, parts: nextIndex,
      cutKey: intakeLargeCutKey(state.store), held, pending: [], frame: await destinationFrameTx(client, destination),
      conflicts: new Set([...conflicts, ...preflightConflicts]),
      metadata: state.source.inspection?.streamedMapReceipt.collectionMetadata,
      part: { sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
        readerVersion: 'geojson-stream/2', layoutHash: layout.hash, destination },
      objectKey: state.source.object_key, sourceBytes: Number(state.source.bytes), recordsRead: raw!.records,
      readerRejected: raw!.quarantined, started: Date.now(), kind: layout.kind ?? 'building',
      chunkReadMs: 0, chunkReads: 0 };
  });
}

async function sourceName(input: IntakeLargeInput): Promise<string> {
  return (await query('SELECT name FROM sources WHERE id=$1', [input.sourceId])).rows[0].name;
}

class SealedChunkCodeChanged extends AppError {
  constructor(message: string) { super(409, 'STALE_REVISION', message); }
}

async function pairedChunk(input: IntakeLargeInput, fold: Fold, index: number): Promise<MappedPartFeature[]> {
  const started = performance.now();
  const raw = await reader.chunk(input.caseId, input.sourceId, fold.readerJobId, index);
  const mapped = await mapper.chunk(input.caseId, input.sourceId, fold.mappingJobId, index);
  const failed = Object.entries({
    'raw.current': !raw.current, 'raw.sourceComplete': !raw.sourceComplete,
    'raw.unknownRemainder': raw.unknownRemainder, 'raw.payload': !raw.payload,
    'mapped.current': !mapped.current, 'mapped.payload': !mapped.payload,
  }).filter(([, failed]) => failed).map(([condition]) => condition);
  if (failed.length || !raw.payload || !mapped.payload) {
    const message = `Sealed chunk ${index} unavailable: ${failed.join(', ')}; `
      + `raw reasons: ${raw.reasons.join(', ') || 'none'}; mapped reasons: ${mapped.reasons.join(', ') || 'none'}.`;
    // Another identical attempt cannot restore deployed code pins. Keep the officer's explicit retry path.
    const codeChanged = [...raw.reasons, ...mapped.reasons]
      .some(reason => reason === 'reader_changed' || reason === 'converter_changed');
    if (codeChanged) throw new SealedChunkCodeChanged(message
      + ' Try again starts a new read with the current reader and converter.');
    conflict(message);
  }
  const features = pairMappedFeatures(raw.payload.records, mapped.payload.records, fold);
  fold.chunkReadMs += performance.now() - started;
  fold.chunkReads++;
  return features;
}

/** The cut's original bytes in contiguous spans of at most 1 MiB; each feature is sliced from its span. */
async function rawFeatures(fold: Fold, cut: IntakePackageCut, timing: PartTiming, beat: () => Promise<void>)
  : Promise<ProvedAreaPartInput['features']> {
  const features: ProvedAreaPartInput['features'] = [];
  let requests = 0, bytes = 0;
  const read = async (start: number, end: number) => {
    requests++;
    const body = Buffer.from(await readObjectRange(fold.objectKey,
      start, end, fold.sourceBytes, Date.now() + RANGE_MS, AbortSignal.timeout(RANGE_MS)));
    await beat();
    bytes += body.byteLength;
    return body;
  };
  let index = 0;
  for await (const item of readRawFeatureRanges(cut.features.map(item => item.raw), read)) {
    features.push({ rawChunkIndex: cut.features[index++].mapped.geometryRef!.chunkIndex,
      featureIndex: item.range.featureIndex, rawBytes: item.bytes });
  }
  timing('rawRangeRequests', requests);
  timing('rawRangeBytes', bytes);
  return features;
}

function countHeld(total: IntakePartHeld, items: HeldPartFeature[]): IntakePartHeld {
  const sum = { ...total };
  for (const item of items) sum[HELD_COUNT[item.code]]++;
  return sum;
}

/** Held features up to a cut's last feature count with that cut; later ones wait for the next cut or the end. */
function heldThrough(fold: Fold, cut: IntakePackageCut | undefined): IntakePartHeld {
  const end = cut ? cut.features.at(-1)!.raw.featureIndex : Infinity;
  fold.held = countHeld(fold.held, fold.pending.filter(held => held.featureIndex < end));
  fold.pending = fold.pending.filter(held => held.featureIndex > end);
  return fold.held;
}

/** Revisit sealed pairs only at EOF, including holds before stored cuts. No parsed feature survives a chunk.
 * The fixed first-area frame reproduces AREA_BOUND holds; the child range manifests are bounded by the reader. */
async function deriveCellFiles(input: IntakeLargeInput, attempt: UspJobAttempt, fold: Fold,
  outside: number): Promise<CellFileResult | undefined> {
  if (!outside) return undefined;
  const collector = new CellFileCollector(fold.metadata), beat = heartbeat(input, attempt);
  const cutter = new IntakePackageCutter(fold.metadata, undefined, fold.frame);
  for (let index = 0; index < fold.chunks; index++) {
    for (const item of await pairedChunk(input, { ...fold, after: -1 }, index)) {
      if (cutter.consume(item).held?.code !== 'PART_FEATURE_AREA_BOUND') continue;
      const { featureIndex, byteStart, byteEnd, rawSha256 } = item.raw;
      collector.add(item.feature, { featureIndex, byteStart, byteEnd, rawSha256 });
    }
    await beat();
  }
  const counted = [...collector.cells.values()].reduce((sum, cell) => sum + cell.ranges.length, 0);
  if (counted + collector.heldFeatures !== outside) conflict('The outside-area feature count changed.');
  const parent = { id: input.sourceId, revision: input.sourceRevision, sha256: input.sourceSha256,
    case_id: input.caseId, itemId: input.itemId, name: await sourceName(input) };
  return retainCellFiles(parent, collector, fold.metadata, {
    transaction, createCase: createSourceCase, large: new LargeOriginalService(),
    register: (caseId, raw) => new IntakeService().register(caseId, raw),
    beat: async () => { await beat(); await pinned(input, attempt, async () => {}); },
    read: async (start, end) => Buffer.from(await readObjectRange(fold.objectKey, start, end, fold.sourceBytes,
      Date.now() + RANGE_MS, AbortSignal.timeout(RANGE_MS))),
    putSidecar: async (ref, chunks) => {
      await putOriginalStream(ref.key, Readable.from(chunks, { objectMode: false }), ref.bytes,
        'application/x-ndjson', ref.sha256, AbortSignal.timeout(RANGE_MS));
      await verifyObjectStream(ref.key, ref.bytes, ref.sha256, RANGE_MS, undefined,
        AbortSignal.timeout(RANGE_MS));
    },
  });
}

async function writeEndTx(client: PoolClient, input: IntakeLargeInput, fold: Fold, state: State,
  cells?: CellFileResult) {
  const parts = (await client.query(`SELECT count(*)::int n,COALESCE(sum((counts->>'accepted')::int),0)::int accepted
    FROM usp_intake_parts WHERE item_id=$1 AND locator->>'mappingJobId'=$2`,
  [input.itemId, fold.mappingJobId])).rows[0];
  const setAside = intakeLargeSetAside(fold.kind, state.source.inspection?.streamedGeometrySummary,
    fold.readerJobId, fold.recordsRead - fold.readerRejected);
  const held = countHeld(fold.held, fold.pending);
  const inventory = fold.readerRejected ? (await client.query<{
    locators: StreamedProfileGeneration['quarantineLocators'];
  }>(`SELECT body->'quarantineLocators' locators FROM usp_streamed_profile_generations
    WHERE job_id=$1 AND ($2::int IS NULL OR generation=$2) ORDER BY generation DESC LIMIT 1`,
  [state.store.profile!.job_id, state.store.profile!.sealed_generation])).rows[0] : undefined;
  const readerRejectedPositions = (inventory?.locators ?? []).flatMap(locator =>
    locator.sequencePosition ? [locator.sequencePosition] : []).slice(0, 5);
  const projection = intakeLargeEnd({ recordsRead: fold.recordsRead,
    linesBeyondLimit: state.store.reader?.lines_beyond_limit,
    accepted: parts.accepted, packages: parts.n, readerRejected: fold.readerRejected, readerRejectedPositions,
    duplicates: fold.conflicts.size, oversized: held.held, wide: held.heldWide,
    outside: cells ? 0 : held.heldOutside, unmeasured: held.heldUnmeasured, setAside },
  // CN1: each retained cell's own case, source and item, kept beside the plan in the same end transaction.
  withCellFiles(await cellPlanTx(client, state), cells?.children));
  if (cells) projection.limitReason = [cellFileWords(parts.accepted, cells), projection.limitReason]
    .filter(Boolean).join(' ');
  await writeIntakeLargeTx(client, input.caseId, input.itemId, geometryProjection(projection, state));
}

/** One cut, one transaction: it drafts only while the fold's stored context is unchanged.
 * Completion queues the final key, never an intermediate key behind this still-folding step.
 * The last cut also writes the end; `cut` is absent when the file ends after a stored cut. */
async function draftCut(input: IntakeLargeInput, attempt: UspJobAttempt, fold: Fold,
  cut: IntakePackageCut | undefined, end: boolean): Promise<Outcome> {
  const started = performance.now(), stages: Record<string, number> = {};
  const timing: PartTiming = (stage, ms) => { stages[stage] = (stages[stage] ?? 0) + ms; };
  const mark = partStageTimer(timing);
  const beat = heartbeat(input, attempt);
  const features = cut ? await rawFeatures(fold, cut, timing, beat) : [];
  mark('rawFeatures');
  const part = cut ? { ...fold.part, cutIndex: cut.index, features } : undefined;
  const observed = part ? await readObservedIntakeCut(part, input.caseId, fold.mappingJobId, fold.readerJobId, beat)
    : undefined;
  await beat();
  mark('observedCut');
  const proved = part ? await readProvedAreaPart(part, beat) : undefined;
  await beat();
  mark('provedCut');
  const prepared = part && proved ? await prepareProvedAreaImport(part, proved) : undefined;
  await beat();
  mark('normalizeCut');
  const held = heldThrough(fold, cut);
  const cells = end ? await deriveCellFiles(input, attempt, fold, countHeld(held, fold.pending).heldOutside)
    : undefined;
  mark('heldAndCells');
  const outcome = await pinned(input, attempt, async (client, state) => {
    const mark = partStageTimer(timing);
    if (intakeLargeCutKey(state.store) !== fold.cutKey) return 'stale';
    if (cells?.receiptWait?.retryAt) {
      const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
      await writeIntakeDraftTx(client, input.caseId, input.itemId,
        { ...current, limitReason: cellReceiptWaitWords(cells.receiptWait) });
      await client.query(
        `UPDATE sources SET inspection=inspection||jsonb_build_object('intakeCellReceiptWait',$2::jsonb)
        WHERE id=$1`, [input.sourceId, JSON.stringify({ jobId: input.jobId })]);
      fold.retryAt = cells.receiptWait.retryAt;
      return 'receipt';
    }
    await cellPlanTx(client, state);
    if (part && observed) await draftIntakePartTx(client, input.itemId, fold.mappingJobId,
      part, observed, held, timing, proved, prepared);
    mark('draftIntakePartTx');
    const after = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
    mark('largeStateKeyAfter');
    if (end) await writeEndTx(client, input, fold, after, cells);
    mark('writeEnd');
    fold.cutKey = intakeLargeCutKey(after.store);
    if (end) return 'end';
    return after.store.unreviewed >= INTAKE_UNFINISHED_PACKAGE_LIMIT ? 'pressure' : 'more';
  }, true, timing);
  console.info(JSON.stringify({ event: 'intake_large_cut', jobId: input.jobId, itemId: input.itemId,
    cutIndex: cut?.index ?? null, features: features.length, end, outcome,
    pairedChunkMs: fold.chunkReadMs, pairedChunks: fold.chunkReads,
    cutMs: performance.now() - started, stages }));
  fold.chunkReadMs = 0;
  fold.chunkReads = 0;
  return outcome;
}

function heartbeat(input: IntakeLargeInput, attempt: UspJobAttempt) {
  let last = Date.now(), renewing: Promise<void> | undefined;
  return async () => {
    if (renewing) return renewing;
    if (Date.now() - last < USP_JOB_LIMITS.heartbeatSeconds * 1000) return;
    renewing = (async () => {
      await heartbeatUspJobAttempt(attempt, client => assertIntakeDraftTx(client, input).then(() => {}));
      await query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1 AND status='running'",
        [input.jobId]);
      last = Date.now();
    })();
    try { await renewing; }
    finally { renewing = undefined; }
  };
}

/** Follow only committed publications, without holding a transaction while waiting. The bounded live fold
 * retains its unfinished package, so successive chunks do not cause a quadratic reread of that suffix. */
async function moreMapped(input: IntakeLargeInput, attempt: UspJobAttempt, fold: Fold): Promise<boolean> {
  if (Date.now() - fold.started >= DRAFT_STEP_MS) return false;
  await delay(100);
  return pinned(input, attempt, async (_client, state) => {
    if (intakeLargeCutKey(state.store) !== fold.cutKey) return false;
    fold.chunks = Math.min(state.store.mapping!.next_publish_index, Number(state.store.reader!.sealed_chunks));
    return true;
  }, false);
}

/** Fold published pairs in order from the last stored cut; stop at eight unreviewed, closure or 60 seconds.
 * A destination area without a reference takes it from the first cut, so the step ends there and the next step
 * cuts the rest in that stored reference, as a resumed fold would. */
async function draft(input: IntakeLargeInput, attempt: UspJobAttempt) {
  const fold = await foldContext(input, attempt), beat = heartbeat(input, attempt);
  const cutter = new IntakePackageCutter(fold.metadata, { index: fold.parts, previous: fold.after }, fold.frame);
  let index = fold.firstChunk;
  do {
    for (; index < fold.chunks; index++) {
      for (const item of await pairedChunk(input, fold, index)) {
        const result = cutter.consume(item);
        if (result.held) fold.pending.push(result.held);
        if (!result.cut) continue;
        const outcome = await draftCut(input, attempt, fold, result.cut, false);
        // Release this step after a streaming cut so its newly queued intake-run can take the case gate.
        if (outcome !== 'more' || !fold.frame || !fold.complete || Date.now() - fold.started >= DRAFT_STEP_MS) return;
        await beat();
      }
      await beat();
    }
    if (fold.complete) {
      await draftCut(input, attempt, fold, cutter.close(), true);
      return fold.retryAt;
    }
    await beat();
  } while (await moreMapped(input, attempt, fold));
}

type RawCheckSlot = {
  chunk_index: number; result_sha256: string; object_key: string | null; object_sha256: string | null;
  bytes: number | string;
};
type RawCheck = {
  plan: StreamedMappingPlan; profile: StreamedProfileGeneration; readerJobId: string;
  keys: Map<string, KeyRow>; conflicts: Set<number>; failure?: PrefixLayoutFailure;
};

/** Reuse mapping's exact identity and used-field rules; late duplicates exclude their earlier occurrences too. */
export function checkIntakeLargeChunk(check: RawCheck, records: StreamingVectorRecord[], index: number) {
  const existing = candidateKeyHashes(records, check.plan)
    .flatMap(hash => check.keys.has(hash) ? [check.keys.get(hash)!] : []);
  const mapped = normalizeMappedChunk(records, check.plan, check.profile, check.readerJobId, index, existing);
  check.failure ??= prefixMappingFailure(mapped.records, records);
  for (const key of mapped.keys) {
    if (key.laterIndex === null) check.keys.set(key.hash,
      { source_key_sha256: key.hash, source_key: key.value, first_feature_index: key.firstIndex });
    else { check.conflicts.add(key.firstIndex); check.conflicts.add(key.laterIndex); }
  }
}

/** Check the sealed raw inventory independently of mapping publication. A late duplicate holds both occurrences,
 * and a prefix layout still proves every used field before any cut. Only bounded raw chunks survive a read. */
async function comparePrefix(input: IntakeLargeInput, attempt: UspJobAttempt) {
  const closureKey = (state: State) => fingerprint({ reader: state.store.reader, profile: state.store.profile,
    recipe: state.store.recipe, mappingJobId: state.store.mapping?.job_id });
  const prepared = await pinned(input, attempt, async (client, state) => {
    const receipt = StreamedMappingReceiptSchema.parse((await client.query(
      'SELECT body FROM usp_mapping_recipes WHERE id=$1', [state.store.recipe!.id])).rows[0].body);
    const plan = receipt.plan;
    const prefix = plan.version === 'streamed-prefix-mapping/1';
    const { profile } = await (prefix ? loadProvisionalStreamedProfileTx : loadSealedStreamedProfileTx)(
      client, plan.profileJobId, plan.profileGeneration, plan.profileHash, plan.rawJobId, input.caseId, input.sourceId);
    const sealed = await loadPrefixSealTx(client, plan);
    return { cutKey: closureKey(state), plan, profile, chunks: state.store.reader!.sealed_chunks!,
      readerJobId: state.store.reader!.job_id, mappingJobId: state.store.mapping!.job_id,
      checkKey: prefixSealCheckKey(receipt.planHash, sealed.generationHash, state.store.mapping!.job_id),
      changed: prefix && !prefixLayoutMatchesSealed(plan, profile, sealed),
      keys: new Map<string, KeyRow>(), conflicts: new Set<number>(),
      failure: undefined as PrefixLayoutFailure | undefined };
  }, 'share');
  const readSlotsTx = async (client: PoolClient, first: number, end: number) => {
    const slots = (await client.query<RawCheckSlot>(`SELECT * FROM usp_streaming_vector_slots WHERE job_id=$1
      AND source_revision=$2 AND chunk_index>=$3 AND chunk_index<$4 AND published=true
      ORDER BY chunk_index FOR SHARE`, [prepared.readerJobId, input.sourceRevision, first, end])).rows;
    if (slots.length !== end - first || slots.some((slot, offset) => slot.chunk_index !== first + offset))
      conflict('The sealed raw part changed.');
    return slots;
  };
  const slotKey = (slot: RawCheckSlot) => fingerprint({ index: slot.chunk_index,
    result: slot.result_sha256, key: slot.object_key, sha256: slot.object_sha256, bytes: Number(slot.bytes) });
  const checkedSlots: string[] = [], beat = heartbeat(input, attempt);
  for (let first = 0; first < prepared.chunks; first += 8) {
    const slots = await pinned(input, attempt, async (client, state) => {
      if (closureKey(state) !== prepared.cutKey) conflict('The prefix closure context changed.');
      return readSlotsTx(client, first, Math.min(first + 8, prepared.chunks));
    }, false);
    // Drain every in-flight read before propagating a failure; normalize in source order, not GET completion order.
    const reads = await Promise.allSettled(slots.map(async slot => {
      try {
        return await readPinnedRawChunk({ rawJobId: prepared.readerJobId, caseId: input.caseId,
          sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
          subject: input.subject, accessBinding: input.accessSha256 }, slot);
      } finally { await beat(); }
    }));
    for (const [offset, read] of reads.entries()) {
      if (read.status === 'rejected') throw read.reason;
      if (!read.value.payload) conflict('The sealed raw payload is unavailable.');
      checkIntakeLargeChunk(prepared, read.value.payload.records, slots[offset].chunk_index);
    }
    await pinned(input, attempt, async (client, state) => {
      if (closureKey(state) !== prepared.cutKey) conflict('The prefix closure context changed.');
      const current = await readSlotsTx(client, first, first + slots.length);
      if (current.some((slot, offset) => slotKey(slot) !== slotKey(slots[offset])))
        conflict('The sealed raw part changed.');
      // No check result is published until this whole bounded read has passed its post-read lease fence.
      await assertUspJobAttemptTx(client, attempt);
    }, false);
    checkedSlots.push(...slots.map(slotKey));
    await beat();
  }
  // Complete-file layouts already validate their fields at admission; only prefix drift asks again.
  prepared.changed ||= prepared.plan.version === 'streamed-prefix-mapping/1' && prepared.failure !== undefined;
  await pinned(input, attempt, async (client, state) => {
    if (closureKey(state) !== prepared.cutKey) conflict('The prefix closure context changed.');
    const slots = await readSlotsTx(client, 0, prepared.chunks);
    if (slots.some((slot, index) => slotKey(slot) !== checkedSlots[index]))
      conflict('The sealed raw part changed.');
    await client.query(`UPDATE sources SET inspection=inspection||jsonb_build_object('intakePrefixSealCheck',$2::jsonb)
      WHERE id=$1`, [input.sourceId, JSON.stringify({ key: prepared.checkKey, mappingJobId: prepared.mappingJobId,
      changed: prepared.changed, conflicts: [...prepared.conflicts],
      ...(prepared.changed && prepared.failure ? { failure: prepared.failure } : {}) })]);
  });
}

async function step(input: IntakeLargeInput, attempt: UspJobAttempt) {
  const state = await pinned(input, attempt, async (client, current) => {
    await client.query(`UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),
      next_attempt_at=now()+interval '180 seconds' WHERE id=$1`, [input.jobId]);
    return current;
  });
  if (!intakeLargeStepCurrent(state, input) || intakeLargeAtRest(state.item)) return complete(input, attempt, false);
  // G20B: this file's area in this batch is retired, so the row rests in words and nothing more is prepared.
  const retired = await retiredFileAreaWords(input.caseId, input.sourceSha256);
  if (retired) {
    await pinned(input, attempt, client => stopItemTx(client, input, retired));
    return complete(input, attempt, false);
  }
  const phase = intakeLargePhase(intakeLargeRows(state.store, state.source));
  if (phase === 'question') await pinned(input, attempt, (client, current) =>
    prepareCellLayoutTx(client, input, current));
  if (phase === 'compare') await comparePrefix(input, attempt);
  if (phase === 'draft' && state.store.unreviewed < INTAKE_UNFINISHED_PACKAGE_LIMIT) {
    try {
      const retryAt = await draft(input, attempt);
      if (retryAt) return complete(input, attempt, false, retryAt);
    } catch (error) {
      // Only a publication watermark wait completes successfully; all other stale pins still fail normally.
      if (!(error instanceof IntakeMappingCutPending)) throw error;
      return complete(input, attempt, false);
    }
  }
  await complete(input, attempt, true);
}

/** Steps already done stay; the row says why nothing more is prepared. */
async function stopItemTx(client: PoolClient, input: IntakeLargeInput, reason = INTAKE_LARGE_STOPPED) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  if (intakeLargeAtRest(current)) return;
  const counters = (await client.query('SELECT parts_planned,parts_done FROM usp_intake_items WHERE item_id=$1',
    [input.itemId])).rows[0];
  await writeIntakeLargeTx(client, input.caseId, input.itemId, { ...current, state: 'failed_part',
    placement: 'not_understood', limitReason: reason, partsPlanned: counters.parts_planned,
    partsDone: counters.parts_done });
}

/** Below the attempt limit the authority retries after 2 seconds. Changed code pins stop for explicit retry;
 * the last attempt, or a part the file itself refuses, also rests the row. */
async function fail(input: IntakeLargeInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'INTAKE_LARGE_STEP_FAILED';
  const refusal = intakeLargePartRefusal(error);
  await transaction(async client => {
    // A changed source must not block the terminal marker, so the source pins are not asserted here.
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    // Processor detail can quote source values; only the application's own words are diagnostic text.
    const message = error instanceof AppError && code !== 'AREA_PROCESSING' ? error.message : 'Error detail withheld.';
    const cause = { errorCode: code, message };
    await client.query(`UPDATE usp_job_attempts SET state='fenced',failure_cause=COALESCE(failure_cause,$3)
      WHERE job_id=$1 AND number=$2`, [input.jobId, attempt.number, cause]);
    if (attempt.number < USP_JOB_LIMITS.maxAttempts && !refusal && !(error instanceof SealedChunkCodeChanged)) {
      await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",
        [input.jobId]);
      await client.query(`UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds',error=$2
        WHERE id=$1`, [input.jobId, code]);
      return;
    }
    await stopItemTx(client, input, refusal ?? INTAKE_LARGE_STOPPED);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query("UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1", [input.jobId, code]);
  });
}

/** A claim that cannot start: an exhausted job rests the row; a changed source ends the job and leaves the row. */
async function unclaimedFailure(input: IntakeLargeInput, error: unknown) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    if (error.code === 'USP_JOB_ATTEMPTS') await stopItemTx(client, input);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, error.code === 'USP_JOB_ATTEMPTS' ? 'failed' : 'stale', error.code]);
  });
}

/** Admission waits precede the attempt authority, so occupied lanes spend no attempt or live lease. */
async function prepareReaders(input: IntakeLargeInput): Promise<boolean> {
  const state = await pinned(input, undefined, async (client, current) => {
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    return !active && ['queued', 'running'].includes(job?.status) ? current : null;
  });
  if (!state) return false;
  if (intakeLargeAtRest(state.item) || await retiredFileAreaWords(input.caseId, input.sourceSha256)) return true;
  try {
    const phase = intakeLargePhase(intakeLargeRows(state.store, state.source));
    if (phase === 'start' || phase === 'read' && !state.store.profile) await startReaders(input, undefined, state);
    // Admission uses current stored authority even for an obsolete wake key; later handoffs cannot delay it.
    if (!state.store.mapping && state.store.recipe?.state === 'approved'
      && ['map', 'compare', 'draft'].includes(phase)) await startMapping(input, undefined, state);
    return true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const occupied = error.status === 429
      && ['STREAMING_CAPACITY', 'STREAMED_PROFILE_CAPACITY', 'MAPPING_CAPACITY'].includes(error.code);
    // A sibling arrival may win admission's revision race; waiting reasserts the source and access pins.
    if (error.code !== 'STALE_REVISION' && !occupied) throw error;
    return waitForReader(input, error.code);
  }
}

/** The first dispatch starts the durable 30 minute bound; retries never extend it. */
async function waitForReader(input: IntakeLargeInput, code: string): Promise<false> {
  await pinned(input, undefined, async (client, state) => {
    const job = (await client.query(`SELECT status,
      dispatched_at <= now()-interval '30 minutes' expired FROM jobs WHERE id=$1 FOR UPDATE`,
    [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !['queued', 'running'].includes(job?.status)) return;
    if (job.expired) {
      await stopItemTx(client, input, 'No reader became free within 30 minutes; '
        + 'the original and the steps already done are kept. Nothing more was prepared from it.');
      await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
        [input.jobId]);
      await client.query("UPDATE jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1",
        [input.jobId, code]);
      return;
    }
    if (!intakeLargeAtRest(state.item)) {
      const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
      await writeIntakeDraftTx(client, input.caseId, input.itemId,
        { ...current, limitReason: 'Waiting for a free reader; the original and the steps already done are kept.' });
    }
    await client.query(`UPDATE jobs SET status='queued',dispatched_at=COALESCE(dispatched_at,now()),
      next_attempt_at=now()+interval '2 seconds',error=$2 WHERE id=$1`, [input.jobId, code]);
  });
  return false;
}

/** The existing dispatcher and fenced authority own scheduling; each job is one step of one large file. */
export async function runIntakeLargeJob(jobId: string) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-large'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeLargeInputSchema.parse(job.payload);
  let admissionError: unknown;
  try {
    if (!await prepareReaders(input)) return;
  } catch (error) {
    admissionError = error;
  }
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-large:${randomUUID()}`,
      async client => {
        await assertIntakeDraftTx(client, input);
        // The existing case gate serializes claims; live attempts, not wake keys, own this item's fold.
        const busy = (await client.query(`SELECT 1 FROM usp_job_attempts a JOIN jobs j ON j.id=a.job_id
          WHERE j.source_id=$1 AND j.operation='intake-large' AND j.id<>$2
            AND a.state='active' AND a.lease_until>now() LIMIT 1`, [input.sourceId, jobId])).rowCount;
        if (busy) throw new AppError(429, 'INTAKE_LARGE_BUSY', 'Another step is preparing this file.');
      });
  } catch (error) {
    if (error instanceof AppError && error.code === 'INTAKE_LARGE_BUSY') {
      await pinned(input, undefined, async client => {
        await client.query(`UPDATE jobs SET status='queued',next_attempt_at=now()+interval '2 seconds'
          WHERE id=$1 AND status IN ('queued','running') AND NOT EXISTS
          (SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now())`, [jobId]);
      });
      return;
    }
    await unclaimedFailure(input, error);
    return;
  }
  try {
    if (admissionError) throw admissionError;
    await step(input, attempt);
  } catch (error) {
    await recordUspJobFailure(attempt, 'INTAKE_LARGE_STEP_FAILED', error);
    await fail(input, attempt, error).catch(() => {/* A newer fence owns the job's durable state. */});
    throw error;
  }
}
