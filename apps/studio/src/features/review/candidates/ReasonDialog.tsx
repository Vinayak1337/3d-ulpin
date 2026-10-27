import { useId, useState } from 'react';
import { Button, Dialog } from '@ulpin/ui';
import { reasonError } from './decisions';
import styles from './CandidateReview.module.css';

/** Every decision on a candidate carries a reason; the confirm button stays off until there is one. */
export function ReasonDialog({ title, confirmLabel, busy, failure, onConfirm, onClose }: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  failure?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
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
        <label className="ul-label" htmlFor={fieldId}>Reason (required)</label>
        <textarea id={fieldId} className={styles.reason} value={reason} aria-invalid={Boolean(showError)}
          aria-describedby={showError ? `${fieldId}-error` : undefined}
          onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)} />
        {showError ? <span id={`${fieldId}-error`} className="ul-help">{error}</span> : null}
        {failure ? <p role="alert" className="ul-help">{failure}</p> : null}
      </div>
    </Dialog>
  );
}
