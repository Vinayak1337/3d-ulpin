import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { TABULAR_LIMITS } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { readTabularSource } from './tabular-source';
import { readTabularWindows, type StreamedTabularRow } from './tabular-stream';

const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const rowHash = (cells: unknown[]) => createHash('sha256').update(JSON.stringify(cells)).digest('hex');
type Read = { records: number; sourceRows: number[]; hashes: string[]; cells: unknown[][] };

/** The whole read (a CSV of at most 16 MiB). */
function whole(bytes: Buffer): Read {
  const table = readTabularSource(bytes, selection);
  return { records: table.rows.length, sourceRows: table.sourceRows, hashes: table.rows.map(rowHash),
    cells: table.rows };
}

/** The stream read (a CSV above 16 MiB), given the bytes whole or one byte at a time. */
async function streamed(bytes: Buffer, byByte = false): Promise<Read> {
  const rows: StreamedTabularRow[] = [];
  const body = Readable.from(byByte ? [...bytes].map(byte => Buffer.from([byte])) : [bytes]);
  const read = await readTabularWindows(body, async window => { rows.push(...window.rows); });
  assert.equal(read.records, rows.length);
  return { records: read.records, sourceRows: rows.map(row => row.sourceRow),
    hashes: rows.map(row => rowHash(row.cells)), cells: rows.map(row => row.cells) };
}

async function bothPaths(text: string) {
  const bytes = Buffer.from(text);
  const read = whole(bytes);
  assert.deepEqual(await streamed(bytes), read, `stream and whole differ: ${JSON.stringify(text)}`);
  assert.deepEqual(await streamed(bytes, true), read, `byte-split stream differs: ${JSON.stringify(text)}`);
  return read;
}

// test_only: generated two-column registers; no real record or identifier.
const body = { LF: 'Key,Note\nK-1,a\nK-2,b', CRLF: 'Key,Note\r\nK-1,a\r\nK-2,b' };
const single = { LF: 'Key,Note\nK-1,a', CRLF: 'Key,Note\r\nK-1,a' };

for (const [ending, eol] of [['LF', '\n'], ['CRLF', '\r\n']] as const) {
  test(`${ending}: one final line ending ends the last record; a blank last line is no record`, async () => {
    const two = [['K-1', 'a'], ['K-2', 'b']], one = [['K-1', 'a']];
    for (const [text, cells, sourceRows] of [
      [body[ending], two, [2, 3]],
      [body[ending] + eol, two, [2, 3]],
      [body[ending] + eol + eol, two, [2, 3]],
      [single[ending], one, [2]],
      [single[ending] + eol, one, [2]],
      [single[ending] + eol + eol, one, [2]],
      [`Key${eol}K-1${eol}K-2${eol}`, [['K-1'], ['K-2']], [2, 3]],
      [`Key,Note${eol}${eol}K-1,a${eol}`, one, [3]],
    ] as const) {
      const read = await bothPaths(text);
      assert.deepEqual(read.cells, cells, JSON.stringify(text));
      assert.deepEqual(read.sourceRows, sourceRows, JSON.stringify(text));
    }
  });

  test(`${ending}: empty cells stay empty text, never absent or 0; a quoted line ending is kept in its cell`,
    async () => {
      const read = await bothPaths(`Key,Note,Area${eol}K-1,,${eol}K-2,"two${eol}lines",0${eol}K-3${eol}`);
      assert.deepEqual(read.cells, [['K-1', '', ''], ['K-2', `two${eol}lines`, '0'], ['K-3']]);
      assert.deepEqual(read.sourceRows, [2, 3, 4]);
    });

  test(`${ending}: a header with no record is refused the same way on both paths`, async () => {
    for (const text of ['Key,Note', `Key,Note${eol}`, `Key,Note${eol}${eol}`]) {
      assert.throws(() => whole(Buffer.from(text)), { code: 'TABULAR_HEADER_REQUIRED' }, JSON.stringify(text));
      await assert.rejects(streamed(Buffer.from(text)), { code: 'TABULAR_HEADER_REQUIRED' }, JSON.stringify(text));
    }
  });
}

test('the whole read counts records, not blank lines, against its 2,000-record bound', async () => {
  const records = (count: number) => Array.from({ length: count }, (_, index) => `K-${index + 1},n`);
  const most = TABULAR_LIMITS.rows;
  assert.equal((await bothPaths(['Key,Note', ...records(most)].join('\n') + '\n')).records, most);
  assert.equal((await bothPaths(['Key,Note', ...records(most)].join('\n') + '\n\n')).records, most);
  const gap = ['Key,Note', ...records(most / 2), '', ...records(most / 2)].join('\n') + '\n';
  assert.equal((await bothPaths(gap)).records, most);
  assert.throws(() => whole(Buffer.from(['Key,Note', ...records(most + 1)].join('\n') + '\n')),
    { code: 'TABULAR_HEADER_OR_READER' });
});

test('a real register reads the same records with and without its final line ending', async () => {
  // docs/api/datasets.json mi-d10-02.csv: public D8 development asset (test_only), BOM and CRLF as published.
  const bytes = readFileSync(join(settings.repositoryRoot, 'fixtures/usp/D8-messy-india/dev/d1b/mi-d10-02.csv'));
  assert.equal(bytes.subarray(-2).toString(), '\r\n');
  const ended = await bothPaths(bytes.toString('utf8'));
  const unended = await bothPaths(bytes.subarray(0, -2).toString('utf8'));
  const blankLast = await bothPaths(bytes.toString('utf8') + '\r\n');
  assert.ok(ended.records > 30);
  assert.deepEqual(unended, ended);
  assert.deepEqual(blankLast, ended);
});
