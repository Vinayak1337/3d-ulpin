import { formatDateTime } from '@ulpin/ui';
import { decisionHistory, type CandidateCard } from './model';
import styles from './CandidateReview.module.css';

/** The decisions already on record, newest first, each with its reason, who decided and when. */
export function HistoryPanel({ cards, onSelect }: { cards: readonly CandidateCard[]; onSelect: (id: string) => void }) {
  const decided = decisionHistory(cards);
  if (!decided.length) {
    return (
      <div className={styles.inspectorBody}>
        <p className="ul-help">No decisions are recorded on these candidates yet.</p>
      </div>
    );
  }
  return (
    <div className={styles.inspectorBody}>
      <ol className={styles.history} aria-label="Decisions on record">
        {decided.map((card) => {
          const { outcome, time, reason, actor } = card.decision!;
          return (
            <li key={card.id} className={styles.historyRow}>
              <strong>{outcome === 'accepted' ? 'Accepted' : 'Rejected'} · {formatDateTime(time)}</strong>
              <button type="button" onClick={() => onSelect(card.id)}>{card.title}</button>
              <span>{reason}</span>
              <span className="ul-muted">By {actor}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
