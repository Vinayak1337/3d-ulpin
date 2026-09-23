import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UspResolvedTargetSchema, UspSnapshotManifestSchema, UspPrepareProposalSchema,
  UspCommitReceiptSchema, UspJobProjectionSchema, UspReleaseDecisionSchema,
  UspPacket0ReceiptSchema, UspErrorEnvelopeSchema, uspServiceResultSchema,
  UspModelGatewayRequestSchema, UspScanReceiptSchema, UspSendReceiptResultSchema,
  parseUsp,
} from '../packages/contracts/src/usp/index';
import { hasVerticalMembership, storedRevision } from '../apps/web/lib/server/usp/snapshots';
import { renderPacket0, selectExactPart } from '../apps/web/lib/server/usp/packet0';
import { uspFixtures } from './fixtures/usp-common';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const pin = { ref: { namespace: 'registry_record', id: '000127-U-A101' }, revision: 2 };
const source = { ...uspFixtures.evidence, target: pin.ref };
const scope = uspFixtures.scope;
const target = {
  pin, scope, backing: { kind: 'registry', siteId: 'site-1', recordId: pin.ref.id },
  kind: 'space', label: 'A101', identifiers: [{ scheme: 'application-3d-ulpin',
    value: 'B001:S001', issuer: null, source: null, state: 'reviewed' }],
  relations: [], representations: [], evidence: [source], recordState: 'recorded', capabilities: ['source-evidence'],
};

test('producer bytes are consumed as available, pending, unavailable and safe error envelopes', () => {
  const result = uspServiceResultSchema(UspResolvedTargetSchema);
  const produced = [
    { state: 'available', data: target },
    { state: 'pending', jobId: 'job-1' },
    { state: 'not_assessed', reasonCode: 'producer_unregistered' },
    { state: 'unavailable', reasonCode: 'unavailable_revision' },
  ];
  for (const value of produced) assert.deepEqual(parseUsp(result, wire(value)), value);
  const error = { error: { code: 'USP_SCOPE_STALE', message: 'Refresh this scope.',
    retryable: false, requestId: 'request-1' } };
  assert.deepEqual(parseUsp(UspErrorEnvelopeSchema, wire(error)), error);
  assert.equal(result.safeParse({ state: 'available', data: null }).success, false);
  assert.equal(UspErrorEnvelopeSchema.safeParse({ error: { ...error.error, privatePath: '/private/a.pdf' } }).success, false);
});

test('snapshot consumer keeps exact historical pins and missing quantity distinct from zero', () => {
  const member = { pin, bodySha256: 'b'.repeat(64), bodyRef: 'c'.repeat(64), authority: 'registry' };
  const manifest = { schemaVersion: 'usp/1', id: scope.manifestId, digest: scope.snapshotDigest,
    scope, capturedAt: '2026-09-23T00:00:00.000Z', selection: { kind: 'site', pins: [] },
    members: [member], frame: { horizontal: 'LOCAL', vertical: null, unit: 'm', transform: null },
    policyVersion: 'policy-1', accessViewId: 'view-1', validAt: null, asOf: null,
    coverage: { state: 'partial', reasonCodes: ['missing_source'] } };
  assert.deepEqual(parseUsp(UspSnapshotManifestSchema, wire(manifest)), manifest);
  assert.equal(UspSnapshotManifestSchema.safeParse({ ...manifest, members: [member, member] }).success, false);
  assert.equal(UspSnapshotManifestSchema.safeParse({ ...manifest, digest: 'd'.repeat(64) }).success, false);
});

test('guarded commands require one bounded target set and strict registered change', () => {
  const base = { kind: 'registry', scope, changes: [{ kind: 'registry_draft', draftId: 'draft-1', expectedDraftRevision: 1 }],
    evidence: [source], guard: uspFixtures.create };
  assert.equal(UspPrepareProposalSchema.safeParse(wire({ ...base, target: pin })).success, true);
  assert.equal(UspPrepareProposalSchema.safeParse(wire({ ...base, targets: [pin] })).success, true);
  assert.equal(UspPrepareProposalSchema.safeParse(wire({ ...base, target: pin, targets: [pin] })).success, false);
  assert.equal(UspPrepareProposalSchema.safeParse(wire({ ...base, targets: [pin, pin] })).success, false);
  assert.equal(UspPrepareProposalSchema.safeParse(wire({ ...base, target: pin,
    changes: [{ kind: 'json_patch', path: '/body/owner', value: 'someone' }] })).success, false);
  const receipt = { receiptId: 'receipt-1', operation: 'commit_registry', requestKey: 'commit-1',
    commandSha256: 'e'.repeat(64), proposalId: 'draft-1', reviewId: 'review-1', before: [pin],
    after: [{ ...pin, revision: 3 }], snapshot: scope,
    event: { streamId: 'registry:site-1', sequence: '1' }, committedAt: '2026-09-23T00:00:00.000Z' };
  assert.deepEqual(parseUsp(UspCommitReceiptSchema, wire(receipt)), receipt);
});

test('job and release consumers preserve pending state, source lineage and revocation', () => {
  const job = { jobId: 'job-1', version: 1, operation: 'pack0', status: 'queued', scope: uspFixtures.intake,
    inputManifestId: 'input-1', inputSha256: 'a'.repeat(64), progress: null,
    attempt: { number: 0, fence: 1, leaseUntil: null }, result: null, errorCode: null };
  assert.deepEqual(parseUsp(UspJobProjectionSchema, wire(job)), job);
  const release = { id: 'release-1', version: 1,
    output: { assetId: 'output-1', version: 1, sha256: 'c'.repeat(64) },
    lineage: [source], audience: 'public', reviewer: 'reviewer-1', policyVersion: 'policy-1',
    state: 'revoked', expiresAt: null, reviewedAt: '2026-09-23T00:00:00.000Z',
    redaction: 'Only the reviewed target row', applicability: 'A101' };
  assert.deepEqual(parseUsp(UspReleaseDecisionSchema, wire(release)), release);
  assert.equal(UspReleaseDecisionSchema.safeParse({ ...release, lineage: [] }).success, false);
  assert.equal(UspModelGatewayRequestSchema.safeParse({ taskKind: 'extract', evidenceRefs: [source],
    input: { instruction: 'read this cited part' }, outputSchemaId: 'extract-1',
    budget: { maxInputBytes: 1024, deadlineMs: 30000 }, policyVersion: 'policy-1' }).success, true);
  assert.equal(UspScanReceiptSchema.safeParse({ receiptId: 'scan-1', uploadId: 'upload-1',
    assetHash: 'a'.repeat(64), state: 'unavailable', scannerVersion: null }).success, true);
  assert.equal(UspSendReceiptResultSchema.safeParse({ state: 'unknown', receiptId: null }).success, true);
});

test('cross-building supplied unit is rejected and packet bytes contain only selected exact part', () => {
  assert.equal(storedRevision('1'), 1);
  assert.throws(() => storedRevision('9007199254740992'));
  const buildingA = { kind: 'building', pin: { ref: { namespace: 'registry_record', id: 'building-a' }, revision: 1 } };
  const buildingB = { kind: 'building', pin: { ref: { namespace: 'registry_record', id: 'building-b' }, revision: 1 } };
  const floor = { kind: 'floor', pin: { ref: { namespace: 'registry_record', id: 'floor-a1' }, revision: 1 },
    relations: [{ target: buildingA.pin }] };
  const space = { kind: 'space', relations: [{ target: floor.pin }] };
  assert.equal(hasVerticalMembership(buildingA, floor, space), true);
  assert.equal(hasVerticalMembership(buildingB, floor, space), false);
  const mixedParts = [
    { locator: { label: 'A101 region' }, text: 'ONLY_A101' },
    { locator: { label: 'A102 region' }, text: 'NEVER_A102' },
  ];
  assert.equal(selectExactPart(mixedParts, { kind: 'verbatim', locator: 'A101 region' }), 'ONLY_A101');
  assert.equal(selectExactPart(mixedParts, { kind: 'verbatim', locator: 'whole page' }), null);
  const rendered = renderPacket0({ id: pin.ref.id, label: 'A101' }, [
    { pointer: source as any, sourceSha256: 'd'.repeat(64),
      excerpt: selectExactPart(mixedParts, { kind: 'verbatim', locator: 'A101 region' }), reasonCode: null },
  ], 'csv');
  assert.match(rendered, /ONLY_A101/);
  assert.doesNotMatch(rendered, /NEVER_A102/);
  const packet = { packetId: 'packet-1', target: pin, scope, format: 'csv',
    artifact: { assetId: 'packet-1', version: 1, sha256: 'd'.repeat(64) }, included: [source], unavailable: [],
    contentType: 'text/csv; charset=utf-8', createdAt: '2026-09-23T00:00:00.000Z',
    status: 'complete', commandSha256: 'e'.repeat(64) };
  assert.deepEqual(parseUsp(UspPacket0ReceiptSchema, wire(packet)), packet);
});
