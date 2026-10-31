import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MappingPlanSchema, SourceProfileSchema, MappingReceiptSchema, type MappingPlan, type MappingReceipt,
  type SourceProfile } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { openObjectStream, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject, localRequestContext } from '../principal';
import { claimUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt, heartbeatUspJobAttempt,
  type UspJobAttempt } from '../jobs';
import { getPackage } from '../../areas/areas';
import { intakeDestination, intakeCaseArea } from './intake-destination';
export { intakeDestination } from './intake-destination';
import { ManualIngestionService, cellParentLayoutTx } from './service';
import { cellLayout } from './intake-cell-files';
import { AdaptiveMappingService, caseOriginalTeacherGate } from './adaptive-mapping-service';
import { compileMapping, GEOJSON_FEATURE_LIMIT, geojsonInventory, setAsideWords } from './registry';
import { profileGisAttributes } from './column-profile';
import { proposeMapping } from './mapping-teacher';
import type { LayerMeanings } from './intake-reading';
import type { IntakeSourceRow } from './intake-context';
import { IntakeDraftInputSchema, assertIntakeDraftTx, intakeDraftKey, queueIntakeDraftTx, requeueStaleDraftTx,
  type IntakeDraftInput } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx, type IntakeDraftState } from './intake-ledger';
import { createIntakeTargetsTx } from './intake-targets';
import { prepareIntakeTable } from './intake-table-auto';
import { nativeConverterLayout, nativeConverterPin, nativeConverterOperations } from './intake-native-derivative';
import { publishWorkbookTablesTx } from './intake-workbook-table';
import { deriveWorkbookSheets } from './intake-workbook-derivative';
import { derivativeKeeping } from './intake-native-derivative-worker';

const manual = new ManualIngestionService();
const adaptive = new AdaptiveMappingService();
type Origin = 'memory' | 'teacher' | 'officer' | 'parent_file' | 'converter';
type Proposal = { plan: MappingPlan; origin: Origin; parentSourceId?: string; method?: string };
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

type MemoryRow = { body: unknown; manual_profile?: unknown };
type MemoryLookup = (sql: string, values: string[]) => Promise<MemoryRow[]>;

function profileContained(profile: SourceProfile, stored: unknown): boolean {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
  const { schemaFingerprint: _hash, ...fields } = stored as Record<string, unknown>;
  const parsed = SourceProfileSchema.omit({ source: true, caseId: true,
    workspaceRevision: true, workspaceFingerprint: true }).safeParse(fields);
  if (!parsed.success) return false;
  const old = parsed.data;
  if (old.version !== profile.version || fingerprint(old.crs) !== fingerprint(profile.crs)
    || fingerprint([...old.geometryTypes].sort()) !== fingerprint([...profile.geometryTypes].sort())) return false;
  return old.paths.every(path => profile.paths.some(current => current.path === path.path
    && fingerprint([...current.types].sort()) === fingerprint([...path.types].sort())));
}

/** Exact memory wins. A contained stored source permits repinning operations, never its approval. */
export async function lookupIntakeMemory(profile: SourceProfile, subject: string,
  lookup: MemoryLookup): Promise<MappingReceipt | null> {
  const exact = (await lookup(`SELECT body FROM usp_mapping_recipes
    WHERE state IN ('approved','executed') AND body->'approval'->>'subject'=$1
    AND body->'plan'->'source'->>'schemaFingerprint'=$2 ORDER BY body->'approval'->>'at' DESC,id DESC LIMIT 1`,
  [subject, profile.source.schemaFingerprint]))[0];
  const parsedExact = MappingReceiptSchema.safeParse(exact?.body);
  if (parsedExact.success && memoryPlan(profile, parsedExact.data)) return parsedExact.data;
  const recent = await lookup(`SELECT r.body,s.inspection->'manualProfile' AS manual_profile
    FROM usp_mapping_recipes r LEFT JOIN sources s ON s.id=r.source_id
    AND s.profile IN ('geojson-manual-v1','large-original-v1')
    AND s.inspection->'manualProfile'->>'version'='manual-geojson/1'
    WHERE r.state IN ('approved','executed') AND r.body->'approval'->>'subject'=$1
    AND r.body->'plan'->>'version'='manual-geojson/1'
    ORDER BY r.body->'approval'->>'at' DESC,r.id DESC LIMIT 50`, [subject]);
  for (const candidate of recent.slice(0, 50)) {
    const parsed = MappingReceiptSchema.safeParse(candidate.body);
    if (!parsed.success || !profileContained(profile, candidate.manual_profile)) continue;
    const stored = candidate.manual_profile as { schemaFingerprint?: unknown };
    if (stored.schemaFingerprint !== parsed.data.plan.source.schemaFingerprint) continue;
    const remembered = { ...parsed.data, plan: { ...parsed.data.plan,
      source: { ...parsed.data.plan.source, schemaFingerprint: profile.source.schemaFingerprint } } };
    if (memoryPlan(profile, remembered)) return remembered;
  }
  return null;
}

/** Reuse operations, never approval. Every batch GeoJSON without memory is a gated case original. */
export async function proposeIntakeLayout(profile: SourceProfile, remembered: MappingReceipt | null,
  requestKey: string, teacher = () => adaptive.propose(profile.caseId, profile.source.sourceId, {
    requestKey, source: profile.source, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint,
  })): Promise<Proposal | null> {
  const plan = memoryPlan(profile, remembered);
  if (plan) return { plan, origin: 'memory' };
  const gate = caseOriginalTeacherGate();
  if (!gate.allowed) return null;
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

const layerMeaningsKey = (input: IntakeDraftInput) =>
  `intake-layer-meanings:${input.itemId}:${input.sourceId}:${input.sourceRevision}:${input.sourceSha256}`;

async function layerProfile(source: IntakeSourceRow) {
  const size = Number(source.bytes);
  if (size > 16 * 1024 * 1024) throw new AppError(413, 'RECORD_LIMIT', 'Use the streaming layer reader.');
  const object = await openObjectStream(source.object_key, size, 30000,
    source.inspection?.largeOriginal?.objectEtag);
  const chunks: Buffer[] = [];
  let count = 0;
  try {
    for await (const chunk of object.body) {
      count += chunk.length;
      if (count > size) throw new AppError(422, 'SOURCE_INTEGRITY', 'The original exceeds its receipt.');
      chunks.push(Buffer.from(chunk));
    }
  } finally { object.body.destroy(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== size || sha256(bytes) !== source.sha256)
    throw new AppError(422, 'SOURCE_INTEGRITY', 'The original differs from its byte/hash receipt.');
  const rows = geojsonInventory(bytes).slice(0, 100).map(feature => feature.properties ?? {});
  if (!rows.some(row => Object.keys(row).length)) return null;
  const profile = profileGisAttributes(rows).profile;
  return { ...profile, columns: profile.columns.map(column => {
    const contact = /address|contact|phone|mobile|e[-_ ]?mail/i.test(column.name)
      || rows.some(row => typeof row[column.name] === 'string'
        && /@|(?:\+?\d[ ()-]*){10,}/u.test(row[column.name] as string));
    return { ...column, maskedSamples: contact ? [] : column.maskedSamples.slice(0, 5) };
  }) };
}

/** Durable meanings only: even a complete answer cannot author a feature layout or approve a record. */
async function preparedLayerMeanings(input: IntakeDraftInput, attempt: UspJobAttempt): Promise<LayerMeanings | null> {
  try {
    return await layerMeanings(input, attempt);
  } catch {
    // Optional field interpretation cannot change the existing layout job's outcome.
    return null;
  }
}

async function layerMeanings(input: IntakeDraftInput, attempt: UspJobAttempt): Promise<LayerMeanings | null> {
  const { item, source } = await pinned(input, attempt, client => assertIntakeDraftTx(client, input));
  const count = source.inspection?.manualProfile?.featureCount ?? item.card?.counts?.features;
  if (item.card?.format !== 'geojson' || Number(source.bytes) > 16 * 1024 * 1024
    || typeof count !== 'number' || count > GEOJSON_FEATURE_LIMIT) return null;
  const key = layerMeaningsKey(input);
  const previous = await pinned(input, attempt, async client => (await client.query(
    "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='intake-draft'",
    [input.caseId, key])).rows[0]?.result as LayerMeanings | undefined);
  if (previous) return previous;
  const provenance = source.inspection?.largeOriginal?.provenance ?? {};
  if (!caseOriginalTeacherGate(provenance).allowed) return null;
  const profile = await layerProfile(source);
  if (!profile) return null;
  const result = await proposeMapping(profile, { context: localRequestContext(input.jobId),
    dataPolicy: { dataClass: 'public', split: 'unlabelled' }, invocationKey: intakeDraftKey(input.itemId,
      input.sourceRevision, 'field-meanings'), maxAttempts: 1,
    authorize: async () => {
      const { source: current } = await pinned(input, attempt, client => assertIntakeDraftTx(client, input));
      if (!caseOriginalTeacherGate(current.inspection?.largeOriginal?.provenance ?? {}).allowed)
        throw new AppError(403, 'CASE_ORIGINAL_TEACHER_REFUSED', caseOriginalTeacherGate().words);
    },
  });
  if (!result.fieldSources.length || result.fieldSources.some(field => field.source === 'unanswered')) return null;
  const meanings = { ...result, sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, labelKind: 'pseudo_label' as const };
  await pinned(input, attempt, async client => {
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'intake-draft',$3,$4) ON CONFLICT DO NOTHING`,
    [input.caseId, key, fingerprint({ source: profile.layoutFingerprint, hash: input.sourceSha256 }), meanings]);
  });
  return meanings;
}

/** A converter supplies semantics only for its pinned derivative, never for matching uploaded fields. */
export function converterIntakeProposal(source: IntakeSourceRow, profile: SourceProfile): Proposal | null {
  const layout = nativeConverterLayout(source);
  if (!layout || profile.source.sourceId !== source.id || profile.source.sourceRevision !== source.revision
    || profile.source.sourceSha256 !== source.sha256) return null;
  const operations = nativeConverterOperations(source)!;
  const plan = MappingPlanSchema.parse({ version: profile.version, mode: 'manual_mapping', source: profile.source,
    caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint, kind: layout.kind, operations,
    basis: 'converter_recorded', converterPin: nativeConverterPin(source) });
  try { compileMapping(plan, profile); }
  catch (error) {
    if (error instanceof AppError && error.status === 422) return null;
    throw error;
  }
  return { plan, origin: 'converter', method: layout.method };
}

async function preparedProposal(input: IntakeDraftInput, attempt: UspJobAttempt, profile: SourceProfile) {
  const key = `intake-draft-plan:${input.jobId}`;
  const previous = await pinned(input, attempt, async client => (await client.query(
    "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='intake-draft'",
    [input.caseId, key])).rows[0]?.result as Proposal | undefined);
  if (previous) return previous;
  const parent = await pinned(input, attempt, async client => {
    const { source } = await assertIntakeDraftTx(client, input);
    return cellParentLayoutTx(client, source, input.subject, profile);
  });
  const inherited = parent ? MappingPlanSchema.safeParse({ ...cellLayout(parent.receipt.plan),
    version: profile.version, mode: 'manual_mapping', source: profile.source, caseId: profile.caseId,
    workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint }) : null;
  let proposal = await pinned(input, attempt, async client => {
    const { source } = await assertIntakeDraftTx(client, input);
    return converterIntakeProposal(source, profile);
  });
  if (!proposal && inherited?.success) {
    try {
      compileMapping(inherited.data, profile);
      proposal = { plan: inherited.data, origin: 'parent_file', parentSourceId: parent!.press.sourceId };
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 422) throw error;
    }
  }
  if (!proposal) {
    const remembered = await lookupIntakeMemory(profile, input.subject, (sql, values) =>
      pinned(input, attempt, async client => (await client.query(sql, values)).rows));
    proposal = await proposeIntakeLayout(profile, remembered, intakeDraftKey(input.itemId, 0, 'propose'));
  }
  if (!proposal) return null;
  await pinned(input, attempt, async client => {
    await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
      VALUES($1,$2,'intake-draft',$3,$4) ON CONFLICT DO NOTHING`,
    [input.caseId, key, fingerprint(input), proposal]);
  });
  return proposal;
}

/** The refusals an officer answers: teacher permission, a different site, or an area that cannot hold the file. */
export function officerQuestion(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  const gate = caseOriginalTeacherGate();
  if (error.code === gate.code) return gate.words;
  if (error.code === 'CONVERTER_LAYOUT') return noLayout;
  if (error.code === 'AREA_SOURCE_DENIED') return otherSite;
  if (error.code === 'AREA_PROCESSING' && error.status === 422) return error.message.slice(0, 2000);
  return null;
}

/** No answer changes a file's bytes: an item whose bytes already made an area rests read, with that sentence. */
export function alreadyInArea(error: unknown): Omit<IntakeDraftState, 'recordsSeen'> | null {
  if (!(error instanceof AppError) || error.code !== 'SOURCE_ALREADY_IN_AREA' || error.status !== 409) return null;
  const areaId = (error.details as { areaId?: unknown } | undefined)?.areaId;
  const planRef = typeof areaId === 'string' ? { existingAreaId: areaId } : null;
  return { state: 'read', placement: 'undecided', planRef, limitReason: error.message.slice(0, 2000) };
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
    if (state.planRef?.origin === 'memory' || state.planRef?.origin === 'teacher'
      || state.planRef?.origin === 'parent_file' || state.planRef?.origin === 'converter') return state.planRef.origin;
    const row = (await client.query(
      "SELECT result FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='intake-draft'",
      [input.caseId, `intake-draft-plan:${input.jobId}`])).rows[0];
    return row?.result?.origin ?? 'officer';
  });
}

async function transition(input: IntakeDraftInput, attempt: UspJobAttempt, receipt: MappingReceipt | null,
  state: IntakeDraftState['state'], meanings: LayerMeanings | null, packageId?: string) {
  const from = receipt ? await origin(input, attempt, receipt) : null;
  const pkg = packageId ? await getPackage(packageId) : null;
  if (pkg && !pkg.sourceRevisionIds.includes(input.sourceId)) conflict('The draft package cites a different source.');
  await pinned(input, attempt, async client => {
    const { source } = await assertIntakeDraftTx(client, input);
    await writeIntakeDraftTx(client, input.caseId, input.itemId, {
      state, placement: pkg ? 'on_map' : receipt ? 'undecided' : 'needs_answer',
      planRef: receipt ? { recipeId: receipt.id, recipeRevision: receipt.revision, recipeState: receipt.state,
        // The item contract has no converter origin; the receipt carries its explicit converter semantics.
        origin: from === 'converter' ? null : from,
        ...(from === 'parent_file'
          ? { parentSourceId: source.inspection?.cellDerivative?.parentSourceId } : {}),
        ...(pkg ? { packageId: pkg.id } : {}), ...(meanings ? { layerMeanings: meanings } : {}) }
        : { layoutQuestion: true, ...(meanings ? { layerMeanings: meanings } : {}) },
      recordsSeen: pkg?.features.length ?? 0,
      limitReason: receipt ? setAsideWords(pkg?.quarantine?.setAside) : noLayout,
    });
    if (state === 'read' && pkg) await createIntakeTargetsTx(client, input.caseId, input.itemId, pkg, input.sourceId);
  });
}

async function settleTable(input: IntakeDraftInput, attempt: UspJobAttempt) {
  await pinned(input, attempt, async client => {
    const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
    if (current.state !== 'reading' || current.placement !== 'undecided' || current.planRef) return;
    await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'read',
      limitReason: 'The table is read. Its field meanings are being proposed for your review; '
        + 'nothing is recorded until you confirm it.',
    });
  });
}

async function advance(input: IntakeDraftInput, attempt: UspJobAttempt) {
  if (input.workbook) {
    const { source, item } = await pinned(input, attempt, client => assertIntakeDraftTx(client, input));
    if (item.state !== 'reading' || item.plan_ref) return;
    const sheets = await deriveWorkbookSheets(input, source, { ...derivativeKeeping, open: openObjectStream },
      () => pinned(input, attempt, async client => {
        const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
        await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current,
          limitReason: 'The worksheet CSV tables are waiting for a free upload slot; this continues by itself.' });
      }));
    return pinned(input, attempt, async client => {
      const current = await assertIntakeDraftTx(client, input);
      if (current.item.state !== 'reading' || current.item.plan_ref) return;
      await publishWorkbookTablesTx(client, input, current.source, current.item.card!, sheets);
    });
  }
  if (input.tableSelection) return settleTable(input, attempt);
  let current = await recipe(input, attempt);
  if (!current) current = await proposeRecipe(input, attempt);
  const from = current ? await origin(input, attempt, current) : null;
  const meanings = from === 'parent_file' ? null : await preparedLayerMeanings(input, attempt);
  if (!current) {
    await transition(input, attempt, null, 'probed', meanings);
    return;
  }
  // A remembered layout the officer already approved for a file of this case is drafted with that approval.
  if (current.state === 'proposed' && (from === 'memory' || from === 'parent_file'))
    current = await manual.carry(input.caseId, current.id);
  if (current.state === 'executed') {
    await transition(input, attempt, current, 'read', meanings, current.execution!.packageId);
    return;
  }
  await transition(input, attempt, current, 'planned', meanings);
  if (current.state === 'proposed') return;
  const converter = current.plan.basis === 'converter_recorded'
    && current.approval?.provenance === 'converter_recorded' && current.approval.subject === null
    && current.authoredBy === input.subject;
  if ((!converter && current.approval?.subject !== input.subject) || localOperatorSubject() !== input.subject)
    throw new AppError(403, 'SOURCE_OPERATOR', 'Execution requires the approving local operator.');
  await transition(input, attempt, current, 'reading', meanings);
  current = await manual.decide(input.caseId, current.id, {
    requestKey: intakeDraftKey(input.itemId, current.revision, 'execute'), expectedRecipeRevision: current.revision,
  }, 'execute') as MappingReceipt;
  await transition(input, attempt, current, 'read', meanings, current.execution!.packageId);
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
  const resting = alreadyInArea(error);
  await transaction(async client => {
    // Source changes must terminate the job without rewriting the item or any recipe.
    const { lockSourceCaseDestinationTx } = await import('../../cases/source-case-lock');
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    await assertUspJobAttemptTx(client, attempt);
    if (input.workbook) await stopTableTx(client, input);
    if (question || resting) {
      const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
      const layout = code === 'CONVERTER_LAYOUT'
        ? { state: 'probed' as const, planRef: { layoutQuestion: true } } : {};
      await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, ...resting ?? { state: 'planned',
        placement: 'needs_answer', limitReason: question, ...layout } });
    }
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
      [input.jobId, attempt.number]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
    if (code === 'STALE_REVISION') await requeueStaleDraftTx(client, input);
  });
}

async function stopTableTx(client: PoolClient, input: IntakeDraftInput) {
  try {
    await assertIntakeDraftTx(client, input);
  } catch (error) {
    if (error instanceof AppError) return;
    throw error;
  }
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  if (current.state === 'reading' && current.placement === 'undecided' && !current.planRef)
    await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'failed_part',
      placement: 'not_understood', limitReason: 'Reading this table stopped. The original is kept unchanged; '
        + 'use "Read as a table" to retry.',
    });
}

async function unclaimedFailure(input: IntakeDraftInput, error: unknown) {
  if (!(error instanceof AppError)) throw error;
  await transaction(async client => {
    const { lockSourceCaseDestinationTx } = await import('../../cases/source-case-lock');
    await lockSourceCaseDestinationTx(client, input.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    await client.query('SELECT job_id FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE', [input.jobId]);
    const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1
      AND state='active' AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
    if (active || !job || !['queued', 'running'].includes(job.status)) return;
    if (input.tableSelection) await stopTableTx(client, input);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, error.code === 'STALE_REVISION' ? 'stale' : 'failed', error.code]);
    if (error.code === 'STALE_REVISION') await requeueStaleDraftTx(client, input);
  });
}

/** Existing dispatcher and fenced authority own scheduling and durable recovery. */
export async function runIntakeDraftJob(jobId: string) {
  const job = (await query("SELECT * FROM jobs WHERE id=$1 AND operation='intake-draft'", [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeDraftInputSchema.parse(job.payload);
  let attempt: UspJobAttempt;
  try {
    if (input.tableSelection && !await prepareIntakeTable(input)) return;
    attempt = await claimUspJobAttempt(jobId, `intake-draft:${randomUUID()}`,
      client => assertIntakeDraftTx(client, input).then(() => {}));
  } catch (error) {
    await unclaimedFailure(input, error);
    return;
  }
  const renewal = input.workbook ? setInterval(() => {
    heartbeatUspJobAttempt(attempt).catch(() => {});
  }, 60000) : null;
  try {
    await advance(input, attempt);
    await complete(input, attempt);
  } catch (error) {
    await fail(input, attempt, error);
    throw error;
  } finally {
    if (renewal) clearInterval(renewal);
  }
}
