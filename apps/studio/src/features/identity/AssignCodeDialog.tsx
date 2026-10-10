import { useId, useState, type ReactNode } from 'react';
import { Banner, Button, DescriptionList, Dialog, Skeleton, formatDateTime } from '@ulpin/ui';
import { useBuildingCanonical, useBuildingRegister, type IdentityReview } from '../../api/queries';
import { sourceLabelGaps, type RecordedUnit } from '../review/recorded/model';
import { assignSubject, reasonError, type AssignSubject, type ReviewedAssignment } from './assignment';
import { CopyableId } from './CopyableId';
import { readFailure } from './registryCard';
import { useAssignFlow, type AssignFlow } from './useAssignFlow';
import styles from './Registry.module.css';

const ALLOWS = 'Recording this review allows one assignment of an application code to this unit at this record '
  + 'revision. The review changes no record by itself.';
const NO_TIME = 'Stored from this dialog; the answer of the review states no time.';
const REASON_HELP = 'Required, at most 2,000 characters. The registry keeps the reason with the review.';

/** What is being decided, read from the record: the unit, its floor, its citation and its revision. */
function Decided({ unit, floorLabel, subject, gaps }: {
  unit: RecordedUnit; floorLabel: string; subject: AssignSubject | string; gaps: string[];
}) {
  const cited = unit.citations.map((citation) => `${citation.source} · ${citation.locator}`).join('; ');
  return (
    <>
      <DescriptionList items={[
        { label: 'Unit', value: unit.label },
        { label: 'Floor', value: floorLabel },
        { label: 'Citation', value: cited || 'No citation recorded' },
        { label: 'Record revision', value: typeof subject === 'string' ? 'Not stated' : subject.revision },
      ]} />
      {gaps.map((gap) => <p key={gap} className="ul-help">{gap}</p>)}
    </>
  );
}

/** The review an assignment will name: its reason, when the registry stored it and the snapshot it is bound to. */
export function ReviewFacts({ review }: { review: ReviewedAssignment }) {
  return (
    <DescriptionList items={[
      { label: 'Reason', value: <p className={styles.reason}>{review.reason}</p> },
      { label: 'Recorded', value: review.createdAt ? formatDateTime(review.createdAt) : NO_TIME },
      { label: 'Review', value: <p className={styles.answered}>{review.reviewId}</p> },
      { label: 'Bound to snapshot', value: <p className={styles.answered}>{review.expectedManifestId}</p> },
      { label: 'At record revision', value: review.expectedRecordVersion },
    ]} />
  );
}

function ReasonField({ reason, onChange }: { reason: string; onChange: (value: string) => void }) {
  const [touched, setTouched] = useState(false);
  const id = useId();
  const error = touched ? reasonError(reason) : null;
  return (
    <div className={styles.field}>
      <label className="ul-label" htmlFor={id}>Reason for this review (required)</label>
      {/* The form can arrive after the dialog (the register is read first), so the field takes focus itself. */}
      <textarea id={id} autoFocus className={styles.text} value={reason} aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`} onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)} />
      <span id={`${id}-help`} className="ul-help">{error ?? REASON_HELP}</span>
    </div>
  );
}

/** The record states the code: the assignment is done. The receipt is shown when this dialog sent it. */
function Assigned({ code, flow }: { code: string | null; flow: AssignFlow }) {
  const receipt = flow.assign.data;
  return (
    <>
      {code ? (
        <DescriptionList items={[{ label: 'Application code', value: <CopyableId id={code} name="code" /> }]} />
      ) : <p>The registry answered the assignment. The record read after it does not state the code yet.</p>}
      {code ? <p className="ul-help">Read from the record of this unit.</p> : null}
      {receipt ? (
        <p className={styles.answered}>
          Receipt {receipt.receiptId} · committed {formatDateTime(receipt.committedAt)}
        </p>
      ) : null}
    </>
  );
}

function Notices({ flow, subject }: { flow: AssignFlow; subject: AssignSubject | string }) {
  return (
    <>
      {typeof subject === 'string' ? (
        <Banner tone="warning">The record does not state {subject}, so no review can be sent.</Banner>
      ) : null}
      {flow.blocked ? <Banner tone="warning">{flow.blocked}</Banner> : null}
      {flow.failure ? <Banner tone={flow.failure.unknown ? 'warning' : 'danger'}>{flow.failure.text}</Banner> : null}
      {flow.readError ? <Banner tone="warning">{flow.readError}</Banner> : null}
    </>
  );
}

function Unread({ error }: { error: unknown }) {
  if (!error) return <Skeleton />;
  return <Banner tone="warning">The record of this unit could not be read. {readFailure(error)}</Banner>;
}

function footer(flow: AssignFlow, done: boolean, primary: ReactNode, onClose: () => void) {
  if (done) return <Button variant="primary" onClick={onClose}>Close</Button>;
  const refused = flow.review && flow.assign.error && !flow.mustRead;
  return (
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onClose}>{flow.assign.isSuccess ? 'Close' : 'Cancel'}</Button>
      {refused ? <Button disabled={flow.busy} onClick={flow.reviewAgain}>Record a new review</Button> : null}
      {flow.mustRead || flow.assign.isSuccess ? (
        <Button disabled={flow.busy} onClick={() => flow.readAgain.mutate()}>Read the record again</Button>
      ) : null}
      {flow.assign.isSuccess ? null : primary}
    </div>
  );
}

/**
 * Review a recorded unit and assign its application code through the registry. A unit that has an unused review
 * opens on that review; otherwise the officer gives the reason first. The code shown at the end is the one the
 * canonical record states, never the one an answer carried.
 */
export function AssignCodeDialog({ buildingId, unit, floorLabel, listed, onClose }: {
  buildingId: string; unit: RecordedUnit; floorLabel: string; listed: IdentityReview | null; onClose: () => void;
}) {
  const canonical = useBuildingCanonical(buildingId);
  const registered = useBuildingRegister(buildingId);
  const [building, register, unread] = [canonical.data, registered.data, canonical.error ?? registered.error];
  const flow = useAssignFlow(buildingId, unit.id, listed);
  const [reason, setReason] = useState('');
  const subject = building && register ? assignSubject(building, register, unit.id) : null;
  const stated = subject && typeof subject !== 'string' ? subject : null;
  const ready = stated && !flow.mustRead && !flow.blocked && !flow.busy;
  const { review } = flow;
  const primary = review ? (
    <Button variant="primary" disabled={!ready} onClick={() => flow.assign.mutate(review)}>Assign code</Button>
  ) : (
    <Button variant="primary" disabled={!ready || Boolean(reasonError(reason))}
      onClick={() => stated && flow.record.mutate({ subject: stated, reason })}>
      Record review
    </Button>
  );
  const done = Boolean(unit.code);
  return (
    <Dialog size="md" title={`${review || done ? 'Assign code' : 'Review and assign code'} · ${unit.label}`}
      onClose={onClose} footer={footer(flow, done, primary, onClose)}>
      {subject ? (
        <div className={styles.body}>
          <Decided unit={unit} floorLabel={floorLabel} subject={subject} gaps={sourceLabelGaps(building!.gaps)} />
          {done || flow.assign.isSuccess ? <Assigned code={unit.code} flow={flow} /> : null}
          {!done && !flow.assign.isSuccess && review ? <ReviewFacts review={review} /> : null}
          {!done && !review ? <><p>{ALLOWS}</p><ReasonField reason={reason} onChange={setReason} /></> : null}
          <Notices flow={flow} subject={subject} />
        </div>
      ) : <Unread error={unread} />}
    </Dialog>
  );
}
