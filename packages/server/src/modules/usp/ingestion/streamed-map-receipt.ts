import type { PoolClient } from 'pg';
import { StreamedMapOriginalReceiptSchema, STREAMING_VECTOR_LIMITS as limits,
  type StreamingVectorInput, type StreamedMapOriginalReceipt } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { areaGeo } from '../../areas/areas';
import { fingerprint } from '../../cases/domain';

type Slot = {
  chunk_index: number; first_feature_index: number; last_feature_index: number; records: number;
  accepted: number; quarantined: number; published: boolean; result_sha256: string;
};
/** `quarantinedByCode` is the reader's tally of its set-aside records; a receipt that sets any aside requires it. */
type Closure = { bytes: number; sha256: string; features: number; metadata: Record<string, unknown>;
  quarantinedByCode?: Record<string, number> };
type Reference = StreamedMapOriginalReceipt['reference'];
type Resolved = { declared: string | null; authority: string; unit: string };

/** A declaration is retained as evidence; projected coordinates never acquire degree units. */
export function streamedSourceReference(metadata: Record<string, unknown>): StreamedMapOriginalReceipt['reference'] {
  if (!Object.hasOwn(metadata, 'crs')) return {
    sourceCrs: 'EPSG:4326', evidence: 'Original has no crs member; RFC 7946 longitude/latitude assumption.',
    coordinateUnit: 'degree',
  };
  const crs = metadata.crs as { type?: unknown; properties?: { name?: unknown } } | null;
  const name = crs?.type === 'name' ? crs.properties?.name : null;
  if (typeof name !== 'string' || name.length > 100 || !name.length) return {
    sourceCrs: null, evidence: 'Original crs member has an unsupported declaration; no coordinate system assumed.',
    coordinateUnit: 'unknown',
  };
  const degree = ['EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'OGC:CRS84'].includes(name);
  return { sourceCrs: name, evidence: `Original crs.properties.name: ${name}`,
    coordinateUnit: degree ? 'degree' : 'unknown' };
}

/** CR1's resolver words each refusal of a declaration this way (`services/geo/geo/area.py` `_geojson_crs`). */
const RESOLVER_REFUSAL = "The file's crs member declares ";

/** Only the resolver's own refusal of the declaration (a 422 in its words) names the coordinate system; another
 * failure of the call is a fault the reader retries under its own code. */
function resolverFailure(error: unknown) {
  if (!(error instanceof AppError) || error.status !== 422) return error;
  if (error.message.startsWith(RESOLVER_REFUSAL)) return new AppError(422, 'STREAMING_SOURCE_CRS', error.message);
  return new Error('The coordinate system resolution failed.');
}

/** CR1's resolution in the geo service decides; nothing is resolved or transformed here. A file that declares
 * nothing, and the legacy degree declarations, keep the reference they had before. */
export async function resolveStreamedReference(metadata: Record<string, unknown>,
  resolve = (collection: Record<string, unknown>) => areaGeo<Resolved>('resolve-geojson-crs', { collection })) {
  const legacy = streamedSourceReference(metadata);
  if (!Object.hasOwn(metadata, 'crs')) return legacy;
  let resolved: Resolved;
  try { resolved = await resolve({ crs: metadata.crs }); }
  catch (error) { throw resolverFailure(error); }
  if (legacy.coordinateUnit === 'degree' && resolved.unit === 'degree') return legacy;
  if (!resolved.declared || resolved.declared.length > 100)
    throw new AppError(422, 'STREAMING_SOURCE_CRS', 'The declared coordinate system name exceeds 100 characters.');
  return { sourceCrs: resolved.declared, evidence: `Declared in the file's crs member: \`${resolved.declared}\``,
    coordinateUnit: resolved.unit, authority: resolved.authority } satisfies Reference;
}

/** Sequences have no collection members that could declare or later replace their RFC 7946 reference. */
export function streamedSequenceReference(): Reference {
  return { sourceCrs: 'EPSG:4326', coordinateUnit: 'degree',
    evidence: 'GeoJSON sequence states no coordinate system; read as RFC 7946 longitude and latitude.' };
}

/** Ordered slot hashes prove the exact retained raw manifest, not just its feature count. */
export function sealedMapReceipt(input: StreamingVectorInput, closure: Closure, slots: Slot[],
  reference: Reference = input.framing === 'feature-collection'
    ? streamedSourceReference(closure.metadata) : streamedSequenceReference()) {
  if (input.framing !== 'feature-collection') {
    if (Object.keys(closure.metadata).length) conflict('A GeoJSON sequence has no collection members.');
    reference = streamedSequenceReference();
  }
  if (closure.bytes !== input.sourceBytes
    || closure.sha256 !== input.sourceSha256 || !closure.features || !slots.length
    || slots.length > limits.chunks) conflict('The raw reader has not verified this complete map original.');
  let records = 0, accepted = 0, quarantined = 0;
  for (const [index, slot] of slots.entries()) {
    if (!slot.published || slot.chunk_index !== index || slot.records < 1 || slot.records > limits.chunkFeatures
      || slot.first_feature_index !== records || slot.last_feature_index !== records + slot.records - 1
      || slot.accepted + slot.quarantined !== slot.records || !/^[a-f0-9]{64}$/.test(slot.result_sha256))
      conflict('The retained raw manifest is not a contiguous sealed prefix.');
    records += slot.records;
    accepted += slot.accepted;
    quarantined += slot.quarantined;
  }
  if (records !== closure.features) conflict('The retained raw manifest does not close at semantic EOF.');
  return StreamedMapOriginalReceiptSchema.parse({
    version: 'streamed-map-original/1', coverage: 'sealed', unknownRemainder: false,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceBytes: input.sourceBytes,
    sourceSha256: input.sourceSha256, readerVersion: input.version, rawJobId: input.jobId,
    framing: input.framing, parts: slots.length, features: records, accepted, quarantined,
    ...(quarantined ? { quarantinedByCode: closure.quarantinedByCode ?? {} } : {}),
    collectionMetadata: closure.metadata,
    rawManifestSha256: fingerprint({ readerVersion: input.version, sourceId: input.sourceId,
      sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, slots }),
    reference,
  });
}

/** Called inside fenced result acceptance; a failed or partial reader cannot write this receipt. */
export async function writeSealedMapReceiptTx(client: PoolClient, input: StreamingVectorInput, closure: Closure,
  reference?: Reference) {
  const source = (await client.query('SELECT * FROM sources WHERE id=$1 FOR UPDATE', [input.sourceId])).rows[0];
  if (source?.profile !== 'large-original-v1') return;
  const state = (await client.query('SELECT * FROM usp_streaming_vector_imports WHERE job_id=$1 FOR SHARE',
    [input.jobId])).rows[0];
  if (source.case_id !== input.caseId || source.revision !== input.sourceRevision
    || source.sha256 !== input.sourceSha256 || Number(source.bytes) !== input.sourceBytes
    || source.object_key !== input.objectKey || !state || state.unknown_remainder
    || !['completed', 'completed_with_rejections'].includes(state.state))
    conflict('The exact source or sealed reader changed before the map receipt.');
  const slots = (await client.query(`SELECT chunk_index,first_feature_index,last_feature_index,records,
    accepted,quarantined,published,result_sha256 FROM usp_streaming_vector_slots
    WHERE job_id=$1 AND source_revision=$2 ORDER BY chunk_index`, [input.jobId, input.sourceRevision])).rows;
  const receipt = sealedMapReceipt(input, closure, slots, reference);
  if (receipt.reference.coordinateUnit === 'unknown')
    throw new AppError(422, 'STREAMING_SOURCE_CRS', "The file's coordinate system declaration was not resolved.");
  if (state.sealed_chunks !== receipt.parts || state.next_publish_index !== receipt.parts
    || state.records !== receipt.features || state.accepted !== receipt.accepted
    || state.quarantined !== receipt.quarantined) conflict('The reader totals differ from its sealed manifest.');
  await client.query(`UPDATE sources SET inspection=jsonb_set(inspection,'{streamedMapReceipt}',$2::jsonb)
    WHERE id=$1`, [input.sourceId, JSON.stringify(receipt)]);
}
