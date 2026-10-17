import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LargeUploadCreateSchema, StreamedMappingReceiptSchema } from '../../../../packages/contracts/src/usp';
import { fingerprint } from '../../../../packages/server/src/modules/cases/domain';

// Serialization control uses LP3a's existing doitt_id/geometry fixture layout, not operational records.
const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const operations = [
  { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
    conversionId: 'literal_identifier@1' },
  { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
];
const plan = { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
  source: { sourceId: id, familyId: id, sourceRevision: 1, sourceSha256: hash, schemaFingerprint: hash },
  caseId: id, caseRevision: 1, rawJobId: id, profileJobId: id, profileGeneration: 17, profileHash: hash,
  operations, semanticEvidence: operations.map(operation => ({ target: operation.target,
    sourcePath: operation.sourcePath, issuer: 'Serialization fixture issuer',
    evidenceUrl: 'https://example.invalid/serialization-fixture',
    meaning: operation.target === 'building.sourceKey' ? 'building_source_identity' : 'building_footprint' })) };
const planHash = fingerprint(plan);
const receipt = { id, revision: 2, state: 'approved', plan, planHash,
  authoredBy: 'serialization-fixture', authoredAt: '2026-10-11T00:00:00.000Z',
  approval: { subject: 'serialization-fixture', at: '2026-10-11T00:00:00.000Z', planHash,
    provenance: 'server_configured_local_operator' } };

function main() {
  if (process.argv.includes('--after')) {
    const stored = JSON.parse(readFileSync('docs/evidence/gf1/pv1/stored-receipt-before.json', 'utf8'));
    const parsed = StreamedMappingReceiptSchema.parse(stored.receipt);
    assert.equal(JSON.stringify(parsed), JSON.stringify(stored.receipt));
    assert.equal(fingerprint(parsed.plan), stored.receipt.planHash);
    assert(!Object.hasOwn(parsed.plan, 'basis'));
    console.log(JSON.stringify({ storedPlanHashesUnchanged: true, absentBasisNotInserted: true,
      receiptBytesEqual: true, before: stored.receipt.planHash, after: fingerprint(parsed.plan) }));
    return;
  }
  const parsed = StreamedMappingReceiptSchema.parse(receipt);
  assert.deepEqual(parsed, receipt);
  assert.equal(fingerprint(parsed.plan), receipt.planHash);
  const input = { requestKey: id, expectedCaseRevision: 0, filename: 'officer-file.geojson',
    bytes: 43263076, mediaType: 'application/octet-stream', sha256: hash,
    provenance: { origin: 'not_stated', acquiredAt: '2026-10-11T00:00:00.000Z' } };
  const refusal = LargeUploadCreateSchema.safeParse(input);
  assert(!refusal.success);
  console.log(JSON.stringify({ fixture: 'LP3a layout serialization control, stored before change', receipt: parsed,
    uploadWithoutCitationBefore: { admitted: false, issues: refusal.error.issues } }));
}
main();
