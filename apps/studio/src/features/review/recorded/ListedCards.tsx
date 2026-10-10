import { Link } from 'react-router';
import { Badge, DataTable, type Column } from '@ulpin/ui';
import type { UnitCards } from '../../../api/queries';
import { cardPdfPath, cardVerificationPath } from '../../identity/registryCard';
import { cardRows, searchGaps, snapshotText, type CardRow } from './cards';
import styles from './Recorded.module.css';

/** The PDF of a readable revision, and the server's verification report of any listed revision. */
function CardActions({ row }: { row: CardRow }) {
  return (
    <span className={styles.cardActions}>
      {row.readable ? (
        <a className="ul-btn" href={cardPdfPath(row.cardId, row.revision)} target="_blank" rel="noreferrer"
          aria-label={`Open card PDF, card ${row.card}, revision ${row.revision}`}>
          Open card PDF
        </a>
      ) : null}
      <Link className="ul-btn" to={cardVerificationPath(row.cardId, row.revision)}
        aria-label={`Verification, card ${row.card}, revision ${row.revision}`}>
        Verification
      </Link>
    </span>
  );
}

const COLUMNS: Column<CardRow>[] = [
  { header: 'Card', cell: (row) => <span className="ul-mono" title={row.cardId}>{row.card}</span> },
  { header: 'Revision', cell: (row) => row.revision },
  { header: 'Issued', cell: (row) => row.issued ?? <em className="ul-unknown">Not reported</em> },
  { header: 'Status', cell: (row) => <Badge tone={row.tone} icon={null}>{row.status}</Badge> },
  { header: 'Unit in its snapshot', cell: (row) => row.unit ?? <em className="ul-unknown">Not reported</em> },
  { header: 'Actions', cell: (row) => <CardActions row={row} /> },
];

/**
 * Every card revision the registry lists for a unit under the snapshots that were read, and under the list what
 * the read could not cover.
 */
export function ListedCards({ cards, snapshotCreatedAt }: { cards: UnitCards; snapshotCreatedAt: string }) {
  return (
    <div className={styles.cards}>
      <p className="ul-help">{snapshotText(cards, snapshotCreatedAt)}</p>
      <div className={styles.cardTable}>
        <DataTable caption="Property cards of this unit" columns={COLUMNS} rows={cardRows(cards.cards)}
          rowKey={(row) => row.key} />
      </div>
      {cards.truncated ? (
        <p className="ul-help">The registry holds more cards for this unit than the {cards.cards.length} listed.</p>
      ) : null}
      {searchGaps(cards).map((gap) => <p key={gap} className="ul-help">{gap}</p>)}
    </div>
  );
}
