import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SourceSpaceRequestSchema } from '@ulpin/contracts';
import { PacketRegionProvenanceSchema, PacketRegionRequestSchema }
  from '../../../../../contracts/src/packet-region';
import { PACKET_PDF_RECIPE, UspPacketPlanEntriesSchema } from '../../../../../contracts/src/usp/packet-pdf';
import { towerRequest } from '../../officer/source-spaces.test-fixture';
import { assignProjectCode } from '../project-identity';
import { fingerprint } from '../../cases/domain';
import { control, errorCode, prepare, type SourceFixture } from '../source-stated-identity.test-fixture';
import { readPacketPlanEntries } from './plan-entries';
import { confirmPdfPacketPlan, createPdfPacketPlan, type PdfPacketIo } from './pdf-service';
import { packetRegionTransform } from './region-extract';

// Retained Tower 3 crop, as in the neighbouring source-stated-binding test. No runtime/original I/O.
const root = 'E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
const worker = JSON.parse(readFileSync(`${root}/result.json`, 'utf8'));
const bytes = readFileSync(`${root}/region.png`);
const request = SourceSpaceRequestSchema.parse({ ...towerRequest, requestKey: randomUUID(), space: {
  label: 'UNIT-3B', evidence: { ...towerRequest.space.evidence, region: [2265, 1545, 2530, 1680] },
} });

function cropIo(f: SourceFixture): PdfPacketIo {
  return { pages: f.db.deps.pages, extract: async (sourceId, _page, raw) => {
    const selection = PacketRegionRequestSchema.parse(raw);
    return { bytes, provenance: PacketRegionProvenanceSchema.parse({ ...worker, version: 'packet-region/1',
      selection: selection.selection, transform: packetRegionTransform(selection.selection),
      purpose: selection.purpose, sourceId, sourceRevision: 1, caseRevision: 1,
      caseId: f.memory.sources.find(source => source.id === sourceId)!.case_id }) };
  } } as PdfPacketIo;
}

async function assigned(f: SourceFixture) {
  const { command } = await prepare(f);
  const receipt = await assignProjectCode(f.ctx, command);
  return { scope: receipt.snapshot, target: receipt.after[0] };
}

const writes = (queries: string[]) => queries.filter(sql => /^(INSERT|UPDATE|DELETE)/.test(sql));

test('entries read answers the handle accepted by real plan create and writes nothing', () => control(async f => {
  const command = await assigned(f);
  const start = f.memory.queries.length;
  const answer = UspPacketPlanEntriesSchema.parse(await readPacketPlanEntries(f.ctx, command));
  assert.deepEqual(await readPacketPlanEntries(f.ctx, command), answer);
  assert.deepEqual(writes(f.memory.queries.slice(start)), []);
  const [entry] = answer.entries;
  assert.equal(entry.label, request.space.label);
  assert.equal(entry.kind, 'source_statement');
  assert.equal(entry.includable, true);
  assert.deepEqual(entry.citation, { sourceId: request.space.evidence.sourceId, revision: 1,
    locator: f.db.rows.find(row => row.id === f.recorded.spaceId).body.evidence[0].locator,
    page: 1, region: request.space.evidence.region });
  const input = { ...command, purpose: 'record_evidence', format: 'pdf', recipe: PACKET_PDF_RECIPE,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), entries: [{ bindingId: entry.bindingId,
      required: true, inclusionReason: request.reason }] };
  const plan = await createPdfPacketPlan(f.ctx,
    { input, guard: { mode: 'create', requestKey: randomUUID() } }, cropIo(f));
  assert.equal(plan.entries[0].state, 'included');
  assert.equal(plan.requiredContext, 'available');
  const changed = `${entry.bindingId[0] === 'a' ? 'b' : 'a'}${entry.bindingId.slice(1)}`;
  const blocked = await createPdfPacketPlan(f.ctx, { input: { ...input,
    entries: [{ ...input.entries[0], bindingId: changed }] },
    guard: { mode: 'create', requestKey: randomUUID() } }, cropIo(f));
  assert.equal(blocked.entries[0].reasonCode, 'committed_region_binding_unavailable');
  await assert.rejects(confirmPdfPacketPlan(f.ctx, { planId: blocked.planId, version: 1,
    planSha256: blocked.planSha256, reviewed: true, guard: { mode: 'update', requestKey: randomUUID(),
      expectedVersion: 1, expectedManifestId: command.scope.manifestId } }), errorCode('PACKET_PLAN_BLOCKED'));
}, request));

test('outside-scope target, changed access and unavailable original answer no entry or write', () => control(async f => {
  const command = await assigned(f);
  const start = f.memory.queries.length;
  await assert.rejects(readPacketPlanEntries(f.ctx, { ...command,
    target: { ...command.target, ref: { ...command.target.ref, id: randomUUID() } } }),
  errorCode('PACKET_PLAN_SELECTION'));
  await assert.rejects(readPacketPlanEntries({ ...f.ctx, accessViewId: 'other' }, command),
    errorCode('STALE_REVISION'));
  f.memory.archived = true;
  await assert.rejects(readPacketPlanEntries(f.ctx, command), errorCode('REGISTRY_REGION_SOURCE_DENIED'));
  assert.deepEqual(writes(f.memory.queries.slice(start)), []);
}, request));

test('other target profiles are explicitly refused without writes', () => control(async f => {
  const command = await assigned(f);
  // Protocol-only unsupported profile; keep the captured member integrity exact for targetTx.
  const captured = f.memory.captured.get(command.scope.manifestId)!.find(
    row => row.object_id === command.target.ref.id);
  captured.body.kind = 'floor';
  captured.body_sha256 = fingerprint(captured.body);
  const manifest = f.memory.snapshots.get(command.scope.manifestId);
  const member = manifest.members.find((item: any) => item.pin.ref.id === command.target.ref.id);
  member.bodySha256 = captured.body_sha256;
  member.bodyRef = fingerprint(['registry_record', captured.object_id, captured.revision, captured.body]);
  const start = f.memory.queries.length;
  await assert.rejects(readPacketPlanEntries(f.ctx, command),
    errorCode('PACKET_PLAN_ENTRIES_SOURCE_ONLY'));
  assert.deepEqual(writes(f.memory.queries.slice(start)), []);
}, request));
