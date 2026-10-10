import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { ListedCard } from '../../api/queries';
import {
  cardKey, confirmBody, EXPIRY_RULE, expiryError, expiryInstant, factText, firstCard, generateBody, inclusionError,
  issueFailure, issueTarget, nextRevision, planBody, planEntry, StepFailure, storedRow, type PlanEntry,
} from './issue';

// Ids of the demo site and UNIT-3B, its plan and its card as docs/evidence/runtime/r3/result.json step3 records.
const SITE = 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b';
const UNIT = '46b7265e-ca88-402d-83df-065cf7c45140';
const CARD = '6a997624-6c8d-40a9-8215-8a671a74dc1c';
const PLAN = { planId: '8f3ebb97-deab-4235-a377-819e5942bfd8', version: 1, planSha256: 'ea15' };
const SCOPE = {
  kind: 'snapshot', scopeId: SITE, world: { namespace: 'world', id: `registry-site/${SITE}` },
  manifestId: 'a9fd4c9d-0a5a-4f4d-9032-527ab7857b78', snapshotDigest: 'b7bf', stage: 'recorded',
} as const;
const EVIDENCE = { sourceId: '5293cd72-2377-4deb-a51c-c76d11ccb429', revision: 1, locator: 'page 1' };
const SUBJECT = { unitId: UNIT, areaId: SITE, revision: 2, evidence: EVIDENCE };
const ENTRY: PlanEntry = {
  bindingId: '1e32', kind: 'source_statement', label: 'UNIT-3B', includable: true, reasonCode: null,
  citation: { ...EVIDENCE, page: 1, region: [596, 390, 644, 409] },
};

const listed = (over: Partial<ListedCard> = {}) => ({
  cardId: CARD, revision: 1, integrity: 'consistent', latestRevision: 1, superseded: false, expired: false,
  revoked: false, revokedAt: null, snapshotState: 'same_revision', ...over,
}) as ListedCard;

describe('Valid until', () => {
  const now = new Date('2026-10-10T12:00').getTime();

  it('takes an instant after now and at most 24 hours ahead', () => {
    expect(expiryError('2026-10-10T12:01', now)).toBeNull();
    expect(expiryError('2026-10-11T12:00', now)).toBeNull();
    expect(expiryInstant('2026-10-11T12:00')).toBe(new Date('2026-10-11T12:00').toISOString());
  });

  it('refuses the past, more than 24 hours ahead and no value with the sentence of the registry', () => {
    expect(expiryError('2026-10-10T12:00', now)).toBe(EXPIRY_RULE);
    expect(expiryError('2026-10-10T11:59', now)).toBe(EXPIRY_RULE);
    expect(expiryError('2026-10-11T12:01', now)).toBe(EXPIRY_RULE);
    expect(expiryError('', now)).toBe(EXPIRY_RULE);
    expect(expiryInstant('not a date')).toBeNull();
  });
});

describe('the reason for the citation', () => {
  it('takes 1 to 2,048 characters after trimming', () => {
    expect(inclusionError('  ')).toBe('Say why this citation is included.');
    expect(inclusionError('x'.repeat(2048))).toBeNull();
    expect(inclusionError('x'.repeat(2049))).toContain('2049');
  });
});

describe('issueTarget', () => {
  it('issues a first card when none is listed, or every listed one is expired or revoked', () => {
    expect(issueTarget([])).toEqual({ mode: 'create', label: 'Issue card' });
    expect(issueTarget([listed({ expired: true }), listed({ revoked: true })]).mode).toBe('create');
  });

  it('issues a first card when the unit changed after the snapshot of the listed card', () => {
    expect(issueTarget([listed({ snapshotState: 'changed_revision' })]).label).toBe('Issue card');
    expect(issueTarget([listed({ snapshotState: null })]).label).toBe('Issue card');
  });

  it('issues the next revision of the card that is valid now, from its latest revision', () => {
    const cards = [listed({ revision: 2, latestRevision: 2 }), listed({ superseded: true, latestRevision: 2 })];
    expect(issueTarget(cards)).toEqual({ mode: 'update', label: 'Issue new revision', cardId: CARD, revision: 2 });
  });
});

describe('planEntry', () => {
  it('plans the one entry the registry answers', () => {
    expect(planEntry([ENTRY])).toEqual({ entry: ENTRY, stop: null });
  });

  it('stops at an entry that is not includable and states its reason code', () => {
    const entry = { ...ENTRY, includable: false, reasonCode: 'source_part_unavailable' };
    expect(planEntry([entry])).toEqual({
      entry, stop: 'The registry answers that this citation cannot be included (source_part_unavailable).',
    });
  });

  it('stops when the registry answers no entry, or more than the plan names', () => {
    expect(planEntry([])).toContain('answered 0 entries');
    expect(planEntry([ENTRY, ENTRY])).toContain('answered 2 entries');
  });
});

describe('the requests of a card', () => {
  const typed = { expiresAt: '2026-10-11T06:30:00.000Z', inclusionReason: '  The boxed label.  ' };

  it('plans the answered binding with the typed reason and the typed expiry', () => {
    const { guard, input } = planBody(SCOPE, SUBJECT, ENTRY, typed, 'key-1');
    expect(guard).toEqual({ mode: 'create', requestKey: 'key-1' });
    expect(input).toMatchObject({
      target: { ref: { namespace: 'registry_record', id: UNIT }, revision: 2 }, scope: SCOPE,
      expiresAt: typed.expiresAt, recipe: 'pack1-single-region-image/1',
      entries: [{ bindingId: '1e32', required: true, inclusionReason: 'The boxed label.' }],
    });
  });

  it('confirms the plan as answered under the snapshot it was planned for', () => {
    expect(confirmBody(PLAN, SCOPE, 'key-2')).toEqual({
      ...PLAN, reviewed: true,
      guard: { mode: 'update', requestKey: 'key-2', expectedVersion: 1, expectedManifestId: SCOPE.manifestId },
    });
  });

  it('sends the same expiry with the plan, the preview and the card, and adds only the key to the card', () => {
    const request = firstCard(PLAN, typed.expiresAt);
    expect(request).toEqual({
      planId: PLAN.planId, planVersion: 1, cardId: null, expiresAt: typed.expiresAt, guard: { mode: 'create' },
    });
    expect(generateBody(request, 'key-3')).toEqual({ ...request, guard: { mode: 'create', requestKey: 'key-3' } });
  });

  it('takes the plan, the revision and the snapshot of a new revision from the card read', () => {
    const card = { cardId: CARD, revision: 1, planId: PLAN.planId, planVersion: 1, scope: SCOPE };
    const request = nextRevision(card as Parameters<typeof nextRevision>[0], typed.expiresAt);
    expect(request).toEqual({
      planId: PLAN.planId, planVersion: 1, cardId: CARD, expiresAt: typed.expiresAt,
      guard: { mode: 'update', expectedVersion: 1, expectedManifestId: SCOPE.manifestId },
    });
  });
});

describe('issueFailure', () => {
  const lost = new TypeError('Failed to fetch');

  it('calls a lost answer of a step that stores an unknown outcome, and names the step', () => {
    const failure = issueFailure(new StepFailure('the plan', true, lost));
    expect(failure.unknown).toBe(true);
    expect(failure.text).toBe('Prepare stopped at the plan. '
      + 'The result is unknown: no answer says whether the registry stored anything.');
  });

  it('states a lost answer of a step that only reads as a failed read', () => {
    const failure = issueFailure(new StepFailure('the rows of the card', false, lost));
    expect(failure).toEqual({ unknown: false,
      text: 'Prepare stopped at the rows of the card. The server gave no answer.' });
  });

  it('states a refusal of a step and of the card request with the words of its code', () => {
    const body = (code: string, message: string) => ({ error: { code, message, retryable: false } });
    const blocked = new ApiError(409, '/confirm', body('PACKET_PLAN_BLOCKED', 'Required context is not available.'));
    expect(issueFailure(new StepFailure('the confirmation of the plan', true, blocked))).toEqual({
      unknown: false,
      text: 'Prepare stopped at the confirmation of the plan. '
        + "The plan does not hold the unit's citation, so it cannot be confirmed. (PACKET_PLAN_BLOCKED)",
    });
    const expiry = new ApiError(422, '/generate', body('CARD_EXPIRY', 'Use a card expiry within the next 24 hours.'));
    expect(issueFailure(expiry).text).toBe('Use a card expiry within the next 24 hours. (CARD_EXPIRY)');
    expect(issueFailure(lost).unknown).toBe(true);
  });
});

describe('storedRow', () => {
  const known = new Set([cardKey({ cardId: CARD, revision: 1 })]);

  it('finds the exact revision the card request answered', () => {
    const cards = [listed({ revision: 2 }), listed()];
    expect(storedRow(cards, known, { cardId: CARD, revision: 2 })).toBe(cards[0]);
    expect(storedRow([listed()], known, { cardId: CARD, revision: 2 })).toBeNull();
  });

  it('after a lost answer finds a row that was not listed when the dialog opened, and nothing else', () => {
    const fresh = listed({ cardId: 'another-card' });
    expect(storedRow([fresh, listed()], known, null)).toBe(fresh);
    expect(storedRow([listed()], known, null)).toBeNull();
  });
});

describe('factText', () => {
  const fact = { key: 'use', label: 'Use / classification' };

  it('prints an available row by its value, and the state and reason code of any other row', () => {
    const available = { ...fact, state: 'available', value: 'UNIT-3B', reasonCode: null } as const;
    expect(factText(available)).toEqual({ value: 'UNIT-3B', note: null });
    const reasonCode = 'use_not_recorded';
    const unavailable = { ...fact, state: 'unavailable', value: 'Not recorded', reasonCode } as const;
    expect(factText(unavailable)).toEqual({ value: 'Not recorded', note: 'unavailable · use_not_recorded' });
    const bare = { ...fact, state: 'not_assessed', value: null, reasonCode: null } as const;
    expect(factText(bare)).toEqual({ value: 'not_assessed', note: null });
  });
});
