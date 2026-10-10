import { Link, Navigate, useParams } from 'react-router';
import { FilePlus, WarningCircle } from '@phosphor-icons/react';
import { DataTable, EmptyState, Icon, Panel, Skeleton, formatDateTime } from '@ulpin/ui';
import { useSourceCase } from '../intake/table/queries';
import { useWorkQueue } from '../../api/queries';
import { caseTables, noTableSentence, unreadCase, type CaseTable } from './caseEntry';
import styles from './BatchesPage.module.css';

/**
 * /studio/cases/:caseId, where a case row of Batches leads. A case with one retained table opens that table's
 * page; with several it lists them; with none it says what the case holds and offers Add files.
 */
export function CasePage() {
  const caseId = useParams()['*']?.split('/')[0] ?? '';
  const sourceCase = useSourceCase(caseId);
  const queue = useWorkQueue('all', '', 1);
  if (sourceCase.isPending || queue.isPending) {
    return <div className={styles.casePage}><Skeleton width="40%" /><Skeleton /></div>;
  }
  if (sourceCase.error) {
    return (
      <div className={styles.casePage}>
        <EmptyState icon={WarningCircle} title="This case could not be opened"
          action={<Link to="/studio/work">Back to Batches</Link>}>
          {unreadCase(sourceCase.error)}
        </EmptyState>
      </div>
    );
  }
  const { sources } = sourceCase.data;
  const row = queue.data?.items.find((item) => item.kind === 'case' && item.id === caseId);
  const tables = caseTables(caseId, sources, row);
  if (tables.length === 1) return <Navigate to={tables[0]!.href} replace />;
  return (
    <div className={styles.casePage}>
      <Link to="/studio/work">Batches</Link>
      <h1 className="ul-title">{sourceCase.data.case.name}</h1>
      {tables.length ? <RetainedTables tables={tables} /> : <NoTable sourceCount={sources.length} />}
    </div>
  );
}

function RetainedTables({ tables }: { tables: CaseTable[] }) {
  return (
    <Panel title="Retained tables" aside={<span className="ul-caption">{tables.length}</span>} flush={(
      <DataTable caption="Retained tables of this case, newest first" rows={tables} rowKey={(table) => table.sourceId}
        columns={[
          { header: 'Table', cell: (table) => <Link to={table.href}>{table.name}</Link> },
          { header: 'Retained', cell: (table) => table.retainedAt ? formatDateTime(table.retainedAt) : 'Unknown' },
        ]} />
    )}>
      <p className="ul-help">Each table has its own import page. Open one to continue its import.</p>
    </Panel>
  );
}

function NoTable({ sourceCount }: { sourceCount: number }) {
  return (
    <EmptyState icon={FilePlus} title="No table is retained in this case" action={(
      <Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>
    )}>
      {noTableSentence(sourceCount)}
    </EmptyState>
  );
}
