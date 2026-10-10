import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { UspSnapshotManifestSchema, type RequestContext } from '../packages/contracts/src/usp';
import { UspPacketPlanSchema, UspPacketPlanEntrySchema, UspPacketPlanInputSchema, UspPacketPlanConfirmationSchema,
  UspPacketPlanExecutionSchema } from '../packages/contracts/src/usp/packets';
import { UspPacket0ReceiptSchema } from '../packages/contracts/src/usp/packet0';
import { projectCodeForPayload } from '../packages/contracts/src/usp/project-identity';
import { generatePropertyCard, readPropertyCard, resolvePropertyCard, type PropertyCardIo } from '../packages/server/src/modules/usp/packets/card-service';
import { renderPropertyCard } from '../packages/server/src/modules/usp/packets/card-render';
import { localRequestContext } from '../packages/server/src/modules/usp/principal';
import { canonical, fingerprint } from '../packages/server/src/modules/cases/domain';
import { renderPacket0 } from '../packages/server/src/modules/usp/packet0';
import { sha256 } from '../packages/server/src/infrastructure/storage';

// Controlled persistence of an already executed plan. Protocol values below
// qualify access/linkage behavior only, never operational property facts.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const siteId = uuid(1), sourceId = uuid(2), caseId = uuid(3), manifestId = uuid(4), targetId = uuid(5), planId = uuid(6), packetId = uuid(7);
const pin = (namespace: string, id: string) => ({ ref: { namespace, id }, revision: 1 });
const target = pin('registry_record', targetId), original = Buffer.from('CONTROL-A,recorded property-card protocol\r\n');
const pointer = { sourceRevision: pin('source_revision', sourceId), assetRevision: null, partRevision: null,
  locator: { kind: 'verbatim' as const, locator: 'CSV row 1' }, purpose: 'record' as const, origin: 'direct' as const, target: target.ref };
class CardDb {
  archived = false; currentRevision = 1; puts = 0; reads = 0; writes = 0; active = 0;
  cardRows: any[] = []; receipts: any[] = []; events: any[] = []; sequence = 0;
  objects = new Map<string, Uint8Array>(); caseProtected = false; pendingArchive = false;
  afterPut?: () => void; afterRead?: () => void; ctx!: RequestContext;
  source = { id: sourceId, revision: 1, case_id: caseId, sha256: sha256(original), bytes: original.length,
    object_key: 'control-original', profile: 'csv-reference-v2', inspection: { referenceParts: [{ locator: 'CSV row 1', text: original.toString().trimEnd() }] } };
  captured = { id: targetId, revision: 1, site_id: siteId, identifier: 'CONTROL-A', kind: 'space', body: { name: 'Technical protocol record A' },
    projectIdentity: { code: projectCodeForPayload('0123456789ABCDEFGHJK'), status: 'assigned',
      location: { anchorState: 'not_supplied', parcels: [], locator: { structureKind: 'S', structureNumber: 1, levels: ['G'], spaceKind: 'R', spaceNumber: 1 } }, successors: [] } };
  scope = { kind: 'snapshot' as const, scopeId: siteId, world: { namespace: 'world', id: `registry-site/${siteId}` },
    manifestId, snapshotDigest: 'a'.repeat(64), stage: 'recorded' as const };
  plan: any; confirmation: any; execution: any; packet: any;
  init(ctx: RequestContext) {
    this.ctx = ctx;
    const input = UspPacketPlanInputSchema.parse({ target, scope: this.scope, purpose: 'record_evidence', format: 'csv', recipe: 'pack0-exact-text-csv/1',
      expiresAt: new Date(Date.now() + 3600000).toISOString(), entries: [{ pointer, required: true, inclusionReason: 'Reviewed protocol literal', review: { kind: 'direct', reviewed: true } }] });
    const entryBody = { selection: input.entries[0], sourceSha256: this.source.sha256, sourceBytes: original.length,
      sourceBodySha256: fingerprint(this.source), evidenceSha256: fingerprint(pointer), excerptSha256: sha256(original.toString().trimEnd()),
      targetPath: [target], applicabilitySha256: null, state: 'included', reasonCode: null };
    const entry = UspPacketPlanEntrySchema.parse({ ...entryBody, entrySha256: fingerprint(entryBody) });
    const body = { planId, version: 1, previousVersion: null, input, creator: ctx.principal, accessViewId: ctx.accessViewId,
      policyVersion: ctx.policyVersion, targetBodySha256: fingerprint(this.captured), targetLabel: this.captured.body.name,
      entries: [entry], requiredContext: 'available', createdAt: new Date().toISOString() };
    this.plan = UspPacketPlanSchema.parse({ ...body, planSha256: fingerprint(body) });
    this.confirmation = UspPacketPlanConfirmationSchema.parse({ confirmationId: uuid(8), planId, version: 1, planSha256: this.plan.planSha256,
      reviewer: ctx.principal, reviewed: true, confirmedAt: new Date().toISOString() });
    const bytes = Buffer.from(renderPacket0({ id: targetId, label: this.plan.targetLabel }, [{ pointer, sourceSha256: this.source.sha256,
      excerpt: original.toString().trimEnd(), reasonCode: null }], 'csv'));
    this.packet = UspPacket0ReceiptSchema.parse({ packetId, target, scope: this.scope, format: 'csv', artifact: { assetId: packetId, version: 1, sha256: sha256(bytes) },
      included: [pointer], unavailable: [], contentType: 'text/csv; charset=utf-8', createdAt: new Date().toISOString(), status: 'complete', commandSha256: 'b'.repeat(64) });
    this.execution = UspPacketPlanExecutionSchema.parse({ planId, version: 1, confirmationId: this.confirmation.confirmationId, packet: this.packet, omissions: [] });
    this.objects.set('control-packet', bytes);
  }
  manifest() {
    const members = [{ pin: target, body: this.captured, authority: 'registry' }, { pin: pin('source_revision', sourceId), body: this.source, authority: 'source' }]
      .map(m => ({ pin: m.pin, bodySha256: fingerprint(m.body), bodyRef: fingerprint([m.pin.ref.namespace, m.pin.ref.id, m.pin.revision, m.body]), authority: m.authority }))
      .sort((a, b) => `${a.pin.ref.namespace}:${a.pin.ref.id}`.localeCompare(`${b.pin.ref.namespace}:${b.pin.ref.id}`));
    return UspSnapshotManifestSchema.parse({ schemaVersion: 'usp/1', id: manifestId, digest: this.scope.snapshotDigest, scope: this.scope,
      capturedAt: '2026-10-02T00:00:00.000Z', selection: { kind: 'targets', pins: [target] }, members,
      frame: { horizontal: null, vertical: null, unit: null, transform: null }, accessViewId: this.ctx.accessViewId, policyVersion: this.ctx.policyVersion,
      validAt: null, asOf: null, coverage: { state: 'complete', reasonCodes: [] } });
  }
  archive() { if (this.caseProtected) this.pendingArchive = true; else this.archived = true; }
  pool = { query: (q: string, v: any[]) => this.query(q, v), connect: async () => {
    assert.equal(this.active, 0, 'Object I/O or nested authority must not hold a connection'); this.active++;
    let baseline: any;
    return { release: () => { this.active--; }, query: async (q: string, v: any[] = []) => {
      if (q === 'BEGIN') baseline = structuredClone({ cards: this.cardRows, receipts: this.receipts, events: this.events, sequence: this.sequence });
      if (q === 'ROLLBACK') { this.cardRows = baseline.cards; this.receipts = baseline.receipts; this.events = baseline.events; this.sequence = baseline.sequence; }
      const result = await this.query(q, v);
      if (q === 'COMMIT' || q === 'ROLLBACK') { this.caseProtected = false; if (this.pendingArchive) this.archived = true; this.pendingArchive = false; }
      return result;
    } } as unknown as PoolClient;
  } } as unknown as Pool;
  async query(sql: string, v: any[] = []) {
    const q = sql.replace(/\s+/g, ' ').trim(), result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q) || q.includes('pg_advisory_xact_lock')) return result();
    if (q.startsWith('SELECT id FROM cases WHERE id=ANY')) { this.caseProtected = true; return result([{ id: caseId }]); }
    if (q.startsWith('SELECT id FROM registry_sites')) return result([{ id: siteId }]);
    if (q.startsWith('SELECT id FROM sources WHERE id=ANY')) return result([{ id: sourceId }]);
    if (q.startsWith('SELECT body FROM usp_snapshots')) return result([{ body: this.manifest() }]);
    if (q.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies')) {
      const quoted = q.includes("namespace='source_revision'"), ns = quoted ? 'source_revision' : v[1], id = quoted ? v[1] : v[2];
      const body = ns === 'source_revision' && id === sourceId ? this.source : ns === 'registry_record' && id === targetId ? this.captured : null;
      return result(body ? [{ body, body_sha256: fingerprint(body) }] : []);
    }
    if (q.startsWith('SELECT * FROM sources')) return result(v[0] === sourceId ? [this.source] : []);
    if (q.startsWith('SELECT site_id,archived FROM cases')) return result([{ site_id: siteId, archived: this.archived }]);
    if (q.includes('FROM registry_records')) return result(v[0] === targetId && v[1] === siteId ? [{ ...this.captured, revision: this.currentRevision, project_status: 'assigned' }] : []);
    if (q.startsWith('SELECT body FROM usp_packet_plans')) return result(v[0] === planId && v[1] === 1 ? [{ body: this.plan }] : []);
    if (q.startsWith('SELECT body FROM usp_packet_plan_confirmations')) return result([{ body: this.confirmation }]);
    if (q.startsWith('SELECT body FROM usp_packet_plan_executions')) return result([{ body: this.execution }]);
    if (q.startsWith('SELECT body,object_key,artifact_hash FROM usp_packets')) return result([{ body: this.packet, object_key: 'control-packet', artifact_hash: this.packet.artifact.sha256 }]);
    if (q.startsWith('SELECT clock_timestamp()')) return result([{ live: Date.parse(v[0]) > Date.now() }]);
    if (q.startsWith('SELECT max(revision)')) return result([{ revision: Math.max(...this.cardRows.filter(r => r.id === v[0]).map(r => r.revision)) }]);
    if (q.startsWith('SELECT body,object_key,artifact_hash FROM usp_property_cards')) return result(this.cardRows.filter(r => r.id === v[0] && r.revision === v[1]));
    if (q.startsWith('SELECT command_sha256,body FROM usp_command_receipts')) return result(this.receipts.filter(r => r.subject === v[0] && r.scope_key === v[1] && r.operation === v[2] && r.request_key === v[3]));
    if (/^(INSERT|UPDATE)/.test(q)) this.writes++;
    if (q.startsWith('INSERT INTO usp_property_cards')) { this.cardRows.push({ id: v[0], revision: v[1], artifact_hash: v[8], object_key: v[9], body: structuredClone(v[10]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_command_receipts')) { this.receipts.push({ subject: v[1], scope_key: v[2], operation: v[3], request_key: v[4], command_sha256: v[5], body: structuredClone(v[6]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_outbox_streams')) return result();
    if (q.startsWith('UPDATE usp_outbox_streams')) return result([{ sequence: String(++this.sequence) }]);
    if (q.startsWith('INSERT INTO usp_outbox(')) { this.events.push(v[2]); return result(); }
    throw new Error(`Unmodelled SQL: ${q}`);
  }
  io: PropertyCardIo = {
    readPacket: async key => { assert.equal(this.active, 0); this.reads++; const bytes = this.objects.get(key); assert(bytes); return bytes; },
    readCard: async (key, bytes, hash) => { assert.equal(this.active, 0); this.reads++; const result = this.objects.get(key); assert(result);
      assert.equal(result.length, bytes); assert.equal(sha256(result), hash); this.afterRead?.(); return result; },
    put: async (key, bytes, type) => { assert.equal(this.active, 0); assert.equal(type, 'application/pdf'); assert(!this.objects.has(key));
      this.puts++; this.objects.set(key, Buffer.from(bytes)); this.afterPut?.(); },
  };
}
async function withDb(action: (db: CardDb, ctx: RequestContext) => Promise<void>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool }, old = globals.ulpinPool, subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const db = new CardDb(); globals.ulpinPool = db.pool; process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'property-card-protocol';
  try { const ctx = localRequestContext('card-control'); db.init(ctx); await action(db, ctx); assert.equal(db.active, 0); }
  finally { globals.ulpinPool = old; if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT; else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject; }
}
const command = () => ({ planId, planVersion: 1, cardId: null, expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create', requestKey: 'card-create' } });
test('executed confirmed plan → card → exact read → decoded local QR/resolver; immutable facts, replay, guarded revision and unsupported glyphs', async () => withDb(async (db, ctx) => {
  const request = command(), card = await generatePropertyCard(ctx, request, db.io), exact = { cardId: card.cardId, revision: 1 };
  assert.equal(card.artifact.pages, 1); assert(card.artifact.bytes <= 524288); assert.equal(db.cardRows.length, 1); assert.equal(db.events.length, 1);
  assert.equal(card.facts.find(f => f.key === 'project_identity')?.value, `${db.captured.projectIdentity.code}; assigned (P3/1)`);
  for (const key of ['geometry', 'measurements', 'render']) assert.equal(card.facts.find(f => f.key === key)?.state, 'unavailable');
  assert.equal(card.facts.find(f => f.key === 'rights')?.state, 'not_assessed');
  const writes = db.writes, reads = db.reads, puts = db.puts;
  assert.deepEqual(await generatePropertyCard(ctx, request, db.io), card);
  assert.equal(db.writes, writes); assert.equal(db.reads, reads); assert.equal(db.puts, puts);
  await assert.rejects(() => generatePropertyCard(ctx, { ...request, expiresAt: new Date(Date.now() + 7200000).toISOString() }, db.io), /different inputs/);
  assert.equal((await readPropertyCard(ctx, exact)).snapshotState, 'same_revision');
  db.currentRevision = 2;
  const historical = await readPropertyCard(ctx, exact);
  assert.equal(historical.snapshotState, 'changed_revision'); assert.equal(historical.currentTargetRevision, 2); assert.deepEqual(historical.card, card);
  let resolvedExact = exact;
  const result = await resolvePropertyCard(ctx, exact, db.io);
  if (process.env.CARD_EVIDENCE_DIR) {
    const directory = process.env.CARD_EVIDENCE_DIR; await mkdir(directory, { recursive: true });
    const pdfPath = join(directory, 'property-card.pdf'); await writeFile(pdfPath, result.bytes);
    await writeFile(join(directory, 'property-card.json'), JSON.stringify(historical, null, 2) + '\n');
    assert(process.env.CARD_PDFTOPPM, 'Evidence journey requires Poppler render/QR decoding');
    const prefix = join(directory, 'property-card');
    const render = spawnSync(process.env.CARD_PDFTOPPM, ['-r', '144', '-singlefile', '-png', pdfPath, prefix], { encoding: 'utf8' });
    assert.equal(render.status, 0, render.stderr);
    const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
    const { PNG } = require('pngjs'), jsQR = require('jsqr');
    const png = PNG.sync.read(await readFile(`${prefix}.png`));
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert(qr, 'QR must decode from the rendered one-page PDF'); assert.equal(qr.data, card.resolverUrl);
    const url = new URL(qr.data); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.search, ''); assert.equal(url.hash, '');
    assert.equal(url.username, ''); assert.equal(url.password, '');
    const match = /\/property-cards\/([^/]+)\/revisions\/([1-9]\d*)$/.exec(url.pathname)!;
    resolvedExact = { cardId: match[1], revision: Number(match[2]) };
    await writeFile(join(directory, 'decoded-qr.txt'), qr.data + '\n');
  }
  const resolved = await resolvePropertyCard(ctx, resolvedExact, db.io);
  assert.equal(sha256(resolved.bytes), card.artifact.sha256); assert.equal(resolved.currentTargetRevision, 2);
  await assert.rejects(() => resolvePropertyCard(ctx, { ...exact, revision: 9 }, db.io), /exact property card revision/);
  const revised = await generatePropertyCard(ctx, { ...request, cardId: card.cardId,
    guard: { mode: 'update', requestKey: 'card-revise', expectedVersion: 1, expectedManifestId: manifestId } }, db.io);
  assert.equal(revised.revision, 2); assert.equal(revised.previousRevision, 1); assert.deepEqual((await readPropertyCard(ctx, exact)).card, card);
  await assert.rejects(() => generatePropertyCard(ctx, { ...request, cardId: card.cardId,
    guard: { mode: 'update', requestKey: 'stale-revise', expectedVersion: 1, expectedManifestId: manifestId } }, db.io), /newer immutable card/);
  const { artifact, cardSha256, ...content } = card;
  await assert.rejects(async () => renderPropertyCard({ ...content, facts: [{ ...card.facts[0], value: 'भूमि' }] }), /supports printable ASCII/);
  await assert.rejects(async () => renderPropertyCard({ ...content, facts: [{ ...card.facts[0], value: 'long exact value '.repeat(500) }] }), /exceed the one-page/);
}));
test('current revocation blocks replay/read and post-object disclosure/publication', async () => withDb(async (db, ctx) => {
  const request = command(), card = await generatePropertyCard(ctx, request, db.io), exact = { cardId: card.cardId, revision: 1 };
  const puts = db.puts;
  db.afterRead = () => db.archive();
  await assert.rejects(() => resolvePropertyCard(ctx, exact, db.io), /unavailable in this site/);
  assert(db.archived);
  await assert.rejects(() => readPropertyCard(ctx, exact), /unavailable in this site/);
  await assert.rejects(() => generatePropertyCard(ctx, request, db.io), /unavailable in this site/);
  assert.equal(db.puts, puts); assert.equal(db.cardRows.length, 1);
  db.archived = false; db.afterRead = undefined;
  db.afterPut = () => db.archive();
  await assert.rejects(() => generatePropertyCard(ctx, { ...request, guard: { mode: 'create', requestKey: 'revoked-publication' } }, db.io), /unavailable in this site/);
  assert.equal(db.cardRows.length, 1); assert.equal(db.receipts.length, 1); assert.equal(db.events.length, 1);
  assert.equal(db.puts, 2, 'Rejected publication can leave one unreferenced immutable derivative');
}));
