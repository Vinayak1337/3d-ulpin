import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../infrastructure/errors';
import { hash, type GatewayConfig } from './config';
import { checkedAmount, reservation } from './pricing';
import type { ProviderFailure } from './adapter';

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
  output:z.unknown().nullable(),receipt:receiptSchema.nullable(),settlement_hash:z.string().nullable()});
export type Call = z.infer<typeof callSchema>;
const deny = (code: string, message: string, status = 503): never => { throw new AppError(status, code, message); };

/** One serialization point across processes; transactions never enclose transport. */
export class PgModelCallLedger {
  constructor(private readonly transact: Transact, readonly config: GatewayConfig,
    private readonly credentialHash: string, private readonly adapterKind: string) {}
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
        WHERE state IN ('reserved','dispatched','outcome_unknown','usage_unverified')`)).rows[0];
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
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO usp_model_calls(id,project_id,principal_hash,invocation_key,attempt,consumer,
        input_hash,scope_hash,config_hash,price,source_hashes,state,reserve_micro_inr,deadline_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved',$12,$13) RETURNING *`,
        [id,this.config.projectId,input.principalHash,input.invocationKey,input.attempt,input.consumer,input.inputHash,
          input.scopeHash,this.configHash,this.config.price,JSON.stringify(input.sourceHashes),reserve.toString(),deadline])).rows[0];
      return {call:callSchema.parse(row),admitted:true};
    });
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
