import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RequestContext } from '@ulpin/contracts/usp';
import { UspGeneratePropertyCardSchema, UspReadPropertyCardSchema, UspPropertyCardSchema,
  UspPropertyCardViewSchema, type PropertyCard } from '../../../../../contracts/src/usp/property-card';
import { UspPacketPlanViewSchema, type PacketPlan } from '../../../../../contracts/src/usp/packets';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { readObject, openObjectStream, putOriginal, sha256 } from '../../../infrastructure/storage';
import { canonical, fingerprint } from '../../cases/domain';
import { assertLocalUsp } from '../snapshots';
import { requestReceiptTx } from '../commands';
import { appendUspOutboxTx } from '../outbox';
import { readPacket0 } from '../packet0';
import { readPacketPlan } from './plan-service';
import { authorizePlanTx, protectPlanDisclosureTx } from './plan-authority';
import { projectCardFactsTx } from './card-projection';
import { propertyCardResolverUrl, renderPropertyCard } from './card-render';

const MAX_BYTES = 524288;
type ArtifactRead = (key: string, bytes: number, hash: string) => Promise<Uint8Array>;
/** Internal controlled transport, never accepted from an HTTP request. */
export type PropertyCardIo = { readPacket: typeof readObject; readCard: ArtifactRead; put: typeof putOriginal };
async function boundedCardRead(key: string, bytes: number, hash: string) {
  const object = await openObjectStream(key, bytes, 30000), chunks: Buffer[] = []; let count = 0;
  try {
    for await (const value of object.body) {
      const chunk = Buffer.from(value); count += chunk.length;
      if (count > bytes || count > MAX_BYTES) throw new AppError(422, 'CARD_ARTIFACT_INTEGRITY', 'Stored card exceeds its byte receipt.');
      chunks.push(chunk);
    }
    const result = Buffer.concat(chunks, count);
    if (count !== bytes || sha256(result) !== hash) throw new AppError(422, 'CARD_ARTIFACT_INTEGRITY', 'Stored card does not match its receipt.');
    return result;
  } finally { object.body.destroy(); }
}
const storage: PropertyCardIo = { readPacket: readObject, readCard: boundedCardRead,
  put: (key, bytes, mediaType) => putOriginal(key, bytes, mediaType, AbortSignal.timeout(30000)) };
function validateCard(raw: unknown) {
  const card = UspPropertyCardSchema.parse(raw), { cardSha256, ...body } = card;
  if (fingerprint(body) !== cardSha256 || card.previousRevision !== (card.revision === 1 ? null : card.revision - 1))
    conflict('The immutable card failed its integrity check.');
  // A saved local origin remains exact even if the configured port later changes.
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/api\/v1\/usp\/property-cards\/[a-f0-9-]{36}\/revisions\/[1-9]\d*$/.test(card.resolverUrl)
    || Number(new URL(card.resolverUrl).port) > 65535
    || new URL(card.resolverUrl).pathname !== `/api/v1/usp/property-cards/${card.cardId}/revisions/${card.revision}`)
    conflict('The saved resolver does not name this exact local card revision.');
  return card;
}
function actor(ctx: RequestContext, card: PropertyCard) {
  assertLocalUsp(ctx);
  if (canonical(ctx.principal) !== canonical(card.creator) || ctx.accessViewId !== card.accessViewId || ctx.policyVersion !== card.policyVersion)
    throw new AppError(403, 'CARD_ACCESS', 'Current operator access does not authorize this private card.');
}
async function liveTx(client: PoolClient, expiresAt: string) {
  if (!(await client.query('SELECT clock_timestamp() < $1::timestamptz AS live', [expiresAt])).rows[0]?.live)
    throw new AppError(403, 'CARD_EXPIRED', 'This exact card revision expired.');
}
async function storedTx(client: PoolClient, cardId: string, revision: number) {
  const row = (await client.query('SELECT body,object_key,artifact_hash FROM usp_property_cards WHERE id=$1 AND revision=$2', [cardId, revision])).rows[0]
    ?? notFound('The exact property card revision is unavailable.');
  const card = validateCard(row.body);
  if (card.cardId !== cardId || card.revision !== revision || row.artifact_hash !== card.artifact.sha256
    || row.object_key !== `usp/property-cards/${cardId}/${revision}/${card.artifact.sha256}`) conflict('The saved card linkage changed.');
  return { card, objectKey: row.object_key as string };
}
type Executed = Awaited<ReturnType<typeof readPacketPlan>> & { confirmation: NonNullable<Awaited<ReturnType<typeof readPacketPlan>>['confirmation']>;
  execution: NonNullable<Awaited<ReturnType<typeof readPacketPlan>>['execution']> };
async function executed(ctx: RequestContext, planId: string, version: number): Promise<Executed> {
  const view = await readPacketPlan(ctx, { planId, version });
  if (!view.confirmation || !view.execution || view.plan.requiredContext !== 'available')
    throw new AppError(422, 'CARD_EXECUTED_PLAN_REQUIRED', 'Execute a confirmed complete text/CSV plan before generating a card.');
  return view as Executed;
}
/** Compare the exact immutable linkage on this same protected transaction client. */
async function protectedTx(client: PoolClient, ctx: RequestContext, view: Executed) {
  await protectPlanDisclosureTx(client, ctx, view.plan);
  await authorizePlanTx(client, ctx, view.plan, true);
  const { planId, version } = view.plan;
  const plan = (await client.query('SELECT body FROM usp_packet_plans WHERE id=$1 AND version=$2', [planId, version])).rows[0]?.body;
  const confirmation = (await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2', [planId, version])).rows[0]?.body;
  const execution = (await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2', [planId, version])).rows[0]?.body;
  if (canonical(UspPacketPlanViewSchema.parse({ plan, confirmation, execution })) !== canonical(view)) conflict('The exact executed plan linkage changed.');
}
function link(card: PropertyCard, view: Executed) {
  const plan = view.plan;
  if (card.planId !== plan.planId || card.planVersion !== plan.version || card.planSha256 !== plan.planSha256
    || card.confirmationId !== view.confirmation.confirmationId || card.packetId !== view.execution.packet.packetId
    || card.packetSha256 !== view.execution.packet.artifact.sha256 || card.targetBodySha256 !== plan.targetBodySha256
    || canonical(card.target) !== canonical(plan.input.target) || canonical(card.scope) !== canonical(plan.input.scope)
    || canonical(card.creator) !== canonical(plan.creator) || card.accessViewId !== plan.accessViewId || card.policyVersion !== plan.policyVersion
    || canonical(card.evidenceEntrySha256) !== canonical(plan.entries.filter(e => e.state === 'included').map(e => e.entrySha256))
    || canonical(card.omissions) !== canonical(view.execution.omissions)) conflict('The card does not match its immutable plan and packet.');
}
async function authorityTx(client: PoolClient, ctx: RequestContext, card: PropertyCard, view: Executed) {
  actor(ctx, card); link(card, view); await protectedTx(client, ctx, view); await liveTx(client, card.expiresAt);
}
async function currentRevisionTx(client: PoolClient, plan: PacketPlan) {
  const row = (await client.query('SELECT revision FROM registry_records WHERE id=$1 AND site_id=$2 FOR SHARE',
    [plan.input.target.ref.id, plan.input.scope.scopeId])).rows[0] ?? notFound('The selected target is unavailable.');
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) conflict('The current target revision is unavailable.');
  return revision;
}
export async function generatePropertyCard(ctx: RequestContext, raw: unknown, io: PropertyCardIo = storage) {
  assertLocalUsp(ctx);
  const command = UspGeneratePropertyCardSchema.parse(raw), hash = fingerprint(command), operation = 'property_card_generate';
  const view = await executed(ctx, command.planId, command.planVersion), plan = view.plan;
  const prepare = async (client: PoolClient) => {
    await protectedTx(client, ctx, view);
    const replay = await requestReceiptTx(client, ctx, plan.input.scope.scopeId, operation, command.guard.requestKey, hash);
    if (replay) {
      const card = validateCard(replay); await authorityTx(client, ctx, card, view);
      const saved = await storedTx(client, card.cardId, card.revision);
      if (canonical(saved.card) !== canonical(card)) conflict('The replay card is unavailable.');
      return { replay: card };
    }
    const expiry = Date.parse(command.expiresAt) - Date.now();
    if (expiry <= 0 || expiry > 24 * 60 * 60 * 1000) throw new AppError(422, 'CARD_EXPIRY', 'Use a card expiry within the next 24 hours.');
    let revision = 1;
    if (command.guard.mode === 'update') {
      const old = (await storedTx(client, command.cardId!, command.guard.expectedVersion)).card;
      // This first profile appends a refreshed expiry for the same executed context.
      // A different snapshot/plan gets a distinct card, never an implicit retarget.
      actor(ctx, old);
      if (old.planId !== plan.planId || old.planVersion !== plan.version || command.guard.expectedManifestId !== old.scope.manifestId)
        throw new AppError(422, 'CARD_REVISION_CONTEXT', 'Create a separate card for a different executed plan or snapshot.');
      link(old, view);
      const latest = (await client.query('SELECT max(revision) AS revision FROM usp_property_cards WHERE id=$1', [old.cardId])).rows[0];
      if (Number(latest?.revision) !== old.revision) conflict('A newer immutable card revision exists.');
      if (old.revision === 2147483647) throw new AppError(422, 'CARD_REVISION_BOUND', 'This card has reached its revision bound. Create a separate card.');
      revision = old.revision + 1;
    }
    const projection = await projectCardFactsTx(client, ctx, plan);
    await authorizePlanTx(client, ctx, plan, true); await liveTx(client, command.expiresAt);
    return { revision, projection };
  };
  const first = await transaction(prepare);
  if (first.replay) return first.replay;
  // The linked private packet is verified through its existing protected reader.
  const packet = await readPacket0(ctx, view.execution.packet.packetId, io.readPacket);
  if (canonical(packet.receipt) !== canonical(view.execution.packet)) conflict('The exact linked packet is unavailable.');
  const cardId = command.cardId ?? randomUUID(), revision = first.revision!;
  const body = { cardId, revision, previousRevision: revision === 1 ? null : revision - 1,
    profile: 'property-card-summary-ascii/1' as const, mode: 'local_operator' as const,
    planId: plan.planId, planVersion: plan.version, planSha256: plan.planSha256,
    confirmationId: view.confirmation.confirmationId, packetId: packet.receipt.packetId, packetSha256: packet.receipt.artifact.sha256,
    target: plan.input.target, scope: plan.input.scope, targetBodySha256: plan.targetBodySha256,
    ...first.projection!, creator: ctx.principal, accessViewId: ctx.accessViewId, policyVersion: ctx.policyVersion,
    evidenceEntrySha256: plan.entries.filter(e => e.state === 'included').map(e => e.entrySha256), omissions: view.execution.omissions,
    resolverUrl: propertyCardResolverUrl(cardId, revision), createdAt: new Date().toISOString(), expiresAt: command.expiresAt };
  const bytes = renderPropertyCard(body), artifact = { sha256: sha256(bytes), bytes: bytes.length, contentType: 'application/pdf' as const, pages: 1 as const };
  const content = { ...body, artifact }, card = UspPropertyCardSchema.parse({ ...content, cardSha256: fingerprint(content) });
  const key = `usp/property-cards/${cardId}/${revision}/${artifact.sha256}`;
  // Object I/O holds no SQL transaction. A rejected final publication may leave
  // an unreferenced immutable derivative, never an altered source or packet.
  await io.put(key, bytes, 'application/pdf');
  return transaction(async client => {
    const final = await prepare(client);
    if (final.replay) return final.replay;
    if (final.revision !== revision || canonical(final.projection) !== canonical(first.projection)) conflict('The exact card projection changed.');
    await authorityTx(client, ctx, card, view);
    await client.query(`INSERT INTO usp_property_cards(id,revision,site_id,manifest_id,plan_id,plan_version,packet_id,subject,artifact_hash,object_key,body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [cardId, revision, plan.input.scope.scopeId, plan.input.scope.manifestId,
      plan.planId, plan.version, packet.receipt.packetId, ctx.principal.subject, artifact.sha256, key, card]);
    await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), ctx.principal.subject, plan.input.scope.scopeId, operation, command.guard.requestKey, hash, card]);
    await appendUspOutboxTx(client, `property-card:${cardId}`, { type: 'property.card.created', scope: card.scope,
      cardId, revision, cardSha256: card.cardSha256, artifactSha256: artifact.sha256, planId: plan.planId, version: plan.version, correlationId: ctx.requestId });
    return card;
  });
}
/** Exact immutable metadata, with current target revision reported separately. */
export async function readPropertyCard(ctx: RequestContext, raw: unknown) {
  assertLocalUsp(ctx);
  const command = UspReadPropertyCardSchema.parse(raw);
  const saved = await transaction(client => storedTx(client, command.cardId, command.revision));
  actor(ctx, saved.card);
  const view = await executed(ctx, saved.card.planId, saved.card.planVersion);
  return transaction(async client => {
    await authorityTx(client, ctx, saved.card, view);
    const currentTargetRevision = await currentRevisionTx(client, view.plan);
    await authorizePlanTx(client, ctx, view.plan, true); await liveTx(client, saved.card.expiresAt);
    return UspPropertyCardViewSchema.parse({ card: saved.card, currentTargetRevision,
      snapshotState: currentTargetRevision === saved.card.target.revision ? 'same_revision' : 'changed_revision' });
  });
}
/** Resolver and download share one bounded, before/after protected read path. */
export async function resolvePropertyCard(ctx: RequestContext, raw: unknown, io: PropertyCardIo = storage) {
  const before = await readPropertyCard(ctx, raw), card = before.card;
  const key = `usp/property-cards/${card.cardId}/${card.revision}/${card.artifact.sha256}`;
  const bytes = await io.readCard(key, card.artifact.bytes, card.artifact.sha256);
  if (bytes.length !== card.artifact.bytes || bytes.length > MAX_BYTES || sha256(bytes) !== card.artifact.sha256)
    throw new AppError(422, 'CARD_ARTIFACT_INTEGRITY', 'The saved PDF does not match this exact card revision.');
  const after = await readPropertyCard(ctx, raw);
  return { ...after, bytes };
}
