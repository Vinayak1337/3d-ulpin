import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import {
  ColumnProfileDocumentSchema,
  type ColumnProfile,
  type ColumnProfileDocument,
  type MappingLayoutField,
} from '@ulpin/contracts';
import { layoutFingerprint, normalizeMappingHeader } from './mapping-plan-v2';
import { parseIndianNumber, parseSourceDate, type MappingRow } from './mapping-executor';
import { UNIT_SUFFIXES } from './unit-table';

type Unit = NonNullable<MappingLayoutField['declaredUnit']>;
const digits = (text: string) =>
  text.replace(/[०-९]/gu, (character) => String(character.charCodeAt(0) - 0x966));
const floor = new RegExp(
  [
    '^(?:G|GF|UGF|LGF|Stilt|B\\d+|Mezz(?:anine)?|Terrace|Ground|First|Second|Third|',
    '\\d+(?:st|nd|rd|th)?\\s*(?:floor|fl))$',
  ].join(''),
  'i',
);
const personalHeader = new RegExp(
  [
    '(?:^|[\\s_.-])(?:name|owner|person|applicant|allottee|purchaser|seller|buyer|father|mother|',
    'husband|wife|contact|phone|mobile|email|aadhaar|aadhar|pan)(?:$|[\\s_.-])|',
    'नाम|पिता|मोबाइल|आधार',
  ].join(''),
  'iu',
);

// Source tokens for shape/enum diagnosis, not value-level synonym mappings.
const SAFE_SAMPLE_WORDS = [
  // Mask markers and categorical/status words.
  'email', 'pan', 'aadhaar', 'phone', 'blank', 'absent', 'array', 'object',
  'approved', 'sanctioned', 'registered', 'draft', 'expired', 'revoked',
  'unknown', 'null', 'withheld', 'conflicting', 'true', 'false', 'yes', 'no',
  // Building/unit/space descriptions.
  'residential', 'commercial', 'industrial', 'institutional', 'mixed', 'group', 'housing', 'flat', 'apartment',
  'common', 'parking', 'unit', 'room', 'kitchen', 'bedroom', 'bathroom', 'balcony', 'shaft',
  // Units and their literal spellings.
  'sq', 'square', 'm', 'meter', 'meters', 'metre', 'metres', 'ft', 'foot', 'feet',
  'yd', 'yds', 'yard', 'yards', 'gaj', 'marla', 'bigha', 'kanal', 'cent', 'guntha', 'count',
  // Floor tokens remain literals, never integer levels.
  'b', 'basement', 'ground', 'upper', 'stilt', 'podium', 'mezzanine', 'terrace',
  'g', 'gf', 'ugf', 'lgf', 'mezz', 'first', 'second', 'third', 'floor', 'fl',
];
const safeWords = new Set(SAFE_SAMPLE_WORDS);

function maskPatterns(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, '[PAN:AAAAADDDDA]')
    .replace(/(?<![\d०-९])(?:[\d०-९]{4}[ -]?){2}[\d०-९]{4}(?![\d०-९])/gu, '[Aadhaar:DDDD DDDD DDDD]')
    .replace(
      /(?<![\d०-९])(?:\+?91[ -]?)?[6-9६-९][\d०-९](?:[ -]?[\d०-९]){8}(?![\d०-९])/gu,
      '[phone:DDDDDDDDDD]',
    );
}

function maskWords(text: string, sensitive: boolean): string {
  return text
    .replace(/[\p{L}]+/gu, (word) => {
      const alreadyMasked = /^[XxDअ]+$/u.test(word);
      const allowed = safeWords.has(word.toLowerCase()) || /^(?:m|ft|yd|B)D+$/u.test(word);
      if (alreadyMasked || (!sensitive && allowed)) return word;
      return word.replace(/[A-Z]/g, 'X').replace(/[a-z]/g, 'x').replace(/[^Xx]/gu, 'अ');
    })
    .replace(/[0-9]/g, 'D')
    .replace(/[०-९]/gu, '०');
}

/** Arbitrary free-text words are conservatively masked, even in unlabelled columns. */
export function maskColumnSample(raw: unknown, name = ''): string {
  if (raw === undefined) return '[absent]';
  if (raw === null) return '[null]';
  if (typeof raw === 'object') return Array.isArray(raw) ? '[array]' : '[object]';
  const text = String(raw).slice(0, 256);
  if (!text.trim()) return '[blank]';
  if (/^\[(?:null|absent|blank|array|object)\]$/.test(text)) return text;
  return maskWords(maskPatterns(text), personalHeader.test(name));
}

function headerUnits(name: string): Unit[] {
  const units = new Set<Unit>();
  // Only explicit tokens: "Area" and magnitude are never unit evidence.
  const normalized = name.replace(/[_()[\]]/g, ' ').trim();
  const words = normalized.split(/\s+/u);
  for (let start = 0; start < words.length; start++) {
    for (let length = 1; length <= 3; length++) {
      const token = words.slice(start, start + length).join(' ');
      for (const [unit, pattern] of Object.entries(UNIT_SUFFIXES)) {
        if (pattern.test(token)) units.add(unit as Unit);
      }
    }
  }
  // A length token inside an area expression is not independent length evidence.
  for (const [area, length] of [
    ['ft2', 'ft'],
    ['m2', 'm'],
  ] as const) {
    if (!units.has(area)) continue;
    let remainder = normalized;
    for (let start = words.length - 1; start >= 0; start--) {
      for (let count = 3; count >= 1; count--) {
        const token = words.slice(start, start + count).join(' ');
        if (UNIT_SUFFIXES[area].test(token)) remainder = remainder.replace(token, ' ');
      }
    }
    if (!remainder.split(/\s+/u).some((token) => UNIT_SUFFIXES[length].test(token))) units.delete(length);
  }
  return [...units];
}

function suffix(raw: unknown): { unit?: Unit; unrecognised: boolean } {
  if (typeof raw !== 'string') return { unrecognised: false };
  const match = /^[+-]?(?:[\d०-९,]+(?:\.[\d०-९]+)?|\.[\d०-९]+)\s*(.*?)$/u.exec(raw.trim());
  if (!match || !match[1]) return { unrecognised: false };
  const unit = Object.entries(UNIT_SUFFIXES).find(([, pattern]) => pattern.test(match[1]))?.[0] as
    | Unit
    | undefined;
  return { unit, unrecognised: !unit };
}

function presentValues(values: readonly unknown[]): unknown[] {
  return values.filter(
    (value) => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim()),
  );
}

function inferDeclaredUnit(name: string, values: readonly unknown[]): Unit | undefined {
  const evidence = new Set(headerUnits(name));
  let conflict = false;
  for (const value of presentValues(values)) {
    const observed = suffix(value);
    if (observed.unit) evidence.add(observed.unit);
    if (observed.unrecognised) conflict = true;
  }
  if (conflict || evidence.size !== 1) return undefined;
  return [...evidence][0];
}

function cellType(value: unknown): ColumnProfile['inferredType'] {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (parseSourceDate(value, 'date_dmy') || parseSourceDate(value, 'date_iso')) return 'date';
  const text = typeof value === 'string' ? value.trim() : value;
  if (typeof text === 'string' && /^(?:true|false)$/i.test(text)) return 'boolean';
  if (parseIndianNumber(text) !== null) return 'number';
  if (typeof text === 'string' && suffix(text).unit) {
    if (parseIndianNumber(text.replace(/\s*[^\d०-९,.+-]+.*$/u, '')) !== null) return 'number';
  }
  return 'text';
}

function inferColumnType(values: readonly unknown[]): ColumnProfile['inferredType'] {
  const types = new Set(presentValues(values).map(cellType));
  if (!types.size) return 'unknown';
  if (types.size > 1) return 'mixed';
  return [...types][0];
}

function shapeRate(values: readonly unknown[], predicate: (value: unknown) => boolean): number | null {
  if (!values.length) return null;
  return values.filter(predicate).length / values.length;
}

function valueShapes(values: readonly unknown[]): ColumnProfile['valueShapes'] {
  const present = presentValues(values);
  const lakhPattern = /^[+-]?\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?(?:\s|$)/;
  return {
    dateDmyRate: shapeRate(present, (value) => parseSourceDate(value, 'date_dmy') !== null),
    dateIsoRate: shapeRate(present, (value) => parseSourceDate(value, 'date_iso') !== null),
    lakhGroupingRate: shapeRate(
      present,
      (value) => typeof value === 'string' && lakhPattern.test(digits(value.trim())),
    ),
    devanagariDigitRate: shapeRate(present, (value) => typeof value === 'string' && /[०-९]/u.test(value)),
    khasraLikeRate: shapeRate(
      present,
      (value) => typeof value === 'string' && /^\d+\/\d+$/.test(digits(value.trim())),
    ),
    floorLabelRate: shapeRate(
      present,
      (value) => typeof value === 'string' && floor.test(digits(value.trim())),
    ),
    nullRate: shapeRate(values, (value) => value === null),
    blankRate: shapeRate(values, (value) => typeof value === 'string' && !value.trim()),
    absentRate: shapeRate(values, (value) => value === undefined),
    distinctRatio: present.length
      ? new Set(present.map((value) => JSON.stringify(value))).size / present.length
      : null,
  };
}

function sampleCells(values: readonly unknown[]): unknown[] {
  // Evenly spaced observed cells only; never replicate or fabricate padding for tiny inputs.
  const count = Math.min(10, values.length);
  return Array.from({ length: count }, (_, index) => values[Math.floor((index * values.length) / count)]);
}

export function profileColumns(
  rows: readonly MappingRow[],
  fields: readonly Pick<MappingLayoutField, 'name'>[],
  sourceKind: ColumnProfileDocument['sourceKind'],
): ColumnProfileDocument {
  const names = fields.map((field) => normalizeMappingHeader(field.name));
  if (!fields.length || fields.length > 256 || new Set(names).size !== fields.length) {
    throw new Error('COLUMN_LAYOUT_AMBIGUOUS');
  }
  const columns = fields.map(({ name }): ColumnProfile => {
    const values = rows.map((row) => row[name]);
    const declaredUnit = inferDeclaredUnit(name, values);
    return {
      name,
      inferredType: inferColumnType(values),
      ...(declaredUnit ? { declaredUnit } : {}),
      valueShapes: valueShapes(values),
      maskedSamples: sampleCells(values).map((value) => maskColumnSample(value, name)),
    };
  });
  return ColumnProfileDocumentSchema.parse({
    version: 'column-profile/1',
    sourceKind,
    columns,
    layoutFingerprint: layoutFingerprint(columns),
    sampleShortfall: columns.some((column) => column.maskedSamples.length < 5),
  });
}

export type ProfiledInput = { profile: ColumnProfileDocument; rows: MappingRow[] };

/** Attribute rows from any existing GIS reader; geometry is never sent to the teacher. */
export function profileGisAttributes(rows: MappingRow[], names?: string[]): ProfiledInput {
  const fields = names ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    rows,
    profile: profileColumns(
      rows,
      fields.map((name) => ({ name })),
      'gis_attributes',
    ),
  };
}

type WorkbookPart = {
  text: string;
  locator: {
    sheet: string;
    cell: string;
    cellState: string;
    ods?: { rowRepeat: number; columnRepeat: number };
  };
};
type WorkbookTable = { rows: MappingRow[]; names: string[] };
type WorkbookCells = Map<number, Map<number, unknown>>;

function readWorkbookParts(path: string): WorkbookPart[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
  const scriptPath = resolve(root, 'scripts/agent/read_workbook_cells.py');
  const servicesGeoPath = resolve(root, 'services/geo');
  const run = spawnSync(
    process.env.ULPIN_PROFILE_PYTHON ?? 'python',
    [scriptPath, servicesGeoPath, resolve(path)],
    {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    },
  );
  if (run.status !== 0) throw new Error('COLUMN_NATIVE_READER_UNAVAILABLE');
  return JSON.parse(run.stdout).parts as WorkbookPart[];
}

function isRepeatedPadding(part: WorkbookPart): boolean {
  const repetition = part.locator.ods;
  if (!repetition || (repetition.rowRepeat === 1 && repetition.columnRepeat === 1)) return false;
  if (['empty', 'empty_string', 'whitespace'].includes(part.locator.cellState)) return true;
  throw new Error('COLUMN_ODS_REPEAT_NEEDS_INPUT');
}

function collectWorkbookCells(parts: WorkbookPart[], sheet?: string): WorkbookCells {
  const cells: WorkbookCells = new Map();
  for (const part of parts.filter((item) => item.locator.sheet === sheet)) {
    if (isRepeatedPadding(part)) continue;
    const match = /^([A-Z]+)(\d+)$/.exec(part.locator.cell);
    if (!match) throw new Error('COLUMN_CELL_INVALID');
    const column = [...match[1]].reduce((count, letter) => count * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const row = Number(match[2]);
    if (!cells.has(row)) cells.set(row, new Map());
    // Formula/error placeholders never become literal values.
    const literal = part.locator.cellState === 'literal' || part.locator.cellState === 'whitespace';
    cells.get(row)!.set(column, literal ? part.text : null);
  }
  return cells;
}

function workbookTable(cells: WorkbookCells, headerRow?: number): WorkbookTable {
  const ordered = [...cells]
    .filter(([row]) => headerRow === undefined || row >= headerRow)
    .sort(([left], [right]) => left - right);
  if (!ordered.length || (headerRow !== undefined && ordered[0][0] !== headerRow)) {
    throw new Error('COLUMN_SHEET_UNAVAILABLE');
  }
  const header = ordered[0][1];
  const namedColumns = [...header].filter(([, value]) => typeof value === 'string' && value.trim());
  if (!namedColumns.length) throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  const width = Math.max(...namedColumns.map(([column]) => column)) + 1;
  const extraValues = ordered.some(([, row]) =>
    [...row].some(
      ([column, value]) => column >= width && value !== null && !(typeof value === 'string' && !value.trim()),
    ),
  );
  if (extraValues) throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  const names = Array.from({ length: width }, (_, index) => header.get(index));
  if (names.some((name) => typeof name !== 'string' || !name.trim()))
    throw new Error('COLUMN_HEADER_NEEDS_INPUT');
  const headers = names as string[];
  const rows = ordered
    .slice(1)
    .map(([, row]) => Object.fromEntries(headers.map((name, index) => [name, row.get(index)])));
  return { names: headers, rows };
}

/** Reuse bounded native XLSX/ODS readers, not a spreadsheet evaluator or a new format service. */
function workbookRows(path: string, sheet?: string, headerRow?: number): WorkbookTable {
  if (headerRow !== undefined && (!Number.isSafeInteger(headerRow) || headerRow < 1 || headerRow > 1048576)) {
    throw new Error('COLUMN_HEADER_ROW_INVALID');
  }
  const parts = readWorkbookParts(path);
  const selected = sheet ?? parts[0]?.locator.sheet;
  return workbookTable(collectWorkbookCells(parts, selected), headerRow);
}

function decodeColumnText(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (text.includes('\0')) throw new Error('COLUMN_ENCODING_UNSUPPORTED');
    return text;
  } catch {
    throw new Error('COLUMN_ENCODING_UNSUPPORTED');
  }
}

function csvColumns(text: string): ProfiledInput {
  const header = Papa.parse<string[]>(text, { preview: 1 }).data[0] ?? [];
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length || header.some((name) => !name.trim())) throw new Error('COLUMN_CSV_INVALID');
  return {
    rows: parsed.data,
    profile: profileColumns(
      parsed.data,
      header.map((name) => ({ name })),
      'tabular',
    ),
  };
}

export function profileColumnFile(path: string, sheet?: string, headerRow?: number): ProfiledInput {
  if (/(?:^|[\\/])\.env(?:\.|$)|(?:key|credential|secret)[^\\/]*$/i.test(path))
    throw new Error('COLUMN_PATH_FORBIDDEN');
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error('COLUMN_FILE_LIMIT');
  const bytes = readFileSync(path);
  if (bytes[0] === 80 && bytes[1] === 75) {
    const table = workbookRows(path, sheet, headerRow);
    return {
      rows: table.rows,
      profile: profileColumns(
        table.rows,
        table.names.map((name) => ({ name })),
        'tabular',
      ),
    };
  }
  const text = decodeColumnText(bytes);
  if (/^\s*\{/.test(text)) {
    const layer = JSON.parse(text);
    if (!Array.isArray(layer.features)) throw new Error('COLUMN_GIS_ATTRIBUTES_UNAVAILABLE');
    const rows = layer.features.map(
      (feature: Record<string, unknown>) => feature.attributes ?? feature.properties ?? {},
    );
    return profileGisAttributes(
      rows,
      layer.fields?.map((field: { name: string }) => field.name),
    );
  }
  return csvColumns(text);
}
