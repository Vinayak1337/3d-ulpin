import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { UspSnapshotManifestSchema, type RequestContext } from '../../../../../contracts/src/usp';
import { UspPacketPlanConfirmationSchema, UspPacketPlanEntrySchema, UspPacketPlanExecutionSchema,
  UspPacketPlanInputSchema, UspPacketPlanSchema } from '../../../../../contracts/src/usp/packets';
import { UspPacket0ReceiptSchema } from '../../../../../contracts/src/usp/packet0';
import type { PropertyCard } from '../../../../../contracts/src/usp/property-card';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { renderPacket0 } from '../packet0';
import { localRequestContext } from '../principal';
import type { PropertyCardIo } from './card-service';

// A controlled store of one already executed text/CSV plan, as in tests/usp-property-card.test.ts. Its protocol
// values qualify access and linkage behaviour only; none of them is an operational property fact.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const siteId = uuid(1), sourceId = uuid(2), caseId = uuid(3), targetId = uuid(5), packetId = uuid(7);
export const manifestId = uuid(4);
export const planId = uuid(6);
const OPERATOR = 'card-verification-protocol';
const pin = <N extends string>(namespace: N, id: string) => ({ ref: { namespace, id }, revision: 1 });
const target = pin('registry_record', targetId);
const original = Buffer.from('CONTROL-A,recorded card verification protocol\r\n');
const excerpt = original.toString().trimEnd();
const pointer = { sourceRevision: pin('source_revision', sourceId), assetRevision: null, partRevision: null,
  locator: { kind: 'verbatim' as const, locator: 'CSV row 1' }, purpose: 'record' as const,
  origin: 'direct' as const, target: target.ref };
const scope = { kind: 'snapshot' as const, scopeId: siteId, manifestId, snapshotDigest: 'a'.repeat(64),
  world: { namespace: 'world', id: `registry-site/${siteId}` }, stage: 'recorded' as const };
const source = { id: sourceId, revision: 1, case_id: caseId, sha256: sha256(original), bytes: original.length,
  object_key: 'control-original', profile: 'csv-reference-v2',
  inspection: { referenceParts: [{ locator: 'CSV row 1', text: excerpt }] } };
const captured = { id: targetId, revision: 1, site_id: siteId, identifier: 'CONTROL-A', kind: 'space',
  body: { name: 'Technical protocol record A' }, projectIdentity: null };

export type CardRow = {
  id: string; revision: number; site_id: string; manifest_id: string; plan_id: string; plan_version: number;
  packet_id: string; subject: string; artifact_hash: string; object_key: string; body: PropertyCard;
};
type Values = readonly any[];
type Handler = (values: Values, sql: string) => unknown[];

export class CardStore {
  cards: CardRow[] = [];
  receipts: any[] = [];
  events: unknown[] = [];
  objects = new Map<string, Uint8Array>();
  writes = 0;
  puts = 0;
  expired = false;
  currentRevision = 1;
  private active = 0;
  private sequence = 0;
  private readonly plan;
  private readonly confirmation;
  private readonly execution;
  private readonly packet;

  constructor(private readonly ctx: RequestContext) {
    const expiresAt = new Date(Date.now() + 3600000).toISOString(), now = new Date().toISOString();
    const input = UspPacketPlanInputSchema.parse({ target, scope, purpose: 'record_evidence', format: 'csv',
      recipe: 'pack0-exact-text-csv/1', expiresAt, entries: [{ pointer, required: true,
        inclusionReason: 'Reviewed protocol literal', review: { kind: 'direct', reviewed: true } }] });
    const entryBody = { selection: input.entries[0], sourceSha256: source.sha256, sourceBytes: original.length,
      sourceBodySha256: fingerprint(source), evidenceSha256: fingerprint(pointer), excerptSha256: sha256(excerpt),
      targetPath: [target], applicabilitySha256: null, state: 'included', reasonCode: null };
    const entry = UspPacketPlanEntrySchema.parse({ ...entryBody, entrySha256: fingerprint(entryBody) });
    const planBody = { planId, version: 1, previousVersion: null, input, creator: ctx.principal,
      accessViewId: ctx.accessViewId, policyVersion: ctx.policyVersion, targetBodySha256: fingerprint(captured),
      targetLabel: captured.body.name, entries: [entry], requiredContext: 'available', createdAt: now };
    this.plan = UspPacketPlanSchema.parse({ ...planBody, planSha256: fingerprint(planBody) });
    this.confirmation = UspPacketPlanConfirmationSchema.parse({ confirmationId: uuid(8), planId, version: 1,
      planSha256: this.plan.planSha256, reviewer: ctx.principal, reviewed: true, confirmedAt: now });
    const bytes = Buffer.from(renderPacket0({ id: targetId, label: this.plan.targetLabel },
      [{ pointer, sourceSha256: source.sha256, excerpt, reasonCode: null }], 'csv'));
    this.packet = UspPacket0ReceiptSchema.parse({ packetId, target, scope, format: 'csv',
      artifact: { assetId: packetId, version: 1, sha256: sha256(bytes) }, included: [pointer], unavailable: [],
      contentType: 'text/csv; charset=utf-8', createdAt: now, status: 'complete', commandSha256: 'b'.repeat(64) });
    this.execution = UspPacketPlanExecutionSchema.parse({ planId, version: 1,
      confirmationId: this.confirmation.confirmationId, packet: this.packet, omissions: [] });
    this.objects.set('control-packet', bytes);
  }

  /** Replaces one stored card row, which the immutability trigger refuses on a real database. */
  alter(revision: number, change: (row: CardRow) => CardRow | null) {
    this.cards = this.cards.flatMap(row => row.revision === revision ? change(row) ?? [] : row);
  }

  readonly io: PropertyCardIo = {
    readPacket: async key => this.object(key),
    readCard: async key => this.object(key),
    put: async (key, bytes) => {
      assert.equal(this.active, 0, 'object writes hold no SQL connection');
      this.puts++;
      this.objects.set(key, Buffer.from(bytes));
    },
  };

  private object(key: string) {
    assert.equal(this.active, 0, 'object reads hold no SQL connection');
    const bytes = this.objects.get(key);
    // The object store answers a missing key with an HTTP 404 in its error metadata.
    if (!bytes) throw Object.assign(new Error('NoSuchKey'), { $metadata: { httpStatusCode: 404 } });
    return bytes;
  }

  private manifest() {
    const members = [{ pin: pin('source_revision', sourceId), body: source, authority: 'source' },
      { pin: target, body: captured, authority: 'registry' }].map(member => ({ pin: member.pin,
      bodySha256: fingerprint(member.body), authority: member.authority,
      bodyRef: fingerprint([member.pin.ref.namespace, member.pin.ref.id, member.pin.revision, member.body]) }))
      .sort((a, b) => `${a.pin.ref.namespace}:${a.pin.ref.id}`.localeCompare(`${b.pin.ref.namespace}:${b.pin.ref.id}`));
    return UspSnapshotManifestSchema.parse({ schemaVersion: 'usp/1', id: manifestId, digest: scope.snapshotDigest,
      scope, capturedAt: '2026-10-02T00:00:00.000Z', selection: { kind: 'targets', pins: [target] }, members,
      frame: { horizontal: null, vertical: null, unit: null, transform: null },
      accessViewId: this.ctx.accessViewId, policyVersion: this.ctx.policyVersion, validAt: null, asOf: null,
      coverage: { state: 'complete', reasonCodes: [] } });
  }

  private snapshotBody(values: Values, sql: string) {
    const quoted = sql.includes("namespace='source_revision'");
    const namespace = quoted ? 'source_revision' : values[1], id = quoted ? values[1] : values[2];
    if (namespace === 'source_revision' && id === sourceId) return [{ body: source, body_sha256: fingerprint(source) }];
    if (namespace === 'registry_record' && id === targetId)
      return [{ body: captured, body_sha256: fingerprint(captured) }];
    return [];
  }

  private readonly reads: [string, Handler][] = [
    ['SELECT id FROM cases WHERE id=ANY', () => [{ id: caseId }]],
    ['SELECT id FROM registry_sites', () => [{ id: siteId }]],
    ['SELECT id FROM sources WHERE id=ANY', () => [{ id: sourceId }]],
    ['SELECT body FROM usp_snapshots', () => [{ body: this.manifest() }]],
    ['SELECT body,body_sha256 FROM usp_snapshot_bodies', (values, sql) => this.snapshotBody(values, sql)],
    ['SELECT * FROM sources', values => values[0] === sourceId ? [source] : []],
    ['SELECT site_id,archived FROM cases', () => [{ site_id: siteId, archived: false }]],
    ['SELECT body FROM usp_packet_plans', values =>
      values[0] === planId && values[1] === 1 ? [{ body: this.plan }] : []],
    ['SELECT body FROM usp_packet_plan_confirmations', () => [{ body: this.confirmation }]],
    ['SELECT body FROM usp_packet_plan_executions', () => [{ body: this.execution }]],
    ['SELECT body,object_key,artifact_hash FROM usp_packets', () => [{ body: this.packet,
      object_key: 'control-packet', artifact_hash: this.packet.artifact.sha256 }]],
    ['SELECT clock_timestamp()', values => [{ live: !this.expired && Date.parse(values[0]) > Date.now() }]],
    ['SELECT max(revision)', values => [{ revision: Math.max(...this.cardsOf(values[0]).map(row => row.revision)) }]],
    ['SELECT revision,body,object_key,artifact_hash FROM usp_property_cards', values =>
      this.cardsOf(values[0]).filter(row => row.revision < values[1]).sort((a, b) => a.revision - b.revision)],
    ['SELECT command_sha256,body FROM usp_command_receipts', values => this.receipts.filter(row =>
      row.subject === values[0] && row.scope_key === values[1] && row.operation === values[2]
      && row.request_key === values[3])],
  ];

  private cardsOf(cardId: string) {
    return this.cards.filter(row => row.id === cardId);
  }

  private write(sql: string, values: Values) {
    this.writes++;
    if (sql.startsWith('INSERT INTO usp_property_cards')) {
      const [id, revision, site_id, manifest_id, plan_id, plan_version, packet_id, subject, artifact_hash, object_key,
        body] = values;
      this.cards.push({ id, revision, site_id, manifest_id, plan_id, plan_version, packet_id, subject, artifact_hash,
        object_key, body: structuredClone(body) });
    } else if (sql.startsWith('INSERT INTO usp_command_receipts')) {
      this.receipts.push({ subject: values[1], scope_key: values[2], operation: values[3], request_key: values[4],
        command_sha256: values[5], body: structuredClone(values[6]) });
    } else if (sql.startsWith('INSERT INTO usp_outbox(')) this.events.push(values[2]);
    else if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: String(++this.sequence) }];
    else if (!sql.startsWith('INSERT INTO usp_outbox_streams')) throw new Error(`Unmodelled write: ${sql}`);
    return [];
  }

  private rows(text: string, values: Values): unknown[] {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return [];
    if (/^(INSERT|UPDATE)/.test(sql)) return this.write(sql, values);
    if (sql.includes('FROM registry_records')) {
      const selected = values[0] === targetId && values[1] === siteId;
      return selected ? [{ ...captured, revision: this.currentRevision, project_status: 'assigned' }] : [];
    }
    if (sql.includes('FROM usp_property_cards WHERE id=$1 AND revision=$2'))
      return this.cardsOf(values[0]).filter(row => row.revision === values[1]);
    const read = this.reads.find(([prefix]) => sql.startsWith(prefix));
    if (!read) throw new Error(`Unmodelled SQL: ${sql}`);
    return read[1](values, sql);
  }

  private async query(text: string, values: Values = []) {
    const rows = this.rows(text, values);
    return { rows, rowCount: rows.length };
  }

  readonly pool = {
    query: (text: string, values?: Values) => this.query(text, values),
    connect: async () => {
      assert.equal(this.active, 0, 'one SQL connection at a time');
      this.active++;
      return { query: (text: string, values?: Values) => this.query(text, values),
        release: () => { this.active--; } } as unknown as PoolClient;
    },
  } as unknown as Pool;
}

/** Runs one scenario as the configured local operator against a fresh store installed as the process pool. */
export async function withCardStore(work: (store: CardStore, ctx: RequestContext) => Promise<void>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = { pool: globals.ulpinPool, subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = OPERATOR;
  try {
    const ctx = localRequestContext('card-verification-control'), store = new CardStore(ctx);
    globals.ulpinPool = store.pool;
    await work(store, ctx);
  } finally {
    globals.ulpinPool = previous.pool;
    if (previous.subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous.subject;
  }
}
