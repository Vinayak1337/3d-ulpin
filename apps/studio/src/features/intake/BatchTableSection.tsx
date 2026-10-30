import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { Button, Skeleton } from '@ulpin/ui';
import { itemTableSource, type ItemTableSource } from '@ulpin/contracts/usp';
export { itemTableSource, type ItemTableSource } from '@ulpin/contracts/usp';
import type { IntakeItem } from './batch-model';
import { PlaceOnMap } from './PlaceOnMapDialog';
import { TableRefusal } from './table/Progress';
import { hasManualProfile, useSourceCase, useTableProfile } from './table/queries';
import { formatSelection, readBatchCase, type TableFromOriginalBody } from './table/retain';
import { TableSelectionFields } from './table/TableImportFields';
import { tableReadingWords } from './table/SourceHeader';
import type { TableProfile } from './table/types';
import { jobWords, tablePath, useFollowTable, type Opened } from './table/useFollowTable';
import styles from './Batch.module.css';

type Follow = ReturnType<typeof useFollowTable>['follow'];

/**
 * One press of "Read as a table": a new request key with the workspace revision. A lost answer for the same choice
 * is sent again with the same key; a refusal, a stopped read or another choice makes the next press a new request.
 */
export function createItemTableRead(caseId: string, source: ItemTableSource, follow: Follow) {
  let body: TableFromOriginalBody | null = null;
  return async (sheet: string, rows: string): Promise<Opened> => {
    const selection = formatSelection(source.format, sheet, rows);
    if (JSON.stringify(body?.selection) !== JSON.stringify(selection)) body = null;
    try {
      body ??= { requestKey: crypto.randomUUID(), expectedWorkspaceRevision: (await readBatchCase(caseId)).revision,
        selection };
      return await follow(caseId, source.sourceId, body, () => { body = null; });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) body = null;
      throw error;
    }
  };
}

/** The item detail's table section; nothing for an item that is not a kept CSV or workbook. */
export function BatchTableSection({ caseId, item, items, primary = false }: {
  caseId: string; item: IntakeItem; items: readonly IntakeItem[]; primary?: boolean;
}) {
  const source = itemTableSource(item, items);
  return source ? <ItemTable caseId={caseId} item={item} source={source} primary={primary} /> : null;
}

/** While the server reads a table or workbook, the item's own words replace the press. */
function serverReadingWords(item: IntakeItem): string | null {
  return item.state === 'reading' ? item.limitReason : null;
}

function ItemTable({ caseId, item, source, primary }: {
  caseId: string; item: IntakeItem; source: ItemTableSource; primary: boolean;
}) {
  const records = useSourceCase(caseId, false);
  const retained = records.data?.sources?.find(row => row.id === source.sourceId);
  // A read CSV has its table receipt; a read workbook can instead be an inventory of unanswered sheets.
  const ready = hasManualProfile(retained)
    || (item.state === 'read' && ['csv', 'tsv'].includes(item.card?.format ?? ''));
  const profile = useTableProfile(caseId, source.sourceId, ready);
  const read = profile.data?.version === 'manual-tabular/1' ? profile.data : null;
  return <section id={`intake-table-${item.itemId}`} className={styles.question} aria-label={`Table in ${item.name}`}>
    <h2 className="ul-heading">Table · {item.name}</h2>
    {profile.isFetching && !profile.data ? <Skeleton /> :
      <ItemTableBody caseId={caseId} item={item} source={source} read={read} primary={primary} />}
  </section>;
}

function ItemTableBody({ caseId, item, source, read, primary }: {
  caseId: string; item: IntakeItem; source: ItemTableSource; read: TableProfile | null; primary: boolean;
}) {
  if (read) return <>
    <ReadTable opened={{ caseId, sourceId: source.sourceId }} reading={read.profile} />
    {source.format !== 'csv' ? <details>
      <summary>Change sheet or header rows</summary>
      <ReadAsTable caseId={caseId} source={source} selection={read.tabular.selection} />
    </details> : null}
    <PlaceOnMap caseId={caseId} itemId={item.itemId} name={item.name} headers={read.headers} />
  </>;
  const words = serverReadingWords(item);
  if (words) return <p role="status">{words}</p>;
  return <ReadAsTable caseId={caseId} source={source} primary={primary} />;
}

export function ReadTable({ opened, reading }: { opened: Opened; reading?: TableProfile['profile'] }) {
  const words = reading ? tableReadingWords(reading) : null;
  return <>
    <p>Read as a table.</p>
    {words ? <p>{words}</p> : null}
    <div><Link className="ul-btn" to={tablePath(opened)}>Open the table</Link></div>
  </>;
}

function ReadAsTable({ caseId, source, primary = false, selection }: {
  caseId: string; source: ItemTableSource; primary?: boolean;
  selection?: { sheet: string; headerRows: number[] };
}) {
  const [sheet, setSheet] = useState(selection?.sheet ?? (source.sheets.length === 1 ? source.sheets[0]! : ''));
  const [rows, setRows] = useState(selection?.headerRows.join(', ') ?? '');
  const { job, reset, follow, open } = useFollowTable();
  const [send] = useState(() => createItemTableRead(caseId, source, follow));
  const press = useMutation({
    mutationFn: () => {
      reset();
      return send(sheet, rows);
    },
    onSuccess: open,
  });
  const reading = press.isPending && job ? jobWords(job, source.format === 'csv' ? 'CSV' : 'workbook') : null;
  return <ReadAsTableForm source={source} sheet={sheet} setSheet={setSheet} rows={rows} setRows={setRows}
    pending={press.isPending} submit={() => press.mutate()} reading={reading} error={press.error} primary={primary} />;
}

export function ReadAsTableForm({ source, sheet, setSheet, rows, setRows, pending, submit, reading, error,
  primary = false }: {
  source: ItemTableSource; sheet: string; setSheet: (value: string) => void; rows: string;
  setRows: (value: string) => void; pending: boolean; submit: () => void; reading: string | null;
  error: Error | null; primary?: boolean;
}) {
  return <form className={styles.stack} onSubmit={(event) => {
    event.preventDefault();
    submit();
  }}>
    <fieldset className={styles.fieldset} disabled={pending}>
      <TableSelectionFields format={source.format} sheets={source.sheets} sheet={sheet} setSheet={setSheet}
        rows={rows} setRows={setRows} />
    </fieldset>
    <div><Button type="submit" variant={primary ? 'primary' : 'secondary'} disabled={pending}>
      Read as a table
    </Button></div>
    {reading ? <p role="status">{reading}</p> : null}
    {error ? <TableRefusal error={error} /> : null}
  </form>;
}
