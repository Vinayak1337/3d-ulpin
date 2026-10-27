import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { probeOriginal } from './intake-probe';
import { intakeGeojsonFraming } from './geojson-framing';
import { intakeNameWords } from './intake-text';
import { keptWords } from './intake-draft';
import { readingOf } from './intake-reading';
import { intakeItem } from './intake-ledger';

// test_only: format controls generated in memory, never property records.
const feature = JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon',
  coordinates: [[[1, 2], [2, 2], [2, 3], [1, 2]]] }, properties: { note: 'test_only' } });
const probe = (bytes: Buffer, name: string) => probeOriginal(async (start, end) => bytes.subarray(start, end),
  bytes.length, name);

for (const extension of ['geojsonl', 'geojsons', 'ndjson', 'jsonl']) {
  test(`newline Features named .${extension} agree with their bytes and choose GeoJSON lines`, async () => {
    const name = `test_only.${extension}`;
    const card = await probe(Buffer.from(`${feature}\n${feature}\n`), name);
    assert.equal(card.format, 'ndjson');
    assert.equal(card.family, 'vector');
    assert.deepEqual(card.geometryTypes, ['Polygon']);
    assert.equal(card.nameDisagrees, false);
    assert.equal(intakeNameWords(card, name), null);
    assert.equal(intakeGeojsonFraming(card), 'geojson-lines');
    assert.equal(card.counts.features, null, 'the sample is not a whole-file count');
    assert.equal(card.crs.code, null, 'no source CRS statement is invented');
  });
}

test('non-Feature NDJSON retains its table family, name disagreements and no map framing', async () => {
  for (const extension of ['geojsonl', 'geojsons', 'ndjson', 'jsonl']) {
    const card = await probe(Buffer.from('{"key":1}\n{"key":2}\n'), `test_only.${extension}`);
    assert.equal(card.family, 'table');
    assert.equal(card.format, 'ndjson');
    assert.equal(card.nameDisagrees, ['geojsonl', 'geojsons'].includes(extension));
    assert.equal(intakeGeojsonFraming(card), null);
  }
});

test('gzip magic is recognised without decompression; card and row words say kept, not read', async () => {
  const bytes = gzipSync(Buffer.from(`${feature}\n`));
  const before = Buffer.from(bytes);
  const words = 'Compressed (gzip): kept, not read.';
  for (const name of ['test_only.geojsonl.csv.gz', 'test_only.bin', 'test_only']) {
    const card = await probe(bytes, name);
    assert.equal(card.format, 'gzip');
    assert.equal(card.family, 'archive');
    assert.equal(card.depth, 'signature');
    assert.ok(card.limits.includes(words));
    const named = intakeNameWords(card, name);
    assert.equal(named, name.endsWith('.bin') ? 'Named .bin, read as GZIP.' : null);
    assert.equal(keptWords(card, bytes.length), words);
    const id = '30000000-0000-4000-8000-000000000001';
    const row = intakeItem({ item_id: id, source_id: id, case_id: id, parent_item_id: null, member_path: null,
      name, family: card.family, format: card.format, size_bytes: bytes.length, size_class: 'S', wave: 4,
      state: 'probed', placement: 'not_understood', card, card_sha256: 'a'.repeat(64),
      probe_version: card.version, plan_ref: null, parts_planned: null, parts_done: 0, records_seen: 0,
      limit_reason: words, pinned_by_officer: false, created_at: '2026-10-24T00:00:00.000Z',
      updated_at: '2026-10-24T00:00:00.000Z' });
    assert.equal(row.limitReason, [named, words].filter(Boolean).join(' '));
    assert.equal(readingOf({ size_bytes: bytes.length, placement: 'not_understood' }, card).drawing.words, words);
    assert.deepEqual(card.geometryTypes, []);
    assert.deepEqual(card.members, []);
    assert.ok(Object.values(card.counts).every(value => value === null));
  }
  assert.deepEqual(bytes, before, 'the compressed original is unchanged');
  const card = await probe(Buffer.from('not gzip'), 'test_only.gz');
  assert.equal(card.format, 'unknown', 'a suffix alone never establishes gzip');
  assert.match(intakeNameWords(card, 'test_only.gz')!, /not a recognised kind/);
});
