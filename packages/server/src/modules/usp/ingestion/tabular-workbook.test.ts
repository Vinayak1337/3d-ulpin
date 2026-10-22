import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { TABULAR_LIMITS, TABULAR_STREAM_LIMITS, type TabularSelection } from '@ulpin/contracts/usp';
import { odsWorkbook, xlsxWorkbook, type OdsCell } from '../../../../../../tests/fixtures/ods-control';
import { probeOriginal } from './intake-probe';
import { readZipMember } from './intake-zip';
import { readTabularSource } from './tabular-source';
import { readTableWindows, type StreamedWorkbookRow } from './tabular-stream';
import { rowLimit, workbookTable } from './tabular-workbook';
import { zipMembers } from '../../../../../../tests/fixtures/xlsx-control';
import { windowRows } from './table-windows';

// The workbook readers need the native reader's packages (services/geo).
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
const python = { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON) ? false : 'needs ULPIN_PROFILE_PYTHON' };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pick = (format: 'xlsx' | 'ods'): TabularSelection => ({ format, sheet: 'Wards', table: null, headerRows: [1] });

function nativeElementLimit(): string {
  const source = readFileSync('services/geo/geo/native_workbook.py', 'utf8');
  const rows = Number(/^MAX_ROWS = (\d+)$/m.exec(source)![1]);
  const cells = Number(/^MAX_CELLS = (\d+)$/m.exec(source)![1]);
  assert.equal(rows, cells, 'the shared XML element wording must name both native bounds');
  return cells.toLocaleString('en-US');
}

test('the whole-reader refusal distinguishes XML elements from ODS repeat expansion', () => {
  assert.throws(rowLimit, { code: 'TABULAR_ROW_LIMIT', message:
    'This table holds more than the whole-file reader takes: '
    + `${TABULAR_LIMITS.rows.toLocaleString('en-US')} records, a workbook's ${nativeElementLimit()} XML row or `
    + 'cell elements, the ODS repeat-expansion check at '
    + `${(TABULAR_LIMITS.rows * TABULAR_LIMITS.columns).toLocaleString('en-US')} cells, or the native sheet, text `
    + 'or archive bounds. Kept through the upload, it is read as a stream instead; no record is cut to fit.' });
});

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

test('an ODS over the whole reader\'s bound is read as a stream instead, as an XLSX is', python, () => {
  const many = [['id', 'lon', 'lat'], ...Array.from({ length: 2001 }, (_, row) => [`${row}`, `77.${row}`, '12.5'])];
  const stream = { code: 'TABULAR_ROW_LIMIT', status: 422,
    message: /it is read as a stream instead; no record is cut/ };
  assert.throws(() => readTabularSource(odsWorkbook('Wards', many).bytes, pick('ods')), stream);
  // One row repeated past the bound is not cut to fit either.
  const repeated = [['id', 'lon', 'lat'], ...Array.from({ length: 2001 }, () => ['1', '77.5', '12.5'])];
  assert.throws(() => readTabularSource(odsWorkbook('Wards', repeated).bytes, pick('ods')), stream);
  assert.throws(() => readTabularSource(xlsxWorkbook('Wards', many).bytes, pick('xlsx')), stream);
});

/** test_only: blocks of ten typed rows, one written once and one repeated nine times by the ODS; block 3's total is a
 * formula with its stored result. */
function register(records: number): OdsCell[][] {
  const rows: OdsCell[][] = [['id', 'ward', 'zone', 'total']];
  for (let block = 0; rows.length <= records; block++) {
    const total = block === 3 ? { formula: 'of:=[.D2]*2', stored: '6' } : `${block}`;
    rows.push([`R${block * 10 + 1}`, `W${block}`, `Z${block % 7}`, total]);
    rows.push(...Array.from({ length: 9 }, () => [`B${block}`, `W${block}`, `W${block}`, `${block}`]));
  }
  return rows.slice(0, records + 1);
}

test('an ODS of 2,500 records is read as a stream: every record, the first 2,000 as the whole read gives them',
  python, async () => {
    const configured = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    const scratch = process.env.ULPIN_DOCUMENT_OCR_SCRATCH = await mkdtemp(join(tmpdir(), 'ulpin-ods-stream-'));
    try {
      const ods = odsWorkbook('Wards', register(2500), [['Notes', [['note'], ['kept']]]]);
      const rows: StreamedWorkbookRow[] = [];
      const read = await readTableWindows(Readable.from([ods.bytes]), { selection: pick('ods'),
        bytes: ods.bytes.length }, async (window, headers) => {
        assert.ok(window.rows.length <= TABULAR_STREAM_LIMITS.windowRows);
        const stored = windowRows(window, headers);
        assert.equal(stored[0]!.rowSha256, (window.rows[0] as StreamedWorkbookRow).rowSha256);
        assert.equal(stored[0]!.rowElement, (window.rows[0] as StreamedWorkbookRow).rowElement);
        rows.push(...window.rows as StreamedWorkbookRow[]);
      });
      assert.deepEqual([read.headers, read.records, read.windows, read.sha256],
        [['id', 'ward', 'zone', 'total'], 2500, 1, sha(ods.bytes)]);
      assert.deepEqual(rows.map(row => row.sourceRow), Array.from({ length: 2500 }, (_, index) => index + 2),
        'the trailing padding writes no record');
      const whole = workbookTable(odsWorkbook('Wards', register(2000)).bytes, pick('ods'), 'ods');
      assert.deepEqual(rows.slice(0, 2000).map(row => row.sourceRow), whole.sourceRows);
      // The whole read leaves a marked cell without a value; the stream keeps its stored text, marked the same way.
      rows.slice(0, 2000).forEach((row, index) => {
        const marks = whole.marks[index]!;
        assert.deepEqual(row.cells.filter((_cell, column) => !marks[column]),
          marks.flatMap((mark, column) => mark ? [] : [whole.rows[index]![column] ?? null]));
        assert.deepEqual(row.marks ?? [], marks.flatMap((mark, column) => mark ? [{ column, mark }] : []));
      });
      assert.deepEqual([rows[30]!.cells, rows[30]!.marks], [['R31', 'W3', 'Z3', '6'],
        [{ column: 3, mark: 'formula_cached' }]], 'a formula keeps its stored result, marked');
      // Each row cites content.xml's stored bytes, and its own row element: the ordinal and its XML's SHA-256.
      const [byteStart, byteEnd] = ods.ranges.get('content.xml')!;
      assert.deepEqual([rows[1]!.byteStart, rows[1]!.byteEnd, rows[1]!.rawSha256],
        [byteStart, byteEnd, sha(ods.bytes.subarray(byteStart, byteEnd))]);
      assert.deepEqual([rows[1]!.rowElement, rows[9]!.rowElement, rows[10]!.rowElement], [3, 3, 4]);
      assert.equal(rows[1]!.rowSha256, rows[9]!.rowSha256);
      assert.match(rows[1]!.rowSha256!, /^[a-f0-9]{64}$/);
      // Within 16 MiB the whole read answers a sheet it does not hold, as for an XLSX, before any stream.
      await assert.rejects(readTableWindows(Readable.from([ods.bytes]), { selection: { ...pick('ods'),
        sheet: 'wards' }, bytes: ods.bytes.length }, async () => {}), { code: 'TABULAR_HEADER_REQUIRED' });
    } finally {
      if (configured === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
      else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = configured;
      await rm(scratch, { recursive: true, force: true });
    }
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
  assert.equal(read.notes![0], `This ODS sheet was read whole: the original is within `
    + `${TABULAR_LIMITS.bytes / 1024 ** 2} MiB and the selected table within `
    + `${TABULAR_LIMITS.rows.toLocaleString('en-US')} records and ${TABULAR_LIMITS.columns} header columns; `
    + 'the native reader caps XML row and cell elements at '
    + `${nativeElementLimit()} each across the workbook, and non-padding repeat expansion is checked against `
    + `${(TABULAR_LIMITS.rows * TABULAR_LIMITS.columns).toLocaleString('en-US')} cells. `
    + 'A larger one is read as a stream.');
});

test('an ODS above 16 MiB streams unchanged, including when the length was not known in advance', python,
  async () => {
    const configured = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    const scratch = process.env.ULPIN_DOCUMENT_OCR_SCRATCH = await mkdtemp(join(tmpdir(), 'ulpin-ods-large-'));
    try {
      // test_only: an uncompressed-size attachment makes a valid large package; no image is interpreted.
      const ods = odsWorkbook('Wards', [['name'], ['kept']], [],
        [['Pictures/test_only.bin', randomBytes(TABULAR_LIMITS.bytes)]]);
      assert.ok(ods.bytes.length > TABULAR_LIMITS.bytes);
      for (const bytes of [ods.bytes.length, 0]) {
        const rows: StreamedWorkbookRow[] = [];
        const body = Readable.from((function* () {
          for (let start = 0; start < ods.bytes.length; start += 65536) yield ods.bytes.subarray(start, start + 65536);
        })());
        const read = await readTableWindows(body, { selection: pick('ods'), bytes }, async window => {
          rows.push(...window.rows as StreamedWorkbookRow[]);
        });
        assert.deepEqual([read.bytes, read.sha256, read.records, rows[0]!.cells],
          [ods.bytes.length, sha(ods.bytes), 1, ['kept']]);
        assert.equal(rows[0]!.rowElement, 2, 'the large package used the stream, never the whole-file read');
      }
      await assert.rejects(readTableWindows(Readable.from([ods.bytes]), { selection: { ...pick('ods'),
        sheet: 'missing' }, bytes: ods.bytes.length }, async () => assert.fail('no window')),
      { code: 'WORKBOOK_SHEET_MISSING' });
      const content = await readZipMember(async (start, end) => ods.bytes.subarray(start, end), ods.bytes.length,
        'content.xml', TABULAR_LIMITS.bytes);
      const manifest = await readZipMember(async (start, end) => ods.bytes.subarray(start, end), ods.bytes.length,
        'META-INF/manifest.xml', TABULAR_LIMITS.bytes);
      const invalid = zipMembers([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'],
        ['content.xml', Buffer.from(content.bytes).toString().replace('1048574', '1048577')],
        ['META-INF/manifest.xml', Buffer.from(manifest.bytes)]]).bytes;
      await assert.rejects(readTableWindows(Readable.from([invalid]), { selection: pick('ods'), bytes: invalid.length },
        async () => {}), { code: 'TABULAR_ODS_LIMIT', status: 413,
        message: /cannot be read as a stream either/ });
    } finally {
      if (configured === undefined) delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
      else process.env.ULPIN_DOCUMENT_OCR_SCRATCH = configured;
      await rm(scratch, { recursive: true, force: true });
    }
  });

test('an ODS above 16 MiB needs the private scratch folder before it is copied', async () => {
  const configured = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  try {
    const body = Readable.from([Buffer.alloc(TABULAR_LIMITS.bytes), Buffer.alloc(1)]);
    await assert.rejects(readTableWindows(body, { selection: pick('ods'), bytes: TABULAR_LIMITS.bytes + 1 },
      async () => assert.fail('no window')), { code: 'TABULAR_SCRATCH_UNAVAILABLE' });
  } finally {
    if (configured !== undefined) process.env.ULPIN_DOCUMENT_OCR_SCRATCH = configured;
  }
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

test('an ODS card never takes a sheet name from a comment, CDATA or a rebound namespace', async () => {
  const table = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const office = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const head = `<o:document-content xmlns:o="${office}" xmlns:t="${table}"><o:body><o:spreadsheet>`;
  const tail = '</o:spreadsheet></o:body></o:document-content>';
  const hidden = '<!--<t:table t:name="Not a sheet"/>--><![CDATA[<t:table t:name="Also not a sheet"/>]]>';
  const actual = '<t:table t:name="Notes &gt; sources"/>';
  const content = head + hidden + actual + tail;
  const make = (xml: string) => zipMembers([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'],
    ['content.xml', xml]]).bytes;
  const card = await probe(make(content), 'notes.ods');
  assert.deepEqual(card.sheets, [{ name: 'Notes > sources', count: null }]);
  const rebound = head + '<t:table xmlns:t="urn:not-an-ods-table" t:name="Not a sheet"/>' + tail;
  assert.deepEqual((await probe(make(rebound), 'notes.ods')).sheets, []);
});

test('an ODS card names its sheets from the head of content.xml, and says when the list may be longer', async () => {
  const two = await probe(odsWorkbook('Wards', LAT_LON, [['Notes & sources', [['note']]]]).bytes, 'wards.ods');
  assert.deepEqual(two.sheets, [{ name: 'Wards', count: null }, { name: 'Notes & sources', count: null }]);
  assert.ok(two.limits.includes('ODS sheet names only, from table start tags in content.xml; no row or cell read.'));
  // A first sheet past the 64 KiB head leaves the second unseen: the card names the first and says more may follow.
  const long = Array.from({ length: 3000 }, (_, row) => [`Ward ${row}`, `${row}`]);
  const cut = await probe(odsWorkbook('Wards', long, [['Notes', [['note']]]]).bytes, 'wards.ods');
  assert.deepEqual(cut.sheets, [{ name: 'Wards', count: null }]);
  assert.ok(cut.limits.includes('content.xml was cut at the member-head limit; these are at least its first sheets, '
    + 'and more may follow.'));
});
