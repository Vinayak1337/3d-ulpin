import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DOCUMENT_LIMITS, INTAKE_LEGACY_WORKBOOK_WORDS, INTAKE_TABLE_READER_FORMATS, STREAMING_VECTOR_LIMITS,
  TabularSelectionSchema, type TabularSelection, type DocumentResult, type IntakeCard } from '@ulpin/contracts/usp';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockCaseEnqueueTx, lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { citeIntakeReceipt, readIntakeDraftTx, saveIntakeCardTx, writeIntakeDraftTx, writeIntakeLargeTx,
  type IntakeDraftState } from './intake-ledger';
import { intakeLargeFailureReason, queueIntakeLargeTx } from './intake-large';
import { queuePageImageTx } from './intake-page-image';
import { batchIfc, queueIntakeIfcTx } from './intake-ifc';
import { batchNativeReader, queueIntakeNativeReaderTx } from './intake-native-readers';
import { surfaceKind } from './intake-surface';
import { stableUuid } from './intake-run';
import { pageImageFormat } from './page-image-read';
import { queueBatchDocumentTx } from './documents';
import { GEOJSON_FEATURE_LIMIT } from './registry';
import { BOUNDED_READER_UNAVAILABLE, prepareRetainedGeojsonTx } from './service';
import { isRetainedMapOriginal } from './retained-map-original';
import { intakeGeojsonFraming } from './geojson-framing';
import { INTAKE_GZIP_WORDS } from './intake-text';
import { INTAKE_HEADER_CONFIRMATION, type IntakeProbeReason } from './intake-probe';

/** Closed reason vocabulary only; old codes and unrecognised stored text get the same safe fallback. */
export function intakeProbeFailureWords(reason: string | null | undefined): string {
  const words: Record<IntakeProbeReason, string> = {
    encoding_unreadable: 'The table text could not be decoded',
    no_rows: 'No nonblank table rows were found',
    line_too_long: 'The first table row did not end within the probe byte limit',
    not_delimited: 'No table columns separated by commas, semicolons, tabs or pipes were found',
    malformed_quotes: 'The table has an unfinished or misplaced quoted field',
    read_failed: 'The file could not be read for its initial check',
  };
  const key = reason?.startsWith('INTAKE_PROBE_FAILED:') ? reason.slice('INTAKE_PROBE_FAILED:'.length) : '';
  let stopped = Object.hasOwn(words, key) ? words[key as IntakeProbeReason] : words.read_failed;
  if (reason === 'INTAKE_PROBE_BUDGET') stopped = 'The initial check reached its time limit';
  // A refused archive member stores its own ZIP_* code: keep it, in words, rather than the generic fallback.
  else if (reason && /^ZIP_[A-Z_]+$/.test(reason)) stopped = `This archive member was not read (${reason})`;
  return `${stopped}; the original is kept unchanged with its SHA-256.`;
}

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeDraftInputSchema = z.strictObject({
  version: z.literal('intake-draft/1'), jobId: uuid, itemId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, sourcePin: hash, recipeRevision: z.number().int().nonnegative(),
  subject: z.string().min(1).max(256), accessSha256: hash,
  tableSelection: TabularSelectionSchema.optional(),
});
export type IntakeDraftInput = z.infer<typeof IntakeDraftInputSchema>;
export type DraftItem = {
  item_id: string; case_id: string; source_id: string; parent_item_id: string | null;
  state: string; placement: string; family: string; card: IntakeCard | null; plan_ref: Record<string, any> | null;
};

/** Stable keys distinguish each recipe phase, while replay sends exactly the same UUID. */
export function intakeDraftKey(itemId: string, revision: number, phase: string): string {
  return stableUuid(`intake-draft/1:${itemId}:${revision}:${phase}`);
}

export const shapefileZip = (card: IntakeCard | null) =>
  card?.format === 'zip' && card.members.some(member => member.format === 'shapefile');

export type NativeDerivativeFormat = 'gpkg' | 'shapefile_zip' | 'shapefile_set' | 'kml' | 'kmz' | 'geoparquet';

/**
 * SH2. The native format a batch card is converted from into GeoJSON layers, or null for any other card. N05: with
 * its original's name, a shapefile card named .shp is the parent of the loose shapefile set of its stem.
 */
export function nativeDerivativeFormat(card: IntakeCard | null, name = ''): NativeDerivativeFormat | null {
  if (card?.format === 'geopackage') return 'gpkg';
  if (card?.format === 'geoparquet') return 'geoparquet';
  if (card?.format === 'kml' || card?.format === 'kmz') return card.format;
  if (card?.format === 'shapefile' && /\.shp$/i.test(name)) return 'shapefile_set';
  return shapefileZip(card) ? 'shapefile_zip' : null;
}

/** Names entries within `budget` characters (limit_reason holds 2000); the rest are counted, never cut. */
export function listWords(entries: string[], budget: number): string {
  let shown = 0;
  for (let used = 0; shown < entries.length && used + entries[shown].length + 2 <= budget; shown++) {
    used += entries[shown].length + 2;
  }
  const rest = entries.length - shown;
  if (!rest) return entries.join(', ');
  return shown ? `${entries.slice(0, shown).join(', ')} and ${rest} more` : `${rest} with long paths`;
}

/** ZW1. Where the archive's layer job stands: none waiting or done, queued or running, or stopped with a sentence. */
export type ZipLayerStage = 'taken' | 'taking' | { stopped: string };

/** Parent words describe actual copies when supplied, never infer successful retention from a probe. */
export function zipParentWords(card: IntakeCard, stage: ZipLayerStage = 'taken',
  outcomes: { path: string; sourceId: string | null; reason: string | null }[] = []): string {
  const members = card.members.filter(member => !member.name.endsWith('/'));
  const shapes = members.filter(member => member.format === 'shapefile');
  const grouped = new Set(shapes.flatMap(member => [member.name, ...(member.companions ?? [])]));
  const independent = members.filter(member => !grouped.has(member.name));
  const actual = new Map(outcomes.map(outcome => [outcome.path, outcome]));
  const taken = independent.filter(member => actual.get(member.name)?.sourceId);
  const pending = independent.filter(member => !actual.get(member.name)?.sourceId && !member.refusalCode
    && !actual.get(member.name)?.reason);
  const kept = independent.filter(member => member.refusalCode || actual.get(member.name)?.reason
    || actual.get(member.name)?.sourceId && !zipMemberHasReader(member));
  const sentences = [`${zipCountWords(card.counts?.members ?? members.length, 'member')}.`];
  if (typeof stage === 'object') sentences.push(stage.stopped);
  if (shapes.length) sentences.push(`${shapes.length} shapefile layer${shapes.length === 1 ? '' : 's'} grouped `
    + `for the native reader: ${listWords(shapes.map(member => member.name), 150)}.`);
  if (taken.length) sentences.push(`${zipKindWords(taken)} taken out as their own items: `
    + `${listWords(taken.map(member => member.name), 400)}.`);
  if (pending.length) sentences.push(`${zipCountWords(pending.length, 'file')} `
    + `${stage === 'taking' ? 'being' : 'waiting to be'} `
    + `taken out as their own items: ${listWords(pending.map(member => member.name), 250)}.`);
  if (kept.length) sentences.push(`${zipCountWords(kept.length, 'file')} kept, not read: `
    + `${listWords(kept.map(member => {
      const outcome = actual.get(member.name);
      const reason = member.refusalCode ?? outcome?.reason?.split(':')[0] ?? 'no batch reader';
      return `${member.name} (${outcome?.sourceId ? 'own item' : 'inside archive'}; ${reason})`;
    }), 350)}.`);
  if (!members.length) sentences.push(`No members could be taken out. ${listWords(card.limits ?? [], 1000)}`);
  return sentences.join(' ');
}

function zipCountWords(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Batch PDFs and Word documents share the document reader; uncertain table layouts keep their press. */
const batchDocument = (card: IntakeCard): card is IntakeCard & { format: 'pdf' | 'docx' } =>
  (card.format === 'pdf' || card.format === 'docx') && card.family === 'document';
const batchTable = (card: IntakeCard) => card.family === 'table' && INTAKE_TABLE_READER_FORMATS.includes(card.format);

/** Only the first-row layout is automatic; incomplete sheet inventories never establish a one-sheet workbook. */
export function certainTableSelection(card: IntakeCard): TabularSelection | null {
  if (!batchTable(card) || card.encrypted || card.depth !== 'structure') return null;
  const delimited = card.format === 'csv' || card.format === 'tsv';
  if (delimited && (!card.delimiter || !card.encoding || !card.columns.length
    || card.limits.includes(INTAKE_HEADER_CONFIRMATION))) return null;
  if (!delimited && (card.sheets.length !== 1
    || card.limits.some(words => /cut|unresolved|unavailable|refused/i.test(words)))) return null;
  const parsed = TabularSelectionSchema.safeParse({ format: delimited ? 'csv' : card.format,
    sheet: delimited ? 'csv' : card.sheets[0].name, table: null, headerRows: [1],
    ...(delimited ? { delimiter: card.delimiter, encoding: card.encoding } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** A member taken out of a ZIP other than a small GeoJSON is kept through the byte receipt, under this profile. */
const keptMember = { profile: 'large-original-v1' } as IntakeSourceRow;

/**
 * Whether the member's own item is read: the routes of the batch enrolment (the surface queue, then
 * queueIntakeDraftTx) applied to the member's own card, as kept through the byte receipt.
 */
function zipMemberHasReader(member: IntakeCard['members'][number]): boolean {
  const card: IntakeCard | null = member.card && { ...member.card, members: [] };
  if (!card) return false;
  return ['zip', 'gzip', 'geojson'].includes(card.format) || batchDocument(card) || Boolean(pageImageFormat(card))
    || batchIfc(keptMember, card) || batchNativeReader(keptMember, card) || Boolean(nativeDerivativeFormat(card))
    || Boolean(surfaceKind(card)) || batchTable(card);
}

function zipKindWords(members: IntakeCard['members']): string {
  const counts = new Map<string, number>();
  const labels: Record<string, [string, string]> = { pdf: ['PDF', 'PDFs'], csv: ['CSV', 'CSVs'],
    geojson: ['GeoJSON layer', 'GeoJSON layers'], geopackage: ['GeoPackage', 'GeoPackages'],
    zip: ['nested ZIP', 'nested ZIPs'] };
  for (const member of members) counts.set(member.format, (counts.get(member.format) ?? 0) + 1);
  return listWords([...counts].map(([format, count]) => {
    const [single, plural] = labels[format] ?? [`${format} file`, `${format} files`];
    return `${count} ${count === 1 ? single : plural}`;
  }), 200);
}

/** Sizes in the batch page's units: bytes, KB and MB as there, GB above them, each of 1024. */
function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  const [value, unit] = bytes < 1024 ** 3 ? [bytes / 1024 ** 2, 'MB'] : [bytes / 1024 ** 3, 'GB'];
  return `${value.toFixed(1).replace(/\.0$/, '')} ${unit}`;
}

const keptFamilies: Record<string, string> = { document: 'document', image: 'image', raster: 'raster',
  point_cloud: 'point cloud', model3d: '3D model', table: 'table', archive: 'archive', unknown: 'file' };
const keptFormats: Record<string, string> = { bigtiff: 'BigTIFF', citygml: 'CityGML', cityjson: 'CityJSON',
  gltf: 'glTF', parquet: 'Parquet', sqlite: 'SQLite' };

/**
 * NU1. A probed file no batch reader takes: no ZIP (its own words) and no table but a large original's (tables
 * have their own layout reader). The vector family always has a reader or a refusal of its own.
 */
function keptOnly(card: IntakeCard, source: IntakeSourceRow): boolean {
  if (card.format === 'geoparquet') return false;
  if (card.family === 'table') return source.profile === 'large-original-v1';
  return card.family !== 'vector' && card.format !== 'zip';
}

/** NU1. What the probe saw of a kept file, from its card's family and format and the original's byte count. */
export function keptWords(card: IntakeCard, bytes: number): string {
  if (card.format === 'gzip') return INTAKE_GZIP_WORDS;
  if (card.format === 'unknown') return `Kept (${sizeWords(bytes)}); its kind was not recognised from its first `
    + 'and last bytes.';
  if (card.format === 'xls') return `Excel 97-2003 workbook (${sizeWords(bytes)}). ${INTAKE_LEGACY_WORKBOOK_WORDS}`;
  const kind = card.format === 'docx' ? 'Word document'
    : `${keptFormats[card.format] ?? card.format.toUpperCase()} ${keptFamilies[card.family]}`;
  const kept = `Kept as ${/^[AEIOX]/.test(kind) ? 'an' : 'a'} ${kind} (${sizeWords(bytes)}).`;
  if (batchTable(card) && card.sheets?.length > 1) return `${kept} Which sheet and header row should be read? `
    + 'Choose them with "Read as a table"; the original is kept with its SHA-256.';
  if (batchTable(card)) return `${kept} Read it as a table with "Open the table"; the original is kept with its `
    + 'SHA-256.';
  if (card.family === 'table') return `${kept} It is not read as a table today; the original is kept with its SHA-256.`;
  return `${kept} No reader in a batch takes this kind of file yet, so it is not on the map; the original is kept `
    + 'with its SHA-256.';
}

/** A refusal is tray metadata, not permission to use a different reader or split an original. */
export function intakeDraftLimit(item: DraftItem, source: IntakeSourceRow): string | null {
  const format = item.card?.format;
  const count = source.inspection?.manualProfile?.featureCount;
  if (format === 'shapefile' || format === 'shapefile_zip')
    return 'Shapefile geometry in a batch is read from a .shp dropped with its .shx and .dbf of the same name, '
      + 'or from a ZIP holding them; this file was not read as one of those parts.';
  if (item.card?.format === 'zip') return zipParentWords(item.card);
  if (Number(source.bytes) > 16 * 1024 * 1024) {
    if (format === 'geojson' || source.profile === 'geojson-manual-v1')
      return `This GeoJSON original has ${Number(source.bytes)} bytes, above the 16777216-byte intake drafting `
        + 'and POST /api/v1/import-packages bound; /api/v1/ingestion/cases/:caseId/uploads can retain it, '
        + 'but no package or card is drafted from this oversized original.';
    return `Drafting accepts at most 16777216 bytes; this original has ${Number(source.bytes)} bytes.`;
  }
  if (Number.isSafeInteger(count) && count > 2000)
    return `Drafting accepts at most 2000 features; this receipt has ${count} features.`;
  if (source.profile !== 'geojson-manual-v1' && !isRetainedMapOriginal(source)
    || source.inspection?.manualProfile?.version !== 'manual-geojson/1'
    || source.inspection?.manualProfile?.format !== 'geojson')
    return 'Drafting accepts only a retained GeoJSON recipe original.';
  if (!Number.isSafeInteger(count) || count < 1)
    return 'Drafting needs a retained count of 1 to 2000 features; the count is unknown.';
  if (item.card?.crs.state !== 'stated' || !source.inspection?.manualProfile?.crs?.evidence)
    return 'Drafting needs a stated, nonconflicting coordinate reference system.';
  return null;
}

async function draftItemTx(client: PoolClient, sourceId: string): Promise<DraftItem | undefined> {
  return (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE',
    [sourceId])).rows[0];
}

async function priorJobTx(client: PoolClient, input: IntakeDraftInput): Promise<string | null> {
  const prior = (await client.query("SELECT id,payload FROM jobs WHERE id=$1 AND operation='intake-draft'",
    [input.jobId])).rows[0];
  if (prior) {
    if (prior.payload.sourcePin !== input.sourcePin) conflict('The retained intake source changed.');
    return prior.id;
  }
  const active = (await client.query(`SELECT id,payload FROM jobs WHERE source_id=$1 AND operation='intake-draft'
    AND status IN ('queued','running') ORDER BY created_at LIMIT 1`, [input.sourceId])).rows[0];
  if (active && active.payload.sourcePin !== input.sourcePin) conflict('The retained intake source changed.');
  return active?.id ?? null;
}

/** Byte-probed kinds select readers; a small byte count alone never selects the bounded feature adapter. */
export function intakeReaderRoute(card: IntakeCard, source: Pick<IntakeSourceRow, 'bytes' | 'inspection'>): string {
  if (card.format !== 'geojson') return intakeGeojsonFraming(card) ? 'streamed_geojson' : card.format;
  // A derivative (a native layer, TC1's table rows) takes the large path whatever its size, as a dropped large file.
  const derivative = source.inspection?.nativeDerivative || source.inspection?.tableDerivative
    || source.inspection?.cellDerivative;
  if (derivative || Number(source.bytes) > 16 * 1024 * 1024
    || source.inspection?.intakeExtent?.fitsOneArea === false) return 'streamed_geojson';
  const count = source.inspection?.manualProfile?.featureCount ?? card.counts.features;
  if (count === null || count === undefined) return 'inspect_geojson';
  return count <= GEOJSON_FEATURE_LIMIT ? 'bounded_geojson' : 'streamed_geojson';
}

/** A small original once sent to the streaming reader stays there, so a later enrolment never starts a second one. */
async function streamingReaderQueuedTx(client: PoolClient, sourceId: string): Promise<boolean> {
  return (await client.query("SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-large' LIMIT 1",
    [sourceId])).rows.length > 0;
}

/** The pre-RT1 route: the streaming reader needs no processor, and the item says why it was taken. */
async function streamedWithReasonTx(client: PoolClient, item: DraftItem, reason: string) {
  const current = await readIntakeDraftTx(client, item.case_id, item.item_id);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { ...current, limitReason: reason });
  return 'streamed' as const;
}

/** Inspect only an already-kept bounded original; invalid content rests with a reason, never loses its receipt. */
async function retainedGeojsonAdapterTx(client: PoolClient, item: DraftItem, source: IntakeSourceRow) {
  if (intakeReaderRoute(item.card!, source) === 'streamed_geojson') return 'streamed';
  if (await streamingReaderQueuedTx(client, source.id)) return 'streamed';
  try {
    const prepared = Boolean(source.inspection?.manualProfile);
    const bounded = await prepareRetainedGeojsonTx(client, source);
    if (!prepared && (bounded || source.inspection?.intakeExtent)) {
      item.card = citeIntakeReceipt(structuredClone(item.card!), source);
      await saveIntakeCardTx(client, item.item_id, item.card);
    }
    return bounded ? 'bounded' : 'streamed';
  } catch (error) {
    if (error instanceof AppError && error.code === BOUNDED_READER_UNAVAILABLE) {
      return streamedWithReasonTx(client, item, error.message);
    }
    if (!(error instanceof AppError) || ![413, 422].includes(error.status)) throw error;
    await writeIntakeDraftTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'not_understood', planRef: null, recordsSeen: 0,
      limitReason: `The original is kept, not read: ${error.message}`.slice(0, 2000),
    });
    return 'kept';
  }
}

/** Caller holds the case; enrollment and probe/approval publication share its transaction. */
export async function queueIntakeDraftTx(client: PoolClient, source: IntakeSourceRow,
  publishedCard?: IntakeCard): Promise<string | null> {
  if (publishedCard?.format === 'zip' && !shapefileZip(publishedCard)) return settleZipParentTx(client, source);
  if (publishedCard && batchDocument(publishedCard)) return queueBatchPdfTx(client, source, publishedCard.format);
  if (publishedCard && pageImageFormat(publishedCard)) return readPageImageTx(client, source, publishedCard);
  if (batchIfc(source, publishedCard)) return queueIntakeIfcTx(client, source);
  if (batchNativeReader(source, publishedCard)) return queueIntakeNativeReaderTx(client, source, publishedCard!);
  if (publishedCard && source.profile === 'large-original-v1' && certainTableSelection(publishedCard))
    return queueBatchTableTx(client, source, publishedCard);
  if (publishedCard && keptOnly(publishedCard, source)) return settleKeptTx(client, source, publishedCard);
  if (nativeDerivativeFormat(publishedCard ?? null)) {
    // SH2: converted into GeoJSON layers by its own job; each layer then takes the large GeoJSON path.
    const { queueNativeDerivativeTx } = await import('./intake-native-derivative');
    return queueNativeDerivativeTx(client, source, publishedCard!);
  }
  // Nonvector readers keep their own behavior. Unsupported vectors receive a reason, never another reader.
  if (source.profile !== 'geojson-manual-v1' && publishedCard?.family !== 'vector') return null;
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.family !== 'vector'
    || !['probed', 'planned', 'reading', 'preparing'].includes(item.state)) return null;
  if (publishedCard && item.plan_ref) return null;
  const retainedGeojson = source.profile === 'large-original-v1' && item.card && intakeGeojsonFraming(item.card);
  const adapter = retainedGeojson ? await retainedGeojsonAdapterTx(client, item, source) : null;
  if (adapter === 'kept') return null;
  if (adapter === 'streamed') {
    // A large GeoJSON is read in parts by its own chain of step jobs; above the reader's ceiling it rests.
    if (Number(source.bytes) <= STREAMING_VECTOR_LIMITS.sourceBytes) return queueIntakeLargeTx(client, source.id);
    await writeIntakeLargeTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'not_understood', planRef: item.plan_ref,
      partsPlanned: null, partsDone: 0, recordsSeen: 0,
      limitReason: intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', Number(source.bytes)),
    });
    return null;
  }
  const reason = intakeDraftLimit(item, source);
  if (reason) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'needs_answer', planRef: item.plan_ref, recordsSeen: 0, limitReason: reason,
    });
    return null;
  }
  return enrollDraftTx(client, item, source);
}

/**
 * ZF2. The ZIP's own item rests read and unplaced: settled in the tray, its words its reason, no question asked.
 * Its layers are drafted as their own items; a shapefile ZIP keeps its direct-import words and no transition.
 */
async function settleZipParentTx(client: PoolClient, source: IntakeSourceRow): Promise<null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.card?.format !== 'zip') return null;
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'read', placement: 'undecided',
    planRef: item.plan_ref, recordsSeen: 0, limitReason: zipParentWords(item.card) });
  return null;
}

/**
 * NU1. A kept file rests not understood, in words naming what the probe saw. Only an unplaced or already kept
 * item is written, so a later reader's placement stands; a re-probe writes the same words.
 */
async function settleKeptTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard): Promise<null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.plan_ref
    || !['undecided', 'not_understood'].includes(item.placement)) return null;
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
    planRef: null, recordsSeen: 0, limitReason: keptWords(card, Number(source.bytes)) });
  return null;
}

/** The existing draft job orchestrates the table commands; no officer request or approval is made. */
async function queueBatchTableTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard) {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.plan_ref
    || !['undecided', 'not_understood'].includes(item.placement)) return null;
  const jobId = await enrollDraftTx(client, item, source, certainTableSelection(card)!);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'reading', placement: 'undecided',
    planRef: null, recordsSeen: 0, limitReason: 'The table is being read. Its field meanings will be proposed for '
      + 'your review; nothing is recorded until you confirm it.' });
  return jobId;
}

/** G23. A page image goes to its own first read instead of resting kept only; a placed or answered item stands. */
async function readPageImageTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard): Promise<string | null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || !['probed', 'reading', 'read'].includes(item.state)) return null;
  return queuePageImageTx(client, source, card, item);
}

// The Word reader keeps its 16 MiB original bound independently of the PDF page profile.
const WORD_ORIGINAL_BYTES = 16 * 1024 ** 2;

/** G10. Words while the document reader reads a batch PDF, and after a stopped or stale read. */
const pdfReading = 'Reading the text layer of each page. Nothing is recorded until you confirm it.';
const pdfStopped = 'The page reader stopped before it finished; the original is kept unchanged with its SHA-256.';
const pdfStale = 'This PDF or its batch changed while it was read; nothing was kept from that read.';
type PdfItemState = Pick<IntakeDraftState, 'state' | 'placement' | 'limitReason'>;
const pdfJobStates: Record<string, PdfItemState> = {
  queued: { state: 'reading', placement: 'undecided', limitReason: pdfReading },
  running: { state: 'reading', placement: 'undecided', limitReason: pdfReading },
  succeeded: { state: 'read', placement: 'undecided',
    limitReason: 'Read earlier. Open its pages to review what the reader found.' },
  stale: { state: 'failed_part', placement: 'not_understood', limitReason: pdfStale },
};

function documentJobWords(format: 'pdf' | 'docx', status: string): PdfItemState {
  if (format === 'pdf') return pdfJobStates[status]
    ?? { state: 'failed_part', placement: 'not_understood', limitReason: pdfStopped };
  const words: Record<string, string> = {
    queued: 'Reading the paragraphs and table cells of this Word document. Nothing is recorded until you confirm it.',
    succeeded: 'Read earlier. Open this Word document to review its paragraphs and table cells.',
    stale: 'This Word document or its batch changed while it was read; nothing was kept from that read.',
    stopped: 'The Word document reader stopped before it finished; the original is kept unchanged with its SHA-256.',
  };
  const next = pdfJobStates[status] ?? { state: 'failed_part', placement: 'not_understood' };
  return { ...next, limitReason: words[status === 'running' ? 'queued' : status] ?? words.stopped };
}

/** Documents share one bounded queue; a later probe finds the same job rather than reading again. */
async function queueBatchPdfTx(client: PoolClient, source: IntakeSourceRow,
  format: 'pdf' | 'docx'): Promise<string | null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.plan_ref
    || !['undecided', 'not_understood'].includes(item.placement)) return null;
  const bytes = Number(source.bytes);
  const kind = format === 'pdf' ? 'PDF document' : 'Word document';
  const reader = format === 'pdf' ? 'page reader' : 'Word document reader';
  const file = format === 'pdf' ? 'PDF' : 'Word document';
  const originalLimit = format === 'pdf' ? DOCUMENT_LIMITS.originalBytes : WORD_ORIGINAL_BYTES;
  const bound = sizeWords(originalLimit);
  if (bytes > originalLimit) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
      planRef: null, recordsSeen: 0, limitReason: `Kept as a ${kind} (${sizeWords(bytes)}). The ${reader} `
        + `in a batch reads a ${file} of at most ${bound}, so this one is not read; `
        + 'the original is kept with its SHA-256.' });
    return null;
  }
  const { jobId, status } = await queueBatchDocumentTx(client, item.case_id, source.id, format);
  const next = { ...documentJobWords(format, status) };
  if (format === 'pdf' && bytes > DOCUMENT_LIMITS.nativeBytes) next.limitReason = textLayerUnread(bytes);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { ...next, planRef: null, recordsSeen: 0 });
  return jobId;
}

const noText = /^PDF page (\d+) has no native text/;
const floorsOrRooms = new RegExp('\\b(?:storeys?|stories|floors?|levels?|basements?|stilts?|rooms?|bedrooms?'
  + '|kitchens?|toilets?|balcon(?:y|ies))\\b|\\bG\\s*\\+\\s*\\d+\\b', 'i');

/** Page numbers as an officer reads them: "page 3", "pages 1–2", "pages 1, 3 and 5–6". */
export function pageWords(pages: readonly number[]): string {
  const runs: string[] = [];
  for (let at = 0; at < pages.length;) {
    let end = at;
    while (end + 1 < pages.length && pages[end + 1] === pages[end] + 1) end++;
    runs.push(end === at ? `${pages[at]}` : `${pages[at]}–${pages[end]}`);
    at = end + 1;
  }
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs.at(-1)}` : runs[0];
  return `${pages.length === 1 ? 'page' : 'pages'} ${list}`;
}

const ascending = (pages: Iterable<number>) => [...new Set(pages)].sort((a, b) => a - b);

/** PL1. The page reader stopped on its byte bound; OCR opens an original within the document bound. */
function textLayerUnread(sourceBytes: number) {
  const unread = `Its text layer is not read above ${sizeWords(DOCUMENT_LIMITS.nativeBytes)}; `
    + 'the original is kept with its SHA-256.';
  if (sourceBytes > DOCUMENT_LIMITS.originalBytes)
    return `${unread} Page opening is limited to ${sizeWords(DOCUMENT_LIMITS.originalBytes)}.`;
  return `${unread} Its pages can be opened to view, and read by OCR for a PDF of at most `
    + `${DOCUMENT_LIMITS.ocrMaxPage} pages; above ${DOCUMENT_LIMITS.ocrBatchPages} pages, choose one page number. `
    + 'Nothing read is a fact until you confirm it.';
}

/**
 * G10. What the page reader found, in an officer's words. Every page has either text parts or a no-text warning,
 * so their union is the page count. A passage naming floors or rooms is a candidate cited to its page and lines,
 * never a value. Scanned pages have no native text; their separate OCR reading is an officer's request. A PDF
 * above the page reader's byte bound has no text layer read; OCR takes an original of up to `originalBytes`.
 */
export function batchPdfSettlement(native: DocumentResult['native'], sourceBytes: number): PdfItemState {
  if (native.status === 'encrypted') return { state: 'read', placement: 'needs_answer', limitReason: 'This PDF is '
    + 'encrypted, so no page was read. Add an unlocked copy to the batch; no password is kept.' };
  if (native.status === 'tool_error') return { state: 'failed_part', placement: 'not_understood',
    limitReason: native.code === 'NATIVE_READER_BYTE_LIMIT' ? textLayerUnread(sourceBytes) : pdfStopped };
  if (native.status === 'unsupported') return { state: 'read', placement: 'not_understood',
    limitReason: 'The page reader could not take this file as a PDF; the original is kept with its SHA-256.' };
  const textPages = ascending(native.parts.flatMap(part => part.locator.page ?? []));
  const scanned = ascending(native.warnings.map(warning => Number(noText.exec(warning)?.[1]))
    .filter(page => Number.isSafeInteger(page) && !textPages.includes(page)));
  const total = textPages.length + scanned.length;
  const words = [`${total} ${total === 1 ? 'page' : 'pages'} read.`];
  if (textPages.length) words.push(`Text was found on ${pageWords(textPages)}.`);
  const one = scanned.length === 1;
  if (scanned.length) words.push(`${pageWords(scanned).replace(/^p/, 'P')} ${one ? 'has' : 'have'} no text layer `
    + '(scanned). Open the PDF reading to request bounded OCR.');
  const named = new Map<string, number>();
  for (const part of native.parts) {
    if (!part.locator.page || !floorsOrRooms.test(part.text)) continue;
    named.set(part.locator.unitId ?? part.id, part.locator.page);
  }
  if (named.size) words.push(`${named.size} ${named.size === 1 ? 'passage' : 'passages'} on `
    + `${pageWords(ascending(named.values()))} name floors, storeys, levels or rooms: candidates cited to their page `
    + 'and lines, for your review.');
  else if (textPages.length) words.push('No passage names floors, storeys, levels or rooms.');
  words.push('Nothing is recorded until you confirm it.');
  return { state: 'read', placement: textPages.length ? 'undecided' : 'not_understood', limitReason: words.join(' ') };
}

/** DOCX units are counted by source locator, not by continuation segments or inferred document values. */
function batchDocxSettlement(native: DocumentResult['native']): PdfItemState {
  if (native.status === 'tool_error') {
    if (native.code !== 'NATIVE_READER_BYTE_LIMIT') return documentJobWords('docx', 'stopped');
    return { state: 'failed_part', placement: 'not_understood', limitReason: 'The Word document reader reads at '
      + `most ${sizeWords(DOCUMENT_LIMITS.nativeBytes)}, so this one was not read; the original is kept with its `
      + 'SHA-256.' };
  }
  if (native.status === 'unsupported' || native.format !== 'docx') return { state: 'read',
    placement: 'not_understood', limitReason: 'The document reader could not take this file as a Word document; '
      + 'the original is kept with its SHA-256.' };
  if (native.status === 'encrypted') return { state: 'read', placement: 'needs_answer',
    limitReason: 'This Word document is encrypted, so it was not read. Add an unlocked copy to the batch; '
      + 'no password is kept.' };
  const paragraphs = new Set<number>();
  const cells = new Set<string>();
  const named = new Set<string>();
  for (const part of native.parts) {
    const { paragraph, table, row, column } = part.locator;
    let citation: string;
    if (paragraph !== undefined) {
      paragraphs.add(paragraph);
      citation = `paragraph ${paragraph}`;
    } else if (table !== undefined && row !== undefined && column !== undefined) {
      citation = `table ${table}, row ${row}, column ${column}`;
      cells.add(citation);
    } else continue;
    if (floorsOrRooms.test(part.text)) named.add(citation);
  }
  const words = [`${zipCountWords(paragraphs.size, 'paragraph')} and ${zipCountWords(cells.size, 'table cell')} read.`];
  if (named.size) words.push(`Passages at ${listWords([...named], 900)} name floors, storeys, levels or rooms: `
    + 'candidates cited to their paragraph or table cell, for your review, not recorded values.');
  else if (paragraphs.size || cells.size) words.push('No passage names floors, storeys, levels or rooms.');
  words.push('Only body paragraphs and direct table cells were read. Drawings, headers, footnotes, nested tables, '
    + 'deleted text and text boxes need separate review.', 'Nothing is recorded until you confirm it.');
  return { state: 'read', placement: paragraphs.size || cells.size ? 'undecided' : 'not_understood',
    limitReason: words.join(' ') };
}

/** A batch document's item, when this source has one in this case. */
async function batchPdfItemTx(client: PoolClient, caseId: string, sourceId: string) {
  const item = await draftItemTx(client, sourceId);
  return item?.case_id === caseId && !item.parent_item_id && item.card && batchDocument(item.card) ? item : null;
}

/** A finished read settles its batch document's item; other sources are left alone. */
export async function settleBatchPdfTx(client: PoolClient, caseId: string, sourceId: string,
  native: DocumentResult['native'], sourceBytes: number) {
  const item = await batchPdfItemTx(client, caseId, sourceId);
  if (!item) return;
  const next = item.card!.format === 'docx' ? batchDocxSettlement(native) : batchPdfSettlement(native, sourceBytes);
  await writeIntakeDraftTx(client, caseId, item.item_id, { ...next, planRef: item.plan_ref, recordsSeen: 0 });
}

/** A stopped or stale document read is said on its batch item; the original stays kept. */
export async function stopBatchPdfTx(client: PoolClient, caseId: string, sourceId: string, stale: boolean) {
  const item = await batchPdfItemTx(client, caseId, sourceId);
  if (item) await writeIntakeDraftTx(client, caseId, item.item_id, {
    ...documentJobWords(item.card!.format as 'pdf' | 'docx', stale ? 'stale' : 'stopped'),
    planRef: item.plan_ref, recordsSeen: 0 });
}

async function enrollDraftTx(client: PoolClient, item: DraftItem, source: IntakeSourceRow,
  tableSelection?: TabularSelection) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-draft:${item.item_id}`]);
  const scope = await intakeCaseTx(client, item.case_id);
  const recipe = (await client.query('SELECT revision FROM usp_mapping_recipes WHERE source_id=$1',
    [source.id])).rows[0];
  const revision = Number(recipe?.revision ?? 0);
  const input = IntakeDraftInputSchema.parse({ version: 'intake-draft/1',
    jobId: intakeDraftKey(item.item_id, revision, 'job'), itemId: item.item_id, caseId: item.case_id,
    caseRevision: scope.current.revision, sourceId: source.id, sourceRevision: source.revision,
    sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding), recipeRevision: revision,
    subject: scope.binding.subject, accessSha256: scope.binding.access,
    ...(tableSelection ? { tableSelection } : {}),
  });
  const prior = await priorJobTx(client, input);
  if (prior) return prior;
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-draft',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  return input.jobId;
}

export type IntakeSourcePins = Pick<IntakeDraftInput, 'itemId' | 'caseId' | 'caseRevision' | 'sourceId'
  | 'sourceRevision' | 'sourceSha256' | 'sourcePin' | 'subject' | 'accessSha256'>;

/** Case-first locking matches recipe execution; source pins remain exact across unrelated case edits.
 * Without `lockCase`, KEY SHARE permits callers' separate readers while ordering the later job's FK lock. */
export async function assertIntakeDraftTx(client: PoolClient, input: IntakeSourcePins, lockCase = true) {
  await lockSourceCaseDestinationTx(client, input.caseId);
  if (!lockCase) await lockCaseEnqueueTx(client, input.caseId);
  const scope = await intakeCaseTx(client, input.caseId, lockCase);
  const { source, binding } = await intakeSourceTx(client, input.caseId, input.sourceId);
  const latest = (await client.query(`SELECT max(revision)::int revision FROM sources
    WHERE case_id=$1 AND family_id=$2`,
    [input.caseId, source.family_id])).rows[0]?.revision;
  if (scope.current.revision < input.caseRevision || binding.subject !== input.subject
    || binding.access !== input.accessSha256 || source.revision !== input.sourceRevision
    || source.sha256 !== input.sourceSha256 || latest !== source.revision
    || intakeSourcePin(source, binding) !== input.sourcePin) conflict('The retained intake source changed.');
  const item = await draftItemTx(client, source.id) ?? notFound('Intake draft item not found.');
  if (item.item_id !== input.itemId || item.case_id !== input.caseId) conflict('The intake draft context changed.');
  return { item, source };
}
