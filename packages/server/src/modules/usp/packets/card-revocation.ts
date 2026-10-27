import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RequestContext } from '@ulpin/contracts/usp';
import { UspPropertyCardRevocationSchema, UspRevokePropertyCardSchema,
  type PropertyCardRevocation } from '../../../../../contracts/src/usp/property-card';
import { transaction } from '../../../infrastructure/db';
import { fingerprint } from '../../cases/domain';
import { requestReceiptTx } from '../commands';
import { appendUspOutboxTx } from '../outbox';
import { assertLocalUsp } from '../snapshots';
import { actor, cardLifecycleTx, lockCardTx, storedTx } from './card-service';

const OPERATION = 'property_card_revoke';

/** The one revocation row, its command receipt and its event commit or roll back together. */
async function recordTx(client: PoolClient, ctx: RequestContext, requestKey: string, commandSha256: string,
  revocation: PropertyCardRevocation) {
  const { cardId, revision, cardSha256, reasonCode, scope } = revocation, subject = ctx.principal.subject;
  await client.query(`INSERT INTO usp_property_card_revocations(card_id,revision,subject,reason_code,body,revoked_at)
    VALUES($1,$2,$3,$4,$5,$6)`, [cardId, revision, subject, reasonCode, revocation, revocation.revokedAt]);
  await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), subject, scope.scopeId, OPERATION, requestKey, commandSha256,
    revocation]);
  await appendUspOutboxTx(client, `property-card:${cardId}`, { type: 'property.card.revoked', scope, cardId, revision,
    cardSha256, reasonCode, correlationId: ctx.requestId });
}

/**
 * Revokes one exact card revision. Only the card's creator, under the access view and policy the card was created
 * with, may do so. No current plan authority and no expiry is asked for, so a card stays revocable after its sources
 * or its expiry moved on. The card row and its PDF are never touched: one append-only row records the revocation.
 * The same request key returns its own receipt; any other key for an already revoked revision gets the first one.
 */
export async function revokePropertyCard(ctx: RequestContext, raw: unknown): Promise<PropertyCardRevocation> {
  assertLocalUsp(ctx);
  const command = UspRevokePropertyCardSchema.parse(raw), hash = fingerprint(command);
  return transaction(async client => {
    const { card } = await storedTx(client, command.cardId, command.revision);
    actor(ctx, card);
    await lockCardTx(client, card.cardId);
    const replay = await requestReceiptTx(client, ctx, card.scope.scopeId, OPERATION, command.guard.requestKey, hash);
    const first = replay ?? (await cardLifecycleTx(client, card.cardId, card.revision, card.expiresAt)).revocation;
    if (first) return UspPropertyCardRevocationSchema.parse(first);
    const revocation = UspPropertyCardRevocationSchema.parse({ cardId: card.cardId, revision: card.revision,
      cardSha256: card.cardSha256, reasonCode: command.reasonCode, reason: command.reason, scope: card.scope,
      revokedAt: new Date().toISOString() });
    await recordTx(client, ctx, command.guard.requestKey, hash, revocation);
    return revocation;
  });
}
