import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { MapArea } from '@ulpin/contracts';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { acceptUspJobAttempt, assertUspJobAttemptTx, claimUspJobAttempt, heartbeatUspJobAttempt,
  USP_JOB_LIMITS, type UspJobAttempt } from '../jobs';
import { ChunkMappingService } from './chunk-mapping';
import { intakeCaseArea, intakeDestination } from './intake-destination';
import { assertIntakeDraftTx } from './intake-draft';
import { INTAKE_LARGE_STOPPED, IntakeLargeInputSchema, intakeLargeAtRest, intakeLargeCutKey, intakeLargeEnd,
  intakeLargeFailureContext, intakeLargePartRefusal, intakeLargePhase, intakeLargePlan, intakeLargeProjection,
  intakeLargeRequestKey, intakeLargeRows, largeStateKey, queueIntakeLargeTx, type IntakeLargeInput
} from './intake-large';
import { readIntakeDraftTx, writeIntakeLargeTx } from './intake-ledger';
import { IntakePackageCutter, type IntakePackageCut, type MappedPartFeature } from './intake-package-cuts';
import { draftIntakePartTx, INTAKE_UNFINISHED_PACKAGE_LIMIT } from './intake-part-draft';
import type { ProvedAreaPartInput } from './proved-area-part';
import { StreamedProfileService } from './streamed-profile';
import { StreamingVectorService } from './streaming-vector';

const reader = new StreamingVectorService();
const profiler = new StreamedProfileService();
const mapper = new ChunkMappingService();
const DRAFT_STEP_MS = 60000, RANGE_BYTES = 1024 * 1024, RANGE_MS = 30000;
type State = NonNullable<Awaited<ReturnType<typeof largeStateKey>>>;
type Outcome = 'more' | 'pressure' | 'stale' | 'end';
type Fold = {
  readerJobId: string; mappingJobId: string; chunks: number; firstChunk: number; after: number; parts: number;
  cutKey: string; held: number; pending: number[]; conflicts: Set<number>; metadata: Record<string, unknown>;
  part: Omit<ProvedAreaPartInput, 'cutIndex' | 'features'>; objectKey: string; sourceBytes: number;
  recordsRead: number; readerRejected: number; started: number;
};

/** The bounded draft job's case and source lock, the attempt fence, then the stored rows. A cut's transaction
 * leaves the case row unlocked: its readers share-lock it from their own transactions. */
async function pinned<T>(input: IntakeLargeInput, attempt: UspJobAttempt,
  work: (client: PoolClient, state: State) => Promise<T>, lockCase = true): Promise<T> {
  return transaction(async client => {
    await assertIntakeDraftTx(client, input, lockCase);
    await assertUspJobAttemptTx(client, attempt);
    const state = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
    return work(client, state);
  });
}

async function publishTx(client: PoolClient, input: IntakeLargeInput, state: State) {
  if (intakeLargeAtRest(state.item)) return;
  const rows = intakeLargeRows(state.store, state.source), phase = intakeLargePhase(rows);
  await writeIntakeLargeTx(client, input.caseId, input.itemId,
    intakeLargeProjection(phase, rows, state.store, intakeLargeFailureContext(state.store, state.source)));
}

/** Every step ends here: the row shows its stored state and the transaction queues the next state's job. */
async function complete(input: IntakeLargeInput, attempt: UspJobAttempt, publish: boolean) {
  await acceptUspJobAttempt(attempt, { assetId: `intake-large:${input.itemId}`, version: 1, sha256: input.stateKey },
    async (_client, job) => {
      if (fingerprint(job.payload) !== fingerprint(input)) conflict('The large intake step changed.');
    }, client => assertIntakeDraftTx(client, input).then(() => {}), async client => {
      const state = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
      if (publish) await publishTx(client, input, state);
      await queueIntakeLargeTx(client, input.sourceId);
    });
}

/** The enqueue pins the case revision it saw; a replayed enqueue of an unchanged request sends the same pins. */
async function caseRevision(input: IntakeLargeInput, attempt: UspJobAttempt): Promise<number> {
  return pinned(input, attempt, async client => Number((await client.query('SELECT revision FROM cases WHERE id=$1',
    [input.caseId])).rows[0].revision));
}

/** The reader and the profile through their own admission, with the item's stable request keys. */
async function startReaders(input: IntakeLargeInput, attempt: UspJobAttempt, state: State) {
  const pins = { expectedCaseRevision: await caseRevision(input, attempt),
    expectedSourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256 };
  const rawJobId = state.store.reader?.job_id ?? (await reader.enqueue(input.caseId, input.sourceId, {
    requestKey: intakeLargeRequestKey(input.itemId, 'reader'), framing: 'feature-collection', ...pins })).jobId;
  if (!state.store.profile) await profiler.enqueue(input.caseId, input.sourceId,
    { requestKey: intakeLargeRequestKey(input.itemId, 'profile'), rawJobId, ...pins });
}

/** The approved layout's own pins admit the part mapping; the row says approved before it runs. */
async function startMapping(input: IntakeLargeInput, attempt: UspJobAttempt, state: State) {
  const recipe = state.store.recipe!;
  const plan = await pinned(input, attempt, async (client, current) => {
    await publishTx(client, input, current);
    return (await client.query('SELECT body FROM usp_mapping_recipes WHERE id=$1', [recipe.id])).rows[0].body.plan;
  });
  await mapper.enqueue(input.caseId, input.sourceId, {
    requestKey: intakeLargeRequestKey(input.itemId, 'mapping', recipe.revision), rawJobId: plan.rawJobId,
    expectedCaseRevision: await caseRevision(input, attempt), expectedSourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, profileJobId: plan.profileJobId, profileGeneration: plan.profileGeneration,
    profileHash: plan.profileHash });
}

/** The GIS suggestion's rule for a retained original that has none: its file name and its bytes' namespace. The
 * area's revision is left out so a replayed cut keeps its import signature while earlier cuts move the area. */
function largeDestination(name: string, sha256: string, area: MapArea | null): ProvedAreaPartInput['destination'] {
  const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150) || 'GIS source';
  const destination = intakeDestination({ suggestedTitle: title, suggestedNamespace: `file:${sha256}` }, area);
  return { namespace: destination.namespace, name: destination.name,
    ...(destination.kind === 'existing_area' ? { areaId: destination.areaId } : {}) };
}

/** Resume after the last stored cut: its end locator, the next index and the held count through its end. */
async function foldContext(input: IntakeLargeInput, attempt: UspJobAttempt): Promise<Fold> {
  const destination = largeDestination(await sourceName(input), input.sourceSha256, await intakeCaseArea(input.caseId));
  return pinned(input, attempt, async (client, state) => {
    const { reader: raw, mapping, recipe } = state.store;
    await publishTx(client, input, state);
    const last = (await client.query(`SELECT locator,counts FROM usp_intake_parts WHERE item_id=$1
      ORDER BY part_index DESC LIMIT 1`, [input.itemId])).rows[0];
    const after = last ? Number(last.locator.featureIndices.at(-1)) : -1;
    const first = (await client.query(`SELECT min(chunk_index)::int n FROM usp_streaming_vector_slots
      WHERE job_id=$1 AND published AND last_feature_index>$2`, [raw!.job_id, after])).rows[0].n;
    const conflicts = (await client.query(`SELECT first_feature_index,later_feature_index
      FROM usp_chunk_mapping_conflicts WHERE job_id=$1`, [mapping!.job_id])).rows
      .flatMap(row => [Number(row.first_feature_index), Number(row.later_feature_index)]);
    const layoutHash = (await client.query("SELECT body->>'planHash' hash FROM usp_mapping_recipes WHERE id=$1",
      [recipe!.id])).rows[0].hash;
    return { readerJobId: raw!.job_id, mappingJobId: mapping!.job_id, chunks: Number(raw!.sealed_chunks),
      firstChunk: first ?? Number(raw!.sealed_chunks), after, parts: state.store.parts,
      cutKey: intakeLargeCutKey(state.store), held: Number(last?.counts.held ?? 0), pending: [],
      conflicts: new Set(conflicts), metadata: state.source.inspection?.streamedMapReceipt.collectionMetadata,
      part: { sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
        readerVersion: 'geojson-stream/2', layoutHash, destination },
      objectKey: state.source.object_key, sourceBytes: Number(state.source.bytes), recordsRead: raw!.records,
      readerRejected: raw!.quarantined, started: Date.now() };
  });
}

async function sourceName(input: IntakeLargeInput): Promise<string> {
  return (await query('SELECT name FROM sources WHERE id=$1', [input.sourceId])).rows[0].name;
}

/** One sealed raw part and its mapped part, as the cutter takes them: accepted, observed, keyed, not duplicated. */
async function pairedChunk(input: IntakeLargeInput, fold: Fold, index: number): Promise<MappedPartFeature[]> {
  const raw = await reader.chunk(input.caseId, input.sourceId, fold.readerJobId, index);
  const mapped = await mapper.chunk(input.caseId, input.sourceId, fold.mappingJobId, index);
  if (!raw.current || !raw.sourceComplete || raw.unknownRemainder || !raw.payload || !mapped.current || !mapped.payload)
    conflict('A sealed part of this file is unavailable.');
  const observed = new Map(mapped.payload.records.map(record => [record.featureIndex, record]));
  return raw.payload.records.flatMap(record => {
    const match = observed.get(record.featureIndex);
    if (record.featureIndex <= fold.after || record.disposition !== 'accepted'
      || fold.conflicts.has(record.featureIndex) || match?.disposition !== 'observed'
      || match.sourceKey.state !== 'known' || !match.geometryRef) return [];
    return [{ raw: record, mapped: match, feature: record.feature as Record<string, unknown> }];
  });
}

/** The cut's original bytes in contiguous spans of at most 1 MiB; each feature is sliced from its span. */
async function rawFeatures(fold: Fold, cut: IntakePackageCut): Promise<ProvedAreaPartInput['features']> {
  const features: ProvedAreaPartInput['features'] = [];
  for (let first = 0; first < cut.features.length;) {
    const start = cut.features[first].raw.byteStart;
    let last = first;
    while (last + 1 < cut.features.length && cut.features[last + 1].raw.byteEnd - start <= RANGE_BYTES) last++;
    const bytes = await readObjectRange(fold.objectKey, start, cut.features[last].raw.byteEnd, fold.sourceBytes,
      Date.now() + RANGE_MS, AbortSignal.timeout(RANGE_MS));
    for (const item of cut.features.slice(first, last + 1)) features.push({
      rawChunkIndex: item.mapped.geometryRef!.chunkIndex, featureIndex: item.raw.featureIndex,
      rawBytes: bytes.subarray(item.raw.byteStart - start, item.raw.byteEnd - start) });
    first = last + 1;
  }
  return features;
}

/** Held features up to a cut's last feature count with that cut; later ones wait for the next cut or the end. */
function heldThrough(fold: Fold, cut: IntakePackageCut | undefined): number {
  const end = cut ? cut.features.at(-1)!.raw.featureIndex : Infinity;
  fold.held += fold.pending.filter(index => index < end).length;
  fold.pending = fold.pending.filter(index => index > end);
  return fold.held;
}

async function writeEndTx(client: PoolClient, input: IntakeLargeInput, fold: Fold, state: State) {
  const parts = (await client.query(`SELECT count(*)::int n,COALESCE(sum((counts->>'accepted')::int),0)::int accepted
    FROM usp_intake_parts WHERE item_id=$1`, [input.itemId])).rows[0];
  await writeIntakeLargeTx(client, input.caseId, input.itemId, intakeLargeEnd({ recordsRead: fold.recordsRead,
    accepted: parts.accepted, packages: parts.n, readerRejected: fold.readerRejected,
    duplicates: fold.conflicts.size, oversized: fold.held + fold.pending.length },
  intakeLargePlan(state.store.recipe)));
}

/** One cut, one transaction: it drafts only while the fold's stored context is unchanged, and queues what follows.
 * The last cut of the file also writes the end; `cut` is absent when the file ends after a stored cut. */
async function draftCut(input: IntakeLargeInput, attempt: UspJobAttempt, fold: Fold,
  cut: IntakePackageCut | undefined, end: boolean): Promise<Outcome> {
  const features = cut ? await rawFeatures(fold, cut) : [];
  const held = heldThrough(fold, cut);
  return pinned(input, attempt, async (client, state) => {
    if (intakeLargeCutKey(state.store) !== fold.cutKey) {
      await queueIntakeLargeTx(client, input.sourceId);
      return 'stale';
    }
    if (cut) await draftIntakePartTx(client, input.itemId, fold.mappingJobId,
      { ...fold.part, cutIndex: cut.index, features }, held);
    const after = await largeStateKey(client, input.sourceId) ?? conflict('The large intake item changed.');
    if (end) await writeEndTx(client, input, fold, after);
    fold.cutKey = intakeLargeCutKey(after.store);
    await queueIntakeLargeTx(client, input.sourceId);
    if (end) return 'end';
    return after.store.unreviewed >= INTAKE_UNFINISHED_PACKAGE_LIMIT ? 'pressure' : 'more';
  }, false);
}

function heartbeat(input: IntakeLargeInput, attempt: UspJobAttempt) {
  let last = Date.now();
  return async () => {
    if (Date.now() - last < USP_JOB_LIMITS.heartbeatSeconds * 1000) return;
    await heartbeatUspJobAttempt(attempt, client => assertIntakeDraftTx(client, input).then(() => {}));
    await query("UPDATE jobs SET next_attempt_at=now()+interval '180 seconds' WHERE id=$1 AND status='running'",
      [input.jobId]);
    last = Date.now();
  };
}

/** Fold the sealed parts in order from the last stored cut; stop at eight unreviewed, the end or 60 seconds. */
async function draft(input: IntakeLargeInput, attempt: UspJobAttempt) {
  const fold = await foldContext(input, attempt), beat = heartbeat(input, attempt);
  const cutter = new IntakePackageCutter(fold.metadata, { index: fold.parts, previous: fold.after });
  for (let index = fold.firstChunk; index < fold.chunks; index++) {
    for (const item of await pairedChunk(input, fold, index)) {
      const result = cutter.consume(item);
      if (result.held) fold.pending.push(result.held.featureIndex);
      if (!result.cut) continue;
      const outcome = await draftCut(input, attempt, fold, result.cut, false);
      if (outcome !== 'more' || Date.now() - fold.started >= DRAFT_STEP_MS) return;
      await beat();
    }
    await beat();
  }
  await draftCut(input, attempt, fold, cutter.close(), true);
}

async function step(input: IntakeLargeInput, attempt: UspJobAttempt) {
  const state = await pinned(input, attempt, async (client, current) => {
    await client.query(`UPDATE jobs SET dispatched_at=COALESCE(dispatched_at,now()),
      next_attempt_at=now()+interval '180 seconds' WHERE id=$1`, [input.jobId]);
    return current;
  });
  if (state.key !== input.stateKey || intakeLargeAtRest(state.item)) return complete(input, attempt, false);
  const phase = intakeLargePhase(intakeLargeRows(state.store, state.source));
  if (phase === 'start' || phase === 'read' && !state.store.profile) await startReaders(input, attempt, state);
  if (phase === 'map' && !state.store.mapping) await startMapping(input, attempt, state);
  if (phase === 'draft' && state.store.unreviewed < INTAKE_UNFINISHED_PACKAGE_LIMIT) await draft(input, attempt);
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

/** Below the attempt limit the authority retries after 2 seconds; the last attempt, or a part the file itself
 * refuses, rests the row. */
async function fail(input: IntakeLargeInput, attempt: UspJobAttempt, error: unknown) {
  const code = error instanceof AppError ? error.code : 'INTAKE_LARGE_STEP_FAILED';
  const refusal = intakeLargePartRefusal(error);
  await transaction(async client => {
    // A changed source must not block the terminal marker, so the source pins are not asserted here.
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    if (attempt.number < USP_JOB_LIMITS.maxAttempts && !refusal) {
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

/** The existing dispatcher and fenced authority own scheduling; each job is one step of one large file. */
export async function runIntakeLargeJob(jobId: string) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-large'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeLargeInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-large:${randomUUID()}`,
      client => assertIntakeDraftTx(client, input).then(() => {}));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  try {
    await step(input, attempt);
  } catch (error) {
    await fail(input, attempt, error).catch(() => {/* A newer fence owns the job's durable state. */});
    throw error;
  }
}
