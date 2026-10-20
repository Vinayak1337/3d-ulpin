import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { INTAKE_PROBE_LIMITS, TABULAR_LIMITS, TABULAR_STREAM_LIMITS as limits, TableCellMarkSchema,
  type TableCellMark, type TabularSelection } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { profileTabularChunk } from './chunk-mapping-agent';

/** One CSV record: its logical record number (the header is 1) and its byte range in the unchanged original,
 * the line ending excluded. Cells are the bytes as written, decoded; a cell past the end of a short row is absent. */
export type StreamedTabularRow = { index: number; sourceRow: number; byteStart: number; byteEnd: number;
  rawSha256: string; cells: string[] };
/** One workbook record: its physical sheet row, its sheet and the SHA-256 of the sheet's XML cite it; it has no
 * byte range in the original. A missing cell is null; a marked cell says how its text was read. */
export type StreamedWorkbookRow = { index: number; sourceRow: number; sheet: string; memberSha256: string;
  cells: (string | null)[]; marks?: { column: number; mark: TableCellMark }[] };
/** A CSV window's byte range runs from its first record's start to its last record's end; its SHA-256 is of exactly
 * those bytes of the original, the line endings and skipped blank records between its records included. A
 * workbook window's byte range is the sheet member's stored bytes in the original, and its SHA-256 is of the
 * window as the reader wrote it. */
export type StreamedTabularWindow<Row = StreamedTabularRow> = { index: number; rows: Row[]; byteStart: number;
  byteEnd: number; sha256: string };
export type StreamedTableWindow = StreamedTabularWindow<StreamedTabularRow | StreamedWorkbookRow>;
export type StreamedTabularRead = { headers: string[]; records: number; windows: number; bytes: number;
  sha256: string; notes?: string[] };
type OnWindow<Row> = (window: StreamedTabularWindow<Row>, headers: string[]) => Promise<void>;

const QUOTE = 0x22, COMMA = 0x2c, LF = 0x0a, CR = 0x0d;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const mib = (bytes: number) => Number((bytes / 1024 ** 2).toFixed(3));

function malformed(sourceRow: number): never {
  throw new AppError(422, 'TABULAR_CSV_MALFORMED',
    `Record ${sourceRow} of this table has a quote that does not close where a cell ends.`);
}

const sourceBudgetError = () => new AppError(413, 'TABULAR_SOURCE_BUDGET',
  `This table is more than ${mib(limits.bytes)} MiB, the most a table may be for now.`);

function sourceBudget(): never {
  throw sourceBudgetError();
}

function tooManyRecords(bytes: number): never {
  throw new AppError(413, 'TABULAR_STREAM_ROWS', `This table is ${mib(bytes)} MiB and has more than ` +
    `${limits.rows.toLocaleString('en-US')} records, the most a table may have for now.`);
}

function tooManyWindows(): never {
  throw new AppError(413, 'TABULAR_STREAM_WINDOWS', `This table needs more than ${limits.windows} windows.`);
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

/** Reads a CSV original as a stream in windows of 10,000 records, never whole; a window also closes at 16 MiB of
 * record bytes, or when the bytes between two of its records pass 1 MiB. Values stay exactly as written: no
 * trimming and no number or date reading; an empty cell stays empty. A record of blanks only is skipped, as the
 * whole-file reader skips it, and its number is kept by the next record. */
export async function readTabularWindows(
  body: Readable, onWindow: OnWindow<StreamedTabularRow>,
): Promise<StreamedTabularRead> {
  const hash = createHash('sha256');
  let carry: Buffer = Buffer.alloc(0), carryStart = 0, bytes = 0, logical = 0, records = 0, windows = 0;
  let headers: string[] | null = null, rows: StreamedTabularRow[] = [], windowBytes = 0;
  let windowHash = createHash('sha256'), gap: Buffer[] = [], gapBytes = 0;
  const flush = async () => {
    if (!rows.length) return;
    if (windows >= limits.windows) tooManyWindows();
    const window = { index: windows++, rows, byteStart: rows[0]!.byteStart, byteEnd: rows.at(-1)!.byteEnd,
      sha256: windowHash.digest('hex') };
    rows = []; windowBytes = 0; gap = []; gapBytes = 0; windowHash = createHash('sha256');
    await onWindow(window, headers!);
  };
  // Bytes after a window's last record wait here until a next record joins the same window.
  const between = async (bytes: Buffer) => {
    if (!rows.length || !bytes.length) return;
    gap.push(Buffer.from(bytes)); gapBytes += bytes.length;
    if (gapBytes > limits.recordBytes) await flush();
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
        if (++records > limits.rows) tooManyRecords(bytes);
        const content = data.subarray(at, record.contentEnd);
        for (const part of rows.length ? gap : []) windowHash.update(part);
        gap = []; gapBytes = 0;
        windowHash.update(content);
        rows.push({ index: records - 1, sourceRow: logical, byteStart: carryStart + at,
          byteEnd: carryStart + record.contentEnd, cells: record.cells,
          rawSha256: createHash('sha256').update(content).digest('hex') });
        windowBytes += record.next - at;
        await between(data.subarray(record.contentEnd, record.next));
        if (rows.length >= limits.windowRows || windowBytes >= limits.windowBytes) await flush();
      } else await between(data.subarray(at, record.next));
      at = record.next;
    }
    carry = data.subarray(at);
    carryStart += at;
    if (carry.length > limits.recordBytes) recordTooLarge(logical + 1);
  };
  for await (const value of body) {
    const chunk = Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > limits.bytes) sourceBudget();
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

const hex64 = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative();
const ReaderLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sheet'), sheet: z.string(), member: z.string(), memberSha256: hex64,
    memberBytes: count, byteStart: count, byteEnd: count, headers: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('window'), index: count, rows: z.array(z.strictObject({ row: z.number().int(),
    cells: z.array(z.string().nullable()), marks: z.array(z.tuple([count, TableCellMarkSchema])).optional() })) }),
  z.strictObject({ kind: z.literal('end'), records: count, windows: count,
    marks: z.record(TableCellMarkSchema, count), mergedRanges: z.boolean(), sharedStrings: count }),
  z.strictObject({ kind: z.literal('refused'), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    row: z.number().int().nullable() }),
]);
type ReaderLine = z.infer<typeof ReaderLineSchema>;
type ReaderEnd = Extract<ReaderLine, { kind: 'end' }>;

const atRow = (row: number | null) => row === null ? 'This sheet' : `Row ${row} of this sheet`;
const WORKBOOK_WORDS: Record<string, (row: number | null) => string> = {
  WORKBOOK_SHEET_MISSING: () => 'This workbook has no sheet with exactly that name; check its spelling and case.',
  WORKBOOK_SHEET_UNSUPPORTED: () => 'That sheet is not a worksheet of cells, so it cannot be read as a table.',
  WORKBOOK_STRUCTURE_UNSUPPORTED: () => 'This file does not have the parts of an XLSX workbook.',
  WORKBOOK_MACROS_UNSUPPORTED: () => 'This workbook carries macros; it is kept unchanged but not read.',
  WORKBOOK_EMBEDDED_UNSUPPORTED: () => 'This workbook carries embedded objects; it is kept unchanged but not read.',
  WORKBOOK_SHARED_STRINGS_LIMIT: () => 'This workbook shares more than 1,000,000 texts or 64 Mi characters ' +
    'between its cells, more than the reader holds for now.',
  WORKBOOK_ROW_ORDER: row => `${atRow(row)} comes after a later row; rows are read in the order written only.`,
  TABULAR_HEADER_REQUIRED: () => 'Pin existing header rows in exactly one native sheet, within 256 columns.',
  TABULAR_SCHEMA_DRIFT: row => `${atRow(row)} has a cell past the last header column.`,
  TABULAR_RECORD_BUDGET: row => `${atRow(row)} is larger than ${mib(limits.recordBytes)} MiB.`,
  ZIP_EXPANDED_LIMIT: () => 'A part of this workbook expands past the size the reader accepts.',
  ZIP_RATIO_LIMIT: () => 'A part of this workbook expands more than 100 times its stored size; it was not read.',
  COLUMN_WORKBOOK_LIMIT: () => 'This workbook has more than 512 parts; it was not read.',
  NATIVE_WORKBOOK_LIMIT: row => `${atRow(row)} passes the workbook reader's sheet or cell text bounds.`,
  NATIVE_WORKBOOK_INVALID: row => `${atRow(row)} is not valid workbook XML, or it declares a document type.`,
};

function workbookRefusal(code: string, row: number | null, bytes: number): never {
  if (code === 'TABULAR_STREAM_ROWS') tooManyRecords(bytes);
  if (code === 'TABULAR_STREAM_WINDOWS') tooManyWindows();
  const words = WORKBOOK_WORDS[code];
  if (!words) readerStopped();
  throw new AppError(code.startsWith('ZIP_') || code.endsWith('_LIMIT') ? 413 : 422, code, words(row));
}

function readerStopped(): never {
  throw new AppError(422, 'TABULAR_NATIVE_READER', 'The workbook reader stopped before the end of the sheet.');
}

function readerLine(line: Buffer) {
  try {
    return ReaderLineSchema.parse(JSON.parse(line.toString('utf8')));
  } catch {
    return readerStopped();
  }
}

/** Copies the original to a private file while counting and hashing it; a ZIP is read from its end, not a stream. */
async function spool(body: Readable, path: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    if (bytes > limits.bytes) return done(sourceBudgetError());
    hash.update(chunk);
    done(null, chunk);
  } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  return { bytes, sha256: hash.digest('hex') };
}

/** Whole lines of the reader's output, one at a time: the next is not read until the caller asks for it. */
async function* readerLines(stream: Readable) {
  const most = limits.windowBytes + limits.recordBytes + 64 * 1024;
  let parts: Buffer[] = [], size = 0;
  for await (const value of stream) {
    let chunk = value as Buffer, at: number;
    while ((at = chunk.indexOf(0x0a)) >= 0) {
      parts.push(chunk.subarray(0, at));
      yield Buffer.concat(parts);
      parts = []; size = 0; chunk = chunk.subarray(at + 1);
    }
    parts.push(chunk); size += chunk.length;
    if (size > most) readerStopped();
  }
  if (size) yield Buffer.concat(parts);
}

function workbookNotes(end: ReaderEnd): string[] {
  const { formula_cached: cached = 0, formula_uncached: uncached = 0, no_value: empty = 0, error = 0,
    unsupported = 0 } = end.marks;
  return [
    ...(cached || uncached ? [`${cached} formula cells keep their cached text, marked; ${uncached} have none and ` +
      'are null. No formula was calculated.'] : []),
    ...(empty ? [`${empty} cell elements store no value; they are null, not 0 or empty text.`] : []),
    ...(error || unsupported ? [`${error} cached errors keep their text and ${unsupported} cells of an unknown ` +
      'storage type are null; both are marked.'] : []),
    ...(end.mergedRanges ? ['The sheet has merged ranges; no value was copied into other cells.'] : []),
  ];
}

function workbookArguments(path: string, selection: TabularSelection) {
  return [join(settings.repositoryRoot, 'scripts/agent/read_workbook_windows.py'),
    join(settings.repositoryRoot, 'services/geo'), path, '--sheet', selection.sheet,
    '--header-rows', selection.headerRows.join(','), '--rows', String(limits.rows),
    '--window-rows', String(limits.windowRows), '--window-bytes', String(limits.windowBytes),
    '--record-bytes', String(limits.recordBytes), '--windows', String(limits.windows),
    '--member-bytes', String(INTAKE_PROBE_LIMITS.expandedBytes),
    '--ratio', String(INTAKE_PROBE_LIMITS.compressionRatio)];
}

/** Reads one sheet of an XLSX original as a stream in windows of 10,000 rows, never whole. The original is copied
 * to a private temporary file (a ZIP is read from its directory at the end), then the native window reader is
 * started once; each window is passed to `onWindow` before the next line is read, so the reader runs at most one
 * window ahead. Cells are the text the file stores; nothing is calculated or reformatted. */
export async function readWorkbookWindows(body: Readable, selection: TabularSelection,
  onWindow: OnWindow<StreamedWorkbookRow>): Promise<StreamedTabularRead> {
  const scratch = await mkdtemp(join(tmpdir(), 'ulpin-workbook-'));
  let reader: ChildProcess | undefined, closed: Promise<number | null> = Promise.resolve(null);
  try {
    const path = join(scratch, 'original.xlsx'), receipt = await spool(body, path);
    const child = reader = spawn(process.env.ULPIN_PROFILE_PYTHON ?? 'python', workbookArguments(path, selection),
      { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    closed = new Promise(resolve => { child.once('error', () => resolve(null)); child.once('close', resolve); });
    let head: Extract<ReaderLine, { kind: 'sheet' }> | null = null, end: ReaderEnd | null = null;
    let records = 0, windows = 0;
    for await (const line of readerLines(child.stdout!)) {
      const item = readerLine(line);
      if (item.kind === 'refused') workbookRefusal(item.code, item.row, receipt.bytes);
      if (item.kind === 'sheet') head = { ...item, headers: checkedHeaders(item.headers) };
      if (item.kind === 'end') end = item;
      if (item.kind !== 'window') continue;
      if (!head || item.index !== windows++) readerStopped();
      const { sheet, memberSha256 } = head;
      const rows = item.rows.map(row => ({ index: records++, sourceRow: row.row, sheet, memberSha256,
        cells: row.cells, ...(row.marks ? { marks: row.marks.map(([column, mark]) => ({ column, mark })) } : {}) }));
      await onWindow({ index: item.index, rows, byteStart: head.byteStart, byteEnd: head.byteEnd,
        sha256: createHash('sha256').update(line).digest('hex') }, head.headers);
    }
    if (await closed !== 0 || !head || !end || end.records !== records || end.windows !== windows) readerStopped();
    if (!records) {
      throw new AppError(422, 'TABULAR_HEADER_REQUIRED', 'This table needs a header record and at least one record.');
    }
    return { headers: head.headers, records, windows, ...receipt, notes: workbookNotes(end) };
  } finally {
    if (reader && reader.exitCode === null && reader.signalCode === null) reader.kill();
    await closed;
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** The pinned selection chooses the reader: a CSV's own bytes, or one sheet of a workbook. */
export function readTableWindows(body: Readable, selection: TabularSelection,
  onWindow: OnWindow<StreamedTabularRow | StreamedWorkbookRow>) {
  return selection.format === 'xlsx' ? readWorkbookWindows(body, selection, onWindow)
    : readTabularWindows(body, onWindow);
}

/** The profile of a streamed table: the existing layout profile of its first 100 records, and per column the
 * counts of written, empty and absent cells over every record. */
export async function profileTabularStream(body: Readable, selection: TabularSelection) {
  const first: (string | undefined)[][] = [];
  let counts: { written: number; empty: number; absent: number }[] = [];
  const read = await readTableWindows(body, selection, async (window, headers) => {
    if (!counts.length) counts = headers.map(() => ({ written: 0, empty: 0, absent: 0 }));
    for (const row of window.rows) {
      // As in the whole read, a cell without a stored value is absent from the layout profile.
      if (first.length < 100) first.push(row.cells.map(cell => cell ?? undefined));
      counts.forEach((count, column) => {
        const cell = row.cells[column];
        if (cell === undefined || cell === null) count.absent++;
        else if (cell === '') count.empty++;
        else count.written++;
      });
    }
  });
  const profile = profileTabularChunk({ jobId: 'inventory', chunkIndex: 0, headers: read.headers, rows: first,
    sourceRef: 'inventory', selection }).profile;
  return { ...read, profile, streamCounts: counts };
}
