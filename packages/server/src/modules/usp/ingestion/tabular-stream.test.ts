import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import test from 'node:test';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { TABULAR_LIMITS, TABULAR_STREAM_LIMITS, TableWindowRowSchema, TabularPinSchema, TabularSourceProfileSchema }
  from '@ulpin/contracts/usp';
import { CONTROL_SHEET, controlWorkbook } from '../../../../../../tests/fixtures/xlsx-control';
import { decodeColumnText, readColumnCsv } from './column-profile';
import { readStreamingTabular, tabularSourceRecord } from './streaming-vector-reader';
import { isWindowedTable, windowRows } from './table-windows';
import { inspectTabularStream, readTabularSource } from './tabular-source';
import { profileTabularStream, readTableWindows, readTabularWindows, type StreamedTableWindow,
  type StreamedTabularRow, type StreamedWorkbookRow } from './tabular-stream';

const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const foreign = 'E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f';
// Public test_only registers (docs/api/datasets.json, D8-foreign); foreign tests stay in their own geography.
const register = `${foreign}/opf-d02/seattle-energy.csv`;
const footprints = `${foreign}/opf-d07/baton-footprint.csv`;
const dataDrive = { skip: !existsSync(register) || !existsSync(footprints) ? 'data drive not mounted' : false };

async function rowsOf(body: Readable) {
  const rows: StreamedTabularRow[] = [];
  const read = await readTabularWindows(body, async window => { rows.push(...window.rows); });
  return { read, rows };
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('cells stay as written across every chunk boundary, each row citing its own bytes', async () => {
  const text = '\uFEFFid,name,area\r\n007,"Plot ""A"", east",\r\n\r\n8,"two\nlines", 12.50 \n9\n10,,0\n';
  const bytes = Buffer.from(text);
  const whole = await rowsOf(Readable.from([bytes]));
  const split = await rowsOf(Readable.from([...bytes].map(byte => Buffer.from([byte]))));
  assert.deepEqual(split, whole);
  assert.deepEqual(whole.read.headers, ['id', 'name', 'area']);
  assert.deepEqual(whole.rows.map(row => [row.sourceRow, row.cells]), [
    [2, ['007', 'Plot "A", east', '']], [4, ['8', 'two\nlines', ' 12.50 ']], [5, ['9']], [6, ['10', '', '0']]]);
  for (const row of whole.rows) {
    assert.equal(row.rawSha256, sha(bytes.subarray(row.byteStart, row.byteEnd)));
  }
  assert.equal(bytes.subarray(whole.rows[1].byteStart, whole.rows[1].byteEnd).toString(), '8,"two\nlines", 12.50 ');
  assert.equal(whole.read.sha256, sha(bytes));
  const windows: { byteStart: number; byteEnd: number; sha256: string }[] = [];
  await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
    async window => { windows.push(window); });
  assert.deepEqual(windows.map(window => [window.byteStart, window.byteEnd]),
    [[whole.rows[0].byteStart, whole.rows[3].byteEnd]]);
  assert.equal(windows[0].sha256, sha(bytes.subarray(windows[0].byteStart, windows[0].byteEnd)),
    'a window hashes its own bytes, the blank record between its records included');
  await assert.rejects(rowsOf(Readable.from(['a,b\n1,"open\n'])), { code: 'TABULAR_CSV_MALFORMED' });
  await assert.rejects(rowsOf(Readable.from(['a,b\n1,2,3\n'])), { code: 'TABULAR_SCHEMA_DRIFT' });
});

function generated(rows: number) {
  const line = (row: number) => row % 11 === 0 ? `${row},0${row % 97}\n`
    : `${row},0${row % 97},${row % 7 ? `${row}.50` : ''},"n, ${row}"\n`;
  return Readable.from((function* () {
    yield 'id,code,area,note\n';
    for (let start = 1; start <= rows; start += 5000) {
      let part = '';
      for (let row = start; row < Math.min(start + 5000, rows + 1); row++) part += line(row);
      yield part;
    }
  })());
}

test('1,000,000 generated test_only rows stream in windows with bounded memory; one more is refused', async t => {
  v8.setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  const mib = (bytes: number) => Math.round(bytes / 1024 ** 2);
  let peak = 0;
  const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  gc();
  const before = process.memoryUsage().heapUsed, started = performance.now();
  const read = await profileTabularStream(generated(TABULAR_STREAM_LIMITS.rows), { selection, bytes: 0 });
  const elapsedMs = Math.round(performance.now() - started);
  clearInterval(sample);
  assert.equal(read.records, 1_000_000);
  assert.equal(read.windows, 100);
  assert.deepEqual(read.streamCounts[2], { written: 779_221, empty: 129_870, absent: 90_909 });
  assert.equal(read.streamCounts[1].written, 1_000_000);
  // Heap left after a full collection, every tenth window: flat, because one window is held, not the table.
  const retained: number[] = [];
  await readTabularWindows(generated(TABULAR_STREAM_LIMITS.rows), async window => {
    if (window.index % 10 === 9) { gc(); retained.push(mib(process.memoryUsage().heapUsed)); }
  });
  const measured = { rows: read.records, bytes: read.bytes, windows: read.windows, elapsedMs,
    heapBeforeMiB: mib(before), heapPeakMiB: mib(Math.max(peak, process.memoryUsage().heapUsed)),
    retainedAfterGcMiB: retained };
  t.diagnostic(JSON.stringify(measured));
  assert.equal(retained.length, 10);
  assert.ok(Math.max(...retained) - Math.min(...retained) < 16, JSON.stringify(measured));
  await assert.rejects(readTabularWindows(generated(TABULAR_STREAM_LIMITS.rows + 1), async () => undefined),
    (error: Error & { code?: string }) => error.code === 'TABULAR_STREAM_ROWS' &&
      /^This table is \d+(\.\d+)? MiB and has more than 1,000,000 records/.test(error.message));
});

test('a real register reads the same rows as the whole-file reader', dataDrive, async t => {
  const prefix = `${foreign}/opf-d02/seattle-energy-prefix-128.csv`;
  const whole = readColumnCsv(decodeColumnText(readFileSync(prefix)));
  const streamed = await rowsOf(createReadStream(prefix));
  assert.deepEqual(streamed.read.headers, whole.headers);
  assert.deepEqual(streamed.rows.map(row => row.cells), whole.rows);
  assert.deepEqual(streamed.rows.map(row => row.sourceRow), whole.sourceRows);
  const bytes = statSync(register).size, started = performance.now();
  const inventory = await inspectTabularStream(createReadStream(register), { sha256: sha(readFileSync(register)),
    bytes }, selection);
  t.diagnostic(JSON.stringify({ file: 'seattle-energy.csv', bytes, records: inventory.records,
    elapsedMs: Math.round(performance.now() - started) }));
  assert.ok(inventory.records > 30_000);
  const { schemaFingerprint: _fingerprint, ...stored } = inventory;
  TabularSourceProfileSchema.pick({ tabular: true, headers: true, records: true, profile: true, limitations: true,
    streamCounts: true }).parse(stored);
});

test('a 77 MB register with long quoted geometry cells is read by the raw job as a stream', dataDrive, async t => {
  const bytes = statSync(footprints).size, file = readFileSync(footprints);
  const pin = TabularPinSchema.parse({ selection, sourceBytes: bytes, admission: { kind: 'case_original',
    issuer: null, origin: 'officer_supplied', licence: 'unconfirmed', containsPersonalData: 'unknown' } });
  let features = 0, first: ReturnType<typeof tabularSourceRecord> | null = null;
  const started = performance.now();
  const read = await readStreamingTabular(createReadStream(footprints), pin, async item => {
    const record = tabularSourceRecord(item);
    first ??= record;
    features++;
  });
  t.diagnostic(JSON.stringify({ file: 'baton-footprint.csv', bytes, records: read.features,
    elapsedMs: Math.round(performance.now() - started) }));
  assert.equal(read.sha256, sha(file));
  assert.equal(read.features, features);
  assert.ok(features > 150_000);
  const cited = file.subarray(first!.byteStart, first!.byteEnd).toString();
  assert.match(cited, /^4861,8303,,66219,1,18,23,41,,"MULTIPOLYGON/);
  assert.equal(first!.rawSha256, sha(file.subarray(first!.byteStart, first!.byteEnd)));
});

const workbook = { format: 'xlsx' as const, sheet: 'Register', table: null, headerRows: [2] };
const source = (bytes: Buffer, selection: typeof workbook = workbook) => ({ selection, bytes: bytes.length });
// The workbook readers need the native reader's packages (services/geo); this one is named in the task's checks.
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
const python = { skip: existsSync(process.env.ULPIN_PROFILE_PYTHON) ? false : 'needs ULPIN_PROFILE_PYTHON' };
// A public official workbook (docs/api/datasets.json, mi-d19-01, RBI table 18); its licence stays unconfirmed.
const rbi = 'E:/BhuAayam-data/datasets/messy-india/rbi-development-table-18/original.xlsx';
const chunked = (bytes: Buffer) => Readable.from((function* () {
  for (let at = 0; at < bytes.length; at += 64 * 1024) yield bytes.subarray(at, at + 64 * 1024);
})());
// The private scratch the demo runtime gives its local readers; here a test folder outside the repository.
const scratchRoot = process.env.ULPIN_DOCUMENT_OCR_SCRATCH = join(tmpdir(), 'ulpin-table-scratch-stream');
const scratchDirectories = () => existsSync(scratchRoot)
  ? readdirSync(scratchRoot).filter(name => name.startsWith('table-workbook-')).length : 0;

test('a generated test_only workbook above 16 MiB is read sheet by sheet in windows, nothing calculated',
  python, async t => {
    const control = controlWorkbook(180_000);
    assert.ok(control.bytes.length > TABULAR_LIMITS.bytes, 'the workbook is above the whole-file bound');
    const scratch = scratchDirectories(), started = performance.now();
    const windows: Omit<StreamedTableWindow, 'rows'>[] = [];
    let first: StreamedTableWindow | null = null, firstHeaders: string[] = [];
    const read = await readTableWindows(chunked(control.bytes), source(control.bytes), async (window, headers) => {
      if (!first) { first = window; firstHeaders = headers; }
      const { rows, ...cited } = window;
      assert.equal(rows.length, 10_000);
      windows.push(cited);
    });
    const elapsedMs = Math.round(performance.now() - started);
    assert.deepEqual(read.headers, ['Ward', 'Plot', 'Area', 'Doubled', 'Tripled', 'Note', 'Hash']);
    assert.deepEqual([read.records, read.windows, read.bytes, read.sha256],
      [180_000, 18, control.bytes.length, sha(control.bytes)]);
    // D3: a window and each of its rows cite the sheet member's stored bytes in the original and the SHA-256 of
    // exactly those bytes; a row also names its sheet and the SHA-256 of the sheet's XML as read.
    const [byteStart, byteEnd] = control.ranges.get(CONTROL_SHEET)!, stored = sha(control.bytes.subarray(byteStart,
      byteEnd));
    assert.deepEqual(windows.map(window => window.index), Array.from({ length: 18 }, (_, index) => index));
    assert.ok(windows.every(window => window.byteStart === byteStart && window.byteEnd === byteEnd
      && window.sha256 === stored));
    const rows = first!.rows as StreamedWorkbookRow[], area = parseInt(control.digest(3).slice(0, 8), 16);
    assert.deepEqual(rows[0], { index: 0, sourceRow: 3, byteStart, byteEnd, rawSha256: stored, sheet: 'Register',
      sheetSha256: control.sheetSha256,
      cells: [control.ward(3), '3.50', String(area), String(area * 2), null, ' lot 3 ', control.digest(3)],
      marks: [{ column: 3, mark: 'formula_cached' }, { column: 4, mark: 'formula_uncached' }] });
    assert.deepEqual([rows[2].sourceRow, rows[2].cells[5]], [5, ''], 'an empty shared string stays empty');
    assert.deepEqual([rows[4].sourceRow, rows[4].cells[5]], [7, null], 'a missing cell stays absent, not 0');
    const kept = windowRows(first!, firstHeaders)[4];
    assert.deepEqual(kept, { record: 4, sourceRow: 7, byteStart, byteEnd, sha256: stored, sheet: 'Register',
      sheetSha256: control.sheetSha256, marks: rows[4].marks, cells: rows[4].cells });
    const { sheetSha256: _sheetSha256, ...unnamed } = kept;
    assert.equal(TableWindowRowSchema.safeParse(unnamed).success, false, 'a sheet row names its sheet\'s SHA-256');
    assert.equal(scratchDirectories(), scratch, 'the private copy is removed');
    t.diagnostic(JSON.stringify({ bytes: read.bytes, records: read.records, windows: read.windows, elapsedMs }));

    // D2, D4: the pin states the streamed size, the raw job takes the windowed path, the notes say what was kept.
    const inventory = await inspectTabularStream(chunked(control.bytes), { sha256: read.sha256, bytes: read.bytes },
      workbook);
    assert.equal(scratchDirectories(), scratch, 'the profile read removes its copy too');
    assert.ok(isWindowedTable({ framing: 'tabular', tabular: inventory.tabular, sourceBytes: read.bytes }));
    const absentNotes = Array.from({ length: 180_000 }, (_, n) => n + 3).filter(row => row % 7 === 0 && row % 5);
    assert.deepEqual(inventory.streamCounts.slice(3, 6), [{ written: 180_000, empty: 0, absent: 0 },
      { written: 0, empty: 0, absent: 180_000 },
      { written: 144_000 - absentNotes.length, empty: 36_000, absent: absentNotes.length }]);
    assert.ok(inventory.limitations.includes('180000 formula cells keep their cached text, marked; 180000 have ' +
      'none and are null. No formula was calculated.'));
    assert.ok(inventory.limitations.includes('The sheet has merged ranges; no value was copied into other cells.'));
    const { schemaFingerprint: _fingerprint, ...profile } = inventory;
    TabularSourceProfileSchema.pick({ tabular: true, headers: true, records: true, profile: true, limitations: true,
      streamCounts: true }).parse(profile);
  });

test('a refused workbook stops with its code in officer words; the copy is removed', python, async () => {
  const scratch = scratchDirectories(), small = controlWorkbook(30);
  await assert.rejects(readTableWindows(chunked(small.bytes), source(small.bytes, { ...workbook, sheet: 'register' }),
    async () => {}),
    { status: 422, code: 'WORKBOOK_SHEET_MISSING',
      message: 'This workbook has no sheet with exactly that name; check its spelling and case.' });
  const entity = controlWorkbook(0, '<!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet xmlns="http://schemas.' +
    'openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>&a;</t>' +
    '</is></c></row></sheetData></worksheet>');
  await assert.rejects(readTableWindows(chunked(entity.bytes), source(entity.bytes), async () => {}),
    { status: 422, code: 'NATIVE_WORKBOOK_INVALID' });
  const csv = Buffer.from('a,b\n1,2\n');
  await assert.rejects(readTableWindows(Readable.from([csv]), source(csv), async () => {}),
    { status: 422, code: 'NATIVE_WORKBOOK_INVALID' });
  await assert.rejects(readTableWindows(chunked(small.bytes), source(small.bytes, { ...workbook, headerRows: [2, 40] }),
    async () => {}), { status: 422, code: 'TABULAR_HEADER_REQUIRED' }, 'a pinned header row the sheet does not have');
  const enough = new Error('first window read');
  await assert.rejects(readTableWindows(chunked(small.bytes), source(small.bytes), async () => { throw enough; }),
    error => error === enough, 'the caller may stop after one window; the reader is stopped');
  assert.equal(scratchDirectories(), scratch);
});

test('a workbook larger than the scratch folder can hold is refused before it is copied', async () => {
  const scratch = scratchDirectories(), body = Readable.from([Buffer.from('never read')]);
  await assert.rejects(readTableWindows(body, { selection: workbook, bytes: 2 ** 50 }, async () => {}),
    (error: Error & { status?: number; code?: string }) => error.status === 507
      && error.code === 'TABULAR_SCRATCH_SPACE' && /^The scratch folder has \d+(\.\d+)? (MiB|GiB) free; reading this /
        .test(error.message) && error.message.includes('1048576.00 GiB workbook needs its size and 1 GiB more'));
  assert.equal(scratchDirectories(), scratch, 'nothing was copied');
  const configured = process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
  try {
    delete process.env.ULPIN_DOCUMENT_OCR_SCRATCH;
    await assert.rejects(readTableWindows(body, { selection: workbook, bytes: 1 }, async () => {}),
      { status: 503, code: 'TABULAR_SCRATCH_UNAVAILABLE' });
  } finally { process.env.ULPIN_DOCUMENT_OCR_SCRATCH = configured; }
});

test('a real workbook reads the same headers, rows and cells as the whole read',
  { skip: existsSync(rbi) ? python.skip : 'data drive not mounted' }, async () => {
    const bytes = readFileSync(rbi), selection = { ...workbook, sheet: 'T_18' };
    const whole = readTabularSource(bytes, selection), rows: StreamedWorkbookRow[] = [];
    const read = await readTableWindows(chunked(bytes), { selection, bytes: bytes.length }, async window => {
      rows.push(...window.rows as StreamedWorkbookRow[]);
    });
    assert.equal(read.sha256, sha(bytes));
    assert.deepEqual(read.headers, whole.headers);
    assert.deepEqual(rows.map(row => row.sourceRow), whole.sourceRows);
    // The whole read keeps no formula text; the window keeps the cached text and marks the cell.
    const plain = (cells: unknown[], row: StreamedWorkbookRow) => whole.headers.map((_, column) =>
      row.marks?.some(mark => mark.column === column) ? 'marked' : cells[column] ?? null);
    rows.forEach((row, at) => assert.deepEqual(plain(row.cells, row), plain(whole.rows[at], row)));
    assert.ok(rows.length > 10);
  });
