import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  UspPacket0ReceiptSchema, UspPacket0RequestSchema, UspExactPartResultSchema,
  type Packet0Request, type RequestContext, type EvidencePointer, type SnapshotScope,
} from '@ulpin/contracts/usp';
import { query, transaction } from '../../infrastructure/db';
import { canonical, fingerprint } from '../cases/domain';
import { AppError, conflict } from '../../infrastructure/errors';
import { putOriginal, readObject, sha256 } from '../../infrastructure/storage';
import { assertLocalUsp, readManifest, readRegistryEvidenceBytes,
  readSnapshotBody, resolveRegistryTarget,assertSnapshotDocumentsTx } from './snapshots';

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

/** Shared PACK0 artifact writer; authority and selected lines are server-owned.
 * A plan uses the same renderer/storage and registers its linkage on the same client. */
export async function preparePacket0Artifact(target: { id: string; label: string }, lines: readonly Packet0Line[],
  format: 'text' | 'csv', put: typeof putOriginal = putOriginal) {
  const bytes = Buffer.from(renderPacket0(target, lines, format), 'utf8');
  const artifactHash = sha256(bytes), packetId = randomUUID();
  const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8';
  const objectKey = `usp/packets/${packetId}/${artifactHash}`;
  await put(objectKey, bytes, contentType);
  return { artifactHash, packetId, contentType, objectKey };
}
/** Internal registration only: callers must finish current authorization under their locks first. */
export async function registerPacket0Tx(client: PoolClient, ctx: RequestContext, request: Packet0Request,
  lines: readonly Packet0Line[], artifact: Awaited<ReturnType<typeof preparePacket0Artifact>>, hash: string) {
  const included = lines.filter(line => line.excerpt !== null).map(line => line.pointer);
  const unavailable = lines.filter(line => line.excerpt === null).map(line => ({ pointer: line.pointer, reasonCode: line.reasonCode! }));
  const receipt = UspPacket0ReceiptSchema.parse({ packetId: artifact.packetId, target: request.target, scope: request.scope,
    format: request.format, artifact: { assetId: artifact.packetId, version: 1, sha256: artifact.artifactHash },
    included, unavailable, contentType: artifact.contentType, createdAt: new Date().toISOString(),
    status: unavailable.length ? 'incomplete' : 'complete', commandSha256: hash });
  assertLocalUsp(ctx);
  await client.query(`INSERT INTO usp_packets(id,manifest_id,target_namespace,target_id,artifact_hash,object_key,body)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [artifact.packetId, request.scope.manifestId, request.target.ref.namespace,
    request.target.ref.id, artifact.artifactHash, artifact.objectKey, receipt]);
  return receipt;
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
  const artifact = await preparePacket0Artifact({ id: request.target.ref.id, label: target.data.label }, lines, request.format);
  return transaction(async client => {
    await assertSnapshotDocumentsTx(client,ctx,request.scope,true);
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
    const receipt = await registerPacket0Tx(client, ctx, request, lines, artifact, hash);
    await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
      VALUES($1,$2,$3,'packet0',$4,$5,$6)`, [randomUUID(), ctx.principal.subject,
      scopeKey, request.guard.requestKey, hash, receipt]);
    return receipt;
  });
}

export async function readPacket0(ctx: RequestContext, packetId: string, read: typeof readObject = readObject) {
  assertLocalUsp(ctx);
  const row = (await query('SELECT body,object_key,artifact_hash FROM usp_packets WHERE id=$1', [packetId])).rows[0];
  if (!row) throw new AppError(404, 'USP_PACKET_NOT_FOUND', 'The packet is unavailable.');
  const receipt = UspPacket0ReceiptSchema.parse(row.body);
  const execution = (await query('SELECT body FROM usp_packet_plan_executions WHERE packet_id=$1', [packetId])).rows[0]?.body;
  if (execution) {
    const { readPacketPlan } = await import('./packets/plan-service');
    const view = await readPacketPlan(ctx, { planId: execution.planId, version: execution.version });
    if (!view.execution || canonical(view.execution.packet) !== canonical(receipt))
      throw new AppError(422, 'USP_PACKET_PLAN_LINK', 'The packet does not match its immutable plan execution.');
    const bytes = await read(row.object_key);
    if (sha256(bytes) !== row.artifact_hash || row.artifact_hash !== receipt.artifact.sha256)
      throw new AppError(422, 'USP_PACKET_INTEGRITY', 'The saved packet no longer matches its receipt.');
    await readPacketPlan(ctx, { planId: execution.planId, version: execution.version });
    return { bytes, receipt };
  }
  await readManifest(ctx, receipt.scope);
  const target = await resolveRegistryTarget(ctx, receipt.scope, receipt.target);
  if (target.state !== 'available') throw new AppError(404, 'USP_PACKET_TARGET', 'The packet target is unavailable.');
  for (const pointer of [...receipt.included, ...receipt.unavailable.map(item => item.pointer)]) {
    if (!target.data.evidence.some(link => canonical(link) === canonical(pointer))) {
      throw new AppError(403, 'USP_PACKET_SCOPE', 'The packet evidence is unavailable for this target.');
    }
  }
  const bytes = await read(row.object_key);
  if (sha256(bytes) !== row.artifact_hash || row.artifact_hash !== receipt.artifact.sha256) {
    throw new AppError(422, 'USP_PACKET_INTEGRITY', 'The saved packet no longer matches its receipt.');
  }
  await readManifest(ctx,receipt.scope);
  return { bytes, receipt };
}

export async function readPacket0Receipt(ctx: RequestContext, packetId: string) {
  return (await readPacket0(ctx, packetId)).receipt;
}
