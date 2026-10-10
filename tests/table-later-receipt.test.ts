import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AnyStreamingInputSchema, ChunkMappingInputSchema, TabularMappingReceiptSchema,
  type TabularMappingPlan } from '../packages/contracts/src/usp';
import { sha256 } from '../packages/server/src/infrastructure/storage';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { localOperatorSubject } from '../packages/server/src/modules/usp/principal';
import { ingestionBinding } from '../packages/server/src/modules/usp/ingestion/events';
import { streamingReaderSha } from '../packages/server/src/modules/usp/ingestion/streaming-vector';
import { assertChunkMappingInputTx, chunkMappingReadContextTx, ChunkMappingService } from
  '../packages/server/src/modules/usp/ingestion/chunk-mapping';
import { ManualIngestionService, tabularProfileForLockedSourceTx } from
  '../packages/server/src/modules/usp/ingestion/service';
import { inspectTabularSource } from '../packages/server/src/modules/usp/ingestion/tabular-source';
import { manualTeacherPlan } from '../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { officerTabularPlan, validateTabularRecipe } from '../packages/server/src/modules/usp/ingestion/tabular-recipe';
import { developmentManifest } from '../scripts/agent/t1-sources';
import { localReaderControl, ManualCaseControl, servicePoolControl } from './reader-pin-control';

// One public D8 development table, read only; the case, jobs and later receipts are SQL protocol controls.
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const table = developmentTable();
const stale = (error: any) => error?.status === 409;

function developmentTable() {
  const asset = developmentManifest().assets.find(item => item.id === 'mi-d10-01.csv');
  assert(asset);
  const bytes = readFileSync(asset.original.externalPath);
  assert.equal(sha256(bytes), asset.original.sha256);
  return { bytes, inventory: inspectTabularSource(bytes, selection) };
}

function tableCase() {
  const id = randomUUID();
  const hash = sha256(table.bytes);
  return new ManualCaseControl({ id, family_id: id, revision: 1, sha256: hash, bytes: table.bytes.length,
    object_key: `sources/${id}/${hash}`, profile: 'tabular-manual-v1', inspection: {
      actor: localOperatorSubject(), manualProfile: { version: 'manual-tabular/1', ...table.inventory } } });
}

function queueRaw(c: ManualCaseControl) {
  const binding = ingestionBinding(c.caseId);
  const base = { version: 'geojson-stream/2', jobId: randomUUID(), caseId: c.caseId, caseRevision: c.revision,
    sourceId: c.source.id, sourceRevision: c.source.revision, sourceFamilyId: c.source.family_id,
    sourceSha256: c.source.sha256, sourceBytes: c.source.bytes, objectKey: c.source.object_key, framing: 'tabular',
    tabular: table.inventory.tabular, subject: binding.subject, accessBinding: binding.access,
    readerSha256: streamingReaderSha() };
  const raw = AnyStreamingInputSchema.parse({ ...base, inputFingerprint: fingerprint(base) });
  c.enroll(raw, 'streaming-vector');
  return raw;
}

async function officerPlan(c: ManualCaseControl): Promise<TabularMappingPlan> {
  const profile = await tabularProfileForLockedSourceTx(c.client, c.caseId, c.revision, c.source);
  const mapping = manualTeacherPlan(profile.profile, 'TEACHER_REPLAY_UNAVAILABLE').plan;
  const plan = officerTabularPlan({ version: 'manual-tabular/1', mode: 'manual_mapping', source: profile.source,
    caseId: c.caseId, workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
    tabular: profile.tabular, mapping, decisions: mapping.fields.map(field => ({ sourceField: field.sourceField,
      reason: 'Protocol control, not property truth.' })) }, localOperatorSubject());
  validateTabularRecipe(plan, profile, table.bytes);
  return plan;
}

/** Record an approval the way the approve command stores it, over the given plan. */
function approve(c: ManualCaseControl, plan: TabularMappingPlan, subject = localOperatorSubject()) {
  const planHash = fingerprint({ plan, destination: null });
  const at = new Date().toISOString();
  c.recipe = TabularMappingReceiptSchema.parse({ id: c.recipe?.id ?? randomUUID(), revision: 2, state: 'approved',
    plan, destination: null, planHash, authoredBy: subject, authoredAt: at,
    approval: { subject, at, planHash, provenance: 'server_configured_local_operator' }, execution: null });
}

async function enqueue(c: ManualCaseControl, rawJobId: string) {
  const status = await new ChunkMappingService().enqueue(c.caseId, c.source.id, { requestKey: randomUUID(), rawJobId,
    expectedCaseRevision: c.revision, expectedSourceRevision: c.source.revision, sourceSha256: c.source.sha256,
    tabular: table.inventory.tabular });
  return ChunkMappingInputSchema.parse(c.jobs.get(status.jobId)!.payload);
}

async function readFreshness(c: ManualCaseControl, input: ReturnType<typeof ChunkMappingInputSchema.parse>) {
  const { freshness } = await chunkMappingReadContextTx(c.client, input, c.caseId, c.source.id, input.jobId,
    fingerprint(input));
  return freshness;
}

/** A queued table mapping on its approved recipe: revision 1, before any other file. */
async function approvedMapping(c: ManualCaseControl) {
  const raw = queueRaw(c);
  approve(c, await officerPlan(c));
  const input = await enqueue(c, raw.jobId);
  assert.equal(input.route, 'approved_recipe');
  return input;
}

async function assertRunsOnRecipe(c: ManualCaseControl, input: ReturnType<typeof ChunkMappingInputSchema.parse>) {
  const current = await assertChunkMappingInputTx(c.client, input);
  assert.equal(current.approved?.receipt.planHash, input.planHash);
  assert(current.profile?.version === 'manual-tabular/1');
  assert(current.approved?.receipt.plan.version === 'manual-tabular/1');
  validateTabularRecipe(current.approved.receipt.plan, current.profile, table.bytes);
}

test('good input: a table mapping on its approved recipe survives a table and a GeoJSON arriving later', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const input = await approvedMapping(c);
      c.receive(); // another table, after admission and before the claim
      c.receive(); // a GeoJSON, before the claim
      await assertRunsOnRecipe(c, input);
      c.receive(); // between claim and completion
      c.receive();
      await assertRunsOnRecipe(c, input);
      c.receive(); // after completion
      assert.deepEqual(await readFreshness(c, input), { current: true, reasons: [] });
      const status = await new ChunkMappingService().status(c.caseId, c.source.id, input.jobId);
      assert.equal(status.current, true);
      assert.equal(status.route, 'approved_recipe');
    });
  }));

test('difficult input: a new revision of the table itself still refuses the job and its read says why', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const input = await approvedMapping(c);
      c.receive();
      c.receive(true);
      await assert.rejects(() => assertChunkMappingInputTx(c.client, input), stale);
      assert.deepEqual(await readFreshness(c, input), { current: false, reasons: ['source_superseded'] });
    });
  }));

test('a mapping enqueued after a later file, over a raw job queued before it, is admitted and runs', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const raw = queueRaw(c);
      c.receive();
      const input = await enqueue(c, raw.jobId);
      assert.equal(input.caseRevision, 1);
      assert.equal(input.route, 'proposal_only');
      c.receive();
      assert.equal((await assertChunkMappingInputTx(c.client, input)).profile?.workspaceRevision, 3);
      assert.deepEqual(await readFreshness(c, input), { current: true, reasons: [] });
    });
  }));

test('an approved recipe made at revision n is the route of a mapping admitted at n+2', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      approve(c, await officerPlan(c));
      const planHash = c.recipe!.planHash;
      c.receive();
      c.receive();
      const input = await enqueue(c, queueRaw(c).jobId);
      assert.equal(input.route, 'approved_recipe');
      assert.equal(input.planHash, planHash);
      assert.equal(c.recipe!.plan.workspaceRevision, 1);
    });
  }));

const moved: [string, (plan: any, c: ManualCaseControl) => void][] = [
  ['schema fingerprint', plan => { plan.source.schemaFingerprint = '0'.repeat(64); }],
  ['source bytes', plan => { plan.source.sourceSha256 = '0'.repeat(64); }],
  ['tabular selection pin', plan => { plan.tabular.developmentAssetId = 'mi-d10-02.csv'; }],
  ['workspace revision behind the pin', (plan, c) => { plan.workspaceRevision = c.revision + 1; }],
  ['equal revisions with another fingerprint', (plan, c) => {
    plan.workspaceRevision = c.revision;
    plan.workspaceFingerprint = '0'.repeat(64);
  }],
];

for (const [name, change] of moved) {
  test(`an approved table recipe still refuses a changed ${name}`, () => localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const input = await approvedMapping(c);
      c.receive();
      const plan = structuredClone(c.recipe!.plan);
      change(plan, c);
      approve(c, plan);
      await assert.rejects(() => assertChunkMappingInputTx(c.client, input), stale);
    });
  }));
}

test('an approved table recipe still refuses an approval recorded by another subject', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const input = await approvedMapping(c);
      c.receive();
      approve(c, c.recipe!.plan as TabularMappingPlan, 'k15-another-operator');
      await assert.rejects(() => assertChunkMappingInputTx(c.client, input), stale);
    });
  }));

test('a table recipe authored at revision n is approved at n+1 and the source pin still decides', () =>
  localReaderControl(() => {
    const c = tableCase();
    return servicePoolControl(c, table.bytes, async () => {
      const service = new ManualIngestionService();
      const plan = await officerPlan(c);
      const authored = await service.author(c.caseId, c.source.id, { requestKey: randomUUID(),
        expectedRecipeRevision: 0, destination: null, plan });
      c.receive();
      queueRaw(c);
      const approved = await service.decide(c.caseId, authored.id, { requestKey: randomUUID(),
        expectedRecipeRevision: authored.revision }, 'approve');
      assert.equal(approved.state, 'approved');
      assert.equal(approved.plan.workspaceRevision, 1);
      // The approval asks both enqueues with the case revision of now, so the later file does not lose the job.
      assert.equal([...c.jobs.values()].some(job => job.operation === 'chunk-mapping'), true);
      c.receive(true);
      await assert.rejects(() => service.author(c.caseId, c.source.id, { requestKey: randomUUID(),
        expectedRecipeRevision: approved.revision, destination: null, plan }), stale);
    });
  }));
