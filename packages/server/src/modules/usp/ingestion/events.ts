import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  CASE_INGESTION_VERSION, CaseIngestionCursorSchema, CaseIngestionOutboxSchema, CaseIngestionEventSchema,
  type CaseIngestionChange, type CaseIngestionControl, type CaseIngestionEvent,
} from '@ulpin/contracts/usp';
import { pool } from '../../../infrastructure/db';
import { AppError, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localRequestContext, localOperatorSubject } from '../principal';
import { appendUspOutboxTx } from '../outbox';

export const INGESTION_EVENT_LIMITS = Object.freeze({
  connections: 4, perOperator: 2, perCase: 1, page: 32, replay: 256, sources: 256,
  eventBytes: 1024, frameBytes: 2048, bufferBytes: 4096, pollMs: 500, heartbeatMs: 10000,
  durationMs: 60000, writeMs: 2000, statementMs: 2000, readMs: 6000, reads: 121,
});
const radix = 10n ** 19n, maxSequence = 9223372036854775807n;
export type IngestionBinding = ReturnType<typeof ingestionBinding>;

/** The subject can only be supplied by a server-owned mutation receipt, never an HTTP input. */
export function ingestionBinding(caseId: string, subject = localOperatorSubject()) {
  caseId = z.string().uuid().parse(caseId).toLowerCase();
  const ctx = localRequestContext('ingestion-events');
  const access = fingerprint({subject, accessViewId: ctx.accessViewId, policyVersion: ctx.policyVersion,
    entitlementVersion: ctx.principal.entitlementVersion});
  const tag = BigInt(`0x${fingerprint({version: CASE_INGESTION_VERSION, caseId, access})}`);
  return {caseId, subject, access, tag, streamId: `case-ingestion:${caseId}:${access}`};
}
export function assertIngestionBinding(binding: IngestionBinding) {
  if (ingestionBinding(binding.caseId).access !== binding.access)
    throw new AppError(403, 'INGESTION_ACCESS_CHANGED', 'The configured local access context changed.');
}
export function ingestionCursor(binding: IngestionBinding, sequence: bigint): string {
  if (sequence < 0n || sequence > maxSequence) throw new Error('Outbox sequence is outside bigint range.');
  return (binding.tag * radix + sequence).toString();
}
/** The query cursor is the replay floor; EventSource reconnects may advance it with Last-Event-ID. */
export function parseIngestionCursor(binding: IngestionBinding, queryCursor?: string, lastEventId?: string): bigint | undefined {
  for (const value of [queryCursor, lastEventId]) if (value !== undefined && !CaseIngestionCursorSchema.safeParse(value).success)
    throw new AppError(422, 'INGESTION_CURSOR', 'Use a canonical decimal case-ingestion cursor.');
  const decode = (value: string, bootstrap: boolean) => {
    if (bootstrap && value === '0') return 0n;
    const encoded = BigInt(value), sequence = encoded % radix;
    if (encoded / radix !== binding.tag || sequence > maxSequence)
      throw new AppError(409, 'INGESTION_CURSOR_SCOPE', 'This cursor does not belong to the authorized case and local access context.');
    return sequence;
  };
  const first = queryCursor === undefined ? undefined : decode(queryCursor,true);
  const last = lastEventId === undefined ? undefined : decode(lastEventId,false);
  if (first !== undefined && last !== undefined && last < first)
    throw new AppError(409, 'INGESTION_CURSOR_CONFLICT', 'Last-Event-ID cannot precede the first query cursor.');
  return last ?? first;
}

export async function appendCaseIngestionTx(client: PoolClient, caseId: string, change: CaseIngestionChange, subject?: string) {
  const binding = ingestionBinding(caseId, subject);
  caseId = binding.caseId;
  // A plain read avoids a new upload->case lock edge in fenced failure callbacks.
  const row = (await client.query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0];
  if (!row) notFound('Source case not found.');
  const body = CaseIngestionOutboxSchema.parse({version: CASE_INGESTION_VERSION, caseId, caseRevision: row.revision, change});
  return appendUspOutboxTx(client, binding.streamId, body);
}

type EventPage = {head: bigint; context: string; caseRevision: number; events: CaseIngestionEvent[]};
type ResyncReason = Exclude<CaseIngestionControl['reason'], 'connected' | 'context_changed' | 'duration_limit'>;
export class IngestionResync extends AppError {
  constructor(public reason: ResyncReason, public page: Pick<EventPage, 'head' | 'caseRevision'>, binding: IngestionBinding, cursor: bigint) {
    super(409, 'INGESTION_RESYNC', 'Refresh the current case records before opening a new stream.', {
      version: CASE_INGESTION_VERSION, caseId: binding.caseId, reason,
      cursor: ingestionCursor(binding, cursor), headCursor: ingestionCursor(binding, page.head), requiresRefresh: true,
    });
  }
}

const active = new Set<IngestionBinding>();
export function reserveIngestionReader(binding: IngestionBinding): () => void {
  if (active.size >= INGESTION_EVENT_LIMITS.connections
    || [...active].filter(item => item.subject === binding.subject).length >= INGESTION_EVENT_LIMITS.perOperator
    || [...active].filter(item => item.caseId === binding.caseId).length >= INGESTION_EVENT_LIMITS.perCase)
    throw new AppError(429, 'INGESTION_STREAM_LIMIT', 'The bounded local event reader allowance is occupied.');
  active.add(binding);
  return () => { active.delete(binding); };
}

export class CaseIngestionReader {
  readonly binding: IngestionBinding;
  private reads = 0;
  constructor(caseId: string) { this.binding = ingestionBinding(z.string().uuid().parse(caseId)); }

  /** Short, indexed, consistent reads; no DB connection survives a page or poll. */
  async read(cursor: bigint | undefined, signal: AbortSignal): Promise<EventPage> {
    assertIngestionBinding(this.binding);
    signal.throwIfAborted();
    if (++this.reads > INGESTION_EVENT_LIMITS.reads) throw new AppError(503, 'INGESTION_READ_LIMIT', 'Reconnect after refreshing current records.');
    const started = Date.now(), client = await pool().connect();
    let released = false;
    const cancel = () => { if (!released) { released = true; client.release(true); } };
    const timer = setTimeout(cancel, Math.max(1, INGESTION_EVENT_LIMITS.readMs - (Date.now() - started)));
    signal.addEventListener('abort', cancel, {once: true});
    try {
      signal.throwIfAborted();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='2000ms'; SET LOCAL lock_timeout='500ms'; SET LOCAL idle_in_transaction_session_timeout='4000ms'");
      const row = (await client.query(`SELECT revision,archived,site_id,current_snapshot_id,updated_at,
        md5(frame::text) frame_hash,md5(context::text) context_hash,
        EXISTS(SELECT 1 FROM registry_case_feature_mappings WHERE case_id=$1) mapped,
        EXISTS(SELECT 1 FROM import_packages WHERE case_id=$1) packaged FROM cases WHERE id=$1`, [this.binding.caseId])).rows[0];
      if (!row) notFound('Source case not found.');
      if (row.archived) throw new AppError(403, 'INGESTION_CASE_ARCHIVED', 'The source case is archived.');
      const pins = (await client.query(`SELECT id,family_id,revision,md5(sha256) hash,md5(status) status_hash,
        md5(profile) profile_hash,bytes,md5(object_key) object_hash
        FROM sources WHERE case_id=$1 ORDER BY family_id,revision LIMIT $2`, [this.binding.caseId, INGESTION_EVENT_LIMITS.sources + 1])).rows;
      if (pins.length > INGESTION_EVENT_LIMITS.sources) throw new AppError(422, 'INGESTION_CONTEXT_LIMIT', 'This local stream supports at most 256 retained source revisions per case.');
      const head = BigInt((await client.query('SELECT last_sequence::text sequence FROM usp_outbox_streams WHERE stream_id=$1', [this.binding.streamId])).rows[0]?.sequence ?? '0');
      const start = cursor ?? head, page = {head, caseRevision: row.revision as number};
      if (start > head) throw new IngestionResync('cursor_out_of_range', page, this.binding, start);
      if (head - start > BigInt(INGESTION_EVENT_LIMITS.replay)) throw new IngestionResync('replay_limit', page, this.binding, start);
      const rows = (await client.query(`SELECT sequence::text,created_at,
        CASE WHEN octet_length(body::text)<=$4 THEN body ELSE NULL END body
        FROM usp_outbox WHERE stream_id=$1 AND sequence>$2 ORDER BY usp_outbox.sequence LIMIT $3`,
      [this.binding.streamId, start.toString(), INGESTION_EVENT_LIMITS.page, INGESTION_EVENT_LIMITS.eventBytes])).rows;
      const events: CaseIngestionEvent[] = [];
      for (const item of rows) {
        const parsed = CaseIngestionOutboxSchema.safeParse(item.body);
        if (BigInt(item.sequence) !== start + BigInt(events.length + 1) || !parsed.success || parsed.data.caseId !== this.binding.caseId)
          throw new IngestionResync('event_gap', page, this.binding, start);
        events.push(CaseIngestionEventSchema.parse({...parsed.data, sequence: item.sequence,
          createdAt: new Date(item.created_at).toISOString(), requiresRefresh: true}));
      }
      if (!events.length && start < head) throw new IngestionResync('event_gap', page, this.binding, start);
      await client.query('COMMIT');
      assertIngestionBinding(this.binding); signal.throwIfAborted();
      return {...page, context: fingerprint({row: {...row, updated_at: new Date(row.updated_at).toISOString()}, pins}), events};
    } catch (error) {
      if (!released) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (!released) client.release();
    }
  }
}
