import { performance } from 'node:perf_hooks';
import Papa from 'papaparse';
import { INTAKE_CARD_VERSION, INTAKE_LEGACY_WORKBOOK_WORDS, INTAKE_PROBE_LIMITS as limits, IntakeCardSchema,
  type IntakeCard, type IntakeMemberCard } from '@ulpin/contracts/usp';
import { detectIntakeKind, intakeNameDisagrees } from './intake-signatures';
import { INTAKE_GZIP_WORDS, intakeColumns, probeJson } from './intake-text';
import { decodeDelimitedText } from './delimited-text';
import { AppError } from '../../../infrastructure/errors';
import { probeDbf, probeLas, probePdf, probeShapefile, probeTiff } from './intake-headers';
import { probeZip, type IntakeRangeReader } from './intake-zip';
import { probeParquet } from './intake-parquet';

export class IntakeProbeBudget extends Error {
  constructor() { super('INTAKE_PROBE_BUDGET'); }
}

export const INTAKE_PROBE_REASONS = Object.freeze(['encoding_unreadable', 'no_rows', 'line_too_long', 'not_delimited',
  'malformed_quotes', 'read_failed'] as const);
export type IntakeProbeReason = typeof INTAKE_PROBE_REASONS[number];

export class IntakeTableProbeError extends AppError {
  constructor(readonly reason: IntakeProbeReason) {
    super(422, 'TABULAR_HEADER_OR_READER', 'The table layout could not be read; the original is kept unchanged.');
  }
}

export const INTAKE_HEADER_CONFIRMATION = 'Header layout needs confirmation before rows are read.';

/** Only complete logical records participate; a quoted newline is part of its field, not a record boundary. */
function completeTableHead(text: string, whole: boolean): string {
  let quoted = false;
  let end = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '"') {
      if (quoted && text[at + 1] === '"') at++;
      else quoted = !quoted;
    }
    if (!quoted && (text[at] === '\n' || text[at] === '\r')) end = at + 1;
  }
  if (whole) return text;
  if (!end) throw new IntakeTableProbeError('line_too_long');
  return text.slice(0, end);
}

function tableSample(text: string, name: string) {
  const candidates = ([',', ';', '\t', '|'] as const).map(delimiter => {
    const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' });
    const header = parsed.data.findIndex(row => row.length >= 2);
    const width = header < 0 ? 0 : parsed.data[header].length;
    const records = parsed.data.filter(row => row.length >= 2).length;
    return { delimiter, parsed, header, width, records };
  });
  const tab = candidates[2];
  const preferTab = /\.tsv$/i.test(name) && tab.header === 0 && tab.width >= 2
    && tab.parsed.data.slice(0, 2).every(row => row.length === tab.width);
  candidates.sort((a, b) => b.records - a.records || b.width - a.width);
  const selected = preferTab ? tab : candidates[0];
  if (selected.header < 0) throw new IntakeTableProbeError('not_delimited');
  if (selected.parsed.errors.length) throw new IntakeTableProbeError('malformed_quotes');
  return selected;
}

function probeDelimited(card: IntakeCard, head: Uint8Array, size: number, name: string) {
  let decoded: ReturnType<typeof decodeDelimitedText>;
  try { decoded = decodeDelimitedText(head, head.length < size); }
  catch { throw new IntakeTableProbeError('encoding_unreadable'); }
  if (!decoded.text.trim()) throw new IntakeTableProbeError('no_rows');
  const text = completeTableHead(decoded.text, head.length === size);
  const { delimiter, parsed, header } = tableSample(text, name);
  const headers = parsed.data[header];
  const values = parsed.data.slice(header + 1, header + 1 + limits.sampleRecords);
  card.family = 'table';
  card.format = delimiter === '\t' ? 'tsv' : 'csv';
  card.depth = 'structure';
  card.encoding = decoded.encoding;
  card.delimiter = delimiter;
  card.counts.rows = head.length === size ? parsed.data.length - header - 1 : null;
  // Profile by position: duplicate literal headers must never overwrite each other's sampled cells.
  card.columns = headers.slice(0, limits.columns).flatMap((name, index) => {
    if (!name || name.length > 1024) return [];
    return intakeColumns(values.map(row => ({ [name]: row[index] })), [name]);
  });
  const nonstandard = header > 0 || /^\s*[\r\n]/.test(text)
    || headers.some(name => !name || name.length > 1024) || new Set(headers).size !== headers.length;
  if (nonstandard) card.limits.push(INTAKE_HEADER_CONFIRMATION);
  if (headers.some(name => !name || name.length > 1024)) {
    card.limits.push('Empty header cells and names above 1024 characters are not listed; no names were supplied.');
  }
  if (decoded.encodingBasis === 'fallback_windows_1252') {
    card.limits.push('Not valid UTF-8; read as Windows-1252 fallback, not a confirmed source encoding.');
  }
  card.drawableHint = card.columns.some(column => column.inferredType === 'number'
    && /^(?:lat(?:itude)?|lon(?:gitude)?|lng|easting|northing|x|y)$/i.test(column.name));
  card.limits.push('Bounded table sample; coordinate-like columns are a hint, not placement.');
  if (headers.length > limits.columns) card.limits.push('Column inventory stopped at 256 columns.');
}

export function intakeSizeClass(size: number): 'S' | 'M' | 'L' | 'XL' {
  if (size <= 16 * 1024 ** 2) return 'S';
  if (size <= 128 * 1024 ** 2) return 'M';
  if (size <= 7 * 1024 ** 3) return 'L';
  return 'XL';
}

export function intakeWave(card: IntakeMemberCard): 1 | 2 | 3 | 4 {
  if (card.family === 'vector' && card.geometryTypes.length) return 1;
  if (card.family === 'model3d' && card.crs.state === 'stated' && card.crs.code) return 1;
  if (card.family === 'raster' || card.family === 'point_cloud') return 2;
  if (card.family === 'table') return 3;
  return 4;
}

function initialCard(head: Uint8Array, name: string): IntakeCard {
  const { detectedBy, rootTypePending, ...detected } = detectIntakeKind(head, name);
  const sidecar = /\.(?:shx|prj|cpg|tfw|jgw|pgw|wld)$/i.test(name);
  const notes: string[] = [];
  if (rootTypePending) notes.push('Root type not yet seen; the complete collection and its coordinate system '
    + 'must be checked before anything is published.');
  if (sidecar) notes.push('Loose sidecar kept at signature depth; same-stem .shx, .prj and .cpg join a batch '
    + 'shapefile set when its .shp, .shx and .dbf are present without duplicate parts; otherwise they wait or stay '
    + 'separate, and loose world files stay separate.');
  if (detected.format === 'shapefile' && /\.shx$/i.test(name)) detected.format = 'shapefile-index';
  return { version: INTAKE_CARD_VERSION, ...detected, formatVersion: null,
    detectedBy: detected.format === 'shapefile-index' ? 'bytes_and_name' : detectedBy,
    nameDisagrees: intakeNameDisagrees(detected.format, name, detected.family), depth: 'signature', encoding: null,
    crs: { state: 'absent', code: null, sidecarSha256: null }, extent: { native: null, epsg4326: null },
    counts: { features: null, rows: null, pages: null, members: null, points: null, bands: null },
    geometryTypes: [], layers: [], sheets: [], members: [], columns: [],
    limits: notes,
    probeBytesRead: 0, probeMs: 0, drawableHint: false, delimiter: null, encrypted: null,
    raster: null, point: null, citations: [] };
}

function probeHead(card: IntakeCard, head: Uint8Array, size: number, tail: Uint8Array = new Uint8Array(), name = '') {
  if (['geojson', 'geojson-seq', 'ndjson'].includes(card.format)) probeJson(card, head, size);
  if (card.format === 'csv' || card.format === 'tsv'
    || card.format === 'unknown' && /\.(?:csv|tsv)$/i.test(name)) {
    if (card.format === 'unknown') card.detectedBy = 'bytes_and_name';
    probeDelimited(card, head, size, name);
  }
  if (card.format === 'shapefile') probeShapefile(card, head);
  if (card.format === 'dbf') probeDbf(card, head);
  if (card.format === 'pdf') probePdf(card, head, tail);
  if (card.format === 'las' || card.format === 'laz') probeLas(card, head);
  if (card.format === 'tiff') probeTiff(card, head, tail, size);
  if (card.format === 'parquet') probeParquet(card, tail);
  if (card.format === 'glb' && head.length >= 8) card.formatVersion = String(Buffer.from(head).readUInt32LE(4));
  if (card.format === 'gzip') card.limits.push(INTAKE_GZIP_WORDS);
  else if (card.format === 'xls') card.limits.push(`Excel 97-2003 workbook. ${INTAKE_LEGACY_WORKBOOK_WORDS}`);
  else if (card.depth === 'signature' && card.format !== 'zip') {
    card.limits.push('Signature only; deeper structure requires the existing native reader.');
  }
}

function boundedReader(read: IntakeRangeReader, size: number, deadlineAt: number) {
  let bytesRead = 0;
  const bounded: IntakeRangeReader = async (start, end) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > size || end < start) {
      throw new Error('INTAKE_RANGE_INVALID');
    }
    if (end - start > limits.directoryBytes) throw new Error('INTAKE_RANGE_LIMIT');
    if (performance.now() >= deadlineAt) throw new IntakeProbeBudget();
    if (end === start) return new Uint8Array();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        const remaining = Math.max(1, deadlineAt - performance.now());
        timer = setTimeout(() => reject(new IntakeProbeBudget()), remaining);
      });
      const bytes = await Promise.race([read(start, end), timeout]);
      if (bytes.length !== end - start) throw new Error('INTAKE_RANGE_LENGTH');
      bytesRead += bytes.length;
      return bytes;
    } finally { clearTimeout(timer); }
  };
  return { read: bounded, bytes: () => bytesRead };
}

/** Bounded original metadata only; no reader/job, extraction, provider or persistence. End is exclusive. */
export async function probeOriginal(read: IntakeRangeReader, size: number, name: string): Promise<IntakeCard> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('INTAKE_SIZE_INVALID');
  const started = performance.now();
  const bounded = boundedReader(read, size, started + limits.budgetMs);
  const head = await bounded.read(0, Math.min(size, limits.headBytes));
  const tailStart = Math.max(head.length, size - limits.tailBytes);
  const tail = size > head.length ? await bounded.read(tailStart, size) : head;
  const card = initialCard(head, name);
  probeHead(card, head, size, tail, name);
  if (card.format === 'zip') {
    await probeZip(card, bounded.read, size, tail, async (memberHead, memberSize, memberName) => {
      const child = initialCard(memberHead, memberName);
      // Empty members keep the archive's existing empty-member refusal, not a table parser refusal.
      if (memberSize > 0) probeHead(child, memberHead, memberSize,
        memberHead.length === memberSize ? memberHead : new Uint8Array(), memberName);
      if (child.format === 'zip') {
        child.limits.push('Nested archive retained; its directory requires a child original.');
      }
      return child;
    });
  }
  if (performance.now() >= started + limits.budgetMs) throw new IntakeProbeBudget();
  if (card.format === 'unknown' && /\.(?:gdb|gdbtable|gdbtablx)$/i.test(name)) {
    card.limits.push('File Geodatabase needs grouped directory components; no reliable single-head kind established.');
  }
  card.nameDisagrees = intakeNameDisagrees(card.format, name, card.family);
  card.probeBytesRead = bounded.bytes();
  card.probeMs = Math.round((performance.now() - started) * 1000) / 1000;
  return IntakeCardSchema.parse(card);
}
