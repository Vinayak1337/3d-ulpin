import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { INTAKE_PROBE_LIMITS, IntakeRegisterSchema, IntakePinSchema, IntakeManifestSchema, IntakeLayerCrsSchema,
  IntakePageImageAnswerSchema, IntakeSurfacePartsQuerySchema, IntakeTablePlacementSchema, IntakePlanRequestSchema,
  AnyMappingReceiptSchema, MappingPlanSchema, SourceProfileSchema, ChunkMappingPayloadSchema, CHUNK_MAPPING_LIMITS,
  CITYGML_LIMITS, CITYJSON_LIMITS, DXF_LIMITS, GLTF_LIMITS, IFC_LIMITS, OBJ_LIMITS,
  CityGMLResultSchema, CityJSONResultSchema, DXFResultSchema, GltfResultSchema, IFCResultSchema, ObjResultSchema,
  DocumentInputSchema, type IntakeCard } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { readObject, readObjectRange, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { areaGeo } from '../../areas/areas';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, assertIntakeSource, assertIntakeSourcesTx, openCellBatchesTx,
  type IntakeSourceRow } from './intake-context';
import { registerIntakeItemTx, intakeItem, listedIntakeRows, saveIntakeCardTx, citeIntakeReceipt, cellFileRefs }
  from './intake-ledger';
import { probeOriginal, IntakeProbeBudget, IntakeTableProbeError, INTAKE_PROBE_REASONS,
  intakeSizeClass, intakeWave } from './intake-probe';
import { assertIngestionBinding, appendCaseIngestionTx, appendIntakeItemTx } from './events';
import { intakeProbeFailureWords, queueIntakeDraftTx } from './intake-draft';
import { queueZipLayersTx } from './intake-zip-layers';
import { labelPageImageTx } from './intake-page-image';
import { planImage, planModel, queueIntakePlanTx } from './intake-plan';
import { planOcrPagesTx } from './intake-plan-processor';
import { queueLateIntakeEvidenceTx } from './intake-evidence';
import { queueIntakeSurfaceTx, surfacePartsTx, surfacePartDisplayTx } from './intake-surface';
import { readingOf, type ReadingFacts } from './intake-reading';
import { streamedLayoutMemoryTx } from './streamed-memory';
import { intakeGeojsonFraming } from './geojson-framing';
import { readDocumentResult } from './documents';
import { omissionFormat, omissionLayersTx } from './intake-native-omissions';

const uuid = z.string().uuid();
// A large GeoJSON names its source's latest streamed profile in the same read; every other item names none.
// ZP2: an item kept from a ZIP member names the archive its lineage was retained from.
const itemSelect = `SELECT i.*,coalesce(s.name,i.member_path) name,profile.job_id streamed_profile_job_id,
  s.inspection->'cellDerivative' cell_derivative,archive.name taken_out_of,archive_item.item_id archive_item_id
  FROM usp_intake_items i LEFT JOIN sources s ON s.id=i.source_id
  LEFT JOIN sources archive ON i.parent_item_id IS NULL AND archive.case_id=s.case_id
    AND archive.id::text=s.inspection->'archiveMember'->>'parentSourceId'
  LEFT JOIN usp_intake_items archive_item ON archive_item.case_id=i.case_id
    AND archive_item.source_id=archive.id AND archive_item.parent_item_id IS NULL
  LEFT JOIN LATERAL (SELECT p.job_id FROM usp_streamed_profile_imports p WHERE p.case_id=i.case_id
    AND p.source_id=i.source_id AND i.parent_item_id IS NULL AND s.profile='large-original-v1'
    AND i.card->>'format'='geojson' ORDER BY p.created_at DESC LIMIT 1) profile ON true`;
const defaults = { transaction, read: readObjectRange, probe: probeOriginal, object: readObject, planModel,
  planOcrPages: planOcrPagesTx, layoutMemory: streamedLayoutMemoryTx,
  resolve: (collection: Record<string, unknown>) =>
    areaGeo<{ authority: string }>('resolve-geojson-crs', { collection }) };

/** The stored diagnostic stays machine-readable; tray responses carry only its plain sentence. */
function describedIntakeItem(row: Parameters<typeof intakeItem>[0]) {
  const item = intakeItem(row);
  if (row.state === 'probe_failed' || row.limit_reason === 'INTAKE_PROBE_BUDGET') {
    item.limitReason = intakeProbeFailureWords(row.limit_reason);
  }
  return item;
}

function readingPlanFacts(source: IntakeSourceRow, stored?: Record<string, unknown>): ReadingFacts {
  const profile = SourceProfileSchema.pick({ paths: true }).strip().safeParse(stored?.profile);
  const facts: ReadingFacts = { profile: profile.success ? profile.data : null };
  const recipe = AnyMappingReceiptSchema.safeParse(stored?.recipe);
  const proposal = z.object({ plan: MappingPlanSchema,
    origin: z.enum(['memory', 'teacher', 'officer']) }).safeParse(stored?.proposal);
  const current = (pin: { sourceId: string; sourceSha256: string; sourceRevision: number }) =>
    pin.sourceId === source.id && pin.sourceSha256 === source.sha256 && pin.sourceRevision === source.revision;
  if (recipe.success && current(recipe.data.plan.source)) facts.recipe = recipe.data;
  if (proposal.success && current(proposal.data.plan.source)) facts.proposal = proposal.data;
  return facts;
}

/** CR1. The geo service decides whether it knows a code (pyproj builds it as a 2D system); none is ever guessed. */
async function knownCrs(crs: string, resolve: typeof defaults.resolve) {
  let authority: string | null = null;
  try {
    authority = (await resolve({ crs: { type: 'name', properties: { name: crs } } })).authority;
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 422) throw error;
  }
  if (authority !== crs) throw new AppError(422, 'INTAKE_LAYER_CRS_UNKNOWN',
    `${crs} is not a two-dimensional coordinate reference system the geo service knows; state one it knows.`);
}

async function itemContextTx(client: PoolClient, caseId: string, itemId: string) {
  const row = (await client.query(`${itemSelect} WHERE i.case_id=$1 AND i.item_id=$2`, [caseId, itemId])).rows[0]
    ?? notFound('Intake item not found in this case.');
  const parent = row.source_id ? row : (await client.query(
    'SELECT source_id FROM usp_intake_items WHERE item_id=$1 AND case_id=$2',
    [row.parent_item_id, caseId])).rows[0];
  if (!parent?.source_id) throw new AppError(403, 'INTAKE_SOURCE_DENIED', 'No retained parent authority.');
  const { source } = await intakeSourceTx(client, caseId, parent.source_id);
  return { row, source };
}

/** CN1. A wide file's rows name which of its cell batches this officer may open; no row without one reads more. */
async function withCellBatchesTx<T extends { plan_ref?: unknown }>(client: PoolClient, rows: T[]) {
  const refs = rows.flatMap(row => cellFileRefs(row.plan_ref));
  if (!refs.length) return rows;
  const open = await openCellBatchesTx(client, refs);
  return rows.map(row => cellFileRefs(row.plan_ref).length ? { ...row, cell_batches_open: open } : row);
}

async function notifyTx(client: PoolClient, source: IntakeSourceRow) {
  // The existing kind has a literal source status. Other statuses publish nothing rather than invent one.
  if (source.status === 'needs_input') await appendCaseIngestionTx(client, source.case_id,
    { kind: 'source.retained', sourceId: source.id, sourceRevision: source.revision, status: 'needs_input' });
}

async function priorTx(client: PoolClient, caseId: string, key: string, digest: string) {
  const prior = (await client.query(`SELECT payload_hash,result FROM operations
    WHERE case_id=$1 AND operation_key=$2 AND kind='intake'`, [caseId, key])).rows[0];
  if (prior && prior.payload_hash !== digest) conflict('This intake request key names different inputs or access.');
  return prior?.result;
}

async function rememberTx(client: PoolClient, caseId: string, key: string, digest: string, result: unknown) {
  await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
    VALUES($1,$2,'intake',$3,$4) ON CONFLICT(case_id,operation_key,kind) DO UPDATE SET result=EXCLUDED.result`,
  [caseId, key, digest, result]);
}

async function childrenTx(client: PoolClient, caseId: string, parentId: string, card: IntakeCard) {
  const members: { path: string; size: number | null; card: IntakeCard | null; refusal: string | null }[] =
    card.members.map(member => ({ path: member.name, size: member.sizeBytes,
    card: member.card ? { ...member.card, members: [] } as IntakeCard : null, refusal: member.refusalCode }));
  // A workbook's items are its sheets, never its package parts; an ODS card lists those its content.xml head names.
  if (card.format === 'xlsx' || card.format === 'ods') {
    members.length = 0;
    for (const sheet of card.sheets) members.push({ path: sheet.name, size: null,
      card: { ...card, sheets: [sheet], members: [], counts: { ...card.counts, members: null } }, refusal: null });
  }
  for (const member of members) {
    // Sheet byte size is unknown, not zero; no reservation or extraction is attempted here.
    const size = member.size;
    const inserted = await client.query(`INSERT INTO usp_intake_items(
      item_id,case_id,parent_item_id,member_path,size_bytes,size_class,
      family,format,wave,state,card,card_sha256,probe_version,limit_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(parent_item_id,member_path) DO NOTHING RETURNING item_id`,
    [randomUUID(), caseId, parentId, member.path, size, size === null ? null : intakeSizeClass(size),
      member.card?.family ?? 'unknown', member.card?.format ?? 'unknown', member.card ? intakeWave(member.card) : 4,
      member.refusal ? 'probe_failed' : 'probed', member.card, member.card ? fingerprint(member.card) : null,
      card.version, member.refusal]);
    for (const row of inserted.rows) await appendIntakeItemTx(client, caseId, row.item_id);
  }
}

/** Requests only register/probe retained bytes. No receipt, reader, job, registry or case revision is changed. */
export class IntakeService {
  private readonly dependencies: typeof defaults;
  constructor(dependencies: Partial<typeof defaults> = {}) { this.dependencies = { ...defaults, ...dependencies }; }

  async register(caseValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const request = IntakeRegisterSchema.parse(raw);
    const key = `intake-register:${request.requestKey}`;
    const initial = await this.prepare(caseId, request, key);
    if (!initial.completed) await this.publish(caseId, key, initial, await this.probe(initial.ctx.source));
    return this.one(caseId, initial.itemId);
  }

  private async prepare(caseId: string, request: z.infer<typeof IntakeRegisterSchema>, key: string) {
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId, true);
      const ctx = await intakeSourceTx(client, caseId, request.sourceId);
      const digest = fingerprint({ request, access: scope.binding.access });
      const prior = await priorTx(client, caseId, key, digest);
      const existing = (await client.query(
        'SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL', [ctx.source.id])).rows[0];
      const row = await registerIntakeItemTx(client, ctx.source);
      const pin = intakeSourcePin(ctx.source, ctx.binding);
      if (prior?.sourcePin && prior.sourcePin !== pin) conflict('The retained intake source changed.');
      if (!existing) await appendIntakeItemTx(client, caseId, row.item_id);
      if (!prior) {
        await rememberTx(client, caseId, key, digest, { itemId: row.item_id, sourcePin: pin, completed: false });
      }
      return { ctx, itemId: row.item_id as string, digest, pin, completed: Boolean(prior?.completed) };
    });
  }

  private async publish(caseId: string, key: string, initial: Awaited<ReturnType<IntakeService['prepare']>>,
    probed: Awaited<ReturnType<IntakeService['probe']>>) {
    return this.dependencies.transaction(async client => {
      await intakeCaseTx(client, caseId, true);
      const fresh = await intakeSourceTx(client, caseId, initial.ctx.source.id);
      assertIngestionBinding(initial.ctx.binding);
      if (intakeSourcePin(fresh.source, fresh.binding) !== initial.pin) {
        conflict('The source changed during the probe.');
      }
      if ((await priorTx(client, caseId, key, initial.digest))?.completed) return;
      if (probed.card) {
        await saveIntakeCardTx(client, initial.itemId, citeIntakeReceipt(probed.card, fresh.source));
        await childrenTx(client, caseId, initial.itemId, probed.card);
        await notifyTx(client, fresh.source);
        // N05: a loose shapefile part waits for its stem's .shp, .shx and .dbf, or queues their one conversion.
        const { queueShapefileSetTx } = await import('./intake-native-derivative');
        const shapefilePart = await queueShapefileSetTx(client, fresh.source, probed.card);
        // SB1: a kept TIFF or LAZ is read in parts by its existing reader; every other item takes the vector queue.
        if (!shapefilePart && !await queueIntakeSurfaceTx(client, fresh.source, probed.card)) {
          await queueIntakeDraftTx(client, fresh.source, probed.card);
        }
        // ZJ1: a ZIP's layers are taken out by a dispatcher job; enrolling it again queues a retry when one waits.
        await queueZipLayersTx(client, fresh.source, probed.card, initial.itemId);
        // AU4-B2 (D4): a table or document kept after a key profile exists is read under it.
        if (!shapefilePart) await queueLateIntakeEvidenceTx(client, caseId, initial.itemId, probed.card.family);
      } else {
        await client.query(`UPDATE usp_intake_items SET state=CASE WHEN card IS NULL THEN $2 ELSE state END,
          limit_reason=CASE WHEN card IS NULL THEN $3 ELSE limit_reason END,updated_at=now() WHERE item_id=$1`,
        [initial.itemId, probed.budget ? 'received' : 'probe_failed', probed.code]);
      }
      await appendIntakeItemTx(client, caseId, initial.itemId);
      await rememberTx(client, caseId, key, initial.digest,
        { itemId: initial.itemId, sourcePin: initial.pin, completed: !probed.budget });
    });
  }

  private async probe(source: IntakeSourceRow) {
    const deadline = Date.now() + INTAKE_PROBE_LIMITS.budgetMs;
    const signal = AbortSignal.timeout(INTAKE_PROBE_LIMITS.budgetMs);
    try {
      const read = (start: number, end: number) => this.dependencies.read(source.object_key,
        start, end, Number(source.bytes), deadline, signal);
      const card = await this.dependencies.probe(read, Number(source.bytes), source.name);
      return { card, budget: false, code: null };
    } catch (error) {
      const budget = error instanceof IntakeProbeBudget || signal.aborted;
      // Never persist parser/error text: it may contain a source value or person/firm name.
      const reason = error instanceof IntakeTableProbeError && INTAKE_PROBE_REASONS.includes(error.reason)
        ? error.reason : 'read_failed';
      return { card: null, budget,
        code: budget ? 'INTAKE_PROBE_BUDGET' : `INTAKE_PROBE_FAILED:${reason}` };
    }
  }

  async manifest(caseValue: string) {
    const caseId = uuid.parse(caseValue);
    // MF1: a fixed number of reads for any number of items; each item is checked by its own schema once.
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      const rows = (await client.query(`${itemSelect} WHERE i.case_id=$1 ORDER BY i.wave,name,i.item_id`,
        [caseId])).rows;
      // Verify each original's existing access binding, including the parent of an unextracted child.
      const sources = [...new Set<string>(rows.map(row => row.source_id).filter(Boolean))];
      await assertIntakeSourcesTx(client, caseId, scope.binding, sources);
      assertIngestionBinding(scope.binding);
      // ZP2: the list folds enrolled members away; the authority read above still covered every queried row.
      const manifest: z.infer<typeof IntakeManifestSchema> = { caseId,
        items: (await withCellBatchesTx(client, listedIntakeRows(rows))).map(describedIntakeItem) };
      return manifest;
    }, undefined, 'repeatable_read_only');
  }

  async one(caseValue: string, itemValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      const { row } = await itemContextTx(client, caseId, itemId);
      assertIngestionBinding(scope.binding);
      return describedIntakeItem((await withCellBatchesTx(client, [row]))[0]);
    });
  }

  async reading(caseValue: string, itemValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      const { row, source } = await itemContextTx(client, caseId, itemId);
      const planColumns = `s.inspection->'manualProfile' profile,r.body recipe,
        p.result proposal,c.object_key,c.object_sha256,c.bytes`;
      const planJoins = `LEFT JOIN usp_mapping_recipes r ON r.source_id=s.id
          LEFT JOIN LATERAL (SELECT o.result FROM operations o JOIN jobs j
            ON o.operation_key='intake-draft-plan:' || j.id::text AND o.case_id=j.case_id
            WHERE o.kind='intake-draft' AND j.operation='intake-draft' AND j.source_id=s.id
            AND j.payload->>'itemId'=i.item_id::text AND j.payload->>'sourceSha256'=s.sha256
            ORDER BY o.created_at DESC LIMIT 1) p ON true
          LEFT JOIN LATERAL (SELECT slot.object_key,slot.object_sha256,slot.bytes
            FROM usp_chunk_mapping_imports m JOIN usp_chunk_mapping_slots slot ON slot.job_id=m.job_id
            WHERE m.case_id=s.case_id AND m.source_id=s.id AND m.source_revision=s.revision
            AND slot.chunk_index=0 AND slot.published=true AND slot.status='ready'
            ORDER BY m.created_at DESC LIMIT 1) c ON true`;
      const storedFacts = async (item: typeof row, retained: IntakeSourceRow, stored?: Record<string, unknown>) => {
        const facts = readingPlanFacts(retained, stored);
        if (item.card?.family === 'table' && stored?.object_key
          && Number(stored.bytes) <= CHUNK_MAPPING_LIMITS.chunkBytes) {
          const bytes = await this.dependencies.object(z.string().parse(stored.object_key));
          if (bytes.length !== Number(stored.bytes) || sha256(bytes) !== stored.object_sha256) {
            throw new AppError(422, 'INTAKE_READING_INTEGRITY', 'The stored field proposal differs from its hash.');
          }
          const payload = ChunkMappingPayloadSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
          if (payload.sourceId === item.source_id && payload.sourceSha256 === retained.sha256
            && payload.sourceRevision === retained.revision) facts.mapping = payload.mapping;
        }
        return facts;
      };
      let facts: ReadingFacts = {};
      if (row.source_id && ['table', 'vector'].includes(row.card?.family)) {
        const stored = (await client.query(`SELECT ${planColumns} FROM sources s
          JOIN usp_intake_items i ON i.source_id=s.id AND i.item_id=$3 ${planJoins}
          WHERE s.case_id=$1 AND s.id=$2`, [caseId, row.source_id, itemId])).rows[0];
        facts = await storedFacts(row, source, stored);
      }
      if (source.profile === 'large-original-v1' && row.card && intakeGeojsonFraming(row.card)
        && row.placement === 'needs_answer') {
        try {
          const memory = await this.dependencies.layoutMemory(client, caseId, itemId);
          facts.layoutMemory = memory.answer.memory;
          facts.profile = memory.profile;
        } catch (error) {
          if (!(error instanceof AppError) || error.status < 400 || error.status >= 500) throw error;
        }
      }
      // Only stored fields and extents can suggest a link; an unread card has neither.
      const peers = row.card ? (await client.query(`SELECT i.*,s.name,to_jsonb(s) AS reading_source,${planColumns}
        FROM usp_intake_items i JOIN sources s ON s.id=i.source_id AND s.case_id=i.case_id ${planJoins}
        WHERE i.case_id=$1 AND i.parent_item_id IS NULL AND i.item_id<>$2
        ORDER BY s.name,i.item_id LIMIT 65`, [caseId, itemId])).rows : [];
      const compared = peers.slice(0, 64);
      for (const peer of compared) assertIntakeSource(peer.reading_source, scope.binding);
      const items = [];
      for (const peer of compared) items.push({ itemId: peer.item_id, name: peer.name,
        card: peer.card ?? null, facts: await storedFacts(peer, peer.reading_source, peer) });
      if (row.source_id && !row.parent_item_id) {
        const readers = {
          dxf: { schema: DXFResultSchema, limit: DXF_LIMITS.resultBytes },
          citygml: { schema: CityGMLResultSchema, limit: CITYGML_LIMITS.resultBytes },
          cityjson: { schema: CityJSONResultSchema, limit: CITYJSON_LIMITS.resultBytes },
          gltf: { schema: GltfResultSchema, limit: GLTF_LIMITS.resultBytes },
          obj: { schema: ObjResultSchema, limit: OBJ_LIMITS.resultBytes },
          ifc: { schema: IFCResultSchema, limit: IFC_LIMITS.resultBytes },
        };
        const format = row.card?.format === 'glb' ? 'gltf' : row.card?.format;
        const reader = Object.hasOwn(readers, format ?? '') ? readers[format as keyof typeof readers] : null;
        const jobId = uuid.safeParse(row.plan_ref?.nativeReaderJobId ?? row.plan_ref?.ifcJobId);
        if (format === 'pdf' || reader && jobId.success) {
          const operation = format === 'pdf' ? 'document-extraction' : `${format}-native`;
          let job = (await client.query(`SELECT j.id,j.payload,m.result_ref,m.input_sha256,
            c.frame,c.context,c.site_id FROM jobs j JOIN cases c ON c.id=j.case_id
            JOIN usp_job_metadata m ON m.job_id=j.id
            JOIN usp_job_attempts a ON a.job_id=j.id AND a.fence=m.accepted_fence AND a.state='accepted'
            WHERE j.case_id=$1 AND j.source_id=$2 AND j.operation=$3 AND ($4::uuid IS NULL OR j.id=$4)
            AND j.status='succeeded' AND m.logical_state='succeeded' AND m.result_ref->>'version'='1'
            AND a.completion_sha256=m.result_ref->>'sha256' AND a.input_sha256=m.input_sha256
            AND NOT (j.payload ? 'ocrSelection') ORDER BY j.created_at DESC LIMIT 1`,
          [caseId, source.id, operation, jobId.success ? jobId.data : null])).rows[0];
          if (!job && format === 'citygml' && jobId.success && row.plan_ref?.nativeReaderJobId === jobId.data) {
            job = (await client.query(`SELECT j.id,j.payload,j.status,j.error,m.input_sha256,
              c.frame,c.context,c.site_id FROM jobs j JOIN cases c ON c.id=j.case_id
              JOIN usp_job_metadata m ON m.job_id=j.id
              WHERE j.case_id=$1 AND j.source_id=$2 AND j.operation='citygml-native' AND j.id=$3
              AND j.status='failed' AND j.error='CITYGML_OUTPUT_LIMIT'
              AND NOT (j.payload ? 'ocrSelection')`, [caseId, source.id, jobId.data])).rows[0];
          }
          const input = job?.payload;
          if (input && fingerprint(input) === job.input_sha256
            && input.jobId === job.id && input.caseId === caseId && input.sourceId === source.id
            && input.objectKey === source.object_key
            && input.caseContextSha256 === fingerprint({ frame: job.frame, context: job.context, siteId: job.site_id })
            && input.sourceSha256 === source.sha256 && input.sourceRevision === source.revision
            && input.sourceBytes === Number(source.bytes) && input.subject === scope.binding.subject
            && input.accessSha256 === scope.binding.access && input.caseRevision <= scope.current.revision) {
            if (format === 'citygml' && job.status === 'failed' && job.error === 'CITYGML_OUTPUT_LIMIT') {
              facts.nativeStopped = { format, code: job.error };
            } else if (format === 'pdf') facts.document = (await readDocumentResult(DocumentInputSchema.parse(input),
              job.result_ref.sha256, this.dependencies.object)).native;
            else if (reader) {
              const key = `${format}-native/${input.jobId}/${job.result_ref.sha256}.json`;
              const bytes = await this.dependencies.object(key);
              if (bytes.length > reader.limit || sha256(bytes) !== job.result_ref.sha256) {
                throw new AppError(422, 'INTAKE_READING_INTEGRITY', 'The stored reading differs from its hash.');
              }
              const result = reader.schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
              if (fingerprint(result.input) !== fingerprint(input)) {
                throw new AppError(422, 'INTAKE_READING_INTEGRITY', 'The stored reading names different inputs.');
              }
              if (result.summary.schemaVersion === 'ulpin-native-ifc/1') facts.ifc = result.summary;
              else facts.native = result.summary;
            }
          }
        }
        if (omissionFormat(row.card ?? null, row.name ?? '')) {
          facts.omissions = (await omissionLayersTx(client, caseId, itemId, source)).map(({ lineage }) =>
            ({ layer: lineage.layer, notWritten: lineage.notWritten }));
        }
      }
      assertIngestionBinding(scope.binding);
      return readingOf(row, row.card ?? null, facts, { items, more: peers.length > 64 });
    });
  }

  /** SB1: a kept surface's parts in order, under the item's original source authority. */
  async parts(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const { after } = IntakeSurfacePartsQuerySchema.parse(raw);
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      await itemContextTx(client, caseId, itemId);
      assertIngestionBinding(scope.binding);
      return surfacePartsTx(client, caseId, itemId, after);
    });
  }

  /** SB1 (D5): one accepted part placed in the batch's local frame, its reader's accepted fence checked again. */
  async display(caseValue: string, itemValue: string, partValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const partIndex = z.coerce.number().int().nonnegative().parse(partValue);
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      await itemContextTx(client, caseId, itemId);
      assertIngestionBinding(scope.binding);
      return surfacePartDisplayTx(client, caseId, itemId, partIndex);
    });
  }

  async pin(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const request = IntakePinSchema.parse(raw);
    await this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId, true);
      const { source } = await itemContextTx(client, caseId, itemId);
      const key = `intake-pin:${request.requestKey}`;
      const digest = fingerprint({ request, itemId, access: scope.binding.access });
      if (await priorTx(client, caseId, key, digest)) return;
      await client.query(`UPDATE usp_intake_items SET wave=$3,pinned_by_officer=true,updated_at=now()
        WHERE case_id=$1 AND item_id=$2`, [caseId, itemId, request.wave]);
      await appendIntakeItemTx(client, caseId, itemId);
      await rememberTx(client, caseId, key, digest, { itemId });
      await notifyTx(client, source);
      assertIngestionBinding(scope.binding);
    });
    return this.one(caseId, itemId);
  }

  /** G23S. A read page image's stored preview: its key comes from the item, its bytes must match the kept hash. */
  async pageImagePreview(caseValue: string, itemValue: string) {
    const preview = (await this.one(caseValue, itemValue)).pageImage?.preview
      ?? notFound('This item has no page image preview.');
    const bytes = await this.dependencies.object(preview.key);
    if (sha256(bytes) !== preview.sha256) {
      throw new AppError(409, 'PAGE_IMAGE_PREVIEW_INTEGRITY', 'The stored preview differs from its kept SHA-256.');
    }
    return { bytes, sha256: preview.sha256 };
  }

  /**
   * NO1. A native conversion's features not written, per layer, under the original item's authority: its derivatives
   * are found by their stored lineage and each layer's locator file is read within one bounded budget.
   */
  async omissions(caseValue: string, itemValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const { omissionFormat, omissionLayersTx, readOmissions } = await import('./intake-native-omissions');
    const scope = await this.dependencies.transaction(async client => {
      const binding = (await intakeCaseTx(client, caseId)).binding;
      const { row, source } = await itemContextTx(client, caseId, itemId);
      assertIngestionBinding(binding);
      if (row.parent_item_id || row.source_id !== source.id || !omissionFormat(row.card, source.name)) {
        throw new AppError(409, 'INTAKE_OMISSIONS_NOT_NATIVE', 'Only a GeoPackage, shapefile, KML, KMZ, CityJSON '
          + 'or CityGML kept in this batch has converted layers with a list of features not written.');
      }
      return { caseId, itemId, source, layers: await omissionLayersTx(client, caseId, itemId, source) };
    });
    return readOmissions(scope, this.dependencies.read);
  }

  /** G23. The officer's answer to what a read page image shows, kept as a candidate label; one stored request. */
  async labelPageImage(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const request = IntakePageImageAnswerSchema.parse(raw);
    await this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId, true);
      await itemContextTx(client, caseId, itemId);
      const key = `intake-page-image-label:${request.requestKey}`;
      const digest = fingerprint({ request, itemId, access: scope.binding.access });
      if (await priorTx(client, caseId, key, digest)) return;
      await labelPageImageTx(client, caseId, itemId, request.label, new Date().toISOString());
      await rememberTx(client, caseId, key, digest, { itemId });
      assertIngestionBinding(scope.binding);
    });
    return this.one(caseId, itemId);
  }

  /** Availability is checked against the processor's verified model, not a host-side assumption. */
  async planOffer(caseValue: string, itemValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const pages = await this.dependencies.transaction(async client => {
      const { row, source } = await itemContextTx(client, caseId, itemId);
      if (Number(source.bytes) > 16 * 1024 ** 2) return [];
      if (planImage(row)) return [1];
      if (row.card?.format !== 'pdf' || row.parent_item_id) return [];
      return [...(await this.dependencies.planOcrPages(client, source)).keys()].sort((left, right) => left - right);
    });
    return { ...await this.dependencies.planModel(), pages };
  }

  async readPlan(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const request = IntakePlanRequestSchema.parse(raw);
    const model = await this.dependencies.planModel();
    return this.dependencies.transaction(async client => {
      await lockSourceCaseDestinationTx(client, caseId);
      const scope = await intakeCaseTx(client, caseId, true);
      const { row, source } = await itemContextTx(client, caseId, itemId);
      const key = `intake-plan:${request.requestKey}`;
      const digest = fingerprint({ request, itemId, access: scope.binding.access });
      const prior = await priorTx(client, caseId, key, digest);
      if (prior) return prior;
      const pages = row.card?.format === 'pdf' ? await this.dependencies.planOcrPages(client, source) : new Map();
      const receipt = await queueIntakePlanTx(client, source, row, request.page, model,
        pages.get(request.page) ?? null);
      await rememberTx(client, caseId, key, digest, receipt);
      assertIngestionBinding(scope.binding);
      return receipt;
    });
  }

  /** CR1. The officer states the EPSG code of a layer whose file states none; the conversion is queued again. */
  async layerCrs(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const request = IntakeLayerCrsSchema.parse(raw);
    await knownCrs(request.crs, this.dependencies.resolve);
    return this.answerItem(caseId, itemId, `intake-layer-crs:${request.requestKey}`, request,
      async (client, source) => {
        const { stateLayerCrsTx } = await import('./intake-native-derivative');
        await stateLayerCrsTx(client, source, itemId, request);
      });
  }

  /**
   * TC1. Places a kept table's rows on the map from the coordinate columns and the EPSG code the officer states;
   * a stated code must be one the geo service knows, and a missing one is asked for, never assumed.
   */
  async placeTable(caseValue: string, itemValue: string, raw: unknown) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    const request = IntakeTablePlacementSchema.parse(raw);
    if (request.crs) await knownCrs(request.crs, this.dependencies.resolve);
    return this.answerItem(caseId, itemId, `intake-table-placement:${request.requestKey}`, request,
      async (client, source) => {
        const { queueTableGeojsonTx } = await import('./table-geojson');
        await queueTableGeojsonTx(client, source, request);
      });
  }

  /** One officer answer on an item, idempotent by its request key, acted on while the case is held. */
  private async answerItem(caseId: string, itemId: string, key: string, request: unknown,
    act: (client: PoolClient, source: IntakeSourceRow) => Promise<void>) {
    await this.dependencies.transaction(async client => {
      await lockSourceCaseDestinationTx(client, caseId);
      const scope = await intakeCaseTx(client, caseId, true);
      const { source } = await itemContextTx(client, caseId, itemId);
      const digest = fingerprint({ request, itemId, access: scope.binding.access });
      if (await priorTx(client, caseId, key, digest)) return;
      await act(client, source);
      await rememberTx(client, caseId, key, digest, { itemId });
      assertIngestionBinding(scope.binding);
    });
    return this.one(caseId, itemId);
  }
}
