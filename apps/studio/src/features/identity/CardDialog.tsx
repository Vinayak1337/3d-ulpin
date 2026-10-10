import { useState } from 'react';
import { Link } from 'react-router';
import { Printer, QrCode } from '@phosphor-icons/react';
import { Banner, Button, Dialog, Icon, PropertyCard, SegmentedControl, Toggle } from '@ulpin/ui';
import type { SpaceModel, LevelModel } from '../../model/building';
import type { SpaceWorkflow } from '../../local/workflow';
import { shortHash } from '../../local/workflow';
import { Qr } from './Qr';
import { useCardFacts } from './cardFacts';
import { DraftNotice } from './DraftNotice';
import { LOCAL_CHAIN_WORDS, useLocalChain } from './localChain';

// The printed card leaves the dialog and its notice behind, so the card itself says what it is.
const DRAFT_FACT = { label: 'Record', value: 'Draft on this device, not a registry record' };

export function verifyPath(workflow: SpaceWorkflow) {
  return `/verify/${encodeURIComponent(workflow.code!)}?rev=${workflow.events[0]!.revision}`;
}

/**
 * S14: the card preview with scope and audience; party names are forced off for Public. The code, revisions
 * and chain are this browser's own (local/workflow.ts), so the dialog says it is a draft on this device.
 */
export function CardDialog({ workflow, space, level, buildingName, registryFailure = null, onClose }: {
  workflow: SpaceWorkflow; space: SpaceModel; level: LevelModel | null; buildingName: string;
  /** Why the registry could not be asked whether it holds a card for this unit, when it could not. */
  registryFailure?: string | null; onClose: () => void;
}) {
  const [audience, setAudience] = useState<'public' | 'owner' | 'officer'>('public');
  const [names, setNames] = useState(false);
  const head = workflow.events[0]!;
  const link = `${window.location.origin}${verifyPath(workflow)}`;
  const card = useCardFacts(workflow);
  const chain = useLocalChain(workflow);
  void level;
  return (
    <Dialog
      title={`Property Card · ${space.name}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Link className="ul-btn" to={verifyPath(workflow)}><Icon icon={QrCode} />Open verification page</Link>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print or save PDF</Button>
        </>
      )}
    >
      <DraftNotice />
      {registryFailure ? (
        <Banner tone="info">The registry could not be asked for the cards of this unit. {registryFailure}</Banner>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 24,
        marginTop: 'var(--ui-space-4)' }}>
        <PropertyCard
          title={`${space.name}, ${buildingName}`}
          code={workflow.code}
          location={card?.location ?? null}
          revision={`r${head.revision}`}
          hash={shortHash(head.hash)}
          chain={LOCAL_CHAIN_WORDS[chain]}
          qr={<Qr value={link} size={88} label="QR code: verification page" />}
          facts={[
            DRAFT_FACT,
            ...(card?.facts ?? []),
            ...(audience !== 'public' && names ? [{ label: 'Party names', value: <em className="ul-unknown">Restricted (officer role)</em> }] : []),
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
            <span className="ul-body-sm">Verification page for this code and revision</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
