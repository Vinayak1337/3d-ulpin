import { useState } from 'react';
import { QrCode } from '@phosphor-icons/react';
import { Button } from '@ulpin/ui';
import type { Target } from '../intake/run/model';
import { BuildingCardDialog } from '../map/inspector/BuildingCard';
import { cardState } from '../map/inspector/cardState';
import styles from './RegisterPage.module.css';

export const UNIT_BLOCKED = 'Select a unit with a proposed code';
export const CODE_BLOCKED = 'Assign a proposed code first';

/**
 * What the record page's Property Card offers. A selected unit keeps its own card flow. With no unit selected, the
 * card the batch made for this building is offered when its intake target names one; only when it names none is the
 * unit condition stated as what blocks a card.
 */
export type CardOffer =
  | { kind: 'unit' }
  | { kind: 'building'; target: Target; card: { id: string; revision: number }; recordRevision: number | null }
  | { kind: 'blocked'; words: string };

export function cardOffer({ unitSelected, unitCode, registryCard, target }: {
  unitSelected: boolean; unitCode: string | null | undefined; registryCard: boolean;
  target: Target | null | undefined;
}): CardOffer {
  if (unitSelected) return unitCode || registryCard ? { kind: 'unit' } : { kind: 'blocked', words: CODE_BLOCKED };
  const card = target?.artefacts.card;
  if (!target || !card || cardState(target) !== 'carded') return { kind: 'blocked', words: UNIT_BLOCKED };
  // The card pins the revision its evidence confirmation recorded; with none, the revision the target recorded.
  const record = target.artefacts.evidence?.record ?? target.artefacts.record;
  return { kind: 'building', target, card, recordRevision: record?.revision ?? null };
}

/** The header's Property Card button and the line under it: what blocks it, or which card it opens. */
export function PropertyCardAction({ offer, buildingName, onOpenUnit }: {
  offer: CardOffer; buildingName: string; onOpenUnit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const building = offer.kind === 'building' ? offer : null;
  return (
    <div className={styles.primary}>
      <Button variant="primary" icon={QrCode} disabled={offer.kind === 'blocked'}
        onClick={() => (building ? setOpen(true) : onOpenUnit())}>Property Card</Button>
      {offer.kind === 'blocked' ? <span className={styles.blocked}>{offer.words}</span> : null}
      {building ? (
        <span className={styles.blocked}>
          Card <span className="ul-mono" title={building.card.id}>{building.card.id.slice(0, 8)}</span>
          {' · '}revision {building.card.revision}
          {building.recordRevision === null ? null : <> · cites record revision {building.recordRevision}</>}
        </span>
      ) : null}
      {building && open ? (
        <BuildingCardDialog target={building.target} name={buildingName} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
