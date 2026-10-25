import { Badge, DataTable } from '@ulpin/ui';
import { columnRows, confidenceText, isUnmapped, questionWords, targetDefinition } from './model';
import type { ChunkMapping, TableProfile } from './types';
import styles from './Table.module.css';

function NoConfidence() {
  return <span><span aria-hidden="true">—</span>
    <span className="ul-visually-hidden">No confidence</span></span>;
}

export function ColumnsTable({ profile, mapping }: { profile: TableProfile; mapping?: ChunkMapping }) {
  return (
    <section className="ul-panel" aria-label="Columns">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Columns</h2>
      </div>
      <div className={`${styles.scroll} ${styles.columns}`} tabIndex={0} aria-label="Column mapping">
        <DataTable caption="Column mapping candidates" rows={columnRows(profile, mapping)}
          rowKey={(row) => String(row.position)} columns={[
            { header: 'Position', numeric: true, cell: (row) => row.position },
            { header: 'Header', cell: (row) => row.header || 'Empty header' },
            { header: 'Inferred type', cell: (row) => row.column.inferredType },
            { header: 'Declared unit', cell: (row) => row.column.declaredUnit ?? 'Unknown' },
            { header: 'Proposed target', cell: (row) => (isUnmapped(row) ? 'Unmapped'
              : targetDefinition(row.target).displayLabel) },
            { header: 'Confidence', numeric: true, cell: (row) => confidenceText(row) ?? <NoConfidence /> },
            { header: 'From', cell: (row) => {
              if (row.noAnswer === null) return row.origin ?? 'Unknown';
              return <span className={styles.question}>
                <Badge tone="warning">Needs review</Badge>No answer · {row.noAnswer}
              </span>;
            } },
            { header: 'Question', cell: (row) => {
              if (!mapping) return 'Unknown';
              if (!row.question) return 'None reported';
              return <span className={styles.question}>
                <Badge tone="warning">Needs review</Badge>{questionWords(row.question.reason)}
              </span>;
            } },
          ]} />
      </div>
    </section>
  );
}
