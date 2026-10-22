import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { TABULAR_LIMITS, type TabularSelection } from '@ulpin/contracts/usp';
import { odsWorkbook, xlsxWorkbook } from '../../../../../../tests/fixtures/ods-control';
import { probeOriginal } from './intake-probe';
import { readTabularSource } from './tabular-source';
import { readTableWindows, type StreamedWorkbookRow } from './tabular-stream';

// The workbook readers need the native reader's packages (services/geo).
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
const python = { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON) ? false : 'needs ULPIN_PROFILE_PYTHON' };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pick = (format: 'xlsx' | 'ods'): TabularSelection => ({ format, sheet: 'Wards', table: null, headerRows: [1] });

// test_only: coordinates and outlines typed for these tests, not records of any place. Neighbouring equal cells and
// the two equal rows are what an ODS writes once with a repeat count.
const LAT_LON = [['ward', 'zone', 'circle', 'latitude', 'longitude'], ['Ward 1', 'A', 'A', '12.9716', '77.5946'],
  ['Ward 2', 'B', 'C', '12.98', '77.61'], ['Ward 2', 'B', 'C', '12.98', '77.61'], ['Ward 3', 'C', 'C', '', '']];
const WKT = [['plot', 'outline'], ['P-1', 'POLYGON ((776500.25 1434500, 776520 1434500, 776520 1434520, '
  + '776500.25 1434500))'], ['P-2', 'POINT (776600 1434600)'], ['P-3', 'near the temple']];

for (const [name, rows] of [['latitude and longitude columns', LAT_LON], ['a WKT column', WKT]] as const) {
  test(`an ODS with ${name} reads to the same table as the same cells in an XLSX`, python, () => {
    const ods = readTabularSource(odsWorkbook('Wards', [...rows]).bytes, pick('ods'));
    const xlsx = readTabularSource(xlsxWorkbook('Wards', [...rows]).bytes, pick('xlsx'));
    assert.deepEqual(ods, xlsx);
    assert.deepEqual(ods.headers, rows[0]);
    assert.equal(ods.rows.length, rows.length - 1);
  });
}

test('an ODS over the whole reader\'s bound is refused in words that it was kept and not read', python, () => {
  const many = [['id', 'lon', 'lat'], ...Array.from({ length: 2001 }, (_, row) => [`${row}`, `77.${row}`, '12.5'])];
  const words = 'An ODS workbook is read whole, never as a stream: up to 16 MiB, 2,000 records and 2,000 cells. '
    + 'This one holds more, so it was kept unchanged and not read; no record is cut to fit. Save it as XLSX or CSV '
    + 'to read every record.';
  assert.throws(() => readTabularSource(odsWorkbook('Wards', many).bytes, pick('ods')),
    { code: 'TABULAR_ODS_LIMIT', status: 413, message: words });
  // One row repeated past the bound is refused the same way, never cut to fit.
  const repeated = [['id', 'lon', 'lat'], ...Array.from({ length: 2001 }, () => ['1', '77.5', '12.5'])];
  assert.throws(() => readTabularSource(odsWorkbook('Wards', repeated).bytes, pick('ods')),
    { code: 'TABULAR_ODS_LIMIT', message: words });
  // An XLSX keeps its own words: it is read again as a stream.
  assert.throws(() => readTabularSource(xlsxWorkbook('Wards', many).bytes, pick('xlsx')),
    { code: 'TABULAR_ROW_LIMIT', message: /it is read as a stream instead; no record is cut to fit/ });
});

test('an ODS is read in one window whose rows cite content.xml, as the whole read gives them', python, async () => {
  const ods = odsWorkbook('Wards', LAT_LON);
  const whole = readTabularSource(ods.bytes, pick('ods'));
  const rows: StreamedWorkbookRow[] = [];
  const read = await readTableWindows(Readable.from([ods.bytes]), { selection: pick('ods'), bytes: ods.bytes.length },
    async window => { rows.push(...window.rows as StreamedWorkbookRow[]); });
  const [byteStart, byteEnd] = ods.ranges.get('content.xml')!;
  assert.deepEqual([read.headers, read.records, read.windows, read.sha256], [whole.headers, 4, 1, sha(ods.bytes)]);
  assert.deepEqual(rows.map(row => row.cells), whole.rows.map(row => [...row, ...Array(5 - row.length).fill(null)]));
  assert.deepEqual(rows.map(row => row.sourceRow), whole.sourceRows);
  assert.deepEqual([rows[0]!.sheet, rows[0]!.byteStart, rows[0]!.byteEnd, rows[0]!.rawSha256],
    ['Wards', byteStart, byteEnd, sha(ods.bytes.subarray(byteStart, byteEnd))]);
  assert.match(read.notes![0]!, /^An ODS workbook is read whole, never as a stream/);
});

test('an ODS above 16 MiB is refused before it is read, never cut', async () => {
  const body = Readable.from([Buffer.alloc(TABULAR_LIMITS.bytes), Buffer.alloc(1)]);
  await assert.rejects(readTableWindows(body, { selection: pick('ods'), bytes: TABULAR_LIMITS.bytes + 1 },
    async () => assert.fail('no window')), { code: 'TABULAR_ODS_LIMIT' });
});

/** An OLE2 compound file head: the header sector, then the first directory sector naming the given streams. */
function compoundFile(streams: string[]): Buffer {
  const file = Buffer.alloc(1024);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(file);
  file.writeUInt16LE(9, 30);
  file.writeUInt32LE(0, 48);
  ['Root Entry', ...streams].forEach((stream, index) => {
    const at = 512 + index * 128;
    file.write(stream, at, 'utf16le');
    file.writeUInt16LE((stream.length + 1) * 2, at + 64);
  });
  return file;
}

const probe = (bytes: Buffer, name: string) => probeOriginal(async (start, end) => bytes.subarray(start, end),
  bytes.length, name);

test('a legacy .xls is recognised as a kept workbook, never read; another compound file stays unknown', async () => {
  const kept = 'Excel 97-2003 workbook. It is kept as evidence; this version does not read its cells. Save it as '
    + 'XLSX or ODS and add that file to place its rows on the map.';
  const named = await probe(compoundFile(['SummaryInformation']), 'ward-list.XLS');
  assert.deepEqual([named.format, named.family, named.detectedBy, named.nameDisagrees, named.limits],
    ['xls', 'table', 'bytes_and_name', false, [kept]]);
  const stream = await probe(compoundFile(['Workbook']), 'export.bin');
  assert.deepEqual([stream.format, stream.detectedBy, stream.nameDisagrees], ['xls', 'bytes', true]);
  for (const [streams, name] of [[['WordDocument'], 'letter.doc'], [['__substg1.0_0037001F'], 'note.msg']] as const) {
    const other = await probe(compoundFile([...streams]), name);
    assert.deepEqual([other.format, other.family], ['unknown', 'unknown']);
  }
});

test('an ODS and an XLSX dropped alone keep their own table kinds', async () => {
  const ods = await probe(odsWorkbook('Wards', LAT_LON).bytes, 'wards.ods');
  const xlsx = await probe(xlsxWorkbook('Wards', LAT_LON).bytes, 'wards.xlsx');
  assert.deepEqual([ods.format, ods.family, xlsx.format, xlsx.family, xlsx.sheets], ['ods', 'table', 'xlsx', 'table',
    [{ name: 'Wards', count: null }]]);
});
