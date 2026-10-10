import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Reuse the server-owned CSV parser; do not introduce another format reader.
const Papa = createRequire(resolve('packages/server/package.json'))('papaparse') as {
  parse: (text: string, options: { skipEmptyLines: 'greedy' }) => { data: string[][]; errors: unknown[] };
};

export const D8_MANIFEST = 'fixtures/usp/D8-messy-india/manifest.json';
export const T1_ROOT = 'E:/BhuAayam-data/task-data/t1';
export const POOL_ROOT = 'E:/BhuAayam-data/datasets/messy-india-pool';
export const POOL_MANIFEST = `${POOL_ROOT}/manifest-v2.json`;
export const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type SourceColumn = {
  name: string;
  publisherMeaning?: string;
  documentationUrl?: string;
  documentationLocator?: string;
  documentationSha256?: string;
  documentationStrength?: string;
  evaluationEligible?: boolean;
};
export type SourceAsset = {
  id: string;
  family: string;
  split: 'dev' | 'pool';
  mediaType: string;
  original: { externalPath: string; sha256: string; bytes: number };
  sourceTable?: { htmlId: string; dataRows?: number };
  sourceSchema?: { headerRows?: number[]; headerCellLiterals?: { locator: string; literal: string }[] };
  columns?: SourceColumn[];
  dictionary?: { url: string; externalPath: string; sha256: string };
  permission: { state: string };
  privacy?: string;
};
export type SourceTable = {
  name: string;
  headers: string[];
  headerLocators: string[][];
  rows: unknown[][];
  headerRows: number[];
};
type NativePart = {
  text: string;
  locator: { sheet: string; row: number; column: number; cell: string; cellState: string; cellType?: string };
};
type Manifest = {
  families: { id: string; split: string }[];
  heldout: { id: string }[];
  assets: SourceAsset[];
};

export function developmentManifest() {
  // This manifest exposes blind family IDs; the separate evaluator manifest is never read.
  const manifest = JSON.parse(readFileSync(D8_MANIFEST, 'utf8')) as Manifest;
  const development = new Set(manifest.families.filter(family => family.split === 'dev').map(family => family.id));
  const heldOut = new Set(manifest.heldout.map(family => family.id));
  const assets = manifest.assets.filter(asset => asset.split === 'dev' && development.has(asset.family));
  if (assets.some(asset => heldOut.has(asset.family))) throw new Error('T1_SPLIT_AMBIGUOUS');
  const allFamilies = new Set([...manifest.families.map(family => family.id), ...heldOut]);
  return { assets, development, heldOut, allFamilies };
}

export function preparationAssets() {
  const manifest = developmentManifest();
  const pool = JSON.parse(readFileSync(POOL_MANIFEST, 'utf8')) as { assets: SourceAsset[]; gaps: unknown[] };
  if (pool.assets.some(asset => asset.split !== 'pool' || manifest.allFamilies.has(asset.family))) {
    throw new Error('T1_POOL_FAMILY_DENIED');
  }
  const assets = [...manifest.assets, ...pool.assets];
  if (new Set(assets.map(asset => `${asset.family}/${asset.id}`)).size !== assets.length) {
    throw new Error('T1_ASSET_AMBIGUOUS');
  }
  return { assets, gaps: pool.gaps };
}

function authorizeSource(asset: SourceAsset) {
  const allowed = preparationAssets().assets.find(entry => entry.family === asset.family && entry.id === asset.id);
  if (!allowed || stableHash(allowed) !== stableHash(asset)) throw new Error('T1_SOURCE_DENIED');
  if (asset.permission.state === 'restricted' || /private|restricted/i.test(asset.privacy ?? '')) {
    throw new Error('T1_SOURCE_DENIED');
  }
  if (/(?:^|[\\/])(?:\.env(?:\.|$)|heldout\.json$)/i.test(asset.original.externalPath)) {
    throw new Error('T1_SOURCE_DENIED');
  }
}

function checkSource(asset: SourceAsset) {
  authorizeSource(asset); // Authorization precedes opening, stat or hashing source bytes.
  if (statSync(asset.original.externalPath).size > 20 * 1024 * 1024) throw new Error('T1_SOURCE_LIMIT');
  if (digest(asset.original.externalPath) !== asset.original.sha256) throw new Error('T1_SOURCE_HASH_MISMATCH');
}

function csvTable(asset: SourceAsset): SourceTable {
  const bytes = readFileSync(asset.original.externalPath);
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('COLUMN_ENCODING_UNSUPPORTED');
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
  if (parsed.errors.length || !parsed.data.length) throw new Error('T1_CSV_INVALID');
  const [headers, ...rows] = parsed.data;
  if (rows.some(row => row.length > headers.length)) throw new Error('T1_ROW_SCHEMA_DRIFT');
  return {
    name: 'csv', headers, rows, headerRows: [1],
    headerLocators: headers.map((_, index) => [`record 1/${index + 1}`]),
  };
}

function nativeParts(asset: SourceAsset): NativePart[] {
  const args = [resolve('scripts/agent/read_workbook_cells.py'), resolve('services/geo'), asset.original.externalPath];
  if (asset.sourceTable?.htmlId) args.push(asset.sourceTable.htmlId);
  const result = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', args, {
    encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.status !== 0) throw new Error('T1_NATIVE_READER_UNAVAILABLE');
  return JSON.parse(result.stdout).parts as NativePart[];
}

function headerRows(parts: NativePart[], asset: SourceAsset): number[] {
  if (asset.sourceSchema?.headerRows) return asset.sourceSchema.headerRows;
  const explicit = [...new Set(parts.filter(part => part.locator.cellType === 'header').map(part => part.locator.row))];
  if (explicit.length) return explicit.sort((left, right) => left - right);
  throw new Error('T1_HEADER_SELECTION_REQUIRED');
}

function nativeRows(parts: NativePart[], headings: number[], width: number, asset: SourceAsset): unknown[][] {
  const data = new Map<number, unknown[]>();
  for (const part of parts) {
    if (part.locator.row <= Math.max(...headings)) continue;
    const declaredRows = asset.sourceTable?.dataRows;
    if (declaredRows !== undefined && part.locator.row > Math.max(...headings) + declaredRows) continue;
    if (part.locator.column > width) throw new Error('T1_ROW_SCHEMA_DRIFT');
    if (!data.has(part.locator.row)) data.set(part.locator.row, Array(width).fill(undefined));
    const known = ['literal', 'whitespace', 'empty_string'].includes(part.locator.cellState);
    // Spans, formulas, unknown caches and missing positions remain absent; do not fill or propagate them.
    data.get(part.locator.row)![part.locator.column - 1] = known ? part.text : undefined;
  }
  return [...data].sort(([left], [right]) => left - right).map(([, row]) => row);
}

function nativeTable(name: string, parts: NativePart[], asset: SourceAsset): SourceTable {
  const selected = parts.filter(part => part.locator.sheet === name);
  const headings = headerRows(selected, asset);
  const width = Math.max(...selected.filter(part => headings.includes(part.locator.row)).map(p => p.locator.column));
  if (!Number.isFinite(width) || width < 1 || width > 256) throw new Error('T1_HEADER_SELECTION_REQUIRED');
  const headers = Array.from({ length: width }, (_, index) => selected.filter(part =>
    part.locator.column === index + 1 && headings.includes(part.locator.row) && part.locator.cellState === 'literal'));
  return {
    name, headers: headers.map(cells => cells.map(cell => cell.text).join(' / ')),
    headerLocators: headers.map(cells => cells.map(cell => cell.locator.cell)),
    rows: nativeRows(selected, headings, width, asset), headerRows: headings,
  };
}

export function sourceTables(asset: SourceAsset): SourceTable[] {
  checkSource(asset);
  if (asset.mediaType === 'text/csv') return [csvTable(asset)];
  const parts = nativeParts(asset);
  const tables = [...new Set(parts.map(part => part.locator.sheet))].map(name => nativeTable(name, parts, asset));
  if (!tables.length) throw new Error('T1_NO_TABLES');
  if (digest(asset.original.externalPath) !== asset.original.sha256) throw new Error('T1_SOURCE_HASH_MISMATCH');
  return tables;
}
