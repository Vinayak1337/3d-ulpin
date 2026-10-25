import { Button, Dialog } from '@ulpin/ui';
import { TableRefusal } from './Progress';
import type { RecipeBody } from './types';

export type Confirmation = { kind: 'propose'; body: RecipeBody; sharedReasonCount: number } | {
  kind: 'approve'; recipeId: string; revision: number; requestKey: string;
};

export function RecipeConfirmation({ confirmation, pending, error, confirm, close }: {
  confirmation: Confirmation; pending: boolean; error: Error | null;
  confirm: () => void; close: () => void;
}) {
  const proposal = confirmation.kind === 'propose';
  return (
    <Dialog title={proposal ? 'Propose this mapping?' : 'Approve this mapping?'} onClose={close} footer={(
      <><Button variant="ghost" disabled={pending} onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={pending} onClick={confirm}>
          {proposal ? 'Confirm proposal' : 'Confirm approval'}
        </Button></>
    )}>
      <div className="ul-stack">
        {proposal ? <p>
          Column decisions: {confirmation.body.plan.decisions.length} · with the shared reason:
          {' '}{confirmation.sharedReasonCount}
        </p> : <p>Revision {confirmation.revision}</p>}
        {error ? <TableRefusal error={error} /> : null}
      </div>
    </Dialog>
  );
}
