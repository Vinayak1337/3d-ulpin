import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive } from '@phosphor-icons/react';
import { Button, Dialog } from '@ulpin/ui';
import { retireArea } from '../../api/queries';

export type RetireTarget = { id: string; name: string; revision: number };

/**
 * Confirms retiring an area. A retired area and its features leave the area lists, the map and the batch's area
 * choices; the server records who retired it, when and why.
 */
export function RetireAreaDialog({ target, onClose, onRetired }: {
  target: RetireTarget; onClose: () => void; onRetired: () => void;
}) {
  const client = useQueryClient();
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stated = reason.trim();
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await retireArea(target.id, { expectedRevision: target.revision, reason: stated });
      await client.invalidateQueries();
      onRetired();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The area was not retired.');
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Retire ${target.name}?`} size="md" onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={Archive} onClick={() => void run()} disabled={busy || !stated}>
            {busy ? 'Retiring…' : 'Retire area'}
          </Button>
        </>
      )}>
      <div className="ul-stack">
        <label className="ul-field" htmlFor={id}>
          <span className="ul-label">Reason (required)</span>
          <textarea id={id} className="ul-input" rows={3} maxLength={2000} required value={reason}
            disabled={busy} onChange={(event) => setReason(event.target.value)} />
        </label>
        {error ? (
          <p className="ul-help" role="alert" style={{ margin: 0, color: 'var(--ui-danger)' }}>{error}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
