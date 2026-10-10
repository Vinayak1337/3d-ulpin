import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  assignCode, captureSnapshot, queryKeys, recordIdentityReview, unitReviewsQuery, type IdentityReview,
} from '../../api/queries';
import {
  answeredReview, assignBody, captureBody, reviewBody, reviewState,
  type AssignSubject, type ReviewedAssignment, type SnapshotScope,
} from './assignment';
import { commandFailure } from './outcome';
import { readFailure } from './registryCard';

/**
 * The review and the assignment of one recorded unit, as one dialog session holds them. Each click sends its
 * requests once. After an outcome that is unknown nothing more is sent until the record was read again.
 */
export function useAssignFlow(buildingId: string, unitId: string, listed: IdentityReview | null) {
  const client = useQueryClient();
  const [review, setReview] = useState<ReviewedAssignment | null>(listed);
  const [mustRead, setMustRead] = useState(false);
  // Set when the reviews read again hold a row the registry could not read back: nothing is offered then.
  const [blocked, setBlocked] = useState<string | null>(null);
  // The scope captured for a revision is kept, so a refused review does not store one more snapshot per click.
  const captured = useRef<{ revision: number; scope: SnapshotScope } | null>(null);
  // One key per review: a second click after a read sends the same body with the same key.
  const key = useRef<{ reviewId: string; value: string } | null>(null);
  const onError = (error: unknown) => setMustRead(commandFailure(error).unknown);

  const record = useMutation({
    mutationFn: async ({ subject, reason }: { subject: AssignSubject; reason: string }) => {
      if (captured.current?.revision !== subject.revision) {
        const { scope } = await captureSnapshot(captureBody(subject));
        captured.current = { revision: subject.revision, scope };
      }
      const body = reviewBody(captured.current.scope, subject, reason);
      return answeredReview(body, await recordIdentityReview(body), subject.unitId);
    },
    onSuccess: (answered) => {
      setReview(answered);
      // The unit block behind the dialog shows the stored review once the dialog closes.
      void client.invalidateQueries({ queryKey: queryKeys.unitReviews(unitId) });
    },
    onError,
  });

  const assign = useMutation({
    mutationFn: (from: ReviewedAssignment) => {
      if (key.current?.reviewId !== from.reviewId) {
        key.current = { reviewId: from.reviewId, value: crypto.randomUUID() };
      }
      return assignCode(assignBody(from, unitId, key.current.value));
    },
    // The code is printed from the canonical record, so everything read for this building is read again.
    onSuccess: () => client.invalidateQueries({ queryKey: ['buildings', buildingId] }),
    onError,
  });

  const readAgain = useMutation({
    mutationFn: async () => {
      await client.refetchQueries({ queryKey: queryKeys.buildingCanonical(buildingId) }, { throwOnError: true });
      return reviewState({ data: await client.fetchQuery(unitReviewsQuery(unitId)), error: null });
    },
    onSuccess: (state) => {
      setReview(state.kind === 'assign' ? state.review : null);
      setBlocked(state.kind === 'unreadable' ? state.text : null);
      setMustRead(false);
      record.reset();
      assign.reset();
    },
  });

  const error = assign.error ?? record.error;
  return {
    review, mustRead, blocked, record, assign, readAgain,
    busy: record.isPending || assign.isPending || readAgain.isPending,
    failure: error ? commandFailure(error) : null,
    readError: readAgain.error ? `The record could not be read again. ${readFailure(readAgain.error)}` : null,
    /** After a refused assignment the officer may leave the listed review and record a new one. */
    reviewAgain: () => { setReview(null); assign.reset(); },
  };
}

export type AssignFlow = ReturnType<typeof useAssignFlow>;
