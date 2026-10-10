import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import type { RequestContext } from '@ulpin/contracts/usp';
import { UspPropertyCardSchema, UspPropertyCardVerificationSchema, UspReadPropertyCardSchema, type PropertyCard,
  type PropertyCardVerification } from '../../../../../contracts/src/usp/property-card';
import { transaction } from '../../../infrastructure/db';
import { AppError, notFound } from '../../../infrastructure/errors';
import { objectMissing } from '../../../infrastructure/storage';
import { canonical } from '../../cases/domain';
import { assertLocalUsp } from '../snapshots';
import { authorizePlanTx, protectPlanDisclosureTx } from './plan-authority';
import { readPacketPlan } from './plan-service';
import { cardAccessDenied, cardArtifact, cardBodyDefect, currentRevisionTx, executedView, expiredTx, link,
  linkedPacket, planLinkageTx, storage, storedLinkageHolds, type Executed, type PropertyCardIo } from './card-service';

/** Earlier revisions read by one report. A longer chain fails its check instead of passing unread. */
export const REVISION_CHAIN_LIMIT = 64;

type Check = PropertyCardVerification['checks'][number];
type CheckKey = Check['key'];
type Command = { cardId: string; revision: number };
type PlanView = Awaited<ReturnType<typeof readPacketPlan>>;
type CardRow = {
  subject: string; site_id: string; manifest_id: string; plan_id: string; plan_version: number;
  body: unknown; object_key: unknown; artifact_hash: unknown;
};
type ChainRow = Pick<CardRow, 'body' | 'object_key' | 'artifact_hash'> & { revision: number };
/** This revision's body once it is known to be this row's intact body, or the check that says it is not. */
type Anchor = { card: PropertyCard } | { card: null; unmet: CheckKey };

const outcome = (key: CheckKey, defect: string | null): Check =>
  ({ key, state: defect ? 'fail' : 'pass', reasonCode: defect });
/** A check that rests on an earlier one is not run when that one did not pass, and names it. */
const dependsOn = (key: CheckKey, earlier: CheckKey): Check =>
  ({ key, state: 'not_checked', reasonCode: `DEPENDS_ON_${earlier.toUpperCase()}` });

/** Runs a thrown check of the read path. A refusal of the stored state is the finding; an access denial or
 * an unavailable service is rethrown, so it never becomes a report. */
async function refuses(check: () => unknown) {
  try {
    await check();
    return false;
  } catch (error) {
    if (error instanceof ZodError) return true;
    if (error instanceof AppError && [404, 409, 422].includes(error.status)) return true;
    throw error;
  }
}

async function cardRowTx(client: PoolClient, command: Command) {
  const row = (await client.query(`SELECT subject,site_id,manifest_id,plan_id,plan_version,body,object_key,artifact_hash
    FROM usp_property_cards WHERE id=$1 AND revision=$2`, [command.cardId, command.revision])).rows[0];
  // One answer for an unknown card and an unknown revision, as on the resolver: no latest-revision fallback.
  return (row ?? notFound('The exact property card revision is unavailable.')) as CardRow;
}

/** Access rests on the row's subject and scope columns and on the plan reader's own authority. The card body
 * is not read here, so a changed body can neither grant nor widen it. */
async function authorizedPlan(ctx: RequestContext, row: CardRow) {
  if (row.subject !== ctx.principal.subject) throw cardAccessDenied();
  const view = await readPacketPlan(ctx, { planId: row.plan_id, version: Number(row.plan_version) });
  const scope = view.plan.input.scope;
  if (scope.scopeId !== row.site_id || scope.manifestId !== row.manifest_id) throw cardAccessDenied();
  return view;
}

/** The parsed body is returned only when it agrees with itself; otherwise the reason it does not. */
function intactBody(body: unknown): { card: PropertyCard; defect: null } | { card: null; defect: string } {
  const parsed = UspPropertyCardSchema.safeParse(body);
  if (!parsed.success) return { card: null, defect: 'CARD_BODY_SCHEMA' };
  const defect = cardBodyDefect(parsed.data);
  return defect ? { card: null, defect } : { card: parsed.data, defect: null };
}

function anchoredCard(row: CardRow, card: PropertyCard | null, command: Command): { check: Check; anchor: Anchor } {
  const key = 'stored_linkage';
  if (!card) return { check: dependsOn(key, 'card_body'), anchor: { card: null, unmet: 'card_body' } };
  if (storedLinkageHolds(row, card, command.cardId, command.revision))
    return { check: outcome(key, null), anchor: { card } };
  return { check: outcome(key, 'STORED_LINKAGE'), anchor: { card: null, unmet: key } };
}

async function artifactDefect(card: PropertyCard, io: PropertyCardIo) {
  try {
    await cardArtifact(card, io);
    return null;
  } catch (error) {
    if (objectMissing(error)) return 'CARD_ARTIFACT_MISSING';
    if (error instanceof AppError && error.status === 422) return 'CARD_ARTIFACT_INTEGRITY';
    throw error;
  }
}

function earlierRevisionDefect(row: ChainRow | undefined, card: PropertyCard, revision: number) {
  if (!row || Number(row.revision) !== revision) return 'REVISION_MISSING';
  const earlier = intactBody(row.body).card;
  if (!earlier) return 'REVISION_BODY';
  if (!storedLinkageHolds(row, earlier, card.cardId, revision)) return 'REVISION_LINKAGE';
  const sameContext = earlier.planId === card.planId && earlier.planVersion === card.planVersion
    && earlier.packetId === card.packetId && canonical(earlier.target) === canonical(card.target);
  return sameContext ? null : 'REVISION_CONTEXT';
}

/** Each earlier revision already names its predecessor inside its own body check; this adds that every one of
 * them exists as its own row and belongs to the same plan, packet and target pin. */
async function revisionChainDefectTx(client: PoolClient, card: PropertyCard) {
  if (card.revision - 1 > REVISION_CHAIN_LIMIT) return 'REVISION_CHAIN_LIMIT';
  const rows = (await client.query(`SELECT revision,body,object_key,artifact_hash FROM usp_property_cards
    WHERE id=$1 AND revision<$2 ORDER BY revision`, [card.cardId, card.revision])).rows as ChainRow[];
  for (let revision = 1; revision < card.revision; revision++) {
    const defect = earlierRevisionDefect(rows[revision - 1], card, revision);
    if (defect) return defect;
  }
  return null;
}

async function planLinkCheckTx(client: PoolClient, card: PropertyCard | null, executed: Executed | null) {
  const key = 'plan_link';
  if (!executed) return outcome(key, 'EXECUTED_PLAN_UNAVAILABLE');
  if (!card) return dependsOn(key, 'card_body');
  if (await refuses(() => link(card, executed))) return outcome(key, 'CARD_PLAN_LINK');
  return outcome(key, await refuses(() => planLinkageTx(client, executed)) ? 'STORED_PLAN_LINK' : null);
}

async function packetBytesCheck(ctx: RequestContext, executed: Executed | null, io: PropertyCardIo) {
  const key = 'packet_bytes';
  // Without an executed plan there is no linked packet to read; plan_link reports that failure.
  if (!executed) return dependsOn(key, 'plan_link');
  return outcome(key, await refuses(() => linkedPacket(ctx, executed, io)) ? 'LINKED_PACKET' : null);
}

async function lifecycleTx(client: PoolClient, command: Command, card: PropertyCard | null) {
  const latest = (await client.query('SELECT max(revision) AS revision FROM usp_property_cards WHERE id=$1',
    [command.cardId])).rows[0];
  const latestRevision = Number(latest.revision);
  return { latestRevision, superseded: latestRevision > command.revision, expiresAt: card?.expiresAt ?? null,
    expired: card ? await expiredTx(client, card.expiresAt) : null, revocation: null };
}

async function snapshotTx(client: PoolClient, view: PlanView) {
  const cardTargetRevision = view.plan.input.target.revision;
  const currentTargetRevision = await currentRevisionTx(client, view.plan);
  const state = currentTargetRevision === cardTargetRevision ? 'same_revision' as const : 'changed_revision' as const;
  return { cardTargetRevision, currentTargetRevision, state };
}

/**
 * Reports whether one exact card revision still agrees with its own stored hash chain, plan and packet.
 * Access is settled first and again after the object reads; only then is a failed check an answer
 * (`inconsistent`) instead of a refusal. Expiry and a later revision are states here, not refusals.
 * Nothing is written.
 */
export async function verifyPropertyCard(ctx: RequestContext, raw: unknown, io: PropertyCardIo = storage) {
  assertLocalUsp(ctx);
  const command = UspReadPropertyCardSchema.parse(raw);
  const row = await transaction(client => cardRowTx(client, command));
  const view = await authorizedPlan(ctx, row), executed = executedView(view);
  const body = intactBody(row.body), cardBody = outcome('card_body', body.defect);
  const { check: storedLinkage, anchor } = anchoredCard(row, body.card, command);
  // Object reads hold no SQL connection, as on the resolver.
  const artifactBytes = anchor.card ? outcome('artifact_bytes', await artifactDefect(anchor.card, io))
    : dependsOn('artifact_bytes', anchor.unmet);
  const packetBytes = await packetBytesCheck(ctx, executed, io);
  const report = await transaction(async client => {
    await protectPlanDisclosureTx(client, ctx, view.plan);
    await authorizePlanTx(client, ctx, view.plan, true);
    const revisionChain = anchor.card ? outcome('revision_chain', await revisionChainDefectTx(client, anchor.card))
      : dependsOn('revision_chain', anchor.unmet);
    const planLink = await planLinkCheckTx(client, body.card, executed);
    const checks = [cardBody, storedLinkage, revisionChain, artifactBytes, planLink, packetBytes];
    const lifecycle = await lifecycleTx(client, command, anchor.card), snapshot = await snapshotTx(client, view);
    await authorizePlanTx(client, ctx, view.plan, true);
    return UspPropertyCardVerificationSchema.parse({ ...command, checkedAt: new Date().toISOString(),
      result: checks.every(check => check.state === 'pass') ? 'consistent' : 'inconsistent', checks, lifecycle,
      snapshot, signature: { state: 'not_assessed', reasonCode: 'NO_TRUSTED_KEY_POLICY' } });
  });
  return { report, scope: view.plan.input.scope };
}
