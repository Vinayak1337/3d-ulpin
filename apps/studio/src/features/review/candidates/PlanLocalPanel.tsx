import type { KeyboardEvent } from 'react';
import type { Ring } from '@ulpin/scene';
import type { CandidateCard } from './model';
import styles from './CandidateReview.module.css';

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const SCALE_STEPS_M = [0.5, 1, 2, 5, 10, 20];
const PAD_RATIO = 0.08;

function rings(card: CandidateCard): Ring[] {
  return card.polygons.flat();
}

function boxOf(cards: readonly CandidateCard[]): Box {
  const points = cards.flatMap((card) => rings(card).flat());
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Plan axes are page-right and page-up; SVG's y runs down, so y is negated. */
const pointsOf = (ring: Ring) => ring.map(([x, y]) => `${x},${-y}`).join(' ');

function viewBoxOf(box: Box): string {
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * PAD_RATIO;
  return `${box.minX - pad} ${-box.maxY - pad} ${box.maxX - box.minX + 2 * pad} ${box.maxY - box.minY + 2 * pad}`;
}

function scaleLengthM(spanM: number): number {
  return [...SCALE_STEPS_M].reverse().find((step) => step <= spanM / 3) ?? SCALE_STEPS_M[0]!;
}

function selectOnKey(event: KeyboardEvent<SVGElement>, select: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

function RoomShape({ card, selected, fontSize, onSelect }: {
  card: CandidateCard; selected: boolean; fontSize: number; onSelect: () => void;
}) {
  const ring = rings(card)[0];
  if (!ring) return null;
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, -(Math.min(...ys) + Math.max(...ys)) / 2];
  return (
    <g>
      <polygon points={pointsOf(ring)} className={`${styles.room} ${selected ? styles.roomOn : ''}`} onClick={onSelect}
        role="button" tabIndex={0} aria-label={card.title} aria-pressed={selected}
        onKeyDown={(event) => selectOnKey(event, onSelect)}>
        <title>{card.title}</title>
      </polygon>
      <text x={centre[0]} y={centre[1]} fontSize={fontSize} textAnchor="middle" className={styles.roomLabel}>
        {card.title}
      </text>
    </g>
  );
}

/**
 * Room candidates in their own plan frame, in metres. They have no placement, so they are never drawn on the map:
 * this panel is their only canvas. The panel shows the drawing panel (frame) of the selected candidate.
 */
export function PlanLocalPanel({ cards, selectedId, onSelect }: {
  cards: readonly CandidateCard[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const selected = cards.find((card) => card.id === selectedId) ?? cards[0];
  if (!selected) return null;
  const sameFrame = cards.filter((card) => card.frame === selected.frame && card.polygons.length);
  const box = boxOf(sameFrame);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const bar = scaleLengthM(span);
  const barY = -box.minY + span * 0.04;
  return (
    <div className={`ul-panel ${styles.plan}`}>
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">{selected.levelLiteral ?? 'Level not stated'}</h2>
        <span className="ul-caption">Plan-local metres · placement unknown · not on the map</span>
      </header>
      <svg className={styles.planSvg} viewBox={viewBoxOf(box)} role="img"
        aria-label={`${sameFrame.length} room candidates of ${selected.levelLiteral ?? 'one panel'}, in plan metres`}>
        {sameFrame.map((card) => (
          <RoomShape key={card.id} card={card} selected={card.id === selectedId} fontSize={span / 45}
            onSelect={() => onSelect(card.id)} />
        ))}
        <g aria-hidden="true">
          <line className={styles.scaleBar} x1={box.minX} x2={box.minX + bar} y1={barY} y2={barY} />
          <text x={box.minX} y={barY - span * 0.015} fontSize={span / 45} className={styles.roomLabel}>{bar} m</text>
        </g>
      </svg>
    </div>
  );
}
