import { randomUUID } from 'node:crypto';
import {
  UspPacket0ReceiptSchema, UspPacket0RequestSchema, UspExactPartResultSchema,
  type Packet0Request, type RequestContext, type EvidencePointer, type SnapshotScope,
} from '@ulpin/contracts/usp';
import { query, transaction } from '../db';
import { canonical, fingerprint } from '../domain';
import { AppError, conflict } from '../errors';
import { putOriginal, readObject, sha256 } from '../storage';
import { assertLocalUsp, readManifest, readRegistryEvidenceBytes,
  readSnapshotBody, resolveRegistryTarget } from './snapshots';

export type Packet0Line = { pointer: EvidencePointer; sourceSha256: string; excerpt: string | null;
  reasonCode: string | null };

export function selectExactPart(parts: unknown, locator: EvidencePointer['locator']): string | null {
  if (locator.kind !== 'verbatim' || !Array.isArray(parts)) return null;
  const matches = parts.filter((part: { locator?: string | { label?: string }; text?: string }) =>
    (typeof part?.locator === 'string' ? part.locator : part?.locator?.label) === locator.locator
    && typeof part.text === 'string');
  return matches.length === 1 && matches[0].text.length > 0 && matches[0].text.length <= 16000
    ? matches[0].text : null;
}

function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
/** Pure renderer: only supplied, target-authorized lines can enter this derivative. */
export function renderPacket0(target: { id: string; label: string }, lines: readonly Packet0Line[], format: 'text' | 'csv') {
  if (format === 'csv') {
    const rows = [['target_id', 'target_label', 'source_revision', 'source_sha256', 'locator', 'excerpt', 'state'],
      ...lines.map(line => [target.id, target.label, line.pointer.sourceRevision.ref.id,
        line.sourceSha256, JSON.stringify(line.pointer.locator), line.excerpt ?? '', line.reasonCode ?? 'available'])];
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  return [`Scoped property evidence packet`, `Target: ${target.label} (${target.id})`,
    'Application identity; no official parcel issuance is implied.',
    ...lines.flatMap(line => [
      `Source revision: ${line.pointer.sourceRevision.ref.id}@${line.pointer.sourceRevision.revision}`,
      `SHA-256: ${line.sourceSha256}`,
      `Locator: ${JSON.stringify(line.pointer.locator)}`,
      line.excerpt === null ? `Unavailable exact extract: ${line.reasonCode}` : `Exact extract: ${line.excerpt}`,
    ])].join('\n') + '\n';
}

async function packetLine(ctx: RequestContext, scope: SnapshotScope, pointer: EvidencePointer): Promise<Packet0Line> {
  const original = await readRegistryEvidenceBytes(ctx, scope, pointer);
  const source = await readSnapshotBody(ctx, scope, pointer.sourceRevision);
  const locator = pointer.locator;
  const parts = source.inspection?.referenceParts;
  // Verifying original bytes does not make a broad/ambiguous extract property-scoped.
  const supported = locator.kind === 'verbatim' && (
    (source.profile === 'text-reference-v2' && /^line [1-9][0-9]*$/.test(locator.locator)) ||
    (source.profile === 'csv-reference-v2' && /^CSV row [1-9][0-9]*$/.test(locator.locator)));
  const excerpt = supported ? selectExactPart(parts, locator) : null;
  return { pointer, sourceSha256: original.authorization.asset.sha256,
    excerpt, reasonCode: excerpt === null ? 'exact_extract_unavailable' : null };
}

export async function readExactPart(ctx: RequestContext, scope: SnapshotScope, pointer: EvidencePointer) {
  assertLocalUsp(ctx);
  const line = await packetLine(ctx, scope, pointer);
  return UspExactPartResultSchema.parse(line.excerpt === null
    ? { state: 'unavailable', reasonCode: line.reasonCode }
    : { state: 'available', data: { pointer, sourceSha256: line.sourceSha256, text: line.excerpt } });
}

export async function createPacket0(ctx: RequestContext, raw: Packet0Request) {
  assertLocalUsp(ctx);
  const request = UspPacket0RequestSchema.parse(raw);
  if (request.guard.mode !== 'create') throw new AppError(422, 'USP_PACKET_GUARD', 'Create a packet with a new request key.');
  const manifest = await readManifest(ctx, request.scope);
  const target = await resolveRegistryTarget(ctx, request.scope, request.target);
  if (target.state !== 'available') throw new AppError(404, 'USP_TARGET_UNAVAILABLE', 'The selected target is unavailable.');
  if (!request.evidence.every(pointer => target.data.evidence.some(link => canonical(link) === canonical(pointer)))) {
    throw new AppError(422, 'USP_PACKET_SCOPE', 'Packet evidence must be linked to the selected target.');
  }
  const hash = fingerprint(request), scopeKey = manifest.id;
  const existing = (await query(
    `SELECT command_sha256,body FROM usp_command_receipts
     WHERE subject=$1 AND scope_key=$2 AND operation='packet0' AND request_key=$3`,
    [ctx.principal.subject, scopeKey, request.guard.requestKey],
  )).rows[0];
  if (existing) {
    if (existing.command_sha256 !== hash) conflict('This packet request key was used with different inputs.');
    return UspPacket0ReceiptSchema.parse(existing.body);
  }
  const lines: Packet0Line[] = [];
  for (const pointer of request.evidence) lines.push(await packetLine(ctx, request.scope, pointer));
  const content = renderPacket0({ id: request.target.ref.id, label: target.data.label }, lines, request.format);
  const bytes = Buffer.from(content, 'utf8'), artifactHash = sha256(bytes), packetId = randomUUID();
  const contentType = request.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8';
  const objectKey = `usp/packets/${packetId}/${artifactHash}`;
  await putOriginal(objectKey, bytes, contentType);
  return transaction(async client => {
    const key = `${ctx.principal.subject}:${scopeKey}:packet0:${request.guard.requestKey}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const replay = (await client.query(
      `SELECT command_sha256,body FROM usp_command_receipts
       WHERE subject=$1 AND scope_key=$2 AND operation='packet0' AND request_key=$3`,
      [ctx.principal.subject, scopeKey, request.guard.requestKey],
    )).rows[0];
    if (replay) {
      if (replay.command_sha256 !== hash) conflict('This packet request key was used with different inputs.');
      return UspPacket0ReceiptSchema.parse(replay.body);
    }
    const included = lines.filter(line => line.excerpt !== null).map(line => line.pointer);
    const unavailable = lines.filter(line => line.excerpt === null).map(line => ({
      pointer: line.pointer, reasonCode: line.reasonCode!,
    }));
    const receipt = UspPacket0ReceiptSchema.parse({ packetId, target: request.target, scope: request.scope,
      format: request.format, artifact: { assetId: packetId, version: 1, sha256: artifactHash },
      included, unavailable, contentType, createdAt: new Date().toISOString(),
      status: unavailable.length ? 'incomplete' : 'complete', commandSha256: hash });
    await client.query(`INSERT INTO usp_packets(id,manifest_id,target_namespace,target_id,artifact_hash,object_key,body)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [packetId, manifest.id, request.target.ref.namespace,
      request.target.ref.id, artifactHash, objectKey, receipt]);
    await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
      VALUES($1,$2,$3,'packet0',$4,$5,$6)`, [randomUUID(), ctx.principal.subject,
      scopeKey, request.guard.requestKey, hash, receipt]);
    return receipt;
  });
}

export async function readPacket0(ctx: RequestContext, packetId: string) {
  assertLocalUsp(ctx);
  const row = (await query('SELECT body,object_key,artifact_hash FROM usp_packets WHERE id=$1', [packetId])).rows[0];
  if (!row) throw new AppError(404, 'USP_PACKET_NOT_FOUND', 'The packet is unavailable.');
  const receipt = UspPacket0ReceiptSchema.parse(row.body);
  await readManifest(ctx, receipt.scope);
  const target = await resolveRegistryTarget(ctx, receipt.scope, receipt.target);
  if (target.state !== 'available') throw new AppError(404, 'USP_PACKET_TARGET', 'The packet target is unavailable.');
  for (const pointer of [...receipt.included, ...receipt.unavailable.map(item => item.pointer)]) {
    if (!target.data.evidence.some(link => canonical(link) === canonical(pointer))) {
      throw new AppError(403, 'USP_PACKET_SCOPE', 'The packet evidence is unavailable for this target.');
    }
  }
  const bytes = await readObject(row.object_key);
  if (sha256(bytes) !== row.artifact_hash || row.artifact_hash !== receipt.artifact.sha256) {
    throw new AppError(422, 'USP_PACKET_INTEGRITY', 'The saved packet no longer matches its receipt.');
  }
  return { bytes, receipt };
}

export async function readPacket0Receipt(ctx: RequestContext, packetId: string) {
  return (await readPacket0(ctx, packetId)).receipt;
}
