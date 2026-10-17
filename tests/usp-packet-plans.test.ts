import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { UspSnapshotManifestSchema, UspDeclarationInputSchema, UspReviewDeclarationSchema,
  DECLARATION_ACKNOWLEDGEMENT, type RequestContext } from '../packages/contracts/src/usp';
import { UspPacketPlanInputSchema, type PacketPlan } from '../packages/contracts/src/usp/packets';
import { createPacketPlan, revisePacketPlan, readPacketPlan, confirmPacketPlan, executePacketPlan,
  type PacketPlanIo } from '../packages/server/src/modules/usp/packets/plan-service';
import { localRequestContext } from '../packages/server/src/modules/usp/principal';
import { canonical, fingerprint } from '../packages/server/src/modules/cases/domain';
import { renderPacket0, selectExactPart, readPacket0 } from '../packages/server/src/modules/usp/packet0';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { assessDeclaration } from '../packages/server/src/modules/usp/declarations/arithmetic';
import { readFile } from 'node:fs/promises';

// Isolated technical protocol records. They assert no real parcel, rights or property facts.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const siteId = uuid(1), sourceId = uuid(2), caseId = uuid(3), manifestId = uuid(4), targetId = uuid(5);
const pin = (namespace: string, id: string, revision = 1) => ({ ref: { namespace, id }, revision });
const target = pin('registry_record', targetId);
const original = Buffer.from('id,note\r\nCONTROL_A,"literal first line\nsecond line"\r\nCONTROL_B,NEVER_B\r\n');
const literal = 'CONTROL_A,"literal first line\nsecond line"';
const pointer = (locator: string) => ({ sourceRevision: pin('source_revision', sourceId),
  assetRevision: null, partRevision: null, locator: { kind: 'verbatim' as const, locator },
  purpose: 'record' as const, origin: 'direct' as const, target: target.ref, legacyLocator: locator });
type State = { plans: any[]; confirmations: any[]; executions: any[]; receipts: any[]; packets: any[]; events: any[]; streams: any[] };
class ControlDb {
  state: State = { plans: [], confirmations: [], executions: [], receipts: [], packets: [], events: [], streams: [] };
  queries: string[] = []; connects = 0; releases = 0; writes = 0; activeConnections = 0; maxConnections = 8;
  archived = false; expired = false; failEvent = false; wrongSite = false;
  extraSources: any[] = []; capturedExtraSources: any[] = [];
  caseLocks = new Set<string>(); archivedCases = new Set<string>(); pendingArchives = new Set<string>();
  afterCaseLock?: () => void;
  attemptArchive(id: string) {
    if (this.caseLocks.has(id)) { this.pendingArchives.add(id); return false; }
    this.commitArchive(id); return true;
  }
  commitArchive(id: string) { if (id === caseId) this.archived = true; else this.archivedCases.add(id); }
  source: any = { id: sourceId, revision: 1, case_id: caseId, sha256: sha256(original), bytes: original.length,
    object_key: 'technical-control-original', profile: 'csv-reference-v2', inspection: { referenceParts: [
      { locator: 'CSV row 2', text: literal }, { locator: 'CSV row 3', text: 'CONTROL_B,NEVER_B' },
    ] } };
  record: any = { id: targetId, site_id: siteId, revision: 1, kind: 'space', identifier: 'CONTROL-A',
    body: { name: 'Protocol control A', evidence: [{ sourceId, locator: 'CSV row 2' }, { sourceId, locator: 'CSV row 9' }] } };
  capturedSource = structuredClone(this.source); capturedRecord = { ...structuredClone(this.record),
    project_code: null, project_status: null, project_location: null, projectIdentity: null, historicalAliases: [] };
  scope = { kind: 'snapshot' as const, scopeId: siteId, world: { namespace: 'world', id: `registry-site/${siteId}` },
    manifestId, snapshotDigest: 'a'.repeat(64), stage: 'recorded' as const };
  sharedBodies: { namespace: string; body: any }[] = []; declarationRevision = 1;
  enableShared() {
    const declaration = pin('declaration', uuid(44)), entry = pin('declaration_entry', uuid(45)), applicability = pin('applicability', uuid(46));
    const validity = { from: '2026-01-01', to: null, endState: 'open_ended' };
    const evidence = { pointer: pointer('CSV row 2'), sha256: this.source.sha256, bytes: this.source.bytes };
    const instrument = { ...evidence, pointer: { ...evidence.pointer, target: declaration.ref } };
    const input = UspDeclarationInputSchema.parse({ jurisdiction: 'Technical protocol only', statute: null,
      allocationSubject: 'stated_other', subjectDefinition: 'Technical share control', basis: 'declared_value', basisDefinition: 'Technical control only',
      instrument, population: { status: 'complete', declaredCount: 1, targets: [target], evidence: instrument },
      denominator: { state: 'known', literal: '100% protocol control', quantity: null, unit: null, evidence: instrument },
      rounding: null, validity, entries: [{ pin: entry, target, literalLabel: 'Protocol A', literalShare: '100%',
        fraction: { numerator: '1', denominator: '1' }, evidence, validity }] });
    const review = UspReviewDeclarationSchema.parse({ proposalId: uuid(47), scope: this.scope,
      guard: { mode: 'update', requestKey: 'recorded-technical-review', expectedVersion: 1, expectedManifestId: manifestId },
      acknowledgement: DECLARATION_ACKNOWLEDGEMENT, sourceAcknowledged: true, populationAcknowledged: true,
      assessmentState: 'reconciled', reason: 'Technical accepted authority control', consentEvidence: [evidence],
      applicability: [{ target, state: 'applicable', evidence, reason: 'Explicit technical target and purpose', purpose: 'declared_share', relationPath: [], validity }] });
    this.sharedBodies = [
      { namespace: 'declaration', body: { pin: declaration, input, review, assessment: assessDeclaration(input), supersedes: null,
        technicalStatus: 'technically_accepted', legalStatus: 'not_assessed' } },
      { namespace: 'declaration_entry', body: { pin: entry, declaration, entry: input.entries[0] } },
      { namespace: 'applicability', body: { pin: applicability, declaration, ...review.applicability[0], consentStatus: 'reviewed_evidence' } },
    ];
    return declaration;
  }
  manifest(ctx: RequestContext) { return UspSnapshotManifestSchema.parse({ schemaVersion: 'usp/1', id: manifestId,
    digest: this.scope.snapshotDigest, scope: this.scope, capturedAt: '2026-10-02T00:00:00.000Z',
    selection: { kind: 'targets', pins: [target] }, members: [
      ...this.capturedExtraSources.map(s => ({ pin: pin('source_revision', s.id), bodySha256: fingerprint(s), bodyRef: `control-source-${s.id}`, authority: 'source' })),
      ...this.sharedBodies.map(b => ({ pin: b.body.pin, bodySha256: fingerprint(b.body), bodyRef: `control-${b.namespace}`, authority: b.namespace })),
      { pin: target, bodySha256: fingerprint(this.capturedRecord), bodyRef: 'control-record', authority: 'registry' },
      { pin: pin('source_revision', sourceId), bodySha256: fingerprint(this.capturedSource), bodyRef: 'control-source', authority: 'source' },
    ].sort((a, b) => {
      const ka = `${a.pin.ref.namespace}:${a.pin.ref.id}@${a.pin.revision}`, kb = `${b.pin.ref.namespace}:${b.pin.ref.id}@${b.pin.revision}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }), frame: { horizontal: null, vertical: null, unit: null, transform: null }, accessViewId: ctx.accessViewId,
    policyVersion: ctx.policyVersion, validAt: null, asOf: null, coverage: { state: 'complete', reasonCodes: [] } }); }
  ctx!: RequestContext;
  pool = { query: (q: string, v: any[] = []) => this.query(q, v), connect: async () => {
    assert(this.activeConnections < this.maxConnections, 'CONTROL pool exhausted by nested accepted authority read');
    this.connects++; this.activeConnections++; let baseline: State;
    return { release: () => { this.releases++; this.activeConnections--; }, query: async (q: string, v: any[] = []) => {
      if (q === 'BEGIN') baseline = structuredClone(this.state);
      if (q === 'ROLLBACK') this.state = baseline!;
      const result = await this.query(q, v);
      if (q === 'COMMIT' || q === 'ROLLBACK') {
        this.caseLocks.clear();
        for (const id of this.pendingArchives) this.commitArchive(id);
        this.pendingArchives.clear();
      }
      return result;
    } } as unknown as PoolClient;
  } } as unknown as Pool;
  async query(sql: string, v: any[] = []) {
    const q = sql.replace(/\s+/g, ' ').trim(); this.queries.push(q);
    const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (q === 'BEGIN' || q === 'ROLLBACK') return result();
    if (q === 'COMMIT' || q.includes('pg_advisory_xact_lock')) return result();
    if (q.startsWith('WITH RECURSIVE evidence_sources')) {
      const ids = [...new Set([caseId, ...this.extraSources.map(s => s.case_id)])].sort();
      for (const id of ids) this.caseLocks.add(id);
      return result(ids.map(id => ({ id })));
    }
    if (q.startsWith('SELECT id FROM cases WHERE id=ANY')) {
      for (const id of v[0]) this.caseLocks.add(id);
      this.afterCaseLock?.();
      return result(v[0].map((id: string) => ({ id })));
    }
    if (q.startsWith('SELECT id FROM sources WHERE id=ANY')) return result([this.source, ...this.extraSources]
      .filter(s => v[0].includes(s.id)).map(s => ({ id: s.id })));
    if (q.startsWith('SELECT id FROM registry_sites')) return result([{ id: siteId }]);
    if (q.startsWith('SELECT body FROM usp_snapshots')) return result(v[0] === manifestId && (v[1] === this.scope.snapshotDigest || v[1] === siteId && v[2] === this.scope.snapshotDigest)
      ? [{ body: this.manifest(this.ctx) }] : []);
    if (q.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies')) {
      const quoted = /namespace='([^']+)'/.exec(q)?.[1];
      const ns = quoted ?? v[1], id = quoted ? v[1] : v[2], revision = quoted ? v[2] : v[3];
      if (quoted && !q.includes('object_id=')) return result((ns === 'source_revision' ? [this.capturedSource]
        : this.sharedBodies.filter(b => b.namespace === ns).map(b => b.body)).map(body => ({ body, body_sha256: fingerprint(body) })));
      const shared = this.sharedBodies.find(b => b.namespace === ns && b.body.pin.ref.id === id && b.body.pin.revision === revision)?.body;
      const body = ns === 'source_revision' && revision === 1 ? id === sourceId ? this.capturedSource : this.capturedExtraSources.find(s => s.id === id)
        : ns === 'registry_record' && id === targetId && revision === 1 ? this.capturedRecord : shared;
      return result(body ? [{ body, body_sha256: fingerprint(body) }] : []);
    }
    if (q.startsWith('SELECT * FROM sources')) return result([this.source, ...this.extraSources].filter(s => s.id === v[0]));
    if (q.startsWith('SELECT revision FROM usp_declaration_revisions')) return result([{ revision: this.declarationRevision }]);
    if (q.startsWith('SELECT body FROM usp_declaration_revisions')) return result();
    if (q.startsWith('SELECT site_id,archived FROM cases')) return result([this.source, ...this.extraSources].some(s => s.case_id === v[0])
      ? [{ site_id: this.wrongSite ? uuid(99) : siteId, archived: v[0] === caseId ? this.archived : this.archivedCases.has(v[0]) }] : []);
    if (q.startsWith("SELECT body->'parts'")) return result();
    if (q.startsWith('SELECT r.id,r.revision')) return result(v[1].includes(targetId) ? [this.record] : []);
    if (q.startsWith('SELECT alias FROM registry_aliases') || q.startsWith('SELECT successor_id FROM usp_project_lineage')) return result();
    if (q.startsWith('SELECT r.*,c.code AS project_code')) return result(v[0] === targetId && v[1] === siteId
      ? [{ ...this.record, project_code: null, project_status: null, project_location: null }] : []);
    if (q.includes('FROM registry_records')) return result(v[0] === targetId && v[1] === siteId ? [this.record] : []);
    if (q.startsWith('SELECT clock_timestamp()')) return result([{ live: !this.expired && Date.parse(v[0]) > Date.now() }]);
    if (q.startsWith('SELECT max(version)')) return result([{ version: Math.max(...this.state.plans.filter(p => p.id === v[0]).map(p => p.version)) }]);
    if (q.startsWith('SELECT body FROM usp_packet_plans')) return result(this.state.plans.filter(p => p.id === v[0] && p.version === v[1]));
    if (q.startsWith('SELECT body,object_key,artifact_hash FROM usp_packets')) return result(this.state.packets.filter(p => p.id === v[0]));
    if (q.startsWith('SELECT namespace,object_id,revision,body FROM usp_snapshot_bodies')) return result([
      { namespace: 'source_revision', object_id: sourceId, revision: 1, body: this.capturedSource },
    ]);
    if (q.startsWith('SELECT body FROM usp_packet_plan_confirmations')) return result(this.state.confirmations.filter(p => p.plan_id === v[0] && p.version === v[1]));
    if (q.startsWith('SELECT body FROM usp_packet_plan_executions')) return result(this.state.executions.filter(p => q.includes('packet_id=')
      ? p.packet_id === v[0] : p.plan_id === v[0] && p.version === v[1]));
    if (q.startsWith('SELECT command_sha256,body FROM usp_command_receipts')) return result(this.state.receipts.filter(p =>
      p.subject === v[0] && p.scope_key === v[1] && p.operation === v[2] && p.request_key === v[3]));
    if (q.startsWith('INSERT') || q.startsWith('UPDATE')) this.writes++;
    if (q.startsWith('INSERT INTO usp_packet_plans')) { this.state.plans.push({ id: v[0], version: v[1], body: structuredClone(v[5]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_packet_plan_confirmations')) { this.state.confirmations.push({ id: v[0], plan_id: v[1], version: v[2], body: structuredClone(v[4]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_packet_plan_executions')) { this.state.executions.push({ plan_id: v[0], version: v[1], packet_id: v[3], body: structuredClone(v[4]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_command_receipts')) { this.state.receipts.push({ subject: v[1], scope_key: v[2], operation: v[3], request_key: v[4], command_sha256: v[5], body: structuredClone(v[6]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_packets')) { this.state.packets.push({ id: v[0], artifact_hash: v[4], object_key: v[5], body: structuredClone(v[6]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_outbox_streams')) { if (!this.state.streams.some(p => p.id === v[0])) this.state.streams.push({ id: v[0], sequence: 0 }); return result(); }
    if (q.startsWith('UPDATE usp_outbox_streams')) { const stream = this.state.streams.find(p => p.id === v[0]); return result([{ sequence: String(++stream.sequence) }]); }
    if (q.startsWith('INSERT INTO usp_outbox(')) {
      if (this.failEvent) throw new Error('CONTROL publication failed');
      this.state.events.push(structuredClone(v[2])); return result();
    }
    throw new Error(`Unmodelled control SQL: ${q}`);
  }
  objects = new Map<string, Uint8Array>(); puts = 0; reads = 0; afterPut?: () => void;
  io: PacketPlanIo = {
    read: async key => { this.reads++; if (key === this.source.object_key) return original;
      const bytes = this.objects.get(key); assert(bytes); return bytes; },
    put: async (key, bytes) => { this.puts++; assert(!this.objects.has(key)); this.objects.set(key, Buffer.from(bytes)); this.afterPut?.(); },
  };
}
async function withDb(action: (db: ControlDb, ctx: RequestContext) => Promise<void>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool }, oldPool = globals.ulpinPool;
  const oldSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const db = new ControlDb(); globals.ulpinPool = db.pool;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'packet-plan-protocol-control';
  try { const ctx = localRequestContext('control-request'); db.ctx = ctx; await action(db, ctx); assert.equal(db.connects, db.releases); }
  finally { globals.ulpinPool = oldPool; if (oldSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT; else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = oldSubject; }
}
function input(db: ControlDb, reviewed = true, missingRequired = false) {
  return UspPacketPlanInputSchema.parse({ target, scope: db.scope, purpose: 'record_evidence', format: 'csv',
    recipe: 'pack0-exact-text-csv/1', expiresAt: new Date(Date.now() + 3600000).toISOString(), entries: [
      { pointer: pointer('CSV row 2'), required: true, inclusionReason: 'Explicit reviewed technical selection', review: { kind: 'direct', reviewed } },
      { pointer: pointer('CSV row 9'), required: missingRequired, inclusionReason: 'Explicit incomplete optional context', review: { kind: 'direct', reviewed: true } },
    ] });
}
const confirmationRequest = (p: PacketPlan, key = 'confirm') => ({ planId: p.planId, version: p.version,
  planSha256: p.planSha256, reviewed: true, guard: { mode: 'update', requestKey: key, expectedVersion: p.version, expectedManifestId: p.input.scope.manifestId } });
async function confirmed(db: ControlDb, ctx: RequestContext) {
  const request = { input: input(db), guard: { mode: 'create', requestKey: 'create' } };
  const plan = await createPacketPlan(ctx, request, db.io);
  const confirmation = await confirmPacketPlan(ctx, confirmationRequest(plan), db.io);
  return { plan, confirmation, request, execute: { planId: plan.planId, version: plan.version,
    confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: 'execute' } } };
}
test('create → read → immutable revise → confirm → exact PACK0; logical multiline CSV, explicit omission and replay', async () => withDb(async (db, ctx) => {
  const create = { input: input(db, false), guard: { mode: 'create', requestKey: 'create' } };
  const first = await createPacketPlan(ctx, create, db.io);
  assert.equal(first.requiredContext, 'blocked');
  await assert.rejects(() => confirmPacketPlan(ctx, confirmationRequest(first), db.io), /required unavailable/);
  const revise = { planId: first.planId, input: input(db), guard: { mode: 'update', requestKey: 'revise', expectedVersion: 1, expectedManifestId: manifestId } };
  const plan = await revisePacketPlan(ctx, revise, db.io);
  assert.equal(plan.version, 2); assert.equal(plan.previousVersion, 1);
  assert.equal(plan.entries[1].state, 'omitted_optional');
  assert.equal((await readPacketPlan(ctx, { planId: first.planId, version: 1 })).plan.planSha256, first.planSha256);
  const confirmation = await confirmPacketPlan(ctx, confirmationRequest(plan), db.io);
  const execute = { planId: plan.planId, version: 2, confirmationId: confirmation.confirmationId,
    guard: { mode: 'create', requestKey: 'execute' } };
  const result = await executePacketPlan(ctx, execute, db.io);
  assert.equal(result.packet.status, 'complete'); assert.equal(result.packet.included.length, 1);
  assert.equal(result.omissions.length, 1); assert.equal(result.packet.unavailable.length, 0);
  const bytes = db.objects.get(db.state.packets[0].object_key)!;
  assert.equal(sha256(bytes), result.packet.artifact.sha256);
  assert.equal(Buffer.from(bytes).toString(), renderPacket0({ id: targetId, label: plan.targetLabel }, [
    { pointer: pointer('CSV row 2'), sourceSha256: sha256(original), excerpt: literal, reasonCode: null },
  ], 'csv'));
  assert.doesNotMatch(Buffer.from(bytes).toString(), /NEVER_B|Unavailable exact extract/);
  assert.equal(selectExactPart(db.source.inspection.referenceParts, pointer('CSV row 2').locator), literal);
  assert.equal(db.puts, 1); assert.equal(db.state.events.length, 4);
  const writes = db.writes, reads = db.reads;
  assert.deepEqual(await createPacketPlan(ctx, create, db.io), first);
  assert.deepEqual(await revisePacketPlan(ctx, revise, db.io), plan);
  assert.deepEqual(await confirmPacketPlan(ctx, confirmationRequest(plan), db.io), confirmation);
  assert.deepEqual(await executePacketPlan(ctx, execute, db.io), result);
  assert.equal(db.writes, writes); assert.equal(db.reads, reads); assert.equal(db.puts, 1);
  assert.equal((await readPacketPlan(ctx, { planId: plan.planId, version: 2 })).execution?.packet.packetId, result.packet.packetId);
  await assert.rejects(() => executePacketPlan(ctx, { ...execute, confirmationId: uuid(999) }, db.io), /different inputs/);
  await assert.rejects(() => executePacketPlan(ctx, { ...execute, guard: { mode: 'create', requestKey: 'another-key' } }, db.io), /already executed/);
}));
test('required missing extract blocks confirmation; unavailable shared purpose stays an optional omission', async () => withDb(async (db, ctx) => {
  const missing = await createPacketPlan(ctx, { input: input(db, true, true), guard: { mode: 'create', requestKey: 'required-missing' } }, db.io);
  assert.equal(missing.entries[1].state, 'blocked_required_context');
  await assert.rejects(() => confirmPacketPlan(ctx, confirmationRequest(missing), db.io), /required unavailable/);
  const i = input(db), shared = { ...i, entries: [i.entries[0], { ...i.entries[1], pointer: { ...pointer('CSV row 3'), origin: 'inherited' },
    review: { kind: 'shared', declaration: pin('declaration', uuid(44)), validAt: null } }] };
  const plan = await createPacketPlan(ctx, { input: shared, guard: { mode: 'create', requestKey: 'shared' } }, db.io);
  assert.equal(plan.entries[1].reasonCode, 'shared_applicability_unavailable');
  assert.equal(plan.entries[1].state, 'omitted_optional');
  await confirmPacketPlan(ctx, confirmationRequest(plan, 'shared-confirm'), db.io);
  const absent = await createPacketPlan(ctx, { input: { ...shared, purpose: 'declared_share', entries: [shared.entries[0],
    { ...shared.entries[1], review: { ...shared.entries[1].review, validAt: '2026-10-02' } }] },
    guard: { mode: 'create', requestKey: 'missing-declaration' } }, db.io);
  assert.equal(absent.entries[1].reasonCode, 'shared_applicability_unavailable');
  assert.equal(absent.entries[1].state, 'omitted_optional');
  assert.equal(db.state.packets.length, 0);
}));
test('wrong target and retarget are denied; source drift blocks new execution but authorized historical replay stays read-only', async () => withDb(async (db, ctx) => {
  const i = input(db);
  await assert.rejects(() => createPacketPlan(ctx, { input: { ...i, entries: [{ ...i.entries[0], pointer: { ...i.entries[0].pointer, target: pin('registry_record', uuid(55)).ref } }] },
    guard: { mode: 'create', requestKey: 'wrong-target' } }, db.io), /exact target/);
  const c = await confirmed(db, ctx);
  await assert.rejects(() => revisePacketPlan(ctx, { planId: c.plan.planId, input: { ...i, target: pin('registry_record', uuid(55)) },
    guard: { mode: 'update', expectedVersion: 1, expectedManifestId: manifestId, requestKey: 'retarget' } }, db.io), /another exact target/);
  db.source.revision = 2;
  const writes = db.writes;
  assert.deepEqual(await createPacketPlan(ctx, c.request, db.io), c.plan);
  assert.deepEqual(await confirmPacketPlan(ctx, confirmationRequest(c.plan), db.io), c.confirmation);
  assert.equal(db.writes, writes);
  assert.equal((await readPacketPlan(ctx, { planId: c.plan.planId, version: 1 })).plan.input.target.revision, 1);
  await assert.rejects(() => executePacketPlan(ctx, c.execute, db.io), /source revision/);
  assert.equal(db.puts, 0); assert.equal(db.state.executions.length, 0);
  db.archived = true;
  await assert.rejects(() => createPacketPlan(ctx, c.request, db.io), /unavailable in this site/);
  await assert.rejects(() => confirmPacketPlan(ctx, confirmationRequest(c.plan), db.io), /unavailable in this site/);
  await assert.rejects(() => readPacketPlan(ctx, { planId: c.plan.planId, version: 1 }), /unavailable in this site/);
}));
test('execution replay reauthorizes after benign drift and expiry; current entitlement/policy and active case remain mandatory', async () => withDb(async (db, ctx) => {
  const c = await confirmed(db, ctx), executed = await executePacketPlan(ctx, c.execute, db.io);
  db.record.revision = 2; db.source.revision = 2; db.expired = true;
  const writes = db.writes;
  assert.deepEqual(await executePacketPlan(ctx, c.execute, db.io), executed); assert.equal(db.writes, writes);
  await assert.rejects(() => executePacketPlan({ ...ctx, principal: { ...ctx.principal, entitlementVersion: 'revoked' } }, c.execute, db.io), /Current access/);
  await assert.rejects(() => readPacketPlan({ ...ctx, policyVersion: 'changed' }, { planId: c.plan.planId, version: 1 }), /Current access/);
  db.wrongSite = true;
  await assert.rejects(() => executePacketPlan(ctx, c.execute, db.io), /unavailable in this site/);
  assert.equal(db.puts, 1);
}));
test('final source check rejects changed extraction during object I/O and failed publication rolls all SQL linkage back', async () => withDb(async (db, ctx) => {
  const c = await confirmed(db, ctx);
  db.afterPut = () => { db.source.inspection.referenceParts[0].text = 'CONTROL tampered'; };
  await assert.rejects(() => executePacketPlan(ctx, c.execute, db.io), /extraction context changed/);
  assert.equal(db.state.packets.length, 0); assert.equal(db.state.executions.length, 0);
  assert.equal(db.state.receipts.length, 2); assert.equal(db.state.events.length, 2);
  db.source = structuredClone(db.capturedSource); db.afterPut = undefined; db.failEvent = true;
  await assert.rejects(() => executePacketPlan(ctx, c.execute, db.io), /publication failed/);
  assert.equal(db.state.packets.length, 0); assert.equal(db.state.executions.length, 0);
  assert.equal(db.state.receipts.length, 2); assert.equal(db.state.events.length, 2);
  assert.equal(db.objects.size, 2); // Unreferenced generated objects are retained for existing orphan recovery, never originals.
  assert.equal(sha256(original), db.capturedSource.sha256);
}));
test('unexecuted expiry and bounded explicit contracts reject unsupported recipe, duplicates and caller principal', async () => withDb(async (db, ctx) => {
  const i = input(db);
  assert(!UspPacketPlanInputSchema.safeParse({ ...i, entries: [...i.entries, i.entries[0]] }).success);
  assert(!UspPacketPlanInputSchema.safeParse({ ...i, entries: Array(21).fill(i.entries[0]) }).success);
  assert(!UspPacketPlanInputSchema.safeParse({ ...i, recipe: 'pdf' }).success);
  assert(!UspPacketPlanInputSchema.safeParse({ ...i, principal: ctx.principal }).success);
  const c = await confirmed(db, ctx); db.expired = true;
  await assert.rejects(() => executePacketPlan(ctx, c.execute, db.io), /expired/);
  assert.equal(db.puts, 0);
  const text = renderPacket0({ id: targetId, label: 'Protocol control A' }, [
    { pointer: pointer('CSV row 2'), sourceSha256: sha256(original), excerpt: literal, reasonCode: null },
    { pointer: pointer('CSV row 9'), sourceSha256: sha256(original), excerpt: null, reasonCode: 'exact_extract_unavailable' },
  ], 'text');
  assert.match(text, /Unavailable exact extract: exact_extract_unavailable/); // Direct PACK0 remains compatible.
  assert.equal(canonical(db.capturedSource), canonical(db.source));
}));
test('accepted shared declared_share authority includes only the exact reviewed clause; linked historical PACK0 download reauthorizes', async () => withDb(async (db, ctx) => {
  db.maxConnections = 1; // Accepted reader is reused without holding a mutation connection or recording locks.
  const declaration = db.enableShared(), i = input(db);
  const sharedInput = { ...i, purpose: 'declared_share', entries: [{ ...i.entries[0], pointer: { ...i.entries[0].pointer, origin: 'inherited' },
    review: { kind: 'shared', declaration, validAt: '2026-10-02' } }] };
  const plan = await createPacketPlan(ctx, { input: sharedInput, guard: { mode: 'create', requestKey: 'shared-accepted' } }, db.io);
  assert.equal(plan.requiredContext, 'available'); assert(plan.entries[0].applicabilitySha256);
  const confirmation = await confirmPacketPlan(ctx, confirmationRequest(plan), db.io);
  const execute = { planId: plan.planId, version: 1, confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: 'shared-execute' } };
  const result = await executePacketPlan(ctx, execute, db.io);
  const downloaded = await readPacket0(ctx, result.packet.packetId, db.io.read);
  assert.equal(sha256(downloaded.bytes), result.packet.artifact.sha256);
  assert.match(Buffer.from(downloaded.bytes).toString(), /literal first line/);
  assert.doesNotMatch(Buffer.from(downloaded.bytes).toString(), /NEVER_B/);
  db.declarationRevision = 2; db.source.revision = 2; db.record.revision = 2;
  assert.deepEqual((await readPacket0(ctx, result.packet.packetId, db.io.read)).receipt, result.packet);
  assert.deepEqual(await executePacketPlan(ctx, execute, db.io), result);
  db.archived = true;
  await assert.rejects(() => readPacket0(ctx, result.packet.packetId, db.io.read), /unavailable in this site/);
}));
test('direct PACK0 historical reader retains exact linked target and bytes after additive plan linkage', async () => withDb(async (db, ctx) => {
  const c = await confirmed(db, ctx), result = await executePacketPlan(ctx, c.execute, db.io);
  db.state.executions = []; // Controlled packet without a plan link exercises the existing direct reader.
  assert.deepEqual((await readPacket0(ctx, result.packet.packetId, db.io.read)).receipt, result.packet);
}));
test('unchanged retained LGD reference provides exact literal parts without any property plan or matched target', async () => {
  const bytes = await readFile(new URL('../fixtures/usp/D4/gf0-structured-codes-v1/lgd-districts.csv', import.meta.url));
  assert.equal(bytes.length, 89622);
  assert.equal(sha256(bytes), 'b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59');
  // The pinned reader receipt identifies these two single-line logical rows.
  const rows = bytes.toString('utf8').split(/\r?\n/), parts = [
    { locator: 'CSV row 4', text: rows[3] }, { locator: 'CSV row 5', text: rows[4] },
  ];
  assert.match(selectExactPart(parts, { kind: 'verbatim', locator: 'CSV row 4' })!, /,049$/);
  assert.match(selectExactPart(parts, { kind: 'verbatim', locator: 'CSV row 5' })!, /,Arvalli,,000$/);
  assert.equal(selectExactPart(parts, { kind: 'verbatim', locator: 'CSV row 6' }), null);
  assert.equal(sha256(await readFile(new URL('../fixtures/usp/D4/gf0-structured-codes-v1/lgd-districts.csv', import.meta.url))), sha256(bytes));
});

// Reuse the reviewer's two query-boundary schedules, with the archive writer now
// respecting case FOR SHARE locks. Original probe is preserved byte-for-byte at
// E:/BhuAayam-data/task-data/desktop-packet-plans-review/historical-read-archive.probe.test.ts
// SHA256 9c3e8cceafe1b448b81eae97d6f3397123defe8292adad1d6f48e72fd969cff4.
function archiveDuringFinalPass(db: ControlDb, finalPass: number) {
  const originalQuery = db.query.bind(db);
  let caseReads = 0, armed = false, attempted = false, committedInside = false;
  const trace: string[] = [];
  db.query = async (sql: string, values: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim(); trace.push(q);
    if (armed && !attempted && q.startsWith('SELECT * FROM sources')) {
      attempted = true; committedInside = db.attemptArchive(caseId);
    }
    const result = await originalQuery(sql, values);
    if (q.startsWith('SELECT site_id,archived FROM cases') && ++caseReads === finalPass) armed = true;
    return result;
  };
  return { trace, attempted: () => attempted, committedInside: () => committedInside, caseReads: () => caseReads };
}
function assertDisclosureLockOrder(trace: string[]) {
  const cases = trace.findIndex(q => q.startsWith('SELECT id FROM cases WHERE id=ANY') && q.endsWith('FOR SHARE'));
  const recording = trace.findIndex(q => q.includes("hashtextextended('physical-area-recording'"));
  const sources = trace.findIndex(q => q.startsWith('SELECT id FROM sources WHERE id=ANY') && q.endsWith('FOR SHARE'));
  const target = trace.findIndex(q => q.includes('FROM registry_records') && q.endsWith('FOR SHARE OF r'));
  assert(cases >= 0 && recording > cases && sources > recording && target > sources);
}
test('P2 reviewer plan schedule: archive waits for protected disclosure, then a subsequent historical read denies with zero writes', async () => withDb(async (db, ctx) => {
  const { plan } = await confirmed(db, ctx), writes = db.writes;
  db.source.revision = 2; db.record.revision = 2; db.expired = true;
  const probe = archiveDuringFinalPass(db, 2);
  const view = await readPacketPlan(ctx, { planId: plan.planId, version: 1 });
  assert.equal(view.plan.planSha256, plan.planSha256); assert(probe.attempted()); assert(!probe.committedInside());
  assert.equal(probe.caseReads(), 2); assertDisclosureLockOrder(probe.trace);
  assert(db.archived); // The queued archive commits only after the protected read transaction commits.
  await assert.rejects(() => readPacketPlan(ctx, { planId: plan.planId, version: 1 }),
    (e: any) => e.status === 403 && e.code === 'DECLARATION_SOURCE_DENIED');
  assert.equal(db.writes, writes); assert.equal(db.puts, 0);
}));
test('P2 reviewer post-object schedule: packet authorization protects the final boundary and prior object-gap revocation denies bytes', async () => withDb(async (db, ctx) => {
  const { execute, plan } = await confirmed(db, ctx), result = await executePacketPlan(ctx, execute, db.io);
  const writes = db.writes, puts = db.puts, probe = archiveDuringFinalPass(db, 4);
  const read: PacketPlanIo['read'] = async key => {
    assert.equal(db.activeConnections, 0); assert.equal(db.caseLocks.size, 0);
    return db.io.read(key);
  };
  const download = await readPacket0(ctx, result.packet.packetId, read);
  assert.equal(sha256(download.bytes), result.packet.artifact.sha256);
  assert(probe.attempted()); assert(!probe.committedInside()); assert.equal(probe.caseReads(), 4);
  assertDisclosureLockOrder(probe.trace); assert(db.archived);
  await assert.rejects(() => readPacket0(ctx, result.packet.packetId, read), (e: any) => e.status === 403);
  db.archived = false;
  await assert.rejects(() => readPacket0(ctx, result.packet.packetId, async key => {
    assert.equal(db.activeConnections, 0); const bytes = await db.io.read(key); db.archived = true; return bytes;
  }), (e: any) => e.status === 403 && e.code === 'DECLARATION_SOURCE_DENIED');
  assert.equal(db.writes, writes); assert.equal(db.puts, puts);
  assert.equal(db.state.plans[0].body.planSha256, plan.planSha256);
}));
test('protected historical closure covers retained and current copied-source cases and rechecks changed discovery', async () => withDb(async (db, ctx) => {
  const oldParent = { ...structuredClone(db.source), id: uuid(70), case_id: uuid(80), object_key: 'retained-parent', inspection: {} };
  const newParent = { ...structuredClone(oldParent), id: uuid(71), case_id: uuid(81), object_key: 'current-parent' };
  db.extraSources = [oldParent, newParent]; db.capturedExtraSources = structuredClone(db.extraSources);
  const copied = (p: typeof oldParent) => ({ caseId: p.case_id, sourceRevisionId: p.id, sourceHash: p.sha256, sourceRevision: p.revision });
  db.source.inspection.copiedFrom = copied(oldParent); db.capturedSource = structuredClone(db.source);
  const { plan } = await confirmed(db, ctx), writes = db.writes;
  db.source.revision = 2; db.source.inspection.copiedFrom = copied(newParent);
  const query = db.query.bind(db), locked: string[][] = [];
  db.query = async (sql, values = []) => {
    if (sql.startsWith('SELECT id FROM cases WHERE id=ANY')) locked.push(values[0]);
    return query(sql, values);
  };
  assert.equal((await readPacketPlan(ctx, { planId: plan.planId, version: 1 })).plan.planSha256, plan.planSha256);
  assert.deepEqual(locked[0], [caseId, oldParent.case_id, newParent.case_id].sort());
  db.archivedCases.add(oldParent.case_id);
  await assert.rejects(() => readPacketPlan(ctx, { planId: plan.planId, version: 1 }), /lineage is unavailable in this site/);
  db.archivedCases.clear(); db.archivedCases.add(newParent.case_id);
  await assert.rejects(() => readPacketPlan(ctx, { planId: plan.planId, version: 1 }), /lineage is unavailable in this site/);
  db.archivedCases.clear(); db.source.inspection.copiedFrom = copied(oldParent);
  db.afterCaseLock = () => { db.source.inspection.copiedFrom = copied(newParent); };
  await assert.rejects(() => readPacketPlan(ctx, { planId: plan.planId, version: 1 }), /authorization dependencies changed/);
  assert.equal(db.writes, writes);
}));
test('accepted shared consent case is protected during historical disclosure and current revocation denies the saved plan', async () => withDb(async (db, ctx) => {
  const declaration = db.enableShared(), consent = { ...structuredClone(db.source), id: uuid(72), case_id: uuid(82), object_key: 'shared-consent-original' };
  db.extraSources = [consent]; db.capturedExtraSources = [structuredClone(consent)];
  const body = db.sharedBodies.find(b => b.namespace === 'declaration')!.body;
  body.review = { ...body.review, consentEvidence: [...body.review.consentEvidence, {
    pointer: { ...pointer('CSV row 2'), sourceRevision: pin('source_revision', consent.id) }, sha256: consent.sha256, bytes: consent.bytes,
  }] };
  const i = input(db), plan = await createPacketPlan(ctx, { input: { ...i, purpose: 'declared_share', entries: [{ ...i.entries[0],
    pointer: { ...i.entries[0].pointer, origin: 'inherited' }, review: { kind: 'shared', declaration, validAt: '2026-10-02' } }] },
    guard: { mode: 'create', requestKey: 'shared-private-case' } }, db.io);
  const writes = db.writes;
  db.afterCaseLock = () => assert(db.caseLocks.has(caseId) && db.caseLocks.has(consent.case_id));
  assert.equal((await readPacketPlan(ctx, { planId: plan.planId, version: 1 })).plan.planSha256, plan.planSha256);
  db.archivedCases.add(consent.case_id);
  await assert.rejects(() => readPacketPlan(ctx, { planId: plan.planId, version: 1 }), (e: any) => e.status === 403);
  assert.equal(db.writes, writes);
}));
