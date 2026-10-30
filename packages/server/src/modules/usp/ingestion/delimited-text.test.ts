import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ColumnProfileDocumentSchema } from '@ulpin/contracts';
import { TabularSelectionSchema, type TabularSelection } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { windowedTableRow } from '../../registry/registry-table-evidence';
import { profileColumnFile, readColumnCsv } from './column-profile';
import { chooseTableDelimiter, csvHeaderNames, decodeDelimitedText } from './delimited-text';
import { inspectTabularSource, inspectTabularStream, readTabularSource } from './tabular-source';
import { probeOriginal, INTAKE_HEADER_CONFIRMATION } from './intake-probe';
import { certainTableSelection } from './intake-draft';
import { readTabularWindows, type StreamedTabularRow } from './tabular-stream';

const selection: TabularSelection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
test('positional names reserve stated names anywhere in the header without changing them', () => {
  const cells = ['column_2', '', 'column_2_2', '  stated  ', '\t ', 'column_5', 'column_5_2'];
  assert.deepEqual(csvHeaderNames(cells),
    ['column_2', 'column_2_3', 'column_2_2', '  stated  ', 'column_5_3', 'column_5', 'column_5_2']);
  assert.deepEqual(csvHeaderNames(['same', 'same']), ['same', 'same']);
  assert.deepEqual(csvHeaderNames(['', ' ', '\t']), ['column_1', 'column_2', 'column_3']);
  assert.equal(cells[1], '', 'the caller’s header cells are not rewritten');
});

const positionalFixtures = [
  { label: '15 cells, 12 empty including trailing cells',
    header: ['key', '', '', '', '', 'value', '', '', '', '', 'note', '', '', '', ''],
    names: ['key', 'column_2', 'column_3', 'column_4', 'column_5', 'value', 'column_7', 'column_8',
      'column_9', 'column_10', 'note', 'column_12', 'column_13', 'column_14', 'column_15'], empty: 12 },
  { label: 'unnamed first numeric index', header: ['', 'key', 'value', 'note', 'a', 'b', 'c'],
    names: ['column_1', 'key', 'value', 'note', 'a', 'b', 'c'], empty: 1 },
  { label: 'stated positional collision', header: ['column_2', '', '  stated  '],
    names: ['column_2', 'column_2_2', '  stated  '], empty: 1 },
] as const;

for (const fixture of positionalFixtures) test(`positional headers agree across readers: ${fixture.label}`, async () => {
  const cells = fixture.header.map((_, index) => String(index + 1));
  const text = `${fixture.header.join(',')}\r\n${cells.join(',')}\r\n`;
  const bytes = Buffer.from(text), before = sha(bytes);
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'control.csv');
  assert.deepEqual(card.columns.map(column => column.name), fixture.names);
  assert.ok(card.columns.every(column => column.inferredType === 'number' && column.sampledNonEmpty === 1));
  assert.ok(!card.limits.includes(INTAKE_HEADER_CONFIRMATION));
  assert.ok(card.limits.includes(
    `${fixture.empty} header cells state no name; those columns are named by position.`));
  const pinned = certainTableSelection(card);
  assert.ok(pinned);
  const inventory = inspectTabularSource(bytes, pinned);
  const whole = readTabularSource(bytes, inventory.tabular.selection);
  assert.deepEqual(whole.headers, fixture.names);
  assert.deepEqual(whole.rows, [cells]);
  assert.deepEqual(readColumnCsv(text).headers, fixture.names);
  assert.deepEqual(inventory.profile.columns.map(column => column.name),
    fixture.names.map((name, index) => `${index + 1}|${name}`));
  const streamed = await inspectTabularStream(Readable.from([bytes]), { bytes: bytes.length, sha256: before }, pinned);
  assert.deepEqual(streamed.headers, fixture.names);
  assert.deepEqual(streamed.profile.columns, inventory.profile.columns);
  const rows: StreamedTabularRow[] = [];
  const read = await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
    async (window, headers) => {
      assert.deepEqual(headers, fixture.names);
      rows.push(...window.rows);
    }, pinned);
  assert.deepEqual(read.headers, fixture.names);
  assert.deepEqual(rows.map(row => row.cells), [cells]);
  assert.equal(rows[0].rawSha256, sha(bytes.subarray(rows[0].byteStart, rows[0].byteEnd)));
  const directory = await mkdtemp(join(tmpdir(), 'csv-positional-'));
  const path = join(directory, 'control.csv');
  try {
    await writeFile(path, bytes);
    const file = profileColumnFile(path);
    assert.deepEqual(file.profile.columns.map(column => column.name), fixture.names);
    assert.deepEqual(file.rows[0], Object.fromEntries(fixture.names.map((name, index) => [name, cells[index]])));
  } finally {
    await rm(path);
    await rmdir(directory);
  }
  assert.equal(read.sha256, before);
  assert.equal(sha(bytes), before, 'the original bytes are unchanged');
});

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
  assert.equal(read.encodingBasis, 'fallback_windows_1252');
  assert.equal(decodeDelimitedText(bytes).encodingBasis, 'fallback_windows_1252');
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

test('UTF-8 validation and BOM choices record their basis without changing the reading', async () => {
  for (const [bytes, basis] of [
    [Buffer.from('key;note\nA;नगर\n'), 'utf8_valid'],
    [Buffer.from('\uFEFFkey;note\nA;नगर\n'), 'bom'],
    [Buffer.from('\uFEFFkey;note\nA;नगर\n', 'utf16le'), 'bom'],
    [Buffer.from('\uFEFFkey;note\nA;नगर\n', 'utf16le').swap16(), 'bom'],
  ] as const) {
    const whole = inspectTabularSource(bytes, selection);
    const stream = await inspectTabularStream(Readable.from([bytes]),
      { bytes: bytes.length, sha256: sha(bytes) }, selection);
    assert.equal(whole.profile.encodingBasis, basis);
    assert.equal(whole.tabular.selection.encodingBasis, basis);
    assert.deepEqual(stream.profile, whole.profile);
    assert.deepEqual(stream.tabular.selection, whole.tabular.selection);
    const stated = { ...whole.tabular.selection, encodingBasis: 'officer_stated' as const };
    const reread = inspectTabularSource(bytes, stated);
    const rereadStream = await inspectTabularStream(Readable.from([bytes]),
      { bytes: bytes.length, sha256: sha(bytes) }, stated);
    assert.equal(reread.profile.encodingBasis, 'officer_stated');
    assert.deepEqual(rereadStream.profile, reread.profile);
    assert.deepEqual(readTabularSource(bytes, reread.tabular.selection),
      readTabularSource(bytes, whole.tabular.selection));
  }
});

test('an officer-stated ISO-8859-1 re-read changes only the decode, never the byte ranges', async () => {
  // test_only: 0x80 distinguishes true ISO-8859-1 from the Windows-1252 euro sign.
  const bytes = Buffer.from('key;note\r\nA;\x80é\r\n', 'latin1');
  const automatic = inspectTabularSource(bytes, selection);
  const stated = { ...automatic.tabular.selection, encoding: 'iso-8859-1' as const,
    encodingBasis: 'officer_stated' as const };
  const whole = inspectTabularSource(bytes, stated);
  const stream = await inspectTabularStream(Readable.from([bytes]),
    { bytes: bytes.length, sha256: sha(bytes) }, stated);
  assert.equal(automatic.profile.encodingBasis, 'fallback_windows_1252');
  assert.equal(whole.profile.encoding, 'iso-8859-1');
  assert.equal(whole.profile.encodingBasis, 'officer_stated');
  assert.deepEqual(whole.tabular.selection, stated);
  assert.deepEqual(stream.profile, whole.profile);
  const before: StreamedTabularRow[] = [], after: StreamedTabularRow[] = [];
  await readTabularWindows(Readable.from([bytes]), async window => { before.push(...window.rows); },
    automatic.tabular.selection);
  await readTabularWindows(Readable.from([...bytes].map(byte => Buffer.from([byte]))),
    async window => { after.push(...window.rows); }, stated);
  assert.deepEqual(before[0].cells, ['A', '€é']);
  assert.deepEqual(after[0].cells, ['A', '\x80é']);
  assert.deepEqual(readTabularSource(bytes, stated).rows, after.map(row => row.cells));
  const ranges = (rows: StreamedTabularRow[]) => rows.map(({ cells: _cells, ...row }) => row);
  assert.deepEqual(ranges(after), ranges(before));
  const row = after[0], raw = bytes.subarray(row.byteStart, row.byteEnd);
  const locator = { selection: stated, columnIndex: 0, columnHeader: 'key', cell: { state: 'literal', value: 'A' },
    rowSha256: fingerprint(row.cells.map(value => ({ state: 'literal', value }))),
    window: { index: 0, record: 0, byteStart: row.byteStart, byteEnd: row.byteEnd, sha256: sha(raw) } };
  assert.equal(await windowedTableRow(locator as Parameters<typeof windowedTableRow>[0], ['key', 'note'], raw),
    'key: A\nnote: \x80é');
});

test('unsupported stated encodings are refused with words and UTF-16 still requires a matching BOM', async () => {
  const invalid = { ...selection, encoding: 'ISCII', encodingBasis: 'officer_stated' };
  const parsed = TabularSelectionSchema.safeParse(invalid);
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.message, /supported|UTF-8/);
  const bytes = Buffer.from('key;note\nA;value\n');
  assert.throws(() => inspectTabularSource(bytes, invalid as unknown as TabularSelection),
    /supported|UTF-8/);
  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    const stated = { ...selection, encoding, encodingBasis: 'officer_stated' as const };
    assert.throws(() => inspectTabularSource(bytes, stated), /BOM|byte order mark/);
    await assert.rejects(inspectTabularStream(Readable.from([bytes]),
      { bytes: bytes.length, sha256: sha(bytes) }, stated), /BOM|byte order mark/);
  }
});

test('old stored profiles keep an unknown encoding basis instead of gaining a guess', async () => {
  const profile = inspectTabularSource(Buffer.from('key\nvalue\n'), selection).profile;
  const { encodingBasis: _basis, ...old } = profile;
  assert.deepEqual(ColumnProfileDocumentSchema.parse(old), old);
  assert.equal(ColumnProfileDocumentSchema.parse(old).encodingBasis, undefined);
  const bytes = Buffer.from('key\nvalue\n');
  for (const reading of [{ encoding: 'windows-1252' as const },
    { encoding: 'windows-1252' as const, delimiter: ',' as const }]) {
    const replay = await readTabularWindows(Readable.from([bytes]), async () => {}, reading);
    assert.equal(replay.encodingBasis, undefined);
  }
});

test('stored selections without a delimiter remain comma readings', () => {
  const old = readTabularSource(Buffer.from('a;b\n1;2\n'), selection);
  assert.deepEqual(old, { headers: ['a;b'], rows: [['1;2']], sourceRows: [2] });
});
