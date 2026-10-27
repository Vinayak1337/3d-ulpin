import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { BuildingRegister, IdentityReview, IdentityReviews } from '../../api/queries';
import type { BuildingCanonical } from '../review/recorded/model';
import {
  answeredReview, assignBody, assignSubject, captureBody, reasonError, reviewBody, reviewState,
} from './assignment';

// Ids of the demo site, Tower 3 and UNIT-3B as docs/evidence/runtime/r3/result.json step3 records them.
const SITE = 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b';
const UNIT = '46b7265e-ca88-402d-83df-065cf7c45140';
const SOURCE = '5293cd72-2377-4deb-a51c-c76d11ccb429';
const LOCATOR = 'page 1; region pt [596,390,644,409]; literal UNIT-3B';
const SCOPE = {
  kind: 'snapshot', scopeId: SITE, world: { namespace: 'world', id: `registry-site/${SITE}` },
  manifestId: 'd97e01c5-c5af-45de-971e-2bb1d355d810',
  snapshotDigest: '62615138508a4d302b414b8ee2cbc3b1f818a394ed1f916c80faaa09aa5ec2f1', stage: 'recorded',
} as const;

function review(over: Partial<IdentityReview> = {}): IdentityReview {
  return {
    reviewId: '105e6dc7-f413-4bbb-9b0f-50bfd352cf04', operation: 'assign', reason: 'A reason',
    createdAt: '2026-10-10T13:48:39.300Z', scope: SCOPE, expectedManifestId: SCOPE.manifestId,
    expectedRecordVersion: 1, used: null, commandSha256: 'de5c', ...over,
  };
}

const listing = (items: IdentityReview[], over: Partial<IdentityReviews> = {}): IdentityReviews => (
  { recordId: UNIT, siteId: SITE, items, truncated: false, unreadable: 0, ...over }
);
const used = { at: '2026-10-10T13:48:45.076Z', operation: 'assign' } as const;
const EVIDENCE = { sourceId: SOURCE, revision: 1, locator: LOCATOR };

describe('reviewState', () => {
  it('offers the review when no unused assign review is listed', () => {
    const none = reviewState({ data: listing([]), error: null });
    expect(none.kind).toBe('review');
    expect(reviewState({ data: listing([review({ used })]), error: null }).kind).toBe('review');
    expect(reviewState({ data: listing([review({ operation: 'correct' })]), error: null }).kind).toBe('review');
  });

  it('says that older reviews were not read when the page is truncated', () => {
    const state = reviewState({ data: listing([], { truncated: true }), error: null });
    expect(state).toMatchObject({ kind: 'review', text: expect.stringContaining('did not read') });
  });

  it('offers the assignment from the newest unused assign review', () => {
    const newest = review({ reviewId: 'newest' });
    const items = [review({ used }), newest, review({ reviewId: 'older' })];
    const state = reviewState({ data: listing(items), error: null });
    expect(state).toEqual({ kind: 'assign', review: newest });
  });

  it('offers nothing when a row is unreadable, even beside a usable review', () => {
    const state = reviewState({ data: listing([review()], { unreadable: 1 }), error: null });
    expect(state.kind).toBe('unreadable');
  });

  it('offers nothing when the read failed, and states the code of the refusal', () => {
    const body = { error: { code: 'INVALID_INPUT', message: 'Use a limit of 1 to 20.' } };
    const error = new ApiError(422, '/reviews', body);
    expect(reviewState({ error })).toEqual({ kind: 'unreadable', text: 'Use a limit of 1 to 20. (INVALID_INPUT)' });
    expect(reviewState({ error: null }).kind).toBe('pending');
  });
});

describe('the assignment', () => {
  it('names the four values of the review item, the unit and the key of the attempt', () => {
    const item = review();
    const body = assignBody(item, UNIT, 'key-1');
    expect(body.scope).toBe(item.scope);
    expect(body).toEqual({
      scope: SCOPE, expectedManifestId: item.expectedManifestId, reviewId: item.reviewId,
      expectedRecordVersion: item.expectedRecordVersion, recordId: UNIT, requestKey: 'key-1',
    });
  });

  it('takes the same four values from a review answered in the dialog', () => {
    const subject = { unitId: UNIT, areaId: SITE, revision: 1, evidence: EVIDENCE };
    const sent = reviewBody(SCOPE, subject, '  Read from the boxed label.  ');
    const answer = { reviewId: 'r-2', commandSha256: 'aa', expectedManifestId: SCOPE.manifestId };
    const answered = answeredReview(sent, answer, UNIT);
    expect(assignBody(answered, UNIT, 'key-2')).toEqual({
      scope: SCOPE, expectedManifestId: SCOPE.manifestId, reviewId: 'r-2', expectedRecordVersion: 1,
      recordId: UNIT, requestKey: 'key-2',
    });
    expect(answered).toMatchObject({ reason: 'Read from the boxed label.', createdAt: null });
  });
});

describe('the review of a unit stated by a source', () => {
  const subject = { unitId: UNIT, areaId: SITE, revision: 2, evidence: EVIDENCE };

  it('captures the recorded site with the unit pinned at its revision', () => {
    expect(captureBody(subject)).toEqual({
      scopeId: SITE, world: { namespace: 'world', id: `registry-site/${SITE}` }, stage: 'recorded',
      selection: { kind: 'targets', pins: [{ ref: { namespace: 'registry_record', id: UNIT }, revision: 2 }] },
    });
  });

  it('sends the assign operation, the recorded citation and no location', () => {
    const body = reviewBody(SCOPE, subject, 'A reason');
    expect(body).toEqual({
      operation: 'assign', scope: SCOPE, recordIds: [UNIT], expectedVersions: { [UNIT]: 2 }, reason: 'A reason',
      evidence: [EVIDENCE],
    });
    expect(body).not.toHaveProperty('location');
  });

  it('takes a reason of 1 to 2,000 characters after trimming', () => {
    expect(reasonError('   ')).toBe('Give the reason for this review.');
    expect(reasonError('x'.repeat(2000))).toBeNull();
    expect(reasonError('x'.repeat(2001))).toContain('2001');
  });
});

describe('assignSubject', () => {
  const citation = { sourceId: SOURCE, sourceRevision: 1 };
  const building = {
    areaId: SITE,
    inputRevisions: [{ namespace: 'registry_record', id: UNIT, revision: 2 }],
    levels: [{ spaces: [{ spaceId: UNIT, label: { citations: [citation] } }] }],
  } as unknown as BuildingCanonical;
  const register = {
    register: [{ id: UNIT, evidence: [{ sourceId: SOURCE, locator: LOCATOR }] }],
  } as unknown as BuildingRegister;

  it('reads the site, the record revision and the recorded citation from the two reads', () => {
    expect(assignSubject(building, register, UNIT)).toEqual({
      unitId: UNIT, areaId: SITE, revision: 2, evidence: EVIDENCE,
    });
  });

  it('names the value the reads do not state instead of sending a guess', () => {
    expect(assignSubject({ ...building, inputRevisions: [] }, register, UNIT)).toBe('the record revision of this unit');
    const bare = { register: [{ id: UNIT, evidence: [] }] } as unknown as BuildingRegister;
    expect(assignSubject(building, bare, UNIT)).toBe('the recorded citation of this unit');
    const cited = [{ sourceId: 'another-source', locator: LOCATOR }];
    const other = { register: [{ id: UNIT, evidence: cited }] } as unknown as BuildingRegister;
    expect(assignSubject(building, other, UNIT)).toBe('the revision of the cited source');
  });
});
