import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { INTAKE_PROBE_LIMITS, IntakeRegisterSchema, IntakePinSchema, IntakeManifestSchema,
  type IntakeCard } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { registerIntakeItemTx, intakeItem, saveIntakeCardTx, citeIntakeReceipt } from './intake-ledger';
import { probeOriginal, IntakeProbeBudget, intakeSizeClass, intakeWave } from './intake-probe';
import { assertIngestionBinding, appendCaseIngestionTx, appendIntakeItemTx } from './events';
import { queueIntakeDraftTx } from './intake-draft';

const uuid = z.string().uuid();
// A large GeoJSON names its source's latest streamed profile in the same read; every other item names none.
const itemSelect = `SELECT i.*,coalesce(s.name,i.member_path) name,profile.job_id streamed_profile_job_id
  FROM usp_intake_items i LEFT JOIN sources s ON s.id=i.source_id
  LEFT JOIN LATERAL (SELECT p.job_id FROM usp_streamed_profile_imports p WHERE p.case_id=i.case_id
    AND p.source_id=i.source_id AND i.parent_item_id IS NULL AND s.profile='large-original-v1'
    AND i.card->>'format'='geojson' ORDER BY p.created_at DESC LIMIT 1) profile ON true`;
const defaults = { transaction, read: readObjectRange, probe: probeOriginal };

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
  if (card.format === 'xlsx') {
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
    if (initial.completed) return this.one(caseId, initial.itemId);
    const probed = await this.probe(initial.ctx.source);
    await this.publish(caseId, key, initial, probed);
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
        await queueIntakeDraftTx(client, fresh.source, probed.card);
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
      return { card: null, budget, code: budget ? 'INTAKE_PROBE_BUDGET' : 'INTAKE_PROBE_FAILED' };
    }
  }

  async manifest(caseValue: string) {
    const caseId = uuid.parse(caseValue);
    return this.dependencies.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const scope = await intakeCaseTx(client, caseId);
      const rows = (await client.query(`${itemSelect} WHERE i.case_id=$1 ORDER BY i.wave,name,i.item_id`,
        [caseId])).rows;
      // Verify each original's existing access binding, including the parent of an unextracted child.
      const sources = new Set(rows.map(row => row.source_id).filter(Boolean));
      for (const sourceId of sources) await intakeSourceTx(client, caseId, sourceId);
      assertIngestionBinding(scope.binding);
      return IntakeManifestSchema.parse({ caseId, items: rows.map(intakeItem) });
    });
  }

  async one(caseValue: string, itemValue: string) {
    const caseId = uuid.parse(caseValue);
    const itemId = uuid.parse(itemValue);
    return this.dependencies.transaction(async client => {
      const scope = await intakeCaseTx(client, caseId);
      const { row } = await itemContextTx(client, caseId, itemId);
      assertIngestionBinding(scope.binding);
      return intakeItem(row);
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
}
