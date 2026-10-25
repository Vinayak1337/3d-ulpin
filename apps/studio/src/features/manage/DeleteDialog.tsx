import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash } from '@phosphor-icons/react';
import { Button, Dialog } from '@ulpin/ui';
import { deleteBuilding } from '../../api/queries';

/**
 * Confirms deleting one building: the dialog says what goes and asks once. An area is retired instead
 * (RetireAreaDialog); nothing of it is deleted.
 */
export function DeleteDialog({ target, onClose, onDeleted }: {
  target: { kind: 'building'; id: string; name: string; detail: string };
  onClose: () => void; onDeleted: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteBuilding(target.id);
      await client.invalidateQueries();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The delete did not go through.');
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Delete ${target.name}?`} size="md" onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={Trash} onClick={() => void run()} disabled={busy}>{busy ? 'Deleting…' : `Delete ${target.kind}`}</Button>
        </>
      )}>
      <div className="ul-stack">
        <p style={{ margin: 0 }}>{target.detail}</p>
        {error ? <p className="ul-help" role="alert" style={{ margin: 0, color: 'var(--ui-danger)' }}>{error}</p> : null}
      </div>
    </Dialog>
  );
}
