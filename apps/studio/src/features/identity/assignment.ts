import type {
  BuildingRegister, IdentityReview, IdentityReviews, PostBody, PostData,
} from '../../api/queries';
import type { BuildingCanonical } from '../review/recorded/model';
import { readFailure } from './registryCard';

type SnapshotBody = PostBody<'/api/v1/usp/snapshots'>;
type ReviewBody = PostBody<'/api/v1/usp/identity/reviews'>;
type AssignBody = PostBody<'/api/v1/usp/identity/assign'>;
export type SnapshotScope = PostData<'/api/v1/usp/snapshots'>['scope'];

// A recorded unit is a registry record; a snapshot of a recorded site names its world by the site id.
export const UNIT_NAMESPACE = 'registry_record';
const REASON_LIMIT = 2000;

/** What a review of one recorded unit must name, each value read from the canonical record or the register. */
export interface AssignSubject {
  unitId: string;
  /** The site: the scope of the snapshot. */
  areaId: string;
  /** The unit's record revision now. */
  revision: number;
  /** The unit's own recorded citation, with the locator as the register states it. */
  evidence: ReviewBody['evidence'][number];
}

/** The four values an assignment copies from its review, and what the unit block prints about that review. */
export type ReviewedAssignment =
  Pick<IdentityReview, 'reviewId' | 'scope' | 'expectedManifestId' | 'expectedRecordVersion' | 'reason'>
  & { /** When the registry stored the review; null for a review answered in this dialog: its answer has no time. */
    createdAt: string | null };

/** Which action a recorded unit without a code offers, from the read of its reviews. */
export type ReviewState =
  | { kind: 'pending' }
  | { kind: 'unreadable'; text: string }
  | { kind: 'review'; text: string }
  | { kind: 'assign'; review: IdentityReview };

const UNREADABLE_ROWS = 'The registry holds a review of this unit that it could not read back consistently.';
const NONE_LISTED = 'The registry lists no unused review for assigning a code to this unit.';
const NONE_AMONG_NEWEST = 'The newest reviews the registry lists for this unit hold no unused review for assigning '
  + 'a code; it holds older ones that this page did not read.';

/**
 * No unused assign review: the unit is reviewed first. The newest unused assign review: it is shown and the code
 * is assigned from it. A failed read or an unreadable row: nothing is offered, because a review may exist.
 */
export function reviewState(read: { data?: IdentityReviews; error: unknown }): ReviewState {
  if (read.error) return { kind: 'unreadable', text: readFailure(read.error) };
  if (!read.data) return { kind: 'pending' };
  if (read.data.unreadable > 0) return { kind: 'unreadable', text: UNREADABLE_ROWS };
  const review = read.data.items.find((item) => item.used === null && item.operation === 'assign');
  if (review) return { kind: 'assign', review };
  return { kind: 'review', text: read.data.truncated ? NONE_AMONG_NEWEST : NONE_LISTED };
}

/** The reason as the contract takes it: 1 to 2,000 characters after trimming. */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return 'Give the reason for this review.';
  return length > REASON_LIMIT ? `The reason is at most 2,000 characters; this one has ${length}.` : null;
}

/** The values of a review, or the name of the first one the two reads do not state. */
export function assignSubject(
  building: BuildingCanonical, register: BuildingRegister, unitId: string,
): AssignSubject | string {
  const pin = building.inputRevisions.find((item) => item.namespace === UNIT_NAMESPACE && item.id === unitId);
  if (!pin) return 'the record revision of this unit';
  const cited = register.register.find((record) => record.id === unitId)?.evidence[0];
  if (!cited) return 'the recorded citation of this unit';
  const space = building.levels.flatMap((level) => level.spaces).find((item) => item.spaceId === unitId);
  const citation = space?.label?.citations.find((item) => item.sourceId === cited.sourceId);
  if (!citation?.sourceRevision) return 'the revision of the cited source';
  const evidence = { sourceId: cited.sourceId, revision: citation.sourceRevision, locator: cited.locator };
  return { unitId, areaId: building.areaId, revision: pin.revision, evidence };
}

/** A snapshot of the recorded site that pins the unit at its revision. */
export function captureBody({ unitId, areaId, revision }: AssignSubject): SnapshotBody {
  return {
    scopeId: areaId,
    world: { namespace: 'world', id: `registry-site/${areaId}` },
    stage: 'recorded',
    selection: { kind: 'targets', pins: [{ ref: { namespace: UNIT_NAMESPACE, id: unitId }, revision }] },
  };
}

/** A review that allows one assignment. A unit stated by a source sends no location. */
export function reviewBody(scope: SnapshotScope, subject: AssignSubject, reason: string): ReviewBody {
  return {
    operation: 'assign',
    scope,
    recordIds: [subject.unitId],
    expectedVersions: { [subject.unitId]: subject.revision },
    reason: reason.trim(),
    evidence: [subject.evidence],
  };
}

/** The review this dialog just stored, in the form of a listed one: the same four values an assignment names. */
export function answeredReview(
  body: ReviewBody, answer: PostData<'/api/v1/usp/identity/reviews'>, unitId: string,
): ReviewedAssignment {
  return {
    reviewId: answer.reviewId,
    scope: body.scope,
    expectedManifestId: answer.expectedManifestId,
    expectedRecordVersion: body.expectedVersions[unitId]!,
    reason: body.reason,
    createdAt: null,
  };
}

/** The assignment a review allows: its four values unchanged, the unit and the key of this attempt. */
export function assignBody(review: ReviewedAssignment, recordId: string, requestKey: string): AssignBody {
  const { scope, expectedManifestId, reviewId, expectedRecordVersion } = review;
  return { scope, expectedManifestId, reviewId, requestKey, recordId, expectedRecordVersion };
}
