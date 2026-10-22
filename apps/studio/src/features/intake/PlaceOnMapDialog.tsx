import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog } from '@ulpin/ui';
import { placeTableOnMap } from './batch-queries';
import { FieldChoice } from './QuestionFields';
import { createTablePlacementCommand, emptyTablePlacement, tablePlacementPress, type TablePlacementForm,
  type TablePlacementState } from './table-placement-command';
import styles from './Batch.module.css';

type Column = { path: string; header: string };
const columnWords = (column: Column) => `${Number(column.path) + 1}. ${column.header || 'Empty header'}`;

/** TC1. For an item already read as a table: the officer states its coordinate columns and system, nothing else. */
export function PlaceOnMap({ caseId, itemId, name, headers }: {
  caseId: string; itemId: string; name: string; headers: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  return <>
    <div><Button variant="soft" onClick={() => setOpen(true)}>Place on the map</Button></div>
    {open ? <PlaceOnMapDialog caseId={caseId} itemId={itemId} name={name} headers={headers}
      onClose={() => setOpen(false)} /> : null}
  </>;
}

function PlaceOnMapDialog({ caseId, itemId, name, headers, onClose }: {
  caseId: string; itemId: string; name: string; headers: readonly string[]; onClose: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyTablePlacement);
  const [state, setState] = useState<TablePlacementState>(
    { busy: false, uncertain: false, error: '', started: false });
  const command = useRef<ReturnType<typeof createTablePlacementCommand> | null>(null);
  command.current ??= createTablePlacementCommand(body => placeTableOnMap(caseId, itemId, body), setState,
    () => void client.invalidateQueries({ queryKey: ['intake', caseId] }));
  return <Dialog title={`Place on the map · ${name}`} size="md" onClose={onClose}>
    <PlaceOnMapForm headers={headers} form={form} state={state} close={onClose}
      change={update => setForm(current => ({ ...current, ...update }))}
      submit={() => void command.current?.(form)} />
  </Dialog>;
}

export function PlaceOnMapForm({ headers, form, change, state, submit, close }: {
  headers: readonly string[]; form: TablePlacementForm; change: (update: Partial<TablePlacementForm>) => void;
  state: TablePlacementState; submit: () => void; close: () => void;
}) {
  const id = useId();
  const columns = headers.map((header, index) => ({ path: String(index), header }));
  if (state.started) return <div className={styles.stack}>
    <p role="status">
      Placing the rows of this table on the map has started. The file&apos;s line in this batch will say how many
      rows were placed and how many were skipped, and why.
    </p>
    <div><Button variant="primary" onClick={close}>Close</Button></div>
  </div>;
  return <form className={styles.stack} onSubmit={event => {
    event.preventDefault();
    submit();
  }}>
    <p className="ul-help">
      The original stays unchanged. Each row with usable coordinates becomes one feature of a new GeoJSON file that
      cites its row; a row without them is skipped and counted, never placed at 0,0. Points stay points.
    </p>
    <fieldset className={styles.fieldset} disabled={state.busy}>
      <label className="ul-field">
        <span className="ul-label">How the rows give their place</span>
        <select className="ul-input" value={form.kind}
          onChange={event => change({ kind: event.target.value === 'wkt' ? 'wkt' : 'columns' })}>
          <option value="columns">An x or longitude column and a y or latitude column</option>
          <option value="wkt">One column of WKT text</option>
        </select>
      </label>
      {form.kind === 'columns' ? <>
        <FieldChoice label="x or longitude" value={form.x} paths={columns} words={columnWords}
          choose={x => change({ x })} />
        <FieldChoice label="y or latitude" value={form.y} paths={columns} words={columnWords}
          choose={y => change({ y })} />
      </> : <FieldChoice label="WKT column" value={form.column} paths={columns} words={columnWords}
        choose={column => change({ column })} />}
      <label className="ul-field" htmlFor={id}>
        <span className="ul-label">Coordinate system</span>
        <input id={id} className="ul-input" value={form.crs} placeholder="EPSG:32643" autoComplete="off"
          aria-invalid={state.error ? true : undefined} aria-describedby={`${id}-help`}
          onChange={event => change({ crs: event.target.value })} />
        <span id={`${id}-help`} className="ul-help">
          Give the EPSG code these coordinates are in. None is assumed and the coordinates are not converted.
        </span>
      </label>
    </fieldset>
    <div className="ul-row">
      <Button type="submit" variant="primary" disabled={state.busy}>{tablePlacementPress(state)}</Button>
      <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
    </div>
    {state.error ? <p role="alert" className="ul-error">{state.error}</p> : null}
    {state.uncertain ? <p className="ul-help">The outcome is not known. The same answer is sent again.</p> : null}
  </form>;
}
