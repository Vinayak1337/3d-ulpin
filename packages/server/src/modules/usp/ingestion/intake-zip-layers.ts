import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ArchiveMemberLineageSchema, IntakeArchiveReceiptSchema, IntakeArchiveRetainSchema, ZIP_LAYER_LIMITS,
  type AnySourceProfile, type ArchiveMemberLineage, type IntakeCard } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { putOriginal, readObjectRange, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { originalAttempt } from '../../cases/original-attempt';
import { appendCaseIngestionTx, appendIntakeItemTx, assertIngestionBinding } from './events';
import { intakeCaseTx, intakeSourceTx, type IntakeSourceRow } from './intake-context';
import { stableUuid } from './intake-run';
import { detectIntakeKind } from './intake-signatures';
import { readZipMember } from './intake-zip';
import { lockUnassignedSourceCase } from './service';

export const ZIP_ARCHIVE_PROFILE = 'zip-manual-v1';
const uuid = z.string().uuid();
// A member read may page a large archive's directory and up to 17 one-MiB ranges.
const MEMBER_READ_MS = 60_000;

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
      const { binding } = await intakeCaseTx(client, caseId, true);
      const scope = await lockUnassignedSourceCase(client, caseId);
      const digest = fingerprint({ input, name: file.name, hash, subject: binding.subject });
      const prior = await priorTx(client, caseId, key, digest);
      if (prior) return IntakeArchiveReceiptSchema.parse(prior);
      const duplicate = (await client.query(`SELECT * FROM sources WHERE case_id=$1 AND sha256=$2 AND profile=$3
        ORDER BY revision DESC LIMIT 1`, [caseId, hash, ZIP_ARCHIVE_PROFILE])).rows[0];
      let result;
      if (duplicate) result = archiveReceipt((await intakeSourceTx(client, caseId, duplicate.id)).source);
      else {
        if (scope.revision !== input.expectedWorkspaceRevision) {
          conflict('The source case changed; refresh before retaining another original.');
        }
        rememberOriginal(objectKey);
        await putOriginal(objectKey, file.bytes, 'application/zip');
        await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
          object_key,status,inspection) VALUES($1,$2,$1,1,$3,$4,'application/zip',$5,$6,$7,'needs_input',$8)`,
        [sourceId, caseId, file.name, ZIP_ARCHIVE_PROFILE, file.bytes.length, hash, objectKey,
          { profile: ZIP_ARCHIVE_PROFILE, status: 'needs_input', issues: [],
            summary: 'ZIP original retained unchanged; each GeoJSON member is kept as its own child original.',
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
  retain: (caseId: string, input: unknown, file: { name: string; bytes: Uint8Array },
    lineage: ArchiveMemberLineage) => Promise<AnySourceProfile>;
  register: (caseId: string, input: unknown) => Promise<unknown>;
};

type MemberRow = { item_id: string; member_path: string; source_id: string | null; size_bytes: string | null;
  card: IntakeCard | null; limit_reason: string | null; state: string; family: string };
type Kept = { member: MemberRow; sourceId: string };

/** Only a GeoJSON member the probe read without refusal, not yet kept, is a layer. */
export function zipLayerMembers(card: IntakeCard | null, members: MemberRow[]): MemberRow[] {
  if (card?.format !== 'zip') return [];
  const probed = new Set(card.members.filter(member => member.format === 'geojson' && !member.refusalCode)
    .map(member => member.name));
  return members.filter(member => probed.has(member.member_path) && member.card?.format === 'geojson');
}

async function membersTx(client: PoolClient, caseId: string, itemId: string): Promise<MemberRow[]> {
  return (await client.query(`SELECT item_id,member_path,source_id,size_bytes,card,limit_reason,state,family
    FROM usp_intake_items WHERE case_id=$1 AND parent_item_id=$2 ORDER BY member_path`, [caseId, itemId])).rows;
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
function notKept(code: string): string {
  if (code === 'ZIP_LAYER_SIZE') return `ZIP_LAYER_SIZE: this GeoJSON member is kept inside the archive; members `
    + `above ${ZIP_LAYER_LIMITS.memberBytes} bytes are not yet kept as their own original.`;
  if (code === 'ZIP_LAYER_LIMIT') return `ZIP_LAYER_LIMIT: the first ${ZIP_LAYER_LIMITS.layers} GeoJSON members `
    + 'of this archive are kept as their own originals; this one stays inside the archive.';
  return `${code}: this GeoJSON member stays inside the archive and was not kept as its own original. `
    + 'Enrol the archive again to retry.';
}

/**
 * ZF1. Each GeoJSON layer of an enrolled ZIP is read back out (size and CRC-32 checked against the directory),
 * retained as its own GeoJSON original with the archive's pins beside its receipt, and enrolled like any dropped
 * file. The member's row under the archive then names that original. All layers are retained before any is
 * enrolled, so no layer's draft can associate the case before its siblings are kept. Replays keep what is kept.
 */
export async function fanOutZipLayers(caseValue: string, itemValue: string, dependencies: ZipLayerDependencies) {
  const caseId = uuid.parse(caseValue);
  const itemId = uuid.parse(itemValue);
  const scope = await dependencies.transaction(async client => {
    const item = (await client.query(`SELECT * FROM usp_intake_items WHERE case_id=$1 AND item_id=$2
      AND parent_item_id IS NULL`, [caseId, itemId])).rows[0];
    if (!item?.source_id || item.card?.format !== 'zip') return null;
    const { source } = await intakeSourceTx(client, caseId, item.source_id);
    const members = await membersTx(client, caseId, itemId);
    const order = new Map<string, number>(item.card.members.map((member: { name: string }, at: number) =>
      [member.name, at]));
    const layers = zipLayerMembers(item.card, members)
      .sort((a, b) => order.get(a.member_path)! - order.get(b.member_path)!);
    return { source, layers, card: item.card as IntakeCard };
  });
  if (!scope) return [];
  const kept: Kept[] = scope.layers.filter(member => member.source_id)
    .map(member => ({ member, sourceId: member.source_id! }));
  const pending = scope.layers.filter(member => !member.source_id);
  const room = Math.max(0, ZIP_LAYER_LIMITS.layers - kept.length);
  for (const member of pending.slice(room)) {
    await dependencies.transaction(client => noteTx(client, caseId, member.item_id, notKept('ZIP_LAYER_LIMIT')));
  }
  for (const member of pending.slice(0, room)) {
    try { kept.push({ member, sourceId: await keepLayer(caseId, itemId, scope.source, member, dependencies) }); }
    catch (error) {
      await dependencies.transaction(client => noteTx(client, caseId, member.item_id, notKept(failureCode(error))));
    }
  }
  for (const layer of kept) {
    try {
      await dependencies.register(caseId, { sourceId: layer.sourceId,
        requestKey: stableUuid(`zip-layer/1:${itemId}:${layer.member.member_path}:${layer.sourceId}`) });
    } catch (error) {
      // The child original stays kept and named; enrolling the archive again enrols it.
      await dependencies.transaction(async client => {
        await client.query(`UPDATE usp_intake_items SET limit_reason=$3,updated_at=now()
          WHERE case_id=$1 AND item_id=$2`, [caseId, layer.member.item_id,
          `${failureCode(error)}: this layer is kept as its own original but was not enrolled. `
            + 'Enrol the archive again to retry.']);
        await appendIntakeItemTx(client, caseId, layer.member.item_id);
      });
    }
  }
  await dependencies.transaction(client => describeArchiveTx(client, caseId, itemId, scope.card));
  return kept.map(layer => layer.sourceId);
}

const familyWords: Record<string, [string, string]> = {
  vector: ['map feature file', 'map feature files'], table: ['table', 'tables'], raster: ['raster', 'rasters'],
  point_cloud: ['point cloud', 'point clouds'], model3d: ['3D model', '3D models'],
  document: ['document', 'documents'], image: ['image', 'images'], archive: ['archive', 'archives'],
  unknown: ['file of a kind not known', 'files of a kind not known'],
};

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/** A member that stays inside the archive says so; a refusal or an earlier reason is left as it is. */
export const ZIP_MEMBER_INSIDE = 'ZIP_MEMBER_INSIDE: this member stays inside the archive; only GeoJSON members '
  + 'become their own files.';

/**
 * ZF2. The ZIP's own words after a fan-out: how many members became their own files and, by kind, which stayed
 * inside the archive. Counts and fixed words only; member names are on the member rows, never repeated here.
 */
export function zipArchiveReason(card: IntakeCard | null, members: MemberRow[]): string {
  if (!members.length) return 'ZIP_NO_LAYERS: this archive lists no members, so none became its own file.';
  const layers = new Set(zipLayerMembers(card, members).map(member => member.item_id));
  const own = members.filter(member => member.source_id).length;
  const notKept = members.filter(member => !member.source_id && layers.has(member.item_id)).length;
  const refused = members.filter(member => !member.source_id && !layers.has(member.item_id)
    && member.state === 'probe_failed').length;
  const inside = new Map<string, number>();
  for (const member of members) {
    if (member.source_id || layers.has(member.item_id) || member.state === 'probe_failed') continue;
    const family = familyWords[member.family] ? member.family : 'unknown';
    inside.set(family, (inside.get(family) ?? 0) + 1);
  }
  const words = [own
    ? `ZIP_LAYERS: ${own} of ${count(members.length, 'member', 'members')} became ${own === 1 ? 'its' : 'their'} `
      + `own ${own === 1 ? 'file' : 'files'}, one item each.`
    : `ZIP_NO_LAYERS: none of the ${count(members.length, 'member', 'members')} became its own file; `
      + 'only GeoJSON members do.'];
  if (notKept) words.push(`${count(notKept, 'GeoJSON member was', 'GeoJSON members were')} not kept; `
    + 'each member row says why.');
  if (refused) words.push(`${count(refused, 'member', 'members')} could not be read inside the archive.`);
  const stayed = [...inside.values()].reduce((sum, value) => sum + value, 0);
  if (stayed) {
    const kinds = Object.keys(familyWords).filter(family => inside.has(family))
      .map(family => count(inside.get(family)!, ...familyWords[family]!));
    words.push(`${stayed} ${stayed === 1 ? 'stays' : 'stay'} inside the archive: ${kinds.join(', ')}.`);
  }
  return words.join(' ');
}

async function describeArchiveTx(client: PoolClient, caseId: string, itemId: string, card: IntakeCard) {
  const members = await membersTx(client, caseId, itemId);
  const layers = new Set(zipLayerMembers(card, members).map(member => member.item_id));
  for (const member of members) {
    if (member.source_id || member.limit_reason || layers.has(member.item_id) || member.state === 'probe_failed') {
      continue;
    }
    await noteTx(client, caseId, member.item_id, ZIP_MEMBER_INSIDE);
  }
  const changed = await client.query(`UPDATE usp_intake_items SET limit_reason=$3,updated_at=now()
    WHERE case_id=$1 AND item_id=$2 AND limit_reason IS DISTINCT FROM $3`,
  [caseId, itemId, zipArchiveReason(card, members)]);
  if (changed.rowCount) await appendIntakeItemTx(client, caseId, itemId);
}

async function keepLayer(caseId: string, parentItemId: string, archive: IntakeSourceRow, member: MemberRow,
  dependencies: ZipLayerDependencies): Promise<string> {
  const size = Number(archive.bytes);
  const deadline = Date.now() + MEMBER_READ_MS;
  const signal = AbortSignal.timeout(MEMBER_READ_MS);
  const read = (start: number, end: number) => dependencies.read(archive.object_key, start, end, size, deadline, signal);
  if (member.size_bytes !== null && Number(member.size_bytes) > ZIP_LAYER_LIMITS.memberBytes) {
    throw new Error('ZIP_LAYER_SIZE');
  }
  const extracted = await readZipMember(read, size, member.member_path, ZIP_LAYER_LIMITS.memberBytes);
  const lineage = ArchiveMemberLineageSchema.parse({ version: 'zip-layer/1', parentSourceId: archive.id,
    parentSourceRevision: archive.revision, parentSha256: archive.sha256, parentItemId,
    memberPath: member.member_path, ordinal: extracted.ordinal, memberBytes: extracted.bytes.length,
    compressedBytes: extracted.compressedBytes, crc32: extracted.crc32, memberSha256: sha256(extracted.bytes) });
  const name = member.member_path.split('/').filter(Boolean).pop() ?? member.member_path;
  let profile: AnySourceProfile | undefined;
  // The case revision is the retain's fence; a sibling's retain moves it, so read it again and retry twice.
  for (let attempt = 0; !profile; attempt++) {
    const revision = await dependencies.transaction(async client =>
      Number((await client.query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0]?.revision));
    try {
      profile = await dependencies.retain(caseId, { format: 'geojson', requestKey: randomUUID(),
        expectedWorkspaceRevision: revision }, { name, bytes: extracted.bytes }, lineage);
    } catch (error) {
      if (attempt >= 2 || !(error instanceof AppError) || error.status !== 409) throw error;
    }
  }
  const sourceId = profile.source.sourceId;
  await dependencies.transaction(async client => {
    const changed = await client.query(`UPDATE usp_intake_items SET source_id=$3,limit_reason=NULL,updated_at=now()
      WHERE case_id=$1 AND item_id=$2 AND source_id IS NULL`, [caseId, member.item_id, sourceId]);
    if (changed.rowCount) await appendIntakeItemTx(client, caseId, member.item_id);
  });
  return sourceId;
}
