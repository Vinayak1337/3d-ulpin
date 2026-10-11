import assert from 'node:assert/strict';
import test from 'node:test';
import { LargeOriginalEvidenceSchema, LargeUploadCreateSchema } from '@ulpin/contracts/usp';
import { storedUploadProvenance } from './large-original';
import { assertIntakeSource } from './intake-context';

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const subject = 'provenance-protocol-operator';
const acquiredAt = '2026-10-11T00:00:00.000Z';
const cited = { issuer: 'Protocol fixture issuer', originalUrl: 'https://example.invalid/original',
  acquiredAt, permissionReference: 'Protocol fixture permission', limitations: ['Not operational evidence'] };
const input = { requestKey: id, expectedCaseRevision: 0, filename: 'officer-file.geojson',
  bytes: 43263076, mediaType: 'application/octet-stream', sha256: hash };
function evidence(provenance: unknown) {
  return { uploadId: id, operatorSubject: subject, objectEtag: 'protocol-etag', verifiedSha256: hash,
    verifiedBytes: input.bytes, provenance, conversion: 'unsupported',
    bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' };
}

test('not-stated origin is strict, stored explicitly, and retains the same private byte authority', () => {
  for (const profile of ['large-original/1', 'large-original/2'] as const) {
    const parsed = LargeUploadCreateSchema.parse({ ...input, profile,
      provenance: { origin: 'not_stated', acquiredAt } });
    const stored = LargeOriginalEvidenceSchema.parse(evidence(storedUploadProvenance(parsed.provenance)));
    assert.deepEqual(stored.provenance, { origin: 'not_stated', acquiredAt, state: 'not_stated' });
    assert.doesNotThrow(() => assertIntakeSource({ id, case_id: id, family_id: id, revision: 1,
      name: input.filename, profile: 'large-original-v1', bytes: input.bytes, sha256: hash,
      object_key: 'protocol-original', status: 'needs_input', inspection: { largeOriginal: stored } },
    { subject, access: hash, caseId: id, tag: 0n, streamId: 'protocol-stream' }));
  }
});

test('cited upload and stored caller-declared evidence retain their exact existing bytes', () => {
  const parsed = LargeUploadCreateSchema.parse({ ...input, provenance: cited });
  assert.equal(JSON.stringify(parsed.provenance), JSON.stringify(cited));
  const before = { ...cited, state: 'caller_declared' };
  const after = LargeOriginalEvidenceSchema.parse(evidence(storedUploadProvenance(parsed.provenance)));
  assert.equal(JSON.stringify(after.provenance), JSON.stringify(before));
});

test('provenance forms cannot mix a publisher with not-stated origin or invent missing values', () => {
  for (const provenance of [
    { ...cited, origin: 'not_stated' }, { origin: 'not_stated', acquiredAt, issuer: cited.issuer },
    { origin: 'not_stated' }, { origin: 'not_stated', acquiredAt: 'yesterday' },
    { origin: 'not_stated', acquiredAt, permissionReference: 'extra' },
  ]) assert.equal(LargeUploadCreateSchema.safeParse({ ...input, provenance }).success, false);
  assert.equal(LargeOriginalEvidenceSchema.safeParse(evidence({ origin: 'not_stated', acquiredAt,
    state: 'caller_declared' })).success, false);
  assert.equal(LargeOriginalEvidenceSchema.safeParse(evidence({ ...cited, state: 'not_stated' })).success, false);
});
