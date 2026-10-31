import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ArchiveMemberLineageSchema, IntakeArchiveReceiptSchema, IntakeArchiveRetainSchema, LARGE_ORIGINAL_LIMITS,
  INTAKE_PROBE_LIMITS, STREAMING_VECTOR_LIMITS, ZIP_LAYER_LIMITS, streamingReadMs, type AnySourceProfile,
  type ArchiveMemberLineage, type IntakeCard, type TableDerivativeLineage,
  type CellDerivativeLineage } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { putOriginal, readObjectRange, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { originalAttempt } from '../../cases/original-attempt';
import { DISPATCH_HEAD_OF_LINE_MS } from '../../cases/dispatch-lanes';
import { appendCaseIngestionTx, appendIntakeItemTx, ingestionBinding, assertIngestionBinding } from './events';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { zipParentWords, type ZipLayerStage } from './intake-draft';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { detectIntakeKind } from './intake-signatures';
import { locateZipMember, readZipMember, streamZipMember } from './intake-zip';
import { LargeLayerLineageSchema, type LargeOriginalService } from './large-original';
import { lockUnassignedSourceCase } from './service';
import type { NativeDerivativeLineage } from './intake-native-derivative';
import { gzipParentWords } from './intake-text';
import { GzipMemberError, gzipMemberName, inspectGzipMember, streamGzipMember } from './intake-gzip-member';

export const ZIP_ARCHIVE_PROFILE = 'zip-manual-v1';
const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeZipLayersInputSchema = z.strictObject({
  version: z.literal('intake-zip-layers/1'), jobId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), itemId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hex64, sourcePin: hex64,
  subject: z.string().min(1).max(256), accessSha256: hex64,
});
export type IntakeZipLayersInput = z.infer<typeof IntakeZipLayersInputSchema>;
// A member read may page a large archive's directory and up to 17 one-MiB ranges.
const MEMBER_READ_MS = 60_000;
// One outer bound from the archive's immutable retain time; re-enrolment never starts it again.
export const ZIP_RECEIPT_WAIT_MS = 30 * 60_000;

function archiveReceipt(row: IntakeSourceRow) {
  return IntakeArchiveReceiptSchema.parse({ sourceId: row.id, sourceRevision: row.revision, sha256: row.sha256,
    bytes: Number(row.bytes) });
}

async function priorTx(client: PoolClient, caseId: string, key: string, digest: string) {
  const prior = (await client.query(`SELECT payload_hash,result FROM operations
    WHERE case_id=$1 AND operation_key=$2 AND kind='intake'`, [caseId, key])).rows[0];
  if (prior && prior.payload_hash !== digest) conflict('This archive request key names different inputs or access.');
  return prior?.result;
}

/** Retains a ZIP of at most 16 MiB unchanged, for enrolment in a batch. Larger ZIPs arrive through /uploads. */
export class IntakeArchiveService {
  async retain(caseValue: string, raw: unknown, file: { name: string; bytes: Uint8Array }) {
    const caseId = uuid.parse(caseValue);
    const input = IntakeArchiveRetainSchema.parse(raw);
    const binding = ingestionBinding(caseId);
    if (!file.bytes.length || file.bytes.length > ZIP_LAYER_LIMITS.archiveBytes) throw new AppError(413,
      'ARCHIVE_SIZE', 'Choose a nonempty ZIP of at most 16 MiB here; a larger ZIP is retained through the uploads route.');
    if (detectIntakeKind(file.bytes.subarray(0, 64)).format !== 'zip') {
      throw new AppError(422, 'ARCHIVE_FORMAT', 'This file is not a ZIP archive.');
    }
    const hash = sha256(file.bytes);
    const key = `intake-archive:${input.requestKey}`;
    const sourceId = randomUUID();
    const objectKey = `sources/${sourceId}/${hash}`;
    return originalAttempt('sources', sourceId, async rememberOriginal => transaction(async client => {
      assertIngestionBinding(binding);
      await intakeCaseTx(client, caseId, true);
      const scope = await lockUnassignedSourceCase(client, caseId);
      const digest = fingerprint({ input, name: file.name, hash, subject: binding.subject });
      const prior = await priorTx(client, caseId, key, digest);
      if (prior) return IntakeArchiveReceiptSchema.parse(prior);
      const duplicate = (await client.query(`SELECT * FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3
        ORDER BY revision DESC LIMIT 1`, [caseId, hash, ZIP_ARCHIVE_PROFILE])).rows[0];
      let result;
      if (duplicate) result = archiveReceipt((await intakeSourceTx(client, caseId, duplicate.id)).source);
      else {
        // Retention appends an original; sibling arrivals and table readings do not change its pins.
        if (scope.revision < input.expectedWorkspaceRevision) {
          conflict('The source case changed; refresh before retaining another original.');
        }
        assertIngestionBinding(binding);
        rememberOriginal(objectKey);
        await putOriginal(objectKey, file.bytes, 'application/zip');
        await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
          object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,'application/zip',$5,$6,$7,'needs_input',$8)`,
        [sourceId, caseId, file.name, ZIP_ARCHIVE_PROFILE, file.bytes.length, hash, objectKey,
          { profile: ZIP_ARCHIVE_PROFILE, status: 'needs_input', issues: [],
            summary: 'ZIP original retained unchanged; bounded members are kept as their own child originals.',
            actor: binding.subject }]);
        await client.query('UPDATE cases SET revision=revision+1,updated_at=now() WHERE id=$1', [caseId]);
        await appendCaseIngestionTx(client, caseId,
          { kind: 'source.retained', sourceId, sourceRevision: 1, status: 'needs_input' }, binding.subject);
        result = archiveReceipt((await intakeSourceTx(client, caseId, sourceId)).source);
      }
      await client.query(`INSERT INTO operations(case_id,operation_key,kind,payload_hash,result)
        VALUES($1,$2,'intake',$3,$4)`, [caseId, key, digest, result]);
      assertIngestionBinding(binding);
      return result;
    }));
  }
}

export type ZipLayerDependencies = {
  transaction: typeof transaction;
  read: typeof readObjectRange;
  register: (caseId: string, input: unknown) => Promise<unknown>;
  retain: (caseId: string, input: unknown, file: { name: string; bytes: Uint8Array },
    lineage: ArchiveMemberLineage) => Promise<AnySourceProfile>;
  retainMember: (caseId: string, revision: number, file: { name: string; bytes: Uint8Array },
    lineage: ArchiveMemberLineage) => Promise<string>;
  /** The byte receipt /uploads uses; a layer above the member bound is retained through it as a large original. */
  large: Pick<LargeOriginalService,
    'create' | 'claimPart' | 'receivePart' | 'failPart' | 'finalize' | 'abort' | 'findDerived'>;
};

type MemberRow = { item_id: string; member_path: string; source_id: string | null; size_bytes: string | null;
  card: IntakeCard | null; limit_reason: string | null };
type Kept = { member: MemberRow; sourceId: string };

/** Shapefile sets keep their existing grouped reader; every other safe member gets its own enrolment. */
export function zipLayerMembers(card: IntakeCard | null, members: MemberRow[]): MemberRow[] {
  if (card?.format === 'gzip') return members;
  if (card?.format !== 'zip') return [];
  const grouped = new Set(card.members.filter(member => member.format === 'shapefile')
    .flatMap(member => [member.name, ...member.companions]));
  const probed = new Set(card.members.filter(member => !member.refusalCode && !member.name.endsWith('/')
    && !grouped.has(member.name)).map(member => member.name));
  return members.filter(member => probed.has(member.member_path));
}

async function membersTx(client: PoolClient, caseId: string, itemId: string): Promise<MemberRow[]> {
  return (await client.query(`SELECT item_id,member_path,source_id,size_bytes,card,limit_reason
    FROM usp_intake_items WHERE case_id=$1 AND parent_item_id=$2 ORDER BY member_path`, [caseId, itemId])).rows;
}

/** A layer waits while it has no original or a reason a retry can clear; the limit and size reasons are final. */
function waiting(member: MemberRow): boolean {
  if (!member.limit_reason) return !member.source_id;
  const code = member.limit_reason.split(':')[0];
  return !/^ZIP_(?:LAYER_(?:LIMIT|SIZE)|NESTING_LIMIT|EMPTY_MEMBER)$/.test(code)
    && !/^GZIP_(?:SIZE_LIMIT|RATIO_LIMIT|MEMBER_INTEGRITY|EMPTY_MEMBER)$/.test(code);
}

/** ZW1. The archive's own words say where its layer job stands, written in the transaction that moves the job. */
export async function zipParentStageTx(client: PoolClient, caseId: string, itemId: string, stage: ZipLayerStage) {
  const card = (await client.query(`SELECT card FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
    AND parent_item_id IS NULL`, [caseId, itemId])).rows[0]?.card;
  if (!['zip', 'gzip'].includes(card?.format)) return;
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const members = await membersTx(client, caseId, itemId);
  const outcomes = members.map(member => ({ path: member.member_path,
    sourceId: member.source_id, reason: member.limit_reason }));
  const words = card.format === 'gzip' ? gzipParentWords(stage, outcomes[0]) : zipParentWords(card, stage, outcomes);
  await writeIntakeDraftTx(client, caseId, itemId, { ...current, limitReason: words });
}

/**
 * ZJ1. Publishing a ZIP card queues its fan-out as one fenced job in the publishing transaction, never inside the
 * request. None is queued while one is queued or running, or when no layer waits. The id is stable from the item,
 * the source revision and the count of this source's earlier jobs. ZW1: while a job waits or runs, the archive's
 * words say its layers are being taken in, also after a re-enrolment's settlement wrote ZF2's words again.
 */
export async function queueZipLayersTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard,
  itemId: string): Promise<string | null> {
  if (!['zip', 'gzip'].includes(card.format)) return null;
  if (await archiveDepthTx(client, source) > INTAKE_PROBE_LIMITS.nestingDepth) {
    const current = await readIntakeDraftTx(client, source.case_id, itemId);
    await writeIntakeDraftTx(client, source.case_id, itemId, { ...current, state: 'read_to_limit',
      limitReason: nestingWords });
    return null;
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-zip-layers:${itemId}`]);
  const jobs = (await client.query(`SELECT status FROM jobs WHERE source_id=$1 AND operation='intake-zip-layers'`,
    [source.id])).rows;
  if (jobs.some(job => ['queued', 'running'].includes(job.status))) {
    await zipParentStageTx(client, source.case_id, itemId, 'taking');
    return null;
  }
  if (card.format === 'gzip') await gzipChildTx(client, source, itemId);
  if (!zipLayerMembers(card, await membersTx(client, source.case_id, itemId)).some(waiting)) {
    await zipParentStageTx(client, source.case_id, itemId, 'taken');
    return null;
  }
  const scope = await intakeCaseTx(client, source.case_id);
  const input = IntakeZipLayersInputSchema.parse({ version: 'intake-zip-layers/1',
    jobId: stableUuid(`intake-zip-layers/1:${itemId}:${source.revision}:${jobs.length + 1}`),
    caseId: source.case_id, caseRevision: scope.current.revision, itemId, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-zip-layers',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  await zipParentStageTx(client, source.case_id, itemId, 'taking');
  return input.jobId;
}

/** Gzip has no directory or trustworthy expanded size; its one member is planned without guessing either. */
async function gzipChildTx(client: PoolClient, source: IntakeSourceRow, parentId: string) {
  const name = gzipMemberName(source.name);
  const inserted = await client.query(`INSERT INTO usp_intake_items(
    item_id,case_id,parent_item_id,member_path,state,family,format,wave)
    VALUES($1,$2,$3,$4,'probed','unknown','unknown',4)
    ON CONFLICT(parent_item_id,member_path) DO NOTHING RETURNING item_id`,
  [stableUuid(`gzip-member/1:${parentId}:${name}`), source.case_id, parentId, name]);
  for (const row of inserted.rows) await appendIntakeItemTx(client, source.case_id, row.item_id);
}

async function noteTx(client: PoolClient, caseId: string, itemId: string, reason: string) {
  const changed = await client.query(`UPDATE usp_intake_items SET limit_reason=$3,updated_at=now()
    WHERE case_id=$1 AND item_id=$2 AND source_id IS NULL AND limit_reason IS DISTINCT FROM $3`,
  [caseId, itemId, reason]);
  if (changed.rowCount) await appendIntakeItemTx(client, caseId, itemId);
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error && /^ZIP_[A-Z_]{1,60}$/.test(error.message)) return error.message;
  return 'ZIP_LAYER_UNAVAILABLE';
}

/** Officer words carry a code and bounds only; parser or provider text may hold a source value. */
function notKept(code: string, member: MemberRow, waitedSeconds = 0): string {
  const sized = `this member${member.size_bytes === null ? '' : ` of ${member.size_bytes} bytes`}`;
  if (code === 'ZIP_EMPTY_MEMBER') return 'ZIP_EMPTY_MEMBER: this empty file is kept inside the archive; '
    + 'the original receipt accepts nonempty members only.';
  if (code === 'ZIP_LAYER_LIMIT') return `ZIP_LAYER_LIMIT: the first ${ZIP_LAYER_LIMITS.layers} independent `
    + 'members of this archive are taken out in archive order; this one stays inside the archive, not read.';
  if (code === 'ZIP_LAYER_SIZE') return `ZIP_LAYER_SIZE: ${sized} is kept inside the archive; members above `
    + `${STREAMING_VECTOR_LIMITS.sourceBytes} bytes are not kept as their own original.`;
  if (code === 'UPLOAD_QUOTA') return `UPLOAD_QUOTA: ${sized} stays inside the archive; the large-original receipt `
    + `allowance is still full after waiting ${waitedSeconds} seconds (30-minute bound from archive retention), `
    + 'so it was not kept as its own original. Enrol the archive again to retry once a receipt is free.';
  return `${code}: this member stays inside the archive and was not kept as its own original. `
    + 'Enrol the archive again to retry.';
}

/**
 * Retain all independent members before enrolling any, so a reader cannot bind the case ahead of its siblings.
 * Small GeoJSON keeps its existing manual route; other members use the byte receipt. Both keep lineage.
 */
export async function fanOutZipLayers(caseValue: string, itemValue: string, dependencies: ZipLayerDependencies) {
  const caseId = uuid.parse(caseValue);
  const itemId = uuid.parse(itemValue);
  const scope = await dependencies.transaction(client => zipScopeTx(client, caseId, itemId));
  if (!scope || scope.depth > INTAKE_PROBE_LIMITS.nestingDepth) return [];
  const result = await keepMembers(caseId, itemId, scope.source, scope.members, dependencies, scope.retainedAt,
    scope.gzip);
  for (const member of result.kept) await enrolMember(caseId, itemId, member, scope.depth, dependencies);
  return result.retryAt === null ? result.kept.map(member => member.sourceId) : { retryAt: result.retryAt };
}

async function zipScopeTx(client: PoolClient, caseId: string, itemId: string) {
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
    AND parent_item_id IS NULL`, [caseId, itemId])).rows[0];
  if (!item?.source_id || !['zip', 'gzip'].includes(item.card?.format)) return null;
  const { source } = await intakeSourceTx(client, caseId, item.source_id);
  const order = new Map<string, number>(item.card.members.map((member: { name: string }, at: number) =>
    [member.name, at]));
  const members = zipLayerMembers(item.card, await membersTx(client, caseId, itemId))
    .sort((a, b) => order.get(a.member_path)! - order.get(b.member_path)!);
  const retainedAt = new Date((source as IntakeSourceRow & { created_at: Date | string }).created_at).getTime();
  if (!Number.isFinite(retainedAt)) conflict('The archive retention time is unavailable.');
  return { source, members, retainedAt, depth: await archiveDepthTx(client, source),
    gzip: item.card.format === 'gzip' };
}

/** Only quota admission waits; receipt expiry is a latest-free time, capped by the archive's own bound. */
function receiptWait(member: MemberRow, error: AppError, retainedAt: number) {
  const now = Date.now();
  const deadline = retainedAt + ZIP_RECEIPT_WAIT_MS;
  if (now >= deadline) return { retryAt: null,
    reason: notKept('UPLOAD_QUOTA', member, Math.max(0, Math.floor((now - retainedAt) / 1000))) };
  const freesAt = Date.parse(String((error.details as { freesAt?: unknown } | undefined)?.freesAt));
  // At least two seconds between yields bounds a 30-minute wait to 900 yielded attempt rows.
  return { retryAt: Math.min(deadline, Math.max(now + 2000, Number.isFinite(freesAt) && freesAt > now
    ? freesAt : now + DISPATCH_HEAD_OF_LINE_MS)),
    reason: 'UPLOAD_QUOTA: Waiting for a free receipt; '
      + 'this member stays in the archive and will be taken out automatically. '
      + 'The wait ends 30 minutes after archive retention.' };
}

async function keepMembers(caseId: string, itemId: string, source: IntakeSourceRow, members: MemberRow[],
  dependencies: ZipLayerDependencies, retainedAt: number, gzip = false) {
  let retryAt: number | null = null;
  const kept = members.filter(member => member.source_id)
    .map(member => ({ member, sourceId: member.source_id! }));
  const pending = members.filter(member => !member.source_id);
  const room = Math.max(0, ZIP_LAYER_LIMITS.layers - kept.length);
  for (const member of pending.slice(room)) {
    await dependencies.transaction(client => noteTx(client, caseId, member.item_id,
      notKept('ZIP_LAYER_LIMIT', member)));
  }
  for (const member of pending.slice(0, room).filter(waiting)) {
    try { kept.push({ member, sourceId: await keepLayer(caseId, itemId, source, member, dependencies, gzip) }); }
    catch (error) {
      let reason = error instanceof GzipMemberError ? error.message : notKept(failureCode(error), member);
      if (error instanceof AppError && error.code === 'UPLOAD_FINALIZING') {
        retryAt = Math.min(retryAt ?? Infinity, Date.now() + DISPATCH_HEAD_OF_LINE_MS);
        reason = 'UPLOAD_FINALIZING: The large-original/2 receipt is still storing and verifying this member. '
          + 'It stays in the archive and will be linked automatically when its original is ready.';
      }
      if (error instanceof AppError && error.code === 'UPLOAD_QUOTA') {
        const wait = receiptWait(member, error, retainedAt);
        reason = wait.reason;
        if (wait.retryAt !== null) retryAt = Math.min(retryAt ?? wait.retryAt, wait.retryAt);
      }
      await dependencies.transaction(client => noteTx(client, caseId, member.item_id, reason));
    }
  }
  return { kept, retryAt };
}

async function memberReason(caseId: string, member: MemberRow, reason: string | null,
  dependencies: ZipLayerDependencies) {
  await dependencies.transaction(async client => {
    const changed = await client.query(`UPDATE usp_intake_items SET limit_reason=$3,updated_at=now()
      WHERE case_id=$1 AND item_id=$2 AND limit_reason IS DISTINCT FROM $3`, [caseId, member.item_id, reason]);
    if (changed.rowCount) await appendIntakeItemTx(client, caseId, member.item_id);
  });
}

async function enrolMember(caseId: string, itemId: string, kept: Kept, depth: number,
  dependencies: ZipLayerDependencies) {
  if (['zip', 'gzip'].includes(kept.member.card?.format ?? '') && depth >= INTAKE_PROBE_LIMITS.nestingDepth) {
    await memberReason(caseId, kept.member, nestingWords, dependencies);
    return;
  }
  try {
    await dependencies.register(caseId, { sourceId: kept.sourceId,
      requestKey: stableUuid(`zip-layer/1:${itemId}:${kept.member.member_path}:${kept.sourceId}`) });
    await memberReason(caseId, kept.member, null, dependencies);
  } catch (error) {
    // The child stays kept and named; re-enrolling the archive retries enrolment without another copy.
    await memberReason(caseId, kept.member,
      `${failureCode(error)}: this member is kept as its own original but was not enrolled. `
        + 'Enrol the archive again to retry.', dependencies);
  }
}

async function keepLayer(caseId: string, parentItemId: string, archive: IntakeSourceRow, member: MemberRow,
  dependencies: ZipLayerDependencies, gzip = false): Promise<string> {
  const linked = await dependencies.transaction(client => linkKeptTx(client, caseId, archive, member));
  if (linked) return linked;
  if (gzip) {
    return keepGzipLayer(caseId, parentItemId, archive, member, dependencies);
  }
  if (Number(member.size_bytes) === 0) throw new Error('ZIP_EMPTY_MEMBER');
  if (member.size_bytes !== null && Number(member.size_bytes) > ZIP_LAYER_LIMITS.memberBytes) {
    return keepLargeLayer(caseId, parentItemId, archive, member, dependencies);
  }
  const size = Number(archive.bytes);
  const deadline = Date.now() + MEMBER_READ_MS;
  const signal = AbortSignal.timeout(MEMBER_READ_MS);
  const read = (start: number, end: number) => dependencies.read(archive.object_key, start, end, size, deadline, signal);
  const extracted = await readZipMember(read, size, member.member_path, ZIP_LAYER_LIMITS.memberBytes);
  const lineage = ArchiveMemberLineageSchema.parse({ version: 'zip-layer/1', parentSourceId: archive.id,
    parentSourceRevision: archive.revision, parentSha256: archive.sha256, parentItemId,
    memberPath: member.member_path, ordinal: extracted.ordinal, memberBytes: extracted.bytes.length,
    compressedBytes: extracted.compressedBytes, crc32: extracted.crc32, memberSha256: sha256(extracted.bytes) });
  const file = { name: layerName(member), bytes: extracted.bytes };
  const sourceId = member.card?.format === 'geojson'
    ? await retainMapLayer(caseId, file, lineage, dependencies)
    : await fenced(caseId, dependencies, revision => dependencies.retainMember(caseId, revision, file, lineage));
  await dependencies.transaction(client => linkTx(client, caseId, member, sourceId));
  return sourceId;
}

/** Gzip uses the same two-pass, part-sized derived-original receipt as a large ZIP member. */
async function keepGzipLayer(caseId: string, parentItemId: string, archive: IntakeSourceRow, member: MemberRow,
  dependencies: ZipLayerDependencies): Promise<string> {
  const size = Number(archive.bytes);
  const readMs = streamingReadMs(size);
  const deadline = Date.now() + readMs;
  const signal = AbortSignal.timeout(readMs);
  const read = (start: number, end: number) =>
    dependencies.read(archive.object_key, start, end, size, deadline, signal);
  const inspected = await inspectGzipMember(read, size);
  const file = { name: layerName(member), bytes: inspected.bytes, sha256: inspected.sha256 };
  const lineage = LargeLayerLineageSchema.parse({ version: 'zip-layer/1', parentSourceId: archive.id,
    parentSourceRevision: archive.revision, parentSha256: archive.sha256, parentItemId,
    memberPath: member.member_path, ordinal: 0, memberBytes: file.bytes, compressedBytes: size,
    crc32: inspected.crc32, memberSha256: file.sha256 });
  const sourceId = await fenced(caseId, dependencies, revision => receiveLargeLayer(caseId,
    { revision, batchSourceId: archive.id }, file, byteParts(streamGzipMember(read, size)), dependencies, lineage));
  await dependencies.transaction(client => linkTx(client, caseId, member, sourceId));
  return sourceId;
}

/**
 * A small GeoJSON keeps the map route. When that route refuses the layer (413 or 422: over its feature bound, a
 * single Feature, no declared projection), the layer is kept through the byte receipt with the same lineage, as a
 * dropped file is, and its streaming reader reads it. Any other failure stays the caller's.
 */
async function retainMapLayer(caseId: string, file: { name: string; bytes: Uint8Array },
  lineage: ArchiveMemberLineage, dependencies: ZipLayerDependencies): Promise<string> {
  try {
    return await fenced(caseId, dependencies, async revision => (await dependencies.retain(caseId,
      { format: 'geojson', requestKey: randomUUID(), expectedWorkspaceRevision: revision }, file, lineage))
      .source.sourceId);
  } catch (error) {
    if (!(error instanceof AppError) || ![413, 422].includes(error.status)) throw error;
    return fenced(caseId, dependencies, revision => dependencies.retainMember(caseId, revision, file, lineage));
  }
}

// The byte receipt takes a basename; the complete original path stays in lineage and on the member row.
function layerName(member: MemberRow): string {
  const name = (member.member_path.split(/[\/\\]/).pop() ?? member.member_path).trim();
  if (!name) return `member-${sha256(member.member_path).slice(0, 12)}`;
  return name.length <= 150 ? name : `${name.slice(0, 130)}-${sha256(member.member_path).slice(0, 12)}`;
}
const nestingWords = `ZIP_NESTING_LIMIT: kept as its own original, not read; ZIP nesting is limited to `
  + `${INTAKE_PROBE_LIMITS.nestingDepth} levels below the outer archive.`;

/** Derive depth from immutable lineage rather than a caller-supplied counter. Missing ancestry fails closed. */
async function archiveDepthTx(client: PoolClient, source: IntakeSourceRow): Promise<number> {
  let depth = 0;
  const seen = new Set([source.id]);
  while (source.inspection?.archiveMember) {
    const lineage = LargeLayerLineageSchema.parse(source.inspection.archiveMember);
    if (lineage.memberSha256 !== source.sha256 || lineage.memberBytes !== Number(source.bytes)) {
      conflict('The ZIP member lineage differs from its retained bytes.');
    }
    const parentId = lineage.parentSourceId;
    if (seen.has(parentId)) return INTAKE_PROBE_LIMITS.nestingDepth + 1;
    if (++depth > INTAKE_PROBE_LIMITS.nestingDepth) return depth;
    seen.add(parentId);
    source = (await intakeSourceTx(client, source.case_id, parentId)).source;
    if (source.sha256 !== lineage.parentSha256 || source.revision !== lineage.parentSourceRevision) {
      conflict('The ZIP member ancestry changed.');
    }
  }
  return depth;
}

/** The case revision is the retain's fence; a sibling's retain moves it, so read it again and retry twice. */
export async function fenced<T>(caseId: string, dependencies: Pick<ZipLayerDependencies, 'transaction'>,
  retain: (revision: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const revision = await dependencies.transaction(async client =>
      Number((await client.query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0]?.revision));
    try { return await retain(revision); }
    catch (error) {
      if (attempt >= 2 || !(error instanceof AppError) || error.status !== 409) throw error;
    }
  }
}

/**
 * ZL2. A child kept for this member but never linked to it (a stop between the retain and the link) is found by the
 * lineage it was retained with and linked, in one transaction, before any member byte is read. The parent's
 * revision and SHA-256 pin the member's bytes; the child's own SHA-256 must be the member's. A map-route row its
 * reader never finished (no manual profile, as a refused retain leaves it) is not a kept child.
 */
async function linkKeptTx(client: PoolClient, caseId: string, archive: IntakeSourceRow,
  member: MemberRow): Promise<string | null> {
  const kept = (await client.query(`SELECT id FROM sources WHERE case_id=$1 AND inspection->'archiveMember' @> $2::jsonb
    AND sha256=inspection->'archiveMember'->>'memberSha256'
    AND (profile<>'geojson-manual-v1' OR inspection ? 'manualProfile') ORDER BY created_at,id LIMIT 1`,
  [caseId, { parentSourceId: archive.id, parentSourceRevision: archive.revision, parentSha256: archive.sha256,
    memberPath: member.member_path }])).rows[0];
  if (!kept) return null;
  await linkTx(client, caseId, member, kept.id);
  return kept.id;
}

async function linkTx(client: PoolClient, caseId: string, member: MemberRow, sourceId: string) {
  const changed = await client.query(`UPDATE usp_intake_items SET source_id=$3,limit_reason=NULL,updated_at=now()
    WHERE case_id=$1 AND item_id=$2 AND source_id IS NULL`, [caseId, member.item_id, sourceId]);
  if (changed.rowCount) await appendIntakeItemTx(client, caseId, member.item_id);
}

/**
 * A member above the small member bound is streamed out of the archive
 * twice: once to hash it and check its size and CRC-32, then in byte parts through the receipt /uploads uses, which
 * checks the hash again before it retains the large original. No pass holds more than one part. A size or CRC
 * mismatch keeps nothing. ZL2: the child's lineage is written by finalize in the transaction that creates it, so a
 * crash keeps either both or neither; the member item is then linked to it before it is enrolled.
 */
async function keepLargeLayer(caseId: string, parentItemId: string, archive: IntakeSourceRow, member: MemberRow,
  dependencies: ZipLayerDependencies): Promise<string> {
  if (Number(member.size_bytes) > STREAMING_VECTOR_LIMITS.sourceBytes) throw new Error('ZIP_LAYER_SIZE');
  const size = Number(archive.bytes);
  // Both passes over the member share one deadline that grows with its size, as the large reader's does.
  const readMs = streamingReadMs(Number(member.size_bytes));
  const deadline = Date.now() + readMs;
  const signal = AbortSignal.timeout(readMs);
  const read = (start: number, end: number) =>
    dependencies.read(archive.object_key, start, end, size, deadline, signal);
  const located = await locateZipMember(read, size, member.member_path);
  const { entry } = located;
  const stream = () => streamZipMember(read, located, STREAMING_VECTOR_LIMITS.sourceBytes);
  const hash = createHash('sha256');
  for await (const chunk of stream()) hash.update(chunk);
  const file = { name: layerName(member), bytes: entry.size, sha256: hash.digest('hex') };
  const lineage = LargeLayerLineageSchema.parse({ version: 'zip-layer/1', parentSourceId: archive.id,
    parentSourceRevision: archive.revision, parentSha256: archive.sha256, parentItemId,
    memberPath: member.member_path, ordinal: located.ordinal, memberBytes: entry.size,
    compressedBytes: entry.compressed, crc32: entry.crc, memberSha256: file.sha256 });
  const sourceId = await fenced(caseId, dependencies, revision =>
    receiveLargeLayer(caseId, { revision, batchSourceId: archive.id }, file, byteParts(stream()), dependencies,
      lineage));
  await dependencies.transaction(client => linkTx(client, caseId, member, sourceId));
  return sourceId;
}

/** Regroups a member's chunks into the receipt's byte parts; only the part being filled is held. */
export async function* byteParts(chunks: AsyncIterable<Uint8Array>) {
  let part = Buffer.allocUnsafe(LARGE_ORIGINAL_LIMITS.partBytes);
  let filled = 0;
  for await (const chunk of chunks) {
    for (let at = 0; at < chunk.length;) {
      const taken = Math.min(chunk.length - at, part.length - filled);
      part.set(chunk.subarray(at, at + taken), filled);
      filled += taken;
      at += taken;
      if (filled === part.length) {
        yield part;
        part = Buffer.allocUnsafe(LARGE_ORIGINAL_LIMITS.partBytes);
        filled = 0;
      }
    }
  }
  if (filled) yield part.subarray(0, filled);
}

/** A bounded, already verified member uses the same original receipt as a dropped file, without parsing. */
export async function retainZipMemberOriginal(caseId: string, revision: number,
  file: { name: string; bytes: Uint8Array }, lineage: ArchiveMemberLineage,
  dependencies: Pick<ZipLayerDependencies, 'large'>): Promise<string> {
  async function* bytes() {
    yield file.bytes;
  }
  return receiveLargeLayer(caseId, { revision, batchSourceId: lineage.parentSourceId },
    { name: file.name, bytes: file.bytes.length, sha256: lineage.memberSha256 },
    byteParts(bytes()), dependencies, lineage);
}

/**
 * The case revision a derived receipt is admitted at, and the batch item it derives from (TC2). A CW3 cell child is
 * received into its own new case, which has no packages yet, so it names no batch item.
 */
export type DerivedReceiptFence = { revision: number; batchSourceId?: string };

/**
 * One byte receipt, driven as /uploads drives it: admit, store each part, finalize. Archive, table, cell and native
 * derivatives pass their lineage, which finalize writes with the source. A failed receipt is aborted. The
 * receipt names its batch item, so packages the batch's own drafts made in the case do not refuse it (TC2).
 */
export async function receiveLargeLayer(caseId: string, fence: DerivedReceiptFence,
  file: { name: string; bytes: number; sha256: string }, parts: AsyncIterable<Uint8Array>,
  dependencies: Pick<ZipLayerDependencies, 'large'>,
  lineage?: ArchiveMemberLineage | TableDerivativeLineage | CellDerivativeLineage | NativeDerivativeLineage)
  : Promise<string> {
  // Only archive members opt into v2 here; other derivative families keep their existing v1 ceilings.
  const v2 = lineage?.version === 'zip-layer/1' && file.bytes > LARGE_ORIGINAL_LIMITS.maxOriginalBytes;
  let status = v2 ? await dependencies.large.findDerived(caseId, lineage) : null;
  status ??= await dependencies.large.create(caseId, { requestKey: randomUUID(),
    ...(v2 ? { profile: 'large-original/2' } : {}),
    expectedCaseRevision: fence.revision, filename: file.name, mediaType: 'application/octet-stream',
    sha256: file.sha256, bytes: file.bytes,
    provenance: { origin: 'not_stated', acquiredAt: new Date().toISOString() } }, fence.batchSourceId,
  v2 ? lineage : undefined);
  if (status.source) return status.source.sourceId;
  if (status.state === 'finalizing') throw new AppError(503, 'UPLOAD_FINALIZING', 'Archive receipt is finalizing.');
  try {
    let partNumber = 0;
    for await (const bytes of parts) {
      partNumber++;
      const saved = status.parts?.find(part => part.partNumber === partNumber);
      if (saved?.state === 'received') continue;
      const claim = await dependencies.large.claimPart(caseId, status.id, {
        requestKey: saved?.requestKey ?? randomUUID(),
        expectedRevision: status.revision, expectedCaseRevision: status.currentCaseRevision,
        partNumber, sha256: sha256(bytes) });
      try { status = await dependencies.large.receivePart(claim, bytes); }
      catch (error) {
        await dependencies.large.failPart(claim);
        throw error;
      }
    }
    const receipt = await dependencies.large.finalize(caseId, status.id, { requestKey: randomUUID(),
      expectedRevision: status.revision, expectedCaseRevision: status.currentCaseRevision, sha256: file.sha256 },
    lineage);
    if (receipt) status = receipt;
    if (receipt?.state === 'finalizing') throw new AppError(503, 'UPLOAD_FINALIZING', 'Archive receipt is finalizing.');
    if (!receipt?.source) throw new Error('ZIP_LAYER_UNAVAILABLE');
    return receipt.source.sourceId;
  } catch (error) {
    if (error instanceof AppError && error.code === 'UPLOAD_FINALIZING') throw error;
    // Its temporary parts are reclaimed; a receipt whose abort also fails is left to its own expiry.
    await dependencies.large.abort(caseId, status.id, { requestKey: randomUUID(), expectedRevision: status.revision,
      expectedCaseRevision: status.currentCaseRevision }).catch(() => {});
    throw error;
  }
}
