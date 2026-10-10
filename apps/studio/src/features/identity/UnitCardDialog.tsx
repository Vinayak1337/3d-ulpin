import { useState } from 'react';
import { Button, Dialog, Skeleton } from '@ulpin/ui';
import { useBuildingCanonical, useUnitCards } from '../../api/queries';
import { isServed } from '../../local/routes';
import type { SpaceWorkflow } from '../../local/workflow';
import type { LevelModel, SpaceModel } from '../../model/building';
import { ListedCards } from '../review/recorded/ListedCards';
import { CardDialog } from './CardDialog';
import { recordedFloors } from '../review/recorded/model';
import { IssueCardDialog } from './IssueCardDialog';
import { issueTarget } from './issue';
import { cardAction, unitCardView } from './registryCard';

const CARDS_SERVED = isServed('POST', '/api/v1/usp/property-cards/list');

/** The existing issue action, only for a unit whose canonical record carries an assigned code. */
function NoRegistryCard({ buildingId, space, onClose }: {
  buildingId: string; space: SpaceModel; onClose: () => void;
}) {
  const canonical = useBuildingCanonical(buildingId);
  const [issuing, setIssuing] = useState(false);
  const floors = canonical.data ? recordedFloors(canonical.data.levels) : [];
  const floor = floors.find((item) => item.units.some((unit) => unit.id === space.id));
  const unit = floor?.units.find((item) => item.id === space.id);
  const target = issueTarget([]);
  if (issuing && unit && floor) {
    return <IssueCardDialog buildingId={buildingId} unit={unit} floorLabel={floor.label} target={target}
      listed={[]} onClose={onClose} />;
  }
  return (
    <Dialog title={`Property cards · ${space.name}`} size="md" onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <p>The registry lists no card for this unit.</p>
      {unit?.code ? <Button onClick={() => setIssuing(true)}>{target.label}</Button> : null}
    </Dialog>
  );
}

/** The registry's cards or its honest missing answer; browser drafts remain local-transport only. */
export function UnitCardDialog({ buildingId, workflow, space, level, buildingName, onClose }: {
  buildingId: string; workflow: SpaceWorkflow | null | undefined; space: SpaceModel; level: LevelModel | null;
  buildingName: string; onClose: () => void;
}) {
  const cards = useUnitCards(buildingId, space.id);
  const view = unitCardView(cards, CARDS_SERVED, Boolean(workflow?.code));
  if (cards.isPending || view === 'registry') {
    return (
      <Dialog title={`Property cards · ${space.name}`} size="md" onClose={onClose}
        footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        {cards.data?.snapshotCreatedAt
          ? <ListedCards cards={cards.data} snapshotCreatedAt={cards.data.snapshotCreatedAt} />
          : <Skeleton />}
      </Dialog>
    );
  }
  if (view === 'none') return <NoRegistryCard buildingId={buildingId} space={space} onClose={onClose} />;
  if (view === 'unanswered') {
    return (
      <Dialog title={`Property cards · ${space.name}`} size="md" onClose={onClose}
        footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        <p>The registry could not be asked for the cards of this unit.</p>
      </Dialog>
    );
  }
  if (view !== 'draft' || !workflow?.code) return null;
  return (
    <CardDialog workflow={workflow} space={space} level={level} buildingName={buildingName}
      unanswered={cardAction(cards, true).unanswered} onClose={onClose} />
  );
}
