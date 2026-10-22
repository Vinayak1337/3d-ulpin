import assert from 'node:assert/strict';
import test from 'node:test';
import { PointBatchMetadataSchema, PointBatchResultSchema } from '../packages/contracts/src/usp/point-batch';

// test_only: literal format-0 layout; no source CRS, GPS time or RGB is asserted.
const format0 = {
  lasVersion: '1.2', pointFormatId: 0, recordLength: 20, recordEncoding: 'las-1.2-point-format-0-le',
  dimensions: ['X', 'Y', 'Z', 'intensity', 'return_number', 'number_of_returns', 'scan_direction_flag',
    'edge_of_flight_line', 'classification', 'synthetic', 'key_point', 'withheld', 'scan_angle_rank',
    'user_data', 'point_source_id'],
  sourcePointCount: 2, scale: [0.01, 0.02, 0.05], offset: [500, 1000, -10],
  sourceBounds: [501.25, 1001, -8.5, 502.5, 1003, -7], crsWkt: null, horizontalAuthority: null,
  verticalReference: null, verticalReferenceStatus: 'unknown', gpsTimeType: null,
  batch: { start: 0, count: 2 }, globalPlacement: 'not_qualified',
  recordFields: [
    { name: 'X', offset: 0, dtype: '<i4', bytes: 4 }, { name: 'Y', offset: 4, dtype: '<i4', bytes: 4 },
    { name: 'Z', offset: 8, dtype: '<i4', bytes: 4 }, { name: 'intensity', offset: 12, dtype: '<u2', bytes: 2 },
    { name: 'bit_fields', offset: 14, dtype: '|u1', bytes: 1 },
    { name: 'raw_classification', offset: 15, dtype: '|u1', bytes: 1 },
    { name: 'scan_angle_rank', offset: 16, dtype: '|i1', bytes: 1 },
    { name: 'user_data', offset: 17, dtype: '|u1', bytes: 1 },
    { name: 'point_source_id', offset: 18, dtype: '<u2', bytes: 2 },
  ],
};
const uuid = '30000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const input = {
  version: 'point-batch/1', jobId: uuid, caseId: uuid, caseRevision: 1, caseContextSha256: hash,
  sourceId: uuid, sourceFamilyId: uuid, sourceRevision: 1, sourceSha256: hash, sourceBytes: 267,
  objectKey: `large-originals/${uuid}/${hash}`, subject: 'point-format-contract-test', accessSha256: hash,
  readerSha256: hash, batch: null,
};

function result(metadata: unknown, bytes: number) {
  return { version: 'point-batch/1', input, metadata, createdAt: '2026-10-22T00:00:00.000Z',
    artifact: { key: `point-batches/${uuid}/${hash}.bin`, sha256: hash, bytes,
      mediaType: 'application/vnd.las.point-records' } };
}

test('format 0 preserves absent GPS/RGB and exact native byte counts in the batch contract', () => {
  const parsed = PointBatchResultSchema.parse(result(format0, 40));
  assert.equal(parsed.metadata.gpsTimeType, null);
  assert.equal(parsed.metadata.crsWkt, null);
  assert(!parsed.metadata.dimensions.includes('gps_time'));
  assert(!parsed.metadata.dimensions.includes('red'));
  assert(!PointBatchResultSchema.safeParse(result(format0, 60)).success);
  assert(!PointBatchMetadataSchema.safeParse({ ...format0, gpsTimeType: 'week_time' }).success);
});

test('legacy GPS and RGB dimensions are optional by format, not padded values', () => {
  const gps = { name: 'gps_time', offset: 20, dtype: '<f8', bytes: 8 };
  const format1 = { ...format0, pointFormatId: 1, recordLength: 28, recordEncoding: 'las-1.2-point-format-1-le',
    dimensions: [...format0.dimensions, 'gps_time'], gpsTimeType: 'week_time',
    recordFields: [...format0.recordFields, gps] };
  PointBatchResultSchema.parse(result(format1, 56));
  const rgb = ['red', 'green', 'blue'].map((name, index) => ({ name, offset: 28 + index * 2,
    dtype: '<u2', bytes: 2 }));
  const format3 = { ...format1, lasVersion: '1.3', pointFormatId: 3, recordLength: 34,
    recordEncoding: 'las-1.3-point-format-3-le', dimensions: [...format1.dimensions, 'red', 'green', 'blue'],
    recordFields: [...format1.recordFields, ...rgb] };
  PointBatchResultSchema.parse(result(format3, 68));
  assert(!PointBatchMetadataSchema.safeParse({ ...format3, dimensions: format1.dimensions }).success);
  assert(!PointBatchMetadataSchema.safeParse({ ...format1, recordLength: 30 }).success);
  assert(!PointBatchMetadataSchema.safeParse({ ...format0, pointFormatId: 4 }).success);
  assert(!PointBatchMetadataSchema.safeParse({ ...format0, lasVersion: '1.1' }).success);
});
