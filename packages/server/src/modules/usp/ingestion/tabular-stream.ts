import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, realpath, rm, statfs } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { DelimitedReading, TableEncoding } from '@ulpin/contracts';
import { INTAKE_PROBE_LIMITS, TABULAR_LIMITS, TABULAR_STREAM_LIMITS as limits, TableCellMarkSchema,
  type TableCellMark, type TabularSelection } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { profileTabularChunk } from './chunk-mapping-agent';
import { bomEncoding, chooseTableDelimiter } from './delimited-text';

/** One CSV record: its logical record number (the header is 1) and its byte range in the unchanged original,
 * the line ending excluded. Cells are the bytes as written, decoded; a cell past the end of a short row is absent. */
export type StreamedTabularRow = { index: number; sourceRow: number; byteStart: number; byteEnd: number;
  rawSha256: string; cells: string[] };
/** One workbook record: its physical sheet row, its sheet and the SHA-256 of the sheet's XML as read; its byte
 * range is the sheet's stored bytes in the ZIP and `rawSha256` is of exactly those bytes. A missing cell is null;
 * a marked cell says how its text was read, and is unknown wherever it is mapped or cited. */
export type StreamedWorkbookRow = Omit<StreamedTabularRow, 'cells'> & { sheet: string; sheetSha256: string;
  cells: (string | null)[]; marks?: { column: number; mark: TableCellMark }[] };
/** A CSV window's byte range runs from its first record's start to its last record's end; its SHA-256 is of exactly
 * those bytes of the original, the line endings and skipped blank records between its records included. A
 * workbook window's byte range is its sheet's stored bytes in the ZIP, and its SHA-256 is of exactly those bytes. */
export type StreamedTabularWindow<Row = StreamedTabularRow> = { index: number; rows: Row[]; byteStart: number;
  byteEnd: number; sha256: string };
export type StreamedTableWindow = StreamedTabularWindow<StreamedTabularRow | StreamedWorkbookRow>;
export type TableSource = { selection: TabularSelection; bytes: number; detectReading?: boolean; name?: string };
export type StreamedTabularRead = { headers: string[]; records: number; windows: number; bytes: number;
  sha256: string; notes?: string[] } & DelimitedReading;
type OnWindow<Row> = (window: StreamedTabularWindow<Row>, headers: string[]) => Promise<void>;

const QUOTE = 0x22, LF = 0x0a, CR = 0x0d;
const cellDecoders = {
  'utf-8': new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }),
  'windows-1252': new TextDecoder('windows-1252', { ignoreBOM: true }),
  'utf-16le': new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }),
  'utf-16be': new TextDecoder('utf-16be', { fatal: true, ignoreBOM: true }),
};
type ByteReading = { delimiter: NonNullable<DelimitedReading['delimiter']>;
  encoding: keyof typeof cellDecoders };
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

function decodeCell(bytes: Buffer | string, quoted: boolean, sourceRow: number, reading: ByteReading): string {
  try {
    const text = typeof bytes === 'string' ? bytes : cellDecoders[reading.encoding].decode(bytes);
    if (text.includes('\0')) throw new Error('binary null');
    return quoted ? text.replaceAll('""', '"') : text;
  } catch {
    throw new AppError(422, 'TABULAR_ENCODING',
      `Record ${sourceRow} has invalid ${reading.encoding} text or a binary null byte.`);
  }
}

const unitAt = (data: Buffer | string, at: number) => typeof data === 'string' ? data.charCodeAt(at) : data[at];
const sliceUnits = (data: Buffer | string, start: number, end: number) =>
  typeof data === 'string' ? data.slice(start, end) : data.subarray(start, end);

/** The same quote state machine for single-byte syntax and decoded UTF-16 code units. */
function parseRecord(data: Buffer | string, start: number, final: boolean, sourceRow: number, reading: ByteReading) {
  const delimiter = reading.delimiter.charCodeAt(0);
  const cells: string[] = [];
  let at = start;
  while (true) {
    let end: number, next: number;
    if (unitAt(data, at) === QUOTE) {
      let close = at + 1;
      while (true) {
        close = typeof data === 'string' ? data.indexOf('"', close) : data.indexOf(QUOTE, close);
        if (close < 0) return final ? malformed(sourceRow) : null;
        if (unitAt(data, close + 1) === QUOTE) { close += 2; continue; }
        if (close + 1 === data.length && !final) return null;
        break;
      }
      cells.push(decodeCell(sliceUnits(data, at + 1, close), true, sourceRow, reading));
      end = close + 1; next = end < data.length ? unitAt(data, end) : -1;
      if (next !== delimiter && next !== LF && next !== CR && next !== -1) malformed(sourceRow);
    } else {
      end = at;
      while (end < data.length) {
        const unit = unitAt(data, end);
        if (unit === delimiter || unit === LF || unit === CR) break;
        end++;
      }
      next = end < data.length ? unitAt(data, end) : -1;
      if (next === -1 && !final) return null;
      cells.push(decodeCell(sliceUnits(data, at, end), false, sourceRow, reading));
    }
    if (next === delimiter) { at = end + 1; continue; }
    if (next === CR && end + 1 === data.length && !final) return null;
    const after = next === -1 ? end : next === CR && unitAt(data, end + 1) === LF ? end + 2 : end + 1;
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
async function readCsvWindows(
  body: Readable, onWindow: OnWindow<StreamedTabularRow>, reading: ByteReading,
): Promise<StreamedTabularRead> {
  const hash = createHash('sha256');
  const width = reading.encoding.startsWith('utf-16') ? 2 : 1;
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
    if (width === 2 && carryStart === 0 && data.length < 2 && !final) { carry = data; return; }
    const atBom = carryStart === 0 ? tableBomUnits(data, reading) : 0;
    const units = width === 2 ? decodeUtf16Window(data, reading.encoding, final) : data;
    let at = atBom;
    while (at < units.length) {
      const record = parseRecord(units, at, final, logical + 1, reading);
      if (!record) break;
      logical++;
      if ((record.next - at) * width > limits.recordBytes) recordTooLarge(logical);
      if (!headers && record.cells.some(cell => cell.trim())) headers = checkedHeaders(record.cells);
      else if (headers && record.cells.some(cell => cell.trim())) {
        if (record.cells.length > headers.length) {
          throw new AppError(422, 'TABULAR_SCHEMA_DRIFT',
            `Record ${logical} of this table has more cells than its header names.`);
        }
        if (++records > limits.rows) tooManyRecords(bytes);
        const content = data.subarray(at * width, record.contentEnd * width);
        for (const part of rows.length ? gap : []) windowHash.update(part);
        gap = []; gapBytes = 0;
        windowHash.update(content);
        rows.push({ index: records - 1, sourceRow: logical, byteStart: carryStart + at * width,
          byteEnd: carryStart + record.contentEnd * width, cells: record.cells,
          rawSha256: createHash('sha256').update(content).digest('hex') });
        windowBytes += (record.next - at) * width;
        await between(data.subarray(record.contentEnd * width, record.next * width));
        if (rows.length >= limits.windowRows || windowBytes >= limits.windowBytes) await flush();
      } else await between(data.subarray(at * width, record.next * width));
      at = record.next;
    }
    carry = data.subarray(at * width);
    carryStart += at * width;
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
  return { headers, records, windows, bytes, sha256: hash.digest('hex'), ...reading };
}

function invalidUtf16(odd = false): never {
  const reason = odd ? 'an odd byte length' : 'an unpaired surrogate';
  throw new AppError(422, 'TABULAR_ENCODING', `This UTF-16 table has ${reason}; the original is unchanged.`);
}

function tableBomUnits(data: Buffer, reading: ByteReading): number {
  const bom = bomEncoding(data);
  if (reading.encoding.startsWith('utf-16')) {
    if (bom !== reading.encoding) throw new AppError(422, 'TABULAR_ENCODING',
      'This table needs a matching UTF-16 byte order mark (BOM); the original is unchanged.');
    return 1;
  }
  if (bom) throw new AppError(422, 'TABULAR_ENCODING', 'This table differs from its pinned text encoding.');
  return data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
}

/** A partial odd byte or high surrogate stays in carry, never split into a replacement character. */
function decodeUtf16Window(data: Buffer, encoding: TableEncoding, final: boolean): string {
  if (final && data.length % 2) invalidUtf16(true);
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(data, { stream: !final });
  } catch {
    invalidUtf16();
  }
}

/** Validate BOM-marked UTF-16 strictly; otherwise a late invalid UTF-8 byte changes the whole reading. */
function csvProbe() {
  let decoder: TextDecoder | undefined, bom: TableEncoding | undefined;
  let valid = true, head = Buffer.alloc(0), prefix = Buffer.alloc(0), bytes = 0;
  const take = (chunk: Buffer) => {
    bytes += chunk.length;
    const remaining = 2 * limits.recordBytes + 4 - head.length;
    if (remaining > 0) head = Buffer.concat([head, chunk.subarray(0, remaining)]);
    if (!decoder) {
      prefix = Buffer.concat([prefix, chunk]);
      if (prefix.length < 2) return;
      bom = bomEncoding(prefix);
      decoder = new TextDecoder(bom ?? 'utf-8', { fatal: true });
      chunk = prefix;
      prefix = Buffer.alloc(0);
    }
    if (valid) {
      try { decoder.decode(chunk, { stream: true }); } catch {
        if (bom) invalidUtf16();
        valid = false;
      }
    }
  };
  const finish = (name: string): ByteReading => {
    if (bom && bytes % 2) invalidUtf16(true);
    if (valid) {
      try {
        decoder ??= new TextDecoder('utf-8', { fatal: true });
        decoder.decode(prefix, { stream: true });
        decoder.decode();
      } catch {
        if (bom) invalidUtf16();
        valid = false;
      }
    }
    const encoding = bom ?? (valid ? 'utf-8' : 'windows-1252');
    const start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
    const text = new TextDecoder(encoding, { fatal: true }).decode(head.subarray(start), { stream: true });
    return { encoding, delimiter: chooseTableDelimiter(text, name) };
  };
  return { take, finish };
}

/** Unpinned reads need a private byte copy for full text validation. Pinned replays stream directly. */
export async function readTabularWindows(body: Readable, onWindow: OnWindow<StreamedTabularRow>,
  reading: DelimitedReading = {}, name = '', sourceBytes = 0): Promise<StreamedTabularRead> {
  if (reading.delimiter && reading.encoding) {
    return readCsvWindows(body, onWindow, { delimiter: reading.delimiter, encoding: reading.encoding });
  }
  const folder = await scratchFolder(sourceBytes, 'csv');
  let copy: Readable | undefined;
  try {
    const path = join(folder, 'original.csv'), probe = csvProbe();
    await spool(body, path, probe.take);
    const detected = probe.finish(name);
    copy = createReadStream(path);
    const encoding = reading.encoding ?? detected.encoding;
    return await readCsvWindows(copy, onWindow, { delimiter: reading.delimiter ?? detected.delimiter, encoding });
  } finally {
    copy?.destroy();
    await rm(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}

const hex64 = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative();
const ReaderLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sheet'), sheet: z.string(), member: z.string(), memberSha256: hex64,
    memberBytes: count, byteStart: count, byteEnd: count, storedSha256: hex64, headers: z.array(z.string()) }),
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

const size = (bytes: number) => bytes < 1024 ** 3 ? `${mib(bytes)} MiB` : `${(bytes / 1024 ** 3).toFixed(2)} GiB`;

/** A private folder for one copy, in the private scratch the demo runtime gives its local readers
 * (ULPIN_DOCUMENT_OCR_SCRATCH, outside the repository), with room for the copy and 1 GiB more. */
async function scratchFolder(bytes: number, format: 'csv' | 'workbook' = 'workbook') {
  const root = process.env.ULPIN_DOCUMENT_OCR_SCRATCH ?? (format === 'csv' ? tmpdir() : undefined);
  const outside = (path: string) => { const at = relative(settings.repositoryRoot, path);
    return at === '..' || at.startsWith(`..${sep}`) || isAbsolute(at); };
  if (!root || !isAbsolute(root) || !outside(resolve(root))) {
    throw new AppError(503, 'TABULAR_SCRATCH_UNAVAILABLE', 'A workbook above 16 MiB is copied to the private ' +
      'scratch folder to be read, and none is configured outside the repository. It was kept unchanged.');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const folder = await realpath(root), disk = await statfs(folder), free = disk.bavail * disk.bsize;
  if (!outside(folder)) throw new AppError(503, 'TABULAR_SCRATCH_UNAVAILABLE', 'The scratch folder is inside the ' +
    'repository; an original is never copied there. It was kept unchanged.');
  if (free < bytes + 1024 ** 3) {
    throw new AppError(507, 'TABULAR_SCRATCH_SPACE', `The scratch folder has ${size(free)} free; reading this ` +
      `${size(bytes)} ${format} needs its size and 1 GiB more (${size(bytes + 1024 ** 3)}). It was kept unchanged.`);
  }
  return mkdtemp(join(folder, `table-${format}-`));
}

/** Copies the original to a private file while counting and hashing it; a ZIP is read from its end, not a stream. */
async function spool(body: Readable, path: string, onChunk?: (chunk: Buffer) => void) {
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(body, new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    if (bytes > limits.bytes) return done(sourceBudgetError());
    hash.update(chunk);
    try { onChunk?.(chunk); } catch (error) { return done(error as Error); }
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
 * to a private scratch file (a ZIP is read from its directory at the end), then the native window reader is
 * started once; each window is passed to `onWindow` before the next line is read, so the reader runs at most one
 * window ahead. Cells are the text the file stores; nothing is calculated or reformatted. */
export async function readWorkbookWindows(body: Readable, { selection, bytes }: TableSource,
  onWindow: OnWindow<StreamedWorkbookRow>): Promise<StreamedTabularRead> {
  const scratch = await scratchFolder(bytes);
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
      const { sheet, memberSha256: sheetSha256, byteStart, byteEnd, storedSha256: sha256 } = head;
      const rows = item.rows.map(row => ({ index: records++, sourceRow: row.row, byteStart, byteEnd,
        rawSha256: sha256, sheet, sheetSha256, cells: row.cells,
        ...(row.marks ? { marks: row.marks.map(([column, mark]) => ({ column, mark })) } : {}) }));
      await onWindow({ index: item.index, rows, byteStart, byteEnd, sha256 }, head.headers);
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
export function readTableWindows(body: Readable, source: TableSource,
  onWindow: OnWindow<StreamedTabularRow | StreamedWorkbookRow>) {
  return source.selection.format === 'xlsx' ? readWorkbookWindows(body, source, onWindow)
    : readTabularWindows(body, onWindow, source.detectReading ? {} : {
      delimiter: source.selection.delimiter ?? ',', encoding: source.selection.encoding ?? 'utf-8',
    }, source.name, source.bytes);
}

/** A workbook cell marked by the reader (a formula's stored result, an error, no value) is unknown, as in the
 * whole read; it is never mapped or cited as a value. */
export function unavailableColumns(row: { marks?: { column: number }[] }) {
  return new Set(row.marks?.map(mark => mark.column));
}

/** The profile of a streamed table: the existing layout profile of its first 100 records, and per column the
 * counts of written, empty and absent cells over every record. */
export async function profileTabularStream(body: Readable, source: TableSource) {
  const first: (string | undefined)[][] = [];
  let counts: { written: number; empty: number; absent: number }[] = [];
  const read = await readTableWindows(body, source, async (window, headers) => {
    if (!counts.length) counts = headers.map(() => ({ written: 0, empty: 0, absent: 0 }));
    for (const row of window.rows) {
      // As in the whole read, a cell without a stored value or with a marked one has no value in the profile.
      const unavailable = 'marks' in row ? unavailableColumns(row) : new Set<number>();
      if (first.length < 100) first.push(row.cells.map((cell, column) =>
        unavailable.has(column) ? undefined : cell ?? undefined));
      counts.forEach((count, column) => {
        const cell = row.cells[column];
        if (cell === undefined || cell === null) count.absent++;
        else if (cell === '') count.empty++;
        else count.written++;
      });
    }
  });
  const profile = profileTabularChunk({ jobId: 'inventory', chunkIndex: 0, headers: read.headers, rows: first,
    sourceRef: 'inventory', selection: source.selection }).profile;
  return { ...read, profile: { ...profile,
    ...(read.delimiter ? { delimiter: read.delimiter, encoding: read.encoding } : {}) }, streamCounts: counts };
}
