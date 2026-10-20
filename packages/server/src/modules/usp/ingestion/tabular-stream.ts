import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { TABULAR_LIMITS, TABULAR_STREAM_LIMITS as limits, type TabularSelection } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { profileTabularChunk } from './chunk-mapping-agent';

/** One CSV record: its logical record number (the header is 1) and its byte range in the unchanged original,
 * the line ending excluded. Cells are the bytes as written, decoded; a cell past the end of a short row is absent. */
export type StreamedTabularRow = { index: number; sourceRow: number; byteStart: number; byteEnd: number;
  rawSha256: string; cells: string[] };
export type StreamedTabularWindow = { index: number; rows: StreamedTabularRow[] };
export type StreamedTabularRead = { headers: string[]; records: number; windows: number; bytes: number;
  sha256: string };

const QUOTE = 0x22, COMMA = 0x2c, LF = 0x0a, CR = 0x0d;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const mib = (bytes: number) => Number((bytes / 1024 ** 2).toFixed(3));

function malformed(sourceRow: number): never {
  throw new AppError(422, 'TABULAR_CSV_MALFORMED',
    `Record ${sourceRow} of this table has a quote that does not close where a cell ends.`);
}

function recordTooLarge(sourceRow: number): never {
  throw new AppError(413, 'TABULAR_RECORD_BUDGET',
    `Record ${sourceRow} of this table is larger than ${mib(limits.recordBytes)} MiB.`);
}

function decodeCell(bytes: Buffer, quoted: boolean, sourceRow: number): string {
  try {
    const text = utf8.decode(bytes);
    return quoted ? text.replaceAll('""', '"') : text;
  } catch {
    throw new AppError(422, 'TABULAR_ENCODING', `Record ${sourceRow} of this table is not valid UTF-8 text.`);
  }
}

/** Parses one record from `start`; null when the bytes end first and more may follow. */
function parseRecord(data: Buffer, start: number, final: boolean, sourceRow: number) {
  const cells: string[] = [];
  let at = start;
  while (true) {
    let end: number, next: number;
    if (data[at] === QUOTE) {
      let close = at + 1;
      while (true) {
        close = data.indexOf(QUOTE, close);
        if (close < 0) return final ? malformed(sourceRow) : null;
        if (data[close + 1] === QUOTE) { close += 2; continue; }
        if (close + 1 === data.length && !final) return null;
        break;
      }
      cells.push(decodeCell(data.subarray(at + 1, close), true, sourceRow));
      end = close + 1; next = data[end] ?? -1;
      if (next !== COMMA && next !== LF && next !== CR && next !== -1) malformed(sourceRow);
    } else {
      end = at;
      while (end < data.length && data[end] !== COMMA && data[end] !== LF && data[end] !== CR) end++;
      next = data[end] ?? -1;
      if (next === -1 && !final) return null;
      cells.push(decodeCell(data.subarray(at, end), false, sourceRow));
    }
    if (next === COMMA) { at = end + 1; continue; }
    if (next === CR && end + 1 === data.length && !final) return null;
    const after = next === -1 ? end : next === CR && data[end + 1] === LF ? end + 2 : end + 1;
    return { cells, contentEnd: end, next: after };
  }
}

function checkedHeaders(cells: string[]): string[] {
  if (!cells.some(header => header.trim()) || cells.length > TABULAR_LIMITS.columns ||
      cells.some(header => header.length > 400)) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED',
      'The first record of this table must name its columns, within 256 columns.');
  }
  return cells;
}

/** Reads a CSV original as a stream in windows of 10,000 records, never whole. Values stay exactly as written:
 * no trimming and no number or date reading; an empty cell stays empty. A record of blanks only is skipped, as
 * the whole-file reader skips it, and its number is kept by the next record. */
export async function readTabularWindows(
  body: Readable, onWindow: (window: StreamedTabularWindow, headers: string[]) => Promise<void>,
): Promise<StreamedTabularRead> {
  const hash = createHash('sha256');
  let carry: Buffer = Buffer.alloc(0), carryStart = 0, bytes = 0, logical = 0, records = 0, windows = 0;
  let headers: string[] | null = null, rows: StreamedTabularRow[] = [];
  const flush = async () => {
    if (!rows.length) return;
    const window = { index: windows++, rows };
    rows = [];
    await onWindow(window, headers!);
  };
  const take = async (data: Buffer, final: boolean) => {
    let at = 0;
    if (carryStart === 0 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) at = 3;
    if (carryStart === 0 && (data[0] === 0xff && data[1] === 0xfe || data[0] === 0xfe && data[1] === 0xff)) {
      throw new AppError(422, 'TABULAR_ENCODING', 'This table is written in UTF-16; it is read as UTF-8 only.');
    }
    while (at < data.length) {
      const record = parseRecord(data, at, final, logical + 1);
      if (!record) break;
      logical++;
      if (record.next - at > limits.recordBytes) recordTooLarge(logical);
      if (!headers) headers = checkedHeaders(record.cells);
      else if (record.cells.some(cell => cell.trim())) {
        if (record.cells.length > headers.length) {
          throw new AppError(422, 'TABULAR_SCHEMA_DRIFT',
            `Record ${logical} of this table has more cells than its header names.`);
        }
        if (++records > limits.rows) {
          throw new AppError(413, 'TABULAR_STREAM_ROWS', `This table is ${mib(bytes)} MiB and has more than ` +
            `${limits.rows.toLocaleString('en-US')} records, the most a table may have for now.`);
        }
        rows.push({ index: records - 1, sourceRow: logical, byteStart: carryStart + at,
          byteEnd: carryStart + record.contentEnd, cells: record.cells,
          rawSha256: createHash('sha256').update(data.subarray(at, record.contentEnd)).digest('hex') });
        if (rows.length >= limits.windowRows) await flush();
      }
      at = record.next;
    }
    carry = data.subarray(at);
    carryStart += at;
    if (carry.length > limits.recordBytes) recordTooLarge(logical + 1);
  };
  for await (const value of body) {
    const chunk = Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > limits.bytes) {
      throw new AppError(413, 'TABULAR_SOURCE_BUDGET', `This table is more than ${mib(limits.bytes)} MiB, ` +
        'the most a table may be for now.');
    }
    hash.update(chunk);
    await take(carry.length ? Buffer.concat([carry, chunk]) : chunk, false);
  }
  await take(carry, true);
  if (!headers || !records) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED', 'This table needs a header record and at least one record.');
  }
  await flush();
  return { headers, records, windows, bytes, sha256: hash.digest('hex') };
}

/** The profile of a streamed table: the existing layout profile of its first 100 records, and per column the
 * counts of written, empty and absent cells over every record. */
export async function profileTabularStream(body: Readable, selection: TabularSelection) {
  const first: string[][] = [];
  let counts: { written: number; empty: number; absent: number }[] = [];
  const read = await readTabularWindows(body, async (window, headers) => {
    if (!counts.length) counts = headers.map(() => ({ written: 0, empty: 0, absent: 0 }));
    for (const row of window.rows) {
      if (first.length < 100) first.push(row.cells);
      counts.forEach((count, column) => {
        const cell = row.cells[column];
        if (cell === undefined) count.absent++;
        else if (cell === '') count.empty++;
        else count.written++;
      });
    }
  });
  const profile = profileTabularChunk({ jobId: 'inventory', chunkIndex: 0, headers: read.headers, rows: first,
    sourceRef: 'inventory', selection }).profile;
  return { ...read, profile, streamCounts: counts };
}
