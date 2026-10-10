import { Banner, Button, Dialog } from '@ulpin/ui';
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
          Save {confirmation.body.plan.decisions.length} reasoned column decisions as an unapproved recipe.
          Approval is a separate step.
        </p> : <p>Approve recipe revision {confirmation.revision} under the configured local operator.</p>}
        {proposal ? <p>{confirmation.sharedReasonCount} columns carry a shared reason.</p> : null}
        <Banner tone="info">
          Approval lets the server map draft rows and train the learner. It does not create buildings,
          complete identity, write the registry or place anything on the map.
        </Banner>
        <p className="ul-help">The server records the operator; this screen does not choose or impersonate one.</p>
        {error ? <TableRefusal error={error} /> : null}
      </div>
    </Dialog>
  );
}
