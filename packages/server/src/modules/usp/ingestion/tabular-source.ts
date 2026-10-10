import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { TABULAR_LIMITS, TabularPinSchema, type TabularSelection, type TabularPin } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { decodeColumnText, readColumnCsv } from './column-profile';
import { profileTabularChunk } from './chunk-mapping-agent';

type Part = { text: string; locator: { sheet: string; row: number; column: number; cellState: string } };
export type TabularTable = { headers: string[]; rows: unknown[][]; sourceRows: number[];
  cellStates?: ('literal' | 'absent' | 'unknown')[][] };
type DevelopmentAsset = { id: string; family: string; split: string; mediaType: string;
  privacy?: string; permission: { state: string }; original: { sha256: string; bytes: number };
  derivativeOf?: { originalSha256: string; version: 'json-table-csv/1' } };
type Derivative = { family: string; originalSha256: string; sha256: string; bytes: number;
  scriptSha256: string; developmentCopy: string };
const JSON_TABLE_GENERATORS = new Set([
  '63821f68526c441aa10a1614f5f92febee05a2536a3b6f13ff470c478eeee263',
  '62d8248ccd5b45e705d21984bbce5926a62e0a4e80fd69502ff3a81b2d8b50ea',
]);

function publicDevelopmentAssets(manifest: any): DevelopmentAsset[] {
  const dev = new Set(manifest.families.filter((family: { split: string }) => family.split === 'dev')
    .map((family: { id: string }) => family.id));
  const blind = new Set(manifest.heldout.map((family: { id: string }) => family.id));
  return manifest.assets.filter((item: DevelopmentAsset) => item.split === 'dev' && dev.has(item.family) &&
    !blind.has(item.family) && item.permission.state !== 'restricted' &&
    !/private|restricted/i.test(item.privacy ?? ''));
}

function recordedDerivative(hash: string, bytes: number, assets: DevelopmentAsset[]): DevelopmentAsset | undefined {
  const index = JSON.parse(readFileSync(join(settings.repositoryRoot,
    'fixtures/usp/D8-messy-india/dev/d1c/derivatives.json'), 'utf8'));
  if (index.schemaVersion !== 'd1d-derivative-index/1' || index.script !== 'scripts/agent/flatten-json-table.py' ||
      index.version !== 'json-table-csv/1') return undefined;
  const matching = index.derivatives.filter((item: Derivative) => item.sha256 === hash && item.bytes === bytes);
  if (matching.length !== 1) return undefined;
  const derivative = matching[0] as Derivative;
  const original = assets.find(item => item.original.sha256 === derivative.originalSha256 &&
    item.family === derivative.family);
  if (!original || !JSON_TABLE_GENERATORS.has(derivative.scriptSha256) ||
      !/^fixtures\/usp\/D8-messy-india\/dev\/d1c\/[^/]+\.csv$/.test(derivative.developmentCopy)) return undefined;
  return { ...original, id: basename(derivative.developmentCopy), mediaType: 'text/csv',
    original: { sha256: hash, bytes },
    derivativeOf: { originalSha256: original.original.sha256, version: 'json-table-csv/1' } };
}

/** Exact public development originals or recorded derivatives only; no evaluator or teacher labels are opened. */
export function tabularDevelopmentAsset(hash: string, bytes: number): DevelopmentAsset {
  const manifest = JSON.parse(readFileSync(join(settings.repositoryRoot,
    'fixtures/usp/D8-messy-india/manifest.json'), 'utf8'));
  const assets = publicDevelopmentAssets(manifest);
  const asset = assets.find(item => item.original.sha256 === hash && item.original.bytes === bytes) ??
    recordedDerivative(hash, bytes, assets);
  if (!asset) {
    throw new AppError(422, 'TABULAR_DATA_DENIED',
      'Only exact public D8 development originals/recorded derivatives qualify.');
  }
  return asset;
}

function workbookParts(bytes: Uint8Array): Part[] {
  const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [
    join(settings.repositoryRoot, 'scripts/agent/read_workbook_cells.py'),
    join(settings.repositoryRoot, 'services/geo'), '-',
  ], { input: Buffer.from(bytes).toString('base64'), encoding: 'utf8', timeout: 30000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (run.status !== 0) {
    throw new AppError(422, 'TABULAR_NATIVE_READER', 'The unchanged native workbook bounds refused it.');
  }
  const output = JSON.parse(run.stdout);
  if (output.format !== 'xlsx') throw new AppError(422, 'TABULAR_FORMAT', 'Choose a native XLSX workbook.');
  return output.parts;
}

function workbookTable(bytes: Uint8Array, selection: TabularSelection): TabularTable {
  const parts = workbookParts(bytes).filter(part => part.locator.sheet === selection.sheet);
  const headerParts = parts.filter(part => selection.headerRows.includes(part.locator.row));
  const width = Math.max(0, ...headerParts.map(part => part.locator.column));
  if (!width || width > TABULAR_LIMITS.columns || selection.headerRows.some(row =>
    !headerParts.some(part => part.locator.row === row))) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED', 'Pin existing header rows in exactly one native sheet.');
  }
  const headers = Array.from({ length: width }, (_, index) => headerParts.filter(part =>
    part.locator.column === index + 1 && part.locator.cellState === 'literal').map(part => part.text).join(' / '));
  const records = workbookRows(parts, selection, width);
  return { headers, ...records };
}

function workbookRows(parts: Part[], selection: TabularSelection, width: number) {
  const records = new Map<number, unknown[]>();
  const states = new Map<number, ('literal' | 'absent' | 'unknown')[]>();
  for (const part of parts) {
    if (part.locator.row <= Math.max(...selection.headerRows)) continue;
    if (part.locator.column > width) {
      throw new AppError(422, 'TABULAR_SCHEMA_DRIFT', 'A cell exceeds the pinned headers.');
    }
    if (!records.has(part.locator.row)) {
      records.set(part.locator.row, []);
      states.set(part.locator.row, Array(width).fill('absent'));
    }
    const literal = ['literal', 'whitespace', 'empty_string'].includes(part.locator.cellState);
    states.get(part.locator.row)![part.locator.column - 1] = literal ? 'literal' : 'unknown';
    if (literal) records.get(part.locator.row)![part.locator.column - 1] =
      part.locator.cellState === 'empty_string' ? '' : part.text;
  }
  const ordered = [...records].sort(([left], [right]) => left - right);
  return { rows: ordered.map(([, row]) => row), sourceRows: ordered.map(([row]) => row),
    cellStates: ordered.map(([row]) => states.get(row)!) };
}

/** Native parsing is bounded; formulas, caches and absent cells never acquire values. */
export function readTabularSource(bytes: Uint8Array, selection: TabularSelection): TabularTable {
  if (!bytes.length || bytes.length > TABULAR_LIMITS.bytes) {
    throw new AppError(413, 'TABULAR_SOURCE_BUDGET', 'Choose a nonempty original up to 16 MiB.');
  }
  let table: TabularTable;
  try {
    if (selection.format === 'xlsx') table = workbookTable(bytes, selection);
    else {
      const csv = readColumnCsv(decodeColumnText(bytes), TABULAR_LIMITS.rows);
      table = csv;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'TABULAR_HEADER_OR_READER', 'The bounded literal reader needs valid headers and records.');
  }
  if (!table.rows.length || table.rows.length > TABULAR_LIMITS.rows || !table.headers.some(header => header.trim()) ||
      table.headers.length > TABULAR_LIMITS.columns || table.headers.some(header => header.length > 400)) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED', 'Choose bounded source headers and at least one data record.');
  }
  return table;
}

export function inspectTabularSource(bytes: Uint8Array, selection: TabularSelection) {
  const asset = tabularDevelopmentAsset(sha256(bytes), bytes.length);
  const expected = selection.format === 'csv' ? 'text/csv' :
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (asset.mediaType !== expected) {
    throw new AppError(422, 'TABULAR_FORMAT', 'The manifest and selected format differ.');
  }
  const table = readTabularSource(bytes, selection);
  const profile = profileTabularChunk({ jobId: 'inventory', chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 100), sourceRef: 'inventory', selection }).profile;
  const tabular = TabularPinSchema.parse({ selection, sourceBytes: bytes.length,
    developmentAssetId: asset.id, developmentFamily: asset.family,
    ...(asset.derivativeOf ? { derivativeOf: asset.derivativeOf } : {}) });
  return { tabular, headers: table.headers, records: table.rows.length, profile,
    schemaFingerprint: fingerprint({ selection, headers: table.headers, layout: profile.layoutFingerprint }),
    limitations: ['test_only; permission unconfirmed unless publisher metadata states otherwise.',
      'No geometry, identity issuance or registry writes; native sheet rows remain source locators.',
      ...(asset.derivativeOf ? [`Recorded JSON-original lineage: ${asset.derivativeOf.originalSha256}; ` +
        `${asset.derivativeOf.version}. CSV is a development derivative, not a publisher-native CSV.`] : [])] };
}

export function assertTabularPin(pin: TabularPin, source: { sha256: string; bytes: number; inspection: any }) {
  TabularPinSchema.parse(pin);
  const asset = tabularDevelopmentAsset(source.sha256, Number(source.bytes));
  if (asset.id !== pin.developmentAssetId || asset.family !== pin.developmentFamily ||
      fingerprint(asset.derivativeOf ?? null) !== fingerprint(pin.derivativeOf ?? null) ||
      fingerprint(pin) !== fingerprint(source.inspection?.manualProfile?.tabular)) {
    throw new AppError(409, 'TABULAR_PIN_CHANGED', 'The tabular byte receipt or selection changed.');
  }
}
