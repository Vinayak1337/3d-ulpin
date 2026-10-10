import { Button, Dialog, Skeleton } from '@ulpin/ui';
import { useUnitCards } from '../../api/queries';
import type { SpaceWorkflow } from '../../local/workflow';
import type { LevelModel, SpaceModel } from '../../model/building';
import { ListedCards } from '../review/recorded/ListedCards';
import { CardDialog } from './CardDialog';
import { isNotFound, readFailure } from './registryCard';

/**
 * What the Property Card button opens for a unit. The registry's own cards when it lists one; the draft made in
 * this browser only when the registry lists none or could not be asked, and this browser holds a code.
 */
export function UnitCardDialog({ buildingId, workflow, space, level, buildingName, onClose }: {
  buildingId: string; workflow: SpaceWorkflow | null | undefined; space: SpaceModel; level: LevelModel | null;
  buildingName: string; onClose: () => void;
}) {
  const cards = useUnitCards(buildingId, space.id);
  if (cards.isPending || cards.data?.snapshotCreatedAt) {
    return (
      <Dialog title={`Property cards · ${space.name}`} size="md" onClose={onClose}
        footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        {cards.data?.snapshotCreatedAt
          ? <ListedCards cards={cards.data} snapshotCreatedAt={cards.data.snapshotCreatedAt} />
          : <Skeleton />}
      </Dialog>
    );
  }
  if (!workflow?.code) return null;
  // A server that holds no such building has no card for it; any other failure leaves that unknown.
  const unasked = cards.error && !isNotFound(cards.error) ? readFailure(cards.error) : null;
  return (
    <CardDialog workflow={workflow} space={space} level={level} buildingName={buildingName} registryFailure={unasked}
      onClose={onClose} />
  );
}
