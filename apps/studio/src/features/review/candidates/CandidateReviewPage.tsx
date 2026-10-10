import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { WarningCircle } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '@ulpin/ui';
import { useAreaCanonical, useAreaContext, useBuildingCanonical } from '../../../api/queries';
import { levelChoices, type StagedDecision } from './decisions';
import { candidateCards } from './model';
import { PlanLocalPanel } from './PlanLocalPanel';
import { RoofprintDecisions } from './RoofprintDecisions';
import { RoofprintMap } from './RoofprintMap';
import { RoomDecisions } from './RoomDecisions';
import { ReviewShell } from './ReviewShell';
import styles from './CandidateReview.module.css';

/** The selected candidate lives in the URL, so a saved link opens the same card. */
function useSelectedCandidate(): [string | null, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const select = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('candidate', id);
    return next;
  }, { replace: true });
  return [params.get('candidate'), select];
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className={styles.loading}>
      <EmptyState icon={WarningCircle} title="The candidates could not be read"
        action={<Link to="/studio/work">Back to Batches</Link>}>
        {message}
      </EmptyState>
    </div>
  );
}

function Loading() {
  return <div className={styles.loading}><Skeleton width="40%" /><Skeleton /><Skeleton /></div>;
}

/** Roofprint candidates of an area: the map, the queue and the decisions per image. */
export function AreaCandidatesPage() {
  const { areaId } = useParams();
  const canonical = useAreaCanonical(areaId);
  const context = useAreaContext(areaId);
  const [selectedId, select] = useSelectedCandidate();
  const [staged, setStaged] = useState<StagedDecision[]>([]);
  const candidates = canonical.data?.candidates;
  const { cards, withoutGeometry } = useMemo(() => candidateCards(candidates, 'roofprint'), [candidates]);
  if (canonical.isPending) return <Loading />;
  if (canonical.error || !canonical.data) {
    return <Unavailable message={canonical.error?.message ?? 'The area was not found.'} />;
  }

  const titleOf = (id: string) => cards.find((card) => card.id === id)?.title ?? id;
  const stage = (decision: StagedDecision) => {
    setStaged((all) => [...all.filter((d) => d.candidateId !== decision.candidateId), decision]);
  };
  const unstage = (id: string) => setStaged((all) => all.filter((d) => d.candidateId !== id));

  return (
    <ReviewShell heading="Roofprint candidates" scope={context.data?.area.name ?? ''} cards={cards}
      withoutGeometry={withoutGeometry} backTo={{ to: `/studio/areas/${areaId}`, label: 'Open map' }}
      selectedId={selectedId} onSelect={select}
      canvas={<RoofprintMap cards={cards} selectedId={selectedId} onSelect={select} />}
      decisions={(card, notify) => (
        <RoofprintDecisions card={card} staged={staged} areaRevision={context.data?.area.revision} titleOf={titleOf}
          onStage={stage} onUnstage={unstage} onRecorded={(message) => { setStaged([]); notify(message); }} />
      )} />
  );
}

/** Room candidates of a building: plan-local, with no placement; a room can only take an existing reviewed level. */
export function BuildingCandidatesPage() {
  const { buildingId } = useParams();
  const canonical = useBuildingCanonical(buildingId);
  const [selectedId, select] = useSelectedCandidate();
  const candidates = canonical.data?.candidates;
  const { cards, withoutGeometry } = useMemo(() => candidateCards(candidates, 'room'), [candidates]);
  if (canonical.isPending) return <Loading />;
  if (!canonical.data) return <Unavailable message={canonical.error?.message ?? 'The building was not found.'} />;
  const building = canonical.data;
  const choices = levelChoices(building.levels);

  return (
    <ReviewShell heading="Room candidates" scope={building.name.value ?? 'Name unknown'} cards={cards}
      withoutGeometry={withoutGeometry} backTo={{ to: `/studio/areas/${building.areaId}`, label: 'Open area map' }}
      selectedId={selectedId} onSelect={select}
      canvas={<PlanLocalPanel cards={cards} selectedId={selectedId} onSelect={select} />}
      decisions={(card, notify) => (
        <RoomDecisions buildingId={building.buildingId} canonicalRevision={building.revisionId} card={card}
          choices={choices} onRecorded={notify} />
      )} />
  );
}
