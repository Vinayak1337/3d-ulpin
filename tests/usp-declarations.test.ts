import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import {
  DECLARATION_ACKNOWLEDGEMENT, UspPrepareProposalSchema, UspCommitProposalSchema,
  UspReviewDeclarationSchema, UspDeclarationInputSchema, UspSnapshotManifestSchema,
} from '../packages/contracts/src/usp/index';
import { assessDeclaration, parseLiteralRational } from '../packages/server/src/modules/usp/declarations/arithmetic';
import { declarationSnapshotView, declarationMembership } from '../packages/server/src/modules/usp/declarations/projection';
import { readSelectedDeclaration, readDeclarationProposal } from '../packages/server/src/modules/usp/declarations/service';
import { prepareProposal, reviewDeclaration, commitProposal } from '../packages/server/src/modules/usp/commands';
import { captureRegistrySnapshotTx, readSnapshotBody } from '../packages/server/src/modules/usp/snapshots';
import { localRequestContext } from '../packages/server/src/modules/usp/principal';
import { fingerprint } from '../packages/server/src/modules/cases/domain';

// Generated technical controls only. These rows/source receipts do not assert
// any real property, retained bytes, official instrument or legal permission.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const siteId = uuid(1), sourceId = uuid(2), caseId = uuid(3), declarationId = uuid(4);
const pin = (namespace: string, id: string, revision = 1) => ({ ref: { namespace, id }, revision });
const targetA = pin('registry_record', uuid(10)), targetB = pin('registry_record', uuid(11));
const validity = { from: '2026-01-01', to: null, endState: 'open_ended' as const };
const evidence = (target: { namespace: string; id: string }, locator: string) => ({
  pointer: { sourceRevision: pin('source_revision', sourceId), assetRevision: null, partRevision: null,
    locator: { kind: 'verbatim', locator }, purpose: 'record', origin: 'direct', target }, sha256: 'a'.repeat(64), bytes: 123,
});
function input() {
  const common = evidence(pin('declaration', declarationId).ref, 'CONTROL declaration population and denominator');
  return UspDeclarationInputSchema.parse({ jurisdiction: 'Technical control jurisdiction', statute: null,
    allocationSubject: 'land_interest', subjectDefinition: 'Source-defined control land interest',
    basis: 'declared_value', basisDefinition: 'Literal stated value basis', instrument: common,
    population: { status: 'complete', declaredCount: 2, targets: [targetA, targetB], evidence: common },
    denominator: { state: 'known', literal: '100 percent of stated interest', quantity: null, unit: null, evidence: common },
    rounding: 'As stated; no automatic tolerance', validity,
    entries: [targetA, targetB].map((target, i) => ({ pin: pin('declaration_entry', uuid(20 + i)), target,
      literalLabel: `CONTROL-${i ? 'B_PRIVATE' : 'A'}`, literalShare: '50%', fraction: { numerator: '1', denominator: '2' },
      evidence: evidence(target.ref, i ? 'B_PRIVATE_CLAUSE' : 'A_CONTROL_CLAUSE'), validity })),
  });
}
test('exact decimals, complete 99.5%, partial 99.5%, unknown denominator and duplicate members stay distinct', () => {
  assert.deepEqual(parseLiteralRational('450.75 sq ft'), { numerator: '1803', denominator: '4', unit: 'sq ft' });
  assert.deepEqual(parseLiteralRational('0.873%'), { numerator: '873', denominator: '100000', unit: '%' });
  assert.throws(() => parseLiteralRational('1e-4%'));
  const i = input();
  assert.equal(assessDeclaration(i).state, 'reconciled');
  assert.equal(assessDeclaration({ ...i, allocationSubject: 'limited_common_property',
    population: { ...i.population, declaredCount: 1, targets: [targetA] },
    entries: [{ ...i.entries[0], literalShare: '100%', fraction: { numerator: '1', denominator: '1' } }] }).state, 'reconciled');
  const almost = { ...i, entries: [{ ...i.entries[0], fraction: { numerator: '99', denominator: '200' } }, i.entries[1]] };
  assert.deepEqual(assessDeclaration(almost).knownSubtotal, { numerator: '199', denominator: '200' });
  assert.equal(assessDeclaration(almost).state, 'arithmetic_mismatch');
  assert.equal(assessDeclaration({ ...almost, population: { ...i.population, status: 'partial' } }).state, 'not_assessed_incomplete_population');
  assert.equal(assessDeclaration({ ...i, population: { ...i.population, status: 'unknown' } }).state, 'not_assessed_incomplete_population');
  assert.equal(assessDeclaration({ ...i, denominator: { ...i.denominator, state: 'withheld', literal: null } }).state, 'not_assessed_denominator');
  const duplicate = assessDeclaration({ ...i, entries: [i.entries[0], { ...i.entries[0], pin: pin('declaration_entry', uuid(22)) }] });
  assert.equal(duplicate.state, 'conflicting_population');
  assert.equal(duplicate.ambiguousCount, 1); assert.equal(duplicate.missingCount, 1);
  assert.deepEqual(duplicate.knownSubtotal, { numerator: '0', denominator: '1' });
  const big = '123456789012345678901234567890123456789012345678901234567890';
  assert.equal(assessDeclaration({ ...i, entries: i.entries.map(e => ({ ...e, fraction: { numerator: big, denominator: (BigInt(big) * 2n).toString() } })) }).state, 'reconciled');
});

type State = { [key: string]: any[] };
const empty = (): State => Object.fromEntries(['proposals', 'reviews', 'declarations', 'entries', 'apps', 'links',
  'snapshots', 'bodies', 'receipts', 'outbox', 'streams', 'fences'].map(k => [k, []]));
class ControlDb {
  state = empty(); queries: string[] = []; connects = 0; releases = 0;
  failAcceptedEvent = false; staleFence = false; archived = false; wrongSource = false;
  source = { id: sourceId, case_id: caseId, revision: 1, sha256: 'a'.repeat(64), bytes: 123,
    object_key: 'technical-control-only', mime_type: 'application/pdf', inspection: {} };
  records = [targetA, targetB].map(p => ({ id: p.ref.id, site_id: siteId, revision: 1, kind: 'space',
    label: 'Technical control record', body: {}, project_status: null }));
  client = { release: () => { this.releases++; }, query: async (sql: string, v: any[] = []) => this.query(sql, v) } as unknown as PoolClient;
  baseline?: State;
  pool = { connect: async () => { this.connects++; return this.client; } } as unknown as Pool;
  async query(sql: string, v: any[]) {
    const q = sql.replace(/\s+/g, ' ').trim(); this.queries.push(q);
    const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (q === 'BEGIN') { this.baseline = structuredClone(this.state); return result(); }
    if (q === 'ROLLBACK') { this.state = this.baseline!; return result(); }
    if (q === 'COMMIT' || q.startsWith('SET TRANSACTION') || q.includes('pg_advisory_xact_lock')) return result();
    if (q.startsWith('WITH RECURSIVE evidence_sources')) return result([{ id: caseId }]);
    if (q.startsWith('INSERT INTO usp_declaration_scope_fences')) { if (!this.state.fences.length) this.state.fences.push({ site: v[0], fence: 0 }); return result(); }
    if (q.startsWith('SELECT fence FROM usp_declaration_scope_fences')) {
      if (this.staleFence) throw Object.assign(new Error('CONTROL stale repeatable-read fence'), { code: '40001' });
      return result(this.state.fences);
    }
    if (q.startsWith('UPDATE usp_declaration_scope_fences')) { this.state.fences[0].fence++; return result(); }
    if (q.startsWith('SELECT id FROM registry_sites')) return result([{ id: siteId }]);
    if (q.startsWith('SELECT * FROM registry_sites')) return result([{ id: siteId, revision: 1, frame: { id: 'LOCAL', horizontalUnit: 'm' } }]);
    if (q.startsWith('SELECT r.*,')) return result(this.records);
    if (q.startsWith('SELECT r.id,r.revision')) return result(this.records.filter(r => v[1].includes(r.id)));
    if (q.includes('FROM usp_project_lineage') || q.includes('FROM registry_aliases') || q.includes('FROM physical_features')
      || q.includes('FROM import_packages') || q.includes('FROM usp_geometry_qualifications')) return result();
    if (q.startsWith('SELECT s.* FROM sources')) return result([this.source]);
    if (q.startsWith('SELECT * FROM sources WHERE')) return result(v[0] === sourceId ? [{ ...this.source,
      sha256: this.wrongSource ? 'b'.repeat(64) : this.source.sha256 }] : []);
    if (q.startsWith('SELECT site_id,archived FROM cases')) return result([{ site_id: siteId, archived: this.archived }]);
    if (q.startsWith('SELECT DISTINCT ON(id)')) {
      const latest = new Map<string, any>();
      for (const d of this.state.declarations) if (!latest.has(d.id) || latest.get(d.id).revision < d.revision) latest.set(d.id, d);
      return result([...latest.values()].sort((a, b) => a.id.localeCompare(b.id)));
    }
    if (q.startsWith('SELECT site_id,revision,body FROM usp_declaration_revisions'))
      return result(this.state.declarations.filter(d => d.id === v[0]).sort((a, b) => b.revision - a.revision).slice(0, 1));
    if (q.startsWith('SELECT body FROM usp_declaration_revisions'))
      return result(this.state.declarations.filter(d => d.id === v[0] && d.revision > v[1]).sort((a, b) => a.revision - b.revision));
    if (q.startsWith('SELECT declaration_id,body FROM usp_declaration_entries'))
      return result(this.state.entries.filter(d => d.id === v[0]).sort((a, b) => b.revision - a.revision).slice(0, 1));
    if (q.startsWith('SELECT id,revision,body FROM usp_declaration_')) {
      const table = q.includes('usp_declaration_entries') ? 'entries' : 'apps';
      return result(this.state[table].filter(d => d.declaration_id === v[0] && d.declaration_revision === v[1]));
    }
    if (q.startsWith('SELECT body FROM usp_snapshots')) {
      const row = this.state.snapshots.find(r => r.id === v[0] && (v.length === 2 ? r.digest === v[1] : r.scope_id === v[1] && r.digest === v[2]));
      return result(row ? [row] : []);
    }
    if (q.includes('FROM usp_snapshot_bodies')) {
      const quoted = /namespace='([^']+)'/.exec(q)?.[1];
      const namespace = quoted ?? v[1];
      let rows = this.state.bodies.filter(b => b.manifest_id === v[0] && b.namespace === namespace);
      if (q.includes('object_id=')) rows = rows.filter(b => b.object_id === (quoted ? v[1] : v[2]) && b.revision === (quoted ? v[2] : v[3]));
      return result(rows);
    }
    if (q.startsWith('SELECT command_sha256,body FROM usp_command_receipts')) return result(this.state.receipts.filter(r =>
      r.subject === v[0] && r.scope_key === v[1] && r.operation === v[2] && r.request_key === v[3]));
    if (q.startsWith('SELECT * FROM usp_declaration_proposals')) return result(this.state.proposals.filter(p => p.id === v[0] && p.site_id === v[1]));
    if (q.startsWith('SELECT * FROM usp_declaration_reviews')) return result(this.state.reviews.filter(p => p.id === v[0] && p.proposal_id === v[1] && p.site_id === v[2]));
    if (q.startsWith('SELECT id FROM usp_declaration_reviews')) return result(this.state.reviews.filter(p => p.proposal_id === v[0]));
    if (q.startsWith('SELECT 1 FROM usp_declaration_commit_links')) return result(this.state.links.filter(p => p.proposal_id === v[0] || v[1] && p.review_id === v[1]));
    if (q.startsWith('INSERT INTO usp_snapshots')) { this.state.snapshots.push({ id: v[0], scope_id: v[1], digest: v[2], body: structuredClone(v[3]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_snapshot_bodies')) { this.state.bodies.push({ manifest_id: v[0], namespace: v[1], object_id: v[2], revision: v[3], body_sha256: v[4], body: structuredClone(v[5]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_declaration_proposals')) { this.state.proposals.push({ id: v[0], site_id: v[1], manifest_id: v[2], subject: v[3], version: 1, body: structuredClone(v[4]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_declaration_reviews')) { this.state.reviews.push({ id: v[0], proposal_id: v[1], site_id: v[2], subject: v[3], body: structuredClone(v[4]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_declaration_revisions')) { this.state.declarations.push({ id: v[0], revision: v[1], site_id: v[2], proposal_id: v[3], review_id: v[4], body: structuredClone(v[5]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_declaration_entries') || q.startsWith('INSERT INTO usp_declaration_applicability')) {
      this.state[q.includes('usp_declaration_entries') ? 'entries' : 'apps'].push({ id: v[0], revision: v[1], declaration_id: v[2], declaration_revision: v[3], body: structuredClone(v[4]) }); return result();
    }
    if (q.startsWith('INSERT INTO usp_declaration_commit_links')) { this.state.links.push({ proposal_id: v[0], review_id: v[1], receipt_id: v[2] }); return result(); }
    if (q.startsWith('INSERT INTO usp_command_receipts')) { this.state.receipts.push({ id: v[0], subject: v[1], scope_key: v[2], operation: v[3], request_key: v[4], command_sha256: v[5], body: structuredClone(v[6]) }); return result(); }
    if (q.startsWith('INSERT INTO usp_outbox_streams')) { if (!this.state.streams.some(s => s.id === v[0])) this.state.streams.push({ id: v[0], sequence: 0 }); return result(); }
    if (q.startsWith('UPDATE usp_outbox_streams')) { const stream = this.state.streams.find(s => s.id === v[0]); return result([{ sequence: String(++stream.sequence) }]); }
    if (q.startsWith('INSERT INTO usp_outbox(')) {
      if (this.failAcceptedEvent && v[2].type === 'declaration.accepted') throw new Error('CONTROL failure after accepted writes and post-write snapshot');
      this.state.outbox.push({ stream: v[0], sequence: v[1], body: structuredClone(v[2]) }); return result();
    }
    throw new Error(`Unmodelled control SQL: ${q}`);
  }
}
async function withDb(action: (db: ControlDb, ctx: ReturnType<typeof localRequestContext>) => Promise<void>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const oldPool = globals.ulpinPool, oldSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  const db = new ControlDb(); globals.ulpinPool = db.pool; process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'declaration-technical-control';
  try { await action(db, localRequestContext('control-request')); assert.equal(db.connects, db.releases); }
  finally { globals.ulpinPool = oldPool; if (oldSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT; else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = oldSubject; }
}
async function draft(db: ControlDb, ctx: ReturnType<typeof localRequestContext>, revision = 1, partial = false) {
  const manifest = await captureRegistrySnapshotTx(db.client, ctx, siteId, { kind: 'targets', pins: [targetA, targetB] });
  const payload = input();
  const amended = { ...payload, validity: revision === 1 ? validity : { ...validity, from: '2026-06-01' },
    population: { ...payload.population, status: partial ? 'partial' : 'complete' },
    entries: payload.entries.map(e => ({ ...e, pin: { ...e.pin, revision } })) };
  const command = UspPrepareProposalSchema.parse({ kind: 'declaration', scope: manifest.scope, targets: [targetA, targetB],
    evidence: [], guard: { mode: 'create', requestKey: `draft-${revision}` }, changes: [{ kind: 'declaration', action: revision === 1 ? 'create' : 'amend',
      declaration: pin('declaration', declarationId, revision), instrument: pin('source_revision', sourceId),
      entries: amended.entries.map(e => e.pin), applicability: [], supersedes: revision === 1 ? null : pin('declaration', declarationId, revision - 1), payload: amended }] });
  const prepared = await prepareProposal(ctx, command);
  assert.equal('assessment' in prepared, true);
  assert.deepEqual(await prepareProposal(ctx, command), prepared);
  return { command, prepared, manifest };
}
async function reviewed(db: ControlDb, ctx: ReturnType<typeof localRequestContext>, revision = 1, consent = true) {
  const d = await draft(db, ctx, revision);
  const review = UspReviewDeclarationSchema.parse({ proposalId: d.prepared.proposalId, scope: d.manifest.scope,
    guard: { mode: 'update', expectedVersion: 1, expectedManifestId: d.manifest.id, requestKey: `review-${revision}` },
    acknowledgement: DECLARATION_ACKNOWLEDGEMENT, sourceAcknowledged: true, populationAcknowledged: true,
    assessmentState: 'reconciled', reason: 'Explicit control review of source, population and arithmetic',
    consentEvidence: revision > 1 && consent ? [input().instrument] : [],
    applicability: input().entries.map(e => ({ target: e.target, state: 'applicable', evidence: e.evidence,
      reason: e.target.ref.id === targetB.ref.id ? 'B_PRIVATE_REVIEW' : 'Selected control clause reviewed', purpose: 'declared_share', relationPath: [], validity })),
  });
  const reviewResult = await reviewDeclaration(ctx, review);
  const commit = UspCommitProposalSchema.parse({ kind: 'declaration', proposalId: d.prepared.proposalId,
    reviewId: reviewResult.reviewId, scope: d.manifest.scope, acknowledgement: DECLARATION_ACKNOWLEDGEMENT,
    guard: { mode: 'update', expectedVersion: 1, expectedManifestId: d.manifest.id, requestKey: `accept-${revision}` } });
  return { ...d, review, reviewResult, commit };
}

test('existing registry snapshot shape/digest remains exact with zero declarations; declaration members change the digest', async () => withDb(async (db, ctx) => {
  const m = await captureRegistrySnapshotTx(db.client, ctx, siteId, { kind: 'site' });
  const expected = fingerprint({ siteId, world: `registry-site/${siteId}`, stage: 'recorded', selection: { kind: 'site', pins: [] },
    members: m.members, frame: { id: 'LOCAL', horizontalUnit: 'm' }, policyVersion: ctx.policyVersion });
  assert.equal(m.digest, expected);
  assert.deepEqual(m.declarations, { state: 'not_assessed', declarationRevisions: [], entryRevisions: [], applicabilityRevisions: [] });
  assert.deepEqual(declarationMembership(m.members), m.declarations);
  assert.equal(UspSnapshotManifestSchema.safeParse(m).success, true);
}));
test('draft → review → acceptance uses the caller transaction; selected read and general bodies hide sibling details', async () => withDb(async (db, ctx) => {
  const r = await reviewed(db, ctx);
  const draftRead = await readDeclarationProposal(ctx, { proposalId: r.prepared.proposalId, scope: r.manifest.scope });
  assert.equal(draftRead.input.entries.length, 2);
  assert.equal(draftRead.state, 'reviewed'); assert.equal(draftRead.reviewId, r.reviewResult.reviewId);
  assert.deepEqual(await reviewDeclaration(ctx, r.review), r.reviewResult);
  await assert.rejects(reviewDeclaration(ctx, { ...r.review, guard: { ...r.review.guard, requestKey: 'second-review' } }), (e: any) => e.status === 409);
  const connectsBefore = db.connects;
  const receipt = await commitProposal(ctx, r.commit);
  assert.equal(db.connects, connectsBefore + 1); // no nested writer/snapshot/receipt transaction
  assert.equal(receipt.snapshot.snapshotDigest === r.manifest.digest, false);
  assert.equal(db.state.declarations.length, 1); assert.equal(db.state.entries.length, 2);
  assert.equal(db.state.links[0].receipt_id, receipt.receiptId);
  assert.equal(db.state.outbox.at(-1).body.scope.snapshotDigest, receipt.snapshot.snapshotDigest);
  const selected = await readSelectedDeclaration(ctx, { scope: receipt.snapshot, target: targetA,
    declaration: pin('declaration', declarationId), validAt: '2026-03-01' });
  assert.equal(selected.entry!.literalLabel, 'CONTROL-A'); assert.equal(selected.packetState, 'available');
  assert.equal(JSON.stringify(selected).includes('B_PRIVATE'), false);
  const onlyA = await captureRegistrySnapshotTx(db.client, ctx, siteId, { kind: 'targets', pins: [targetA] });
  await assert.rejects(readSelectedDeclaration(ctx, { scope: onlyA.scope, target: targetB,
    declaration: pin('declaration', declarationId), validAt: '2026-03-01' }));
  const general = await readSnapshotBody(ctx, receipt.snapshot, pin('declaration', declarationId));
  assert.equal(JSON.stringify(general).includes('CONTROL-A'), false);
  assert.equal(JSON.stringify(general).includes('B_PRIVATE'), false);
  const sibling = declarationSnapshotView('declaration_entry', db.state.entries[1].body);
  assert.equal(JSON.stringify(sibling).includes('B_PRIVATE'), false);
  const before = structuredClone(db.state);
  assert.deepEqual(await commitProposal(ctx, r.commit), receipt);
  assert.deepEqual(db.state, before);
  await assert.rejects(commitProposal(ctx, { ...r.commit, proposalId: uuid(99) }), (e: any) => e.status === 409);
  await assert.rejects(commitProposal(ctx, { ...r.commit, acknowledgement: 'different input' }));
}));
test('post-write failure rolls back revisions, snapshot, applicability, receipt and outbox; retry succeeds', async () => withDb(async (db, ctx) => {
  const r = await reviewed(db, ctx); const before = structuredClone(db.state);
  db.failAcceptedEvent = true;
  await assert.rejects(commitProposal(ctx, r.commit), /CONTROL failure/);
  assert.deepEqual(db.state, before);
  assert.equal(db.queries.at(-1), 'ROLLBACK');
  db.failAcceptedEvent = false;
  await commitProposal(ctx, r.commit);
  assert.equal(db.state.declarations.length, 1);
}));
test('changed population, wrong source receipt, revoked case and stale review each fail without accepted writes', async () => withDb(async (db, ctx) => {
  const r = await reviewed(db, ctx);
  db.records[0].revision = 2;
  await assert.rejects(commitProposal(ctx, r.commit)); db.records[0].revision = 1;
  db.wrongSource = true;
  await assert.rejects(commitProposal(ctx, r.commit)); db.wrongSource = false;
  db.archived = true;
  await assert.rejects(commitProposal(ctx, r.commit)); db.archived = false;
  db.staleFence = true;
  await assert.rejects(commitProposal(ctx, r.commit), (e: any) => e.status === 409 && e.code === 'DECLARATION_REFRESH'); db.staleFence = false;
  await assert.rejects(commitProposal(ctx, { ...r.commit, guard: { ...r.commit.guard, mode: 'update', expectedVersion: 2 } }));
  assert.equal(db.state.declarations.length, 0); assert.equal(db.state.entries.length, 0);
  assert.equal(db.state.receipts.filter(r => r.operation === 'commit_declaration').length, 0);
  assert.equal(db.state.outbox.some(e => e.body.type === 'declaration.accepted'), false);
  const caseLock = db.queries.findIndex(q => q.startsWith('WITH RECURSIVE'));
  assert.ok(caseLock < db.queries.findIndex(q => q.includes("'physical-area-recording'")));
}));
test('amendment keeps original entries/effective period; missing consent is withheld downstream; historical reads stay pinned', async () => withDb(async (db, ctx) => {
  const r1 = await reviewed(db, ctx); const receipt1 = await commitProposal(ctx, r1.commit);
  const first = structuredClone(db.state.declarations[0]);
  const r2 = await reviewed(db, ctx, 2, false); const receipt2 = await commitProposal(ctx, r2.commit);
  assert.deepEqual(db.state.declarations[0], first);
  assert.equal(db.state.entries.filter(e => e.revision === 1).length, 2);
  assert.equal(db.state.entries.filter(e => e.revision === 2).length, 2);
  assert.notEqual(receipt1.snapshot.snapshotDigest, receipt2.snapshot.snapshotDigest);
  const historical = await readSelectedDeclaration(ctx, { scope: receipt1.snapshot, target: targetA,
    declaration: pin('declaration', declarationId), validAt: '2026-03-01' });
  assert.equal(historical.entry!.pin.revision, 1); assert.equal(historical.packetState, 'available');
  const laterOld = await readSelectedDeclaration(ctx, { scope: receipt1.snapshot, target: targetA,
    declaration: pin('declaration', declarationId), validAt: '2026-07-01' });
  assert.equal(laterOld.packetState, 'not_assessed');
  const amended = await readSelectedDeclaration(ctx, { scope: receipt2.snapshot, target: targetA,
    declaration: pin('declaration', declarationId, 2), validAt: '2026-07-01' });
  assert.equal(amended.applicability!.consentStatus, 'not_assessed'); assert.equal(amended.packetState, 'not_assessed');
  assert.equal(amended.supersedes!.revision, 1);
}));
