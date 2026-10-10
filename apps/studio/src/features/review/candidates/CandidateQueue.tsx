import { useMemo, useState } from 'react';
import { Badge, FilterChip, Panel, StatusBadge } from '@ulpin/ui';
import {
  candidateGroups, countByState, filterCards, type CandidateCard, type CandidateGroup, type QueueFilter, type StateChip,
} from './model';
import styles from './CandidateReview.module.css';

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'candidate', label: 'Needs review' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'rejected', label: 'Rejected' },
];

export function CandidateChip({ chip }: { chip: StateChip }) {
  if (chip.kind === 'status') return <StatusBadge status={chip.word} />;
  return <Badge icon={null}>{chip.label}</Badge>;
}

function QueueRow({ card, selected, onSelect }: { card: CandidateCard; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" className={styles.row} aria-current={selected} onClick={onSelect}>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{card.title}</span>
          <span className={styles.rowMeta}>{card.confidence}</span>
        </span>
        <CandidateChip chip={card.chip} />
      </button>
    </li>
  );
}

function QueueGroup({ group, selectedId, onSelect }: {
  group: CandidateGroup; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <li>
      <div className={styles.groupHead}>{group.title} · {group.cards.length}</div>
      <ul className={styles.groupList}>
        {group.cards.map((card) => (
          <QueueRow key={card.id} card={card} selected={card.id === selectedId} onSelect={() => onSelect(card.id)} />
        ))}
      </ul>
    </li>
  );
}

/** The review queue: candidates grouped by image or plan panel, filtered by their recorded state. */
export function CandidateQueue({ cards, selectedId, onSelect, withoutGeometry }: {
  cards: CandidateCard[]; selectedId: string | null; onSelect: (id: string) => void; withoutGeometry: number;
}) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const counts = useMemo(() => countByState(cards), [cards]);
  const groups = useMemo(() => candidateGroups(filterCards(cards, filter)), [cards, filter]);
  const total: Record<QueueFilter, number> = { all: cards.length, ...counts };
  const aside = <span className="ul-caption">{cards.length} in the record</span>;
  return (
    <Panel className={styles.queue} title="Candidates" aside={aside} flush={(
      <>
        <div className={styles.filters} role="group" aria-label="Filter by state">
          {FILTERS.map((f) => (
            <FilterChip key={f.value} label={f.label} count={total[f.value]} pressed={filter === f.value}
              onToggle={() => setFilter(f.value)} />
          ))}
        </div>
        <ul className={styles.list} aria-label="Candidates">
          {groups.map((group) => (
            <QueueGroup key={group.key} group={group} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
        {withoutGeometry ? (
          <p className={styles.note}>{withoutGeometry} more entries in the record carry no geometry.</p>
        ) : null}
      </>
    )} />
  );
}
