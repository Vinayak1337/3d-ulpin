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
// Stated by the officer; the cells are never read to guess it.
const decimalMarks = [['point', 'Point (12.34)'], ['comma', 'Comma (12,34)']] as const;

/**
 * TC1. For an item already read as a table: the officer states its coordinate columns, system and decimal mark.
 * TB2: `opened` shows the dialog at once, after a press on the table page has just made the item.
 */
export function PlaceOnMap({ caseId, itemId, name, headers, opened = false }: {
  caseId: string; itemId: string; name: string; headers: readonly string[]; opened?: boolean;
}) {
  const [open, setOpen] = useState(opened);
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
    <p role="status">Preparing the rows of this table as a GeoJSON file has started.</p>
    <div><Button variant="primary" onClick={close}>Close</Button></div>
  </div>;
  return <form className={styles.stack} onSubmit={event => {
    event.preventDefault();
    submit();
  }}>
    <fieldset className={styles.fieldset} disabled={state.busy}>
      <label className="ul-field">
        <span className="ul-label">Coordinates from</span>
        <select className="ul-input" value={form.kind}
          onChange={event => change({ kind: event.target.value === 'wkt' ? 'wkt' : 'columns' })}>
          <option value="columns">x and y columns</option>
          <option value="wkt">One WKT column</option>
        </select>
      </label>
      {form.kind === 'columns' ? <>
        <FieldChoice label="x or longitude" value={form.x} paths={columns} words={columnWords}
          choose={x => change({ x })} />
        <FieldChoice label="y or latitude" value={form.y} paths={columns} words={columnWords}
          choose={y => change({ y })} />
        <fieldset className={styles.fieldset}>
          <legend className="ul-label">Decimal mark</legend>
          {decimalMarks.map(([mark, words]) => <label key={mark} className="ul-row">
            <input type="radio" name={`${id}-mark`} value={mark} checked={form.decimalMark === mark}
              onChange={() => change({ decimalMark: mark })} />
            {words}
          </label>)}
        </fieldset>
      </> : <>
        <FieldChoice label="WKT column" value={form.column} paths={columns} words={columnWords}
          choose={column => change({ column })} />
      </>}
      <label className="ul-field" htmlFor={id}>
        <span className="ul-label">EPSG code</span>
        <input id={id} className="ul-input" value={form.crs} autoComplete="off"
          aria-invalid={state.error ? true : undefined} onChange={event => change({ crs: event.target.value })} />
      </label>
    </fieldset>
    <div className="ul-row">
      <Button type="submit" variant="primary" disabled={state.busy}>{tablePlacementPress(state)}</Button>
      <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
    </div>
    {state.error ? <p role="alert" className="ul-error">{state.error}</p> : null}
    {state.uncertain ? <p role="status">The outcome is not known.</p> : null}
  </form>;
}
