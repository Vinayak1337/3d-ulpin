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
import { useTableProfile } from './table/queries';
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
  return source ? <ItemTable caseId={caseId} itemId={item.itemId} name={item.name} source={source}
    primary={primary} /> : null;
}

function ItemTable({ caseId, itemId, name, source, primary }: {
  caseId: string; itemId: string; name: string; source: ItemTableSource; primary: boolean;
}) {
  // The profile read answers a table once the source is one, and refuses before; a refusal leaves the press shown.
  const profile = useTableProfile(caseId, source.sourceId);
  const read = profile.data?.version === 'manual-tabular/1' ? profile.data : null;
  return <section id={`intake-table-${itemId}`} className={styles.question} aria-label={`Table in ${name}`}>
    <h2 className="ul-heading">Table · {name}</h2>
    {profile.isPending ? <Skeleton /> : read ? <>
      <ReadTable opened={{ caseId, sourceId: source.sourceId }} reading={read.profile} />
      <PlaceOnMap caseId={caseId} itemId={itemId} name={name} headers={read.headers} />
    </> : <ReadAsTable caseId={caseId} source={source} primary={primary} />}
  </section>;
}

export function ReadTable({ opened, reading }: { opened: Opened; reading?: TableProfile['profile'] }) {
  const words = reading ? tableReadingWords(reading) : null;
  return <>
    <p>Read as a table.</p>
    {words ? <p>{words}</p> : null}
    <div><Link className="ul-btn" to={tablePath(opened)}>Open the table</Link></div>
  </>;
}

function ReadAsTable({ caseId, source, primary }: { caseId: string; source: ItemTableSource; primary: boolean }) {
  const [sheet, setSheet] = useState(source.sheets.length === 1 ? source.sheets[0]! : '');
  const [rows, setRows] = useState('');
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
