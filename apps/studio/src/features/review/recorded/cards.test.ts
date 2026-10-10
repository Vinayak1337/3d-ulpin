import { describe, expect, it } from 'vitest';
import live from '../../../../../../docs/evidence/gf5/f3d/responses.json';
import { mergeUnitCards, type ListedCard, type UnitCards } from '../../../api/queries';
import { issueTarget } from '../../identity/issue';
import { cardRows, noCardText, searchGaps, snapshotText } from './cards';

const listed = live.cardList.data.items[0] as ListedCard;
// The shape the server lists for a row it could not read back consistently: every detail is null.
const inconsistent: ListedCard = { cardId: listed.cardId, revision: 2, integrity: 'inconsistent',
  latestRevision: null, superseded: null, createdAt: null, expiresAt: null, expired: null, revoked: null,
  revokedAt: null, targetRevision: null, currentTargetRevision: null, snapshotState: null, profile: null,
  artifact: null, cardSha256: null, resolverUrl: null };
const none: UnitCards = { snapshotCreatedAt: null, cards: [], truncated: false, searchedAll: true,
  unlisted: false, snapshots: 0, unread: 0 };
const whole = { truncated: false, unreadable: 0 };
const page = (...items: ListedCard[]) => ({ items, truncated: false });

describe('the cards listed for a recorded unit', () => {
  it('shows the live card as valid until its expiry, with both actions', () => {
    expect(cardRows(live.cardList.data.items as ListedCard[])).toEqual([{
      key: `${listed.cardId}:1`, cardId: listed.cardId, card: '6a997624', revision: 1,
      issued: '10 Oct 2026, 19:19',
      status: 'Valid until 11 Oct 2026, 19:09', tone: 'success', readable: true, unit: 'At its present revision',
    }]);
  });

  it('says expired once the server reports it, with the time the card expired', () => {
    const [row] = cardRows([{ ...listed, expired: true }]);
    expect(row).toMatchObject({ status: 'Expired 11 Oct 2026, 19:09', tone: 'neutral', readable: true });
  });

  it('puts a revocation before an expiry, with its time when the listing gives one', () => {
    const revoked = { ...listed, expired: true, revoked: true, revokedAt: '2026-10-10T14:30:00.000Z' };
    expect(cardRows([revoked])[0]).toMatchObject({ status: 'Revoked 10 Oct 2026, 20:00', tone: 'danger' });
    expect(cardRows([{ ...revoked, revokedAt: null }])[0]!.status).toBe('Revoked');
  });

  it('shows no detail and offers no PDF for a row that could not be read back consistently', () => {
    expect(cardRows([inconsistent])).toEqual([{ key: `${listed.cardId}:2`, cardId: listed.cardId,
      card: '6a997624', revision: 2, issued: null, status: 'Inconsistent', tone: 'warning', readable: false, unit: null }]);
  });

  it('does not word a missing expiry as valid', () => {
    expect(cardRows([{ ...listed, expiresAt: null }])[0]!.status).toBe('Expiry not reported');
    expect(cardRows([{ ...listed, expired: null }])[0]!.status).toBe('Expiry not reported');
  });

  it('keeps the order the server lists', () => {
    const rows = cardRows([inconsistent, listed]);
    expect(rows.map((row) => row.revision)).toEqual([2, 1]);
  });

  it('says on each row whether its snapshot holds the unit at its present revision', () => {
    const [row] = cardRows([{ ...listed, snapshotState: 'changed_revision' }]);
    expect(row!.unit).toBe('Changed since this card');
  });

  it('counts the snapshots read and names the newest that lists a card by its creation time', () => {
    const at = live.snapshots.items[0]!.createdAt;
    expect(snapshotText({ ...none, snapshots: 5, unread: 2 }, at))
      .toBe('Read under 3 snapshots; the newest that lists a card is of 10 Oct 2026, 19:18');
    expect(snapshotText({ ...none, snapshots: 1 }, at)).toContain('Read under 1 snapshot;');
  });

  it('says no card was issued only when every snapshot was searched', () => {
    expect(noCardText(none)).toBe('No card has been issued for this unit.');
    const short = noCardText({ ...none, searchedAll: false, snapshots: 5, unread: 2 });
    expect(short).toBe('No card is listed under the snapshots of this building that were read. '
      + '2 of 5 snapshots could not be read.');
  });
});

describe('the cards of a unit across the snapshots the listing returns', () => {
  const older: ListedCard = { ...listed, cardId: 'an-older-card', expired: true };
  const changed: ListedCard = { ...listed, revision: 2, snapshotState: 'changed_revision' };

  it('lists every card the snapshots hold once, where the newest snapshot lists it', () => {
    const merged = mergeUnitCards([
      { createdAt: 'newest', page: page() },
      { createdAt: 'second', page: page(changed, listed) },
      { createdAt: 'third', page: page(listed, older) },
    ], whole);
    expect(merged.cards).toEqual([changed, listed, older]);
    expect(merged).toMatchObject({ snapshotCreatedAt: 'second', truncated: false, searchedAll: true,
      unlisted: false, snapshots: 3, unread: 0 });
    expect(searchGaps(merged)).toEqual([]);
    expect(cardRows(merged.cards).map((row) => row.unit))
      .toEqual(['Changed since this card', 'At its present revision', 'At its present revision']);
    expect(cardRows(merged.cards).map((row) => `${row.card} r${row.revision}`))
      .toEqual(['6a997624 r2', '6a997624 r1', 'an-older r1']);
  });

  it('counts a snapshot whose card read failed and names it in one sentence, never as none listed', () => {
    const reads = [{ createdAt: 'a', page: null }, { createdAt: 'b', page: page(listed) },
      { createdAt: 'c', page: null }, { createdAt: 'd', page: page() }, { createdAt: 'e', page: page(older) }];
    const merged = mergeUnitCards(reads, whole);
    expect(merged).toMatchObject({ snapshotCreatedAt: 'b', cards: [listed, older], searchedAll: false,
      snapshots: 5, unread: 2 });
    expect(searchGaps(merged)).toEqual(['2 of 5 snapshots could not be read.']);
    const one = mergeUnitCards(reads.slice(0, 2), whole);
    expect(searchGaps(one)).toEqual(['1 of 2 snapshots could not be read.']);
    expect(noCardText(mergeUnitCards([reads[0]!, reads[3]!], whole))).toContain('1 of 2 snapshots could not be');
  });

  it('says when the listing left snapshots out, and when a scope holds more cards than its page', () => {
    const reads = [{ createdAt: 'a', page: { items: [listed], truncated: true } }, { createdAt: 'b', page: null }];
    const merged = mergeUnitCards(reads, { truncated: true, unreadable: 0 });
    expect(merged).toMatchObject({ truncated: true, searchedAll: false, unlisted: true });
    expect(searchGaps(merged)).toEqual(['1 of 2 snapshots could not be read.',
      'Older or unreadable snapshots of this building were not searched.']);
    expect(mergeUnitCards([], { truncated: false, unreadable: 1 })).toMatchObject({ cards: [], unlisted: true,
      searchedAll: false, snapshotCreatedAt: null });
  });

  it('lets the issue action decide from the whole list, not from the newest snapshot alone', () => {
    const merged = mergeUnitCards([{ createdAt: 'newest', page: page(older) },
      { createdAt: 'older', page: page(listed) }], whole);
    expect(issueTarget(merged.cards)).toMatchObject({ mode: 'update', cardId: listed.cardId, revision: 1 });
    expect(issueTarget(mergeUnitCards([{ createdAt: 'newest', page: page(older) }], whole).cards).mode)
      .toBe('create');
  });
});
