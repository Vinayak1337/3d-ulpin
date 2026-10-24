import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import type { RequestContext } from '@ulpin/contracts/usp';
import { UspListPropertyCardsSchema, UspPropertyCardListSchema, UspPropertyCardSchema, type PropertyCard,
  type PropertyCardList } from '../../../../../contracts/src/usp/property-card';
import { transaction } from '../../../infrastructure/db';
import { AppError } from '../../../infrastructure/errors';
import { readManifest } from '../snapshots';
import { actor, cardBodyDefect, currentRevisionTx, executedView, link, storedLinkageHolds } from './card-service';
import { readPacketPlan } from './plan-service';

type Command = ReturnType<typeof UspListPropertyCardsSchema.parse>;
type Item = PropertyCardList['items'][number];
type PlanView = Awaited<ReturnType<typeof readPacketPlan>>;
type Row = {
  id: string; revision: number; manifest_id: string; plan_id: string; plan_version: number; body: unknown;
  object_key: unknown; artifact_hash: unknown; latest_revision: number; revoked_at: Date | null; read_at: Date;
};

/** Every fact of a row whose body cannot be relied on. The verification read explains such a row. */
const UNKNOWN = { latestRevision: null, superseded: null, createdAt: null, expiresAt: null, expired: null,
  revoked: null, revokedAt: null, targetRevision: null, currentTargetRevision: null, snapshotState: null,
  profile: null, artifact: null, cardSha256: null, resolverUrl: null };

const planKey = (row: Row) => `${row.plan_id}:${row.plan_version}`;

/** Whether an error of the given kinds was thrown; anything else, such as an unavailable service, is rethrown. */
function refused(check: () => void, statuses: readonly number[]) {
  try {
    check();
    return false;
  } catch (error) {
    if (error instanceof AppError && statuses.includes(error.status)) return true;
    throw error;
  }
}

/**
 * One statement reads the page: each row with the latest revision of its card, its revocation and the database
 * clock. Rows are chosen by the row's own site and subject columns and by the target of the plan the row names,
 * never by the card body, so a changed body can neither add a row to a list nor remove one from it.
 */
async function pageTx(client: PoolClient, ctx: RequestContext, command: Command) {
  const { scope, target, limit } = command;
  return (await client.query(`SELECT c.id,c.revision,c.manifest_id,c.plan_id,c.plan_version,c.body,c.object_key,
      c.artifact_hash,(SELECT max(l.revision) FROM usp_property_cards l WHERE l.id=c.id) AS latest_revision,
      r.revoked_at,clock_timestamp() AS read_at
    FROM usp_property_cards c
    JOIN usp_packet_plans p ON p.id=c.plan_id AND p.version=c.plan_version
    LEFT JOIN usp_property_card_revocations r ON r.card_id=c.id AND r.revision=c.revision
    WHERE c.site_id=$1 AND c.subject=$2
      AND p.body->'input'->'target'->'ref'->>'namespace'=$3 AND p.body->'input'->'target'->'ref'->>'id'=$4
    ORDER BY c.created_at DESC,c.id,c.revision DESC LIMIT $5`,
  [scope.scopeId, ctx.principal.subject, target.namespace, target.id, limit + 1])).rows as Row[];
}

/** The plan reader's own authority for one plan of the page, or null when it refuses the caller or the plan
 * it returns is not for the requested site and target. */
async function admittedPlan(ctx: RequestContext, command: Command, row: Row): Promise<PlanView | null> {
  try {
    const view = await readPacketPlan(ctx, { planId: row.plan_id, version: Number(row.plan_version) });
    const { scope, target } = view.plan.input;
    const requested = scope.scopeId === command.scope.scopeId && target.ref.namespace === command.target.namespace
      && target.ref.id === command.target.id;
    return requested ? view : null;
  } catch (error) {
    if (error instanceof ZodError) return null;
    if (error instanceof AppError && [403, 404, 409, 422].includes(error.status)) return null;
    throw error;
  }
}

/** The row's body when it parses, agrees with its own fingerprint and resolver and is named by the row's columns. */
function intactCard(row: Row) {
  const parsed = UspPropertyCardSchema.safeParse(row.body);
  if (!parsed.success || cardBodyDefect(parsed.data)) return null;
  return storedLinkageHolds(row, parsed.data, row.id, Number(row.revision)) ? parsed.data : null;
}

/** The state compares the revision the card was generated from with the record now, as the card read and the
 * consistency report do. The scope of the request names the site only and takes no part in it. */
function consistentItem(row: Row, card: PropertyCard, currentTargetRevision: number): Item {
  const latestRevision = Number(row.latest_revision), revokedAt = row.revoked_at && new Date(row.revoked_at);
  return { cardId: card.cardId, revision: card.revision, integrity: 'consistent', latestRevision,
    superseded: latestRevision > card.revision, createdAt: card.createdAt, expiresAt: card.expiresAt,
    expired: new Date(row.read_at).getTime() >= Date.parse(card.expiresAt), revoked: revokedAt !== null,
    revokedAt: revokedAt?.toISOString() ?? null, targetRevision: card.target.revision, currentTargetRevision,
    snapshotState: currentTargetRevision === card.target.revision ? 'same_revision' : 'changed_revision',
    profile: card.profile, artifact: { sha256: card.artifact.sha256, bytes: card.artifact.bytes },
    cardSha256: card.cardSha256, resolverUrl: card.resolverUrl };
}

/** One listed row, or null when it is not the caller's to see. */
function listedItem(ctx: RequestContext, row: Row, view: PlanView, currentTargetRevision: number): Item | null {
  if (view.plan.input.scope.manifestId !== row.manifest_id) return null;
  const card = intactCard(row), executed = executedView(view);
  const inconsistent: Item = { cardId: row.id, revision: Number(row.revision), integrity: 'inconsistent', ...UNKNOWN };
  if (!card) return inconsistent;
  if (refused(() => actor(ctx, card), [403])) return null;
  if (!executed || refused(() => link(card, executed), [409])) return inconsistent;
  return consistentItem(row, card, currentTargetRevision);
}

/**
 * The caller's own card revisions of one target in one site, newest first, without any card fact. It writes
 * nothing. The scope is checked as on every USP read; cards of earlier snapshots of the same site are listed too.
 * A row is listed only when its subject column is the caller and the plan reader admits the caller to its plan
 * (at most one plan read per distinct plan of the page, so at most `limit`); a row with an intact body must also
 * name the caller as creator under the current access view and policy.
 */
export async function listPropertyCards(ctx: RequestContext, raw: unknown): Promise<PropertyCardList> {
  const command = UspListPropertyCardsSchema.parse(raw);
  await readManifest(ctx, command.scope);
  const rows = await transaction(client => pageTx(client, ctx, command)), page = rows.slice(0, command.limit);
  const plans = new Map<string, PlanView | null>();
  for (const row of page)
    if (!plans.has(planKey(row))) plans.set(planKey(row), await admittedPlan(ctx, command, row));
  const admitted = [...plans.values()].find(view => view !== null);
  if (!admitted) return UspPropertyCardListSchema.parse({ items: [], truncated: rows.length > command.limit });
  // Every admitted plan names the requested target record, so its current revision is read once.
  const current = await transaction(client => currentRevisionTx(client, admitted.plan));
  const items = page.flatMap(row => {
    const view = plans.get(planKey(row));
    return (view && listedItem(ctx, row, view, current)) ?? [];
  });
  return UspPropertyCardListSchema.parse({ items, truncated: rows.length > command.limit });
}
