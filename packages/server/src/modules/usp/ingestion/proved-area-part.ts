import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { SourceRangeReferenceSchema, type SourceRangeReference } from '@ulpin/contracts';
import { STREAMING_VECTOR_LIMITS as limits, StreamedMappingReceiptSchema, StreamedMapOriginalReceiptSchema,
  type StreamedMappingPlan, type StreamedMappingReceipt, type StreamingVectorRecord } from '@ulpin/contracts/usp';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { isRetainedMapOriginal } from './retained-map-original';
import { streamingContextTx, StreamingVectorService } from './streaming-vector';
import { loadProvisionalStreamedProfileTx, loadSealedStreamedProfileTx } from './streamed-profile';
import { compileStreamedMapping, assertStreamedIssuerEvidence, loadPrefixSealTx,
  prefixLayoutMatchesSealed, prefixSealCheckKey } from './streamed-mapping';
import { readStreamingFeatures, sourceFeaturePosition, sourceRecord } from './streaming-vector-reader';

export type ProvedAreaPartInput = {
  sourceId: string; sourceRevision: number; sourceSha256: string;
  readerVersion: 'geojson-stream/2'; layoutHash: string; cutIndex: number;
  features: { rawChunkIndex: number; featureIndex: number; rawBytes: Uint8Array }[];
  destination: { namespace: string; name: string; areaId?: string; expectedAreaRevision?: number };
};

/** Internal elapsed-stage observer; no source values or geometry are logged. */
export type PartTiming = (stage: string, ms: number) => void;
export function partStageTimer(timing?: PartTiming) {
  let start = performance.now();
  return (stage: string) => {
    const now = performance.now();
    timing?.(stage, now - start);
    start = now;
  };
}

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
  return { feature, range, position: sourceFeaturePosition(record) };
}

class NumberToken { constructor(readonly source: string) {} }
type SourceReviver = (key: string, value: unknown, context: { source?: string }) => unknown;
const parseTokens = JSON.parse as (text: string, reviver: SourceReviver) => any;

/** A whole-number key is the digits the file writes; a parsed number cannot tell `12` from `12.0`. */
export function assertIntegerKeyTokens(plan: Pick<StreamedMappingPlan, 'operations'>, raws: Uint8Array[]) {
  const key = plan.operations.find(op => op.target.endsWith('.sourceKey'));
  if (key?.conversionId !== 'literal_integer_identifier@1') return;
  const prefix = '/features/*/properties/';
  const field = key.sourcePath.startsWith(prefix)
    ? key.sourcePath.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~') : null;
  for (const raw of raws) {
    const feature = parseTokens(Buffer.from(raw).toString('utf8'),
      (_name, value, context) => typeof value === 'number' ? new NumberToken(context.source ?? '') : value);
    const token = field === null ? feature?.id : feature?.properties?.[field];
    if (!(token instanceof NumberToken) || !/^-?(?:0|[1-9][0-9]*)$/.test(token.source) || token.source === '-0')
      throw new AppError(422, 'PART_INTEGER_IDENTIFIER',
        'Source identity must be complete, unique whole-number tokens within the exact integer range.');
  }
}

/** The same whole-file authority admits open cuts at both the intake and proved-part gates. */
export function assertPartPrefixSealCheck(input: ProvedAreaPartInput, mappingJobId: string,
  check: Record<string, any> | undefined, planHash: string, sealedHash: string) {
  if (planHash !== input.layoutHash || check?.changed !== false || check.mappingJobId !== mappingJobId
    || check.key !== prefixSealCheckKey(planHash, sealedHash, mappingJobId))
    conflict('The approved mapped file has not passed its exact source and key check.');
  const conflicts = new Set<number>(check.conflicts ?? []);
  if (input.features.some(feature => conflicts.has(feature.featureIndex)))
    conflict('Both occurrences of a duplicated source key must stay out of a package.');
}

async function prefixOpenPartTx(client: PoolClient, input: ProvedAreaPartInput, receipt: StreamedMappingReceipt,
  mappingJobId: string, generation: number, records: number) {
  const row = (await client.query(`SELECT m.next_publish_index FROM usp_chunk_mapping_imports m
    JOIN jobs j ON j.id=m.job_id JOIN usp_streaming_vector_imports r ON r.job_id=m.raw_job_id
    WHERE m.job_id=$1 AND m.source_id=$2 AND m.raw_job_id=$3 AND m.source_revision=$4
    AND m.state IN ('queued','running') AND r.sealed_chunks=$5 AND r.records=$6
    AND NOT r.unknown_remainder AND r.state IN ('completed','completed_with_rejections')
    AND j.payload->>'planHash'=$7 AND j.payload->>'recipeId'=$8
    AND (j.payload->>'recipeRevision')::int=$9 AND j.payload->>'sourceSha256'=$10
    AND j.payload->>'rawJobId'=m.raw_job_id::text AND j.payload->>'route'='approved_recipe' FOR SHARE OF m,j,r`,
  [mappingJobId, input.sourceId, receipt.plan.rawJobId, input.sourceRevision, generation, records,
    receipt.planHash, receipt.id, receipt.revision, input.sourceSha256])).rows[0];
  if (!row || input.features.some(feature => feature.rawChunkIndex >= row.next_publish_index))
    conflict('The first-part layout has not passed comparison with this complete file.');
}

async function approvedPartLayoutTx(client: PoolClient, input: ProvedAreaPartInput, source: Record<string, any>) {
  const row = (await client.query('SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2 FOR SHARE',
    [source.case_id, source.id])).rows[0] ?? notFound('The approved streamed layout is unavailable.');
  const receipt = StreamedMappingReceiptSchema.parse(row.body);
  const plan = receipt.plan;
  if (receipt.state !== 'approved' || receipt.planHash !== input.layoutHash
    || receipt.planHash !== fingerprint(plan) || receipt.approval?.planHash !== input.layoutHash
    || receipt.approval?.subject !== localOperatorSubject()
    || plan.source.sourceId !== input.sourceId || plan.source.sourceRevision !== input.sourceRevision
    || plan.source.sourceSha256 !== input.sourceSha256)
    conflict('The proved cut requires this original\'s exact officer-approved sealed layout.');
  const prefix = plan.version === 'streamed-prefix-mapping/1';
  const { profile } = await (prefix ? loadProvisionalStreamedProfileTx : loadSealedStreamedProfileTx)(
    client, plan.profileJobId, plan.profileGeneration, plan.profileHash, plan.rawJobId, source.case_id, source.id);
  if (prefix) {
    const sealed = await loadPrefixSealTx(client, plan);
    const check = source.inspection?.intakePrefixSealCheck;
    const closed = check && (await client.query(`SELECT m.job_id FROM usp_chunk_mapping_imports m
      JOIN jobs j ON j.id=m.job_id WHERE m.job_id=$1 AND m.source_id=$2 AND m.raw_job_id=$3
      AND NOT m.unknown_remainder AND m.sealed_chunks=$4 AND m.next_publish_index=m.sealed_chunks
      AND m.records=$5 AND m.state IN ('completed','completed_with_rejections','needs_input')
      AND j.payload->>'planHash'=$6 AND j.payload->>'recipeId'=$7
      AND (j.payload->>'recipeRevision')::int=$8 FOR SHARE OF m,j`,
    [check.mappingJobId, source.id, plan.rawJobId, sealed.generation, sealed.recordsSeen,
      receipt.planHash, receipt.id, receipt.revision])).rowCount;
    if (!closed && check) {
      await prefixOpenPartTx(client, input, receipt, check.mappingJobId, sealed.generation, sealed.recordsSeen);
      assertPartPrefixSealCheck(input, check.mappingJobId, check, receipt.planHash, sealed.generationHash);
    }
    if (!check || check.changed !== false
      || check.key !== prefixSealCheckKey(receipt.planHash, sealed.generationHash, check.mappingJobId)
      || !prefixLayoutMatchesSealed(plan, profile, sealed))
      conflict('The first-part layout has not passed comparison with this complete file.');
  }
  const mapping = compileStreamedMapping(plan, profile);
  assertStreamedIssuerEvidence(plan, source as { profile: string; inspection: any });
  return { plan, mapping };
}

/** Use the existing authorized raw-payload reader; the caller cannot replace the retained hash with its own. */
async function loadPartFeatures(input: ProvedAreaPartInput, caseId: string, rawJobId: string, sourceBytes: number) {
  if (!input.features.length || input.features.length > 2000)
    throw new AppError(413, 'PART_FEATURE_BOUND', 'A proved part contains 1 to 2000 features.');
  const rawService = new StreamingVectorService();
  const chunks = new Map<number, StreamingVectorRecord[]>();
  const features: Record<string, unknown>[] = [], ranges = new Map<number, SourceRangeReference>();
  const positions: number[] = [];
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
    positions.push(proved.position);
    ranges.set(entry.featureIndex, proved.range);
  }
  return { features, ranges, positions };
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
  assertIntegerKeyTokens(plan, input.features.map(feature => feature.rawBytes));
  return { ...part, mapping, source, metadata: receipt.collectionMetadata };
}
