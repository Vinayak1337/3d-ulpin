import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { SourceRangeReference } from '@ulpin/contracts';
import { STREAMING_VECTOR_LIMITS } from '@ulpin/contracts/usp';
import { readStreamingFeatures } from '../ingestion/streaming-vector-reader';
import { sha256 } from '../../../infrastructure/storage';
import { capturedSourceRange, featurePropertiesExtract, featureRangeExtract, readFeatureRange }
  from './feature-extract';
import { assessPlanTx, PlanSourceReadBudget } from './plan-authority';
import { withFeaturePlan, uuid, type FeaturePlanStore } from './feature-plan.test-fixture';
import { fingerprint } from '../../cases/domain';

const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
const data = JSON.parse(bytes.toString());
const ranges = new Map<number, SourceRangeReference>();
const scanned = readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
  ranges.set(item.index, { format: 'geojson', featureIndex: item.index, byteStart: item.start,
    byteEnd: item.end, rawSha256: sha256(item.raw), readerVersion: STREAMING_VECTOR_LIMITS.version });
});
const observation = (index: number) => ({ sourceFeatureIndex: index, properties: data.features[index].properties,
  sourceReference: { sourceRange: ranges.get(index) } });

test('all 1661 real NYC buildings have character-identical range and whole-file excerpts', async () => {
  await scanned;
  let compared = 0;
  for (const [index, range] of ranges) {
    // Existing import quarantines index 1322 for the documented ring self-intersection (CA5).
    if (index === 1322) continue;
    const actual = featureRangeExtract(bytes.subarray(range.byteStart, range.byteEnd), range, observation(index));
    assert.equal(actual, featurePropertiesExtract(bytes, index), `Feature ${index}`);
    compared++;
  }
  assert.equal(compared, 1661);
});

for (const index of [0, 1620]) {
  test(`NYC index ${index}: range assessment identical; exactly one span and no whole read`, async () => {
    await scanned;
    await withFeaturePlan(index, async store => {
      const input = store.input();
      const client = store.pool() as unknown as PoolClient;
      const whole = await assessPlanTx(client, store.ctx, input, store.io.read);
      const range = ranges.get(index)!;
      store.features[0].body.sourceReference = { sourceRange: range };
      const reads: number[][] = [];
      const part = await assessPlanTx(client, store.ctx, input,
        async () => { throw new Error('Whole read forbidden'); }, undefined, undefined,
        async (key, start, end, size) => {
          assert.equal(key, store.source.object_key);
          assert.equal(size, bytes.length);
          reads.push([start, end]);
          return bytes.subarray(start, end);
        });
      assert.deepEqual(part, whole);
      assert.deepEqual(reads, [[range.byteStart, range.byteEnd]]);
      delete store.features[0].body.sourceReference;
      assert.deepEqual(await assessPlanTx(client, store.ctx, input, store.io.read), whole);
    });
  });
}

test('a range-only plan ignores total original size but preserves source byte receipt', async () => {
  await scanned;
  await withFeaturePlan(0, async store => {
    store.source.bytes = 500 * 1024 * 1024;
    store.features[0].body.sourceReference = { sourceRange: ranges.get(0) };
    const result = await assessPlanTx(store.pool() as unknown as PoolClient, store.ctx, store.input(),
      async () => { throw new Error('Whole read forbidden'); }, undefined, undefined,
      async (_key, start, end, size) => {
        assert.equal(size, 500 * 1024 * 1024);
        return bytes.subarray(start, end);
      });
    assert.equal(result.entries[0].sourceBytes, 500 * 1024 * 1024);
    assert.equal(result.entries[0].state, 'included');
  });
});

for (const change of ['changed byte', 'shifted span', 'other feature', 'truncated object', 'over bound']) {
  test(`${change} is refused with its range code`, async () => {
    await scanned;
    const reference = { ...ranges.get(0)! };
    let raw = Buffer.from(bytes.subarray(reference.byteStart, reference.byteEnd));
    const observed = observation(0);
    if (change === 'changed byte') raw[40] ^= 1;
    if (change === 'shifted span') reference.byteStart++;
    if (change === 'other feature') {
      const other = ranges.get(1620)!;
      Object.assign(reference, other, { featureIndex: 0 });
      raw = Buffer.from(bytes.subarray(other.byteStart, other.byteEnd));
    }
    if (change === 'truncated object') {
      raw = raw.subarray(0, raw.length - 1);
      reference.byteEnd--;
      reference.rawSha256 = sha256(raw);
    }
    if (change === 'over bound') reference.byteEnd = reference.byteStart + 1024 * 1024 + 1;
    observed.sourceReference.sourceRange = reference;
    assert.throws(() => {
      const range = capturedSourceRange(observed, bytes.length)!;
      featureRangeExtract(raw, range, observed);
    }, { status: 422, code: change === 'over bound' ? 'PACKET_PLAN_RANGE_BOUND' : 'PACKET_PLAN_RANGE_MISMATCH' });
  });
}

test('a strict single Feature and single object properties are required; the old character bound stays', () => {
  const controls = [
    '{"type":"Feature","properties":{},"properties":{}}',
    '{"type":"Feature","properties":null}',
    '[{"type":"Feature","properties":{}}]',
  ];
  for (const control of controls) {
    const raw = Buffer.from(control);
    const range: SourceRangeReference = { format: 'geojson', featureIndex: 0, byteStart: 0,
      byteEnd: raw.length, rawSha256: sha256(raw), readerVersion: STREAMING_VECTOR_LIMITS.version };
    assert.throws(() => featureRangeExtract(raw, range, { sourceFeatureIndex: 0 }),
      { code: 'PACKET_PLAN_RANGE_MISMATCH' });
  }
  const raw = Buffer.from(`{"type":"Feature","properties":{"value":"${'x'.repeat(15989)}"}}`);
  const range: SourceRangeReference = { format: 'geojson', featureIndex: 0, byteStart: 0,
    byteEnd: raw.length, rawSha256: sha256(raw), readerVersion: STREAMING_VECTOR_LIMITS.version };
  assert.equal(featureRangeExtract(raw, range, { sourceFeatureIndex: 0 }), null);
});

test('size/range response mismatch maps to range mismatch, and UTF-8 is strict', async () => {
  await scanned;
  const observed = observation(0);
  const { AppError } = await import('../../../infrastructure/errors');
  await assert.rejects(() => readFeatureRange({ object_key: 'control', bytes: bytes.length }, observed,
    async () => { throw new AppError(422, 'SOURCE_INTEGRITY', 'Control range response mismatch'); }),
  { code: 'PACKET_PLAN_RANGE_MISMATCH' });
  const raw = Buffer.from(bytes.subarray(ranges.get(0)!.byteStart, ranges.get(0)!.byteEnd));
  raw[40] = 255;
  const reference = { ...ranges.get(0)!, rawSha256: sha256(raw) };
  assert.throws(() => featureRangeExtract(raw, reference, observed), { code: 'PACKET_PLAN_RANGE_MISMATCH' });
});

test('one actual two-source plan reads a large source by range and the second source whole', async () => {
  await scanned;
  await withFeaturePlan(0, async store => {
    const { second, client, input } = mixedSourceFixture(store);
    const reads: string[] = [];
    const result = await assessPlanTx(client, store.ctx, input, async key => {
      assert.equal(key, second.object_key);
      reads.push('whole');
      return bytes;
    }, undefined, undefined, async (key, start, end) => {
      assert.equal(key, store.source.object_key);
      reads.push('range');
      return bytes.subarray(start, end);
    });
    assert.deepEqual(reads, ['range', 'whole']);
    assert(result.entries.every(entry => entry.state === 'included'));
  });
});

function mixedSourceFixture(store: FeaturePlanStore) {
  const second = { ...store.source, id: uuid(21), object_key: 'second-whole-source' };
  store.source.bytes = 500 * 1024 * 1024;
  store.features[0].body.sourceReference = { sourceRange: ranges.get(0) };
  const feature = structuredClone(store.features[0]);
  feature.id = uuid(22);
  Object.assign(feature.body, { sourceRevisionId: second.id, sourceFeatureIndex: 1620,
    sourceKey: data.features[1620].properties.doitt_id, properties: data.features[1620].properties });
  delete feature.body.sourceReference;
  store.features.push(feature);
  const pointer = structuredClone(store.pointer);
  pointer.sourceRevision.ref.id = second.id;
  pointer.locator.locator = `feature ${feature.body.sourceKey}`;
  pointer.legacyLocator = pointer.locator.locator;
  store.record.body.evidence.push({ sourceId: second.id, locator: pointer.legacyLocator });
  const manifest = store.manifest.bind(store);
  store.manifest = () => {
    const body = manifest();
    return { ...body, members: [...body.members, { pin: pointer.sourceRevision, authority: 'source' as const,
      bodySha256: fingerprint(second), bodyRef: fingerprint(['source_revision', second.id, 1, second]) }] };
  };
  const client = secondSourceClient(store.pool() as unknown as PoolClient, second);
  const originalInput = store.input();
  const input = { ...originalInput, entries: [...originalInput.entries, { ...originalInput.entries[0], pointer }] };
  return { second, client, input };
}

function secondSourceClient(base: PoolClient, source: Record<string, any>): PoolClient {
  return { query: async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT * FROM sources') && values[0] === source.id)
      return { rows: [source], rowCount: 1 };
    if (text.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies')) {
      const id = text.includes("namespace='source_revision'") ? values[1] : values[2];
      if (id === source.id) return { rows: [{ body: source, body_sha256: fingerprint(source) }], rowCount: 1 };
    }
    return base.query(sql, values);
  } } as unknown as PoolClient;
}

test('mixed source budget counts whole bytes plus ranges, deduplicating spans and upgrading to whole', () => {
  const budget = new PlanSourceReadBudget();
  budget.charge('range-source', 500 * 1024 * 1024, { byteStart: 0, byteEnd: 1024 });
  budget.charge('whole-source', 64 * 1024 * 1024 - 1024, null);
  budget.charge('range-source', 500 * 1024 * 1024, { byteStart: 0, byteEnd: 1024 });
  assert.throws(() => budget.charge('range-source', 500 * 1024 * 1024,
    { byteStart: 1024, byteEnd: 2048 }), { code: 'PACKET_PLAN_SOURCE_LIMIT' });
  const upgrade = new PlanSourceReadBudget();
  upgrade.charge('source', 64 * 1024 * 1024, { byteStart: 0, byteEnd: 1024 });
  upgrade.charge('source', 64 * 1024 * 1024, null);
  upgrade.charge('source', 64 * 1024 * 1024, { byteStart: 1024, byteEnd: 2048 });
});
