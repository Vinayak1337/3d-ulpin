import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INTAKE_PROBE_LIMITS } from '@ulpin/contracts/usp';
import { probeOriginal, IntakeTableProbeError, INTAKE_HEADER_CONFIRMATION } from './intake-probe';
import { certainTableSelection, intakeProbeFailureWords } from './intake-draft';
import { readingOf } from './intake-reading';

const utf8 = (text: string) => Buffer.from(text);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const probe = (bytes: Uint8Array, name = 'control.csv') =>
  probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
const utf16 = (text: string, bigEndian = false) => {
  const bytes = Buffer.from('\ufeff' + text, 'utf16le');
  return bigEndian ? bytes.swap16() : bytes;
};
// Synthetic framing controls only, not asserted property records or evaluation truth.
const fixtures: [string, Buffer, string[], number, string, string][] = [
  ['UTF-8', utf8('key,value\na,b'), ['key', 'value'], 1, ',', 'utf-8'],
  ['UTF-8 BOM', utf8('\ufeffkey,value\na,b\n'), ['key', 'value'], 1, ',', 'utf-8'],
  ['UTF-16 LE BOM', utf16('key,value\na,b\n'), ['key', 'value'], 1, ',', 'utf-16le'],
  ['UTF-16 BE BOM', utf16('key,value\na,b\n', true), ['key', 'value'], 1, ',', 'utf-16be'],
  ['Windows-1252', Buffer.from('key,caf\xe9\na,\x80\n', 'latin1'), ['key', 'café'], 1, ',', 'windows-1252'],
  ['semicolon', utf8('key;value\na;b\n'), ['key', 'value'], 1, ';', 'utf-8'],
  ['tab', utf8('key\tvalue\na\tb\n'), ['key', 'value'], 1, '\t', 'utf-8'],
  ['pipe', utf8('key|value\na|b\n'), ['key', 'value'], 1, '|', 'utf-8'],
  ['quoted delimiter', utf8('key,value\na,"b,c"\n'), ['key', 'value'], 1, ',', 'utf-8'],
  ['quoted quote', utf8('key,value\na,"b""c"\n'), ['key', 'value'], 1, ',', 'utf-8'],
  ['quoted newline', utf8('key,value\na,"b\nc"\n'), ['key', 'value'], 1, ',', 'utf-8'],
  ['CRLF', utf8('key,value\r\na,b\r\nc,d\r\n'), ['key', 'value'], 2, ',', 'utf-8'],
  ['LF', utf8('key,value\na,b\nc,d\n'), ['key', 'value'], 2, ',', 'utf-8'],
  ['CR only', utf8('key,value\ra,b\rc,d\r'), ['key', 'value'], 2, ',', 'utf-8'],
  ['blank preamble', utf8('\n\nkey,value\na,b\n'), ['key', 'value'], 1, ',', 'utf-8'],
  ['title preamble', utf8('Table title\nkey;value\na;b\n'), ['key', 'value'], 1, ';', 'utf-8'],
  ['ragged rows', utf8('key;value\na\nb;c;d\n'), ['key', 'value'], 2, ';', 'utf-8'],
  ['trailing empty columns', utf8('key,value,\na,b,\n'), ['key', 'value', 'column_3'], 1, ',', 'utf-8'],
  ['duplicate header', utf8('key,key\na,2\n'), ['key', 'key'], 1, ',', 'utf-8'],
  ['empty header', utf8(',value\na,b\n'), ['column_1', 'value'], 1, ',', 'utf-8'],
  ['whitespace header', utf8('key, \t ,value\na,2,b\n'), ['key', 'column_2', 'value'], 1, ',', 'utf-8'],
  ['positional collision', utf8('column_2,,value\na,2,b\n'), ['column_2', 'column_2_2', 'value'], 1, ',', 'utf-8'],
  ['header only', utf8('key,value'), ['key', 'value'], 0, ',', 'utf-8'],
  ['very long data line', utf8('key,value\na,' + 'b'.repeat(60_000)), ['key', 'value'], 1, ',', 'utf-8'],
  ['overlong header cell', utf8('key,' + 'v'.repeat(1025) + '\na,b'), ['key'], 1, ',', 'utf-8'],
];

for (const [label, bytes, headers, rows, delimiter, encoding] of fixtures) {
  test(`bounded table probe: ${label}`, async () => {
    const before = hash(bytes);
    const card = await probe(bytes);
    assert.equal(card.family, 'table');
    assert.equal(card.depth, 'structure');
    assert.deepEqual(card.columns.map(column => column.name), headers);
    assert.equal(card.counts.rows, rows);
    assert.equal(card.delimiter, delimiter);
    assert.equal(card.encoding, encoding);
    assert.equal(hash(bytes), before);
    assert.ok(card.probeBytesRead <= INTAKE_PROBE_LIMITS.headBytes);
    if (encoding === 'windows-1252') {
      assert.match(card.limits.join(' '), /Windows-1252 fallback/);
      assert.match(readingOf({}, card).holds.map(line => line.words).join(' '), /Windows-1252 fallback/);
    }
    const needsConfirmation = /preamble|duplicate|overlong header/.test(label);
    assert.equal(card.limits.includes(INTAKE_HEADER_CONFIRMATION), needsConfirmation);
    if (needsConfirmation) assert.equal(certainTableSelection(card), null);
    else assert.ok(certainTableSelection(card));
    if (label === 'duplicate header') assert.deepEqual(card.columns.map(column => column.inferredType),
      ['text', 'number']);
  });
}

test('only complete records are sampled from a cut head and its whole-file count stays unknown', async () => {
  const bytes = utf8('key,value\na,b\nc,"' + 'd'.repeat(70_000) + '"\n');
  const card = await probe(bytes);
  assert.equal(card.counts.rows, null);
  assert.deepEqual(card.columns.map(column => column.sampledNonEmpty), [1, 1]);
  assert.equal(card.probeBytesRead, bytes.length);
});

test('a suffix can help identify a header-only table but never overrides a known binary signature', async () => {
  assert.equal((await probe(utf8('key,value'))).detectedBy, 'bytes_and_name');
  assert.equal((await probe(utf8('%PDF-1.7\n'))).format, 'pdf');
  assert.equal((await probe(utf8('Title\nplain prose, not a table'), 'readme.md')).format, 'unknown');
});

const stops = [
  ['encoding_unreadable', Buffer.from('key,value\na,\0'), 'The table text could not be decoded'],
  ['no_rows', utf8(' \r\n'), 'No nonblank table rows were found'],
  ['line_too_long', utf8('a'.repeat(70_000) + ',value\n'),
    'The first table row did not end within the probe byte limit'],
  ['not_delimited', utf8('plain text\nmore text'),
    'No table columns separated by commas, semicolons, tabs or pipes were found'],
  ['malformed_quotes', utf8('key,value\na,"PRIVATE_PARSER_SENTINEL'),
    'The table has an unfinished or misplaced quoted field'],
] as const;
for (const [reason, bytes, sentence] of stops) test(`closed probe stop: ${reason}`, async () => {
  await assert.rejects(probe(bytes), error => error instanceof IntakeTableProbeError && error.reason === reason);
  const stored = `INTAKE_PROBE_FAILED:${reason}`;
  const words = `${sentence}; the original is kept unchanged with its SHA-256.`;
  assert.equal(intakeProbeFailureWords(stored), words);
  const reading = readingOf({ state: 'probe_failed', limit_reason: stored }, null);
  assert.equal(reading.what.words, words);
  assert.equal(reading.drawing.words, words);
  assert.equal(reading.question, null);
  assert.doesNotMatch(JSON.stringify(reading), /INTAKE_|PRIVATE_PARSER_SENTINEL/);
});

test('unknown and historical stops never expose stored parser text or bare codes', () => {
  const words = 'The file could not be read for its initial check; the original is kept unchanged with its SHA-256.';
  for (const reason of ['INTAKE_PROBE_FAILED:read_failed', 'INTAKE_PROBE_FAILED',
    'INTAKE_PROBE_FAILED:PRIVATE_PARSER_SENTINEL', 'PRIVATE_PARSER_SENTINEL', 'INTAKE_PROBE_FAILED:toString']) {
    assert.equal(intakeProbeFailureWords(reason), words);
    assert.equal(readingOf({ state: 'probe_failed', limit_reason: reason }, null).drawing.words, words);
  }
  assert.match(intakeProbeFailureWords('INTAKE_PROBE_BUDGET'), /time limit; the original is kept/);
});

test('catalogued LGD practice table and a difficult framing of those unchanged cells stay read-only', async () => {
  const bytes = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv');
  const original = hash(bytes);
  const good = await probe(bytes);
  const difficult = await probe(utf16('Practice framing control\r' + bytes.toString().replace(/\r?\n/g, '\r'), true));
  assert.equal(good.counts.rows, 1);
  assert.equal(difficult.counts.rows, 1);
  assert.deepEqual(difficult.columns, good.columns);
  assert.equal(hash(bytes), original);
});
