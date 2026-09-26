import { ShieldCheck } from '@phosphor-icons/react';
import { Banner, Button, DescriptionList, Dialog, StatusBadge, UlpinCode } from '@ulpin/ui';
import type { BuildingRegister } from '../../api/queries';
import type { SpaceModel } from '../../model/building';
import { useAssignCode } from '../workflow/useWorkflow';

/** S11: confirm before a random proposed code is generated. Lineage and anchor are shown, never invented. */
export function AssignDialog({ space, register, onClose, onAssigned }: {
  space: SpaceModel; register: BuildingRegister; onClose: () => void; onAssigned: (code: string) => void;
}) {
  const assign = useAssignCode();
  const parcels = register.parcelIdentifiers;
  return (
    <Dialog
      size="md"
      title={`Assign proposed 3D ULPIN · ${space.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={ShieldCheck}
            disabled={assign.isPending}
            onClick={() => assign.mutate(space.id, { onSuccess: (workflow) => onAssigned(workflow.code!) })}
          >
            Assign code
          </Button>
        </>
      )}
    >
      <div className="ul-stack" style={{ gap: 20 }}>
        <div style={{ padding: 16, borderRadius: 'var(--ui-radius-12)', background: 'var(--ui-surface-subtle)' }}>
          <UlpinCode code={null} state="draft" />
          <p className="ul-help" style={{ marginTop: 8 }}>A random code is generated on confirm. It carries no parcel, level or use, so corrections never change it.</p>
        </div>
        <DescriptionList items={[
          { label: 'Parcel ULPIN', value: parcels.length ? parcels.map((p) => p.value).join(', ') : <span className="ul-row"><span className="ul-unknown">Official parcel anchor not supplied</span><StatusBadge status="Unknown" /></span> },
          { label: 'Lineage', value: 'New space · no predecessors' },
          { label: 'Status', value: <StatusBadge status="Reviewed" /> },
        ]} />
        <p className="ul-help">The state's parcel ULPIN is unchanged. The code is labelled "3D ULPIN (proposed)" and is not an official identifier.</p>
        {assign.error ? <Banner tone="danger">{assign.error.message}</Banner> : null}
      </div>
    </Dialog>
  );
}
