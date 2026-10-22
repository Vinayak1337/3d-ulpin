import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { INTAKE_OMISSION_LIMITS, IntakeNativeOmissionsSchema, IntakeOmissionSchema, streamingReadMs,
  type IntakeCard, type IntakeNativeOmissions } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import type { readObjectRange } from '../../../infrastructure/storage';
import type { IntakeSourceRow } from './intake-context';
import { nativeDerivativeFormat } from './intake-draft';
import { NativeDerivativeLineageSchema } from './intake-native-derivative';

/**
 * NO1. What a native conversion left out, per converted layer: read from the locator file each layer's GeoJSON
 * derivative keeps beside it (`native-gis-locators/1`: a header line, then one line per row of the original,
 * `{feature:n, position}` when written and `{feature:null, position, reason}` when not). Only the original item's
 * authority is used; the locator file's key comes from the derivative's stored lineage, never from the request.
 * Read-only: nothing is placed, confirmed or recorded.
 */
type Lineage = z.infer<typeof NativeDerivativeLineageSchema>;
type Layer = IntakeNativeOmissions['layers'][number];
type Omission = z.infer<typeof IntakeOmissionSchema>;
const RANGE = 1024 * 1024;

const HeaderSchema = z.looseObject({ version: z.literal('native-gis-locators/1'),
  originalSha256: z.string(), layer: z.string(), positionKind: z.string().max(100).optional() });
const LineSchema = z.union([
  z.strictObject({ feature: z.number().int().nonnegative(), position: IntakeOmissionSchema.shape.position }),
  z.strictObject({ feature: z.null(), position: IntakeOmissionSchema.shape.position,
    reason: IntakeOmissionSchema.shape.reason }),
]);

/** The formats whose layers are converted into GeoJSON derivatives with a locator file. */
export function omissionFormat(card: IntakeCard | null, name: string): boolean {
  return card?.format === 'cityjson' || card?.format === 'citygml' || nativeDerivativeFormat(card, name) !== null;
}

/**
 * Each converted layer's derivative of this original revision, one per layer (the newest kept), in layer order.
 * A derivative whose stored lineage does not parse is not listed.
 */
export async function omissionLayersTx(client: PoolClient, caseId: string, itemId: string,
  source: IntakeSourceRow): Promise<{ sourceId: string; lineage: Lineage }[]> {
  const rows = (await client.query(`SELECT DISTINCT ON (inspection->'nativeDerivative'->>'layer') id,
    inspection->'nativeDerivative' lineage FROM sources WHERE case_id=$1 AND profile='large-original-v1'
    AND inspection->'nativeDerivative'->>'originalItemId'=$2 AND inspection->'nativeDerivative'->>'originalSourceId'=$3
    AND inspection->'nativeDerivative'->>'originalSha256'=$4
    ORDER BY inspection->'nativeDerivative'->>'layer',created_at DESC,id`,
  [caseId, itemId, source.id, source.sha256])).rows;
  return rows.flatMap(row => {
    const lineage = NativeDerivativeLineageSchema.safeParse(row.lineage);
    return lineage.success && lineage.data.originalSourceRevision === source.revision
      ? [{ sourceId: row.id as string, lineage: lineage.data }] : [];
  }).sort((a, b) => a.lineage.ordinal - b.lineage.ordinal).slice(0, INTAKE_OMISSION_LIMITS.layers);
}

const integrity = (layer: string, why: string) => new AppError(409, 'INTAKE_OMISSIONS_INTEGRITY',
  `The locator file kept for layer ${layer} ${why}.`);

/** Reads one locator file's first `budget` bytes in bounded ranges, the whole file when it fits. */
async function locatorBytes(lineage: Lineage, budget: number, read: typeof readObjectRange,
  deadline: number, signal: AbortSignal) {
  const { objectKey, bytes } = lineage.sidecar;
  const end = Math.min(bytes, budget);
  const parts: Uint8Array[] = [];
  for (let start = 0; start < end; start += RANGE) {
    parts.push(await read(objectKey, start, Math.min(end, start + RANGE), bytes, deadline, signal));
  }
  return Buffer.concat(parts);
}

/** The layer's omissions from the bytes read; a partial read keeps complete lines only, none without its header. */
function listLayer(lineage: Lineage, sourceId: string, raw: Buffer, whole: boolean): Layer | null {
  const text = raw.toString('utf8');
  const lines = (whole ? text : text.slice(0, text.lastIndexOf('\n') + 1)).split('\n').filter(Boolean);
  if (!whole && !lines.length) return null;
  let header: z.infer<typeof HeaderSchema>;
  try { header = HeaderSchema.parse(JSON.parse(lines[0] ?? '')); }
  catch { throw integrity(lineage.layer, 'does not start with its locator header'); }
  if (header.originalSha256 !== lineage.originalSha256 || header.layer !== lineage.layer) {
    throw integrity(lineage.layer, 'names another original or layer');
  }
  const listed: Omission[] = [];
  let written = 0, notWritten = 0;
  for (const line of lines.slice(1)) {
    let row: z.infer<typeof LineSchema>;
    try { row = LineSchema.parse(JSON.parse(line)); }
    catch { throw integrity(lineage.layer, 'holds a line that is not a locator'); }
    if (row.feature !== null) { written++; continue; }
    notWritten++;
    if (listed.length < INTAKE_OMISSION_LIMITS.perLayer) listed.push({ position: row.position, reason: row.reason });
  }
  if (whole && (written !== lineage.features || notWritten !== lineage.notWritten)) {
    throw integrity(lineage.layer, 'counts other features than its derivative states');
  }
  return { layer: lineage.layer, ordinal: lineage.ordinal, derivativeSourceId: sourceId,
    positionKind: header.positionKind ?? null, written: lineage.features, notWritten: lineage.notWritten, listed,
    scan: whole ? 'whole' : 'partial', sidecarSha256: lineage.sidecar.sha256 };
}

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** One sentence per state the officer needs to know; a partial or unread layer says why. */
export function omissionWords(layers: Layer[]): string {
  if (!layers.length) return 'No converted layer of this file is kept yet, so nothing is listed as left out.';
  const left = layers.filter(layer => layer.notWritten);
  if (!left.length) return `Every feature of ${plural(layers.length, 'converted layer')} was written; `
    + 'none was left out.';
  const words = [`${plural(left.reduce((sum, layer) => sum + layer.notWritten, 0), 'feature')} of `
    + `${plural(left.length, 'layer')} were not written. Each stays in the original at the position listed, `
    + `with the converter's reason; at most ${INTAKE_OMISSION_LIMITS.perLayer} are listed per layer.`];
  if (left.some(layer => layer.scan === 'partial')) words.push('A long locator file was read only in part, so '
    + 'its list is not checked against the file\'s SHA-256.');
  if (left.some(layer => layer.scan === 'not_read')) words.push('Some layers were not read in this request, as '
    + `at most ${INTAKE_OMISSION_LIMITS.scanBytes / RANGE} MiB of locator files are read at once; only their `
    + 'counts are shown.');
  words.push('These are candidates from the converter; nothing here is placed, confirmed or recorded.');
  return words.join(' ');
}

/**
 * Lists each converted layer's omissions within the request's byte budget. A layer with none is not read; a file
 * that fits is read whole and checked against its kept SHA-256 and counts; the rest are read in part or not at all.
 */
export async function readOmissions(scope: { caseId: string; itemId: string; source: IntakeSourceRow;
  layers: { sourceId: string; lineage: Lineage }[] }, read: typeof readObjectRange,
  scanBytes: number = INTAKE_OMISSION_LIMITS.scanBytes): Promise<IntakeNativeOmissions> {
  const deadline = Date.now() + streamingReadMs(scanBytes);
  const signal = AbortSignal.timeout(streamingReadMs(scanBytes));
  let budget = scanBytes;
  const layers: Layer[] = [];
  for (const { sourceId, lineage } of scope.layers) {
    const counts = { layer: lineage.layer, ordinal: lineage.ordinal, derivativeSourceId: sourceId,
      positionKind: null, written: lineage.features, notWritten: lineage.notWritten, listed: [],
      sidecarSha256: lineage.sidecar.sha256 };
    if (!lineage.notWritten) { layers.push({ ...counts, scan: 'none_left_out' }); continue; }
    if (!budget) { layers.push({ ...counts, scan: 'not_read' }); continue; }
    const whole = lineage.sidecar.bytes <= budget;
    const raw = await locatorBytes(lineage, budget, read, deadline, signal);
    budget -= raw.length;
    if (whole && createHash('sha256').update(raw).digest('hex') !== lineage.sidecar.sha256) {
      throw integrity(lineage.layer, 'differs from its kept SHA-256');
    }
    layers.push(listLayer(lineage, sourceId, raw, whole) ?? { ...counts, scan: 'not_read' });
  }
  return IntakeNativeOmissionsSchema.parse({ version: 'intake-native-omissions/1', caseId: scope.caseId,
    itemId: scope.itemId, sourceId: scope.source.id, sourceRevision: scope.source.revision,
    sourceSha256: scope.source.sha256, layers, words: omissionWords(layers) });
}
