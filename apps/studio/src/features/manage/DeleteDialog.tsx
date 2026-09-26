import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash } from '@phosphor-icons/react';
import { Button, Dialog } from '@ulpin/ui';
import { deleteArea, deleteBuilding } from '../../api/queries';

/**
 * Confirms deleting an area (with everything its import brought in) or one building. Deletion reaches the
 * public portal too, so the dialog says what goes and asks once.
 */
export function DeleteDialog({ target, onClose, onDeleted }: {
  target: { kind: 'area' | 'building'; id: string; name: string; detail: string };
  onClose: () => void; onDeleted: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await (target.kind === 'area' ? deleteArea(target.id) : deleteBuilding(target.id));
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
        <p className="ul-help" style={{ margin: 0 }}>It is removed from the Studio and the public portal. Requests filed for it stay in Requests.</p>
        {error ? <p className="ul-help" role="alert" style={{ margin: 0, color: 'var(--ui-danger)' }}>{error}</p> : null}
      </div>
    </Dialog>
  );
}
