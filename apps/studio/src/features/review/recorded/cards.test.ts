import { describe, expect, it } from 'vitest';
import live from '../../../../../../docs/evidence/gf5/f3d/responses.json';
import type { ListedCard, UnitCards } from '../../../api/queries';
import { cardRows, noCardText, snapshotText } from './cards';

const listed = live.cardList.data.items[0] as ListedCard;
// The shape the server lists for a row it could not read back consistently: every detail is null.
const inconsistent: ListedCard = { cardId: listed.cardId, revision: 2, integrity: 'inconsistent',
  latestRevision: null, superseded: null, createdAt: null, expiresAt: null, expired: null, revoked: null,
  revokedAt: null, targetRevision: null, currentTargetRevision: null, snapshotState: null, profile: null,
  artifact: null, cardSha256: null, resolverUrl: null };
const none: UnitCards = { snapshotCreatedAt: null, cards: [], truncated: false, searchedAll: true };

describe('the cards listed for a recorded unit', () => {
  it('shows the live card as valid until its expiry, with both actions', () => {
    expect(cardRows(live.cardList.data.items as ListedCard[])).toEqual([{
      key: `${listed.cardId}:1`, cardId: listed.cardId, revision: 1, issued: '10 Oct 2026, 19:19',
      status: 'Valid until 11 Oct 2026, 19:09', tone: 'success', readable: true,
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
    expect(cardRows([inconsistent])).toEqual([{ key: `${listed.cardId}:2`, cardId: listed.cardId, revision: 2,
      issued: null, status: 'Inconsistent', tone: 'warning', readable: false }]);
  });

  it('does not word a missing expiry as valid', () => {
    expect(cardRows([{ ...listed, expiresAt: null }])[0]!.status).toBe('Expiry not reported');
    expect(cardRows([{ ...listed, expired: null }])[0]!.status).toBe('Expiry not reported');
  });

  it('keeps the order the server lists', () => {
    const rows = cardRows([inconsistent, listed]);
    expect(rows.map((row) => row.revision)).toEqual([2, 1]);
  });

  it('names the snapshot the cards were read under by its creation time', () => {
    expect(snapshotText(live.snapshots.items[0]!.createdAt)).toBe('Read under the snapshot of 10 Oct 2026, 19:18');
  });

  it('says no card was issued only when every snapshot was searched', () => {
    expect(noCardText(none)).toBe('No card has been issued for this unit.');
    expect(noCardText({ ...none, searchedAll: false })).not.toContain('No card has been issued');
  });
});
