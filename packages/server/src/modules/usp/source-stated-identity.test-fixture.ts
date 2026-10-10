import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SourceSpaceRequest } from '@ulpin/contracts';
import { fingerprint } from '../cases/domain';
import { commandSourceSpace } from '../officer/source-spaces';
import { SourceSpaceControl, retainedTower, towerRequest } from '../officer/source-spaces.test-fixture';
import { localRequestContext } from './principal';
import { prepareProjectIdentityReview } from './project-identity';
import { captureRegistrySnapshot } from './snapshots';

const pins = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/tower3-source-import.json', 'utf8')).documentPins;
const sizes = [3782332, 1655334, 2448909, 1630108];
const frame = JSON.parse(readFileSync('docs/evidence/gf1/k4a/site-readiness.json', 'utf8')).sites[1].frame;

/** Existing SQL protocol in memory. Original hashes/byte counts are retained; no persisted allocation or object I/O. */
export class SourceIdentityControl {
  snapshots = new Map<string, any>();
  captured = new Map<string, any[]>();
  reviews = new Map<string, any>();
  receipts = new Map<string, any>();
  codes = new Map<string, any>();
  identities = new Map<string, any>();
  audit: any[] = [];
  plans = new Map<string, any>();
  queries: string[] = [];
  sequence = 0;
  archived = false;
  checkpoint: any;
  sources: any[];
  constructor(readonly db: SourceSpaceControl) {
    const caseId = randomUUID();
    this.sources = pins.map((pin: any, index: number) => ({ id: pin.sourceId, case_id: caseId, family_id: randomUUID(),
      revision: pin.sourceRevision, sha256: pin.sourceSha256, bytes: sizes[index],
      object_key: `memory-only-no-object-read/${index}`, inspection: { documentOriginal: {
        version: 'source-document/1', subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
        format: 'pdf', sha256: pin.sourceSha256, bytes: sizes[index], receivedAt: '2026-10-10T00:00:00Z',
      } } }));
  }
  private result(rows: any[] = []) { return { rows, rowCount: rows.length }; }
  private snapshotReads(q: string, v: any[]) {
    if (q.startsWith('SELECT * FROM registry_sites')) return this.result([{ id: retainedTower.areaId,
      revision: this.db.siteRevision, frame }]);
    if (q.startsWith('SELECT r.*,c.')) return this.result(this.db.rows
      .filter(row => !q.includes('r.id=$1') || row.id === v[0]).map(row => ({ ...row,
      project_code: this.codes.get(row.id)?.code ?? null, project_status: this.codes.get(row.id)?.status ?? null,
      project_location: this.identities.get(row.id)?.location ?? null })));
    if (q.startsWith('SELECT s.* FROM sources')) return this.result(this.sources);
    if (q.startsWith('SELECT f.id,f.area_id')) return this.result([this.db.feature]);
    if (q.startsWith('SELECT case_id,body')) return this.result();
    if (q.startsWith('SELECT pin.value AS pin')) return this.result(pins.map((pin: any) => ({ pin })));
    if (q.startsWith('SELECT predecessor_id') || q.startsWith('SELECT record_id,alias')
      || q.startsWith('SELECT DISTINCT ON')) return this.result();
    return null;
  }
  private sourceReads(q: string, v: any[]) {
    if (q.startsWith('SELECT case_id FROM sources')) {
      return this.result(this.sources.filter(source => source.id === v[0]));
    }
    if (q.startsWith('SELECT * FROM sources')) {
      return this.result(this.sources.filter(source => source.id === v.at(-1)));
    }
    if (q.startsWith('SELECT id,revision,archived')) return this.result([{ id: v[0], revision: 1,
      archived: this.archived, frame, context: {}, site_id: retainedTower.areaId }]);
    if (q.startsWith('SELECT archived FROM cases')) return this.result([{ archived: this.archived }]);
    if (q.startsWith('SELECT max(revision)')) return this.result([{ revision: this.sources.find(
      source => source.family_id === v[1])?.revision }]);
    if (q.startsWith('SELECT id FROM cases')) return this.result([{ id: v[0] }]);
    return null;
  }
  private identityReads(q: string, v: any[]) {
    if (q.startsWith('SELECT body FROM usp_snapshots')) return this.result(this.snapshots.has(v[0])
      ? [{ body: this.snapshots.get(v[0]) }] : []);
    if (q.includes('FROM usp_snapshot_bodies')) {
      let rows = this.captured.get(v[0]) ?? [];
      const ns = q.match(/namespace='([^']+)'/)?.[1];
      if (ns) rows = rows.filter(row => row.namespace === ns);
      else if (q.includes('namespace=$2')) rows = rows.filter(row => row.namespace === v[1]
        && row.object_id === v[2] && row.revision === v[3]);
      if (q.includes('object_id=$2')) rows = rows.filter(row => row.object_id === v[1] && row.revision === v[2]);
      return this.result(rows);
    }
    if (q.startsWith('SELECT id,site_id,kind,revision,body')
      || q.startsWith('SELECT id,revision FROM registry_records')) {
      const ids = v[0];
      return this.result(this.db.rows.filter(row => ids.includes(row.id)).map(row => ({ ...row })));
    }
    if (q.startsWith('SELECT * FROM usp_project_identity_reviews')) return this.result(this.reviews.has(v[0])
      ? [this.reviews.get(v[0])] : []);
    if (q.startsWith('SELECT 1 FROM usp_project_codes')) return this.result(this.codes.has(v[0]) ? [{}] : []);
    if (q.startsWith('SELECT command_sha256,body')) return this.result(this.receipts.has(v[3])
      ? [this.receipts.get(v[3])] : []);
    if (q.startsWith('SELECT c.record_id,c.code')) return this.result([...this.codes.values()].map(code => ({ ...code,
      revision: this.db.rows.find(row => row.id === code.record_id)?.revision,
      version: this.identities.get(code.record_id)?.version,
      reviewer_subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT })));
    return null;
  }
  private identityWrites(q: string, v: any[]) {
    if (q.startsWith('INSERT INTO usp_snapshots')) this.snapshots.set(v[0], structuredClone(v[3]));
    else if (q.startsWith('INSERT INTO usp_snapshot_bodies')) {
      const rows = this.captured.get(v[0]) ?? [];
      rows.push({ namespace: v[1], object_id: v[2], revision: v[3], body_sha256: v[4], body: structuredClone(v[5]) });
      this.captured.set(v[0], rows);
    } else if (q.startsWith('INSERT INTO usp_packet_plans')) this.plans.set(`${v[0]}:${v[1]}`, structuredClone(v[5]));
    else if (q.startsWith('INSERT INTO usp_project_identity_reviews')) this.reviews.set(v[0], {
      id: v[0], scope_id: v[1], manifest_id: v[2], operation: v[3], command_hash: v[4],
      reviewer_subject: v[5], body: v[6] });
    else if (q.startsWith('INSERT INTO usp_project_codes')) this.codes.set(v[1], {
      code: v[0], record_id: v[1], scope_id: v[2], status: 'assigned', review_id: v[3] });
    else if (q.startsWith('INSERT INTO usp_project_identity_state')) this.identities.set(v[0], {
      location: v[1], review_id: v[2], version: v[3] });
    else if (q.startsWith('INSERT INTO usp_project_identity_audit')) this.audit.push(v[6]);
    else if (q.startsWith('INSERT INTO usp_command_receipts')) this.receipts.set(v[4], {
      command_sha256: v[5], body: v[6] });
    else if (q.startsWith('UPDATE usp_project_identity_reviews')) this.reviews.get(v[0]).consumed_at = true;
    else if (q.startsWith('UPDATE registry_records SET revision=$2 WHERE')) this.db.rows.find(row => row.id === v[0])
      .revision = v[1];
    else if (q.startsWith('UPDATE usp_outbox_streams')) return this.result([{ sequence: String(++this.sequence) }]);
    else if (q.startsWith('INSERT INTO usp_outbox')) { /* Existing event authority, not a competing outbox. */ }
    else return null;
    return this.result();
  }
  private packetReads(q: string, v: any[]) {
    if (q.startsWith("SELECT set_config('statement_timeout'")) return this.result([{ deadline_live: true }]);
    if (q.startsWith('SELECT id,site_id,revision,archived FROM cases')) return this.result([{ id: v[0],
      site_id: retainedTower.areaId, revision: 1, archived: this.archived }]);
    if (q.startsWith('SELECT id,case_id,inspection FROM sources')) {
      return this.result(this.sources.filter(source => source.id === v[0]));
    }
    if (q.startsWith('SELECT body FROM usp_packet_plans')) {
      const plan = this.plans.get(`${v[0]}:${v[1]}`);
      return this.result(plan ? [{ body: plan }] : []);
    }
    if (q.startsWith('SELECT max(version)')) return this.result([{ version: Math.max(
      ...[...this.plans.values()].filter(plan => plan.planId === v[0]).map(plan => plan.version)) }]);
    if (q.startsWith('SELECT body FROM usp_packet_plan_')) return this.result();
    if (q.startsWith('SELECT clock_timestamp()')) return this.result([{ live: true }]);
    if (q.startsWith('SELECT body FROM registry_revisions')) {
      return this.result(this.db.histories.filter(row => row.id === v[0] && row.revision === v[1]));
    }
    if (q.startsWith('SELECT alias FROM registry_aliases') || q.startsWith('SELECT successor_id')) return this.result();
    if (q.startsWith('SELECT revision FROM cases')) return this.result([{ revision: 1 }]);
    return null;
  }
  private boundary(q: string) {
    if (q.startsWith('BEGIN')) this.checkpoint = structuredClone({ sources: this.sources, snapshots: this.snapshots,
      captured: this.captured, reviews: this.reviews, receipts: this.receipts, codes: this.codes,
      identities: this.identities, audit: this.audit, sequence: this.sequence,
      rows: this.db.rows, histories: this.db.histories, siteRevision: this.db.siteRevision });
    if (q === 'ROLLBACK' && this.checkpoint) {
      const { rows, histories, siteRevision, ...state } = this.checkpoint;
      Object.assign(this, state);
      Object.assign(this.db, { rows, histories, siteRevision });
    }
    if (q.startsWith('BEGIN') || ['COMMIT', 'ROLLBACK'].includes(q) || /^(SET |SAVEPOINT|RELEASE |ROLLBACK TO)/.test(q)
      || q.startsWith('SELECT pg_advisory')) return this.result();
    return null;
  }
  async query(sql: string, values: any[] = []): Promise<any> {
    const q = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(q);
    const own = this.boundary(q) ?? this.snapshotReads(q, values) ?? this.sourceReads(q, values)
      ?? this.identityReads(q, values) ?? this.identityWrites(q, values) ?? this.packetReads(q, values);
    return own ?? this.db.query(sql, values);
  }
  readonly pool = { connect: async () => ({ query: this.query.bind(this), release() {} }),
    query: this.query.bind(this) };
  assertSourceIntegrity() {
    return this.sources.every(source => source.sha256
      === pins.find((pin: any) => pin.sourceId === source.id).sourceSha256);
  }
}

const globals = globalThis as unknown as { ulpinPool?: unknown };
export const location = { anchorState: 'not_supplied' as const, parcels: [], locator: {
  structureKind: '?' as const, structureNumber: 1, levels: ['L?'], spaceKind: '?' as const, spaceNumber: 1 } };
export const errorCode = (code: string) => (error: any) => error.code === code;

async function fixture(request: SourceSpaceRequest) {
  const db = new SourceSpaceControl();
  const recorded = await commandSourceSpace(retainedTower.buildingId, request, db.deps);
  const memory = new SourceIdentityControl(db);
  const ctx = localRequestContext(randomUUID());
  const capture = async () => captureRegistrySnapshot(ctx, retainedTower.areaId, { kind: 'targets', pins: [{
    ref: { namespace: 'registry_record', id: recorded.spaceId },
    revision: db.rows.find(row => row.id === recorded.spaceId).revision,
  }] });
  return { db, memory, ctx, recorded, capture, request };
}
export type SourceFixture = Awaited<ReturnType<typeof fixture>>;

export async function control(work: (f: SourceFixture) => Promise<void>, request: SourceSpaceRequest = towerRequest) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const pool = globals.ulpinPool;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k4b-offline-protocol-control';
  try { const f = await fixture(request); globals.ulpinPool = f.memory.pool; await work(f); }
  finally {
    globals.ulpinPool = pool;
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

export async function prepare(f: SourceFixture) {
  const snapshot = await f.capture();
  const review = { operation: 'assign' as const, scope: snapshot.scope, recordIds: [f.recorded.spaceId],
    expectedVersions: { [f.recorded.spaceId]: 1 }, reason: f.request.reason,
    evidence: [{ sourceId: f.request.space.evidence.sourceId, revision: 1,
      locator: f.db.rows.find(row => row.id === f.recorded.spaceId).body.evidence[0].locator }], location };
  const prepared = await prepareProjectIdentityReview(f.ctx, review as any);
  return { review, snapshot, command: { scope: snapshot.scope, expectedManifestId: snapshot.id,
    reviewId: prepared.reviewId, requestKey: randomUUID(), recordId: f.recorded.spaceId, expectedRecordVersion: 1 } };
}
