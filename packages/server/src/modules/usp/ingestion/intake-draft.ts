import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DOCUMENT_LIMITS, STREAMING_VECTOR_LIMITS, type DocumentResult, type IntakeCard } from '@ulpin/contracts/usp';
import { conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { writeIntakeDraftTx, writeIntakeLargeTx, type IntakeDraftState } from './intake-ledger';
import { intakeLargeFailureReason, queueIntakeLargeTx } from './intake-large';
import { queuePageImageTx } from './intake-page-image';
import { batchIfc, queueIntakeIfcTx } from './intake-ifc';
import { stableUuid } from './intake-run';
import { pageImageFormat } from './page-image-read';
import { queueBatchDocumentTx } from './documents';

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeDraftInputSchema = z.strictObject({
  version: z.literal('intake-draft/1'), jobId: uuid, itemId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, sourcePin: hash, recipeRevision: z.number().int().nonnegative(),
  subject: z.string().min(1).max(256), accessSha256: hash,
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

export type NativeDerivativeFormat = 'gpkg' | 'shapefile_zip' | 'shapefile_set' | 'kml' | 'kmz';

/**
 * SH2. The native format a batch card is converted from into GeoJSON layers, or null for any other card. N05: with
 * its original's name, a shapefile card named .shp is the parent of the loose shapefile set of its stem.
 */
export function nativeDerivativeFormat(card: IntakeCard | null, name = ''): NativeDerivativeFormat | null {
  if (card?.format === 'geopackage') return 'gpkg';
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
    || actual.get(member.name)?.sourceId && !zipMemberHasReader(member.format));
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

function zipMemberHasReader(format: string): boolean {
  return ['geojson', 'geopackage', 'kml', 'kmz', 'pdf', 'csv', 'xlsx', 'jpeg', 'png', 'tiff', 'ifc', 'zip',
    'geotiff', 'laz', 'copc'].includes(format);
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
  if (card.family === 'table') return source.profile === 'large-original-v1';
  return card.family !== 'vector' && card.format !== 'zip';
}

/** NU1. What the probe saw of a kept file, from its card's family and format and the original's byte count. */
function keptWords(card: IntakeCard, bytes: number): string {
  if (card.format === 'unknown') return `Kept (${sizeWords(bytes)}); its kind was not recognised from its first `
    + 'and last bytes.';
  const kind = `${keptFormats[card.format] ?? card.format.toUpperCase()} ${keptFamilies[card.family]}`;
  return `Kept as ${/^[AEIO]/.test(kind) ? 'an' : 'a'} ${kind} (${sizeWords(bytes)}). No reader in a batch takes `
    + 'this kind of file yet, so it is not on the map; the original is kept with its SHA-256.';
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
  if (source.profile !== 'geojson-manual-v1' || source.inspection?.manualProfile?.version !== 'manual-geojson/1'
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

/** Caller holds the case; enrollment and probe/approval publication share its transaction. */
export async function queueIntakeDraftTx(client: PoolClient, source: IntakeSourceRow,
  publishedCard?: IntakeCard): Promise<string | null> {
  if (publishedCard?.format === 'zip' && !shapefileZip(publishedCard)) return settleZipParentTx(client, source);
  if (publishedCard?.format === 'pdf' && publishedCard.family === 'document') return queueBatchPdfTx(client, source);
  if (publishedCard && pageImageFormat(publishedCard)) return readPageImageTx(client, source, publishedCard);
  if (batchIfc(source, publishedCard)) return queueIntakeIfcTx(client, source);
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
    || !['probed', 'planned', 'reading'].includes(item.state)) return null;
  if (publishedCard && item.plan_ref) return null;
  if (source.profile === 'large-original-v1' && item.card?.format === 'geojson') {
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

/** G23. A page image goes to its own first read instead of resting kept only; a placed or answered item stands. */
async function readPageImageTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard): Promise<string | null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || !['probed', 'reading', 'read'].includes(item.state)) return null;
  return queuePageImageTx(client, source, card, item);
}

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

/**
 * G10. A probed PDF is read by the existing document reader, on its text layer only. Above the reader's byte bound
 * it rests kept, in words. A later probe finds the same job and says where that job stands.
 */
async function queueBatchPdfTx(client: PoolClient, source: IntakeSourceRow): Promise<string | null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.plan_ref
    || !['undecided', 'not_understood'].includes(item.placement)) return null;
  const bytes = Number(source.bytes);
  if (bytes > DOCUMENT_LIMITS.originalBytes) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
      planRef: null, recordsSeen: 0, limitReason: `Kept as a PDF document (${sizeWords(bytes)}). The page reader `
        + `in a batch reads a PDF of at most ${sizeWords(DOCUMENT_LIMITS.originalBytes)}, so this one is not read; `
        + 'the original is kept with its SHA-256.' });
    return null;
  }
  const { jobId, status } = await queueBatchDocumentTx(client, item.case_id, source.id);
  const next = pdfJobStates[status] ?? { state: 'failed_part', placement: 'not_understood', limitReason: pdfStopped };
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

/**
 * G10. What the page reader found, in an officer's words. Every page has either text parts or a no-text warning,
 * so their union is the page count. A passage naming floors or rooms is a candidate cited to its page and lines,
 * never a value; a page with no text layer is said to be scanned and unread, as no OCR runs in a batch.
 */
export function batchPdfSettlement(native: DocumentResult['native']): PdfItemState {
  if (native.status === 'encrypted') return { state: 'read', placement: 'needs_answer', limitReason: 'This PDF is '
    + 'encrypted, so no page was read. Add an unlocked copy to the batch; no password is kept.' };
  if (native.status === 'tool_error') return { state: 'failed_part', placement: 'not_understood',
    limitReason: native.code === 'NATIVE_READER_BYTE_LIMIT' ? 'The page reader reads a PDF of at most '
      + `${sizeWords(DOCUMENT_LIMITS.nativeBytes)}, so this one is not read; the original is kept with its SHA-256.`
      : pdfStopped };
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
    + `(scanned), so the words on ${one ? 'it' : 'them'} are not read; no OCR runs in a batch.`);
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

/** G10. A batch PDF's item, when this source has one in this case. */
async function batchPdfItemTx(client: PoolClient, caseId: string, sourceId: string) {
  const item = await draftItemTx(client, sourceId);
  return item?.case_id === caseId && item.card?.format === 'pdf' ? item : null;
}

/** G10. A finished document read settles its batch PDF's item; a source with no PDF item is left alone. */
export async function settleBatchPdfTx(client: PoolClient, caseId: string, sourceId: string,
  native: DocumentResult['native']) {
  const item = await batchPdfItemTx(client, caseId, sourceId);
  if (item) await writeIntakeDraftTx(client, caseId, item.item_id, { ...batchPdfSettlement(native),
    planRef: item.plan_ref, recordsSeen: 0 });
}

/** G10. A stopped or stale document read is said on its batch PDF's item; the original stays kept. */
export async function stopBatchPdfTx(client: PoolClient, caseId: string, sourceId: string, stale: boolean) {
  const item = await batchPdfItemTx(client, caseId, sourceId);
  if (item) await writeIntakeDraftTx(client, caseId, item.item_id, { state: 'failed_part',
    placement: 'not_understood', planRef: item.plan_ref, recordsSeen: 0, limitReason: stale ? pdfStale : pdfStopped });
}

async function enrollDraftTx(client: PoolClient, item: DraftItem, source: IntakeSourceRow) {
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
 * Without `lockCase` the case row is left to callers whose readers share-lock it in their own transactions. */
export async function assertIntakeDraftTx(client: PoolClient, input: IntakeSourcePins, lockCase = true) {
  await lockSourceCaseDestinationTx(client, input.caseId);
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
