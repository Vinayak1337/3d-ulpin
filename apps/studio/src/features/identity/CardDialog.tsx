import { useState } from 'react';
import { Link } from 'react-router';
import { Printer, QrCode } from '@phosphor-icons/react';
import { Button, Dialog, Icon, PropertyCard, SegmentedControl, Toggle, formatDate } from '@ulpin/ui';
import type { SpaceModel, LevelModel } from '../../model/building';
import type { SpaceWorkflow } from '../../local/workflow';
import { shortHash } from '../../local/workflow';
import { Qr } from './Qr';

export function verifyPath(workflow: SpaceWorkflow) {
  return `/verify/${encodeURIComponent(workflow.code!)}?rev=${workflow.events[0]!.revision}`;
}

/** S14: the card preview with scope and audience; party names are forced off for Public. */
export function CardDialog({ workflow, space, level, buildingName, onClose }: {
  workflow: SpaceWorkflow; space: SpaceModel; level: LevelModel | null; buildingName: string; onClose: () => void;
}) {
  const [audience, setAudience] = useState<'public' | 'owner' | 'officer'>('public');
  const [names, setNames] = useState(false);
  const head = workflow.events[0]!;
  const link = `${window.location.origin}${verifyPath(workflow)}`;
  return (
    <Dialog
      title={`Property Card · ${space.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Link className="ul-btn" to={verifyPath(workflow)}><Icon icon={QrCode} />Open local link</Link>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print or save PDF</Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 24 }}>
        <PropertyCard
          title={`${space.name}, ${buildingName}`}
          code={workflow.code}
          location={null}
          revision={`r${head.revision}`}
          hash={shortHash(head.hash)}
          chain="Chain consistent"
          qr={<Qr value={link} size={88} label="QR code: local link on this device" />}
          facts={[
            { label: 'Parcel ULPIN', value: <span className="ul-unknown">Official parcel anchor not supplied</span> },
            { label: 'Level', value: level ? `${level.label} · elevation unknown` : 'Unknown' },
            { label: 'Area', value: 'Not assessed: the source does not state its unit' },
            { label: 'Assigned', value: workflow.assignedAt ? formatDate(workflow.assignedAt) : 'Unknown' },
            ...(audience !== 'public' && names ? [{ label: 'Party names', value: <span className="ul-unknown">None recorded in the source</span> }] : []),
          ]}
        />
        <div className="ul-stack" style={{ alignContent: 'start', gap: 20 }}>
          <div className="ul-stack" style={{ gap: 6 }}>
            <span className="ul-caption">Scope</span>
            <span className="ul-body-sm">Unit · one space</span>
          </div>
          <div className="ul-stack" style={{ gap: 6 }}>
            <span className="ul-caption">Audience</span>
            <SegmentedControl label="Audience" value={audience} onChange={setAudience} options={[{ value: 'public', label: 'Public' }, { value: 'owner', label: 'Owner' }, { value: 'officer', label: 'Officer' }]} />
          </div>
          <Toggle label="Party names" checked={audience !== 'public' && names} disabled={audience === 'public'} onChange={setNames} />
          <div className="ul-stack" style={{ gap: 6 }}>
            <span className="ul-caption">QR opens</span>
            <span className="ul-body-sm">Local link on this device</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
