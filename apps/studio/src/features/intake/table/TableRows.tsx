import { useState } from 'react';
import { Banner, Button, DataTable, Skeleton } from '@ulpin/ui';
import { targetDefinition } from './model';
import { TableRefusal } from './Progress';
import { TABLE_PAGE_ROWS, useTableRows } from './queries';
import type { TableRow } from './types';
import styles from './Table.module.css';

type CellMark = NonNullable<TableRow['marks']>[number]['mark'];

/** XW1M: how the workbook reader marked a cell, in words; nothing is calculated and no value is shown for it. */
const MARK_WORDS: Record<CellMark, string> = {
  formula_cached: 'Formula, stored result not used',
  formula_uncached: 'Formula, no stored result',
  no_value: 'No value',
  error: 'Workbook error',
  unsupported: 'Not read',
};

const markOf = (row: TableRow, column: number) => row.marks?.find((item) => item.column === column)?.mark;

/** A cell as written: an empty cell and a cell the record does not have are both shown, never as 0. A workbook cell
 * the reader marked shows the mark's words, never its stored text. */
function Written({ value, mark }: { value: string | null; mark?: CellMark }) {
  if (mark) return <span className={styles.muted}>{MARK_WORDS[mark]}</span>;
  if (value === null) return <span className={styles.muted}>Absent</span>;
  if (value === '') return <span className={styles.muted}>Empty</span>;
  return <>{value}</>;
}

function Mapped({ row }: { row: TableRow }) {
  if (!row.mapped) return <span className={styles.muted}>Not mapped</span>;
  const named = row.mapped.filter((cell) => cell.target !== 'unknown');
  if (!named.length) return <span className={styles.muted}>No field mapped</span>;
  return <span className={styles.question}>{named.map((cell) => (
    <span key={cell.sourceField}>
      {targetDefinition(cell.target).displayLabel}: {cell.issueCode === 'TABULAR_CELL_UNAVAILABLE'
        ? 'Not read' : cell.value === null ? 'Unknown' : String(cell.value)} · {cell.state.replaceAll('_', ' ')}
    </span>
  ))}</span>;
}

/** G13: a table read as a stream is shown a page at a time, by record number, from the server's windows. */
export function TableRows({ caseId, sourceId }: { caseId: string; sourceId: string }) {
  const [cursors, setCursors] = useState<number[]>([-1]);
  const after = cursors.at(-1)!;
  const page = useTableRows(caseId, sourceId, after);
  const data = page.data;
  const first = data?.rows[0]?.record, last = data?.rows.at(-1)?.record;
  return (
    <section className="ul-panel" aria-label="Table records">
      <div className="ul-panel__head">
        <h2 className="ul-heading">Records</h2>
        <span className="ul-caption" role="status">{data ? `${data.records.toLocaleString('en-IN')} records · `
          + `${data.windows.written} windows read · ${data.windows.mapped} mapped` : 'Reading records…'}</span>
      </div>
      <div className="ul-pad ul-stack">
        {page.error ? <TableRefusal error={page.error} retry={() => void page.refetch()} /> : null}
        {data?.windows.failed.map((item) => (
          <Banner key={item.window} tone="warning">
            Records {(item.firstRecord + 1).toLocaleString('en-IN')}–{(item.lastRecord + 1).toLocaleString('en-IN')}
            {' '}were not mapped: {item.message ?? 'no reason given'}
            {item.issueCode ? ` (${item.issueCode})` : ''}
          </Banner>
        ))}
        {page.isPending ? <Skeleton /> : null}
        {data && !data.rows.length ? <p>No records yet.</p> : null}
      </div>
      {data?.rows.length ? (
        <div className={`${styles.scroll} ${styles.columns}`} tabIndex={0}
          aria-label="Records table">
          <DataTable caption="Records" rows={data.rows}
            rowKey={(row) => String(row.record)} columns={[
              { header: 'Record', numeric: true, cell: (row) => (row.record + 1).toLocaleString('en-IN') },
              { header: 'Source row', numeric: true, cell: (row) => row.sourceRow.toLocaleString('en-IN') },
              ...data.headers.map((header, index) => ({ header: `${index + 1}. ${header || 'Empty header'}`,
                cell: (row: TableRow) => <Written value={row.cells[index] ?? null} mark={markOf(row, index)} /> })),
              { header: 'Mapped fields', cell: (row: TableRow) => <Mapped row={row} /> },
            ]} />
        </div>
      ) : null}
      <div className={`ul-pad ${styles.pager}`}>
        <Button variant="ghost" disabled={cursors.length < 2 || page.isFetching}
          onClick={() => setCursors((list) => list.slice(0, -1))}>Previous {TABLE_PAGE_ROWS}</Button>
        <span className="ul-caption">{first === undefined ? 'No records on this page'
          : `Records ${(first + 1).toLocaleString('en-IN')}–${(last! + 1).toLocaleString('en-IN')}`}</span>
        <Button variant="ghost" disabled={data?.next == null || page.isFetching}
          onClick={() => setCursors((list) => [...list, data!.next!])}>Next {TABLE_PAGE_ROWS}</Button>
      </div>
    </section>
  );
}
