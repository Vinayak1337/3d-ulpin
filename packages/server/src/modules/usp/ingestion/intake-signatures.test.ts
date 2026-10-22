import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { INTAKE_PROBE_LIMITS } from '@ulpin/contracts/usp';
import { probeOriginal } from './intake-probe';
import { decodeIntakeHead, detectIntakeKind } from './intake-signatures';

// test_only protocol fixtures, constructed from literals; not survey or registry data.
const detect = (text: string) => detectIntakeKind(Buffer.from(text)).format;

const dxfVariants = [
  ['leading comment groups', '999\nexport comment\n 999 \nsecond comment\n 0 \nSECTION\n 2 \nHEADER\n'],
  ['empty comment and CRLF', ' \t999 \r\n\r\n\t0\t\r\nSECTION\r\n\t2\t\r\nENTITIES\r\n'],
  ['CLASSES first', '0\nSECTION\n2\nCLASSES\n'],
  ['TABLES first', '0\nSECTION\n2\nTABLES\n'],
  ['BLOCKS first', '0\nSECTION\n2\nBLOCKS\n'],
  ['OBJECTS first', '0\nSECTION\n2\nOBJECTS\n'],
];
for (const [name, text] of dxfVariants) {
  test(`DXF recognises ${name}`, () => assert.equal(detect(text), 'dxf'));
}

test('DXF stays anchored to complete leading group pairs and a known first section', () => {
  assert.equal(detect('notes\n0\nSECTION\n2\nHEADER\n'), 'unknown');
  assert.equal(detect('999\ncomment\nnotes\n0\nSECTION\n2\nHEADER\n'), 'unknown');
  assert.equal(detect('0\nSECTION\n2\nHEADERNOTES\n'), 'unknown');
});

const objVariants = [
  ['homogeneous w', 'v 1 2 3 1\nf 1 2 3\n'],
  ['vertex colours', 'v 1 2 3 0.2 0.4 0.6\nvn 0 0 1\n'],
  ['exponent coordinates', 'v 1.5e-3 -2E+02 +3.0e0\nvt 0 1\n'],
  ['metadata before geometry', '# test_only\no object\ng group\ns off\nmtllib surface.mtl\nusemtl surface\n'
    + 'v 1.5e-3 -2E+02 3 1\nf 1 2 3\n'],
];
for (const [name, text] of objVariants) {
  test(`OBJ recognises ${name}`, () => assert.equal(detect(text), 'obj'));
}

test('OBJ refuses letters, incomplete numbers, unsupported arity and a vertex without a companion', () => {
  assert.equal(detect('v one 2 3\nf 1 2 3\n'), 'unknown');
  assert.equal(detect('v 1e 2 3\nf 1 2 3\n'), 'unknown');
  assert.equal(detect('v . 2 3\nf 1 2 3\n'), 'unknown');
  assert.equal(detect('v 1 2 3 4 5\nf 1 2 3\n'), 'unknown');
  assert.equal(detect('v 1 2 3 1\n'), 'unknown');
  assert.equal(detect('# v 1 2 3\nf 1 2 3\n'), 'unknown');
});

const xmlVariants = [
  ['external DOCTYPE', '<?xml version="1.0"?>\n<!DOCTYPE kml SYSTEM "not-fetched.dtd">\n<kml/>', 'kml'],
  ['internal DOCTYPE', '<?xml version="1.0"?>\n<!DOCTYPE kml [<!ENTITY label "a > b [ c">]>\n<kml/>', 'kml'],
  ['quoted root attribute', '<?xml version="1.0"?>\n<!DOCTYPE gml:FeatureCollection>\n'
    + '<gml:FeatureCollection label="a > b" xmlns:gml="http://www.opengis.net/gml"/>', 'gml'],
  ['processing instruction', '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="a.xsl"?>\n'
    + '<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"/>', 'citygml'],
  ['mixed prolog', '<?xml version="1.0"?>\n<!-- test_only -->\n<?style value="a > b"?>\n'
    + '<!DOCTYPE gml:FeatureCollection>\n<!-- root follows -->\n'
    + '<gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml"/>', 'gml'],
];
for (const [name, text, format] of xmlVariants) {
  test(`XML recognises ${name} without inspecting document content`, () => assert.equal(detect(text), format));
}

test('UTF-8 BOM is already stripped by the shared decoder before the XML declaration', () => {
  const bytes = Buffer.from('\uFEFF<?xml version="1.0"?>\n<kml/>');
  const decoded = decodeIntakeHead(bytes);
  assert.equal(decoded.encoding, 'utf-8');
  assert.ok(decoded.text.startsWith('<?xml'));
  assert.equal(detectIntakeKind(bytes).format, 'kml');
});

test('XML uses the actual root only and refuses an unfinished prolog', () => {
  assert.equal(detect('<?xml version="1.0"?><!DOCTYPE html><html><kml/></html>'), 'unknown');
  assert.equal(detect('<?xml version="1.0"?><html xmlns:gml="http://www.opengis.net/gml"/>'), 'unknown');
  assert.equal(detect('<!DOCTYPE html [<!ENTITY example "<kml/>">]><html/>'), 'unknown');
  assert.equal(detect('<?xml version="1.0"?><!DOCTYPE kml [<kml/>'), 'unknown');
  assert.equal(detect('<?xml-stylesheet <kml/>'), 'unknown');
});

test('GeoJSON root type after long crs, name and bbox within the 64 KiB head is recognised', async () => {
  const text = '{"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},'
    + '"name":"' + 'test_only'.repeat(5000) + '","bbox":[1,2,3,4],"type":"FeatureCollection","features":[]}';
  const bytes = Buffer.from(text);
  assert.equal(INTAKE_PROBE_LIMITS.headBytes, 64 * 1024);
  assert.ok(bytes.length < INTAKE_PROBE_LIMITS.headBytes);
  assert.equal(detectIntakeKind(bytes).format, 'geojson');
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'test_only.bin');
  assert.equal(card.format, 'geojson');
  assert.equal(card.nameDisagrees, true);
});

test('GeoJSON root type beyond the head stays unknown even with a .geojson extension and a readable tail', async () => {
  const text = '{"features":[{"type":"Feature","geometry":null,"properties":{"name":"'
    + 'test_only'.repeat(9000) + '"}}],"type":"FeatureCollection"}';
  const bytes = Buffer.from(text);
  assert.equal(JSON.parse(text).type, 'FeatureCollection');
  assert.ok(text.lastIndexOf('"type"') > INTAKE_PROBE_LIMITS.headBytes);
  assert.equal(detectIntakeKind(bytes.subarray(0, INTAKE_PROBE_LIMITS.headBytes)).format, 'unknown');
  assert.equal(detectIntakeKind(bytes).format, 'geojson');
  const ranges: number[][] = [];
  const card = await probeOriginal(async (start, end) => {
    ranges.push([start, end]);
    return bytes.subarray(start, end);
  }, bytes.length, 'test_only.geojson');
  assert.equal(card.format, 'unknown');
  assert.equal(card.family, 'unknown');
  assert.equal(card.detectedBy, 'bytes');
  assert.equal(card.counts.features, null);
  assert.deepEqual(ranges, [[0, 65536], [65536, bytes.length]]);
});

test('64 KiB comment and malformed XML heads complete in milliseconds without backtracking', context => {
  const fixtures = [
    ['DXF comments', '999\ncomment\n'.repeat(6000).slice(0, 65536), 'unknown'],
    ['OBJ comments', '# comment\n'.repeat(7000).slice(0, 65536), 'unknown'],
    ['DXF after comments', ('999\ncomment\n'.repeat(5400) + '0\nSECTION\n2\nBLOCKS\n').padEnd(65536), 'dxf'],
    ['OBJ after comments', ('# comment\n'.repeat(6500) + 'v 1e0 2 3 1\nf 1 2 3\n').padEnd(65536), 'obj'],
    ['malformed XML name', '<' + 'a.'.repeat(32767) + 'a', 'unknown'],
  ];
  for (const [name, text, format] of fixtures) {
    assert.equal(Buffer.byteLength(text), 65536);
    const started = performance.now();
    assert.equal(detect(text), format);
    const elapsed = performance.now() - started;
    context.diagnostic(`64 KiB ${name}: ${elapsed.toFixed(3)} ms`);
    assert.ok(elapsed < 250, `bounded head scan took ${elapsed.toFixed(3)} ms`);
  }
});
