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
}

const NO_CARD = 'No card has been issued for this unit.';
const NOT_ALL_SEARCHED = 'No card is listed under the newest snapshots of this building. '
  + 'Older or unreadable snapshots were not searched.';

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
  };
}

/** The listed card revisions in the server's order (newest first). */
export function cardRows(cards: readonly ListedCard[]): CardRow[] {
  return cards.map(cardRow);
}

/** The snapshot the cards were read under, named by when it was created. */
export function snapshotText(createdAt: string): string {
  return `Read under the snapshot of ${formatDateTime(createdAt)}`;
}

/** What to say when no scope lists a card: that none was issued only when every snapshot was searched. */
export function noCardText(cards: UnitCards): string {
  return cards.searchedAll ? NO_CARD : NOT_ALL_SEARCHED;
}
