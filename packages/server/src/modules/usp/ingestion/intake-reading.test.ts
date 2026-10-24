import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { INTAKE_FORMAT_NAMES, IntakeReadingSchema } from '@ulpin/contracts/usp';
import { INTAKE_FORMAT_NAMES as browserFormatNames } from '@ulpin/contracts/upload-reader-limits';
import { intakeItem } from './intake-ledger';
import { probeOriginal } from './intake-probe';
import { readingOf, type ReadingRow } from './intake-reading';

const fixtures = [
  ['fixtures/real-nyc/original.geojson', 'GeoJSON map layer', 'features?'],
  ['fixtures/real-area/original.geojson', 'GeoJSON map layer', 'features?'],
  ['fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv', 'CSV table', 'profiled columns'],
  ['fixtures/usp/D8-messy-india/dev/d1b/mi-d19-01.xlsx', 'XLSX table', 'sheets'],
];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const probe = (bytes: Uint8Array, name: string) =>
  probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);

for (const [path, kind, count] of fixtures) test(`reading stored facts from ${path}`, async () => {
  const bytes = readFileSync(path);
  const before = digest(bytes);
  const card = await probe(bytes, basename(path));
  const original = structuredClone(card);
  const row: ReadingRow = { state: 'probed', placement: 'needs_answer', size_bytes: bytes.length,
    plan_ref: { layoutQuestion: card.family === 'vector' } };
  const reading = readingOf(row, card);
  assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
  assert.ok(reading.what.words.includes(kind), reading.what.words);
  assert.match(reading.what.words, new RegExp(`\\d+ ${count}`));
  assert.ok(reading.drawing.words.length);
  assert.doesNotMatch(`${reading.what.words} ${reading.drawing.words}`, /Not known/i);
  assert.equal(reading.what.basis, 'reader');
  assert.deepEqual([reading.fields, reading.links], [[], []]);
  for (const [noun, value] of Object.entries(card.counts)) {
    if (value !== null) {
      const words = `${value} ${value === 1 ? noun.slice(0, -1) : noun}`;
      assert.ok(reading.holds.some(entry => entry.words === words));
    }
  }
  assert.ok(reading.question);
  if (card.family === 'vector') {
    assert.equal(reading.drawing.as, 'outlines');
    assert.match(reading.drawing.words, /after the layer layout/);
    assert.match(readingOf({ ...row, placement: 'on_map' }, card).drawing.words, /on the map/);
    const answered = readingOf({ ...row, plan_ref: { recipeState: 'approved' } }, card);
    assert.match(answered.drawing.words, /confirmed layer layout/);
    assert.equal(answered.question, null);
  } else {
    assert.equal(reading.drawing.as, 'kept');
    assert.match(reading.drawing.words, /not drawn until/);
    const placed = readingOf({ ...row, placement: 'on_map' }, card);
    assert.equal(placed.drawing.as, 'features');
    assert.equal(placed.question, null);
  }
  assert.deepEqual(card, original);
  assert.equal(digest(readFileSync(path)), before, 'original bytes remain unchanged');
});

test('all recognised formats have shared plain names; unlisted tokens are left out of what', () => {
  const formats = ['7z', 'bigtiff', 'citygml', 'cityjson', 'csv', 'dbf', 'dwg', 'dxf', 'e57', 'flatgeobuf',
    'geojson', 'geojson-seq', 'geopackage', 'glb', 'gltf', 'gml', 'ifc', 'jpeg', 'kml', 'ndjson', 'obj',
    'parquet', 'pdf', 'ply', 'png', 'rar', 'shapefile', 'sqlite', 'tiff', 'tsv', 'xls', 'zip', 'xlsx',
    'ods', 'kmz', 'las', 'laz', 'geotiff', 'geoparquet', 'shapefile_zip'];
  assert.ok(Object.isFrozen(INTAKE_FORMAT_NAMES));
  assert.equal(browserFormatNames, INTAKE_FORMAT_NAMES);
  for (const format of formats) {
    assert.ok(Object.hasOwn(INTAKE_FORMAT_NAMES, format), format);
    const name = INTAKE_FORMAT_NAMES[format];
    assert.ok(name.trim().length, format);
    const words = readingOf({ format, family: 'unknown' }, null).what.words;
    assert.ok(words.includes(name), words);
    assert.doesNotMatch(words, /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/);
  }
  for (const format of ['UNLISTED-FORMAT', 'shapefile-index', 'toString']) {
    assert.equal(readingOf({ format, family: 'table' }, null).what.words, 'table.');
  }
});

test('one feature, row, page, member, point and band use singular nouns', async () => {
  const card = await probe(Buffer.from('{"type":"FeatureCollection","features":[]}'), 'empty.geojson');
  // Count grammar protocol control, not a dataset assertion.
  card.counts = { features: 1, rows: 1, pages: 1, members: 1, points: 1, bands: 1 };
  const reading = readingOf({}, card);
  for (const noun of ['feature', 'row', 'page', 'member', 'point', 'band']) {
    assert.ok(reading.what.words.includes(`1 ${noun}`));
    assert.ok(reading.holds.some(entry => entry.words === `1 ${noun}`));
    assert.doesNotMatch(reading.what.words, new RegExp(`\\b1 ${noun}s\\b`));
  }
});

test('unknown counts stay omitted; a known zero is retained and item what uses the same assembler', async () => {
  const card = await probe(readFileSync(fixtures[2][0]), 'lgd-gurugram.csv');
  const reading = readingOf({}, card);
  assert.equal(card.counts.rows, null);
  assert.ok(!reading.holds.some(entry => /\brows\b/.test(entry.words)));
  assert.doesNotMatch(reading.what.words, /0 rows/);
  const empty = await probe(Buffer.from('{"type":"FeatureCollection","features":[]}'), 'empty.geojson');
  assert.ok(readingOf({}, empty).holds.some(entry => entry.words === '0 features'));
  // Protocol identity and timestamps only, not a dataset record.
  const id = '10000000-0000-4000-8000-000000000001';
  const row = { item_id: id, case_id: id, source_id: id, parent_item_id: null, member_path: null,
    name: 'lgd-gurugram.csv', family: card.family, format: card.format, size_bytes: 239, size_class: 'S',
    wave: 3, state: 'probed', placement: 'undecided', card, card_sha256: null, probe_version: card.version,
    plan_ref: null, parts_planned: null, parts_done: 0, records_seen: 0, limit_reason: null,
    pinned_by_officer: false, created_at: new Date(0), updated_at: new Date(0) };
  assert.equal(intakeItem(row).what, readingOf(row, card).what.words);
  // Mixed-geometry protocol control: one observed polygon must not label every feature an outline.
  empty.geometryTypes = ['Polygon', 'Point'];
  assert.equal(readingOf({}, empty).drawing.as, 'features');
  const refused = readingOf({ placement: 'needs_answer', limit_reason: 'This reader cannot read this layer.' }, empty);
  assert.equal(refused.drawing.as, 'kept');
  assert.equal(refused.question, null);
  empty.layers = [{ name: 'protocol layer', count: null }, { name: 'empty protocol layer', count: 0 }];
  const layers = readingOf({}, empty).holds.map(entry => entry.words);
  assert.ok(layers.includes('Layer: protocol layer.'));
  assert.ok(layers.includes('Layer: empty protocol layer (0 records).'));
});

test('unrecognised bytes and unprobed items are kept with their reason, without inventing a kind', async () => {
  const bytes = Buffer.from([0, 1, 2, 3]); // Unknown-signature protocol control.
  const card = await probe(bytes, 'unrecognised.bin');
  const reason = 'Kept; its kind was not recognised from its first and last bytes.';
  const reading = readingOf({ size_bytes: bytes.length, limit_reason: reason }, card);
  assert.match(reading.what.words, /kind was not recognised/);
  assert.equal(reading.drawing.as, 'kept');
  assert.equal(reading.drawing.words, reason);
  assert.equal(reading.question, null);
  const pending = readingOf({ size_bytes: null }, null);
  assert.deepEqual(pending.holds, []);
  assert.doesNotMatch(pending.what.words, /0 bytes|UNKNOWN/);
});

test('a ZIP describes members without claiming copies and a layer CRS question follows stored answers', async () => {
  const card = await probe(zipSync({ 'rows.csv': strToU8('key,value\n') }), 'bundle.zip');
  assert.match(readingOf({}, card).drawing.words, /waiting to be taken out/);
  assert.doesNotMatch(readingOf({}, card).drawing.words, /CSV taken out as their own items:/);
  const nativeLayers = { unstated: ['layer'], answers: [] as { layer: string }[] };
  assert.match(readingOf({ plan_ref: { nativeLayers } }, card).question!, /coordinate system.*layer/);
  nativeLayers.answers.push({ layer: 'layer' });
  assert.equal(readingOf({ plan_ref: { nativeLayers } }, card).question, null);
  const malformed = JSON.parse('{"plan_ref":{"nativeLayers":{"unstated":"unreadable"}}}');
  assert.equal(readingOf(malformed, card).question, null, 'an unknown stored projection does not break the reading');
});

const pack = 'E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload';
for (const [file, as, words] of [['nyc-10013-ortho-2018.tif', 'raster_overlay', /Raster overlay/],
  ['nyc-10013-lidar-2017.laz', 'points', /Points/]] as const) {
  const path = `${pack}/${file}`;
  const skip = !existsSync(path) && 'the data drive inputs are not present';
  test(`surface reading from ${file}`, { skip }, async () => {
    const bytes = readFileSync(path);
    const card = await probe(bytes, file);
    const reading = readingOf({ size_bytes: bytes.length }, card);
    assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
    assert.equal(reading.drawing.as, as);
    assert.match(reading.drawing.words, words);
    assert.doesNotMatch(`${reading.what.words} ${reading.drawing.words}`, /Not known/i);
    assert.ok(reading.holds.some(entry => /Extent|Raster width/.test(entry.words)));
    if (as === 'points') {
      assert.ok(reading.holds.some(entry => /Point scale/.test(entry.words)));
      assert.ok(reading.holds.some(entry => entry.words === `Point format: ${card.point!.format}.`));
    }
    if (card.formatVersion) {
      assert.ok(reading.holds.some(entry => entry.words === `Format version: ${card.formatVersion}.`));
    }
  });
}
