import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { TableRefusal } from './table/Progress';
import { useTableProfile } from './table/queries';
import { formatSelection, readBatchCase, type TableFromOriginalBody } from './table/retain';
import { TableSelectionFields } from './table/TableImportFields';
import { jobWords, tablePath, useFollowTable, type Opened } from './table/useFollowTable';
import styles from './Batch.module.css';

export interface ItemTableSource { sourceId: string; format: 'csv' | 'xlsx'; sheets: string[] }
type Follow = ReturnType<typeof useFollowTable>['follow'];

/**
 * N01B. The kept CSV or workbook an item can be read from, by its card: its own original, or for one sheet of a kept
 * workbook, the workbook's. A file inside a ZIP has no original of its own, so it is not offered.
 */
export function itemTableSource(item: IntakeItem, items: readonly IntakeItem[]): ItemTableSource | null {
  const card = item.card;
  if (card?.family !== 'table' || (card.format !== 'csv' && card.format !== 'xlsx')) return null;
  const parent = items.find((row) => row.itemId === item.parentItemId);
  const sourceId = item.sourceId ?? (parent?.card?.format === 'xlsx' ? parent.sourceId : null);
  return sourceId ? { sourceId, format: card.format, sheets: card.sheets.map((sheet) => sheet.name) } : null;
}

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
export function BatchTableSection({ caseId, item, items }: {
  caseId: string; item: IntakeItem; items: readonly IntakeItem[];
}) {
  const source = itemTableSource(item, items);
  return source ? <ItemTable caseId={caseId} name={item.name} source={source} /> : null;
}

function ItemTable({ caseId, name, source }: { caseId: string; name: string; source: ItemTableSource }) {
  // The profile read answers a table once the source is one, and refuses before; a refusal leaves the press shown.
  const profile = useTableProfile(caseId, source.sourceId);
  const read = profile.data?.version === 'manual-tabular/1';
  return <section className={styles.question} aria-label={`Table in ${name}`}>
    <h2 className="ul-heading">Table · {name}</h2>
    {profile.isPending ? <Skeleton /> : read ? <ReadTable opened={{ caseId, sourceId: source.sourceId }} />
      : <ReadAsTable caseId={caseId} source={source} />}
  </section>;
}

export function ReadTable({ opened }: { opened: Opened }) {
  return <>
    <p>This file is already read as a table.</p>
    <div><Link className="ul-btn" to={tablePath(opened)}>Open the table</Link></div>
  </>;
}

function ReadAsTable({ caseId, source }: { caseId: string; source: ItemTableSource }) {
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
  const reading = press.isPending && job ? jobWords(job, source.format === 'xlsx' ? 'workbook' : 'CSV') : null;
  return <ReadAsTableForm source={source} sheet={sheet} setSheet={setSheet} rows={rows} setRows={setRows}
    pending={press.isPending} submit={() => press.mutate()} reading={reading} error={press.error} />;
}

export function ReadAsTableForm({ source, sheet, setSheet, rows, setRows, pending, submit, reading, error }: {
  source: ItemTableSource; sheet: string; setSheet: (value: string) => void; rows: string;
  setRows: (value: string) => void; pending: boolean; submit: () => void; reading: string | null;
  error: Error | null;
}) {
  return <form className={styles.stack} onSubmit={(event) => {
    event.preventDefault();
    submit();
  }}>
    <p className="ul-help">
      The original stays unchanged. Reading it as a table creates mapped draft rows, not buildings; nothing enters
      the register or appears on the map.
    </p>
    <fieldset className={styles.fieldset} disabled={pending}>
      <TableSelectionFields format={source.format} sheets={source.sheets} sheet={sheet} setSheet={setSheet}
        rows={rows} setRows={setRows} />
    </fieldset>
    <div><Button type="submit" variant="primary" disabled={pending}>Read as a table</Button></div>
    {reading ? <p role="status">{reading}</p> : null}
    {error ? <TableRefusal error={error} /> : null}
  </form>;
}
