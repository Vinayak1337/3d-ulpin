import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';
import { hash, providerKeyReferences, type GatewayConfig } from './config';
import { checkedAmount, reservation } from './pricing';
import { citedKeyRefusal, type CitedKeyRefusal, type KeyRefusalKind, type ProviderFailure } from './adapter';

export type Transact = <T>(action: (client: PoolClient) => Promise<T>) => Promise<T>;
export type Admission = { principalHash: string; invocationKey: string; attempt: number;
  consumer: 'INGEST' | 'ASSIST'; inputHash: string; scopeHash: string; sourceHashes: readonly string[]; deadlineAt: Date };
export type CallReceipt = { httpStatus: number; responseHash: string; inputTokens?: number; outputTokens?: number;
  actualMicroInr: string; semanticError?: 'invalid_output' | 'truncated_output' };
const receiptSchema = z.strictObject({httpStatus:z.number().int().min(100).max(599),responseHash:z.string().regex(/^[a-f0-9]{64}$/),
  inputTokens:z.number().int().nonnegative().safe().optional(),outputTokens:z.number().int().nonnegative().safe().optional(),
  actualMicroInr:z.string().regex(/^(0|[1-9][0-9]*)$/),semanticError:z.enum(['invalid_output','truncated_output']).optional()});
const callSchema = z.object({id:z.string().uuid(),input_hash:z.string(),scope_hash:z.string(),config_hash:z.string(),
  state:z.enum(['reserved','dispatched','settled','released','outcome_unknown','usage_unverified']),
  consumer:z.enum(['INGEST','ASSIST']),
  deadline_at:z.date(),reserve_micro_inr:z.string(),actual_micro_inr:z.string().nullable(),
  output:z.unknown().nullable(),receipt:receiptSchema.nullable(),settlement_hash:z.string().nullable(),
  credential_hash:z.string().nullable().optional(),error_kind:z.string().nullable().optional()});
export type Call = z.infer<typeof callSchema>;
export type KeyState = { reference: string; state: 'in_use' | 'waiting' | 'used_up';
  reason?: KeyRefusalKind; markedAt?: string };
const deny = (code: string, message: string, status = 503): never => { throw new AppError(status, code, message); };
const unresolvedStates = "('reserved','dispatched','outcome_unknown','usage_unverified')";
const ownerReason = z.string().trim().min(3).max(300).regex(/^[^\x00-\x1f\x7f]+$/);
const withoutKeyNames = ({ secretReference, secretReferences, ...rest }: Record<string, unknown>) => rest;

/** A call closed at zero because the provider refused its key keeps that kind and has no output. */
export function closedKeyRefusal(call: Call): KeyRefusalKind | undefined {
  const refused = call.error_kind === 'quota_exhausted' || call.error_kind === 'credential_invalid';
  return call.state === 'settled' && refused ? call.error_kind as KeyRefusalKind : undefined;
}

/** One serialization point across processes; transactions never enclose transport. */
export class PgModelCallLedger {
  /** One key: its hash, as before. A list: the hash of its key hashes in the owner's order. */
  private readonly credentialHash: string;
  /** The key hashes of a list policy in the owner's order; undefined for a one-key policy. */
  private readonly keyHashes?: readonly string[];
  constructor(private readonly transact: Transact, readonly config: GatewayConfig,
    credential: string | readonly string[], private readonly adapterKind: string) {
    const listed = typeof credential !== 'string';
    const named = config.secretReferences?.length;
    if (listed && (credential.length !== named || new Set(credential).size !== named) || !listed && named)
      deny('MODEL_CONFIGURATION', 'The policy must name each key once, and every named key must differ.', 422);
    this.keyHashes = listed ? credential : undefined;
    this.credentialHash = listed ? hash(credential) : credential;
  }
  get configHash() { return hash({config:this.config,adapter:this.adapterKind}); }
  private async lock(client: PoolClient) {
    await client.query(`INSERT INTO usp_model_budget(singleton,project_id,config_hash,config,credential_hash)
      VALUES(true,$1,$2,$3,$4) ON CONFLICT(singleton) DO NOTHING`,
      [this.config.projectId,this.configHash,this.config,this.credentialHash]);
    const row = (await client.query('SELECT *, clock_timestamp() now FROM usp_model_budget WHERE singleton=true FOR UPDATE')).rows[0];
    if (!row || row.config_hash !== this.configHash || row.credential_hash !== this.credentialHash)
      deny('MODEL_RECONCILIATION_REQUIRED', 'The pinned pool configuration changed. Reconcile it before paid dispatch.');
    if (!(row.now instanceof Date) || Number.isNaN(row.now.getTime())) deny('MODEL_LEDGER_UNAVAILABLE','Model ledger clock is unavailable.');
    return row;
  }
  async reserve(input: Admission): Promise<{call: Call; admitted: boolean}> {
    return this.transact(async client => {
      const budget = await this.lock(client);
      const existing = (await client.query(`SELECT * FROM usp_model_calls WHERE project_id=$1 AND principal_hash=$2
        AND invocation_key=$3 AND attempt=$4`, [this.config.projectId,input.principalHash,input.invocationKey,input.attempt])).rows[0];
      if (existing) {
        const call = callSchema.parse(existing);
        if (call.input_hash !== input.inputHash || call.scope_hash !== input.scopeHash || call.config_hash !== this.configHash)
          deny('MODEL_IDEMPOTENCY_CONFLICT','The call key was already used for different inputs.',409);
        return {call,admitted:false};
      }
      if (![1,2].includes(input.attempt) || !['INGEST','ASSIST'].includes(input.consumer))
        deny('MODEL_ATTEMPT_LIMIT','A synchronous extraction permits at most two attempts.',422);
      if (budget.blocked_reason) deny('MODEL_POOL_BLOCKED','The single model pool requires reconciliation. Manual preparation remains available.');
      if ([budget.cooldown_until,budget.next_admission_at].some(d => d && d.getTime() > budget.now.getTime()))
        deny('MODEL_COOLDOWN','The shared provider bucket is cooling down. No alternate key is attempted.',429);
      const unresolved = (await client.query(`SELECT count(*)::int count FROM usp_model_calls
        WHERE state IN ${unresolvedStates}`)).rows[0];
      if (z.object({count:z.number().int().nonnegative()}).parse(unresolved).count)
        deny('MODEL_EXPOSURE_PENDING','A model call is in flight or has unresolved exposure. Its reservation remains held.');
      const prior = (await client.query(`SELECT * FROM usp_model_calls WHERE project_id=$1 AND principal_hash=$2
        AND invocation_key=$3 ORDER BY attempt`,[this.config.projectId,input.principalHash,input.invocationKey])).rows.map(r => callSchema.parse(r));
      if ((input.attempt === 1 && prior.length) || (input.attempt === 2 && (prior.length !== 1 || prior[0].state !== 'settled')))
        deny('MODEL_ATTEMPT_LIMIT','Only one repair after a settled first call is permitted.',422);
      if (prior[0] && (prior[0].scope_hash !== input.scopeHash || prior[0].consumer !== input.consumer))
        deny('MODEL_IDEMPOTENCY_CONFLICT','A repair must retain the original scope and consumer.',409);
      const proposedDeadline = prior[0]?.deadline_at ?? input.deadlineAt;
      if (!(proposedDeadline instanceof Date) || !Number.isFinite(proposedDeadline.getTime()))
        deny('MODEL_DEADLINE','The synchronous deadline is invalid.',422);
      // Clamp at the DB clock boundary; tiny process/VM clock skew must not reject a valid 45s deadline.
      const deadline = new Date(Math.min(proposedDeadline.getTime(),budget.now.getTime()+45000));
      if (deadline.getTime() <= budget.now.getTime())
        deny('MODEL_DEADLINE','The shared synchronous deadline has expired.',422);
      const daily = (await client.query(`SELECT count(*)::int count FROM usp_model_calls WHERE principal_hash=$1
        AND created_at >= date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND state != 'released'`,[input.principalHash,budget.now])).rows[0];
      if (z.object({count:z.number().int().nonnegative()}).parse(daily).count >= this.config.principalDailyCallCap)
        deny('MODEL_PRINCIPAL_CAP','The daily principal model-call cap has been reached.',429);
      const totals = (await client.query(`SELECT
        COALESCE(sum(CASE WHEN state='settled' THEN actual_micro_inr WHEN state='released' THEN 0 ELSE reserve_micro_inr END),0)::text total,
        COALESCE(sum(CASE WHEN consumer!='INGEST' THEN CASE WHEN state='settled' THEN actual_micro_inr WHEN state='released' THEN 0 ELSE reserve_micro_inr END ELSE 0 END),0)::text other
        FROM usp_model_calls`)).rows[0];
      const amounts = z.object({total:z.string().regex(/^\d+$/),other:z.string().regex(/^\d+$/)}).parse(totals);
      const reserve = reservation(this.config), cap = BigInt(this.config.projectCapMicroInr);
      if (checkedAmount(BigInt(amounts.total) + reserve) > cap)
        deny('MODEL_PROJECT_CAP','The reservation would exceed the hard project cap.');
      if (this.config.projectDailyCapMicroInr) {
        const dailyQuery = await client.query(`SELECT COALESCE(sum(CASE WHEN state='settled' THEN actual_micro_inr
          WHEN state='released' THEN 0 ELSE reserve_micro_inr END),0)::text total FROM usp_model_calls
          WHERE created_at >= date_trunc('day',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [budget.now]);
        const dailyAmount = z.object({ total: z.string().regex(/^\d+$/) }).parse(dailyQuery.rows[0]);
        if (checkedAmount(BigInt(dailyAmount.total) + reserve) > BigInt(this.config.projectDailyCapMicroInr)) {
          deny('MODEL_DAILY_CAP', 'The reservation would exceed the daily project cap.');
        }
      }
      const nonIngestCap = cap * BigInt(10000 - this.config.ingestProtectedBps) / 10000n;
      if (input.consumer !== 'INGEST' && BigInt(amounts.other) + reserve > nonIngestCap)
        deny('MODEL_CONSUMER_CAP','This reservation would spend the protected ingestion allocation.');
      const credentialHash = await this.keyInUse(client);
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO usp_model_calls(id,project_id,principal_hash,invocation_key,attempt,consumer,
        input_hash,scope_hash,config_hash,price,source_hashes,state,reserve_micro_inr,deadline_at,credential_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved',$12,$13,$14) RETURNING *`,
        [id,this.config.projectId,input.principalHash,input.invocationKey,input.attempt,input.consumer,input.inputHash,
          input.scopeHash,this.configHash,this.config.price,JSON.stringify(input.sourceHashes),reserve.toString(),
          deadline,credentialHash])).rows[0];
      return {call:callSchema.parse(row),admitted:true};
    });
  }
  private async openMarks(client: PoolClient): Promise<Map<string, { reason: KeyRefusalKind; markedAt: Date }>> {
    const rows = (await client.query(`SELECT credential_hash, reason, marked_at FROM usp_model_key_marks
      WHERE restored_at IS NULL`)).rows;
    return new Map(rows.map(row => [row.credential_hash, { reason: row.reason, markedAt: row.marked_at }]));
  }
  /** Chosen under the budget row's lock: the first key of the list without an open mark. Never a per-call choice. */
  private async keyInUse(client: PoolClient): Promise<string> {
    if (!this.keyHashes) return this.credentialHash;
    const marks = await this.openMarks(client);
    const free = this.keyHashes.find(keyHash => !marks.has(keyHash));
    return free ?? deny('MODEL_KEYS_EXHAUSTED',
      'Every key of the list is marked used up. Manual preparation remains available.');
  }
  async admissionDelay(): Promise<number> {
    return this.transact(async client => {
      const row = await this.lock(client);
      return Math.max(0,...[row.cooldown_until,row.next_admission_at].filter(Boolean).map(d => d.getTime()-row.now.getTime()));
    });
  }
  async dispatch(id: string) {
    return this.transact(async client => {
      const budget = await this.lock(client);
      if (budget.blocked_reason) deny('MODEL_POOL_BLOCKED','The model pool is blocked.');
      const row = (await client.query(`UPDATE usp_model_calls SET state='dispatched',dispatched_at=clock_timestamp()
        WHERE id=$1 AND config_hash=$2 AND state='reserved' AND deadline_at>clock_timestamp() RETURNING id`,[id,this.configHash])).rows[0];
      if (!row) deny('MODEL_CALL_PENDING','This attempt cannot be dispatched twice.');
      await client.query(`UPDATE usp_model_budget SET next_admission_at=clock_timestamp()+$1*interval '1 millisecond' WHERE singleton=true`,[this.config.paceMs]);
    });
  }
  async releaseBeforeDispatch(id: string) {
    await this.transact(async client => {
      await this.lock(client);
      await client.query(`UPDATE usp_model_calls SET state='released',error_kind='pre_dispatch_rejected'
        WHERE id=$1 AND config_hash=$2 AND state='reserved' AND dispatched_at IS NULL`,[id,this.configHash]);
    });
  }
  async retainExposure(id: string, failure?: ProviderFailure) {
    await this.transact(async client => {
      await this.lock(client);
      if (this.keyHashes && citedKeyRefusal(failure)) return this.closeKeyRefusal(client, id, failure);
      const row = (await client.query(`UPDATE usp_model_calls SET state=$2,error_kind=$3
        WHERE id=$1 AND config_hash=$4 AND state='dispatched' RETURNING id`,
        [id,failure ? 'outcome_unknown' : 'usage_unverified',failure?.kind ?? 'usage_unverified',this.configHash])).rows[0];
      if (!row) return;
      if (failure && ['quota_exhausted','credential_invalid','capability_denied'].includes(failure.kind))
        await client.query('UPDATE usp_model_budget SET blocked_reason=$1 WHERE singleton=true',[failure.kind]);
      if (failure?.cooldownMs) await client.query(`UPDATE usp_model_budget SET cooldown_until=GREATEST(cooldown_until,
        clock_timestamp()+$1*interval '1 millisecond') WHERE singleton=true`,[failure.cooldownMs]);
    });
  }
  /** The refused request made no completion: the row closes at zero with its receipt and the key gets its mark. */
  private async closeKeyRefusal(client: PoolClient, id: string, failure: CitedKeyRefusal) {
    const receipt: CallReceipt = { httpStatus: failure.httpStatus, responseHash: failure.responseHash,
      actualMicroInr: '0' };
    const row = (await client.query(`UPDATE usp_model_calls SET state='settled',actual_micro_inr=0,receipt=$2,
      settlement_hash=$3,settled_at=clock_timestamp(),error_kind=$4
      WHERE id=$1 AND config_hash=$5 AND state='dispatched' RETURNING credential_hash`,
      [id, receipt, hash({ actual: '0', output: null, receipt }), failure.kind, this.configHash])).rows[0];
    if (!row) return;
    const reference = providerKeyReferences(this.config)[this.keyHashes!.indexOf(row.credential_hash)];
    await client.query(`INSERT INTO usp_model_key_marks(id,credential_hash,secret_reference,reason,http_status,call_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [randomUUID(), row.credential_hash, reference, failure.kind, failure.httpStatus, id]);
  }
  /** Owner step. Adopts the configured keys when nothing else of the pinned policy differs and nothing is open. */
  async reconcileKeys(reason: string): Promise<'unpinned' | 'unchanged' | 'reconciled'> {
    const stated = ownerReason.parse(reason);
    return this.transact(async client => {
      const row = (await client.query('SELECT * FROM usp_model_budget WHERE singleton=true FOR UPDATE')).rows[0];
      if (!row) return 'unpinned';
      if (row.config_hash === this.configHash && row.credential_hash === this.credentialHash) return 'unchanged';
      const configured = JSON.parse(JSON.stringify(this.config));
      if (!isDeepStrictEqual(withoutKeyNames(row.config), withoutKeyNames(configured)))
        deny('MODEL_RECONCILIATION_REQUIRED', 'Only the key list may differ from the pinned policy.');
      const unresolved = (await client.query(`SELECT count(*)::int count FROM usp_model_calls
        WHERE state IN ${unresolvedStates}`)).rows[0];
      if (z.object({count:z.number().int().nonnegative()}).parse(unresolved).count)
        deny('MODEL_EXPOSURE_PENDING', 'A model call has unresolved exposure. Resolve it before changing the keys.');
      await client.query(`UPDATE usp_model_budget SET config_hash=$1,config=$2,credential_hash=$3,
        reconciled_at=clock_timestamp(),reconciled_reason=$4 WHERE singleton=true`,
        [this.configHash, this.config, this.credentialHash, stated]);
      return 'reconciled';
    });
  }
  private hashOf(reference: string): string {
    const index = providerKeyReferences(this.config).indexOf(reference);
    if (index < 0) deny('MODEL_SECRET_REFERENCE', 'That name is not a key of the configured policy.', 422);
    return (this.keyHashes ?? [this.credentialHash])[index];
  }
  /** Owner step. Closes the key's open mark with the owner's reason; the mark row itself is kept. */
  async restoreKey(reference: string, reason: string): Promise<boolean> {
    const stated = ownerReason.parse(reason), keyHash = this.hashOf(reference);
    return this.transact(async client => {
      const restored = await client.query(`UPDATE usp_model_key_marks SET restored_at=clock_timestamp(),
        restored_reason=$2 WHERE credential_hash=$1 AND restored_at IS NULL RETURNING id`, [keyHash, stated]);
      return restored.rows.length > 0;
    });
  }
  /** Names and states only, in the owner's order; never a hash or a value. */
  async keyStates(): Promise<KeyState[]> {
    return this.transact(async client => {
      const marks = await this.openMarks(client), hashes = this.keyHashes ?? [this.credentialHash];
      const inUse = hashes.findIndex(keyHash => !marks.has(keyHash));
      return providerKeyReferences(this.config).map((reference, index): KeyState => {
        const mark = marks.get(hashes[index]);
        if (mark) return { reference, state: 'used_up', reason: mark.reason, markedAt: mark.markedAt.toISOString() };
        return { reference, state: index === inUse ? 'in_use' : 'waiting' };
      });
    });
  }
  async settle(id: string, actual: bigint, output: unknown, receipt: CallReceipt): Promise<Call> {
    checkedAmount(actual); receiptSchema.parse(receipt);
    if (receipt.actualMicroInr !== actual.toString()) deny('MODEL_SETTLEMENT_CONFLICT','Settlement receipt amount differs.',409);
    const settlementHash = hash({actual:actual.toString(),output,receipt});
    return this.transact(async client => {
      await this.lock(client);
      const call = callSchema.parse((await client.query('SELECT * FROM usp_model_calls WHERE id=$1 AND config_hash=$2 FOR UPDATE',[id,this.configHash])).rows[0]);
      if (call.state === 'settled') {
        if (call.settlement_hash !== settlementHash) deny('MODEL_SETTLEMENT_CONFLICT','A different settlement was already recorded.',409);
        return call;
      }
      if (!['dispatched','outcome_unknown','usage_unverified'].includes(call.state))
        deny('MODEL_SETTLEMENT_STATE','Only a dispatched call can incur provider spend.',409);
      const row = (await client.query(`UPDATE usp_model_calls SET state='settled',actual_micro_inr=$2,
        output=$3,receipt=$4,settlement_hash=$5,settled_at=clock_timestamp() WHERE id=$1 RETURNING *`,
        [id,actual.toString(),JSON.stringify(output),receipt,settlementHash])).rows[0];
      if (actual > BigInt(call.reserve_micro_inr))
        await client.query("UPDATE usp_model_budget SET blocked_reason='deficit' WHERE singleton=true");
      return callSchema.parse(row);
    });
  }
}
