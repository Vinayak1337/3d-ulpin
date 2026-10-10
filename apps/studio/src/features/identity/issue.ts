import type { ListedCard, PostBody, PostData } from '../../api/queries';
import { UNIT_NAMESPACE, type AssignSubject, type SnapshotScope } from './assignment';
import { commandFailure, type CommandFailure } from './outcome';
import { readFailure } from './registryCard';

type EntriesBody = PostBody<'/api/v1/usp/packets/plans/entries'>;
type PlanBody = PostBody<'/api/v1/usp/packets/plans/create'>;
type ConfirmBody = PostBody<'/api/v1/usp/packets/plans/confirm'>;
type ExecuteBody = PostBody<'/api/v1/usp/packets/plans/execute'>;
type PreviewBody = PostBody<'/api/v1/usp/property-cards/preview'>;
type GenerateBody = PostBody<'/api/v1/usp/property-cards/generate'>;
export type PlanEntry = PostData<'/api/v1/usp/packets/plans/entries'>['entries'][number];
export type CardPreview = PostData<'/api/v1/usp/property-cards/preview'>;
export type CardFact = CardPreview['facts'][number];
type StoredCard = PostData<'/api/v1/usp/property-cards/read'>['card'];

/** The sentence the registry answers for an expiry it does not take; the form says it before anything is sent. */
export const EXPIRY_RULE = 'Use an expiry within the next 24 hours.';
export const INCLUSION_LIMIT = 2048;
const DAY_MS = 24 * 60 * 60 * 1000;
// The one recipe a plan of a single recorded citation uses (docs/evidence/gf5/f3e/result.json, sequence B).
const RECIPE = 'pack1-single-region-image/1';

/** The instant of a date and time typed in the officer's own time zone; null when it is not a date and time. */
export function expiryInstant(local: string): string | null {
  const time = local ? new Date(local).getTime() : Number.NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Null for an instant after now and at most 24 hours ahead; the registry's own sentence for every other value. */
export function expiryError(local: string, now: number): string | null {
  const instant = expiryInstant(local);
  const ahead = instant ? Date.parse(instant) - now : 0;
  return ahead > 0 && ahead <= DAY_MS ? null : EXPIRY_RULE;
}

/** The reason for including the citation as the plan takes it: 1 to 2,048 characters after trimming. */
export function inclusionError(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return 'Say why this citation is included.';
  return length > INCLUSION_LIMIT ? `At most 2,048 characters; this has ${length}.` : null;
}

/** What the action of the Cards block issues: a first card, or the next revision of the card that is valid now. */
export type IssueTarget =
  | { mode: 'create'; label: 'Issue card' }
  | { mode: 'update'; label: 'Issue new revision'; cardId: string; revision: number };

function revisable(card: ListedCard): boolean {
  return !card.revoked && card.expired === false && !card.superseded && card.integrity === 'consistent'
    && card.snapshotState === 'same_revision';
}

/**
 * A new revision when a listed card is valid now and its snapshot holds the unit at its present revision. A new
 * card when none is listed, when every listed one is expired or revoked, or when the unit changed since.
 */
export function issueTarget(cards: readonly ListedCard[]): IssueTarget {
  const card = cards.find(revisable);
  if (!card) return { mode: 'create', label: 'Issue card' };
  return { mode: 'update', label: 'Issue new revision', cardId: card.cardId, revision: card.revision };
}

export const cardKey = (card: { cardId: string; revision: number }) => `${card.cardId}:${card.revision}`;

/**
 * The listed row of the card this dialog asked for. With an answer of the card request it is that exact
 * revision. Without one (the answer was lost) it is a row that was not listed when the dialog opened.
 */
export function storedRow(
  cards: readonly ListedCard[], known: ReadonlySet<string>, issued: { cardId: string; revision: number } | null,
): ListedCard | null {
  const wanted = issued ? cardKey(issued) : null;
  return cards.find((card) => (wanted ? cardKey(card) === wanted : !known.has(cardKey(card)))) ?? null;
}

/** The one entry a plan of this unit names, or the sentence that says why Prepare stops at the entries. */
export function planEntry(entries: readonly PlanEntry[]): { entry: PlanEntry; stop: string | null } | string {
  const [entry] = entries;
  if (!entry || entries.length !== 1) {
    return `The registry answered ${entries.length} entries for this unit; a plan of this kind names exactly one.`;
  }
  if (entry.includable) return { entry, stop: null };
  const stop = `The registry answers that this citation cannot be included (${entry.reasonCode ?? 'no reason code'}).`;
  return { entry, stop };
}

/** The unit as a plan and a snapshot name it. */
function targetOf(subject: AssignSubject): EntriesBody['target'] {
  return { ref: { namespace: UNIT_NAMESPACE, id: subject.unitId }, revision: subject.revision };
}

export function entriesBody(scope: SnapshotScope, subject: AssignSubject): EntriesBody {
  return { scope, target: targetOf(subject) };
}

/** A plan of the unit's one recorded citation, required, with the officer's reason and the officer's expiry. */
export function planBody(
  scope: SnapshotScope, subject: AssignSubject, entry: PlanEntry,
  typed: { expiresAt: string; inclusionReason: string }, requestKey: string,
): PlanBody {
  return {
    guard: { mode: 'create', requestKey },
    input: {
      target: targetOf(subject), scope, purpose: 'record_evidence', format: 'pdf', recipe: RECIPE,
      expiresAt: typed.expiresAt,
      entries: [{ bindingId: entry.bindingId, required: true, inclusionReason: typed.inclusionReason.trim() }],
    },
  };
}

/** The plan exactly as the registry answered it, confirmed under the snapshot it was planned for. */
export function confirmBody(
  plan: { planId: string; version: number; planSha256: string }, scope: SnapshotScope, requestKey: string,
): ConfirmBody {
  return {
    planId: plan.planId, version: plan.version, planSha256: plan.planSha256, reviewed: true,
    guard: { mode: 'update', requestKey, expectedVersion: plan.version, expectedManifestId: scope.manifestId },
  };
}

export function executeBody(
  plan: { planId: string; version: number }, confirmationId: string, requestKey: string,
): ExecuteBody {
  return { planId: plan.planId, version: plan.version, confirmationId, guard: { mode: 'create', requestKey } };
}

/** What a preview and the card after it both name. Only the key of the card request is added to it. */
export type CardRequest = PreviewBody;

/** A first card of an executed plan. */
export function firstCard(plan: { planId: string; version: number }, expiresAt: string): CardRequest {
  return { planId: plan.planId, planVersion: plan.version, cardId: null, expiresAt, guard: { mode: 'create' } };
}

/** The next revision of a stored card: it keeps the plan and the snapshot the card read states. */
export function nextRevision(card: StoredCard, expiresAt: string): CardRequest {
  return {
    planId: card.planId, planVersion: card.planVersion, cardId: card.cardId, expiresAt,
    guard: { mode: 'update', expectedVersion: card.revision, expectedManifestId: card.scope.manifestId },
  };
}

/** The card request the officer read the rows of, with the one key of this prepared card. */
export function generateBody(request: CardRequest, requestKey: string): GenerateBody {
  return { ...request, guard: { ...request.guard, requestKey } };
}

/** A step of Prepare that was not answered with 200, and whether that step stores anything. */
export class StepFailure extends Error {
  constructor(readonly step: string, readonly stores: boolean, readonly reason: unknown) {
    super(`Prepare stopped at ${step}.`);
  }
}

/**
 * Why Prepare or the card request stopped. A step that only reads cannot leave an unknown outcome: its lost
 * answer is stated as a read that failed. Every other failure is stated as the commands state theirs.
 */
export function issueFailure(error: unknown): CommandFailure {
  if (!(error instanceof StepFailure)) return commandFailure(error);
  const { unknown, text } = error.stores
    ? commandFailure(error.reason)
    : { unknown: false, text: readFailure(error.reason) };
  return { unknown, text: `${error.message} ${text}` };
}

/** A row of the card as answered: its value, or its state when it has none, and its reason code when it has one. */
export function factText(fact: CardFact): { value: string; note: string | null } {
  const note = fact.state === 'available' ? null : [fact.state, fact.reasonCode].filter(Boolean).join(' · ');
  return fact.value === null ? { value: note ?? fact.state, note: null } : { value: fact.value, note };
}
