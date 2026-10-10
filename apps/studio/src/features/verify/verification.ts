import { formatDateTime } from '@ulpin/ui';
import type { CardVerification } from '../../api/queries';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** The one statement the page leads with, and a second line where the report gives one. */
export interface Verdict {
  tone: Exclude<Tone, 'neutral'>;
  text: string;
  detail: string | null;
}

export interface CheckRow {
  key: string;
  label: string;
  state: string;
  tone: Tone;
  /** The server's reason code for a check that did not pass, as it is. */
  reasonCode: string | null;
}

// The server's check ids in plain words. An id that is not listed is shown as it is.
const CHECK_LABELS: Record<string, string> = {
  card_body: 'Card body matches its fingerprint',
  stored_linkage: 'Stored record names this card and PDF',
  revision_chain: 'Earlier revisions present and intact',
  artifact_bytes: 'Stored PDF matches its hash',
  plan_link: 'Card linked to its executed plan',
  packet_bytes: 'Linked packet reads back intact',
};
const CHECK_STATES: Record<string, { word: string; tone: Tone }> = {
  pass: { word: 'Passed', tone: 'success' },
  fail: { word: 'Failed', tone: 'danger' },
  not_checked: { word: 'Not checked', tone: 'neutral' },
};
const SIGNATURE_STATES: Record<string, string> = { not_assessed: 'not assessed' };
const SIGNATURE_REASONS: Record<string, string> = { NO_TRUSTED_KEY_POLICY: 'no trusted key policy exists' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^[1-9]\d{0,9}$/;
// The largest revision number the card routes accept.
const MAX_REVISION = 2_147_483_647;

/** The card id and revision an address names, or null when it cannot name a card: that is never sent on. */
export function cardAddress(cardId: string | undefined, revision: string | undefined) {
  if (!cardId || !revision || !UUID.test(cardId) || !REVISION.test(revision)) return null;
  const number = Number(revision);
  return number <= MAX_REVISION ? { cardId: cardId.toLowerCase(), revision: number } : null;
}

/** The first that the report states, in the order revoked, not consistent, expired, superseded, consistent. */
export function verdictOf(report: CardVerification): Verdict {
  const { revocation, expired, expiresAt, superseded, latestRevision } = report.lifecycle;
  if (revocation) {
    return { tone: 'danger', text: `Revoked ${formatDateTime(revocation.revokedAt)}`,
      detail: `Reason code: ${revocation.reasonCode}` };
  }
  if (report.result !== 'consistent') return { tone: 'danger', text: 'Not consistent', detail: null };
  if (expired) {
    return { tone: 'warning', text: expiresAt ? `Expired ${formatDateTime(expiresAt)}` : 'Expired', detail: null };
  }
  if (superseded) {
    return { tone: 'warning', text: 'Superseded by a later revision', detail: `Latest revision: ${latestRevision}` };
  }
  return { tone: 'success', text: 'Consistent', detail: null };
}

/** Every check the report names, in the server's order. */
export function checkRows(report: CardVerification): CheckRow[] {
  return report.checks.map((check) => {
    const state = CHECK_STATES[check.state];
    return { key: check.key, label: CHECK_LABELS[check.key] ?? check.key, state: state?.word ?? check.state,
      tone: state?.tone ?? 'neutral', reasonCode: check.reasonCode };
  });
}

/** The signature assessment as the server states it. Not assessed is never worded as unsigned or as valid. */
export function signatureText(signature: CardVerification['signature']): string {
  const state = SIGNATURE_STATES[signature.state] ?? signature.state;
  const reason = SIGNATURE_REASONS[signature.reasonCode];
  const why = reason ? `${reason} (${signature.reasonCode})` : signature.reasonCode;
  return `Signature: ${state}. Reason: ${why}.`;
}

/** Whether the unit's record is still at the revision the card was issued for, with both revision numbers. */
export function recordText(snapshot: CardVerification['snapshot']): string {
  const { cardTargetRevision, currentTargetRevision } = snapshot;
  if (snapshot.state === 'same_revision') return `Revision ${cardTargetRevision}, unchanged since the card`;
  return `Revision ${currentTargetRevision} now; the card was issued for revision ${cardTargetRevision}`;
}
