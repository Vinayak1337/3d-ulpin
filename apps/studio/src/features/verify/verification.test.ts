import { describe, expect, it } from 'vitest';
import live from '../../../../../docs/evidence/gf5/f3d/responses.json';
import type { CardVerification } from '../../api/queries';
import { cardAddress, checkRows, recordText, signatureText, verdictOf } from './verification';

const report = live.verification.data as CardVerification;
const withLifecycle = (patch: Partial<CardVerification['lifecycle']>): CardVerification =>
  ({ ...report, lifecycle: { ...report.lifecycle, ...patch } });
const revocation = { revokedAt: '2026-10-10T14:30:00.000Z', reasonCode: 'protocol_control' };

describe('the verification report of a registry card', () => {
  it('leads with Consistent for the live card and lists its six checks in the server order', () => {
    expect(verdictOf(report)).toEqual({ tone: 'success', text: 'Consistent', detail: null });
    const rows = checkRows(report);
    expect(rows.map((row) => row.key)).toEqual(report.checks.map((check) => check.key));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.state === 'Passed' && row.tone === 'success' && row.reasonCode === null)).toBe(true);
    expect(rows[0]!.label).toBe('Card body matches its fingerprint');
  });

  it('orders the verdict: revoked, not consistent, expired, superseded', () => {
    const superseded = withLifecycle({ superseded: true, latestRevision: 2 });
    expect(verdictOf(superseded)).toEqual({ tone: 'warning', text: 'Superseded by a later revision',
      detail: 'Latest revision: 2' });
    const expired = withLifecycle({ superseded: true, latestRevision: 2, expired: true });
    expect(verdictOf(expired)).toMatchObject({ tone: 'warning', text: 'Expired 11 Oct 2026, 19:09' });
    const inconsistent: CardVerification = { ...expired, result: 'inconsistent' };
    expect(verdictOf(inconsistent)).toMatchObject({ tone: 'danger', text: 'Not consistent' });
    const revoked: CardVerification = { ...inconsistent, lifecycle: { ...inconsistent.lifecycle, revocation } };
    expect(verdictOf(revoked)).toEqual({ tone: 'danger', text: 'Revoked 10 Oct 2026, 20:00',
      detail: 'Reason code: protocol_control' });
  });

  it('shows a failed and an unchecked check with the server reason code, and an unknown id as it is', () => {
    const checks = [
      { key: 'card_body', state: 'fail', reasonCode: 'CARD_FINGERPRINT' },
      { key: 'stored_linkage', state: 'not_checked', reasonCode: 'DEPENDS_ON_CARD_BODY' },
      { key: 'later_check', state: 'later_state', reasonCode: null },
    ] as unknown as CardVerification['checks'];
    expect(checkRows({ ...report, checks })).toEqual([
      { key: 'card_body', label: 'Card body matches its fingerprint', state: 'Failed', tone: 'danger',
        reasonCode: 'CARD_FINGERPRINT' },
      { key: 'stored_linkage', label: 'Stored record names this card and PDF', state: 'Not checked',
        tone: 'neutral', reasonCode: 'DEPENDS_ON_CARD_BODY' },
      { key: 'later_check', label: 'later_check', state: 'later_state', tone: 'neutral', reasonCode: null },
    ]);
  });

  it('states the signature as not assessed with its reason, never as unsigned or valid', () => {
    const text = signatureText(report.signature);
    expect(text).toBe('Signature: not assessed. Reason: no trusted key policy exists (NO_TRUSTED_KEY_POLICY).');
    expect(text).not.toMatch(/unsigned|valid/i);
  });

  it('says whether the unit record moved on since the card', () => {
    expect(recordText(report.snapshot)).toBe('Revision 2, unchanged since the card');
    expect(recordText({ cardTargetRevision: 2, currentTargetRevision: 3, state: 'changed_revision' }))
      .toBe('Revision 3 now; the card was issued for revision 2');
  });

  it('never sends a malformed card address on', () => {
    expect(cardAddress(report.cardId, '1')).toEqual({ cardId: report.cardId, revision: 1 });
    expect(cardAddress(report.cardId.toUpperCase(), '12')).toEqual({ cardId: report.cardId, revision: 12 });
    const malformed: [string | undefined, string | undefined][] = [
      ['not-a-card', '1'], [report.cardId, '0'], [report.cardId, '1.5'], [report.cardId, '-1'],
      [report.cardId, 'latest'], [report.cardId, '2147483648'], [`${report.cardId}/..`, '1'], [undefined, '1'],
      [report.cardId, undefined],
    ];
    for (const [cardId, revision] of malformed) expect(cardAddress(cardId, revision)).toBeNull();
  });
});
