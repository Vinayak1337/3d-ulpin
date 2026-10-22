import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { TABULAR_LIMITS, TabularPinSchema, type TabularSelection, type TabularPin } from '@ulpin/contracts/usp';
import { settings } from '../../../infrastructure/config';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { COLUMN_CSV_ROW_LIMIT, decodeColumnText, readColumnCsv } from './column-profile';
import { profileTabularChunk } from './chunk-mapping-agent';
import { profileTabularStream } from './tabular-stream';
import { decodeTableBytes, detectDelimitedReading } from './delimited-text';
import { rowLimit, workbookLimit, workbookTable, type TabularTable } from './tabular-workbook';

export { TABULAR_ROW_LIMIT, type TabularTable } from './tabular-workbook';

type DevelopmentAsset = { id: string; family: string; split: string; mediaType: string;
  privacy?: string; permission: { state: string }; original: { sha256: string; bytes: number };
  derivativeOf?: { originalSha256: string; version: 'json-table-csv/1' } };
type Derivative = { family: string; originalSha256: string; sha256: string; bytes: number;
  scriptSha256: string; developmentCopy: string };
type CaseAdmission = Extract<TabularPin, { admission: unknown }>['admission'];
export type TabularProvenance = Partial<Omit<CaseAdmission, 'kind'>>;
type TabularAdmission = { kind: 'development'; asset: DevelopmentAsset } |
  { kind: 'case_original'; admission: CaseAdmission };
const MEDIA_TYPES: Readonly<Record<TabularSelection['format'], string>> = { csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet' };
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

function recordedDerivative(
  hash: string, bytes: number, assets: DevelopmentAsset[], index: any,
): DevelopmentAsset | undefined {
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

function knownHash(value: unknown, hash: string): boolean {
  if (typeof value === 'string') return value === hash;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(item => knownHash(item, hash));
}

function dataDenied(): never {
  throw new AppError(422, 'TABULAR_DATA_DENIED',
    'Only exact public D8 development originals/recorded derivatives qualify.');
}

/** One admission authority; known but ineligible hashes never use the case-original door. */
export function admitTabularSource(
  hash: string, bytes: number, provenance: TabularProvenance = {},
): TabularAdmission {
  const manifest = JSON.parse(readFileSync(join(settings.repositoryRoot,
    'fixtures/usp/D8-messy-india/manifest.json'), 'utf8'));
  const assets = publicDevelopmentAssets(manifest);
  const original = assets.find(item => item.original.sha256 === hash && item.original.bytes === bytes);
  if (original) return { kind: 'development', asset: original };
  const index = JSON.parse(readFileSync(join(settings.repositoryRoot,
    'fixtures/usp/D8-messy-india/dev/d1c/derivatives.json'), 'utf8'));
  const derivative = recordedDerivative(hash, bytes, assets, index);
  if (derivative) return { kind: 'development', asset: derivative };
  if (knownHash(manifest, hash) || knownHash(index, hash)) dataDenied();
  return { kind: 'case_original', admission: {
    kind: 'case_original', issuer: provenance.issuer ?? null, origin: 'officer_supplied',
    licence: provenance.licence ?? 'unconfirmed', containsPersonalData: provenance.containsPersonalData ?? 'unknown',
  } };
}

/** Development-only callers retain their existing refusal, through the shared admission authority. */
export function tabularDevelopmentAsset(hash: string, bytes: number): DevelopmentAsset {
  const admitted = admitTabularSource(hash, bytes);
  if (admitted.kind !== 'development') dataDenied();
  return admitted.asset;
}

function admittedPin(admitted: TabularAdmission, selection: TabularSelection, sourceBytes: number): TabularPin {
  if (admitted.kind === 'case_original') {
    return TabularPinSchema.parse({ selection, sourceBytes, admission: admitted.admission });
  }
  const asset = admitted.asset;
  return TabularPinSchema.parse({ selection, sourceBytes,
    developmentAssetId: asset.id, developmentFamily: asset.family,
    ...(asset.derivativeOf ? { derivativeOf: asset.derivativeOf } : {}) });
}

/** Native parsing is bounded; formulas, caches and absent cells never acquire values. */
export function readTabularSource(bytes: Uint8Array, selection: TabularSelection): TabularTable {
  if (!bytes.length || bytes.length > TABULAR_LIMITS.bytes) {
    throw new AppError(413, 'TABULAR_SOURCE_BUDGET', 'Choose a nonempty original up to 16 MiB.');
  }
  let table: TabularTable;
  try {
    if (selection.format !== 'csv') {
      const { marks: _marks, ...read } = workbookTable(bytes, selection, selection.format);
      table = read;
    } else {
      const text = selection.encoding
        ? decodeTableBytes(bytes, selection.encoding)
        : decodeColumnText(bytes);
      const csv = readColumnCsv(text, TABULAR_LIMITS.rows, selection.delimiter ?? ',');
      table = csv;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.message === COLUMN_CSV_ROW_LIMIT) rowLimit();
    throw new AppError(422, 'TABULAR_HEADER_OR_READER',
      'The literal reader requires valid headers, at most 2,000 rows and 256 columns.');
  }
  if (table.rows.length > TABULAR_LIMITS.rows) {
    if (selection.format !== 'csv') workbookLimit(selection.format);
    rowLimit();
  }
  if (!table.rows.length || !table.headers.some(header => header.trim()) ||
      table.headers.length > TABULAR_LIMITS.columns || table.headers.some(header => header.length > 400)) {
    throw new AppError(422, 'TABULAR_HEADER_REQUIRED',
      'Choose source headers and at least one record, within 2,000 rows and 256 columns.');
  }
  return table;
}

export function inspectTabularSource(
  bytes: Uint8Array, selection: TabularSelection, provenance: TabularProvenance = {}, name = '',
  reading: 'detect' | 'pinned' = 'detect',
) {
  const admitted = admitTabularSource(sha256(bytes), bytes.length, provenance);
  if (admitted.kind === 'development' && admitted.asset.mediaType !== MEDIA_TYPES[selection.format]) {
    throw new AppError(422, 'TABULAR_FORMAT', 'The manifest and selected format differ.');
  }
  if (selection.format === 'csv' && reading === 'detect') {
    try {
      const stated = selection.encodingBasis === 'officer_stated' ? selection.encoding : undefined;
      const { delimiter, encoding, encodingBasis } = detectDelimitedReading(bytes, name, stated);
      selection = { ...selection, delimiter: selection.delimiter ?? delimiter, encoding, encodingBasis };
    } catch (error) {
      let words = 'This table has invalid text or binary null bytes. The original is unchanged; provide a text table.';
      if (selection.encodingBasis === 'officer_stated') {
        words = `This table has invalid ${selection.encoding} text or a binary null byte; the original is unchanged.`;
        if (error instanceof Error && /Unsupported|BOM|byte order mark/.test(error.message)) words = error.message;
      }
      throw new AppError(422, 'TABULAR_ENCODING', words);
    }
  }
  const table = readTabularSource(bytes, selection);
  const profile = profileTabularChunk({ jobId: 'inventory', chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 100), sourceRef: 'inventory', selection }).profile;
  if (selection.format === 'csv') {
    if (selection.delimiter) profile.delimiter = selection.delimiter;
    if (selection.encoding) profile.encoding = selection.encoding;
    if (selection.encodingBasis) profile.encodingBasis = selection.encodingBasis;
  }
  const tabular = admittedPin(admitted, selection, bytes.length);
  return { tabular, headers: table.headers, records: table.rows.length, profile,
    schemaFingerprint: fingerprint({ selection, headers: table.headers, layout: profile.layoutFingerprint }),
    limitations: admissionLimitations(admitted) };
}

/** A case original's CSV or workbook above 16 MiB, read from its retained object as a stream against its byte
 * receipt. */
export async function inspectTabularStream(body: Readable, receipt: { sha256: string; bytes: number },
  selection: TabularSelection, provenance: TabularProvenance = {}, name = '') {
  const admitted = admitTabularSource(receipt.sha256, receipt.bytes, provenance);
  if (admitted.kind !== 'case_original') {
    throw new AppError(422, 'TABULAR_FORMAT', 'Only a case original is read as a stream.');
  }
  const read = await profileTabularStream(body, { selection, bytes: receipt.bytes, detectReading: true, name });
  if (selection.format === 'csv') selection = { ...selection, delimiter: read.delimiter, encoding: read.encoding,
    ...(read.encodingBasis ? { encodingBasis: read.encodingBasis } : {}) };
  if (read.bytes !== receipt.bytes || read.sha256 !== receipt.sha256) {
    throw new AppError(422, 'STREAMING_SOURCE_INTEGRITY', 'The original differs from its byte receipt.');
  }
  const tabular = admittedPin(admitted, selection, read.bytes);
  return { tabular, headers: read.headers, records: read.records, profile: read.profile,
    streamCounts: read.streamCounts,
    schemaFingerprint: fingerprint({ selection, headers: read.headers, layout: read.profile.layoutFingerprint }),
    limitations: [...admissionLimitations(admitted),
      `Read as a stream in ${read.windows} windows; the profile shows the first 100 records.`,
      ...read.notes ?? []] };
}

function admissionLimitations(admitted: TabularAdmission): string[] {
  const common = 'No geometry, identity issuance or registry writes; native sheet rows remain source locators.';
  if (admitted.kind === 'case_original') {
    return [`officer_supplied; licence ${admitted.admission.licence}; ` +
      `containsPersonalData ${admitted.admission.containsPersonalData}.`,
    'This is not a development or evaluation asset; no family or learning split is assigned.',
    'The D8 manifest omits held-out original hashes; this gate cannot recognise those files by hash.', common];
  }
  const asset = admitted.asset;
  return ['test_only; permission unconfirmed unless publisher metadata states otherwise.', common,
    ...(asset.derivativeOf ? [`Recorded JSON-original lineage: ${asset.derivativeOf.originalSha256}; ` +
      `${asset.derivativeOf.version}. CSV is a development derivative, not a publisher-native CSV.`] : [])];
}

export function assertTabularPin(pin: TabularPin, source: { sha256: string; bytes: number; inspection: any }) {
  const parsed = TabularPinSchema.parse(pin);
  const admitted = admitTabularSource(source.sha256, Number(source.bytes), source.inspection?.tabularProvenance);
  const expected = admittedPin(admitted, parsed.selection, Number(source.bytes));
  if (fingerprint(expected) !== fingerprint(parsed) ||
      fingerprint(parsed) !== fingerprint(source.inspection?.manualProfile?.tabular)) {
    throw new AppError(409, 'TABULAR_PIN_CHANGED', 'The tabular byte receipt, selection or provenance changed.');
  }
}
