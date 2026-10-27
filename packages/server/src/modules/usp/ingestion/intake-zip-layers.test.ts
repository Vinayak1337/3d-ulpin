import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { ArchiveMemberLineageSchema } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { zipParentWords } from './intake-draft';
import { probeOriginal } from './intake-probe';
import { readZipMember } from './intake-zip';
import { zipLayerMembers } from './intake-zip-layers';

const bytes = (text: string) => Buffer.from(text);

async function inspect(files: Record<string, Uint8Array>) {
  const pack = zipSync(files, { level: 0 });
  const read = async (start: number, end: number) => pack.subarray(start, end);
  const card = await probeOriginal(read, pack.length, 'mixed.zip');
  const rows = card.members.map(member => ({ item_id: randomUUID(), member_path: member.name,
    source_id: null, size_bytes: String(member.sizeBytes), limit_reason: member.refusalCode,
    card: member.card ? { ...member.card, members: [] } : null }));
  return { pack, read, card, rows };
}

// Header-only controls exercise grouping and routing, not the accuracy of a native GIS/PDF reader.
function shapeHeader() {
  const header = Buffer.alloc(100);
  header.writeUInt32BE(9994);
  header.writeUInt32BE(50, 24);
  header.writeUInt32LE(1000, 28);
  header.writeUInt32LE(5, 32);
  return header;
}

test('a shapefile set does not claim an unrelated PDF, CSV or GeoJSON', async () => {
  const fixture = await inspect({ 'map/roads.shp': shapeHeader(), 'map/roads.shx': shapeHeader(),
    'map/roads.dbf': bytes('DBF control'), 'map/roads.prj': bytes('CRS control'),
    'plan.pdf': bytes('%PDF-1.4\n%%EOF'), 'register.csv': bytes('key,value\na,b\n'),
    'map/blocks.geojson': bytes('{"type":"FeatureCollection","features":[]}') });
  assert.equal(fixture.card.format, 'zip');
  assert.equal(fixture.card.members.length, 4);
  assert.deepEqual(zipLayerMembers(fixture.card, fixture.rows).map(row => row.member_path),
    ['plan.pdf', 'register.csv', 'map/blocks.geojson']);
  const words = zipParentWords(fixture.card, 'taken', fixture.rows.map(row => ({ path: row.member_path,
    sourceId: row.member_path.endsWith('.shp') ? null : randomUUID(), reason: null })));
  assert.match(words, /^7 members\. 1 shapefile layer grouped for the native reader/);
  assert.match(words, /1 PDF, 1 CSV, 1 GeoJSON layer taken out as their own items/);
});

test('DXF, CityGML, CityJSON and TSV members taken out are named as taken, not as kept unread', async () => {
  const fixture = await inspect({ 'plan.dxf': bytes('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'),
    'city.gml': bytes('<?xml version="1.0"?><CityModel xmlns="http://www.opengis.net/citygml/2.0"></CityModel>'),
    'city.json': bytes('{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}'),
    'rows.tsv': bytes('key\tvalue\na\tb\n') });
  assert.deepEqual(fixture.card.members.map(member => member.format).sort(), ['citygml', 'cityjson', 'dxf', 'tsv']);
  const words = zipParentWords(fixture.card, 'taken', fixture.rows.map(row => ({ path: row.member_path,
    sourceId: randomUUID(), reason: null })));
  assert.doesNotMatch(words, /kept, not read/);
  assert.match(words, /taken out as their own items: .*city\.gml.*/);
});

test('a gzip member taken out of a ZIP is named as taken, not as a file with no batch reader', async () => {
  const fixture = await inspect({ 'map.geojson.gz': gzipSync(bytes('{"type":"FeatureCollection","features":[]}')) });
  const words = zipParentWords(fixture.card, 'taken', [{ path: 'map.geojson.gz',
    sourceId: randomUUID(), reason: null }]);
  assert.match(words, /1 gzip file taken out as their own items/);
  assert.doesNotMatch(words, /kept, not read/);
});

test('GeoJSON and GeoPackage both become independent byte originals with exact member hashes', async () => {
  const sqlite = Buffer.alloc(100);
  sqlite.write('SQLite format 3\0');
  sqlite.write('GPKG', 68);
  const fixture = await inspect({ 'map/blocks.geojson': bytes('{"type":"FeatureCollection","features":[]}'),
    'map/buildings.gpkg': sqlite });
  const selected = zipLayerMembers(fixture.card, fixture.rows);
  assert.deepEqual(selected.map(row => row.card?.format), ['geojson', 'geopackage']);
  for (const member of selected) {
    const extracted = await readZipMember(fixture.read, fixture.pack.length, member.member_path, 1024);
    const lineage = ArchiveMemberLineageSchema.parse({ version: 'zip-layer/1', parentSourceId: randomUUID(),
      parentSourceRevision: 1, parentSha256: sha256(fixture.pack), parentItemId: randomUUID(),
      memberPath: member.member_path, ordinal: extracted.ordinal, memberBytes: extracted.bytes.length,
      compressedBytes: extracted.compressedBytes, crc32: extracted.crc32, memberSha256: sha256(extracted.bytes) });
    assert.equal(lineage.memberSha256, sha256(extracted.bytes));
  }
});

test('traversal names are refused rather than copied, and the parent says where they remain', async () => {
  const fixture = await inspect({ '../escape.pdf': bytes('%PDF-1.4\n%%EOF'),
    'safe.csv': bytes('key,value\na,b\n') });
  assert.deepEqual(zipLayerMembers(fixture.card, fixture.rows).map(row => row.member_path), ['safe.csv']);
  assert.match(zipParentWords(fixture.card), /escape\.pdf \(inside archive; ZIP_UNSAFE_PATH\)/);
});

test('the expanded archive ceiling refuses the member plan and stays visible in parent words', async () => {
  const fixture = await inspect({ 'large.bin': bytes('one'), 'another.bin': bytes('two') });
  const pack = Buffer.from(fixture.pack);
  const directory = pack.readUInt32LE(pack.length - 6);
  pack.writeUInt32LE(0xffffffff, directory + 24);
  const next = directory + 46 + pack.readUInt16LE(directory + 28);
  pack.writeUInt32LE(0xffffffff, next + 24);
  const card = await probeOriginal(async (start, end) => pack.subarray(start, end), pack.length, 'large.zip');
  assert.deepEqual(zipLayerMembers(card, []), []);
  assert.match(zipParentWords(card), /No members could be taken out\. ZIP_EXPANDED_LIMIT/);
});
