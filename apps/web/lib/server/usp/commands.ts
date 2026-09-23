import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  UspCommitProposalSchema, UspCommitReceiptSchema, UspPrepareProposalSchema,
  UspSnapshotManifestSchema, type RequestContext, type PrepareProposal, type CommitProposal,
} from '@ulpin/contracts/usp';
import { transaction } from '../db';
import { canonical, fingerprint } from '../domain';
import { AppError, conflict, notFound } from '../errors';
import { commitRegistryReviewTx } from '../registry';
import { assertLocalUsp, captureRegistrySnapshotTx } from './snapshots';

async function scopedManifestTx(client: PoolClient, ctx: RequestContext, scope: CommitProposal['scope']) {
  const row = (await client.query('SELECT body FROM usp_snapshots WHERE id=$1 AND digest=$2',
    [scope.manifestId, scope.snapshotDigest])).rows[0] ?? notFound('The exact snapshot is unavailable.');
  const manifest = UspSnapshotManifestSchema.parse(row.body);
  if (canonical(manifest.scope) !== canonical(scope) || manifest.accessViewId !== ctx.accessViewId
    || manifest.policyVersion !== ctx.policyVersion) conflict('Refresh the property selection and its access context.');
  return manifest;
}

async function requestReceiptTx(client: PoolClient, ctx: RequestContext, scopeKey: string,
  operation: string, requestKey: string, commandSha256: string) {
  const key = `${ctx.principal.subject}:${scopeKey}:${operation}:${requestKey}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  const previous = (await client.query(
    `SELECT command_sha256,body FROM usp_command_receipts
     WHERE subject=$1 AND scope_key=$2 AND operation=$3 AND request_key=$4`,
    [ctx.principal.subject, scopeKey, operation, requestKey],
  )).rows[0];
  if (previous && previous.command_sha256 !== commandSha256) conflict('This request key was used with different inputs.');
  return previous?.body;
}

export async function appendUspOutboxTx(client: PoolClient, streamId: string, body: object) {
  await client.query('INSERT INTO usp_outbox_streams(stream_id) VALUES($1) ON CONFLICT DO NOTHING', [streamId]);
  const row = (await client.query(
    'UPDATE usp_outbox_streams SET last_sequence=last_sequence+1 WHERE stream_id=$1 RETURNING last_sequence::text AS sequence',
    [streamId],
  )).rows[0];
  const sequence = String(row.sequence);
  await client.query('INSERT INTO usp_outbox(stream_id,sequence,body) VALUES($1,$2,$3)', [streamId, sequence, body]);
  return { streamId, sequence };
}

export async function prepareProposalTx(client: PoolClient, ctx: RequestContext, raw: PrepareProposal) {
  assertLocalUsp(ctx);
  const command = UspPrepareProposalSchema.parse(raw);
  if (command.kind !== 'registry' || command.changes.length !== 1
    || command.changes[0].kind !== 'registry_draft' || command.guard.mode !== 'create') {
    throw new AppError(422, 'USP_PROPOSAL_UNSUPPORTED', 'This preparation operation is not supported by the registry bridge.');
  }
  const manifest = await scopedManifestTx(client, ctx, command.scope);
  const scopeKey = command.scope.scopeId;
  const operation = 'prepare_registry';
  const hash = fingerprint(command);
  const previous = await requestReceiptTx(client, ctx, scopeKey, operation, command.guard.requestKey, hash);
  if (previous) return previous as { proposalId: string; version: number; state: 'draft' };
  const current = await captureRegistrySnapshotTx(client, ctx, command.scope.scopeId, manifest.selection);
  if (current.digest !== manifest.digest) conflict('Source or property revisions changed. Review a fresh snapshot.');
  const change = command.changes[0];
  const draft = (await client.query('SELECT * FROM registry_drafts WHERE id=$1 AND site_id=$2 FOR UPDATE',
    [change.draftId, command.scope.scopeId])).rows[0] ?? notFound();
  if (draft.status !== 'draft' || draft.revision !== change.expectedDraftRevision) conflict('The draft changed.');
  const selections = 'target' in command ? [command.target] : command.targets;
  for (const target of selections) {
    if (!manifest.members.some(member => canonical(member.pin) === canonical(target))) conflict('A selected target changed.');
  }
  if (!draft.records.some((record: { id: string }) => selections.some(target => target.ref.id === record.id))) {
    throw new AppError(422, 'USP_DRAFT_SCOPE', 'The draft does not contain the selected record.');
  }
  const result = { proposalId: draft.id, version: draft.revision, state: 'draft' as const };
  await client.query(
    `INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), ctx.principal.subject, scopeKey, operation, command.guard.requestKey, hash, result],
  );
  await appendUspOutboxTx(client, `registry:${scopeKey}`, {
    type: 'proposal.prepared', scope: command.scope, proposalId: draft.id, correlationId: ctx.requestId,
  });
  return result;
}

export async function prepareProposal(ctx: RequestContext, raw: PrepareProposal) {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return prepareProposalTx(client, ctx, raw);
  });
}

export async function commitProposalTx(client: PoolClient, ctx: RequestContext, raw: CommitProposal) {
  assertLocalUsp(ctx);
  const command = UspCommitProposalSchema.parse(raw);
  if (command.kind !== 'registry' || command.guard.mode !== 'update'
    || command.guard.expectedManifestId !== command.scope.manifestId) {
    throw new AppError(422, 'USP_COMMIT_UNSUPPORTED', 'This reviewed commit operation is not supported.');
  }
  const hash = fingerprint(command), scopeKey = command.scope.scopeId, operation = 'commit_registry';
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  const previous = await requestReceiptTx(client, ctx, scopeKey, operation, command.guard.requestKey, hash);
  if (previous) return UspCommitReceiptSchema.parse(previous);
  const manifest = await scopedManifestTx(client, ctx, command.scope);
  const current = await captureRegistrySnapshotTx(client, ctx, scopeKey, manifest.selection);
  if (current.digest !== manifest.digest) conflict('Source or property revisions changed. Review a fresh snapshot.');
  const draft = (await client.query('SELECT * FROM registry_drafts WHERE id=$1 AND site_id=$2',
    [command.proposalId, scopeKey])).rows[0] ?? notFound();
  if (draft.status !== 'draft' || draft.revision !== command.guard.expectedVersion) conflict('The proposal changed.');
  const reviewRow = (await client.query('SELECT * FROM registry_reviews WHERE id=$1 AND draft_id=$2',
    [command.reviewId, command.proposalId])).rows[0] ?? notFound();
  if (reviewRow.committed) conflict('The review was already recorded outside this receipt.');
  const before = draft.records.map((record: { id: string; revision: number }) => ({
    ref: { namespace: 'registry_record', id: record.id }, revision: record.revision,
  }));
  // This helper retains the baseline recording lock, review checks and revision writes.
  await commitRegistryReviewTx(client, command.reviewId, command.acknowledgement);
  const afterRows = (await client.query('SELECT id,revision FROM registry_records WHERE id=ANY($1::uuid[]) ORDER BY id',
    [before.map((pin: { ref: { id: string } }) => pin.ref.id)])).rows;
  if (afterRows.length !== before.length) throw new AppError(409, 'USP_POSTWRITE_MISSING', 'A recorded target is unavailable.');
  const after = afterRows.map(row => ({ ref: { namespace: 'registry_record', id: row.id }, revision: Number(row.revision) }));
  const resulting = await captureRegistrySnapshotTx(client, ctx, scopeKey, manifest.selection.kind === 'targets'
    ? { kind: 'targets', pins: manifest.selection.pins.map(old =>
      after.find(next => next.ref.namespace === old.ref.namespace && next.ref.id === old.ref.id) ?? old) }
    : { kind: 'site' });
  const event = await appendUspOutboxTx(client, `registry:${scopeKey}`, {
    type: 'registry.recorded', scope: resulting.scope, proposalId: command.proposalId,
    reviewId: command.reviewId, correlationId: ctx.requestId,
  });
  const receipt = UspCommitReceiptSchema.parse({
    receiptId: randomUUID(), operation, requestKey: command.guard.requestKey,
    commandSha256: hash, proposalId: command.proposalId, reviewId: command.reviewId,
    before, after, snapshot: resulting.scope, event, committedAt: new Date().toISOString(),
  });
  await client.query(
    `INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [receipt.receiptId, ctx.principal.subject, scopeKey, operation, command.guard.requestKey, hash, receipt],
  );
  return receipt;
}

export async function commitProposal(ctx: RequestContext, raw: CommitProposal) {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return commitProposalTx(client, ctx, raw);
  });
}
