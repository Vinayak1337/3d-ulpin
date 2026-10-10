import assert from 'node:assert/strict';
import test from 'node:test';
import { isSourceNativeCandidate } from './geometry';
import { nativeReviewFixture, retainedRoofprintFixture } from '../areas/native-review.test-fixture';

// Admission metadata controls reuse retained source geometry/identities; they assert no analytical qualification.
test('a publisher observed or source-stated planned candidate is admitted, never its recorded revision', () => {
  const pkg = nativeReviewFixture();
  const feature = pkg.features[0];
  const before = structuredClone(pkg);
  assert.equal(isSourceNativeCandidate(feature, pkg), true);
  assert.equal(isSourceNativeCandidate({ ...feature, worldStatus: 'planned' }, pkg), true);
  assert.equal(isSourceNativeCandidate({ ...feature, revision: 1 }, pkg), false);
  assert.deepEqual(pkg, before);
});

test('the retained model roofprint is not admitted even though it names its package sources', () => {
  const pkg = retainedRoofprintFixture();
  assert.equal(pkg.features[0].revision, 0);
  assert.equal(pkg.features[0].worldStatus, 'observed');
  assert.equal(isSourceNativeCandidate(pkg.features[0], pkg), false);
});

test('a derived marker cannot be cleared by a source-supported semantics label', () => {
  const pkg = nativeReviewFixture();
  const receipt = retainedRoofprintFixture().features[0].properties.spatialExtraction;
  for (const marker of [receipt, {}, null, undefined]) {
    const feature = { ...pkg.features[0], properties: { spatialExtraction: marker },
      semantics: { ...pkg.features[0].semantics, evidenceState: 'source_supported' as const } };
    assert.equal(isSourceNativeCandidate(feature, pkg), false);
  }
});

test('unknown publisher semantics stay reviewable; synthetic or hypothetical status never passes admission', () => {
  const pkg = nativeReviewFixture();
  const feature = pkg.features[0];
  assert.equal(isSourceNativeCandidate({ ...feature, semantics: { evidenceState: 'unresolved' } }, pkg), true);
  assert.equal(isSourceNativeCandidate({ ...feature, worldStatus: 'synthetic' }, pkg), false);
  assert.equal(isSourceNativeCandidate({ ...feature, worldStatus: 'hypothetical' }, pkg), false);
});

test('native admission requires evidence for the feature exact source within its own package', () => {
  const pkg = nativeReviewFixture();
  const feature = pkg.features[0];
  const otherSource = retainedRoofprintFixture().sourceRevisionIds[0];
  assert.equal(isSourceNativeCandidate({ ...feature, evidence: [{ sourceRevisionId: otherSource }] }, pkg), false);
  assert.equal(isSourceNativeCandidate(feature, { sourceRevisionIds: [otherSource] }), false);
  assert.equal(isSourceNativeCandidate({ ...feature, evidence: [] }, pkg), false);
  assert.equal(isSourceNativeCandidate({ ...feature, sourceRevisionId: '' }, { sourceRevisionIds: [''] }), false);
});
