import { Badge, DataTable } from '@ulpin/ui';
import { columnRows, targetDefinition } from './model';
import type { ChunkMapping, TableProfile } from './types';
import styles from './Table.module.css';

export function ColumnsTable({ profile, mapping }: { profile: TableProfile; mapping?: ChunkMapping }) {
  return (
    <section className="ul-panel" aria-label="Column mapping candidates">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Columns</h2>
        <span className="ul-caption">Proposals are candidates, not recorded facts</span>
      </div>
      <div className={`${styles.scroll} ${styles.columns}`} tabIndex={0}
        aria-label="Column mapping table, scroll for more columns and rows">
        <DataTable caption="Column mapping candidates" rows={columnRows(profile, mapping)}
          rowKey={(row) => String(row.position)} columns={[
            { header: 'Position', numeric: true, cell: (row) => row.position },
            { header: 'Literal header', cell: (row) => row.header || 'Empty header' },
            { header: 'Inferred type', cell: (row) => row.column.inferredType },
            { header: 'Declared unit', cell: (row) => row.column.declaredUnit ?? 'Unknown' },
            { header: 'Proposed target', cell: (row) => (
              <span title={targetDefinition(row.target).meaning}>
                {targetDefinition(row.target).displayLabel}
                <small className={styles.targetId}>{row.target}</small>
              </span>
            ) },
            { header: 'Confidence', numeric: true, cell: (row) => {
              if (row.origin === 'officer') return 'Officer decision';
              return row.confidence === null ? 'Unknown' : `${Math.round(row.confidence * 100)}%`;
            } },
            { header: 'From', cell: (row) => row.origin ?? 'Unknown' },
            { header: 'Question', cell: (row) => {
              if (!mapping) return 'Unknown';
              if (!row.question) return 'None reported';
              return <span className={styles.question}>
                <Badge tone="warning">Needs input</Badge>{row.question.reason}
              </span>;
            } },
          ]} />
      </div>
    </section>
  );
}
