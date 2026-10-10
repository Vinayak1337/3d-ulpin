import { Banner, Skeleton } from '@ulpin/ui';
import { useUnitCards } from '../../../api/queries';
import { readFailure } from '../../identity/registryCard';
import { noCardText } from './cards';
import { ListedCards } from './ListedCards';
import type { RecordedUnit } from './model';
import { useSeen } from './useSeen';
import styles from './Recorded.module.css';

function CardsBody({ query }: { query: ReturnType<typeof useUnitCards> }) {
  if (query.error) {
    return <Banner tone="warning">The cards of this unit could not be read. {readFailure(query.error)}</Banner>;
  }
  if (!query.data) return <Skeleton width="60%" />;
  const { data } = query;
  if (!data.snapshotCreatedAt) return <p className="ul-help">{noCardText(data)}</p>;
  return <ListedCards cards={data} snapshotCreatedAt={data.snapshotCreatedAt} />;
}

/**
 * The property cards the registry lists for a unit with an assigned code. Nothing is asked until the block
 * scrolls into view, so a long floor list sends no card read for units that are never looked at.
 */
export function UnitCards({ buildingId, unit }: { buildingId: string; unit: RecordedUnit }) {
  const { ref, seen } = useSeen<HTMLElement>();
  const cards = useUnitCards(buildingId, unit.id, seen);
  return (
    <section ref={ref} className={styles.cards} aria-label={`Cards of ${unit.label}`}>
      <h5 className={styles.sublabel}>Cards</h5>
      <CardsBody query={cards} />
    </section>
  );
}
