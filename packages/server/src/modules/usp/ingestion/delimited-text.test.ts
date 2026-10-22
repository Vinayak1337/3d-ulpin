import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { TabularSelection } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { windowedTableRow } from '../../registry/registry-table-evidence';
import { profileColumnFile, readColumnCsv } from './column-profile';
import { chooseTableDelimiter, decodeDelimitedText } from './delimited-text';
import { inspectTabularSource, inspectTabularStream, readTabularSource } from './tabular-source';
import { probeOriginal } from './intake-probe';
import { readTabularWindows, type StreamedTabularRow } from './tabular-stream';

const selection: TabularSelection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fixtures = [
  { text: 'label;note\nA;"inside; and ""quoted""\nnext"\n', delimiter: ';',
    cells: ['A', 'inside; and "quoted"\nnext'] },
  { text: 'label\tnote\nA\tvalue\n', delimiter: '\t', cells: ['A', 'value'] },
  { text: 'label|note\nA|value\n', delimiter: '|', cells: ['A', 'value'] },
  { text: 'label,note\nA,value\n', delimiter: ',', cells: ['A', 'value'] },
  { text: 'label,note\nA,value\nB,other\n', delimiter: ',', cells: ['A', 'value'] },
  { text: 'label\nvalue\n', delimiter: ',', cells: ['value'] },
] as const;

test('all table readers use deterministic delimiters, including CSV1 and a single column', async () => {
  for (const fixture of fixtures) {
    const bytes = Buffer.from(fixture.text), originalHash = sha(bytes);
    const inventory = inspectTabularSource(bytes, selection);
    assert.equal(inventory.profile.delimiter, fixture.delimiter);
    assert.equal(inventory.profile.encoding, 'utf-8');
    const whole = readTabularSource(bytes, inventory.tabular.selection);
    const rows: StreamedTabularRow[] = [];
    const read = await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
      async window => { rows.push(...window.rows); });
    assert.equal(read.delimiter, fixture.delimiter);
    assert.deepEqual(rows.map(row => row.cells), whole.rows);
    assert.deepEqual(whole.rows[0], fixture.cells);
    assert.deepEqual(readColumnCsv(fixture.text).rows, whole.rows);
    const row = rows[0];
    assert.equal(row.rawSha256, sha(bytes.subarray(row.byteStart, row.byteEnd)));
    assert.equal(sha(bytes), originalHash, 'the original bytes are unchanged');
  }
  assert.equal(chooseTableDelimiter('a;b\n1;2;3\n'), ',', 'inconsistent second record falls back to comma');
  assert.equal(chooseTableDelimiter('\n\r\na;b\n1;2\n'), ';');
  assert.equal(chooseTableDelimiter(';;\na;b\n1;2\n'), ';');
  assert.deepEqual(readColumnCsv(';;\na;b\n1;2\n').headers, ['a', 'b']);
  assert.deepEqual(readColumnCsv('\n\na;b\n1;2\n').sourceRows, [4]);
  assert.equal(chooseTableDelimiter('a,b,c\tz\n1,2,3\t4\n', 'judge.tsv'), '\t');
});

test('a consistent delimiter wins over a wider but inconsistent header', () => {
  assert.equal(chooseTableDelimiter('Name;Area, sq m, gross;Id\nA;12,5;1\n'), ';');
  assert.equal(chooseTableDelimiter('label,note,id\nA,value,1\n'), ',');
  assert.equal(chooseTableDelimiter('Name;Area;Rate\nA;12,5;3,25\n'), ';');
});

test('BOMs and Windows-1252 are recorded consistently by whole-file and byte-window readers', async () => {
  const text = 'label;note\nA;café\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  const directory = await mkdtemp(join(tmpdir(), 'csv2-profile-'));
  try {
    for (const [bytes, encoding] of [[le, 'utf-16le'], [be, 'utf-16be'],
      [Buffer.from('\uFEFF' + text), 'utf-8'], [Buffer.from(text, 'latin1'), 'windows-1252'],
      [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'latin1')]), 'windows-1252']] as const) {
      const inventory = inspectTabularSource(bytes, selection);
      assert.equal(inventory.profile.encoding, encoding);
      assert.equal(inventory.profile.delimiter, ';');
      const table = readTabularSource(bytes, inventory.tabular.selection);
      assert.deepEqual(table.headers, ['label', 'note']);
      assert.deepEqual(table.rows, [['A', 'café']]);
      const path = join(directory, 'judge.csv');
      await writeFile(path, bytes);
      assert.equal(profileColumnFile(path).profile.encoding, encoding);
      const rows: StreamedTabularRow[] = [];
      const streamed = await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
        async window => { rows.push(...window.rows); });
      assert.equal(streamed.encoding, encoding);
      assert.deepEqual(rows.map(row => row.cells), table.rows);
    }
    const path = join(directory, 'judge.tsv');
    await writeFile(path, 'a,b,c\tz\n1,2,3\t4\n');
    assert.equal(profileColumnFile(path).profile.delimiter, '\t');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Windows-1252 byte ranges and accented headers read back as the same evidence row', async () => {
  const bytes = Buffer.concat([Buffer.from('clé;note\r\nA;"café; ', 'latin1'),
    Buffer.from([0x93]), Buffer.from('text', 'ascii'), Buffer.from([0x94]), Buffer.from('"\r\n')]);
  const inventory = await inspectTabularStream(Readable.from([bytes]), { bytes: bytes.length, sha256: sha(bytes) },
    selection);
  assert.equal(inventory.profile.encoding, 'windows-1252');
  assert.equal(inventory.tabular.selection.delimiter, ';');
  const rows: StreamedTabularRow[] = [];
  const read = await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
    async window => { rows.push(...window.rows); }, inventory.tabular.selection);
  assert.deepEqual(read.headers, ['clé', 'note']);
  assert.deepEqual(rows[0].cells, ['A', 'café; “text”']);
  const row = rows[0], raw = bytes.subarray(row.byteStart, row.byteEnd);
  const locator = { selection: inventory.tabular.selection, columnIndex: 0, columnHeader: 'clé',
    cell: { state: 'literal', value: 'A' },
    rowSha256: fingerprint(row.cells.map(value => ({ state: 'literal', value }))),
    window: { index: 0, record: 0, byteStart: row.byteStart, byteEnd: row.byteEnd, sha256: sha(raw) } };
  const excerpt = await windowedTableRow(locator as Parameters<typeof windowedTableRow>[0], read.headers, raw);
  assert.equal(excerpt, 'clé: A\nnote: café; “text”');
  await assert.rejects(windowedTableRow(locator as Parameters<typeof windowedTableRow>[0], read.headers,
    Buffer.concat([raw, Buffer.from('\n')])), /differs from its window/);
});

test('a late invalid UTF-8 byte selects Windows-1252 for every cell, not just the failing cell', async () => {
  const bytes = Buffer.concat([Buffer.from('label;note\nA;café\nB;'), Buffer.from([0xe9]), Buffer.from('\n')]);
  const rows: StreamedTabularRow[] = [];
  const read = await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
    async window => { rows.push(...window.rows); });
  assert.equal(read.encoding, 'windows-1252');
  assert.deepEqual(rows.map(row => row.cells), [['A', 'cafÃ©'], ['B', 'é']]);
  assert.equal(decodeDelimitedText(bytes).encoding, read.encoding);
});

test('a TSV name preference is pinned once for whole and streamed profiles', async () => {
  const bytes = Buffer.from('a,b,c\tz\n1,2,3\t4\n');
  const whole = inspectTabularSource(bytes, selection, {}, 'judge.tsv');
  const streamed = await inspectTabularStream(Readable.from([bytes]),
    { bytes: bytes.length, sha256: sha(bytes) }, selection, {}, 'judge.tsv');
  assert.equal(whole.tabular.selection.delimiter, '\t');
  assert.deepEqual(streamed.tabular.selection, whole.tabular.selection);
  assert.deepEqual(streamed.profile, whole.profile);
  assert.deepEqual(readTabularSource(bytes, whole.tabular.selection).rows, [['1,2,3', '4']]);
});

test('the intake head probe uses the same table reading policy', async () => {
  for (const [bytes, name, delimiter, encoding] of [
    [Buffer.from('key;note\nA;café\n', 'latin1'), 'judge.csv', ';', 'windows-1252'],
    [Buffer.from('a,b,c\tz\n1,2,3\t4\n'), 'judge.tsv', '\t', 'utf-8'],
    [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('key;note\nA;café\n', 'utf16le')]),
      'judge.csv', ';', 'utf-16le'],
  ] as const) {
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
    assert.equal(card.delimiter, delimiter);
    assert.equal(card.encoding, encoding);
    assert.equal(card.columns.length, 2);
  }
});

test('invalid table text is refused with reader words rather than an internal error', () => {
  for (const bytes of [Buffer.from('key,note\nA,\0\n'), Buffer.from([0xff, 0xfe, 0x41])]) {
    assert.throws(() => inspectTabularSource(bytes, selection),
      (error: Error & { code?: string; status?: number }) => error.code === 'TABULAR_ENCODING'
        && error.status === 422 && error.message.includes('original is unchanged'));
  }
});

test('a single Windows-1252 byte still reaches the header refusal, not a decoder error', async () => {
  await assert.rejects(readTabularWindows(Readable.from([Buffer.from([0xe9])]), async () => assert.fail('no rows')),
    { code: 'TABULAR_HEADER_REQUIRED' });
});

test('stored selections without a delimiter remain comma readings', () => {
  const old = readTabularSource(Buffer.from('a;b\n1;2\n'), selection);
  assert.deepEqual(old, { headers: ['a;b'], rows: [['1;2']], sourceRows: [2] });
});
