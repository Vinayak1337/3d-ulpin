import { useState } from 'react';
import { Button } from '@ulpin/ui';
import styles from './Table.module.css';

export function SharedUnknown({ count, apply, pending }: {
  count: number; apply: (reason: string) => void; pending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      apply(reason);
    }}>
      <label className="ul-field">
        <span className="ul-label">Shared reason for unknown fields</span>
        <textarea className="ul-input" aria-label="Shared reason for unknown fields" required rows={2}
          maxLength={2000} value={reason} disabled={pending}
          onChange={(event) => setReason(event.target.value)} />
      </label>
      <p className="ul-help" role="status">
        {count} columns will change. Only unanswered columns with an empty or unknown target are included.
        Answered columns and other targets stay unchanged.
      </p>
      <div><Button type="submit" disabled={pending || count === 0 || !reason.trim()}>
        Mark every unanswered column as Unknown field
      </Button></div>
    </form>
  );
}
