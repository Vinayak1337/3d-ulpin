import { formatDateTime } from '@ulpin/ui';
import type { ListedCard, UnitCards } from '../../../api/queries';

export type CardTone = 'danger' | 'warning' | 'neutral' | 'success';

/** One listed card revision as the Cards block shows it. Every text comes from the listing. */
export interface CardRow {
  key: string;
  cardId: string;
  revision: number;
  /** When the revision was issued; null when the server could not read the row back consistently. */
  issued: string | null;
  status: string;
  tone: CardTone;
  /** False for a row the server could not read back consistently: its PDF is not offered. */
  readable: boolean;
  /** Whether the card's snapshot holds the unit at its present revision; null when the row does not say. */
  unit: string | null;
}

const NO_CARD = 'No card has been issued for this unit.';
const NONE_LISTED = 'No card is listed under the snapshots of this building that were read.';
const NOT_ALL_LISTED = 'Older or unreadable snapshots of this building were not searched.';
const UNIT_STATES: Record<NonNullable<ListedCard['snapshotState']>, string> = {
  same_revision: 'At its present revision',
  changed_revision: 'Changed since this card',
};

function timed(word: string, at: string | null): string {
  return at ? `${word} ${formatDateTime(at)}` : word;
}

/** One status per row, in the order revoked, inconsistent, expired, valid: the first that the listing states. */
function statusOf(card: ListedCard): Pick<CardRow, 'status' | 'tone'> {
  if (card.revoked) return { status: timed('Revoked', card.revokedAt), tone: 'danger' };
  if (card.integrity === 'inconsistent') return { status: 'Inconsistent', tone: 'warning' };
  if (card.expired) return { status: timed('Expired', card.expiresAt), tone: 'neutral' };
  if (card.expired === false && card.expiresAt) {
    return { status: timed('Valid until', card.expiresAt), tone: 'success' };
  }
  return { status: 'Expiry not reported', tone: 'neutral' };
}

function cardRow(card: ListedCard): CardRow {
  return {
    key: `${card.cardId}:${card.revision}`,
    cardId: card.cardId,
    revision: card.revision,
    issued: card.createdAt ? formatDateTime(card.createdAt) : null,
    ...statusOf(card),
    readable: card.integrity === 'consistent',
    unit: card.snapshotState ? UNIT_STATES[card.snapshotState] : null,
  };
}

/** The listed card revisions in the order they were read: newest snapshot first, then the server's order. */
export function cardRows(cards: readonly ListedCard[]): CardRow[] {
  return cards.map(cardRow);
}

/** How many snapshots the cards were read under, and when the newest that lists one was created. */
export function snapshotText(cards: UnitCards, createdAt: string): string {
  const read = cards.snapshots - cards.unread;
  const snapshots = read === 1 ? '1 snapshot' : `${read} snapshots`;
  return `Read under ${snapshots}; the newest that lists a card is of ${formatDateTime(createdAt)}`;
}

/**
 * What the list could not cover, one sentence each: the snapshots whose card read failed, counted, and the
 * snapshots the listing itself left out. Empty when every snapshot of the building was read.
 */
export function searchGaps(cards: UnitCards): string[] {
  const { unread, snapshots } = cards;
  const noun = snapshots === 1 ? 'snapshot' : 'snapshots';
  const failed = unread ? [`${unread} of ${snapshots} ${noun} could not be read.`] : [];
  return cards.unlisted ? [...failed, NOT_ALL_LISTED] : failed;
}

/** What to say when no scope lists a card: that none was issued only when every snapshot was searched. */
export function noCardText(cards: UnitCards): string {
  return cards.searchedAll ? NO_CARD : [NONE_LISTED, ...searchGaps(cards)].join(' ');
}
