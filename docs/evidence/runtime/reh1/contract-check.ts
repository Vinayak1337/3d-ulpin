import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  NormalizedAreaSchema, NormalizedBuildingSchema, SourceBuildingImportSchema,
} from '../../../../packages/contracts/src/index';
import { SourceSpaceReceiptSchema } from '../../../../packages/contracts/src/canonical/source-spaces';
import {
  UspIdentityCommitReceiptSchema, UspSnapshotManifestSchema, UspBuildingSnapshotListSchema,
} from '../../../../packages/contracts/src/usp/domain';
import {
  ProjectIdentityReviewSchema, AssignProjectCodeSchema,
} from '../../../../packages/contracts/src/usp/project-identity';
import {
  UspPacketPlanSchema, UspPacketPlanConfirmationSchema, UspPacketPlanExecutionSchema,
} from '../../../../packages/contracts/src/usp/packets';
import {
  UspReadPropertyCardSchema, UspPropertyCardSchema, UspPropertyCardPreviewSchema,
  UspPropertyCardVerificationSchema, UspPropertyCardListSchema,
} from '../../../../packages/contracts/src/usp/property-card';
import { DocumentStatusSchema } from '../../../../packages/contracts/src/usp/document-ingestion';
import { save } from './audit.mjs';

assert.deepEqual(process.argv.slice(2), ['--runtime', 'ulpin-reh-01']);
const root = 'E:/BhuAayam-data/task-data/reh1';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const answer = (index: string) => read(`${index}-response`).body;
const data = (index: string) => answer(index).data;

SourceSpaceReceiptSchema.parse(answer('012'));
UspSnapshotManifestSchema.parse(data('016'));
ProjectIdentityReviewSchema.parse(read('017-request').body);
AssignProjectCodeSchema.parse(read('018-request').body);
UspIdentityCommitReceiptSchema.parse(data('018'));
UspPacketPlanSchema.parse(data('023'));
UspPacketPlanConfirmationSchema.parse(data('024'));
UspPacketPlanExecutionSchema.parse(data('025'));
UspPropertyCardPreviewSchema.parse(data('026'));
const card = UspPropertyCardSchema.parse(data('027'));
DocumentStatusSchema.parse(answer('007'));
const snapshots = UspBuildingSnapshotListSchema.parse(answer('c1-001'));
for (let index = 1; index < snapshots.items.length; index++) {
  assert(Date.parse(snapshots.items[index - 1].capturedAt) >= Date.parse(snapshots.items[index].capturedAt));
}
NormalizedAreaSchema.parse(answer('c2-005'));
SourceBuildingImportSchema.parse(read('c2-002-request').body.metadata);
UspPropertyCardListSchema.parse(data('c1-002'));
const report = UspPropertyCardVerificationSchema.parse(data('c1-003'));
assert.equal(report.result, 'consistent');
assert.equal(report.checks.length, 6);
assert(report.checks.every(check => check.state === 'pass'));
const canonical = NormalizedBuildingSchema.parse(answer('019'));
const unit = canonical.levels.flatMap(level => level.spaces).find(space => space.spaceId === card.target.ref.id);
assert(unit);
assert.equal(unit.proposedCode.state, 'reviewed');
assert.equal(unit.polygons.state, 'absent');
assert.equal(unit.areaM2?.state, 'unknown');
assert.equal(unit.areaM2?.value, null);
assert.equal(unit.kind.state, 'unknown');
assert.equal(canonical.parcelRefs.length, 0);

// Two real bad reads: our diagnostic added expiry; the Studio revision path adds its mode and label.
const failures = ['029', 'c1-004'].map(index => {
  const body = read(`${index}-request`).body;
  assert.equal(UspReadPropertyCardSchema.safeParse(body).success, false);
  const exact = { cardId: body.cardId, revision: body.revision };
  assert.equal(UspReadPropertyCardSchema.safeParse(exact).success, true);
  return { index, extraKeys: Object.keys(body).filter(key => key !== 'cardId' && key !== 'revision'),
    originalHttp: read(`${index}-response`).status, exactBodyParses: true, correctedBodySent: false };
});
const inputs = JSON.parse(readFileSync('docs/evidence/runtime/reh1/input-integrity.json', 'utf8'));
for (const source of inputs.pdfs) {
  const path = Array.isArray(source.path) ? source.path.join('') : source.path;
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), source.sourceSha256);
}
const result = { exit: 0, schemaParses: 17, successfulResponseParses: 14,
  verificationChecksPassed: 6, snapshotsNewestCapturedFirst: true,
  unknownsPreserved: true, originalPdfsRehashedUnchanged: inputs.pdfs.length, failures };
const recorded = 'docs/evidence/runtime/reh1/contract-check-final.json';
if (existsSync(recorded)) assert.deepEqual(JSON.parse(readFileSync(recorded, 'utf8')), result);
else save('contract-check-final.json', result);
console.log('PASS exchange contracts, six card checks, unknowns, source hashes and two extra-field regressions.');
