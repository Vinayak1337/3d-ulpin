import type { PoolClient } from 'pg';
import { z } from 'zod';
import { STREAMING_VECTOR_LIMITS, streamingReadMs, type IntakeCard } from '@ulpin/contracts/usp';
import type { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import type { readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { listWords, nativeDerivativeFormat } from './intake-draft';
import { nativeLayersRef, readIntakeDraftTx, writeIntakeDraftTx, type IntakeDraftState,
  type NativeLayersRef } from './intake-ledger';
import { stableUuid } from './intake-run';
import { byteParts, fenced, receiveLargeLayer, type ZipLayerDependencies } from './intake-zip-layers';
import { uploadSlotWait, uploadSlotVersion, waitForUploadSlot } from './large-original';

/**
 * SH2. A GeoPackage, or a ZIP its card names a shapefile set in, is converted by the native reader, window by
 * window, into one GeoJSON derivative per layer. Each derivative is retained as its own large original that names
 * the original it came from, and enrolled like any dropped file, so the large GeoJSON path reads it unchanged.
 * KML1: a KML or KMZ takes the same path, one layer per Document or Folder holding Placemarks.
 * N05: a shapefile dropped as loose parts takes it too, its .shp item the parent of every part of its stem.
 */
export const NATIVE_DERIVATIVE_CONVERSION = 'native_gis_to_geojson@1';
const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const SET_PARTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'] as const;
type SetExtension = typeof SET_PARTS[number];
// N05: each part of a loose shapefile set, pinned by its own retained original; present only for `shapefile_set`.
const SetMembersSchema = z.array(z.strictObject({ sourceId: uuid, sourceRevision: z.number().int().positive(),
  sha256: hex64, extension: z.enum(SET_PARTS) })).min(3).max(SET_PARTS.length);
type SetMember = z.infer<typeof SetMembersSchema>[number];
export const IntakeNativeDerivativeInputSchema = z.strictObject({
  version: z.literal('intake-native-derivative/1'), jobId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), itemId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hex64, sourcePin: hex64,
  subject: z.string().min(1).max(256), accessSha256: hex64, members: SetMembersSchema.optional(),
});
export type IntakeNativeDerivativeInput = z.infer<typeof IntakeNativeDerivativeInputSchema>;

const stored = z.strictObject({
  objectKey: z.string().regex(/^native-derivatives\/[a-f0-9]{64}\/\d+\/[a-z]+-[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(STREAMING_VECTOR_LIMITS.sourceBytes), sha256: hex64 });
const layerName = z.string().min(1).max(256);
// CR1: a system the file states, or the code an officer stated for a layer whose file states none.
const crsSource = z.enum(['stated', 'officer_stated']);
// KML1: the words saying where a stated system comes from when the format, not the file, states it.
// A compound AdV reference includes its cited horizontal basis and the unconverted vertical reference.
const crsBasis = z.string().min(1).max(1000).optional();
const ConvertedLayerSchema = z.strictObject({ layer: layerName, ordinal: z.number().int().nonnegative(),
  state: z.literal('converted'), crs: z.string().regex(/^EPSG:\d{1,9}$/), crsSource, crsBasis,
  features: z.number().int().nonnegative(), notWritten: z.number().int().nonnegative(), geojson: stored,
  sidecar: stored });
const reason = z.string().min(1).max(300);
const StoppedLayerSchema = z.strictObject({ layer: layerName, ordinal: z.number().int().nonnegative(),
  state: z.literal('not_converted'), reason });
// `statesCrs`: the file states a system that does not resolve; only a layer stating none takes an officer answer.
const UnstatedLayerSchema = z.strictObject({ layer: layerName, ordinal: z.number().int().nonnegative(),
  state: z.literal('crs_unstated'), statesCrs: z.boolean(), reason });
export const NativeConversionSchema = z.strictObject({
  conversion: z.literal(NATIVE_DERIVATIVE_CONVERSION), readerVersion: z.string().min(1).max(64), sourceId: uuid,
  sourceSha256: hex64, layers: z.array(z.discriminatedUnion('state',
    [ConvertedLayerSchema, StoppedLayerSchema, UnstatedLayerSchema])).min(1).max(100),
  // KML1: how many of each element the original keeps that the reader neither fetches nor reads.
  notRead: z.partialRecord(z.enum(['NetworkLink', 'GroundOverlay', 'PhotoOverlay', 'ScreenOverlay']),
    z.number().int().positive()).optional(),
});
export type NativeConversion = z.infer<typeof NativeConversionSchema>;
type ConvertedLayer = z.infer<typeof ConvertedLayerSchema>;
type StoppedLayer = z.infer<typeof StoppedLayerSchema> | z.infer<typeof UnstatedLayerSchema>;

/** The lineage a derivative child keeps beside its receipt: its original, layer, conversion and locator sidecar. */
export const NativeDerivativeLineageSchema = z.strictObject({
  version: z.literal('native-derivative/1'), conversion: z.literal(NATIVE_DERIVATIVE_CONVERSION),
  readerVersion: z.string().min(1).max(64), originalSourceId: uuid, originalSourceRevision: z.number().int().positive(),
  originalSha256: hex64, originalItemId: uuid,
  format: z.enum(['gpkg', 'shapefile_zip', 'shapefile_set', 'kml', 'kmz', 'cityjson', 'citygml', 'geoparquet']),
  layer: layerName, ordinal: z.number().int().nonnegative(), crs: z.string(), crsSource, crsBasis,
  features: z.number().int().nonnegative(), notWritten: z.number().int().nonnegative(), sidecar: stored,
  members: SetMembersSchema.optional(),
}).refine(lineage => (lineage.format === 'shapefile_set') === Boolean(lineage.members),
  'Only a shapefile set names its members, and it names every one.');
export type NativeDerivativeLineage = z.infer<typeof NativeDerivativeLineageSchema>;

/** The existing GIS conversions and each 3D format's own building ground outlines. */
function derivativeFormat(card: IntakeCard | null, name: string):
  ReturnType<typeof nativeDerivativeFormat> | 'cityjson' | 'citygml' {
  if (card?.format === 'cityjson' || card?.format === 'citygml') return card.format;
  return nativeDerivativeFormat(card, name);
}

type NativeFormat = NonNullable<ReturnType<typeof derivativeFormat>>;
const kinds: Record<NativeFormat, string> = { gpkg: 'GeoPackage', shapefile_zip: 'shapefile ZIP',
  shapefile_set: 'shapefile', kml: 'KML', kmz: 'KMZ', cityjson: 'CityJSON', citygml: 'CityGML',
  geoparquet: 'GeoParquet' };
const kind = (format: NativeFormat) => kinds[format];

/** The native reading the outlines are converted after stays cited beside its item. */
function withReading(planRef: Record<string, unknown> | null, stored: unknown): Record<string, unknown> | null {
  const jobId = (stored as { nativeReaderJobId?: unknown } | null)?.nativeReaderJobId;
  return typeof jobId === 'string' ? { ...planRef, nativeReaderJobId: jobId } : planRef;
}

type SetPart = { item_id: string; card: IntakeCard; plan_ref: Record<string, unknown> | null; source_id: string;
  name: string; revision: number; sha256: string; object_key: string; bytes: string | number;
  extension: SetExtension };
// The card each part's bytes must carry for its name to be believed; a .prj or .cpg is text of any kind.
const partFormats: Partial<Record<SetExtension, string>> = { shp: 'shapefile', shx: 'shapefile-index', dbf: 'dbf' };
const REQUIRED: SetExtension[] = ['shp', 'shx', 'dbf'];

/** N05. A part's stem (its name, folder path kept, without the extension) and extension; null for any other file. */
function partName(name: string): { stem: string; extension: SetExtension } | null {
  const match = /^(.+)\.([^./\\]+)$/.exec(name);
  const extension = match?.[2].toLowerCase() as SetExtension | undefined;
  return match && extension && SET_PARTS.includes(extension) ? { stem: match[1], extension } : null;
}

const fileName = (name: string) => name.split(/[/\\]/).pop()!;

/**
 * N05. The batch's live parts of one stem, compared without case: root items of the case with a card, each the
 * latest revision of its original, whose bytes agree with their name. In extension order.
 */
async function stemPartsTx(client: PoolClient, caseId: string, stem: string): Promise<SetPart[]> {
  const rows = (await client.query(`SELECT i.item_id,i.card,i.plan_ref,s.id source_id,s.name,s.revision,s.sha256,
    s.object_key,s.bytes FROM usp_intake_items i JOIN sources s ON s.id=i.source_id
    WHERE i.case_id=$1 AND i.parent_item_id IS NULL AND i.card IS NOT NULL AND lower(s.name)=ANY($2::text[])
    AND s.revision=(SELECT max(f.revision) FROM sources f WHERE f.case_id=s.case_id AND f.family_id=s.family_id)
    ORDER BY s.name,i.item_id`, [caseId, SET_PARTS.map(extension => `${stem}.${extension}`.toLowerCase())])).rows;
  return rows.flatMap(row => {
    const extension = partName(row.name)!.extension;
    const format = partFormats[extension];
    return !format || row.card.format === format ? [{ ...row, extension }] : [];
  }).sort((a, b) => SET_PARTS.indexOf(a.extension) - SET_PARTS.indexOf(b.extension));
}

/** The extensions a stem holds more than one of, and the required ones it lacks. */
function setGaps(parts: SetPart[]) {
  const held = (extension: SetExtension) => parts.filter(part => part.extension === extension).length;
  return { twice: SET_PARTS.filter(extension => held(extension) > 1),
    missing: REQUIRED.filter(extension => !held(extension)) };
}

/** N05. The whole live set the .shp original is the parent of, in extension order; null while it is not whole. */
async function wholeSetTx(client: PoolClient, source: IntakeSourceRow): Promise<SetPart[] | null> {
  const parts = await stemPartsTx(client, source.case_id, partName(source.name)!.stem);
  const { twice, missing } = setGaps(parts);
  return !twice.length && !missing.length && parts[0].source_id === source.id ? parts : null;
}

const memberPins = (parts: SetPart[]): SetMember[] => parts.map(part => ({ sourceId: part.source_id,
  sourceRevision: part.revision, sha256: part.sha256, extension: part.extension }));

const dotted = (extensions: SetExtension[]) => extensions.map(extension => `.${extension}`).join(' and ');

const readWith = (shp: SetPart) => `Read with ${fileName(shp.name)} as one shapefile.`;

/** N05B. The words a part other than the .shp of a whole live set rests with; null for any other source. */
export async function setPartWordsTx(client: PoolClient, caseId: string, sourceId: string): Promise<string | null> {
  const name: string | undefined = (await client.query('SELECT name FROM sources WHERE case_id=$1 AND id=$2',
    [caseId, sourceId])).rows[0]?.name;
  const named = name ? partName(name) : null;
  if (!named) return null;
  const parts = await stemPartsTx(client, caseId, named.stem);
  const { twice, missing } = setGaps(parts);
  return !twice.length && !missing.length && parts.slice(1).some(part => part.source_id === sourceId)
    ? readWith(parts[0]) : null;
}

/**
 * N05B (D1). A key-profile reading of a part that is still queued ends stale in the words the part rests with; one
 * running or finished is left.
 */
async function withdrawPartReadingsTx(client: PoolClient, caseId: string, parts: SetPart[], words: string) {
  const jobs = (await client.query(`SELECT payload FROM jobs WHERE case_id=$1 AND operation='intake-evidence'
    AND status='queued' AND source_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
  [caseId, parts.map(part => part.source_id)])).rows;
  if (!jobs.length) return;
  const { IntakeEvidenceInputSchema } = await import('./intake-evidence');
  const { endIntakeEvidenceJobTx } = await import('./intake-evidence-worker');
  for (const job of jobs) {
    await endIntakeEvidenceJobTx(client, IntakeEvidenceInputSchema.parse(job.payload), 'stale', words);
  }
}

async function restPartTx(client: PoolClient, caseId: string, part: SetPart,
  state: Pick<IntakeDraftState, 'state' | 'placement' | 'limitReason'>) {
  await writeIntakeDraftTx(client, caseId, part.item_id, { ...state, planRef: part.plan_ref, recordsSeen: 0 });
}

/**
 * N05. A published loose part (named .shp, .shx, .dbf, .prj or .cpg) of a stem holding a .shp or .shx is read only
 * with its set. A stem holding two parts of one extension rests every part in words naming them; one short of its
 * .shp, .shx or .dbf rests every part waiting; a whole set queues SH2's conversion on its .shp item, and every other
 * part rests read with it, its queued key-profile reading withdrawn. False for any other file, a lone .dbf included,
 * which keeps its own path.
 */
export async function queueShapefileSetTx(client: PoolClient, source: IntakeSourceRow,
  card: IntakeCard): Promise<boolean> {
  const named = partName(source.name);
  const format = named && partFormats[named.extension];
  if (!named || (format && card.format !== format)) return false;
  const parts = await stemPartsTx(client, source.case_id, named.stem);
  if (!parts.some(part => part.extension === 'shp' || part.extension === 'shx')) return false;
  const stem = fileName(named.stem);
  const { twice, missing } = setGaps(parts);
  if (twice.length) {
    const doubled = parts.filter(part => twice.includes(part.extension)).map(part => fileName(part.name));
    const limitReason = `Shapefile part: ${stem} has more than one ${dotted(twice)} (${listWords(doubled, 1500)}), `
      + 'so its parts are not read together as one shapefile.';
    for (const part of parts) await restPartTx(client, source.case_id, part,
      { state: 'probed', placement: 'not_understood', limitReason });
    return true;
  }
  if (missing.length) {
    for (const part of parts) await restPartTx(client, source.case_id, part, { state: 'probed',
      placement: 'undecided', limitReason: `Shapefile part: waiting for ${dotted(missing)} of ${stem}.` });
    return true;
  }
  const [shp, ...others] = parts;
  for (const part of others) await restPartTx(client, source.case_id, part, { state: 'read', placement: 'undecided',
    limitReason: readWith(shp) });
  await withdrawPartReadingsTx(client, source.case_id, others, readWith(shp));
  const { source: parent } = await intakeSourceTx(client, source.case_id, shp.source_id);
  await queueNativeDerivativeTx(client, parent, shp.card);
  return true;
}

/**
 * Publishing the card queues one fenced conversion job in the publishing transaction. None is queued while one
 * waits or runs, or once the last succeeded without layer failures; a failed job or partial conversion is queued
 * again by enrolling the file again. An officer's coordinate system answer (`answered`) queues it again after one
 * finished. N05: a shapefile set's job is counted among those of the same members, its id taken from the .shp item
 * and the members' sorted SHA-256s, so parts
 * published in any order queue the same job; none is queued while the set is not whole.
 */
export async function queueNativeDerivativeTx(client: PoolClient, source: IntakeSourceRow,
  card: IntakeCard, answered = false): Promise<string | null> {
  const format = derivativeFormat(card, source.name);
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL
    FOR UPDATE`, [source.id])).rows[0];
  if (!format || !item) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`intake-native-derivative:${item.item_id}`]);
  const parts = format === 'shapefile_set' ? await wholeSetTx(client, source) : undefined;
  if (parts === null) return null;
  const members = parts && memberPins(parts);
  const jobs = (await client.query(`SELECT id,status,payload FROM jobs WHERE source_id=$1
    AND operation='intake-native-derivative' ORDER BY created_at`, [source.id])).rows
    .filter(job => fingerprint(job.payload?.members ?? null) === fingerprint(members ?? null));
  const open = jobs.find(job => ['queued', 'running'].includes(job.status));
  if (open) return open.id;
  if (!answered && item.plan_ref?.nativeDerivativeRetry !== true && jobs.at(-1)?.status === 'succeeded') return null;
  const scope = await intakeCaseTx(client, source.case_id);
  const key = members ? `shapefile_set:${item.item_id}:${members.map(member => member.sha256).sort().join(',')}`
    : `${item.item_id}:${source.revision}`;
  const input = IntakeNativeDerivativeInputSchema.parse({ version: 'intake-native-derivative/1',
    jobId: stableUuid(`intake-native-derivative/1:${key}:${jobs.length + 1}`),
    caseId: source.case_id, caseRevision: scope.current.revision, itemId: item.item_id, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access, ...(members ? { members } : {}) });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-native-derivative',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  // The layers asked about and the officer's answers stay beside the item while it is read again.
  const nativeLayers = nativeLayersRef(item.plan_ref);
  const planRef = nativeLayers.unstated.length || nativeLayers.answers.length ? { nativeLayers } : null;
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'reading', placement: 'undecided',
    planRef: withReading(planRef, item.plan_ref), recordsSeen: 0,
    limitReason: `The layers of this ${kind(format)} are being converted to GeoJSON, each to be taken in as its own `
      + 'file. Layers enter the map path once the whole conversion ends.' });
  return input.jobId;
}

/**
 * CR1. Keeps the officer's EPSG code for a layer the last conversion found stating no system, beside the item, and
 * queues the conversion again. The caller holds the case and has checked the code with the geo service. A system
 * the file states is never replaced; each layer takes one answer; none is taken while a conversion runs.
 */
export async function stateLayerCrsTx(client: PoolClient, source: IntakeSourceRow, itemId: string,
  answer: { layer: string; crs: string }) {
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE item_id=$1 AND source_id=$2
    AND parent_item_id IS NULL FOR UPDATE`, [itemId, source.id])).rows[0];
  if (!item || !nativeDerivativeFormat(item.card, source.name)) throw new AppError(409,
    'INTAKE_LAYER_CRS_NOT_NATIVE',
    'Only a layer of a GeoPackage, shapefile ZIP or set, KML or KMZ takes a coordinate system answer.');
  const stored = nativeLayersRef(item.plan_ref);
  if (stored.answers.some(entry => entry.layer === answer.layer)) throw new AppError(409, 'INTAKE_LAYER_CRS_ANSWERED',
    'The officer already stated this layer\'s coordinate system.');
  if (!stored.unstated.includes(answer.layer)) throw new AppError(409, 'INTAKE_LAYER_CRS_STATED',
    'The last conversion found no layer of this name whose file states no coordinate system; '
      + 'a system the file states is never replaced.');
  if ((await client.query(`SELECT 1 FROM jobs WHERE source_id=$1 AND operation='intake-native-derivative'
    AND status='running' LIMIT 1`, [source.id])).rowCount) throw new AppError(409, 'INTAKE_LAYER_CRS_CONVERTING',
    'The layers of this file are being converted; state the coordinate system once that ends.');
  const nativeLayers: NativeLayersRef = { ...stored, answers: [...stored.answers,
    { layer: answer.layer, crs: answer.crs, state: 'officer_stated', statedAt: new Date().toISOString() }] };
  const current = await readIntakeDraftTx(client, item.case_id, itemId);
  await writeIntakeDraftTx(client, item.case_id, itemId, { ...current, planRef: { nativeLayers } });
  await queueNativeDerivativeTx(client, source, item.card, true);
}

export type NativeDerivativeDependencies = Pick<ZipLayerDependencies, 'transaction' | 'large' | 'register'> & {
  read: typeof readObjectRange;
  waitForSlot?: typeof waitForUploadSlot;
  convert: (request: { sourceId: string; objectKey: string; sha256: string; bytes: number;
    format: NativeFormat; layerCrs?: Record<string, string>; layer?: string; members?: { extension: SetExtension;
      sourceId: string; objectKey: string; sha256: string; bytes: number }[] }) => Promise<unknown>;
};

type Outcome = { layer: string; sourceId: string | null; code: string | null; waiting?: boolean };

function failedLayerWords(outcome: Outcome) {
  if (outcome.code === 'UPLOAD_SLOT_WAIT_ENDED') return `${outcome.layer} `
    + '(no upload slot became free within 30 minutes; the converted bytes are kept)';
  if (outcome.code === 'NATIVE_DERIVATIVE_ORPHAN_UNLINKED') return `${outcome.layer} `
    + '(an earlier retained original is left unchanged; its bytes and receipt lineage '
    + 'could not be matched uniquely and exactly)';
  return `${outcome.layer} (${outcome.code}; enrol the file again to retry)`;
}

/**
 * Officer words name each layer and what became of it; a layer with no stated system asks the officer. The layers
 * stating none and the officer's answers are kept beside the item. N05: a shapefile set's words name its parts.
 * WD1: only a layer that can take an answer (one stating no system) makes the item need one; a stated system that
 * does not resolve is kept, never replaced, and the words say how to export it again. Each converted layer's
 * written and not-written feature counts are told, and where the features not written are named.
 */
export function nativeParentState(format: NativeFormat, conversion: NativeConversion,
  outcomes: Outcome[], answers: NativeLayersRef['answers'] = [], parts: string[] = []): IntakeDraftState {
  const officer = new Map<string, string>();
  for (const layer of conversion.layers) {
    if (layer.state === 'converted' && layer.crsSource === 'officer_stated') officer.set(layer.layer, layer.crs);
  }
  const named = (layer: string) =>
    officer.has(layer) ? `${layer} (${officer.get(layer)}, stated by the officer)` : layer;
  const taken = outcomes.filter(outcome => outcome.sourceId && !outcome.code).map(outcome => named(outcome.layer));
  const failed = outcomes.filter(outcome => outcome.code && !outcome.waiting).map(failedLayerWords);
  const stopped = (state: StoppedLayer['state']) => conversion.layers
    .filter((layer): layer is StoppedLayer => layer.state === state).map(layer => `${layer.layer} (${layer.reason})`);
  const refused = stopped('not_converted');
  const asked = conversion.layers.flatMap(layer =>
    layer.state === 'crs_unstated' && !layer.statesCrs ? [layer.layer] : []);
  const planRef = asked.length || answers.length ? { nativeLayers: { unstated: asked, answers } } : null;
  const sentences = [];
  if (taken.length) sentences.push(`${taken.length === 1 ? '1 layer' : `${taken.length} layers`} of this `
    + `${kind(format)} ${taken.length === 1 ? 'is' : 'are'} converted to GeoJSON and taken in as `
    + `${taken.length === 1 ? 'its own file' : 'their own files'}: ${listWords(taken, 500)}.`);
  const missingCrs = conversion.layers.flatMap(layer => layer.state === 'crs_unstated' && !layer.statesCrs
    ? [`${layer.layer} (${layer.reason})`] : []);
  const unresolvedCrs = conversion.layers.flatMap(layer => layer.state === 'crs_unstated' && layer.statesCrs
    ? [`${layer.layer} (${layer.reason})`] : []);
  if (missingCrs.length) sentences.push(`Not converted until its coordinate reference system is stated: `
    + `${listWords(missingCrs, 500)}.`);
  if (unresolvedCrs.length) sentences.push(`Kept, not converted: ${listWords(unresolvedCrs, 500)}. Export `
    + `${unresolvedCrs.length === 1 ? 'this layer' : 'these layers'} with a coordinate reference system that resolves `
    + 'to one EPSG code and add the file again; a system the file states is never replaced.');
  if (refused.length) sentences.push(`Not converted: ${listWords(refused, 450)}.`);
  if (failed.length) sentences.push(`Converted but not taken in: ${listWords(failed, 400)}.`);
  const waiting = outcomes.filter(outcome => outcome.waiting).map(outcome => outcome.layer);
  if (waiting.length) sentences.push(`Converted and waiting for a free upload slot: ${listWords(waiting, 400)}. `
    + 'It continues by itself; the converted bytes are kept.');
  sentences.push(...featureCountWords(conversion));
  if (parts.length) sentences.push(`Read as one shapefile from its parts: ${listWords(parts, 300)}.`);
  sentences.push(...basisWords(conversion));
  let placement: IntakeDraftState['placement'] = 'not_understood';
  if (taken.length || failed.length || waiting.length) placement = 'undecided';
  if (asked.length) placement = 'needs_answer';
  return { state: 'read', placement, planRef, recordsSeen: 0, limitReason: sentences.join(' ') };
}

const featureCount = (value: number) => value.toLocaleString('en-US');

/**
 * Gap 6. Each converted layer's written and not-written features. A feature not written stays in the original; the
 * layer's stored locator sidecar names its position there and why. NO1: the item's reading lists them from it.
 */
function featureCountWords(conversion: NativeConversion): string[] {
  const converted = conversion.layers.filter((layer): layer is ConvertedLayer => layer.state === 'converted');
  if (!converted.length) return [];
  const counts = converted.map(layer => `${layer.layer} (${featureCount(layer.features)} written, `
    + `${featureCount(layer.notWritten)} not written)`);
  const words = [`Features per converted layer: ${listWords(counts, 300)}.`];
  if (converted.some(layer => layer.notWritten)) words.push('A feature not written is not in that layer\'s GeoJSON; '
    + 'the stored locator file kept beside that GeoJSON names its position in the original and why. '
    + 'Open the reading of this file to see them listed.');
  return words;
}

/** KML1. Where a system the format states comes from, and what the original keeps that is not fetched or read. */
function basisWords(conversion: NativeConversion): string[] {
  const words: string[] = [];
  const [basis] = conversion.layers.flatMap(layer => layer.state === 'converted' && layer.crsBasis
    ? [layer.crsBasis] : []);
  if (basis) words.push(`Coordinate system: ${basis}.`);
  const kept = Object.entries(conversion.notRead ?? {}).map(([element, count]) => `${element} (${count})`);
  if (kept.length) words.push(`Kept in the original but not fetched or read: ${kept.join(', ')}.`);
  return words;
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && /^ZIP_[A-Z_]{1,60}$/.test(error.message)) return error.message;
  return 'NATIVE_DERIVATIVE_UNAVAILABLE';
}

/**
 * N05. A shapefile set's parts while they are still the whole live set the job pinned (when it pinned one), each
 * original's access checked; null once a part was added, replaced or doubled, as that publish queued its own job.
 */
async function pinnedSetTx(client: PoolClient, source: IntakeSourceRow, pinned?: SetMember[]) {
  const parts = await wholeSetTx(client, source);
  if (!parts || (pinned && fingerprint(memberPins(parts)) !== fingerprint(pinned))) return null;
  for (const part of parts) await intakeSourceTx(client, source.case_id, part.source_id);
  return parts;
}

/**
 * Converts the item's original, retains each converted layer's GeoJSON as a large-original child named by its
 * lineage (one already kept by an earlier attempt is reused), enrols every child, then writes the item's words.
 * N05: a shapefile set is converted from the parts its job pinned; a job whose set changed writes nothing.
 */
export async function convertNativeLayers(caseValue: string, itemValue: string,
  dependencies: NativeDerivativeDependencies, pinned?: SetMember[]): Promise<string[]> {
  const caseId = uuid.parse(caseValue), itemId = uuid.parse(itemValue);
  const scope = await dependencies.transaction(async client => {
    const item = (await client.query(`SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
      AND parent_item_id IS NULL`, [caseId, itemId])).rows[0];
    if (!item?.source_id || !item.card) return null;
    const { source } = await intakeSourceTx(client, caseId, item.source_id);
    const format = derivativeFormat(item.card, source.name);
    const parts = format === 'shapefile_set' ? await pinnedSetTx(client, source, pinned) : undefined;
    if (!format || parts === null) return null;
    return { format, source, parts, answers: nativeLayersRef(item.plan_ref).answers, stored: item.plan_ref };
  });
  if (!scope) return [];
  const { format, source, parts, answers, stored } = scope;
  const layerCrs = Object.fromEntries(answers.map(answer => [answer.layer, answer.crs]));
  const set = parts && { layer: fileName(partName(source.name)!.stem), members: parts.map(part => ({
    extension: part.extension, sourceId: part.source_id, objectKey: part.object_key, sha256: part.sha256,
    bytes: Number(part.bytes) })) };
  const conversion = NativeConversionSchema.parse(await dependencies.convert({ sourceId: source.id,
    objectKey: source.object_key, sha256: source.sha256, bytes: Number(source.bytes), format,
    ...(answers.length ? { layerCrs } : {}), ...set }));
  if (conversion.sourceId !== source.id || conversion.sourceSha256 !== source.sha256)
    throw new AppError(422, 'NATIVE_DERIVATIVE_PINS', 'The conversion names a different original.');
  const outcomes: Outcome[] = [];
  const slotWait: { deadline: number | null } = { deadline: null };
  for (const layer of conversion.layers) {
    if (layer.state !== 'converted') continue;
    const lineage = NativeDerivativeLineageSchema.parse({ version: 'native-derivative/1',
      conversion: conversion.conversion, readerVersion: conversion.readerVersion, originalSourceId: source.id,
      originalSourceRevision: source.revision, originalSha256: source.sha256, originalItemId: itemId, format,
      layer: layer.layer, ordinal: layer.ordinal, crs: layer.crs, crsSource: layer.crsSource,
      ...(layer.crsBasis ? { crsBasis: layer.crsBasis } : {}), features: layer.features,
      notWritten: layer.notWritten, sidecar: layer.sidecar, ...(parts ? { members: memberPins(parts) } : {}) });
    try {
      const sourceId = await keepWhenSlotFree(caseId, layer, lineage, dependencies, slotWait, async () => {
        const waiting = [...outcomes, { layer: layer.layer, sourceId: null, code: 'UPLOAD_QUOTA', waiting: true }];
        const state = nativeParentState(format, conversion, waiting, answers, parts?.map(part => fileName(part.name)));
        await dependencies.transaction(async client => {
          if (parts && !await pinnedSetTx(client, source, memberPins(parts))) return;
          await writeIntakeDraftTx(client, caseId, itemId, { ...state, state: 'reading',
            planRef: withReading(state.planRef, stored) });
        });
      });
      outcomes.push({ layer: layer.layer, sourceId, code: null });
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
  await dependencies.transaction(async client => {
    if (parts && !await pinnedSetTx(client, source, memberPins(parts))) return;
    const state = nativeParentState(format, conversion, outcomes, answers, parts?.map(part => fileName(part.name)));
    const planRef = withReading(state.planRef, stored);
    // A caught layer fault still completes the job; keep re-enrolment retryable without automatic retries.
    await writeIntakeDraftTx(client, caseId, itemId, { ...state,
      planRef: outcomes.some(outcome => outcome.code) ? { ...planRef, nativeDerivativeRetry: true } : planRef });
  });
  return outcomes.flatMap(outcome => outcome.sourceId ? [outcome.sourceId] : []);
}

/** Slot pressure is not a failed conversion or a spent job attempt. No transaction or bytes are held while asleep. */
async function keepWhenSlotFree(caseId: string, layer: ConvertedLayer, lineage: NativeDerivativeLineage,
  dependencies: NativeDerivativeDependencies, wait: { deadline: number | null }, waiting: () => Promise<void>) {
  let noted = false;
  for (;;) {
    const version = uploadSlotVersion();
    try { return await keepDerivative(caseId, layer, lineage, dependencies); }
    catch (error) {
      const slot = uploadSlotWait(error);
      if (!slot) throw error;
      const deadline = wait.deadline ??= Date.now() + 30 * 60 * 1000;
      if (Date.now() >= deadline) throw new AppError(429, 'UPLOAD_SLOT_WAIT_ENDED',
        'No upload slot became free within 30 minutes; the converted bytes are kept.');
      if (!noted) {
        await waiting();
        noted = true;
      }
      await (dependencies.waitForSlot ?? waitForUploadSlot)(version, slot.freesAt, deadline);
    }
  }
}

/** A replay finds the child an earlier attempt kept by its lineage and hash, so nothing is retained twice. */
async function keptChildTx(client: PoolClient, caseId: string, layer: ConvertedLayer,
  lineage: NativeDerivativeLineage): Promise<string | null> {
  const kept = (await client.query(`SELECT id FROM sources WHERE case_id=$1 AND profile='large-original-v1'
    AND sha256=$2 AND inspection->'nativeDerivative'=$3::jsonb AND bytes=$4
    ORDER BY created_at,id LIMIT 1`, [caseId, layer.geojson.sha256, lineage, layer.geojson.bytes])).rows[0];
  if (kept) {
    await intakeSourceTx(client, caseId, kept.id);
    return kept.id;
  }
  return recoverOrphanTx(client, caseId, layer, lineage);
}

/** Old receipts pin the parent and layer name. Recomputed bytes must agree with every retained receipt fact. */
async function recoverOrphanTx(client: PoolClient, caseId: string, layer: ConvertedLayer,
  lineage: NativeDerivativeLineage): Promise<string | null> {
  const candidates = (await client.query(`SELECT s.id,u.body,u.operator_subject FROM sources s
    JOIN usp_source_uploads u ON u.source_id=s.id AND u.case_id=s.case_id
      AND u.id::text=s.inspection->'largeOriginal'->>'uploadId'
    WHERE s.case_id=$1 AND s.profile='large-original-v1' AND u.state='retained'
      AND u.body->>'batchSourceId'=$2 AND (s.name=$3 OR s.sha256=$4)
      AND NOT (s.inspection ? 'nativeDerivative') ORDER BY s.created_at,s.id LIMIT 2 FOR UPDATE OF s,u`,
  [caseId, lineage.originalSourceId, `${layer.layer}.geojson`, layer.geojson.sha256])).rows;
  if (!candidates.length) return null;
  if (candidates.length !== 1) orphanUnlinked();
  const candidate = candidates[0];
  const { source, binding } = await orphanSourceTx(client, caseId, candidate.id);
  const parent = (await intakeSourceTx(client, caseId, lineage.originalSourceId)).source;
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
    AND source_id=$3 AND parent_item_id IS NULL`, [caseId, lineage.originalItemId, parent.id])).rows[0];
  const { input, verified } = candidate.body;
  if (!item || parent.revision !== lineage.originalSourceRevision || parent.sha256 !== lineage.originalSha256
    || candidate.operator_subject !== binding.subject || source.name !== `${layer.layer}.geojson`
    || input?.filename !== source.name || input?.sha256 !== layer.geojson.sha256
    || Number(input?.bytes) !== layer.geojson.bytes || verified?.sha256 !== layer.geojson.sha256
    || Number(verified?.bytes) !== layer.geojson.bytes || source.sha256 !== layer.geojson.sha256
    || Number(source.bytes) !== layer.geojson.bytes
    || source.object_key !== `large-originals/${source.id}/${source.sha256}`
    || ['archiveMember', 'tableDerivative', 'cellDerivative'].some(key => source.inspection?.[key])) orphanUnlinked();
  await client.query(`UPDATE sources SET inspection=inspection||jsonb_build_object('nativeDerivative',$2::jsonb)
    WHERE id=$1 AND profile='large-original-v1'`, [source.id, lineage]);
  return source.id;
}

async function orphanSourceTx(client: PoolClient, caseId: string, sourceId: string) {
  try { return await intakeSourceTx(client, caseId, sourceId); }
  catch (error) {
    if (error instanceof AppError && ['INTAKE_SOURCE_DENIED', 'INTAKE_SOURCE_INTEGRITY'].includes(error.code)) {
      orphanUnlinked();
    }
    throw error;
  }
}

function orphanUnlinked(): never {
  throw new AppError(409, 'NATIVE_DERIVATIVE_ORPHAN_UNLINKED',
    'An earlier retained original is left unchanged because its bytes and receipt lineage do not match exactly.');
}

async function keepDerivative(caseId: string, layer: ConvertedLayer,
  lineage: NativeDerivativeLineage, dependencies: NativeDerivativeDependencies) {
  const prior = await dependencies.transaction(client => keptChildTx(client, caseId, layer, lineage));
  if (prior) return prior;
  // The copy's deadline grows with the layer's size, as the large reader's does.
  const readMs = streamingReadMs(layer.geojson.bytes);
  const deadline = Date.now() + readMs;
  const signal = AbortSignal.timeout(readMs);
  const { objectKey, bytes, sha256 } = layer.geojson;
  async function* ranges() {
    for (let start = 0; start < bytes; start += 1024 * 1024) {
      yield await dependencies.read(objectKey, start, Math.min(bytes, start + 1024 * 1024), bytes, deadline, signal);
    }
  }
  const file = { name: `${layer.layer}.geojson`, bytes, sha256 };
  // The receipt hashes the parts again and refuses bytes that differ from the conversion's own hash.
  return fenced(caseId, dependencies, revision =>
    receiveLargeLayer(caseId, { revision, batchSourceId: lineage.originalSourceId }, file, byteParts(ranges()),
      dependencies, lineage));
}
