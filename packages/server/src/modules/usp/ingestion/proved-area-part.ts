import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { SourceRangeReferenceSchema, type SourceRangeReference } from '@ulpin/contracts';
import { STREAMING_VECTOR_LIMITS as limits, StreamedMappingReceiptSchema, StreamedMapOriginalReceiptSchema,
  type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import type { Mapping } from '../../areas/areas';
import { localOperatorSubject } from '../principal';
import { isRetainedMapOriginal } from './retained-map-original';
import { streamingContextTx, StreamingVectorService } from './streaming-vector';
import { loadSealedStreamedProfileTx } from './streamed-profile';
import { compileStreamedMapping, assertStreamedIssuerEvidence } from './streamed-mapping';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';

export type ProvedAreaPartInput = {
  sourceId: string; sourceRevision: number; sourceSha256: string;
  readerVersion: 'geojson-stream/2'; layoutHash: string; cutIndex: number;
  features: { rawChunkIndex: number; featureIndex: number; rawBytes: Uint8Array }[];
  destination: { namespace: string; name: string; areaId?: string; expectedAreaRevision?: number };
};

export function provedPartOperationKey(input: ProvedAreaPartInput): string {
  if (!Number.isSafeInteger(input.cutIndex) || input.cutIndex < 0 || input.readerVersion !== limits.version)
    throw new AppError(422, 'PART_CUT_IDENTITY', 'Choose a valid cut index and the retained reader version.');
  return fingerprint({ version: 'proved-area-part/1', sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, readerVersion: input.readerVersion,
    layoutHash: input.layoutHash, cutIndex: input.cutIndex });
}

/** The hash is from the immutable reader payload, never from a reserialized parsed Feature. */
export async function provePartFeature(record: StreamingVectorRecord, bytes: Uint8Array, sourceBytes: number) {
  const range = SourceRangeReferenceSchema.parse({ format: 'geojson', featureIndex: record.featureIndex,
    byteStart: record.byteStart,
    byteEnd: record.byteEnd, rawSha256: record.rawSha256, readerVersion: limits.version });
  if (record.disposition !== 'accepted' || range.byteEnd > sourceBytes
    || bytes.length !== range.byteEnd - range.byteStart || bytes.length > limits.featureBytes
    || sha256(bytes) !== range.rawSha256)
    throw new AppError(422, 'PART_RAW_INTEGRITY',
      'The exact raw feature bytes differ from their retained reader record.');
  let feature: Record<string, unknown> | undefined;
  await readStreamingFeatures(Readable.from([
    Buffer.from('{"type":"FeatureCollection","features":['), Buffer.from(bytes), Buffer.from(']}'),
  ]), 'feature-collection', async item => {
    if (item.index !== 0 || sourceRecord(item).disposition !== 'accepted'
      || !isDeepStrictEqual(item.feature, record.feature))
      throw new AppError(422, 'PART_RAW_INTEGRITY', 'The raw span is not this one unchanged accepted Feature.');
    feature = item.feature as Record<string, unknown>;
  });
  if (!feature) throw new AppError(422, 'PART_RAW_INTEGRITY', 'The raw span contains no accepted Feature.');
  return { feature, range };
}

async function approvedPartLayoutTx(client: PoolClient, input: ProvedAreaPartInput, source: Record<string, any>) {
  const row = (await client.query('SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2 FOR SHARE',
    [source.case_id, source.id])).rows[0] ?? notFound('The approved streamed layout is unavailable.');
  const receipt = StreamedMappingReceiptSchema.parse(row.body);
  const plan = receipt.plan;
  if (receipt.state !== 'approved' || receipt.planHash !== input.layoutHash
    || receipt.planHash !== fingerprint(plan) || receipt.approval?.planHash !== input.layoutHash
    || receipt.approval?.subject !== localOperatorSubject() || plan.version !== 'streamed-mapping/1'
    || plan.source.sourceId !== input.sourceId || plan.source.sourceRevision !== input.sourceRevision
    || plan.source.sourceSha256 !== input.sourceSha256)
    conflict('The proved cut requires this original\'s exact officer-approved sealed layout.');
  const { profile } = await loadSealedStreamedProfileTx(client, plan.profileJobId, plan.profileGeneration,
    plan.profileHash, plan.rawJobId, source.case_id, source.id);
  compileStreamedMapping(plan, profile);
  assertStreamedIssuerEvidence(plan, source as { profile: string; inspection: any });
  const mapping: Mapping = { kind: 'building', geometryRole: 'unknown' };
  for (const op of plan.operations) {
    if (op.sourcePath === '/features/*/id' || op.target === 'building.geometry') continue;
    const field = op.sourcePath.slice('/features/*/properties/'.length).replaceAll('~1', '/').replaceAll('~0', '~');
    if (op.target === 'building.sourceKey') mapping.idField = field;
    if (op.target === 'building.name') mapping.nameField = field;
  }
  return { plan, mapping };
}

/** Use the existing authorized raw-payload reader; the caller cannot replace the retained hash with its own. */
async function loadPartFeatures(input: ProvedAreaPartInput, caseId: string, rawJobId: string, sourceBytes: number) {
  if (!input.features.length || input.features.length > 2000)
    throw new AppError(413, 'PART_FEATURE_BOUND', 'A proved part contains 1 to 2000 features.');
  const rawService = new StreamingVectorService();
  const chunks = new Map<number, StreamingVectorRecord[]>();
  const features: Record<string, unknown>[] = [], ranges = new Map<number, SourceRangeReference>();
  let previous = -1;
  for (const entry of input.features) {
    if (!Number.isSafeInteger(entry.rawChunkIndex) || entry.rawChunkIndex < 0 || entry.featureIndex <= previous)
      conflict('The proved cut must follow the original global feature order.');
    previous = entry.featureIndex;
    if (!chunks.has(entry.rawChunkIndex)) {
      const chunk = await rawService.chunk(caseId, input.sourceId, rawJobId, entry.rawChunkIndex);
      if (!chunk.current || !chunk.sourceComplete || chunk.unknownRemainder || !chunk.payload)
        conflict('The raw part is not from the exact closed retained original.');
      chunks.set(entry.rawChunkIndex, chunk.payload.records);
    }
    const record = chunks.get(entry.rawChunkIndex)!.find(value => value.featureIndex === entry.featureIndex);
    if (!record) conflict('The global feature index is not in the retained raw part.');
    const proved = await provePartFeature(record, entry.rawBytes, sourceBytes);
    features.push(proved.feature);
    ranges.set(entry.featureIndex, proved.range);
  }
  return { features, ranges };
}

/** This internal preparation does not store a new original or make any registry observation ready. */
export async function prepareProvedAreaPartTx(client: PoolClient, input: ProvedAreaPartInput) {
  const row = (await client.query('SELECT case_id FROM sources WHERE id=$1', [input.sourceId])).rows[0]
    ?? notFound('The retained original is unavailable.');
  const { source, latest } = await streamingContextTx(client, row.case_id, input.sourceId, true);
  if (!latest || !isRetainedMapOriginal(source) || source.profile !== 'large-original-v1'
    || source.revision !== input.sourceRevision || source.sha256 !== input.sourceSha256)
    conflict('The exact sealed retained original changed before part import.');
  const receipt = StreamedMapOriginalReceiptSchema.parse(source.inspection.streamedMapReceipt);
  const { plan, mapping } = await approvedPartLayoutTx(client, input, source);
  if (plan.rawJobId !== receipt.rawJobId || input.readerVersion !== receipt.readerVersion)
    conflict('The approved layout and receipt name different raw readers.');
  const part = await loadPartFeatures(input, source.case_id, plan.rawJobId, Number(source.bytes));
  return { ...part, mapping, source, metadata: receipt.collectionMetadata };
}
