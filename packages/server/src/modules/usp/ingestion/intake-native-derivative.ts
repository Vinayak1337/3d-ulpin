import type { PoolClient } from 'pg';
import { z } from 'zod';
import { STREAMING_VECTOR_LIMITS, type IntakeCard } from '@ulpin/contracts/usp';
import type { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import type { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { listWords, nativeDerivativeFormat } from './intake-draft';
import { writeIntakeDraftTx, type IntakeDraftState } from './intake-ledger';
import { stableUuid } from './intake-run';
import { byteParts, fenced, receiveLargeLayer, type ZipLayerDependencies } from './intake-zip-layers';

/**
 * SH2. A GeoPackage, or a ZIP its card names a shapefile set in, is converted by the native reader, window by
 * window, into one GeoJSON derivative per layer. Each derivative is retained as its own large original that names
 * the original it came from, and enrolled like any dropped file, so the large GeoJSON path reads it unchanged.
 */
export const NATIVE_DERIVATIVE_CONVERSION = 'native_gis_to_geojson@1';
const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeNativeDerivativeInputSchema = z.strictObject({
  version: z.literal('intake-native-derivative/1'), jobId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), itemId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hex64, sourcePin: hex64,
  subject: z.string().min(1).max(256), accessSha256: hex64,
});
export type IntakeNativeDerivativeInput = z.infer<typeof IntakeNativeDerivativeInputSchema>;

const stored = z.strictObject({
  objectKey: z.string().regex(/^native-derivatives\/[a-f0-9]{64}\/\d+\/[a-z]+-[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(STREAMING_VECTOR_LIMITS.sourceBytes), sha256: hex64 });
const layerName = z.string().min(1).max(256);
const ConvertedLayerSchema = z.strictObject({ layer: layerName, ordinal: z.number().int().nonnegative(),
  state: z.literal('converted'), crs: z.string().regex(/^EPSG:\d{1,9}$/), features: z.number().int().nonnegative(),
  notWritten: z.number().int().nonnegative(), geojson: stored, sidecar: stored });
const StoppedLayerSchema = z.strictObject({ layer: layerName, ordinal: z.number().int().nonnegative(),
  state: z.enum(['not_converted', 'crs_unstated']), reason: z.string().min(1).max(300) });
export const NativeConversionSchema = z.strictObject({
  conversion: z.literal(NATIVE_DERIVATIVE_CONVERSION), readerVersion: z.string().min(1).max(64), sourceId: uuid,
  sourceSha256: hex64, layers: z.array(z.discriminatedUnion('state', [ConvertedLayerSchema, StoppedLayerSchema]))
    .min(1).max(100),
});
export type NativeConversion = z.infer<typeof NativeConversionSchema>;
type ConvertedLayer = z.infer<typeof ConvertedLayerSchema>;
type StoppedLayer = z.infer<typeof StoppedLayerSchema>;

/** The lineage a derivative child keeps beside its receipt: its original, layer, conversion and locator sidecar. */
export const NativeDerivativeLineageSchema = z.strictObject({
  version: z.literal('native-derivative/1'), conversion: z.literal(NATIVE_DERIVATIVE_CONVERSION),
  readerVersion: z.string().min(1).max(64), originalSourceId: uuid, originalSourceRevision: z.number().int().positive(),
  originalSha256: hex64, originalItemId: uuid, format: z.enum(['gpkg', 'shapefile_zip']), layer: layerName,
  ordinal: z.number().int().nonnegative(), crs: z.string(), features: z.number().int().nonnegative(),
  notWritten: z.number().int().nonnegative(), sidecar: stored,
});

const kind = (format: 'gpkg' | 'shapefile_zip') => format === 'gpkg' ? 'GeoPackage' : 'shapefile ZIP';

/**
 * Publishing the card queues one fenced conversion job in the publishing transaction. None is queued while one
 * waits or runs, or once one finished; a failed job is queued again by enrolling the file again.
 */
export async function queueNativeDerivativeTx(client: PoolClient, source: IntakeSourceRow,
  card: IntakeCard): Promise<string | null> {
  const format = nativeDerivativeFormat(card);
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL
    FOR UPDATE`, [source.id])).rows[0];
  if (!format || !item) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`intake-native-derivative:${item.item_id}`]);
  const jobs = (await client.query(`SELECT id,status FROM jobs WHERE source_id=$1
    AND operation='intake-native-derivative' ORDER BY created_at`, [source.id])).rows;
  const open = jobs.find(job => ['queued', 'running', 'completed'].includes(job.status));
  if (open) return open.status === 'completed' ? null : open.id;
  const scope = await intakeCaseTx(client, source.case_id);
  const input = IntakeNativeDerivativeInputSchema.parse({ version: 'intake-native-derivative/1',
    jobId: stableUuid(`intake-native-derivative/1:${item.item_id}:${source.revision}:${jobs.length + 1}`),
    caseId: source.case_id, caseRevision: scope.current.revision, itemId: item.item_id, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-native-derivative',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'reading', placement: 'undecided',
    planRef: null, recordsSeen: 0, limitReason: `The layers of this ${kind(format)} are being converted to GeoJSON, `
      + 'each to be taken in as its own file.' });
  return input.jobId;
}

export type NativeDerivativeDependencies = Pick<ZipLayerDependencies, 'transaction' | 'large' | 'register'> & {
  read: typeof readObjectRange;
  convert: (request: { sourceId: string; objectKey: string; sha256: string; bytes: number;
    format: 'gpkg' | 'shapefile_zip' }) => Promise<unknown>;
};

type Outcome = { layer: string; sourceId: string | null; code: string | null };

/** Officer words name each layer and what became of it; a layer with no stated system asks the officer. */
export function nativeParentState(format: 'gpkg' | 'shapefile_zip', conversion: NativeConversion,
  outcomes: Outcome[]): IntakeDraftState {
  const taken = outcomes.filter(outcome => outcome.sourceId && !outcome.code).map(outcome => outcome.layer);
  const failed = outcomes.filter(outcome => outcome.code)
    .map(outcome => `${outcome.layer} (${outcome.code}; enrol the file again to retry)`);
  const stopped = (state: StoppedLayer['state']) => conversion.layers
    .filter((layer): layer is StoppedLayer => layer.state === state).map(layer => `${layer.layer} (${layer.reason})`);
  const unstated = stopped('crs_unstated'), refused = stopped('not_converted');
  const sentences = [];
  if (taken.length) sentences.push(`${taken.length === 1 ? '1 layer' : `${taken.length} layers`} of this `
    + `${kind(format)} ${taken.length === 1 ? 'is' : 'are'} converted to GeoJSON and taken in as `
    + `${taken.length === 1 ? 'its own file' : 'their own files'}: ${listWords(taken, 500)}.`);
  if (unstated.length) sentences.push(`Not converted until its coordinate reference system is stated: `
    + `${listWords(unstated, 500)}.`);
  if (refused.length) sentences.push(`Not converted: ${listWords(refused, 450)}.`);
  if (failed.length) sentences.push(`Converted but not taken in: ${listWords(failed, 400)}.`);
  const placement = unstated.length ? 'needs_answer' : taken.length || failed.length ? 'undecided' : 'not_understood';
  return { state: 'read', placement, planRef: null, recordsSeen: 0, limitReason: sentences.join(' ') };
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && /^ZIP_[A-Z_]{1,60}$/.test(error.message)) return error.message;
  return 'NATIVE_DERIVATIVE_UNAVAILABLE';
}

/**
 * Converts the item's original, retains each converted layer's GeoJSON as a large-original child named by its
 * lineage (one already kept by an earlier attempt is reused), enrols every child, then writes the item's words.
 */
export async function convertNativeLayers(caseValue: string, itemValue: string,
  dependencies: NativeDerivativeDependencies): Promise<string[]> {
  const caseId = uuid.parse(caseValue), itemId = uuid.parse(itemValue);
  const scope = await dependencies.transaction(async client => {
    const item = (await client.query(`SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
      AND parent_item_id IS NULL`, [caseId, itemId])).rows[0];
    const format = nativeDerivativeFormat(item?.card ?? null);
    if (!item?.source_id || !format) return null;
    return { format, source: (await intakeSourceTx(client, caseId, item.source_id)).source };
  });
  if (!scope) return [];
  const { format, source } = scope;
  const conversion = NativeConversionSchema.parse(await dependencies.convert({ sourceId: source.id,
    objectKey: source.object_key, sha256: source.sha256, bytes: Number(source.bytes), format }));
  if (conversion.sourceId !== source.id || conversion.sourceSha256 !== source.sha256)
    throw new AppError(422, 'NATIVE_DERIVATIVE_PINS', 'The conversion names a different original.');
  const outcomes: Outcome[] = [];
  for (const layer of conversion.layers) {
    if (layer.state !== 'converted') continue;
    const lineage = NativeDerivativeLineageSchema.parse({ version: 'native-derivative/1',
      conversion: conversion.conversion, readerVersion: conversion.readerVersion, originalSourceId: source.id,
      originalSourceRevision: source.revision, originalSha256: source.sha256, originalItemId: itemId, format,
      layer: layer.layer, ordinal: layer.ordinal, crs: layer.crs, features: layer.features,
      notWritten: layer.notWritten, sidecar: layer.sidecar });
    try {
      outcomes.push({ layer: layer.layer, sourceId: await keepDerivative(caseId, layer, lineage, dependencies),
        code: null });
    } catch (error) {
      outcomes.push({ layer: layer.layer, sourceId: null, code: failureCode(error) });
    }
  }
  for (const outcome of outcomes.filter(entry => entry.sourceId)) {
    try {
      await dependencies.register(caseId, { sourceId: outcome.sourceId,
        requestKey: stableUuid(`native-derivative/1:${itemId}:${outcome.layer}:${outcome.sourceId}`) });
    } catch (error) {
      // The child stays kept and named; enrolling the original again enrols it.
      outcome.code = failureCode(error);
    }
  }
  await dependencies.transaction(client => writeIntakeDraftTx(client, caseId, itemId,
    nativeParentState(format, conversion, outcomes)));
  return outcomes.flatMap(outcome => outcome.sourceId ? [outcome.sourceId] : []);
}

/** A replay finds the child an earlier attempt kept by its lineage and hash, so nothing is retained twice. */
async function keptChildTx(client: PoolClient, caseId: string, layer: ConvertedLayer,
  lineage: z.infer<typeof NativeDerivativeLineageSchema>): Promise<string | null> {
  return (await client.query(`SELECT id FROM sources WHERE case_id=$1 AND profile='large-original-v1' AND sha256=$2
    AND inspection->'nativeDerivative'->>'originalSha256'=$3 AND inspection->'nativeDerivative'->>'layer'=$4
    ORDER BY revision DESC LIMIT 1`, [caseId, layer.geojson.sha256, lineage.originalSha256, layer.layer]))
    .rows[0]?.id ?? null;
}

async function keepDerivative(caseId: string, layer: ConvertedLayer,
  lineage: z.infer<typeof NativeDerivativeLineageSchema>, dependencies: NativeDerivativeDependencies) {
  const prior = await dependencies.transaction(client => keptChildTx(client, caseId, layer, lineage));
  if (prior) return prior;
  const deadline = Date.now() + STREAMING_VECTOR_LIMITS.readMs;
  const signal = AbortSignal.timeout(STREAMING_VECTOR_LIMITS.readMs);
  const { objectKey, bytes, sha256 } = layer.geojson;
  async function* ranges() {
    for (let start = 0; start < bytes; start += 1024 * 1024) {
      yield await dependencies.read(objectKey, start, Math.min(bytes, start + 1024 * 1024), bytes, deadline, signal);
    }
  }
  const file = { name: `${layer.layer}.geojson`, bytes, sha256 };
  // The receipt hashes the parts again and refuses bytes that differ from the conversion's own hash.
  const sourceId = await fenced(caseId, dependencies, revision =>
    receiveLargeLayer(caseId, revision, file, byteParts(ranges()), dependencies));
  await dependencies.transaction(client => client.query(`UPDATE sources
    SET inspection=inspection||jsonb_build_object('nativeDerivative',$2::jsonb)
    WHERE id=$1 AND profile='large-original-v1'`, [sourceId, lineage]));
  return sourceId;
}
