import { performance } from 'node:perf_hooks';
import { INTAKE_CARD_VERSION, INTAKE_LEGACY_WORKBOOK_WORDS, INTAKE_PROBE_LIMITS as limits, IntakeCardSchema,
  type IntakeCard, type IntakeMemberCard } from '@ulpin/contracts/usp';
import { detectIntakeKind, intakeNameDisagrees } from './intake-signatures';
import { probeDelimited, probeJson } from './intake-text';
import { probeDbf, probeLas, probePdf, probeShapefile, probeTiff } from './intake-headers';
import { probeZip, type IntakeRangeReader } from './intake-zip';
import { probeParquet } from './intake-parquet';

export class IntakeProbeBudget extends Error {
  constructor() { super('INTAKE_PROBE_BUDGET'); }
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
  if (sidecar) notes.push('Loose sidecar kept at signature depth; grouping separate sources is out of scope.');
  if (detected.format === 'shapefile' && /\.shx$/i.test(name)) detected.format = 'shapefile-index';
  return { version: INTAKE_CARD_VERSION, ...detected, formatVersion: null,
    detectedBy: detected.format === 'shapefile-index' ? 'bytes_and_name' : detectedBy,
    nameDisagrees: intakeNameDisagrees(detected.format, name), depth: 'signature', encoding: null,
    crs: { state: 'absent', code: null, sidecarSha256: null }, extent: { native: null, epsg4326: null },
    counts: { features: null, rows: null, pages: null, members: null, points: null, bands: null },
    geometryTypes: [], layers: [], sheets: [], members: [], columns: [],
    limits: notes,
    probeBytesRead: 0, probeMs: 0, drawableHint: false, delimiter: null, encrypted: null,
    raster: null, point: null, citations: [] };
}

function probeHead(card: IntakeCard, head: Uint8Array, size: number, tail: Uint8Array = new Uint8Array(), name = '') {
  if (['geojson', 'geojson-seq', 'ndjson'].includes(card.format)) probeJson(card, head, size);
  if (card.format === 'csv' || card.format === 'tsv') probeDelimited(card, head, name);
  if (card.format === 'shapefile') probeShapefile(card, head);
  if (card.format === 'dbf') probeDbf(card, head);
  if (card.format === 'pdf') probePdf(card, head, tail);
  if (card.format === 'las' || card.format === 'laz') probeLas(card, head);
  if (card.format === 'tiff') probeTiff(card, head, tail, size);
  if (card.format === 'parquet') probeParquet(card, tail);
  if (card.format === 'glb' && head.length >= 8) card.formatVersion = String(Buffer.from(head).readUInt32LE(4));
  if (card.format === 'xls') card.limits.push(`Excel 97-2003 workbook. ${INTAKE_LEGACY_WORKBOOK_WORDS}`);
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
      probeHead(child, memberHead, memberSize, memberHead.length === memberSize ? memberHead : new Uint8Array(),
        memberName);
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
  card.nameDisagrees = intakeNameDisagrees(card.format, name);
  card.probeBytesRead = bounded.bytes();
  card.probeMs = Math.round((performance.now() - started) * 1000) / 1000;
  return IntakeCardSchema.parse(card);
}
