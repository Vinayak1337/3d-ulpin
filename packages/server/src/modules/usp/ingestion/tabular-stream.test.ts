import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import test from 'node:test';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { TABULAR_STREAM_LIMITS, TabularPinSchema, TabularSourceProfileSchema } from '@ulpin/contracts/usp';
import { decodeColumnText, readColumnCsv } from './column-profile';
import { readStreamingTabular, tabularSourceRecord } from './streaming-vector-reader';
import { inspectTabularStream } from './tabular-source';
import { profileTabularStream, readTabularWindows, type StreamedTabularRow } from './tabular-stream';

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
  const read = await profileTabularStream(generated(TABULAR_STREAM_LIMITS.rows), selection);
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
