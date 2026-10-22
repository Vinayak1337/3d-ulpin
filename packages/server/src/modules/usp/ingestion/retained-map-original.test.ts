import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetainedMapOriginal } from './retained-map-original';
import { permitsFeatureRecordSource } from '../../registry/registry-reference-policy';

const receipt = () => ({ profile: 'geojson-manual-v1', sha256: 'a'.repeat(64), status: 'needs_input',
  inspection: { manualProfile: { version: 'manual-geojson/1', format: 'geojson' },
    gis: { sourceSha256: 'a'.repeat(64) } } });

test('exact retained receipt ignores status but grants record purpose only', () => {
  for (const status of ['needs_input', 'inspected', 'unknown']) {
    const source = { ...receipt(), status };
    assert(isRetainedMapOriginal(source));
    assert(permitsFeatureRecordSource(source, 'record'));
    assert(!permitsFeatureRecordSource(source, 'geometry'));
    assert(!permitsFeatureRecordSource(source, 'right'));
  }
});
for (const profile of ['large-original-v1', 'document-original-v1', 'tabular-manual-v1', 'geojson-area-v2']) {
  test(`${profile} with needs_input and copied inspection is not a retained map original`, () => {
    const source = { ...receipt(), profile };
    assert(!isRetainedMapOriginal(source));
    assert(!permitsFeatureRecordSource(source, 'record'));
  });
}
for (const [name, patch] of [
  ['manual version', { manualProfile: { version: 'manual-geojson/2', format: 'geojson' } }],
  ['format', { manualProfile: { version: 'manual-geojson/1', format: 'csv' } }],
  ['missing manual receipt', { manualProfile: null }],
  ['GIS source hash', { gis: { sourceSha256: 'b'.repeat(64) } }],
  ['missing GIS receipt', { gis: null }],
] as const) {
  test(`${name} fails exact retained receipt identity`, () => {
    const source = receipt();
    Object.assign(source.inspection, patch);
    assert(!isRetainedMapOriginal(source));
    assert(!permitsFeatureRecordSource(source, 'record'));
  });
}
test('a bounded adapter on an upload keeps exact upload byte authority and still grants record purpose only', () => {
  const manual = receipt();
  const source = { ...manual, profile: 'large-original-v1', bytes: 1024,
    inspection: { ...manual.inspection, largeOriginal: { verifiedBytes: 1024, verifiedSha256: manual.sha256 } } };
  assert(isRetainedMapOriginal(source));
  assert(permitsFeatureRecordSource(source, 'record'));
  assert(!permitsFeatureRecordSource(source, 'geometry'));
  assert(!permitsFeatureRecordSource(source, 'right'));
  assert(!isRetainedMapOriginal({ ...source, bytes: 1025 }));
  assert(!isRetainedMapOriginal({ ...source, sha256: 'b'.repeat(64) }));
  assert(!isRetainedMapOriginal({ ...source, bytes: 16 * 1024 * 1024 + 1,
    inspection: { ...source.inspection,
      largeOriginal: { verifiedBytes: 16 * 1024 * 1024 + 1, verifiedSha256: manual.sha256 } } }));
});

test('missing and malformed inspection never match by absent hash equality', () => {
  assert(!isRetainedMapOriginal({ profile: 'geojson-manual-v1' }));
  assert(!isRetainedMapOriginal({ ...receipt(), inspection: [] }));
  assert(!isRetainedMapOriginal({ ...receipt(), sha256: undefined }));
});
