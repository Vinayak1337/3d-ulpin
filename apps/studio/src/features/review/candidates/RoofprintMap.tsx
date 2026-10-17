import { useMemo } from 'react';
import { SceneView } from '@ulpin/scene/react';
import type { FootprintInput, Pick, SceneState } from '@ulpin/scene';
import { useMapView } from '../../map/useMapView';
import type { CandidateCard } from './model';
import styles from './CandidateReview.module.css';

/** Every roofprint is a candidate: no height, drawn ghosted. Acceptance does not change how it looks. */
function toFootprints(cards: readonly CandidateCard[]): FootprintInput[] {
  return cards.map((card) => ({
    id: card.id, polygons: card.polygons, heightM: null, heightState: 'unknown', candidate: true,
  }));
}

/** Roofprint candidates on the map, in the area frame the record states. The selected one is highlighted. */
export function RoofprintMap({ cards, selectedId, onSelect }: {
  cards: readonly CandidateCard[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [{ look }] = useMapView();
  const footprints = useMemo(() => toFootprints(cards), [cards]);
  const state = useMemo<SceneState>(() => ({
    mode: selectedId ? 'building' : 'area', buildingId: selectedId, levelId: null, spaceId: null, tool: 'select',
  }), [selectedId]);
  const onPick = (pick: Pick) => { if (pick.kind === 'building') onSelect(pick.id); };
  return (
    <div className={styles.canvasWrap}>
      <SceneView look={look} className={styles.canvas} buildings={footprints} detail={null} state={state}
        onPick={onPick} label={`Map of ${cards.length} roofprint candidates, drawn as ghosted outlines`} />
      <span className={`ul-float ${styles.canvasNote}`}>
        Candidates stay ghosted until a roofprint is recorded in the registry.
      </span>
    </div>
  );
}
