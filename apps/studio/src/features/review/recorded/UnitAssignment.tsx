import { Banner, Button, Skeleton } from '@ulpin/ui';
import { useUnitReviews, type IdentityReview } from '../../../api/queries';
import { reviewState, type ReviewState } from '../../identity/assignment';
import { ReviewFacts } from '../../identity/AssignCodeDialog';
import type { RecordedUnit } from './model';
import { useSeen } from './useSeen';
import styles from './Recorded.module.css';

function AssignmentBody({ state, reading, onRead, onOpen }: {
  state: ReviewState; reading: boolean; onRead: () => void; onOpen: (listed: IdentityReview | null) => void;
}) {
  if (state.kind === 'pending') return <Skeleton width="60%" />;
  if (state.kind === 'unreadable') {
    return (
      <Banner tone="warning" action={<Button disabled={reading} onClick={onRead}>Read again</Button>}>
        The reviews of this unit could not be read. {state.text}
      </Banner>
    );
  }
  if (state.kind === 'review') {
    return (
      <>
        <p className="ul-help">{state.text}</p>
        <div><Button variant="primary" onClick={() => onOpen(null)}>Review and assign code</Button></div>
      </>
    );
  }
  return (
    <>
      <p className="ul-help">The registry lists this review for the unit. No assignment has used it.</p>
      <ReviewFacts review={state.review} />
      <div><Button variant="primary" onClick={() => onOpen(state.review)}>Assign code</Button></div>
    </>
  );
}

/**
 * What a recorded unit without a code offers, decided by the registry's reviews of it. The reviews are asked
 * for when the block scrolls into view; while they are unread or unreadable no action is offered.
 */
export function UnitAssignment({ unit, onOpen }: {
  unit: RecordedUnit; onOpen: (listed: IdentityReview | null) => void;
}) {
  const { ref, seen } = useSeen<HTMLElement>();
  const reviews = useUnitReviews(unit.id, seen);
  return (
    <section ref={ref} className={styles.cards} aria-label={`Review and code of ${unit.label}`}>
      <h5 className={styles.sublabel}>Review and code</h5>
      <AssignmentBody state={reviewState(reviews)} reading={reviews.isFetching} onRead={() => reviews.refetch()}
        onOpen={onOpen} />
    </section>
  );
}
