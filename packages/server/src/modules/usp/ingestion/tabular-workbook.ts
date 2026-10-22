import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { TABULAR_LIMITS, type TableCellMark, type TabularSelection } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';

/**
 * The whole-file workbook reader: one sheet of an XLSX or an ODS original up to 16 MiB, read through the host's
 * native cell readers (scripts/agent/read_workbook_cells.py). Formulas, caches and absent cells never acquire values.
 */
type CellState = 'literal' | 'absent' | 'unknown';
type Part = { text: string; locator: { sheet: string; row: number; column: number; cellState: string;
  ods?: { rowRepeat: number; columnRepeat: number } } };
export type WorkbookFormat = Extract<TabularSelection['format'], 'xlsx' | 'ods'>;
export type TabularTable = { headers: string[]; rows: unknown[][]; sourceRows: number[];
  cellStates?: CellState[][] };
/** How the reader stored each cell it marked unknown, as the stream reader names it; null where it is not marked. */
export type WorkbookTable = TabularTable & { marks: (TableCellMark | null)[][] };

/** TB2: the code of a refusal at the whole-file reader's size bound; the same bytes can still be read as a stream.
 * OD2: an ODS is read as a stream past the bound too. */
export const TABULAR_ROW_LIMIT = 'TABULAR_ROW_LIMIT';
/** ODS repeat/cell bounds still refused after trying the stream, not the whole reader's size or count bound. */
export const TABULAR_ODS_LIMIT = 'TABULAR_ODS_LIMIT';
const MARKS: Readonly<Record<string, TableCellMark>> = { empty: 'no_value', formula_cached: 'formula_cached',
  formula_uncached: 'formula_uncached', error: 'error' };
// Repeated cells of empty text or only spaces are an ODS sheet's padding, as in the column profile.
const ODS_PADDING = ['empty_string', 'whitespace'];

export function rowLimit(): never {
  throw new AppError(422, TABULAR_ROW_LIMIT, 'This table holds more than the whole-file reader takes: 2,000 '
    + 'records, or 2,000 cells of a workbook. Kept through the upload, it is read as a stream instead; no record is '
    + 'cut to fit.');
}

function workbookParts(bytes: Uint8Array, format: WorkbookFormat): Part[] {
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [
    join(settings.repositoryRoot, 'scripts/agent/read_workbook_cells.py'),
    join(settings.repositoryRoot, 'services/geo'), '-',
  ], { input: Buffer.from(bytes).toString('base64'), encoding: 'utf8', timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  // The native readers name their own size bound; any other stop stays its refusal.
  if (run.status !== 0 && /\b(?:NATIVE_(?:WORKBOOK|ODS)_LIMIT|COLUMN_WORKBOOK_LIMIT)\b/.test(run.stderr ?? '')) {
    rowLimit();
  }
  if (run.status !== 0) {
    throw new AppError(422, 'TABULAR_NATIVE_READER', 'The unchanged native workbook bounds refused it.');
  }
  const output = JSON.parse(run.stdout);
  if (output.format !== format) {
    throw new AppError(422, 'TABULAR_FORMAT', `Choose a native ${format.toUpperCase()} workbook.`);
  }
  return format === 'ods' ? odsCells(output.parts) : output.parts;
}

/**
 * XL1: one ODS cell element stands for a block of equal cells, its row and column repeats. An ODS writes every
 * blank cell as an element with no value, so it is absent, as a blank XLSX cell is. Repeated padding writes nothing;
 * any other repeated element is its stored text in every cell it covers, up to the table's cell bound.
 */
function odsCells(parts: Part[]): Part[] {
  const cells: Part[] = [];
  for (const part of parts) {
    if (part.locator.cellState === 'empty') continue;
    const { rowRepeat, columnRepeat } = part.locator.ods ?? { rowRepeat: 1, columnRepeat: 1 };
    if (rowRepeat * columnRepeat === 1) cells.push(part);
    else if (!ODS_PADDING.includes(part.locator.cellState)) {
      if (cells.length + rowRepeat * columnRepeat > TABULAR_LIMITS.rows * TABULAR_LIMITS.columns) rowLimit();
      for (const cell of repeatedCells(part, rowRepeat, columnRepeat)) cells.push(cell);
    }
  }
  return cells;
}

function repeatedCells(part: Part, rows: number, columns: number): Part[] {
  return Array.from({ length: rows * columns }, (_, index) => ({ ...part, locator: { ...part.locator,
    row: part.locator.row + Math.floor(index / columns), column: part.locator.column + index % columns } }));
}

export function workbookTable(bytes: Uint8Array, selection: TabularSelection, format: WorkbookFormat)
  : WorkbookTable {
  const parts = workbookParts(bytes, format).filter(part => part.locator.sheet === selection.sheet);
  const headerParts = parts.filter(part => selection.headerRows.includes(part.locator.row));
  const width = headerParts.reduce((last, part) => Math.max(last, part.locator.column), 0);
  if (!width || width > TABULAR_LIMITS.columns || selection.headerRows.some(row =>
    !headerParts.some(part => part.locator.row === row))) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED',
      'Pin existing header rows in exactly one native sheet, within 256 columns.');
  }
  const headers = Array.from({ length: width }, (_, index) => headerParts.filter(part =>
    part.locator.column === index + 1 && part.locator.cellState === 'literal').map(part => part.text).join(' / '));
  const records = workbookRows(parts, selection, width);
  return { headers, ...records };
}

function workbookRows(parts: Part[], selection: TabularSelection, width: number) {
  const records = new Map<number, unknown[]>();
  const states = new Map<number, CellState[]>();
  const marks = new Map<number, (TableCellMark | null)[]>();
  for (const part of parts) {
    if (part.locator.row <= Math.max(...selection.headerRows)) continue;
    if (part.locator.column > width) {
      throw new AppError(422, 'TABULAR_SCHEMA_DRIFT', 'A cell exceeds the pinned headers.');
    }
    if (!records.has(part.locator.row)) {
      records.set(part.locator.row, []);
      states.set(part.locator.row, Array(width).fill('absent'));
      marks.set(part.locator.row, Array(width).fill(null));
    }
    const literal = ['literal', 'whitespace', 'empty_string'].includes(part.locator.cellState);
    states.get(part.locator.row)![part.locator.column - 1] = literal ? 'literal' : 'unknown';
    if (!literal) {
      marks.get(part.locator.row)![part.locator.column - 1] = MARKS[part.locator.cellState] ?? 'unsupported';
    }
    if (literal) records.get(part.locator.row)![part.locator.column - 1] =
      part.locator.cellState === 'empty_string' ? '' : part.text;
  }
  const ordered = [...records].sort(([left], [right]) => left - right);
  return { rows: ordered.map(([, row]) => row), sourceRows: ordered.map(([row]) => row),
    cellStates: ordered.map(([row]) => states.get(row)!), marks: ordered.map(([row]) => marks.get(row)!) };
}
