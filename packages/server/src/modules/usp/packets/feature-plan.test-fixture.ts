import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { UspSnapshotManifestSchema, type RequestContext } from '../../../../../contracts/src/usp';
import { UspTextPacketPlanInputSchema } from '../../../../../contracts/src/usp/packets';
import { fingerprint } from '../../cases/domain';
import { sha256 } from '../../../infrastructure/storage';
import { withCardStore, type CardStore } from './card-verification.test-fixture';
import type { PacketPlanIo } from './plan-service';

// Exact original feature data with memory-only protocol identities; no normalization/placement qualification.
export const originalPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
export const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const pin = (namespace: string, index: number) => ({ ref: { namespace, id: uuid(index) }, revision: 1 });
type Values = any[];
type Stored = { id: string; version: number; body: any };

export class FeaturePlanStore {
  original = readFileSync(originalPath);
  source = { id: uuid(2), revision: 1, case_id: uuid(3), name: 'buildings-original.geojson',
    sha256: sha256(this.original), bytes: this.original.length, object_key: 'memory-native-original',
    profile: 'geojson-area-v2', status: 'inspected', inspection: { status: 'interpreted', referenceParts: [] } };
  record: any;
  features: any[];
  plans: Stored[] = [];
  confirmations: any[] = [];
  executions: any[] = [];
  packets: any[] = [];
  queries: string[] = [];
  originalReads = 0;
  scope = { kind: 'snapshot' as const, scopeId: uuid(1), manifestId: uuid(4), snapshotDigest: 'a'.repeat(64),
    world: { namespace: 'world', id: `registry-site/${uuid(1)}` }, stage: 'recorded' as const };
  target = pin('registry_record', 5);
  pointer: any;

  constructor(readonly cards: CardStore, readonly ctx: RequestContext, index: number) {
    const feature = JSON.parse(this.original.toString()).features[index];
    const key = feature.properties.doitt_id;
    const properties = Object.fromEntries(['doitt_id', 'height_roof', 'bin', 'base_bbl']
      .filter(name => Object.hasOwn(feature.properties, name)).map(name => [name, feature.properties[name]]));
    this.record = { id: uuid(5), site_id: uuid(1), revision: 1, kind: 'building', identifier: 'MEMORY-BUILDING',
      body: { name: `Building ${key}`, evidence: [{ sourceId: uuid(2), locator: `feature ${key}` }], rights: [] },
      project_code: null, project_status: null, project_location: null, projectIdentity: null, historicalAliases: [] };
    this.features = [{ id: uuid(9), record_id: uuid(5), revision: 1, body: { sourceRevisionId: uuid(2),
      sourceKey: key, sourceFeatureIndex: index, properties, kind: 'building' } }];
    this.pointer = { sourceRevision: pin('source_revision', 2), assetRevision: null, partRevision: null,
      locator: { kind: 'verbatim', locator: `feature ${key}` }, legacyLocator: `feature ${key}`,
      purpose: 'record', origin: 'direct', target: this.target.ref };
  }

  input() {
    return UspTextPacketPlanInputSchema.parse({ target: this.target, scope: this.scope, purpose: 'record_evidence',
      format: 'csv', recipe: 'pack0-exact-text-csv/1', expiresAt: new Date(Date.now() + 3600000).toISOString(),
      entries: [{ pointer: this.pointer, required: true, inclusionReason: 'Reviewed original native feature',
        review: { kind: 'direct', reviewed: true } }] });
  }

  private bodies() {
    return [{ pin: this.target, body: this.record, authority: 'registry' },
      { pin: pin('source_revision', 2), body: this.source, authority: 'source' },
      ...this.features.map(body => ({ pin: { ref: { namespace: 'area_feature', id: body.id }, revision: body.revision },
        body, authority: 'area_feature' }))];
  }

  manifest() {
    const members = this.bodies().map(member => ({ pin: member.pin, bodySha256: fingerprint(member.body),
      bodyRef: fingerprint([member.pin.ref.namespace, member.pin.ref.id, member.pin.revision, member.body]),
      authority: member.authority })).sort((left, right) => {
      const key = (item: typeof left) => `${item.pin.ref.namespace}:${item.pin.ref.id}@${item.pin.revision}`;
      return key(left) < key(right) ? -1 : 1;
    });
    return UspSnapshotManifestSchema.parse({ schemaVersion: 'usp/1', id: uuid(4), digest: this.scope.snapshotDigest,
      scope: this.scope, capturedAt: '2026-10-02T00:00:00.000Z', selection: { kind: 'targets', pins: [this.target] },
      members, frame: { horizontal: null, vertical: null, unit: null, transform: null },
      accessViewId: this.ctx.accessViewId, policyVersion: this.ctx.policyVersion, validAt: null, asOf: null,
      coverage: { state: 'complete', reasonCodes: [] } });
  }

  private captured(values: Values, sql: string) {
    const quoted = sql.includes("namespace='source_revision'");
    const namespace = quoted ? 'source_revision' : values[1];
    const id = quoted ? values[1] : values[2];
    const body = this.bodies().find(item => item.pin.ref.namespace === namespace && item.pin.ref.id === id)?.body;
    return body ? [{ body, body_sha256: fingerprint(body) }] : [];
  }

  private rows(sql: string, values: Values): any[] | null {
    if (sql.startsWith('WITH RECURSIVE evidence_sources')) return [{ id: this.source.case_id }];
    if (sql.startsWith('SELECT body FROM usp_snapshots')) return [{ body: this.manifest() }];
    if (sql.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies')) return this.captured(values, sql);
    if (sql.startsWith('SELECT * FROM sources')) return values[0] === this.source.id ? [this.source] : [];
    if (sql.startsWith('SELECT r.id,r.revision')) return [this.record];
    if (sql.includes('FROM registry_records')) return [this.record];
    if (sql.startsWith('SELECT alias FROM registry_aliases')) return [];
    if (sql.startsWith('SELECT successor_id FROM usp_project_lineage')) return [];
    if (sql.startsWith("SELECT body->'parts'")) return [];
    if (sql.startsWith('SELECT body FROM usp_packet_plans'))
      return this.plans.filter(row => row.id === values[0] && row.version === values[1]);
    if (sql.startsWith('SELECT max(version)')) return [{ version: Math.max(...this.plans.map(row => row.version)) }];
    if (sql.startsWith('SELECT body FROM usp_packet_plan_confirmations')) return this.confirmations;
    if (sql.startsWith('SELECT body FROM usp_packet_plan_executions')) return this.executions;
    if (sql.startsWith('SELECT body,object_key,artifact_hash FROM usp_packets')) return this.packets;
    return this.write(sql, values);
  }

  private write(sql: string, values: Values): any[] | null {
    if (sql.startsWith('INSERT INTO usp_packet_plans'))
      this.plans.push({ id: values[0], version: values[1], body: structuredClone(values[5]) });
    else if (sql.startsWith('INSERT INTO usp_packet_plan_confirmations'))
      this.confirmations.push({ body: structuredClone(values[4]) });
    else if (sql.startsWith('INSERT INTO usp_packet_plan_executions'))
      this.executions.push({ body: structuredClone(values[4]) });
    else if (sql.startsWith('INSERT INTO usp_packets'))
      this.packets.push({ body: structuredClone(values[6]), object_key: values[5], artifact_hash: values[4] });
    else return null;
    return [];
  }

  private async query(sql: string, values: Values, fallback: () => Promise<any>) {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(text);
    assert(!text.includes('FROM physical_features'), 'selection never substitutes a live observation');
    const rows = this.rows(text, values);
    return rows === null ? fallback() : { rows, rowCount: rows.length };
  }

  pool(): Pool {
    const base = this.cards.pool;
    return { query: (sql: string, values: Values = []) =>
      this.query(sql, values, () => base.query(sql, values)), connect: async () => {
      const client = await base.connect();
      return { release: () => client.release(), query: (sql: string, values: Values = []) =>
        this.query(sql, values, () => client.query(sql, values)) } as unknown as PoolClient;
    } } as unknown as Pool;
  }

  io: PacketPlanIo = {
    read: async key => {
      if (key === this.source.object_key) {
        this.originalReads++;
        return this.original;
      }
      return this.cards.io.readPacket(key);
    },
    put: async (key, bytes) => { this.cards.objects.set(key, Buffer.from(bytes)); },
  };
}

export async function withFeaturePlan(index: number, work: (store: FeaturePlanStore) => Promise<void>) {
  await withCardStore(async (cards, ctx) => {
    const store = new FeaturePlanStore(cards, ctx, index);
    const globals = globalThis as unknown as { ulpinPool?: Pool };
    globals.ulpinPool = store.pool();
    await work(store);
  });
}
