import { useId, useState, type ReactNode } from 'react';
import { Button, Dialog } from '@ulpin/ui';
import { reasonError } from './decisions';
import styles from './CandidateReview.module.css';

const KEPT_WITH_DECISION = 'The reason is kept with the decision, with who decided and when.';

/** Every decision on a candidate carries a reason; the confirm button stays off until there is one. */
export function ReasonDialog({ title, confirmLabel, busy, failure, onConfirm, onClose, children }: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  failure?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const error = reasonError(reason);
  const showError = touched && error;
  return (
    <Dialog title={title} size="md" onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={Boolean(error) || busy} onClick={() => onConfirm(reason)}>
            {confirmLabel}
          </Button>
        </>
      )}>
      <div className={styles.dialogBody}>
        {children}
        <label className="ul-label" htmlFor={fieldId}>Reason (required)</label>
        <textarea id={fieldId} className={styles.reason} value={reason} aria-invalid={Boolean(showError)}
          aria-describedby={`${fieldId}-help`} onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)} />
        <span id={`${fieldId}-help`} className="ul-help">{showError ? error : KEPT_WITH_DECISION}</span>
        {failure ? <p role="alert" className="ul-help">{failure}</p> : null}
      </div>
    </Dialog>
  );
}
