import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { CoreContractError, parseUsp, UspPacket0RequestSchema, UspReadEvidenceRequestSchema,
  UspReadScopeRequestSchema, UspResolveTargetRequestSchema, UspSnapshotScopeSchema,
  UspPrepareProposalSchema, UspCommitProposalSchema, UspCaptureSnapshotRequestSchema,
  UspVerticalSelectionSchema } from '@ulpin/contracts/usp';
import { AppError } from '@/lib/server/errors';
import { assertLocalRequest, localRequestContext } from '@/lib/server/usp/principal';
import { captureRegistrySnapshot, readManifest, readRegistryScope, resolveRegistryTarget,
  readRegistryEvidenceBytes, resolveRegistryVerticalContext } from '@/lib/server/usp/snapshots';
import { prepareProposal, commitProposal } from '@/lib/server/usp/commands';
import { createPacket0, readPacket0 } from '@/lib/server/usp/packet0';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function jsonBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'USP_BODY_REQUIRED', 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 1024 * 1024) throw new AppError(413, 'USP_BODY_LIMIT', 'The request body is too large.');
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'USP_INVALID_JSON', 'The request body must be valid JSON.'); }
}

async function handle(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    assertLocalRequest(request);
    const ctx = localRequestContext(requestId);
    const path = (await context.params).path;
    if (request.method === 'GET' && path[0] === 'packets' && path.length === 2) {
      const { bytes, receipt } = await readPacket0(ctx, z.uuid().parse(path[1]));
      return new Response(new Uint8Array(bytes), { headers: { ...headers,
        'Content-Type': receipt.contentType,
        'Content-Disposition': `attachment; filename="packet-${receipt.packetId}.${receipt.format === 'csv' ? 'csv' : 'txt'}"`,
        'X-Artifact-SHA256': receipt.artifact.sha256 } });
    }
    if (request.method !== 'POST') throw new AppError(404, 'USP_ROUTE', 'This workflow route is unavailable.');
    const body = await jsonBody(request);
    let data: unknown, scope: unknown;
    if (path.join('/') === 'snapshots') {
      const input = parseUsp(UspCaptureSnapshotRequestSchema, body);
      if (input.stage !== 'recorded' || input.world.id !== `registry-site/${input.scopeId}`) {
        throw new AppError(422, 'USP_SNAPSHOT_PROFILE', 'This recorded registry scope is unavailable.');
      }
      data = await captureRegistrySnapshot(ctx, input.scopeId, input.selection);
      scope = (data as { scope: unknown }).scope;
    } else if (path.join('/') === 'snapshots/read') {
      const input = parseUsp(UspSnapshotScopeSchema, body.scope);
      scope = input;
      data = await readManifest(ctx, input);
    } else if (path.join('/') === 'scope/read') {
      const input = parseUsp(UspReadScopeRequestSchema, body);
      scope = input.scope;
      data = await readRegistryScope(ctx, input.scope, input.cursor, input.limit);
    } else if (path.join('/') === 'targets/resolve') {
      const input = parseUsp(UspResolveTargetRequestSchema, body);
      scope = input.scope;
      data = await resolveRegistryTarget(ctx, input.scope, input.pin);
    } else if (path.join('/') === 'targets/vertical') {
      const input = parseUsp(UspVerticalSelectionSchema, body);
      scope = input.scope;
      data = await resolveRegistryVerticalContext(ctx, input.scope, input.building, input.floor, input.space);
    } else if (path.join('/') === 'evidence/original') {
      const input = parseUsp(UspReadEvidenceRequestSchema, body);
      if (input.action !== 'original') throw new AppError(422, 'USP_EVIDENCE_ACTION', 'Choose the original action.');
      const { bytes, authorization } = await readRegistryEvidenceBytes(ctx, input.scope, input.pointer);
      return new Response(new Uint8Array(bytes), { headers: { ...headers,
        'Content-Type': authorization.mediaType, 'Content-Disposition': 'attachment',
        'X-Source-SHA256': authorization.asset.sha256 } });
    } else if (path.join('/') === 'proposals/prepare') {
      const input = parseUsp(UspPrepareProposalSchema, body);
      scope = input.scope;
      data = await prepareProposal(ctx, input);
    } else if (path.join('/') === 'proposals/commit') {
      const input = parseUsp(UspCommitProposalSchema, body);
      data = await commitProposal(ctx, input);
      scope = (data as { snapshot: unknown }).snapshot;
    } else if (path.join('/') === 'packets') {
      const input = parseUsp(UspPacket0RequestSchema, body);
      data = await createPacket0(ctx, input);
      scope = input.scope;
    } else throw new AppError(404, 'USP_ROUTE', 'This workflow route is unavailable.');
    return Response.json({ data, meta: { schemaVersion: 'usp/1', requestId, scope } }, { headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status
      : error instanceof ZodError || error instanceof CoreContractError ? 400 : 503;
    return Response.json({ error: { code: error instanceof AppError ? error.code : 'USP_REQUEST_FAILED',
      message: error instanceof AppError ? error.message : 'This operation is unavailable. Check its input or service state.',
      retryable: status >= 500, requestId } }, { status, headers });
  }
}

export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
