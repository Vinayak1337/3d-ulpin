import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { probeOriginal, intakeWave, intakeSizeClass } from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { detectIntakeKind } from '../packages/server/src/modules/usp/ingestion/intake-signatures';
import { zipMemberRefusal, probeZip } from '../packages/server/src/modules/usp/ingestion/intake-zip';
import { INTAKE_PROBE_LIMITS } from '../packages/contracts/src/usp/intake';

// Protocol controls built here test format framing and refusals, never asserted as real property data.
const bytes = (value: string) => Buffer.from(value);
async function probe(value: Uint8Array, name = 'input.bin', size = value.length) {
  return probeOriginal(async (start, end) => value.subarray(start, end), size, name);
}
const head = (size = 256) => Buffer.alloc(size);
const fixtures: [string, Uint8Array][] = [
  ['pdf', bytes('%PDF-1.7\n')], ['png', Buffer.from('89504e470d0a1a0a', 'hex')],
  ['jpeg', Buffer.from('ffd8ff', 'hex')], ['las', bytes('LASF')],
  ['sqlite', bytes('SQLite format 3\0')], ['parquet', bytes('PAR1')],
  ['zip', Buffer.from('504b0304', 'hex')], ['tiff', Buffer.from('49492a00', 'hex')],
  ['bigtiff', Buffer.from('4d4d002b', 'hex')], ['glb', bytes('glTF')],
  ['dwg', bytes('AC1032')], ['e57', bytes('ASTM-E57')], ['7z', Buffer.from('377abcaf271c', 'hex')],
  ['rar', Buffer.from('526172211a070100', 'hex')], ['flatgeobuf', Buffer.from('6667620366676201', 'hex')],
  ['geojson', bytes('{"type":"FeatureCollection","features":[]}')],
  ['cityjson', bytes('{"type":"CityJSON","version":"2.0","CityObjects":{}}')],
  ['geojson-seq', bytes('\x1e{"type":"Feature","geometry":null}\n')],
  ['ndjson', bytes('{"key":1}\n{"key":2}\n')], ['csv', bytes('key,value\n1,2\n')],
  ['tsv', bytes('key\tvalue\n1\t2\n')], ['ifc', bytes("ISO-10303-21;\nFILE_SCHEMA(('IFC4'));\n")],
  ['citygml', bytes('<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0">')],
  ['gml', bytes('<gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml">')],
  ['kml', bytes('<kml xmlns="http://www.opengis.net/kml/2.2">')],
  ['dxf', bytes('0\nSECTION\n2\nHEADER\n')], ['gltf', bytes('{"asset":{"version":"2.0"}}')],
  ['obj', bytes('v 1 2 3\nf 1 2 3\n')], ['ply', bytes('ply\nformat ascii 1.0\n')],
];
for (const [format, fixture] of fixtures) {
  test(`byte signature identifies ${format} independently of the filename`, () => {
    assert.equal(detectIntakeKind(fixture).format, format);
  });
}

test('GeoPackage, LAZ, DBF and shapefile header signatures', () => {
  const sqlite = head();
  sqlite.write('SQLite format 3\0');
  sqlite.writeUInt32BE(0x47504b47, 68);
  assert.equal(detectIntakeKind(sqlite).format, 'geopackage');
  const las = head();
  las.write('LASF');
  las[104] = 134;
  assert.equal(detectIntakeKind(las).format, 'laz');
  const dbf = head();
  dbf[0] = 3;
  dbf[2] = 1;
  dbf[3] = 1;
  dbf.writeUInt16LE(33, 8);
  dbf.writeUInt16LE(12, 10);
  assert.equal(detectIntakeKind(dbf).format, 'dbf');
  const shp = head();
  shp.writeUInt32BE(9994);
  shp.writeUInt32LE(1000, 28);
  assert.equal(detectIntakeKind(shp).format, 'shapefile');
});

test('bytes defeat a misleading name and no cell value is serialized', async () => {
  const card = await probe(bytes('latitude,owner\n12.34,PRIVATE_PERSON_SENTINEL\n'), 'input.geojson');
  assert.equal(card.format, 'csv');
  assert.equal(card.nameDisagrees, true);
  assert.equal(card.counts.rows, null);
  assert.equal(card.drawableHint, true);
  assert.ok(!JSON.stringify(card).includes('PRIVATE_PERSON_SENTINEL'));
  assert.ok(!JSON.stringify(card).includes('12.34'));
});

test('GeoJSON complete values expose names/types only, and whole count only when complete', async () => {
  const source = bytes('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":'
    + '{"type":"Point","coordinates":[1,2]},"properties":{"owner":"PROPERTY_SECRET_SENTINEL"}}]}');
  const card = await probe(source);
  assert.equal(card.counts.features, 1);
  assert.deepEqual(card.geometryTypes, ['Point']);
  assert.ok(!JSON.stringify(card).includes('PROPERTY_SECRET_SENTINEL'));
  const cut = await probe(source.subarray(0, 100));
  assert.equal(cut.counts.features, null);
  assert.equal(cut.crs.state, 'absent');
});

test('a large original uses at most head and tail, counts remain unknown', async () => {
  const size = 10 * 1024 ** 3;
  let read = 0;
  const card = await probeOriginal(async (start, end) => {
    read += end - start;
    const range = Buffer.alloc(end - start, 32);
    if (start === 0) range.write('{"type":"FeatureCollection","features":[');
    return range;
  }, size, 'large.geojson');
  assert.equal(read, 128 * 1024);
  assert.equal(card.counts.features, null);
});

test('XLSX sheets from workbook only; neither cell nor shared-string content opened', async () => {
  const pack = zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>'),
    'xl/worksheets/sheet1.xml': strToU8('CELL_SECRET_SENTINEL'),
    'xl/sharedStrings.xml': strToU8('PERSON_SECRET_SENTINEL'),
  });
  const card = await probe(pack, 'input.zip');
  assert.equal(card.format, 'xlsx');
  assert.deepEqual(card.sheets, [{ name: 'Sheet1', count: null }]);
  assert.ok(!JSON.stringify(card).includes('SECRET_SENTINEL'));
});

test('DOCX, ODS and KMZ container kinds come from directory plus bytes', async () => {
  const packs = [
    ['docx', { 'word/document.xml': strToU8('TEXT_SECRET'), '[Content_Types].xml': strToU8('<Types/>') }],
    ['ods', { mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
      'content.xml': strToU8('CELL_SECRET') }],
    ['kmz', { 'doc.kml': strToU8('<kml xmlns="http://www.opengis.net/kml/2.2">') }],
  ] as const;
  for (const [format, files] of packs) assert.equal((await probe(zipSync(files))).format, format);
});

test('a KMZ with doc.kml at its root and its images or models stays a KMZ', async () => {
  const kml = strToU8('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>');
  const icon = Buffer.from('89504e470d0a1a0a', 'hex');
  const kmz = await probe(zipSync({ 'doc.kml': kml, 'files/icon.png': icon, 'models/house.dae': bytes('<COLLADA/>') }),
    'ward.kmz');
  assert.deepEqual([kmz.format, kmz.family], ['kmz', 'vector']);
});

test('a ZIP holding a KML beside other files stays a ZIP and lists every member', async () => {
  const card = await probe(zipSync({ 'a.kml': strToU8('<kml xmlns="http://www.opengis.net/kml/2.2">'),
    'b.geojson': bytes('{"type":"FeatureCollection","features":[]}'), 'c.csv': bytes('key,value\n1,2\n') }),
  'mixed.zip');
  assert.deepEqual([card.format, card.family], ['zip', 'archive']);
  assert.deepEqual(card.members.map(member => [member.name, member.format, member.refusalCode]),
    [['a.kml', 'kml', null], ['b.geojson', 'geojson', null], ['c.csv', 'csv', null]]);
});

test('ZIP shapefile companions form one item and absent PRJ stays absent', async () => {
  const shp = head(100);
  shp.writeUInt32BE(9994);
  shp.writeUInt32LE(1000, 28);
  shp.writeUInt32LE(5, 32);
  const shx = Buffer.from(shp);
  shx.writeUInt32BE(54, 24);
  const card = await probe(zipSync({ 'folder/layer.shp': shp, 'folder/layer.shx': shx }));
  assert.equal(card.members.length, 1);
  assert.equal(card.members[0].card?.crs.state, 'absent');
  assert.equal(card.members[0].card?.counts.features, 1);
  assert.equal(intakeWave(card.members[0].card!), 1);
});

test('ZIP companions never borrow a CRS from a different case-sensitive folder or base name', async () => {
  const shp = head(100);
  shp.writeUInt32BE(9994);
  shp.writeUInt32LE(1000, 28);
  shp.writeUInt32LE(5, 32);
  const card = await probe(zipSync({ 'Folder/layer.shp': shp,
    'folder/layer.prj': bytes('GEOGCS["CRS_CONTROL"]'), 'Folder/Layer.prj': bytes('GEOGCS["CRS_CONTROL"]') }));
  assert.equal(card.members.length, 1);
  assert.deepEqual(card.members[0].companions, []);
  assert.equal(card.members[0].card?.crs.state, 'absent');
});

for (const name of ['/absolute.bin', '../parent.bin', 'folder/../parent.bin', 'C:\\drive.bin']) {
  test(`ZIP refuses unsafe path ${name}`, async () => {
    const card = await probe(zipSync({ [name]: bytes('PAR1') }));
    assert.equal(card.members[0].refusalCode, 'ZIP_UNSAFE_PATH');
  });
}

test('ZIP guards compression ratio and nesting depth', async () => {
  const card = await probe(zipSync({ 'bomb.bin': Buffer.alloc(1024 * 1024) }));
  assert.equal(card.members[0].refusalCode, 'ZIP_RATIO_LIMIT');
  assert.equal(zipMemberRefusal({ name: 'nested.zip', size: 10, compressed: 10 }, 3), 'ZIP_NESTING_LIMIT');
});

test('ZIP guards member count, directory size and aggregate expanded bytes before opening members', async () => {
  const pack = Buffer.from(zipSync({ 'one.bin': bytes('PAR1'), 'two.bin': bytes('PAR1') }));
  const eocd = pack.length - 22;
  const directory = pack.readUInt32LE(eocd + 16);
  const tooMany = Buffer.from(pack);
  tooMany.writeUInt16LE(INTAKE_PROBE_LIMITS.members + 1, eocd + 10);
  assert.match((await probe(tooMany)).limits.join(), /ZIP_MEMBER_LIMIT/);
  const tooLarge = Buffer.from(pack);
  tooLarge.writeUInt32LE(INTAKE_PROBE_LIMITS.directoryBytes + 1, eocd + 12);
  assert.match((await probe(tooLarge)).limits.join(), /ZIP_DIRECTORY_LIMIT/);
  const expanded = Buffer.from(pack);
  expanded.writeUInt32LE(0xffffffff, directory + 24);
  const next = directory + 46 + expanded.readUInt16LE(directory + 28);
  expanded.writeUInt32LE(0xffffffff, next + 24);
  assert.match((await probe(expanded)).limits.join(), /ZIP_EXPANDED_LIMIT/);
  const card = await probe(pack);
  await probeZip(card, async () => { throw new Error('Must not read'); }, pack.length, pack, async () => card, 3);
  assert.match(card.limits.join(), /ZIP_NESTING_LIMIT/);
});

test('GeoParquet is recognized from bounded Compact-Thrift geo metadata, not its extension', async () => {
  const value = bytes('{"version":"1.1.0","primary_column":"geometry","columns":{"geometry":{"encoding":"WKB"}}}');
  const schema = Buffer.concat([Buffer.from([0x48, 6]), bytes('schema'), Buffer.from([0x15, 0, 0])]);
  const footer = Buffer.concat([Buffer.from([0x15, 2, 0x19, 0x1c]), schema,
    Buffer.from([0x16, 0, 0x19, 0x0c, 0x19, 0x1c, 0x18, 3]), bytes('geo'),
    Buffer.from([0x18, value.length]), value, Buffer.from([0, 0])]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(footer.length);
  const card = await probe(Buffer.concat([bytes('PAR1'), footer, length, bytes('PAR1')]), 'control.parquet');
  assert.equal(card.format, 'geoparquet');
  assert.equal(card.formatVersion, '1.1.0');
  assert.equal(card.depth, 'signature');
  assert.equal(card.counts.features, null);
  footer.write('VALUE', footer.indexOf('1.1.0'));
  const untyped = await probe(Buffer.concat([bytes('PAR1'), footer, length, bytes('PAR1')]), 'control.parquet');
  assert.equal(untyped.format, 'parquet');
  assert.ok(!JSON.stringify(untyped).includes('VALUE'));
});

test('TIFF first IFD states dimensions, bands and an explicit geographic GeoKey only', async () => {
  const tiff = head(256);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(4, 8);
  for (const [index, tag, value] of [[0, 256, 100], [1, 257, 120], [2, 277, 1], [3, 34735, 128]]) {
    const at = 10 + index * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(3, at + 2);
    tiff.writeUInt32LE(tag === 34735 ? 8 : 1, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  }
  for (const [index, value] of [1, 1, 0, 1, 2048, 0, 1, 4326].entries()) {
    tiff.writeUInt16LE(value, 128 + index * 2);
  }
  const card = await probe(tiff);
  assert.equal(card.format, 'geotiff');
  assert.deepEqual(card.raster, { width: 100, height: 120, tiled: false });
  assert.equal(card.counts.bands, 1);
  assert.equal(card.crs.code, 'EPSG:4326');
  assert.equal(card.extent.epsg4326, null);
  tiff.writeUInt16LE(0, 134);
  assert.equal((await probe(tiff)).crs.state, 'absent');
});

test('loose SHX stays at signature depth and never becomes an anchor alone', async () => {
  const shx = head(100);
  shx.writeUInt32BE(9994);
  shx.writeUInt32LE(1000, 28);
  shx.writeUInt32LE(5, 32);
  const card = await probe(shx, 'control.shx');
  assert.equal(card.format, 'shapefile-index');
  assert.equal(card.detectedBy, 'bytes_and_name');
  assert.equal(card.depth, 'signature');
  assert.equal(intakeWave(card), 4);
});

test('nested property type never decides the original JSON format', async () => {
  const card = await probe(bytes('{"record":{"type":"FeatureCollection","name":"VALUE_SECRET"}}'));
  assert.equal(card.format, 'unknown');
  assert.ok(!JSON.stringify(card).includes('VALUE_SECRET'));
});

test('a range that never completes exits within the single exported time budget', async () => {
  await assert.rejects(probeOriginal(async () => new Promise<Uint8Array>(() => {}), 100, 'control.bin'),
    /INTAKE_PROBE_BUDGET/);
});

test('each family has an explicit wave and size classes include the boundary', async () => {
  const base = await probe(bytes('unknown'));
  for (const [family, wave] of [['vector', 1], ['raster', 2], ['point_cloud', 2], ['table', 3],
    ['document', 4], ['image', 4], ['archive', 4], ['unknown', 4], ['model3d', 4]] as const) {
    assert.equal(intakeWave({ ...base, family, geometryTypes: ['Polygon'] }), wave);
  }
  assert.equal(intakeWave({ ...base, family: 'model3d', crs: { state: 'stated', code: 'EPSG:4326',
    sidecarSha256: null } }), 1);
  assert.equal(intakeWave({ ...base, family: 'vector' }), 4);
  assert.deepEqual([16 * 1024 ** 2, 128 * 1024 ** 2, 7 * 1024 ** 3, 7 * 1024 ** 3 + 1]
    .map(intakeSizeClass), ['S', 'M', 'L', 'XL']);
});
