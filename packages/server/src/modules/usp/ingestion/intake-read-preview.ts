import { z } from 'zod';
import { IntakeReadPreviewPageSchema, StreamedMapOriginalReceiptSchema, STREAMING_VECTOR_LIMITS,
  type IntakeReadPreviewPage } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, notFound } from '../../../infrastructure/errors';
import { assertIngestionBinding } from './events';
import { intakeSourceTx } from './intake-context';
import { intakeLargeRequestKey, intakeReadGenerationTx } from './intake-large';
import { intakeGeojsonFraming } from './geojson-framing';
import { featureExtent, measurableCrs, type SourceCrs } from './intake-package-extent';
import { StreamingVectorService } from './streaming-vector';

const uuid = z.string().uuid();
const query = z.strictObject({
  after: z.coerce.number().int().min(-1).max(STREAMING_VECTOR_LIMITS.features).optional(),
});
const previewWords = 'Preview of the outlines read so far; not a record, not reviewed, not placed. ';
const crsWords = 'The preview needs a stated, supported CRS; the file’s coordinate system is unsupported or unread. ';
const rfc7946Words = 'No coordinate system is stated so far, so the outlines are drawn as longitude and latitude '
  + '(RFC 7946); a later statement in the file replaces this preview. ';
const sequenceWords = 'GeoJSON sequences have no collection members; the outlines use longitude and latitude '
  + '(RFC 7946). ';
const outsideWords = 'Some outlines are not in longitude and latitude and wait for the file\'s '
  + 'stated coordinate system.';
const coordinateBytes = 4 * 1024 * 1024;
type Dependencies = { transaction: typeof transaction; reader: Pick<StreamingVectorService, 'status' | 'chunk'> };
type PreviewCrs = { crs: SourceCrs | null; basis: IntakeReadPreviewPage['crsBasis'] };

function previewCrs(inspection: Record<string, any> | null, card: any, source: { id: string; revision: number;
  sha256: string; bytes: string | number }, rawJobId: string, framing: string): PreviewCrs {
  const receipt = StreamedMapOriginalReceiptSchema.safeParse(inspection?.streamedMapReceipt);
  if (receipt.success && receipt.data.rawJobId === rawJobId && receipt.data.sourceId === source.id
    && receipt.data.sourceRevision === source.revision && receipt.data.sourceSha256 === source.sha256
    && receipt.data.sourceBytes === Number(source.bytes) && receipt.data.framing === framing) {
    const crs = measurableCrs(receipt.data.collectionMetadata);
    return { crs, basis: crs ? 'sealed' : 'unsupported' };
  }
  // A sequence has no collection declaration; its exact-job receipt still needs to seal the whole read.
  if (framing !== 'feature-collection') return { crs: measurableCrs({}), basis: 'rfc7946_no_crs_read_yet' };
  // RFC 7946 is provisional here: an exact-job sealed declaration replaces this basis.
  if (card?.crs?.state === 'absent') return { crs: measurableCrs({}), basis: 'rfc7946_no_crs_read_yet' };
  if (card?.crs?.state !== 'stated' || !card.crs.code) return { crs: null, basis: 'unsupported' };
  const crs = measurableCrs({ crs: { type: 'name', properties: { name: card.crs.code } } });
  return { crs, basis: crs ? 'stated' : 'unsupported' };
}

function previewGeometry(feature: unknown, crs: SourceCrs, rfc7946: boolean) {
  const value = feature as Record<string, any>;
  const extent = featureExtent(value, crs);
  if (!extent) return null;
  const [west, south, east, north] = extent.bounds;
  if (rfc7946 && (west < -180 || east > 180 || south < -90 || north > 90)) return 'outside_degrees';
  let index = 0;
  const reshape = (coordinates: any[]): any[] => {
    if (typeof coordinates[0] !== 'number') return coordinates.map(reshape);
    const point = extent.geographic.slice(index, index + 2);
    index += 2;
    return point;
  };
  return { type: value.geometry.type, coordinates: reshape(value.geometry.coordinates) };
}

function readerWords(status: string) {
  if (['queued', 'running'].includes(status)) return 'Packages follow when the whole file is read and checked.';
  if (['completed', 'completed_with_rejections'].includes(status))
    return 'The reader has finished. See the packages when the whole file has been read and checked.';
  return 'The reader has stopped. Packages wait for the whole-file checks.';
}

/** Only stored rows and authorized published raw parts; never opens the original or starts preparation. */
export async function readIntakeReadPreview(caseIdValue: string, itemIdValue: string, value: unknown = {},
  deps: Dependencies = { transaction, reader: new StreamingVectorService() }): Promise<IntakeReadPreviewPage> {
  const caseId = uuid.parse(caseIdValue), itemId = uuid.parse(itemIdValue), after = query.parse(value).after ?? -1;
  const context = await deps.transaction(async client => {
    const item = (await client.query('SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2',
      [caseId, itemId])).rows[0] ?? notFound('Intake item not found in this case.');
    const { source, binding } = await intakeSourceTx(client, caseId, item.source_id);
    const framing = item.card && intakeGeojsonFraming(item.card);
    if (item.parent_item_id !== null || source.profile !== 'large-original-v1' || !framing
      || Number(source.bytes) > STREAMING_VECTOR_LIMITS.sourceBytes)
      throw new AppError(422, 'INTAKE_READ_PREVIEW_ITEM', 'Only a top-level retained GeoJSON has a read preview.');
    const generation = await intakeReadGenerationTx(client, caseId, itemId);
    const operation = (await client.query(`SELECT result->>'jobId' job_id FROM operations
      WHERE case_id=$1 AND operation_key=$2 AND kind='streaming-vector'`,
    [caseId, `streaming-vector:${intakeLargeRequestKey(itemId, 'reader', 0, generation)}`])).rows[0];
    if (!operation) notFound('The file has no published reader parts yet.');
    return { source, binding, card: item.card, framing, rawJobId: uuid.parse(operation.job_id) };
  });
  const { source, rawJobId, binding } = context;
  const status = await deps.reader.status(caseId, source.id, rawJobId);
  if (status.sourceRevision !== source.revision || status.sourceSha256 !== source.sha256
    || status.framing !== context.framing)
    throw new AppError(409, 'INTAKE_READ_PREVIEW_PIN', 'The reader differs from this retained GeoJSON.');
  if (status.issueCode === 'STREAMING_SOURCE_INTEGRITY')
    throw new AppError(422, 'STREAMING_SOURCE_INTEGRITY', 'The retained original failed its pinned integrity check.');
  if (!status.nextPublishIndex) notFound('The file has no published reader parts yet.');
  const reading = ['queued', 'running'].includes(status.status);
  const { crs, basis } = previewCrs(source.inspection, context.card, source, rawJobId, context.framing);
  let referenceWords = '';
  if (!crs) referenceWords = crsWords;
  if (context.framing !== 'feature-collection') referenceWords = sequenceWords;
  else if (basis === 'rfc7946_no_crs_read_yet') referenceWords = rfc7946Words;
  const page: IntakeReadPreviewPage = { itemId, sourceId: source.id, sourceRevision: source.revision,
    sourceSha256: source.sha256, rawJobId, chunksRead: status.nextPublishIndex, reading, crsBasis: basis,
    features: [], next: null, words: previewWords + referenceWords + readerWords(status.status) };
  if (crs) await appendFeatures(caseId, after, page, crs, deps);
  assertIngestionBinding(binding);
  return IntakeReadPreviewPageSchema.parse(page);
}

async function appendFeatures(caseId: string, after: number, page: IntakeReadPreviewPage, crs: SourceCrs,
  deps: Dependencies) {
  // Bound raw-part work as well as the response, including sparse or quarantined prefixes.
  const slots = await deps.transaction(async client => (await client.query(`SELECT chunk_index FROM
    usp_streaming_vector_slots WHERE job_id=$1 AND published=true AND chunk_index<$2
    AND last_feature_index>$3 ORDER BY chunk_index LIMIT 32`, [page.rawJobId, page.chunksRead, after])).rows);
  let scanned = after, bytes = 0;
  for (const slot of slots) {
    const chunk = await deps.reader.chunk(caseId, page.sourceId, page.rawJobId, slot.chunk_index);
    for (const record of chunk.payload?.records ?? []) {
      if (record.featureIndex <= after) continue;
      if (record.disposition === 'accepted') {
        const geometry = previewGeometry(record.feature, crs, page.crsBasis === 'rfc7946_no_crs_read_yet');
        if (geometry === 'outside_degrees') {
          if (!page.words.endsWith(outsideWords)) page.words += ' ' + outsideWords;
        } else if (geometry) {
          const size = Buffer.byteLength(JSON.stringify(geometry));
          if (page.features.length === 2000 || bytes + size > coordinateBytes) {
            page.next = scanned;
            return;
          }
          page.features.push({ featureIndex: record.featureIndex, geometry } as
            IntakeReadPreviewPage['features'][number]);
          bytes += size;
        }
      }
      scanned = record.featureIndex;
    }
    // Slots with no payload are wholly quarantined, but still advance the scan cursor.
    scanned = Math.max(scanned, chunk.slot.lastFeatureIndex ?? scanned);
  }
  if (scanned >= 0 && (page.reading || slots.length === 32)) page.next = scanned;
}
