import {
  CANONICAL_TARGETS,
  canonicalTarget,
  type CanonicalMappedValue,
  type CanonicalTarget,
  type MappingPlanV2,
  type MappingLayoutField,
} from '@ulpin/contracts';
import { ENUM_TABLES, validateMappingPlanV2, type MappingValidationContext } from './mapping-plan-v2';
import { UNIT_TABLE, UNIT_SUFFIXES } from './unit-table';

export type MappingRow = Readonly<Record<string, unknown>>;
export type MappedCell = CanonicalMappedValue & { sourceField: string; target: CanonicalTarget };
export type MappedRow = { row: number; fields: MappedCell[] };
export type MappingExecutionContext = MappingValidationContext & {
  sourceRef: string;
  rowOffset?: number;
  /** Reader-provided only; coordinates remain in this source reference. */
  sourceCrs?: string;
  parents?: { field: string; rows: readonly MappingRow[] }[];
};
export type MappingExecutionResult = {
  version: 'mapping-executor/1';
  method: string;
  layoutFingerprint: string;
  rows: MappedRow[];
  counts: {
    cells: number;
    candidate: number;
    needsInput: number;
    unknown: number;
    absent: number;
    null: number;
    conflicting: number;
  };
};
type MappingV2Field = MappingPlanV2['fields'][number];
type CellContext = {
  plan: MappingPlanV2;
  inventory: ReadonlyMap<string, MappingLayoutField>;
  context: MappingExecutionContext;
};
type DateKind = 'date_dmy' | 'date_iso';
type DateParts = { year: number; month: number; day: number };

export function mappedCellCounts(rows: readonly MappedRow[]): MappingExecutionResult['counts'] {
  const counts = { cells: 0, candidate: 0, needsInput: 0, unknown: 0, absent: 0, null: 0, conflicting: 0 };
  for (const row of rows) {
    for (const cell of row.fields) {
      counts.cells++;
      switch (cell.state) {
        case 'candidate':
          counts.candidate++;
          break;
        case 'needs_input':
          counts.needsInput++;
          break;
        case 'unknown':
          counts.unknown++;
          break;
        case 'absent':
          counts.absent++;
          break;
        case 'null':
          counts.null++;
          break;
        case 'conflicting':
          counts.conflicting++;
          break;
      }
    }
  }
  return counts;
}

export class MappingPlanValidationError extends Error {
  readonly code = 'MAPPING_PLAN_INVALID';
  constructor(readonly errors: ReturnType<typeof validateMappingPlanV2>['errors']) {
    super('MappingPlan v2 validation failed.');
  }
}

const asciiDigits = (text: string) =>
  text.replace(/[०-९]/gu, (character) => String(character.charCodeAt(0) - '०'.charCodeAt(0)));

/** Strict Indian/western grouping, never Number('') or an arbitrary expression parser. */
export function parseIndianNumber(raw: unknown): number | null {
  if (typeof raw === 'number')
    return Number.isFinite(raw) && Math.abs(raw) <= Number.MAX_SAFE_INTEGER ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = asciiDigits(raw.trim());
  const pattern =
    /^[+-]?(?:\d+(?:\.\d+)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?)$/;
  if (!pattern.test(text)) return null;
  const value = Number(text.replaceAll(',', ''));
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

function matchDate(text: string, kind: DateKind): DateParts | null {
  const match =
    kind === 'date_dmy' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  if (kind === 'date_dmy') return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function parseSourceDate(raw: unknown, kind: DateKind): string | null {
  if (typeof raw !== 'string') return null;
  const parts = matchDate(asciiDigits(raw.trim()), kind);
  if (!parts) return null;
  const { year, month, day } = parts;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function quantity(raw: unknown, unit: NonNullable<MappingLayoutField['declaredUnit']>): number | null {
  if (typeof raw === 'number') return parseIndianNumber(raw);
  if (typeof raw !== 'string') return null;
  const match = /^([+-]?(?:[\d,]+(?:\.\d+)?|\.\d+))\s*(.*?)$/.exec(asciiDigits(raw.trim()));
  if (!match || (match[2] && !UNIT_SUFFIXES[unit].test(match[2]))) return null;
  return parseIndianNumber(match[1]);
}

function isPosition(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 3 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function isClosedRing(ring: unknown): boolean {
  return (
    Array.isArray(ring) &&
    ring.length >= 4 &&
    ring.every(isPosition) &&
    JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])
  );
}

function isSourcePolygon(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const geometry = raw as Record<string, unknown>;
  let polygons: unknown = null;
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates;
  else if (Object.hasOwn(geometry, 'rings')) polygons = [geometry.rings];
  return (
    Array.isArray(polygons) &&
    polygons.length > 0 &&
    polygons.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isClosedRing))
  );
}

function needsInput(cell: MappedCell, code: string): MappedCell {
  return { ...cell, value: null, state: 'needs_input', issueCode: code };
}

function mapParentKey(
  cell: MappedCell,
  original: unknown,
  parentField: string,
  context: MappingExecutionContext,
): MappedCell {
  const parents = context.parents?.filter((parent) => parent.field === parentField);
  const matches =
    parents
      ?.flatMap((parent) => parent.rows)
      .filter((parent) => Object.hasOwn(parent, parentField) && parent[parentField] === original) ?? [];
  if ((typeof original !== 'string' && typeof original !== 'number') || matches.length !== 1) {
    return needsInput(
      cell,
      matches.length > 1 ? 'MAPPING_PARENT_KEY_AMBIGUOUS' : 'MAPPING_PARENT_KEY_NOT_FOUND',
    );
  }
  cell.value = original;
  return cell;
}

function mapLiteral(cell: MappedCell, original: unknown): MappedCell {
  const definition = CANONICAL_TARGETS[cell.target];
  if (typeof original !== 'string') {
    if (definition.valueKind !== 'key' || typeof original !== 'number' || !Number.isSafeInteger(original)) {
      return needsInput(cell, 'MAPPING_LITERAL_UNPARSEABLE');
    }
  }
  if (typeof original === 'string' && !original.trim()) return needsInput(cell, 'MAPPING_LITERAL_EMPTY');
  cell.value = original;
  return cell;
}

function mapQuantity(
  cell: MappedCell,
  original: unknown,
  field: MappingV2Field,
  ctx: CellContext,
): MappedCell {
  const definition = CANONICAL_TARGETS[cell.target];
  const source = ctx.inventory.get(field.sourceField)!;
  const operation = field.operation;
  let unit = source.declaredUnit;
  if (operation.kind === 'unit_convert') unit = operation.sourceUnit;
  else if (!unit && definition.unitFamily === 'count') unit = 'count';
  if (!unit) return needsInput(cell, 'MAPPING_UNIT_REQUIRED');
  const conversion = UNIT_TABLE[unit];
  if (conversion.family !== definition.unitFamily) return needsInput(cell, 'MAPPING_UNIT_FAMILY_MISMATCH');
  if (conversion.factor === null) return needsInput(cell, 'MAPPING_REGIONAL_UNIT_NEEDS_INPUT');
  if (operation.kind !== 'unit_convert' && conversion.factor !== 1) {
    return needsInput(cell, 'MAPPING_UNIT_CONVERSION_REQUIRED');
  }
  const parsed = quantity(original, unit);
  if (parsed === null) return needsInput(cell, 'MAPPING_NUMBER_UNPARSEABLE');
  const value = parsed * (operation.kind === 'unit_convert' ? conversion.factor : 1);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    return needsInput(cell, 'MAPPING_NUMBER_OUT_OF_RANGE');
  }
  const invalidCount = definition.unitFamily === 'count' && (!Number.isInteger(value) || value < 0);
  const invalidArea = definition.unitFamily === 'area' && value < 0;
  const invalidHeight = cell.target === 'building.heightM' && value < 0;
  if (invalidCount || invalidArea || invalidHeight) return needsInput(cell, 'MAPPING_QUANTITY_INVALID');
  cell.value = value;
  cell.unit = conversion.unit;
  if (conversion.source) cell.conversionSource = conversion.source;
  return cell;
}

function mapDate(cell: MappedCell, original: unknown, field: MappingV2Field): MappedCell {
  const operation = field.operation;
  let kind: DateKind = 'date_iso';
  if (
    operation.kind === 'parse_literal' &&
    (operation.literalKind === 'date_dmy' || operation.literalKind === 'date_iso')
  ) {
    kind = operation.literalKind;
  }
  const value = parseSourceDate(original, kind);
  if (value === null) return needsInput(cell, 'MAPPING_DATE_UNPARSEABLE');
  cell.value = value;
  return cell;
}

function mapEnum(cell: MappedCell, original: unknown, field: MappingV2Field): MappedCell {
  const operation = field.operation;
  const table =
    operation.kind === 'enum_lookup'
      ? ENUM_TABLES[operation.tableId]
      : Object.values(ENUM_TABLES).find((item) => item.target === cell.target);
  if (typeof original !== 'string' || !table) return needsInput(cell, 'MAPPING_ENUM_UNRECOGNISED');
  const value = operation.kind === 'enum_lookup' ? original.trim().toLowerCase() : original;
  if (!(table.values as readonly string[]).includes(value))
    return needsInput(cell, 'MAPPING_ENUM_UNRECOGNISED');
  cell.value = value;
  return cell;
}

function mapGeometry(cell: MappedCell, original: unknown, context: MappingExecutionContext): MappedCell {
  if (!context.sourceCrs) return needsInput(cell, 'MAPPING_CRS_UNVERIFIED');
  if (!isSourcePolygon(original)) return needsInput(cell, 'MAPPING_GEOMETRY_UNPARSEABLE');
  // Retained source geometry only, never a local-frame scene projection.
  cell.value = structuredClone(original);
  cell.sourceCrs = context.sourceCrs;
  return cell;
}

function mapCell(field: MappingV2Field, row: MappingRow, rowIndex: number, ctx: CellContext): MappedCell {
  const target = canonicalTarget(field.target);
  const cell: MappedCell = {
    sourceField: field.sourceField,
    target,
    value: null,
    state: 'candidate',
    citations: [{ sourceRef: ctx.context.sourceRef, row: rowIndex, column: field.sourceField }],
    method: ctx.plan.method,
  };
  if (!Object.hasOwn(row, field.sourceField) || row[field.sourceField] === undefined)
    return { ...cell, state: 'absent' };
  const original = row[field.sourceField];
  cell.literal = structuredClone(original);
  if (original === null) return { ...cell, state: 'null' };
  if (target === 'unknown') return { ...cell, state: 'unknown' };
  if (field.operation.kind === 'link_parent_key') {
    return mapParentKey(cell, original, field.operation.parentField, ctx.context);
  }
  switch (CANONICAL_TARGETS[target].valueKind) {
    case 'text_literal':
    case 'key':
      return mapLiteral(cell, original);
    case 'number_unit':
      return mapQuantity(cell, original, field, ctx);
    case 'date':
      return mapDate(cell, original, field);
    case 'enum':
      return mapEnum(cell, original, field);
    case 'geometry':
      return mapGeometry(cell, original, ctx.context);
    default:
      return needsInput(cell, 'MAPPING_VALUE_UNSUPPORTED');
  }
}

function mapRow(row: MappingRow, index: number, ctx: CellContext): MappedRow {
  const rowIndex = (ctx.context.rowOffset ?? 0) + index;
  return { row: rowIndex, fields: ctx.plan.fields.map((field) => mapCell(field, row, rowIndex, ctx)) };
}

function appendSchemaDriftCells(mapped: MappedRow[], rows: readonly MappingRow[], ctx: CellContext) {
  // Later rows may expose unprofiled columns: retain them with locators, never silently drop them.
  for (let index = 0; index < rows.length; index++) {
    for (const name of Object.keys(rows[index])) {
      if (ctx.inventory.has(name)) continue;
      mapped[index].fields.push({
        sourceField: name,
        target: 'unknown',
        value: null,
        state: 'needs_input',
        literal: structuredClone(rows[index][name]),
        citations: [{ sourceRef: ctx.context.sourceRef, row: mapped[index].row, column: name }],
        method: ctx.plan.method,
        issueCode: 'MAPPING_ROW_SCHEMA_DRIFT',
      });
    }
  }
}

function markLevelBoundConflicts(rows: MappedRow[]) {
  // Cross-field contradictions retain both originals; no automatic schedule repair.
  for (const row of rows) {
    const lower = row.fields.find((field) => field.target === 'level.lowerM');
    const upper = row.fields.find((field) => field.target === 'level.upperM');
    if (lower?.state !== 'candidate' || upper?.state !== 'candidate') continue;
    if (typeof lower.value !== 'number' || typeof upper.value !== 'number' || lower.value < upper.value)
      continue;
    for (const field of [lower, upper]) {
      field.state = 'conflicting';
      field.issueCode = 'MAPPING_LEVEL_BOUNDS_CONFLICT';
    }
  }
}

/** Validates itself; a caller's "validated=true" is not a trust boundary. No persistence. */
export function executeMappingPlanV2(
  raw: unknown,
  rows: readonly MappingRow[],
  context: MappingExecutionContext,
): MappingExecutionResult {
  const checked = validateMappingPlanV2(raw, context);
  if (!checked.success) throw new MappingPlanValidationError(checked.errors);
  const ctx: CellContext = {
    plan: checked.plan,
    inventory: new Map(context.fields.map((field) => [field.name, field])),
    context,
  };
  const mapped = rows.map((row, index) => mapRow(row, index, ctx));
  appendSchemaDriftCells(mapped, rows, ctx);
  markLevelBoundConflicts(mapped);
  return {
    version: 'mapping-executor/1',
    method: ctx.plan.method,
    layoutFingerprint: ctx.plan.layoutFingerprint,
    rows: mapped,
    counts: mappedCellCounts(mapped),
  };
}
